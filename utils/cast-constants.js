/**
 * Deborah — Cast Director Constants
 * ---------------------------------
 * Barcha Cast enum'lari va config uchun canonical qadriyatlar.
 * Server va client bir xil registry'ni ishlatadi.
 */

// ── Schema / preset ──
export const CAST_SCHEMA_VERSION = 2;
export const PRESET_VERSION = 1;

// ── Phase state machine ──
export const CAST_PHASES = {
  LOBBY_OPEN: 'LOBBY_OPEN',
  THINK_TIME: 'THINK_TIME',
  QUESTION_OPEN: 'QUESTION_OPEN',
  QUESTION_LOCKED: 'QUESTION_LOCKED',
  REVEAL: 'REVEAL',
  DISCUSSION: 'DISCUSSION',
  REVOTE_OPEN: 'REVOTE_OPEN',
  LEADERBOARD: 'LEADERBOARD',
  // C3-11 POE flow
  PREDICTION_OPEN: 'PREDICTION_OPEN',
  OBSERVATION: 'OBSERVATION',
  EXPLANATION_OPEN: 'EXPLANATION_OPEN',
  // C3-12 Open-Response Semantic Board
  ORB_COLLECT: 'ORB_COLLECT',
  ORB_REVIEW: 'ORB_REVIEW',
  ENDED: 'ENDED',
};

// ── Pace ──
export const CAST_PACE = {
  INSTRUCTOR: 'instructor',
  STUDENT: 'student',
  SELF_PACED: 'self_paced',
};

// ── Playback advance mode ──
export const CAST_ADVANCE_MODE = {
  HOST_CONTROLLED: 'host_controlled',
  SEMI_AUTO: 'semi_auto',
  FULLY_AUTO: 'fully_auto',
};

// ── Close triggers ──
export const CAST_CLOSE_TRIGGER = {
  HOST_ONLY: 'host_only',
  HOST_OR_SOFT_TIMEOUT: 'host_or_soft_timeout',
  ALL_ANSWERED: 'all_answered',
  AUTO_AFTER_MAX: 'auto_after_max',
};

// ── Timer modes ──
export const CAST_TIMER_MODE = {
  OFF: 'off',
  SOFT: 'soft',
  STRICT: 'strict',
};

// ── Scoring modes ──
export const CAST_SCORING_MODE = {
  ACCURACY: 'accuracy',
  BALANCED: 'balanced',
  SPEED: 'speed',
  NO_POINTS: 'no_points',
  PARTICIPATION: 'participation',
};

export const CAST_SCORING_VERSION = 'score_v2';

// ── Leaderboard visibility / frequency ──
export const CAST_LB_VISIBILITY = {
  OFF_DURING_LEARNING: 'off_during_learning',
  PERSONAL_ONLY: 'personal_only',
  TOP_N: 'top_n',
  RELATIVE_NEIGHBORS: 'relative_neighbors',
  TEAM_ONLY: 'team_only',
  FULL_PRIVATE_HOST: 'full_private_host',
};

export const CAST_LB_FREQUENCY = {
  MANUAL: 'manual',
  NEVER: 'never',
  END_ONLY: 'end_only',
  EVERY_QUESTION: 'every_question',
  EVERY_N: 'every_n',
  MILESTONES: 'milestones',
};

// ── Join identity / late join ──
export const CAST_JOIN_IDENTITY = {
  SAFE_ALIAS: 'safe_alias',
  ROSTER_ANONYMOUS: 'roster_anonymous',
  ANONYMOUS: 'anonymous',
};

export const CAST_LATE_JOIN_POLICY = {
  OFF: 'off',
  NEXT_QUESTION: 'next_question',
  UNTIL_QUESTION: 'until_question',
};

// ── Feedback / response distribution ──
export const CAST_FEEDBACK_POLICY = {
  TEACHER_CONTROLLED: 'teacher_controlled',
  IMMEDIATE: 'immediate',
  AFTER_QUESTION: 'after_question',
  AFTER_SESSION: 'after_session',
};

