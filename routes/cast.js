/**
 * Deborah — Cast REST API
 * -----------------------
 * - POST /api/cast/preflight       — safe test metadata (hech qachon answer key yoʻq)
 * - POST /api/cast/sessions        — validated session creation (CSRF + auth)
 * - GET  /cast/:sessionId/director — Director view (owner/co-host only)
 * - GET  /cast/:sessionId/projector — Projector view (one-time ticket redeem)
 * - POST /api/cast/sessions/:id/invites — co-host/moderator invite
 * - POST /api/cast/sessions/:id/invites/redeem
 * - POST /api/cast/sessions/:id/invites/:nonce/revoke
 */

import { Router } from 'express';
import crypto from 'crypto';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { admissionPolicyForTier, TIER_SESSION_CAP, CAST_TIERS } from '../config/realtime.js';
import { CastConfigInputSchema, CastConfigSnapshotSchema, validateCrossField, hashConfig } from '../services/cast/config-schema.js';
import { PRESET_REGISTRY, resolvePreset, DEFAULT_PRESET_ID } from '../services/cast/presets.js';
import { loadCastTest } from '../services/cast/test-loader.js';
import { analyzeTest, recommendTimer } from '../services/cast/capabilities.js';
import { estimateDuration } from '../services/cast/duration-estimator.js';
import {
  createSession,
  countActiveSessions,
  generateSessionId,
  generateJoinCode,
  getSessionMeta,
  getConfig,
  getState,
  getRole,
  upsertRole,
  getPublicQuestion,
  getPublicQuestions,
  listAnswersForQuestion,
} from '../services/cast/session-store.js';
import { initialState } from '../services/cast/state-machine.js';
import { toCastError } from '../services/cast/errors.js';
import { CAST_ROLES, CAST_SCHEMA_VERSION, CAST_PRESETS } from '../utils/cast-constants.js';
import { participantQuestionProjection, directorQuestionProjection } from '../services/cast/projections.js';
// C4-06: child-safe governance — minor-safe preset server'da majburiy
import { applyGovernance, assertPolicyNotBypassed } from '../services/cast/governance-service.js';
// C4-07: data policy — retention pin + legal hold + deletion endpoints
import { resolveRetentionPolicy, policyFingerprint } from '../services/cast/data-policy.js';
// C5-01: action pack — teacher report + student recap
import { writeAudit, getEventsAfter } from '../services/cast/event-store.js';
// C5-02: event replay + teacher reflection
import { replaySessionState, projectTeacherReplay, projectReplayWall, projectStudentReplay, projectAuditReplay, projectWallContent, markDeletedQuestions, REPLAY_CAMERA_PERMISSION } from '../services/cast/replay-service.js';
import { createReflection, updateReflection, projectReflection, REFLECTION_FIELDS } from '../services/cast/reflection-service.js';
// C5-03: psychometric-safe metrics + comparison guard
import { buildMetric, wilsonInterval } from '../services/cast/metrics-service.js';
import { checkCompatibility, sideBySide, equatingStatus } from '../services/cast/comparison-service.js';
// C5-04: analytics event pipeline — dashboard + buffer stats
import { validateAnalyticsEvent, buildAnalyticsEvent, AnalyticsBuffer, safeEmit, summarizeProductMetrics, dedupeEvents, ANALYTICS_EVENTS, ANALYTICS_CATEGORIES, EVENT_CATEGORY_MAP } from '../services/cast/analytics.js';
// C5-08: observability — support bundle + telemetry snapshot
import { buildSupportBundle, assertBundleSafe, browserLabel } from '../services/cast/support-bundle.js';
import { castTelemetrySnapshot, castCounters } from '../services/cast/telemetry.js';
// C4-08: institution governance — effective policy + apply + pin
import {
  resolveEffectivePolicy,
  applyInstitutionPolicy,
  assertInstitutionPolicyNotBypassed,
  isApprovedPreset,
  pinSessionPolicy,
  INSTITUTION_POLICY_ROOT,
} from '../services/cast/institution-policy.js';
import { combinedGovernance } from '../services/cast/governance-service.js';

/**
 * Resolve preset + governance policy birgalikda.
 * MINOR_SAFE preset'da overrides hech qachon policy fieldlarini
 * o'zgartira olmaydi (server-authoritative — tugallanish sharti).
 * @returns {{resolved:object, config:object, applied:string[], violations:string[]}}
 */
function resolveWithGovernance(presetId, overrides) {
  const resolved = resolvePreset(presetId, overrides);
  const isMinorSafe = resolved.preset.id === CAST_PRESETS.MINOR_SAFE;
  // Bypass urinishini tekshiramiz (policy fieldlariga override qilmoqchi bo'lsa)
  const violations = isMinorSafe ? assertPolicyNotBypassed(overrides, 'minor_safe_v1') : [];
  const { config, applied } = applyGovernance(resolved.config, isMinorSafe ? 'minor_safe_v1' : null);
  return { resolved, config, applied, violations };
}

const router = Router();

// ── S18 BUG-116: sessionId whitelist — barcha :id/:sessionId route'larda ──
// generateSessionId() = 'cast_' + base64url(9 bayt) = 12 belgi. Lokal fb adapter
// '..' resolve qiladi (S15 BUG-093 oilasi): traversal sessionId bilan meta/invite/
// replay path'lari orqali mavjudlik-orakli va arb. yo‘l o‘qish mumkin edi.
const CAST_SESSION_ID_RE = /^cast_[A-Za-z0-9_-]{12}$/;
function castSessionParam(req, res, next, value, name) {
  if (typeof value === 'string' && CAST_SESSION_ID_RE.test(value)) return next();
  // API JSON, view route'lari redirect qiladi — status kodini route hal qiladi
  req.castBadSessionId = true;
  if (req.path.startsWith('/api/')) return res.status(404).json({ ok: false, error: { code: 'SESSION_NOT_FOUND', message: 'Sessiya topilmadi' } });
  return res.redirect(req.session?.user ? '/user/panel' : '/play');
}
router.param('id', castSessionParam);
router.param('sessionId', castSessionParam);

// ── S18 BUG-119: /cast/qr public — per-IP rate limit (CPU DoS oldini olish) ──
const QR_LIMIT = 30; // 1 daqiqa
const QR_WINDOW = 60_000;
const qrHits = new Map();
function qrLimited(ip) {
  const now = Date.now();
  const key = String(ip || 'unknown');
  const arr = (qrHits.get(key) || []).filter((ts) => now - ts < QR_WINDOW);
  if (arr.length >= QR_LIMIT) return true;
  arr.push(now);
  qrHits.set(key, arr);
  if (qrHits.size > 5000) qrHits.delete(qrHits.keys().next().value);
  return false;
}


// C4-08: institution policy yuklash (dynamic import — test izolyatsiyasi)
async function loadInstitutionPolicies(tenantId) {
  const { fb } = await import('../firebase/admin.js');
  const snap = await fb.get(`${INSTITUTION_POLICY_ROOT()}/${tenantId}`);
  return snap.exists() ? Object.values(snap.val() || {}) : [];
}

// ── Preflight: POST /api/cast/preflight ──
router.post('/api/cast/preflight', requireAuth, async (req, res) => {
  try {
    if (await castHostDeniedFor(req)) {
      return res.status(403).json({ ok: false, error: { code: 'NOT_AUTHORIZED', message: "VIP talaba uchun Cast yopiq — yakkaxon tayyorlanish (Mashq/Sinov) ishlating" } });
    }
    const { source, draftConfig = {} } = req.body || {};
    if (!source || !source.type || !source.key) {
      return res.status(400).json({ ok: false, error: { code: 'CAST_CONFIG_INVALID', message: 'Manba ko‘rsatilmagan' } });
    }

    const loaded = await loadCastTest(source, req.session?.user);
    const analysis = analyzeTest(loaded.publicQuestions, loaded.privateQuestions);

    // Resolve preset defaults (server authoritative) for capability/duration estimate
    const presetId = draftConfig.presetId || DEFAULT_PRESET_ID;
    // C4-06: governance (minor-safe) resolve'ga qo'llanadi
    const { resolved, config: governed } = resolveWithGovernance(presetId, draftConfig.overrides || {});
    const mergedForEstimate = { ...governed, timer: { mode: 'soft', defaultSeconds: 30, ...governed.timer }, leaderboard: governed.leaderboard, teams: governed.teams || { enabled: false } };
    const duration = estimateDuration({ config: mergedForEstimate, questionCount: loaded.publicQuestions.length });

    const preflightId = 'pf_' + crypto.randomBytes(8).toString('hex');
    const expiresAt = Date.now() + 10 * 60 * 1000; // 10 min

    // Preflight receipt (server-side, in-memory + hash check on create)
    // S18 BUG-120: receiptlar hech qachon tozalanmasdi — har preflight sessiya
    // obyektini shishirardi (eski TTL o'tganlarini olib tashla + cap 10)
    const receipts = req.session.castPreflight = req.session.castPreflight || {};
    const nowMs = Date.now();
    for (const k of Object.keys(receipts)) {
      if (receipts[k]?.expiresAt < nowMs) delete receipts[k];
    }
    const receiptKeys = Object.keys(receipts);
    if (receiptKeys.length >= 10) delete receipts[receiptKeys[0]];
    receipts[preflightId] = {
      source: loaded.testId ? { type: source.type, key: source.key, chunk: source.chunk || null } : source,
      testId: loaded.testId,
      testVersion: loaded.testVersion,
      itemSetHash: loaded.itemSetHash,
      presetId,
      expiresAt,
      questionCount: loaded.publicQuestions.length,
    };

    return res.json({
      ok: true,
      preflightId,
      expiresAt,
      test: {
        title: loaded.title,
        questionCount: loaded.publicQuestions.length,
        typeCounts: analysis.typeCounts,
      },
      capabilities: {
        supportsTeams: analysis.supportsTeams,
        supportsAnswerShuffle: analysis.supportsAnswerShuffle,
        supportsPartialCredit: analysis.supportsPartialCredit,
      },
      blockers: analysis.blockers,
      warnings: analysis.warnings,
      estimatedDurationSeconds: duration.expectedSeconds,
      duration: duration,
      presets: Object.values(PRESET_REGISTRY).map((p) => ({ id: p.id, version: p.version, labelKey: p.labelKey, recommended: p.recommended })),
      // C4-08 (item 11): institution policy — Setup Studio locked fieldlar read-only
      institutionPolicy: await (async () => {
        try {
          const all = await loadInstitutionPolicies(req.session?.user?.tenantId || 'default');
          const eff = resolveEffectivePolicy(all);
          if (!eff) return null;
          return {
            policyId: eff.policyId,
            version: eff.version,
            approvedPresets: eff.approvedPresets || [],
            lockedFields: eff.lockedFields || {},
            limits: eff.limits || {},
          };
        } catch {
          return null;
        }
      })(),
    });
  } catch (err) {
    const e = toCastError(err);
    const status = ['NOT_AUTHORIZED'].includes(e.code) ? 403 : 400;
    return res.status(status).json({ ok: false, error: e });
  }
});

