/**
 * Deborah — Cast Preset Registry
 * ------------------------------
 * Har preset immutable object sifatida: id, version, labelKey,
 * recommended, defaults. Server authoritative — client preset object
 * authoritative emas, faqat presetId + overrides yuboradi.
 */

import {
  CAST_PRESETS,
  CAST_PACE,
  CAST_ADVANCE_MODE,
  CAST_CLOSE_TRIGGER,
  CAST_TIMER_MODE,
  CAST_SCORING_MODE,
  CAST_LB_VISIBILITY,
  CAST_LB_FREQUENCY,
} from '../../utils/cast-constants.js';

export const PRESET_REGISTRY = {
  [CAST_PRESETS.RESPONSIVE_ACCURACY]: {
    id: CAST_PRESETS.RESPONSIVE_ACCURACY,
    version: 1,
    labelKey: 'preset.responsiveAccuracy',
    recommended: true,
    defaults: {
      pace: CAST_PACE.INSTRUCTOR,
      playback: {
        advanceMode: CAST_ADVANCE_MODE.HOST_CONTROLLED,
        closeTrigger: [CAST_CLOSE_TRIGGER.HOST_OR_SOFT_TIMEOUT],
        thinkSeconds: 5,
        minimumOpenSeconds: 3,
      },
      timer: {
        mode: CAST_TIMER_MODE.SOFT,
        defaultSeconds: 30,
        allowHostExtend: true,
        maxExtensionsPerQuestion: 3,
      },
      scoring: {
        mode: CAST_SCORING_MODE.ACCURACY,
        version: 'score_v2',
        correctBase: 1000,
        speedBonusMax: 0,
        wrongPoints: 0,
        tieBreak: 'same_rank_then_stable_display',
        partialCredit: false,
        multiplier: 1,
        scorePolicy: 'first_only',
      },
      leaderboard: {
        visibility: CAST_LB_VISIBILITY.OFF_DURING_LEARNING,
        finalVisibility: CAST_LB_VISIBILITY.TOP_N,
        topN: 5,
        frequency: CAST_LB_FREQUENCY.END_ONLY,
        anonymizeLowRanks: true,
        showExactScore: false,
      },
      feedback: {
        correctness: 'teacher_controlled',
        correctAnswer: 'teacher_controlled',
        explanation: 'teacher_controlled',
        responseDistribution: 'teacher_controlled',
      },
      join: {
        identity: 'safe_alias',
        allowLateJoin: true,
        lateJoinPolicy: 'next_question',
        lateJoinUntilQuestion: 3,
        lockLobbyOnStart: true,
        maxPlayers: 100,
      },
      presentation: {
        themeId: 'focus_dark',
        motion: 'reduced',
        lobbyMusic: 'off',
        questionMusic: 'off',
        soundEffects: 'low',
      },
      responsiveTeaching: {
        hingeRecommendations: true,
        confidencePolicy: 'strategic_items',
        peerInstructionAvailable: true,
        firstVoteDistribution: 'teacher_private',
        misconceptionMap: true,
        reasoningCapture: 'selected_items',
        confusionSignal: true,
        quickPrompt: true,
        discussionEnabled: true,
        discussionDefaultSeconds: 60,
        showPreviousOnRevote: true,
      },
    },
  },

  [CAST_PRESETS.CLASSIC_LIVE]: {
    id: CAST_PRESETS.CLASSIC_LIVE,
    version: 1,
    labelKey: 'preset.classicLive',
    recommended: false,
    defaults: {
      pace: CAST_PACE.INSTRUCTOR,
      playback: {
        advanceMode: CAST_ADVANCE_MODE.HOST_CONTROLLED,
        closeTrigger: [CAST_CLOSE_TRIGGER.HOST_OR_SOFT_TIMEOUT, CAST_CLOSE_TRIGGER.ALL_ANSWERED],
        thinkSeconds: 3,
        minimumOpenSeconds: 3,
      },
      timer: { mode: CAST_TIMER_MODE.STRICT, defaultSeconds: 20, allowHostExtend: true, maxExtensionsPerQuestion: 2 },
      scoring: {
        mode: CAST_SCORING_MODE.SPEED,
        version: 'score_v2',
        correctBase: 600,
        speedBonusMax: 400,
        wrongPoints: 0,
        tieBreak: 'same_rank_then_stable_display',
        partialCredit: false,
        multiplier: 1,
        scorePolicy: 'first_only',
      },
      leaderboard: {
        visibility: CAST_LB_VISIBILITY.TOP_N,
        finalVisibility: CAST_LB_VISIBILITY.TOP_N,
        topN: 5,
        frequency: CAST_LB_FREQUENCY.EVERY_QUESTION,
        anonymizeLowRanks: true,
        showExactScore: false,
      },
      feedback: {
        correctness: 'after_question',
        correctAnswer: 'after_question',
        explanation: 'teacher_controlled',
        responseDistribution: 'teacher_controlled',
      },
      join: {
        identity: 'safe_alias',
        allowLateJoin: true,
        lateJoinPolicy: 'next_question',
        lateJoinUntilQuestion: 3,
        lockLobbyOnStart: true,
        maxPlayers: 100,
      },
      presentation: {
        themeId: 'focus_dark',
        motion: 'reduced',
        lobbyMusic: 'off',
        questionMusic: 'off',
        soundEffects: 'low',
      },
      responsiveTeaching: {
        hingeRecommendations: false,
        confidencePolicy: 'off',
        peerInstructionAvailable: false,
        firstVoteDistribution: 'teacher_private',
        misconceptionMap: false,
        reasoningCapture: 'off',
        confusionSignal: true,
        quickPrompt: false,
        discussionEnabled: false,
        discussionDefaultSeconds: 45,
        showPreviousOnRevote: false,
      },
    },
  },

  [CAST_PRESETS.TEAM_CHALLENGE]: {
    id: CAST_PRESETS.TEAM_CHALLENGE,
    version: 1,
    labelKey: 'preset.teamChallenge',
    recommended: false,
    defaults: {
      pace: CAST_PACE.INSTRUCTOR,
      playback: {
        advanceMode: CAST_ADVANCE_MODE.HOST_CONTROLLED,
        closeTrigger: [CAST_CLOSE_TRIGGER.HOST_OR_SOFT_TIMEOUT, CAST_CLOSE_TRIGGER.ALL_ANSWERED],
        thinkSeconds: 3,
        minimumOpenSeconds: 3,
      },
      timer: { mode: CAST_TIMER_MODE.SOFT, defaultSeconds: 45, allowHostExtend: true, maxExtensionsPerQuestion: 3 },
      scoring: {
        mode: CAST_SCORING_MODE.ACCURACY,
        version: 'score_v2',
        correctBase: 1000,
        speedBonusMax: 0,
        wrongPoints: 0,
        tieBreak: 'same_rank_then_stable_display',
        partialCredit: false,
        multiplier: 1,
        scorePolicy: 'first_only',
      },
      leaderboard: {
        visibility: CAST_LB_VISIBILITY.TEAM_ONLY,
        finalVisibility: CAST_LB_VISIBILITY.TEAM_ONLY,
        topN: 5,
        frequency: CAST_LB_FREQUENCY.EVERY_QUESTION,
        anonymizeLowRanks: true,
        showExactScore: false,
      },
      feedback: {
        correctness: 'after_question',
        correctAnswer: 'teacher_controlled',
        explanation: 'teacher_controlled',
        responseDistribution: 'teacher_controlled',
      },
      join: {
        identity: 'safe_alias',
        allowLateJoin: true,
        lateJoinPolicy: 'next_question',
        lateJoinUntilQuestion: 3,
        lockLobbyOnStart: true,
        maxPlayers: 100,
      },
      teams: {
        enabled: true,
        mode: 'single_team_device',
        assignment: 'random',
        count: 4,
        scoreAggregation: 'normalized_average',
      },
      presentation: {
        themeId: 'focus_dark',
        motion: 'reduced',
        lobbyMusic: 'off',
        questionMusic: 'off',
        soundEffects: 'low',
      },
      responsiveTeaching: {
        hingeRecommendations: true,
        confidencePolicy: 'off',
        peerInstructionAvailable: true,
        firstVoteDistribution: 'teacher_private',
        misconceptionMap: false,
        reasoningCapture: 'off',
        confusionSignal: true,
        quickPrompt: false,
        discussionEnabled: false,
        discussionDefaultSeconds: 45,
        showPreviousOnRevote: false,
      },
    },
  },

  [CAST_PRESETS.SELF_PACED_RACE]: {
    id: CAST_PRESETS.SELF_PACED_RACE,
    version: 1,
    labelKey: 'preset.selfPacedRace',
    recommended: false,
    defaults: {
      pace: CAST_PACE.SELF_PACED,
      selfPaced: {
        enabled: true,
        perQuestionSeconds: 45,
        randomizeOrder: true,
        lateJoinStart: 'first',
        lateJoinPosition: 0,
        rankVisibility: 'private',
        publicLiveRank: false,
        fairnessWindowSeconds: 30,
      },
      playback: {
        advanceMode: CAST_ADVANCE_MODE.AUTO,
        closeTrigger: [CAST_CLOSE_TRIGGER.ALL_ANSWERED, CAST_CLOSE_TRIGGER.TIMER_END],
        thinkSeconds: 5,
        minimumOpenSeconds: 2,
      },
      timer: { mode: CAST_TIMER_MODE.COUNTDOWN, defaultSeconds: 45, allowHostExtend: false, maxExtensionsPerQuestion: 0 },
      scoring: {
        mode: CAST_SCORING_MODE.SPEED,
        version: 'score_v2',
        correctBase: 1000,
        speedBonusMax: 500,
        wrongPoints: 0,
        tieBreak: 'same_rank_then_stable_display',
        partialCredit: false,
        multiplier: 1,
        scorePolicy: 'first_only',
      },
      leaderboard: {
        visibility: CAST_LB_VISIBILITY.ALWAYS,
        finalVisibility: CAST_LB_VISIBILITY.FULL,
        topN: 10,
        frequency: CAST_LB_FREQUENCY.AFTER_EACH,
        anonymizeLowRanks: false,
        showExactScore: true,
      },
      feedback: {
        correctness: 'after_question',
        correctAnswer: 'after_question',
        explanation: 'after_question',
        responseDistribution: 'after_question',
      },
      join: {
        identity: 'safe_alias',
        allowLateJoin: false,
        lateJoinPolicy: 'lobby_only',
        lateJoinUntilQuestion: 0,
        lockLobbyOnStart: true,
        maxPlayers: 100,
      },
      presentation: {
        themeId: 'focus_dark',
        motion: 'smooth',
        lobbyMusic: 'off',
        questionMusic: 'off',
        soundEffects: 'on',
      },
      responsiveTeaching: {
        hingeRecommendations: false,
        confidencePolicy: 'off',
        peerInstructionAvailable: false,
        firstVoteDistribution: 'teacher_private',
        misconceptionMap: false,
        reasoningCapture: 'none',
        confusionSignal: false,
        quickPrompt: false,
        discussionEnabled: false,
        discussionDefaultSeconds: 60,
        showPreviousOnRevote: false,
      },
    },
  },
  [CAST_PRESETS.MINOR_SAFE]: {
    id: CAST_PRESETS.MINOR_SAFE,
    version: 1,
    labelKey: 'preset.minorSafe',
    recommended: false,
    // C4-06: child-safe — chat/DM off, open text host_review_first,
    // safe_alias identity, moderated wall, anonim reyting.
    // Governance-service bu fieldlarni server'da majburiy qiladi
    // (overrides bilan chetlab o'tib bo'lmaydi).
    defaults: {
      pace: CAST_PACE.INSTRUCTOR,
      playback: {
        advanceMode: CAST_ADVANCE_MODE.HOST_CONTROLLED,
        closeTrigger: [CAST_CLOSE_TRIGGER.HOST_OR_SOFT_TIMEOUT],
        thinkSeconds: 5,
        minimumOpenSeconds: 3,
      },
      timer: { mode: CAST_TIMER_MODE.SOFT, defaultSeconds: 30, allowHostExtend: true, maxExtensionsPerQuestion: 2 },
      scoring: {
        mode: CAST_SCORING_MODE.NO_POINTS,
        version: 'score_v2',
        correctBase: 1000,
        speedBonusMax: 0,
        wrongPoints: 0,
        tieBreak: 'same_rank_then_stable_display',
        partialCredit: false,
        multiplier: 1,
        scorePolicy: 'first_only',
      },
      leaderboard: {
        visibility: CAST_LB_VISIBILITY.OFF_DURING_LEARNING,
        finalVisibility: CAST_LB_VISIBILITY.TOP_N,
        topN: 5,
        frequency: CAST_LB_FREQUENCY.END_ONLY,
        anonymizeLowRanks: true,
        showExactScore: false,
      },
      feedback: {
        correctness: 'after_question',
        correctAnswer: 'teacher_controlled',
        explanation: 'teacher_controlled',
        responseDistribution: 'teacher_controlled',
      },
      join: {
        identity: 'safe_alias',
        allowLateJoin: true,
        lateJoinPolicy: 'next_question',
        lateJoinUntilQuestion: 2,
        lockLobbyOnStart: true,
        maxPlayers: 60,
      },
      moderation: {
        publicChat: false,
        directMessages: false,
        openTextVisibility: 'host_review_first',
        questionWall: 'moderated',
        publicIdentity: 'safe_alias',
      },
      presentation: {
        themeId: 'focus_dark',
        motion: 'reduced',
        lobbyMusic: 'off',
        questionMusic: 'off',
        soundEffects: 'off',
      },
      responsiveTeaching: {
        hingeRecommendations: true,
        confidencePolicy: 'strategic_items',
        peerInstructionAvailable: true,
        firstVoteDistribution: 'teacher_private',
        misconceptionMap: true,
        reasoningCapture: 'selected_items',
        confusionSignal: true,
        quickPrompt: true,
        discussionEnabled: true,
        discussionDefaultSeconds: 45,
        showPreviousOnRevote: true,
      },
    },
  },

  [CAST_PRESETS.FORMATIVE_CHECK]: {
    id: CAST_PRESETS.FORMATIVE_CHECK,
    version: 1,
    labelKey: 'preset.formativeCheck',
    recommended: false,
    defaults: {
      pace: CAST_PACE.INSTRUCTOR,
      playback: {
        advanceMode: CAST_ADVANCE_MODE.HOST_CONTROLLED,
        closeTrigger: [CAST_CLOSE_TRIGGER.HOST_ONLY],
        thinkSeconds: 5,
        minimumOpenSeconds: 3,
      },
      timer: { mode: CAST_TIMER_MODE.OFF, defaultSeconds: 30, allowHostExtend: true, maxExtensionsPerQuestion: 0 },
      scoring: {
        mode: CAST_SCORING_MODE.NO_POINTS,
        version: 'score_v2',
        correctBase: 1000,
        speedBonusMax: 0,
        wrongPoints: 0,
        tieBreak: 'same_rank_then_stable_display',
        partialCredit: false,
        multiplier: 1,
        scorePolicy: 'first_only',
      },
      leaderboard: {
        visibility: CAST_LB_VISIBILITY.OFF_DURING_LEARNING,
        finalVisibility: CAST_LB_VISIBILITY.TOP_N,
        topN: 5,
        frequency: CAST_LB_FREQUENCY.END_ONLY,
        anonymizeLowRanks: true,
        showExactScore: false,
      },
      feedback: {
        correctness: 'after_question',
        correctAnswer: 'teacher_controlled',
        explanation: 'after_question',
        responseDistribution: 'teacher_controlled',
      },
      join: {
        identity: 'safe_alias',
        allowLateJoin: true,
        lateJoinPolicy: 'until_question',
        lateJoinUntilQuestion: 3,
        lockLobbyOnStart: true,
        maxPlayers: 100,
      },
      presentation: {
        themeId: 'focus_dark',
        motion: 'reduced',
        lobbyMusic: 'off',
        questionMusic: 'off',
        soundEffects: 'off',
      },
      responsiveTeaching: {
        hingeRecommendations: true,
        confidencePolicy: 'strategic_items',
        peerInstructionAvailable: true,
        firstVoteDistribution: 'teacher_private',
        misconceptionMap: true,
        reasoningCapture: 'all_items',
        confusionSignal: true,
        quickPrompt: true,
        discussionEnabled: true,
        discussionDefaultSeconds: 60,
        showPreviousOnRevote: true,
      },
    },
  },
};