// ── C3-03 Vote→Discuss→Revote score policy ──
export const CAST_SCORE_POLICY = {
  FIRST_ONLY: 'first_only',                        // leaderboard'ga faqat first vote
  REVOTE_ONLY: 'revote_only',                      // faqat revote balli (agar bo'lsa)
  LEARNING_ONLY_NO_LEADERBOARD: 'learning_only_no_leaderboard', // o'rganish uchun, reytingga kirmaydi
};

// ── Answer statuses ──
export const CAST_ANSWER_STATUS = {
  ACCEPTED: 'ACCEPTED',
  ALREADY_ANSWERED: 'ALREADY_ANSWERED',
  REJECTED_LATE: 'REJECTED_LATE',
  REJECTED_STALE_REVISION: 'REJECTED_STALE_REVISION',
  REJECTED_INVALID_OPTION: 'REJECTED_INVALID_OPTION',
  REJECTED_QUESTION_CLOSED: 'REJECTED_QUESTION_CLOSED',
  REJECTED_NO_SESSION: 'REJECTED_NO_SESSION',
};

// ── Roles ──
export const CAST_ROLES = {
  OWNER: 'owner',
  CO_HOST: 'co_host',
  MODERATOR: 'moderator',
  PROJECTOR_ONLY: 'projector_only',
  ANALYST_READONLY: 'analyst_readonly',
};

// ── Question types (cast-supported subset) ──
export const CAST_QUESTION_TYPES = {
  SINGLE_CHOICE: 'single_choice',
  TRUE_FALSE: 'true_false',
  MULTIPLE_SELECT: 'multiple_select',
};