// ── S24 (QA STEP 104, BUG-230ka310a/hz153): VIP talaba Cast HOST qila olmaydi ──
// User qarori: VIP = yakkaxon tayyorlanish (mock/pre/AI); oddiy student o'zi
// yaratgan / ommaviy testiga Cast qiladi; teacher/admin boshqaradi.
// Server-side majburiy — UI yashirishning o'zi yetarli emas.
async function castHostDeniedFor(req) {
  const u = req.session?.user;
  if (!u) return true;
  if (u.role === 'student') {
    try {
      const { fb } = await import('../firebase/admin.js');
      const snap = await fb.get(`users/${u.safeKey}/isVip`);
      if (snap.exists() && snap.val() === true) return true;
    } catch (_) { /* fb xatosi — sessiya rolini bloklamaymiz */ }
  }
  return false;
}

// ── Session create: POST /api/cast/sessions ──
// AUTH A-19 §08/§14: pending/rejected teacher cast session YARATA OLMAYDI.
router.post('/api/cast/sessions', requireAuth, async (req, res) => {
  const _sRole = req.session?.user?.role;
  if (_sRole === 'teacher_pending' || _sRole === 'teacher_rejected') {
    return res.status(403).json({ error: 'Ruxsat etilmagan rol' });
  }
  // S24 (BUG-230ka310a): VIP talaba ham Cast session yarata olmaydi
  if (await castHostDeniedFor(req)) {
    return res.status(403).json({ error: 'VIP talaba uchun Cast yopiq' });
  }
  try {
    const { requestId, preflightId, source, presetId, overrides = {}, choreographyTemplateId, environment = 'production', tier } = req.body || {};

    // C5-06 (item 14): Redis unavailable bo'lsa new XXL session admission BLOK.
    // XXL tier faqat multi-node (redis_streams) rejimida ishlaydi.
    if (tier === 'XXL') {
      const redisOk = !!(req.app.get('redisOk'));
      const pol = admissionPolicyForTier('XXL', { redisOk });
      if (!pol.admitted) {
        return res.status(503).json({ ok: false, error: { code: 'ADMISSION_DENIED', reason: pol.reason, message: pol.message } });
      }
    }

    // ── C5-09 (item 20): certified tier cap — active sessionlar soni tier
    //    cap'idan oshsa yangi session rad etiladi (capacity certification).
    //    Faqat `tier` ko'rsatilganda qo'llanadi (default so'rovlar cheklanmaydi).
    if (tier && CAST_TIERS.includes(tier)) {
      const cap = TIER_SESSION_CAP[tier];
      const activeCount = await countActiveSessions();
      if (activeCount >= cap) {
        return res.status(503).json({
          ok: false,
          error: {
            code: 'ADMISSION_DENIED',
            reason: 'TIER_CAP_REACHED',
            message: `${tier} tier uchun certified limit yetgan (${activeCount}/${cap} active session)`,
          },
        });
      }
    }

    // Idempotency: same requestId returns existing session
    if (requestId) {
      const pending = req.session.castPending = req.session.castPending || {};
      if (pending[requestId]) {
        return res.json({ ok: true, ...pending[requestId], replayed: true });
      }
    }

    // 1. Validate input config shape (presetId + overrides)
    const inputParse = CastConfigInputSchema.safeParse({ presetId, overrides });
    if (!inputParse.success) {
      return res.status(400).json({
        ok: false,
        error: {
          code: 'CAST_CONFIG_INVALID',
          fields: inputParse.error.issues.map((i) => ({ path: i.path.join('.'), code: i.code, message: i.message })),
        },
      });
    }

    // 2. Preflight receipt check
    const receipts = req.session.castPreflight || {};
    const receipt = preflightId ? receipts[preflightId] : null;
    if (!receipt || receipt.expiresAt < Date.now()) {
      return res.status(400).json({ ok: false, error: { code: 'PREFLIGHT_INVALID', message: 'Preflight muddati o‘tgan yoki topilmadi' } });
    }

    // 3. Load + verify snapshot server-side (ownership again, source hash)
    const loaded = await loadCastTest(source || receipt.source, req.session?.user);
    if (receipt.itemSetHash && receipt.itemSetHash !== loaded.itemSetHash) {
      return res.status(400).json({ ok: false, error: { code: 'PREFLIGHT_INVALID', message: 'Test o‘zgarganda sessiya ochib bo‘lmaydi' } });
    }

    // 4. Resolve final config + governance + cross-field validation
    // 🔴 C4-06 review fix: preset har doim receipt'dan (preflight'dan) olinadi —
    // server-authoritative. Client create'da boshqa preset yuborsa ham e'tiborsiz
    // qoldiriladi: preflight minor_safe bo'lsa create'da ungoverned preset bilan
    // bypass qilib bo'lmaydi (tugallanish sharti).
    const effectivePresetId = receipt.presetId;
    const isMinorSafe = effectivePresetId === CAST_PRESETS.MINOR_SAFE;
    const { resolved, config: merged, violations } = resolveWithGovernance(effectivePresetId, overrides);
    // C4-06: minor-safe overrides'ni chetlab o'tish → config_invalid (bypass blok)
    if (violations.length > 0) {
      return res.status(400).json({ ok: false, error: { code: 'CAST_CONFIG_INVALID', fields: violations.map((p) => ({ path: p, code: 'GOVERNANCE_LOCKED', message: 'Bu sozlamani minor-safe rejimda o‘zgartirib bo‘lmaydi' })) } });
    }
    // ── C4-08: institution governance — effective policy'ni qo'llash ──
    // Tenant scope: session'ni ochgan teacher'ning tenantId (default 'default').
    // Locked field'lar server-authoritative — client override qila olmaydi.
    const institutionTenant = req.session?.user?.tenantId || 'default';
    const allPolicies = await loadInstitutionPolicies(institutionTenant);
    const effectivePolicy = resolveEffectivePolicy(allPolicies);
    // Approved preset check (item 2): bo'sh ro'yxat = cheklov yo'q
    if (effectivePolicy && !isApprovedPreset(effectivePolicy, effectivePresetId)) {
      return res.status(400).json({ ok: false, error: { code: 'CAST_CONFIG_INVALID', fields: [{ path: 'presetId', code: 'PRESET_NOT_APPROVED', message: 'Bu preset institution policy tomonidan ruxsat etilmagan' }] } });
    }
    // Locked field override urinishi → reject (item 12)
    const instBypass = effectivePolicy ? assertInstitutionPolicyNotBypassed(overrides, effectivePolicy) : [];
    if (instBypass.length > 0) {
      return res.status(400).json({ ok: false, error: { code: 'CAST_CONFIG_INVALID', fields: instBypass.map((p) => ({ path: p, code: 'GOVERNANCE_LOCKED', message: 'Bu sozlamani institution policy o‘zgartirishga ruxsat bermaydi' })) } });
    }
    // Locked field qiymatlarini majburlash + limit'larni clamp (server-side)
    let instApplied = [];
    let instClamped = [];
    if (effectivePolicy) {
      const appliedRes = applyInstitutionPolicy(merged, effectivePolicy);
      instApplied = appliedRes.applied;
      instClamped = appliedRes.clamped;
    }
    const cross = validateCrossField(merged);
    if (cross.errors.length > 0) {
      return res.status(400).json({ ok: false, error: { code: 'CAST_CONFIG_INVALID', fields: cross.errors } });
    }
    // Governance majburiy qilgan fieldlar snapshot'ga yoziladi
    // (customized flag preset'dan og'ish bo'lsa true — governance ham preset
    // defaults'idan farq qilishi mumkin, lekin customized'ni sun'iy ko'paytirmaymiz)
    resolved.config = merged;

    const configSnapshot = {
      schemaVersion: CAST_SCHEMA_VERSION,
      preset: { id: resolved.preset.id, version: resolved.preset.version, customized: resolved.customized },
      source: { type: source?.type || receipt.source.type, key: source?.key || receipt.source.key, chunk: source?.chunk || receipt.source.chunk || null },
      pace: merged.pace,
      playback: merged.playback,
      timer: merged.timer,
      scoring: merged.scoring,
      leaderboard: merged.leaderboard,
      feedback: merged.feedback,
      join: merged.join,
      presentation: merged.presentation,
      teams: merged.teams || { enabled: false, mode: 'individual_then_aggregate', assignment: 'random', count: 4, scoreAggregation: 'normalized_average', talkEnabled: true, talkSeconds: 60, reporterRotation: true, tiePolicy: 'first_answered' },
      responsiveTeaching: merged.responsiveTeaching,
      moderation: merged.moderation,
      accessibility: merged.accessibility,
      participation: merged.participation,
      localization: merged.localization,
      dataLifecycle: {
        ...merged.dataLifecycle,
        // C4-07 (item 4): policy versionni sessiya snapshotga pin qilish
        pinnedPolicyHash: policyFingerprint(resolveRetentionPolicy(merged.dataLifecycle?.policyId, merged.dataLifecycle?.classOverrides)),
      },
      resilience: merged.resilience,
      postCast: merged.postCast,
      ai: merged.ai,
      // C4-08 (item 6/10): recording + media — SECTION_FILL orqali preset'da bo'lsa ham
      recording: merged.recording || { enabled: false, modality: 'none', retentionClass: 'camera_mic' },
      media: merged.media || { lazyLoadThemes: true, externalImages: 'block', maxDimensionPx: 1920 },
      personalProgress: merged.personalProgress || { visibility: 'private' },
      classGoal: merged.classGoal || { enabled: false, type: 'accuracy_threshold', target: 80 },
      // C3-16 Self-Paced Race
      selfPaced: merged.selfPaced || {
        enabled: false,
        perQuestionSeconds: 60,
        randomizeOrder: true,
        lateJoinStart: 'first',
        lateJoinPosition: 0,
        rankVisibility: 'private',
        publicLiveRank: false,
        fairnessWindowSeconds: 30,
      },
      // C3-17 Power-ups — default OFF
      powerUps: merged.powerUps || {
        enabled: false,
        allowedTypes: [],
        startingInventory: {},
        extraTimeSeconds: 15,
        teamConsistent: true,
      },
      // C5-05 (item 7): perf feature flags — safeNextPrefetch default OFF (opt-in)
      perf: merged.perf || {
        safeNextPrefetch: false,
        timerUpdateMs: 1000,
        answerCountCoalesceMs: 120,
      },
    };

    const parsedSnapshot = CastConfigSnapshotSchema.safeParse(configSnapshot);
    if (!parsedSnapshot.success) {
      return res.status(400).json({
        ok: false,
        error: { code: 'CAST_CONFIG_INVALID', fields: parsedSnapshot.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) },
      });
    }
    const finalConfig = parsedSnapshot.data;

    // 5. Create session
    const sessionId = generateSessionId();
    const joinCode = generateJoinCode();
    const actorId = `user:${req.session?.user?.safeKey || req.session?.user?.username}`;

    // C3-14: choreography — immutable snapshot (item 12)
    let choreography = null;
    if (choreographyTemplateId) {
      const { getTemplate, validateTemplate, buildRuntime } = await import('../services/cast/choreography-service.js');
      const tpl = await getTemplate(actorId, choreographyTemplateId);
      if (!tpl) {
        return res.status(400).json({ ok: false, error: { code: 'TEMPLATE_INVALID', message: 'Choreography template topilmadi' } });
      }
      const v = validateTemplate(tpl);
      if (!v.valid) {
        return res.status(400).json({ ok: false, error: { code: 'TEMPLATE_INVALID', message: v.errors.join('; ') } });
      }
      choreography = buildRuntime(tpl, actorId);
    }
    const state = initialState({ primaryDirectorId: actorId, questionCount: loaded.publicQuestions.length, choreography });

    await createSession({
      sessionId,
      joinCode,
      meta: {
        testId: loaded.testId,
        testVersion: loaded.testVersion,
        itemSetHash: loaded.itemSetHash,
        configHash: hashConfig(finalConfig),
        title: loaded.title,
        status: 'lobby',
        lobbyLocked: false,
        ownerActorId: actorId,
        // C4-10: oddiy (simple studio) sessiya — director'da ilg'or vositalar yashirinadi
        ui: req.body?.simple ? 'simple' : 'full',
        // C3-15: rehearsal session — simulation data production metriclarga kirmaydi
        environment: environment === 'simulation' ? 'simulation' : 'production',
        rehearsal: environment === 'simulation',
        // C4-08 (item 9): institution policy version pin — existing session
        // o'z version'ida qoladi (yangi policy e'lon qilinsa ham)
        institutionPolicy: effectivePolicy ? pinSessionPolicy(effectivePolicy) : null,
        governance: {
          institutionApplied: instApplied,
          institutionClamped: instClamped,
        },
      },
      config: finalConfig,
      state,
      privateQuestions: loaded.privateQuestions,
      publicQuestions: loaded.publicQuestions,
    });

    // 6. Owner role record
    await upsertRole(sessionId, {
      actorId,
      role: CAST_ROLES.OWNER,
      sessionId,
      permissionsVersion: 1,
      revokedAt: null,
      grantedAt: Date.now(),
    });

    // 7. Projector one-time ticket
    const projectorTicket = crypto.randomBytes(24).toString('hex');
    await getSessionMeta(sessionId); // ensure exists
    await upsertProjectorTicket(sessionId, projectorTicket);

    // Consume preflight receipt
    delete receipts[preflightId];

    // Idempotency bookkeeping
    const resultPayload = {
      sessionId,
      joinCode,
      revision: 1,
      directorUrl: `/cast/${sessionId}/director`,
      projectorUrl: `/cast/${sessionId}/projector?t=${projectorTicket}`,
      joinUrl: `/play?code=${joinCode}`,
    };
    if (requestId) {
      req.session.castPending[requestId] = resultPayload;
    }

    return res.json({ ok: true, ...resultPayload });
  } catch (err) {
    console.error('[cast] session create error:', err && err.stack ? err.stack.split('\n').slice(0, 6).join('\n') : err);
    const e = toCastError(err);
    const status = ['NOT_AUTHORIZED'].includes(e.code) ? 403 : ['SESSION_NOT_FOUND'].includes(e.code) ? 404 : 400;
    return res.status(status).json({ ok: false, error: e });
  }
});

