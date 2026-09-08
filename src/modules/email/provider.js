/**
 * AUTH A-23 — Email provider abstraksiyasi
 * -------------------------------------------------
 * Transactional email yuborish. Provider tanlovi `.env` orqali:
 *
 *   EMAIL_PROVIDER=mock      (default; test/dev — hech qaerga yubormaydi, preview qaytaradi)
 *   EMAIL_PROVIDER=smtp      (nodemailer; SMTP_HOST/PORT/USER/PASS)
 *   EMAIL_PROVIDER=postmark  (Postmark API; POSTMARK_SERVER_TOKEN)
 *
 * Qoidalar:
 *   - Faqat TRANSACTIONAL (welcome, verify, reset, teacher_approved/rejected).
 *     Marketing alohida tizim (A-23 §08 — aralashmaydi).
 *   - Retry/backoff: muvaffaqiyatsizlikda 3 marta (1s/3s/9s — exponential).
 *   - Kredensiallar faqat server'da (env); hech qachon frontend'ga chiqmaydi.
 *   - Email'da parol/token hech qachon emas; reset'da faqat token HAVOLASI.
 */

// AUTH B-02: send-side email_log — status (sent|failed) + emailHash (PII minimal)
import { logEmailRecord } from './log.js';

// D-01: EMAIL_FROM/EMAIL_SENDING_DOMAIN env schema'dan (Zod validated);
// eski MAIL_* nomlari backward-compat fallback sifatida qoladi.
const DEFAULT_FROM = process.env.EMAIL_FROM || process.env.MAIL_FROM || 'Deborah <no-reply@deborah.uz>';
const SENDING_DOMAIN = process.env.EMAIL_SENDING_DOMAIN || process.env.MAIL_SENDING_DOMAIN || 'mail.deborah.uz';

const RETRY_DELAYS_MS = [1000, 3000, 9000]; // 3 marta (exponential backoff)

/* -------------------------------------------------------------------------- */
/* AUTH D-32 — provider failover (§07/§25) + cost tracking (§08/§26)          */
/* -------------------------------------------------------------------------- */

// Failover trigger: 5x provider xatosi 1 daqiqa ichida → secondary (§25).
const FAILOVER_ERROR_WINDOW_MS = 60_000;
const FAILOVER_ERROR_THRESHOLD = 5;
const FAILOVER_COOLDOWN_MS = 5 * 60_000; // 5 daqiqadan keyin primary'ga qaytish urinishi (auto-recovery)

let failover = {
  consecutiveErrors: 0,
  firstErrorAt: null,
  active: null, // 'primary' | 'secondary' | null
  switchedAt: null,
  cooldownUntil: 0,
};

/** Provider tartibi: EMAIL_PROVIDER_PRIMARY → EMAIL_PROVIDER_SECONDARY (§07). */
export function getProviderOrder(env = process.env) {
  const pick = (v) => (String(v || '').toLowerCase());
  const primary = pick(env.EMAIL_PROVIDER_PRIMARY || env.EMAIL_PROVIDER || 'mock');
  const secondary = pick(env.EMAIL_PROVIDER_SECONDARY || (primary === 'mock' ? 'smtp' : 'mock'));
  const order = [];
  for (const p of [primary, secondary]) {
    if (['mock', 'smtp', 'postmark', 'ses'].includes(p) && !order.includes(p)) order.push(p);
  }
  return order.length ? order : ['mock'];
}

/** Failover holatini tozalaydi (testlar uchun). */
export function resetFailoverState() {
  failover = { consecutiveErrors: 0, firstErrorAt: null, active: null, switchedAt: null, cooldownUntil: 0 };
  return failover;
}

/** Hozirgi faol provider (failover holatiga qarab). */
export function activeProvider(env = process.env) {
  const order = getProviderOrder(env);
  if (failover.active === 'secondary') {
    // Auto-recovery (§25): cooldown tugadi → primary'ga qaytish urinishi
    if (Date.now() >= failover.cooldownUntil) return order[0];
    return order[1] ?? order[0];
  }
  return order[0];
}

