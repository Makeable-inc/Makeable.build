import test from "node:test";
import assert from "node:assert/strict";

import {
  DIRECT_WIRE_CONNECTIONS,
  DIRECT_WIRE_PARTS,
  DIRECT_WIRE_POLICY,
  assertDirectWireContract,
} from "../lib/environment-monitor-direct-wire-contract.mjs";

test("C3 environment monitor has eleven individual direct-wire connections", () => {
  assert.deepEqual(assertDirectWireContract(), { partCount: 5, wireCount: 11, stepCount: 7 });
  assert.equal(DIRECT_WIRE_CONNECTIONS.filter((wire) => wire.to.part === "microphone").length, 3);
  assert.equal(DIRECT_WIRE_CONNECTIONS.some((wire) => wire.to.pin === "DO"), false);
  assert.equal(DIRECT_WIRE_POLICY.quickConnectorsAllowed, false);
  assert.equal(DIRECT_WIRE_PARTS.find((part) => part.id === "carrier")?.selectionStatus, "ready");
  assert.equal(DIRECT_WIRE_POLICY.carrierMountContract.orientation, "usb_c_toward_power_block");
  assert.equal(DIRECT_WIRE_POLICY.carrierPowerContract.peripheralVoltage, "3.3V");
});