/** Default preset — Responsive Accuracy */
export const DEFAULT_PRESET_ID = CAST_PRESETS.RESPONSIVE_ACCURACY;

/**
 * Snapshot-required sections that presets may omit.
 * Server-authoritative defaults (mirror config-schema defaults) —
 * resolvePreset natijasi doim to'liq snapshot shaklida bo'ladi.
 */
const SECTION_FILL = {
  // C4-08 (item 6): maxSpeedWeight — governance locked field (institution policy
  // clamp qiladi). Preset'larda yo'q bo'lsa ham snapshot to'liq bo'ladi.
  scoring: {
    maxSpeedWeight: 0.2,
  },
  teams: {
    enabled: false,
    mode: 'individual_then_aggregate',
    assignment: 'random',
    count: 4,
    scoreAggregation: 'normalized_average',
    // C4-01: team talk phase + reporter rotation defaults
    talkEnabled: true,
    talkSeconds: 60,
    reporterRotation: true,
    tiePolicy: 'first_answered',
  },
  moderation: {
    publicChat: false,
    directMessages: false,
    openTextVisibility: 'host_review_first',
    questionWall: 'moderated',
    publicIdentity: 'safe_alias',
  },
  accessibility: {
    showQuestionOnDevice: true,
    highContrastAvailable: true,
    reducedMotionDefault: true,
    audioHasVisualEquivalent: true,
    keyboardDirector: true,
    screenReaderStatus: true,
    // C4-04 (item 18): default theme
    defaultTheme: 'focus_dark',
    // C4-04 (item 20): accommodation hook (per-session overridable)
    accommodation: { longTimeMs: 0, noTimer: false },
  },
  participation: {
    delivery: 'in_room',
    paperCardMode: false,
    // C4-03 (item 1): P3 flag default on (institution policy o'chirishi mumkin)
    cardScanP3: true,
  },
  localization: {
    locale: 'uz-Latn',
    rtl: false,
  },
  dataLifecycle: {
    policyId: 'institution_default_v1',
    retentionClass: 'standard',
  },
  resilience: {
    reconnectGraceMs: 120000,
    hostDisconnectGraceMs: 60000,
    // C4-02 Hybrid / low-bandwidth
    networkTelemetry: true,
    lowBandwidth: {
      enabled: false,
      decorativeEventsOff: true,
      maxMediaKb: 120,
    },
  },
  postCast: {
    actionPack: true,
    eventReplay: true,
    studentPrivateRecap: true,
    teacherReflection: true,
  },
  recording: {
    enabled: false,
    modality: 'none',
    retentionClass: 'camera_mic',
  },
  media: {
    lazyLoadThemes: true,
    externalImages: 'block',
    maxDimensionPx: 1920,
  },
  ai: {
    cohostMode: 'off',
    mayExecuteLiveActions: false,
    teacherApprovalRequired: true,
  },
  // C3-09 Class Goal + Personal Progress
  personalProgress: {
    visibility: 'private',
  },
  // C3-16 Self-Paced Race
  selfPaced: {
    enabled: false,
    perQuestionSeconds: 60,
    randomizeOrder: true,
    lateJoinStart: 'first',
    lateJoinPosition: 0,
    rankVisibility: 'private',
    publicLiveRank: false,
    fairnessWindowSeconds: 30,
  },
  // C3-17 Power-ups — default OFF (item 1); allowedTypes teacher belgilaydi
  powerUps: {
    enabled: false,
    allowedTypes: [],
    startingInventory: {},
    extraTimeSeconds: 15,
    teamConsistent: true,
  },
  classGoal: {
    enabled: false,
    type: 'accuracy_threshold',
    target: 80,
  },
  // C5-05 (item 7): perf/payload feature flags — safeNextPrefetch default OFF (opt-in)
  perf: {
    safeNextPrefetch: false,
    timerUpdateMs: 1000,
    answerCountCoalesceMs: 120,
  },
};