// ── C3-15 Rehearsal: simulation session yaratish ──
router.post('/api/cast/rehearsal', requireAuth, async (req, res) => {
  try {
    const { preflightId, source, presetId, overrides = {} } = req.body || {};
    // Simulation session — create-session logikasini environment=simulation bilan qayta ishlatadi
    const loaded = await loadCastTest(source, req.session?.user);
    const analysis = analyzeTest(loaded.publicQuestions, loaded.privateQuestions);
    const { resolved, config: governedConfig, violations } = resolveWithGovernance(presetId || DEFAULT_PRESET_ID, overrides || {});
    // C4-06: minor-safe bypass blok
    if (violations.length > 0) {
      return res.status(400).json({ ok: false, error: { code: 'CAST_CONFIG_INVALID', fields: violations.map((p) => ({ path: p, code: 'GOVERNANCE_LOCKED', message: 'Bu sozlamani minor-safe rejimda o‘zgartirib bo‘lmaydi' })) } });
    }
    // C4-08: institution governance — rehearsal'da ham policy qo'llanadi (bypass emas)
    const institutionTenant = req.session?.user?.tenantId || 'default';
    const allPolicies = await loadInstitutionPolicies(institutionTenant);
    const effectivePolicy = resolveEffectivePolicy(allPolicies);
    if (effectivePolicy && !isApprovedPreset(effectivePolicy, presetId || DEFAULT_PRESET_ID)) {
      return res.status(400).json({ ok: false, error: { code: 'CAST_CONFIG_INVALID', fields: [{ path: 'presetId', code: 'PRESET_NOT_APPROVED', message: 'Bu preset institution policy tomonidan ruxsat etilmagan' }] } });
    }
    const instBypass = effectivePolicy ? assertInstitutionPolicyNotBypassed(overrides || {}, effectivePolicy) : [];
    if (instBypass.length > 0) {
      return res.status(400).json({ ok: false, error: { code: 'CAST_CONFIG_INVALID', fields: instBypass.map((p) => ({ path: p, code: 'GOVERNANCE_LOCKED', message: 'Bu sozlamani institution policy o‘zgartirishga ruxsat bermaydi' })) } });
    }
    if (effectivePolicy) applyInstitutionPolicy(governedConfig, effectivePolicy);
    const cross = validateCrossField(governedConfig);
    if (cross.errors.length > 0) {
      return res.status(400).json({ ok: false, error: { code: 'CAST_CONFIG_INVALID', fields: cross.errors } });
    }
    resolved.config = governedConfig;
    const sessionId = generateSessionId();
    const joinCode = generateJoinCode();
    const actorId = `user:${req.session?.user?.safeKey || req.session?.user?.username}`;
    const state = initialState({ primaryDirectorId: actorId, questionCount: loaded.publicQuestions.length });
    await createSession({
      sessionId,
      joinCode,
      meta: {
        testId: loaded.testId,
        testVersion: loaded.testVersion,
        itemSetHash: loaded.itemSetHash,
        configHash: hashConfig(resolved.config),
        title: loaded.title,
        status: 'lobby',
        lobbyLocked: false,
        ownerActorId: actorId,
        environment: 'simulation',
        rehearsal: true,
        createdFor: 'quality_lab',
      },
      config: resolved.config,
      state,
      privateQuestions: loaded.privateQuestions,
      publicQuestions: loaded.publicQuestions,
    });
    await upsertRole(sessionId, {
      actorId,
      role: CAST_ROLES.OWNER,
      sessionId,
      permissionsVersion: 1,
      revokedAt: null,
      grantedAt: Date.now(),
    });
    return res.json({
      ok: true,
      sessionId,
      joinCode,
      environment: 'simulation',
      rehearsal: true,
      directorUrl: `/cast/${sessionId}/director`,
      qualityLabUrl: `/cast/${sessionId}/quality-lab`,
    });
  } catch (err) {
    const e = toCastError(err);
    return res.status(400).json({ ok: false, error: e });
  }
});

// ── C3-15 Rehearsal: bot scenario (item 3-6) ──
router.post('/api/cast/rehearsal/:id/bots', requireAuth, async (req, res) => {
  try {
    const { id: sessionId } = req.params;
    const actorId = `user:${req.session?.user?.safeKey || req.session?.user?.username}`;
    const role = await getRole(sessionId, actorId);
    if (!role || !['owner', 'co_host'].includes(role.role)) {
      return res.status(403).json({ ok: false, error: { code: 'NOT_AUTHORIZED', message: 'Faqat egasi botlarni boshqaradi' } });
    }
    const { scenarioId, count = 10 } = req.body || {};
    const { startScenario } = await import('../services/cast/bot-simulator.js');
    const result = await startScenario({ sessionId, scenarioId, count });
    res.json({ ok: true, ...result });
  } catch (err) {
    const e = toCastError(err);
    const status = ['NOT_AUTHORIZED'].includes(e.code) ? 403 : 400;
    res.status(status).json({ ok: false, error: e });
  }
});

router.post('/api/cast/rehearsal/:id/bots/stop', requireAuth, async (req, res) => {
  try {
    const { id: sessionId } = req.params;
    const actorId = `user:${req.session?.user?.safeKey || req.session?.user?.username}`;
    const role = await getRole(sessionId, actorId);
    if (!role || !['owner', 'co_host'].includes(role.role)) {
      return res.status(403).json({ ok: false, error: { code: 'NOT_AUTHORIZED' } });
    }
    const { stopBots } = await import('../services/cast/bot-simulator.js');
    stopBots(sessionId);
    res.json({ ok: true, stopped: true });
  } catch (err) {
    const e = toCastError(err);
    res.status(400).json({ ok: false, error: e });
  }
});

// ── C3-15 Rehearsal: reset/stop (item 8) ──
router.post('/api/cast/rehearsal/:id/reset', requireAuth, async (req, res) => {
  try {
    const { id: sessionId } = req.params;
    const actorId = `user:${req.session?.user?.safeKey || req.session?.user?.username}`;
    const role = await getRole(sessionId, actorId);
    if (!role || !['owner', 'co_host'].includes(role.role)) {
      return res.status(403).json({ ok: false, error: { code: 'NOT_AUTHORIZED' } });
    }
    const { resetRehearsal } = await import('../services/cast/rehearsal-service.js');
    const result = await resetRehearsal(sessionId, actorId);
    res.json({ ok: true, ...result });
  } catch (err) {
    const e = toCastError(err);
    res.status(400).json({ ok: false, error: e });
  }
});

router.post('/api/cast/rehearsal/:id/stop', requireAuth, async (req, res) => {
  try {
    const { id: sessionId } = req.params;
    const actorId = `user:${req.session?.user?.safeKey || req.session?.user?.username}`;
    const role = await getRole(sessionId, actorId);
    if (!role || !['owner', 'co_host'].includes(role.role)) {
      return res.status(403).json({ ok: false, error: { code: 'NOT_AUTHORIZED' } });
    }
    const { stopRehearsal } = await import('../services/cast/rehearsal-service.js');
    const result = await stopRehearsal(sessionId);
    res.json({ ok: true, ...result });
  } catch (err) {
    const e = toCastError(err);
    res.status(400).json({ ok: false, error: e });
  }
});

