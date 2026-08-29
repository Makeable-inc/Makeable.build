import test from "node:test";
import assert from "node:assert/strict";
import { classifyPinMatingSide } from "../lib/pin-mating-side.mjs";

test("classifies BME280 and BH1750 style downward headers as underside", () => {
  const result = classifyPinMatingSide({
    boardBounds: { min: [-0.01, -0.01, -0.001], max: [0.01, 0.01, 0] },
    pinBounds: { min: [-0.001, -0.001, -0.007], max: [0.001, 0.001, -0.001] },
  });
  assert.equal(result.matingSide, "underside");
  assert.deepEqual(result.connectorNormal, [0, 0, -1]);
  assert.equal(result.pinTipCoordinate, -0.007);
  assert.equal(result.undersideExposureM, 0.006);
});

test("classifies microphone style upward headers as top", () => {
  const result = classifyPinMatingSide({
    boardBounds: { min: [-0.01, -0.02, -0.0008], max: [0.01, 0.02, 0.0008] },
    pinBounds: { min: [-0.001, 0.014, -0.0016], max: [0.001, 0.016, 0.01] },
  });
  assert.equal(result.matingSide, "top");
  assert.deepEqual(result.connectorNormal, [0, 0, 1]);
  assert.equal(result.pinTipCoordinate, 0.01);
  assert.ok(result.topExposureM > result.undersideExposureM);
});

test("fails closed when exposed shank lengths are ambiguous", () => {
  assert.throws(() => classifyPinMatingSide({
    boardBounds: { min: [-0.01, -0.01, -0.0008], max: [0.01, 0.01, 0.0008] },
    pinBounds: { min: [-0.001, -0.001, -0.003], max: [0.001, 0.001, 0.003] },
  }), /Ambiguous male-pin mating side/);
});

test("fails closed when no usable male-pin shank is exposed", () => {
  assert.throws(() => classifyPinMatingSide({
    boardBounds: { min: [-0.01, -0.01, -0.001], max: [0.01, 0.01, 0.001] },
    pinBounds: { min: [-0.001, -0.001, -0.0012], max: [0.001, 0.001, 0.0012] },
  }), /No usable exposed male-pin shank/);
});