// ── Command / event envelope ──
export const CAST_EVENTS = {
  SESSION_CREATED: 'cast:sessionCreated',
  SESSION_STARTED: 'cast:sessionStarted',
  QUESTION_PREVIEW: 'cast:questionPreview',
  QUESTION_OPENED: 'cast:questionOpened',
  QUESTION_PAUSED: 'cast:questionPaused',
  QUESTION_RESUMED: 'cast:questionResumed',
  TIME_ADDED: 'cast:timeAdded',
  QUESTION_CLOSED: 'cast:questionClosed',
  QUESTION_LOCKED: 'cast:questionLocked',
  QUESTION_REVEALED: 'cast:questionRevealed',
  EVIDENCE_UPDATED: 'cast:evidenceUpdated',
  DISCUSSION_STARTED: 'cast:discussionStarted',
  REVOTE_OPENED: 'cast:revoteOpened',
  REVOTE_CLOSED: 'cast:revoteClosed',
  VOTE_MATRIX: 'cast:voteMatrix',
  CONFIDENCE_UPDATED: 'cast:confidenceUpdated',
  QUICK_PROMPT_LIVE: 'cast:quickPromptLive',
  QUICK_PROMPT_RESULT: 'cast:quickPromptResult',
  REASONING_QUEUE: 'cast:reasoningQueue',
  REASONING_MODERATED: 'cast:reasoningModerated',
  REASONING_PUBLIC: 'cast:reasoningPublic',
  TRANSFER_OPENED: 'cast:transferOpened',
  TRANSFER_ANSWERED: 'cast:transferAnswered',
  LEARNING_PROGRESS_UPDATED: 'cast:learningProgressUpdated',
  GOAL_PROGRESS: 'cast:goalProgress',
  GOAL_COMPLETE: 'cast:goalComplete',
  PERSONAL_BEST: 'cast:personalBest',
  CONFUSION_AGGREGATE: 'cast:confusionAggregate',
  // C5-11 AI Co-host shadow
  SHADOW_SUGGESTION: 'cast:shadowSuggestion',
  WALL_QUEUE: 'cast:wallQueue',
  WALL_PUBLIC: 'cast:wallPublic',
  // C3-11 POE flow
  POE_LAUNCHED: 'cast:poeLaunched',
  POE_PREDICTION_OPENED: 'cast:poePredictionOpened',
  POE_OBSERVATION_STARTED: 'cast:poeObservationStarted',
  POE_MEDIA_STATE: 'cast:poeMediaState',
  POE_EXPLANATION_OPENED: 'cast:poeExplanationOpened',
  POE_EXPLANATION_CLOSED: 'cast:poeExplanationClosed',
  POE_ANALYSIS: 'cast:poeAnalysis',
  POE_ANALYSIS_PUBLIC: 'cast:poeAnalysisPublic',
  POE_EXEMPLAR_QUEUE: 'cast:poeExemplarQueue',
  POE_EXEMPLAR_PUBLIC: 'cast:poeExemplarPublic',
  // C3-12 Open-Response Semantic Board
  ORB_OPENED: 'cast:orbOpened',
  ORB_COUNT: 'cast:orbCount',
  ORB_CLOSED: 'cast:orbClosed',
  ORB_CLUSTER_RESULT: 'cast:orbClusterResult',
  ORB_MANUAL_UPDATE: 'cast:orbManualUpdate',
  ORB_PROJECTOR: 'cast:orbProjector',
  ORB_ENDED: 'cast:orbEnded',
  // C3-13 Student Question Forge
  FORGE_CAPABILITY: 'cast:forgeCapability',
  FORGE_QUEUE: 'cast:forgeQueue',
  FORGE_REJECTED: 'cast:forgeRejected',
  FORGE_CONFIRMED: 'cast:forgeConfirmed',
  // C3-14 Session Choreography
  CHOREO_STATE: 'cast:choreoState',
  // C3-16 Self-Paced Race
  SP_ACTIVATED: 'cast:spActivated',
  SP_PAUSED: 'cast:spPaused',
  SP_RESUMED: 'cast:spResumed',
  SP_CURSOR: 'cast:spCursor',
  SP_CURSOR_UPDATED: 'cast:spCursorUpdated',
  SP_PROGRESS: 'cast:spProgress',
  // C3-17 Power-ups
  POWERUP_ACTIVATED: 'cast:powerupActivated',
  POWERUP_USED: 'cast:powerupUsed',
  POWERUP_INVENTORY: 'cast:powerupInventory',
  POWERUP_GRANTED: 'cast:powerupGranted',
  // C4-01 Team Challenge
  TEAM_ASSIGNED: 'cast:teamAssigned',
  TEAM_ROSTER: 'cast:teamRoster',
  TEAM_TALK_STARTED: 'cast:teamTalkStarted',
  TEAM_TALK_ENDED: 'cast:teamTalkEnded',
  TEAM_REPORTER_ROTATED: 'cast:teamReporterRotated',
  TEAM_LEADERBOARD: 'cast:teamLeaderboard',
  // C4-03 No-device paper-card mode
  CARD_SCANNED: 'cast:cardScanned',
  CARD_DUPLICATE: 'cast:cardDuplicate',
  CARD_UNKNOWN: 'cast:cardUnknown',
  CARD_CORRECTED: 'cast:cardCorrected',
  CARD_PROGRESS: 'cast:cardProgress',
  LEADERBOARD_UPDATED: 'cast:leaderboardUpdated',
  PARTICIPANT_JOINED: 'cast:participantJoined',
  PARTICIPANT_LEFT: 'cast:participantLeft',
  PARTICIPANT_BLOCKED: 'cast:participantBlocked',
  PARTICIPANT_UNBLOCKED: 'cast:participantUnblocked',
  BLOCKED_JOIN_ATTEMPT: 'cast:blockedJoinAttempt',
  JOIN_CODE_ROTATED: 'cast:joinCodeRotated',
  GOVERNANCE_ENFORCED: 'cast:governanceEnforced',
  PRESENCE_UPDATED: 'cast:presenceUpdated',
  SESSION_ENDED: 'cast:sessionEnded',
  SNAPSHOT: 'cast:snapshot',
  ANSWER_ACK: 'cast:answerAck',
  ANSWER_COUNT: 'cast:answerCount',
  JOIN_ACK: 'cast:joinAck',
  MODERATION_UPDATE: 'cast:moderationUpdate',
  ERROR: 'cast:error',
};

