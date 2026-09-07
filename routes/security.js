/**
 * Deborah — Security Profile & Safe Exam Browser Boundary Routes
 *
 * Prompt 36 (Phase D) REST API:
 *   - GET  /api/admin/security/policy        — institution S0–S4 band + SEB
 *     key registration + managed-device/LAN flags (requireAdmin)
 *   - PUT  /api/admin/security/policy        — upsert institution policy
 *     (validated, idempotent, audited)
 *   - GET  /api/student/assignments/:id/security-profile — sanitized badge +
 *     unsupported-control blocker report for the preflight UI (requireAuth)
 *   - POST /api/student/assignments/:id/security/verify  — server-side SEB
 *     config/key boundary verification (requireAuth)
 *   - GET  /user/security-profile            — profile badge/instruction UI page
 *
 * Security:
 *   - Admin writes are tenant-scoped + audited (SECURITY_POLICY_UPDATE).
 *   - Student badge is whitelist-sanitized — the registered SEB key hash is
 *     never exposed (buildProfileBadge).
 *   - SEB boundary fails CLOSED when the institution has no registered key.
 */

import { Router } from 'express';
import { requireAdmin, requireAuth } from '../middleware/auth.js';
import { fb } from '../firebase/admin.js';
import {
  getInstitutionSecurityPolicy,
  upsertInstitutionSecurityPolicy,
  resolveProfileForAssignment,
  verifySebBoundary,
  getStudentSecurityProfile,
} from '../src/modules/security/index.js';

const router = Router();
// Admin policy API must be admin-gated. Scoped to /api/admin so the router
// (mounted at '/') never intercepts unrelated paths.
router.use('/api/admin', requireAdmin);

function actorId(req) {
  return req.session?.admin?.id || req.session?.user?.id || null;
}

/**
 * Safely parse an optional JSON query parameter. Malformed or non-string
 * values degrade to {} instead of throwing (raw parser errors never leak).
 */
function safeParseQuery(value) {
  if (typeof value !== 'string' || value.trim() === '') return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (_) {
    return {};
  }
}

/** GET /api/admin/security/policy — current institution security policy. */
router.get('/api/admin/security/policy', async (req, res) => {
  try {
    const policy = await getInstitutionSecurityPolicy();
    res.json({ ok: true, policy });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** PUT /api/admin/security/policy — upsert institution policy (audited). */
router.put('/api/admin/security/policy', async (req, res) => {
  try {
    const {
      minProfile,
      maxProfile,
      sebConfigKeyHash,
      requireManagedDevice,
      allowLanMode,
    } = req.body || {};
    const result = await upsertInstitutionSecurityPolicy({
      minProfile,
      maxProfile,
      sebConfigKeyHash,
      requireManagedDevice,
      allowLanMode,
      actorId: actorId(req),
    });
    if (result.ok === false) {
      return res.status(400).json({ error: result.errors?.join('; ') || 'Invalid policy' });
    }
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** GET /api/student/assignments/:id/security-profile — sanitized badge + report. */
router.get('/api/student/assignments/:id/security-profile', async (req, res) => {
  try {
    if (!actorId(req)) return res.status(401).json({ error: 'Authentication required' });
    const result = await getStudentSecurityProfile(
      parseInt(req.params.id, 10),
      safeParseQuery(req.query.attestation),
      safeParseQuery(req.query.client),
    );
    if (!result.ok) {
      return res.status(404).json({ error: result.reason || 'Security profile unavailable' });
    }
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** POST /api/student/assignments/:id/security/verify — SEB boundary verification. */
router.post('/api/student/assignments/:id/security/verify', async (req, res) => {
  try {
    if (!actorId(req)) return res.status(401).json({ error: 'Authentication required' });
    const { sebPresent, configKeyHash, userAgent, profile } = req.body || {};

    // Resolve the effective profile server-side (never trust the client).
    const resolution = await resolveProfileForAssignment(parseInt(req.params.id, 10));
    const effectiveProfile = resolution.ok ? resolution.effective_profile : (profile || 'S0');

    const verdict = await verifySebBoundary({
      sebPresent,
      configKeyHash,
      userAgent: userAgent || req.headers['user-agent'] || '',
      profile: effectiveProfile,
    });

    res.status(verdict.ok ? 200 : 400).json({
      ok: verdict.ok,
      code: verdict.code,
      reason: verdict.reason,
      profile: verdict.profile,
      seb_key_registered: verdict.seb_key_registered,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** GET /user/security-profile — profile badge/instruction UI page. */
router.get('/user/security-profile', async (req, res) => {
  if (!req.session?.user) return res.redirect('/user/login');
  const userKey = req.session.user.safeKey;
  // AUTH A-29: email/breach holati + account copy (i18n)
  let userEmail = null;
  let emailVerified = false;
  let breachFlagged = null;
  try {
    const { getBreachFlag } = await import('../src/modules/auth/account-events.js');
    const { fb } = await import('../firebase/admin.js');
    const eSnap = await fb.get(`users/${userKey}/email`);
    if (eSnap.exists()) userEmail = eSnap.val();
    const vSnap = await fb.get(`users/${userKey}/email_verified`);
    emailVerified = vSnap.exists() && vSnap.val() === true;
    breachFlagged = await getBreachFlag(userKey);
  } catch (_) {}
  // 4 til account copy (user settings'dagi lang)
  let accountCopy = {};
  let rawLang = 'uz';
  try {
    const { resolveAuthLang, AUTH_COPY } = await import('../data/auth-i18n.js');
    let lang = 'uz';
    const { fb } = await import('../firebase/admin.js');
    const langSnap = await fb.get(`users/${userKey}/settings/lang`);
    if (langSnap.exists() && langSnap.val()) lang = langSnap.val();
    rawLang = lang;
    accountCopy = AUTH_COPY[resolveAuthLang(lang)] || {};
  } catch (_) {}
  // C-10: HEMIS bog'lanish holati (REST yoqilganmi / OAuth sozlanganmi / bog'langanmi)
  let hemisStatus = { restEnabled: false, oauthConfigured: false, linked: false, profile: null };
  try {
    const { isRestEnabled, isOAuthConfigured } = await import('../src/modules/auth/providers/hemis.js');
    hemisStatus.restEnabled = isRestEnabled();
    hemisStatus.oauthConfigured = isOAuthConfigured();
    const hSnap = await fb.get(`users/${userKey}/hemis`);
    if (hSnap.exists()) {
      const h = hSnap.val();
      hemisStatus.linked = true;
      hemisStatus.profile = {
        fullName: h.fullName || '',
        university: h.university || '',
        group: h.group || '',
        specialty: h.specialty || '',
        linkedAt: h.linkedAt || 0,
        source: h.source || 'rest',
      };
    }
  } catch (_) {}
  const { USER_PAGES: _UP, pageLangResolve: _plr, PAGE_HTML_LANG: _phl } = await import('../data/user-pages-i18n.js');
  const _l = _plr(typeof rawLang !== 'undefined' ? rawLang : 'uz');
  const _pc = _UP.security;
  res.render('user/security-profile', {
    title: (_pc.h1[_l] || 'Xavfsizlik profili') + ' — Deborah',
    pageTitle: (_pc.h1[_l] || 'Xavfsizlik profili'),
    pageCopy: _pc,
    pageLang: _l,
    htmlLang: _phl[_l] || 'uz',
    user: req.session.user,
    userEmail,
    emailVerified,
    breachFlagged: breachFlagged ? Date.now() : null,
    csrfToken: req.session.csrfToken,
    accountCopy,
    hemisStatus,
  });
});

export default router;