// ── C3-15 Quality Lab: preflight/postflight/findings (items 9-12) ──
router.post('/api/cast/quality/preflight', requireAuth, async (req, res) => {
  try {
    const { source, config = {} } = req.body || {};
    if (!source || !source.type || !source.key) {
      return res.status(400).json({ ok: false, error: { code: 'CAST_CONFIG_INVALID', message: 'Manba koʻrsatilmagan' } });
    }
    const loaded = await loadCastTest(source, req.session?.user);
    const { runPreflight } = await import('../services/cast/quality-lab.js');
    const findings = runPreflight({
      publicQuestions: loaded.publicQuestions,
      privateQuestions: loaded.privateQuestions,
      config,
    });
    const { buildReport } = await import('../services/cast/quality-lab.js');
    res.json({ ok: true, findings, report: buildReport(findings), title: loaded.title, questionCount: loaded.publicQuestions.length });
  } catch (err) {
    const e = toCastError(err);
    res.status(400).json({ ok: false, error: e });
  }
});

router.post('/api/cast/quality/postflight', requireAuth, async (req, res) => {
  try {
    const { sessionId } = req.body || {};
    const actorId = `user:${req.session?.user?.safeKey || req.session?.user?.username}`;
    const role = await getRole(sessionId, actorId);
    if (!role || !['owner', 'co_host'].includes(role.role)) {
      return res.status(403).json({ ok: false, error: { code: 'NOT_AUTHORIZED' } });
    }
    const { runPostflightForSession, buildReport, listFindings } = await import('../services/cast/quality-lab.js');
    const findings = await runPostflightForSession(sessionId);
    res.json({ ok: true, findings, report: buildReport(findings), all: await listFindings(sessionId) });
  } catch (err) {
    const e = toCastError(err);
    res.status(400).json({ ok: false, error: e });
  }
});

router.post('/api/cast/quality/findings/:id/status', requireAuth, async (req, res) => {
  try {
    const { id: findingId } = req.params;
    const { sessionId, status } = req.body || {};
    const actorId = `user:${req.session?.user?.safeKey || req.session?.user?.username}`;
    const role = await getRole(sessionId, actorId);
    if (!role || !['owner', 'co_host'].includes(role.role)) {
      return res.status(403).json({ ok: false, error: { code: 'NOT_AUTHORIZED' } });
    }
    const { updateFindingStatus } = await import('../services/cast/quality-lab.js');
    const updated = await updateFindingStatus(sessionId, findingId, status, actorId);
    res.json({ ok: true, finding: updated });
  } catch (err) {
    const e = toCastError(err);
    res.status(400).json({ ok: false, error: e });
  }
});

// ── C3-15 Quality Lab: GET findings (view yuklanishida analizni qayta ishga tushirmaydi) ──
router.get('/api/cast/quality/:id/findings', requireAuth, async (req, res) => {
  try {
    const { id: sessionId } = req.params;
    const actorId = `user:${req.session?.user?.safeKey || req.session?.user?.username}`;
    const role = await getRole(sessionId, actorId);
    if (!role || !['owner', 'co_host'].includes(role.role)) {
      return res.status(403).json({ ok: false, error: { code: 'NOT_AUTHORIZED' } });
    }
    const { listFindings } = await import('../services/cast/quality-lab.js');
    const all = await listFindings(sessionId);
    res.json({ ok: true, all });
  } catch (err) {
    const e = toCastError(err);
    res.status(400).json({ ok: false, error: e });
  }
});

// ── C3-15 Quality Lab: session-based preflight (view'da source yo'q — sessiya savollari ustida) ──
router.post('/api/cast/quality/:id/preflight', requireAuth, async (req, res) => {
  try {
    const { id: sessionId } = req.params;
    const actorId = `user:${req.session?.user?.safeKey || req.session?.user?.username}`;
    const role = await getRole(sessionId, actorId);
    if (!role || !['owner', 'co_host'].includes(role.role)) {
      return res.status(403).json({ ok: false, error: { code: 'NOT_AUTHORIZED' } });
    }
    const { getPublicQuestions, getPrivateQuestions } = await import('../services/cast/session-store.js');
    const { runPreflight, buildReport, persistFindings, listFindings } = await import('../services/cast/quality-lab.js');
    const pub = await getPublicQuestions(sessionId);
    const priv = await getPrivateQuestions(sessionId);
    const config = await getConfig(sessionId);
    const findings = runPreflight({
      publicQuestions: Object.values(pub || {}),
      privateQuestions: Object.values(priv || {}),
      config: config || {},
    });
    await persistFindings(sessionId, 'preflight', findings);
    res.json({ ok: true, findings, report: buildReport(findings), all: await listFindings(sessionId) });
  } catch (err) {
    const e = toCastError(err);
    res.status(400).json({ ok: false, error: e });
  }
});

// ── C3-15 Quality Lab view ──
router.get('/cast/:sessionId/quality-lab', requireAuth, async (req, res) => {
  try {
    const { sessionId } = req.params;
    const actorId = `user:${req.session?.user?.safeKey || req.session?.user?.username}`;
    const role = await getRole(sessionId, actorId);
    if (!role || !['owner', 'co_host'].includes(role.role)) {
      return res.status(403).json({ error: 'Siz bu sessiyani boshqara olmaysiz' });
    }
    const meta = await getSessionMeta(sessionId);
    if (!meta) return res.redirect('/user/panel');
    const { isRehearsal } = await import('../services/cast/rehearsal-service.js');
    res.render('cast/quality-lab', {
      title: `Quality Lab — ${meta.title || sessionId}`,
      boot: {
        sessionId,
        joinCode: meta.joinCode || null,
        // C4-10: oddiy rejim + QR uchun join link
        simple: meta.ui === 'simple',
        joinUrl: `${req.protocol}://${req.get('host')}/play?code=${encodeURIComponent(meta.joinCode || '')}`,
        actor: { id: actorId, role: role.role },
        csrfToken: req.session.csrfToken,
        title: meta.title || 'Cast',
        rehearsal: isRehearsal(meta),
      },
      characters: [],
    });
  } catch (err) {
    console.error('Quality lab route error:', err.message);
    res.redirect('/user/panel');
  }
});

// ── Director view: GET /cast/:sessionId/director ──
/** GET /api/cast/sessions/:id/meta — director lobbi meta (BUG-021: 404 edi, o'lik chaqiruv) */
router.get('/api/cast/sessions/:id/meta', requireAuth, async (req, res) => {
  try {
    const sessionId = req.params.id;
    // S18 BUG-115: role tekshiruvi YO'Q edi — har qanday auth user HAR QANDAY
    // sessiyaning joinCode'ini olib, begona live sessiyaga qo'shila olardi.
    // /meta faqat director (staff) ishlatadi (cast-director.js:187).
    const actorIdM = `user:${req.session?.user?.safeKey || req.session?.user?.username}`;
    const roleM = await getRole(sessionId, actorIdM);
    if (!roleM) return res.status(403).json({ ok: false, error: { code: 'NOT_AUTHORIZED', message: 'Siz bu sessiyaga tegishli emassiz' } });
    const { getSessionMeta, getState } = await import('../services/cast/session-store.js');
    const meta = await getSessionMeta(sessionId);
    if (!meta) return res.status(404).json({ ok: false, error: 'not_found' });
    const state = await getState(sessionId);
    return res.json({
      ok: true,
      sessionId,
      title: meta.title || '',
      joinCode: meta.joinCode || '',
      createdAt: meta.created_at || null,
      phase: state?.phase || 'lobby',
      revision: state?.revision || 1,
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: 'server_error' });
  }
});

router.get('/cast/:sessionId/director', requireAuth, async (req, res) => {
  try {
    const { sessionId } = req.params;
    const actorId = `user:${req.session?.user?.safeKey || req.session?.user?.username}`;
    const role = await getRole(sessionId, actorId);
    // C3-10: moderator scoped access — wall/confusion moderation uchun
    if (!role || !['owner', 'co_host', 'moderator'].includes(role.role)) {
      return res.status(403).json({ error: 'Siz bu sessiyani boshqara olmaysiz' });
    }
    const meta = await getSessionMeta(sessionId);
    if (!meta) return res.redirect('/user/panel');

    const config = await getConfig(sessionId);
    const state = await getState(sessionId);

    // C3-08: Director item picker uchun savollar roʻyxati (answer keyʻsiz, faqat text + id)
    const pubQuestions = await getPublicQuestions(sessionId);
    const questionList = Object.entries(pubQuestions || {}).map(([qid, q]) => ({
      id: qid,
      text: q.text || qid,
      type: q.type || 'single_choice',
    }));

    res.render('cast/director', {
      title: `Cast — ${meta.title || sessionId}`,
      boot: {
        sessionId,
        joinCode: meta.joinCode || null,
        // C4-10: oddiy rejim + QR join link
        simple: meta.ui === 'simple',
        joinUrl: `${req.protocol}://${req.get('host')}/play?code=${encodeURIComponent(meta.joinCode || '')}`,
        actor: { id: actorId, role: role.role },
        csrfToken: req.session.csrfToken,
        // C4-05: UI locale config'dan
        locale: config?.localization?.locale || 'uz-Latn',
        socketPath: '/socket.io',
        initialRevision: state?.revision || 1,
        title: meta.title || 'Cast sessiyasi',
        config: {
          timer: config?.timer,
          playback: config?.playback,
          leaderboard: config?.leaderboard,
          presentation: config?.presentation,
          // C3-16 Self-Paced Race
          pace: config?.pace,
          selfPaced: config?.selfPaced,
          // C3-17 Power-ups
          powerUps: config?.powerUps,
          // C4-01 Team Challenge
          teams: config?.teams,
          // C4-03 Paper-card mode
          participation: config?.participation,
        },
        questions: questionList,
      },
      characters: [],
    });
  } catch (err) {
    console.error('Director route error:', err.message);
    res.redirect('/user/panel');
  }
});

// ── S30.02: QR endpoint — GET /cast/qr?d=<url> (SVG) ──
router.get('/cast/qr', async (req, res) => {
  try {
    // S18 BUG-119: public endpoint — cheksiz QR generatsiya (CPU) DoS og'ri
    if (qrLimited(req.ip)) return res.status(429).json({ error: 'rate_limited' });
    const data = String(req.query.d || '').slice(0, 200);
    if (!data || !/^[a-z0-9:/.?&=_%#-]+$/i.test(data)) {
      return res.status(400).json({ error: 'invalid qr data' });
    }
    const QRCode = (await import('qrcode')).default;
    const svg = await QRCode.toString(data, { type: 'svg', width: 320, margin: 1, errorCorrectionLevel: 'M' });
    res.type('image/svg+xml').send(svg);
  } catch (err) {
    res.status(400).json({ error: 'qr error' });
  }
});

// ── Projector view: GET /cast/:sessionId/projector?t=... ──
router.get('/cast/:sessionId/projector', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { t } = req.query;
    const ok = await redeemProjectorTicket(sessionId, t);
    // BUG-074: bu brauzer sahifasi — xom JSON 403 o'rniga /play'ga redirect
    // (meta-missing/catch shoxlari bilan bir xil; API emas).
    if (!ok) return res.redirect('/play');

    const meta = await getSessionMeta(sessionId);
    if (!meta) return res.redirect('/play');

    const config = await getConfig(sessionId);
    res.render('cast/projector', {
      title: `Cast — ${meta.title || sessionId}`,
      boot: {
        sessionId,
        role: 'projector',
        // C4-05: UI locale config'dan
        locale: config?.localization?.locale || 'uz-Latn',
        socketPath: '/socket.io',
        initialRevision: 1,
        title: meta.title || 'Cast',
        config: { presentation: config?.presentation || {} },
      },
      characters: [],
    });
  } catch (err) {
    console.error('Projector route error:', err.message);
    res.redirect('/play');
  }
});

