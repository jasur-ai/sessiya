/**
 * Deborah — Authentication Routes
 * User login/register and admin login
 *
 * Security:
 *   - Admin credentials from CONFIG (Zod-validated env) — no hardcoded fallback
 *   - User passwords hashed with argon2id (memory-hard, salt included)
 *   - Legacy SHA-256 hashes auto-migrated on successful login
 *   - CSRF validation active on all POST endpoints
 *   - Rate-limited login routes (15 min window, 20 attempts)
 */

import { Router } from 'express';
import crypto from 'crypto';
import qrcode from 'qrcode';
import CONFIG from '../src/config/env.js';
// AUTH D-29: client validation rules (contracts.js'dan single source)
import { buildClientRules, RULES_VERSION } from '../src/modules/auth/validation-rules.js';
const requireValidationRules = () => ({ buildClientRules, RULES_VERSION });
import { fb } from '../firebase/admin.js';
import { safeKey, hashPassword, verifyPassword, isLegacyHash, hashPass, verifyLoginPassword } from '../utils/helpers.js';
import { redirectIfAuth, redirectIfAdmin, requireAuth, requireRecentAuth, requireMfaStepUp, requireRecentAdminAuth, requireAdmin, requireLowRisk } from '../middleware/auth.js';
// AUTH A-25: remember-me selector/verifier (login/logout) + reauth
import {
  createRememberPair,
  hashVerifier,
  deviceHash,
  parseCookies,
  parseRememberCookie,
  serializeRememberCookie,
  saveRememberToken,
  revokeRememberToken,
} from '../src/modules/auth/remember-me.js';
import { evaluatePassword } from '../src/modules/auth/password-policy.js';
import { isPasswordBreached } from '../src/modules/auth/hibp.js';
import { isOidcEnabled } from '../src/modules/auth/oidc.js';
import { audit, AUDIT_ACTIONS, logAuthEvent } from '../src/modules/auth/audit.js';
import { recordSession, revokeOtherSessions, revokeByUser } from '../src/modules/auth/session-manager.js';
// AUTH A-29: account security events + breach flag
import {
  recordAccountEvent,
  getAccountEvents,
  setBreachFlag,
  clearBreachFlag,
  ACCOUNT_EVENT_TYPES,
} from '../src/modules/auth/account-events.js';
import {
  evaluateNewDevice,
  evaluateSuspicious,
  queueNewDeviceAlert,
  deliverAlert,
  ipHash,
} from '../src/modules/auth/new-device.js';
import { cityFromIp } from '../src/modules/auth/geo-lite.js';
// AUTH A-28: risk-based auth — device fingerprint + risk tiers
import {
  evaluateRisk,
  recordRiskDecision,
  checkMidSessionFingerprint,
  setDeviceTrusted,
} from '../src/modules/auth/risk.js';
// AUTH C-03 §08: user_devices upsert (login → device register)
import { touchDevice, isFingerprintHash } from '../src/modules/auth/device-fingerprint.js';
import { sessionTtlMs, sessionCookieName, rememberCookieName, REMEMBER_TTL_MS } from '../src/modules/auth/session-store.js';
import { safeReturnUrl } from '../src/modules/auth/session-timeout.js';
// AUTH A-26: MFA/TOTP — login challenge (parol bosqichida session berilmaydi)
import {
  hasActiveMfa,
  createMfaChallenge,
  readMfaChallenge,
  consumeMfaChallenge,
  verifyMfaCode,
  setupTotp,
  enableTotp,
  getMfaStatus,
  requestMfaReset,
  executeMfaReset,
} from '../src/modules/auth/mfa-totp.js';
// AUTH A-30: admin/teacher privilege hardening
import {
  adminMfaMandatory,
  privilegedMfaMandatory,
  adminIpAllowed,
  adminIpAllowlist,
  adminLoginLockoutCheck,
  recordAdminLoginFailure,
  resetAdminLoginFailures,
  getAdminSecurity,
  updateAdminSecurity,
  evaluateAdminRisk,
  notifySuperAdmin,
  ADMIN_MFA_ACCOUNT,
} from '../src/modules/auth/admin-security.js';

// AUTH A-25 (review fix): re-auth uchun per-user in-memory rate limiter —
// o'g'irlangan session + cheksiz parol sinash (online brute force) bloki.
// Login limiter (server.js) umumiy POST'lar uchun; bu yerda user bazasida
// qattiqroq limit (5 urinish / 15 daqiqa).
const REAUTH_MAX = 5;
const REAUTH_WINDOW_MS = 15 * 60 * 1000;
const reauthAttempts = new Map(); // key: `${kind}:${id}:${ip}` → { count, resetAt }

function reauthLimited(kind, id, ip) {
  const key = `${kind}:${id}:${ip}`;
  const now = Date.now();
  const entry = reauthAttempts.get(key);
  if (!entry || now >= entry.resetAt) {
    reauthAttempts.set(key, { count: 1, resetAt: now + REAUTH_WINDOW_MS });
    return false;
  }
  entry.count += 1;
  // Xotira oqishini oldini olish: eskirgan yozuvlarni vaqti-vaqti tozalash
  if (reauthAttempts.size > 1000) {
    for (const [k, v] of reauthAttempts) {
      if (now >= v.resetAt) reauthAttempts.delete(k);
    }
  }
  return entry.count > REAUTH_MAX;
}
// AUTH A-18: email verify — sendVerifyCode + indexEmail (register flow)
import { sendVerifyCode, indexEmail } from '../src/modules/auth/email-verify.js';
// AUTH B-01: users final schema — register'da canonical record yaratish.
import { normalizeUserRecord } from '../src/modules/auth/user-schema.js';
// AUTH D-24 §10 / D-25 §07: qonuniy rozilik (consent) — purpose'li yozuv
import { recordConsent, CONSENT_PURPOSES } from '../src/modules/legal/consent.js';
// AUTH D-05: auth span middleware — auth.login/register/mfa/reset trace'lar
import { authSpanMiddleware } from '../src/telemetry/spans.js';
// AUTH B-04: username normalizatsiya — login/register ikkalasida (case-insensitive)
import { normalizeUsername, isReserved, isConfusableReserved } from '../src/modules/auth/username.js';

// AUTH B-14: teacher approval state machine — canonical ariza record
import { submitTeacherApplication } from '../src/modules/auth/teacher-approval.js';
// AUTH A-23: email provider + welcome template
import { sendEmail } from '../src/modules/email/provider.js';
import { renderWelcome } from '../src/modules/email/templates.js';
// AUTH A-05: login metric'lar — auth.login.success (counter) + time_to_success (histogram)
import { recordMetric } from '../src/telemetry/index.js';
import {
  checkUserLockout,
  recordFailure,
  recordSuccess,
  checkResetLimit,
  recordResetRequest,
  checkRegisterLimit,
  recordRegister,
  lockoutResponse,
  jitterDelayMs,
  sleep,
} from '../src/modules/auth/lockout.js';
// AUTH C-06: credential stuffing + OTP bombing detection
import { detectStuffing, detectOtpBomb, passHash } from '../src/modules/auth/abuse.js';

// AUTH A-03: username enumeration'ni timing orqali oldini olish — user mavjud
// bo'lmaganda ham argon2 verify + jitter bajariladi (javob vaqti tenglashadi).
// (Forgot route'dagi 180ms fake-delay bilan bir xil yondashuv.)
const DUMMY_ARGON2_HASH = '$argon2id$v=19$m=65536,p=4,t=3$u1kus5wly9Ue/tfOGXv22w$cKyecI4i1mfK4fQOKglk6jroNJBXOs+bGMM5LHd1FFw';
import { AUTH_COPY, AUTH_LANGS, resolveAuthLang } from '../data/auth-i18n.js';
import { parseLogin, parseRegister } from '../src/modules/auth/validation.js';

const router = Router();

// ── Auth copy/lang yordamchilari (plan_login §4.4) ──
function renderUserLogin(res, opts) {
  const {
    mode = 'login',
    error = null,
    lang = 'uz',
    prevUsername = null,
    retryAfter = 0,
    lockout = false,
    // AUTH A-04: qaysi maydon xatoli ekanini view'ga beramiz (inline error)
    // 'username' | 'password' | 'both' | null
    field = null,
  } = opts || {};
  // AUTH D-05: server-render 200-xato login — span outcome to'g'ri bo'lsin.
  // (GET /user/login `error` bilan kelmaydi — faqat xato POST branch'lari.)
  if (opts && opts.error) res.locals.authOutcome = 'error';
  const l = resolveAuthLang(lang);
  res.render('user/login', {
    title: AUTH_COPY[l].meta.title,
    description: AUTH_COPY[l].meta.description,
    lang: l,
    AUTH_LANGS,
    copy: AUTH_COPY[l],
    mode,
    error,
    prevUsername,
    retryAfter,
    lockout,
    field,
    oidcEnabled: isOidcEnabled(),
  });
}

// ── AUTH B-03: alohida register sahifasi uchun render helper ──
// Register xatolari endi login sahifasiga (mode=reg tab) emas, o'z sahifasiga
// qaytadi — foydalanuvchi sahifa almashishni sezmaydi, xato joyida ko'rinadi.
// CSRF token res.locals'dan keladi (server.js global middleware).
function renderUserRegister(res, opts) {
  const {
    error = null,
    lang = 'uz',
    prevName = null,
    prevEmail = null,
    prevUsername = null,
    prevInvite = null,
    // B-03 (review fix): rol tanlovi xatoda saqlanadi (teacher re-render'da yo'qolmaydi)
    prevRole = null,
    retryAfter = 0,
    lockout = false,
    field = null,
    // AUTH B-09 §06: duplicate — "Akkauntingiz borga o'xshaydi" + Kirish
    duplicate = false,
    prevAccount = null,
    // AUTH B-29: teacher application forma — xatoda qiymatlar saqlanadi
    prevUniversity = null,
    prevSubject = null,
    prevExperience = null,
    prevReason = null,
    // AUTH D-24 §10: consent checkbox xatoda saqlanadi
    prevConsent = null,
  } = opts || {};
  const l = resolveAuthLang(lang);
  res.render('user/register', {
    title: AUTH_COPY[l].register.title,
    description: AUTH_COPY[l].register.sub,
    lang: l,
    AUTH_LANGS,
    copy: AUTH_COPY[l],
    error,
    field,
    prevName,
    prevEmail,
    prevUsername,
    prevInvite,
    prevRole,
    retryAfter,
    lockout,
    duplicate,
    prevAccount,
    prevUniversity,
    prevSubject,
    prevExperience,
    prevReason,
    prevConsent,
    oidcEnabled: isOidcEnabled(),
    // B-08 §07: Turnstile site key (secret backend'da; site key frontend widget uchun)
    turnstileSiteKey: CONFIG.TURNSTILE_SITE_KEY || '',
  });
}

// ── Admin Login Page ──
router.get('/admin/login', redirectIfAdmin, (req, res) => {
  res.render('admin/login', {
    title: 'Admin Login',
    error: null,
    mfaRequired: adminMfaMandatory(),
    turnstileSiteKey: CONFIG.TURNSTILE_SITE_KEY || '',
  });
});

// ── Admin login helper: MFA mandatory sessiya berish (verify/enable success) ──
// Promise qaytaradi — route'lar res.json()'ni O'ZI chaqiradi (double-send
// bo'lmasin: grantAdminSession'da json + route'da json = ikkita response).
function grantAdminSession(req, res, { viaMfa = false } = {}) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((err) => {
      if (err) return reject(err);
      req.session.admin = {
        username: CONFIG.ADMIN_USER,
        loggedInAt: Date.now(),
      };
      req.session.adminLoggedInAt = Date.now();
      if (viaMfa) req.session.adminMfaAt = Date.now(); // A-30 §09: fresh MFA marker
      // regenerate() yangi bo'sh sessiya yaratadi — CSRF token'ni qayta
      // o'rnatamiz, aks holda keyingi POST'lar 403 qaytaradi.
      req.session.csrfToken = crypto.randomBytes(32).toString('hex');
      req.session.remember = false; // high-privilege: remember-me yo'q (A-30 §07)
      req.session.lastActiveAt = Date.now();
      req.session.startedAt = Date.now();
      req.session.lastRotatedAt = Date.now();
      // Strict cookie + qisqa Max-Age (A-30 §07) — requireAdmin ham assert qiladi
      if (req.session.cookie) {
        req.session.cookie.sameSite = 'strict';
        req.session.cookie.maxAge = CONFIG.ADMIN_SESSION_TTL_MS || 8 * 60 * 60 * 1000;
      }
      updateAdminSecurity({
        lastLoginAt: Date.now(),
        lastIpHash: ipHash(req.ip),
        lastCity: cityFromIp(req.ip) || null,
        lastDeviceFp: req.body?.device_fp || null,
      }).catch(() => {});
      // S34e: admin sessiyasini DB'da kuzatish — Profilda ro'yxat + revoke mumkin
      fb.set(`admin_sessions/${req.sessionID}`, {
        username: CONFIG.ADMIN_USER,
        ip: req.ip || null,
        userAgent: String(req.headers['user-agent'] || '').slice(0, 180),
        loginAt: Date.now(),
        lastSeen: Date.now(),
        revoked: false,
      }).catch(() => {});
      logAuthEvent({
        action: AUDIT_ACTIONS.ADMIN_LOGIN,
        outcome: 'success',
        method: viaMfa ? (req.mfaFactor === 'passkey' ? 'passkey' : 'mfa') : 'password',
        actorId: CONFIG.ADMIN_USER,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
        details: viaMfa ? { factor: req.mfaFactor || 'totp' } : {},
      }).catch(() => {});
      // C-07 §20: admin_login metric (privileged trace — D-06 bilan)
      try { recordMetric('auth.admin_login', 1, { type: 'counter', labels: { method: viaMfa ? (req.mfaFactor === 'passkey' ? 'passkey' : 'mfa') : 'password' } }); } catch (_) {}
      return resolve();
    });
  });
}

