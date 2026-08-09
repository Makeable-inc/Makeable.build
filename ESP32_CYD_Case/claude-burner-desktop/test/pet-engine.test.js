'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  STATE_VERSION,
  EMOTIONS,
  createInitialState,
  applyDecay,
  applyUsageSnapshot,
  applyManualLife,
  setPlan,
  toTimestamp,
  simulatedLifeForUsage,
  simulatedStateForUsage,
  progressionForUsage,
  emotionForSpark,
  stateKeyFor,
} = require('../src/pet-engine');

const START = Date.parse('2026-08-03T12:00:00.000Z');
const HOUR = 60 * 60 * 1000;

test('Claude epoch reset strings are parsed as seconds', () => {
  assert.equal(toTimestamp('1785823200'), 1785823200000);
  assert.equal(toTimestamp('1785823200000'), 1785823200000);
});

test('simulation converts plan usage into LIFE without exceeding 100', () => {
  assert.equal(simulatedLifeForUsage('pro', null, 50), 25);
  assert.equal(simulatedLifeForUsage('max5', 5, 20), 50);
  assert.equal(simulatedLifeForUsage('max20', 20, 1), 10);
  assert.equal(simulatedLifeForUsage('max20', 20, 10), 100);
  assert.equal(simulatedLifeForUsage('max20', 20, 100), 100);
});

test('simulation derives SPARK independently from plan-normalized usage', () => {
  const simulated = simulatedStateForUsage(stateAt(0, 1, 'max20'), 3, START + HOUR);
  assert.equal(simulated.life, 30);
  assert.equal(simulated.spark, 60);
  assert.equal(simulated.emotion, 'excited');
  assert.equal(simulated.stateKey, 'small_excited');
});

test('Max 20x usage is normalized to the same progress as equivalent Pro work', () => {
  const pro = progressionForUsage('pro', null, 40);
  const max20 = progressionForUsage('max20', 20, 2);
  assert.equal(pro.proEquivalentUsagePct, 40);
  assert.equal(max20.proEquivalentUsagePct, 40);
  assert.equal(pro.projectedLife, 20);
  assert.equal(max20.projectedLife, 20);
  assert.equal(max20.lifePerRawUsagePct, 10);

  const proEvolution = applyUsageSnapshot(stateAt(0, 1, 'pro'), {
    plan: 'pro', fiveHourUsedPct: 72, resetsAt: START + 5 * HOUR,
    capturedAt: START + HOUR, stale: false,
  });
  const maxEvolution = applyUsageSnapshot(stateAt(0, 1, 'max20'), {
    plan: 'max20', maxMultiplier: 20, fiveHourUsedPct: 3.6,
    resetsAt: START + 5 * HOUR, capturedAt: START + HOUR, stale: false,
  });
  assert.equal(proEvolution.life, 36);
  assert.equal(maxEvolution.life, 36);
  assert.equal(proEvolution.spark, 72);
  assert.equal(maxEvolution.spark, 72);
  assert.equal(proEvolution.bondXP, 72);
  assert.equal(maxEvolution.bondXP, 72);
  assert.equal(proEvolution.level, 2);
  assert.equal(maxEvolution.level, 2);
  assert.equal(proEvolution.stateKey, 'medium_excited');
  assert.equal(maxEvolution.stateKey, 'medium_excited');
});

function stateAt(life, level = 1, plan = 'pro') {
  return createInitialState(START, { life, level, plan });
}

test('version 3 state migrates to v4 without losing persistent progress', () => {
  const migrated = createInitialState(START + HOUR, {
    version: 3,
    life: 70,
    highestLife: 86,
    level: 3,
    plan: 'max20',
    maxMultiplier: 20,
    lastActivityAt: START,
    lastCalculatedAt: START + 0.5 * HOUR,
    maxObservedUsage: 3,
    maxObservedProEquivalentUsage: 60,
    windowResetsAt: START + 5 * HOUR,
    windowLifeAwarded: 35,
    unlockedStates: ['not_a_real_state'],
  });

  assert.equal(migrated.version, STATE_VERSION);
  assert.equal(migrated.life, 70);
  assert.equal(migrated.highestLife, 86);
  assert.equal(migrated.level, 3);
  assert.equal(migrated.plan, 'max20');
  assert.equal(migrated.spark, 60);
  assert.equal(migrated.bondXP, 0);
  assert.equal(migrated.lastSparkCalculatedAt, new Date(START + 0.5 * HOUR).toISOString());
  assert.equal(migrated.stateKey, 'large_excited');
  assert.deepEqual(migrated.unlockedStates, ['large_excited']);
});