// ── Participant boot: GET /play resolves code → participant page (handled in game.js)
// ── Invites ──
router.post('/api/cast/sessions/:id/invites', requireAuth, async (req, res) => {
  try {
    const { id: sessionId } = req.params;
    const actorId = `user:${req.session?.user?.safeKey || req.session?.user?.username}`;
    const role = await getRole(sessionId, actorId);
    if (!role || role.role !== 'owner') {
      return res.status(403).json({ ok: false, error: { code: 'NOT_OWNER', message: 'Faqat egasi taklif yarata oladi' } });
    }
    const { role: targetRole = CAST_ROLES.CO_HOST } = req.body || {};
    if (![CAST_ROLES.CO_HOST, CAST_ROLES.MODERATOR].includes(targetRole)) {
      return res.status(400).json({ ok: false, error: { code: 'CAST_CONFIG_INVALID', message: 'Noma’lum rol' } });
    }
    // S18 BUG-117: expiresInSeconds clamp yo'q edi — manfiy (darhol o'lik) yoki
    // 1e9 (31 yil) qiymatlar qabul qilinardi
    const expiresInSeconds = Math.max(60, Math.min(86400, Number(req.body?.expiresInSeconds) || 900));
    const nonce = crypto.randomBytes(16).toString('hex');
    const invite = {
      nonce,
      role: targetRole,
      sessionId,
      inviter: actorId,
      createdAt: Date.now(),
      expiresAt: Date.now() + expiresInSeconds * 1000,
      redeemedBy: null,
    };
    const { upsertInvite } = await import('../services/cast/role-service.js');
    await upsertInvite(sessionId, nonce, invite);
    res.json({ ok: true, invite });
  } catch (err) {
    res.status(400).json({ ok: false, error: toCastError(err) });
  }
});

router.post('/api/cast/sessions/:id/invites/redeem', requireAuth, async (req, res) => {
  try {
    const { id: sessionId } = req.params;
    const { nonce } = req.body || {};
    const actorId = `user:${req.session?.user?.safeKey || req.session?.user?.username}`;
    const { redeemInvite } = await import('../services/cast/role-service.js');
    const roleRecord = await redeemInvite(sessionId, nonce, actorId);
    res.json({ ok: true, role: roleRecord });
  } catch (err) {
    res.status(400).json({ ok: false, error: toCastError(err) });
  }
});

router.post('/api/cast/sessions/:id/invites/:nonce/revoke', requireAuth, async (req, res) => {
  try {
    const { id: sessionId, nonce } = req.params;
    // S18 BUG-118: nonce fb path'ga tushadi (invites/{nonce}) — traversal bilan
    // (nonce='../..') ixtiyoriy fb node remove chaqirilishi mumkin edi
    if (!/^[a-f0-9]{32}$/.test(String(nonce || ''))) {
      return res.status(400).json({ ok: false, error: { code: 'CAST_CONFIG_INVALID', message: 'Noto‘g‘ri nonce' } });
    }
    const actorId = `user:${req.session?.user?.safeKey || req.session?.user?.username}`;
    const role = await getRole(sessionId, actorId);
    if (!role || role.role !== 'owner') {
      return res.status(403).json({ ok: false, error: { code: 'NOT_OWNER', message: 'Faqat egasi bekor qila oladi' } });
    }
    const { revokeInvite } = await import('../services/cast/role-service.js');
    await revokeInvite(sessionId, nonce);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ ok: false, error: toCastError(err) });
  }
});

// ── C3-13 Forge: Save to library (authenticated POST + ownership) ──
router.post('/api/cast/forge/library-save', requireAuth, async (req, res) => {
  try {
    const { sessionId, draftId } = req.body || {};
    if (!sessionId || !draftId) {
      return res.status(400).json({ ok: false, error: { code: 'CAST_CONFIG_INVALID', message: 'sessionId va draftId talab qilinadi' } });
    }

    const actorId = `user:${req.session?.user?.safeKey || req.session?.user?.username}`;
    // Ownership: faqat owner/co-host draftni libraryʻga saqlay oladi (item 12)
    const role = await getRole(sessionId, actorId);
    if (!role || !['owner', 'co_host'].includes(role.role)) {
      return res.status(403).json({ ok: false, error: { code: 'NOT_AUTHORIZED', message: 'Faqat session egasi libraryga saqlay oladi' } });
    }

    const { getForgeDraft, saveForgeToLibrary, FORGE_STATUS } = await import('../services/cast/question-forge-service.js');
    const { writeAudit } = await import('../services/cast/event-store.js');

    const record = await getForgeDraft(sessionId, draftId);
    if (!record) {
      return res.status(404).json({ ok: false, error: { code: 'SESSION_NOT_FOUND', message: 'Draft topilmadi' } });
    }
    if (record.status !== FORGE_STATUS.APPROVED) {
      return res.status(400).json({ ok: false, error: { code: 'INVALID_PHASE', message: 'Faqat tasdiqlangan draft saqlanadi' } });
    }

    // Teacher final answer/explanationni qayta validate qilamiz (item 13)
    // editedVersion — teacher tahriri; aks holda original draft
    const finalDraft = record.editedVersion || record;
    const itemId = await saveForgeToLibrary({ draft: finalDraft, teacherId: actorId });
    await writeAudit(sessionId, { action: 'forge:library_save', draftId, itemId, actorId, safe: true });

    return res.json({ ok: true, itemId });
  } catch (err) {
    const e = toCastError(err);
    const status = ['NOT_AUTHORIZED'].includes(e.code) ? 403 : 400;
    return res.status(status).json({ ok: false, error: e });
  }
});

// ── C4-07: Retention / deletion / legal-hold API ──

// GET /api/cast/retention/policy — resolved policy (institution config + default proposal)
router.get('/api/cast/retention/policy', requireAuth, async (req, res) => {
  try {
    const policyId = req.query.policyId || 'institution_default_v1';
    const policy = resolveRetentionPolicy(policyId, null);
    res.json({ ok: true, policy, fingerprint: policyFingerprint(policy) });
  } catch (err) {
    res.status(400).json({ ok: false, error: toCastError(err) });
  }
});

// POST /api/cast/retention/run — retention job'ni qo'lda ishga tushirish (faqat admin)
// 🔴 Review fix: faqat admin — aks holda istalgan student global data deletion
// trigger qila olardi.
router.post('/api/cast/retention/run', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { policyId, retentionClass } = req.body || {};
    const { runRetentionJob } = await import('../services/cast/retention-job.js');
    const { fb } = await import('../firebase/admin.js');
    const result = await runRetentionJob({ dbGet: fb.get, dbSet: fb.set, dbRemove: fb.remove }, {
      policyId: policyId || 'institution_default_v1',
      retentionClass: retentionClass || 'standard',
    });
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(400).json({ ok: false, error: toCastError(err) });
  }
});

// POST /api/cast/sessions/:id/legal-hold — legal hold record (item 12)
router.post('/api/cast/sessions/:id/legal-hold', requireAuth, async (req, res) => {
  try {
    const { id: sessionId } = req.params;
    const actorId = `user:${req.session?.user?.safeKey || req.session?.user?.username}`;
    const role = await getRole(sessionId, actorId);
    if (!role || !['owner', 'co_host'].includes(role.role)) {
      return res.status(403).json({ ok: false, error: { code: 'NOT_AUTHORIZED' } });
    }
    // S18 BUG-121: scope/reason clamp yo'q + holds array cheksiz o'sadi
    const scopeRaw = req.body?.scope || 'session';
    const scope = ['session', 'data'].includes(scopeRaw) ? scopeRaw : 'session';
    const reason = String(req.body?.reason || '').slice(0, 500);
    const expiresInDaysRaw = Number(req.body?.expiresInDays);
    const expiresInDays = Number.isFinite(expiresInDaysRaw) ? Math.max(1, Math.min(3650, Math.floor(expiresInDaysRaw))) : null;
    const { buildLegalHold } = await import('../services/cast/data-policy.js');
    const { fb } = await import('../firebase/admin.js');
    const hold = buildLegalHold({ actor: actorId, scope, reason, expiresInDays });
    const holdsPath = `cast_private/${sessionId}/governance/legal_holds`;
    const snap = await fb.get(holdsPath);
    const holds = snap.exists() ? snap.val() : [];
    if (!Array.isArray(holds)) {
      return res.status(400).json({ ok: false, error: { code: 'CAST_CONFIG_INVALID', message: 'Legal hold ro‘yxati buzilgan' } });
    }
    if (holds.length >= 50) {
      return res.status(400).json({ ok: false, error: { code: 'CAST_CONFIG_INVALID', message: 'Legal hold limiti (50)' } });
    }
    holds.push(hold);
    await fb.set(holdsPath, holds);
    res.json({ ok: true, hold });
  } catch (err) {
    res.status(400).json({ ok: false, error: toCastError(err) });
  }
});

// GET /api/cast/sessions/:id/tombstones — deletion tombstones (item 9)
router.get('/api/cast/sessions/:id/tombstones', requireAuth, async (req, res) => {
  try {
    const { id: sessionId } = req.params;
    const actorId = `user:${req.session?.user?.safeKey || req.session?.user?.username}`;
    const role = await getRole(sessionId, actorId);
    if (!role || !['owner', 'co_host'].includes(role.role)) {
      return res.status(403).json({ ok: false, error: { code: 'NOT_AUTHORIZED' } });
    }
    const { fb } = await import('../firebase/admin.js');
    const snap = await fb.get(`cast_private/${sessionId}/governance/tombstones`);
    res.json({ ok: true, tombstones: snap.exists() ? snap.val() : {} });
  } catch (err) {
    res.status(400).json({ ok: false, error: toCastError(err) });
  }
});

