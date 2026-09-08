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
// 09/2026 (user qarori): rasm endi nafaqat URL — fayl upload (data:image) ham
// qo'llab-quvvatlanadi. Hajm cheki ~2.4MB base64 (client 1280px gacha downscale qiladi).
const DATAIMG_RE = /^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=\s]{100,2400000}$/;
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
      // rasm: data: (upload) yoki http(s) (URL) — masofaviy URL same-origin proxy'ga
      // aylantiriladi (CSP img-src 'self' data: blob: + export'da canvas taint bo'lmasligi).
      // Allaqachon proxy'langan src (saqlash idempotent) ham o'tadi.
      let src = typeof e.src === 'string' ? e.src.slice(0, 2600) : '';
      if (src.startsWith('/user/api/img?u=')) src = src;
      else if (DATAIMG_RE.test(src)) src = src;
      else if (URL_RE.test(src)) src = '/user/api/img?u=' + encodeURIComponent(src);
      else src = '';
      return { ...base, src };
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

// ── 09/2026: Rasm URL-proksi (CSP img-src 'self' data: blob: sababli tashqi
// rasm to'g'ridan-to'g'ri <img> da ko'rinmaydi; eksport'da ham canvas taint
// bo'lmasligi uchun hamma rasm same-origin orqali yuklanadi). SSRF-ga qarshi
// private/link-local manzillar bloklanadi, hajm+vaqt chegarasi bor. ──
const BLOCKED_HOST_RE = /^(localhost|0\.0\.0\.0|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|::1$|\[::1\]|\[fc|\[fd)/i;
router.get('/api/img', async (req, res) => {
  const raw = String(req.query.u || '').slice(0, 600);
  if (!URL_RE.test(raw)) return res.status(400).end();
  try {
    const host = new URL(raw).hostname;
    if (BLOCKED_HOST_RE.test(host)) return res.status(400).end();
  } catch (_) { return res.status(400).end(); }
  try {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 9000);
    const r = await fetch(raw, { redirect: 'follow', signal: ctrl.signal, headers: { 'User-Agent': 'Deborah-presentations/1.0' } });
    clearTimeout(to);
    if (!r.ok) return res.status(502).end();
    const len = Number(r.headers.get('content-length') || 0);
    if (len > 8 * 1024 * 1024) return res.status(413).end();
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > 8 * 1024 * 1024) return res.status(413).end();
    res.setHeader('Cache-Control', 'private, max-age=600');
    const ct = String(r.headers.get('content-type') || '');
    if (/^image\//i.test(ct)) res.setHeader('Content-Type', ct);
    res.end(buf);
  } catch (_) { res.status(502).end(); }
});

// ═══ PPTX IMPORT (09/2026 — user qarori: tashqi PowerPoint fayldan deck) ═══
// Parser: minimal ZIP o'quvchi (store+deflate), ppt/slides/slideN.xml →
// matn shakllari (a:t, rPr: sz/b/srgbClr) + rasmlar (blip → media) — 1280×720
// modelga masshtablanadi. Node zlib inflateRaw — tashqi qaramlik yo'q.
import { inflateRawSync } from 'zlib';

function zipEntries(buf) {
  const out = [];
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 70000); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) return out;
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n++) {
    if (off + 46 > buf.length || buf.readUInt32LE(off) !== 0x02014b50) break;
    const method = buf.readUInt16LE(off + 10);
    const csize = buf.readUInt32LE(off + 20);
    const nlen = buf.readUInt16LE(off + 28);
    const elen = buf.readUInt16LE(off + 30);
    const clen = buf.readUInt16LE(off + 32);
    const lho = buf.readUInt32LE(off + 42);
    const name = buf.toString('utf8', off + 46, off + 46 + nlen);
    const dataStart = lho + 30 + buf.readUInt16LE(lho + 26) + buf.readUInt16LE(lho + 28);
    let data;
    try {
      data = method === 0 ? buf.subarray(dataStart, dataStart + csize)
        : method === 8 ? inflateRawSync(buf.subarray(dataStart, dataStart + csize)) : null;
    } catch (_) { data = null; }
    if (data) out.push({ name, data });
    off += 46 + nlen + elen + clen;
  }
  return out;
}