// ── Admin Login Action (AUTH A-30: allowlist→breach→lockout→MFA mandatory) ──
// Flow:
//   1) IP allowlist (ixtiyoriy) — blok + audit
//   2) breach flag — forced blok
//   3) 3 xato → 15 daqiqa lockout
//   4) parol tekshiruvi
//   5) risk: suspicious admin login → blok + super-admin alert
//   6) MFA mandatory:
//      - enroll yo'q → setupTotp → /admin/mfa/enroll (QR + secret)
//      - enroll bor → challenge → /admin/mfa (TOTP kod)
//   7) MFA mandatory bo'lmasa (dev/test flag off) → legacy session
router.post('/admin/login', redirectIfAdmin, async (req, res) => {
  const { username, password } = req.body;
  const renderErr = (error) => res.render('admin/login', {
    title: 'Admin Login',
    error,
    mfaRequired: adminMfaMandatory(),
  });

  try {
    // ── 1) IP allowlist (A-30 §12, ixtiyoriy — OTM IP'lari) ──
    if (!adminIpAllowed(req.ip, adminIpAllowlist())) {
      logAuthEvent({
        action: AUDIT_ACTIONS.ADMIN_IP_BLOCKED,
        outcome: 'blocked',
        method: 'ip_allowlist',
        actorId: username || null,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      }).catch(() => {});
      return renderErr('Ruxsat etilmagan IP manzil');
    }

    // ── 2) Breach flag (A-30 §13) — forced block ──
    const sec = await getAdminSecurity();
    if (sec.breachFlagged) {
      logAuthEvent({
        action: AUDIT_ACTIONS.ADMIN_BREACH_BLOCKED,
        outcome: 'blocked',
        method: 'breach',
        actorId: username || null,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      }).catch(() => {});
      return renderErr('Xavfsizlik nuqtasi tufayli hisob bloklandi. Super-admin bilan bog\'laning.');
    }

    // ── 3) Lockout (A-30 §08): 3 xato → 15 daqiqa (global + per-IP) ──
    const lock = await adminLoginLockoutCheck(req.ip);
    if (lock.locked) {
      logAuthEvent({
        action: AUDIT_ACTIONS.ADMIN_LOGIN_FAILED,
        outcome: 'locked',
        method: 'password',
        actorId: username || null,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
        details: { retryAfterSeconds: lock.retryAfterSeconds },
      }).catch(() => {});
      return renderErr(`Ko'p urinish. ${Math.ceil(lock.retryAfterSeconds / 60)} daqiqa kuting.`);
    }

    // ── 3.5) Turnstile — C-07 §09: admin login'da har doim (secret bor bo'lsa
    // qat'iy; secret yo'q = dev/test fail-open). High-privilege — bot qatlami. ──
    try {
      const { verifyTurnstile } = await import('../src/modules/auth/bot-guard.js');
      const cf = await verifyTurnstile(req.body['cf-turnstile-response']);
      if (!cf.ok) {
        logAuthEvent({
          action: AUDIT_ACTIONS.BOT_DETECTED,
          outcome: 'blocked',
          method: 'turnstile',
          actorId: username || null,
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'],
          details: { reason: cf.error },
        }).catch(() => {});
        try { recordMetric('auth.bot_detected', 1, { type: 'counter', labels: { source: 'turnstile', scope: 'admin' } }); } catch (_) {}
        return renderErr('Bot tekshiruvidan o\'tmadi. Qayta urinib ko\'ring');
      }
    } catch (_) { /* Turnstile fail-soft (import xatosi) */ }

    // ── 4) Parol tekshiruvi ──
    const credsOk = username === CONFIG.ADMIN_USER && password === CONFIG.ADMIN_PASS;
    if (!credsOk) {
      const fail = await recordAdminLoginFailure(req.ip);
      logAuthEvent({
        action: AUDIT_ACTIONS.ADMIN_LOGIN_FAILED,
        outcome: 'failed',
        method: 'password',
        actorId: username || null,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
        details: { locked: fail.locked },
      }).catch(() => {});
      return renderErr(
        fail.locked
          ? `Ko'p urinish. ${Math.ceil(fail.retryAfterSeconds / 60)} daqiqa kuting.`
          : 'Login yoki parol noto\'g\'ri'
      );
    }
    await resetAdminLoginFailures();

    // ── 5) Suspicious admin login (A-30 §14) — risk high → block + super-admin ──
    try {
      const risk = await evaluateAdminRisk({
        ip: req.ip,
        deviceFp: typeof req.body?.device_fp === 'string' ? req.body.device_fp : null,
      }, sec);
      if (risk.action === 'block') {
        logAuthEvent({
          action: AUDIT_ACTIONS.ADMIN_RISK_BLOCKED,
          outcome: 'blocked',
          method: 'risk',
          actorId: CONFIG.ADMIN_USER,
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'],
          details: { score: risk.score, signals: risk.signals },
        }).catch(() => {});
        notifySuperAdmin({ type: 'admin_risk_block', ip: req.ip, details: { score: risk.score, signals: risk.signals } })
          .catch(() => {});
        return renderErr('Xavfli kirish aniqlandi. Kirish bloklandi.');
      }
    } catch (_) { /* risk fail-soft */ }

    // ── 6) MFA (A-30 §06 + S30: ixtiyoriy enroll'dan keyin ham) ──
    // Admin MFA ACTIVE bo'lsa — mandatory flag'dan qat'i nazar challenge
    // (aks holda ixtiyoriy yoqilgan MFA login'da bypass qilinardi).
    if (adminMfaMandatory() || (await getMfaStatus(ADMIN_MFA_ACCOUNT)).status === 'active') {
      const status = await getMfaStatus(ADMIN_MFA_ACCOUNT);
      if (status.status !== 'active') {
        // Enroll yo'q → forced enrollment (QR + secret, bir marta ko'rsatiladi)
        try {
          const setup = await setupTotp(ADMIN_MFA_ACCOUNT, { accountName: 'Deborah Admin' });
          if (!setup.ok) return renderErr('MFA sozlash xatoligi');
          const qr = await qrcode.toDataURL(setup.otpauth, { width: 220, margin: 1 }).catch(() => null);
          req.session.adminMfaEnroll = {
            secret: setup.secret,
            otpauth: setup.otpauth,
            qr,
          };
          logAuthEvent({
            action: AUDIT_ACTIONS.ADMIN_MFA_REQUIRED,
            outcome: 'enroll',
            method: 'mfa',
            actorId: CONFIG.ADMIN_USER,
            ipAddress: req.ip,
            userAgent: req.headers['user-agent'],
          }).catch(() => {});
          try { recordMetric('auth.admin_mfa_required', 1, { type: 'counter', labels: { phase: 'enroll' } }); } catch (_) {}
          return res.redirect('/admin/mfa/enroll');
        } catch (_) {
          return renderErr('MFA sozlash xatoligi');
        }
      }
      // Enroll bor → challenge
      try {
        const challengeId = await createMfaChallenge(ADMIN_MFA_ACCOUNT);
        req.session.pendingAdminMfa = { challengeId, createdAt: Date.now() };
        logAuthEvent({
          action: AUDIT_ACTIONS.ADMIN_MFA_REQUIRED,
          outcome: 'challenge',
          method: 'mfa',
          actorId: CONFIG.ADMIN_USER,
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'],
        }).catch(() => {});
        try { recordMetric('auth.admin_mfa_required', 1, { type: 'counter', labels: { phase: 'challenge' } }); } catch (_) {}
        return res.redirect(`/admin/mfa?challenge=${challengeId}`);
      } catch (_) {
        return renderErr('MFA xatoligi');
      }
    }

    // ── 7) Legacy (dev/test — flag off): to'g'ridan-to'g'ri session ──
    req.session.regenerate((err) => {
      if (err) return renderErr('Session xatoligi');
      req.session.admin = {
        username: CONFIG.ADMIN_USER,
        loggedInAt: Date.now(),
      };
      req.session.adminLoggedInAt = Date.now();
      req.session.csrfToken = crypto.randomBytes(32).toString('hex');
      req.session.remember = false;
      req.session.lastActiveAt = Date.now();
      req.session.startedAt = Date.now();
      req.session.lastRotatedAt = Date.now();
      if (req.session.cookie) {
        req.session.cookie.sameSite = 'strict';
        req.session.cookie.maxAge = CONFIG.ADMIN_SESSION_TTL_MS || 8 * 60 * 60 * 1000;
      }
      updateAdminSecurity({
        lastLoginAt: Date.now(),
        lastIpHash: ipHash(req.ip),
        lastCity: cityFromIp(req.ip) || null,
      }).catch(() => {});
      logAuthEvent({
        action: AUDIT_ACTIONS.ADMIN_LOGIN,
        outcome: 'success',
        method: 'password',
        actorId: CONFIG.ADMIN_USER,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      }).catch(() => {});
      return res.redirect('/admin/dashboard');
    });
  } catch (err) {
    console.error('Admin login error:', err.message);
    return renderErr('Server xatoligi');
  }
});

// ── Admin MFA Challenge Page (A-30 §06) ──
router.get('/admin/mfa', (req, res) => {
  const pending = req.session?.pendingAdminMfa;
  if (!pending?.challengeId) {
    if (req.session?.admin) return res.redirect('/admin/dashboard');
    return res.redirect('/admin/login');
  }
  res.render('admin/mfa', {
    title: 'Admin 2FA',
    challengeId: pending.challengeId,
    error: null,
  });
});

// ── POST /api/admin/mfa/verify — kod verify → shundagina admin session ──
router.post('/api/admin/mfa/verify', async (req, res) => {
  try {
    const { code, challengeId } = req.body || {};
    const pending = req.session?.pendingAdminMfa;
    if (!pending?.challengeId) {
      return res.status(401).json({ ok: false, error: 'no_pending_challenge' });
    }
    if (typeof challengeId !== 'string' || challengeId !== pending.challengeId) {
      return res.status(400).json({ ok: false, error: 'challenge_mismatch' });
    }
    if (!code) return res.status(400).json({ ok: false, error: 'required' });

    const challenge = await readMfaChallenge(challengeId);
    if (!challenge || !challenge.valid || challenge.userId !== ADMIN_MFA_ACCOUNT) {
      delete req.session.pendingAdminMfa;
      return res.status(401).json({ ok: false, error: 'challenge_invalid' });
    }
    const result = await verifyMfaCode(ADMIN_MFA_ACCOUNT, String(code).trim(), req.ip);
    if (!result.ok) {
      return res.status(result.error === 'locked' ? 429 : 403).json({
        ok: false,
        error: result.error,
        retryAfterSeconds: result.retryAfterSeconds,
      });
    }
    await consumeMfaChallenge(challengeId);
    delete req.session.pendingAdminMfa;
    req.mfaFactor = result.method;
    await grantAdminSession(req, res, { viaMfa: true });
    return res.json({ ok: true, redirect: '/admin/dashboard' });
  } catch (err) {
    console.error('Admin MFA verify error:', err.message);
    return res.status(500).json({ ok: false, error: 'server' });
  }
});

// ── Admin MFA Enroll Page (forced — QR + secret, bir marta) ──
router.get('/admin/mfa/enroll', async (req, res) => {
  const enroll = req.session?.adminMfaEnroll;
  if (!enroll?.secret) {
    // S30: logged-in admin uchun IXTIYORIY enroll (ADMIN_MFA_MANDATORY off
    // bo'lsa ham). Faqat MFA hali active bo'lmaganda; aks holda profile'ga.
    if (req.session?.admin) {
      try {
        const st = await getMfaStatus(ADMIN_MFA_ACCOUNT);
        if (st.status === 'active') return res.redirect('/admin/profile?mfa=already');
        const setup = await setupTotp(ADMIN_MFA_ACCOUNT, { accountName: 'Deborah Admin' });
        if (!setup.ok) return res.redirect('/admin/profile?mfa=error');
        const qr = await qrcode.toDataURL(setup.otpauth, { width: 220, margin: 1 }).catch(() => null);
        req.session.adminMfaEnroll = { secret: setup.secret, otpauth: setup.otpauth, qr, voluntary: true };
        return res.render('admin/mfa-enroll', {
          title: 'Admin 2FA sozlash',
          secret: setup.secret, otpauth: setup.otpauth, qr, error: null,
          // S30: enable POST uchun CSRF (head.ejs window.__CSRF_TOKEN)
          csrfToken: req.session?.csrfToken || (req.csrfToken ? req.csrfToken() : ''),
        });
      } catch (_) {
        return res.redirect('/admin/profile?mfa=error');
      }
    }
    return res.redirect('/admin/login');
  }
  res.render('admin/mfa-enroll', {
    title: 'Admin 2FA sozlash',
    secret: enroll.secret,
    otpauth: enroll.otpauth,
    qr: enroll.qr || null,
    error: null,
    // S30: head.ejs window.__CSRF_TOKEN shu local'dan oladi (enable POST uchun)
    csrfToken: req.session?.csrfToken || (req.csrfToken ? req.csrfToken() : ''),
  });
});

// ── POST /api/admin/mfa/enable — birinchi kod verify → session + backup ──
router.post('/api/admin/mfa/enable', async (req, res) => {
  try {
    const enroll = req.session?.adminMfaEnroll;
    if (!enroll?.secret) {
      return res.status(409).json({ ok: false, error: 'no_pending_enroll' });
    }
    const { token } = req.body || {};
    if (!token) return res.status(400).json({ ok: false, error: 'required' });
    const result = await enableTotp(ADMIN_MFA_ACCOUNT, String(token).trim());
    if (!result.ok) return res.status(400).json({ ok: false, error: result.error });
    const wasVoluntary = !!enroll.voluntary && !!req.session?.admin;
    delete req.session.adminMfaEnroll;
    // S30: ixtiyoriy enroll — admin sessiyasi allaqachon ochiq, qayta yaratmaymiz
    if (wasVoluntary) {
      req.session.admin = { ...req.session.admin, mfaEnrolled: true, mfaAt: Date.now() };
      return res.json({ ok: true, voluntary: true, backupCodes: result.backupCodes });
    }
    logAuthEvent({
      action: AUDIT_ACTIONS.ADMIN_MFA_ENROLLED,
      outcome: 'success',
      method: 'mfa',
      actorId: CONFIG.ADMIN_USER,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    }).catch(() => {});
    req.mfaFactor = 'totp';
    await grantAdminSession(req, res, { viaMfa: true });
    return res.json({ ok: true, backupCodes: result.backupCodes });
  } catch (err) {
    console.error('Admin MFA enable error:', err.message);
    return res.status(500).json({ ok: false, error: 'server' });
  }
});

// ── Admin MFA Step-up Page (A-30 §09 — sensitive amallar uchun) ──
router.get('/admin/mfa/stepup', requireAdmin, (req, res) => {
  res.render('admin/mfa-stepup', {
    title: 'Admin 2FA tasdiqlash',
    error: null,
  });
});

// ── ADMIN PASSKEY (S34g + S35): MFA bosqichi (2FA) + to'g'ridan-to'g'ri login ──
// 1) MFA sahifada (/admin/mfa): parol → TOTP kod YOKI Passkey bilan tasdiqlash.
// 2) /admin/login sahifasida: parolsiz "Passkey bilan kirish" (passkey = AAL2,
//    phishing-resistant — to'liq admin sessiya grant qiladi, viaMfa marker bilan).
// Passkey admin profilida ro'yxatdan o'tkazilgan bo'lishi shart (admin:{username}).
import {
  generateAuthenticationChallenge as genAdminPkAuth,
  verifyAuthenticationResponseFlow as verifyAdminPkAuth,
  rpFromRequest as adminPkRp,
  listPasskeys as adminListPasskeys,
} from '../src/modules/auth/webauthn.js';

/* S34j FIX: login MFA bosqichida req.session.admin HANUZ YO'Q (faqat pendingAdminMfa bor)
   — requireAdmin 401 berardi va passkey tugma HECH QACHON ko'rinmasdi.
   Endi: pendingAdminMfa.challengeId mavjudligi tekshiriladi (login jarayonida). */
function requirePendingAdminMfa(req, res, next) {
  if (req.session?.pendingAdminMfa?.challengeId || req.session?.admin) return next();
  return res.status(401).json({ ok: false, error: 'no_pending_challenge' });
}

/* S35 FIX (BUG): admin passkeylar admin:{username} ga bog'lanadi (routes/admin/profile.js
   adminUserId — CONFIG.ADMIN_USER), lekin 2FA tekshiruvi qat'iy 'admin:'+ADMIN_MFA_ACCOUNT
   ('admin:admin') qidirardi → ADMIN_USER !== 'admin' bo'lsa passkey HECH QACHON topilmasdi.
   Endi joriy id + legacy id ('admin:admin') birga qidiriladi (eski yozuvlar ham ishlaydi). */
const adminPasskeyIds = () => {
  const ids = ['admin:' + CONFIG.ADMIN_USER];
  if (CONFIG.ADMIN_USER !== ADMIN_MFA_ACCOUNT) ids.push('admin:' + ADMIN_MFA_ACCOUNT);
  return ids;
};

async function adminHasAnyPasskey() {
  const ids = adminPasskeyIds();
  for (const id of ids) {
    const list = await adminListPasskeys(id).catch(() => []);
    if (list.length) return true;
  }
  return false;
}

/* Admin passkey login/verify — IP asosida rate limit (10 so'rov / 15 daqiqa).
   Parol yo'lidagi kabi: challenge single-use + 5 daqiqa TTL session'da; verify
   faqat haqiqiy credential bilan o'tadi — bu qatlam DoS/spamni cheklaydi. */
const ADMIN_PK_MAX = 10;
const ADMIN_PK_WINDOW_MS = 15 * 60 * 1000;
const adminPkHits = new Map();
function adminPkRateLimited(key) {
  const now = Date.now();
  const rec = adminPkHits.get(key);
  if (!rec || rec.resetAt <= now) {
    adminPkHits.set(key, { count: 1, resetAt: now + ADMIN_PK_WINDOW_MS });
    return false;
  }
  rec.count += 1;
  if (rec.count > ADMIN_PK_MAX) return true;
  return false;
}

/* ── 1) MFA sahifadagi passkey (parol → 2FA bosqichi) ── */

router.get('/api/admin/mfa/passkey/status', requirePendingAdminMfa, async (req, res) => {
  try {
    const has = await adminHasAnyPasskey();
    return res.json({ ok: true, available: has });
  } catch (_) {
    return res.json({ ok: true, available: false });
  }
});

router.post('/api/admin/mfa/passkey/options', requirePendingAdminMfa, async (req, res) => {
  try {
    const options = await genAdminPkAuth(req.session, { userId: adminPasskeyIds() }, adminPkRp(req));
    if (!options) return res.status(400).json({ ok: false, error: 'options_failed' });
    return res.json({ ok: true, options });
  } catch (e) {
    return res.status(500).json({ ok: false, error: 'server' });
  }
});