// ── Projector ticket helpers (in-memory scoped; revoked after redeem) ──
const projectorTickets = new Map(); // sessionId -> Set<ticket>
function upsertProjectorTicket(sessionId, ticket) {
  if (!projectorTickets.has(sessionId)) projectorTickets.set(sessionId, new Set());
  projectorTickets.get(sessionId).add(ticket);
}
async function redeemProjectorTicket(sessionId, ticket) {
  if (!ticket || !projectorTickets.has(sessionId)) return false;
  const set = projectorTickets.get(sessionId);
  if (!set.has(ticket)) return false;
  set.delete(ticket); // one-time
  if (set.size === 0) projectorTickets.delete(sessionId);
  return true;
}

// ═══════════════════════════════════════════════════════════
// C5-01 — Post-Cast Action Pack: results view + APIs
// ═══════════════════════════════════════════════════════════

const AP_S = (sid) => `cast_sessions/${sid}/action_pack`;

/**
 * Owner / co-host / moderator tekshiruvi (teacher report + export).
 * Success → actorId qaytadi; failure → 403 yuborib `null` qaytadi.
 * Route tomonda `if (!actorId) return;` shaklida ishlatiladi.
 */
async function assertCastStaff(sessionId, req, res) {
  const actorId = `user:${req.session?.user?.safeKey || req.session?.user?.username}`;
  const role = await getRole(sessionId, actorId);
  if (!role || !['owner', 'co_host', 'moderator'].includes(role.role)) {
    res.status(403).json({ ok: false, error: { code: 'NOT_AUTHORIZED', message: 'Siz bu sessiyaga kirish huquqiga ega emassiz' } });
    return null;
  }
  return actorId;
}

// ── Teacher results view: GET /cast/:sessionId/results ──
router.get('/cast/:sessionId/results', requireAuth, async (req, res) => {
  try {
    const { sessionId } = req.params;
    const actorId = `user:${req.session?.user?.safeKey || req.session?.user?.username}`;
    const role = await getRole(sessionId, actorId);
    if (!role || !['owner', 'co_host', 'moderator'].includes(role.role)) {
      return res.redirect('/user/panel');
    }
    const meta = await getSessionMeta(sessionId);
    if (!meta) return res.redirect('/user/panel');
    const config = await getConfig(sessionId);
    res.render('cast/results', {
      title: `Natijalar — ${meta.title || sessionId}`,
      boot: {
        sessionId,
        joinCode: meta.joinCode || null,
        actor: { id: actorId, role: role.role },
        csrfToken: req.session.csrfToken,
        locale: config?.localization?.locale || 'uz-Latn',
        socketPath: '/socket.io',
        title: meta.title || 'Cast',
        rehearsal: isRehearsal(meta),
      },
      characters: [],
    });
  } catch (err) {
    console.error('Results route error:', err.message);
    res.redirect('/user/panel');
  }
});

// ── Teacher report (immutable snapshot): GET /api/cast/sessions/:id/results/report ──
router.get('/api/cast/sessions/:id/results/report', requireAuth, async (req, res) => {
  try {
    const { id: sessionId } = req.params;
    const authRes = await assertCastStaff(sessionId, req, res);
    if (!authRes) return; // 403 yuborildi

    const snap = await fb.get(`${AP_S(sessionId)}/report`);
    if (!snap.exists()) {
      // Job hali tayyor emas — statusni qaytarish
      return res.json({ ok: false, ready: false, message: 'Hisobot hali tayyor emas' });
    }
    res.json({ ok: true, ready: true, report: snap.val() });
  } catch (err) {
    res.status(400).json({ ok: false, error: toCastError(err) });
  }
});

// ── Student private recap: GET /api/cast/sessions/:id/results/recap ──
// Student o'z javoblari + approved explanation + next steps; low rank YO'Q.
router.get('/api/cast/sessions/:id/results/recap', requireAuth, async (req, res) => {
  try {
    const { id: sessionId } = req.params;
    const actorId = `user:${req.session?.user?.safeKey || req.session?.user?.username}`;
    const role = await getRole(sessionId, actorId);
    if (!role) return res.status(403).json({ ok: false, error: { code: 'NOT_AUTHORIZED' } });
    // Review fix (C5-01): staff boshqa student recapini ko'ra oladi; oddiy
    // student faqat O'Z recapini — ?participantId orqali boshqa studentni
    // o'qib bo'lmaydi (privacy scope).
    const isStaff = ['owner', 'co_host', 'moderator'].includes(role.role);
    const ownPid = role.participantId || role.actorId || null;
    const targetPid = req.query.participantId || null;
    const pid = isStaff && targetPid ? targetPid : ownPid;
    if (!pid) return res.status(400).json({ ok: false, error: { code: 'NO_PARTICIPANT_ID' } });

    const config = await getConfig(sessionId);
    const postCast = config?.postCast || {};
    if (postCast.studentPrivateRecap === false) {
      return res.status(403).json({ ok: false, error: { code: 'RECAP_DISABLED', message: 'Shaxsiy recap o‘chirilgan' } });
    }

    const questions = await getPublicQuestions(sessionId);
    const answersByQuestion = {};
    const misconceptions = {};
    for (const qid of Object.keys(questions || {})) {
      const first = await listAnswersForQuestion(sessionId, qid, 1);
      const revote = await listAnswersForQuestion(sessionId, qid, 2);
      answersByQuestion[qid] = { ...first, ...revote };
    }
    // Confirmed misconception'lar audit'dan
    try {
      const audSnap = await fb.get(`cast_private/${sessionId}/audit`);
      if (audSnap.exists()) {
        for (const a of Object.values(audSnap.val() || {})) {
          if (a && a.type === 'cast:misconceptionDecision' && a.confirmed && a.teacherExplanation) {
            misconceptions[a.questionId || ''] = misconceptions[a.questionId || ''] || {};
            misconceptions[a.questionId || ''] [a.optionId] = {
              confirmed: true,
              teacherExplanation: a.teacherExplanation,
            };
          }
        }
      }
    } catch (_) { /* non-critical */ }

    const accuracy = { accepted: 0, correct: 0, accuracyPercent: null };
    for (const byPid of Object.values(answersByQuestion)) {
      const rec = byPid?.[pid];
      if (rec) {
        accuracy.accepted++;
        if (rec.isCorrect || rec.status === 'CORRECT') accuracy.correct++;
      }
    }
    if (accuracy.accepted > 0) {
      accuracy.accuracyPercent = Math.round((accuracy.correct / accuracy.accepted) * 1000) / 10;
    }

    const { projectStudentRecap } = await import('../services/cast/action-pack-service.js');
    const recap = projectStudentRecap({ participantId: pid, answersByQuestion, misconceptions, questions, accuracy });
    res.json({ ok: true, recap });
  } catch (err) {
    res.status(400).json({ ok: false, error: toCastError(err) });
  }
});

