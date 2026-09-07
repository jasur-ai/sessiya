/**
 * Deborah — Portfolio Routes (AUTH A-12)
 * -------------------------------------
 * Student evidence portfolio backed by the local DB (fb):
 *   - GET    /user/portfolio                   — portfolio UI (4-til)
 *   - GET    /api/user/portfolio               — my items
 *   - POST   /api/user/portfolio/items         — add evidence (default-private)
 *   - PATCH  /api/user/portfolio/items/:id     — set visibility (owner-only)
 *   - DELETE /api/user/portfolio/items/:id     — delete (owner-only)
 *   - POST   /api/user/portfolio/import        — transcript/diploma import (PDF/Excel) + consent
 *   - POST   /api/user/items/:id/share         — selective share grant
 *   - POST   /api/user/share-grants/:id/revoke — revoke grant (owner-only)
 *   - GET    /share/:token                     — public share view
 *   - GET    /api/user/portfolio/export        — transcript PDF export (A-12 §13)
 *
 * Security: every write requires auth + CSRF; items/grants are owner-scoped
 * (IDOR-safe); import is default-private and requires data-residency consent;
 * privileged actions are audited.
 */

import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { requireAuth } from '../middleware/auth.js';
import { logAuthEvent } from '../src/modules/auth/audit.js';
import { AUDIT_ACTIONS } from '../src/modules/auth/audit.js';
import {
  listItems,
  addItem,
  setVisibility,
  deleteItem,
  importTranscript,
  createShareGrant,
  revokeShareGrant,
  resolveShareToken,
  buildUserTranscriptPdf,
} from '../src/modules/portfolio/index.js';
import { PortfolioImportError, SUPPORTED_EXTENSIONS, MAX_FILE_BYTES } from '../src/modules/portfolio/index.js';
import { catalogFor, resolveLocale } from '../src/modules/portfolio/index.js';

const router = Router();

const uploadDir = path.resolve(os.tmpdir(), 'deborah-portfolio-uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const unique = `${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    cb(null, `portfolio-${unique}${path.extname(file.originalname).toLowerCase()}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_BYTES, files: 1 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (SUPPORTED_EXTENSIONS.includes(ext)) return cb(null, true);
    cb(new PortfolioImportError('unsupported_format', `Unsupported file type: ${ext}`));
  },
});

/** Multer wrapper — upload xatolarini 400 JSON qilib qaytaradi. */
function uploadSingle(req, res, next) {
  upload.single('file')(req, res, (err) => {
    if (err) {
      const code =
        err instanceof PortfolioImportError
          ? err.code
          : err?.code === 'LIMIT_FILE_SIZE'
            ? 'file_too_large'
            : 'upload_error';
      return res.status(400).json({ error: err?.message || 'Upload failed', code });
    }
    next();
  });
}

/** Unique per-user identifier from the session (users/{safeKey}). */
function uid(req) {
  return req.session?.user?.safeKey || req.session?.user?.username || null;
}

function localeFrom(req) {
  return resolveLocale(req.query.lang || req.cookies?.lang || req.session?.lang || 'uz-Latn');
}

/** GET /user/portfolio — portfolio UI (locale: settings/lang > query/cookie). */
router.get('/user/portfolio', requireAuth, async (req, res) => {
  const userId = uid(req);
  let sLang = null;
  try {
    const { fb } = await import('../firebase/admin.js');
    const snap = await fb.get(`users/${userId}/settings/lang`);
    if (snap.exists() && snap.val()) sLang = snap.val();
  } catch (_) { /* fail-soft */ }
  const locale = resolveLocale(req.query.lang || sLang || 'uz-Latn');
  const ui = catalogFor(locale);
  const { portfolio, items } = await listItems({ userId });
  res.render('user/portfolio', {
    title: ui.title,
    user: req.session.user,
    portfolio,
    items,
    ui,
    locale,
    csrfToken: res.locals.csrfToken,
  });
});

/** GET /api/user/portfolio — my items. */
router.get('/api/user/portfolio', requireAuth, async (req, res) => {
  const { portfolio, items } = await listItems({ userId: uid(req) });
  res.json({ portfolio, items });
});

