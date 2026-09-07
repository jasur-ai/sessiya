/**
 * Deborah — Role Workspace Routes (Prompt 68)
 *
 * teacher / student / proctor / marker / board scoped screens in the shared
 * role-aware shell. Security:
 *   - requireRole() — HTML ruxsatsiz → stealth 404, API → 403 JSON.
 *   - UI nav faqat ko'rinishni boshqaradi; har API write path server-side
 *     guard'larga ega (authorization.js ABAC, tenant scope).
 *   - Secret DTO (parol xesh, token) view'larga yuborilmaydi.
 *
 * I18N (S34h): role sahifalari sidebar/nav uchun user settings lang'ini
 * (uz / uz-cyrl / ru / en) resolve qiladi; /student esa to'liq 4 tilda.
 */

import { Router } from 'express';
import { requireRole, ROLE_NAV, can } from '../middleware/roles.js';
import { fb } from '../firebase/admin.js';
import { htmlLangOf } from '../data/panel-i18n.js';
import { USER_PAGES, pageLangResolve, PAGE_HTML_LANG } from '../data/user-pages-i18n.js';

const router = Router();

/** User settings'dagi tilni o'qib, rol sahifasi kontekstini yig'adi. */
async function langCtx(req) {
  const { resolveAuthLang, AUTH_COPY } = await import('../data/auth-i18n.js');
  let raw = 'uz';
  try {
    const k = req.session?.user?.safeKey;
    if (k) {
      const snap = await fb.get(`users/${k}/settings/lang`);
      if (snap.exists() && snap.val()) raw = snap.val();
    }
  } catch (_) { /* fail-soft → uz */ }
  const authLang = resolveAuthLang(raw);
  const pLang = pageLangResolve(raw);
  return {
    langRaw: raw,
    lang: authLang,          // auth copy tili
    pageLang: pLang,         // page copy tili
    htmlLang: PAGE_HTML_LANG[pLang] || htmlLangOf(pLang),
    fullCopy: AUTH_COPY[authLang] || AUTH_COPY.uz,
    copy: {
      sidebar: (AUTH_COPY[authLang] || AUTH_COPY.uz).sidebar,
      header: (AUTH_COPY[authLang] || AUTH_COPY.uz).header,
    },
    // ROLE_NAV label'larini tilga moslash — joriy til bo'yicha YASSI dict
    navCopy: Object.fromEntries(Object.entries(USER_PAGES.nav).map(([k, v]) => [k, v[pLang] || v.uz || ''])),
    navLang: pLang,
  };
}

/** EJS'ga rol kontekstini uzatish (hech qanday secret DTO yo'q). */
function roleLocals(role, active, extra = {}) {
  return {
    role,
    // roleLabel: sidebar AUTH copy bo'yicha tarjima qiladi (ru/en/uz-cyrl)
    navItems: ROLE_NAV[role] || ROLE_NAV.default,
    active, // sidebar uchun: workspace path (masalan '/teacher')
    title: extra.title,
    ...extra,
  };
}

// ── Teacher Workspace (Overview / Courses / Assessments / Grading / Muhitlarim) ──
// S22 matritsa: monitoring = FAQAT o'zi yaratgan muhitlar; tayyor mock/subtest
// kutubxonasi teacher'ga ko'rinmaydi (imtihon tayyorlash maxsadi bilan).
router.get('/teacher', requireRole('teacher'), async (req, res) => {
  const role = 'teacher';
  const tab = req.query.tab || 'overview';
  const canOverride = can(role, 'grade:override');
  const canPublish = can(role, 'test:publish');
  const username = req.session?.user?.username || '';
  const safeKey = req.session?.user?.safeKey || '';
  const ctx = await langCtx(req);

  // Real ma'lumotlar: o'z testlari + o'zi host qilgan Cast sessiyalari + mashq tarixi
  let myTests = [];
  let mySessions = [];
  let practiceCount = 0;
  try {
    const [testsSnap, sessionsSnap, histSnap] = await Promise.all([
      fb.get(`users/${safeKey}/tests`),
      fb.get('game_sessions'),
      fb.get(`users/${safeKey}/practice_history`),
    ]);
    if (testsSnap.exists()) {
      myTests = Object.entries(testsSnap.val() || {})
        .map(([key, v]) => ({ key, name: v?.name || key, count: v?.questions?.length || 0, createdAt: v?.created_at || v?.created || 0, isPublic: !!v?.isPublic }))
        .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
        .slice(0, 50);
    }
    if (sessionsSnap.exists()) {
      mySessions = Object.entries(sessionsSnap.val() || {})
        .filter(([, v]) => v && typeof v.host === 'string' && v.host === username)
        .map(([code, v]) => ({
          code,
          testName: v.test_name || 'Test',
          players: Object.keys(v.players || {}).length,
          status: v?.state?.status || 'waiting',
          createdAt: v.created_at || 0,
        }))
        .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
        .slice(0, 30);
    }
    if (histSnap.exists()) practiceCount = Object.keys(histSnap.val() || {}).length;
  } catch (_) { /* fb yo'q — bo'sh ko'rsatamiz */ }

  res.render('role/teacher', roleLocals(role, '/teacher', {
    title: "O'qituvchi ish maydoni",
    tab,
    canOverride,
    canPublish,
    username,
    myTests,
    mySessions,
    practiceCount,
    ...ctx,
  }));
});

// ── Student Workspace (assignments / portfolio — Kalendar olib tashlangan, 09/2026) ──
router.get('/student', requireRole('student'), async (req, res) => {
  const role = 'student';
  const ctx = await langCtx(req);
  const sc = USER_PAGES.student;
  res.render('role/student', roleLocals(role, '/student', {
    title: (sc.h1[ctx.pageLang] || 'Talaba ish maydoni') + ' — Deborah',
    canAttempt: can(role, 'attempt:create'),
    canReadResult: can(role, 'result:read'),
    username: req.session?.user?.username || '',
    pageCopy: sc,
    ...ctx,
  }));
});

// ── Proctor Workspace (Live monitoring) ──
router.get('/proctor', requireRole('proctor'), async (req, res) => {
  const role = 'proctor';
  const ctx = await langCtx(req);
  res.render('role/proctor', roleLocals(role, '/proctor', {
    title: 'Proktor — jonli monitoring',
    canPause: can(role, 'attempt:pause'),
    canTerminate: can(role, 'attempt:terminate'),
    username: req.session?.user?.username || '',
    ...ctx,
  }));
});

// ── Marker Workspace (Grading queue) ──
router.get('/marker', requireRole('marker'), async (req, res) => {
  const role = 'marker';
  const ctx = await langCtx(req);
  res.render('role/marker', roleLocals(role, '/marker', {
    title: 'Baholovchi — grading queue',
    canScore: can(role, 'grade:score'),
    username: req.session?.user?.username || '',
    ...ctx,
  }));
});

// ── Board Workspace (Ratification) ──
router.get('/board', requireRole('board'), async (req, res) => {
  const role = 'board';
  const ctx = await langCtx(req);
  res.render('role/board', roleLocals(role, '/board', {
    title: "Hay'at — ratifikatsiya",
    canRatify: can(role, 'result:ratify'),
    username: req.session?.user?.username || '',
    ...ctx,
  }));
});

export default router;