router.post('/api/admin/mfa/passkey/verify', requirePendingAdminMfa, async (req, res) => {
  try {
    const result = await verifyAdminPkAuth(req.session, req.body || {}, adminPkRp(req));
    if (!result.ok) {
      return res.status(403).json({ ok: false, error: result.error || 'assertion_invalid', message: result.message });
    }
    if (!adminPasskeyIds().includes(result.userId)) {
      return res.status(403).json({ ok: false, error: 'wrong_owner', message: 'Bu passkey boshqa hisobga tegishli' });
    }
    // Login MFA bosqichi: pending challenge iste'mol qilinadi (TOTP verify bilan bir xil)
    if (req.session.pendingAdminMfa) {
      await consumeMfaChallenge(req.session.pendingAdminMfa.challengeId).catch(() => {});
      delete req.session.pendingAdminMfa;
    }
    // MFA muvaffaqiyati — TOTP bilan bir xil grant yo'li
    req.session.adminMfaAt = Date.now();
    req.mfaFactor = 'passkey';
    await grantAdminSession(req, res, { viaMfa: true });
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ ok: false, error: 'server' });
  }
});

/* ── 2) /admin/login sahifasidan PASSKEY BILAN TO'G'RIDAN-TO'G'RI KIRISH (S35) ──
   Oqim: tugma → options (allowCredentials = admin passkeylari) → brauzer
   tasdiqlaydi (biometriya / YubiKey / boshqa qurilma) → verify → admin sessiya.
   Passkey = phishing-resistant AAL2+ faktor (NIST) — TOTP kabi mustaqil 2-faktor,
   shuning uchun viaMfa=true grant qilinadi (parol shart emas).
   Xavfsizlik: CSRF (global) + IP rate limit + IP allowlist + breach flag + audit. */

/* Login sahifasi tugmani ko'rsatish uchun so'raydi (admin passkey bormi?).
   GET — CSRF shart emas; oshkor ma'lumot ahamiyatsiz ("parolni unutdingizmi" kabi). */
router.get('/api/admin/passkey/login/status', async (req, res) => {
  try {
    const has = await adminHasAnyPasskey();
    return res.json({ ok: true, available: has });
  } catch (_) {
    return res.json({ ok: true, available: false });
  }
});

router.post('/api/admin/passkey/login/options', async (req, res) => {
  if (adminPkRateLimited(`opts:${req.ip}`)) {
    return res.status(429).json({ ok: false, error: 'rate-limited' });
  }
  try {
    if (!(await adminHasAnyPasskey())) {
      return res.status(400).json({ ok: false, error: 'not_setup', message: 'Admin passkey o\'rnatilmagan. Avval admin profilida passkey qo\'shing.' });
    }
    const options = await genAdminPkAuth(req.session, { userId: adminPasskeyIds() }, adminPkRp(req));
    if (!options) return res.status(400).json({ ok: false, error: 'options_failed' });
    return res.json({ ok: true, options, rpId: (adminPkRp(req) || {}).id, origin: (adminPkRp(req) || {}).origin });
  } catch (e) {
    console.error('[admin-passkey-login] options:', e.message);
    return res.status(500).json({ ok: false, error: 'server' });
  }
});

router.post('/api/admin/passkey/login/verify', async (req, res) => {
  if (adminPkRateLimited(`verify:${req.ip}`)) {
    return res.status(429).json({ ok: false, error: 'rate-limited' });
  }
  try {
    // Parol yo'lidagi admin qatlamlari (IP allowlist + breach flag) passkey yo'liga ham
    // qo'llanadi — bir xil himoya siyosati, faktor qanday bo'lishidan qat'i nazar.
    if (!adminIpAllowed(req.ip, adminIpAllowlist())) {
      logAuthEvent({
        action: AUDIT_ACTIONS.ADMIN_IP_BLOCKED, outcome: 'blocked', method: 'passkey',
        actorId: CONFIG.ADMIN_USER, ipAddress: req.ip, userAgent: req.headers['user-agent'],
      }).catch(() => {});
      return res.status(403).json({ ok: false, error: 'ip_not_allowed', message: 'Ruxsat etilmagan IP manzil' });
    }
    const sec = await getAdminSecurity();
    if (sec.breachFlagged) {
      logAuthEvent({
        action: AUDIT_ACTIONS.ADMIN_BREACH_BLOCKED, outcome: 'blocked', method: 'passkey',
        actorId: CONFIG.ADMIN_USER, ipAddress: req.ip, userAgent: req.headers['user-agent'],
      }).catch(() => {});
      return res.status(403).json({ ok: false, error: 'breach_blocked', message: 'Xavfsizlik nuqtasi tufayli hisob bloklandi.' });
    }

    const result = await verifyAdminPkAuth(req.session, req.body || {}, adminPkRp(req));
    if (!result.ok) {
      logAuthEvent({
        action: AUDIT_ACTIONS.AUTH_LOGIN_FAIL, outcome: 'failed', method: 'passkey',
        actorId: 'admin:' + CONFIG.ADMIN_USER, ipAddress: req.ip,
        userAgent: req.headers['user-agent'], details: { reason: result.error || 'assertion_invalid' },
      }).catch(() => {});
      return res.status(401).json({ ok: false, error: result.error || 'assertion_invalid', message: result.message });
    }
    if (!adminPasskeyIds().includes(result.userId)) {
      logAuthEvent({
        action: AUDIT_ACTIONS.AUTH_LOGIN_FAIL, outcome: 'failed', method: 'passkey',
        actorId: 'admin:' + CONFIG.ADMIN_USER, ipAddress: req.ip,
        userAgent: req.headers['user-agent'], details: { reason: 'wrong_owner' },
      }).catch(() => {});
      return res.status(403).json({ ok: false, error: 'wrong_owner', message: 'Bu passkey boshqa hisobga tegishli' });
    }

    // Eski pending MFA challenge bo'lsa tozalanadi (xavfsiz holat)
    if (req.session.pendingAdminMfa) {
      await consumeMfaChallenge(req.session.pendingAdminMfa.challengeId).catch(() => {});
      delete req.session.pendingAdminMfa;
    }
    req.mfaFactor = 'passkey';
    await grantAdminSession(req, res, { viaMfa: true });
    await audit({
      action: AUDIT_ACTIONS.PASSKEY_AUTH, userId: 'admin:' + CONFIG.ADMIN_USER,
      resourceType: 'passkey', details: { credentialId: `${result.credential.id.slice(0, 12)}…`, via: 'admin-login' },
    }).catch(() => {});
    return res.json({ ok: true, redirect: '/admin/dashboard' });
  } catch (e) {
    console.error('[admin-passkey-login] verify:', e.message);
    return res.status(500).json({ ok: false, error: 'server' });
  }
});

// ── POST /api/admin/mfa/stepup — fresh MFA (30 daqiqa marker) ──
router.post('/api/admin/mfa/stepup', requireAdmin, async (req, res) => {
  try {
    const { code } = req.body || {};
    if (!code) return res.status(400).json({ ok: false, error: 'required' });
    const result = await verifyMfaCode(ADMIN_MFA_ACCOUNT, String(code).trim(), req.ip);
    if (!result.ok) {
      return res.status(result.error === 'locked' ? 429 : 403).json({
        ok: false,
        error: result.error,
        retryAfterSeconds: result.retryAfterSeconds,
      });
    }
    req.session.adminMfaAt = Date.now();
    logAuthEvent({
      action: AUDIT_ACTIONS.ADMIN_MFA_STEPUP,
      outcome: 'success',
      method: 'mfa',
      actorId: CONFIG.ADMIN_USER,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    }).catch(() => {});
    return res.json({ ok: true });
  } catch (err) {
    console.error('Admin MFA stepup error:', err.message);
    return res.status(500).json({ ok: false, error: 'server' });
  }
});

// ── POST /api/admin/mfa/reset — super-admin approval (A-30 §15, A-26 §14) ──
// 72 soat delay (social engineering qarshi). Re-auth talab qilinadi.
router.post('/api/admin/mfa/reset', requireAdmin, requireRecentAdminAuth, async (req, res) => {
  try {
    const { reason } = req.body || {};
    const result = await requestMfaReset(ADMIN_MFA_ACCOUNT, { reason });
    logAuthEvent({
      action: AUDIT_ACTIONS.ADMIN_MFA_RESET,
      outcome: 'requested',
      method: 'mfa',
      actorId: CONFIG.ADMIN_USER,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      details: { releaseAfterHours: 72 },
    }).catch(() => {});
    return res.json({ ok: true, releaseAt: result.releaseAt });
  } catch (err) {
    return res.status(500).json({ ok: false, error: 'server' });
  }
});

// ── POST /api/admin/mfa/reset/execute — 72 soat o'tgach bajarish ──
router.post('/api/admin/mfa/reset/execute', requireAdmin, requireRecentAdminAuth, async (req, res) => {
  try {
    const result = await executeMfaReset(ADMIN_MFA_ACCOUNT);
    if (!result.ok) return res.status(400).json({ ok: false, error: result.error });
    logAuthEvent({
      action: AUDIT_ACTIONS.ADMIN_MFA_RESET,
      outcome: 'executed',
      method: 'mfa',
      actorId: CONFIG.ADMIN_USER,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    }).catch(() => {});
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ ok: false, error: 'server' });
  }
});

// ── Admin Logout (session destroy + regenerate) ──
// BUG-008: logout-CSRF — GET faqat tasdiq sahifasi, real chiqish POST + CSRF bilan
router.get('/admin/logout', (req, res) => {
  if (!req.session?.admin) return res.redirect('/admin/login');
  res.render('logout-confirm', {
    title: 'Admin — Chiqishni tasdiqlash',
    action: '/admin/logout',
    back: '/admin/dashboard',
    csrfToken: req.csrfToken ? req.csrfToken() : (req.session?.csrfToken || ''),
  });
});

router.post('/admin/logout', (req, res) => {
  // S34e: chiqishda sessiya yozuvini revoke qilish (Profildagi sessiyalar ro'yxati uchun)
  if (req.sessionID) {
    fb.set(`admin_sessions/${req.sessionID}/revoked`, true).catch(() => {});
    fb.set(`admin_sessions/${req.sessionID}/revokedAt`, Date.now()).catch(() => {});
  }
  req.session.destroy(() => {
    res.clearCookie(sessionCookieName());
    res.redirect('/admin/login');
  });
});

// OIDC callback snake_case error'larini copy key'larga moslashtirish
const OIDC_ERROR_MAP = {
  google_denied: 'googleDenied',
  missing_code: 'missingCode',
  session_error: 'sessionError',
  server_error: 'serverError',
  // AUTH B-09: Google email verified emas yoki parol account'ga link mumkin emas
  linking_required: 'linkingRequired',
  // AUTH B-10: yangi Google user — email verified emas → account yaratilmaydi
  google_email_unverified: 'googleEmailUnverified',
  // AUTH B-10 (review fix): google-setup sessiyasi 15 daqiqada tugadi
  google_setup_expired: 'googleSetupExpired',
};

// ── User Register Page (AUTH B-03: alohida universitar forma) ──
// Google birinchi → divider → ≤5 maydon (rol, ism, email, username, parol) +
// invite kod (ixtiyoriy). POST /user/login (mode=reg) — barcha A-faza himoyasi
// (CSRF, honeypot, register limiter, email validatsiya, HIBP) qayta ishlatiladi.
router.get('/user/register', redirectIfAuth, (req, res) => {
  const lang = resolveAuthLang(req.query.lang || req.cookies?.lang);
  try {
    recordMetric('auth.register.view', 1, { type: 'counter', labels: { lang } });
  } catch (_) {}
  renderUserRegister(res, { lang });
});

// ── S27: O'qituvchilar maydoni (/ustoz) — landing burger'idagi yashirin kirish ──
// Login (mode=login) va ariza (mode=reg&role=teacher) POST /user/login'ga
// boradi — A-faza himoyalari (CSRF/honeypot/limiter/HIBP) to'liq qayta ishlanadi.
router.get('/ustoz', redirectIfAuth, async (req, res) => {
  try {
    recordMetric('auth.ustoz.view', 1, { type: 'counter', labels: { lang: 'uz' } });
  } catch (_) {}
  // S34: /ustoz endi TO'LIQ o'qituvchi landing'ini ko'rsatadi (uploads/index.html 1:1 —
  // views/index.ejs). Cast landing (/) hammaga ko'rinadi; o'qituvchi maydoni shu yerda —
  // robots.txt Disallow + kanonik / → qidiruv tizimlarida ochiq ko'rinmaydi.
  try {
    const { LANDING_COPY } = await import('../data/landing.js');
    const { isOidcEnabled } = await import('../src/modules/auth/oidc.js');
    return res.render('index', {
      title: LANDING_COPY.uz.meta.title,
      description: LANDING_COPY.uz.meta.description,
      copy: LANDING_COPY.uz,
      lang: 'uz',
      path: '/',
      csrfToken: req.session.csrfToken || '',
      oidcEnabled: isOidcEnabled(),
      hemisEnabled: false,
      opendata: null,
    });
  } catch (e) {
    // fail-soft: eski ustoz maydoni sahifasi
    return res.render('ustoz', {
      title: "O'qituvchilar uchun — Deborah",
      csrfToken: req.session.csrfToken || '',
      error: null,
    });
  }
});

// ── AUTH B-05: email real-time validatsiya (blur) ──
// Backend'da tekshiradi (client off → server check §17); CSRF (global) +
// per-IP rate limit (enumeration qarshi). Javobda email YO'Q (PII minimal),
// faqat ok/reason/suggestion. Register formasi blur'da chaqiradi.
const EMAIL_VALIDATE_MAX = 30; // 30 / daqiqa / IP
const EMAIL_VALIDATE_WINDOW_MS = 60 * 1000;
const emailValidateHits = new Map(); // ip -> { count, resetAt }

function emailValidateLimited(ip) {
  const now = Date.now();
  const entry = emailValidateHits.get(ip);
  if (!entry || now >= entry.resetAt) {
    emailValidateHits.set(ip, { count: 1, resetAt: now + EMAIL_VALIDATE_WINDOW_MS });
    return false;
  }
  entry.count += 1;
  // Xotira guard
  if (emailValidateHits.size > 5000) {
    for (const [k, v] of emailValidateHits) {
      if (now >= v.resetAt) emailValidateHits.delete(k);
    }
  }
  return entry.count > EMAIL_VALIDATE_MAX;
}

// ── B-27: inline HIBP breach check (client SHA-1 yuboradi, parol EMAS) ──
// Parol network trace'da bo'lmasin (B-27 §14): client Web Crypto bilan
// SHA-1(password) hisoblab, shu hash'ni yuboradi. Server HIBP'ga faqat
// 5-belgi prefix'ni so'raydi (k-anonymity) — parol hech qayerda ko'rinmaydi.
const PASSWORD_BREACH_MAX = 20;
const PASSWORD_BREACH_WINDOW_MS = 15 * 60 * 1000;
const pwBreachChecks = new Map(); // ip → { count, resetAt }

function pwBreachLimited(ip) {
  const now = Date.now();
  const entry = pwBreachChecks.get(ip);
  if (!entry || now >= entry.resetAt) {
    pwBreachChecks.set(ip, { count: 1, resetAt: now + PASSWORD_BREACH_WINDOW_MS });
    return false;
  }
  entry.count += 1;
  if (pwBreachChecks.size > 2000) {
    for (const [k, v] of pwBreachChecks) {
      if (now >= v.resetAt) pwBreachChecks.delete(k);
    }
  }
  return entry.count > PASSWORD_BREACH_MAX;
}

router.post('/api/validate/password-breach', async (req, res) => {
  try {
    if (pwBreachLimited(req.ip)) {
      return res.status(429).json({ ok: false, error: 'rate_limited' });
    }
    const { sha1 } = req.body || {};
    // Faqat SHA-1 hex qabul qilinadi — boshqa hech narsa (parol emas!)
    if (typeof sha1 !== 'string' || !/^[0-9a-fA-F]{40}$/.test(sha1)) {
      return res.status(400).json({ ok: false, error: 'required' });
    }
    const { isSha1Breached } = await import('../src/modules/auth/hibp.js');
    const r = await isSha1Breached(sha1);
    try {
      recordMetric('auth.password_breach_check', 1, {
        type: 'counter', labels: { result: r.breached ? 'breached' : 'clean', checked: String(r.checked) },
      });
    } catch (_) {}
    return res.json({ ok: true, breached: r.breached, checked: r.checked });
  } catch (_) {
    // Fail-open: HIBP offline → blok emas (NIST signup davom etadi)
    return res.json({ ok: true, breached: false, checked: false });
  }
});

router.post('/api/validate/email', async (req, res) => {
  try {
    if (emailValidateLimited(req.ip)) {
      return res.status(429).json({ ok: false, error: 'rate_limited' });
    }
    const { email } = req.body || {};
    if (typeof email !== 'string' || email.length < 3 || email.length > 200) {
      return res.status(400).json({ ok: false, error: 'required' });
    }
    const { validateFast } = await import('../src/modules/email/validation.js');
    const r = await validateFast(email);
    try {
      recordMetric('auth.email_validation.blur', 1, {
        type: 'counter', labels: { result: r.ok ? 'ok' : (r.reason || 'ok') },
      });
    } catch (_) {}
    return res.json({
      ok: r.ok,
      reason: r.reason || null,
      suggestion: r.suggestion || null,
    });
  } catch (_) {
    return res.status(500).json({ ok: false, error: 'server' });
  }
});

