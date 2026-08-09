'use strict';

const STATE_VERSION = 4;
const HOUR_MS = 60 * 60 * 1000;
const GRACE_HOURS = 2;
const DECAY_HOURS = 58;
const SPARK_GRACE_HOURS = 0.5;
const SPARK_DECAY_HOURS = 11.5;
const LIFE_PER_USAGE_PERCENT = 0.5;
const WINDOW_LIFE_CAP = 100;
const RESET_WINDOW_TOLERANCE_MS = 10 * 60 * 1000;
const MAX_RESET_HORIZON_MS = (5 * 60 + 15) * 60 * 1000;
const MAX_PRO_EQUIVALENT_USAGE = 100 * 20;

const PLAN_MULTIPLIERS = Object.freeze({
  free: 0,
  pro: 1,
  max5: 5,
  max20: 20,
});

const EMOTIONS = Object.freeze([
  'moody',
  'hopeful',
  'cheerful',
  'excited',
  'explosion',
]);

const LEVEL_SIZES = Object.freeze({
  1: 'small',
  2: 'medium',
  3: 'large',
});

const VALID_STATE_KEYS = new Set(
  Object.values(LEVEL_SIZES).flatMap((size) => EMOTIONS.map((emotion) => `${size}_${emotion}`)),
);

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function toTimestamp(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') {
    return value < 10_000_000_000 ? value * 1000 : value;
  }
  if (typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value.trim())) {
    const numeric = Number(value);
    return numeric < 10_000_000_000 ? numeric * 1000 : numeric;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toIso(value) {
  const timestamp = toTimestamp(value);
  return timestamp === null ? null : new Date(timestamp).toISOString();
}

function normalizePlan(plan, maxMultiplier = null) {
  const raw = String(plan || '').trim().toLowerCase();
  if (raw === 'pro') return 'pro';
  if (raw === 'free') return 'free';
  if (raw === 'max5' || raw === 'max_5' || raw === 'max 5x') return 'max5';
  if (raw === 'max20' || raw === 'max_20' || raw === 'max 20x') return 'max20';
  if (raw === 'max') return Number(maxMultiplier) === 20 ? 'max20' : 'max5';
  return 'free';
}

function multiplierFor(state) {
  return PLAN_MULTIPLIERS[normalizePlan(state.plan, state.maxMultiplier)] ?? 0;
}

function progressionForUsage(plan, maxMultiplier, usagePct) {
  const normalizedPlan = normalizePlan(plan, maxMultiplier);
  const multiplier = PLAN_MULTIPLIERS[normalizedPlan] ?? 0;
  const rawUsagePct = clamp(Number(usagePct) || 0, 0, 100);
  const proEquivalentUsagePct = rawUsagePct * multiplier;
  return {
    plan: normalizedPlan,
    multiplier,
    rawUsagePct,
    proEquivalentUsagePct,
    lifePerRawUsagePct: LIFE_PER_USAGE_PERCENT * multiplier,
    projectedLife: clamp(LIFE_PER_USAGE_PERCENT * proEquivalentUsagePct, 0, 100),
  };
}

function lifeGainForUsageDelta(plan, maxMultiplier, positiveUsageDelta) {
  const progression = progressionForUsage(plan, maxMultiplier, positiveUsageDelta);
  return LIFE_PER_USAGE_PERCENT * progression.proEquivalentUsagePct;
}

function simulatedLifeForUsage(plan, maxMultiplier, usagePct) {
  return progressionForUsage(plan, maxMultiplier, usagePct).projectedLife;
}

function simulatedStateForUsage(inputState, usagePct, now = Date.now()) {
  const progression = progressionForUsage(
    inputState.plan,
    inputState.maxMultiplier,
    usagePct,
  );
  return applyManualLife(
    inputState,
    progression.projectedLife,
    now,
    clamp(progression.proEquivalentUsagePct, 0, 100),
  );
}

function emotionForSpark(spark) {
  const value = clamp(Number(spark) || 0, 0, 100);
  if (value < 5) return 'moody';
  if (value < 20) return 'hopeful';
  if (value < 45) return 'cheerful';
  if (value < 80) return 'excited';
  return 'explosion';
}

function sizeForLevel(level) {
  const normalizedLevel = clamp(Math.round(Number(level) || 1), 1, 3);
  return LEVEL_SIZES[normalizedLevel];
}

function stateKeyFor(level, emotion) {
  const normalizedEmotion = EMOTIONS.includes(emotion) ? emotion : emotionForSpark(0);
  return `${sizeForLevel(level)}_${normalizedEmotion}`;
}

function sanitizeUnlockedStates(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((key) => VALID_STATE_KEYS.has(key)))];
}