/** POST /api/user/portfolio/items — add evidence (default-private). */
router.post('/api/user/portfolio/items', requireAuth, async (req, res) => {
  try {
    // BUG-230db189/200 fix: title tur va uzunlik validatsiyasi (array/object/number/100KB qabul qilinardi)
    const rawTitle = req.body?.title;
    if (typeof rawTitle !== 'string' || !rawTitle.trim()) {
      return res.status(400).json({ error: 'title required' });
    }
    const r = await addItem({
      userId: uid(req),
      kind: req.body?.kind || 'draft',
      title: rawTitle.trim().slice(0, 200),
      contentMeta: req.body?.contentMeta || {},
      evidence: req.body?.evidence || {},
    });
    if (!r.ok) return res.status(400).json({ error: r.error });
    res.json({ ok: true, itemId: r.itemId });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

/** PATCH /api/user/portfolio/items/:id — visibility (owner-only). */
router.patch('/api/user/portfolio/items/:id', requireAuth, async (req, res) => {
  try {
    const r = await setVisibility({
      userId: uid(req),
      itemId: req.params.id,
      visibility: req.body?.visibility || 'private',
    });
    if (!r.ok) return res.status(r.code === 'forbidden' ? 403 : 400).json({ error: r.error });
    res.json({ ok: true, itemId: r.itemId, visibility: r.visibility });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

/** DELETE /api/user/portfolio/items/:id — delete (owner-only). */
router.delete('/api/user/portfolio/items/:id', requireAuth, async (req, res) => {
  try {
    const r = await deleteItem({ userId: uid(req), itemId: req.params.id });
    if (!r.ok) return res.status(r.code === 'forbidden' ? 403 : 400).json({ error: r.error });
    res.json({ ok: true, itemId: r.itemId });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

/** POST /api/user/portfolio/import — transcript/diploma import (A-12 §07-12). */
router.post('/api/user/portfolio/import', requireAuth, uploadSingle, async (req, res) => {
  const file = req.file;
  if (!file) return res.status(400).json({ error: 'file required' });
  const consent = req.body?.consent === 'true' || req.body?.consent === '1' || req.body?.consent === true || req.body?.consent === 'on';
  try {
    const r = await importTranscript({
      userId: uid(req),
      filePath: file.path,
      extension: path.extname(file.originalname).toLowerCase(),
      consent,
    });
    if (!r.ok) {
      return res.status(r.code === 'consent_required' ? 400 : 400).json({ error: r.error, code: r.code });
    }
    res.json({ ok: true, created: r.created, skipped: r.skipped, warnings: r.warnings });
  } catch (e) {
    if (e instanceof PortfolioImportError) {
      return res.status(400).json({ error: e.message, code: e.code });
    }
    res.status(500).json({ error: String(e?.message || e) });
  } finally {
    // A-12 §29 memory guard — uploaded file is transient, always clean up
    if (file?.path) fs.promises.unlink(file.path).catch(() => {});
  }
});

/** POST /api/user/items/:id/share — selective share grant. */
router.post('/api/user/items/:id/share', requireAuth, async (req, res) => {
  try {
    const r = await createShareGrant({
      userId: uid(req),
      itemId: req.params.id,
      viewerEmail: req.body?.viewerEmail || null,
      expiresAt: req.body?.expiresAt || null,
    });
    if (!r.ok) return res.status(r.code === 'forbidden' ? 403 : 400).json({ error: r.error });
    res.json({ ok: true, token: r.token, url: r.url });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

/** POST /api/user/share-grants/:id/revoke — revoke grant (owner-only). */
router.post('/api/user/share-grants/:id/revoke', requireAuth, async (req, res) => {
  try {
    const r = await revokeShareGrant({ userId: uid(req), grantId: req.params.id });
    if (!r.ok) return res.status(r.code === 'forbidden' ? 403 : 400).json({ error: r.error });
    res.json({ ok: true, revoked: true });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

/** GET /share/:token — public share view (link-gated). */
router.get('/share/:token', async (req, res) => {
  const r = await resolveShareToken({ token: req.params.token, viewerEmail: req.query.viewer || '' });
  if (!r.ok) {
    return res.status(404).render('portfolio-share', {
      title: 'Share not available',
      ok: false,
      error: r.error,
      item: null,
      csrfToken: null,
    });
  }
  res.render('portfolio-share', {
    title: 'Shared evidence',
    ok: true,
    error: null,
    item: r.item,
    grant: r.grant,
    csrfToken: null,
  });
});

/**
 * GET /api/user/portfolio/diploma-check — diplom.edu.uz tekshiruv (AUTH C-13 §10-11, P3).
 * -------------------------------------------------------------------------------------
 * Server hech narsa fetch qilmaydi (SSRF yo'q) — faqat manba URL qaytaradi va audit
 * yozadi. Haqiqiy tekshiruv foydalanuvchi brauzerida ochiladi (diplom.edu.uz o'zi UZ IP
 * geofence'ni qo'llaydi — xorijiy IP dan 451). To'liq "Tekshirilgan ✓" flow OneID
 * shartnomasi bilan (C-12 BLOCKED) faollashadi.
 */
router.get('/api/user/portfolio/diploma-check', requireAuth, async (req, res) => {
  try {
    logAuthEvent({
      action: AUDIT_ACTIONS.DIPLOMA_CHECK,
      outcome: 'success',
      method: 'client_redirect',
      actorId: req.session?.user?.safeKey || req.session?.user?.username || null,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      details: { target: 'diploma.edu.uz' },
      channel: 'opendata',
    });
    // Client-side tekshiruv: brauzer to'g'ridan-to'g'ri diplom.edu.uz'ga yo'naltiriladi.
    // Server hech qanday fetch qilmaydi — SSRF yo'q; geofence (UZ IP / 451) diplom.edu.uz'ning o'zida.
    res.redirect(302, 'https://diplom.edu.uz');
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

/** GET /api/user/portfolio/export — transcript PDF (A-12 §13). */
router.get('/api/user/portfolio/export', requireAuth, async (req, res) => {
  try {
    const { buffer, filename, rows } = await buildUserTranscriptPdf({
      userId: uid(req),
      displayName: req.session.user?.display_name || req.session.user?.username || '',
    });
    if (rows === 0) return res.status(404).json({ error: 'No transcript rows yet — import a file first' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(buffer);
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

export default router;