/** Preset diff generator: {fieldPath: {from, to}} */
export function diffPreset(baseConfig, resolvedConfig) {
  const diff = {};
  const walk = (base, resolved, prefix = '') => {
    for (const key of Object.keys(resolved || {})) {
      const path = prefix ? `${prefix}.${key}` : key;
      const b = base ? base[key] : undefined;
      const r = resolved[key];
      if (r && typeof r === 'object' && !Array.isArray(r)) {
        walk(b, r, path);
      } else if (JSON.stringify(b) !== JSON.stringify(r)) {
        diff[path] = { from: b, to: r };
      }
    }
  };
  walk(baseConfig, resolvedConfig);
  return diff;
}

/**
 * Resolve preset + overrides → full snapshot-shaped config.
 * Institution governance locklar keyin (governance-service) qayta qo'llanadi.
 *
 * @param {string} presetId
 * @param {object} overrides — partial config
 * @returns {{ config: object, customized: boolean, diff: object }}
 */
export function resolvePreset(presetId, overrides = {}) {
  const preset = PRESET_REGISTRY[presetId];
  if (!preset) {
    const err = new Error(`Unknown preset: ${presetId}`);
    err.code = 'UNKNOWN_PRESET';
    throw err;
  }

  const base = preset.defaults;
  const merged = {};
  const customize = (target, over, prefix = '') => {
    for (const [key, value] of Object.entries(over || {})) {
      const path = prefix ? `${prefix}.${key}` : key;
      const baseVal = target[key];
      if (value && typeof value === 'object' && !Array.isArray(value) && baseVal && typeof baseVal === 'object') {
        target[key] = { ...baseVal };
        customize(target[key], value, path);
      } else {
        target[key] = value;
      }
    }
  };

  for (const [key, value] of Object.entries(base)) {
    merged[key] = value && typeof value === 'object' && !Array.isArray(value) ? { ...value } : value;
  }
  customize(merged, overrides);

  // customized diff must be computed BEFORE filling snapshot-only sections,
  // otherwise injected defaults (teams, moderation, …) look like customizations
  const diff = diffPreset(base, merged);
  const customized = Object.keys(diff).length > 0;

  // Fill snapshot-required sections missing from this preset.
  // Review fix (C3-16): override'da key mavjud bo'lsa ham — fill'dagi
  // yetishmayotgan field'lar to'ldiriladi (masalan selfPaced override'da
  // enabled/rankVisibility ko'rsatilmasa — strict snapshot fail bo'lardi).
  for (const [key, fill] of Object.entries(SECTION_FILL)) {
    if (!merged[key]) {
      merged[key] = { ...fill };
    } else if (fill && typeof fill === 'object' && merged[key] && typeof merged[key] === 'object') {
      for (const [fk, fv] of Object.entries(fill)) {
        if (merged[key][fk] === undefined) merged[key][fk] = fv;
      }
    }
  }

  // C4-02 (item 4): hybrid'da speed bonus default 0 — remote va in-room
  // participantlar o'rtasida adolatsizlik bo'lmasligi uchun (network kechikishi
  // speed ballga ta'sir qilmaydi). Teacher override qilsa — warning path'da
  // HYBRID_SPEED_WARNING ko'rsatiladi (item 5).
  if (merged.participation?.delivery === 'hybrid' && merged.scoring?.speedBonusMax) {
    merged.scoring.speedBonusMax = 0;
  }

  return {
    preset,
    config: merged,
    customized,
    diff,
  };
}
