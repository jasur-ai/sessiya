/**
 * Deborah — User Panel Routes
 * Test CRUD, search, quiz taking, mock tests, PRE tests
 */

import { Router } from 'express';
import { fb } from '../firebase/admin.js';
import { requireAuth } from '../middleware/auth.js';
import { requireVip, isCurrentUserVip } from '../middleware/vip.js';
import { DB_PATHS, GAME_SETTINGS, CARTOON_CHARS } from '../utils/constants.js';
import { normalizeQuestion } from '../utils/helpers.js';
// AUTH B-01: users final schema — /api/me DTO (public/private, PII minimal).
import { toPrivateUser, normalizeUserRecord } from '../src/modules/auth/user-schema.js';
import { getStudentAssignments } from '../src/modules/preflight/index.js';
// AUTH B-16 §12: rejected teacher cooldown — qayta ariza oynasi
import { TEACHER_COOLDOWN_MS } from '../src/modules/auth/teacher-approval.js';
// Panel/workspace i18n (uz / uz-cyrl / ru / en) + practice copy
import { PANEL_COPY, resolvePanelLang, htmlLangOf, localeOf } from '../data/panel-i18n.js';
import { builderCopyFor } from '../data/test-builder-i18n.js';
import { practiceCopyFor } from '../data/practice-i18n.js';

const router = Router();

// → All routes require auth
router.use(requireAuth);

// ── AUTH B-01: /api/me — o'z profilini private DTO orqali qaytaradi.
// password/google_sub/telegram_id/ip-hash/mfa secret HECH QACHON chiqmaydi
// (user-schema.js SECRET_KEYS — guide §12, §28).
router.get('/api/me', async (req, res) => {
  const userKey = req.session.user?.safeKey;
  if (!userKey) {
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  }
  const snap = await fb.get(`users/${userKey}`);
  if (!snap.exists()) {
    return res.status(404).json({ ok: false, error: 'not_found' });
  }
  const record = normalizeUserRecord(snap.val());
  return res.json({ ok: true, user: toPrivateUser(record, { key: userKey }) });
});

// ── AUTH A-19: Teacher approval status sahifasi ──
// Faqat teacher_pending/teacher_rejected rollariga ko'rinadi; boshqa rollar
// stealth 404 (sahifa "yo'q" ko'rinadi). Approval holati DB'dan o'qiladi —
// sessiya eskirgan bo'lsa ham to'g'ri holat ko'rsatiladi.
router.get('/teacher-approval', async (req, res) => {
  const user = req.session.user;
  const role = user?.role;
  if (role !== 'teacher_pending' && role !== 'teacher_rejected') {
    return res.status(404).render('error', {
      title: '404 — Sahifa topilmadi',
      message: "So'ralgan sahifa mavjud emas",
      status: 404,
    });
  }
  try {
    const [roleSnap, versionSnap, reasonSnap, notifSnap, cooldownSnap, decidedSnap] = await Promise.all([
      fb.get(`users/${user.safeKey}/role`),
      fb.get(`users/${user.safeKey}/role_version`),
      fb.get(`users/${user.safeKey}/teacher_rejection_reason`),
      fb.get(`users/${user.safeKey}/notification_last`),
      fb.get(`users/${user.safeKey}/teacher_cooldown_until`),
      fb.get(`users/${user.safeKey}/teacher_decision_at`),
    ]);
    const currentRole = roleSnap.exists() ? roleSnap.val() : role;
    // Admin tasdiqlagan bo'lsa — sessiya eskisini saqlasa ham teacher bo'lib
    // kirishi mumkin. DB'dagi haqiqiy role_version o'qiladi (AUTH A-02
    // invalidateIfStale bilan mos kelishi uchun — ixtiyoriy Date.now() EMAS).
    if (currentRole === 'teacher') {
      const dbVersion = versionSnap.exists() ? versionSnap.val() : Date.now();
      user.role = 'teacher';
      user.roleVersion = dbVersion;
      return res.redirect('/teacher');
    }
    const rejectionReason = reasonSnap.exists() ? reasonSnap.val() : '';
    const notification = notifSnap.exists() ? notifSnap.val() : null;
    // AUTH B-16 §12: cooldown holati — qayta ariza faqat cooldown o'tgach
    const cooldownUntil = cooldownSnap.exists() ? cooldownSnap.val() : 0;
    const decidedAt = decidedSnap.exists() ? decidedSnap.val() : 0;
    let cooldown = { active: false, remainingMs: 0, until: 0 };
    if (cooldownUntil || decidedAt) {
      const until = cooldownUntil || decidedAt + TEACHER_COOLDOWN_MS;
      const remainingMs = until - Date.now();
      cooldown = {
        active: remainingMs > 0,
        remainingMs: Math.max(0, remainingMs),
        until,
        days: Math.max(1, Math.ceil(Math.max(0, remainingMs) / 86400000)),
      };
    }
    // AUTH A-19 §19: 4 til — user settings'dagi lang (default uz)
    const { resolveAuthLang, AUTH_COPY } = await import('../data/auth-i18n.js');
    let lang = 'uz';
    try {
      const settingsSnap = await fb.get(`users/${user.safeKey}/settings/lang`);
      if (settingsSnap.exists() && settingsSnap.val()) lang = settingsSnap.val();
    } catch (_) {}
    const l = resolveAuthLang(lang);
    const copy = AUTH_COPY[l];
    res.render('user/teacher-approval', {
      title: currentRole === 'teacher_rejected' ? copy.teacherApproval.rejectedTitle : copy.teacherApproval.pendingTitle,
      status: currentRole, // 'teacher_pending' | 'teacher_rejected'
      rejectionReason,
      notification,
      username: user.username || user.safeKey,
      lang: l,
      copy: copy.teacherApproval,
      fullCopy: copy, // S14 (BUG-087): sidebar copy.sidebar uchun
      cooldown,
      // AUTH B-36 §12: apellyatsiya yuborilgach tasdiq banneri
      appealSent: req.query.appeal === '1',
      csrfToken: req.session?.csrfToken || '',
    });
  } catch (err) {
    console.error('Teacher approval page error:', err);
    res.status(500).render('error', { title: '500', message: 'Server xatosi', status: 500 });
  }
});

