/**
 * Deborah — "Profilim" (hamma rollar uchun)
 * ---------------------------------------------------------
 * Talab (2026-08-27): bitta "Profilim" bo'limi HAMMA rolga
 * (student/teacher/admin/proctor/marker/board):
 *   - to'liq profil ma'lumotlari
 *   - 12 ta zaxira (backup) kod — ko'rish uchun qayta tasdiqlash
 *     (parol YOKI TOTP kod) SHART (requireRecentAuth ga teng kuch)
 *
 *   GET  /user/profile            — sahifa (requireAuth, barcha rollar)
 *   GET  /api/profile/me          — to'liq profil JSON
 *   POST /api/profile/backup-codes — zaxira kodlarni YANGILASH (rotate)
 *                                    body: { password } yoki { mfaCode }
 *
 * Xavfsizlik:
 *   - backup kodlar DB'da HASH holda saqlanadi — plaintext faqat
 *     rotate javobida BIR marta ko'rsatiladi (mfa-totp.js §09)
 *   - MFA o'chiq bo'lsa zaxira kod mavjud emas → 400 mfa_disabled
 *   - 5 ta noto'g'ri urinish / 15 daqiqa rate limit
 *   - audit: PROFILE_BACKUP_CODES_ROTATE (muvaffaqiyatli/fail)
 */
import crypto from 'node:crypto';
import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { fb } from '../firebase/admin.js';
import { verifyLoginPassword } from '../utils/helpers.js';
import CONFIG from '../src/config/env.js';
import { ADMIN_MFA_ACCOUNT } from '../src/modules/auth/admin-security.js';
import { USER_PAGES, pageLangResolve, PAGE_HTML_LANG } from '../data/user-pages-i18n.js';
import {
  hasActiveMfa,
  getMfaStatus,
  rotateBackupCodes,
  verifyMfaCode,
} from '../src/modules/auth/mfa-totp.js';
import { logAuthEvent } from '../src/modules/auth/audit.js';

const router = Router();

/** User YOKI admin sessiya — admin panel sidebaridagi "Profilim" ham ishlaydi. */
function profileAuth(req, res, next) {
  if (req.session && req.session.admin && !req.session.user) return next();
  return requireAuth(req, res, next);
}

/** Admin (env-kreditual) profili — MFA mfa_totp/admin ostida. */
async function collectAdminProfile(sessionAdmin) {
  const mfa = await getMfaStatus(ADMIN_MFA_ACCOUNT).catch(() => ({ status: 'none' }));
  return {
    username: sessionAdmin.username || 'admin',
    displayName: 'Administrator',
    email: null,
    emailVerified: false,
    role: 'admin',
    authProvider: 'admin',
    avatarUrl: null,
    isVip: false,
    createdAt: null,
    lastLoginAt: null,
    teacherRole: null,
    mfa: {
      status: mfa.status || 'none',
      backupCodesRemaining: typeof mfa.backupCodesRemaining === 'number' ? mfa.backupCodesRemaining : 0,
    },
    hasPassword: true, // env ADMIN_PASS orqali tasdiqlanadi
    isAdminSession: true,
  };
}

/** Foydalanuvchi profilini DB + sessiyadan yig'adi (parol/hash HECH QAYERDA chiqmaydi). */
async function collectProfile(sessionUser) {
  const safeKey = sessionUser.safeKey;
  const snap = await fb.get(`users/${safeKey}`).catch(() => null);
  const db = snap && snap.exists() ? snap.val() : {};
  const mfa = await getMfaStatus(safeKey).catch(() => ({ status: 'none' }));

  return {
    username: db.username || sessionUser.username || '—',
    displayName: db.display_name || sessionUser.displayName || db.username || '—',
    email: db.email || sessionUser.email || null,
    emailVerified: db.email_verified === true,
    role: db.role || sessionUser.role || 'student',
    authProvider: db.auth_provider || sessionUser.authProvider || 'password',
    avatarUrl: db.avatar_url || sessionUser.avatarUrl || null,
    isVip: db.isVip === true || sessionUser.isVip === true,
    createdAt: db.created_at || null,
    lastLoginAt: db.last_login_at || null,
    teacherRole: db.role === 'teacher' || db.role === 'teacher_pending' || db.role === 'teacher_rejected'
      ? db.role : null,
    mfa: {
      status: mfa.status || 'none', // active | pending | none
      backupCodesRemaining: typeof mfa.backupCodesRemaining === 'number' ? mfa.backupCodesRemaining : 0,
    },
    hasPassword: typeof db.password === 'string' && db.password.length > 0,
  };
}

/** Barcha rollar uchun "Profilim" sahifasi (4 til — user settings/lang). */
async function profileLangOf(req) {
  let raw = 'uz';
  try {
    const key = req.session?.user?.safeKey;
    if (key) {
      const langSnap = await fb.get(`users/${key}/settings/lang`);
      if (langSnap.exists() && langSnap.val()) raw = langSnap.val();
    }
  } catch (_) { /* fail-soft → uz */ }
  const l = pageLangResolve(raw);
  return { raw, l, htmlLang: PAGE_HTML_LANG[l] || 'uz' };
}
router.get('/user/profile', profileAuth, async (req, res) => {
  const { l, htmlLang } = await profileLangOf(req);
  const pc = USER_PAGES.profile;
  const pageTitle = (pc.h1[l] || 'Profilim') + ' — Deborah';
  try {
    if (!req.session.user && req.session.admin) {
      const adminProfile = await collectAdminProfile(req.session.admin);
      return res.render('user/profile', {
        title: pageTitle,
        pageTitle,
        pageCopy: pc,
        pageLang: l,
        htmlLang,
        user: { username: adminProfile.username, role: 'admin' },
        profile: adminProfile,
        csrfToken: req.session.csrfToken,
      });
    }
  } catch (err) { /* pastda umumiy yo'l */ }
  try {
    const profile = await collectProfile(req.session.user);
    res.render('user/profile', {
      title: pageTitle,
      pageTitle,
      pageCopy: pc,
      pageLang: l,
      htmlLang,
      user: req.session.user,
      profile,
      csrfToken: req.session.csrfToken,
    });
  } catch (err) {
    console.error('[PROFILE] render error:', err);
    res.status(500).render('error', { title: '500', message: 'Server xatosi', status: 500 });
  }
});