// ── Command types (client → server) ──
export const CAST_COMMANDS = {
  JOIN: 'cast:join',
  REJOIN: 'cast:rejoin',
  SESSION_START: 'cast:sessionStart',
  QUESTION_OPEN: 'cast:questionOpen',
  QUESTION_PAUSE: 'cast:questionPause',
  QUESTION_RESUME: 'cast:questionResume',
  ADD_TIME: 'cast:addTime',
  QUESTION_CLOSE: 'cast:questionClose',
  QUESTION_REVEAL: 'cast:questionReveal',
  QUESTION_NEXT: 'cast:questionNext',
  // STYLE S32 — Leaderboard (manual show; frequency/visibility config bilan)
  LEADERBOARD_SHOW: 'leaderboard:show',
  SESSION_END: 'cast:sessionEnd',
  ANSWER_SUBMIT: 'cast:answerSubmit',
  GET_MY_ANSWER_STATUS: 'cast:getMyAnswerStatus',
  GET_SNAPSHOT: 'cast:getSnapshot',
  HEARTBEAT: 'cast:heartbeat',
  CONFIRMATION_SIGNAL: 'cast:confusionSignal',
  QUESTION_WALL: 'cast:questionWall',
  LOCK_LOBBY: 'cast:lockLobby',
  REMOVE_PARTICIPANT: 'cast:removeParticipant',
  BLOCK_PARTICIPANT: 'cast:blockParticipant',
  UNBLOCK_PARTICIPANT: 'cast:unblockParticipant',
  ROTATE_JOIN_CODE: 'cast:rotateJoinCode',
  DIRECTOR_JOIN: 'cast:directorJoin',
  HINGE_DECISION: 'cast:hingeDecision',
  START_DISCUSSION: 'cast:startDiscussion',
  OPEN_REVOTE: 'cast:openRevote',
  SUBMIT_CONFIDENCE: 'cast:submitConfidence',
  MISCONCEPTION_DECISION: 'cast:misconceptionDecision',
  QUICK_PROMPT_LAUNCH: 'cast:quickPromptLaunch',
  QUICK_PROMPT_SAVE: 'cast:quickPromptSave',
  QUICK_PROMPT_CANCEL: 'cast:quickPromptCancel',
  SUBMIT_REASONING: 'cast:submitReasoning',
  MODERATE_REASONING: 'cast:moderateReasoning',
  TRANSFER_LAUNCH: 'cast:transferLaunch',
  TRANSFER_SUBMIT: 'cast:transferSubmit',
  GOAL_CONFIG: 'cast:goalConfig',
  WALL_MODERATE: 'cast:wallModerate',
  SIGNAL_ACK: 'cast:signalAck',
  // C5-11 AI Co-host shadow
  SHADOW_RUN: 'cast:shadowRun',
  SHADOW_DECIDE: 'cast:shadowDecide',
  SHADOW_GATE: 'cast:shadowGate',
  // C3-11 POE flow
  POE_LAUNCH: 'cast:poeLaunch',
  POE_SUBMIT_PREDICTION: 'cast:poeSubmitPrediction',
  POE_CLOSE_PREDICTION: 'cast:poeClosePrediction',
  POE_MEDIA_READY: 'cast:poeMediaReady',
  POE_MEDIA_ACTION: 'cast:poeMediaAction',
  POE_START_EXPLANATION: 'cast:poeStartExplanation',
  POE_SUBMIT_EXPLANATION: 'cast:poeSubmitExplanation',
  POE_CLOSE_EXPLANATION: 'cast:poeCloseExplanation',
  POE_SHOW_ANALYSIS: 'cast:poeShowAnalysis',
  POE_MODERATE_EXEMPLAR: 'cast:poeModerateExemplar',
  // C3-12 Open-Response Semantic Board
  ORB_LAUNCH: 'cast:orbLaunch',
  ORB_SUBMIT: 'cast:orbSubmit',
  ORB_CLOSE: 'cast:orbClose',
  ORB_RUN_CLUSTER: 'cast:orbRunCluster',
  ORB_MANUAL: 'cast:orbManual',
  ORB_END: 'cast:orbEnd',
  // C3-13 Student Question Forge
  FORGE_SUBMIT: 'cast:forgeSubmit',
  FORGE_REVIEW: 'cast:forgeReview',
  FORGE_LAUNCH: 'cast:forgeLaunch',
  // C3-14 Session Choreography Composer
  CHOREO_SAVE: 'cast:choreoSave',
  CHOREO_LIST: 'cast:choreoList',
  CHOREO_LOAD: 'cast:choreoLoad',
  CHOREO_OVERRIDE: 'cast:choreoOverride',
  CHOREO_ADVANCE: 'cast:choreoAdvance',
  // C3-16 Self-Paced Race
  SP_OPEN: 'cast:spOpen',
  SP_PAUSE: 'cast:spPause',
  SP_RESUME: 'cast:spResume',
  SP_SYNC: 'cast:spSync',
  // C3-17 Power-ups
  POWERUP_ACTIVATE: 'cast:powerupActivate',
  POWERUP_GRANT: 'cast:powerupGrant',
  POWERUP_CONFIG: 'cast:powerupConfig',
  // C4-01 Team Challenge
  TEAM_ASSIGN: 'cast:teamAssign',
  TEAM_TALK_START: 'cast:teamTalkStart',
  TEAM_TALK_END: 'cast:teamTalkEnd',
  TEAM_REPORTER_ROTATE: 'cast:teamReporterRotate',
  // C4-03 No-device paper-card mode
  CARD_SCAN: 'cast:cardScan',
  CARD_CORRECT: 'cast:cardCorrect',
};

