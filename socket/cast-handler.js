/**
 * Deborah — Cast Socket Handler
 * -----------------------------
 * New Cast sessions — command/event envelope + ACK.
 * Har command: parse → authorize → service call → ACK.
 * Business logic Socket callback ichida qolmaydi.
 *
 * Security (G0-06):
 * - Host Socket Express session orqali teacher accountga bog'lanadi
 * - Participant scoped membership ticket bilan ishlaydi
 * - socket.data.role/code authorization source emas — server check
 */

import { fb } from '../firebase/admin.js';
import crypto from 'crypto';
import { CAST_COMMANDS, CAST_EVENTS, CAST_PHASES, CAST_TIMER_MODE, CAST_ROLES, CAST_ERROR_CODES, POWERUP_TYPE_LIST, CAST_LB_VISIBILITY, CAST_LB_FREQUENCY, CAST_ADVANCE_MODE } from '../utils/cast-constants.js';
import { toCastError } from '../services/cast/errors.js';
import { can, assertCan } from '../services/cast/permissions.js';
import { applyEvent, assertCommandAllowed, assertPhaseTransition, initialState, replayEvents } from '../services/cast/state-machine.js';
import { scheduleQuestionTimer, cancelSessionTimer, computeClosesAt } from '../services/cast/timer-service.js';
import { commitEvent, getCurrentState, getEventsAfter, writeAudit } from '../services/cast/event-store.js';
import {
  getSessionMeta,
  getConfig,
  getState,
  getRole,
  upsertRole,
  getParticipant,
  upsertParticipant,
  listParticipants,
  markPresence,
  removeParticipant,
  getPrivateQuestion,
  getPublicQuestion,
  getPublicQuestions,
  setScore,
  getScores,
  setLobbyLock,
  resolveSessionByCode,
  listAnswersForQuestion,
} from '../services/cast/session-store.js';
import { submitAnswer, getMyAnswerStatus } from '../services/cast/answer-service.js';
// C3-16 Self-Paced Race
import { isSelfPaced,
  initCursor,
  getCursor,
  setCursor,
  listCursors,
  activateSelfPaced,
  getSpMeta,
  pauseAll,
  resumeAll,
  advanceCursor,
  checkCursorExpiry,
  computeOwnRank,
  projectCursor,
  directorDistribution,
  fairnessHealth,
  finalizeRace,
} from '../services/cast/self-paced-service.js';
// C3-17 Power-ups
import {
  isPowerUpsEnabled,
  isTypeAllowed,
  allowedTypes,
  initInventory,
  getInventory,
  activatePowerUp,
  grantPowerUp,
  projectInventory,
  directorPowerupSummary,
} from '../services/cast/powerup-service.js';
// C4-01 Team Challenge
import {
  isTeamsEnabled,
  isSingleTeamDevice,
  isTalkEnabled,
  assignTeams,
  buildTeam,
  recomputeActiveMembers,
  projectTeamForMember,
} from '../services/cast/team-service.js';
import {
  buildTeamLeaderboard,
  teamOnlyProjection,
  buildLeaderboardFromStore,
  publicTopN,
  personalProjection,
} from '../services/cast/leaderboard.js';
// C4-02 Hybrid / low-bandwidth
import {
  resolveParticipantDelivery,
  bucketNetworkQuality,
  networkBucketLabel,
  deliveryFingerprint,
  lowBandwidthPolicy,
} from '../services/cast/resilience-service.js';
// C4-03 No-device paper-card mode
import {
  normalizeCardId,
  normalizeCardAnswer,
  mapOrientationToOption,
  mergeScanRecord,
  buildCorrectionAudit,
  projectCardProgress,
} from '../services/cast/card-scan-service.js';
import { sanitizeDisplayAlias, suggestNumberedAlias } from '../services/cast/join-service.js';
import { participantQuestionProjection, publicStateProjection, answerCountProjection, directorEvidenceProjection } from '../services/cast/projections.js';
import { createCoalescer, DIRECTOR_COALESCE_MS } from '../services/cast/payload-service.js';
import {
  classifyPriority,
  degradationLevel,
  shouldDrop,
  shouldThrottleAggregate,
  backpressureSnapshot,
  degradationAuditEvent,
  EVENT_PRIORITY,
} from '../services/cast/backpressure.js';
// C5-08 (item 1/3/4): Cast observability — ACK metrics, sanitized logs, trace ID
import { incCounter, recordAckTiming, traceFromCommand, buildLogEntry } from '../services/cast/telemetry.js';
import { buildQuestionEvidence, computeQuestionEvidence, computeVoteChangeMatrix } from '../services/cast/evidence-service.js';
import { recommendHingeAction, recordTeacherDecision } from '../services/cast/hinge-engine.js';
import { computeConfidenceMatrix, normalizeConfidence } from '../services/cast/confidence-service.js';
import { recordMisconceptionDecision, pinMisconceptionVersion } from '../services/cast/misconception-service.js';
import { validateQuickPrompt, generatePromptQuestionId, buildPromptQuestion, saveToLibrary } from '../services/cast/quick-prompt-service.js';
import { submitReasoning, listModerationQueue, moderateReasoning, getPublicReasoning } from '../services/cast/reasoning-service.js';
import { validateTransferMapping, buildMasteryContract, computeLearningProgress, checkRedemptionLimit, buildNextStep } from '../services/cast/mastery-service.js';
import { validateClassGoal, computeClassGoalProgress, buildGoalCompleteEvent } from '../services/cast/class-goal-service.js';
import { computeComparableFingerprint, computePersonalProgress, buildPersonalBest, canShowPublic } from '../services/cast/personal-progress-service.js';
import { isValidSignal, isDuplicateSignal, aggregateSignals, buildAggregatePayload, acknowledgeSignals, SIGNAL_COOLDOWN_MS, SIGNAL_DEDUPE_WINDOW_MS, CONFUSION_SIGNALS } from '../services/cast/confusion-service.js';
import { submitWallItem, listWallQueue, moderateWallItem, getPublicWall, markDirectorSeen, freezeWall, WALL_PENDING_STATES } from '../services/cast/moderation-service.js';
// C4-06: governance — block list, code rotation, moderation permission, alias policy
import { isBlocked, blockParticipant, unblockParticipant, rotateJoinCode, canModerate, holdWhenModeratorUnavailable } from '../services/cast/governance-service.js';
// C5-01: Post-Cast Action Pack — end session'da async report job
import { buildActionPackForSession } from '../services/cast/action-pack-service.js';
// C5-04: Analytics event pipeline — PII-safe, non-blocking
import { buildAnalyticsEvent, AnalyticsBuffer, safeEmit, ANALYTICS_EVENTS } from '../services/cast/analytics.js';
import { normalizeForCompare, isReservedImpersonation, hasInvisibleAbuse, assessAlias } from '../services/cast/nickname.js';
import { generateJoinCode as genJoinCode } from '../services/cast/session-store.js';
import {
  validatePoeContract,
  recordPrediction,
  recordExplanation,
  getPoeRecords,
  computePredictionDistribution,
  computeChangeMatrix,
  computeAggregatePattern,
  buildPoeSummary,
  getMediaReadiness,
  setParticipantLister,
  submitExemplar,
  listExemplarQueue,
  moderateExemplar,
  projectPublicExemplars,
} from '../services/cast/poe-service.js';
import {
  collectOpenResponse,
  buildProviderItems,
  recordClusterResult,
  getOrbData,
  applyManualAction,
  buildProjectorBoard,
  deleteOrb,
  validateOpenResponse,
} from '../services/cast/open-response-service.js';
import { runClustering } from '../services/cast/clustering-adapter.js';
import { getActiveClusteringProvider, providerRetentionDays } from '../services/cast/provider-registry.js';
import { computeQuestionOrder } from '../services/cast/randomization.js';
import {
  validateForgeDraft,
  submitForgeDraft,
  getForgeDraft,
  listForgeQueue,
  getForgeMeta,
  applyForgeReview,
  markForgeLaunched,
  projectForgeQueue,
  getForgeLiveQuestion,
  FORGE_ATTRIBUTION_POLICY,
  FORGE_STATUS,
} from '../services/cast/question-forge-service.js';
// C3-14 Session Choreography
import {
  saveTemplate,
  getTemplate,
  listTemplates,
  validateTemplate,
  buildRuntime,
  currentBlock,
  nextBlock,
  coverage,
  runtimeHealth,
  estimateDuration,
} from '../services/cast/choreography-service.js';
import {
  buildShadowBaseline,
  buildShadowInput,
  recordShadowDecision,
  computeShadowGate,
  parseSuggestion,
  assertSuggestionAllowed,
} from '../services/cast/ai-shadow-service.js';
import { runShadowSuggestion } from '../services/cast/ai-shadow-adapter.js';

// C5-11: shadow runs (evaluation history) — sessionId -> array of records
// Cheklangan saqlash (C5-11 review fix): har session uchun oxirgi 100 run —
// Map unbounded o'sib ketmasligi uchun (memory leak oldini olish).
const SHADOW_MAX_RUNS_PER_SESSION = 100;
const shadowRunsBySession = new Map();

// C5-07 (item 2): Backpressure tracker — module-level, barcha socket'lar uchun
// umumiy. Queue depth = davom etayotgan async handler'lar soni; lag = event-loop
// monitoring. Threshold'lar DEFAULT_THRESHOLDS'dan (100/400/800, 250ms/1000ms).
const backpressureState = { depth: 0, droppedP3: 0, lastLevel: 'normal', degradationAt: null, recoveredAt: null };
let bpLagCheckTimer = null;
let lastLagCheck = Date.now();
// C5-07 (item 12): degradation emit uchun module-level io reference
// (setupCastHandlers ichida bir marta o'rnatiladi — har socket'da emas).
let castIoRef = null;
function getBackpressureTracker() {
  if (!bpLagCheckTimer) {
    bpLagCheckTimer = setInterval(() => {
      const now = Date.now();
      const lagMs = Math.max(0, now - lastLagCheck);
      lastLagCheck = now;
      const level = degradationLevel({ queueDepth: backpressureState.depth, lagMs });
      const prev = backpressureState.lastLevel;
      if (level !== prev) {
        backpressureState.lastLevel = level;
        if (level !== 'normal' && !backpressureState.degradationAt) {
          backpressureState.degradationAt = now;
          backpressureState.recoveredAt = null;
        } else if (level === 'normal' && backpressureState.degradationAt) {
          backpressureState.recoveredAt = now;
        }
        // C5-07 (item 12): degradation start/end safe audit — identity/raw yo'q
        const audit = degradationAuditEvent({
          action: level === 'normal' ? 'end' : 'start',
          level,
          metrics: { queueDepth: backpressureState.depth, lagMs },
        });
        try { writeAudit(null, { action: `degradation:${audit.action}`, level: audit.level, queueDepth: audit.queueDepth, lagMs: audit.lagMs, safe: true }).catch(() => {}); } catch (_) {}
        if (castIoRef) {
          // directorCount — connected director'li session'lar (lobby'dagilar ham
          // qamrab olinadi; coalescer faqat answer bo'lgan session'larni bilardi).
          for (const sid of directorCount.keys()) {
            try { castIoRef.to(`cast:${sid}:director`).emit('cast:degradation', audit); } catch (_) {}
          }
        }
      }
    }, 500);
    bpLagCheckTimer.unref?.();
  }
  return {
    get level() { return backpressureState.lastLevel; },
    get depth() { return backpressureState.depth; },
    get snapshot() {
      return backpressureSnapshot({ queueDepth: backpressureState.depth, lagMs: Math.max(0, Date.now() - lastLagCheck) });
    },
    inc() { backpressureState.depth += 1; },
    dec() { backpressureState.depth = Math.max(0, backpressureState.depth - 1); },
    recordDrop() { backpressureState.droppedP3 += 1; },
    get droppedP3() { return backpressureState.droppedP3; },
    get degradationAt() { return backpressureState.degradationAt; },
    get recoveredAt() { return backpressureState.recoveredAt; },
  };
}

// C5-05 (item 10/11): ANSWER_COUNT coalescer — sessionId bo'yicha module-level
// Map (har socket uchun EMAS, aks holda 100 socket = 100 coalescer).
// Bitta session uchun bitta coalescer: answer storm'da broadcast soni kamayadi.
const answerCountCoalescers = new Map();

/**
 * Backpressure tracker (C5-07 item 10/11) — server health endpoint'ga
 * snapshot berish uchun module-level accessor.
 */
export function getCastBackpressureSnapshot() {
  const t = getBackpressureTracker();
  return {
    level: t.level,
    depth: t.depth,
    droppedP3: t.droppedP3,
    degradationAt: t.degradationAt,
    recoveredAt: t.recoveredAt,
    ...t.snapshot,
  };
}

/**
 * Coalescer registry tozalash (C5-05 review fix). Retention/deletion
 * path'lari (session:end bo'lmagan) ham Map'dan entry'ni o'chira oladi.
 */
export function clearAnswerCountCoalescer(sessionId) {
  const ac = answerCountCoalescers.get(sessionId);
  if (ac) {
    ac.stop();
    answerCountCoalescers.delete(sessionId);
  }
}

// ── Membership ticket signing (HMAC) ──
// Ushbu handler process-local; production'da session-store adapter orqali.
const TICKET_SECRET = process.env.SESSION_SECRET || 'cast-dev-secret';