/** Provider natijasini qayd qiladi — failover trigger/recovery (§25). */
export function recordProviderResult(ok, env = process.env) {
  const now = Date.now();
  if (ok) {
    failover.consecutiveErrors = 0;
    failover.firstErrorAt = null;
    if (failover.active === 'secondary') {
      failover.active = null; // recovery
      failover.switchedAt = null;
      return { recovered: true, active: null };
    }
    return { recovered: false, active: null };
  }
  failover.consecutiveErrors += 1;
  if (!failover.firstErrorAt) failover.firstErrorAt = now;
  if (now - failover.firstErrorAt > FAILOVER_ERROR_WINDOW_MS) {
    failover.firstErrorAt = now; // window o'tdi — qayta boshlash
    failover.consecutiveErrors = 1;
  }
  if (
    failover.consecutiveErrors >= FAILOVER_ERROR_THRESHOLD &&
    failover.active !== 'secondary' &&
    getProviderOrder(env).length > 1
  ) {
    failover.active = 'secondary';
    failover.switchedAt = now;
    failover.cooldownUntil = now + FAILOVER_COOLDOWN_MS;
    return { switched: true, active: 'secondary' };
  }
  return { switched: false, active: failover.active };
}

/** Provider status (health/metrics uchun). */
export function failoverStatus() {
  return { ...failover };
}

// ── Cost tracking (§08/§26) — per-provider email narxi (USD).
const COST_PER_EMAIL = { postmark: 0.00165, smtp: 0.0004, ses: 0.0001, mock: 0 };

export function emailCostPerUnit(provider) {
  return COST_PER_EMAIL[provider] || 0;
}

/**
 * Email cost'ni yig'adi: email_cost/{YYYY-MM}/{provider} (D-32 §26) + budget alert.
 * E-07: budget config endi DB'dan (admin set qilgan) — env faqat default; 80% warn
 * idempotent (oyiga bir marta audit) — har yuborishda spam bo'lmaydi.
 * @returns {Promise<{month, provider, cost, count}>}
 */
export async function recordEmailCost({ provider, count = 1, budget = null } = {}) {
  const month = new Date().toISOString().slice(0, 7);
  const key = `email_cost/${month}/${String(provider || 'unknown')}`;
  const unit = emailCostPerUnit(provider);
  try {
    const { fb } = await import('../../../firebase/admin.js');
    const snap = await fb.get(key);
    const prev = snap.exists() ? snap.val() || {} : {};
    const prevCount = Number(prev.count || 0);
    const prevCost = Number(prev.cost || 0);
    const totalCount = prevCount + count;
    const totalCost = Math.round((prevCost + count * unit) * 1000) / 1000;
    await fb.set(key, { cost: totalCost, count: totalCount, updatedAt: Date.now() });
    // E-07: budget config (DB admin set > env default), 80% warn + 100% exceeded (idempotent)
    let budgetAmt = Number(budget || 0);
    if (!(budgetAmt > 0)) {
      const { getBudgetConfig } = await import('./budget.js');
      const cfg = await getBudgetConfig();
      budgetAmt = Number(cfg.amount || 0);
    }
    if (budgetAmt > 0) {
      const { markBudgetAlert } = await import('./budget.js');
      const { logAuthEvent, AUDIT_ACTIONS } = await import('../auth/audit.js');
      const pct = (totalCost / budgetAmt) * 100;
      const fireAlert = async (flag, level) => {
        if (await markBudgetAlert(month, flag)) {
          await logAuthEvent({
            action: AUDIT_ACTIONS.EMAIL_BUDGET_ALERT,
            outcome: level,
            actorId: null,
            details: { month, provider, cost: totalCost, budget: budgetAmt, pct: Math.round(pct * 10) / 10 },
          }).catch(() => {});
        }
      };
      if (pct >= 100) {
        await fireAlert('exceeded', 'warn');
      } else if (pct >= 80) {
        await fireAlert('warn80', 'warn');
      }
    }
    return { month, provider, cost: totalCost, count, totalCount };
  } catch {
    return { month, provider, cost: 0, count };
  }
}

/**
 * AUTH A-23 review fix: bounce'dan keyin suppress qilingan email'ga
 * qayta-qayta yubormaslik. Email webhook (`email_suppressed/{safeKey}`)
 * yozgan bo'lsa — yuborishni o'tkazib yuboramiz (deliverability spiral).
 * Dynamic import — provider modulini yengil saqlash (unit test'lar uchun).
 */