function migratedSpark(options, plan, life) {
  const explicit = Number(options.spark);
  if (Number.isFinite(explicit)) return clamp(explicit, 0, 100);

  const observedEquivalent = Number(options.maxObservedProEquivalentUsage);
  if (Number.isFinite(observedEquivalent) && observedEquivalent > 0) {
    return clamp(observedEquivalent, 0, 100);
  }

  const observedUsage = Number(options.maxObservedUsage);
  if (Number.isFinite(observedUsage) && observedUsage > 0) {
    return clamp(observedUsage * (PLAN_MULTIPLIERS[plan] ?? 0), 0, 100);
  }

  // Version 3 had no independent recent-activity meter. Using its persisted
  // LIFE is the least surprising migration: Ember keeps an equivalent visible
  // mood until the new, faster spark decay takes over.
  return clamp(life, 0, 100);
}

function createInitialState(now = Date.now(), options = {}) {
  const nowIso = toIso(now);
  const plan = normalizePlan(options.plan, options.maxMultiplier);
  const life = clamp(Number(options.life ?? 0), 0, 100);
  const highestLife = clamp(Number(options.highestLife ?? life), 0, 100);
  const spark = migratedSpark(options, plan, life);
  const maxObservedUsage = clamp(Number(options.maxObservedUsage ?? 0), 0, 100);
  const legacyMultiplier = PLAN_MULTIPLIERS[plan] ?? 0;
  const maxObservedProEquivalentUsage = clamp(Number(
    options.maxObservedProEquivalentUsage ?? maxObservedUsage * legacyMultiplier
  ), 0, MAX_PRO_EQUIVALENT_USAGE);
  return finalize({
    version: STATE_VERSION,
    life,
    highestLife,
    spark,
    // Prior schemas did not retain enough information to reconstruct lifetime
    // normalized usage safely (LIFE may have come from demo controls or may
    // already have decayed), so migration starts bond history at zero.
    bondXP: Math.max(0, Number(options.bondXP ?? 0) || 0),
    unlockedStates: sanitizeUnlockedStates(options.unlockedStates),
    level: clamp(Math.round(Number(options.level ?? 1)), 1, 3),
    emotion: emotionForSpark(spark),
    lastActivityAt: toIso(options.lastActivityAt ?? now),
    lastCalculatedAt: toIso(options.lastCalculatedAt ?? now),
    lastSparkCalculatedAt: toIso(
      options.lastSparkCalculatedAt ?? options.lastCalculatedAt ?? now,
    ),
    plan,
    maxMultiplier: plan === 'max20' ? 20 : plan === 'max5' ? 5 : null,
    windowResetsAt: toIso(options.windowResetsAt),
    maxObservedUsage,
    maxObservedProEquivalentUsage,
    windowLifeAwarded: clamp(Number(options.windowLifeAwarded ?? 0), 0, WINDOW_LIFE_CAP),
    lastUsageCapturedAt: toIso(options.lastUsageCapturedAt),
  });
}

function updateLevel(level, life) {
  let next = clamp(Math.round(Number(level) || 1), 1, 3);
  const value = clamp(Number(life) || 0, 0, 100);

  if (next === 1 && value >= 36) next = 2;
  if (next === 2 && value >= 69) next = 3;
  if (next === 3 && value < 65) next = 2;
  if (next === 2 && value < 32) next = 1;
  return next;
}

function emotionFor(levelOrSpark, maybeSpark) {
  return emotionForSpark(maybeSpark === undefined ? levelOrSpark : maybeSpark);
}

function finalize(state) {
  const life = clamp(Number(state.life) || 0, 0, 100);
  const spark = clamp(Number(state.spark) || 0, 0, 100);
  const highestLife = Math.max(clamp(Number(state.highestLife) || 0, 0, 100), life);
  const level = updateLevel(state.level, life);
  const emotion = emotionForSpark(spark);
  const stateKey = stateKeyFor(level, emotion);
  const unlockedStates = sanitizeUnlockedStates(state.unlockedStates);
  if (!unlockedStates.includes(stateKey)) unlockedStates.push(stateKey);
  return {
    ...state,
    version: STATE_VERSION,
    life,
    spark,
    bondXP: Math.max(0, Number(state.bondXP) || 0),
    highestLife,
    level,
    emotion,
    stateKey,
    unlockedStates,
  };
}