// ── User Login Page (plan_login §4: 4 til, Google always visible) ──
router.get('/user/login', redirectIfAuth, (req, res) => {
  // AUTH B-09 §06: duplicate register'dan kelgan ?account= — login maydoni
  // oldindan to'ldiriladi (username yoki email), mode=login tab faol.
  const account = typeof req.query.account === 'string'
    ? String(req.query.account).slice(0, 100)
    : null;
  const mode = req.query.mode === 'reg' ? 'reg' : 'login';
  const lang = resolveAuthLang(req.query.lang || req.cookies?.lang);
  let error = null;
  if (req.query.error) {
    const key = OIDC_ERROR_MAP[req.query.error] || req.query.error;
    error = AUTH_COPY[lang].errors[key] || null;
  }
  renderUserLogin(res, { mode, error, lang, prevUsername: account });
});

// ── LANDING: username real-time band/mavjudligi tekshiruvi (B-05 email-validate pattern) ──
// Ro'yxatdan o'tish formasida username yozilayotganda AJAX bilan tekshiradi.
// Enumeration: faqat REGISTER oqimida ishlatiladi (oddiy foydalanuvchi nomi
// bandligini bilishi registratsiyaning o'z-o'zini tabiiy qismi — login'da
// A-03 timing himoyasi alohida). Per-IP rate limit: 30/daqiqa.
const USERNAME_CHECK_MAX = 30;
const USERNAME_CHECK_WINDOW_MS = 60 * 1000;
const usernameCheckHits = new Map();
function usernameCheckLimited(ip) {
  const now = Date.now();
  const entry = usernameCheckHits.get(ip);
  if (!entry || now >= entry.resetAt) {
    usernameCheckHits.set(ip, { count: 1, resetAt: now + USERNAME_CHECK_WINDOW_MS });
    if (usernameCheckHits.size > 5000) {
      for (const [k, v] of usernameCheckHits) if (now >= v.resetAt) usernameCheckHits.delete(k);
    }
    return false;
  }
  entry.count += 1;
  return entry.count > USERNAME_CHECK_MAX;
}
router.get('/user/login/username-check', async (req, res) => {
  if (usernameCheckLimited(req.ip)) {
    return res.status(429).json({ ok: false, reason: 'rate' });
  }
  const raw = String(req.query.username || '').trim();
  if (raw.length < 2 || raw.length > 50) {
    return res.json({ ok: false, reason: 'invalid' });
  }
  const n = normalizeUsername(raw);
  if (!/^[a-zA-Z0-9_.-]{2,50}$/.test(n) || n !== raw) {
    return res.json({ ok: false, reason: 'invalid' });
  }
  if (isReserved(n) || isConfusableReserved(n)) {
    return res.json({ ok: false, reason: 'reserved' });
  }
  try {
    const snap = await fb.get(`users/${safeKey(n)}`);
    return res.json({ ok: !snap.exists(), reason: snap.exists() ? 'taken' : null, username: n });
  } catch (_) {
    // Store xatosi — foydalanuvchini bloklamaymiz, server-side yana tekshiriladi
    return res.json({ ok: true, reason: null, username: n });
  }
});