// ── C3-17 Power-up types (pedagogically safe registry) ──
// Random answer elimination va opponent sabotage ATAA qat'iy kiritilmaydi (item 3).
export const POWERUP_TYPES = {
  HINT: 'hint',                 // to'g'ri variantga yaqinlashtiruvchi maslahat
  EXTRA_TIME: 'extra_time',     // personal timer uzaytirish
  TEAM_CONSULT: 'team_consult', // jamoadosh bilan maslahat (team session)
  PRIVATE_REDEMPTION: 'private_redemption', // shaxsiy qayta urinish/redemption
};

export const POWERUP_TYPE_LIST = Object.values(POWERUP_TYPES);

// ── C4-01 Evidence unit (group vs individual) ──
export const EVIDENCE_UNIT = {
  INDIVIDUAL: 'individual',
  GROUP: 'group',
};

// ── C4-01 Team talk phase bounds ──
export const TEAM_TALK_MIN_SECONDS = 10;
export const TEAM_TALK_MAX_SECONDS = 600;

// ── C4-03 No-device paper-card mode ──
// Card ID formati: CARD-001 (director ro'yxatiga mos); four-orientation mapping.
export const CARD_ID_RE = /^CARD-\d{1,4}$/;

export const CARD_ORIENTATIONS = {
  DEG_0: '0',   // option index 0 (A)
  DEG_90: '90', // option index 1 (B)
  DEG_180: '180', // option index 2 (C)
  DEG_270: '270', // option index 3 (D)
};

export const CARD_ORIENTATION_LIST = Object.values(CARD_ORIENTATIONS);

export const CARD_CONFIDENCE_MIN = 0.5;   // glare/occlusion threshold (item 9)
export const CARD_CONFIDENCE_WARN = 0.7;

// ── C4-02 Hybrid / low-bandwidth ──
export const DELIVERY_TYPES = {
  IN_ROOM: 'in_room',
  REMOTE: 'remote',
  HYBRID: 'hybrid',
};

export const DELIVERY_TYPE_LIST = Object.values(DELIVERY_TYPES);

// Network quality buckets (telemetry — item 8).
// Answer record'dan ALOHIDA saqlanadi; wrong answer EMAS (item tugallanish sharti).
export const NETWORK_BUCKETS = {
  GOOD: 'good',           // latency < 300ms, no loss
  DEGRADED: 'degraded',   // 300–800ms yoki qisman loss
  POOR: 'poor',           // > 800ms yoki katta loss
};

export const NETWORK_BUCKET_LIST = Object.values(NETWORK_BUCKETS);

export const NETWORK_BUCKET_THRESHOLDS = {
  DEGRADED_LATENCY_MS: 300,
  POOR_LATENCY_MS: 800,
  DEGRADED_LOSS_PERCENT: 5,
  POOR_LOSS_PERCENT: 20,
};

