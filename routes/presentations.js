/**
 * Deborah — Taqdimotlar (Presentations) moduli
 * - Hub:  GET  /user/presentations
 * - Edit:  GET  /user/presentations/:id/edit
 * - View:  GET  /user/presentations/:id/view   (to'liq ekran taqdimot rejimi)
 *
 * API (barchasi requireAuth, owner-scoped — faqat o'z taqdimoti):
 * - GET    /user/api/presentations
 * - POST   /user/api/presentations              {name, engine, start:'blank'|'test', testKey}
 * - GET    /user/api/presentations/:id
 * - POST   /user/api/presentations/:id/save     {deck}  (to'liq deck autosave)
 * - POST   /user/api/presentations/:id/rename   {name}
 * - POST   /user/api/presentations/:id/duplicate
 * - POST   /user/api/presentations/:id/delete
 *
 * 09/2026 (user qarori): Google Slides uslubi + Canva uslubi muhitlari sayt
 * ichida, joriy account bilan; ma'lumotlar users/<safeKey>/presentations ostida.
 */
import { Router } from 'express';
import { fb } from '../firebase/admin.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

const SLIDE_W = 1280;
const SLIDE_H = 720;
const MAX_SLIDES = 60;
const MAX_ELS = 140;
const MAX_NAME = 120;
const HEX = /^#[0-9a-fA-F]{3,8}$/;
const KEY_RE = /^[A-Za-z0-9_-]{1,48}$/;
const URL_RE = /^https?:\/\/[^\s"<>]{5,400}$/i;
const LAYOUTS = ['blank', 'title', 'titlebody'];
const KINDS = ['rect', 'circle', 'triangle', 'diamond', 'line'];
const EL_TYPES = ['text', 'list', 'shape', 'image'];
const FONTS = ['body', 'display'];
const ALIGNS = ['left', 'center', 'right'];

function safeKey(v) {
  return typeof v === 'string' && KEY_RE.test(v) ? v : null;
}
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}
function num(v, min, max, dflt) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : dflt;
}
function str(v, max) {
  return typeof v === 'string' ? v.slice(0, max) : '';
}
function hexOr(v, dflt) {
  return typeof v === 'string' && HEX.test(v) ? v : dflt;
}
function optStr(v, max, allowEmpty) {
  if (typeof v !== 'string') return '';
  const s = v.slice(0, max);
  return allowEmpty ? s : (s.trim() ? s.trim() : '');
}

function newSlide(layout, n) {
  layout = LAYOUTS.includes(layout) ? layout : 'blank';
  const slide = {
    id: 'sl' + uid(),
    layout,
    bg: { type: 'solid', c1: '#f7eeda' },
    elements: [],
  };
  const pushText = (el) => slide.elements.push(el);
  if (layout === 'title') {
    pushText({ id: 'el' + uid(), type: 'text', x: 120, y: 250, w: 1040, h: 130, text: '', fontSize: 64, bold: true, color: '#241a0c', align: 'center', font: 'display' });
  } else if (layout === 'titlebody') {
    pushText({ id: 'el' + uid(), type: 'text', x: 120, y: 90, w: 1040, h: 120, text: '', fontSize: 52, bold: true, color: '#241a0c', align: 'center', font: 'display' });
    pushText({ id: 'el' + uid(), type: 'text', x: 180, y: 290, w: 920, h: 330, text: '', fontSize: 26, bold: false, color: '#3a2c1a', align: 'left', font: 'body' });
  }
  return slide;
}

function defaultDeck(name, engine, layout) {
  const isCanvas = engine === 'canvas';
  const slide = newSlide(layout || (isCanvas ? 'blank' : 'title'), null);
  if (isCanvas) slide.bg = { type: 'gradient', c1: '#f6ecd9', c2: '#e6d5ae', deg: 135 };
  const deck = {
    id: 'prs' + uid(),
    name: optStr(name, MAX_NAME, false) || 'Taqdimotim',
    engine: isCanvas ? 'canvas' : 'slides',
    slides: [slide],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    archived: false,
  };
  return deck;
}