function cumulativeDecayHours(lastActivityAt, timestamp, graceHours = GRACE_HOURS) {
  const activity = toTimestamp(lastActivityAt);
  if (activity === null || timestamp === null) return 0;
  const inactiveHours = Math.max(0, (timestamp - activity) / HOUR_MS);
  return Math.max(0, inactiveHours - graceHours);
}

function applyDecay(inputState, now = Date.now()) {
  const state = finalize({ ...inputState });
  const nowMs = toTimestamp(now);
  const calculatedMs = toTimestamp(state.lastCalculatedAt);
  if (nowMs === null) return state;

  const sparkCalculatedMs = toTimestamp(state.lastSparkCalculatedAt);

  let life = state.life;
  let lastCalculatedAt = state.lastCalculatedAt;
  if (calculatedMs === null || nowMs >= calculatedMs) {
    const previousDecayHours = cumulativeDecayHours(state.lastActivityAt, calculatedMs);
    const currentDecayHours = cumulativeDecayHours(state.lastActivityAt, nowMs);
    const newlyChargeableHours = Math.max(0, currentDecayHours - previousDecayHours);
    life = clamp(life - newlyChargeableHours * (100 / DECAY_HOURS), 0, 100);
    lastCalculatedAt = toIso(nowMs);
  }

  let spark = state.spark;
  let lastSparkCalculatedAt = state.lastSparkCalculatedAt;
  if (sparkCalculatedMs === null || nowMs >= sparkCalculatedMs) {
    const previousSparkDecayHours = cumulativeDecayHours(
      state.lastActivityAt,
      sparkCalculatedMs,
      SPARK_GRACE_HOURS,
    );
    const currentSparkDecayHours = cumulativeDecayHours(
      state.lastActivityAt,
      nowMs,
      SPARK_GRACE_HOURS,
    );
    const newlyChargeableSparkHours = Math.max(
      0,
      currentSparkDecayHours - previousSparkDecayHours,
    );
    spark = clamp(
      spark - newlyChargeableSparkHours * (100 / SPARK_DECAY_HOURS),
      0,
      100,
    );
    lastSparkCalculatedAt = toIso(nowMs);
  }

  return finalize({
    ...state,
    life,
    spark,
    lastCalculatedAt,
    lastSparkCalculatedAt,
  });
}

function setPlan(inputState, plan, maxMultiplier = null) {
  const normalized = normalizePlan(plan, maxMultiplier);
  return finalize({
    ...inputState,
    plan: normalized,
    maxMultiplier: normalized === 'max20' ? 20 : normalized === 'max5' ? 5 : null,
  });
}

function applyManualLife(inputState, life, now = Date.now(), spark = life) {
  const state = applyDecay(inputState, now);
  return finalize({
    ...state,
    life: clamp(Number(life) || 0, 0, 100),
    spark: clamp(Number(spark) || 0, 0, 100),
    lastActivityAt: toIso(now),
    lastCalculatedAt: toIso(now),
    lastSparkCalculatedAt: toIso(now),
  });
}

