import assert from "node:assert/strict";
import test from "node:test";

import {
  XIAO_QWIIC_CABLE,
  XIAO_QWIIC_ASSETS,
  XIAO_QWIIC_CONNECTIONS,
  XIAO_QWIIC_PARTS,
  XIAO_QWIIC_POLICY,
  XIAO_QWIIC_PRODUCT_DESIGN,
  assertXiaoQwiicContract,
} from "../lib/xiao-qwiic-air-monitor-contract.mjs";

test("XIAO CO2 beacon uses the exact no-solder Qwiic cable without a breadboard", () => {
  assert.deepEqual(assertXiaoQwiicContract(), { partCount: 2, wireCount: 4, stepCount: 8 });
  assert.equal(XIAO_QWIIC_CABLE.connectorFamily, "jst_sh_1.0mm_4p_qwiic");
  assert.equal(XIAO_QWIIC_CABLE.requiresSoldering, false);
  assert.equal(XIAO_QWIIC_CABLE.nominalLengthMm, 150);
  assert.equal(XIAO_QWIIC_CABLE.assetId, "adafruit-4397-qwiic-to-female-sockets");
  assert.equal(XIAO_QWIIC_ASSETS.length, 3);
  assert.equal(XIAO_QWIIC_POLICY.breadboardAllowed, false);
  assert.equal(XIAO_QWIIC_POLICY.groveAllowedAsQwiic, false);
  assert.equal(XIAO_QWIIC_POLICY.heroAttempts, 1);
  assert.equal(XIAO_QWIIC_POLICY.visualPasses, 0);
  assert.equal(XIAO_QWIIC_POLICY.cableLoopsAllowed, false);
});

test("electronics placements come from the shared hero and enclosure design contract", () => {
  assert.deepEqual(XIAO_QWIIC_PRODUCT_DESIGN.outerEnvelopeMm, [67, 55, 34.2]);
  assert.deepEqual(XIAO_QWIIC_PARTS[0].assembledPosition, [-0.018, 0.013, 0.028]);
  assert.deepEqual(XIAO_QWIIC_PARTS[1].assembledPosition, [0.016, -0.005, 0.01]);
  assert.equal(XIAO_QWIIC_PRODUCT_DESIGN.runtimeVisualPasses, 0);
});

test("every conductor resolves to a unique real named AWS GLB contact", () => {
  assert.deepEqual(XIAO_QWIIC_CONNECTIONS.map((wire) => wire.signal), ["GND", "3V3", "SDA", "SCL"]);
  assert.ok(XIAO_QWIIC_CONNECTIONS.every((wire) => wire.from.nodeName.startsWith("interface:seeed-xiao-esp32c3:")));
  assert.ok(XIAO_QWIIC_CONNECTIONS.every((wire) => wire.to.nodeName.startsWith("component:CONN4:contact-tip:")));
  assert.ok(XIAO_QWIIC_CONNECTIONS.every((wire) => wire.to.connectorNodeName === "anchor:CONN4_STEMMA_QT"));
  assert.ok(XIAO_QWIIC_CONNECTIONS.every((wire) => wire.from.matingSide === "underside"));
  assert.ok(XIAO_QWIIC_CONNECTIONS.every((wire) => !/usb/i.test(`${wire.from.nodeName} ${wire.to.nodeName}`)));
  assert.equal(new Set(XIAO_QWIIC_CONNECTIONS.flatMap((wire) => [wire.from.nodeName, wire.to.nodeName])).size, 8);
});

test("all electronics are immutable ready AWS GLBs", () => {
  assert.deepEqual(XIAO_QWIIC_PARTS.map((part) => part.selectionStatus), ["ready", "ready"]);
  assert.ok(XIAO_QWIIC_PARTS.every((part) => part.assetUrl.startsWith("https://dvy6bet209exg.cloudfront.net/")));
  assert.ok(XIAO_QWIIC_PARTS.every((part) => /^[a-f0-9]{64}$/.test(part.sha256)));
});