test('explicit v4 spark, bond, and unlock history survive reload', () => {
  const restored = createInitialState(START + HOUR, {
    version: 4,
    life: 40,
    highestLife: 80,
    level: 2,
    spark: 6,
    bondXP: 912.5,
    unlockedStates: ['small_moody', 'large_explosion', 'invalid'],
    lastActivityAt: START,
    lastCalculatedAt: START,
    lastSparkCalculatedAt: START + 0.25 * HOUR,
    plan: 'pro',
  });
  assert.equal(restored.spark, 6);
  assert.equal(restored.bondXP, 912.5);
  assert.equal(restored.stateKey, 'medium_hopeful');
  assert.deepEqual(restored.unlockedStates, [
    'small_moody',
    'large_explosion',
    'medium_hopeful',
  ]);
});

test('LIFE has the approved hysteretic form boundaries', () => {
  assert.equal(applyManualLife(stateAt(69, 3), 65, START).level, 3);
  assert.equal(applyManualLife(stateAt(69, 3), 64.999, START).level, 2);
  assert.equal(applyManualLife(stateAt(36, 2), 32, START).level, 2);
  assert.equal(applyManualLife(stateAt(36, 2), 31.999, START).level, 1);
  assert.equal(applyManualLife(stateAt(35, 1), 36, START).level, 2);
  assert.equal(applyManualLife(stateAt(68, 2), 69, START).level, 3);
});

test('spark maps to the five approved emotions at exact thresholds', () => {
  const cases = [
    [0, 'moody'], [4, 'moody'], [4.999, 'moody'],
    [5, 'hopeful'], [19, 'hopeful'], [19.999, 'hopeful'],
    [20, 'cheerful'], [44, 'cheerful'], [44.999, 'cheerful'],
    [45, 'excited'], [79, 'excited'], [79.999, 'excited'],
    [80, 'explosion'], [99, 'explosion'], [100, 'explosion'],
  ];
  for (const [spark, emotion] of cases) {
    assert.equal(emotionForSpark(spark), emotion, `emotion at ${spark} spark`);
  }
});

test('all 15 size and emotion combinations have stable state keys', () => {
  const keys = new Set();
  for (const level of [1, 2, 3]) {
    for (const emotion of EMOTIONS) keys.add(stateKeyFor(level, emotion));
  }
  assert.equal(keys.size, 15);
  assert.deepEqual([...keys], [
    'small_moody', 'small_hopeful', 'small_cheerful', 'small_excited', 'small_explosion',
    'medium_moody', 'medium_hopeful', 'medium_cheerful', 'medium_excited', 'medium_explosion',
    'large_moody', 'large_hopeful', 'large_cheerful', 'large_excited', 'large_explosion',
  ]);
});

test('Pro, Max 5x, and Max 20x gains are exact', () => {
  for (const [plan, used, expectedLife, expectedSpark, expectedBond, expectedEmotion] of [
    ['pro', 10, 5, 10, 10, 'hopeful'],
    ['max5', 10, 25, 50, 50, 'excited'],
    ['max20', 10, 100, 100, 200, 'explosion'],
  ]) {
    const result = applyUsageSnapshot(stateAt(0, 1, plan), {
      plan,
      fiveHourUsedPct: used,
      resetsAt: START + 5 * HOUR,
      capturedAt: START + HOUR,
      stale: false,
    });
    assert.equal(result.life, expectedLife, `${plan} life`);
    assert.equal(result.spark, expectedSpark, `${plan} spark`);
    assert.equal(result.bondXP, expectedBond, `${plan} bond XP`);
    assert.equal(result.emotion, expectedEmotion, `${plan} emotion`);
  }
});