/** To'liq profil JSON (UI dinamik yangilash uchun). */
router.get('/api/profile/me', profileAuth, async (req, res) => {
  try {
    const profile = req.session.user
      ? await collectProfile(req.session.user)
      : await collectAdminProfile(req.session.admin);
    res.json({ ok: true, profile });
  } catch (err) {
    console.error('[PROFILE] me error:', err);
    res.status(500).json({ ok: false, error: 'server' });
  }
});

// ── Zaxira kodlar: rate limit (5 urinish / 15 daqiqa / user) ──
const bcAttempts = new Map(); // safeKey → { n, firstAt }
const BC_MAX = 5;
const BC_WINDOW_MS = 15 * 60 * 1000;
function bcLimited(safeKey) {
  const now = Date.now();
  const e = bcAttempts.get(safeKey);
  if (!e || now - e.firstAt > BC_WINDOW_MS) { bcAttempts.set(safeKey, { n: 1, firstAt: now }); return false; }
  e.n += 1;
  return e.n > BC_MAX;
}
function bcReset(safeKey) { bcAttempts.delete(safeKey); }

/**
 * POST /api/profile/backup-codes — 12 ta YANGI zaxira kod (rotate).
 * Qayta tasdiqlash: FAQAT joriy kirish paroli (Authenticator kodi SO'RALMAYDI —
 * 2026-08-27 qaror). Admin sessiya uchun — admin paroli (env) tekshiriladi.
 */
router.post('/api/profile/backup-codes', profileAuth, async (req, res) => {
  const isAdmin = !req.session.user && !!req.session.admin;
  const actorKey = isAdmin ? ADMIN_MFA_ACCOUNT : req.session.user.safeKey;
  try {
    if (bcLimited(actorKey)) {
      await logAuthEvent({
        action: 'profile.backup_codes_rotate', outcome: 'rate-limited',
        method: 'password', actorId: actorKey, ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      }).catch(() => {});
      return res.status(429).json({ ok: false, error: 'rate_limited', message: 'Juda ko\u2018p urinish — 15 daqiqadan keyin qayta urinib ko\u2018ring' });
    }

    if (!(await hasActiveMfa(actorKey))) {
      return res.status(400).json({
        ok: false, error: 'mfa_disabled',
        message: 'Zaxira kodlar faqat MFA (Authenticator) yoqilganda mavjud. MFA faqat admin va o\u2018qituvchi akkauntlarida.',
      });
    }

    const password = typeof (req.body || {}).password === 'string' ? req.body.password : '';
    if (!password) {
      return res.status(400).json({ ok: false, error: 'password_required', message: 'Joriy kirish parolingizni kiriting.' });
    }

    let verified = false;
    if (isAdmin) {
      // Admin: env ADMIN_PASS (timing-safe)
      try {
        const a = Buffer.from(String(password));
        const b = Buffer.from(String(CONFIG.ADMIN_PASS || ''));
        verified = a.length === b.length && crypto.timingSafeEqual(a, b);
      } catch (_) { verified = false; }
    } else {
      const snap = await fb.get(`users/${req.session.user.safeKey}/password`).catch(() => null);
      if (snap && snap.exists()) {
        // Login bilan bir xil tekshiruv (argon2 + legacy sha256/plaintext +
        // muvaffaqiyatda argon2'ga migratsiya) — eski akkauntlar ham ishlaydi
        const v = await verifyLoginPassword(password, snap.val(), req.session.user.safeKey);
        verified = v.ok;
        if (v.ok && v.migrated && v.newHash) {
          await fb.set(`users/${req.session.user.safeKey}/password`, v.newHash).catch(() => {});
        }
      } else {
        return res.status(400).json({
          ok: false, error: 'no_password',
          message: 'Akkauntga parol o\u2018rnatilmagan — avval Xavfsizlik profilida parol o\u2018rnating (Google akkauntga parol qo\u2018shish).',
        });
      }
    }

    if (!verified) {
      await logAuthEvent({
        action: 'profile.backup_codes_rotate', outcome: 'wrong-credentials',
        method: 'password', actorId: actorKey, ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      }).catch(() => {});
      return res.status(403).json({
        ok: false, error: 'wrong_credentials',
        message: 'Parol xato — joriy kirish parolingizni tekshirib qayta kiriting.',
      });
    }

    bcReset(actorKey);
    const result = await rotateBackupCodes(actorKey);
    await logAuthEvent({
      action: 'profile.backup_codes_rotate', outcome: 'success',
      method: 'password', actorId: actorKey, ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      details: { backupCodeCount: Array.isArray(result.backupCodes) ? result.backupCodes.length : 0 },
    }).catch(() => {});

    return res.json({ ok: true, backupCodes: result.backupCodes });
  } catch (err) {
    console.error('[PROFILE] backup-codes error:', err);
    bcReset(actorKey);
    return res.status(500).json({ ok: false, error: 'server' });
  }
});

export default router;
