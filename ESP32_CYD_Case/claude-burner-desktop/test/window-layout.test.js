'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  intersectionArea,
  fitToWorkArea,
  restoreOrFit,
} = require('../src/window-layout');

test('window bounds are centered and capped to the usable display area in DIP', () => {
  assert.deepEqual(fitToWorkArea({ x: 0, y: 25, width: 1512, height: 957 }), {
    x: 206, y: 124, width: 1100, height: 760,
  });
  assert.deepEqual(fitToWorkArea({ x: 0, y: 25, width: 900, height: 650 }), {
    x: 24, y: 49, width: 852, height: 602,
  });
});

test('off-screen saved bounds are rejected while reachable bounds are restored', () => {
  const displays = [{ workArea: { x: 0, y: 25, width: 1512, height: 957 } }];
  const rejected = restoreOrFit({ x: 3000, y: 2000, width: 1100, height: 760 }, displays, displays[0].workArea);
  assert.equal(rejected.restored, false);
  assert.equal(rejected.x, 206);

  const restored = restoreOrFit({ x: 140, y: 80, width: 980, height: 700 }, displays, displays[0].workArea);
  assert.equal(restored.restored, true);
  assert.equal(restored.width, 980);
  assert.equal(restored.height, 700);
  assert.ok(intersectionArea(restored, displays[0].workArea) > 600_000);
});