export const POWERUP_DEFAULT_INVENTORY = {
  hint: 1,
  extra_time: 1,
  team_consult: 0,
  private_redemption: 0,
};

// ── Join code alphabet — C4-10 (user qarori): kod faqat raqamlardan iborat
// (klassik jonli viktorina uslubi — “faqat raqam” join kodi). 6 xonali. ──
export const JOIN_CODE_ALPHABET = '0123456789';
export const JOIN_CODE_LENGTH = 6;

// ── Config bounds ──
export const CAST_BOUNDS = {
  TIMER_MIN_SECONDS: 5,
  TIMER_MAX_SECONDS: 600,
  THINK_MIN_SECONDS: 0,
  THINK_MAX_SECONDS: 30,
  TEAM_COUNT_MIN: 2,
  TEAM_COUNT_MAX: 8,
  MAX_PLAYERS_MIN: 1,
  MAX_PLAYERS_MAX: 1000,
  MAX_EXTENSIONS_PER_QUESTION: 3,
  ACK_TIMEOUT_MS: 5000,
};

// ── Confidence ──
export const CAST_CONFIDENCE_POLICY = {
  OFF: 'off',
  STRATEGIC_ITEMS: 'strategic_items',
  ALL_ITEMS: 'all_items',
};

// ── C3-04 Confidence Lens: individual confidence levels ──
export const CAST_CONFIDENCE_LEVEL = {
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
};

export const CAST_CONFIDENCE_LEVELS = ['low', 'medium', 'high'];

// ── Error codes (stable, contract) ──
export const CAST_ERROR_CODES = {
  CONFIG_INVALID: 'CAST_CONFIG_INVALID',
  SESSION_NOT_FOUND: 'SESSION_NOT_FOUND',
  NOT_AUTHORIZED: 'NOT_AUTHORIZED',
  NOT_OWNER: 'NOT_OWNER',
  STALE_REVISION: 'STALE_REVISION',
  INVALID_PHASE: 'INVALID_PHASE',
  ALREADY_ANSWERED: 'ALREADY_ANSWERED',
  REJECTED_LATE: 'REJECTED_LATE',
  REJECTED_QUESTION_CLOSED: 'REJECTED_QUESTION_CLOSED',
  INVALID_OPTION: 'INVALID_OPTION',
  JOIN_CODE_INVALID: 'JOIN_CODE_INVALID',
  LOBBY_LOCKED: 'LOBBY_LOCKED',
  LOBBY_FULL: 'LOBBY_FULL',
  NAME_TAKEN: 'NAME_TAKEN',
  UNSUPPORTED_PAYLOAD: 'UNSUPPORTED_PAYLOAD',
  PREFLIGHT_INVALID: 'PREFLIGHT_INVALID',
  SOURCE_UNAVAILABLE: 'SOURCE_UNAVAILABLE',
  SESSION_ENDED: 'SESSION_ENDED',
  COMMAND_UNKNOWN: 'COMMAND_UNKNOWN',
  DUPLICATE_COMMAND: 'DUPLICATE_COMMAND',
  CONTROL_FENCED: 'CONTROL_FENCED',
  CAPABILITY_UNSUPPORTED: 'CAPABILITY_UNSUPPORTED',
  INVALID_JUMP: 'INVALID_JUMP',
  TEMPLATE_INVALID: 'TEMPLATE_INVALID',
  // C4-06: a'zolik blok / governance
  BLOCKED: 'BLOCKED',
  GOVERNANCE_LOCKED: 'GOVERNANCE_LOCKED',
  INTERNAL: 'INTERNAL',
};

// ── Presets ──
export const CAST_PRESETS = {
  RESPONSIVE_ACCURACY: 'responsive_accuracy',
  CLASSIC_LIVE: 'classic_live',
  TEAM_CHALLENGE: 'team_challenge',
  FORMATIVE_CHECK: 'formative_check',
  SELF_PACED_RACE: 'self_paced_race',
  // C4-06: child-safe moderation preset (server-authoritative)
  MINOR_SAFE: 'minor_safe',
};