test('concurrent snapshots award only the highest observed percentage per reset window', () => {
  const reset = START + 5 * HOUR;
  let state = stateAt(0, 1, 'pro');
  for (const [used, hour] of [[20, 1], [12, 1.1], [25, 1.2], [25, 1.3], [24, 1.4]]) {
    state = applyUsageSnapshot(state, {
      plan: 'pro', fiveHourUsedPct: used, resetsAt: reset,
      capturedAt: START + hour * HOUR, stale: false,
    });
  }
  assert.equal(state.life, 12.5);
  assert.equal(state.spark, 25);
  assert.equal(state.bondXP, 25);
  assert.equal(state.maxObservedUsage, 25);
  assert.equal(state.windowLifeAwarded, 12.5);
});

test('minute-rounded active probes cannot reset awards for the same window', () => {
  const reset = START + 5 * HOUR;
  let state = applyUsageSnapshot(stateAt(0, 1, 'max20'), {
    fiveHourUsedPct: 5, resetsAt: reset,
    capturedAt: START + HOUR, stale: false,
  });
  assert.equal(state.life, 50);
  assert.equal(state.spark, 100);
  assert.equal(state.bondXP, 100);
  state = applyUsageSnapshot(state, {
    fiveHourUsedPct: 5, resetsAt: reset + 59_000,
    capturedAt: START + HOUR + 60_000, stale: false,
  });
  assert.equal(state.life, 50);
  assert.equal(state.spark, 100);
  assert.equal(state.bondXP, 100);
  assert.equal(state.windowLifeAwarded, 50);
  assert.equal(state.maxObservedUsage, 5);
});

test('telemetry cannot downgrade a persisted Max plan', () => {
  const state = applyUsageSnapshot(stateAt(0, 1, 'max20'), {
    plan: 'pro', maxMultiplier: null, fiveHourUsedPct: 1,
    resetsAt: START + 5 * HOUR, capturedAt: START + HOUR, stale: false,
  });
  assert.equal(state.plan, 'max20');
  assert.equal(state.maxMultiplier, 20);
  assert.equal(state.life, 10);
  assert.equal(state.spark, 20);
  assert.equal(state.bondXP, 20);
});

test('new windows reset deduplication and each window is capped at 100 life earned', () => {
  let state = stateAt(0, 1, 'max20');
  state = applyUsageSnapshot(state, {
    plan: 'max20', fiveHourUsedPct: 100, resetsAt: START + 5 * HOUR,
    capturedAt: START + HOUR, stale: false,
  });
  assert.equal(state.life, 100);
  assert.equal(state.spark, 100);
  assert.equal(state.bondXP, 2000);
  assert.equal(state.windowLifeAwarded, 100);

  state = applyManualLife(state, 0, START + 5 * HOUR);
  state = applyUsageSnapshot(state, {
    plan: 'max20', fiveHourUsedPct: 5, resetsAt: START + 10 * HOUR,
    capturedAt: START + 6 * HOUR, stale: false,
  });
  assert.equal(state.life, 50);
  assert.equal(state.spark, 100);
  assert.equal(state.bondXP, 2100);
  assert.equal(state.windowLifeAwarded, 50);
});

test('a late snapshot from an older reset window cannot award life', () => {
  let state = applyUsageSnapshot(stateAt(0, 1, 'pro'), {
    plan: 'pro', fiveHourUsedPct: 30, resetsAt: START + 10 * HOUR,
    capturedAt: START + 6 * HOUR, stale: false,
  });
  state = applyUsageSnapshot(state, {
    plan: 'pro', fiveHourUsedPct: 100, resetsAt: START + 5 * HOUR,
    capturedAt: START + 7 * HOUR, stale: false,
  });
  assert.equal(state.life, 15);
  assert.ok(Math.abs(state.spark - 25.652173913043477) < 1e-9);
  assert.equal(state.bondXP, 30);
  assert.equal(state.maxObservedUsage, 30);
});