function unq(s) {
  return String(s || '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#39;/g, "'");
}
function parseSlideXml(xml, relMap) {
  const els = [];
  const spRe = /<p:sp>([\s\S]*?)<\/p:sp>/g;
  let m;
  while ((m = spRe.exec(xml))) {
    const block = m[1];
    const off = /<a:off x="(-?\d+)" y="(-?\d+)"\/>/.exec(block);
    const ext = /<a:ext cx="(\d+)" cy="(\d+)"\/>/.exec(block);
    if (!off || !ext) continue;
    const x = +off[1], y = +off[2], w = +ext[1], h = +ext[2];
    const paras = [];
    const pRe = /<a:p>([\s\S]*?)<\/a:p>/g;
    let p;
    while ((p = pRe.exec(block))) {
      const txts = [];
      const tRe = /<a:t>([\s\S]*?)<\/a:t>/g;
      let t;
      while ((t = tRe.exec(p[1]))) txts.push(unq(t[1]));
      const text = txts.join('').trim();
      if (text) paras.push({ text });
    }
    if (!paras.length) continue;
    // barcha run'lar bo'yicha birinchi format (sz/b/srgbClr)
    const firstRp = /<a:rPr[^>]*sz="(\d+)"[^>]*b="(\d)"[^>]*>([\s\S]*?)<\/a:rPr>|<a:rPr[^>]*sz="(\d+)"[^>]*>([\s\S]*?)<\/a:rPr>/.exec(block);
    const col = /<a:srgbClr val="([0-9A-Fa-f]{6})"/.exec(block);
    let fontSize = 24, bold = false;
    if (firstRp) {
      const sz = firstRp[1] || firstRp[4];
      if (sz) fontSize = Math.min(200, Math.max(10, Math.round(+sz / 100)));
      bold = firstRp[2] === '1';
    }
    const color = col ? '#' + col[1].toLowerCase() : '#241a0c';
    // agar juda ko'p qator bo'lsa — ro'yxat emas, matn (qatorlar \n)
    els.push({ x, y, w, h, text: paras.map((q) => q.text).join('\n'), fontSize, bold, color });
  }
  // rasmlar
  const picRe = /<p:pic>([\s\S]*?)<\/p:pic>/g;
  while ((m = picRe.exec(xml))) {
    const block = m[1];
    const rid = /r:embed="rId(\d+)"/.exec(block);
    const off = /<a:off x="(-?\d+)" y="(-?\d+)"\/>/.exec(block);
    const ext = /<a:ext cx="(\d+)" cy="(\d+)"\/>/.exec(block);
    if (!rid || !off || !ext) continue;
    const target = relMap[+rid[1]];
    if (!target) continue;
    els.push({ x: +off[1], y: +off[2], w: +ext[1], h: +ext[2], img: target });
  }
  return els;
}

router.post('/api/presentations/import', async (req, res) => {
  try {
    const user = req.session.user;
    const chunks = [];
    let size = 0;
    for await (const c of req) {
      size += c.length;
      if (size > 25 * 1024 * 1024) return res.status(413).json({ error: 'Fayl juda katta (25 MB limit)' });
      chunks.push(c);
    }
    const buf = Buffer.concat(chunks);
    const entries = zipEntries(buf);
    const entry = (n) => entries.find((e) => e.name === n);
    const slideNos = [];
    for (const e of entries) {
      const m = /^ppt\/slides\/slide(\d+)\.xml$/.exec(e.name);
      if (m) slideNos.push(+m[1]);
    }
    slideNos.sort((a, b) => a - b);
    if (!slideNos.length) return res.status(400).json({ error: 'PPTX faylda slayd topilmadi' });

    // media → dataURL (har bir rel uchun)
    const mediaCache = new Map();
    const mediaDataUrl = (relTarget) => {
      const name = 'ppt/' + String(relTarget || '').replace(/^\.\.\//, 'slides/../').replace(/^\.\.\/ppt\//, '').replace('../media/', 'media/');
      const clean = name.replace(/^ppt\//, '');
      const fileName = clean.startsWith('media/') ? clean : ('media/' + clean.split('/').pop());
      if (mediaCache.has(fileName)) return mediaCache.get(fileName);
      const e2 = entries.find((x) => x.name === 'ppt/' + fileName);
      if (!e2) { mediaCache.set(fileName, null); return null; }
      const ext = (fileName.split('.').pop() || 'png').toLowerCase();
      const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'gif' ? 'image/gif' : ext === 'webp' ? 'image/webp' : ext === 'svg' ? 'image/svg+xml' : 'image/png';
      const b64 = e2.data.toString('base64');
      const url = `data:${mime};base64,${b64}`;
      mediaCache.set(fileName, url);
      return url;
    };

    // slayd o'lchami (16:9 default)
    let cx = 12192000, cy = 6858000;
    const pres = entry('ppt/presentation.xml');
    if (pres) {
      const sm = /<p:sldSz[^>]*cx="(\d+)"[^>]*cy="(\d+)"/.exec(pres.data.toString('utf8'));
      if (sm) { cx = +sm[1]; cy = +sm[2]; }
    }
    const scale = Math.min(SLIDE_W / cx, SLIDE_H / cy);
    const ox = Math.round((SLIDE_W - cx * scale) / 2);
    const oy = Math.round((SLIDE_H - cy * scale) / 2);

    const slides = [];
    for (const n of slideNos) {
      const xmlEntry = entry(`ppt/slides/slide${n}.xml`);
      const relEntry = entry(`ppt/slides/_rels/slide${n}.xml.rels`);
      const relMap = {};
      if (relEntry) {
        const re = /<Relationship[^>]*Id="rId(\d+)"[^>]*Target="([^"]+)"/g;
        let mm;
        const rels = relEntry.data.toString('utf8');
        while ((mm = re.exec(rels))) {
          const type = /Type="[^"]*\/(image|media)\/"/.exec(mm[0]);
          if (type) relMap[+mm[1]] = mm[2];
        }
      }
      let rawEls = [];
      try {
        rawEls = parseSlideXml(xmlEntry.data.toString('utf8'), relMap);
      } catch (_) { rawEls = []; }
      const elements = rawEls.slice(0, MAX_ELS).map((r, i) => {
        const x = Math.round(r.x * scale + ox);
        const y = Math.round(r.y * scale + oy);
        const w = Math.max(8, Math.round(r.w * scale));
        const h = Math.max(8, Math.round(r.h * scale));
        if (r.img) {
          const src = mediaDataUrl(r.img);
          return src ? { id: 'el' + uid() + i, type: 'image', x, y, w, h, src } : null;
        }
        return {
          id: 'el' + uid() + i, type: 'text', x, y, w, h,
          text: r.text, fontSize: r.fontSize, bold: r.bold, italic: false,
          color: r.color, align: 'left', font: 'body',
        };
      }).filter(Boolean);
      if (!elements.length) continue;
      slides.push({ id: 'sl' + uid(), layout: 'blank', bg: { type: 'solid', c1: '#ffffff' }, elements });
      if (slides.length >= MAX_SLIDES) break;
    }
    if (!slides.length) return res.status(400).json({ error: 'PPTX ichida tahrirlanadigan kontent topilmadi' });

    const headerName = String(req.headers['x-pptx-name'] || '').replace(/\.pptx$/i, '').slice(0, MAX_NAME).trim();
    const name = headerName || ('Import ' + new Date().toLocaleDateString('uz'));
    const deck = {
      id: 'prs' + uid(),
      name,
      engine: 'canvas',
      slides,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      archived: false,
    };
    const out = sanitizeDeck(deck, null);
    const final = { id: deck.id, name: out.name, engine: out.engine, slides: out.slides, createdAt: Date.now(), updatedAt: Date.now(), archived: false };
    await fb.set(`users/${user.safeKey}/presentations/${deck.id}`, final);
    res.json({ ok: true, key: deck.id, name: final.name, slideCount: final.slides.length });
  } catch (err) {
    res.status(400).json({ error: 'PPTX o‘qilmadi: ' + (err.message || 'format noto‘g‘ri') });
  }
});

