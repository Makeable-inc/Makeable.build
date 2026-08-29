import test from "node:test";
import assert from "node:assert/strict";

import { DIRECT_WIRE_CONNECTIONS } from "../lib/environment-monitor-direct-wire-contract.mjs";
import { C3_DIRECT_WIRE_PIN_ROUTES, assertC3DirectWirePinContract } from "../lib/c3-direct-wire-pin-contract.mjs";

test("every direct-wire route begins on one unique carrier breakout pin", () => {
  assert.deepEqual(assertC3DirectWirePinContract(), { routeCount: 11, uniqueCarrierPins: 11, usbEndpointCount: 0 });
  assert.deepEqual(
    C3_DIRECT_WIRE_PIN_ROUTES.map((route) => route.id).sort(),
    DIRECT_WIRE_CONNECTIONS.map((route) => route.id).sort(),
  );
});

test("power, bus, and analog routes use the intended replicated header rows", () => {
  const byId = new Map(C3_DIRECT_WIRE_PIN_ROUTES.map((route) => [route.id, route]));
  assert.match(byId.get("bme-3v3").sourceNodeName, /right-breakout:3V3:pin:1$/);
  assert.match(byId.get("bh-3v3").sourceNodeName, /right-breakout:3V3:pin:2$/);
  assert.match(byId.get("mic-3v3").sourceNodeName, /right-breakout:3V3:pin:3$/);
  assert.match(byId.get("bme-sda").sourceNodeName, /left-breakout:GPIO8:pin:1$/);
  assert.match(byId.get("bh-scl").sourceNodeName, /left-breakout:GPIO9:pin:2$/);
  assert.match(byId.get("mic-ao").sourceNodeName, /right-breakout:GPIO4:pin:3$/);
});

test("every sensor endpoint supplies geometry for automatic mating-side classification", () => {
  for (const route of C3_DIRECT_WIRE_PIN_ROUTES) {
    assert.equal(route.targetConnectorGender, "male", route.id);
    assert.equal(route.targetMatingSidePolicy, "auto-from-exposed-shank", route.id);
    assert.match(route.targetBoardNodeName, /fiberglass-core|^pcb:/, route.id);
    assert.equal("targetMountSide" in route, false, route.id);
    assert.equal("targetNormal" in route, false, route.id);
    assert.match(route.targetNodeName, /male-pin|:metal$/, route.id);
    assert.doesNotMatch(route.targetNodeName, /anchor|pad|solder|housing/i, route.id);
  }
});
