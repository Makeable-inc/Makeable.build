'use strict';

const STATE_VERSION = 1;
const HOUR_MS = 60 * 60 * 1000;
const GRACE_HOURS = 2;
const DECAY_HOURS = 58;
const LIFE_PER_USAGE_PERCENT = 0.5;
const WINDOW_LIFE_CAP = 100;

const PLAN_MULTIPLIERS = Object.freeze({
  free: 0,
  pro: 1,
  max5: 5,
  max20: 20,
});

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

function simulatedLifeForUsage(plan, maxMultiplier, usagePct) {
  const normalized = normalizePlan(plan, maxMultiplier);
  const multiplier = PLAN_MULTIPLIERS[normalized] ?? 0;
  const usage = clamp(Number(usagePct) || 0, 0, 100);
  return clamp(LIFE_PER_USAGE_PERCENT * usage * multiplier, 0, 100);
}

function createInitialState(now = Date.now(), options = {}) {
  const nowIso = toIso(now);
  const plan = normalizePlan(options.plan, options.maxMultiplier);
  return finalize({
    version: STATE_VERSION,
    life: clamp(Number(options.life ?? 0), 0, 100),
    level: clamp(Math.round(Number(options.level ?? 1)), 1, 3),
    emotion: 'dormant',
    lastActivityAt: toIso(options.lastActivityAt ?? now),
    lastCalculatedAt: toIso(options.lastCalculatedAt ?? now),
    plan,
    maxMultiplier: plan === 'max20' ? 20 : plan === 'max5' ? 5 : null,
    windowResetsAt: toIso(options.windowResetsAt),
    maxObservedUsage: clamp(Number(options.maxObservedUsage ?? 0), 0, 100),
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

function emotionFor(level, life) {
  const value = clamp(Number(life) || 0, 0, 100);
  if (level === 3) {
    if (value >= 85) return 'supercharged';
    if (value >= 75) return 'happy_confident';
    return 'tired_concerned';
  }
  if (level === 2) {
    if (value >= 55) return 'energized';
    if (value >= 44) return 'neutral_attentive';
    return 'worried_gloomy';
  }
  if (value >= 20) return 'curious_hopeful';
  if (value >= 8) return 'sad_puppy';
  if (value >= 1) return 'exhausted';
  return 'dormant';
}

function finalize(state) {
  const life = clamp(Number(state.life) || 0, 0, 100);
  const level = updateLevel(state.level, life);
  return {
    ...state,
    version: STATE_VERSION,
    life,
    level,
    emotion: emotionFor(level, life),
  };
}

function cumulativeDecayHours(lastActivityAt, timestamp) {
  const activity = toTimestamp(lastActivityAt);
  if (activity === null || timestamp === null) return 0;
  const inactiveHours = Math.max(0, (timestamp - activity) / HOUR_MS);
  return Math.max(0, inactiveHours - GRACE_HOURS);
}

function applyDecay(inputState, now = Date.now()) {
  const state = finalize({ ...inputState });
  const nowMs = toTimestamp(now);
  const calculatedMs = toTimestamp(state.lastCalculatedAt);
  if (nowMs === null) return state;

  // A backward wall-clock jump cannot create decay or move the calculation
  // watermark backward, which would otherwise double-charge time later.
  if (calculatedMs !== null && nowMs < calculatedMs) return state;

  const previousDecayHours = cumulativeDecayHours(state.lastActivityAt, calculatedMs);
  const currentDecayHours = cumulativeDecayHours(state.lastActivityAt, nowMs);
  const newlyChargeableHours = Math.max(0, currentDecayHours - previousDecayHours);
  const lifeLoss = newlyChargeableHours * (100 / DECAY_HOURS);

  return finalize({
    ...state,
    life: clamp(state.life - lifeLoss, 0, 100),
    lastCalculatedAt: toIso(nowMs),
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

function applyManualLife(inputState, life, now = Date.now()) {
  const state = applyDecay(inputState, now);
  return finalize({
    ...state,
    life: clamp(Number(life) || 0, 0, 100),
    lastActivityAt: toIso(now),
    lastCalculatedAt: toIso(now),
  });
}

function applyUsageSnapshot(inputState, snapshot) {
  const capturedAt = toTimestamp(snapshot.capturedAt) ?? Date.now();
  let state = applyDecay(inputState, capturedAt);
  if (snapshot.stale) return state;

  const used = clamp(Number(snapshot.fiveHourUsedPct), 0, 100);
  const incomingReset = toTimestamp(snapshot.resetsAt);
  const currentReset = toTimestamp(state.windowResetsAt);

  if (incomingReset !== null && currentReset !== null && incomingReset < currentReset) {
    // Ignore a late snapshot from an older five-hour window.
    return state;
  }

  if (incomingReset !== currentReset) {
    state = {
      ...state,
      windowResetsAt: toIso(incomingReset),
      maxObservedUsage: 0,
      windowLifeAwarded: 0,
    };
  }

  if (snapshot.plan) {
    state = setPlan(state, snapshot.plan, snapshot.maxMultiplier ?? state.maxMultiplier);
  }

  const previousMax = clamp(Number(state.maxObservedUsage) || 0, 0, 100);
  const positiveUsageDelta = Math.max(0, used - previousMax);
  const remainingWindowAward = Math.max(0, WINDOW_LIFE_CAP - state.windowLifeAwarded);
  const calculatedGain = LIFE_PER_USAGE_PERCENT * positiveUsageDelta * multiplierFor(state);
  const lifeGain = Math.min(calculatedGain, remainingWindowAward);

  const activityDetected = positiveUsageDelta > 0 && state.plan !== 'free';
  const existingWatermark = toTimestamp(state.lastCalculatedAt);
  const calculationWatermark = existingWatermark === null ? capturedAt : Math.max(existingWatermark, capturedAt);
  const existingActivity = toTimestamp(state.lastActivityAt);
  const activityWatermark = existingActivity === null ? capturedAt : Math.max(existingActivity, capturedAt);
  return finalize({
    ...state,
    life: clamp(state.life + lifeGain, 0, 100),
    lastActivityAt: activityDetected ? toIso(activityWatermark) : state.lastActivityAt,
    lastCalculatedAt: toIso(calculationWatermark),
    maxObservedUsage: Math.max(previousMax, used),
    windowLifeAwarded: clamp(state.windowLifeAwarded + lifeGain, 0, WINDOW_LIFE_CAP),
    lastUsageCapturedAt: toIso(capturedAt),
  });
}

module.exports = {
  STATE_VERSION,
  PLAN_MULTIPLIERS,
  createInitialState,
  normalizePlan,
  multiplierFor,
  simulatedLifeForUsage,
  updateLevel,
  emotionFor,
  applyDecay,
  applyUsageSnapshot,
  applyManualLife,
  setPlan,
  toTimestamp,
  toIso,
};