// ── AUTH A-19 §14: pending/rejected teacher — test yaratish, panel,
// student data blok. Faqat /teacher-approval status sahifasi ochiq.
router.use((req, res, next) => {
  const role = req.session?.user?.role;
  if (role === 'teacher_pending' || role === 'teacher_rejected') {
    const isApi = req.originalUrl?.startsWith('/api/') || req.path?.startsWith('/api/');
    if (isApi || req.xhr || req.accepts('json')) {
      return res.status(403).json({ error: 'Ruxsat etilmagan rol' });
    }
    return res.status(404).render('error', {
      title: '404 — Sahifa topilmadi',
      message: "So'ralgan sahifa mavjud emas",
      status: 404,
    });
  }
  next();
});

// ── User Panel ──
router.get('/panel', async (req, res) => {
  const user = req.session.user;
  try {
    // VIP stealth (user qarori 09/2026): panel'da VIP izlari YO'Q — mock/pre
    // to'plamlar bloki butunlay olib tashlangan (ko'rinmaydi, yuklanmaydi).
    const isVip = await isCurrentUserVip(req);
    const testsSnap = await fb.get(`users/${user.safeKey}/tests`);
    const tests = testsSnap.val() || {};

    // AUTH A-28: risk banner copy — user settings'dagi lang (default uz)
    const { resolveAuthLang, AUTH_COPY } = await import('../data/auth-i18n.js');
    let plang = 'uz';
    try {
      const langSnap = await fb.get(`users/${user.safeKey}/settings/lang`);
      if (langSnap.exists() && langSnap.val()) plang = langSnap.val();
    } catch (_) {}
    const riskCopy = AUTH_COPY[resolveAuthLang(plang)]?.risk || {};
    const accountCopy = AUTH_COPY[resolveAuthLang(plang)]?.account || {};
    // AUTH B-06: verify modal/banner copy (4 til)
    const verifyCopy = AUTH_COPY[resolveAuthLang(plang)]?.verify || {};

    // AUTH A-29: breach flag — panel banneri "Parolingiz breach'da"
    let breachFlagged = null;
    try {
      const { getBreachFlag } = await import('../src/modules/auth/account-events.js');
      breachFlagged = await getBreachFlag(user.safeKey);
    } catch (_) {}

    // AUTH D-25 §12: re-consent banner — privacy policy yangilansa/berilmagan bo'lsa
    let consentStale = false;
    try {
      const { hasCurrentConsent } = await import('../src/modules/legal/consent.js');
      consentStale = !(await hasCurrentConsent(user.safeKey));
    } catch (_) { /* fail-soft — banner ko'rsatilmaydi */ }

    const _panelCopy = AUTH_COPY[resolveAuthLang(plang)];

    // Panel i18n: 4 til (uz / uz-cyrl / ru / en) — resolve qilingan kod server
    // tomonidan EJS'ga va client dict (window.__PANEL_COPY) sifatida beriladi.
    const plangResolved = resolvePanelLang(plang);
    const panelCopy = PANEL_COPY[plangResolved] || PANEL_COPY.uz;

    res.render('user/panel', {
      title: (panelCopy['ws.title'] || 'Ish maydonim') + ' — Deborah',
      active: 'panel',
      panelLang: plangResolved,
      panelLangRaw: plang,
      htmlLang: htmlLangOf(plangResolved),
      localeCode: localeOf(plangResolved),
      panelCopy,
      panelCopyAll: PANEL_COPY,
      // S34h (BUG fix): sidebar RU/EN/ЎЗК lug'ati — oldin berilmagan, sidebar doim uz fallback'da qolardi
      fullCopy: _panelCopy,
      copy: { sidebar: _panelCopy.sidebar, header: _panelCopy.header },
      // AUTH A-18: limited mode banner — email verify'siz summative blok
      emailVerified: user.emailVerified === true,
      userEmail: user.email || null,
      csrfToken: req.session.csrfToken,
      riskCopy,
      accountCopy,
      verifyCopy,
      breachFlagged,
      consentStale,
      tests: Object.entries(tests)
        .sort((a, b) => (b[1].created_at || b[1].created || 0) - (a[1].created_at || a[1].created || 0))
        .map(([key, t]) => ({
          key,
          name: t.name || t.title || 'Testsiz',
          count: t.questions?.length || t.count || 0,
          createdAt: t.created_at || t.created || 0,
          updatedAt: t.updated_at || t.created_at || t.created || 0,
          isPublic: !!t.isPublic,
          archived: !!t.archived,
          subject: t.subject || t.tag || null,
          type: t.type || (Array.isArray(t.questions) && t.questions.length && t.questions.every(q => Array.isArray(q.options)) ? 'variant' : null),
          lastUse: t.lastUsedAt || t.last_used_at || 0,
        })),
      fmtDate: (ts) => new Date(ts || Date.now()).toLocaleDateString(localeOf(plangResolved)),
      username: user.username,
    });
    // Update session with fresh isVip value
    req.session.user.isVip = isVip;
  } catch (err) {
    console.error('User panel error:', err);
    res.render('user/panel', {
      title: 'Ish maydonim — Deborah',
      active: 'panel',
      panelLang: 'uz',
      panelLangRaw: 'uz',
      htmlLang: 'uz',
      localeCode: 'uz-UZ',
      panelCopy: PANEL_COPY.uz,
      panelCopyAll: PANEL_COPY,
      fullCopy: AUTH_COPY.uz,
      copy: { sidebar: AUTH_COPY.uz.sidebar, header: AUTH_COPY.uz.header },
      tests: [],
      username: user.username,
      isVip: false,
      error: err.message,
      riskCopy: {},
    });
  }
});