function signTicket(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', TICKET_SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function verifyTicket(ticket) {
  if (!ticket || typeof ticket !== 'string') return null;
  const [body, sig] = ticket.split('.');
  if (!body || !sig) return null;
  const expected = crypto.createHmac('sha256', TICKET_SECRET).update(body).digest('base64url');
  if (sig !== expected) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (payload.exp && payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

/**
 * Setup Cast socket handlers.
 * @param {import('socket.io').Server} io
 * @param {import('socket.io').Socket} socket
 */
export function setupCastHandlers(io, socket) {
  if (!castIoRef) castIoRef = io; // C5-07 (item 12): degradation emit uchun
  const log = (...args) => console.log(`[Cast ${socket.id.slice(0, 8)}]`, ...args);
  const rooms = (sessionId) => `cast:${sessionId}`;
  // C4-09: participant-private room — shaxsiy proyeksiyalar faqat egasiga boradi.
  // (Har socket o'z closure'ida ishlagani uchun per-socket Map'ga tayanib bo'lmaydi.)
  const participantRoom = (sessionId, participantId) => `cast:${sessionId}:p:${participantId}`;
  const directorRoom = (sessionId) => `cast:${sessionId}:director`;
  // C3-10: moderator scoped room — faqat moderation content (wall + confusion aggregate)
  const moderationRoom = (sessionId) => `cast:${sessionId}:moderator`;
  // C3-11: POE media readiness uchun active participant lister
  setParticipantLister(async (sessionId) => Object.values(await listParticipants(sessionId)));

  // C5-05 (item 10/11): module-level coalescer'ni io bilan bog'lash.
  // Har socket setup'da faqat emit funksiyasini (io closure) yangilaymiz;
  // coalescer'ning o'zi bitta — session uchun broadcast soni kamayadi.
  const getAnswerCountCoalescer = (sid) => {
    let c = answerCountCoalescers.get(sid);
    if (!c) {
      const emitProjection = (proj) => {
        io.to(rooms(sid)).emit(CAST_EVENTS.ANSWER_COUNT, proj);
      };
      c = createCoalescer(emitProjection, DIRECTOR_COALESCE_MS);
      answerCountCoalescers.set(sid, c);
    }
    return c;
  };

  // C5-04: Analytics — non-blocking, PII-safe. Provider yo'q bo'lsa buffer/drop
  // (live Castga ta'sir yo'q). Event'lar fb'ga yozilmaydi — retention
  // AGGREGATE class (395 kun).
  const analyticsBuffer = new AnalyticsBuffer();
  // C5-07 (item 4): analytics = P3 — degraded2 rejimida drop/coalesce.
  // Analytics hech qachon accepted-answer ground truth'ga ta'sir qilmaydi.
  const emitAnalytics = (type, sessionId, meta = {}, network = {}) => {
    const bp = backpressureTracker();
    if (shouldDrop(bp.level, EVENT_PRIORITY.P3)) {
      return null; // P3 drop — saturation paytida decorative update kamayadi
    }
    const ev = buildAnalyticsEvent({ type, sessionId, meta, network });
    safeEmit(analyticsBuffer, ev).catch(() => {});
    return ev;
  };

  // C5-07 (item 2): backpressure tracker — module-level, session'lar bo'ylab umumiy
  // (queue depth + event-loop lag). Ops alert (item 11) va audit (item 12) uchun.
  const backpressureTracker = getBackpressureTracker();

  // Actor identity: teacher via Express session, participant via membership ticket
  function resolveActor() {
    const sessUser = socket.request?.session?.user;
    if (sessUser) {
      return { actorId: `user:${sessUser.safeKey || sessUser.username}`, actorRole: sessUser.role === 'teacher' ? 'teacher' : 'user' };
    }
    const ticket = socket.data?.castTicket;
    if (ticket) {
      const payload = verifyTicket(ticket);
      if (payload) {
        return { actorId: payload.participantId, actorRole: 'participant', participantId: payload.participantId, sessionId: payload.sessionId };
      }
    }
    return null;
  }

  function actorIdOrNull() {
    const a = resolveActor();
    return a?.actorId || null;
  }

  async function roleFor(sessionId, actor) {
    if (actor?.actorRole === 'participant') return 'participant';
    if (!actor) return null;
    const rec = await getRole(sessionId, actor.actorId);
    return rec && !rec.revokedAt ? rec.role : null;
  }

  // ── Envelope parsing ──
  // C5-08 (item 1): ACK kind classification — percentil bucketing uchun
  function classifyAckKind(type) {
    const t = String(type || '').toLowerCase();
    if (t.includes('answer') || t.includes('submit')) return 'answer';
    if (t.includes('start') || t.includes('open') || t.includes('close') || t.includes('reveal') || t.includes('pause') || t.includes('resume') || t.includes('next') || t.includes('end')) return 'host';
    if (t.includes('join') || t.includes('rejoin')) return 'join';
    if (t.includes('snapshot') || t.includes('state') || t.includes('recover')) return 'state';
    return 'other';
  }

  function parseCommand(data) {
    if (!data || typeof data !== 'object') {
      throw new Error('MALFORMED_COMMAND');
    }
    return {
      commandId: data.commandId || crypto.randomUUID(),
      sessionId: data.sessionId,
      expectedRevision: data.expectedRevision,
      type: data.type,
      payload: data.payload || {},
      sentAtClient: data.sentAtClient || 0,
      controlLeaseEpoch: data.controlLeaseEpoch,
    };
  }

  // C5-08 (item 1): connections = per-socket (onAny emas — har command'da emas)
  incCounter('connections');

  // ── Command dispatcher ──
  socket.onAny(async (eventName, data, ack) => {
    if (!String(eventName).startsWith('cast:')) return;
    const sendAck = typeof ack === 'function' ? ack : null;
    const cmdStartedAt = Date.now();
    // C5-08 (item 4): correlation ID — traceId ACK'da qaytadi (client log korrelyatsiya)
    const traceCtx = traceFromCommand(data || {});
    const ackSend = (result) => {
      if (sendAck) {
        sendAck({ ...(result || {}), traceId: traceCtx.traceId });
      }
      // C5-08 (item 1): ACK latency metrics (p50/p95/p99 bucketing)
      const kind = classifyAckKind(String((data && data.type) || eventName));
      recordAckTiming(kind, Date.now() - cmdStartedAt);
      if (result && result.ok === false) incCounter('ackErrors');
    };

    // C5-07 (item 6): accepted answer hech qachon drop qilinmaydi. Depth faqat
    // monitoring uchun — P0 command'lar (answer, host) prioritetda bajariladi.
    backpressureTracker.inc();
    try {
      const cmd = parseCommand(data);
      const { type } = cmd;

      // Resolve actor + role
      const actor = resolveActor();
      const sessionId = cmd.sessionId;

      // ── Public join / rejoin (no session-bound ticket yet) ──
      if (type === CAST_COMMANDS.JOIN) {
        return await handleJoin(cmd, actor, ackSend);
      }
      if (type === CAST_COMMANDS.REJOIN) {
        return await handleRejoin(cmd, ackSend);
      }
      if (type === CAST_COMMANDS.HEARTBEAT) {
        return ackSend({ ok: true, commandId: cmd.commandId, serverAt: Date.now() });
      }
      // C4-02: latency ping (client network monitor) — server authoritative timestamp
      if (type === 'cast:ping') {
        // Telemetry: answer bermagan remote participant ham bucket'lanadi (item 9)
        if (cmd.payload && sessionId && actor?.participantId) {
          const cfg = await getConfig(sessionId).catch(() => null);
          if (cfg?.resilience?.networkTelemetry !== false) {
            await recordNetworkSample(sessionId, actor.participantId, cfg, cmd.payload).catch(() => {});
          }
        }
        return ackSend({ ok: true, commandId: cmd.commandId, serverAt: Date.now() });
      }
      if (type === CAST_COMMANDS.GET_SNAPSHOT) {
        return await handleGetSnapshot(cmd, actor, ackSend);
      }
      // ── Director private room join (owner/co_host only) ──
      // (public evidence event qasddan YO'Q — C3-01 item 11)
      if (type === CAST_COMMANDS.DIRECTOR_JOIN) {
        return await handleDirectorJoin(cmd, actor, ackSend);
      }
      if (type === CAST_COMMANDS.GET_MY_ANSWER_STATUS) {
        const actor2 = resolveActor();
        if (!actor2?.participantId) return ackSend({ ok: false, error: { code: 'NOT_AUTHORIZED' } });
        const st = await getMyAnswerStatus(sessionId, cmd.payload?.questionId, actor2.participantId, cmd.payload?.attemptNo || 1);
        return ackSend({ ok: true, commandId: cmd.commandId, ...st });
      }

      if (!sessionId || !actor) {
        return ackSend({ ok: false, commandId: cmd.commandId, error: { code: 'NOT_AUTHORIZED', message: 'Avtorizatsiya talab qilinadi' } });
      }

      // Role authorization (server-side, never socket.data)
      const role = await roleFor(sessionId, actor);
      const actionMap = {
        [CAST_COMMANDS.SESSION_START]: 'session:start',
        [CAST_COMMANDS.QUESTION_OPEN]: 'question:open',
        [CAST_COMMANDS.QUESTION_PAUSE]: 'question:pause',
        [CAST_COMMANDS.QUESTION_RESUME]: 'question:resume',
        [CAST_COMMANDS.QUESTION_CLOSE]: 'question:close',
        [CAST_COMMANDS.QUESTION_REVEAL]: 'question:reveal',
        [CAST_COMMANDS.QUESTION_NEXT]: 'question:next',
        [CAST_COMMANDS.LEADERBOARD_SHOW]: 'leaderboard:show',
        [CAST_COMMANDS.ADD_TIME]: 'time:add',
        [CAST_COMMANDS.SESSION_END]: 'session:end',
        [CAST_COMMANDS.LOCK_LOBBY]: 'lock:lobby',
        [CAST_COMMANDS.REMOVE_PARTICIPANT]: 'participant:remove',
        [CAST_COMMANDS.BLOCK_PARTICIPANT]: 'participant:block',
        [CAST_COMMANDS.UNBLOCK_PARTICIPANT]: 'participant:block',
        [CAST_COMMANDS.ROTATE_JOIN_CODE]: 'session:rotate_code',
        [CAST_COMMANDS.HINGE_DECISION]: 'content:moderate',
        [CAST_COMMANDS.MISCONCEPTION_DECISION]: 'content:moderate',
        [CAST_COMMANDS.QUICK_PROMPT_LAUNCH]: 'quick_prompt:launch',
        [CAST_COMMANDS.QUICK_PROMPT_SAVE]: 'content:moderate',
        [CAST_COMMANDS.SUBMIT_REASONING]: 'answer:submit',
        [CAST_COMMANDS.MODERATE_REASONING]: 'content:moderate',
        [CAST_COMMANDS.TRANSFER_LAUNCH]: 'mastery:launch',
        [CAST_COMMANDS.TRANSFER_SUBMIT]: 'answer:submit',
        [CAST_COMMANDS.GOAL_CONFIG]: 'question:next',
        [CAST_COMMANDS.WALL_MODERATE]: 'content:moderate',
        [CAST_COMMANDS.SIGNAL_ACK]: 'content:moderate',
        // C5-11 AI Co-host shadow — suggestion faqat card, live action emas
        [CAST_COMMANDS.SHADOW_RUN]: 'analyst:read',
        [CAST_COMMANDS.SHADOW_DECIDE]: 'content:moderate',
        [CAST_COMMANDS.SHADOW_GATE]: 'analyst:read',
        // C3-11 POE
        [CAST_COMMANDS.POE_LAUNCH]: 'question:next',
        [CAST_COMMANDS.POE_CLOSE_PREDICTION]: 'question:close',
        [CAST_COMMANDS.POE_MEDIA_ACTION]: 'question:next',
        [CAST_COMMANDS.POE_START_EXPLANATION]: 'question:open',
        [CAST_COMMANDS.POE_CLOSE_EXPLANATION]: 'question:close',
        [CAST_COMMANDS.POE_SHOW_ANALYSIS]: 'question:reveal',
        [CAST_COMMANDS.POE_SUBMIT_PREDICTION]: 'answer:submit',
        [CAST_COMMANDS.POE_MEDIA_READY]: 'answer:submit',
        [CAST_COMMANDS.POE_SUBMIT_EXPLANATION]: 'answer:submit',
        [CAST_COMMANDS.POE_MODERATE_EXEMPLAR]: 'content:moderate',
        // C3-12 Open-Response Semantic Board
        [CAST_COMMANDS.ORB_LAUNCH]: 'question:next',
        [CAST_COMMANDS.ORB_SUBMIT]: 'answer:submit',
        [CAST_COMMANDS.ORB_CLOSE]: 'question:close',
        [CAST_COMMANDS.ORB_RUN_CLUSTER]: 'question:reveal',
        [CAST_COMMANDS.ORB_MANUAL]: 'question:next', // teacher judgement — moderator emas
        [CAST_COMMANDS.ORB_END]: 'question:next',
        // C3-13 Student Question Forge
        [CAST_COMMANDS.FORGE_SUBMIT]: 'answer:submit', // participant
        [CAST_COMMANDS.FORGE_REVIEW]: 'question:next', // owner/co-host — publish kuchi
        [CAST_COMMANDS.FORGE_LAUNCH]: 'question:next', // owner/co-host — pacing ta'siri
        // C3-14 Session Choreography
        [CAST_COMMANDS.CHOREO_SAVE]: 'question:next',
        [CAST_COMMANDS.CHOREO_LIST]: 'question:next',
        [CAST_COMMANDS.CHOREO_LOAD]: 'question:next',
        [CAST_COMMANDS.CHOREO_OVERRIDE]: 'question:next',
        [CAST_COMMANDS.CHOREO_ADVANCE]: 'question:next',
        [CAST_COMMANDS.QUICK_PROMPT_CANCEL]: 'content:moderate',
        [CAST_COMMANDS.START_DISCUSSION]: 'discuss:start',
        [CAST_COMMANDS.OPEN_REVOTE]: 'revote:open',
        // C3-16 Self-Paced Race
        [CAST_COMMANDS.SP_OPEN]: 'question:next',
        [CAST_COMMANDS.SP_PAUSE]: 'question:pause',
        [CAST_COMMANDS.SP_RESUME]: 'question:resume',
        // C3-17 Power-ups (participant activate — permission yengil; director grant/config)
        [CAST_COMMANDS.POWERUP_ACTIVATE]: 'answer:submit',
        [CAST_COMMANDS.POWERUP_GRANT]: 'question:next',
        [CAST_COMMANDS.POWERUP_CONFIG]: 'question:next',
        // C4-01 Team Challenge (director-only)
        [CAST_COMMANDS.TEAM_ASSIGN]: 'question:next',
        [CAST_COMMANDS.TEAM_TALK_START]: 'question:pause',
        [CAST_COMMANDS.TEAM_TALK_END]: 'question:resume',
        [CAST_COMMANDS.TEAM_REPORTER_ROTATE]: 'question:next',
        // C4-03 Paper-card (director-only — camera frame serverga YO'Q)
        [CAST_COMMANDS.CARD_SCAN]: 'question:next',
        [CAST_COMMANDS.CARD_CORRECT]: 'question:next',
      };
      const action = actionMap[type];
      if (action) {
        const perm = can(role, action);
        if (!perm.allowed) {
          await writeAudit(sessionId, { action: 'unauthorized:' + type, actorId: actor.actorId, safe: true });
          return ackSend({ ok: false, commandId: cmd.commandId, error: { code: 'NOT_AUTHORIZED', message: perm.reason } });
        }
      }

      switch (type) {
        case CAST_COMMANDS.ANSWER_SUBMIT:
          return await handleAnswer(cmd, actor, ackSend);
        case CAST_COMMANDS.SESSION_START:
          return await handleSessionStart(cmd, actor, ackSend);
        case CAST_COMMANDS.QUESTION_OPEN:
          return await handleQuestionOpen(cmd, actor, ackSend);
        case CAST_COMMANDS.QUESTION_PAUSE:
          return await handlePause(cmd, actor, ackSend);
        case CAST_COMMANDS.QUESTION_RESUME:
          return await handleResume(cmd, actor, ackSend);
        case CAST_COMMANDS.ADD_TIME:
          return await handleAddTime(cmd, actor, ackSend);
        case CAST_COMMANDS.QUESTION_CLOSE:
          return await handleClose(cmd, actor, ackSend);
        case CAST_COMMANDS.QUESTION_REVEAL:
          return await handleReveal(cmd, actor, ackSend);
        case CAST_COMMANDS.QUESTION_NEXT:
          return await handleNext(cmd, actor, ackSend);
        // STYLE S32 — Leaderboard show (public Top-N + personal private + team)
        case CAST_COMMANDS.LEADERBOARD_SHOW:
          return await handleLeaderboardShow(cmd, actor, ackSend);
        case CAST_COMMANDS.SESSION_END:
          return await handleSessionEnd(cmd, actor, ackSend);
        case CAST_COMMANDS.LOCK_LOBBY:
          return await handleLockLobby(cmd, ackSend);
        case CAST_COMMANDS.REMOVE_PARTICIPANT:
          return await handleRemoveParticipant(cmd, actor, ackSend);
        case CAST_COMMANDS.BLOCK_PARTICIPANT:
          return await handleBlockParticipant(cmd, actor, ackSend);
        case CAST_COMMANDS.UNBLOCK_PARTICIPANT:
          return await handleUnblockParticipant(cmd, actor, ackSend);
        case CAST_COMMANDS.ROTATE_JOIN_CODE:
          return await handleRotateJoinCode(cmd, actor, ackSend);
        case CAST_COMMANDS.CONFIRMATION_SIGNAL:
          return await handleConfusionSignal(cmd, actor, ackSend);
        case CAST_COMMANDS.QUESTION_WALL:
          return await handleQuestionWall(cmd, actor, ackSend);
        case CAST_COMMANDS.HINGE_DECISION:
          return await handleHingeDecision(cmd, actor, ackSend);
        case CAST_COMMANDS.START_DISCUSSION:
          return await handleStartDiscussion(cmd, actor, ackSend);
        case CAST_COMMANDS.OPEN_REVOTE:
          return await handleOpenRevote(cmd, actor, ackSend);
        // C3-16 Self-Paced Race
        case CAST_COMMANDS.SP_OPEN:
          return await handleSpOpen(cmd, actor, ackSend);
        case CAST_COMMANDS.SP_PAUSE:
          return await handleSpPause(cmd, actor, ackSend);
        case CAST_COMMANDS.SP_RESUME:
          return await handleSpResume(cmd, actor, ackSend);
        case CAST_COMMANDS.SP_SYNC:
          return await handleSpSync(cmd, actor, ackSend);
        // C3-17 Power-ups
        case CAST_COMMANDS.POWERUP_ACTIVATE:
          return await handlePowerupActivate(cmd, actor, ackSend);
        case CAST_COMMANDS.POWERUP_GRANT:
          return await handlePowerupGrant(cmd, actor, ackSend);
        case CAST_COMMANDS.POWERUP_CONFIG:
          return await handlePowerupConfig(cmd, actor, ackSend);
        // C4-01 Team Challenge
        case CAST_COMMANDS.TEAM_ASSIGN:
          return await handleTeamAssign(cmd, actor, ackSend);
        case CAST_COMMANDS.TEAM_TALK_START:
          return await handleTeamTalkStart(cmd, actor, ackSend);
        case CAST_COMMANDS.TEAM_TALK_END:
          return await handleTeamTalkEnd(cmd, actor, ackSend);
        case CAST_COMMANDS.TEAM_REPORTER_ROTATE:
          return await handleTeamReporterRotate(cmd, actor, ackSend);
        // C4-03 Paper-card
        case CAST_COMMANDS.CARD_SCAN:
          return await handleCardScan(cmd, actor, ackSend);
        case CAST_COMMANDS.CARD_CORRECT:
          return await handleCardCorrect(cmd, actor, ackSend);
        case CAST_COMMANDS.SUBMIT_CONFIDENCE:
          return await handleSubmitConfidence(cmd, actor, ackSend);
        case CAST_COMMANDS.MISCONCEPTION_DECISION:
          return await handleMisconceptionDecision(cmd, actor, ackSend);
        case CAST_COMMANDS.QUICK_PROMPT_LAUNCH:
          return await handleQuickPromptLaunch(cmd, actor, ackSend);
        case CAST_COMMANDS.QUICK_PROMPT_SAVE:
          return await handleQuickPromptSave(cmd, actor, ackSend);
        case CAST_COMMANDS.QUICK_PROMPT_CANCEL:
          return await handleQuickPromptCancel(cmd, actor, ackSend);
        case CAST_COMMANDS.SUBMIT_REASONING:
          return await handleSubmitReasoning(cmd, actor, ackSend);
        case CAST_COMMANDS.MODERATE_REASONING:
          return await handleModerateReasoning(cmd, actor, ackSend);
        case CAST_COMMANDS.TRANSFER_LAUNCH:
          return await handleTransferLaunch(cmd, actor, ackSend);
        case CAST_COMMANDS.TRANSFER_SUBMIT:
          return await handleTransferSubmit(cmd, actor, ackSend);
        case CAST_COMMANDS.GOAL_CONFIG:
          return await handleGoalConfig(cmd, actor, ackSend);
        case CAST_COMMANDS.WALL_MODERATE:
          return await handleWallModerate(cmd, actor, ackSend);
        case CAST_COMMANDS.SIGNAL_ACK:
          return await handleSignalAck(cmd, actor, ackSend);
        // C5-11 AI Co-host shadow
        case CAST_COMMANDS.SHADOW_RUN:
          return await handleShadowRun(cmd, actor, ackSend);
        case CAST_COMMANDS.SHADOW_DECIDE:
          return await handleShadowDecide(cmd, actor, ackSend);
        case CAST_COMMANDS.SHADOW_GATE:
          return await handleShadowGate(cmd, actor, ackSend);
        // C3-11 POE
        case CAST_COMMANDS.POE_LAUNCH:
          return await handlePoeLaunch(cmd, actor, ackSend);
        case CAST_COMMANDS.POE_SUBMIT_PREDICTION:
          return await handlePoeSubmitPrediction(cmd, actor, ackSend);
        case CAST_COMMANDS.POE_CLOSE_PREDICTION:
          return await handlePoeClosePrediction(cmd, actor, ackSend);
        case CAST_COMMANDS.POE_MEDIA_READY:
          return await handlePoeMediaReady(cmd, actor, ackSend);
        case CAST_COMMANDS.POE_MEDIA_ACTION:
          return await handlePoeMediaAction(cmd, actor, ackSend);
        case CAST_COMMANDS.POE_START_EXPLANATION:
          return await handlePoeStartExplanation(cmd, actor, ackSend);
        case CAST_COMMANDS.POE_SUBMIT_EXPLANATION:
          return await handlePoeSubmitExplanation(cmd, actor, ackSend);
        case CAST_COMMANDS.POE_CLOSE_EXPLANATION:
          return await handlePoeCloseExplanation(cmd, actor, ackSend);
        case CAST_COMMANDS.POE_SHOW_ANALYSIS:
          return await handlePoeShowAnalysis(cmd, actor, ackSend);
        case CAST_COMMANDS.POE_MODERATE_EXEMPLAR:
          return await handlePoeModerateExemplar(cmd, actor, ackSend);
        // C3-12 Open-Response Semantic Board
        case CAST_COMMANDS.ORB_LAUNCH:
          return await handleOrbLaunch(cmd, actor, ackSend);
        case CAST_COMMANDS.ORB_SUBMIT:
          return await handleOrbSubmit(cmd, actor, ackSend);
        case CAST_COMMANDS.ORB_CLOSE:
          return await handleOrbClose(cmd, actor, ackSend);
        case CAST_COMMANDS.ORB_RUN_CLUSTER:
          return await handleOrbRunCluster(cmd, actor, ackSend);
        case CAST_COMMANDS.ORB_MANUAL:
          return await handleOrbManual(cmd, actor, ackSend);
        case CAST_COMMANDS.ORB_END:
          return await handleOrbEnd(cmd, actor, ackSend);
        // C3-13 Student Question Forge
        case CAST_COMMANDS.FORGE_SUBMIT:
          return await handleForgeSubmit(cmd, actor, ackSend);
        case CAST_COMMANDS.FORGE_REVIEW:
          return await handleForgeReview(cmd, actor, ackSend);
        case CAST_COMMANDS.FORGE_LAUNCH:
          return await handleForgeLaunch(cmd, actor, ackSend);
        // C3-14 Session Choreography
        case CAST_COMMANDS.CHOREO_SAVE:
          return await handleChoreoSave(cmd, actor, ackSend);
        case CAST_COMMANDS.CHOREO_LIST:
          return await handleChoreoList(cmd, actor, ackSend);
        case CAST_COMMANDS.CHOREO_LOAD:
          return await handleChoreoLoad(cmd, actor, ackSend);
        case CAST_COMMANDS.CHOREO_OVERRIDE:
          return await handleChoreoOverride(cmd, actor, ackSend);
        case CAST_COMMANDS.CHOREO_ADVANCE:
          return await handleChoreoAdvance(cmd, actor, ackSend);
        default:
          return ackSend({ ok: false, commandId: cmd.commandId, error: { code: 'COMMAND_UNKNOWN', message: 'Noma’lum buyruq' } });
      }
    } catch (err) {
      const e = toCastError(err);
      ackSend({ ok: false, error: e });
      // C5-08 (item 1): revision drift / retry signal counters
      if (e && (e.code === 'STALE_REVISION' || e.code === 'REVISION_CONFLICT')) incCounter('revisionDrifts');
      if (e && (e.code === 'DUPLICATE_COMMAND')) incCounter('duplicates');
    } finally {
      backpressureTracker.dec();
    }
  });

  // ── POE: ANALYSIS fazasida qayta ulangan participant'ga public analysis'ni qayta yuborish ──
  async function emitPoeAnalysisToSocket(sessionId, flowId, socketId) {
    try {
      const records = await getPoeRecords(sessionId, flowId);
      const aggregatePattern = computeAggregatePattern(records);
      const exemplars = projectPublicExemplars(await listExemplarQueue(sessionId, flowId));
      io.to(socketId).emit(CAST_EVENTS.POE_ANALYSIS_PUBLIC, {
        aggregatePattern,
        exemplars: exemplars.slice(0, 6),
      });
    } catch (_) { /* non-critical */ }
  }

  // ── JOIN ──
  async function handleJoin(cmd, actor, ackSend) {
    const { joinCode, displayName, avatarId, delivery, cardId } = cmd.payload || {};
    const code = String(joinCode || '').toUpperCase().replace(/[\s-]/g, '');
    if (!code) return ackSend({ ok: false, commandId: cmd.commandId, error: { code: 'JOIN_CODE_INVALID' } });

    const sessionId = await resolveSessionByCode(code);
    if (!sessionId) return ackSend({ ok: false, commandId: cmd.commandId, error: { code: 'JOIN_CODE_INVALID', message: 'Bunday kod bilan sessiya topilmadi' } });

    const meta = await getSessionMeta(sessionId);
    const config = await getConfig(sessionId);
    if (!meta || meta.status === 'ended') {
      return ackSend({ ok: false, commandId: cmd.commandId, error: { code: 'SESSION_NOT_FOUND', message: 'Sessiya tugagan' } });
    }

    // Lobby lock check
    const state = await getState(sessionId);
    const phase = state?.phase || CAST_PHASES.LOBBY_OPEN;
    if (meta.lobbyLocked && phase !== CAST_PHASES.LOBBY_OPEN) {
      return ackSend({ ok: false, commandId: cmd.commandId, error: { code: 'LOBBY_LOCKED', message: 'Qabul yopilgan' } });
    }
    if (phase !== CAST_PHASES.LOBBY_OPEN && config?.join?.allowLateJoin === false) {
      return ackSend({ ok: false, commandId: cmd.commandId, error: { code: 'LOBBY_LOCKED', message: 'Kech qo‘shilish yopiq' } });
    }

    // Name sanitize (C4-06: assessAlias reserved/invisible blok + NFKC)
    let displayAlias, normalized;
    try {
      const assessed = assessAlias(displayName);
      if (!assessed.safe) {
        return ackSend({ ok: false, commandId: cmd.commandId, error: { code: 'NAME_TAKEN', message: assessed.reason === 'RESERVED_ROLE' ? 'Bu ism band' : assessed.reason === 'INVISIBLE_OR_CONFUSABLE' ? 'Ismda yashirin belgilar bo‘lishi mumkin emas' : 'Ism kiritilishi shart' } });
      }
      // Review fix: assessAlias tozalagan (clean) matnni ishlatamiz — invisible
      // belgilar olib tashlangan holda sanitize qilinadi (ikki marta strip emas)
      ({ displayAlias, normalized } = sanitizeDisplayAlias(assessed.clean, 30));
    } catch (e) {
      return ackSend({ ok: false, commandId: cmd.commandId, error: { code: 'NAME_TAKEN', message: e.message } });
    }

    // C4-06 (item 15): block list — a'zolik blok qilingan ism qayta qo'shila olmaydi
    const blocked = await isBlocked({ dbGet: fb.get }, sessionId, normalized).catch(() => false);
    if (blocked) {
      io.to(rooms(sessionId)).emit(CAST_EVENTS.BLOCKED_JOIN_ATTEMPT, { normalized });
      return ackSend({ ok: false, commandId: cmd.commandId, error: { code: 'BLOCKED', message: 'Siz bu sessiyaga qayta qo‘shila olmaysiz' } });
    }

    // Duplicate alias → numbered suggestion
    const participants = await listParticipants(sessionId);
    const taken = new Set(Object.values(participants).map((p) => (p.normalized || '')));
    if (taken.has(normalized)) {
      displayAlias = suggestNumberedAlias(displayAlias, taken);
      normalized = displayAlias.toLowerCase().normalize('NFKC');
    }

    // Capacity
    if (Object.keys(participants).length >= (config?.join?.maxPlayers || 100)) {
      return ackSend({ ok: false, commandId: cmd.commandId, error: { code: 'LOBBY_FULL', message: 'Sessiya to‘lgan' } });
    }

    const participantId = 'p_' + crypto.randomBytes(8).toString('hex');
    const ticketPayload = {
      sessionId,
      participantId,
      exp: Date.now() + 24 * 60 * 60 * 1000,
    };
    const membershipTicket = signTicket(ticketPayload);

    // C4-01: team assignment (random/balanced/roster) — join'da avtomatik
    let teamAssignment = null;
    if (isTeamsEnabled(config)) {
      try {
        teamAssignment = await assignNewcomerToTeam(sessionId, participantId, config);
      } catch (_) { /* assignment non-critical — manual re-assign mumkin */ }
    }      // C4-02 (item 2): participant delivery type — remote/in_room
    const deliveryType = resolveParticipantDelivery(config, delivery);
    // C4-03: paper-card mode'da participant o'z kartasini ro'yxatdan o'tkazadi (expected count)
    let registeredCardId = null;
    if (config?.participation?.paperCardMode && config?.participation?.cardScanP3 !== false) {
      try {
        registeredCardId = normalizeCardId(cardId);
      } catch (_) { /* karta yo'q bo'lsa — keyinroq qo'shish mumkin */ }
    }

    await upsertParticipant(sessionId, {
      participantId,
      displayAlias,
      normalized,
      avatarId: avatarId || null,
      presence: 'online',
      joinedAt: Date.now(),
      last_seen: Date.now(),
      late: phase !== CAST_PHASES.LOBBY_OPEN,
      // C4-01
      teamId: teamAssignment?.teamId || null,
      rosterTeamId: teamAssignment?.rosterTeamId || null,
      // C4-02
      delivery: deliveryType,
      // C4-03
      cardId: registeredCardId,
    });

    socket.data.castTicket = membershipTicket;
    socket.data.castSessionId = sessionId;
    socket.join(rooms(sessionId));
    socket.join(participantRoom(sessionId, participantId));
    // C3-13: participant socket'larini kuzatamiz — forge notification'lar uchun
    trackParticipantSocket(participantId, socket.id);

    // Broadcast roster update
    io.to(rooms(sessionId)).emit(CAST_EVENTS.PARTICIPANT_JOINED, {
      participantId,
      displayAlias,
      count: Object.keys(await listParticipants(sessionId)).length,
    });

    // Initial snapshot for the joiner
    const currentState = await getState(sessionId);
    const q = await getPublicQuestion(sessionId, currentState?.questionId);

    // C3-16: self-paced bo'lsa — cursor init (join'da) + o'z cursor'i ack'da
    let spCursor = null;
    if (isSelfPaced(config)) {
      try {
        const pubQ = await getPublicQuestions(sessionId);
        spCursor = await initCursor({
          sessionId,
          participantId,
          questionIds: Object.keys(pubQ || {}),
          config,
          sessionSeed: currentState?.sessionSeed || 0,
          meta,
        });
      } catch (_) { /* non-critical */ }
    }
    // C3-17: power-up inventory init (join'da; item 5 — server-side saqlash)
    let powerUps = null;
    if (isPowerUpsEnabled(config)) {
      try {
        powerUps = await initInventory({ sessionId, participantId, config });
      } catch (_) { /* non-critical */ }
    }

    // C5-04: joined analytics (pseudonymous actorKey, latency bucket)
    try {
      emitAnalytics(ANALYTICS_EVENTS.JOINED, sessionId, {
        actorKey: String(participantId).slice(0, 16),
        delivery: deliveryType,
        joinMs: cmd.sentAtClient ? Date.now() - cmd.sentAtClient : undefined,
      });
    } catch (_) { /* analytics non-critical */ }

    ackSend({
      ok: true,
      commandId: cmd.commandId,
      sessionId,
      participantId,
      displayAlias,
      membershipTicket,
      joinMode: phase === CAST_PHASES.LOBBY_OPEN ? 'lobby' : 'in_session',
      revision: currentState?.revision || 1,
      state: publicStateProjection(currentState),
      question: q ? participantQuestionProjection(q, { phase: currentState.phase, openedAt: currentState.openedAt, closesAt: currentState.closesAt, revision: currentState.revision }) : null,
      title: meta.title,
      config: safeJoinConfig(config),
      // C3-13: forge capability (session config + institution policy)
      forge: { enabled: Boolean(config?.responsiveTeaching?.questionForge) },
      // C3-16: own cursor (faqat o'ziga; order/rank identity yo'q)
      selfPaced: spCursor,
      // C3-17: own power-up inventory (faqat o'ziga; public emas)
      powerUps,
      // C4-01: own team projection (faqat o'z jamoasiga)
      team: teamAssignment?.team ? projectTeamForMember(teamAssignment.team, participantId) : null,
      // C4-02: delivery + network policy (client low-bandwidth mode uchun)
      delivery: deliveryType,
      network: {
        fingerprint: deliveryFingerprint(config),
        lowBandwidth: lowBandwidthPolicy(config),
        networkTelemetry: config?.resilience?.networkTelemetry !== false,
      },
    });
    // C3-11: ANALYSIS fazasida qayta ulanish — analysis'ni shu socket'ga qayta yuboramiz
    const pf = currentState?.poeFlow;
    if (pf?.analysisShownAt && pf?.contract?.flowId) {
      await emitPoeAnalysisToSocket(sessionId, pf.contract.flowId, socket.id);
    }
  }

  // ── REJOIN ──
  async function handleRejoin(cmd, ackSend) {
    const ticket = cmd.payload?.membershipTicket || socket.data?.castTicket;
    const payload = verifyTicket(ticket);
    if (!payload) return ackSend({ ok: false, commandId: cmd.commandId, error: { code: 'NOT_AUTHORIZED', message: 'Ticket yaroqsiz' } });

    const sessionId = payload.sessionId;
    const participantId = payload.participantId;
    const participant = await getParticipant(sessionId, participantId);
    if (!participant) return ackSend({ ok: false, commandId: cmd.commandId, error: { code: 'NOT_AUTHORIZED', message: 'Ishtirokchi topilmadi' } });

    socket.data.castTicket = ticket;
    socket.data.castSessionId = sessionId;
    socket.join(rooms(sessionId));
    socket.join(participantRoom(sessionId, participantId));
    // C3-13: reconnect'da ham participant socket'ini kuzatamiz
    trackParticipantSocket(participantId, socket.id);
    await markPresence(sessionId, participantId, 'online');

    const currentState = await getState(sessionId);
    const q = await getPublicQuestion(sessionId, currentState?.questionId);

    // C3-16: rejoin'da cursor holatini qayta yuboramiz (reconnect — item 7)
    let spCursor = null;
    const config2 = await getConfig(sessionId);
    if (isSelfPaced(config2)) {
      const cursor = await getCursor(sessionId, participantId);
      if (cursor) spCursor = projectCursor(cursor);
      else {
        try {
          const pubQ = await getPublicQuestions(sessionId);
          const meta2 = await getSessionMeta(sessionId);
          spCursor = await initCursor({ sessionId, participantId, questionIds: Object.keys(pubQ || {}), config: config2, sessionSeed: currentState?.sessionSeed || 0, meta: meta2 });
        } catch (_) { /* non-critical */ }
      }
    }

    // C5-04: rejoined analytics
    try {
      emitAnalytics(ANALYTICS_EVENTS.REJOINED, sessionId, {
        actorKey: String(participantId).slice(0, 16),
        retries: participant.rejoinCount || 0,
      });
    } catch (_) { /* analytics non-critical */ }

    ackSend({
      ok: true,
      commandId: cmd.commandId,
      sessionId,
      participantId,
      displayAlias: participant.displayAlias,
      revision: currentState?.revision || 1,
      state: publicStateProjection(currentState),
      question: q ? participantQuestionProjection(q, { phase: currentState.phase, openedAt: currentState.openedAt, closesAt: currentState.closesAt, revision: currentState.revision }) : null,
      selfPaced: spCursor,
    });
    // C3-11: ANALYSIS fazasida rejoin — analysis'ni shu socket'ga qayta yuboramiz
    const pf = currentState?.poeFlow;
    if (pf?.analysisShownAt && pf?.contract?.flowId) {
      await emitPoeAnalysisToSocket(sessionId, pf.contract.flowId, socket.id);
    }
  }

  // ── SNAPSHOT (authz: faqat sessiya a'zosi / rol egasi) ──
  async function handleGetSnapshot(cmd, actor, ackSend) {
    const sessionId = cmd.sessionId;
    if (!sessionId) return ackSend({ ok: false, error: { code: 'SESSION_NOT_FOUND' } });
    if (!actor) {
      return ackSend({ ok: false, commandId: cmd.commandId, error: { code: 'NOT_AUTHORIZED', message: 'Avtorizatsiya talab qilinadi' } });
    }
    // Participant ticket faqat shu sessiya uchun; rol egasi ham ruxsat
    if (actor.actorRole === 'participant') {
      if (actor.sessionId !== sessionId) {
        return ackSend({ ok: false, commandId: cmd.commandId, error: { code: 'NOT_AUTHORIZED', message: 'Sessiyaga azolik talab qilinadi' } });
      }
    } else {
      const role = await getRole(sessionId, actor.actorId);
      if (!role || role.revokedAt) {
        return ackSend({ ok: false, commandId: cmd.commandId, error: { code: 'NOT_AUTHORIZED', message: 'Sessiyaga azolik talab qilinadi' } });
      }
    }
    const state = await getCurrentState(sessionId);
    if (!state) return ackSend({ ok: false, error: { code: 'SESSION_NOT_FOUND' } });
    const q = await getPublicQuestion(sessionId, state.questionId);
    ackSend({
      ok: true,
      commandId: cmd.commandId,
      revision: state.revision,
      state: publicStateProjection(state),
      question: q ? participantQuestionProjection(q, { phase: state.phase, openedAt: state.openedAt, closesAt: state.closesAt, revision: state.revision }) : null,
    });
  }

  // ── DIRECTOR JOIN (private evidence room) ──
  async function handleDirectorJoin(cmd, actor, ackSend) {
    const sessionId = cmd.sessionId;
    if (!sessionId || !actor) {
      return ackSend({ ok: false, commandId: cmd.commandId, error: { code: 'NOT_AUTHORIZED', message: 'Avtorizatsiya talab qilinadi' } });
    }
    if (actor.actorRole === 'participant') {
      return ackSend({ ok: false, commandId: cmd.commandId, error: { code: 'NOT_AUTHORIZED', message: 'Direktor huquqi talab qilinadi' } });
    }
    const role = await getRole(sessionId, actor.actorId);
    if (!role || role.revokedAt || !['owner', 'co_host', 'moderator'].includes(role.role)) {
      return ackSend({ ok: false, commandId: cmd.commandId, error: { code: 'NOT_AUTHORIZED', message: 'Direktor huquqi talab qilinadi' } });
    }
    // C3-10: moderator faqat moderation room'ga kiradi (scoped — evidence yo'q)
    const isModerator = role.role === 'moderator';
    socket.join(moderationRoom(sessionId));
    if (!isModerator) {
      socket.join(directorRoom(sessionId));
      // BUG-230db143d fix: director asosiy xonaga ham qo'shiladi —
      // participantJoined/phase/answer stats 'cast:{id}' xonasiga ketadi,
      // director faqat ':director' xonasida edi → live eventlarni eshitmasdi.
      socket.join(rooms(sessionId));
    }
    // C3-10: director presence + wall refresh
    socket.data.castDirectorSessions = socket.data.castDirectorSessions || [];
    if (!socket.data.castDirectorSessions.includes(sessionId)) {
      socket.data.castDirectorSessions.push(sessionId);
      directorCount.set(sessionId, (directorCount.get(sessionId) || 0) + 1);
    }
    try {
      await markDirectorSeen(sessionId);
      await emitWallQueue(sessionId);
      await emitWallPublic(sessionId);
      // C3-13: forge queue — director join'da yangilanadi (faqat owner/co-host)
      if (!isModerator) await emitForgeQueue(sessionId);
      // C3-14: choreography dashboard — director join'da current/next state
      if (!isModerator) await emitChoreoState(sessionId);
    } catch (_) { /* non-critical */ }
    // BUG-230db143b fix: director JOIN KODINI ko'rmaydi (UI '—' qotardi) —
    // getSnapshot ham directorJoin ack ham joinCode qaytarmas edi.
    let joinCode = null;
    let participants = [];
    try {
      const meta = await getSessionMeta(sessionId);
      joinCode = meta?.joinCode || null;
      // BUG-230db143d fix: director ochilganda mavjud ishtirokchilar ro'yxati
      const plist = await listParticipants(sessionId);
      participants = Object.values(plist || {}).map((p) => ({
        participantId: p.participantId,
        displayAlias: p.displayAlias,
        presence: p.presence || 'online',
      }));
    } catch (_) {}
    ackSend({ ok: true, commandId: cmd.commandId, joined: true, scoped: isModerator, joinCode, participants });
  }

  // ── ANSWER ──
  async function handleAnswer(cmd, actor, ackSend) {
    if (actor?.actorRole !== 'participant' || !actor.participantId) {
      return ackSend({ ok: false, commandId: cmd.commandId, error: { code: 'NOT_AUTHORIZED' } });
    }
    const config = await getConfig(cmd.sessionId);
    try {
      // C4-01: single_team_device'da answer team ID bilan yoziladi (item 7)
      let teamId = null;
      if (isSingleTeamDevice(config)) {
        const me = await getParticipant(cmd.sessionId, actor.participantId);
        teamId = me?.teamId || null;
        if (!teamId) {
          return ackSend({ ok: false, commandId: cmd.commandId, error: { code: 'NOT_AUTHORIZED', message: 'Siz jamoa azosi emassiz' } });
        }
      }
      // C4-02 (item 8): network quality sample — answer record'dan ALOHIDA telemetry.
      // Remote network issue hech qachon wrong answerga aylantirilmaydi (tugallanish sharti).
      if (config?.resilience?.networkTelemetry !== false) {
        try {
          await recordNetworkSample(cmd.sessionId, actor.participantId, config, cmd.payload);
        } catch (_) { /* telemetry non-critical */ }
      }

      const attemptNo = cmd.payload?.attemptNo || 1;

      const result = await submitAnswer({
        sessionId: cmd.sessionId,
        questionId: cmd.payload?.questionId,
        participantId: actor.participantId,
        teamId,
        commandId: cmd.commandId,
        selectedOptionIds: cmd.payload?.selectedOptionIds || [],
        attemptNo: cmd.payload?.attemptNo || 1,
        confidence: cmd.payload?.confidence, // C3-04 (grade'ga ta'sir qilmaydi)
        config,
      });

      // C3-04: confidence bor bo'lsa director private matrix yangilanadi
      if (result.scoreRecord) {
        await emitConfidenceMatrix(cmd.sessionId, cmd.payload?.questionId, attemptNo);
      }

      // Update score record — C3-03 score policy bo'yicha
      const scorePolicy = config?.scoring?.scorePolicy || 'first_only';
      const isRevote = attemptNo === 2;
      if (result.scoreRecord) {
        // first_only → faqat first ball; revote_only → faqat revote; learning_only → reytingga kirmaydi
        const applyToLeaderboard =
          scorePolicy === 'first_only' ? !isRevote :
          scorePolicy === 'revote_only' ? isRevote :
          false;
        if (applyToLeaderboard) {
          // C4-01: score responseOwnerId bo'yicha yoziladi (team bo'lsa jamoa balli)
          const ownerId = result.scoreRecord.responseOwnerId || actor.participantId;
          const scores = await getScores(cmd.sessionId);
          const cur = scores[ownerId] || { total: 0, answeredCount: 0 };
          await setScore(cmd.sessionId, ownerId, {
            total: (cur.total || 0) + result.scoreRecord.total,
            answeredCount: (cur.answeredCount || 0) + 1,
            evidenceUnit: result.scoreRecord.evidenceUnit,
            updatedAt: Date.now(),
          });
        }
      }

      // Broadcast answer count — C5-05 (item 10/11): coalesce.
      // Director 4-10Hz, projector 2-4Hz — 100+ participant answer storm'da
      // har answer uchun alohida broadcast qilinmaydi.
      const answers = await listAnswersForQuestion(cmd.sessionId, cmd.payload?.questionId, attemptNo);
      const participants = await listParticipants(cmd.sessionId);
      const acProj = answerCountProjection(Object.keys(answers).length, Object.keys(participants).length);
      const answerCountCoalescer = getAnswerCountCoalescer(cmd.sessionId);
      answerCountCoalescer.push(acProj);

      // Revote close'da before/after matrix (director private)
      if (isRevote) {
        await emitVoteMatrix(cmd.sessionId, cmd.payload?.questionId);
      }

      // C3-09: class goal progress + personal best after answer
      await emitClassGoalProgress(cmd.sessionId);
      // C4-01 (item 8): single_team_device'da individual personal best
      // yaratilmaydi — jamoa javobi member'larning shaxsiy yozuviga aylanmaydi.
      if (!isSingleTeamDevice(config)) {
        await emitPersonalBest(cmd.sessionId, actor.participantId);
      }
      // C4-01: jamoa reytingi director'ga yangilanadi (team-only, member identity yo'q)
      await emitTeamLeaderboard(cmd.sessionId);

      ackSend({ ok: true, ...result.ack });
    } catch (err) {
      ackSend({ ok: false, commandId: cmd.commandId, error: toCastError(err) });
    }
  }

  // ── Session START ──
  async function handleSessionStart(cmd, actor, ackSend) {
    const state = await getState(cmd.sessionId);
    assertCommandAllowed(state, 'session:start');
    const config = await getConfig(cmd.sessionId);

    // Lock lobby on start per config
    if (config?.join?.lockLobbyOnStart !== false) {
      await setLobbyLock(cmd.sessionId, true);
    }

    const event = { type: 'cast:sessionStarted', payload: { startedAt: Date.now() }, serverAt: Date.now() };
    const next = applyEvent(state, event);
    assertPhaseTransition(state, next.phase);

    const res = await commitEvent({ sessionId: cmd.sessionId, expectedRevision: cmd.expectedRevision, event, state: next });
    io.to(rooms(cmd.sessionId)).emit(CAST_EVENTS.SESSION_STARTED, { revision: res.revision, serverAt: res.event.serverAt });
    ackSend({ ok: true, commandId: cmd.commandId, newRevision: res.revision, serverAt: res.event.serverAt });
  }

  // ── QUESTION OPEN (with think-time preview) ──
  async function handleQuestionOpen(cmd, actor, ackSend) {
    const state = await getState(cmd.sessionId);
    assertCommandAllowed(state, 'question:open');
    const config = await getConfig(cmd.sessionId);
    // C3-16: self-paced active bo'lsa normal savol oqimi rad etiladi
    // (har participant o'z cursor'i orqali yuguradi — room question konflikt qiladi)
    if (state?.selfPaced?.active) {
      return ackSend({ ok: false, commandId: cmd.commandId, error: { code: 'INVALID_PHASE', message: 'Self-paced poygada normal savol ochib bo‘lmaydi — SP paneldan boshqaring' } });
    }

    const order = computeQuestionOrder(
      (await getPublicQuestions(cmd.sessionId) && Object.keys(await getPublicQuestions(cmd.sessionId))),
      state.sessionSeed || 0,
      true,
    );
    const questionId = order[state.questionPosition] || state.questionId;

    // If question position is past end → end session
    if (!questionId) {
      return handleSessionEnd(cmd, actor, ackSend);
    }

    const thinkMs = (config?.playback?.thinkSeconds || 0) * 1000;

    // Preview event (think phase)
    const previewEvent = {
      type: 'cast:questionPreview',
      payload: { questionId, questionPosition: state.questionPosition },
      serverAt: Date.now(),
    };
    let next = applyEvent(state, previewEvent);
    let res = await commitEvent({ sessionId: cmd.sessionId, expectedRevision: cmd.expectedRevision, event: previewEvent, state: next });

    // Broadcast preview — think/staging bosqichi: savol kontenti ham boradi,
    // shunda participant/projector savolni 3s staging'da ko'rsatib, countdown bildira oladi
    const pubQ = await getPublicQuestion(cmd.sessionId, questionId);
    io.to(rooms(cmd.sessionId)).emit(CAST_EVENTS.QUESTION_PREVIEW, {
      revision: res.revision,
      questionPosition: state.questionPosition,
      totalQuestions: state.totalQuestions,
      thinkSeconds: config?.playback?.thinkSeconds || 0,
      question: pubQ ? participantQuestionProjection(pubQ, { phase: 'THINK_TIME', revision: res.revision }) : null,
      serverAt: res.event.serverAt,
    });

    if (thinkMs > 0) {
      // Schedule open after think time
      setTimeout(async () => {
        await openQuestionNow(cmd.sessionId, questionId, res.revision);
      }, thinkMs);
    } else {
      await openQuestionNow(cmd.sessionId, questionId, res.revision);
    }

    ackSend({ ok: true, commandId: cmd.commandId, newRevision: res.revision, questionId });
  }

  async function openQuestionNow(sessionId, questionId, afterRevision) {
    try {
      const state = await getState(sessionId);
      if (!state || state.questionId !== questionId) return; // stale
      const config = await getConfig(sessionId);
      const openedAt = Date.now();
      const closesAt = computeClosesAt({ mode: config?.timer?.mode || 'soft', defaultSeconds: config?.timer?.defaultSeconds || 30, openedAt });

      const event = {
        type: 'cast:questionOpened',
        payload: { questionId, openedAt, closesAt, timerMode: config?.timer?.mode || 'soft' },
        serverAt: openedAt,
      };
      const next = applyEvent(state, event);
      const res = await commitEvent({ sessionId, expectedRevision: state.revision, event, state: next });

      const pubQ = await getPublicQuestion(sessionId, questionId);
      io.to(rooms(sessionId)).emit(CAST_EVENTS.QUESTION_OPENED, {
        revision: res.revision,
        question: pubQ ? participantQuestionProjection(pubQ, { phase: 'QUESTION_OPEN', openedAt, closesAt, revision: res.revision }) : null,
        serverAt: res.event.serverAt,
        timerMode: config?.timer?.mode,
      });

      // Timer scheduling (soft → soft-expired event; strict → lock)
      if (config?.timer?.mode !== 'off' && closesAt) {
        scheduleQuestionTimer({
          sessionId,
          questionId,
          revision: res.revision,
          expiresAt: closesAt,
          mode: config.timer.mode,
          onFire: async ({ sessionId: sid, questionId: qid, revision }) => {
            const st = await getState(sid);
            if (!st || st.revision !== revision || st.questionId !== qid || st.phase !== 'QUESTION_OPEN') return;
            if (config?.timer?.mode === 'strict') {
              await handleLockNow(sid, qid, revision);
            } else {
              const ev = { type: 'cast:questionClosed', payload: { closesAt: Date.now(), softExpired: true }, serverAt: Date.now() };
              const nx = applyEvent(st, ev);
              const r = await commitEvent({ sessionId: sid, expectedRevision: revision, event: ev, state: nx });
              io.to(rooms(sid)).emit(CAST_EVENTS.QUESTION_CLOSED, { revision: r.revision, softExpired: true, serverAt: r.event.serverAt });
    scheduleAutoPodium(sid);
              await emitQuestionEvidence(sid, qid, 1);
            }
          },
        });
      }
    } catch (err) {
      console.error('[Cast] openQuestionNow error:', err.message);
    }
  }

  // ── PAUSE ──
  async function handlePause(cmd, actor, ackSend) {
    const state = await getState(cmd.sessionId);
    assertCommandAllowed(state, 'question:pause');
    if (state.phase !== 'QUESTION_OPEN') {
      return ackSend({ ok: false, commandId: cmd.commandId, error: { code: 'INVALID_PHASE' } });
    }
    cancelSessionTimer(cmd.sessionId);
    const pausedAt = Date.now();
    const event = { type: 'cast:questionPaused', payload: { pausedAt, remainingMs: Math.max(0, (state.closesAt || pausedAt) - pausedAt) }, serverAt: pausedAt };
    const next = applyEvent(state, event);
    const res = await commitEvent({ sessionId: cmd.sessionId, expectedRevision: cmd.expectedRevision, event, state: next });
    io.to(rooms(cmd.sessionId)).emit(CAST_EVENTS.QUESTION_PAUSED, { revision: res.revision, payload: event.payload });
    ackSend({ ok: true, commandId: cmd.commandId, newRevision: res.revision });
  }

  // ── RESUME ──
  async function handleResume(cmd, actor, ackSend) {
    const state = await getState(cmd.sessionId);
    assertCommandAllowed(state, 'question:resume');
    if (state.phase !== 'QUESTION_OPEN' || !state.pausedAt) {
      return ackSend({ ok: false, commandId: cmd.commandId, error: { code: 'INVALID_PHASE' } });
    }
    const config = await getConfig(cmd.sessionId);
    const pausedDurationMs = Date.now() - state.pausedAt;
    const closesAt = (state.closesAt || Date.now()) + pausedDurationMs;
    const event = { type: 'cast:questionResumed', payload: { resumedAt: Date.now(), closesAt, pausedDurationMs, totalPausedMs: (state.totalPausedMs || 0) + pausedDurationMs }, serverAt: Date.now() };
    const next = applyEvent(state, event);
    const res = await commitEvent({ sessionId: cmd.sessionId, expectedRevision: cmd.expectedRevision, event, state: next });

    if (config?.timer?.mode !== 'off' && closesAt) {
      scheduleQuestionTimer({
        sessionId: cmd.sessionId,
        questionId: state.questionId,
        revision: res.revision,
        expiresAt: closesAt,
        mode: config.timer.mode,
        onFire: async ({ sessionId: sid, questionId: qid, revision }) => {
          const st = await getState(sid);
          if (!st || st.revision !== revision || st.questionId !== qid || st.phase !== 'QUESTION_OPEN') return;
          const ev = { type: 'cast:questionClosed', payload: { closesAt: Date.now(), softExpired: true }, serverAt: Date.now() };
          const nx = applyEvent(st, ev);
          const r = await commitEvent({ sessionId: sid, expectedRevision: revision, event: ev, state: nx });
          io.to(rooms(sid)).emit(CAST_EVENTS.QUESTION_CLOSED, { revision: r.revision, softExpired: true, serverAt: r.event.serverAt });
    scheduleAutoPodium(sid);
          await emitQuestionEvidence(sid, qid, 1);
        },
      });
    }

    io.to(rooms(cmd.sessionId)).emit(CAST_EVENTS.QUESTION_RESUMED, { revision: res.revision, payload: event.payload });
    ackSend({ ok: true, commandId: cmd.commandId, newRevision: res.revision, closesAt });
  }

  // ── ADD TIME ──
  async function handleAddTime(cmd, actor, ackSend) {
    const state = await getState(cmd.sessionId);
    assertCommandAllowed(state, 'time:add');
    const config = await getConfig(cmd.sessionId);
    const maxExt = config?.timer?.maxExtensionsPerQuestion ?? 3;
    const extensionCount = state.extensionCount || 0;
    if (extensionCount >= maxExt) {
      return ackSend({ ok: false, commandId: cmd.commandId, error: { code: 'INVALID_PHASE', message: 'Maksimal uzaytirish soni' } });
    }
    const seconds = Math.min(120, Math.max(5, Number(cmd.payload?.seconds) || 15));
    const closesAt = (state.closesAt || Date.now()) + seconds * 1000;
    const event = { type: 'cast:timeAdded', payload: { seconds, closesAt, extensionCount: extensionCount + 1 }, serverAt: Date.now() };
    const next = applyEvent({ ...state, extensionCount: extensionCount + 1 }, event);
    const res = await commitEvent({ sessionId: cmd.sessionId, expectedRevision: cmd.expectedRevision, event, state: next });

    if (config?.timer?.mode !== 'off' && closesAt) {
      scheduleQuestionTimer({
        sessionId: cmd.sessionId,
        questionId: state.questionId,
        revision: res.revision,
        expiresAt: closesAt,
        mode: config.timer.mode,
        onFire: async ({ sessionId: sid, questionId: qid, revision }) => {
          const st = await getState(sid);
          if (!st || st.revision !== revision || st.questionId !== qid || st.phase !== 'QUESTION_OPEN') return;
          const ev = { type: 'cast:questionClosed', payload: { closesAt: Date.now(), softExpired: true }, serverAt: Date.now() };
          const nx = applyEvent(st, ev);
          const r = await commitEvent({ sessionId: sid, expectedRevision: revision, event: ev, state: nx });
          io.to(rooms(sid)).emit(CAST_EVENTS.QUESTION_CLOSED, { revision: r.revision, softExpired: true, serverAt: r.event.serverAt });
    scheduleAutoPodium(sid);
          await emitQuestionEvidence(sid, qid, 1);
        },
      });
    }

    io.to(rooms(cmd.sessionId)).emit(CAST_EVENTS.TIME_ADDED, { revision: res.revision, payload: event.payload });
    ackSend({ ok: true, commandId: cmd.commandId, newRevision: res.revision, closesAt });
  }

  // ── CLOSE ──
  async function handleClose(cmd, actor, ackSend) {
    const state = await getState(cmd.sessionId);
    assertCommandAllowed(state, 'question:close');
    // C3-16: self-paced active — normal close bloklanadi
    if (state?.selfPaced?.active) {
      return ackSend({ ok: false, commandId: cmd.commandId, error: { code: 'INVALID_PHASE', message: 'Self-paced poygada normal close ishlamaydi' } });
    }
    cancelSessionTimer(cmd.sessionId);
    const event = { type: 'cast:questionClosed', payload: { closesAt: Date.now(), hostClosed: true }, serverAt: Date.now() };
    const next = applyEvent(state, event);
    const res = await commitEvent({ sessionId: cmd.sessionId, expectedRevision: cmd.expectedRevision, event, state: next });
    io.to(rooms(cmd.sessionId)).emit(CAST_EVENTS.QUESTION_CLOSED, { revision: res.revision, hostClosed: true, serverAt: res.event.serverAt });
    scheduleAutoPodium(cmd.sessionId);
    // Teacher-private evidence → director room only
    if (state.voteRound === 2) {
      // Revote manual close → before/after matrix
      await emitVoteMatrix(cmd.sessionId, state.questionId);
    } else {
      await emitQuestionEvidence(cmd.sessionId, state.questionId, 1);
    }
    ackSend({ ok: true, commandId: cmd.commandId, newRevision: res.revision });
  }

  // ── REVEAL ──
  async function handleReveal(cmd, actor, ackSend) {
    const state = await getState(cmd.sessionId);
    assertCommandAllowed(state, 'question:reveal');
    const config = await getConfig(cmd.sessionId);
    // C3-16: self-paced active — normal reveal bloklanadi
    if (state?.selfPaced?.active) {
      return ackSend({ ok: false, commandId: cmd.commandId, error: { code: 'INVALID_PHASE', message: 'Self-paced poygada normal reveal ishlamaydi' } });
    }
    const priv = await getPrivateQuestion(cmd.sessionId, state.questionId);
    const pubQ = await getPublicQuestion(cmd.sessionId, state.questionId);

    const event = { type: 'cast:questionRevealed', payload: { questionId: state.questionId }, serverAt: Date.now() };
    const next = applyEvent(state, event);
    const res = await commitEvent({ sessionId: cmd.sessionId, expectedRevision: cmd.expectedRevision, event, state: next });

    const includeExplanation = config?.feedback?.explanation === 'after_question';
    const reveal = {
      questionId: state.questionId,
      correctOptionIds: priv?.correctOptionIds || [],
      explanation: includeExplanation && priv?.explanation ? priv.explanation : null,
      revision: res.revision,
    };
    // S30.07: projector public distribution — max 5 bar, identity yo'q (faqat optionId + count + percent)
    try {
      const evidence = await buildQuestionEvidence({
        sessionId: cmd.sessionId,
        questionId: state.questionId,
        attemptNo: state.voteRound === 2 ? 2 : 1,
        store: { listParticipants, listAnswersForQuestion, getState },
      });
      const dist = (evidence?.distribution || [])
        .map((d) => ({ optionId: d.optionId, count: d.count || 0, percent: d.percent || 0 }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);
      if (dist.length) {
        reveal.distribution = dist;
        reveal.distributionTotal = evidence.accepted || 0;
      }
    } catch (err) {
      // distribution opsional — fail bo'lsa reveal baribir boradi
      console.error('[Cast] reveal distribution error:', err.message);
    }
    cancelAutoPodium(cmd.sessionId);
    io.to(rooms(cmd.sessionId)).emit(CAST_EVENTS.QUESTION_REVEALED, reveal);
    ackSend({ ok: true, commandId: cmd.commandId, newRevision: res.revision, reveal });
  }

  // ── NEXT ──
  async function handleNext(cmd, actor, ackSend) {
    const state = await getState(cmd.sessionId);
    assertCommandAllowed(state, 'question:next');
    // C3-16: self-paced active — normal next bloklanadi (SP advance ishlatiladi)
    if (state?.selfPaced?.active) {
      return ackSend({ ok: false, commandId: cmd.commandId, error: { code: 'INVALID_PHASE', message: 'Self-paced poygada normal next ishlamaydi' } });
    }
    cancelSessionTimer(cmd.sessionId);
    const nextPos = state.questionPosition + 1;
    if (nextPos >= state.totalQuestions) {
      return handleSessionEnd(cmd, actor, ackSend);
    }
    const order = computeQuestionOrder(
      Object.keys(await getPublicQuestions(cmd.sessionId)),
      state.sessionSeed || 0,
      true,
    );
    const nextQ = order[nextPos];
    const event = { type: 'cast:questionNext', payload: { questionPosition: nextPos, questionId: nextQ }, serverAt: Date.now() };
    const next = applyEvent(state, event);
    const res = await commitEvent({ sessionId: cmd.sessionId, expectedRevision: cmd.expectedRevision, event, state: next });
    const pubQ2 = await getPublicQuestion(cmd.sessionId, nextQ);
    const cfg2 = await getConfig(cmd.sessionId);
    const thinkSeconds = cfg2?.playback?.thinkSeconds || 0;
    io.to(rooms(cmd.sessionId)).emit(CAST_EVENTS.QUESTION_PREVIEW, {
      revision: res.revision,
      questionPosition: nextPos,
      totalQuestions: state.totalQuestions,
      thinkSeconds,
      question: pubQ2 ? participantQuestionProjection(pubQ2, { phase: 'THINK_TIME', revision: res.revision }) : null,
      serverAt: res.event.serverAt,
    });
    // C4-09 FULLY_AUTO: keyingi savol ham avtomatik ochiladi (thinkSeconds'dan so'ng)
    // — direktor aralashuvi shart emas (reklama/demo uslubidagi to'liq avto oqim).
    const cfgAdv = cfg2?.playback?.advanceMode;
    if (cfgAdv === CAST_ADVANCE_MODE.FULLY_AUTO) {
      const openIt = () => { openQuestionNow(cmd.sessionId, nextQ, res.revision).catch(() => {}); };
      const thinkMs = Math.max(0, Math.round(Number(thinkSeconds) || 0)) * 1000;
      if (thinkMs > 0) setTimeout(openIt, thinkMs);
      else openIt();
    }
    ackSend({ ok: true, commandId: cmd.commandId, newRevision: res.revision, questionPosition: nextPos });
  }

  // ── C4-09: AVTO-SHOHSUPA (podium) — savol yopilgach 3s dan keyin, avto-rejimda 5s ──
  // Faqat har-savol leaderboard ochiq bo'lgan modlarda (CLASSIC_LIVE: top_n + every_question).
  const podiumTimers = new Map();
  function cancelAutoPodium(sessionId) {
    const t = podiumTimers.get(sessionId);
    if (t) { clearTimeout(t); podiumTimers.delete(sessionId); }
  }
  function autoPodiumEligible(config) {
    const lb = (config && config.leaderboard) || {};
    if ((lb.frequency || CAST_LB_FREQUENCY.MANUAL) !== CAST_LB_FREQUENCY.EVERY_QUESTION) return false;
    const vis = lb.visibility || CAST_LB_VISIBILITY.OFF_DURING_LEARNING;
    return vis === CAST_LB_VISIBILITY.TOP_N || vis === CAST_LB_VISIBILITY.RELATIVE_NEIGHBORS;
  }
  async function scheduleAutoPodium(sessionId) {
    cancelAutoPodium(sessionId);
    const t = setTimeout(async () => {
      podiumTimers.delete(sessionId);
      try {
        const state = await getState(sessionId);
        if (!state || !state.questionId || state.phase !== CAST_PHASES.QUESTION_LOCKED) return;
        const config = await getConfig(sessionId).catch(() => null);
        if (!config || !autoPodiumEligible(config)) return;
        const parts = await listParticipants(sessionId).catch(() => ({}));
        if (!parts || Object.keys(parts).length === 0) return;
        const vis = config.leaderboard.visibility;
        await emitLeaderboardProjections(sessionId, { visibility: vis }).catch(() => {});
        // Server state → LEADERBOARD (direktor next/session-end buyruqlari ochiladi;
        // phase LOCKED'da question:next yo'q — manual leaderboard bilan bir xil yo'l)
        if (state.phase === CAST_PHASES.QUESTION_LOCKED) {
          const evLb = { type: 'cast:leaderboardShown', payload: { shownAt: Date.now(), autoPodium: true }, serverAt: Date.now() };
          const nextLb = applyEvent(state, evLb);
          await commitEvent({ sessionId, expectedRevision: state.revision, event: evLb, state: nextLb }).catch((e) => console.error('[Cast] podium phase commit error:', e.message));
        }
        const adv = config.playback && config.playback.advanceMode;
        const autoHoldMs = adv && adv !== CAST_ADVANCE_MODE.HOST_CONTROLLED ? 5000 : 0;
        const serverAt = Date.now();
        // Participant'larga shaxsiy podium (o'z o'rni + ball) — per-participant socket'ga
        const scores = await getScores(sessionId).catch(() => ({}));
        const ranked = buildLeaderboardFromStore(parts, scores);
        for (const entry of ranked) {
          const personal = personalProjection(ranked, entry.participantId, 1);
          if (!personal) continue;
          io.to(trackedSocketsFor(entry.participantId)).emit('cast:podiumShow', {
            questionId: state.questionId,
            personal,
            totalParticipants: ranked.length,
            autoHoldMs,
            serverAt,
          });
        }
        // Public/overlay (projector + director): umumiy ko'rinish
        io.to(rooms(sessionId)).emit('cast:podiumShow', {
          questionId: state.questionId,
          autoHoldMs,
          serverAt,
        });
        // FULLY_AUTO: 5s shohsupadan so'ng avto next/session-end (direktor bosishini kutmaydi)
        if (adv === CAST_ADVANCE_MODE.FULLY_AUTO && autoHoldMs > 0) {
          const t2 = setTimeout(async () => {
            podiumTimers.delete(sessionId);
            try {
              const st2 = await getState(sessionId).catch(() => null);
              if (!st2) return;
              const noop = () => {};
              const auto = { actorId: 'auto-podium', role: 'system' };
              const cmd = { sessionId, expectedRevision: st2.revision };
              if (st2.questionPosition + 1 >= (st2.totalQuestions || 0)) {
                await handleSessionEnd(cmd, auto, noop);
              } else {
                await handleNext(cmd, auto, noop);
              }
            } catch (err2) {
              console.error('[Cast] auto advance after podium error:', err2.message);
            }
          }, autoHoldMs);
          podiumTimers.set(sessionId, t2);
        }
      } catch (err) {
        console.error('[Cast] auto podium error:', err.message);
      }
    }, 3000);
    podiumTimers.set(sessionId, t);
  }

  // ── STYLE S32 — LEADERBOARD PROJECTIONS (shared emit) ──
  // Public Top-N (max 5, low ranks yashirin) + personal projection (participant-private)
  // + team leaderboard. Visibility config'ga bo'ysunadi.
  async function emitLeaderboardProjections(sessionId, { visibility, final = false } = {}) {
    const config = (await getConfig(sessionId).catch(() => null)) || {};
    const lb = config.leaderboard || {};
    const activeVisibility = visibility || (final ? lb.finalVisibility || lb.visibility : lb.visibility) || CAST_LB_VISIBILITY.OFF_DURING_LEARNING;
    if (activeVisibility === CAST_LB_VISIBILITY.OFF_DURING_LEARNING) return;

    const participants = await listParticipants(sessionId).catch(() => ({}));
    const scores = await getScores(sessionId).catch(() => ({}));
    const ranked = buildLeaderboardFromStore(participants, scores);
    const topN = Math.max(1, Math.min(lb.topN || 5, 5)); // S32.02: public Top N default max 5
    const showExact = !!lb.showExactScore;
    const serverAt = Date.now();

    // S32.03/S32.04: neutral list + subtle medal tones — client'da; server safe aliases
    const publicProj = publicTopN(ranked, { topN, showExactScore: showExact });

    // Public (projector + director) — individual low ranks ochilmaydi
    if (activeVisibility === CAST_LB_VISIBILITY.TOP_N || activeVisibility === CAST_LB_VISIBILITY.RELATIVE_NEIGHBORS) {
      io.to(rooms(sessionId)).emit(CAST_EVENTS.LEADERBOARD_UPDATED, {
        mode: 'public_top_n',
        visibility: activeVisibility,
        topN: publicProj,
        final,
        serverAt,
      });
    }

    // Team leaderboard (jamoa low performance individual'ga bog'lanmaydi)
    if (isTeamsEnabled(config)) {
      await emitTeamLeaderboard(sessionId, { topN: Math.min(topN, 8) });
    }

    // Personal projection — participant-private (har biriga o'zi + neighbor'lar)
    if (activeVisibility === CAST_LB_VISIBILITY.PERSONAL_ONLY || activeVisibility === CAST_LB_VISIBILITY.RELATIVE_NEIGHBORS || activeVisibility === CAST_LB_VISIBILITY.TOP_N) {
      for (const entry of ranked) {
        const personal = personalProjection(ranked, entry.participantId, 1);
        if (!personal) continue;
        // C4-09: shaxsiy proyeksiya faqat ushbu participant'ning tracked socket'lariga
        // (identity server-side; boshqa participant/socket olmaydi — S32.05)
        io.to(trackedSocketsFor(entry.participantId)).emit(CAST_EVENTS.LEADERBOARD_UPDATED, {
          mode: 'personal',
          visibility: activeVisibility,
          personal,
          totalParticipants: ranked.length,
          final,
          serverAt,
        });
      }
    }
  }

  // ── STYLE S32 — LEADERBOARD SHOW (director manual) ──
  async function handleLeaderboardShow(cmd, actor, ackSend) {
    cancelAutoPodium(cmd.sessionId);
    const sessionId = cmd.sessionId;
    const state = await getState(sessionId);
    assertCommandAllowed(state, 'leaderboard:show');
    const config = (await getConfig(sessionId).catch(() => null)) || {};
    const lb = config.leaderboard || {};
    const visibility = lb.visibility || CAST_LB_VISIBILITY.OFF_DURING_LEARNING;
    const frequency = lb.frequency || CAST_LB_FREQUENCY.END_ONLY;
    const isFinal = state.phase === CAST_PHASES.ENDED;
    const activeVisibility = isFinal ? lb.finalVisibility || visibility : visibility;

    // Frequency gate — end_only: faqat session end'da (handleSessionEnd chaqiradi);
    // manual: director istalgan payt ko'rsatishi mumkin.
    if (frequency === CAST_LB_FREQUENCY.NEVER) {
      return ackSend({ ok: true, commandId: cmd.commandId, skipped: 'never', reason: 'leaderboard disabled' });
    }
    if (frequency === CAST_LB_FREQUENCY.END_ONLY && !isFinal) {
      return ackSend({ ok: true, commandId: cmd.commandId, skipped: 'end_only', reason: 'final only' });
    }
    if (activeVisibility === CAST_LB_VISIBILITY.OFF_DURING_LEARNING) {
      return ackSend({ ok: true, commandId: cmd.commandId, skipped: 'visibility_off', reason: 'off during learning' });
    }

    await emitLeaderboardProjections(sessionId, { visibility: activeVisibility });

    // State machine → LEADERBOARD phase
    const event = { type: 'cast:leaderboardShown', payload: { shownAt: Date.now() }, serverAt: Date.now() };
    const next = applyEvent(state, event);
    const res = await commitEvent({ sessionId, expectedRevision: cmd.expectedRevision, event, state: next }).catch(() => null);
    await writeAudit(sessionId, { action: 'leaderboard:show', actorId: actor?.actorId, visibility: activeVisibility, safe: true }).catch(() => {});

    ackSend({ ok: true, commandId: cmd.commandId, newRevision: res?.revision, visibility: activeVisibility, serverAt: Date.now() });
  }

  // ── PRIVATE EVIDENCE + HINGE (director room only — C3-01/C3-02) ──
  async function emitQuestionEvidence(sessionId, questionId, attemptNo = 1) {
    try {
      const evidence = await buildQuestionEvidence({ sessionId, questionId, attemptNo, store: { listParticipants, listAnswersForQuestion, getState } });
      const config = await getConfig(sessionId);
      // Correct option ID'lari faqat director private kanalida ishlatiladi
      const priv = await getPrivateQuestion(sessionId, questionId);
      const hinge = recommendHingeAction(evidence, {
        policy: config?.responsiveTeaching?.hingePolicy || undefined,
        correctOptionIds: priv?.correctOptionIds || [],
      });
      io.to(directorRoom(sessionId)).emit(CAST_EVENTS.EVIDENCE_UPDATED, {
        ...directorEvidenceProjection(evidence),
        hinge,
      });
    } catch (err) {
      console.error('[Cast] evidence error:', err.message);
    }
  }

  // ── LOCK NOW (strict timer fire) ──
  async function handleLockNow(sessionId, questionId, revision) {
    try {
      const st = await getState(sessionId);
      if (!st || st.revision !== revision || st.questionId !== questionId) return;
      const ev = { type: 'cast:questionLocked', payload: { questionId, lockedAt: Date.now() }, serverAt: Date.now() };
      const nx = applyEvent(st, ev);
      const r = await commitEvent({ sessionId, expectedRevision: revision, event: ev, state: nx });
      io.to(rooms(sessionId)).emit(CAST_EVENTS.QUESTION_LOCKED, { revision: r.revision, questionId, serverAt: r.event.serverAt });
      scheduleAutoPodium(sessionId);
      await emitQuestionEvidence(sessionId, questionId, 1);
    } catch (err) {
      console.error('[Cast] lockNow error:', err.message);
    }
  }

  // ── LOCK LOBBY ──
  async function handleLockLobby(cmd, ackSend) {
    const locked = !!cmd.payload?.locked;
    await setLobbyLock(cmd.sessionId, locked);
    ackSend({ ok: true, commandId: cmd.commandId, locked });
  }

  // ── REMOVE PARTICIPANT (item 15: vaqtinchalik — rejoin mumkin) ──
  async function handleRemoveParticipant(cmd, actor, ackSend) {
    const pid = cmd.payload?.participantId;
    if (!pid) return ackSend({ ok: false, commandId: cmd.commandId, error: { code: 'INVALID_OPTION' } });
    await removeParticipant(cmd.sessionId, pid);
    io.to(rooms(cmd.sessionId)).emit(CAST_EVENTS.PARTICIPANT_LEFT, { participantId: pid });
    await writeAudit(cmd.sessionId, { action: 'participant:remove', participantId: pid, actorId: actor?.actorId, safe: true });
    ackSend({ ok: true, commandId: cmd.commandId });
  }

  // ── BLOCK PARTICIPANT (item 15: a'zolik blok — qayta qo'shila olmaydi) ──
  async function handleBlockParticipant(cmd, actor, ackSend) {
    const { participantId, reason = '' } = cmd.payload || {};
    if (!participantId) return ackSend({ ok: false, commandId: cmd.commandId, error: { code: 'INVALID_OPTION' } });
    try {
      const participants = await listParticipants(cmd.sessionId);
      const p = participants[participantId];
      const normalized = p?.normalized || normalizeForCompare(p?.displayAlias || '');
      // 🔴 Review fix: normalized bo'sh bo'lsa participantId asosida block (key '' bo'lmasin)
      const blockKey = normalized || participantId;
      // 1) Block list'ga qo'sh
      const res = await blockParticipant(
        { dbGet: fb.get, dbSet: fb.set },
        cmd.sessionId,
        { participantId, normalized: blockKey, reason, blockedBy: actor?.actorId }
      );
      // 2) Ishtirokchini sessiyadan chiqar (remove ham)
      await removeParticipant(cmd.sessionId, participantId);
      io.to(rooms(cmd.sessionId)).emit(CAST_EVENTS.PARTICIPANT_LEFT, { participantId, blocked: true });
      io.to(rooms(cmd.sessionId)).emit(CAST_EVENTS.PARTICIPANT_BLOCKED, { participantId });
      await writeAudit(cmd.sessionId, { action: 'participant:block', participantId, reasonLength: String(reason || '').length, actorId: actor?.actorId, safe: true });
      ackSend({ ok: true, commandId: cmd.commandId, ...res });
    } catch (err) {
      const e = toCastError(err);
      ackSend({ ok: false, commandId: cmd.commandId, error: e });
    }
  }

  // ── UNBLOCK PARTICIPANT (item 15) ──
  async function handleUnblockParticipant(cmd, actor, ackSend) {
    const key = cmd.payload?.key || cmd.payload?.normalized || cmd.payload?.participantId;
    if (!key) return ackSend({ ok: false, commandId: cmd.commandId, error: { code: 'INVALID_OPTION' } });
    try {
      const res = await unblockParticipant({ dbGet: fb.get, dbSet: fb.set }, cmd.sessionId, key);
      io.to(rooms(cmd.sessionId)).emit(CAST_EVENTS.PARTICIPANT_UNBLOCKED, { key });
      await writeAudit(cmd.sessionId, { action: 'participant:unblock', key, actorId: actor?.actorId, safe: true });
      ackSend({ ok: true, commandId: cmd.commandId, ...res });
    } catch (err) {
      const e = toCastError(err);
      ackSend({ ok: false, commandId: cmd.commandId, error: e });
    }
  }

  // ── ROTATE JOIN CODE (item 16: lobby raid → kod aylantirish) ──
  async function handleRotateJoinCode(cmd, actor, ackSend) {
    try {
      const meta = await getSessionMeta(cmd.sessionId);
      const result = await rotateJoinCode(
        { dbGet: fb.get, dbSet: fb.set, dbRemove: fb.remove, dbUpdate: fb.update },
        cmd.sessionId,
        { generateCode: () => genJoinCode(), meta }
      );
      io.to(directorRoom(cmd.sessionId)).emit(CAST_EVENTS.JOIN_CODE_ROTATED, { joinCode: result.newCode, rotatedAt: result.rotatedAt });
      await writeAudit(cmd.sessionId, { action: 'session:rotate_code', actorId: actor?.actorId, safe: true });
      ackSend({ ok: true, commandId: cmd.commandId, joinCode: result.newCode });
    } catch (err) {
      const e = toCastError(err);
      ackSend({ ok: false, commandId: cmd.commandId, error: e });
    }
  }

  // ── CONFUSION SIGNAL (C3-10) ──
  async function handleConfusionSignal(cmd, actor, ackSend) {
    if (actor?.actorRole !== 'participant') {
      return ackSend({ ok: false, commandId: cmd.commandId, error: { code: 'NOT_AUTHORIZED' } });
    }
    const signal = cmd.payload?.signal;
    if (!isValidSignal(signal)) {
      return ackSend({ ok: false, commandId: cmd.commandId, error: { code: 'INVALID_OPTION' } });
    }
    const config = await getConfig(cmd.sessionId).catch(() => null);
    if (config?.responsiveTeaching?.confusionSignal === false) {
      return ackSend({ ok: false, commandId: cmd.commandId, error: { code: 'CAPABILITY_UNSUPPORTED' } });
    }
    // Per-participant cooldown
    const key = `${cmd.sessionId}:${actor.participantId}:${signal}`;
    const last = confusionCooldowns.get(key) || 0;
    const now = Date.now();
    if (now - last < SIGNAL_COOLDOWN_MS) {
      return ackSend({ ok: true, commandId: cmd.commandId, throttled: true });
    }
    confusionCooldowns.set(key, now);
    // Same-signal dedupe (time window, per participant)
    const sessionSignals = confusionSignals.get(cmd.sessionId) || [];
    if (isDuplicateSignal(sessionSignals.find((s) => s.signal === signal && s.participantId === actor.participantId)?.at, now)) {
      return ackSend({ ok: true, commandId: cmd.commandId, throttled: true, dedupe: true });
    }
    sessionSignals.push({ signal, at: now, participantId: actor.participantId });
    confusionSignals.set(cmd.sessionId, sessionSignals.filter((s) => now - s.at <= SIGNAL_DEDUPE_WINDOW_MS));
    await emitConfusionAggregate(cmd.sessionId);
    ackSend({ ok: true, commandId: cmd.commandId });
  }

  // ── QUESTION WALL (C3-10) — private moderation queue ──
  async function handleQuestionWall(cmd, actor, ackSend) {
    if (actor?.actorRole !== 'participant') {
      return ackSend({ ok: false, commandId: cmd.commandId, error: { code: 'NOT_AUTHORIZED' } });
    }
    const config = await getConfig(cmd.sessionId).catch(() => null);
    if (config?.moderation?.questionWall === 'off') {
      return ackSend({ ok: false, commandId: cmd.commandId, error: { code: 'CAPABILITY_UNSUPPORTED' } });
    }
    const text = String(cmd.payload?.text || '');
    const res = await submitWallItem({
      sessionId: cmd.sessionId,
      participantId: actor.participantId,
      text,
      commandId: cmd.commandId,
    });
    if (res.error) {
      return ackSend({ ok: false, commandId: cmd.commandId, error: { code: 'INVALID_OPTION', message: res.error } });
    }
    await emitWallQueue(cmd.sessionId);
    ackSend({ ok: true, commandId: cmd.commandId, contentId: res.contentId, priority: res.priority });
  }

  // ── WALL MODERATE (C3-10/C4-06) — approve/redact/hide/project/withdraw ──
  async function handleWallModerate(cmd, actor, ackSend) {
    const { contentId, action, redactedText } = cmd.payload || {};
    if (!contentId || !action) {
      return ackSend({ ok: false, commandId: cmd.commandId, error: { code: 'INVALID_OPTION' } });
    }
    // C4-06 (item 13): permission matritsasi — faqat owner/co_host/moderator
    const role = await roleFor(cmd.sessionId, actor).catch(() => null);
    if (!role || !canModerate(action, role?.role)) {
      return ackSend({ ok: false, commandId: cmd.commandId, error: { code: 'NOT_AUTHORIZED', message: 'Sizda moderatsiya ruxsati yo‘q' } });
    }
    try {
      const updated = await moderateWallItem({
        sessionId: cmd.sessionId,
        contentId,
        action,
        moderatorId: actor?.actorId || null,
        redactedText,
      });
      await emitWallQueue(cmd.sessionId);
      await emitWallPublic(cmd.sessionId);
      await writeAudit(cmd.sessionId, { action: 'wall:' + action, contentId, actorId: actor?.actorId, safe: true });
      ackSend({ ok: true, commandId: cmd.commandId, state: updated.moderationState });
    } catch (err) {
      const e = toCastError(err);
      ackSend({ ok: false, commandId: cmd.commandId, error: e });
    }
  }

  // ── SIGNAL ACK (C3-10) — teacher acknowledgement ──
  async function handleSignalAck(cmd, actor, ackSend) {
    const { signal } = cmd.payload || {};
    if (!isValidSignal(signal)) {
      return ackSend({ ok: false, commandId: cmd.commandId, error: { code: 'INVALID_OPTION' } });
    }
    const acks = confusionAcks.get(cmd.sessionId) || {};
    acks[signal] = Date.now();
    confusionAcks.set(cmd.sessionId, acks);
    await emitConfusionAggregate(cmd.sessionId);
    await writeAudit(cmd.sessionId, { action: 'signal:ack', signal, actorId: actor?.actorId, safe: true });
    ackSend({ ok: true, commandId: cmd.commandId });
  }

  // ── Emit helpers (C3-10) ──
  async function emitConfusionAggregate(sessionId) {
    try {
      const sessionSignals = confusionSignals.get(sessionId) || [];
      const acks = confusionAcks.get(sessionId) || {};
      const { counts } = aggregateSignals(sessionSignals, Date.now());
      const ackList = CONFUSION_SIGNALS.filter((s) => acks[s]);
      // Director + moderator: to'liq counts
      const aggregate = acknowledgeSignals(buildAggregatePayload(counts), ackList);
      io.to(directorRoom(sessionId)).emit(CAST_EVENTS.CONFUSION_AGGREGATE, aggregate);
      io.to(moderationRoom(sessionId)).emit(CAST_EVENTS.CONFUSION_AGGREGATE, aggregate);
      // Participants/projector: faqat ack status (counts yashirilgan — identity ham, sinf soni ham)
      const publicAgg = acknowledgeSignals(buildAggregatePayload({}), ackList);
      io.to(rooms(sessionId)).emit(CAST_EVENTS.CONFUSION_AGGREGATE, publicAgg);
    } catch (err) {
      console.error('[Cast] confusion aggregate error:', err.message);
    }
  }

  async function emitWallQueue(sessionId) {
    try {
      const queue = await listWallQueue(sessionId);
      const pending = Object.values(queue)
        .filter((v) => WALL_PENDING_STATES.includes(v.moderationState))
        .map((v) => v);
      const payload = {
        pending: pending.slice(0, 50), // limit
        total: pending.length,
      };
      io.to(directorRoom(sessionId)).emit(CAST_EVENTS.WALL_QUEUE, payload);
      io.to(moderationRoom(sessionId)).emit(CAST_EVENTS.WALL_QUEUE, payload);
    } catch (err) {
      console.error('[Cast] wall queue error:', err.message);
    }
  }

  async function emitWallPublic(sessionId) {
    try {
      const publicWall = await getPublicWall(sessionId);
      // C4-06 (item 17): moderator unavailable + openText host_review_first →
      // content private hold (proyeksiyaga chiqmaydi, director ham ko'radi held status)
      const config = await getConfig(sessionId).catch(() => null);
      const held = holdWhenModeratorUnavailable(
        { moderatorOnline: publicWall.moderatorOnline, frozen: publicWall.frozen },
        config
      );
      io.to(rooms(sessionId)).emit(CAST_EVENTS.WALL_PUBLIC, { ...publicWall, held });
      if (held) {
        io.to(directorRoom(sessionId)).emit(CAST_EVENTS.WALL_PUBLIC, { ...publicWall, held: true });
        io.to(moderationRoom(sessionId)).emit(CAST_EVENTS.WALL_PUBLIC, { ...publicWall, held: true });
      }
    } catch (err) {
      console.error('[Cast] wall public error:', err.message);
    }
  }

  // ══════════════════ C5-11 AI Co-host Shadow (recommendation card only) ══════════════════

  // ── SHADOW RUN (director): suggestion generatsiya + director room'ga emit ──
  // Item 5/7: AI hech qachon live command bajarmaydi — faqat card.
  async function handleShadowRun(cmd, actor, ackSend) {
    const config = (await getConfig(cmd.sessionId).catch(() => null)) || {};
    if (config?.ai?.cohostMode !== 'shadow') {
      return ackSend({ ok: false, commandId: cmd.commandId, error: { code: 'INVALID_OPTION', message: 'AI co-host shadow o\'chiq (ai.cohostMode)' } });
    }
    const state = await getState(cmd.sessionId).catch(() => null);
    // Baseline: rule-engine chiqishlari (evidence/hinge) — de-identified.
    const evidence = state?.questionId ? await computeQuestionEvidenceSafe(cmd.sessionId) : null;
    const baseline = buildShadowBaseline({
      evidence,
      hinge: state?.questionId ? getHingeForState(state) : null,
    });
    const shadowInput = buildShadowInput({ baseline, config, context: { phase: state?.phase, questionIndex: state?.questionIndex } });
    const result = await runShadowSuggestion({ shadowInput, opts: { timeoutMs: 4000, maxCostUs: 400 } });
    if (!result.ok) {
      return ackSend({ ok: false, commandId: cmd.commandId, error: { code: 'AI_UNAVAILABLE', message: result.error } });
    }
    const suggestion = { id: 'sh_' + crypto.randomUUID().slice(0, 8), ...result.suggestion };
    const evaluation = recordShadowDecision({ suggestion, decision: 'pending', latencyMs: result.latencyMs, costUs: result.costUs, baseline });
    if (evaluation.ok) {
      const runs = shadowRunsBySession.get(cmd.sessionId) || [];
      runs.push(evaluation.evaluation);
      // Review fix: unbounded growth oldini olish — oxirgi 100 run saqlanadi
      if (runs.length > SHADOW_MAX_RUNS_PER_SESSION) runs.splice(0, runs.length - SHADOW_MAX_RUNS_PER_SESSION);
      shadowRunsBySession.set(cmd.sessionId, runs);
    }
    io.to(directorRoom(cmd.sessionId)).emit(CAST_EVENTS.SHADOW_SUGGESTION, {
      suggestion,
      provider: result.provider,
      latencyMs: result.latencyMs,
      costUs: result.costUs,
      baseline: baseline.aggregate,
    });
    await writeAudit(cmd.sessionId, { action: 'shadow:run', suggestionId: suggestion.id, safe: true }).catch(() => {});
    ackSend({ ok: true, commandId: cmd.commandId, suggestionId: suggestion.id });
  }

  // ── SHADOW DECIDE (director): teacher accept/dismiss eventini yig'ish ──
  // Item 6: decision'lar run history'ga yoziladi, gate'da ishlatiladi.
  async function handleShadowDecide(cmd, actor, ackSend) {
    const { decision, suggestionId } = cmd.payload || {};
    if (!['accepted', 'dismissed'].includes(decision)) {
      return ackSend({ ok: false, commandId: cmd.commandId, error: { code: 'INVALID_OPTION', message: 'Noma\'lum qaror' } });
    }
    const runs = shadowRunsBySession.get(cmd.sessionId) || [];
    const pending = runs.find((r) => r.suggestionId === suggestionId && r.decision === 'pending');
    if (!pending) {
      return ackSend({ ok: false, commandId: cmd.commandId, error: { code: 'INVALID_OPTION', message: 'Suggestion topilmadi yoki allaqachon qaror qilingan' } });
    }
    pending.decision = decision;
    pending.accepted = decision === 'accepted';
    pending.dismissed = decision === 'dismissed';
    if (decision === 'dismissed') pending.falseInterruption = 1;
    await writeAudit(cmd.sessionId, { action: `shadow:decide:${decision}`, suggestionId, safe: true }).catch(() => {});
    ackSend({ ok: true, commandId: cmd.commandId, recorded: true });
  }

  // ── SHADOW GATE (director): evaluation gate — suggestion mode'ga o'tish mumkinmi ──
  // Item 10: shadow evaluation gate'dan o'tmasa suggestion mode'ga o'tilmaydi.
  async function handleShadowGate(cmd, actor, ackSend) {
    const runs = shadowRunsBySession.get(cmd.sessionId) || [];
    const gate = computeShadowGate({ runs });
    ackSend({ ok: true, commandId: cmd.commandId, ...gate });
  }

  // ── Small helpers (shadow) ──
  async function computeQuestionEvidenceSafe(sessionId) {
    try {
      const state = await getState(sessionId);
      return computeQuestionEvidence({
        sessionId,
        questionId: state.questionId,
        attemptNo: state.attemptNo || 1,
        participants: state.participants || {},
        answers: state.answers || {},
        revision: state.revision || 0,
      });
    } catch (_) {
      return null;
    }
  }
  function getHingeForState(state) {
    try {
      return state.hinge || state.hingeDecision?.recommendation ? { recommendation: state.hinge || state.hingeDecision?.recommendation } : null;
    } catch (_) {
      return null;
    }
  }

  // ══════════════════ C3-11 POE (Prediction → Observation → Explanation) ══════════════════

  // ── POE LAUNCH (director) ──
  async function handlePoeLaunch(cmd, actor, ackSend) {
    const state = await getState(cmd.sessionId);
    assertCommandAllowed(state, 'poe:launch');
    const validation = validatePoeContract(cmd.payload?.contract);
    if (!validation.ok) {
      return ackSend({ ok: false, commandId: cmd.commandId, error: { code: 'INVALID_OPTION', message: validation.errors.join('; ') } });
    }
    const { contract } = validation;
    const predQ = await getPublicQuestion(cmd.sessionId, contract.predictionQuestionId);
    const expQ = await getPublicQuestion(cmd.sessionId, contract.explanationQuestionId);
    if (!predQ || !expQ) {
      return ackSend({ ok: false, commandId: cmd.commandId, error: { code: 'INVALID_OPTION', message: 'Prediction yoki explanation savol topilmadi' } });
    }
    const config = await getConfig(cmd.sessionId);
    const predictionSeconds = contract.timerPolicy.predictionSeconds || config?.timer?.defaultSeconds || 30;
    const openedAt = Date.now();
    const closesAt = openedAt + predictionSeconds * 1000;
    const event = { type: 'poe:launched', payload: { contract, openedAt, closesAt }, serverAt: openedAt };
    const next = applyEvent(state, event);
    assertPhaseTransition(state, next.phase);
    const res = await commitEvent({ sessionId: cmd.sessionId, expectedRevision: cmd.expectedRevision, event, state: next });

    io.to(rooms(cmd.sessionId)).emit(CAST_EVENTS.POE_PREDICTION_OPENED, {
      revision: res.revision,
      flowId: contract.flowId,
      question: participantQuestionProjection(predQ, { phase: 'PREDICTION_OPEN', openedAt, closesAt, revision: res.revision }),
      askConfidence: true,
      closesAt,
      serverAt: res.event.serverAt,
    });
    io.to(directorRoom(cmd.sessionId)).emit(CAST_EVENTS.POE_LAUNCHED, {
      revision: res.revision,
      contract,
      closesAt,
    });

    if (config?.timer?.mode !== 'off' && closesAt) {
      scheduleQuestionTimer({
        sessionId: cmd.sessionId,
        questionId: contract.predictionQuestionId,
        revision: res.revision,
        expiresAt: closesAt,
        mode: config.timer.mode,
        onFire: async ({ sessionId: sid, revision }) => {
          await closePredictionNow(sid, revision, true);
        },
      });
    }
    await writeAudit(cmd.sessionId, { action: 'poe:launch', flowId: contract.flowId, actorId: actor?.actorId, safe: true });
    ackSend({ ok: true, commandId: cmd.commandId, newRevision: res.revision, closesAt });
  }

  async function closePredictionNow(sessionId, revision, softExpired = false) {
    try {
      const st = await getState(sessionId);
      if (!st || st.revision !== revision || st.phase !== CAST_PHASES.PREDICTION_OPEN) return;
      const event = { type: 'poe:predictionLocked', payload: { closedAt: Date.now(), softExpired }, serverAt: Date.now() };
      const nx = applyEvent(st, event);
      const r = await commitEvent({ sessionId, expectedRevision: revision, event, state: nx });
      await emitPoePredictionUpdate(sessionId, st.poeFlow?.contract, { stage: 'locked' });
      const obsPayload = {
        revision: r.revision,
        flowId: st.poeFlow?.contract?.flowId,
        media: st.poeFlow?.contract?.media || null,
        serverAt: r.event.serverAt,
      };
      io.to(rooms(sessionId)).emit(CAST_EVENTS.POE_OBSERVATION_STARTED, obsPayload);
      io.to(directorRoom(sessionId)).emit(CAST_EVENTS.POE_OBSERVATION_STARTED, obsPayload);
      await emitPoeMediaState(sessionId);
    } catch (err) {
      console.error('[Cast] closePredictionNow error:', err.message);
    }
  }

  // ── POE SUBMIT PREDICTION (participant) ──
  async function handlePoeSubmitPrediction(cmd, actor, ackSend) {
    if (actor?.actorRole !== 'participant' || !actor.participantId) {
      return ackSend({ ok: false, commandId: cmd.commandId, error: { code: 'NOT_AUTHORIZED' } });
    }
    const state = await getState(cmd.sessionId);
    if (state.phase !== CAST_PHASES.PREDICTION_OPEN || !state.poeFlow) {
      return ackSend({ ok: false, commandId: cmd.commandId, error: { code: 'INVALID_PHASE' } });
    }
    const contract = state.poeFlow.contract;
    const priv = await getPrivateQuestion(cmd.sessionId, contract.predictionQuestionId);
    const validIds = new Set((priv?.options || []).map((o) => o.id));
    const selected = Array.isArray(cmd.payload?.selectedOptionIds) ? cmd.payload.selectedOptionIds : [];
    for (const id of selected) {
      if (!validIds.has(id)) return ackSend({ ok: false, commandId: cmd.commandId, error: { code: 'INVALID_OPTION' } });
    }
    const config = await getConfig(cmd.sessionId);
    if (config?.timer?.mode === 'strict' && state.closesAt && Date.now() > state.closesAt) {
      return ackSend({ ok: false, commandId: cmd.commandId, error: { code: 'REJECTED_LATE' } });
    }
    const res = await recordPrediction({
      sessionId: cmd.sessionId,
      flowId: contract.flowId,
      participantId: actor.participantId,
      questionId: contract.predictionQuestionId,
      selectedOptionIds: selected,
      confidence: cmd.payload?.confidence,
      commandId: cmd.commandId,
    });
    if (res.error) return ackSend({ ok: false, commandId: cmd.commandId, error: { code: 'INVALID_OPTION', message: res.error } });
    await emitPoePredictionUpdate(cmd.sessionId, contract, { stage: 'live' });
    ackSend({ ok: true, commandId: cmd.commandId, status: 'ACCEPTED' });
  }

  // ── POE CLOSE PREDICTION (director) → OBSERVATION ──
  async function handlePoeClosePrediction(cmd, actor, ackSend) {
    const state = await getState(cmd.sessionId);
    assertCommandAllowed(state, 'poe:closePrediction');
    cancelSessionTimer(cmd.sessionId);
    const event = { type: 'poe:predictionLocked', payload: { closedAt: Date.now(), hostClosed: true }, serverAt: Date.now() };
    const next = applyEvent(state, event);
    const res = await commitEvent({ sessionId: cmd.sessionId, expectedRevision: cmd.expectedRevision, event, state: next });
    await emitPoePredictionUpdate(cmd.sessionId, state.poeFlow?.contract, { stage: 'locked' });
    const obsPayload = {
      revision: res.revision,
      flowId: state.poeFlow?.contract?.flowId,
      media: state.poeFlow?.contract?.media || null,
      serverAt: res.event.serverAt,
    };
    io.to(rooms(cmd.sessionId)).emit(CAST_EVENTS.POE_OBSERVATION_STARTED, obsPayload);
    io.to(directorRoom(cmd.sessionId)).emit(CAST_EVENTS.POE_OBSERVATION_STARTED, obsPayload);
    await emitPoeMediaState(cmd.sessionId);
    ackSend({ ok: true, commandId: cmd.commandId, newRevision: res.revision });
  }

  // ── POE MEDIA READY (participant) ──
  async function handlePoeMediaReady(cmd, actor, ackSend) {
    if (actor?.actorRole !== 'participant' || !actor.participantId) {
      return ackSend({ ok: false, commandId: cmd.commandId, error: { code: 'NOT_AUTHORIZED' } });
    }
    const state = await getState(cmd.sessionId);
    if (state.phase !== CAST_PHASES.OBSERVATION || !state.poeFlow) {
      return ackSend({ ok: false, commandId: cmd.commandId, error: { code: 'INVALID_PHASE' } });
    }
    const { flowId } = state.poeFlow.contract;
    await fb.set(`cast_private/${cmd.sessionId}/poe/${flowId}/readiness/${actor.participantId}`, { at: Date.now() });
    await emitPoeMediaState(cmd.sessionId);
    ackSend({ ok: true, commandId: cmd.commandId });
  }

  // ── POE MEDIA ACTION (director: retry / skip / fallback — item 14) ──
  async function handlePoeMediaAction(cmd, actor, ackSend) {
    const state = await getState(cmd.sessionId);
    assertCommandAllowed(state, 'poe:mediaAction');
    const action = cmd.payload?.action;
    const contract = state.poeFlow?.contract;
    if (!contract || !['retry', 'skip', 'fallback'].includes(action)) {
      return ackSend({ ok: false, commandId: cmd.commandId, error: { code: 'INVALID_OPTION' } });
    }
    if (action === 'retry') {
      io.to(rooms(cmd.sessionId)).emit(CAST_EVENTS.POE_OBSERVATION_STARTED, {
        flowId: contract.flowId,
        media: contract.media,
        retry: true,
        serverAt: Date.now(),
      });
      return ackSend({ ok: true, commandId: cmd.commandId, action });
    }
    if (action === 'fallback') {
      const fallbackText = String(cmd.payload?.fallbackText || '').trim().slice(0, 500);
      if (!fallbackText) return ackSend({ ok: false, commandId: cmd.commandId, error: { code: 'INVALID_OPTION' } });
      const event = { type: 'poe:mediaFailed', payload: { fallbackText }, serverAt: Date.now() };
      const next = applyEvent(state, event);
      await commitEvent({ sessionId: cmd.sessionId, expectedRevision: cmd.expectedRevision, event, state: next });
      io.to(rooms(cmd.sessionId)).emit(CAST_EVENTS.POE_OBSERVATION_STARTED, {
        flowId: contract.flowId,
        media: { type: 'live_note', text: fallbackText },
        fallback: true,
        serverAt: Date.now(),
      });
      await writeAudit(cmd.sessionId, { action: 'poe:media_fallback', flowId: contract.flowId, actorId: actor?.actorId, safe: true });
      return ackSend({ ok: true, commandId: cmd.commandId, action });
    }
    // skip → explanation'ga to'g'ridan-to'g'ri (force)
    return handlePoeStartExplanation(cmd, actor, ackSend, { force: true });
  }

  // ── POE START EXPLANATION (director) — strict timer gate (item 7) ──
  async function handlePoeStartExplanation(cmd, actor, ackSend, opts = {}) {
    const state = await getState(cmd.sessionId);
    assertCommandAllowed(state, 'poe:startExplanation');
    const contract = state.poeFlow?.contract;
    if (!contract) return ackSend({ ok: false, commandId: cmd.commandId, error: { code: 'INVALID_PHASE' } });
    const config = await getConfig(cmd.sessionId);
    if (config?.timer?.mode === 'strict' && !opts.force && !cmd.payload?.force) {
      const readiness = await getMediaReadiness(cmd.sessionId, contract.flowId, contract.mediaReadyThreshold);
      if (!readiness.ready) {
        return ackSend({ ok: false, commandId: cmd.commandId, error: { code: 'MEDIA_NOT_READY', message: `Media tayyorligi: ${readiness.readyCount}/${readiness.required}` } });
      }
    }
    const explanationSeconds = contract.timerPolicy.explanationSeconds || config?.timer?.defaultSeconds || 60;
    const openedAt = Date.now();
    const closesAt = openedAt + explanationSeconds * 1000;
    const event = { type: 'poe:explanationOpened', payload: { openedAt, closesAt }, serverAt: openedAt };
    const next = applyEvent(state, event);
    const res = await commitEvent({ sessionId: cmd.sessionId, expectedRevision: cmd.expectedRevision, event, state: next });
    const expQ = await getPublicQuestion(cmd.sessionId, contract.explanationQuestionId);
    const mode = expQ?.type === 'short_answer' ? 'short_answer' : 'mcq';
    const expPayload = {
      revision: res.revision,
      flowId: contract.flowId,
      mode,
      question: participantQuestionProjection(expQ, { phase: 'EXPLANATION_OPEN', openedAt, closesAt, revision: res.revision }),
      closesAt,
      serverAt: res.event.serverAt,
    };
    io.to(rooms(cmd.sessionId)).emit(CAST_EVENTS.POE_EXPLANATION_OPENED, expPayload);
    io.to(directorRoom(cmd.sessionId)).emit(CAST_EVENTS.POE_EXPLANATION_OPENED, expPayload);
    if (config?.timer?.mode !== 'off' && closesAt) {
      scheduleQuestionTimer({
        sessionId: cmd.sessionId,
        questionId: contract.explanationQuestionId,
        revision: res.revision,
        expiresAt: closesAt,
        mode: config.timer.mode,
        onFire: async ({ sessionId: sid, revision }) => {
          await closeExplanationNow(sid, revision, true);
        },
      });
    }
    await writeAudit(cmd.sessionId, { action: 'poe:start_explanation', flowId: contract.flowId, actorId: actor?.actorId, safe: true });
    ackSend({ ok: true, commandId: cmd.commandId, newRevision: res.revision, closesAt });
  }

  async function closeExplanationNow(sessionId, revision, softExpired = false) {
    try {
      const st = await getState(sessionId);
      if (!st || st.revision !== revision || st.phase !== CAST_PHASES.EXPLANATION_OPEN) return;
      const event = { type: 'poe:explanationLocked', payload: { closedAt: Date.now(), softExpired }, serverAt: Date.now() };
      const nx = applyEvent(st, event);
      const r = await commitEvent({ sessionId, expectedRevision: revision, event, state: nx });
      const closedPayload = { revision: r.revision, softExpired: true, serverAt: r.event.serverAt };
      io.to(rooms(sessionId)).emit(CAST_EVENTS.POE_EXPLANATION_CLOSED, closedPayload);
      io.to(directorRoom(sessionId)).emit(CAST_EVENTS.POE_EXPLANATION_CLOSED, closedPayload);
    } catch (err) {
      console.error('[Cast] closeExplanationNow error:', err.message);
    }
  }

  // ── POE SUBMIT EXPLANATION (participant) ──
  async function handlePoeSubmitExplanation(cmd, actor, ackSend) {
    if (actor?.actorRole !== 'participant' || !actor.participantId) {
      return ackSend({ ok: false, commandId: cmd.commandId, error: { code: 'NOT_AUTHORIZED' } });
    }
    const state = await getState(cmd.sessionId);
    if (state.phase !== CAST_PHASES.EXPLANATION_OPEN || !state.poeFlow) {
      return ackSend({ ok: false, commandId: cmd.commandId, error: { code: 'INVALID_PHASE' } });
    }
    const contract = state.poeFlow.contract;
    const expQ = await getPublicQuestion(cmd.sessionId, contract.explanationQuestionId);
    const mode = expQ?.type === 'short_answer' ? 'short_answer' : 'mcq';
    const payload = {
      sessionId: cmd.sessionId,
      flowId: contract.flowId,
      participantId: actor.participantId,
      questionId: contract.explanationQuestionId,
      mode,
      text: cmd.payload?.text,
      selectedOptionIds: cmd.payload?.selectedOptionIds,
      commandId: cmd.commandId,
    };
    if (mode === 'mcq') {
      const priv = await getPrivateQuestion(cmd.sessionId, contract.explanationQuestionId);
      const validIds = new Set((priv?.options || []).map((o) => o.id));
      for (const id of (payload.selectedOptionIds || [])) {
        if (!validIds.has(id)) return ackSend({ ok: false, commandId: cmd.commandId, error: { code: 'INVALID_OPTION' } });
      }
    }
    const res = await recordExplanation(payload);
    if (res.error) return ackSend({ ok: false, commandId: cmd.commandId, error: { code: 'INVALID_OPTION', message: res.error } });
    // Short answer → exemplar queue (moderatsiyadan keyin public — item 12)
    if (mode === 'short_answer' && res.record?.text) {
      await submitExemplar({
        sessionId: cmd.sessionId,
        flowId: contract.flowId,
        participantId: actor.participantId,
        text: res.record.text,
        commandId: cmd.commandId,
      });
      await emitPoeExemplarQueue(cmd.sessionId, contract.flowId);
    }
    await emitPoeExplanationUpdate(cmd.sessionId, contract);
    ackSend({ ok: true, commandId: cmd.commandId, status: 'ACCEPTED', mode });
  }

  // ── POE CLOSE EXPLANATION (director) → QUESTION_LOCKED ──
  async function handlePoeCloseExplanation(cmd, actor, ackSend) {
    const state = await getState(cmd.sessionId);
    assertCommandAllowed(state, 'poe:closeExplanation');
    cancelSessionTimer(cmd.sessionId);
    const event = { type: 'poe:explanationLocked', payload: { closedAt: Date.now(), hostClosed: true }, serverAt: Date.now() };
    const next = applyEvent(state, event);
    const res = await commitEvent({ sessionId: cmd.sessionId, expectedRevision: cmd.expectedRevision, event, state: next });
    const closedPayload = { revision: res.revision, serverAt: res.event.serverAt };
    io.to(rooms(cmd.sessionId)).emit(CAST_EVENTS.POE_EXPLANATION_CLOSED, closedPayload);
    io.to(directorRoom(cmd.sessionId)).emit(CAST_EVENTS.POE_EXPLANATION_CLOSED, closedPayload);
    ackSend({ ok: true, commandId: cmd.commandId, newRevision: res.revision });
  }

  // ── POE SHOW ANALYSIS (director) → REVEAL + action pack (items 10-13) ──
  async function handlePoeShowAnalysis(cmd, actor, ackSend) {
    const state = await getState(cmd.sessionId);
    if (!state.poeFlow || state.phase !== CAST_PHASES.QUESTION_LOCKED) {
      return ackSend({ ok: false, commandId: cmd.commandId, error: { code: 'INVALID_PHASE' } });
    }
    const event = { type: 'poe:analysisShown', payload: { shownAt: Date.now() }, serverAt: Date.now() };
    const next = applyEvent(state, event);
    const res = await commitEvent({ sessionId: cmd.sessionId, expectedRevision: cmd.expectedRevision, event, state: next });
    const { contract } = state.poeFlow;
    const records = await getPoeRecords(cmd.sessionId, contract.flowId);
    const analysis = {
      flowId: contract.flowId,
      predictionDistribution: computePredictionDistribution(records),
      changeMatrix: computeChangeMatrix(records),
      aggregatePattern: computeAggregatePattern(records),
    };
    // Director private: to'liq (change matrix identity bilan — teacher-private)
    io.to(directorRoom(cmd.sessionId)).emit(CAST_EVENTS.POE_ANALYSIS, { revision: res.revision, ...analysis });
    // Public: faqat aggregate + approved exemplars
    const exemplars = projectPublicExemplars(await listExemplarQueue(cmd.sessionId, contract.flowId));
    io.to(rooms(cmd.sessionId)).emit(CAST_EVENTS.POE_ANALYSIS_PUBLIC, {
      revision: res.revision,
      aggregatePattern: analysis.aggregatePattern,
      exemplars: exemplars.slice(0, 6),
    });
    // Action Pack summary (item 13)
    const summary = buildPoeSummary(records, { flowId: contract.flowId });
    await fb.set(`cast_sessions/${cmd.sessionId}/action_pack/poe/${contract.flowId}`, summary);
    await writeAudit(cmd.sessionId, { action: 'poe:show_analysis', flowId: contract.flowId, actorId: actor?.actorId, safe: true });
    ackSend({ ok: true, commandId: cmd.commandId, newRevision: res.revision });
  }

  // ── POE MODERATE EXEMPLAR (director/moderator — item 12) ──
  async function handlePoeModerateExemplar(cmd, actor, ackSend) {
    const { flowId, exemplarId, action, redactedText } = cmd.payload || {};
    const state = await getState(cmd.sessionId);
    const fId = flowId || state?.poeFlow?.contract?.flowId;
    if (!fId || !exemplarId || !action) {
      return ackSend({ ok: false, commandId: cmd.commandId, error: { code: 'INVALID_OPTION' } });
    }
    try {
      await moderateExemplar({
        sessionId: cmd.sessionId,
        flowId: fId,
        exemplarId,
        action,
        moderatorId: actor?.actorId || null,
        redactedText,
      });
      await emitPoeExemplarQueue(cmd.sessionId, fId);
      await emitPoeExemplarPublic(cmd.sessionId, fId);
      await writeAudit(cmd.sessionId, { action: 'poe:exemplar:' + action, exemplarId, actorId: actor?.actorId, safe: true });
      ackSend({ ok: true, commandId: cmd.commandId });
    } catch (err) {
      ackSend({ ok: false, commandId: cmd.commandId, error: toCastError(err) });
    }
  }

  // ── C3-12 Open-Response Semantic Board ──

  async function emitOrbCount(sessionId, runId) {
    const data = await getOrbData(sessionId, runId);
    const total = Object.keys(data.responses).length;
    const safeHold = Object.values(data.responses).filter((r) => r.state === 'SAFE_HOLD').length;
    io.to(rooms(sessionId)).emit(CAST_EVENTS.ORB_COUNT, { runId, total, safeHold });
  }

  async function emitOrbProjector(sessionId, runId) {
    const board = await buildProjectorBoard(sessionId, runId);
    io.to(rooms(sessionId)).emit(CAST_EVENTS.ORB_PROJECTOR, { runId, board });
  }

  // ── ORB LAUNCH (director) → ORB_COLLECT ──
  async function handleOrbLaunch(cmd, actor, ackSend) {
    const state = await getState(cmd.sessionId);
    assertCommandAllowed(state, 'orb:launch');
    const prompt = String(cmd.payload?.prompt || '').trim().slice(0, 500);
    if (!prompt) return ackSend({ ok: false, commandId: cmd.commandId, error: { code: 'INVALID_OPTION', message: 'Savol matni kerak' } });
    const runId = 'orb_' + crypto.randomBytes(5).toString('hex');
    const seconds = Math.min(600, Math.max(5, Number(cmd.payload?.seconds) || 60));
    const openedAt = Date.now();
    const closesAt = openedAt + seconds * 1000;
    const event = { type: 'orb:opened', payload: { runId, prompt, openedAt, closesAt }, serverAt: openedAt };
    const next = applyEvent(state, event);
    const res = await commitEvent({ sessionId: cmd.sessionId, expectedRevision: cmd.expectedRevision, event, state: next });
    // Private store meta
    const provider = getActiveClusteringProvider();
    await fb.set(`cast_private/${cmd.sessionId}/orb/${runId}/meta`, {
      runId, prompt, openedAt, closesAt, status: 'COLLECT',
      provider: provider.id, retentionDays: providerRetentionDays(provider.id), trainingUse: false,
    });
    io.to(rooms(cmd.sessionId)).emit(CAST_EVENTS.ORB_OPENED, {
      revision: res.revision, runId, prompt, closesAt, serverAt: res.event.serverAt,
    });
    io.to(directorRoom(cmd.sessionId)).emit(CAST_EVENTS.ORB_OPENED, { revision: res.revision, runId, prompt, closesAt });
    if (closesAt) {
      scheduleQuestionTimer({
        sessionId: cmd.sessionId,
        questionId: runId,
        revision: res.revision,
        expiresAt: closesAt,
        mode: 'soft',
        onFire: async ({ sessionId: sid, revision }) => {
          await closeOrbNow(sid, revision, true);
        },
      });
    }
    await writeAudit(cmd.sessionId, { action: 'orb:launch', runId, promptLen: prompt.length, actorId: actor?.actorId, safe: true });
    ackSend({ ok: true, commandId: cmd.commandId, runId, newRevision: res.revision, closesAt });
  }

  async function closeOrbNow(sessionId, revision, softExpired = false) {
    try {
      const st = await getState(sessionId);
      if (!st || st.revision !== revision || st.phase !== CAST_PHASES.ORB_COLLECT) return;
      const event = { type: 'orb:closed', payload: { closedAt: Date.now(), softExpired }, serverAt: Date.now() };
      const nx = applyEvent(st, event);
      const r = await commitEvent({ sessionId, expectedRevision: revision, event, state: nx });
      const runId = st.orbFlow?.runId;
      if (runId) {
        await fb.set(`cast_private/${sessionId}/orb/${runId}/meta/status`, 'REVIEW');
        await fb.set(`cast_private/${sessionId}/orb/${runId}/meta/closedAt`, Date.now());
        await emitOrbCount(sessionId, runId);
        // Director review UI'ni ham to'ldiramiz (manual close bilan bir xil)
        const data = await getOrbData(sessionId, runId);
        io.to(directorRoom(sessionId)).emit(CAST_EVENTS.ORB_CLOSED, { revision: r.revision, runId, data, softExpired: true });
      } else {
        io.to(directorRoom(sessionId)).emit(CAST_EVENTS.ORB_CLOSED, { revision: r.revision, runId: null, softExpired: true });
      }
      io.to(rooms(sessionId)).emit(CAST_EVENTS.ORB_CLOSED, { revision: r.revision, softExpired: true, serverAt: r.event.serverAt });
    } catch (err) {
      console.error('[Cast] closeOrbNow error:', err.message);
    }
  }

  // ── ORB SUBMIT (participant) ──
  async function handleOrbSubmit(cmd, actor, ackSend) {
    if (actor?.actorRole !== 'participant' || !actor.participantId) {
      return ackSend({ ok: false, commandId: cmd.commandId, error: { code: 'NOT_AUTHORIZED' } });
    }
    const state = await getState(cmd.sessionId);
    if (state.phase !== CAST_PHASES.ORB_COLLECT || !state.orbFlow?.runId) {
      return ackSend({ ok: false, commandId: cmd.commandId, error: { code: 'INVALID_PHASE' } });
    }
    const v = validateOpenResponse(cmd.payload?.text);
    if (!v.ok) return ackSend({ ok: false, commandId: cmd.commandId, error: { code: 'INVALID_OPTION', message: v.error } });
    const res = await collectOpenResponse({
      sessionId: cmd.sessionId,
      runId: state.orbFlow.runId,
      participantId: actor.participantId,
      text: v.clean,
      commandId: cmd.commandId,
    });
    if (res.error) return ackSend({ ok: false, commandId: cmd.commandId, error: { code: 'INVALID_OPTION', message: res.error } });
    await emitOrbCount(cmd.sessionId, state.orbFlow.runId);
    ackSend({ ok: true, commandId: cmd.commandId, status: 'ACCEPTED', safeHold: res.item.state === 'SAFE_HOLD' });
  }

  // ── ORB CLOSE (director) → ORB_REVIEW ──
  async function handleOrbClose(cmd, actor, ackSend) {
    const state = await getState(cmd.sessionId);
    assertCommandAllowed(state, 'orb:close');
    cancelSessionTimer(cmd.sessionId);
    const event = { type: 'orb:closed', payload: { closedAt: Date.now(), hostClosed: true }, serverAt: Date.now() };
    const next = applyEvent(state, event);
    const res = await commitEvent({ sessionId: cmd.sessionId, expectedRevision: cmd.expectedRevision, event, state: next });
    const runId = state.orbFlow?.runId;
    if (runId) {
      await fb.set(`cast_private/${cmd.sessionId}/orb/${runId}/meta/status`, 'REVIEW');
      await fb.set(`cast_private/${cmd.sessionId}/orb/${runId}/meta/closedAt`, Date.now());
      await emitOrbCount(cmd.sessionId, runId);
      // Director'ga review holatini yuboramiz
      const data = await getOrbData(cmd.sessionId, runId);
      io.to(directorRoom(cmd.sessionId)).emit(CAST_EVENTS.ORB_CLOSED, { revision: res.revision, runId, data, hostClosed: true });
    }
    io.to(rooms(cmd.sessionId)).emit(CAST_EVENTS.ORB_CLOSED, { revision: res.revision, hostClosed: true, serverAt: res.event.serverAt });
    await writeAudit(cmd.sessionId, { action: 'orb:close', runId, actorId: actor?.actorId, safe: true });
    ackSend({ ok: true, commandId: cmd.commandId, newRevision: res.revision });
  }

  // ── ORB RUN CLUSTER (director — item 5-8, 14) ──
  async function handleOrbRunCluster(cmd, actor, ackSend) {
    const state = await getState(cmd.sessionId);
    assertCommandAllowed(state, 'orb:runCluster');
    const runId = state.orbFlow?.runId;
    if (!runId) return ackSend({ ok: false, commandId: cmd.commandId, error: { code: 'INVALID_PHASE' } });
    const data = await getOrbData(cmd.sessionId, runId);
    // PII/profanity o'tmagan itemlar — identity yo'q (item 3-4, 6)
    const providerItems = buildProviderItems(data.responses);
    const result = await runClustering(providerItems, { runId });
    await recordClusterResult({ sessionId: cmd.sessionId, runId, result, providerId: result.provider });
    const fresh = await getOrbData(cmd.sessionId, runId);
    io.to(directorRoom(cmd.sessionId)).emit(CAST_EVENTS.ORB_CLUSTER_RESULT, { runId, data: fresh, result });
    await writeAudit(cmd.sessionId, { action: 'orb:cluster', runId, provider: result.provider, usedFallback: !!result.usedFallback, actorId: actor?.actorId, safe: true });
    ackSend({ ok: true, commandId: cmd.commandId, provider: result.provider, usedFallback: !!result.usedFallback, clusters: (result.clusters || []).length });
  }

  // ── ORB MANUAL (director — merge/split/rename/move/confirm; item 10-11) ──
  async function handleOrbManual(cmd, actor, ackSend) {
    const state = await getState(cmd.sessionId);
    assertCommandAllowed(state, 'orb:manual');
    const runId = state.orbFlow?.runId;
    const action = cmd.payload?.action;
    if (!runId || !action) return ackSend({ ok: false, commandId: cmd.commandId, error: { code: 'INVALID_OPTION' } });
    const res = await applyManualAction({
      sessionId: cmd.sessionId,
      runId,
      action,
      payload: cmd.payload || {},
      actorId: actor?.actorId,
      commandId: cmd.commandId,
    });
    if (!res.ok) return ackSend({ ok: false, commandId: cmd.commandId, error: { code: 'INVALID_OPTION', message: res.error } });
    const data = await getOrbData(cmd.sessionId, runId);
    io.to(directorRoom(cmd.sessionId)).emit(CAST_EVENTS.ORB_MANUAL_UPDATE, { runId, action, data, event: res.event });
    // Projector: faqat confirmed cluster'lar (tugallanish sharti — teacher confirmation)
    await emitOrbProjector(cmd.sessionId, runId);
    await writeAudit(cmd.sessionId, { action: 'orb:manual:' + action, runId, actorId: actor?.actorId, safe: true });
    ackSend({ ok: true, commandId: cmd.commandId, event: res.event });
  }

  // ── ORB END (director) → QUESTION_OPEN ──
  async function handleOrbEnd(cmd, actor, ackSend) {
    const state = await getState(cmd.sessionId);
    assertCommandAllowed(state, 'orb:end');
    const runId = state.orbFlow?.runId;
    const event = { type: 'orb:ended', payload: { endedAt: Date.now() }, serverAt: Date.now() };
    const next = applyEvent(state, event);
    const res = await commitEvent({ sessionId: cmd.sessionId, expectedRevision: cmd.expectedRevision, event, state: next });
    if (runId) {
      await fb.set(`cast_private/${cmd.sessionId}/orb/${runId}/meta/status`, 'ENDED');
    }
    io.to(rooms(cmd.sessionId)).emit(CAST_EVENTS.ORB_ENDED, { revision: res.revision, serverAt: res.event.serverAt });
    io.to(directorRoom(cmd.sessionId)).emit(CAST_EVENTS.ORB_ENDED, { revision: res.revision, runId });
    await writeAudit(cmd.sessionId, { action: 'orb:end', runId, actorId: actor?.actorId, safe: true });
    ackSend({ ok: true, commandId: cmd.commandId, newRevision: res.revision });
  }

  // ── C3-13 STUDENT QUESTION FORGE ──
  // participantSocketMap: participantId → Set(socketId) — rejoin'da ham ishlaydi
  const participantSocketMap = new Map();
  function trackParticipantSocket(participantId, socketId) {
    if (!participantId || !socketId) return;
    if (!participantSocketMap.has(participantId)) participantSocketMap.set(participantId, new Set());
    participantSocketMap.get(participantId).add(socketId);
  }
  function untrackParticipantSocket(participantId, socketId) {
    const set = participantSocketMap.get(participantId);
    if (!set) return;
    set.delete(socketId);
    if (set.size === 0) participantSocketMap.delete(participantId);
  }
  function emitToParticipant(participantId, eventName, payload) {
    const sockets = participantSocketMap.get(participantId);
    if (!sockets) return;
    for (const sid of sockets) {
      io.to(sid).emit(eventName, payload);
    }
  }

  // ── FORGE SUBMIT (participant) ──
  async function handleForgeSubmit(cmd, actor, ackSend) {
    if (actor?.actorRole !== 'participant' || !actor.participantId) {
      return ackSend({ ok: false, commandId: cmd.commandId, error: { code: 'NOT_AUTHORIZED', message: 'Faqat ishtirokchilar savol yuborishi mumkin' } });
    }
    const state = await getState(cmd.sessionId);
    if (!state || state.phase === 'ENDED') {
      return ackSend({ ok: false, commandId: cmd.commandId, error: { code: 'SESSION_ENDED' } });
    }
    if (state.phase === CAST_PHASES.LOBBY_OPEN) {
      return ackSend({ ok: false, commandId: cmd.commandId, error: { code: 'INVALID_PHASE', message: 'Sessiya hali boshlanmagan' } });
    }

    // 1. Forge capability — session config + institution policy (item 1)
    const config = await getConfig(cmd.sessionId);
    if (!config?.responsiveTeaching?.questionForge) {
      return ackSend({ ok: false, commandId: cmd.commandId, error: { code: 'NOT_AUTHORIZED', message: 'Bu sessiyada savol yuborish yoqilgan emas' } });
    }

    const draft = cmd.payload?.draft;
    const commandId = cmd.payload?.commandId || cmd.commandId;
    const validation = validateForgeDraft(draft);
    if (!validation.valid) {
      return ackSend({ ok: false, commandId: cmd.commandId, error: { code: 'INVALID_OPTION', message: validation.errors.join('; ') } });
    }

    try {
      const participant = await getParticipant(cmd.sessionId, actor.participantId);
      const semanticDuplicate = Boolean(config?.responsiveTeaching?.forgeSemanticDuplicate);
      const res = await submitForgeDraft({
        sessionId: cmd.sessionId,
        participantId: actor.participantId,
        alias: participant?.displayAlias || null,
        draft,
        commandId,
        semanticDuplicate,
      });

      // Director private queue yangilanishi
      await emitForgeQueue(cmd.sessionId);
      await writeAudit(cmd.sessionId, { action: 'forge:submit', draftId: res.draftId, participantId: actor.participantId, safe: true });

      ackSend({
        ok: true,
        commandId: cmd.commandId,
        draftId: res.draftId,
        status: res.status,
        replay: res.replay || false,
        duplicate: res.duplicate || false,
        safeHold: Boolean(res.priority === 'HIGH'),
      });
    } catch (err) {
      const e = toCastError(err);
      ackSend({ ok: false, commandId: cmd.commandId, error: e });
    }
  }

  // ── FORGE REVIEW (owner/co-host): preview/edit/approve/reject ──
  async function handleForgeReview(cmd, actor, ackSend) {
    const { draftId, action, edits, rejectReason } = cmd.payload || {};
    if (!draftId || !['preview', 'edit', 'approve', 'reject'].includes(action)) {
      return ackSend({ ok: false, commandId: cmd.commandId, error: { code: 'INVALID_OPTION', message: 'Draft ID va action talab qilinadi' } });
    }

    // preview — faqat o'qish, hech narsa o'zgarmaydi
    if (action === 'preview') {
      const rec = await getForgeDraft(cmd.sessionId, draftId);
      if (!rec) {
        return ackSend({ ok: false, commandId: cmd.commandId, error: { code: 'SESSION_NOT_FOUND', message: 'Draft topilmadi' } });
      }
      return ackSend({ ok: true, commandId: cmd.commandId, draft: rec });
    }

    try {
      const res = await applyForgeReview({
        sessionId: cmd.sessionId,
        draftId,
        action,
        editorId: actor?.actorId,
        edits,
        rejectReason,
      });

      await emitForgeQueue(cmd.sessionId);
      await writeAudit(cmd.sessionId, { action: 'forge:' + action, draftId, actorId: actor?.actorId, safe: true });

      // Participant'ga private notification (items 14-15) — safe microcopy
      if (action === 'approve') {
        const rec = await getForgeDraft(cmd.sessionId, draftId);
        emitToParticipant(rec?.authorParticipantId, CAST_EVENTS.FORGE_CONFIRMED, {
          draftId,
          message: 'Savolingiz qabul qilindi! Tez orada sinf bilan baham ko\u2018rilishi mumkin.',
        });
      } else if (action === 'reject') {
        const rec = await getForgeDraft(cmd.sessionId, draftId);
        emitToParticipant(rec?.authorParticipantId, CAST_EVENTS.FORGE_REJECTED, {
          draftId,
          reason: rec?.rejectReason || null,
          message: rec?.rejectReason ? `Savolingiz qayta ishlandi: ${rec.rejectReason}` : 'Savolingiz qayta ishlandi. Yangi savol yuborishingiz mumkin.',
        });
      }

      ackSend({ ok: true, commandId: cmd.commandId, ...res });
    } catch (err) {
      const e = toCastError(err);
      ackSend({ ok: false, commandId: cmd.commandId, error: e });
    }
  }

  // ── FORGE LAUNCH NOW (owner/co-host) — Quick Prompt service bilan ulash (item 11) ──
  async function handleForgeLaunch(cmd, actor, ackSend) {
    const { draftId } = cmd.payload || {};
    if (!draftId) {
      return ackSend({ ok: false, commandId: cmd.commandId, error: { code: 'INVALID_OPTION', message: 'Draft ID talab qilinadi' } });
    }
    const state = await getState(cmd.sessionId);
    assertCommandAllowed(state, 'quick_prompt:launch');

    const rec = await getForgeDraft(cmd.sessionId, draftId);
    if (!rec) {
      return ackSend({ ok: false, commandId: cmd.commandId, error: { code: 'SESSION_NOT_FOUND', message: 'Draft topilmadi' } });
    }
    if (rec.status !== FORGE_STATUS.APPROVED || !rec.questionId) {
      return ackSend({ ok: false, commandId: cmd.commandId, error: { code: 'INVALID_PHASE', message: 'Avval draftni approve qiling' } });
    }

    const questionId = rec.questionId;
    const liveQ = await getForgeLiveQuestion(cmd.sessionId, questionId);
    if (!liveQ) {
      return ackSend({ ok: false, commandId: cmd.commandId, error: { code: 'SESSION_NOT_FOUND', message: 'Tasdiqlangan savol topilmadi' } });
    }

    // Quick Prompt choreography — open directly (preview yo'q), timer bilan
    const openedAt = Date.now();
    const seconds = Number(cmd.payload?.timerSeconds) || 30;
    const closesAt = openedAt + seconds * 1000;
    const event = {
      type: 'cast:quickPromptLive',
      payload: { questionId, openedAt, closesAt, timerMode: 'soft', isForge: true, forgeDraftId: draftId },
      serverAt: openedAt,
    };
    const nextState = { ...state, phase: CAST_PHASES.QUESTION_OPEN, questionId, openedAt, closesAt };
    const res = await commitEvent({ sessionId: cmd.sessionId, expectedRevision: cmd.expectedRevision, event, state: nextState });

    io.to(rooms(cmd.sessionId)).emit(CAST_EVENTS.QUICK_PROMPT_LIVE, {
      revision: res.revision,
      question: {
        id: liveQ.id,
        type: liveQ.type,
        text: liveQ.text,
        options: liveQ.options,
        closesAt,
        isQuickPrompt: true,
        isForge: true,
      },
      serverAt: res.event.serverAt,
    });

    scheduleQuestionTimer({
      sessionId: cmd.sessionId,
      questionId,
      revision: res.revision,
      expiresAt: closesAt,
      mode: 'soft',
      onFire: async ({ sessionId: sid, questionId: qid, revision }) => {
        const st = await getState(sid);
        if (!st || st.revision !== revision || st.questionId !== qid) return;
        const ev = { type: 'cast:questionClosed', payload: { closesAt: Date.now(), softExpired: true }, serverAt: Date.now() };
        const nx = applyEvent({ ...st, phase: CAST_PHASES.QUESTION_OPEN }, ev);
        const r = await commitEvent({ sessionId: sid, expectedRevision: revision, event: ev, state: nx });
        io.to(rooms(sid)).emit(CAST_EVENTS.QUESTION_CLOSED, { revision: r.revision, softExpired: true, serverAt: r.event.serverAt });
    scheduleAutoPodium(sid);
        // Quick prompt result (director only) — quick prompt bilan bir xil
        await emitQuickPromptResult(sid, qid);
      },
    });

    await markForgeLaunched(cmd.sessionId, draftId, actor?.actorId);
    await emitForgeQueue(cmd.sessionId);
    await writeAudit(cmd.sessionId, { action: 'forge:launch', draftId, questionId, actorId: actor?.actorId, safe: true });

    // Muallifga notification
    emitToParticipant(rec.authorParticipantId, CAST_EVENTS.FORGE_CONFIRMED, {
      draftId,
      launched: true,
      message: 'Savolingiz sinf bilan baham ko\u2018rilmoqda! 🎉',
    });

    ackSend({ ok: true, commandId: cmd.commandId, newRevision: res.revision, questionId });
  }

  // ── FORGE queue emit (director private) ──
  async function emitForgeQueue(sessionId) {
    try {
      const config = await getConfig(sessionId);
      const policy = config?.responsiveTeaching?.forgeAttribution || FORGE_ATTRIBUTION_POLICY.PRIVATE;
      const queue = projectForgeQueue(await listForgeQueue(sessionId), policy);
      const meta = await getForgeMeta(sessionId);
      io.to(directorRoom(sessionId)).emit(CAST_EVENTS.FORGE_QUEUE, { queue, meta });
    } catch (err) {
      console.error('[Cast] forge queue emit error:', err.message);
    }
  }

  // ── C3-14 CHOREOGRAPHY ──
  // ══════════════════ C3-16 Self-Paced Race (item 1-11) ══════════════════

  // ── SP OPEN (director: race boshlash) ──
  async function handleSpOpen(cmd, actor, ackSend) {
    try {
      const state = await getState(cmd.sessionId);
      const config = await getConfig(cmd.sessionId);
      if (!isSelfPaced(config)) {
        return ackSend({ ok: false, commandId: cmd.commandId, error: { code: 'CAPABILITY_UNSUPPORTED', message: 'Self-paced rejim yoqilmagan' } });
      }
      const pubQuestions = await getPublicQuestions(cmd.sessionId);
      const questionIds = Object.keys(pubQuestions || {});
      const meta = await getSessionMeta(cmd.sessionId);
      const sessionSeed = state?.sessionSeed || 0;

      // Barcha mavjud participant'lar uchun cursor init (yo'q bo'lsa)
      const participants = await listParticipants(cmd.sessionId);
      let cursorCount = 0;
      for (const pid of Object.keys(participants)) {
        try {
          await initCursor({ sessionId: cmd.sessionId, participantId: pid, questionIds, config, sessionSeed, meta });
          cursorCount++;
        } catch (_) { /* non-critical */ }
      }

      const act = await activateSelfPaced({ sessionId: cmd.sessionId, questionIds, config, sessionSeed });

      // Room-level state event
      const event = { type: 'sp:activated', payload: { startedAt: Date.now() }, serverAt: Date.now() };
      const next = applyEvent(state, event);
      const res = await commitEvent({ sessionId: cmd.sessionId, expectedRevision: cmd.expectedRevision, event, state: next });

      // Har participant'ga o'z cursor'ini yuboramiz (faqat o'ziga)
      for (const pid of Object.keys(participants)) {
        const cursor = await getCursor(cmd.sessionId, pid);
        if (cursor) {
          const proj = projectCursor(cursor);
          const curQ = await getPublicQuestion(cmd.sessionId, proj.currentQuestionId);
          io.to(trackedSocketsFor(pid)).emit(CAST_EVENTS.SP_CURSOR, {
            cursor: proj,
            question: curQ ? participantQuestionProjection(curQ, { phase: 'QUESTION_OPEN', openedAt: proj.questionOpenedAt, closesAt: proj.questionExpiresAt, revision: res.revision }) : null,
            serverAt: res.event.serverAt,
          });
        }
      }

      io.to(rooms(cmd.sessionId)).emit(CAST_EVENTS.SP_ACTIVATED, {
        revision: res.revision,
        active: act.count,
        serverAt: res.event.serverAt,
      });
      await emitSpDirector(cmd.sessionId);
      ackSend({ ok: true, commandId: cmd.commandId, newRevision: res.revision, active: act.count });
    } catch (err) {
      ackSend({ ok: false, commandId: cmd.commandId, error: toCastError(err) });
    }
  }

  // ── SP PAUSE (director: global pause) ──
  async function handleSpPause(cmd, actor, ackSend) {
    try {
      const state = await getState(cmd.sessionId);
      const res = await pauseAll(cmd.sessionId);
      const event = { type: 'sp:paused', payload: { pausedAt: Date.now() }, serverAt: Date.now() };
      const next = applyEvent(state, event);
      const committed = await commitEvent({ sessionId: cmd.sessionId, expectedRevision: cmd.expectedRevision, event, state: next });
      io.to(rooms(cmd.sessionId)).emit(CAST_EVENTS.SP_PAUSED, { revision: committed.revision, paused: true, serverAt: committed.event.serverAt });
      await emitSpDirector(cmd.sessionId);
      ackSend({ ok: true, commandId: cmd.commandId, newRevision: committed.revision, pausedCount: res.count });
    } catch (err) {
      ackSend({ ok: false, commandId: cmd.commandId, error: toCastError(err) });
    }
  }

  // ── SP RESUME (director: global resume) ──
  async function handleSpResume(cmd, actor, ackSend) {
    try {
      const state = await getState(cmd.sessionId);
      const config = await getConfig(cmd.sessionId);
      const res = await resumeAll(cmd.sessionId, config);
      const event = { type: 'sp:resumed', payload: { totalPausedMs: 0 }, serverAt: Date.now() };
      const next = applyEvent(state, event);
      const committed = await commitEvent({ sessionId: cmd.sessionId, expectedRevision: cmd.expectedRevision, event, state: next });
      io.to(rooms(cmd.sessionId)).emit(CAST_EVENTS.SP_RESUMED, { revision: committed.revision, paused: false, serverAt: committed.event.serverAt });
      await emitSpDirector(cmd.sessionId);
      ackSend({ ok: true, commandId: cmd.commandId, newRevision: committed.revision, resumedCount: res.count });
    } catch (err) {
      ackSend({ ok: false, commandId: cmd.commandId, error: toCastError(err) });
    }
  }

  // ── SP SYNC (participant: cursor + own rank + expiry check) ──
  async function handleSpSync(cmd, actor, ackSend) {
    if (actor?.actorRole !== 'participant' || !actor.participantId) {
      return ackSend({ ok: false, commandId: cmd.commandId, error: { code: 'NOT_AUTHORIZED' } });
    }
    const sessionId = cmd.sessionId;
    const state = await getState(sessionId);
    const config = await getConfig(sessionId);
    if (!isSelfPaced(config) || !state?.selfPaced?.active) {
      return ackSend({ ok: true, commandId: cmd.commandId, active: false });
    }
    // Expiry tekshiruvi — vaqt tugagan bo'lsa cursor avtomatik keyingi savolga o'tadi
    await checkCursorExpiry({ sessionId, participantId: actor.participantId });
    const cursor = await getCursor(sessionId, actor.participantId);
    const rank = await computeOwnRank({ sessionId, participantId: actor.participantId });
    const proj = cursor ? projectCursor(cursor) : null;
    const curQ = proj?.currentQuestionId ? await getPublicQuestion(sessionId, proj.currentQuestionId) : null;
    ackSend({
      ok: true,
      commandId: cmd.commandId,
      active: true,
      paused: !!state.selfPaced.paused,
      cursor: proj,
      question: curQ ? participantQuestionProjection(curQ, { phase: 'QUESTION_OPEN', openedAt: proj?.questionOpenedAt, closesAt: proj?.questionExpiresAt, revision: state.revision }) : null,
      rank: rank.rank ? { rank: rank.rank, total: rank.total } : null,
      serverAt: Date.now(),
    });
  }

  // ══════════════════ C3-17 Power-ups (pedagogically safe, item 1-13) ══════════════════

  // ── POWERUP ACTIVATE (participant) ──
  async function handlePowerupActivate(cmd, actor, ackSend) {
    if (actor?.actorRole !== 'participant' || !actor.participantId) {
      return ackSend({ ok: false, commandId: cmd.commandId, error: { code: 'NOT_AUTHORIZED' } });
    }
    try {
      const config = await getConfig(cmd.sessionId);
      if (!isPowerUpsEnabled(config)) {
        return ackSend({ ok: false, commandId: cmd.commandId, error: { code: 'CAPABILITY_UNSUPPORTED', message: 'Power-up yoqilmagan' } });
      }
      const { type, questionId, teamMemberId } = cmd.payload || {};
      // Idempotent + allowed-types check server-side (item 4, 6)
      const result = await activatePowerUp({
        sessionId: cmd.sessionId,
        participantId: actor.participantId,
        type,
        config,
        questionId: questionId || stateOf(cmd.sessionId)?.questionId || null,
        teamMemberId,
      });
      // Shaxsiy inventory yangilanadi (faqat o'ziga; public shame EMAS — item 13)
      ackSend({ ok: true, commandId: cmd.commandId, ...result });
      // Director private summary (count'lar — identity yo'q)
      await emitPowerupSummary(cmd.sessionId);
    } catch (err) {
      ackSend({ ok: false, commandId: cmd.commandId, error: toCastError(err) });
    }
  }

  // ── POWERUP GRANT (director: individual grant) ──
  async function handlePowerupGrant(cmd, actor, ackSend) {
    try {
      const config = await getConfig(cmd.sessionId);
      if (!isPowerUpsEnabled(config)) {
        return ackSend({ ok: false, commandId: cmd.commandId, error: { code: 'CAPABILITY_UNSUPPORTED' } });
      }
      const { participantId, type, count = 1 } = cmd.payload || {};
      if (!participantId || !type) {
        return ackSend({ ok: false, commandId: cmd.commandId, error: { code: 'INVALID_OPTION' } });
      }
      const res = await grantPowerUp({ sessionId: cmd.sessionId, participantId, type, config, count });
      // Recipient'ga shaxsiy yangilangan inventory (faqat o'ziga)
      io.to(trackedSocketsFor(participantId)).emit(CAST_EVENTS.POWERUP_GRANTED, { type, inventory: res.inventory });
      await emitPowerupSummary(cmd.sessionId);
      ackSend({ ok: true, commandId: cmd.commandId, ...res });
    } catch (err) {
      ackSend({ ok: false, commandId: cmd.commandId, error: toCastError(err) });
    }
  }

  // ── POWERUP CONFIG (director: allowed types dinamik) ──
  async function handlePowerupConfig(cmd, actor, ackSend) {
    try {
      const config = await getConfig(cmd.sessionId);
      const { allowed } = cmd.payload || {};
      if (!Array.isArray(allowed)) {
        return ackSend({ ok: false, commandId: cmd.commandId, error: { code: 'INVALID_OPTION' } });
      }
      // Faqat registry'dan valid turlar (item 3 — sabotage/elimination kirmaydi)
      const valid = allowed.filter((t) => POWERUP_TYPE_LIST.includes(t));
      await fb.update(`cast_sessions/${cmd.sessionId}/config/powerUps`, { enabled: true, allowedTypes: valid });
      const updated = await getConfig(cmd.sessionId);
      io.to(rooms(cmd.sessionId)).emit(CAST_EVENTS.POWERUP_ACTIVATED, { enabled: true, allowed: allowedTypes(updated) });
      await emitPowerupSummary(cmd.sessionId);
      ackSend({ ok: true, commandId: cmd.commandId, enabled: true, allowed: valid });
    } catch (err) {
      ackSend({ ok: false, commandId: cmd.commandId, error: toCastError(err) });
    }
  }

  async function stateOf(sessionId) {
    return getState(sessionId).catch(() => null);
  }

  // ── C4-03 CARD SCAN (director — item 7) ──
  // Client faqat cardId + orientation + confidence yuboradi; RAW FRAME YO'Q (item 5/6).
  async function handleCardScan(cmd, actor, ackSend) {
    try {
      const config = await getConfig(cmd.sessionId);
      if (!config?.participation?.paperCardMode) {
        return ackSend({ ok: false, commandId: cmd.commandId, error: { code: 'CAPABILITY_UNSUPPORTED', message: 'Qog‘oz kartochka rejimi yoqilmagan' } });
      }
      if (config?.participation?.cardScanP3 === false) {
        return ackSend({ ok: false, commandId: cmd.commandId, error: { code: 'CAPABILITY_UNSUPPORTED', message: 'P3 flag o‘chiq — kartochka skaneri ishlamaydi' } });
      }
      const { cardId, orientation, confidence, questionId } = cmd.payload || {};
      const { cardId: normId, confidence: conf, flagged } = normalizeCardAnswer({ cardId, orientation, confidence });

      // Private question → option mapping (item 2/7)
      const priv = await getPrivateQuestion(cmd.sessionId, questionId);
      if (!priv) return ackSend({ ok: false, commandId: cmd.commandId, error: { code: 'INVALID_OPTION', message: 'Savol topilmadi' } });
      const optionId = mapOrientationToOption(priv, orientation);

      // Idempotent scan record — transaction (first scan immutable — item 8; race-free)
      const scanPath = `cast_private/${cmd.sessionId}/card_scans/${questionId}/${normId}`;
      const merged = await fb.transaction(scanPath, (current) => {
        const existing = current && current.status ? current : null;
        const { record } = mergeScanRecord(existing, {
          cardId: normId,
          optionId,
          confidence: conf,
          flagged,
          questionId,
          at: Date.now(),
          by: actor?.actorId || 'director',
        });
        return record;
      });
      const status = merged.value?.status || 'ACCEPTED';

      // C4-03 (item 7): scan → server answer command (cardId → participantId)
      let participantId = null;
      const participants = await listParticipants(cmd.sessionId);
      for (const [pid, p] of Object.entries(participants || {})) {
        if (p.cardId === normId) { participantId = pid; break; }
      }
      if (participantId && status !== 'DUPLICATE') {
        try {
          await submitAnswer({
            sessionId: cmd.sessionId,
            questionId,
            participantId,
            commandId: `card_${normId}_${questionId}`,
            selectedOptionIds: [optionId],
            attemptNo: 1,
            config,
          });
        } catch (_) { /* duplicate answer / closed — scan record yetarli */ }
      }

      // Director roomga progress + event
      await emitCardProgress(cmd.sessionId, questionId);
      if (status === 'DUPLICATE') {
        io.to(directorRoom(cmd.sessionId)).emit(CAST_EVENTS.CARD_DUPLICATE, { cardId: normId });
      }
      if (!expectedCardKnown(cmd.sessionId, normId)) {
        io.to(directorRoom(cmd.sessionId)).emit(CAST_EVENTS.CARD_UNKNOWN, { cardId: normId });
      }
      ackSend({ ok: true, commandId: cmd.commandId, status, cardId: normId, optionId, confidence: conf, flagged });
    } catch (err) {
      ackSend({ ok: false, commandId: cmd.commandId, error: toCastError(err) });
    }
  }

  // ── C4-03 CARD CORRECT (item 12/13 — lock'dan oldin manual correction + audit) ──
  async function handleCardCorrect(cmd, actor, ackSend) {
    try {
      const config = await getConfig(cmd.sessionId);
      if (!config?.participation?.paperCardMode) {
        return ackSend({ ok: false, commandId: cmd.commandId, error: { code: 'CAPABILITY_UNSUPPORTED' } });
      }
      const { cardId, optionId, reason, questionId } = cmd.payload || {};
      const normId = normalizeCardId(cardId);
      // optionId private question'ning haqiqiy variantlaridan bo'lishi shart
      const priv = await getPrivateQuestion(cmd.sessionId, questionId);
      if (!priv) return ackSend({ ok: false, commandId: cmd.commandId, error: { code: 'INVALID_OPTION', message: 'Savol topilmadi' } });
      const validOpts = new Set((priv.options || []).map((o) => o.id));
      if (!validOpts.has(optionId)) {
        return ackSend({ ok: false, commandId: cmd.commandId, error: { code: 'INVALID_OPTION', message: 'Noma‘lum variant ID' } });
      }
      const scanPath = `cast_private/${cmd.sessionId}/card_scans/${questionId}/${normId}`;
      const current = (await fb.get(scanPath)).exists() ? (await fb.get(scanPath)).val() : null;
      const audit = buildCorrectionAudit({
        actorId: actor?.actorId || 'director',
        cardId: normId,
        fromOptionId: current?.optionId || null,
        toOptionId: optionId,
        reason,
      });
      await fb.set(scanPath, {
        ...(current || { cardId: normId, questionId, at: Date.now() }),
        optionId,
        corrected: true,
        confidence: 1,
        flagged: false,
        correctedAt: Date.now(),
        correctedBy: audit.actorId,
      });
      await fb.set(`cast_private/${cmd.sessionId}/card_corrections/${questionId}/${normId}/${audit.at}`, audit);
      await emitCardProgress(cmd.sessionId, questionId);
      io.to(directorRoom(cmd.sessionId)).emit(CAST_EVENTS.CARD_CORRECTED, { cardId: normId, optionId });
      ackSend({ ok: true, commandId: cmd.commandId, cardId: normId, optionId, auditAt: audit.at });
    } catch (err) {
      ackSend({ ok: false, commandId: cmd.commandId, error: toCastError(err) });
    }
  }

  // ── C4-03 Card progress → director (item 11: scanned/expected) ──
  async function emitCardProgress(sessionId, questionId) {
    try {
      const participants = await listParticipants(sessionId);
      const scans = (await fb.get(`cast_private/${sessionId}/card_scans/${questionId}`)).val() || {};
      const progress = projectCardProgress(participants, scans);
      io.to(directorRoom(sessionId)).emit(CAST_EVENTS.CARD_PROGRESS, { questionId, ...progress });
    } catch (_) { /* non-critical */ }
  }

  // Helper: card known roster'da bormi (unknown flag — item 8)
  async function expectedCardKnown(sessionId, cardId) {
    try {
      const participants = await listParticipants(sessionId);
      return Object.values(participants || {}).some((p) => p.cardId === cardId);
    } catch (_) { return false; }
  }

  // ── C4-01 TEAM ASSIGN (director: manual assignment / re-balance) ──
  async function handleTeamAssign(cmd, actor, ackSend) {
    try {
      const config = await getConfig(cmd.sessionId);
      if (!isTeamsEnabled(config)) {
        return ackSend({ ok: false, commandId: cmd.commandId, error: { code: 'CAPABILITY_UNSUPPORTED', message: 'Jamoa rejimi yoqilmagan' } });
      }
      const participants = await listParticipants(cmd.sessionId);
      const pids = Object.keys(participants || {});
      const { mode } = cmd.payload || {};
      if (mode === 'manual' && Array.isArray(cmd.payload?.assignments)) {
        // manual: { assignments: [{participantId, teamId}] }
        for (const a of cmd.payload.assignments) {
          const p = participants[a.participantId];
          if (!p) continue;
          await upsertParticipant(cmd.sessionId, { ...p, teamId: a.teamId, updatedAt: Date.now() });
        }
      } else {
        // random/balanced/roster — qayta assign
        const { teams, assignments } = assignTeams({
          participants: pids.map((pid) => ({ participantId: pid, displayAlias: participants[pid]?.displayAlias, rosterTeamId: participants[pid]?.rosterTeamId })),
          teamsConfig: config.teams,
        });
        for (const [pid, teamId] of Object.entries(assignments)) {
          const p = participants[pid];
          if (!p) continue;
          await upsertParticipant(cmd.sessionId, { ...p, teamId, updatedAt: Date.now() });
        }
      }
      await emitTeamRoster(cmd.sessionId);
      ackSend({ ok: true, commandId: cmd.commandId });
    } catch (err) {
      ackSend({ ok: false, commandId: cmd.commandId, error: toCastError(err) });
    }
  }

  // ── C4-01 TEAM TALK START (team talk phase + timer) ──
  async function handleTeamTalkStart(cmd, actor, ackSend) {
    try {
      const config = await getConfig(cmd.sessionId);
      if (!isTeamsEnabled(config) || !isTalkEnabled(config)) {
        return ackSend({ ok: false, commandId: cmd.commandId, error: { code: 'CAPABILITY_UNSUPPORTED', message: 'Jamoa muhokamasi yoqilmagan' } });
      }
      const seconds = cmd.payload?.seconds ?? config.teams.talkSeconds ?? 60;
      const duration = assertTalkSeconds(seconds);
      const startsAt = Date.now();
      const endsAt = startsAt + duration * 1000;
      const talk = { startedAt: startsAt, endsAt, seconds: duration };
      await fb.set(`cast_private/${cmd.sessionId}/team_talk`, talk);
      io.to(rooms(cmd.sessionId)).emit(CAST_EVENTS.TEAM_TALK_STARTED, talk);
      ackSend({ ok: true, commandId: cmd.commandId, ...talk });
    } catch (err) {
      ackSend({ ok: false, commandId: cmd.commandId, error: toCastError(err) });
    }
  }

  // ── C4-01 TEAM TALK END (erta yopish) ──
  async function handleTeamTalkEnd(cmd, actor, ackSend) {
    try {
      await fb.remove(`cast_private/${cmd.sessionId}/team_talk`);
      io.to(rooms(cmd.sessionId)).emit(CAST_EVENTS.TEAM_TALK_ENDED, { endedAt: Date.now() });
      ackSend({ ok: true, commandId: cmd.commandId });
    } catch (err) {
      ackSend({ ok: false, commandId: cmd.commandId, error: toCastError(err) });
    }
  }

  // ── C4-01 REPORTER ROTATE (item 15 — rotation reminder) ──
  async function handleTeamReporterRotate(cmd, actor, ackSend) {
    try {
      const config = await getConfig(cmd.sessionId);
      if (!isTeamsEnabled(config)) {
        return ackSend({ ok: false, commandId: cmd.commandId, error: { code: 'CAPABILITY_UNSUPPORTED' } });
      }
      const teamId = cmd.payload?.teamId;
      if (!teamId) return ackSend({ ok: false, commandId: cmd.commandId, error: { code: 'INVALID_OPTION' } });
      // reporterIndex +1 (cyclic) — team record'da saqlanadi
      const snap = await fb.get(`cast_private/${cmd.sessionId}/teams/${teamId}`);
      const team = snap.exists() ? snap.val() : null;
      if (!team) return ackSend({ ok: false, commandId: cmd.commandId, error: { code: 'INVALID_OPTION', message: 'Jamoa topilmadi' } });
      const members = team.memberIds || [];
      const next = ((team.reporterIndex ?? -1) + 1) % Math.max(1, members.length);
      await fb.set(`cast_private/${cmd.sessionId}/teams/${teamId}`, { ...team, reporterIndex: next, updatedAt: Date.now() });
      const reporterId = members[next] || null;
      io.to(rooms(cmd.sessionId)).emit(CAST_EVENTS.TEAM_REPORTER_ROTATED, {
        teamId,
        reporterId,
        reporterIndex: next,
      });
      ackSend({ ok: true, commandId: cmd.commandId, teamId, reporterIndex: next });
    } catch (err) {
      ackSend({ ok: false, commandId: cmd.commandId, error: toCastError(err) });
    }
  }

  // ── C4-01 Newcomer'ni jamoaga qo'shish (join'da auto-assign) ──
  // Late-join member ham mavjud jamoaga qo'shiladi (item 4).
  async function assignNewcomerToTeam(sessionId, participantId, config) {
    const participants = await listParticipants(sessionId);
    const existing = Object.values(participants || {});
    const teamCount = Math.max(2, Math.min(8, Number(config.teams?.count) || 4));
    const teamIds = Array.from({ length: teamCount }, (_, i) => `team_${i + 1}`);
    // Roster: participant'da rosterTeamId bo'lsa — o'sha jamoa
    const rosterTeamId = participants[participantId]?.rosterTeamId || null;
    let chosen = null;
    if (rosterTeamId && teamIds.includes(rosterTeamId)) {
      chosen = rosterTeamId;
    } else {
      // Balanced: eng kam a'zoli jamoa (deterministik: pastki ID)
      const counts = {};
      for (const pid of Object.keys(participants || {})) {
        const t = participants[pid]?.teamId;
        if (t) counts[t] = (counts[t] || 0) + 1;
      }
      let minCount = Infinity;
      for (const tid of teamIds) {
        const c = counts[tid] || 0;
        if (c < minCount) { minCount = c; chosen = tid; }
      }
    }
    const team = buildTeam({ teamId: chosen, name: `Jamoa ${chosen.replace(/^team_/, '')}` });
    const snap = await fb.get(`cast_private/${sessionId}/teams/${chosen}`);
    const stored = snap.exists() ? snap.val() : null;
    const memberIds = [...new Set([...(stored?.memberIds || []), participantId])];
    const updated = recomputeActiveMembers({ ...team, memberIds, reporterIndex: stored?.reporterIndex ?? 0 }, participants);
    await fb.set(`cast_private/${sessionId}/teams/${chosen}`, updated);
    return { teamId: chosen, team: updated, rosterTeamId: rosterTeamId || null };
  }

  // ── C4-02 Network telemetry (item 8) — alohida path, answer record'ga EMAS ──
  // Answer ham, ping ham shu orqali yoziladi — answer bermagan remote
  // participant ham bucket'lanadi (item 9: technical_failure detection).
  async function recordNetworkSample(sessionId, participantId, config, payload = {}) {
    const bucket = bucketNetworkQuality({
      latencyMs: payload.netLatencyMs || 0,
      lossPercent: payload.netLossPercent || 0,
      sampleCount: payload.netSampleCount || 0,
    });
    if (bucket === 'unknown') return null;
    await fb.set(`cast_private/${sessionId}/network/${participantId}`, {
      bucket,
      latencyMs: payload.netLatencyMs || 0,
      lossPercent: payload.netLossPercent || 0,
      at: Date.now(),
    });
    const me = await getParticipant(sessionId, participantId);
    if (me && me.networkBucket !== bucket) {
      await upsertParticipant(sessionId, { ...me, networkBucket: bucket, networkUpdatedAt: Date.now() });
    }
    return bucket;
  }

  // ── C4-01 Team roster → director room (member count + teamId; safe names) ──
  async function emitTeamRoster(sessionId) {
    try {
      const config = await getConfig(sessionId);
      if (!isTeamsEnabled(config)) return;
      const participants = await listParticipants(sessionId);
      const teams = {};
      for (const [pid, p] of Object.entries(participants || {})) {
        if (!p.teamId) continue;
        teams[p.teamId] = teams[p.teamId] || { teamId: p.teamId, memberIds: [], reporterIndex: 0 };
        teams[p.teamId].memberIds.push(pid);
      }
      for (const [tid, t] of Object.entries(teams)) {
        await fb.set(`cast_private/${sessionId}/teams/${tid}`, t);
      }
      const roster = Object.entries(teams).map(([teamId, t]) => ({
        teamId,
        name: `Jamoa ${teamId.replace(/^team_/, '')}`,
        memberCount: t.memberIds.length,
        memberAliases: t.memberIds.map((pid) => participants[pid]?.displayAlias || '—'),
      }));
      io.to(directorRoom(sessionId)).emit(CAST_EVENTS.TEAM_ROSTER, { teams: roster });
    } catch (_) { /* non-critical */ }
  }

  // ── C4-01 Team-only leaderboard → director + projector ──
  async function emitTeamLeaderboard(sessionId, { topN = 8 } = {}) {
    try {
      const config = await getConfig(sessionId);
      if (!isTeamsEnabled(config)) return;
      const participants = await listParticipants(sessionId);
      const scores = await getScores(sessionId);
      const teams = {};
      for (const [pid, p] of Object.entries(participants || {})) {
        if (!p.teamId) continue;
        teams[p.teamId] = teams[p.teamId] || { teamId: p.teamId, name: `Jamoa ${p.teamId.replace(/^team_/, '')}`, memberIds: [] };
        teams[p.teamId].memberIds.push(pid);
      }
      const lb = buildTeamLeaderboard(teams, scores, config.teams);
      const projection = teamOnlyProjection(lb, { topN, showExactScore: true });
      io.to(directorRoom(sessionId)).emit(CAST_EVENTS.TEAM_LEADERBOARD, projection);
    } catch (_) { /* non-critical */ }
  }

  // ── Power-up director summary (faqat count'lar — privacy) ──
  async function emitPowerupSummary(sessionId) {
    try {
      const summary = await directorPowerupSummary(sessionId);
      io.to(directorRoom(sessionId)).emit(CAST_EVENTS.POWERUP_USED, summary);
    } catch (_) { /* non-critical */ }
  }

  // ── SP director aggregate (distribution + fairness + meta) — private room ──
  async function emitSpDirector(sessionId) {
    try {
      const config = await getConfig(sessionId);
      if (!isSelfPaced(config)) return;
      const state = await getState(sessionId);
      const meta = await getSpMeta(sessionId);
      const dist = await directorDistribution(sessionId);
      const health = await fairnessHealth({ sessionId, config });
      io.to(directorRoom(sessionId)).emit(CAST_EVENTS.SP_PROGRESS, {
        distribution: dist,
        fairness: health,
        paused: !!(state?.selfPaced?.paused),
        activated: !!(state?.selfPaced?.active),
        meta: meta ? { activatedAt: meta.activatedAt, paused: !!meta.paused } : null,
        serverAt: Date.now(),
      });
    } catch (err) {
      console.error('[Cast] sp director error:', err.message);
    }
  }

  // Tracked participant socket'larini qaytaradi (identity faqat server-side)
  function trackedSocketsFor(participantId) {
    return [...(participantSocketMap.get(participantId) || [])];
  }

  async function emitChoreoState(sessionId) {
    try {
      const state = await getState(sessionId);
      const chor = state?.choreography;
      if (!chor) return;
      const cur = currentBlock(chor);
      const next = nextBlock(chor);
      const health = runtimeHealth(chor, state.phase);
      const elapsedMs = chor.blockStartedAt ? Math.max(0, Date.now() - chor.blockStartedAt) : 0;
      const remainingMs = cur && cur.config?.seconds ? Math.max(0, Number(cur.config.seconds) * 1000 - elapsedMs) : null;
      io.to(directorRoom(sessionId)).emit(CAST_EVENTS.CHOREO_STATE, {
        current: cur ? { id: cur.id, type: cur.type, config: cur.config } : null,
        next: next ? { id: next.id, type: next.type } : null,
        currentIndex: chor.currentIndex,
        totalBlocks: chor.blocks.length,
        overrideNext: chor.overrideNext,
        elapsedMs,
        remainingMs,
        coverage: coverage(chor),
        health,
        finished: chor.currentIndex >= chor.blocks.length,
        lastEvent: chor.events[chor.events.length - 1] || null,
      });
    } catch (err) {
      console.error('[Cast] choreo state emit error:', err.message);
    }
  }

  // ── CHOREO SAVE (template composer) ──
  async function handleChoreoSave(cmd, actor, ackSend) {
    const { template } = cmd.payload || {};
    if (!template || !template.blocks) {
      return ackSend({ ok: false, commandId: cmd.commandId, error: { code: 'TEMPLATE_INVALID', message: 'Template talab qilinadi' } });
    }
    try {
      const saved = await saveTemplate(actor?.actorId, template);
      await writeAudit(cmd.sessionId, { action: 'choreo:save', templateId: saved.templateId, version: saved.version, actorId: actor?.actorId, safe: true });
      ackSend({ ok: true, commandId: cmd.commandId, templateId: saved.templateId, version: saved.version });
    } catch (err) {
      const e = toCastError(err);
      ackSend({ ok: false, commandId: cmd.commandId, error: e });
    }
  }

  // ── CHOREO LIST (templates ro'yxati) ──
  async function handleChoreoList(cmd, actor, ackSend) {
    try {
      const templates = await listTemplates(actor?.actorId);
      ackSend({ ok: true, commandId: cmd.commandId, templates });
    } catch (err) {
      const e = toCastError(err);
      ackSend({ ok: false, commandId: cmd.commandId, error: e });
    }
  }

  // ── CHOREO LOAD (template olish) ──
  async function handleChoreoLoad(cmd, actor, ackSend) {
    const { templateId } = cmd.payload || {};
    if (!templateId) {
      return ackSend({ ok: false, commandId: cmd.commandId, error: { code: 'TEMPLATE_INVALID', message: 'templateId talab qilinadi' } });
    }
    const template = await getTemplate(actor?.actorId, templateId);
    if (!template) {
      return ackSend({ ok: false, commandId: cmd.commandId, error: { code: 'SESSION_NOT_FOUND', message: 'Template topilmadi' } });
    }
    ackSend({ ok: true, commandId: cmd.commandId, template });
  }

  // ── CHOREO OVERRIDE (planned next'ni o'zgartirish, item 14-16) ──
  async function handleChoreoOverride(cmd, actor, ackSend) {
    const { blockId } = cmd.payload || {};
    const state = await getState(cmd.sessionId);
    if (!state?.choreography) {
      return ackSend({ ok: false, commandId: cmd.commandId, error: { code: 'TEMPLATE_INVALID', message: 'Bu sessiyada choreography yo‘q' } });
    }
    if (!blockId) {
      return ackSend({ ok: false, commandId: cmd.commandId, error: { code: 'INVALID_JUMP', message: 'blockId talab qilinadi' } });
    }
    try {
      const event = { type: 'choreo:override', payload: { blockId, by: actor?.actorId }, serverAt: Date.now() };
      const next = applyEvent({ ...state }, event);
      const res = await commitEvent({ sessionId: cmd.sessionId, expectedRevision: cmd.expectedRevision, event, state: next });
      await emitChoreoState(cmd.sessionId);
      await writeAudit(cmd.sessionId, { action: 'choreo:override', blockId, actorId: actor?.actorId, safe: true });
      ackSend({ ok: true, commandId: cmd.commandId, newRevision: res.revision, overrideNext: blockId });
    } catch (err) {
      const e = toCastError(err);
      ackSend({ ok: false, commandId: cmd.commandId, error: e });
    }
  }

  // ── CHOREO ADVANCE (manual next — current block'ni tugatish) ──
  async function handleChoreoAdvance(cmd, actor, ackSend) {
    const state = await getState(cmd.sessionId);
    if (!state?.choreography) {
      return ackSend({ ok: false, commandId: cmd.commandId, error: { code: 'TEMPLATE_INVALID', message: 'Bu sessiyada choreography yo‘q' } });
    }
    const event = { type: 'choreo:advance', payload: { by: actor?.actorId }, serverAt: Date.now() };
    const next = applyEvent({ ...state }, event);
    const res = await commitEvent({ sessionId: cmd.sessionId, expectedRevision: cmd.expectedRevision, event, state: next });
    await emitChoreoState(cmd.sessionId);
    await writeAudit(cmd.sessionId, { action: 'choreo:advance', actorId: actor?.actorId, safe: true });
    ackSend({ ok: true, commandId: cmd.commandId, newRevision: res.revision });
  }

  // ── POE emit helpers ──
  async function emitPoePredictionUpdate(sessionId, contract, { stage }) {
    if (!contract) return;
    try {
      const records = await getPoeRecords(sessionId, contract.flowId);
      const distribution = computePredictionDistribution(records);
      const priv = await getPrivateQuestion(sessionId, contract.predictionQuestionId);
      io.to(directorRoom(sessionId)).emit(CAST_EVENTS.POE_ANALYSIS, {
        flowId: contract.flowId,
        stage: 'prediction_' + stage,
        predictionDistribution: distribution,
        correctOptionIds: stage === 'locked' ? priv?.correctOptionIds || [] : null,
      });
    } catch (err) {
      console.error('[Cast] poe prediction update error:', err.message);
    }
  }

  async function emitPoeMediaState(sessionId) {
    try {
      const state = await getState(sessionId);
      const contract = state?.poeFlow?.contract;
      if (!contract || state.phase !== CAST_PHASES.OBSERVATION) return;
      const readiness = await getMediaReadiness(sessionId, contract.flowId, contract.mediaReadyThreshold);
      io.to(directorRoom(sessionId)).emit(CAST_EVENTS.POE_MEDIA_STATE, {
        type: 'media_readiness',
        ...readiness,
        threshold: contract.mediaReadyThreshold,
      });
    } catch (err) {
      console.error('[Cast] poe media state error:', err.message);
    }
  }

  async function emitPoeExplanationUpdate(sessionId, contract) {
    if (!contract) return;
    try {
      const records = await getPoeRecords(sessionId, contract.flowId);
      const explained = Object.values(records).filter((r) => r.explanation).length;
      io.to(directorRoom(sessionId)).emit(CAST_EVENTS.POE_MEDIA_STATE, {
        type: 'explanation_count',
        explained,
      });
    } catch (err) {
      console.error('[Cast] poe explanation update error:', err.message);
    }
  }

  async function emitPoeExemplarQueue(sessionId, flowId) {
    try {
      const queue = await listExemplarQueue(sessionId, flowId);
      const pending = Object.values(queue).filter((v) => WALL_PENDING_STATES.includes(v.moderationState));
      const payload = { flowId, pending: pending.slice(0, 50), total: pending.length };
      io.to(directorRoom(sessionId)).emit(CAST_EVENTS.POE_EXEMPLAR_QUEUE, payload);
      io.to(moderationRoom(sessionId)).emit(CAST_EVENTS.POE_EXEMPLAR_QUEUE, payload);
    } catch (err) {
      console.error('[Cast] poe exemplar queue error:', err.message);
    }
  }

  async function emitPoeExemplarPublic(sessionId, flowId) {
    try {
      const queue = await listExemplarQueue(sessionId, flowId);
      const exemplars = projectPublicExemplars(queue).slice(0, 6);
      io.to(rooms(sessionId)).emit(CAST_EVENTS.POE_EXEMPLAR_PUBLIC, { flowId, exemplars });
    } catch (err) {
      console.error('[Cast] poe exemplar public error:', err.message);
    }
  }

  // ── HINGE DECISION (accept/dismiss/override — C3-02) ──
  async function handleHingeDecision(cmd, actor, ackSend) {
    const { decision, overrideTo, questionId } = cmd.payload || {};
    if (!['accept', 'dismiss', 'override'].includes(decision)) {
      return ackSend({ ok: false, commandId: cmd.commandId, error: { code: 'INVALID_OPTION', message: 'Noma‘lum qaror' } });
    }
    if (decision === 'override' && !['MOVE_ON', 'DISCUSS', 'RETEACH'].includes(overrideTo)) {
      return ackSend({ ok: false, commandId: cmd.commandId, error: { code: 'INVALID_OPTION', message: 'Yaroqsiz override maqsad' } });
    }
    const record = recordTeacherDecision({
      recommendation: { recommendation: cmd.payload?.recommendation || null, ruleVersion: cmd.payload?.ruleVersion },
      decision,
      overrideTo: decision === 'override' ? overrideTo : null,
      teacherId: actor?.actorId,
      sessionId: cmd.sessionId,
      questionId,
      at: Date.now(),
    });
    await writeAudit(cmd.sessionId, { ...record, safe: true });
    ackSend({ ok: true, commandId: cmd.commandId, recorded: true });
  }

  // ── START DISCUSSION (C3-03) ──
  async function handleStartDiscussion(cmd, actor, ackSend) {
    const state = await getState(cmd.sessionId);
    assertCommandAllowed(state, 'discuss:start');
    // Discussion faqat QUESTION_LOCKED / REVEAL dan boshlanadi (lock tekshiruvi)
    if (![CAST_PHASES.QUESTION_LOCKED, CAST_PHASES.REVEAL].includes(state.phase)) {
      return ackSend({ ok: false, commandId: cmd.commandId, error: { code: 'INVALID_PHASE', message: 'Savol yopilgach muhokama ochiladi' } });
    }
    const config = await getConfig(cmd.sessionId);
    if (config?.responsiveTeaching?.discussionEnabled === false) {
      return ackSend({ ok: false, commandId: cmd.commandId, error: { code: 'INVALID_PHASE', message: 'Bu rejimda muhokama o‘chirilgan' } });
    }
    const seconds = Math.min(600, Math.max(10, Number(cmd.payload?.seconds) || config?.responsiveTeaching?.discussionDefaultSeconds || 60));
    const instructions = String(cmd.payload?.instructions || '').slice(0, 200) || null;
    const discussionEndsAt = Date.now() + seconds * 1000;
    const event = {
      type: 'cast:discussionStarted',
      payload: { discussionEndsAt, instructions, seconds },
      serverAt: Date.now(),
    };
    const next = applyEvent(state, event);
    const res = await commitEvent({ sessionId: cmd.sessionId, expectedRevision: cmd.expectedRevision, event, state: next });
    io.to(rooms(cmd.sessionId)).emit(CAST_EVENTS.DISCUSSION_STARTED, {
      revision: res.revision,
      seconds,
      instructions,
      discussionEndsAt,
      serverAt: res.event.serverAt,
    });
    ackSend({ ok: true, commandId: cmd.commandId, newRevision: res.revision, discussionEndsAt });
  }

  // ── OPEN REVOTE (C3-03) ──
  async function handleOpenRevote(cmd, actor, ackSend) {
    const state = await getState(cmd.sessionId);
    assertCommandAllowed(state, 'revote:open');
    // Revote faqat DISCUSSION / REVEAL dan
    if (![CAST_PHASES.DISCUSSION, CAST_PHASES.REVEAL].includes(state.phase)) {
      return ackSend({ ok: false, commandId: cmd.commandId, error: { code: 'INVALID_PHASE', message: 'Muhokama davomida revote ochiladi' } });
    }
    cancelSessionTimer(cmd.sessionId);
    const config = await getConfig(cmd.sessionId);
    const seconds = Math.min(300, Math.max(10, Number(cmd.payload?.seconds) || config?.timer?.defaultSeconds || 30));
    const openedAt = Date.now();
    const closesAt = computeClosesAt({ mode: config?.timer?.mode || 'soft', defaultSeconds: seconds, openedAt });
    const event = {
      type: 'cast:revoteOpened',
      payload: { questionId: state.questionId, openedAt, closesAt, voteRound: 2, timerMode: config?.timer?.mode || 'soft' },
      serverAt: openedAt,
    };
    const next = applyEvent(state, event);
    const res = await commitEvent({ sessionId: cmd.sessionId, expectedRevision: cmd.expectedRevision, event, state: next });

    // Revote timer (soft expiry → close + matrix)
    if (closesAt) {
      scheduleQuestionTimer({
        sessionId: cmd.sessionId,
        questionId: state.questionId,
        revision: res.revision,
        expiresAt: closesAt,
        mode: config?.timer?.mode || 'soft',
        onFire: async ({ sessionId: sid, questionId: qid, revision }) => {
          const st = await getState(sid);
          if (!st || st.revision !== revision || st.questionId !== qid || st.phase !== 'REVOTE_OPEN') return;
          const ev = { type: 'cast:revoteClosed', payload: { closesAt: Date.now(), softExpired: true }, serverAt: Date.now() };
          const nx = applyEvent(st, ev);
          const r = await commitEvent({ sessionId: sid, expectedRevision: revision, event: ev, state: nx });
          io.to(rooms(sid)).emit(CAST_EVENTS.REVOTE_CLOSED, { revision: r.revision, softExpired: true, serverAt: r.event.serverAt });
          await emitVoteMatrix(sid, qid);
        },
      });
    }

    io.to(rooms(cmd.sessionId)).emit(CAST_EVENTS.REVOTE_OPENED, {
      revision: res.revision,
      questionId: state.questionId,
      openedAt,
      closesAt,
      voteRound: 2,
      showPrevious: config?.responsiveTeaching?.showPreviousOnRevote !== false,
      serverAt: res.event.serverAt,
    });
    ackSend({ ok: true, commandId: cmd.commandId, newRevision: res.revision, closesAt });
  }

  // ── Before/after vote matrix (director private) ──
  async function emitVoteMatrix(sessionId, questionId) {
    try {
      const [firstVotes, revotes] = await Promise.all([
        listAnswersForQuestion(sessionId, questionId, 1),
        listAnswersForQuestion(sessionId, questionId, 2),
      ]);
      const { matrix, changed, total } = computeVoteChangeMatrix(firstVotes, revotes);
      io.to(directorRoom(sessionId)).emit(CAST_EVENTS.VOTE_MATRIX, {
        questionId,
        matrix,
        changed,
        total,
        revision: (await getState(sessionId))?.revision || 0,
      });
    } catch (err) {
      console.error('[Cast] vote matrix error:', err.message);
    }
  }

  // ── CONFIDENCE (C3-04) ──
  async function handleSubmitConfidence(cmd, actor, ackSend) {
    if (actor?.actorRole !== 'participant' || !actor.participantId) {
      return ackSend({ ok: false, commandId: cmd.commandId, error: { code: 'NOT_AUTHORIZED' } });
    }
    const level = normalizeConfidence(cmd.payload?.confidence);
    if (!level) {
      return ackSend({ ok: false, commandId: cmd.commandId, error: { code: 'INVALID_OPTION', message: 'Noma‘lum ishonch darajasi' } });
    }
    const { questionId, attemptNo = 1 } = cmd.payload || {};
    if (!questionId) {
      return ackSend({ ok: false, commandId: cmd.commandId, error: { code: 'INVALID_OPTION' } });
    }
    // Confidence'ni mavjud answer record'ga yozamiz (score/grade'ga ta'sir qilmaydi)
    await fb.update(`cast_private/${cmd.sessionId}/answers/${questionId}/${actor.participantId}/${attemptNo}`, {
      confidence: level,
      confidenceAt: Date.now(),
    });
    await emitConfidenceMatrix(cmd.sessionId, questionId, attemptNo);
    ackSend({ ok: true, commandId: cmd.commandId, confidence: level });
  }

  // ── MISCONCEPTION DECISION (C3-05) ──
  async function handleMisconceptionDecision(cmd, actor, ackSend) {
    const { optionId, confirmed, questionId } = cmd.payload || {};
    if (!optionId || typeof optionId !== 'string' || optionId.length > 100 || confirmed === undefined) {
      return ackSend({ ok: false, commandId: cmd.commandId, error: { code: 'INVALID_OPTION', message: 'Malumot yetarli emas' } });
    }
    const record = recordMisconceptionDecision({
      sessionId: cmd.sessionId,
      questionId: questionId || null,
      optionId,
      misconceptionId: cmd.payload?.misconceptionId || null,
      confirmed: !!confirmed,
      teacherExplanation: cmd.payload?.teacherExplanation || null,
      teacherId: actor?.actorId,
      at: Date.now(),
    });
    await writeAudit(cmd.sessionId, { ...record, safe: true });
    ackSend({ ok: true, commandId: cmd.commandId, recorded: true });
  }

  // ── QUICK PROMPT LAUNCH (C3-06) ──
  async function handleQuickPromptLaunch(cmd, actor, ackSend) {
    const state = await getState(cmd.sessionId);
    assertCommandAllowed(state, 'quick_prompt:launch');

    const draft = cmd.payload?.draft;
    const config = await getConfig(cmd.sessionId);
    const validation = validateQuickPrompt(draft, config);
    if (!validation.valid) {
      return ackSend({ ok: false, commandId: cmd.commandId, error: { code: 'INVALID_OPTION', message: validation.errors.join('; ') } });
    }

    const questionId = generatePromptQuestionId(cmd.sessionId);
    const { public: pubQ, private: privQ } = buildPromptQuestion(draft, questionId);

    // Save to session (public + private)
    await fb.set(`cast_sessions/${cmd.sessionId}/questions_public/${questionId}`, pubQ);
    if (privQ) {
      await fb.set(`cast_private/${cmd.sessionId}/questions/${questionId}`, privQ);
    }

    // Event: quick prompt live (open directly, no preview)
    const openedAt = Date.now();
    const seconds = Number(draft?.timer?.seconds) || config?.timer?.defaultSeconds || 30;
    const closesAt = openedAt + seconds * 1000;

    const event = {
      type: 'cast:quickPromptLive',
      payload: { questionId, openedAt, closesAt, timerMode: 'soft' },
      serverAt: openedAt,
    };

    // Update state: quick prompt choreography block (same questionPosition)
    const nextState = { ...state, phase: CAST_PHASES.QUESTION_OPEN, questionId, openedAt, closesAt };
    const res = await commitEvent({ sessionId: cmd.sessionId, expectedRevision: cmd.expectedRevision, event, state: nextState });

    io.to(rooms(cmd.sessionId)).emit(CAST_EVENTS.QUICK_PROMPT_LIVE, {
      revision: res.revision,
      question: {
        id: questionId,
        type: pubQ.type,
        text: pubQ.text,
        options: pubQ.options,
        closesAt,
        isQuickPrompt: true,
      },
      serverAt: res.event.serverAt,
    });

    // Timer (soft expiry)
    if (closesAt) {
      scheduleQuestionTimer({
        sessionId: cmd.sessionId,
        questionId,
        revision: res.revision,
        expiresAt: closesAt,
        mode: 'soft',
        onFire: async ({ sessionId: sid, questionId: qid, revision }) => {
          const st = await getState(sid);
          if (!st || st.revision !== revision || st.questionId !== qid) return;
          const ev = { type: 'cast:questionClosed', payload: { closesAt: Date.now(), softExpired: true }, serverAt: Date.now() };
          const nx = applyEvent({ ...st, phase: CAST_PHASES.QUESTION_OPEN }, ev);
          const r = await commitEvent({ sessionId: sid, expectedRevision: revision, event: ev, state: nx });
          io.to(rooms(sid)).emit(CAST_EVENTS.QUESTION_CLOSED, { revision: r.revision, softExpired: true, serverAt: r.event.serverAt });
    scheduleAutoPodium(sid);
          // Quick prompt result (director only)
          await emitQuickPromptResult(sid, qid);
        },
      });
    }

    // Write audit
    await writeAudit(cmd.sessionId, { action: 'quick_prompt:launch', actorId: actor?.actorId, questionId, type: draft.type, safe: true });

    ackSend({ ok: true, commandId: cmd.commandId, newRevision: res.revision, questionId });
  }

  // ── QUICK PROMPT SAVE TO LIBRARY (C3-06) ──
  async function handleQuickPromptSave(cmd, actor, ackSend) {
    const draft = cmd.payload?.draft;
    if (!draft || !draft.type) {
      return ackSend({ ok: false, commandId: cmd.commandId, error: { code: 'INVALID_OPTION', message: 'Prompt malumoti talab qilinadi' } });
    }
    const validation = validateQuickPrompt(draft);
    if (!validation.valid) {
      return ackSend({ ok: false, commandId: cmd.commandId, error: { code: 'INVALID_OPTION', message: validation.errors.join('; ') } });
    }
    try {
      const itemId = await saveToLibrary(draft, actor?.actorId);
      await writeAudit(cmd.sessionId, { action: 'quick_prompt:save', actorId: actor?.actorId, itemId, type: draft.type, safe: true });
      ackSend({ ok: true, commandId: cmd.commandId, itemId });
    } catch (err) {
      ackSend({ ok: false, commandId: cmd.commandId, error: { code: 'NOT_AUTHORIZED', message: err.message } });
    }
  }

  // ── QUICK PROMPT CANCEL (C3-06) ──
  async function handleQuickPromptCancel(cmd, actor, ackSend) {
    const state = await getState(cmd.sessionId);
    if (state.phase !== CAST_PHASES.QUESTION_OPEN) {
      return ackSend({ ok: false, commandId: cmd.commandId, error: { code: 'INVALID_PHASE' } });
    }
    // Verify it's a quick prompt (not a real question)
    const questionId = state.questionId;
    if (!questionId || !questionId.startsWith('qp_')) {
      return ackSend({ ok: false, commandId: cmd.commandId, error: { code: 'INVALID_OPTION', message: 'Bu buyruq faqat tezkor savollar uchun' } });
    }
    cancelSessionTimer(cmd.sessionId);
    const event = { type: 'cast:questionClosed', payload: { closesAt: Date.now(), hostClosed: true, isQuickPromptCancel: true }, serverAt: Date.now() };
    const next = applyEvent({ ...state, phase: CAST_PHASES.QUESTION_OPEN }, event);
    const res = await commitEvent({ sessionId: cmd.sessionId, expectedRevision: cmd.expectedRevision, event, state: next });
    io.to(rooms(cmd.sessionId)).emit(CAST_EVENTS.QUESTION_CLOSED, { revision: res.revision, hostClosed: true, isQuickPromptCancel: true, serverAt: res.event.serverAt });
    await writeAudit(cmd.sessionId, { action: 'quick_prompt:cancel', actorId: actor?.actorId, safe: true });
    ackSend({ ok: true, commandId: cmd.commandId, newRevision: res.revision });
  }

  // ── Quick prompt result (director private) ──
  async function emitQuickPromptResult(sessionId, questionId) {
    try {
      const answers = await listAnswersForQuestion(sessionId, questionId, 1);
      const participants = await listParticipants(sessionId);
      const total = Object.keys(participants).length;
      const answered = Object.keys(answers).length;

      // Distribution
      const distribution = {};
      for (const a of Object.values(answers)) {
        const ids = a.selectedOptionIds || [];
        for (const id of ids) {
          distribution[id] = (distribution[id] || 0) + 1;
        }
      }

      io.to(directorRoom(sessionId)).emit(CAST_EVENTS.QUICK_PROMPT_RESULT, {
        questionId,
        answered,
        total,
        distribution,
        revision: (await getState(sessionId))?.revision || 0,
      });
    } catch (err) {
      console.error('[Cast] quick prompt result error:', err.message);
    }
  }

  // ── SUBMIT REASONING (C3-07) ──
  async function handleSubmitReasoning(cmd, actor, ackSend) {
    if (actor?.actorRole !== 'participant' || !actor.participantId) {
      return ackSend({ ok: false, commandId: cmd.commandId, error: { code: 'NOT_AUTHORIZED' } });
    }
    const { questionId, text, attemptNo } = cmd.payload || {};
    if (!questionId) {
      return ackSend({ ok: false, commandId: cmd.commandId, error: { code: 'INVALID_OPTION' } });
    }

    const result = await submitReasoning({
      sessionId: cmd.sessionId,
      questionId,
      participantId: actor.participantId,
      commandId: cmd.commandId,
      text: text || '',
      attemptNo: attemptNo || 1,
    });

    if (result.status === 'ACCEPTED') {
      // Notify director's reasoning queue
      await emitReasoningQueue(cmd.sessionId, questionId);
      ackSend({ ok: true, commandId: cmd.commandId, reasoningId: result.reasoningId, status: result.status });
    } else {
      ackSend({ ok: true, commandId: cmd.commandId, status: 'EMPTY' });
    }
  }

  // ── MODERATE REASONING (C3-07) ──
  async function handleModerateReasoning(cmd, actor, ackSend) {
    const { reasoningId, action, redactedText } = cmd.payload || {};
    if (!reasoningId || !action) {
      return ackSend({ ok: false, commandId: cmd.commandId, error: { code: 'INVALID_OPTION' } });
    }
    try {
      const result = await moderateReasoning({
        sessionId: cmd.sessionId,
        reasoningId,
        action,
        moderatorId: actor?.actorId,
        redactedText,
      });
      // Notify director room
      io.to(directorRoom(cmd.sessionId)).emit(CAST_EVENTS.REASONING_MODERATED, {
        reasoningId,
        moderationState: result.moderationState,
        questionId: result.questionId,
        participantId: result.participantId,
      });
      // If projected → broadcast public text
      if (action === 'project' && result.questionId && result.participantId) {
        const publicText = await getPublicReasoning(cmd.sessionId, result.questionId, result.participantId);
        if (publicText) {
          io.to(rooms(cmd.sessionId)).emit(CAST_EVENTS.REASONING_PUBLIC, {
            questionId: result.questionId,
            participantId: result.participantId,
            text: publicText,
            projected: true,
          });
        }
      }
      await writeAudit(cmd.sessionId, { action: 'reasoning:moderate', actorId: actor?.actorId, reasoningId, action, safe: true });
      ackSend({ ok: true, commandId: cmd.commandId });
    } catch (err) {
      ackSend({ ok: false, commandId: cmd.commandId, error: { code: 'INVALID_OPTION', message: err.message } });
    }
  }

  // ── Reasoning queue (director private) ──
  async function emitReasoningQueue(sessionId, questionId) {
    try {
      const queue = await listModerationQueue(sessionId);
      const pending = Object.entries(queue)
        .filter(([, v]) => WALL_PENDING_STATES.includes(v.moderationState))
        .map(([, v]) => v);
      if (pending.length > 0) {
        io.to(directorRoom(sessionId)).emit(CAST_EVENTS.REASONING_QUEUE, {
          questionId,
          pending: pending.slice(0, 50), // limit
          total: pending.length,
        });
      }
    } catch (err) {
      console.error('[Cast] reasoning queue error:', err.message);
    }
  }

  // ── TRANSFER / REDEMPTION LAUNCH (C3-08) ──
  async function handleTransferLaunch(cmd, actor, ackSend) {
    const state = await getState(cmd.sessionId);
    assertCommandAllowed(state, 'mastery:launch');

    const { sourceQuestionId, followUpQuestionId, type, leaderboardImpact } = cmd.payload || {};
    const config = await getConfig(cmd.sessionId);

    // Load private questions for mapping validation
    const privSnap = await fb.get(`cast_private/${cmd.sessionId}/questions`);
    const privateQuestions = privSnap.exists() ? privSnap.val() : {};

    const validation = validateTransferMapping({ sourceQuestionId, followUpQuestionId, type, privateQuestions });
    if (!validation.valid) {
      return ackSend({ ok: false, commandId: cmd.commandId, error: { code: 'INVALID_OPTION', message: validation.errors.join('; ') } });
    }

    const flowType = type || 'TRANSFER';

    // Redemption attempt limit check (class-wide aggregate)
    if (flowType === 'REDEMPTION') {
      const limit = config?.mastery?.redemptionAttemptLimit ?? 3;
      // Count existing redemption attempts for this source question
      const apSnap = await fb.get(`cast_sessions/${cmd.sessionId}/action_pack/learning_progress`);
      const progress = apSnap.exists() ? apSnap.val() : {};
      const attemptsUsed = Object.values(progress).filter((r) => r.sourceQuestionId === sourceQuestionId).length;
      const { allowed, remaining } = checkRedemptionLimit({ attemptsUsed, limit });
      if (!allowed) {
        return ackSend({ ok: false, commandId: cmd.commandId, error: { code: 'INVALID_PHASE', message: 'Redemption urinishlar limiti tugadi' } });
      }
    }

    // Load follow-up question (private + public)
    const followUpPriv = privateQuestions[followUpQuestionId];
    const pubSnap = await fb.get(`cast_sessions/${cmd.sessionId}/questions_public/${followUpQuestionId}`);
    const followUpPub = pubSnap.exists() ? pubSnap.val() : null;
    if (!followUpPub) {
      return ackSend({ ok: false, commandId: cmd.commandId, error: { code: 'SOURCE_UNAVAILABLE', message: 'Follow-up savol topilmadi' } });
    }

    const contract = buildMasteryContract({ sourceQuestionId, followUpQuestionId, type: flowType, attemptNo: 1, leaderboardImpact: leaderboardImpact || 'NONE' });

    // Open follow-up question (normal question flow)
    const openedAt = Date.now();
    const seconds = config?.timer?.defaultSeconds || 30;
    const closesAt = openedAt + seconds * 1000;

    const event = {
      type: 'cast:transferOpened',
      payload: {
        questionId: followUpQuestionId,
        sourceQuestionId,
        flowType,
        openedAt,
        closesAt,
        contract,
      },
      serverAt: openedAt,
    };
    const next = applyEvent(state, event);
    const res = await commitEvent({ sessionId: cmd.sessionId, expectedRevision: cmd.expectedRevision, event, state: next });

    io.to(rooms(cmd.sessionId)).emit(CAST_EVENTS.TRANSFER_OPENED, {
      revision: res.revision,
      question: followUpPub ? participantQuestionProjection(followUpPub, { phase: 'QUESTION_OPEN', openedAt, closesAt, revision: res.revision }) : null,
      flowType,
      sourceQuestionId,
      contract,
      leaderboardImpact: contract.leaderboardImpact,
      serverAt: res.event.serverAt,
    });

    // Timer (soft expiry)
    if (closesAt) {
      scheduleQuestionTimer({
        sessionId: cmd.sessionId,
        questionId: followUpQuestionId,
        revision: res.revision,
        expiresAt: closesAt,
        mode: 'soft',
        onFire: async ({ sessionId: sid, questionId: qid, revision }) => {
          const st = await getState(sid);
          if (!st || st.revision !== revision || st.questionId !== qid || st.phase !== 'QUESTION_OPEN') return;
          const ev = { type: 'cast:transferCompleted', payload: { questionId: qid }, serverAt: Date.now() };
          const nx = applyEvent({ ...st, phase: CAST_PHASES.QUESTION_OPEN }, ev);
          await commitEvent({ sessionId: sid, expectedRevision: revision, event: ev, state: nx });
          io.to(rooms(sid)).emit(CAST_EVENTS.QUESTION_CLOSED, { revision: nx.revision, softExpired: true, serverAt: Date.now() });
          scheduleAutoPodium(sid);
        },
      });
    }

    await writeAudit(cmd.sessionId, { action: 'mastery:launch', actorId: actor?.actorId, flowType, sourceQuestionId, followUpQuestionId, leaderboardImpact: contract.leaderboardImpact, safe: true });
    ackSend({ ok: true, commandId: cmd.commandId, newRevision: res.revision, contract });
  }

  // ── TRANSFER / REDEMPTION SUBMIT (C3-08) ──
  async function handleTransferSubmit(cmd, actor, ackSend) {
    if (actor?.actorRole !== 'participant' || !actor.participantId) {
      return ackSend({ ok: false, commandId: cmd.commandId, error: { code: 'NOT_AUTHORIZED' } });
    }
    const { followUpQuestionId, sourceQuestionId, flowType, selectedOptionIds } = cmd.payload || {};
    const state = await getState(cmd.sessionId);
    if (!state || state.questionId !== followUpQuestionId || state.phase !== 'QUESTION_OPEN') {
      return ackSend({ ok: false, commandId: cmd.commandId, error: { code: 'REJECTED_QUESTION_CLOSED', message: 'Savol yopilgan' } });
    }

    // Score the follow-up answer (private, leaderboard impact NONE)
    const priv = await getPrivateQuestion(cmd.sessionId, followUpQuestionId);
    if (!priv) {
      return ackSend({ ok: false, commandId: cmd.commandId, error: { code: 'INVALID_OPTION', message: 'Savol topilmadi' } });
    }
    // Validate selected option IDs against private question options
    const validIds = new Set((priv.options || []).map((o) => o.id));
    for (const id of selectedOptionIds || []) {
      if (!validIds.has(id)) {
        return ackSend({ ok: false, commandId: cmd.commandId, error: { code: 'INVALID_OPTION', message: 'Noma\'lum variant' } });
      }
    }
    const correctSet = new Set(priv.correctOptionIds || []);
    const uniqueSelected = [...new Set(selectedOptionIds || [])];
    const isCorrect = uniqueSelected.length === correctSet.size && uniqueSelected.every((id) => correctSet.has(id));

    const receivedAt = Date.now();
    const elapsedMs = Math.max(0, receivedAt - (state.openedAt || receivedAt));

    const followUpAnswer = {
      answerId: 'tr_' + cmd.commandId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32),
      commandId: cmd.commandId,
      participantId: actor.participantId,
      questionId: followUpQuestionId,
      selectedOptionIds: uniqueSelected,
      receivedAt,
      elapsedMs,
      isCorrect,
      status: 'ACCEPTED',
      flowType,
      sourceQuestionId,
      leaderboardImpact: 'NONE',
    };

    // Write transfer result SEPARATELY from original competition score
    await fb.set(`cast_private/${cmd.sessionId}/transfer_results/${followUpQuestionId}/${actor.participantId}`, followUpAnswer);

    // Compute learning progress against the source answer
    const sourceSnap = await fb.get(`cast_private/${cmd.sessionId}/answers/${sourceQuestionId}/${actor.participantId}/1`);
    const sourceAnswer = sourceSnap.exists() ? sourceSnap.val() : null;
    const progress = computeLearningProgress({ sourceAnswer, followUpAnswer, type: flowType });

    // Write learning progress (separate from leaderboard)
    const progressPath = `cast_sessions/${cmd.sessionId}/action_pack/learning_progress/${followUpQuestionId}/${actor.participantId}`;
    await fb.set(progressPath, progress);

    // Action pack next-step
    const nextStep = buildNextStep({ sessionId: cmd.sessionId, questionId: sourceQuestionId, status: progress.status, followUpQuestionId, flowType });
    const nextStepPath = `cast_sessions/${cmd.sessionId}/action_pack/next_steps/${followUpQuestionId}/${actor.participantId}`;
    await fb.set(nextStepPath, nextStep);

    // Director-private learning progress update
    io.to(directorRoom(cmd.sessionId)).emit(CAST_EVENTS.LEARNING_PROGRESS_UPDATED, {
      followUpQuestionId,
      participantId: actor.participantId,
      progress,
      nextStep,
    });

    // Broadcast answer count (public — count only, no identity)
    io.to(rooms(cmd.sessionId)).emit(CAST_EVENTS.ANSWER_COUNT, { answered: 1, total: Object.keys(await listParticipants(cmd.sessionId)).length });

    ackSend({ ok: true, commandId: cmd.commandId, status: 'ACCEPTED', isCorrect, leaderboardImpact: 'NONE', progress: { status: progress.status, wrongToCorrect: progress.wrongToCorrect } });
  }

  // ── CLASS GOAL CONFIG (C3-09) ──
  async function handleGoalConfig(cmd, actor, ackSend) {
    const goal = cmd.payload?.goal;
    const validation = validateClassGoal(goal);
    if (!validation.valid) {
      return ackSend({ ok: false, commandId: cmd.commandId, error: { code: 'INVALID_OPTION', message: validation.errors.join('; ') } });
    }
    // Save goal to session config
    await fb.set(`cast_sessions/${cmd.sessionId}/config/class_goal`, goal);

    // Compute initial progress + emit to rooms (aggregate only)
    const progress = computeClassGoalProgress({ goal, questions: {}, events: {} });
    io.to(rooms(cmd.sessionId)).emit(CAST_EVENTS.GOAL_PROGRESS, { progress });
    io.to(directorRoom(cmd.sessionId)).emit(CAST_EVENTS.GOAL_PROGRESS, { progress, goal });

    await writeAudit(cmd.sessionId, { action: 'class_goal:config', actorId: actor?.actorId, goalType: goal.type, target: goal.target, safe: true });
    ackSend({ ok: true, commandId: cmd.commandId, progress });
  }

  // ── Compute + broadcast class goal progress after evidence (C3-09) ──
  async function emitClassGoalProgress(sessionId) {
    try {
      const config = await getConfig(sessionId);
      const goal = config?.class_goal;
      if (!goal) return;

      // Aggregate from answered questions evidence
      const answersSnap = await fb.get(`cast_private/${sessionId}/answers`);
      const allAnswers = answersSnap.exists() ? answersSnap.val() : {};
      const questions = {};
      for (const [qid, byPid] of Object.entries(allAnswers)) {
        let correct = 0;
        let incorrect = 0;
        for (const attempts of Object.values(byPid)) {
          const rec = attempts['1'];
          if (rec && rec.status === 'ACCEPTED') {
            if (rec.isCorrect) correct++;
            else incorrect++;
          }
        }
        questions[qid] = { correct, incorrect };
      }

      // Mastery rounds from transfer results
      const transferSnap = await fb.get(`cast_private/${sessionId}/transfer_results`);
      const transferResults = transferSnap.exists() ? transferSnap.val() : {};
      let masteryRoundsCompleted = 0;
      for (const byPid of Object.values(transferResults)) {
        for (const rec of Object.values(byPid)) {
          if (rec && rec.isCorrect) masteryRoundsCompleted++;
        }
      }

      // Misconceptions resolved from learning progress (C3-08)
      const lpSnap = await fb.get(`cast_sessions/${sessionId}/action_pack/learning_progress`);
      const learningProgress = lpSnap.exists() ? lpSnap.val() : {};
      let misconceptionsResolved = 0;
      for (const byPid of Object.values(learningProgress)) {
        for (const rec of Object.values(byPid)) {
          if (rec && (rec.status === 'first_wrong_redeemed_correct' || rec.status === 'first_wrong_transfer_correct')) {
            misconceptionsResolved++;
          }
        }
      }

      const progress = computeClassGoalProgress({
        goal,
        questions,
        events: { masteryRoundsCompleted, misconceptionsResolved },
      });

      // Public: aggregate only (no participant blame)
      io.to(rooms(sessionId)).emit(CAST_EVENTS.GOAL_PROGRESS, { progress });
      // Director: goal too
      io.to(directorRoom(sessionId)).emit(CAST_EVENTS.GOAL_PROGRESS, { progress, goal });

      // Goal complete → celebration event (reduced-motion safe)
      const complete = buildGoalCompleteEvent(progress);
      if (complete) {
        io.to(rooms(sessionId)).emit(CAST_EVENTS.GOAL_COMPLETE, complete);
      }
    } catch (err) {
      console.error('[Cast] class goal progress error:', err.message);
    }
  }

  // ── Personal best (participant-private; opt-in public) (C3-09) ──
  async function emitPersonalBest(sessionId, participantId) {
    try {
      const config = await getConfig(sessionId);
      const participant = await getParticipant(sessionId, participantId);
      if (!participant) return;

      const fingerprint = computeComparableFingerprint(config);
      const answersSnap = await fb.get(`cast_private/${sessionId}/answers`);
      const allAnswers = answersSnap.exists() ? answersSnap.val() : {};
      const myAnswers = {};
      for (const [qid, byPid] of Object.entries(allAnswers)) {
        if (byPid[participantId]) {
          myAnswers[qid] = byPid[participantId]['1'] || null;
        }
      }

      const progress = computePersonalProgress({ participant, answers: myAnswers, fingerprint });
      const visibility = config?.personalProgress?.visibility || 'private';
      const personalBest = buildPersonalBest({ participant, progress, visibility });

      // Participant-private socket room: participant socket'ga to'g'ridan-to'g'ri
      const socketId = socket.id;
      io.to(socketId).emit(CAST_EVENTS.PERSONAL_BEST, personalBest);

      // Public (projector) — faqat opt-in bo'lsa
      if (canShowPublic(personalBest)) {
        io.to(rooms(sessionId)).emit(CAST_EVENTS.PERSONAL_BEST, { ...personalBest, publicVisible: true });
      }
    } catch (err) {
      // non-critical — personal best optional
    }
  }

  // ── Confidence private matrix (director room only) ──
  async function emitConfidenceMatrix(sessionId, questionId, attemptNo = 1) {
    try {
      const answers = await listAnswersForQuestion(sessionId, questionId, attemptNo);
      const matrix = computeConfidenceMatrix(answers);
      io.to(directorRoom(sessionId)).emit(CAST_EVENTS.CONFIDENCE_UPDATED, {
        questionId,
        attemptNo,
        ...matrix,
      });
    } catch (err) {
      console.error('[Cast] confidence error:', err.message);
    }
  }

  // ── SESSION END ──
  async function handleSessionEnd(cmd, actor, ackSend) {
    const state = await getState(cmd.sessionId);
    if (!state || state.phase === 'ENDED') {
      return ackSend({ ok: false, commandId: cmd.commandId, error: { code: 'SESSION_ENDED' } });
    }
    cancelSessionTimer(cmd.sessionId);
    // C3-16: self-paced race bo'lsa — barcha cursor'lar finalize (item 8)
    const endConfig = await getConfig(cmd.sessionId);
    if (isSelfPaced(endConfig)) {
      try { await finalizeRace(cmd.sessionId); } catch (_) { /* non-critical */ }
    }
    const event = { type: 'cast:sessionEnded', payload: { endedAt: Date.now() }, serverAt: Date.now() };
    const next = applyEvent(state, event);
    const res = await commitEvent({ sessionId: cmd.sessionId, expectedRevision: cmd.expectedRevision, event, state: next });

    // C5-05 (item 10/11): oxirgi answer count'ni yuborib, coalescer'ni tozalaymiz
    const ac = answerCountCoalescers.get(cmd.sessionId);
    if (ac) {
      try { await ac.flush(); } catch (_) { /* non-critical */ }
      ac.stop();
      answerCountCoalescers.delete(cmd.sessionId);
    }

    // Save final leaderboard snapshot (immutable)
    const participants = await listParticipants(cmd.sessionId);
    const scores = await getScores(cmd.sessionId);
    const rows = Object.entries(participants).map(([pid, p]) => ({
      participantId: pid,
      displayAlias: p.displayAlias,
      score: scores[pid]?.total || 0,
    }));
    rows.sort((a, b) => b.score - a.score);
    await fb.set(`cast_sessions/${cmd.sessionId}/action_pack/final_leaderboard`, { rows, endedAt: Date.now() });

    // C5-01 (item 1): async action-pack job — report raw public leaderboard'ga
    // bog'liq emas (immutable snapshot). Non-blocking: socket ACK tezda qaytadi.
    const apSessionId = cmd.sessionId;
    buildActionPackForSession(apSessionId, {
      getSessionMeta: (sid) => getSessionMeta(sid),
      getConfig: (sid) => getConfig(sid),
      listParticipants: (sid) => listParticipants(sid),
      getPublicQuestions: (sid) => getPublicQuestions(sid),
      getScores: (sid) => getScores(sid),
      listAnswersForQuestion: (sid, qid, attemptNo) => listAnswersForQuestion(sid, qid, attemptNo),
      getNetworkSamples: async (sid) => {
        const snap = await fb.get(`cast_private/${sid}/network`);
        return snap.exists() ? snap.val() : {};
      },
      listAudit: async (sid) => {
        const snap = await fb.get(`cast_private/${sid}/audit`);
        return snap.exists() ? snap.val() : {};
      },
      listFindings: async () => {
        // Postflight findings hozircha quality-lab sahifasidan o'qiladi;
        // bu yerda bo'lmasa empty — report hali ham to'liq ishlaydi.
        return [];
      },
    })
      .then(async (report) => {
        await fb.set(`cast_sessions/${apSessionId}/action_pack/report`, { ...report, status: 'ready' });
        await writeAudit(apSessionId, { action: 'action_pack:generated', reportId: report.fingerprint, safe: true });
      })
      .catch((err) => {
        console.error('[Cast] action pack job error:', err.message);
        // Job fail bo'lsa — retry belgisi (keyingi retention run'da qayta urinish)
        fb.set(`cast_sessions/${apSessionId}/action_pack/job`, { status: 'failed', error: err.message, at: Date.now() }).catch(() => {});
      });

    await writeAudit(cmd.sessionId, { action: 'session:end', actorId: actor?.actorId, safe: true });

    // STYLE S32: final leaderboard — END_ONLY frequency'da ham shu yerda ko'rsatiladi
    // (ENDED phase'da leaderboard:show command whitelist'da yo'q — shuning uchun
    // handleSessionEnd o'zi emit qiladi, celebrate budget max 1 — S32.09).
    try {
      const cfg = (await getConfig(cmd.sessionId).catch(() => null)) || {};
      const lbCfg = cfg.leaderboard || {};
      const freq = lbCfg.frequency || CAST_LB_FREQUENCY.END_ONLY;
      if (freq !== CAST_LB_FREQUENCY.NEVER) {
        await emitLeaderboardProjections(cmd.sessionId, { final: true });
      }
    } catch (_) { /* non-critical */ }

    io.to(rooms(cmd.sessionId)).emit(CAST_EVENTS.SESSION_ENDED, { revision: res.revision, serverAt: res.event.serverAt });
    ackSend({ ok: true, commandId: cmd.commandId, newRevision: res.revision });
  }

  // ── Disconnect ──
  socket.on('disconnect', async () => {
    const sessionId = socket.data?.castSessionId;
    const ticket = socket.data?.castTicket;
    const payload = ticket ? verifyTicket(ticket) : null;
    if (sessionId && payload) {
      // C3-13: participant socket'ini kuzatuvdan olib tashlaymiz
      untrackParticipantSocket(payload.participantId, socket.id);
      try {
        await markPresence(sessionId, payload.participantId, 'offline');
        io.to(rooms(sessionId)).emit(CAST_EVENTS.PRESENCE_UPDATED, {
          participantId: payload.participantId,
          presence: 'offline',
        });
      } catch (_) {
        /* non-critical */
      }
    }
    // C3-10: director disconnect → public wall freeze (oxirgi director chiqsa)
    const dirSessions = socket.data?.castDirectorSessions || [];
    for (const sid of dirSessions) {
      const n = (directorCount.get(sid) || 1) - 1;
      if (n <= 0) {
        directorCount.delete(sid);
        try { await freezeWall(sid); } catch (_) { /* non-critical */ }
      } else {
        directorCount.set(sid, n);
        try { await markDirectorSeen(sid); } catch (_) { /* non-critical */ }
      }
    }
  });
}

// ── Confusion signal cooldown registry ──
const confusionCooldowns = new Map();
// C3-10: session-scoped signal store (in-memory, identity faqat in-memory — hech qachon persist qilinmaydi)
const confusionSignals = new Map(); // sessionId → [{signal, at, participantId}]
const confusionAcks = new Map(); // sessionId → {signal: at}
const directorCount = new Map(); // sessionId → connected director sockets soni

// ── Safe join config (no answer keys, no private fields) ──
function safeJoinConfig(config) {
  if (!config) return null;
  return {
    join: config.join,
    presentation: config.presentation,
    timer: config.timer,
    scoring: config.scoring,
    feedback: config.feedback,
    // C4-03: paper-card mode'ni client bilishi kerak (card field ko'rsatish)
    participation: config.participation,
    // C4-04 (item 20): accommodation hook — noTimer/longTimeMs client'da qo'llaniladi
    accessibility: config.accessibility,
  };
}