function applyUsageSnapshot(inputState, snapshot) {
  const capturedAt = toTimestamp(snapshot.capturedAt) ?? Date.now();
  let state = applyDecay(inputState, capturedAt);
  if (snapshot.stale) return state;
  if (normalizePlan(state.plan, state.maxMultiplier) === 'free') return state;

  const used = clamp(Number(snapshot.fiveHourUsedPct), 0, 100);
  const incomingReset = toTimestamp(snapshot.resetsAt);
  const currentReset = toTimestamp(state.windowResetsAt);
  if (incomingReset === null
      || incomingReset < capturedAt - 60_000
      || incomingReset > capturedAt + MAX_RESET_HORIZON_MS) {
    // A missing, expired, or implausibly distant reset must never create a
    // phantom window and award the same usage twice.
    return state;
  }
  const sameResetWindow = incomingReset !== null && currentReset !== null
    && Math.abs(incomingReset - currentReset) <= RESET_WINDOW_TOLERANCE_MS;

  if (incomingReset !== null && currentReset !== null
      && incomingReset < currentReset - RESET_WINDOW_TOLERANCE_MS) {
    // Ignore a late snapshot from an older five-hour window.
    return state;
  }

  if (!sameResetWindow && incomingReset !== currentReset) {
    state = {
      ...state,
      windowResetsAt: toIso(incomingReset),
      maxObservedUsage: 0,
      maxObservedProEquivalentUsage: 0,
      windowLifeAwarded: 0,
    };
  } else if (sameResetWindow && incomingReset > currentReset) {
    // Prefer the most precise/later reset representation without resetting
    // usage deduplication when `/usage` rounded the same window to a minute.
    state = { ...state, windowResetsAt: toIso(incomingReset) };
  }

  // Plan selection is managed by auth/onboarding and persisted separately.
  // Telemetry snapshots are intentionally not authoritative here: a delayed
  // Pro writer must never downgrade a user-confirmed Max 20x pet.

  const previousMax = clamp(Number(state.maxObservedUsage) || 0, 0, 100);
  const previousProEquivalent = clamp(
    Number(state.maxObservedProEquivalentUsage) || 0,
    0,
    MAX_PRO_EQUIVALENT_USAGE,
  );
  const observedProEquivalent = used * multiplierFor(state);
  // The raw five-hour percentage is the authoritative per-window watermark.
  // Apply the currently selected plan only to usage that arrived after the
  // previous maximum; switching plans must never re-award an old percentage.
  const positiveUsageDelta = Math.max(0, used - previousMax);
  const positiveProEquivalentDelta = positiveUsageDelta * multiplierFor(state);
  const remainingWindowAward = Math.max(0, WINDOW_LIFE_CAP - state.windowLifeAwarded);
  // Deduplicate on a plan-independent Pro-equivalent watermark. Raw plan
  // percentages are not comparable when someone changes Pro/Max mid-window.
  const calculatedGain = LIFE_PER_USAGE_PERCENT * positiveProEquivalentDelta;
  const lifeGain = Math.min(calculatedGain, remainingWindowAward);
  const normalizedWindowPct = clamp(observedProEquivalent, 0, 100);

  const activityDetected = positiveProEquivalentDelta > 0;
  const existingWatermark = toTimestamp(state.lastCalculatedAt);
  const calculationWatermark = existingWatermark === null ? capturedAt : Math.max(existingWatermark, capturedAt);
  const existingSparkWatermark = toTimestamp(state.lastSparkCalculatedAt);
  const sparkCalculationWatermark = existingSparkWatermark === null
    ? capturedAt
    : Math.max(existingSparkWatermark, capturedAt);
  const existingActivity = toTimestamp(state.lastActivityAt);
  const activityWatermark = existingActivity === null ? capturedAt : Math.max(existingActivity, capturedAt);
  return finalize({
    ...state,
    life: clamp(state.life + lifeGain, 0, 100),
    spark: activityDetected ? Math.max(state.spark, normalizedWindowPct) : state.spark,
    bondXP: state.bondXP + positiveProEquivalentDelta,
    lastActivityAt: activityDetected ? toIso(activityWatermark) : state.lastActivityAt,
    lastCalculatedAt: toIso(calculationWatermark),
    lastSparkCalculatedAt: toIso(sparkCalculationWatermark),
    maxObservedUsage: Math.max(previousMax, used),
    maxObservedProEquivalentUsage: Math.max(previousProEquivalent, observedProEquivalent),
    windowLifeAwarded: clamp(state.windowLifeAwarded + lifeGain, 0, WINDOW_LIFE_CAP),
    lastUsageCapturedAt: toIso(capturedAt),
  });
}

module.exports = {
  STATE_VERSION,
  PLAN_MULTIPLIERS,
  EMOTIONS,
  createInitialState,
  normalizePlan,
  multiplierFor,
  progressionForUsage,
  lifeGainForUsageDelta,
  simulatedLifeForUsage,
  simulatedStateForUsage,
  updateLevel,
  emotionFor,
  emotionForSpark,
  sizeForLevel,
  stateKeyFor,
  applyDecay,
  applyUsageSnapshot,
  applyManualLife,
  setPlan,
  toTimestamp,
  toIso,
};
