import assert from "node:assert/strict";
import test from "node:test";

import { createLowProfileRoute } from "../lib/aws-production-assembly.mjs";
import { createPlantCompanionAssemblyContract } from "../lib/plant-companion-assembly-contract.mjs";

test("direct-connect plant contract keeps all models remote and bans breadboards", () => {
  const contract = createPlantCompanionAssemblyContract();
  assert.equal(contract.state, "ready");
  assert.equal(contract.requiredAssets.length, 6);
  assert.equal(contract.parts.length, 6);
  assert.equal(contract.wires.length, 11);
  assert.equal(contract.steps.length, 4);
  assert.ok(contract.requiredAssets.every((asset) => (
    asset.url.startsWith("https://dvy6bet209exg.cloudfront.net/")
      && /^[a-f0-9]{64}$/.test(asset.sha256)
  )));
  assert.deepEqual(
    contract.wires.find((wire) => wire.id === "wire-qwiic-controller-tsl-sda")?.from.position,
    [-0.03405, -0.002455, 0.01955],
  );
  assert.deepEqual(
    contract.wires.find((wire) => wire.id === "wire-soil-aout")?.to.position,
    [0.05454, 0.0358, 0.0207],
  );
  assert.deepEqual(
    [...new Set(contract.wires.map((wire) => wire.signal))].sort(),
    ["3V3", "AOUT", "GND", "SCL", "SDA"],
  );
  assert.equal(contract.policy.id, "no-breadboards-v1");
  assert.ok(contract.requiredAssets.every((asset) => !/breadboard/i.test(asset.id)));
  assert.ok(contract.parts.every((part) => !/breadboard/i.test(`${part.id} ${part.label}`)));
  assert.ok(contract.wires.every((wire) => (
    [wire.from.kind, wire.to.kind].every((kind) => ["verified-part-pin", "verified-keyed-connector-contact"].includes(kind))
  )));
});

test("natural jumper bow preserves locked endpoints and has a bounded single arch", () => {
  const wire = {
    id: "wire-sda-controller",
    from: { position: [-0.01211, 0.00762, 0.023] },
    to: { position: [0.00635, -0.01651, 0.00806] },
  };
  const route = createLowProfileRoute(wire, {
    bowDirection: "left",
    lane: -1,
    bowHeightMm: 5,
  }, 0.00806, 0);

  assert.deepEqual(route[0], wire.from.position);
  assert.deepEqual(route.at(-1), wire.to.position);
  assert.equal(route.length, 13);
  const intermediateZ = route.slice(1, -1).map((point) => point[2]);
  assert.ok(Math.max(...intermediateZ) > wire.from.position[2]);
  assert.ok(Math.max(...intermediateZ) > wire.to.position[2]);
  assert.ok(Math.max(...intermediateZ) <= Math.max(wire.from.position[2], wire.to.position[2]) + 0.0101);
  assert.ok(route[1][2] > wire.from.position[2]);
  assert.ok(route.at(-2)[2] > wire.to.position[2]);
});

test("Sol-selected bow lanes separate flexible leads without changing pins", () => {
  const wire = {
    id: "wire-scl-bme",
    from: { position: [0.01773, 0.0072, 0.024] },
    to: { position: [0.00889, -0.01397, 0.00806] },
  };
  const leftBow = createLowProfileRoute(wire, {
    bowDirection: "left",
    lane: 2,
    bowHeightMm: 4,
  }, 0.00806, 1);
  const rightBow = createLowProfileRoute(wire, {
    bowDirection: "right",
    lane: 2,
    bowHeightMm: 4,
  }, 0.00806, 1);

  assert.deepEqual(leftBow[0], wire.from.position);
  assert.deepEqual(leftBow.at(-1), wire.to.position);
  assert.deepEqual(rightBow[0], wire.from.position);
  assert.deepEqual(rightBow.at(-1), wire.to.position);
  assert.notDeepEqual(leftBow[6], rightBow[6]);
  assert.ok(leftBow.slice(1, -1).every((point) => point[2] >= 0.00806));
  assert.ok(rightBow.slice(1, -1).every((point) => point[2] >= 0.00806));
});