test('re-reading a still-fresh snapshot never moves the decay watermark backward', () => {
  const reset = START + 24 * HOUR;
  let state = applyDecay(stateAt(100, 3, 'pro'), START + 20 * HOUR);
  const watermark = state.lastCalculatedAt;
  state = applyUsageSnapshot(state, {
    plan: 'pro', fiveHourUsedPct: 5, resetsAt: reset,
    capturedAt: START + 19 * HOUR, stale: false,
  });
  assert.equal(state.lastCalculatedAt, watermark);
  assert.equal(state.lastActivityAt, new Date(START + 19 * HOUR).toISOString());
  const once = applyDecay(state, START + 21 * HOUR);
  const twice = applyDecay(applyUsageSnapshot(once, {
    plan: 'pro', fiveHourUsedPct: 0, resetsAt: reset,
    capturedAt: START + 19 * HOUR, stale: false,
  }), START + 21 * HOUR);
  assert.equal(twice.life, once.life);
});

test('plan changes apply only to future raw usage deltas', () => {
  let state = applyUsageSnapshot(stateAt(10, 1, 'pro'), {
    plan: 'pro', fiveHourUsedPct: 10, resetsAt: START + 5 * HOUR,
    capturedAt: START + HOUR, stale: false,
  });
  assert.equal(state.life, 15);
  assert.equal(state.maxObservedProEquivalentUsage, 10);
  state = setPlan(state, 'max', 20);
  state = applyUsageSnapshot(state, {
    fiveHourUsedPct: 10, resetsAt: START + 5 * HOUR,
    capturedAt: START + 1.1 * HOUR, stale: false,
  });
  assert.equal(state.life, 15);
  assert.equal(state.bondXP, 10);
  state = applyUsageSnapshot(state, {
    fiveHourUsedPct: 11, resetsAt: START + 5 * HOUR,
    capturedAt: START + 1.2 * HOUR, stale: false,
  });
  assert.equal(state.life, 25);
  assert.equal(state.bondXP, 30);
  state = setPlan(state, 'pro');
  state = applyUsageSnapshot(state, {
    fiveHourUsedPct: 11, resetsAt: START + 5 * HOUR,
    capturedAt: START + 1.3 * HOUR, stale: false,
  });
  assert.equal(state.life, 25);
  assert.equal(state.bondXP, 30);
  state = applyUsageSnapshot(state, {
    fiveHourUsedPct: 13, resetsAt: START + 5 * HOUR,
    capturedAt: START + 1.4 * HOUR, stale: false,
  });
  assert.equal(state.life, 26);
  // A plan downgrade changes future charging only; it does not erase recent
  // activity energy that has not yet decayed.
  assert.equal(state.spark, 100);
  assert.equal(state.bondXP, 32);
});

test('free mode never claims token-derived growth', () => {
  const result = applyUsageSnapshot(stateAt(12, 1, 'free'), {
    plan: 'free', fiveHourUsedPct: 90, resetsAt: START + 5 * HOUR,
    capturedAt: START + HOUR, stale: false,
  });
  assert.equal(result.life, 12);
  assert.equal(result.lastActivityAt, new Date(START).toISOString());
  assert.equal(result.maxObservedUsage, 0);
  assert.equal(result.maxObservedProEquivalentUsage, 0);
  assert.equal(result.bondXP, 0);
});

test('an implausibly distant reset cannot open a phantom award window', () => {
  const ordinaryReset = START + 5 * HOUR;
  let state = applyUsageSnapshot(stateAt(0, 1, 'max20'), {
    fiveHourUsedPct: 5,
    resetsAt: ordinaryReset,
    capturedAt: START + HOUR,
    stale: false,
  });
  assert.equal(state.life, 50);
  state = applyUsageSnapshot(state, {
    fiveHourUsedPct: 5,
    resetsAt: START + 25 * HOUR,
    capturedAt: START + 2 * HOUR,
    stale: false,
  });
  assert.equal(state.life, 50);
  assert.equal(state.windowResetsAt, new Date(ordinaryReset).toISOString());
});