/** Server-sanitize: client ixtiyoriy deck emas, qat'iy shakl saqlanadi. */
function sanitizeDeck(body, existing) {
  const engine = body.engine === 'canvas' ? 'canvas' : 'slides';
  const name = optStr(body.name, MAX_NAME, false) || (existing && existing.name) || 'Taqdimotim';
  const slides = Array.isArray(body.slides) ? body.slides.slice(0, MAX_SLIDES) : [];
  const out = slides.map((s, i) => {
    if (!s || typeof s !== 'object') return null;
    const layout = LAYOUTS.includes(s.layout) ? s.layout : 'blank';
    const bgT = s.bg && s.bg.type === 'gradient' ? 'gradient' : 'solid';
    const bg = bgT === 'gradient'
      ? { type: 'gradient', c1: hexOr(s.bg && s.bg.c1, '#f6ecd9'), c2: hexOr(s.bg && s.bg.c2, '#c9a565'), deg: num(s.bg && s.bg.deg, 0, 360, 135) }
      : { type: 'solid', c1: hexOr(s.bg && s.bg.c1, '#f7eeda') };
    const elements = (Array.isArray(s.elements) ? s.elements : []).slice(0, MAX_ELS).map((e) => {
      if (!e || typeof e !== 'object' || !EL_TYPES.includes(e.type)) return null;
      const base = {
        id: safeKey(String(e.id || '')) || 'el' + uid(),
        type: e.type,
        x: num(e.x, -200, SLIDE_W + 200, 0),
        y: num(e.y, -200, SLIDE_H + 200, 0),
        w: num(e.w, 8, SLIDE_W * 2, 200),
        h: num(e.h, 8, SLIDE_H * 2, 80),
      };
      if (e.type === 'text') {
        return { ...base, text: optStr(e.text, 3000, true), fontSize: num(e.fontSize, 10, 200, 24), bold: !!e.bold, italic: !!e.italic, color: hexOr(e.color, '#241a0c'), align: ALIGNS.includes(e.align) ? e.align : 'left', font: FONTS.includes(e.font) ? e.font : 'body' };
      }
      if (e.type === 'list') {
        const items = (Array.isArray(e.items) ? e.items : []).slice(0, 40).map((it) => ({ txt: optStr(it && it.txt, 600, true) }));
        return { ...base, items, fontSize: num(e.fontSize, 10, 140, 24), bold: !!e.bold, color: hexOr(e.color, '#241a0c'), gap: num(e.gap, 2, 60, 12) };
      }
      if (e.type === 'shape') {
        return { ...base, kind: KINDS.includes(e.kind) ? e.kind : 'rect', fill: hexOr(e.fill, '#c9a565'), stroke: hexOr(e.stroke, 'transparent') === 'transparent' ? 'transparent' : hexOr(e.stroke, 'transparent'), strokeW: num(e.strokeW, 0, 24, 0) };
      }
      return { ...base, src: typeof e.src === 'string' && URL_RE.test(e.src) ? e.src : '' };
    }).filter(Boolean);
    return { id: safeKey(String(s.id || '')) || 'sl' + uid(), layout, bg, elements };
  }).filter(Boolean);

  return { name, engine, slides: out };
}

async function loadDeck(user, id) {
  const key = safeKey(id);
  if (!key) return null;
  const snap = await fb.get(`users/${user.safeKey}/presentations/${key}`);
  return snap.exists() ? { key, ...snap.val() } : null;
}