// ── User Login Action (rate-limited, CSRF-protected, plan_login §3.1) ──
router.post('/user/login',
  // AUTH C-01: auth rate limiter (login/register burst + per-account/ASN)
  (req, res, next) => {
    const limiter = req.app?.get('authRateLimiter');
    if (!limiter) return next();
    const key = (req.body && req.body.mode === 'reg') ? 'register' : 'login';
    return limiter(key)(req, res, next);
  },
  // AUTH D-05 §08: auth.login / auth.register span (mode bo'yicha).
  authSpanMiddleware((req) => (req.body && req.body.mode === 'reg' ? 'auth.register' : 'auth.login'),
    (req) => ({ 'auth.mode': req.body && req.body.mode === 'reg' ? 'register' : 'login' })),
  redirectIfAuth, async (req, res) => {
  // ── LANDING JSON rejimi: X-Landing: 1 bilan kelgan so'rov HTML sahifa o'rniga
  // JSON oladi — landing formasi xatoni JOYIDA (auth-msg) ko'rsatadi va
  // foydalanuvchi /user/register'ning ikkinchi paneliga tashlanmay qoladi.
  // Barcha renderUserLogin/renderUserRegister/redirect chiqishlari shu yerda
  // ushlanadi — qolgan mantiq o'zgarmaydi.
  const mode = req.body.mode === 'reg' ? 'reg' : 'login';
  if (req.get('x-landing') === '1') {
    const form = mode === 'reg' ? 'register' : 'login';
    res.render = (view, opts = {}) => {
      const error = opts.error || null;
      res.status(error ? 401 : 200).json({
        ok: !error,
        error: error || undefined,
        lockout: !!opts.lockout,
        duplicate: !!opts.duplicate,
        form,
      });
    };
    res.redirect = (url) => {
      res.status(200).json({ ok: true, redirect: url });
    };
  }

  // LANDING (cast-demo): landing reg formasi alohida username maydoniga ega emas —
  // email local part'dan [a-zA-Z0-9_.-] username standartlash (B-09 §06 email-tolerant
  // login'ga mos). To'liq register sahifasi o'zgarmaydi (u hech qachon @ yubormaydi).
  if (mode === 'reg' && typeof req.body.username === 'string' && req.body.username.includes('@')) {
    const local = String(req.body.email || req.body.username).split('@')[0].toLowerCase()
      .replace(/[^a-z0-9_.-]/g, '').slice(0, 50);
    if (local.length >= 2) req.body.username = local;
  }
  const { username, password } = req.body;
  // AUTH A-19 §07: register'da teacher tanlovi — ariza teacher_pending sifatida.
  const wantsTeacher = mode === 'reg' && req.body.role === 'teacher';
  const lang = resolveAuthLang(req.body.lang || req.query.lang || req.cookies?.lang);
  const copy = AUTH_COPY[lang];
  // AUTH A-05: time_to_success histogram uchun — login boshidagi vaqt.
  const loginStartedAt = Date.now();

  // AUTH A-04: Zod validatsiya (login: non-empty; register: min 8 + harf + raqam)
  // AUTH A-18: register'da email majburiy (format + unique)
  // AUTH B-03: name (ishm) + invite ham parseRegister'ga o'tadi —
  // ularsiz parseRegister ularni hech qachon ko'rmaydi (name/invite yo'qoladi).
  const parsed = mode === 'login'
    ? parseLogin({ username, password })
    : parseRegister({
        username, password,
        email: req.body.email, website: req.body.website, name: req.body.name,
        invite: req.body.invite,
        // AUTH D-24 §10: qonuniy rozilik (checkbox 'on'/'true') — majburiy
        consent: req.body.consent,
        // AUTH B-29: teacher application forma maydonlari
        university: req.body.university, subject: req.body.subject,
        experience: req.body.experience, reason: req.body.reason,
      });
  // AUTH A-21/B-08 §06: honeypot to'ldirilgan — bot. Silent success qaytaramiz,
  // lekin user yaratilmaydi va rate limit bucket'iga ham tegmaydi (bot hech narsa sezmaydi).
  if (!parsed.ok && parsed.honeypot) {
    // A-21 review fix + A-22: real register parol hash + DB + email token + HIBP
    // network check (~150ms-1.5s) oladi; honeypot shu qadar tez qaytsa, bot
    // 'tez javob = bloklangan' deb bilib oladi. Random 400-900ms padding —
    // bot javob vaqtidan haqiqiy register'ni ajrata olmasin (timing side-channel yo'q).
    await new Promise((r) => setTimeout(r, 400 + Math.floor(Math.random() * 500)));
    // B-08 §14: bot_detected audit + metric
    logAuthEvent({
      action: AUDIT_ACTIONS.BOT_DETECTED,
      outcome: 'blocked',
      method: 'honeypot',
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      details: { reason: 'honeypot' },
    }).catch(() => {});
    try {
      recordMetric('auth.bot_detected', 1, { type: 'counter', labels: { source: 'honeypot' } });
    } catch (_) { /* telemetry fail-soft */ }
    // B-03: alohida register sahifasiga qaytadi (bot silent qabul qilinganini ko'radi)
    return res.redirect('/user/register?lang=' + encodeURIComponent(lang));
  }
  if (!parsed.ok) {
    if (mode === 'reg') {
      // B-03: register xatosi alohida sahifada (login tab'iga emas)
      // B-29: teacher maydon xatolari — university/subject/experience/reason
      return renderUserRegister(res, {
        lang,
        error: copy.errors[parsed.errorKey] || copy.errors.required,
        prevName: req.body.name,
        prevEmail: req.body.email,
        prevUsername: username,
        prevInvite: req.body.invite,
        prevUniversity: req.body.university,
        prevSubject: req.body.subject,
        prevExperience: req.body.experience,
        prevReason: req.body.reason,
        prevRole: req.body.role === 'teacher' ? 'teacher' : 'student',
        field: parsed.errorKey === 'usernameChars' ? 'username'
          : (parsed.errorKey === 'usernameReserved' || parsed.errorKey === 'usernameConfusable') ? 'username'
          : parsed.errorKey === 'emailInvalid' ? 'email'
          : (parsed.errorKey === 'nameShort' || parsed.errorKey === 'nameLong') ? 'name'
          : parsed.errorKey === 'inviteInvalid' ? 'invite'
          : parsed.errorKey === 'universityRequired' || parsed.errorKey === 'universityMax' ? 'university'
          : parsed.errorKey === 'subjectRequired' || parsed.errorKey === 'subjectMax' ? 'subject'
          : parsed.errorKey === 'experienceRange' ? 'experience'
          : parsed.errorKey === 'reasonMax' ? 'reason'
          : (parsed.errorKey === 'required' ? 'both' : 'password'),
      });
    }
    return renderUserLogin(res, {
      mode,
      lang,
      error: copy.errors[parsed.errorKey] || copy.errors.required,
      prevUsername: username,
      prevEmail: req.body.email,
      // usernameChars → username maydoni; required → ikkalasi; parol xatolari → password
      field: parsed.errorKey === 'usernameChars' ? 'username'
        : (parsed.errorKey === 'usernameReserved' || parsed.errorKey === 'usernameConfusable') ? 'username'
        : parsed.errorKey === 'emailInvalid' ? 'email'
        : (parsed.errorKey === 'nameShort' || parsed.errorKey === 'nameLong') ? 'name'
        : parsed.errorKey === 'inviteInvalid' ? 'invite'
        : (parsed.errorKey === 'required' ? 'both' : 'password'),
    });
  }
  const email = parsed.email;

  // AUTH B-29: teacher application — university/subject majburiy (role=teacher).
  // Zod schema'da optional (student/invite uchun); bu yerda rolga qarab qat'iy.
  if (mode === 'reg' && wantsTeacher) {
    const missing = !parsed.university || !parsed.university.trim()
      ? 'universityRequired'
      : !parsed.subject || !parsed.subject.trim() ? 'subjectRequired' : null;
    if (missing) {
      return renderUserRegister(res, {
        lang,
        error: copy.errors[missing] || copy.errors.required,
        prevUsername: username,
        prevEmail: req.body.email,
        prevName: req.body.name,
        prevInvite: req.body.invite,
        prevRole: 'teacher',
        prevUniversity: req.body.university,
        prevSubject: req.body.subject,
        prevExperience: req.body.experience,
        prevReason: req.body.reason,
        field: missing === 'universityRequired' ? 'university' : 'subject',
      });
    }
  }

  // AUTH B-04: canonical normalize (NFKC + lowercase) — login ham register ham
  // case-insensitive va full-width'ga chidamli ("Smith" → 'smith').
  const normalizedUsername = normalizeUsername(parsed.username || username);

  try {
    // AUTH B-09 §06: account username YOKI email. Duplicate flow login
    // maydonini email bilan prefill qiladi — email'ni index orqali resolve.
    // (Username'lar '@' o'z ichiga ololmaydi — '@' bor bo'lsa email ekanligi aniq.)
    let userKey = safeKey(normalizedUsername);
    if (normalizedUsername.includes('@')) {
      const { resolveAccountToUserKey } = await import('../src/modules/auth/email-verify.js');
      const resolved = await resolveAccountToUserKey(normalizedUsername);
      userKey = resolved.userKey || safeKey(normalizedUsername);
    }
    const snap = await fb.get(`users/${userKey}`);

    if (mode === 'login') {
      if (!snap.exists()) {
        // Timing side-channel himoyasi (AUTH A-03): mavjud user'da parol
        // tekshiruvi argon2 + jitter bajaradi — bu yerda ham xuddi shunday
        // kechikish beramiz, username mavjudligi javob vaqtidan aniqlanmasin.
        await verifyPassword(password, DUMMY_ARGON2_HASH).catch(() => {});
        await sleep(jitterDelayMs(0));
        return renderUserLogin(res, {
          mode,
          lang,
          error: copy.errors.userNotFound,
          prevUsername: username,
          field: 'username',
        });
      }

      const userData = snap.val();

      // AUTH B-34 §10/§11: admin review'da rad etilgan signup — account
      // bloklangan (signup_review_blocked). Generic xabar (riskBlocked) —
      // sabab aniqlanmasin (enumeration yo'q).
      if (userData && userData.signup_review_blocked) {
        logAuthEvent({
          action: AUDIT_ACTIONS.AUTH_LOGIN,
          outcome: 'blocked',
          method: 'password',
          actorId: userKey,
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'],
          details: { reason: 'signup_review_blocked' },
        }).catch(() => {});
        await sleep(jitterDelayMs(1));
        return renderUserLogin(res, {
          mode, lang, error: copy.errors.riskBlocked || copy.errors.locked,
          prevUsername: username, lockout: true,
        });
      }

      // AUTH A-03: lockout tekshiruvi (per-user qattiq — parol tekshiruvdan oldin)
      // userData snapshot'ini beramiz — 2-oyna DB read qilinmaydi.
      const lock = await checkUserLockout(userKey, userData);
      // AUTH C-02 §10: permanent blok (admin status='blocked') — countdown emas,
      // generic xato (enumeration yo'q). Support hal qiladi (support@deborah.uz).
      if (lock.permanent) {
        logAuthEvent({
          action: AUDIT_ACTIONS.AUTH_LOGIN,
          outcome: 'blocked',
          method: 'password',
          actorId: userKey,
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'],
          details: { reason: 'account_blocked', permanent: true },
        }).catch(() => {});
        return renderUserLogin(res, {
          mode, lang,
          error: copy.errors.riskBlocked || copy.errors.locked,
          prevUsername: username, lockout: false,
        });
      }
      if (lock.locked) {
        logAuthEvent({
          action: AUDIT_ACTIONS.AUTH_LOGIN,
          outcome: 'blocked',
          method: 'password',
          actorId: userKey,
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'],
          details: { retryAfterSeconds: lock.retryAfterSeconds },
        }).catch(() => {});
        return lockoutResponse(req, res, {
          retryAfterSeconds: lock.retryAfterSeconds,
          render: (o) => renderUserLogin(res, {
            mode, lang, error: copy.errors.locked, prevUsername: username,
            retryAfter: o.retryAfter, lockout: true,
          }),
        });
      }

      const storedHash = userData.password || '';

      let isMatch = false;

      // 1. Try argon2 verification first
      if (storedHash.startsWith('$argon2')) {
        isMatch = await verifyPassword(password, storedHash);
      }
      // 2. Try legacy SHA-256 verification (for migration)
      else if (isLegacyHash(storedHash)) {
        const legacyHash = hashPass(password, userKey);
        isMatch = legacyHash === storedHash;
      }
      // 3. Try legacy plaintext (oldest format)
      else if (storedHash === password) {
        isMatch = true;
      }

      if (!isMatch) {
        // AUTH A-03: jitter (brute-force sekinlashtirish) + failure qaydi (user + IP)
        const failRec = await recordFailure({ userKey, ip: req.ip, method: 'password' });
        // AUTH C-06 §06: credential stuffing / spray / device pattern (Redis)
        const stuffing = await detectStuffing({
          redis: req.app?.get('redisClient') || null,
          redisOk: req.app?.get('redisOk') === true,
          ipAddress: req.ip,
          passwordHash: passHash(req.body.password || ''),
          fingerprint: req.body.device_fp,
          userId: userKey,
        });
        // High → blok (stuffing); medium → jitter oshirish (challenge);
        // alert → davom etadi (monitoring). Fail-open: Redis yo'q → ok.
        if (stuffing.level === 'block') {
          await logAuthEvent({
            action: AUDIT_ACTIONS.ABUSE_BLOCKED,
            outcome: 'blocked',
            method: 'abuse',
            actorId: userKey,
            ipAddress: req.ip,
            userAgent: req.headers['user-agent'],
            details: { pattern: stuffing.pattern },
          }).catch(() => {});
          return renderUserLogin(res, {
            mode, lang,
            error: copy.errors.lockout || 'Xavfsizlik tizimi ushbu kirishni blokladi. Keyinroq urinib ko\'ring',
            prevUsername: username,
          });
        }
        await sleep(jitterDelayMs(failRec.userFailedAttempts + (stuffing.level === 'challenge' ? 3 : 0)));
        logAuthEvent({
          action: AUDIT_ACTIONS.AUTH_LOGIN_FAIL,
          outcome: 'failed',
          method: 'password',
          actorId: userKey,
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'],
          details: { attempts: failRec.userFailedAttempts },
        }).catch(() => {});
        // AUTH D-06 §06: login fail — outcome:'failed' (spike alert uchun)
        try {
          recordMetric('auth_login_total', 1, { type: 'counter', labels: { method: 'password', outcome: 'failed' } });
        } catch (_) {}
        return renderUserLogin(res, {
          mode,
          lang,
          error: failRec.locked ? copy.errors.locked : copy.errors.wrongPassword,
          prevUsername: username,
          retryAfter: failRec.locked ? failRec.retryAfterSeconds : 0,
          lockout: failRec.locked,
          field: failRec.locked ? null : 'password',
        });
      }

      // AUTH A-03: muvaffaqiyatli login — hisoblagichlar tozalanadi + audit
      await recordSuccess({ userKey, ip: req.ip });
      // AUTH A-03/A-05: success audit — AWAIT qilinadi! local-db writeLock
      // chain'ida keyingi fb.set() diskdan eski holatni o'qib audit yozuvini
      // overwrite qilmasligi uchun (race — A-05 da topildi).
      await logAuthEvent({
        action: AUDIT_ACTIONS.AUTH_LOGIN,
        outcome: 'success',
        method: 'password',
        actorId: userKey,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      }).catch(() => {});

      // AUTH A-05: telemetry — login_success (method) + time_to_success histogram
      try {
        recordMetric('auth.login.success', 1, { type: 'counter', labels: { method: 'password' } });
        recordMetric('auth.login.time_to_success', Date.now() - loginStartedAt, {
          type: 'histogram', unit: 'ms', labels: { method: 'password' },
        });
        // AUTH D-06 §06: Prometheus nomli metric'lar
        recordMetric('auth_login_total', 1, { type: 'counter', labels: { method: 'password', outcome: 'success' } });
        recordMetric('auth_login_duration_histogram', Date.now() - loginStartedAt, { type: 'histogram', unit: 'ms' });
      } catch (_) { /* telemetry fail-soft */ }

      // AUTH A-29 §08 (P1): breach detect — kiritilgan parol HIBP'ga async
      // tekshiriladi (k-anonymity). Topilsa → breach_flagged + security event
      // + panel banner "Parolingiz ma'lum breach'da — o'zgartiring".
      // Login'ni bloklamaydi (fire-and-forget, fail-soft). Test rejimida
      // HIBP moduli tarmoqqa chiqmaydi (NODE_ENV=test skip).
      (async () => {
        try {
          const hibp = await isPasswordBreached(password);
          if (hibp.breached) {
            await setBreachFlag(userKey);
            // AUTH B-20: breach email (P1) — parol ma'lum breach'da topildi.
            // fire-and-forget, fail-soft. Kod/parol emailda YO'Q.
            try {
              const { renderBreach } = await import('../src/modules/email/templates.js');
              const { sendEmail } = await import('../src/modules/email/provider.js');
              if (userData.email) {
                const tpl = renderBreach({ username: userData.username || '', lang });
                await sendEmail({
                  to: userData.email,
                  subject: tpl.subject,
                  html: tpl.html,
                  text: tpl.text,
                  tag: 'breach',
                });
              }
            } catch (_) { /* fail-soft */ }
            await recordAccountEvent({
              userId: userKey,
              type: ACCOUNT_EVENT_TYPES.BREACH_DETECTED,
              ipAddress: req.ip,
              userAgent: req.headers['user-agent'],
              details: { breached: true },
            }).catch(() => {});
            await logAuthEvent({
              action: AUDIT_ACTIONS.BREACH_DETECTED,
              outcome: 'detected',
              method: 'password',
              actorId: userKey,
              ipAddress: req.ip,
              userAgent: req.headers['user-agent'],
              details: { checked: hibp.checked },
            }).catch(() => {});
            try {
              recordMetric('auth.login.breach_detected', 1, { type: 'counter' });
            } catch (_) {}
          }
        } catch (_) { /* fail-soft */ }
      })();

      // AUTH A-05/A-09: last_login update (OIDC bilan izchil — oidc.js ham yozadi)
      // A-09 §6: last_login_ip_hash + last_city — yangi qurilma aniqlash uchun.
      // MUHIM: eski qiymatlar yangilashdan OLDIN olinadi — new-device check
      // yangilangan qiymatga qarshi solishtirib qolmasin (bunda har doim
      // "mos" chiqib, xabar hech qachon yuborilmas edi).
      const prevLoginState = {
        ipHash: userData.last_login_ip_hash || null,
        city: userData.last_city || null,
        at: typeof userData.last_login_at === 'number' ? userData.last_login_at : 0,
      };
      try {
        const now = Date.now();
        await fb.set(`users/${userKey}/last_login`, now);
        await fb.set(`users/${userKey}/last_login_ip_hash`, ipHash(req.ip));
        await fb.set(`users/${userKey}/last_city`, cityFromIp(req.ip));
        // AUTH B-23 §07: kontekstual opt-in — login_count sessiyalar soni
        // (birinchi kirishda emas, 2-3 sessiyadan keyin push so'raladi)
        await fb.set(`users/${userKey}/login_count`, (userData.login_count || 0) + 1);
      } catch (_) { /* non-critical */ }

      // ── AUTH A-28: risk-based auth (guide §06-§17) ──
      // Parol to'g'ri — risk baholanadi (device fingerprint + server signals).
      //   trusted   (<0.3) → seamless davom etadi
      //   unknown   (0.3-0.7) → step-up: MFA mavjud bo'lsa MFA flow (A-26),
      //                          aks holda session.riskStepup (panel'da
      //                          device trust banner — qurilmani tasdiqlash)
      //   suspicious (>0.7) → block + suspicious alert
      // Fail-soft: risk service xatosi login'ni buzmaydi (guide §17).
      let riskDecision = null;
      try {
        const fp =
          typeof req.body.device_fp === 'string' && /^[a-f0-9]{16,64}$/i.test(req.body.device_fp)
            ? req.body.device_fp.toLowerCase()
            : null;
        riskDecision = await evaluateRisk({
          userId: userKey,
          fingerprintHash: fp,
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'],
          prevLoginState,
          // C-04 §06: account_age signal — created_at < 7 kun → +0.2
          userCreatedAt: typeof userData.created_at === 'number' ? userData.created_at : 0,
          // C-05 §09: account-level velocity — Redis SET (fail-open)
          redis: req.app?.get('redisClient') || null,
          redisOk: req.app?.get('redisOk') === true,
          extraSignals: {
            vpnProxy: req.headers['x-risk-vpn'] === '1',
            bot: req.headers['x-risk-bot'] === '1',
            devTools: req.headers['x-risk-dev-tools'] === '1',
          },
        });
        // Record: audit + metric + device touch (seamless ham — tuning logs §29)
        await recordRiskDecision({
          userId: userKey,
          fingerprintHash: fp,
          score: riskDecision.score,
          tier: riskDecision.tier,
          action: riskDecision.action,
          signals: riskDecision.signals,
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'],
          blocked: riskDecision.action === 'block',
        });

        if (riskDecision.action === 'block') {
          // Suspicious (>0.7) → block + suspicious alert (A-09 queue) + audit
          try {
            await queueNewDeviceAlert({
              userId: userKey,
              type: 'suspicious',
              ipAddress: req.ip,
              userAgent: req.headers['user-agent'],
            });
          } catch (_) {}
          await logAuthEvent({
            action: AUDIT_ACTIONS.RISK_BLOCKED,
            outcome: 'blocked',
            method: 'risk',
            actorId: userKey,
            ipAddress: req.ip,
            userAgent: req.headers['user-agent'],
            details: { score: riskDecision.score, signals: riskDecision.signals, reason: 'risk_block' },
          }).catch(() => {});
          // Parol to'g'ri bo'lsa ham session berilmaydi
          return renderUserLogin(res, {
            mode,
            lang,
            error: copy.errors.riskBlocked,
            prevUsername: username,
            field: null,
          });
        }
      } catch (_) { /* risk fail-soft */ }

      // ── Legacy hash migration (tranzaktsion: rehash + save bir joyda) ──
      // If password was verified with SHA-256 or plaintext, upgrade to argon2
      if (!storedHash.startsWith('$argon2')) {
        try {
          const newHash = await hashPassword(password);
          await fb.set(`users/${userKey}/password`, newHash);
          // Audit: legacy hash migratsiyasi (A-05) — AWAIT qilinadi
          // (local-db writeLock race: fire-and-forget yozuv keyingi
          // fb.set() tomonidan overwrite bo'lishi mumkin — A-05 topilmasi).
          await audit({
            action: AUDIT_ACTIONS.AUTH_LOGIN,
            resourceType: 'user',
            details: { migratedHash: true, from: isLegacyHash(storedHash) ? 'sha256' : 'plaintext', to: 'argon2id' },
            ipAddress: req.ip,
            userAgent: req.headers['user-agent'],
          }).catch(() => {});
        } catch (_) {
          // Non-critical: next login will migrate
        }
      }

      // AUTH A-30 §06: TEACHER MFA mandatory — privileged rol (teacher/admin)
      // MFA'siz login qila olmaydi. Yo'q bo'lsa forced enrollment:
      //   pendingMfaSetup (secret + otpauth) → /user/mfa/setup → birinchi kod
      //   → enableTotp → shundagina session. O'qituvchi akkaunti MFA bilan
      //   majburiy himoyalanadi (bypass yo'q).
      const privilegedRole = userData.role === 'teacher' || userData.role === 'admin';
      if (privilegedMfaMandatory() && privilegedRole && !(await hasActiveMfa(userKey))) {
        try {
          const setup = await setupTotp(userKey, { accountName: userData.username || username });
          if (setup.ok) {
            req.session.pendingMfaSetup = {
              userId: userKey,
              secret: setup.secret,
              otpauth: setup.otpauth,
            };
            await audit({
              action: AUDIT_ACTIONS.MFA_REQUIRED,
              userId: userKey,
              resourceType: 'mfa',
              details: { reason: 'privileged_mandatory', role: userData.role },
              ipAddress: req.ip,
              userAgent: req.headers['user-agent'],
            }).catch(() => {});
            return res.redirect('/user/mfa/setup');
          }
        } catch (_) { /* fail-soft: quyidagi MFA challenge qoladi */ }
      }

      // AUTH A-26 §10: MFA challenge — parol to'g'ri, lekin MFA active bo'lsa
      // session BERILMAYDI. pendingMfa + single-use challenge yaratiladi,
      // faqat /api/mfa/verify muvaffaqiyatida session beriladi.
      const mfaEnabled = await hasActiveMfa(userKey);
      // 2026-08-27 qaror: Authenticator login'da FAQAT admin/o'qituvchi
      // uchun. Oddiy va VIP userlar parol bilan kiradi (MFA ularga kerak emas).
      if (mfaEnabled && privilegedRole) {
        try {
          const challengeId = await createMfaChallenge(userKey);
          req.session.pendingMfa = { userId: userKey, challengeId, createdAt: Date.now() };
          await audit({
            action: AUDIT_ACTIONS.MFA_REQUIRED,
            userId: userKey,
            resourceType: 'mfa',
            ipAddress: req.ip,
            userAgent: req.headers['user-agent'],
          }).catch(() => {});
          return res.redirect(`/user/mfa?challenge=${challengeId}`);
        } catch (_) {
          // Fail-soft: MFA tekshiruvi xatosi login'ni buzmasin
        }
      }

      // Regenerate session to prevent session fixation
      req.session.regenerate(async (err) => {
        if (err) {
          return renderUserLogin(res, {
            mode,
            lang,
            error: copy.errors.session,
            prevUsername: username,
          });
        }

        // Read isVip from DB
        let isVip = false;
        try {
          const vipSnap = await fb.get(`users/${userKey}/isVip`);
          isVip = vipSnap.exists() && vipSnap.val() === true;
        } catch (_) {}

        // Role-aware session (Prompt 68) — default 'student'.
        // A-31 review fix: teacher_pending/teacher_rejected ham sessiyaga
        // saqlanadi — aks holda rejected teacher login'da 'student' bo'lib
        // panelga kirib qolardi (A-19 security test topdi).
        const role = userData.role && ['student','teacher','proctor','marker','board','teacher_pending','teacher_rejected'].includes(userData.role)
          ? userData.role
          : 'student';

        req.session.user = {
          username: userData.username || username,
          safeKey: userKey,
          isVip,
          role,
          // Parol versiyasi — reset'dan keyin eski sessiyalar bekor qilinadi
          // (plan_login §5: middleware/auth.js requireAuth tekshiradi).
          passwordUpdatedAt: userData.password_updated_at || 0,
          // AUTH A-02: rol versiyasi — rol o'zgarganda eski sessiyalar bekor
          // qilinadi (0 = hali tekshirilmagan; middleware bir marta o'qiydi).
          roleVersion: typeof userData.role_version === 'number' ? userData.role_version : 0,
          // AUTH A-28: risk tier + device fingerprint — mid-session mismatch
          // (hijack signal, guide §11) va qurilma trust'ini tekshirish uchun.
          riskTier: riskDecision?.tier ?? null,
          deviceFp: riskDecision?.fingerprintHash ?? null,
          riskStepup: riskDecision?.tier === 'unknown',
          // B-07 §10: email verified — limited mode (summative blok) uchun.
          // DB'dagi email_verified faktik holati sessiyaga tushadi.
          email: userData.email || null,
          emailVerified: userData.email_verified === true,
        };

        // regenerate() yangi bo'sh sessiya yaratadi — CSRF token'ni qayta
        // o'rnatamiz, aks holda keyingi POST'lar 403 qaytaradi.
        req.session.csrfToken = crypto.randomBytes(32).toString('hex');

        // AUTH A-01: remember → 30 kun, aks holda 8 soat (Redis TTL + cookie Max-Age)
        const remember =
          req.body.remember === 'on' || req.body.remember === 'true' || req.body.remember === '1';
        req.session.remember = remember;
        req.session.cookie.maxAge = sessionTtlMs(remember);

        // AUTH A-25 §07: remember-me selector/verifier — remember=on bo'lsa
        // token yaratiladi (30 kun, device-bound), aks holda eski cookie tozalanadi.
        if (remember) {
          try {
            const pair = createRememberPair();
            await saveRememberToken({
              userId: userKey,
              selector: pair.selector,
              verifierHash: hashVerifier(pair.verifier),
              deviceHash: deviceHash(req.headers['user-agent'], req.ip),
            });
            res.cookie(rememberCookieName(), serializeRememberCookie(pair), {
              httpOnly: true,
              secure: CONFIG.NODE_ENV === 'production',
              sameSite: 'lax',
              path: '/',
              maxAge: REMEMBER_TTL_MS,
            });
            audit({
              action: AUDIT_ACTIONS.REMEMBER_CREATED,
              userId: userKey,
              resourceType: 'session',
              ipAddress: req.ip,
              userAgent: req.headers['user-agent'],
            }).catch(() => {});
          } catch (_) { /* non-critical */ }
        } else if (parseCookies(req.headers.cookie)[rememberCookieName()]) {
          // Eski remember cookie bor bo'lsagina tozalanadi — aks holda
          // qo'shimcha Set-Cookie header chiqmaydi (regression yo'q).
          res.clearCookie(rememberCookieName(), { path: '/' });
        }

        // AUTH A-02: idle timeout uchun lastActive boshlang'ich qiymati
        req.session.lastActiveAt = Date.now();
        // AUTH A-25 §08: absolute timeout (12 soat) + rotation boshlanishi
        req.session.startedAt = Date.now();
        req.session.lastRotatedAt = Date.now();

        // AUTH A-01: session record (local DB) — ro'yxat/revoke, PII minimal (ipHash)
        recordSession({
          userId: userKey,
          sessionId: req.sessionID,
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'],
          authMethod: 'password',
          remember,
          role,
          isVip,
        }).catch(() => {});

        // ── AUTH A-09: yangi qurilma + suspicious activity (guide §6-§13) ──
        // Login'da ip_hash/UA tekshiriladi; yangi bo'lsa → xabar queue +
        // yetkazish; suspicious rules (geo o'zgarish/tez login/ko'p qurilma)
        // → aniq xabar + audit. Dedupe 24h + cap kuniga ≤2 — queue'da.
        (async () => {
          const ua = req.headers['user-agent'];
          // 1) Yangi qurilma? (§6) — eski state'ga nisbatan solishtiriladi.
          // excludeSessionId: hozir yozilayotgan session'ni tashqariga chiqaradi
          // (recordSession fire-and-forget — race bo'lmasin).
          const d = await evaluateNewDevice({
            userId: userKey,
            ipAddress: req.ip,
            userAgent: ua,
            prevLoginState,
            excludeSessionId: req.sessionID,
          });
          if (d.isNew) {
            const queued = await queueNewDeviceAlert({
              userId: userKey,
              type: 'new_device',
              ipAddress: req.ip,
              userAgent: ua,
            });
            if (queued.queued && queued.alertId) {
              await deliverAlert({ userId: userKey, alertId: queued.alertId }).catch(() => {});
            }
            await logAuthEvent({
              action: AUDIT_ACTIONS.AUTH_LOGIN,
              outcome: 'new_device',
              method: 'password',
              actorId: userKey,
              ipAddress: req.ip,
              userAgent: ua,
              details: { knownSessions: d.knownCount, reason: d.reason, queued: !!queued.queued },
            }).catch(() => {});
          }

          // 2) Suspicious activity? (§9-§10)
          const susp = await evaluateSuspicious({
            userId: userKey,
            ipAddress: req.ip,
            userAgent: ua,
            prevLoginState,
          });
          if (susp.suspicious) {
            const queued = await queueNewDeviceAlert({
              userId: userKey,
              type: 'suspicious',
              ipAddress: req.ip,
              userAgent: ua,
            });
            if (queued.queued && queued.alertId) {
              await deliverAlert({ userId: userKey, alertId: queued.alertId }).catch(() => {});
            }
            try {
              recordMetric('auth.suspicious_alert', 1, { type: 'counter', labels: { rules: susp.rules.join(',') } });
            } catch (_) {}
            await logAuthEvent({
              action: 'auth.suspicious',
              outcome: 'detected',
              method: 'password',
              actorId: userKey,
              ipAddress: req.ip,
              userAgent: ua,
              details: { rules: susp.rules, queued: !!queued.queued },
            }).catch(() => {});
          }
        })().catch(() => {
          // Fail-soft: xabar tizimi login'ni buzmasin
        });

        // AUTH A-02/A-05: returnUrl'ga qaytish — allowlist (safeReturnUrl).
        // AUTH A-05 (guide A-05 §13): role redirect — student → /user/panel,
        // teacher → /teacher, admin → /admin/dashboard.
        const returnUrl = safeReturnUrl(req.query.returnUrl);
        // AUTH A-19 §08/§13: pending → "ko'rib chiqilmoqda" ekrani (task emas);
        // rejected → sabab bilan rad etilgan ekran. Hech qachon panel/workspace emas.
        if (role === 'teacher_pending' || role === 'teacher_rejected') {
          return res.redirect('/user/teacher-approval');
        }
        if (role === 'teacher') return res.redirect('/teacher');
        if (role === 'admin') return res.redirect('/admin/dashboard');
        return res.redirect(returnUrl);
      });
    } else {
      // ── Register (plan_login: min 8 + 1 harf + 1 raqam) ──
      // AUTH A-03: register limit — 5/15 daqiqa per IP (bot himoyasi)
      const regLimit = checkRegisterLimit(req.ip);
      if (!regLimit.allowed) {
        return lockoutResponse(req, res, {
          retryAfterSeconds: regLimit.retryAfterSeconds,
          render: (o) => renderUserRegister(res, {
            lang, error: copy.errors.locked, prevUsername: username,
            prevEmail: email, prevName: req.body.name, prevInvite: req.body.invite,
            prevRole: req.body.role === 'teacher' ? 'teacher' : 'student',
            retryAfter: o.retryAfter, lockout: true,
          }),
        });
      }

      // B-08 §08: per-email register limit — 3/soat (distributed bot signup qarshi)
      const { checkEmailRegisterLimit } = await import('../src/modules/auth/bot-guard.js');
      const emailLimit = checkEmailRegisterLimit(email);
      if (!emailLimit.allowed) {
        logAuthEvent({
          action: AUDIT_ACTIONS.SIGNUP_BLOCKED,
          outcome: 'blocked',
          method: 'rate_limit',
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'],
          details: { reason: 'email_rate_limit' },
        }).catch(() => {});
        return lockoutResponse(req, res, {
          retryAfterSeconds: emailLimit.retryAfterSeconds,
          render: (o) => renderUserRegister(res, {
            lang, error: copy.errors.locked, prevUsername: username,
            prevEmail: email, prevName: req.body.name, prevInvite: req.body.invite,
            prevRole: req.body.role === 'teacher' ? 'teacher' : 'student',
            retryAfter: o.retryAfter, lockout: true,
          }),
        });
      }

      // B-08 §07: Turnstile — secret o'rnatilgan bo'lsa qat'iy (fail-open yo'q:
      // secret bor = bot'lar widget'dan o'tishi shart; secret yo'q = dev/test fail-open).
      const { verifyTurnstile } = await import('../src/modules/auth/bot-guard.js');
      const cf = await verifyTurnstile(req.body['cf-turnstile-response']);
      if (!cf.ok) {
        logAuthEvent({
          action: AUDIT_ACTIONS.BOT_DETECTED,
          outcome: 'blocked',
          method: 'turnstile',
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'],
          details: { reason: cf.error },
        }).catch(() => {});
        try {
          recordMetric('auth.bot_detected', 1, { type: 'counter', labels: { source: 'turnstile' } });
        } catch (_) { /* telemetry fail-soft */ }
        return lockoutResponse(req, res, {
          retryAfterSeconds: 15,
          render: (o) => renderUserRegister(res, {
            lang, error: copy.errors.locked, prevUsername: username,
            prevEmail: email, prevName: req.body.name, prevInvite: req.body.invite,
            prevRole: req.body.role === 'teacher' ? 'teacher' : 'student',
            retryAfter: o.retryAfter, lockout: true,
          }),
        });
      }

      // AUTH B-34 §06/§07: signup velocity — per-IP yumshoq (kampus NAT) +
      // per-fingerprint qattiq. Limit'da 429 + Turnstile qattiq (B-08 §23:
      // Redis/DB down → velocity yumshoq fail-open, Turnstile qattiq qoladi).
      // Fingerprint faqat hash {16,64} hex — raw ma'lumot server'ga kirmaydi (§14).
      const deviceFp = typeof req.body.device_fp === 'string'
        && /^[a-f0-9]{16,64}$/i.test(req.body.device_fp)
        ? req.body.device_fp.toLowerCase() : null;
      const {
        checkSignupVelocity, recordDomainSignup, checkDomainReputation, createSignupReview,
      } = await import('../src/modules/auth/bot-guard.js');
      const vel = await checkSignupVelocity({ ip: req.ip, fingerprint: deviceFp });
      if (!vel.allowed) {
        logAuthEvent({
          action: AUDIT_ACTIONS.SIGNUP_VELOCITY_BLOCK,
          outcome: 'blocked',
          method: 'register',
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'],
          details: { reason: vel.reason, scope: vel.reason === 'velocity_fp' ? 'fingerprint' : 'ip' },
        }).catch(() => {});
        try {
          recordMetric('signup.velocity_block', 1, {
            type: 'counter', labels: { reason: vel.reason },
          });
        } catch (_) { /* telemetry fail-soft */ }
        return lockoutResponse(req, res, {
          retryAfterSeconds: vel.retryAfterSeconds || 3600,
          render: (o) => renderUserRegister(res, {
            lang, error: copy.errors.locked, prevUsername: username,
            prevEmail: email, prevName: req.body.name, prevInvite: req.body.invite,
            prevRole: req.body.role === 'teacher' ? 'teacher' : 'student',
            retryAfter: o.retryAfter, lockout: true,
          }),
        });
      }

      // AUTH B-16 §14: rad etilgan teacher qayta ariza topshirsa (cooldown
      // o'tgach) → TEACHER_APPEAL audit (submitTeacherApplication'ga uzatiladi).
      let appealSubmit = false;
      if (snap.exists()) {
        const existing = snap.val() || {};
        // AUTH A-25 §14: rad etilgan teacher — 30 kun cooldown; o'tgach qayta
        // ariza (appeal) qabul qilinadi (eski record overwrite qilinadi).
        if (wantsTeacher && existing.role === 'teacher_rejected') {
          const decidedAt = existing.teacher_decision_at || 0;
          const cooldownMs = CONFIG.TEACHER_REJECT_COOLDOWN_MS || 30 * 24 * 60 * 60 * 1000;
          if (Date.now() - decidedAt < cooldownMs) {
            logAuthEvent({
              action: AUDIT_ACTIONS.TEACHER_COOLDOWN_BLOCK,
              outcome: 'blocked',
              method: 'register',
              actorId: userKey,
              ipAddress: req.ip,
              userAgent: req.headers['user-agent'],
              details: { remainingMs: decidedAt + cooldownMs - Date.now() },
            }).catch(() => {});
            return renderUserRegister(res, {
              lang,
              error: copy.errors.teacherCooldown,
              prevUsername: username,
              prevEmail: email,
              prevName: req.body.name,
              prevInvite: req.body.invite,
              prevRole: 'teacher',
              field: 'username',
            });
          }
          // Cooldown o'tgan — appeal qabul: eski rejection marker tozalanadi
          appealSubmit = true;
          await fb.remove(`users/${userKey}/teacher_rejection_reason`).catch(() => {});
        } else {
          // AUTH B-09 §06: duplicate — "Akkauntingiz borga o'xshaydi" + Kirish.
          // Enumeration himoya: xabar email band bilan BIR XIL; rate limit
          // (per-IP 5/15 + per-email 3/h) allaqachon qo'llaniladi.
          logAuthEvent({
            action: AUDIT_ACTIONS.DUPLICATE_ATTEMPT,
            outcome: 'blocked',
            method: 'register',
            ipAddress: req.ip,
            userAgent: req.headers['user-agent'],
            details: { reason: 'username_taken', field: 'username' },
          }).catch(() => {});
          return renderUserRegister(res, {
            lang,
            error: copy.errors.duplicate,
            duplicate: true,
            prevAccount: email || username,
            prevUsername: username,
            prevEmail: email,
            prevName: req.body.name,
            prevInvite: req.body.invite,
            prevRole: wantsTeacher ? 'teacher' : 'student',
            field: 'username',
          });
        }
      }

      // AUTH A-23 §11-§12 + B-05: email validation — syntax + disposable
      // (hard block) + MX (domain'da mail server) + typo suggestion.
      // Sync 200ms budget; MX natijasi 24h cache; test'da MX skip (fail-open).
      const { validateFast } = await import('../src/modules/email/validation.js');
      const vEmail = await validateFast(email);
      try {
        recordMetric('auth.email_validation', 1, {
          type: 'counter', labels: { result: vEmail.ok ? 'ok' : (vEmail.reason || 'ok') },
        });
        if (vEmail.reason === 'disposable') {
          recordMetric('auth.email_disposable_blocked', 1, { type: 'counter' });
        }
      } catch (_) {}
      if (!vEmail.ok && vEmail.reason === 'disposable') {
        logAuthEvent({
          action: AUDIT_ACTIONS.EMAIL_VALIDATION_REJECT,
          outcome: 'blocked',
          method: 'register',
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'],
          details: { reason: 'disposable' },
        }).catch(() => {});
        return renderUserRegister(res, {
          lang,
          error: copy.errors.emailDisposable,
          prevUsername: username,
          prevEmail: email,
          prevName: req.body.name,
          prevInvite: req.body.invite,
          prevRole: wantsTeacher ? 'teacher' : 'student',
          field: 'email',
        });
      }
      if (!vEmail.ok && vEmail.reason === 'no-mx') {
        // Domain'da mail server yo'q — sintez tekshiruv; enumeration emas
        // (bitta javob: emailInvalid). MX tekshiruvini blok emas, rad etish.
        logAuthEvent({
          action: AUDIT_ACTIONS.EMAIL_VALIDATION_REJECT,
          outcome: 'blocked',
          method: 'register',
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'],
          details: { reason: 'no-mx' },
        }).catch(() => {});
        return renderUserRegister(res, {
          lang,
          error: copy.errors.emailInvalid,
          prevUsername: username,
          prevEmail: email,
          prevName: req.body.name,
          prevInvite: req.body.invite,
          prevRole: wantsTeacher ? 'teacher' : 'student',
          field: 'email',
        });
      }

      // AUTH A-18 §08: email unique — users_email_index (enumeration band email
      // xabari rate limit bilan himoyalanadi; umumiy javob bir xil qoladi).
      const emailIdx = await indexEmail(email, userKey);
      if (!emailIdx.ok) {
        // AUTH B-09 §29: email band + duplicate BIR XIL UX (enumeration).
        logAuthEvent({
          action: AUDIT_ACTIONS.DUPLICATE_ATTEMPT,
          outcome: 'blocked',
          method: 'register',
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'],
          details: { reason: 'email_taken', field: 'email' },
        }).catch(() => {});
        return renderUserRegister(res, {
          lang,
          error: copy.errors.duplicate,
          duplicate: true,
          prevAccount: email || username,
          prevUsername: username,
          prevEmail: email,
          prevName: req.body.name,
          prevInvite: req.body.invite,
          prevRole: wantsTeacher ? 'teacher' : 'student',
          field: 'email',
        });
      }

      // AUTH A-22: NIST parol siyosati — dynamic min (8 MFA / 15 oddiy),
      // complexity talabi yo'q; teacher uchun zxcvbn score >= 4 SHART.
      const pol = evaluatePassword(password, {
        mfa: false, // twofa_enabled hali o'rnatilmagan (keyingi A-faza)
        requireStrong: wantsTeacher,
      });
      if (!pol.ok) {
        audit({
          action: AUDIT_ACTIONS.PASSWORD_POLICY_REJECT,
          resourceType: 'user',
          details: { reason: pol.reason, score: pol.score, role: wantsTeacher ? 'teacher' : 'student' },
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'],
        }).catch(() => {});
        return renderUserRegister(res, {
          lang,
          error: copy.errors[pol.reason] || copy.errors.passwordMin,
          prevUsername: username,
          prevEmail: email,
          prevName: req.body.name,
          prevInvite: req.body.invite,
          prevRole: wantsTeacher ? 'teacher' : 'student',
          field: 'password',
        });
      }

      // AUTH A-22: HIBP Pwned Passwords (k-anonymity) — breach parol rad.
      // Test rejimida skip (fail-open); offline'da ham fail-open + log.
      const hibp = await isPasswordBreached(password);
      if (hibp.breached) {
        audit({
          action: AUDIT_ACTIONS.BREACH_PASSWORD_BLOCKED,
          resourceType: 'user',
          details: { checked: hibp.checked },
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'],
        }).catch(() => {});
        return renderUserRegister(res, {
          lang,
          error: copy.errors.passwordWeak,
          prevUsername: username,
          prevEmail: email,
          prevName: req.body.name,
          prevInvite: req.body.invite,
          prevRole: wantsTeacher ? 'teacher' : 'student',
          field: 'password',
        });
      }

      // Hash with argon2 (modern, memory-hard)
      const hashed = await hashPassword(password);

      // AUTH A-19 §07: teacher register → teacher_pending (admin tasdiqlaydi).
      // Ariza ma'lumotlari (universitet, ariza matni) user record'ga saqlanadi.
      const teacherRole = wantsTeacher ? 'teacher_pending' : 'student';
      const teacherApp = wantsTeacher
        ? {
            university: String(req.body.university || '').trim().slice(0, 200),
            reason: String(req.body.reason || '').trim().slice(0, 500),
            appliedAt: Date.now(),
          }
        : null;

      // AUTH B-03: role_selected metrikasi (register'da rol tanlandi)
      try {
        recordMetric('auth.register.role_selected', 1, { type: 'counter', labels: { role: wantsTeacher ? 'teacher' : 'student' } });
      } catch (_) {}

      // AUTH B-01: canonical users schema — normalizeUserRecord idempotent
      // backfill qiladi (email_status, updated_at, twofa_enabled va h.k.).
      // AUTH B-03: name (ism) + invite_code (ixtiyoriy) ham saqlanadi.
      await fb.set(`users/${userKey}`, normalizeUserRecord({
        username: normalizedUsername,
        ...(parsed.name ? { name: parsed.name } : {}),
        email, // AUTH A-18: majburiy — parol tiklash uchun asos
        email_verified: false,
        password: hashed,
        created_at: Date.now(),
        safeKey: userKey,
        isVip: false,
        role: teacherRole,
        role_version: 1, // AUTH A-02: rol versiyasi — approval'da oshiriladi
        // B-03 (review fix): invite B-12 gacha faqat format tekshiriladi —
        // privilege bermaydi; 'unverified' marker kelajakdagi kod ishonmasin.
        ...(parsed.invite ? { invite_code: parsed.invite, invite_status: 'unverified' } : {}),
        ...(teacherApp ? { teacher_application: teacherApp } : {}),
        // B-06 §09: lang persist — resend/panel settings/lang dan o'qiydi;
        // birinchi email (register) bilan keyingi email tili mos bo'lishi uchun.
        settings: { lang },
      }));// AUTH D-24 §10 / D-25 §07/§09: qonuniy rozilik — purpose'li yozuv
// (privacy_policy_v1 + ip_hash). parseRegister'da consent majburiy
// tekshirilgan — bu yerda faqat yozuv (idempotent; audit consent:granted).
      await recordConsent(userKey, CONSENT_PURPOSES.PRIVACY_POLICY, {
        lang,
        ipHash: ipHash(req.ip),
      }).catch(() => {});

      // AUTH B-14 §06/§08: teacher arizasi → canonical `teacher_applications`
      // record + audit + metric. Appeal (teacher_rejected → cooldown o'tdi)
      // ham shu yerda yangi ariza sifatida qayd etiladi (role allaqachon
      // teacher_pending qilib yozildi — cooldown gate faqat himoya sifatida).
      if (teacherRole === 'teacher_pending') {
        const appResult = await submitTeacherApplication({
          userKey,
          username: normalizedUsername,
          email,
          name: parsed.name || '',
          // AUTH B-29: Zod'dan (trim/limit tekshirilgan) — req.body'ga ishonilmaydi
          university: parsed.university || '',
          subject: parsed.subject || '',
          experience: parsed.experience || '',
          reason: parsed.reason || '',
          lang,
          // B-16 §14: cooldown o'tgan rejected → appeal (TEACHER_APPEAL audit)
          appeal: appealSubmit,
        }).catch(() => ({ ok: false, error: 'server' }));
        // B-29 §14: duplicate — pending/approved allaqachon mavjud
        if (!appResult || !appResult.ok) {
          if (appResult?.error === 'duplicate_application') {
            return renderUserRegister(res, {
              lang,
              error: copy.errors.duplicate_application || copy.errors.required,
              prevUsername: username,
              prevEmail: email,
              prevName: req.body.name,
              prevInvite: req.body.invite,
              prevRole: 'teacher',
              field: 'username',
            });
          }
          logAuthEvent({
            action: AUDIT_ACTIONS.TEACHER_APPLICATION,
            outcome: 'fail',
            method: 'register',
            actorId: userKey,
            details: { error: appResult?.error || 'unknown' },
          }).catch(() => {});
        }
      }

      // AUTH A-18 §11: verify kod emailga yuboriladi (A-23: provider orqali).
      // Kod hech qachon log'ga chiqmaydi; audit'da faqat event.
      // B-06 §09: template 4 til — register'dagi lang (cookie/query/settings).
      // BUG-039: javobni SMTP bloklamasin — maks 5s kutamiz, yuborish orqada
      // davom etadi (mock/tez provider'da race zudlik bilan fulfilled bo'ladi).
      await Promise.race([
        sendVerifyCode({ userKey, email, lang }).then((r) => {
          // 09/2026: yuborilmasa jim o'tmaymiz — server log'da aniq ko'rinadi
          if (!r || !r.ok) console.warn(`[register] verify kod yuborilmadi (${r?.error || 'unknown'})`);
        }).catch((err) => console.warn('[register] verify send error:', err?.message || err)),
        new Promise((resolve) => setTimeout(resolve, 5000)),
      ]);

      // B-06 §20: metric — birinchi send ham sanaladi (resend bilan yig'indi)
      try {
        recordMetric('auth.email_verify.sent', 1, {
          type: 'counter',
          labels: { channel: 'email', method: 'email' },
        });
      } catch (_) { /* telemetry fail-soft */ }

      // AUTH B-05 §07: background SMTP probe (validateFull) — create'dan keyin
      // fire-and-forget, fail-open. 'missing' bo'lsa faqat flag + audit
      // (email_status pending qoladi — signup buzilmaydi, §29).
      (async () => {
        try {
          const { validateFull } = await import('../src/modules/email/validation.js');
          const probeRes = await validateFull(email);
          if (probeRes.mailbox === 'missing') {
            await fb.set(`users/${userKey}/smtp_probe_failed`, true);
            await logAuthEvent({
              action: AUDIT_ACTIONS.EMAIL_SMTP_PROBE,
              outcome: 'missing',
              method: 'smtp',
              actorId: userKey,
              ipAddress: req.ip,
              userAgent: req.headers['user-agent'],
              details: { domain: email.split('@')[1] },
            }).catch(() => {});
          }
        } catch (_) { /* fail-open */ }
      })();

      // AUTH A-23: welcome email (register muvaffaqiyat; fire-and-forget)
      sendEmail({
        to: email,
        subject: renderWelcome({ username, lang }).subject,
        html: renderWelcome({ username, lang }).html,
        text: renderWelcome({ username, lang }).text,
        tag: 'welcome',
      }).catch((err) => console.warn('[email:welcome] send failed:', err?.message || err));
      logAuthEvent({
        action: AUDIT_ACTIONS.EMAIL_VERIFY_SENT,
        outcome: 'success',
        method: 'email',
        // B-06 §14: verify_sent (channel) — kod hech qachon log'ga chiqmaydi
        channel: 'email',
        actorId: userKey,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      }).catch(() => {});

      // Regenerate session after registration
      req.session.regenerate(async (err) => {
        if (err) {
          return renderUserRegister(res, {
            lang,
            error: copy.errors.session,
            prevUsername: username,
            prevEmail: email,
            prevName: req.body.name,
            prevInvite: req.body.invite,
            prevRole: wantsTeacher ? 'teacher' : 'student',
          });
        }
        req.session.user = {
          username: normalizedUsername,
          safeKey: userKey,
          isVip: false,
          role: teacherRole,
          email, // AUTH A-18: session'da email (verify UX uchun)
          emailVerified: false,
          passwordUpdatedAt: 0,
          roleVersion: 1, // AUTH A-02: rol versiyasi
        };
        // regenerate() yangi bo'sh sessiya yaratadi — CSRF token'ni qayta
        // o'rnatamiz, aks holda keyingi POST'lar 403 qaytaradi.
        req.session.csrfToken = crypto.randomBytes(32).toString('hex');
        // AUTH A-02: idle timeout uchun lastActive boshlang'ich qiymati
        req.session.lastActiveAt = Date.now();
        // AUTH A-25 §08: absolute timeout + rotation boshlanishi
        req.session.startedAt = Date.now();
        req.session.lastRotatedAt = Date.now();
        // AUTH A-03: register limit + audit
        recordRegister(req.ip);
        // AUTH B-34 §07/§09/§10: muvaffaqiyatli signup — domain history +
        // suspicious bo'lsa review queue (fire-and-forget, register javobini
        // sekinlatmaydi; failure → yumshoq). Velocity counter'ni check allaqachon
        // increment qilgan (§07 INCR) — bu yerda takroriy count YO'Q.
        (async () => {
          try {
            const domain = String(email || '').split('@')[1] || null;
            if (domain) await recordDomainSignup(domain);
            // Suspicious: velocity score yuqori yoki butunlay yangi domain
            let suspicious = null;
            if (vel.score >= 0.6) {
              suspicious = { reason: 'velocity', score: vel.score };
            } else if (domain) {
              const rep = await checkDomainReputation(domain);
              if (!rep.known) suspicious = { reason: 'domain', score: 0.5 };
            }
            if (suspicious) {
              await createSignupReview({
                userId: userKey,
                reason: suspicious.reason,
                score: suspicious.score,
                ipHash: ipHash(req.ip),
                fingerprintHash: deviceFp, // faqat hash — raw PII yo'q
                domain,
              });
            }
          } catch (_) { /* non-critical */ }
        })();
        logAuthEvent({
          action: AUDIT_ACTIONS.AUTH_REGISTER,
          outcome: 'success',
          method: 'password',
          actorId: userKey,
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'],
          details: wantsTeacher ? { role: 'teacher_pending' } : undefined,
        }).catch(() => {});
        // AUTH D-06 §06: auth_register_total (Prometheus)
        try {
          recordMetric('auth_register_total', 1, { type: 'counter', labels: { role: wantsTeacher ? 'teacher' : 'student' } });
        } catch (_) {}
        // AUTH A-19: teacher arizasi uchun audit event (admin ro'yxatda ko'radi)
        if (wantsTeacher) {
          logAuthEvent({
            action: AUDIT_ACTIONS.TEACHER_APPLICATION,
            outcome: 'submitted',
            method: 'register',
            actorId: userKey,
            ipAddress: req.ip,
            userAgent: req.headers['user-agent'],
            details: { university: teacherApp.university },
          }).catch(() => {});
        }
        // AUTH A-01: yangi ro'yxatdan o'tgan user ham session registry'da ko'rinsin
        // (login oqimi bilan bir xil — session ro'yxati/revoke izchil bo'ladi).
        recordSession({
          userId: userKey,
          sessionId: req.sessionID,
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'],
          authMethod: 'password',
          remember: false,
          role: teacherRole,
          isVip: false,
        }).catch(() => {});
        // AUTH A-19: pending teacher → cheklangan rejim ekraniga
        // AUTH D-05: muvaffaqiyatli login — span outcome success
        res.locals.authOutcome = 'success';
        return res.redirect(wantsTeacher ? '/user/teacher-approval' : '/user/panel');
      });
    }
  } catch (err) {
    console.error('Auth error:', err);
    return renderUserLogin(res, {
      mode,
      lang,
      error: copy.errors.server,
      prevUsername: username,
    });
  }
});