// ── Student Assignments (Prompt 28) ──
router.get('/assignments', async (req, res) => {
  const user = req.session.user;
  let assignments = [];
  try {
    const userId = user?.id || null;
    if (userId) {
      assignments = await getStudentAssignments(userId);
    }
  } catch (err) {
    console.error('Student assignments error:', err.message);
  }
  res.render('user/assignments', {
    title: 'Mening Assessmentlarim',
    assignments,
    username: user?.username || '',
  });
});

// ── Create Test Page ──
router.get('/create-test', async (req, res) => {
  // S15 BUG-093: ?edit kaliti ham traversal kelishi mumkin edi (boshqa userning
  // maxfiy testini edit sahifasida o'qib olish). Whitelist.
  const editKey = req.query.edit ? safeTestKey(req.query.edit) : null;
  if (req.query.edit && !editKey) {
    return res.status(400).render('error', { title: '400 — Yaroqsiz so\u2018rov', message: 'Noto\u2018g\u2018ri test kaliti', status: 400 });
  }
  let testData = null;

  if (editKey) {
    try {
      const snap = await fb.get(`users/${req.session.user.safeKey}/tests/${editKey}`);
      if (snap.exists()) testData = snap.val();
    } catch (_) {}
  }

  // S34m: create-test 4 til (uz/uz-cyrl/ru/en) — foydalanuvchi settings/lang asosida
  // Dublikat diktant yo'q: lug'at data/test-builder-i18n.js (server + client bir manba).
  let bRaw = 'uz';
  try {
    const ls = await fb.get(`users/${req.session.user.safeKey}/settings/lang`);
    if (ls.exists() && ls.val()) bRaw = ls.val();
  } catch (_) {}
  const bLang = resolvePanelLang(bRaw);
  const bc = builderCopyFor(bLang);

  res.render('user/create-test', {
    title: (editKey ? bc.titleEdit : bc.title) + ' — Deborah',
    editKey,
    testData,
    isEdit: !!editKey,
    bc, // S34m: create-test 4 til copy (data/test-builder-i18n.js)
    bLang,
    htmlLang: htmlLangOf(bLang),
  });
});

// ── S15 BUG-093: test kaliti whitelist — path traversal/IDOR himoyasi ──
// fb.set/get lokal implementatsiya '..' segmentlarini resolve QILADI:
// editKey='../../users/VICTIM/tests/x' boshqa userning testini yozib olardi
// (yoki butun user yozuvini bosib o'tish). Barcha test endpointlarida majburiy.
const TEST_KEY_RE = /^[A-Za-z0-9_-]{1,64}$/;
function safeTestKey(key) {
  return (typeof key === 'string' && TEST_KEY_RE.test(key)) ? key : null;
}