// ── Export report (item 12 'export'): GET /api/cast/sessions/:id/results/export ──
router.get('/api/cast/sessions/:id/results/export', requireAuth, async (req, res) => {
  try {
    const { id: sessionId } = req.params;
    const authRes = await assertCastStaff(sessionId, req, res);
    if (!authRes) return; // 403 yuborildi
    const snap = await fb.get(`${AP_S(sessionId)}/report`);
    if (!snap.exists()) return res.status(404).json({ ok: false, error: { code: 'REPORT_NOT_READY' } });
    const report = snap.val();
    const { format = 'json' } = req.query;
    if (format === 'csv') {
      // CSV: faqat aggregate qatorlar — raw javoblar YO'Q
      const lines = ['sessionId,fingerprint,accepted,correct,accuracyPercent,technicalFailures,generatedAt'];
      lines.push([
        report.sessionId,
        report.fingerprint,
        report.accuracy.accepted,
        report.accuracy.correct,
        report.accuracy.accuracyPercent ?? '',
        report.networkSummary.technicalFailures ?? 0,
        report.generatedAt,
      ].join(','));
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="cast-report-${sessionId}.csv"`);
      return res.send(lines.join('\n'));
    }
    res.json({ ok: true, report });
  } catch (err) {
    res.status(400).json({ ok: false, error: toCastError(err) });
  }
});

// ── AI draft (item 16, feature flag): POST /api/cast/sessions/:id/results/ai-draft ──
// Feature flag: env CAST_AI_DRAFT_ENABLED=1. Faqat aggregate/de-identified
// ma'lumot yuboriladi; teacher approval `ai.teacherApprovalRequired` config'da.
router.post('/api/cast/sessions/:id/results/ai-draft', requireAuth, async (req, res) => {
  try {
    if (process.env.CAST_AI_DRAFT_ENABLED !== '1') {
      return res.status(403).json({ ok: false, error: { code: 'AI_DRAFT_DISABLED', message: 'AI draft feature flag o‘chiq' } });
    }
    const { id: sessionId } = req.params;
    const authRes = await assertCastStaff(sessionId, req, res);
    if (!authRes) return; // 403 yuborildi
    const snap = await fb.get(`${AP_S(sessionId)}/report`);
    if (!snap.exists()) return res.status(404).json({ ok: false, error: { code: 'REPORT_NOT_READY' } });
    const report = snap.val();
    const config = await getConfig(sessionId);
    const ai = config?.ai || {};
    // De-identified payload: faqat aggregate + item flags — hech qanday ism/alias YO'Q
    const draft = {
      requestId: 'ad_' + crypto.randomBytes(6).toString('hex'),
      sessionId,
      fingerprint: report.fingerprint,
      accuracyPercent: report.accuracy.accuracyPercent,
      accepted: report.accuracy.accepted,
      hardestQuestions: report.hardestQuestions.map((h) => ({ questionId: h.questionId, accuracyPercent: h.accuracyPercent, insufficientSample: h.insufficientSample })),
      misconceptions: report.misconceptions.map((m) => ({ misconceptionId: m.misconceptionId, questionId: m.questionId })),
      itemQuality: report.itemQuality.map((i) => ({ code: i.code, severity: i.severity, action: i.action, questionId: i.questionId })),
      teacherApprovalRequired: ai.teacherApprovalRequired !== false,
      status: 'draft',
      createdAt: Date.now(),
    };
    await fb.set(`${AP_S(sessionId)}/ai_draft`, draft);
    await writeAudit(sessionId, { action: 'action_pack:ai_draft', requestId: draft.requestId, safe: true });
    res.json({ ok: true, draft });
  } catch (err) {
    res.status(400).json({ ok: false, error: toCastError(err) });
  }
});

// ═══════════════════════════════════════════════════════════
// C5-02 — Event Replay va teacher reflection
// ═══════════════════════════════════════════════════════════

const RL_ROOT = (sid) => `cast_sessions/${sid}/replay`;

/** Replay uchun event'lar + config + answers yig'ish (staff scope). */
async function loadReplayContext(sessionId) {
  const events = await getEventsAfter(sessionId, 0);
  const config = await getConfig(sessionId);
  const questions = await getPublicQuestions(sessionId);
  const answersByQuestion = {};
  for (const qid of Object.keys(questions || {})) {
    const first = await listAnswersForQuestion(sessionId, qid, 1);
    const revote = await listAnswersForQuestion(sessionId, qid, 2);
    answersByQuestion[qid] = { ...first, ...revote };
  }
  return { events, config, questions, answersByQuestion };
}

/** Misconception'lar audit'dan (director confirmed). */
async function loadReplayMisconceptions(sessionId) {
  const misconceptions = {};
  try {
    const audSnap = await fb.get(`cast_private/${sessionId}/audit`);
    if (audSnap.exists()) {
      for (const a of Object.values(audSnap.val() || {})) {
        if (a && a.type === 'cast:misconceptionDecision' && a.confirmed) {
          misconceptions[a.questionId || ''] = misconceptions[a.questionId || ''] || {};
          misconceptions[a.questionId || ''] [a.optionId] = {
            misconceptionId: a.misconceptionId || null,
            confirmed: true,
            teacherExplanation: a.teacherExplanation || null,
          };
        }
      }
    }
  } catch (_) { /* non-critical */ }
  return misconceptions;
}

// ── Replay view: GET /cast/:sessionId/replay (staff) ──
router.get('/cast/:sessionId/replay', requireAuth, async (req, res) => {
  try {
    const { sessionId } = req.params;
    const actorId = `user:${req.session?.user?.safeKey || req.session?.user?.username}`;
    const role = await getRole(sessionId, actorId);
    if (!role || !['owner', 'co_host', 'moderator'].includes(role.role)) {
      return res.redirect('/user/panel');
    }
    const meta = await getSessionMeta(sessionId);
    if (!meta) return res.redirect('/user/panel');
    const config = await getConfig(sessionId);
    const postCast = config?.postCast || {};
    if (postCast.eventReplay === false) {
      return res.redirect('/user/panel'); // feature o'chirilgan
    }
    res.render('cast/replay', {
      title: `Replay — ${meta.title || sessionId}`,
      boot: {
        sessionId,
        joinCode: meta.joinCode || null,
        actor: { id: actorId, role: role.role },
        csrfToken: req.session.csrfToken,
        locale: config?.localization?.locale || 'uz-Latn',
        socketPath: '/socket.io',
        title: meta.title || 'Cast',
        rehearsal: isRehearsal(meta),
        reflectionFields: REFLECTION_FIELDS,
        cameraPermissionRequested: REPLAY_CAMERA_PERMISSION.requested,
      },
      characters: [],
    });
  } catch (err) {
    console.error('Replay route error:', err.message);
    res.redirect('/user/panel');
  }
});

// ── Teacher replay timeline: GET /api/cast/sessions/:id/replay/teacher ──
router.get('/api/cast/sessions/:id/replay/teacher', requireAuth, async (req, res) => {
  try {
    const { id: sessionId } = req.params;
    const authRes = await assertCastStaff(sessionId, req, res);
    if (!authRes) return;
    const { events, config, questions, answersByQuestion } = await loadReplayContext(sessionId);
    const misconceptions = await loadReplayMisconceptions(sessionId);
    const netSnap = await fb.get(`cast_private/${sessionId}/network`);
    const network = netSnap.exists() ? netSnap.val() : {};
    const teacher = projectTeacherReplay({ events, config, answersByQuestion, network, misconceptions });
    teacher.configFingerprint = hashConfig(config);
    // Review fix (C5-02): wall content redaction projection replay'ga ulandi
    try {
      const wallSnap = await fb.get(`cast_private/${sessionId}/wall_queue`);
      if (wallSnap.exists()) teacher.wallContent = projectReplayWall(wallSnap.val());
      else teacher.wallContent = [];
    } catch (_) { teacher.wallContent = []; }
    res.json({ ok: true, replay: teacher });
  } catch (err) {
    res.status(400).json({ ok: false, error: toCastError(err) });
  }
});

// ── Student replay: GET /api/cast/sessions/:id/replay/student ──
// Student faqat O'Z javoblari + approved feedback; staff ?participantId= bilan.
router.get('/api/cast/sessions/:id/replay/student', requireAuth, async (req, res) => {
  try {
    const { id: sessionId } = req.params;
    const actorId = `user:${req.session?.user?.safeKey || req.session?.user?.username}`;
    const role = await getRole(sessionId, actorId);
    if (!role) return res.status(403).json({ ok: false, error: { code: 'NOT_AUTHORIZED' } });
    const isStaff = ['owner', 'co_host', 'moderator'].includes(role.role);
    const ownPid = role.participantId || role.actorId || null;
    const targetPid = req.query.participantId || null;
    const pid = isStaff && targetPid ? targetPid : ownPid;
    if (!pid) return res.status(400).json({ ok: false, error: { code: 'NO_PARTICIPANT_ID' } });
    const { questions, answersByQuestion } = await loadReplayContext(sessionId);
    const misconceptions = await loadReplayMisconceptions(sessionId);
    const student = projectStudentReplay({ participantId: pid, answersByQuestion, misconceptions, questions });
    res.json({ ok: true, replay: student });
  } catch (err) {
    res.status(400).json({ ok: false, error: toCastError(err) });
  }
});

// ── Audit projection: GET /api/cast/sessions/:id/replay/audit (staff) ──
router.get('/api/cast/sessions/:id/replay/audit', requireAuth, async (req, res) => {
  try {
    const { id: sessionId } = req.params;
    const authRes = await assertCastStaff(sessionId, req, res);
    if (!authRes) return;
    const events = await getEventsAfter(sessionId, 0);
    res.json({ ok: true, audit: projectAuditReplay({ events }) });
  } catch (err) {
    res.status(400).json({ ok: false, error: toCastError(err) });
  }
});

// ── Determinism check: GET /api/cast/sessions/:id/replay/determinism (staff) ──
// Replay state'ni hozirgi commit qilingan state bilan solishtiradi.
router.get('/api/cast/sessions/:id/replay/determinism', requireAuth, async (req, res) => {
  try {
    const { id: sessionId } = req.params;
    const authRes = await assertCastStaff(sessionId, req, res);
    if (!authRes) return;
    const events = await getEventsAfter(sessionId, 0);
    const current = await getState(sessionId);
    const questions = await getPublicQuestions(sessionId);
    // Review fix (C5-02): choreography qayta tartiblagan bo'lsa questionIds
    // tartibi initial'da farq qilishi mumkin — faqat STABLE field'larni
    // solishtiramiz (phase, endedAt, voteRound). questionPosition/questionId
    // choreography'ga bog'liq bo'lib false-divergence berishi mumkin.
    const stateArgs = {
      primaryDirectorId: current?.primaryDirectorId || null,
      questionIds: Object.keys(questions || {}),
      questionCount: Object.keys(questions || {}).length,
    };
    const { state: replayed } = replaySessionState({ initialStateArgs: stateArgs, events });
    const match =
      replayed.phase === current?.phase &&
      replayed.endedAt === current?.endedAt &&
      replayed.voteRound === current?.voteRound &&
      replayed.totalQuestions === current?.totalQuestions;
    res.json({ ok: true, deterministic: match, replayedPhase: replayed.phase, currentPhase: current?.phase });
  } catch (err) {
    res.status(400).json({ ok: false, error: toCastError(err) });
  }
});

// ── Reflection: GET /api/cast/sessions/:id/reflection (owner only) ──
// Review fix (C5-02): "private teacher reflection" — co_host/moderator ham
// o'qiy olmaydi, faqat OWNER (teacher). Reflection faqat o'ziga ko'rinadi.
async function assertCastOwner(sessionId, req, res) {
  const actorId = `user:${req.session?.user?.safeKey || req.session?.user?.username}`;
  const role = await getRole(sessionId, actorId);
  if (!role || role.role !== 'owner') {
    res.status(403).json({ ok: false, error: { code: 'NOT_OWNER', message: 'Faqat sessiya egasi reflection ko ra oladi' } });
    return null;
  }
  return actorId;
}

router.get('/api/cast/sessions/:id/reflection', requireAuth, async (req, res) => {
  try {
    const { id: sessionId } = req.params;
    const authRes = await assertCastOwner(sessionId, req, res);
    if (!authRes) return;
    const config = await getConfig(sessionId);
    if (config?.postCast?.teacherReflection === false) {
      return res.status(403).json({ ok: false, error: { code: 'REFLECTION_DISABLED' } });
    }
    const snap = await fb.get(`${RL_ROOT(sessionId)}/reflection`);
    res.json({ ok: true, reflection: snap.exists() ? projectReflection(snap.val()) : null, fields: REFLECTION_FIELDS });
  } catch (err) {
    res.status(400).json({ ok: false, error: toCastError(err) });
  }
});

// ── Reflection save: PUT /api/cast/sessions/:id/reflection (owner only) ──
router.put('/api/cast/sessions/:id/reflection', requireAuth, async (req, res) => {
  try {
    const { id: sessionId } = req.params;
    const authRes = await assertCastOwner(sessionId, req, res);
    if (!authRes) return;
    const teacherId = authRes;
    const config = await getConfig(sessionId);
    if (config?.postCast?.teacherReflection === false) {
      return res.status(403).json({ ok: false, error: { code: 'REFLECTION_DISABLED' } });
    }
    const { fields } = req.body || {};
    const path = `${RL_ROOT(sessionId)}/reflection`;
    const snap = await fb.get(path);
    let note;
    if (snap.exists()) {
      const existing = snap.val();
      if (existing.teacherId && existing.teacherId !== teacherId) {
        return res.status(403).json({ ok: false, error: { code: 'NOT_AUTHORIZED', message: 'Faqat o z teacheri tahrirlay oladi' } });
      }
      note = updateReflection(existing, { fields: fields || {}, at: Date.now() });
      await fb.set(path, { ...note, teacherId });
    } else {
      note = createReflection({ sessionId, teacherId, fields: fields || {} });
      await fb.set(path, note);
    }
    await writeAudit(sessionId, { action: 'reflection:save', reflectionId: note.reflectionId, safe: true });
    res.json({ ok: true, reflection: projectReflection({ ...note, teacherId }) });
  } catch (err) {
    if (err.code === 'REFLECTION_TOO_LONG') {
      return res.status(400).json({ ok: false, error: { code: 'REFLECTION_TOO_LONG' } });
    }
    res.status(400).json({ ok: false, error: toCastError(err) });
  }
});

// ═══════════════════════════════════════════════════════════
// C5-03 — Psychometric-safe metrics va comparison guard
// ═══════════════════════════════════════════════════════════

/**
 * Compatibility: POST /api/cast/sessions/:id/comparison
 * Body: { otherSessionId } — ikki session'ni solishtirish (staff only).
 * Incompatible bo'lsa → direct delta/rank BLOKLANADI (faqat SEPARATE_REPORTS).
 */
router.post('/api/cast/sessions/:id/comparison', requireAuth, async (req, res) => {
  try {
    const { id: sessionId } = req.params;
    const authRes = await assertCastStaff(sessionId, req, res);
    if (!authRes) return;
    const { otherSessionId } = req.body || {};
    if (!otherSessionId || otherSessionId === sessionId) {
      return res.status(400).json({ ok: false, error: { code: 'CAST_CONFIG_INVALID', message: 'Boshqa sessiya id kerak' } });
    }
    // Boshqa session'ga ham staff access kerak
    const otherRole = await getRole(otherSessionId, authRes);
    if (!otherRole || !['owner', 'co_host', 'moderator'].includes(otherRole.role)) {
      return res.status(403).json({ ok: false, error: { code: 'NOT_AUTHORIZED' } });
    }

    const [configA, configB, metaA, metaB] = await Promise.all([
      getConfig(sessionId),
      getConfig(otherSessionId),
      getSessionMeta(sessionId),
      getSessionMeta(otherSessionId),
    ]);

    const compatibility = checkCompatibility({ config: configA }, { config: configB });
    const equating = equatingStatus({ testVersionA: metaA?.testVersion, testVersionB: metaB?.testVersion });

    // Incompatible → misleading direct delta/rank yo'q (tugallanish sharti)
    let sideBySideView = null;
    if (compatibility.compatible) {
      sideBySideView = sideBySide(
        { accuracy: await sessionAccuracyMetric(sessionId), accepted: await sessionAcceptedCount(sessionId), technicalFailures: await sessionTechFailures(sessionId) },
        { accuracy: await sessionAccuracyMetric(otherSessionId), accepted: await sessionAcceptedCount(otherSessionId), technicalFailures: await sessionTechFailures(otherSessionId) }
      );
    }

    res.json({
      ok: true,
      comparison: {
        sessionA: sessionId,
        sessionB: otherSessionId,
        ...compatibility,
        equating,
        sideBySideView,
        // Item 14: teacher/class ranking endpoint YO'Q — faqat aggregate
        note: 'Direct rank/delta faqat compatible sessionlar uchun. Ranking endpoint mavjud emas.',
      },
    });
  } catch (err) {
    res.status(400).json({ ok: false, error: toCastError(err) });
  }
});

/** Session accuracy metric (numerator/denominator + Wilson interval). */
async function sessionAccuracyMetric(sessionId) {
  const questions = await getPublicQuestions(sessionId);
  let numerator = 0;
  let denominator = 0;
  for (const qid of Object.keys(questions || {})) {
    const byPid = await listAnswersForQuestion(sessionId, qid, 1);
    for (const rec of Object.values(byPid || {})) {
      denominator++;
      if (rec.isCorrect || rec.status === 'CORRECT') numerator++;
    }
  }
  const metric = buildMetric({ metric: 'accuracy', numerator, denominator });
  return { ...metric, interval: wilsonInterval(numerator, denominator) };
}

async function sessionAcceptedCount(sessionId) {
  const questions = await getPublicQuestions(sessionId);
  let accepted = 0;
  for (const qid of Object.keys(questions || {})) {
    accepted += Object.keys(await listAnswersForQuestion(sessionId, qid, 1)).length;
  }
  return accepted;
}

async function sessionTechFailures(sessionId) {
  const participants = await listParticipants(sessionId);
  let failures = 0;
  for (const p of Object.values(participants || {})) {
    if (p.delivery === 'remote' && ['poor', 'degraded'].includes(p.networkBucket)) failures++;
  }
  return failures;
}

// ═══════════════════════════════════════════════════════════
// C5-04 — Analytics event pipeline
// ═══════════════════════════════════════════════════════════

// Analytics buffer'lar (process-local; per-session stats dashboard uchun)
const analyticsBuffers = new Map(); // sessionId -> AnalyticsBuffer
const ANALYTICS_ROOT = (sid) => `cast_private/${sid}/analytics`;

/**
 * Analytics event POST: /api/cast/sessions/:id/analytics
 * Client/director tomonidan yuboriladi — PII-safe eventlar.
 * Schema'dan o'tmasa DROP + safe metric (live Castga ta'sir yo'q).
 */
router.post('/api/cast/sessions/:id/analytics', requireAuth, async (req, res) => {
  try {
    const { id: sessionId } = req.params;
    // Auth: faqat sessiya bilan bog'liq user (staff yoki participant ticket)
    const actorId = `user:${req.session?.user?.safeKey || req.session?.user?.username}`;
    const role = await getRole(sessionId, actorId);
    if (!role) return res.status(403).json({ ok: false, error: { code: 'NOT_AUTHORIZED' } });

    const { events = [] } = req.body || {};
    if (!Array.isArray(events)) return res.status(400).json({ ok: false, error: { code: 'CAST_CONFIG_INVALID' } });

    const buffer = analyticsBuffers.get(sessionId) || new AnalyticsBuffer();
    analyticsBuffers.set(sessionId, buffer);

    const accepted = [];
    const dropped = [];
    for (const raw of events.slice(0, 200)) {
      const ev = { ...raw, sessionId, at: raw.at || Date.now() };
      const res2 = await safeEmit(buffer, ev);
      if (res2.ok) accepted.push(ev);
      else dropped.push({ type: ev.type, reason: res2.reason || 'INVALID' });
    }
    await writeAudit(sessionId, { action: 'analytics:ingest', accepted: accepted.length, dropped: dropped.length, safe: true });
    res.json({ ok: true, accepted: accepted.length, dropped: dropped.length });
  } catch (err) {
    res.status(400).json({ ok: false, error: toCastError(err) });
  }
});

/**
 * Product metric dashboard: GET /api/cast/sessions/:id/analytics/dashboard
 * Staff only. Faqat aggregate — teacher ranking YO'Q (item 12).
 */
router.get('/api/cast/sessions/:id/analytics/dashboard', requireAuth, async (req, res) => {
  try {
    const { id: sessionId } = req.params;
    const authRes = await assertCastStaff(sessionId, req, res);
    if (!authRes) return;

    const buffer = analyticsBuffers.get(sessionId);
    const buffered = buffer ? buffer.drain() : [];
    // Saqlangan eventlarni ham yuklaymiz (agar mavjud bo'lsa)
    let stored = [];
    try {
      const snap = await fb.get(ANALYTICS_ROOT(sessionId));
      if (snap.exists()) stored = Object.values(snap.val() || {});
    } catch (_) { /* non-critical */ }
    const all = dedupeEvents([...buffered, ...stored]);

    const summary = summarizeProductMetrics(all);
    const byCategory = {};
    for (const e of all) {
      const cat = EVENT_CATEGORY_MAP[e.type] || 'other';
      byCategory[cat] = (byCategory[cat] || 0) + 1;
    }
    res.json({ ok: true, summary, byCategory, eventCount: all.length, bufferStats: buffer ? buffer.stats() : { buffered: 0 } });
  } catch (err) {
    res.status(400).json({ ok: false, error: toCastError(err) });
  }
});

/**
 * Admin analytics overview: GET /admin/api/cast/analytics (barcha session'lar)
 * requireAdmin — routes/admin.js'da. Bu yerda yordamchi export qilamiz.
 */
export const analyticsHelpers = {
  summarizeProductMetrics,
  validateAnalyticsEvent,
  buildAnalyticsEvent,
  ANALYTICS_EVENTS,
  ANALYTICS_CATEGORIES,
};

/**
 * Admin cast telemetry: GET /api/cast/telemetry (requireAdmin)
 * requireAdmin — metrics PII-safe (sanitized), faqat ops ko'radi.
 */
router.get('/api/cast/telemetry', requireAdmin, (req, res) => {
  const snap = castTelemetrySnapshot({
    bpLevel: req.app.get('backpressureSnapshot')?.level || 'normal',
    lagMs: req.app.get('backpressureSnapshot')?.lagMs || 0,
    dbQueue: 0,
  });
  res.json({ ok: true, ...snap });
});

// ═══════════════════════════════════════════════════════════
// C5-08 — Observability: support bundle (preview + submit)
// ═══════════════════════════════════════════════════════════

/**
 * Preview: GET /api/cast/sessions/:id/support-bundle/preview
 * Director/owner — bundle'ni yuborishdan OLDIN ko'radi (item 8).
 * Bundle PII-safe — raw/answer/token/roster yo'q (tugallanish sharti).
 */
router.get('/api/cast/sessions/:id/support-bundle/preview', requireAuth, async (req, res) => {
  try {
    const sessionId = req.params.id;
    const actor = req.session.user;
    const role = await getRole(sessionId, `user:${actor.safeKey || actor.username}`);
    const meta = await getSessionMeta(sessionId);
    if (!role || role.role !== CAST_ROLES.DIRECTOR) {
      return res.status(403).json({ ok: false, error: { code: 'NOT_AUTHORIZED' } });
    }
    const config = await getConfig(sessionId);
    const bundle = await buildSupportBundle({
      sessionId,
      config: config || undefined,
      client: { browser: browserLabel(req.headers['user-agent']) },
      runtime: {
        backpressureLevel: req.app.get('backpressureSnapshot')?.level || 'normal',
        failedRequestIds: (meta && meta.failedRequestIds) || [],
      },
    });
    assertBundleSafe(bundle);
    res.json({ ok: true, preview: true, bundle });
  } catch (err) {
    res.status(400).json({ ok: false, error: toCastError(err) });
  }
});

/**
 * Submit: POST /api/cast/sessions/:id/support-bundle (item 8 — eksplicit submit)
 * Director/owner — bundle yuboriladi (ops log'iga yoziladi; DB'ga saqlanmaydi,
 * chunki bundle o'zi auto-expiry bilan vaqtinchalik diagnostika vositasi).
 */
router.post('/api/cast/sessions/:id/support-bundle', requireAuth, async (req, res) => {
  try {
    const sessionId = req.params.id;
    const actor = req.session.user;
    const role = await getRole(sessionId, `user:${actor.safeKey || actor.username}`);
    if (!role || role.role !== CAST_ROLES.DIRECTOR) {
      return res.status(403).json({ ok: false, error: { code: 'NOT_AUTHORIZED' } });
    }
    const config = await getConfig(sessionId);
    const bundle = await buildSupportBundle({
      sessionId,
      config: config || undefined,
      client: { browser: browserLabel(req.headers['user-agent']) },
      runtime: {
        backpressureLevel: req.app.get('backpressureSnapshot')?.level || 'normal',
        failedRequestIds: req.body.failedRequestIds || [],
        signals: req.body.signals || {},
      },
    });
    assertBundleSafe(bundle);
    // Safe audit — bundle metadata (bundle o'zi saqlanmaydi)
    await writeAudit(sessionId, {
      action: 'support_bundle:submitted',
      bundleId: bundle.bundleId,
      sev: bundle.sev,
      eventCount: bundle.events.length,
      expiresAt: bundle.expiresAt,
    }).catch(() => {});
    res.json({ ok: true, bundleId: bundle.bundleId, sev: bundle.sev, expiresAt: bundle.expiresAt, eventCount: bundle.events.length });
  } catch (err) {
    res.status(400).json({ ok: false, error: toCastError(err) });
  }
});

export default router;