// ── Forgot Password render helper (plan_login §3.3) ──
function renderForgot(res, opts) {
  const {
    error = null, sent = false, lang = 'uz', prevUsername = null,
    retryAfter = 0, lockout = false, devPreview = null,
  } = opts || {};
  const l = resolveAuthLang(lang);
  res.render('user/forgot', {
    title: AUTH_COPY[l].meta.title,
    description: AUTH_COPY[l].meta.description,
    lang: l,
    AUTH_LANGS,
    copy: AUTH_COPY[l],
    error,
    sent,
    prevUsername,
    retryAfter,
    lockout,
    devPreview, // AUTH A-20: dev/test token havolasi (production'da YO'Q)
  });
}

// ── Forgot Password Page (plan_login §4: 4 til, CSRF) ──
router.get('/user/forgot', redirectIfAuth, (req, res) => {
  const lang = resolveAuthLang(req.query.lang || req.cookies?.lang);
  // AUTH B-09 §06: duplicate alert'dan kelgan ?account= — maydon prefilled
  const account = typeof req.query.account === 'string'
    ? String(req.query.account).slice(0, 100)
    : null;
  renderForgot(res, { lang, prevUsername: account });
});

// ── Forgot Password Action (enumeration-safe, rate-limited via generalLimiter) ──
router.post('/user/forgot', redirectIfAuth, async (req, res) => {
  const { username } = req.body;
  const lang = resolveAuthLang(req.body.lang || req.query.lang || req.cookies?.lang);
  const copy = AUTH_COPY[lang];

  if (!username) {
    return renderForgot(res, { lang, error: copy.errors.required });
  }

  try {
    // AUTH A-20 §07: account username YOKI email bo'lishi mumkin.
    const { resolveAccountToUserKey } = await import('../src/modules/auth/email-verify.js');
    const { userKey } = await resolveAccountToUserKey(username);

    // AUTH A-03: reset limit — 3/soat per account (spam/brute force)
    const resetLimit = checkResetLimit(username);
    if (!resetLimit.allowed) {
      return lockoutResponse(req, res, {
        retryAfterSeconds: resetLimit.retryAfterSeconds,
        render: (o) => renderForgot(res, {
          lang, error: copy.errors.locked, retryAfter: o.retryAfter, lockout: true,
        }),
      });
    }
    recordResetRequest(username);
    logAuthEvent({
      action: AUDIT_ACTIONS.AUTH_RESET_REQUEST,
      outcome: 'success',
      method: 'reset',
      actorId: userKey || username,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      details: { rateLimited: false },
    }).catch(() => {});

    // User mavjud bo'lsa — 15 daqiqalik token yaratib saqlaymiz.
    // Token hash'lab saqlanadi (resetTokens/{tokenHash} → { safeKey }) —
    // DB kompromat bo'lsa ham havola o'g'irlab bo'lmaydi.
    // AUTH A-20 §08/§09: faqat verified email'li user'ga token (A-18 asos).
    let devPreview = null;
    if (userKey) {
      const userSnap = await fb.get(`users/${userKey}`);
      const userData = userSnap.exists() ? userSnap.val() : {};
      const verifiedEmail = !!(userData.email && userData.email_verified === true);
      if (verifiedEmail) {
        const token = crypto.randomBytes(48).toString('hex');
        const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
        const expiresAt = Date.now() + 15 * 60 * 1000;
        await fb.set(`resetTokens/${tokenHash}`, {
          safeKey: userKey,
          expiresAt,
          createdAt: Date.now(),
        });
        // Dev/test: token havolasi LOG'GA CHIQARILMAYDI (A-17 PII scan —
        // log/audit'da token bo'lmasligi shart). Preview sahifada ko'rsatiladi
        // (production'da hech qachon ko'rinmaydi).
        if (CONFIG.NODE_ENV !== 'production') {
          devPreview = `/user/reset?token=${token}`;
        }
        // Audit: parol tiklash so'rovi (faqat verified user'da — enumeration
        // audit log'iga oqib ketmasin).
        await audit({
          action: AUDIT_ACTIONS.RESET_REQUEST,
          resourceType: 'user',
          details: { method: 'link' },
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'],
        }).catch(() => {});
      } else {
        // Verified bo'lmagan / legacy email — token YO'Q (A-20 §09/§10).
        // Javob bir xil — user login'da A-18 verify banner ko'radi.
        logAuthEvent({
          action: AUDIT_ACTIONS.AUTH_RESET_REQUEST,
          outcome: 'blocked',
          method: 'reset',
          actorId: userKey,
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'],
          details: { reason: 'email_not_verified' },
        }).catch(() => {});
      }
    } else {
      // Timing side-channel himoyasi: mavjud user'da fb.set yozuvi bor
      // (sekinroq). Yo'q user'da ham xuddi shunday kechikish beramiz —
      // javob vaqtidan user mavjudligini aniqlab bo'lmasin.
      await new Promise((r) => setTimeout(r, 180));
    }

    // Enumeration-safe: user mavjud bo'lmasa ham bir xil javob.
    // Dev/test preview — faqat ushbu so'rov javobida, production'da yo'q.
    return renderForgot(res, { lang, sent: true, devPreview });
  } catch (err) {
    console.error('Forgot error:', err);
    return renderForgot(res, { lang, error: copy.errors.server });
  }
});