test('two-hour grace then linear 58-hour LIFE decay reaches zero at 60 hours', () => {
  const full = stateAt(100, 3, 'pro');
  const samples = [
    [0, 100, 3],
    [2, 100, 3],
    [11, 84.48275862068965, 3],
    [17, 74.13793103448276, 3],
    [23, 63.793103448275865, 2],
    [35, 43.10344827586207, 2],
    [42, 31.034482758620697, 1],
    [48, 20.689655172413794, 1],
    [55, 8.620689655172413, 1],
    [60, 0, 1],
  ];
  for (const [hour, expectedLife, level] of samples) {
    const result = applyDecay(full, START + hour * HOUR);
    assert.ok(Math.abs(result.life - expectedLife) < 1e-9, `life at ${hour}h`);
    assert.equal(result.level, level, `level at ${hour}h`);
  }
});

test('spark has a 30-minute grace then reaches zero at 12 hours', () => {
  const full = createInitialState(START, { life: 100, level: 3, spark: 100, plan: 'pro' });
  const samples = [
    [0, 100, 'explosion'],
    [0.5, 100, 'explosion'],
    [2.8, 80, 'explosion'],
    [2.81, 79.91304347826087, 'excited'],
    [6, 52.17391304347826, 'excited'],
    [9, 26.086956521739125, 'cheerful'],
    [11, 8.695652173913047, 'hopeful'],
    [11.5, 4.347826086956516, 'moody'],
    [12, 0, 'moody'],
  ];
  for (const [hour, expectedSpark, emotion] of samples) {
    const result = applyDecay(full, START + hour * HOUR);
    assert.ok(Math.abs(result.spark - expectedSpark) < 1e-9, `spark at ${hour}h`);
    assert.equal(result.emotion, emotion, `emotion at ${hour}h`);
  }
});

test('decay is incremental across restarts and backwards clocks never duplicate loss', () => {
  let state = applyDecay(stateAt(100, 3, 'pro'), START + 30 * HOUR);
  const at30 = state.life;
  const sparkAt30 = state.spark;
  state = applyDecay(state, START + 20 * HOUR);
  assert.equal(state.life, at30);
  assert.equal(state.spark, sparkAt30);
  assert.equal(state.lastCalculatedAt, new Date(START + 30 * HOUR).toISOString());
  assert.equal(state.lastSparkCalculatedAt, new Date(START + 30 * HOUR).toISOString());
  state = applyDecay(state, START + 40 * HOUR);
  assert.ok(Math.abs(state.life - (100 - (38 * 100 / 58))) < 1e-9);
  assert.equal(state.spark, 0);
});

test('highest LIFE, bond, and unlocked state history persist through decay', () => {
  let state = applyManualLife(stateAt(0, 1, 'pro'), 86, START);
  assert.equal(state.highestLife, 86);
  assert.equal(state.stateKey, 'large_explosion');
  assert.ok(state.unlockedStates.includes('large_explosion'));
  state = applyDecay(state, START + 60 * HOUR);
  assert.equal(state.life, 0);
  assert.equal(state.emotion, 'moody');
  assert.equal(state.stateKey, 'small_moody');
  assert.equal(state.highestLife, 86);
  assert.equal(state.bondXP, 0);
  assert.ok(state.unlockedStates.includes('large_explosion'));
  assert.ok(state.unlockedStates.includes('small_moody'));
});

test('new activity applies outstanding decay before adding earned life', () => {
  const result = applyUsageSnapshot(stateAt(100, 3, 'pro'), {
    plan: 'pro', fiveHourUsedPct: 10, resetsAt: START + 25 * HOUR,
    capturedAt: START + 22 * HOUR, stale: false,
  });
  assert.ok(Math.abs(result.life - (100 - 20 * 100 / 58 + 5)) < 1e-9);
  assert.equal(result.spark, 10);
  assert.equal(result.emotion, 'hopeful');
  assert.equal(result.bondXP, 10);
  assert.equal(result.lastActivityAt, new Date(START + 22 * HOUR).toISOString());
});
