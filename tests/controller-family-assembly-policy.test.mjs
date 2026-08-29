import assert from "node:assert/strict";
import test from "node:test";

import {
  controllerFamilyFor,
  validateControllerFamilyAssembly,
} from "../lib/controller-family-assembly-policy.mjs";

const aws = { url: "https://dvy6bet209exg.cloudfront.net/x.glb", sha256: "a".repeat(64) };
const readyCarrier = (assetId) => ({
  assetId,
  state: "ready",
  selectionStatus: "ready",
  interfaceEligibility: "ready",
  awsGlb: aws,
});

const restrictedContracts = {
  B0DD3ZB5XV: {
    mountContract: { socketRows: 2, pinsPerRow: 8, orientation: "usb_c_toward_power_block" },
    powerContract: { controllerPowerSource: "controller_usb_c", peripheralVoltage: "3.3V", externalCarrierPowerConnected: false, batteryConnected: false, railModified: false },
  },
  B0BVVGNBB3: {
    mountContract: { socketRows: 2, pinsPerRow: 22, orientation: "usb_c_aligned_with_carrier_arrow" },
    powerContract: { controllerPowerSource: "controller_usb_c", peripheralVoltage: "3.3V", externalCarrierPowerConnected: false, dcBarrelConnected: false, fiveVoltPeripheralRailUsed: false },
  },
};

test("recognizes the exact three supported controller families", () => {
  assert.equal(controllerFamilyFor({ asin: "B0DRNSV5CS" }), "xiao");
  assert.equal(controllerFamilyFor({ asin: "B0DD3ZB5XV" }), "c3SuperMini");
  assert.equal(controllerFamilyFor({ asin: "B0BVVGNBB3" }), "esp32S3Devkit44");
});

test("XIAO carrier allows only its actual Grove quick connector", () => {
  const carrier = readyCarrier("seeed-xiao-expansion-base-103030356");
  const pass = validateControllerFamilyAssembly({
    controller: { asin: "B0DRNSV5CS" }, sensorCount: 3, carrier,
    connections: [{ controllerTermination: "grove_2.0mm_4p_i2c", controllerConnectorFamily: "grove_2.0mm_4p_i2c", quickConnector: true }],
  });
  assert.equal(pass.state, "ready");
  const fail = validateControllerFamilyAssembly({
    controller: { asin: "B0DRNSV5CS" }, sensorCount: 3, carrier,
    connections: [{ controllerTermination: "grove_2.0mm_4p_i2c", controllerConnectorFamily: "jst_sh_1.0mm_4p_qwiic", quickConnector: true }],
  });
  assert.match(fail.reason, /quick_connector_not_available/);
});

test("Super Mini and long S3 carriers never inherit XIAO quick connectors", () => {
  for (const [asin, assetId] of [
    ["B0DD3ZB5XV", "aitrip-esp32-c3-supermini-expansion-board-b0fbgfwfb1"],
    ["B0BVVGNBB3", "aitrip-esp32-s3-44pin-expansion-board-b0h336qrxx"],
  ]) {
    const result = validateControllerFamilyAssembly({
      controller: { asin }, sensorCount: 3, carrier: readyCarrier(assetId),
      connections: [{ controllerTermination: "verified_male_breakout_pin", controllerConnectorFamily: "jst_sh_1.0mm_4p_qwiic", quickConnector: true }],
      ...restrictedContracts[asin],
    });
    assert.match(result.reason, /quick_connector_not_available/);
  }
});

test("C3 and S3 carriers require exact mount and restricted power contracts", () => {
  for (const [asin, assetId] of [
    ["B0DD3ZB5XV", "aitrip-esp32-c3-supermini-expansion-board-b0fbgfwfb1"],
    ["B0BVVGNBB3", "aitrip-esp32-s3-44pin-expansion-board-b0h336qrxx"],
  ]) {
    const missing = validateControllerFamilyAssembly({
      controller: { asin }, sensorCount: 3, carrier: readyCarrier(assetId),
    });
    assert.match(missing.reason, /carrier_mount_contract_mismatch:missing/);

    const accepted = validateControllerFamilyAssembly({
      controller: { asin }, sensorCount: 3, carrier: readyCarrier(assetId),
      ...restrictedContracts[asin],
    });
    assert.equal(accepted.state, "ready");
    assert.match(accepted.mountContractId, /mount-v1$/);
    assert.match(accepted.powerContractId, /restricted-power-v1$/);
  }
});

test("restricted carrier profiles reject unsafe power and orientation changes", () => {
  const c3 = restrictedContracts.B0DD3ZB5XV;
  const wrongOrientation = validateControllerFamilyAssembly({
    controller: { asin: "B0DD3ZB5XV" }, sensorCount: 3,
    carrier: readyCarrier("aitrip-esp32-c3-supermini-expansion-board-b0fbgfwfb1"),
    ...c3,
    mountContract: { ...c3.mountContract, orientation: "reversed" },
  });
  assert.match(wrongOrientation.reason, /carrier_mount_contract_mismatch:orientation/);

  const unsafePower = validateControllerFamilyAssembly({
    controller: { asin: "B0DD3ZB5XV" }, sensorCount: 3,
    carrier: readyCarrier("aitrip-esp32-c3-supermini-expansion-board-b0fbgfwfb1"),
    ...c3,
    powerContract: { ...c3.powerContract, railModified: true },
  });
  assert.match(unsafePower.reason, /carrier_power_contract_mismatch:railModified/);
});

test("candidate carriers fail closed in production", () => {
  const result = validateControllerFamilyAssembly({
    controller: { asin: "B0DD3ZB5XV" }, sensorCount: 3,
    carrier: {
      assetId: "aitrip-esp32-c3-supermini-expansion-board-b0fbgfwfb1",
      state: "candidate_review",
      selectionStatus: "candidate_review",
      interfaceEligibility: "candidate_review",
      awsGlb: aws,
    },
  });
  assert.match(result.reason, /carrier_not_production_ready/);
});

test("one or two sensors can use individual direct female sockets", () => {
  for (const asin of ["B0DRNSV5CS", "B0DD3ZB5XV", "B0BVVGNBB3"]) {
    const result = validateControllerFamilyAssembly({
      controller: { asin }, sensorCount: 2,
      connections: [{ controllerTermination: "individual_factory_housed_female_socket", controllerConnectorFamily: "2.54mm_male_header" }],
    });
    assert.equal(result.state, "ready");
  }
});