// ── User Logout (session destroy + remember token revoke + cookie clear) ──
// BUG-032: logout-CSRF — GET faqat tasdiq sahifasi, real chiqish POST + CSRF bilan
// S28 (D-17 §06 + E-03 kontrakt tiklandi): GET /user/logout — haqiqiy chiqish (302).
// Sabab: e6ae35e'dagi GET=tasdiq sahifasi 7 ta auth journey testini buzdi
// (logout bo'lmaydi → keyingi login 403, push token revoke bo'lmaydi).
// logout-csrf.test user-branch [200,302] tolerant — 302 bilan ham o'tadi;
// ADMIN GET /admin/logout tasdiq sahifasi SAQLANDI (u qat'iy 200 talab qiladi).
// UI (sidebar) allaqachon POST + CSRF ishlatadi (BUG-037); ?revoke_token=
// (E-03 push service-worker link) faqat o'z tokenini o'chiradi.
router.get('/user/logout', async (req, res) => {
  if (!req.session?.user) return res.redirect('/');
  // BUG-008/230db222 fix (yengil): cross-site GET logout blok (logout CSRF).
  // Sec-Fetch-Site yuborgan brauzerlarda cross-site/same-site so'rovlar rad;
  // to'g'ridan-to'g'ri manzil satridan kirish ('none') va same-origin ruxsat.
  // Eski brauzerlar header yubormasligi mumkin — fail-open (UI POST+CSRF ishlatadi).
  const sfs = String(req.headers['sec-fetch-site'] || '').toLowerCase();
  if (sfs === 'cross-site' || sfs === 'same-site') {
    return res.status(403).send('Cross-site logout blocked');
  }
  // A-25 §07: remember token revoke (DB)
  try {
    const cookieVal = parseCookies(req.headers.cookie)[rememberCookieName()];
    if (cookieVal) {
      const pair = parseRememberCookie(cookieVal);
      if (pair) await revokeRememberToken(pair.selector);
    }
  } catch (_) { /* non-critical */ }
  // E-03: push device token revoke (PII) — GET link orqali ham
  try {
    const userKey = req.session?.user?.safeKey;
    const revokeToken = typeof req.query?.revoke_token === 'string' ? String(req.query.revoke_token).slice(0, 500) : '';
    if (userKey && revokeToken) {
      const { removeFcmToken } = await import('../src/modules/student/fcm.js');
      await removeFcmToken({ userId: userKey, token: revokeToken }).catch(() => {});
    }
  } catch (_) { /* non-critical */ }
  res.clearCookie(rememberCookieName(), { path: '/' });
  req.session.destroy(() => {
    res.clearCookie(sessionCookieName());
    res.redirect('/');
  });
});

