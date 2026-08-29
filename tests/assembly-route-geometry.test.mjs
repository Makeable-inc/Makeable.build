import assert from "node:assert/strict";
import test from "node:test";

import {
  assertRouteAvoidsKeepouts,
  assertRouteHasNoLoops,
  assertRouteInsideBounds,
  buildNormalAlignedHarnessRoute,
} from "../lib/assembly-route-geometry.mjs";

const base = {
  source: { position: [-0.01438, 0.005, 0.003875], normal: [0, 0, -1] },
  target: { position: [0.01598, 0.0015, 0.01585], normal: [-1, 0, 0] },
  lane: 1,
  bowDirection: "right",
  bowHeightMm: 5,
  cableLengthMm: 150,
};

test("the XIAO sleeve exits downward and the Qwiic cable approaches through the side entry", () => {
  const route = buildNormalAlignedHarnessRoute(base);
  assert.ok(route.sourceWireExit[2] < route.sourceTip[2]);
  assert.ok(route.targetWireExit[0] < route.targetMouth[0]);
  assert.deepEqual(route.sourceTangent, [0, 0, -1]);
  assert.deepEqual(route.targetApproach, [1, 0, 0]);
  assert.ok(route.routedLengthMm > 0);
  assert.equal(route.version, "normal-aligned-no-loop-harness-v2");
  assert.equal(route.loopCount, 0);
  assert.equal(route.selfIntersectionCount, 0);
  assert.equal(route.curves.length, 2);
  assert.ok(route.unusedSlackMm > 0);
  assert.equal(assertRouteHasNoLoops(route), route);
});

test("a cable shorter than the locked route fails closed", () => {
  assert.throws(() => buildNormalAlignedHarnessRoute({ ...base, cableLengthMm: 10 }), /Cable is too short/);
});

test("sampled routes fail when they enter the USB keepout", () => {
  const route = buildNormalAlignedHarnessRoute(base);
  assert.throws(() => assertRouteAvoidsKeepouts(route, [{
    id: "usb-c",
    bounds: { min: [-0.020, -0.010, -0.010], max: [0.010, 0.012, 0.020] },
  }]), /Route enters keepout usb-c/);
});

test("a distant keepout passes", () => {
  const route = buildNormalAlignedHarnessRoute(base);
  assert.equal(assertRouteAvoidsKeepouts(route, [{
    id: "distant",
    bounds: { min: [1, 1, 1], max: [2, 2, 2] },
  }]), route);
});

test("the locked XIAO route remains an open bow without a service coil", () => {
  const route = buildNormalAlignedHarnessRoute({
    ...base,
    source: { position: [-0.01438, 0.005, 0.017875], normal: [0, 0, -1] },
    target: { position: [0.01598, 0.0015, 0.01185], normal: [-1, 0, 0] },
    sourceSleeveLengthMm: 12,
  });
  assert.equal(route.routingStyle, "single-open-bow");
  assert.equal(route.loopCount, 0);
  assert.equal(route.curves.length, 2);
  assert.equal(assertRouteInsideBounds(route, {
    min: [-0.0313, -0.0253, 0.0022],
    max: [0.0313, 0.0253, 0.032],
  }), route);
});

test("a route marked with a closed coil fails deterministically", () => {
  const route = buildNormalAlignedHarnessRoute(base);
  assert.throws(() => assertRouteHasNoLoops({ ...route, loopCount: 1 }), /forbidden cable loop/);
});