// ── Sahifalar ──
router.get('/presentations', async (req, res) => {
  const user = req.session.user;
  const { PRESENT_COPY, resolvePresentLang } = await import('../data/presentations-i18n.js');
  const { resolvePanelLang, htmlLangOf, localeOf } = await import('../data/panel-i18n.js');
  const { AUTH_COPY, resolveAuthLang } = await import('../data/auth-i18n.js');
  let plang = 'uz';
  try {
    const s = await fb.get(`users/${user.safeKey}/settings/lang`);
    if (s.exists() && s.val()) plang = s.val();
  } catch (_) {}
  const lang = resolvePanelLang(plang);
  const pCopy = PRESENT_COPY[resolvePresentLang(plang)];
  const authCopy = AUTH_COPY[resolveAuthLang(plang)];
  let decks = [];
  try {
    const snap = await fb.get(`users/${user.safeKey}/presentations`);
    decks = Object.entries(snap.val() || {})
      .sort((a, b) => (b[1].updatedAt || 0) - (a[1].updatedAt || 0))
      .map(([k, d]) => ({
        key: k,
        name: d.name || 'Taqdimotim',
        engine: d.engine === 'canvas' ? 'canvas' : 'slides',
        slideCount: Array.isArray(d.slides) ? d.slides.length : 0,
        archived: !!d.archived,
        updatedAt: d.updatedAt || d.createdAt || 0,
      }));
  } catch (_) {}
  let tests = [];
  try {
    const t = await fb.get(`users/${user.safeKey}/tests`);
    tests = Object.entries(t.val() || {})
      .filter(([, v]) => v && !v.archived && Array.isArray(v.questions) && v.questions.length)
      .map(([k, v]) => ({ key: k, name: v.name || v.title || 'Test', count: v.questions.length }));
  } catch (_) {}
  res.render('user/presentations', {
    title: pCopy.hubTitle + ' — Deborah',
    active: 'presentations',
    htmlLang: htmlLangOf(lang),
    localeCode: localeOf(lang),
    pCopy,
    deckCopyAll: PRESENT_COPY,
    pLang: resolvePresentLang(plang),
    fullCopy: authCopy,
    copy: { sidebar: authCopy.sidebar, header: authCopy.header },
    user: { username: user.username },
    decks,
    tests,
    csrfToken: req.session.csrfToken,
    fmtDate: (ts) => new Date(ts || Date.now()).toLocaleDateString(localeOf(lang)),
    username: user.username,
  });
});

router.get('/presentations/:id/edit', async (req, res) => {
  const user = req.session.user;
  const deck = await loadDeck(user, req.params.id);
  if (!deck) return res.status(404).render('error', { title: '404', message: 'Taqdimot topilmadi', status: 404 });
  const { PRESENT_COPY, resolvePresentLang } = await import('../data/presentations-i18n.js');
  const { resolvePanelLang, htmlLangOf, localeOf } = await import('../data/panel-i18n.js');
  const { AUTH_COPY, resolveAuthLang } = await import('../data/auth-i18n.js');
  let plang = 'uz';
  try {
    const s = await fb.get(`users/${user.safeKey}/settings/lang`);
    if (s.exists() && s.val()) plang = s.val();
  } catch (_) {}
  const lang = resolvePanelLang(plang);
  const authCopy = AUTH_COPY[resolveAuthLang(plang)];
  const pCopy = PRESENT_COPY[resolvePresentLang(plang)];
  res.render('user/present-editor', {
    title: deck.name + ' — Deborah',
    htmlLang: htmlLangOf(lang),
    localeCode: localeOf(lang),
    pCopy,
    fullCopy: authCopy,
    copy: { sidebar: authCopy.sidebar, header: authCopy.header },
    deckJSON: JSON.stringify({
      key: deck.key,
      name: deck.name,
      engine: deck.engine === 'canvas' ? 'canvas' : 'slides',
      slides: deck.slides || [],
    }).replace(/</g, '\\u003c'),
    csrfToken: req.session.csrfToken,
    username: user.username,
  });
});

router.get('/presentations/:id/view', async (req, res) => {
  const user = req.session.user;
  const deck = await loadDeck(user, req.params.id);
  if (!deck) return res.status(404).render('error', { title: '404', message: 'Taqdimot topilmadi', status: 404 });
  const { PRESENT_COPY, resolvePresentLang } = await import('../data/presentations-i18n.js');
  const { resolvePanelLang, htmlLangOf, localeOf } = await import('../data/panel-i18n.js');
  const { AUTH_COPY, resolveAuthLang } = await import('../data/auth-i18n.js');
  let plang = 'uz';
  try {
    const s = await fb.get(`users/${user.safeKey}/settings/lang`);
    if (s.exists() && s.val()) plang = s.val();
  } catch (_) {}
  const lang = resolvePanelLang(plang);
  const authCopy = AUTH_COPY[resolveAuthLang(plang)];
  const pCopy = PRESENT_COPY[resolvePresentLang(plang)];
  res.render('user/present-view', {
    title: deck.name + ' — Deborah',
    htmlLang: htmlLangOf(lang),
    localeCode: localeOf(lang),
    pCopy,
    fullCopy: authCopy,
    copy: { sidebar: authCopy.sidebar, header: authCopy.header },
    deckJSON: JSON.stringify({
      key: deck.key,
      name: deck.name,
      engine: deck.engine === 'canvas' ? 'canvas' : 'slides',
      slides: deck.slides || [],
    }).replace(/</g, '\\u003c'),
    csrfToken: req.session.csrfToken,
    username: user.username,
  });
});