// Tasdiq sahifasi (ixtiyoriy): UI'da foydalanilmaydi, lekin saqlanadi —
// formasi POST /user/logout'ga yuboradi (CSRF bilan).
router.get('/user/logout/confirm', (req, res) => {
  if (!req.session?.user) return res.redirect('/');
  res.render('logout-confirm', {
    title: 'Chiqishni tasdiqlash',
    action: '/user/logout',
    back: '/user/panel',
    csrfToken: req.csrfToken ? req.csrfToken() : (req.session?.csrfToken || ''),
  });
});

router.post('/user/logout', async (req, res) => {
  // AUTH A-25 §07: remember token revoke (DB) + cookie tozalash
  try {
    const cookieVal = parseCookies(req.headers.cookie)[rememberCookieName()];
    if (cookieVal) {
      const pair = parseRememberCookie(cookieVal);
      if (pair) await revokeRememberToken(pair.selector);
    }
  } catch (_) { /* non-critical */ }
  // AUTH E-03: logout'da device push token revoke (PII). Client o'z tokenini
  // ?revoke_token= orqali yuboradi — faqat o'z user'iga tegishli token o'chadi.
  try {
    const userKey = req.session?.user?.safeKey;
    const revokeToken = typeof req.body?.revoke_token === 'string' ? req.body.revoke_token.slice(0, 500) : '';
    if (userKey && revokeToken) {
      const { removeFcmToken } = await import('../src/modules/student/fcm.js');
      await removeFcmToken({ userId: userKey, token: revokeToken }).catch(() => {});
    }
  } catch (_) { /* non-critical */ }
  res.clearCookie(rememberCookieName(), { path: '/' });
  req.session.destroy(() => {
    res.clearCookie(sessionCookieName());
    res.redirect('/');
  });
});

// ── AUTH A-25 §09: re-auth (sensitive amallar uchun — parol verify) ──
// OWASP: parol/email o'zgartirish, teacher approve kabi amallardan oldin
// foydalanuvchi qisqa muddat ichida parolini qayta tasdiqlagan bo'lishi shart.
router.post('/api/auth/reauth', requireAuth, async (req, res) => {
  try {
    const { password } = req.body || {};
    const userKey = req.session.user?.safeKey;
    if (!userKey) return res.status(401).json({ ok: false, error: 'unauthorized' });
    if (!password) return res.status(400).json({ ok: false, error: 'required' });
    if (reauthLimited('user', userKey, req.ip)) {
      logAuthEvent({
        action: AUDIT_ACTIONS.REAUTH_FAILED,
        outcome: 'rate-limited',
        method: 'password',
        actorId: userKey,
        ipAddress: req.ip,
      }).catch(() => {});
      return res.status(429).json({ ok: false, error: 'rate-limited' });
    }
    const snap = await fb.get(`users/${userKey}/password`);
    if (!snap.exists()) return res.status(404).json({ ok: false, error: 'not-found' });
    // Login bilan bir xil tekshiruv (legacy sha256/plaintext + migratsiya) —
    // aks holda eski akkauntlar to'g'ri parol bilan reauth'da 403 oladi
    const v = await verifyLoginPassword(password, snap.val(), userKey);
    if (v.ok && v.migrated && v.newHash) {
      await fb.set(`users/${userKey}/password`, v.newHash).catch(() => {});
    }
    const ok = v.ok;
    if (!ok) {
      logAuthEvent({
        action: AUDIT_ACTIONS.REAUTH_FAILED,
        outcome: 'wrong-password',
        method: 'password',
        actorId: userKey,
        ipAddress: req.ip,
      }).catch(() => {});
      return res.status(403).json({ ok: false, error: 'wrong-password' });
    }
    req.session.reauthedAt = Date.now();
    // AUTH A-28: parol reauth → mid-session mismatch flag tozalanadi (banner yopiladi)
    if (req.session.user) delete req.session.user.riskFlagged;
    logAuthEvent({
      action: AUDIT_ACTIONS.REAUTH_SUCCESS,
      outcome: 'success',
      method: 'password',
      actorId: userKey,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    }).catch(() => {});
    return res.json({ ok: true });
  } catch (err) {
    console.error('Reauth error:', err.message);
    return res.status(500).json({ ok: false, error: 'server' });
  }
});

// ── AUTH A-28 §11: mid-session fingerprint mismatch (hijack signal) ──
// Active session'da fingerprint o'zgargan bo'lsa → riskFlagged (audit +
// metric). Faqat HASH solishtiriladi — raw telemetry client'da qoladi.
router.post('/api/auth/device/check', requireAuth, async (req, res) => {
  try {
    const sessionFp = req.session.user?.deviceFp;
    const fp =
      typeof req.body?.fingerprint === 'string' && /^[a-f0-9]{16,64}$/i.test(req.body.fingerprint)
        ? req.body.fingerprint.toLowerCase()
        : null;
    // Session'da fingerprint yo'q (eski login) yoki client hash bermadi
    // (privacy blocker) — fail-safe: mismatch hisoblanmaydi.
    if (!sessionFp || !fp) return res.json({ ok: true, mismatch: false });
    const { mismatch } = await checkMidSessionFingerprint({
      userId: req.session.user.safeKey,
      sessionFingerprint: sessionFp,
      currentFingerprint: fp,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    if (mismatch) req.session.user.riskFlagged = true;
    return res.json({ ok: true, mismatch });
  } catch (_) {
    return res.json({ ok: true, mismatch: false }); // fail-soft
  }
});

// AUTH C-03 §08: login → device register (upsert) — idempotent.
// Body: { fingerprint } (16-64 hex). Session'da yo'q bo'lsa ham ishlaydi
// (login'da risk flow allaqachon touch qiladi — bu SPA/retry uchun explicit).
// Privacy: FAQAT hash saqlanadi (raw canvas/WebGL hech qachon).
router.post('/api/auth/device/register', requireAuth, async (req, res) => {
  try {
    const raw = req.body?.fingerprint || req.body?.device_fp || req.session.user?.deviceFp;
    const fingerprintHash = typeof raw === 'string' && isFingerprintHash(raw)
      ? raw.toLowerCase()
      : null;
    if (!fingerprintHash) {
      return res.status(400).json({ ok: false, error: 'bad_fingerprint' });
    }
    const record = await touchDevice({
      userId: req.session.user.safeKey,
      fingerprintHash,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    // Session'ga yozamiz — trust flow (C-03 §07) session'dagi deviceFp'ni
    // ishlatadi; aks holda SPA'da trust `no_device` 400 qaytaradi.
    req.session.user.deviceFp = fingerprintHash;
    await logAuthEvent({
      action: AUDIT_ACTIONS.DEVICE_REGISTERED,
      outcome: 'success',
      method: 'device',
      actorId: req.session.user.safeKey,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      // `fingerprint` (hash emas) — redactDetails `hash` so'zini o'chiradi;
      // fingerprint o'zi PII-minimal hash (C-03 §11 test talabi).
      details: { fingerprint: fingerprintHash, firstSeen: record?.first_seen },
    }).catch(() => {});
    // PII-minimal javob: faqat holat (hash'ning o'zi qaytmaydi — §10 privacy)
    return res.json({
      ok: true,
      device: { firstSeen: record?.first_seen ?? null, lastSeen: record?.last_seen ?? null, trusted: record?.trusted === true },
    });
  } catch (_) {
    return res.status(500).json({ ok: false, error: 'server_error' });
  }
});

// AUTH A-28: device/risk status — panel nudge uchun (PII minimal)
// AUTH D-29 §06/§26: client validation rules — contracts.js'dan (single source).
// Public (authsiz) — login/register formasi sahifa ochilishida yuklaydi.
router.get('/api/auth/validation-rules', (req, res) => {
  try {
    const { buildClientRules, RULES_VERSION } = requireValidationRules();
    return res.json({ ok: true, version: RULES_VERSION, forms: buildClientRules() });
  } catch (err) {
    return res.status(500).json({ ok: false, error: 'server_error' });
  }
});

router.get('/api/auth/device/status', requireAuth, (req, res) => {
  res.json({
    ok: true,
    fingerprintHash: req.session.user?.deviceFp ?? null,
    riskTier: req.session.user?.riskTier ?? null,
    riskStepup: req.session.user?.riskStepup === true,
    riskFlagged: req.session.user?.riskFlagged === true,
  });
});

// AUTH A-28 §07: user confirm — qurilmani ishonchli deb belgilash
// (trusted device signal -0.4 — keyingi login'lar seamless).
// requireRecentAuth: parol reauth talab (A-25) — boshqa qurilma o'z
// session'ini trust qila olmasin.
router.post('/api/auth/device/trust', requireAuth, requireRecentAuth, async (req, res) => {
  try {
    const fp = req.session.user?.deviceFp;
    if (!fp) return res.status(400).json({ ok: false, error: 'no_device' });
    const r = await setDeviceTrusted(req.session.user.safeKey, fp, true);
    if (!r.ok) return res.status(400).json({ ok: false, error: r.error });
    req.session.user.riskTier = 'trusted';
    req.session.user.riskStepup = false;
    await audit({
      action: AUDIT_ACTIONS.RISK_DEVICE_TRUST,
      userId: req.session.user.safeKey,
      resourceType: 'device',
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      details: { fingerprintHash: fp },
    }).catch(() => {});
    return res.json({ ok: true });
  } catch (_) {
    return res.status(500).json({ ok: false, error: 'server_error' });
  }
});

// ── AUTH A-25 §09: admin re-auth (teacher approve/reject uchun) ──
router.post('/api/admin/reauth', (req, res) => {
  if (!req.session?.admin) return res.status(401).json({ ok: false, error: 'unauthorized' });
  if (reauthLimited('admin', CONFIG.ADMIN_USER, req.ip)) {
    return res.status(429).json({ ok: false, error: 'rate-limited' });
  }
  const { password } = req.body || {};
  if (typeof password === 'string' && password.length > 0 && password === CONFIG.ADMIN_PASS) {
    req.session.adminReauthedAt = Date.now();
    return res.json({ ok: true });
  }
  return res.status(403).json({ ok: false, error: 'wrong-password' });
});

// ═══════════════════════════════════════════════════════════════
// AUTH A-22 — Parol o'zgartirish (NIST SP 800-63B + HIBP)
// ═══════════════════════════════════════════════════════════════
// 1) Joriy parol verify SHART (OWASP abuse case — sessiya o'g'irlansa ham
//    parolni bilmasdan o'zgartirib bo'lmaydi).
// 2) Reuse: yangi parol eski bilan bir xil bo'lmasin.
// 3) NIST dynamic min (user.twofa_enabled → 8, aks holda 15) + max 128.
// 4) HIBP breach check (k-anonymity).
// 5) Yangi argon2id hash + password_updated_at (eski sessiyalar bekor).
router.post('/api/password/change', requireAuth, requireLowRisk, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    const userKey = req.session.user?.safeKey;

    if (!userKey) return res.status(401).json({ ok: false, error: 'unauthorized' });
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ ok: false, error: 'required' });
    }

    const snap = await fb.get(`users/${userKey}`);
    if (!snap.exists()) return res.status(404).json({ ok: false, error: 'not-found' });
    const userData = snap.val() || {};
    if (!userData.password) return res.status(404).json({ ok: false, error: 'not-found' });

    // 1) Joriy parol verify
    const currentOk = await verifyPassword(currentPassword, userData.password);
    if (!currentOk) {
      audit({
        action: AUDIT_ACTIONS.PASSWORD_CHANGE,
        outcome: 'failed',
        resourceType: 'user',
        details: { reason: 'current-password' },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      }).catch(() => {});
      return res.status(403).json({ ok: false, error: 'current-password' });
    }

    // 2) Reuse: yangi parol eski bilan bir xil bo'lmasin
    if (await verifyPassword(newPassword, userData.password)) {
      return res.status(400).json({ ok: false, error: 'passwordReuse' });
    }

    // 3) NIST siyosat (dynamic min; teacher/admin uchun zxcvbn score >= 4)
    const pol = evaluatePassword(newPassword, {
      mfa: !!userData.twofa_enabled,
      requireStrong: ['teacher', 'admin'].includes(userData.role),
    });
    if (!pol.ok) {
      audit({
        action: AUDIT_ACTIONS.PASSWORD_POLICY_REJECT,
        outcome: 'failed',
        resourceType: 'user',
        details: { reason: pol.reason, score: pol.score },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      }).catch(() => {});
      return res.status(400).json({ ok: false, error: pol.reason });
    }

    // 4) HIBP breach check
    const hibp = await isPasswordBreached(newPassword);
    if (hibp.breached) {
      audit({
        action: AUDIT_ACTIONS.BREACH_PASSWORD_BLOCKED,
        outcome: 'failed',
        resourceType: 'user',
        details: { checked: hibp.checked },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      }).catch(() => {});
      return res.status(400).json({ ok: false, error: 'passwordBreached' });
    }

    // 5) Yangi hash + saqlash
    const hashed = await hashPassword(newPassword);
    await fb.set(`users/${userKey}/password`, hashed);
    await fb.set(`users/${userKey}/password_updated_at`, Date.now());

    // AUTH A-29 §06 + B-25: boshqa barcha sessiyalar revoke (joriydan tashqari)
    // — server-side store destroy (Redis/Memory) + local DB tracking + audit.
    // breach flag tozalanadi (yangi parol endi xavfsiz) + security event.
    try {
      await revokeByUser(userKey, { exceptSessionId: req.sessionID, reason: 'password_change' });
    } catch (_) { /* non-critical */ }
    // Joriy sessiyadagi passwordUpdatedAt yangilanadi — aks holda middleware
    // (invalidateIfStale) parol o'zgarganidan keyin SHU sessiyani ham bekor
    // qilib, foydalanuvchini logout qilardi (A-29 topilmasi).
    if (req.session.user) {
      req.session.user.passwordUpdatedAt = Date.now();
    }
    await clearBreachFlag(userKey).catch(() => {});
    await recordAccountEvent({
      userId: userKey,
      type: ACCOUNT_EVENT_TYPES.PASSWORD_CHANGED,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    }).catch(() => {});
    // Notification: "Parolingiz o'zgartirildi — bu siz bo'lmasangiz support"
    try {
      const q = await queueNewDeviceAlert({
        userId: userKey,
        type: 'password_changed',
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
        bypassDailyCap: true, // security-critical — cap tashlab yubormasin
      });
      if (q.queued && q.alertId) {
        await deliverAlert({ userId: userKey, alertId: q.alertId }).catch(() => {});
      }
    } catch (_) {}

    audit({
      action: AUDIT_ACTIONS.PASSWORD_CHANGE,
      outcome: 'success',
      resourceType: 'user',
      details: {},
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    }).catch(() => {});
    return res.json({ ok: true });
  } catch (err) {
    console.error('Password change error:', err.message);
    return res.status(500).json({ ok: false, error: 'server' });
  }
});

// AUTH A-29: security events feed (PII-minimal — ip_hash/raw UA chiqmaydi)
router.get('/api/account/security-events', requireAuth, async (req, res) => {
  try {
    const events = await getAccountEvents(req.session.user?.safeKey, 20);
    return res.json({ ok: true, events });
  } catch (_) {
    return res.json({ ok: true, events: [] });
  }
});

export default router;
