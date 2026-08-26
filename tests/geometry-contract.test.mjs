import assert from "node:assert/strict";
import test from "node:test";

import { verifiedPartsCatalog } from "../lib/makeable-builds.mjs";
import {
  buildGeometryContract,
  componentGeometryForPart,
  formatIndustrialDesignPromptBlock,
  geometrySummaryForBuild,
  validateGeometryContract,
} from "../lib/geometry-contract.mjs";

test("geometry contract encloses verified components and keepouts", () => {
  const catalog = verifiedPartsCatalog();
  const parts = [
    catalog.find((part) => /XIAO ESP32C3/i.test(part.name)),
    catalog.find((part) => /0\.91-inch.*OLED/i.test(part.name)),
    catalog.find((part) => /VL53L1X/i.test(`${part.name} ${part.subtype}`)),
  ];
  assert.ok(parts.every(Boolean));

  const contract = buildGeometryContract({
    idea: "a desk distance companion with a tiny OLED display",
    parts,
    requestedAffordances: ["front display", "distance sensor window", "USB-C port"],
    now: "2026-08-21T20:00:00.000Z",
  });

  assert.equal(contract.validation.ok, true);
  assert.equal(validateGeometryContract(contract).ok, true);
  assert.ok(contract.enclosure.outer.widthMm > contract.enclosure.inner.widthMm);
  assert.ok(contract.enclosure.outer.depthMm > contract.enclosure.inner.depthMm);
  assert.ok(contract.enclosure.outer.heightMm > contract.enclosure.inner.heightMm);
  assert.ok(contract.enclosure.wallThicknessMm >= 2.0);
  assert.ok(contract.enclosure.wallThicknessMm <= 2.4);
  assert.equal(contract.fdm.movingClearanceMm, 0.5);

  for (const placement of contract.placements) {
    assertAabbContains(contract.enclosure.innerAabb, placement.bodyAabb, `${placement.name} body`);
    assertAabbContains(contract.enclosure.innerAabb, placement.requiredAabb, `${placement.name} keepout`);
  }

  assert.ok(contract.components.every((component) => component.pinOrientation));
  assert.ok(contract.components.every((component) => /^https:\/\//.test(component.sourceUrl)));
  assert.ok(contract.components.every((component) => /\d{4}-\d{2}-\d{2}/.test(component.checkedDate)));
  assert.ok(contract.components.every((component) => ["high", "medium", "low"].includes(component.confidence)));
});

test("display windows are capped to the verified active display area", () => {
  const display = verifiedPartsCatalog().find((part) => /0\.91-inch.*OLED/i.test(part.name));
  assert.ok(display);

  const geometry = componentGeometryForPart(display);
  assert.equal(geometry.verified, true);
  assert.ok(geometry.activeDisplayArea.widthMm > 0);
  assert.ok(geometry.activeDisplayArea.heightMm > 0);

  const contract = buildGeometryContract({
    idea: "a pixel face desk display",
    parts: [display],
    requestedAffordances: ["oversized readable screen"],
  });
  const displayCutout = contract.cutouts.find((cutout) => cutout.type === "display-window");
  assert.ok(displayCutout);
  assert.ok(displayCutout.widthMm <= geometry.activeDisplayArea.widthMm);
  assert.ok(displayCutout.heightMm <= geometry.activeDisplayArea.heightMm);

  const promptBlock = formatIndustrialDesignPromptBlock(contract);
  assert.match(promptBlock, /display window/i);
  assert.match(promptBlock, /capped below active area/i);
  assert.doesNotMatch(promptBlock, /oversized readable screen/i);
});

test("unsupported requested ports and sensors do not enter the prompt block", () => {
  const catalog = verifiedPartsCatalog();
  const parts = [
    catalog.find((part) => /XIAO ESP32C3/i.test(part.name)),
    catalog.find((part) => /0\.91-inch.*OLED/i.test(part.name)),
    {
      id: "fake-hcsr04",
      name: "HC-SR04 ultrasonic transparent dome barrel-jack module",
      category: "sensor",
      subtype: "unsupported",
      url: "https://example.com/unsupported",
      presoldered: true,
    },
  ];
  assert.ok(parts[0] && parts[1]);

  const { contract, promptBlock } = geometrySummaryForBuild({
    idea: "a desk pet with a cat figurine and ultrasonic sensor",
    parts,
    requestedAffordances: [
      "HC-SR04 ultrasonic transducer pair",
      "barrel jack power port",
      "transparent dome",
      "physical cat figurine",
      "front display",
    ],
  });

  assert.equal(contract.validation.ok, true);
  assert.equal(contract.unsupportedAffordanceCount >= 4, true);
  assert.ok(contract.omittedComponents.some((component) => component.partId === "fake-hcsr04"));
  assert.ok(contract.visibleAffordances.every((affordance) => affordance.requiresVerifiedComponent));
  assert.ok(contract.cutouts.every((cutout) => cutout.requiresVerifiedComponent));

  assert.doesNotMatch(promptBlock, /HC-SR04/i);
  assert.doesNotMatch(promptBlock, /ultrasonic transducer/i);
  assert.doesNotMatch(promptBlock, /barrel jack/i);
  assert.doesNotMatch(promptBlock, /transparent dome/i);
  assert.doesNotMatch(promptBlock, /cat figurine/i);
  assert.doesNotMatch(promptBlock, /fake-hcsr04/i);
  assert.match(promptBlock, /front display|display face|display window/i);
  assert.match(promptBlock, /Do not add any exterior feature for unverified or omitted parts/i);
});

test("rear USB and magnetic reed sensing remain hidden in hero guidance", () => {
  const catalog = verifiedPartsCatalog();
  const controller = catalog.find((part) => /XIAO ESP32C3/i.test(part.name));
  const reed = catalog.find((part) => /Reed Sensor|Reed Switch/i.test(part.name));
  assert.ok(controller && reed);

  const { contract, promptBlock } = geometrySummaryForBuild({
    idea: "a quiet door chime",
    parts: [controller, reed],
  });

  assert.ok(!contract.visibleAffordances.some((item) => /usb|magnetic/i.test(item.type)));
  assert.doesNotMatch(promptBlock, /USB-C access aligned/i);
  assert.doesNotMatch(promptBlock, /magnetic-sensing-zone/i);
  assert.match(promptBlock, /service opening must be completely outside the hero camera view/i);
});

test("qualified soil-moisture sensor has a connector-aware geometry profile", () => {
  const sensor = verifiedPartsCatalog().find((part) => part.asin === "B0DYDN9RG4");
  assert.ok(sensor);

  const geometry = componentGeometryForPart(sensor);
  assert.equal(geometry.verified, true);
  assert.equal(geometry.profileId, "diyables-capacitive-soil-moisture-tlc555i");
  assert.equal(geometry.body.widthMm, 23);
  assert.equal(geometry.body.heightMm, 98);
  assert.match(geometry.pinOrientation, /factory-soldered/i);
  assert.ok(geometry.keepouts.some((item) => item.type === "connector-cable-bend"));
  assert.equal(geometry.dimensionSourceUrl, "https://diyables.io/products/capacitive-soil-moisture-sensor-module");
});

function assertAabbContains(container, item, label) {
  assert.ok(item.minX >= container.minX, `${label} minX`);
  assert.ok(item.maxX <= container.maxX, `${label} maxX`);
  assert.ok(item.minY >= container.minY, `${label} minY`);
  assert.ok(item.maxY <= container.maxY, `${label} maxY`);
  assert.ok(item.minZ >= container.minZ, `${label} minZ`);
  assert.ok(item.maxZ <= container.maxZ, `${label} maxZ`);
}