// ── API ──
router.get('/api/presentations', async (req, res) => {
  const user = req.session.user;
  const snap = await fb.get(`users/${user.safeKey}/presentations`);
  const decks = Object.entries(snap.val() || {})
    .sort((a, b) => (b[1].updatedAt || 0) - (a[1].updatedAt || 0))
    .map(([k, d]) => ({
      key: k,
      name: d.name || 'Taqdimotim',
      engine: d.engine === 'canvas' ? 'canvas' : 'slides',
      slideCount: Array.isArray(d.slides) ? d.slides.length : 0,
      archived: !!d.archived,
      updatedAt: d.updatedAt || d.createdAt || 0,
    }));
  res.json({ decks });
});

router.post('/api/presentations', async (req, res) => {
  try {
    const user = req.session.user;
    const { name, engine, start, testKey } = req.body || {};
    const eng = engine === 'canvas' ? 'canvas' : 'slides';
    let deck;

    if (start === 'test') {
      const tKey = safeKey(testKey);
      if (!tKey) return res.status(400).json({ error: 'Test tanlanmadi' });
      const tsnap = await fb.get(`users/${user.safeKey}/tests/${tKey}`);
      if (!tsnap.exists()) return res.status(404).json({ error: 'Test topilmadi' });
      const t = tsnap.val();
      const questions = (Array.isArray(t.questions) ? t.questions : []).slice(0, 40);
      if (!questions.length) return res.status(400).json({ error: 'Testda savollar yo‘q' });
      deck = defaultDeck(name || t.name || t.title, eng, 'title');
      const titleEl = deck.slides[0].elements[0];
      titleEl.text = optStr(name || t.name || t.title, MAX_NAME, false) || 'Taqdimotim';
      deck.slides = [];
      deck.slides.push({ id: 'sl' + uid(), layout: 'title', bg: { type: 'solid', c1: '#241a0c' }, elements: [
        { id: 'el' + uid(), type: 'text', x: 120, y: 250, w: 1040, h: 160, text: titleEl.text, fontSize: 62, bold: true, color: '#f6ecd9', align: 'center', font: 'display' },
      ] });
      questions.forEach((q, i) => {
        const opts = Array.isArray(q.options) ? q.options.map((o) => String(o || '').trim()).filter(Boolean).slice(0, 8) : [];
        const els = [];
        const qText = String(q.text || '').trim() || `Savol ${i + 1}`;
        if (opts.length >= 2) {
          els.push({ id: 'el' + uid(), type: 'text', x: 140, y: 90, w: 1000, h: 200, text: qText, fontSize: 34, bold: true, color: '#241a0c', align: 'left', font: 'display' });
          els.push({ id: 'el' + uid(), type: 'list', x: 220, y: 330, w: 840, h: 260, items: opts.map((o) => ({ txt: o })), fontSize: 26, bold: false, color: '#3a2c1a', gap: 14 });
        } else {
          els.push({ id: 'el' + uid(), type: 'text', x: 140, y: 220, w: 1000, h: 160, text: qText, fontSize: 38, bold: true, color: '#241a0c', align: 'center', font: 'display' });
        }
        deck.slides.push({ id: 'sl' + uid(), layout: 'blank', bg: { type: 'solid', c1: i % 2 ? '#f6ecd9' : '#efe2c4' }, elements: els });
      });
      deck.slides.push({ id: 'sl' + uid(), layout: 'title', bg: { type: 'gradient', c1: '#a37f3a', c2: '#5b4317', deg: 135 }, elements: [
        { id: 'el' + uid(), type: 'text', x: 120, y: 250, w: 1040, h: 120, text: 'Rahmat!', fontSize: 72, bold: true, color: '#f6ecd9', align: 'center', font: 'display' },
      ] });
      deck.slides = deck.slides.slice(0, MAX_SLIDES);
    } else {
      deck = defaultDeck(name, eng, null);
    }

    const out = sanitizeDeck(deck, null);
    const final = { id: deck.id, name: out.name, engine: out.engine, slides: out.slides, createdAt: Date.now(), updatedAt: Date.now(), archived: false };
    await fb.set(`users/${user.safeKey}/presentations/${deck.id}`, final);
    res.json({ ok: true, key: deck.id, name: final.name });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/api/presentations/:id', async (req, res) => {
  const deck = await loadDeck(req.session.user, req.params.id);
  if (!deck) return res.status(404).json({ error: 'Topilmadi' });
  const { key, id, ...rest } = deck;
  res.json({ ok: true, deck: { key, name: rest.name, engine: rest.engine, slides: rest.slides || [] } });
});

router.post('/api/presentations/:id/save', async (req, res) => {
  try {
    const user = req.session.user;
    const existing = await loadDeck(user, req.params.id);
    if (!existing) return res.status(404).json({ error: 'Topilmadi' });
    const { name, engine, slides } = sanitizeDeck({ name: req.body && req.body.name, engine: (req.body && req.body.engine) || existing.engine, slides: req.body && req.body.slides }, existing);
    await fb.update(`users/${user.safeKey}/presentations/${existing.key}`, {
      name,
      engine: engine === 'canvas' ? 'canvas' : 'slides',
      slides,
      updatedAt: Date.now(),
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/api/presentations/:id/rename', async (req, res) => {
  const user = req.session.user;
  const existing = await loadDeck(user, req.params.id);
  if (!existing) return res.status(404).json({ error: 'Topilmadi' });
  const name = optStr(req.body && req.body.name, MAX_NAME, false);
  if (!name) return res.status(400).json({ error: 'Nom kiriting' });
  await fb.update(`users/${user.safeKey}/presentations/${existing.key}`, { name, updatedAt: Date.now() });
  res.json({ ok: true, name });
});

router.post('/api/presentations/:id/duplicate', async (req, res) => {
  const user = req.session.user;
  const existing = await loadDeck(user, req.params.id);
  if (!existing) return res.status(404).json({ error: 'Topilmadi' });
  const copy = {
    id: 'prs' + uid(),
    name: (existing.name || 'Taqdimotim') + ' — nusxa',
    engine: existing.engine === 'canvas' ? 'canvas' : 'slides',
    slides: (existing.slides || []).map((s) => ({
      ...JSON.parse(JSON.stringify(s)),
      id: 'sl' + uid(),
      elements: (s.elements || []).map((e) => ({ ...JSON.parse(JSON.stringify(e)), id: 'el' + uid() })),
    })),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    archived: false,
  };
  const out = sanitizeDeck(copy, null);
  copy.name = out.name; copy.engine = out.engine; copy.slides = out.slides;
  await fb.set(`users/${user.safeKey}/presentations/${copy.id}`, copy);
  res.json({ ok: true, key: copy.id });
});

router.post('/api/presentations/:id/delete', async (req, res) => {
  const user = req.session.user;
  const key = safeKey(req.params.id);
  if (!key) return res.status(400).json({ error: 'Yaroqsiz kalit' });
  const snap = await fb.get(`users/${user.safeKey}/presentations/${key}`);
  if (!snap.exists()) return res.status(404).json({ error: 'Topilmadi' });
  await fb.remove(`users/${user.safeKey}/presentations/${key}`);
  res.json({ ok: true });
});

router.post('/api/presentations/:id/archive', async (req, res) => {
  const user = req.session.user;
  const existing = await loadDeck(user, req.params.id);
  if (!existing) return res.status(404).json({ error: 'Topilmadi' });
  const archived = !!(req.body && req.body.archived);
  await fb.update(`users/${user.safeKey}/presentations/${existing.key}`, { archived, updatedAt: Date.now() });
  res.json({ ok: true, archived });
});

export default router;