export async function isEmailSuppressed(email) {
  if (!email) return false;
  try {
    const { fb } = await import('../../../firebase/admin.js');
    const { safeKey } = await import('../../../utils/helpers.js');
    const snap = await fb.get(`email_suppressed/${safeKey(String(email).toLowerCase().trim())}`);
    return snap.exists();
  } catch {
    return false; // fb muammosi email yuborishni bloklamaydi (fail-open)
  }
}

/** Provider'ni env'dan aniqlaydi (test'da 'mock'). */
export function resolveProvider(env = process.env) {
  if (env.NODE_ENV === 'test') return 'mock';
  const p = (env.EMAIL_PROVIDER || 'mock').toLowerCase();
  return ['mock', 'smtp', 'postmark'].includes(p) ? p : 'mock';
}

/**
 * Bitta email yuboradi (retry bilan).
 * @param {{to: string, subject: string, html: string, text?: string, tag?: string, metadata?: object}} msg
 * @param {{provider?: string, sendImpl?: Function}} [deps] — test'da injectable
 * @returns {Promise<{ok: boolean, messageId?: string, provider: string, error?: string, attempts: number}>}
 */
export async function sendEmail(msg, deps = {}) {
  const provider = deps.provider || activeProvider();
  const { to, subject, html, text } = msg || {};
  if (!to || !subject || (!html && !text)) {
    return { ok: false, provider, error: 'invalid-message', attempts: 1 };
  }

  // AUTH A-23 review: suppress qilingan email'ga yubormaymiz (test'da
  // deps.checkSuppressed injekt qilinadi).
  const checkSuppressed = deps.checkSuppressed || isEmailSuppressed;
  if (await checkSuppressed(to)) {
    console.warn(`[email] suppressed, skip send: ${maskEmail(to)}`);
    return { ok: false, provider, error: 'suppressed', attempts: 0, suppressed: true };
  }

  let lastErr = null;
  let messageId = null;
  for (let attempt = 1; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      const result = await sendOnce(
        {
          from: DEFAULT_FROM,
          ...msg,
          html: html || undefined,
          text: text || stripHtml(html || ''),
          metadata: { ...(msg.metadata || {}), sendingDomain: SENDING_DOMAIN },
        },
        { provider, sendImpl: deps.sendImpl },
      );
      messageId = result.messageId;
      // AUTH B-02: sent status — email_log (PII minimal, fail-soft)
      logEmailRecord({
        email: to,
        template: msg.tag || null,
        status: 'sent',
        providerMsgId: messageId,
        id: messageId,
      }).catch(() => {});
      // AUTH D-32 §08: cost tracking (fail-soft) — provider muvaffaqiyatli
      recordEmailCost({ provider, count: 1 }).catch(() => {});
      recordProviderResult(true); // failover window reset / auto-recovery
      return { ok: true, messageId, provider, attempts: attempt };
    } catch (err) {
      lastErr = err;
      if (attempt < RETRY_DELAYS_MS.length) {
        await sleep(RETRY_DELAYS_MS[attempt - 1]);
      }
    }
  }
  // ── AUTH D-32 §07: primary fail → secondary (xabar yo'qolmaydi, queue saqlaydi) ──
  const outcome = recordProviderResult(false);
  // secondary'ga switch bo'ldi (shu yoki avvalgi fail'da) → darhol secondary'da sinaymiz
  if (outcome.switched || outcome.active === 'secondary') {
    const { logAuthEvent, AUDIT_ACTIONS } = await import('../auth/audit.js');
    await logAuthEvent({
      action: AUDIT_ACTIONS.EMAIL_PROVIDER_FAILOVER,
      outcome: 'warn',
      actorId: null,
      details: { from: provider, to: getProviderOrder()[1], reason: String(lastErr?.message || 'send-failed').slice(0, 120) },
    }).catch(() => {});
    const secondary = getProviderOrder()[1];
    if (secondary && secondary !== provider) {
      try {
        const sres = await sendOnce(
          {
            from: DEFAULT_FROM,
            ...msg,
            html: html || undefined,
            text: text || stripHtml(html || ''),
            metadata: { ...(msg.metadata || {}), sendingDomain: SENDING_DOMAIN },
          },
          { provider: secondary, sendImpl: deps.sendImpl },
        );
        logEmailRecord({
          email: to,
          template: msg.tag || null,
          status: 'sent',
          providerMsgId: sres.messageId,
          id: sres.messageId,
        }).catch(() => {});
        recordEmailCost({ provider: secondary, count: 1 }).catch(() => {});
        recordProviderResult(true); // secondary muvaffaqiyat — recovery
        return { ok: true, messageId: sres.messageId, provider: secondary, attempts: RETRY_DELAYS_MS.length + 1, failedOver: true };
      } catch (err2) {
        lastErr = err2;
      }
    }
  }
  console.warn(`[email:${provider}] send failed after ${RETRY_DELAYS_MS.length} attempts: ${lastErr?.message || lastErr}`);
  // AUTH B-02: failed status — email_log (email o'zi HECH QACHON yozilmaydi)
  logEmailRecord({
    email: to,
    template: msg.tag || null,
    status: 'failed',
    error: lastErr?.message || lastErr || 'send-failed',
  }).catch(() => {});
  return { ok: false, provider, error: 'send-failed', attempts: RETRY_DELAYS_MS.length };
}