// ═══ EKSPORT (09/2026 — user qarori: PDF, PPTX, PNG, JPG yuklab olish) ═══
// Client har slaydni 1280x720 JPEG qilib POST qiladi → server PDF (pure-JS
// writer, JPEG DCTDecode embed) yoki PPTX (pptxgenjs, full-bleed rasm) qaytaradi.
// PNG/JPG (zip) client tomonda yig'iladi (present-export.js).
function buildPdfJpeg(pages) {
  // pages: Buffer[] (JPEG 1280x720) — sahifa 960x540pt (1280x720 @ 72dpi)
  const chunks = [];
  const push = (s) => chunks.push(Buffer.from(s, 'latin1'));
  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  const offsets = [0];
  let objNum = 1;
  const add = (body) => { offsets[objNum] = Buffer.concat(chunks).length; push(objNum + ' 0 obj\n' + body + '\nendobj\n'); return objNum++; };
  const kids = [];
  for (let i = 0; i < pages.length; i++) {
    const imgRef = objNum;
    add(`<< /Type /XObject /Subtype /Image /Width 1280 /Height 720 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${pages[i].length} >>\nstream\n`);
    chunks.push(pages[i]);
    push('\nendstream');
    const contRef = objNum;
    const cont = Buffer.from(`q 960 0 0 540 0 0 cm /Im${imgRef} Do Q\n`, 'latin1');
    add(`<< /Length ${cont.length} >>\nstream\n`);
    chunks.push(cont);
    push('endstream');
    const pageRef = objNum;
    add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 960 540] /Resources << /XObject << /Im${imgRef} ${imgRef} 0 R >> >> /Contents ${contRef} 0 R >>`);
    kids.push(`${pageRef} 0 R`);
  }
  const catalogRef = 1;
  add('<< /Type /Catalog /Pages 2 0 R >>');
  add(`<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${kids.length} >>`);
  const xrefStart = Buffer.concat(chunks).length;
  let xref = `xref\n0 ${objNum}\n0000000000 65535 f \n`;
  for (let i = 1; i < objNum; i++) xref += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
  push(xref + `trailer\n<< /Size ${objNum} /Root ${catalogRef} 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`);
  return Buffer.concat(chunks);
}

router.post('/api/presentations/:id/export', async (req, res) => {
  try {
    const user = req.session.user;
    const existing = await loadDeck(user, req.params.id);
    if (!existing) return res.status(404).json({ error: 'Topilmadi' });
    const fmt = req.body && req.body.fmt === 'pptx' ? 'pptx' : 'pdf';
    const pages = Array.isArray(req.body && req.body.pages) ? req.body.pages.slice(0, 60) : [];
    if (!pages.length) return res.status(400).json({ error: 'Slaydlar yo‘q' });
    const jpegs = [];
    for (const p of pages) {
      const b64 = typeof p === 'string' ? p : (p && typeof p.data === 'string' ? p.data : '');
      if (!b64 || !/^[A-Za-z0-9+/=\s]{200,9000000}$/.test(b64)) return res.status(400).json({ error: 'Yaroqsiz rasm' });
      jpegs.push(Buffer.from(b64.replace(/\s/g, ''), 'base64'));
    }
    let buf;
    let ctype;
    let ext = fmt;
    if (fmt === 'pptx') {
      const PptxGenJS = (await import('pptxgenjs')).default;
      const p = new PptxGenJS();
      p.layout = 'LAYOUT_16x9';
      p.author = 'Deborah';
      for (const j of jpegs) p.addSlide().addImage({ data: 'data:image/jpeg;base64,' + j.toString('base64'), x: 0, y: 0, w: 10, h: 5.625 });
      buf = await p.write({ outputType: 'nodebuffer' });
      ctype = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
    } else {
      buf = buildPdfJpeg(jpegs);
      ctype = 'application/pdf';
    }
    const safe = String(existing.name || 'taqdimot').replace(/[^\w\u0400-\u04FF\u00C0-\u024F -]+/g, '').replace(/\s+/g, ' ').trim().slice(0, 90) || 'taqdimot';
    res.setHeader('Content-Type', ctype);
    res.setHeader('Content-Disposition', `attachment; filename="presentation.${ext}"; filename*=UTF-8''${encodeURIComponent(safe)}.${ext}`);
    res.setHeader('Content-Length', buf.length);
    res.end(buf);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