// ── Save Test ──
router.post('/api/tests/save', async (req, res) => {
  try {
    const { name, questions, editKey } = req.body;
    const user = req.session.user;
    // S34m: aniq xabar — "Invalid data" emas, aynan nima yetishmayotganini aytish
    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: 'Test nomini kiriting — testga nom qoying', field: 'name' });
    }
    if (!Array.isArray(questions) || !questions.length) {
      return res.status(400).json({ error: "Kamida 1 ta savol qo'shing — bo'sh test saqlanmaydi", field: 'questions' });
    }
    // BUG-014 + S15 BUG-093/095/096: server-side input bounds + kalit whitelist
    if (String(name).trim().length > 300 || questions.length > 300) {
      return res.status(400).json({ error: 'Test juda katta (nom ≤300 belgi, ≤300 savol)' });
    }
    // BUG-093: editKey traversal — boshqa user yozuvlarini bosib olishni bloklash
    const validEditKey = editKey ? safeTestKey(editKey) : null;
    if (editKey && !validEditKey) {
      return res.status(400).json({ error: 'Yaroqsiz test kaliti' });
    }
    for (const q of questions) {
      if (String(q?.text || '').length > 2000) return res.status(400).json({ error: 'Savol matni ≤2000 belgi' });
      if (Array.isArray(q?.options) && q.options.length > 12) return res.status(400).json({ error: 'Har savolda ≤12 variant' });
      // BUG-096: variant matni/explanation/tags chegarasi (BUG-014 to'liqmagan edi)
      if (Array.isArray(q?.options) && q.options.some((o2) => String(o2 || '').length > 500)) {
        return res.status(400).json({ error: 'Variant matni ≤500 belgi' });
      }
      if (String(q?.explanation || '').length > 2000) return res.status(400).json({ error: 'Izoh ≤2000 belgi' });
      if (Array.isArray(q?.tags) && (q.tags.length > 10 || q.tags.some((x) => String(x || '').length > 60))) {
        return res.status(400).json({ error: 'Teglar: ≤10 ta, har biri ≤60 belgi' });
      }
    }

    const testKey = validEditKey || Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

    // Preserve isPublic + created_at when editing (bitta get, ikkita maydon)
    // S15 BUG-097: `archived` HAM saqlansin — tahrirlangan arxiv testi jim yo'qolardi;
    // updated_at qo'shildi (duplicate/archive yozadi, save yozmasdi — 'Eng yangi' sorti chiriydi)
    let isPublic = false;
    let wasArchived = false;
    let createdAt = Date.now();
    if (validEditKey) {
      try {
        const existing = await fb.get(`users/${user.safeKey}/tests/${validEditKey}`);
        if (existing.exists()) {
          isPublic = !!existing.val().isPublic;
          wasArchived = !!existing.val().archived;
          createdAt = existing.val().created_at || createdAt;
        }
      } catch (_) {}
    }

    const testData = {
      name: name.trim(),
      questions: questions.map(q => ({
        text: q.text || '',
        options: (q.options || []).map(o => String(o || '')),
        // BUG-095: correct indeks int + [0..options-1] oralig'ida (999/-1/1.5 kelib qolmasin)
        correct: Math.max(0, Math.min(
          Number.isFinite(+q?.correct) ? Math.floor(+q.correct) : 0,
          Math.max(0, (q.options || []).length - 1),
        )),
        // S27: Test Builder draft maydonlari
        type: ['single_choice', 'true_false', 'multiple_select', 'short_answer', 'exit_ticket'].includes(q.type) ? q.type : 'single_choice',
        explanation: typeof q.explanation === 'string' ? q.explanation : '',
        tags: Array.isArray(q.tags) ? q.tags.map(t => String(t)).filter(Boolean) : [],
        timing: Math.max(0, Math.min(600, parseInt(q.timing, 10) || 0)),
      })),
      count: questions.length,
      created_at: createdAt,
      updated_at: Date.now(), // S15 BUG-097
      archived: wasArchived, // S15 BUG-097: edit arxivlangan testni qayta tiriltirmasin
      isPublic, // Preserved from existing test, default false
    };

    await fb.set(`users/${user.safeKey}/tests/${testKey}`, testData);

    // Sync public_tests on edit (name/count may have changed)
    if (isPublic) {
      await fb.update(`public_tests/${user.safeKey}__${testKey}`, {
        name: name.trim(),
        count: questions.length,
      });
    }

    res.json({ success: true, key: testKey });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Delete Test ──
