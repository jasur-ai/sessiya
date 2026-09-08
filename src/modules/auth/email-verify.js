/**
 * Deborah — Email Verify Core (AUTH A-18, P0)
 * -------------------------------------------------
 * Register'da email majburiy + verify (OTP 6-kod).
 *
 * STORAGE:
 *   - email_verify/{hashOtp(code, '')} → { userKey, email, codeHash, salt, used, expiresAt, createdAt }
 *     (record kaliti = deterministik kod-hash; collision guard telegram-otp'da bo'lgani kabi)
 *   - users/{userKey}/email_verified → true (verify'da)
 *
 * SECURITY:
 *   - Kod plaintext saqlanmaydi (sha256(code:salt)); hech qachon log'ga chiqmaydi.
 *   - Single-use consume (withLock + re-read + used flag); 15 daqiqa TTL.
 *   - Rate limit: send 3/soat per-user+email; check 5/15 daqiqa per-user (brute-force).
 *   - Resend cooldown 60s.
 *
 * DELIVERY:
 *   - Email infra (nodemailer/SMTP) production config — hozircha queue + preview log
 *     (new-device deliverAlert pattern; kod faqat dev/test'da preview, production'da
 *     faqat email orqali yuboriladi).
 */

import crypto from 'crypto';
import { fb } from '../../../firebase/admin.js';
import { safeKey } from '../../../utils/helpers.js';
// AUTH A-23: haqiqiy email yuborish (provider abstraksiya) + verify template
import { sendEmail } from '../email/provider.js';
import { renderVerify } from '../email/templates.js';

// ── Config ──
const TTL_MS = 15 * 60 * 1000; // 15 daqiqa
const RESEND_COOLDOWN_MS = 60 * 1000; // 60s
const SEND_MAX_PER_HOUR = 3; // 3/soat
const CHECK_MAX_PER_WINDOW = 5; // 5/15 daqiqa
const WINDOW_MS = 15 * 60 * 1000;

// ── Rate limit store (memory) ──
const sendAttempts = new Map(); // key → timestamps[]
const checkAttempts = new Map(); // key → timestamps[]
const RATE_MAX_KEYS = 5000;

function bump(map, key, max, windowMs) {
  const now = Date.now();
  const arr = (map.get(key) || []).filter((t) => now - t < windowMs);
  if (arr.length >= max) {
    return { allowed: false, retryAfterSeconds: Math.ceil((arr[0] + windowMs - now) / 1000) };
  }
  arr.push(now);
  if (map.size > RATE_MAX_KEYS) {
    // memory guard — eng eski key'ni tashlab yuboramiz
    const oldest = map.keys().next().value;
    map.delete(oldest);
  } else {
    map.set(key, arr);
  }
  return { allowed: true };
}

/** 6-xonali kod — crypto.randomInt (predictable emas). */
export function generateCode() {
  return crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
}

/** B-28 §13: jitter uchun yordamchi — test'da stub qilinishi mumkin. */
export function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Kod hash (saqlash uchun): sha256(code:salt). */
export function hashCode(code, salt) {
  return crypto.createHash('sha256').update(`${String(code)}:${String(salt)}`).digest('hex');
}

/** per-user lock zanjiri (single-use race'ga qarshi). */
const locks = new Map();
function withLock(key, fn) {
  const prev = locks.get(key) || Promise.resolve();
  const next = prev.then(fn, fn);
  locks.set(key, next.catch(() => {}));
  return next;
}

/**
 * Verify kod yaratadi va saqlaydi (record kaliti = deterministik kod-hash).
 * @returns {Promise<{ ok: boolean, code?: string, error?: string, httpStatus?: number, retryAfterSeconds?: number }>}
 */
