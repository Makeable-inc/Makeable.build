import assert from "node:assert/strict";
import test from "node:test";

import { planEsp32SensorConnections } from "../lib/esp32-sensor-assembly-policy.mjs";

const controller = {
  id: "esp32-s3-devkitc-1",
  footprintFamily: "esp32S3Devkit44",
  powerRails: [
    { id: "3v3", voltageV: 3.3, maxCurrentMa: 500 },
    { id: "5v", voltageV: 5, maxCurrentMa: 1000 },
  ],
  groundPins: ["GND-1", "GND-2"],
};

const sensor = (id, pin, extra = {}) => ({ id, requiredVoltageV: 3.3, currentMa: 25, signalPins: [pin], ...extra });

test("one sensor uses direct controller pins without a breakout", () => {
  const plan = planEsp32SensorConnections({ controller, sensors: [sensor("temperature", "GPIO4")] });
  assert.equal(plan.state, "ready");
  assert.equal(plan.strategy, "direct-pin-to-pin");
  assert.equal(plan.breakoutRequired, false);
  assert.deepEqual(plan.groundPlan.pins, ["GND-1"]);
});

test("two sensors may share one verified power rail and use separate grounds", () => {
  const plan = planEsp32SensorConnections({
    controller,
    sensors: [sensor("light", "GPIO4"), sensor("motion", "GPIO5")],
  });
  assert.equal(plan.state, "ready");
  assert.equal(plan.powerSharing, true);
  assert.deepEqual(plan.groundPlan, { strategy: "separate-controller-grounds", pins: ["GND-1", "GND-2"] });
});

test("two sensors may share a single ground only with a modeled multi-wire termination", () => {
  const plan = planEsp32SensorConnections({
    controller: { ...controller, groundPins: ["GND-1"] },
    sensors: [sensor("light", "GPIO4"), sensor("motion", "GPIO5")],
  });
  assert.equal(plan.state, "ready");
  assert.equal(plan.groundPlan.strategy, "shared-controller-ground");
  assert.equal(plan.groundPlan.requiresVerifiedMultiWireTermination, true);
});

test("three sensors require the exact controller-footprint expansion board", () => {
  const sensors = [sensor("one", "GPIO4"), sensor("two", "GPIO5"), sensor("three", "GPIO6")];
  assert.match(planEsp32SensorConnections({ controller, sensors }).reason, /exact_breakout_required/);
  const mismatch = planEsp32SensorConnections({
    controller,
    sensors,
    breakout: { footprintFamily: "c3SuperMini", state: "ready", localGlb: { path: "x.glb", sha256: "a".repeat(64) } },
  });
  assert.match(mismatch.reason, /breakout_footprint_mismatch/);
});

test("three sensors accept a hash-bound exact local candidate but do not promote it to production-ready", () => {
  const plan = planEsp32SensorConnections({
    controller,
    sensors: [sensor("one", "GPIO4"), sensor("two", "GPIO5"), sensor("three", "GPIO6")],
    breakout: {
      id: "aitrip-esp32-s3-44pin-gpio-1-to-2-expansion-board",
      footprintFamily: "esp32S3Devkit44",
      state: "candidate_review",
      localGlb: { path: "models/s3.glb", sha256: "a".repeat(64) },
    },
    production: false,
  });
  assert.equal(plan.strategy, "exact-expansion-board");
  assert.equal(plan.state, "candidate_review");
  assert.match(plan.reason, /release_review_and_aws_publication/);
});

test("production rejects the Super Mini and long DevKit carrier candidates", () => {
  const sensors = [sensor("one", "GPIO4"), sensor("two", "GPIO5"), sensor("three", "GPIO6")];
  const plan = planEsp32SensorConnections({
    controller,
    sensors,
    breakout: {
      id: "aitrip-esp32-s3-44pin-gpio-1-to-2-expansion-board",
      footprintFamily: "esp32S3Devkit44",
      state: "candidate_review",
      interfaceEligibility: "candidate_review",
      selectionStatus: "candidate_review",
      awsGlb: { url: "https://dvy6bet209exg.cloudfront.net/x.glb", sha256: "a".repeat(64) },
    },
  });
  assert.match(plan.reason, /breakout_not_production_ready/);
});

test("production accepts the exact S3 carrier only with its locked mount and power contracts", () => {
  const sensors = [sensor("one", "GPIO4"), sensor("two", "GPIO5"), sensor("three", "GPIO6")];
  const breakout = {
    id: "aitrip-esp32-s3-44pin-expansion-board-b0h336qrxx",
    footprintFamily: "esp32S3Devkit44",
    state: "ready",
    interfaceEligibility: "ready",
    selectionStatus: "ready",
    awsGlb: { url: "https://dvy6bet209exg.cloudfront.net/x.glb", sha256: "a".repeat(64) },
    mountContract: { socketRows: 2, pinsPerRow: 22, orientation: "usb_c_aligned_with_carrier_arrow" },
    powerContract: { controllerPowerSource: "controller_usb_c", peripheralVoltage: "3.3V", externalCarrierPowerConnected: false, dcBarrelConnected: false, fiveVoltPeripheralRailUsed: false },
  };
  const ready = planEsp32SensorConnections({ controller, sensors, breakout });
  assert.equal(ready.state, "ready");
  const unsafe = planEsp32SensorConnections({
    controller,
    sensors,
    breakout: { ...breakout, powerContract: { ...breakout.powerContract, fiveVoltPeripheralRailUsed: true } },
  });
  assert.match(unsafe.reason, /controller_family_gate:carrier_power_contract_mismatch/);
});

test("breadboards are rejected regardless of sensor count", () => {
  assert.throws(() => planEsp32SensorConnections({
    controller,
    sensors: [sensor("one", "GPIO4")],
    breakout: { id: "solderless-breadboard" },
  }), /no-breadboards-v1/);
});
