'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createInitialState,
  applyDecay,
  applyUsageSnapshot,
  applyManualLife,
  setPlan,
  toTimestamp,
  simulatedLifeForUsage,
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

function stateAt(life, level = 1, plan = 'pro') {
  return createInitialState(START, { life, level, plan });
}

test('emotion and hysteretic form boundaries match the approved table', () => {
  const cases = [
    [0, 1, 'dormant'], [1, 1, 'exhausted'], [7, 1, 'exhausted'],
    [8, 1, 'sad_puppy'], [19, 1, 'sad_puppy'], [20, 1, 'curious_hopeful'],
    [31, 1, 'curious_hopeful'], [32, 1, 'curious_hopeful'], [35, 1, 'curious_hopeful'],
    [36, 2, 'worried_gloomy'], [43, 2, 'worried_gloomy'], [44, 2, 'neutral_attentive'],
    [54, 2, 'neutral_attentive'], [55, 2, 'energized'], [64, 2, 'energized'],
    [65, 2, 'energized'], [68, 2, 'energized'], [69, 3, 'tired_concerned'],
    [74, 3, 'tired_concerned'], [75, 3, 'happy_confident'], [84, 3, 'happy_confident'],
    [85, 3, 'supercharged'], [99, 3, 'supercharged'], [100, 3, 'supercharged'],
  ];
  for (const [life, level, emotion] of cases) {
    const next = applyManualLife(stateAt(Math.max(0, life - 1), level), life, START);
    assert.equal(next.level, level, `level at ${life}`);
    assert.equal(next.emotion, emotion, `emotion at ${life}`);
  }

  assert.equal(applyManualLife(stateAt(69, 3), 65, START).level, 3);
  assert.equal(applyManualLife(stateAt(69, 3), 64.999, START).level, 2);
  assert.equal(applyManualLife(stateAt(36, 2), 32, START).level, 2);
  assert.equal(applyManualLife(stateAt(36, 2), 31.999, START).level, 1);
});

test('Pro, Max 5x, and Max 20x gains are exact', () => {
  for (const [plan, used, expected] of [
    ['pro', 10, 5], ['max5', 10, 25], ['max20', 10, 100],
  ]) {
    const result = applyUsageSnapshot(stateAt(0, 1, plan), {
      plan,
      fiveHourUsedPct: used,
      resetsAt: START + 5 * HOUR,
      capturedAt: START + HOUR,
      stale: false,
    });
    assert.equal(result.life, expected, plan);
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
  assert.equal(state.maxObservedUsage, 25);
  assert.equal(state.windowLifeAwarded, 12.5);
});

test('new windows reset deduplication and each window is capped at 100 life earned', () => {
  let state = stateAt(0, 1, 'max20');
  state = applyUsageSnapshot(state, {
    plan: 'max20', fiveHourUsedPct: 100, resetsAt: START + 5 * HOUR,
    capturedAt: START + HOUR, stale: false,
  });
  assert.equal(state.life, 100);
  assert.equal(state.windowLifeAwarded, 100);

  state = applyManualLife(state, 0, START + 5 * HOUR);
  state = applyUsageSnapshot(state, {
    plan: 'max20', fiveHourUsedPct: 5, resetsAt: START + 10 * HOUR,
    capturedAt: START + 6 * HOUR, stale: false,
  });
  assert.equal(state.life, 50);
  assert.equal(state.windowLifeAwarded, 50);
});

test('a late snapshot from an older reset window cannot award life', () => {
  let state = applyUsageSnapshot(stateAt(0, 1, 'pro'), {
    plan: 'pro', fiveHourUsedPct: 30, resetsAt: START + 10 * HOUR,
    capturedAt: START + HOUR, stale: false,
  });
  state = applyUsageSnapshot(state, {
    plan: 'pro', fiveHourUsedPct: 100, resetsAt: START + 5 * HOUR,
    capturedAt: START + 2 * HOUR, stale: false,
  });
  assert.equal(state.life, 15);
  assert.equal(state.maxObservedUsage, 30);
});

test('re-reading a still-fresh snapshot never moves the decay watermark backward', () => {
  const reset = START + 30 * HOUR;
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

test('plan changes preserve LIFE and affect future gain only', () => {
  let state = applyUsageSnapshot(stateAt(10, 1, 'pro'), {
    plan: 'pro', fiveHourUsedPct: 10, resetsAt: START + 5 * HOUR,
    capturedAt: START + HOUR, stale: false,
  });
  assert.equal(state.life, 15);
  state = setPlan(state, 'max', 5);
  state = applyUsageSnapshot(state, {
    fiveHourUsedPct: 12, resetsAt: START + 5 * HOUR,
    capturedAt: START + 1.1 * HOUR, stale: false,
  });
  assert.equal(state.life, 20);
});

test('free mode never claims token-derived growth', () => {
  const result = applyUsageSnapshot(stateAt(12, 1, 'free'), {
    plan: 'free', fiveHourUsedPct: 90, resetsAt: START + 5 * HOUR,
    capturedAt: START + HOUR, stale: false,
  });
  assert.equal(result.life, 12);
  assert.equal(result.lastActivityAt, new Date(START).toISOString());
});

test('two-hour grace then linear 58-hour decay reaches dormant at 60 hours', () => {
  const full = stateAt(100, 3, 'pro');
  const samples = [
    [0, 100, 3, 'supercharged'],
    [2, 100, 3, 'supercharged'],
    [11, 84.48275862068965, 3, 'happy_confident'],
    [17, 74.13793103448276, 3, 'tired_concerned'],
    [23, 63.793103448275865, 2, 'energized'],
    [35, 43.10344827586207, 2, 'worried_gloomy'],
    [42, 31.034482758620697, 1, 'curious_hopeful'],
    [48, 20.689655172413794, 1, 'curious_hopeful'],
    [55, 8.620689655172413, 1, 'sad_puppy'],
    [60, 0, 1, 'dormant'],
  ];
  for (const [hour, expectedLife, level, emotion] of samples) {
    const result = applyDecay(full, START + hour * HOUR);
    assert.ok(Math.abs(result.life - expectedLife) < 1e-9, `life at ${hour}h`);
    assert.equal(result.level, level, `level at ${hour}h`);
    assert.equal(result.emotion, emotion, `emotion at ${hour}h`);
  }
});

test('decay is incremental across restarts and backwards clocks never duplicate loss', () => {
  let state = applyDecay(stateAt(100, 3, 'pro'), START + 30 * HOUR);
  const at30 = state.life;
  state = applyDecay(state, START + 20 * HOUR);
  assert.equal(state.life, at30);
  assert.equal(state.lastCalculatedAt, new Date(START + 30 * HOUR).toISOString());
  state = applyDecay(state, START + 40 * HOUR);
  assert.ok(Math.abs(state.life - (100 - (38 * 100 / 58))) < 1e-9);
});

test('new activity applies outstanding decay before adding earned life', () => {
  const result = applyUsageSnapshot(stateAt(100, 3, 'pro'), {
    plan: 'pro', fiveHourUsedPct: 10, resetsAt: START + 25 * HOUR,
    capturedAt: START + 22 * HOUR, stale: false,
  });
  assert.ok(Math.abs(result.life - (100 - 20 * 100 / 58 + 5)) < 1e-9);
  assert.equal(result.lastActivityAt, new Date(START + 22 * HOUR).toISOString());
});