export async function sendVerifyCode({ userKey, email, lang = 'uz' }) {
  if (!userKey || !email) return { ok: false, error: 'missing_fields', httpStatus: 400 };

  const key = `send:${safeKey(userKey)}`;
  const limit = bump(sendAttempts, key, SEND_MAX_PER_HOUR, 60 * 60 * 1000);
  if (!limit.allowed) {
    return { ok: false, error: 'too_many_requests', httpStatus: 429, retryAfterSeconds: limit.retryAfterSeconds };
  }

  // Resend cooldown 60s — so'nggi record'ni tekshiramiz
  const lastSnap = await fb.get(`email_verify_last/${safeKey(userKey)}`);
  if (lastSnap.exists()) {
    const last = lastSnap.val();
    const elapsed = Date.now() - (last.at || 0);
    if (elapsed < RESEND_COOLDOWN_MS) {
      return {
        ok: false,
        error: 'resend_cooldown',
        httpStatus: 429,
        retryAfterSeconds: Math.ceil((RESEND_COOLDOWN_MS - elapsed) / 1000),
      };
    }
  }

  const code = generateCode();
  const salt = crypto.randomBytes(8).toString('hex');

  // Collision guard: band (tirik) lookupKey'ga yangi kod generatsiya
  let lookupKey = hashCode(code, '');
  for (let attempt = 0; attempt < 8; attempt++) {
    const existing = await fb.get(`email_verify/${lookupKey}`);
    if (!existing.exists()) break;
    const rec = existing.val();
    if (!rec || rec.used || (rec.expiresAt && rec.expiresAt < Date.now())) break;
    code = generateCode();
    lookupKey = hashCode(code, '');
  }

  // B-28 §15: resend oldingi kodni bekor qiladi (replay yo'q) — eski
  // lookupKey record'ini used qilamiz; yangi kod endi yagona amal qiladi.
  try {
    const lastSnap2 = await fb.get(`email_verify_last/${safeKey(userKey)}`);
    if (lastSnap2.exists()) {
      const lastRec = lastSnap2.val();
      if (lastRec && lastRec.lookupKey && lastRec.lookupKey !== lookupKey) {
        const old = await fb.get(`email_verify/${lastRec.lookupKey}`);
        if (old.exists()) {
          const oldRec = old.val();
          if (!oldRec.used) {
            await fb.update(`email_verify/${lastRec.lookupKey}`, { used: true, replaced_by: lookupKey, used_at: Date.now() });
          }
        }
      }
    }
  } catch (_) { /* old kodni bekor qilish fail-soft */ }

  const record = {
    userKey,
    email: String(email).toLowerCase().trim(),
    codeHash: hashCode(code, salt),
    salt,
    used: false,
    expiresAt: Date.now() + TTL_MS,
    createdAt: Date.now(),
  };
  await fb.set(`email_verify/${lookupKey}`, record);
  await fb.set(`email_verify_last/${safeKey(userKey)}`, { at: Date.now(), lookupKey });

  // DELIVERY (AUTH A-23): provider orqali haqiqiy email — mock/smtp/postmark.
  // Dev/test'da kod preview'da qaytadi (email ham mock'da log'lanadi);
  // production'da faqat email orqali. Email'da kod log'ga chiqmaydi.
  // B-06 §09: template 4 til — lang user settings'dan (resolveAuthLang route'da).
  const tpl = renderVerify({ code, lang });
  const sent = await sendEmail({
    to: record.email,
    subject: tpl.subject,
    html: tpl.html,
    text: tpl.text,
    tag: 'verify',
  }).catch((err) => {
    console.warn('[email:verify] send failed:', err?.message || err);
    return { ok: false, error: String(err?.message || err).slice(0, 300) };
  });

  // BUG-FIX 09/2026 (user: "kod emailga kelmayapti"): ilgari yuborish
  // muvaffaqiyatsiz bo'lsa ham { ok:true, delivery:'queued' } qaytardi —
  // UI "yuborildi" deb ko'rsatib, email hech qachon bormas edi (jim yutqazish).
  // Endi yetkazib bo'lmasa 502 send_failed → UI aniq xato ko'rsatadi.
  if (!sent || sent.ok !== true) {
    return { ok: false, error: 'send_failed', httpStatus: 502 };
  }
  const preview = process.env.NODE_ENV !== 'production' ? code : null;
  return { ok: true, code: preview, delivery: 'sent' };
}

/**
 * Kodni iste'mol qiladi (single-use) va email'ni tasdiqlaydi.
 * @returns {Promise<{ ok: boolean, error?: string, httpStatus?: number }>}
 */