router.post('/api/tests/delete', async (req, res) => {
  try {
    const userKey = req.session.user.safeKey;
    const testKey = safeTestKey(req.body.key); // S15 BUG-093
    if (!testKey) return res.status(400).json({ error: 'Yaroqsiz test kaliti' });
    
    // Remove from public_tests if was public
    const snap = await fb.get(`users/${userKey}/tests/${testKey}`);
    if (snap.exists() && snap.val().isPublic) {
      await fb.remove(`public_tests/${userKey}__${testKey}`);
    }
    
    await fb.remove(`users/${userKey}/tests/${testKey}`);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Duplicate Test (S26.03 overflow) ──
router.post('/api/tests/duplicate', async (req, res) => {
  try {
    const userKey = req.session.user.safeKey;
    const key = safeTestKey(req.body.key); // S15 BUG-093
    if (!key) return res.status(400).json({ error: 'Yaroqsiz test kaliti' });

    const snap = await fb.get(`users/${userKey}/tests/${key}`);
    if (!snap.exists()) return res.status(404).json({ error: 'Test topilmadi' });

    const src = snap.val();
    // Kolliziya ehtimolini kamaytirish: timestamp + random suffix
    const newKey = `t_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    await fb.set(`users/${userKey}/tests/${newKey}`, {
      ...src,
      name: `${src.name || 'Test'} (nusxa)`,
      created_at: Date.now(),
      updated_at: Date.now(),
      isPublic: false,
      archived: false,
      copiedFrom: key,
    });
    res.json({ success: true, key: newKey });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Archive / Restore Test (S26.03 overflow) ──
router.post('/api/tests/archive', async (req, res) => {
  try {
    const { archived } = req.body;
    const key = safeTestKey(req.body.key); // S15 BUG-093
    if (!key) return res.status(400).json({ error: 'Yaroqsiz test kaliti' });

    const snap = await fb.get(`users/${req.session.user.safeKey}/tests/${key}`);
    if (!snap.exists()) return res.status(404).json({ error: 'Test topilmadi' });

    await fb.update(`users/${req.session.user.safeKey}/tests/${key}`, {
      archived: !!archived,
      updated_at: Date.now(),
    });
    res.json({ success: true, archived: !!archived });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Export Test as JSON (S26.03 overflow) ──
router.get('/api/tests/export', async (req, res) => {
  try {
    const key = safeTestKey(req.query.key); // S15 BUG-093
    if (!key) return res.status(400).json({ error: 'Yaroqsiz test kaliti' });
    const snap = await fb.get(`users/${req.session.user.safeKey}/tests/${key}`);
    if (!snap.exists()) return res.status(404).json({ error: 'Test topilmadi' });
    const name = (snap.val().name || 'test').replace(/[^\w\-]+/g, '_').slice(0, 40);
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="deborah-test-${name}.json"`);
    res.send(JSON.stringify({ exportedAt: Date.now(), test: snap.val() }, null, 2));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Rename Test ──
router.post('/api/tests/rename', async (req, res) => {
  try {
    const { name } = req.body;
    const key = safeTestKey(req.body.key); // S15 BUG-093
    // S15 BUG-094: uzunlik chegarasi yo'q edi (5 000 belgi qabul qilinardi) +
    // mavjudlik tekshiruvi yo'q — ghost 'faqat nom' yozuvlar yaratilardi
    if (!key) return res.status(400).json({ error: 'Yaroqsiz test kaliti' });
    if (!name?.trim()) return res.status(400).json({ error: 'Name required' });
    if (name.trim().length > 300) return res.status(400).json({ error: 'Nom ≤300 belgi' });
    const snap = await fb.get(`users/${req.session.user.safeKey}/tests/${key}`);
    if (!snap.exists()) return res.status(404).json({ error: 'Test topilmadi' });
    await fb.update(`users/${req.session.user.safeKey}/tests/${key}`, { name: name.trim(), updated_at: Date.now() });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Toggle Test Public/Private ──
router.post('/api/tests/toggle-public', async (req, res) => {
  try {
    const key = safeTestKey(req.body.key); // S15 BUG-093
    if (!key) return res.status(400).json({ error: 'Yaroqsiz test kaliti' });

    const userKey = req.session.user.safeKey;
    const snap = await fb.get(`users/${userKey}/tests/${key}`);
    if (!snap.exists()) return res.status(404).json({ error: 'Test topilmadi' });
    
    const test = snap.val();
    const newVal = !test.isPublic;
    const globalKey = `${userKey}__${key}`;
    
    await fb.update(`users/${userKey}/tests/${key}`, { isPublic: newVal });
    
    // Sync public_tests collection
    if (newVal) {
      await fb.set(`public_tests/${globalKey}`, {
        name: test.name || 'Test',
        authorName: req.session.user.username || userKey,
        authorUid: userKey,
        testKey: key,
        count: test.questions?.length || test.count || 0,
        created: Date.now(),
      });
    } else {
      await fb.remove(`public_tests/${globalKey}`);
    }
    
    res.json({ success: true, isPublic: newVal });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Take Quiz / Arena (split-screen view) ──
router.get('/test-arena', (req, res) => {
  const { source, key } = req.query;
  res.render('user/test-arena', {
    title: 'Deborah — Test Arena',
    characters: CARTOON_CHARS,
    initialCode: '',
    autoLoad: false,
    source: source || '',
    testKey: key || '',
  });
});

// ── Search tests ──
// 🔥 Uses public_tests collection for fast search (no full user scan)
// + current user's own tests
router.get('/api/tests/search', async (req, res) => {
  try {
    // S35.05: Uzbek apostrophe variantlari (o' / o‘ / oʼ / o` ) canonical U+02BB ga
    // keltiriladi — qidiruv matnida ham, test nomida ham. Display asl saqlanadi.
    const canon = (s) => String(s || '').replace(/[\u02BB\u02BC\u2018\u2019\u2032`']/g, '\u02BB').toLowerCase().trim();
    const query = canon(req.query.q);
    if (!query) return res.json({ results: [] });

    const currentUser = req.session?.user?.safeKey || '';
    const results = [];
    const seenKeys = new Set();

    // S22 matritsa: ommaviy kutubxona faqat VIP — oddiy user faqat o'z testlarini ko'radi
    const vipForSearch = await isCurrentUserVip(req);
    // 1️⃣ Search public_tests collection (fast, indexed)
    try {
      const pubSnap = vipForSearch ? await fb.get('public_tests') : null;
      if (pubSnap.exists()) {
        const pubTests = pubSnap.val();
        for (const [globalKey, pub] of Object.entries(pubTests)) {
          const testName = canon(pub.name);
          if (!testName.includes(query)) continue;
          
          results.push({
            userName: pub.authorName || pub.authorUid || 'Noma\'lum',
            testName: pub.name || 'Test',
            testKey: pub.testKey,
            count: pub.count || 0,
          });
          seenKeys.add(globalKey);
        }
      }
    } catch (_) {}

    // 2️⃣ Also search current user's own tests (in case not public)
    if (currentUser) {
      try {
        const mySnap = await fb.get(`users/${currentUser}/tests`);
        if (mySnap.exists()) {
          const myTests = mySnap.val();
          for (const [testKey, test] of Object.entries(myTests)) {
            const testName = canon(test.name);
            if (!testName.includes(query)) continue;
            
            const globalKey = `${currentUser}__${testKey}`;
            // Skip if already in results from public_tests
            if (seenKeys.has(globalKey)) continue;
            
            results.push({
              userName: req.session.user.username || currentUser,
              testName: test.name || 'Test',
              testKey,
              count: test.questions?.length || test.count || 0,
            });
          }
        }
      } catch (_) {}
    }

    res.json({ results: results.slice(0, 30) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function normalizeMockQuestions(questions) {
  return (questions || []).map(q => {
    const opts = q.options || [];
    const strings = opts.map(o => o.text || '');
    const correctIdx = opts.findIndex(o => o.isCorrect);
    return {
      text: q.text || '',
      options: strings,
      correct: correctIdx >= 0 ? correctIdx : 0,
      is_double: false,
    };
  }).filter(Boolean);
}

// ── AUTH D-09 §07: Settings sahifasi (Profil / Xavfsizlik / Maxfiylik / Bildirishnomalar) ──
// 4 til copy: AUTH_COPY[lang].settings (ps D-09 qismi — data/auth-i18n.js).
// Server-authoritative: hamma ma'lumot req.session.user dan; client body userKey qabul qilmaydi (IDOR yo'q).
router.get('/settings', async (req, res) => {
  const user = req.session.user;
  try {
    const { resolveAuthLang, AUTH_COPY } = await import('../data/auth-i18n.js');
    let lang = 'uz';
    const langSnap = await fb.get(`users/${user.safeKey}/settings/lang`);
    if (langSnap.exists() && langSnap.val()) lang = langSnap.val();
    const resolvedLang = resolveAuthLang(lang);

    // Profil uchun joriy qiymatlar (PII minimal — faqat o'z profili)
    const [nameSnap, themeSnap] = await Promise.all([
      fb.get(`users/${user.safeKey}/name`),
      fb.get(`users/${user.safeKey}/settings/theme`),
    ]);

    // AUTH D-25 §10: consent listesi (settings UI) + joriy versiya roziligi
    let consents = null;
    let consentCurrent = false;
    try {
      const { listConsents, hasCurrentConsent, CONSENT_VERSION } = await import('../src/modules/legal/consent.js');
      [consents, consentCurrent] = await Promise.all([
        listConsents(user.safeKey),
        hasCurrentConsent(user.safeKey),
      ]);
      res.locals.consentVersion = CONSENT_VERSION;
    } catch (_) { /* fail-soft — UI konsent holda render bo'ladi */ }

    res.render('user/settings', {
      title: AUTH_COPY[resolvedLang]?.settings?.title || 'Sozlamalar',
      lang: resolvedLang, // S14 (BUG-087): html lang to'g'ri bo'lsin
      active: 'settings',
      user: req.session.user,
      csrfToken: req.session.csrfToken,
      profile: {
        name: nameSnap.exists() ? nameSnap.val() : (user.name || ''),
        lang: resolvedLang,
        theme: themeSnap.exists() ? themeSnap.val() : 'light',
        email: user.email || null,
        emailVerified: user.emailVerified === true,
      },
      // D-09: ps i18n bloki (`settings` kaliti) — hali yo'q bo'lsa fallback {} (render buzilmaydi)
      settingsCopy: AUTH_COPY[resolvedLang]?.settings || {},
      accountCopy: AUTH_COPY[resolvedLang]?.account || {},
      copy: AUTH_COPY[resolvedLang] || AUTH_COPY.uz, // S14 (BUG-087): sidebar 4 til
      // AUTH D-25: consent holati (settings UI) — {purpose: {granted,version,grantedAt,revokedAt}}
      consents: consents || {},
      consentCurrent,
      consentVersion: res.locals.consentVersion || '1.0.0',
    });
  } catch (err) {
    res.status(500).render('user/settings', {
      title: 'Sozlamalar',
      active: 'settings',
      user: req.session.user,
      csrfToken: req.session.csrfToken,
      profile: { name: user.name || '', lang: 'uz', theme: 'light', email: user.email || null, emailVerified: user.emailVerified === true },
      settingsCopy: {},
      accountCopy: {},
      copy: AUTH_COPY.uz,
    });
  }
});

// ── AUTH D-09 §07: Profil o'zgartirish (Zod, low-risk — reauth talab qilinmaydi) ──
// name 2-60, lang enum [uz,ru,en,kk], theme enum [light,dark]. Idempotent: takroriy PATCH → 200.
router.patch('/api/settings/profile', async (req, res) => {
  const user = req.session.user;
  const body = req.body || {};
  try {
    const { z } = await import('zod');
    const profileSchema = z.object({
      name: z.string().trim().min(2).max(60).optional(),
      lang: z.enum(['uz', 'uz-cyrl', 'ru', 'en', 'kk']).optional(),
      theme: z.enum(['light', 'dark']).optional(),
    }).strict();
    const parsed = profileSchema.safeParse(body);
    if (!parsed.success) {
      return res.status(400).json({
        ok: false,
        error: 'invalid_profile',
        fields: Object.fromEntries(parsed.error.issues.map((i) => [i.path[0], i.code])),
      });
    }
    const data = parsed.data;
    if (Object.keys(data).length === 0) {
      return res.status(400).json({ ok: false, error: 'empty_body' });
    }

    const updates = {};
    if (data.name !== undefined) updates.name = data.name;
    if (data.lang !== undefined || data.theme !== undefined) {
      // local-db update value key'larini '/' bo'yicha split qilmaydi —
      // settings ob'ektini o'qib, nested merge qilamiz (literal kalit xatosi oldi).
      const settingsSnap = await fb.get(`users/${user.safeKey}/settings`);
      const settings = settingsSnap.exists() ? settingsSnap.val() : {};
      if (data.lang !== undefined) settings.lang = data.lang;
      if (data.theme !== undefined) settings.theme = data.theme;
      updates.settings = settings;
    }

    await fb.update(`users/${user.safeKey}`, updates);

    // Session'dagi name'ni yangilash (keyingi renderlarda ko'rinishi uchun)
    if (data.name !== undefined) req.session.user.name = data.name;

    // Audit: settings_saved (PII yo'q — faqat o'zgargan kalitlar)
    try {
      const { logAuthEvent, AUDIT_ACTIONS } = await import('../src/modules/auth/audit.js');
      await logAuthEvent({
        action: AUDIT_ACTIONS.SETTINGS_SAVED,
        outcome: 'success',
        method: 'patch',
        actorId: user.safeKey,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
        details: { changed: Object.keys(updates) },
      });
    } catch (_) { /* audit xatosi so'rovni buzmaydi */ }

    res.json({ ok: true, saved: Object.keys(data) });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'settings_save_failed' });
  }
});

// ═══════════════════════════════════════════════════════════════════
// S22 — Yakka mashq (solo practice): o'z/ommaviy testlar (student),
// mock/pre to'plamlar (faqat VIP). Javob kaliti klientga TUSHMAYDI —
// grade serverda.
// ═══════════════════════════════════════════════════════════════════
async function loadPracticeQuestions(req, res) {
  const source = String(req.query.source || req.body?.source || 'user');
  const key = String(req.query.key || req.body?.key || '');
  if (!key || !/^[A-Za-z0-9_.-]{1,120}$/.test(key) || key.includes('..')) {
    return { err: res.status(400).json({ ok: false, error: 'invalid_key' }) };
  }
  const user = req.session.user;
  if (source === 'user') {
    // O'z testi YOKI boshqa userning public testi
    const ownSnap = await fb.get(`users/${user.safeKey}/tests/${key}`);
    if (ownSnap.exists()) {
      const d = ownSnap.val();
      return { title: d.name || 'Test', questions: Array.isArray(d.questions) ? d.questions : [] };
    }
    const pubSnap = await fb.get(`public_tests`);
    if (pubSnap.exists()) {
      for (const [globalKey, meta] of Object.entries(pubSnap.val() || {})) {
        if (meta && meta.testKey === key) {
          const authorSnap = await fb.get(`users/${meta.authorUid}/tests/${key}`);
          if (authorSnap.exists()) {
            const d = authorSnap.val();
            return { title: d.name || 'Ommaviy test', questions: Array.isArray(d.questions) ? d.questions : [] };
          }
        }
      }
    }
    return { err: res.status(404).json({ ok: false, error: 'not_found' }) };
  }
  if (source === 'mock' || source === 'pre') {
    // Faqat VIP (imtihonga tayyorlanish to'plamlari — S22 qarori)
    const vipSnap = await fb.get(`users/${user.safeKey}/isVip`);
    const isVip = vipSnap.exists() && vipSnap.val() === true;
    const isStaff = ['teacher', 'admin', 'board'].includes(user.role);
    if (!isVip && !isStaff) {
      return { err: res.status(403).json({ ok: false, error: 'vip_required' }) };
    }
    if (source === 'mock') {
      const snap = await fb.get(`mock_fans/${key}`);
      if (!snap.exists()) return { err: res.status(404).json({ ok: false, error: 'not_found' }) };
      const d = snap.val();
      return { title: d.name || key, questions: Array.isArray(d.questions) ? d.questions : [] };
    }
    const chunk = String(req.query.chunk || req.body?.chunk || '');
    if (!chunk || !/^[A-Za-z0-9_.-]{1,64}$/.test(chunk) || chunk.includes('..')) {
      return { err: res.status(400).json({ ok: false, error: 'invalid_chunk' }) };
    }
    const snap = await fb.get(`pre_groups/${key}`);
    if (!snap.exists()) return { err: res.status(404).json({ ok: false, error: 'not_found' }) };
    const g = snap.val();
    const sel = (g.chunks || []).find((c) => c && c.id === chunk);
    if (!sel) return { err: res.status(404).json({ ok: false, error: 'not_found' }) };
    return { title: (g.title || key) + ' — ' + (sel.name || chunk), questions: Array.isArray(sel.questions) ? sel.questions : [] };
  }
  return { err: res.status(400).json({ ok: false, error: 'invalid_source' }) };
}

router.get('/practice', async (req, res) => {
  const loaded = await loadPracticeQuestions(req, res);
  if (loaded.err) return;
  const qs = (loaded.questions || []).map((q, i) => ({
    id: i,
    text: String(q?.text || ''),
    type: q?.type || 'single_choice',
    options: Array.isArray(q?.options) ? q.options.map((o) => String(o || '')) : [],
    // correct NI YUBORMAYMIZ
  })).filter((q) => q.text && q.options.length >= 2);
  if (!qs.length) return res.status(404).render('error', { title: '404', message: 'Savollar topilmadi', status: 404 });

  // Practice i18n: 4 til (uz/uz-cyrl/ru/en) — data/practice-i18n.js
  let pRaw = 'uz';
  try {
    const pSnap = await fb.get(`users/${req.session.user.safeKey}/settings/lang`);
    if (pSnap.exists() && pSnap.val()) pRaw = pSnap.val();
  } catch (_) {}
  const pLang = resolvePanelLang(pRaw);
  const pCopy = practiceCopyFor(pLang);

  return res.render('user/practice', {
    title: (pCopy.pageTitle || '{title}').replace('{title}', loaded.title),
    practiceTitle: loaded.title,
    pLang,
    htmlLang: htmlLangOf(pLang),
    pCopy,
    source: String(req.query.source || 'user'),
    key: String(req.query.key || ''),
    chunk: String(req.query.chunk || ''),
    questions: qs,
    csrfToken: res.locals.csrfToken || req.session.csrfToken || '',
  });
});

router.post('/api/practice/grade', async (req, res) => {
  const loaded = await loadPracticeQuestions(req, res);
  if (loaded.err) return;
  const answers = Array.isArray(req.body?.answers) ? req.body.answers : [];
  const results = [];
  let correct = 0;
  (loaded.questions || []).forEach((q, i) => {
    const opts = Array.isArray(q?.options) ? q.options : [];
    const correctIdx = Math.max(0, Math.min(Number.isFinite(+q?.correct) ? Math.floor(+q.correct) : 0, opts.length - 1));
    const given = Number.isInteger(answers[i]) ? answers[i] : -1;
    const isCorrect = given === correctIdx;
    if (isCorrect) correct++;
    results.push({
      id: i,
      correctIndex: correctIdx, // grade'dan KEYIN ochiq — o'quv ko'rinishi uchun
      given,
      isCorrect,
      explanation: String(q?.explanation || ''),
    });
  });
  const total = results.length || 1;
  // Natijani saqlash (o'z testi bo'lsa — progress kuzatuvi)
  try {
    const user = req.session.user;
    const src = String(req.body?.source || req.query.source || 'user');
    if (user && src === 'user') {
      await fb.set(`users/${user.safeKey}/practice_history/${Date.now().toString(36)}`, {
        key: String(req.body?.key || req.query.key || ''),
        title: loaded.title,
        correct, total, percent: Math.round((correct / total) * 100),
        at: Date.now(),
      });
    }
  } catch (_) { /* non-critical */ }
  res.json({ ok: true, correct, total, percent: Math.round((correct / total) * 100), results });
});

export default router;