/** Bitta urinish — provider'ga qarab. */
async function sendOnce(msg, { provider, sendImpl }) {
  if (sendImpl) {
    // Test'da to'liq mock (transport o'rniga)
    const out = await sendImpl(msg);
    return { messageId: out?.messageId || `mock-${Date.now()}-${Math.random().toString(16).slice(2, 8)}` };
  }
  if (provider === 'postmark') return sendViaPostmark(msg);
  if (provider === 'smtp') return sendViaSmtp(msg);
  return sendViaMock(msg);
}

/** Mock transport — hech qaerga yubormaydi; log + messageId (dev/test). */
async function sendViaMock(msg) {
  // BUG-FIX 09/2026: production'da mock transport "yubordi" deb jim o'tib
  // ketardi → foydalanuvchi kodni olmay, hech qanday xato ko'rmas edi.
  // Production'da mock taqiqlanadi: xato aniq ko'rinadi (UI 502 + email_log failed),
  // deploy'da EMAIL_PROVIDER=smtp/postmark sozlanishi shart ekani ochiq aytiladi.
  if (process.env.NODE_ENV === 'production') {
    throw new Error('EMAIL_PROVIDER=mock production uchun taqiqlangan — SMTP/Postmark sozlang');
  }
  // Log'da email mazmuni YO'Q (PII); faqat meta.
  console.info(`[email:mock] would-send to=${maskEmail(msg.to)} tag=${msg.tag || '-'} subject="${msg.subject}"`);
  return { messageId: `mock-${Date.now()}-${Math.random().toString(16).slice(2, 8)}` };
}

/** Postmark API (transactional-only, A-23 §06/§07). */
async function sendViaPostmark(msg) {
  const token = process.env.POSTMARK_SERVER_TOKEN;
  if (!token) throw new Error('POSTMARK_SERVER_TOKEN not set');
  const res = await fetch('https://api.postmarkapp.com/email', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'X-Postmark-Server-Token': token,
    },
    body: JSON.stringify({
      From: msg.from,
      To: msg.to,
      Subject: msg.subject,
      HtmlBody: msg.html,
      TextBody: msg.text,
      Tag: msg.tag,
      Metadata: msg.metadata || {},
      MessageStream: 'outbound', // transactional stream
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`postmark http-${res.status} ${body.slice(0, 200)}`);
  }
  const data = await res.json();
  return { messageId: data.MessageID };
}

/** SMTP (nodemailer) — generic provider uchun. */
async function sendViaSmtp(msg) {
  const nodemailer = (await import('nodemailer')).default;
  const host = process.env.SMTP_HOST;
  if (!host) throw new Error('SMTP_HOST not set');
  const transport = nodemailer.createTransport({
    host,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    // BUG-039: timeout'siz transport sekin SMTP'da so'rovni minutlar bloklar
    // edi (reg POST 90-180s timeout). 10-15s chegaralar.
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      : undefined,
  });
  const info = await transport.sendMail({
    from: msg.from,
    to: msg.to,
    subject: msg.subject,
    html: msg.html,
    text: msg.text,
    headers: { 'X-Tag': msg.tag || '' },
  });
  return { messageId: info.messageId };
}

/** HTML'dan oddiy matn (text berilmaganda). */
function stripHtml(html) {
  return String(html || '')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function maskEmail(email) {
  const [user, domain] = String(email || '').split('@');
  if (!domain) return '***';
  return `${(user || '').slice(0, 2)}***@${domain}`;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export { DEFAULT_FROM, SENDING_DOMAIN, stripHtml, maskEmail };
