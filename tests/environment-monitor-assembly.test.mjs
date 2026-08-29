import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  ENVIRONMENT_MONITOR_NETS,
  ENVIRONMENT_MONITOR_PARTS,
  ENVIRONMENT_MONITOR_POLICY,
  assertEnvironmentMonitorContract,
} from "../lib/environment-monitor-assembly-contract.mjs";

test("environment monitor locks three sensors, twelve wires, and no breadboard", () => {
  assert.deepEqual(assertEnvironmentMonitorContract(), {
    partCount: 5,
    sensorCount: 3,
    wireCount: 12,
    addresses: ["0x58", "0x44", "0x5A"],
  });
  assert.equal(ENVIRONMENT_MONITOR_POLICY.breadboardAllowed, false);
});

test("every production part resolves to a content-addressed AWS GLB", () => {
  for (const part of ENVIRONMENT_MONITOR_PARTS) {
    assert.match(part.sha256, /^[a-f0-9]{64}$/);
    assert.equal(part.glbUrl, `https://dvy6bet209exg.cloudfront.net/v1/approved-visual-catalog-v1/objects/sha256/${part.sha256}.glb`);
  }
});

test("wire colors and ESP32-C3 I2C pin contract remain explicit", () => {
  assert.deepEqual(
    ENVIRONMENT_MONITOR_NETS.map(({ label, controllerPin }) => [label, controllerPin]),
    [["GND", "GND"], ["3V3", "3V3"], ["SDA", "GPIO8"], ["SCL", "GPIO9"]],
  );
});

test("interactive review models the complete tube-wire path", async () => {
  const html = await readFile("artifacts/environment-monitor-c3/2026-08-28/viewer/index.html", "utf8");
  assert.match(html, /new THREE\.TubeGeometry\(curve,80,\.00058,12,false\)/);
  assert.match(html, /takeoff-comb-split-arch-landing/);
  assert.match(html, /wireGroup\.children\.length/);
  assert.match(html, /breadboardCount:0/);
});