export async function verifyCode({ userKey, code, email }) {
  if (!userKey) return { ok: false, error: 'missing_fields', httpStatus: 400 };
  if (!code || !/^\d{6}$/.test(String(code))) {
    return { ok: false, error: 'invalid_code_format', httpStatus: 400 };
  }

  const key = `check:${safeKey(userKey)}`;
  const limit = bump(checkAttempts, key, CHECK_MAX_PER_WINDOW, WINDOW_MS);
  if (!limit.allowed) {
    return { ok: false, error: 'too_many_attempts', httpStatus: 429, retryAfterSeconds: limit.retryAfterSeconds };
  }

  const lookupKey = hashCode(String(code), '');
  return withLock(`verify:${lookupKey}`, async () => {
    const cur = await fb.get(`email_verify/${lookupKey}`);
    // B-28 §13: xato/eskirgan kodda jitter (100-300ms) — javob vaqti
    // tasodifiy, brute-force sekinlashadi (C-01 bilan birga).
    // B-07 §08: noto'g'ri/eskirgan → 422 OTP_INVALID (kontrakt); B-28 §08:
    // muddati o'tgan kod → expired (UX: "Yangi kod yuborish" CTA).
    if (!cur.exists()) {
      await delay(100 + Math.floor(Math.random() * 201));
      return { ok: false, error: 'otp_invalid', httpStatus: 422 };
    }
    const rec = cur.val();
    if (rec.used) {
      await delay(100 + Math.floor(Math.random() * 201));
      return { ok: false, error: 'otp_invalid', httpStatus: 422 };
    }
    if (rec.expiresAt && rec.expiresAt < Date.now()) {
      await delay(100 + Math.floor(Math.random() * 201));
      return { ok: false, error: 'expired', httpStatus: 422 };
    }
    // User guard: kod boshqa user'ga tegishli bo'lmasin (agar topilsa)
    if (rec.userKey && rec.userKey !== userKey) {
      await delay(100 + Math.floor(Math.random() * 201));
      return { ok: false, error: 'otp_invalid', httpStatus: 422 };
    }
    // Email guard: verify'dagi email record'dagi bilan mos (o'zgargan bo'lsa)
    if (email && rec.email && String(email).toLowerCase().trim() !== rec.email) {
      await delay(100 + Math.floor(Math.random() * 201));
      return { ok: false, error: 'otp_invalid', httpStatus: 422 };
    }
    // B-07 §09: bitta foydalanish (replay yo'q) — used_at timestamp
    await fb.update(`email_verify/${lookupKey}`, { used: true, used_at: Date.now() });
    // User mavjud bo'lsa email_verified=true yoziladi; yo'q bo'lsa user
    // yaratilmaydi (partially-created user xavfi) — 404 qaytaramiz.
    const userSnap = await fb.get(`users/${safeKey(userKey)}`);
    if (!userSnap.exists()) {
      return { ok: false, error: 'user_not_found', httpStatus: 404 };
    }
    // B-07 §07: email_verified=true + email_status=verified (B-01 schema)
    await fb.update(`users/${safeKey(userKey)}`, {
      email_verified: true,
      email_status: 'verified',
    });
    // D-22 §14: verify roziligi consent_log — email PII qayta ishlash auditi.
    // Register'da privacy_policy_v1 allaqachon berilgan; bu yerda verify'ni
    // ham yozamiz (idempotent — bir xil versiya → bump YO'Q, consent:granted
    // audit). Dinamik import — legal→auth import siklini oldini oladi.
    try {
      const { recordConsent, CONSENT_PURPOSES } = await import('../legal/consent.js');
      await recordConsent(userKey, CONSENT_PURPOSES.PRIVACY_POLICY, {});
    } catch (_) { /* fail-soft — verify'ning o'zi buzilmaydi */ }
    // last recordni tozalaymiz — resend cooldown endi kerak emas
    await fb.set(`email_verify_last/${safeKey(userKey)}`, { at: 0, lookupKey });
    return { ok: true };
  });
}

/** Email bandligini tekshiradi (register'da — users_email_index). */
export async function emailExists(email) {
  if (!email) return false;
  const key = safeKey(String(email).toLowerCase().trim());
  const snap = await fb.get(`users_email_index/${key}`);
  return snap.exists();
}

/**
 * AUTH A-20: email → userKey lookup (users_email_index orqali).
 * Forgot flow'da account field email bo'lsa ishlatiladi.
 * @returns {Promise<string|null>} userKey yoki null
 */
export async function findUserKeyByEmail(email) {
  if (!email) return null;
  const key = safeKey(String(email).toLowerCase().trim());
  const snap = await fb.get(`users_email_index/${key}`);
  if (!snap.exists()) return null;
  const userKey = snap.val();
  return typeof userKey === 'string' && userKey ? userKey : null;
}

/**
 * AUTH A-20: account string'ini userKey ga resolve qiladi — username OR email.
 * Enumeration-safe: email index'da bo'lmasa ham null qaytaradi (forgot
 * javobi bir xil bo'ladi).
 * @param {string} account — username yoki email
 * @returns {Promise<{ userKey: string|null, byEmail: boolean }>}
 */
export async function resolveAccountToUserKey(account) {
  if (!account || typeof account !== 'string') return { userKey: null, byEmail: false };
  const trimmed = account.trim();
  if (!trimmed) return { userKey: null, byEmail: false };

  // 1) Avval username sifatida
  const asUsername = safeKey(trimmed);
  const userSnap = await fb.get(`users/${asUsername}`);
  if (userSnap.exists()) return { userKey: asUsername, byEmail: false };

  // 2) Email sifatida (index orqali)
  const byEmail = await findUserKeyByEmail(trimmed);
  if (byEmail) return { userKey: byEmail, byEmail: true };

  return { userKey: null, byEmail: false };
}

/** Emailni index'ga yozadi (register'da — unique guard). */
export async function indexEmail(email, userKey) {
  if (!email || !userKey) return { ok: false, error: 'missing_fields', httpStatus: 400 };
  const key = safeKey(String(email).toLowerCase().trim());
  return withLock(`email-index:${key}`, async () => {
    const existing = await fb.get(`users_email_index/${key}`);
    if (existing.exists() && existing.val() !== userKey) {
      return { ok: false, error: 'email_taken', httpStatus: 409 };
    }
    await fb.set(`users_email_index/${key}`, userKey);
    return { ok: true };
  });
}
