/**
 * Deborah — Email Verify API (AUTH A-18)
 * --------------------------------------
 * POST /api/auth/verify/send      — kod qayta yuborish (resend, cooldown 60s)
 * POST /api/auth/verify/complete  — kodni tekshirish + email_verified=true
 *
 * Ikkalasi ham requireAuth (register'da session allaqachon o'rnatiladi) +
 * global CSRF + audit. Kod hech qachon log'ga chiqmaydi.
 */

import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { logAuthEvent, AUDIT_ACTIONS } from '../src/modules/auth/audit.js';
import { sendVerifyCode, verifyCode } from '../src/modules/auth/email-verify.js';
import { recordMetric } from '../src/telemetry/index.js';
// AUTH C-06 §07: OTP bombing — per-user 3/soat, per-IP 10/soat
import { detectOtpBomb } from '../src/modules/auth/abuse.js';

const router = Router();

/** User language — settings/lang (default uz), resolveAuthLang bilan. */
async function resolveUserLang(userKey) {
  try {
    const { resolveAuthLang } = await import('../data/auth-i18n.js');
    const { fb } = await import('../firebase/admin.js');
    const snap = await fb.get(`users/${userKey}/settings/lang`);
    return resolveAuthLang(snap.exists() ? snap.val() : 'uz');
  } catch (_) {
    return 'uz';
  }
}

// ── Resend kod ──
router.post('/api/auth/verify/send', requireAuth, async (req, res) => {
  const userKey = req.session?.user?.safeKey;
  const email = req.session?.user?.email || req.body?.email;
  if (!userKey) return res.status(401).json({ error: 'unauthorized' });
  if (!email || typeof email !== 'string') {
    return res.status(400).json({ error: 'email_required' });
  }

  const lang = await resolveUserLang(userKey);

  // AUTH C-06 §07: OTP bombing — Redis counter (fail-open: Redis yo'q → ok)
  const bomb = await detectOtpBomb({
    redis: req.app?.get('redisClient') || null,
    redisOk: req.app?.get('redisOk') === true,
    userId: userKey,
    ipAddress: req.ip,
  });
  if (!bomb.allowed) {
    logAuthEvent({
      action: AUDIT_ACTIONS.OTP_BOMB_DETECTED,
      outcome: 'blocked',
      method: 'otp',
      actorId: userKey,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    }).catch(() => {});
    return res.status(429).json({
      error: 'rate_limited', retryAfterSeconds: bomb.retryAfterSeconds,
      message: 'Juda ko\'p so\'rov yuborildi. Bir soatdan keyin qayta urinib ko\'ring',
    });
  }

  const result = await sendVerifyCode({ userKey, email, lang });
  if (!result.ok) {
    // 09/2026: send muvaffaqiyatsiz (mas. production'da EMAIL_PROVIDER=mock) —
    // server log'da ko'rinishi kerak; UI aniq xato oladi (endi jim qaytmaydi).
    if (result.error === 'send_failed') {
      console.warn(`[email:verify] kod yuborilmadi user=${userKey} -> ${email} (delivery failed)`);
    }
    return res
      .status(result.httpStatus || 400)
      .json({ error: result.error, retryAfterSeconds: result.retryAfterSeconds });
  }

  // B-06 §14: audit verify_sent (channel) — kod hech qachon log'ga chiqmaydi
  logAuthEvent({
    action: AUDIT_ACTIONS.EMAIL_VERIFY_SENT,
    outcome: 'success',
    method: 'resend',
    channel: 'email',
    actorId: userKey,
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  }).catch(() => {});

  // B-06 §20: metric verify_sent
  try {
    recordMetric('auth.email_verify.sent', 1, {
      type: 'counter',
      labels: { channel: 'email', method: 'resend' },
    });
  } catch (_) { /* telemetry fail-soft */ }

  res.json({ ok: true, deliveredTo: 'email' });
});

// ── Kodni tasdiqlash ──
router.post('/api/auth/verify/complete', requireAuth, async (req, res) => {
  const userKey = req.session?.user?.safeKey;
  const email = req.session?.user?.email;
  const { code } = req.body || {};
  if (!userKey) return res.status(401).json({ error: 'unauthorized' });

  const result = await verifyCode({ userKey, code, email });
  if (!result.ok) {
    // B-28 §08: muddati o'tgan kod — alohida audit + metric (expiry UX)
    if (result.error === 'expired') {
      logAuthEvent({
        action: AUDIT_ACTIONS.EMAIL_VERIFY_EXPIRED,
        outcome: 'fail',
        method: 'otp',
        channel: 'email',
        actorId: userKey,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      }).catch(() => {});
      try {
        recordMetric('auth.email_verify.expired', 1, { type: 'counter', labels: { channel: 'email' } });
      } catch (_) {}
    }
    logAuthEvent({
      action: AUDIT_ACTIONS.EMAIL_VERIFY_COMPLETE,
      outcome: 'fail',
      method: 'otp',
      channel: 'email',
      reason: result.error,
      actorId: userKey,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    }).catch(() => {});

    // B-07 §18: metric verify_complete (fail) — brute-force kuzatuvi
    try {
      recordMetric('auth.email_verify.complete', 1, {
        type: 'counter',
        labels: { channel: 'email', outcome: 'fail' },
      });
    } catch (_) { /* telemetry fail-soft */ }

    return res
      .status(result.httpStatus || 422)
      .json({ error: result.error, retryAfterSeconds: result.retryAfterSeconds });
  }

  // Session'da emailVerified=true — limited mode banner yo'qoladi
  if (req.session.user) req.session.user.emailVerified = true;

  logAuthEvent({
    action: AUDIT_ACTIONS.EMAIL_VERIFY_COMPLETE,
    outcome: 'success',
    method: 'otp',
    channel: 'email',
    actorId: userKey,
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  }).catch(() => {});

  // B-07 §18: metric verify_complete (success)
  try {
    recordMetric('auth.email_verify.complete', 1, {
      type: 'counter',
      labels: { channel: 'email', outcome: 'success' },
    });
    // AUTH D-06 §06: auth_verify_total (Prometheus)
    recordMetric('auth_verify_total', 1, { type: 'counter', labels: { method: 'email' } });
  } catch (_) { /* telemetry fail-soft */ }

  res.json({ ok: true, emailVerified: true });
});

export default router;
