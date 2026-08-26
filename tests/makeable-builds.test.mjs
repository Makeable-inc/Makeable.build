import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  catalogStats,
  createBuild,
  createBuildImagePrompt,
  createLocalBuildStore,
  getPublicBuild,
  listPublicBuilds,
  verifiedPartsCatalog,
} from "../lib/makeable-builds.mjs";

test("verified parts catalog exposes the full pre-soldered source library", () => {
  const stats = catalogStats();
  const catalog = verifiedPartsCatalog();

  assert.equal(stats.total, 80);
  assert.equal(stats.presolderedVerified, 80);
  assert.equal(catalog.length, 80);
  assert.ok(catalog.every((part) => part.presoldered));
  assert.ok(catalog.filter((part) => part.modelSelectable).every((part) => /^\d{4}-\d{2}-\d{2}$/.test(part.checkedDate)));
  assert.ok(catalog.some((part) => part.name.includes("Seeed Studio XIAO ESP32C3")));
  assert.ok(catalog.some((part) => /VL53L1X/i.test(`${part.name} ${part.subtype}`)));
  assert.ok(catalog.some((part) => /FS90R/i.test(`${part.name} ${part.subtype}`)));
  assert.ok(catalog.some((part) => /2P.*Female-to-Female Dupont/i.test(`${part.name} ${part.subtype}`)));

  const bme280 = catalog.find((part) => /BME280/i.test(part.name));
  const ambientLight = catalog.find((part) => /BH1750/i.test(`${part.name} ${part.subtype}`));
  const xiao = catalog.find((part) => /XIAO ESP32C3/i.test(part.name));
  const buzzer = catalog.find((part) => /Passive Buzzer/i.test(part.name));
  assert.equal(bme280?.category, "sensor");
  assert.equal(ambientLight?.category, "sensor");
  assert.equal(xiao?.category, "controller");
  assert.equal(buzzer?.category, "output");
});

test("planner receives verified cables and the low-power continuous-servo exception", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "makeable-builds-"));
  const store = createLocalBuildStore(path.join(temp, "builds.jsonl"));
  const catalog = verifiedPartsCatalog();
  const controller = catalog.find((part) => /XIAO ESP32C3/i.test(part.name));
  const servo = catalog.find((part) => /FS90R.*with wheels/i.test(part.name));
  const cable = catalog.find((part) => /ZYAMY.*Female-to-Female Dupont/i.test(part.name));
  const touch = catalog.find((part) => /DIYables Touch Sensor Button/i.test(part.name));
  let plannerPayload = {};
  let imagePayload = {};
  assert.ok(controller && servo && cable && touch);

  try {
    const result = await createBuild(
      {
        idea: "a small two-wheel robot car driven by continuous-rotation micro servos and using a 2P female-to-female Dupont cable",
        email: "maker@example.com",
      },
      {
        env: { OPENAI_API_KEY: "test-key" },
        store,
        fetchFn: async (url, options) => {
          if (String(url).endsWith("/v1/responses")) {
            plannerPayload = JSON.parse(String(options?.body || "{}"));
            return new Response(JSON.stringify({
              output_text: JSON.stringify({
                title: "Two-wheel robot car",
                summary: "A compact printed robot car using verified continuous-rotation servos.",
                behavior: "The ESP32 sends PWM direction commands to two FS90R servos while a separate regulated servo supply provides motor power.",
                selectedPartIds: [controller.id, servo.id, touch.id],
                visibleHardwareCues: ["two powered wheels aligned with the selected servos", "a touch control"],
                warnings: [
                  "Confirm the exact three-pin servo mating and external power-distribution path.",
                  "The Dupont cable is not selected and cannot serve as a three-pin servo adapter.",
                ],
              }),
            }), { status: 200, headers: { "Content-Type": "application/json" } });
          }
          assert.match(String(url), /\/v1\/images\/generations$/);
          imagePayload = JSON.parse(String(options?.body || "{}"));
          return new Response(JSON.stringify({ data: [{ b64_json: "aGVsbG8=" }] }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        },
      },
    );

    const developerPrompt = plannerPayload.input?.find((entry) => entry.role === "developer")?.content || "";
    const userPayload = JSON.parse(plannerPayload.input?.find((entry) => entry.role === "user")?.content || "{}");
    assert.match(developerPrompt, /FS90R continuous-rotation micro servo/i);
    assert.match(developerPrompt, /2P female-to-female Dupont cable joins two 2-pin male headers/i);
    assert.ok(userPayload.catalog.some((part) => /FS90R/i.test(part.name)));
    assert.ok(userPayload.catalog.some((part) => /Female-to-Female Dupont/i.test(part.name)));
    assert.ok(result.body.parts.some((part) => /FS90R/i.test(part.name)));
    assert.ok(result.body.parts.some((part) => /Female-to-Female Dupont/i.test(part.name)));
    assert.ok(!result.body.parts.some((part) => /Touch Sensor Button/i.test(part.name)));
    assert.ok(result.body.warnings.some((warning) => /separate regulated 4\.8-6V servo supply/i.test(warning)));
    assert.ok(!result.body.warnings.some((warning) => /Dupont cable is not selected/i.test(warning)));
    assert.ok(result.body.visibleHardwareCues.some((cue) => /wheel clearances and axle openings/i.test(cue)));
    assert.match(imagePayload.prompt, /Use only the selected FS90R continuous-rotation servos/i);
    assert.match(imagePayload.prompt, /exactly two wheels total: one single 60 mm diameter by 8 mm wide tire on the left/i);
    assert.match(imagePayload.prompt, /Never show a dual tire, doubled rim, tandem wheel, caster, hidden third wheel/i);
    assert.match(imagePayload.prompt, /do not invent a gearbox, DC motor, motor driver, battery, extra wheel/i);
    assert.match(imagePayload.prompt, /selected factory-terminated cable assemblies/i);
    assert.match(imagePayload.prompt, /do not turn a 2P cable into a three-pin servo adapter/i);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("deterministic fallback adds an FS90R wheel kit without inventing a two-pin servo adapter", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "makeable-builds-"));
  const store = createLocalBuildStore(path.join(temp, "builds.jsonl"));
  try {
    const result = await createBuild(
      {
        idea: "a two-wheel robot car with continuous rotation servos",
        email: "maker@example.com",
      },
      {
        env: { MAKEABLE_FORCE_BUILD_FALLBACK: "1" },
        store,
      },
    );

    assert.equal(result.status, 201);
    assert.ok(result.body.parts.some((part) => /FS90R/i.test(part.name)));
    assert.ok(!result.body.parts.some((part) => /Female-to-Female Dupont/i.test(part.name)));
    assert.ok(result.body.warnings.some((warning) => /three-pin servo plug/i.test(warning)));
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("deterministic display selection follows the interface instead of defaulting to a tiny OLED", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "makeable-builds-"));
  const store = createLocalBuildStore(path.join(temp, "builds.jsonl"));
  const build = async (idea) => createBuild(
    { idea, email: "maker@example.com" },
    { env: { MAKEABLE_FORCE_BUILD_FALLBACK: "1" }, store },
  );

  try {
    const dashboard = await build("a vertical air quality dashboard with color trends and touch controls");
    assert.ok(dashboard.body.parts.some((part) => /ESP32-C6 1\.47inch IPS Touch Display/i.test(part.name)));
    assert.ok(!dashboard.body.parts.some((part) => /0\.91-inch/i.test(part.name)));
    assert.equal(dashboard.body.parts.filter((part) => part.category === "controller").length, 1);

    const timer = await build("a retro kitchen countdown timer with a 16x2 character LCD");
    assert.ok(timer.body.parts.some((part) => /16x2|LC1602/i.test(`${part.name} ${part.subtype}`)));
    assert.ok(!timer.body.parts.some((part) => /0\.91-inch/i.test(part.name)));

    const companion = await build("a friendly desk companion with a color animated face");
    assert.ok(companion.body.parts.some((part) => part.asin === "B0H2HL5ZQY"));
    assert.ok(!companion.body.parts.some((part) => /0\.91-inch/i.test(part.name)));

    const wearable = await build("a tiny wearable single-line status tag");
    assert.ok(wearable.body.parts.some((part) => /0\.91-inch/i.test(part.name)));

    const lamp = await build("a motion-triggered bedside lamp");
    assert.ok(!lamp.body.parts.some((part) => part.category === "display" || /display|oled|lcd|tft|ips/i.test(`${part.name} ${part.subtype}`)));

    const plant = await build("a compact plant soil moisture monitor placed directly in the soil");
    assert.ok(plant.body.parts.some((part) => /ESP32-C6 1\.47inch IPS Touch Display/i.test(part.name)));
    assert.ok(!plant.body.parts.some((part) => /0\.91-inch/i.test(part.name)));
    assert.ok(plant.body.warnings.some((warning) => /does not currently include a dimension-verified capacitive soil-moisture sensor/i.test(warning)));
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("servo and Dupont geometry is dimension-backed without exposing the internal cable", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "makeable-builds-"));
  const store = createLocalBuildStore(path.join(temp, "builds.jsonl"));
  let savedBuild = null;
  try {
    const result = await createBuild(
      {
        idea: "a compact two-wheel robot car using FS90R servos and a 2P female-to-female Dupont cable",
        email: "maker@example.com",
      },
      {
        env: { MAKEABLE_FORCE_BUILD_FALLBACK: "1" },
        store: {
          async save(build) {
            savedBuild = build;
            return store.save(build);
          },
        },
      },
    );

    assert.equal(result.status, 201);
    const servo = savedBuild.geometryContract.components.find((part) => /FS90R/i.test(part.name));
    const cable = savedBuild.geometryContract.components.find((part) => /Dupont/i.test(part.name));
    assert.equal(servo?.verified, true);
    assert.equal(cable?.verified, true);
    assert.equal(cable?.visiblePolicy, "internal-only");
    assert.ok(savedBuild.geometryContract.visibleAffordances.some((item) => item.type === "paired-drive-wheels"));
    assert.equal(savedBuild.geometryContract.visibleAffordances.some((item) => /Dupont/i.test(item.label)), false);
    assert.ok(savedBuild.geometryContract.cutouts.filter((item) => item.type === "servo-axle-opening").length === 2);
    assert.equal(savedBuild.geometryContract.validation.ok, true);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("build creation stores email privately and returns catalog-backed parts", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "makeable-builds-"));
  const store = createLocalBuildStore(path.join(temp, "builds.jsonl"));
  try {
    const result = await createBuild(
      {
        idea: "a window air monitor that tells me when to open the window",
        email: "maker@example.com",
      },
      {
        env: { MAKEABLE_FORCE_BUILD_FALLBACK: "1" },
        store,
        fetchFn: async () => {
          throw new Error("network should not be used in forced fallback mode");
        },
      },
    );

    assert.equal(result.status, 201);
    assert.equal(result.body.email, undefined);
    assert.equal(result.body.emailPreview, undefined);
    assert.equal(result.body.image.source, "preview_fallback");
    assert.ok(result.body.parts.length >= 2);
    assert.ok(result.body.parts.every((part) => part.url.startsWith("https://")));
    assert.ok(result.body.parts.every((part) => part.presoldered));
    assert.ok(result.body.parts.every((part) => /^\d{4}-\d{2}-\d{2}$/.test(part.checkedDate)));
    assert.equal(result.body.cost.totalParts, result.body.parts.length);
    assert.ok(result.body.cost.estimatedTotalUsd >= result.body.cost.knownSubtotalUsd);
    assert.ok(result.body.parts.every((part) => Number.isFinite(part.unitPriceUsd)));
    assert.ok(result.body.parts.every((part) => ["listing", "planning-estimate"].includes(part.priceSource)));

    const listed = await listPublicBuilds(store);
    assert.equal(listed.length, 1);
    assert.equal(listed[0].email, undefined);
    const fetched = await getPublicBuild(store, result.body.id);
    assert.equal(fetched.title, result.body.title);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("ultrasonic requests do not create a direct HC-SR04 Echo claim", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "makeable-builds-"));
  const store = createLocalBuildStore(path.join(temp, "builds.jsonl"));
  try {
    const result = await createBuild(
      {
        idea: "an ultrasonic HC-SR04 distance notifier for my desk",
        email: "maker@example.com",
      },
      {
        env: { MAKEABLE_FORCE_BUILD_FALLBACK: "1" },
        store,
      },
    );

    assert.equal(result.status, 201);
    assert.ok(result.body.warnings.some((warning) => /does not include a 3\.3V-safe HC-SR04P/i.test(warning)));
    assert.ok(!result.body.parts.some((part) => /hc-?sr04/i.test(part.name)));
    assert.ok(result.body.parts.some((part) => /vl53l1x|tof/i.test(`${part.name} ${part.subtype}`)));
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("environmental fallback keeps one controller and classifies sensing parts as sensors", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "makeable-builds-"));
  const store = createLocalBuildStore(path.join(temp, "builds.jsonl"));
  try {
    const result = await createBuild(
      {
        idea: "a temperature and humidity monitor for my room",
        email: "maker@example.com",
      },
      {
        env: { MAKEABLE_FORCE_BUILD_FALLBACK: "1" },
        store,
      },
    );

    assert.equal(result.status, 201);
    assert.doesNotMatch(result.body.title, /\b(?:and|for|in|of|the|to|with)$/i);
    assert.equal(result.body.parts.filter((part) => part.category === "controller").length, 1);
    assert.ok(result.body.parts.some((part) => /BME280/i.test(part.name) && part.category === "sensor"));
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("intent post-processing keeps one ESP32-safe rotary control", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "makeable-builds-"));
  const store = createLocalBuildStore(path.join(temp, "builds.jsonl"));
  const catalog = verifiedPartsCatalog();
  const controller = catalog.find((part) => /XIAO ESP32C3/i.test(part.name));
  const display = catalog.find((part) => /0\.91-inch.*OLED/i.test(part.name));
  const encoders = catalog.filter((part) => /rotary encoder/i.test(`${part.name} ${part.subtype}`));
  const longBehavior = "Turn and press the knob to set a timer. The display shows the remaining focus or break interval and makes the current mode obvious from across the desk. The onboard status light changes gently between ready, running, paused, and complete states without adding another external module.";
  const modelWarning = "Confirm the exact rotary encoder pinout before wiring the module to the controller.";
  assert.ok(controller && display && encoders.length >= 2);
  assert.ok(longBehavior.length > 220);

  try {
    const result = await createBuild(
      {
        idea: "a quiet desk focus timer with a small OLED display and a rotary knob",
        email: "maker@example.com",
      },
      {
        env: { OPENAI_API_KEY: "test-key" },
        store,
        fetchFn: async (url) => {
          if (String(url).endsWith("/v1/responses")) {
            return new Response(JSON.stringify({
              output_text: JSON.stringify({
                title: "Quiet focus timer",
                summary: "A silent focus timer.",
                behavior: longBehavior,
                selectedPartIds: [controller.id, display.id, encoders[0].id],
                visibleHardwareCues: ["small display", "one rotary knob"],
                warnings: [modelWarning],
              }),
            }), { status: 200, headers: { "Content-Type": "application/json" } });
          }
          return new Response(JSON.stringify({ data: [{ b64_json: "aGVsbG8=" }] }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        },
      },
    );

    assert.equal(result.status, 201);
    assert.equal(result.body.parts.filter((part) => /rotary encoder/i.test(`${part.name} ${part.subtype}`)).length, 1);
    assert.ok(result.body.parts.some((part) => /MTDELE/i.test(part.name)));
    assert.ok(!result.body.parts.some((part) => /SUUOO/i.test(part.name)));
    assert.equal(result.body.behavior, longBehavior);
    assert.ok(result.body.warnings.includes(modelWarning));
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("ESP32-compatible peripherals stay peripherals and fill explicit input/output intent", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "makeable-builds-"));
  const store = createLocalBuildStore(path.join(temp, "builds.jsonl"));
  try {
    const result = await createBuild(
      {
        idea: "a presence desk pet with a touch input, RGB LED status, and pixel display",
        email: "maker@example.com",
      },
      {
        env: { MAKEABLE_FORCE_BUILD_FALLBACK: "1" },
        store,
      },
    );

    assert.equal(result.status, 201);
    assert.equal(result.body.parts.filter((part) => part.category === "controller").length, 1);
    assert.ok(result.body.parts.some((part) => /touch/i.test(`${part.name} ${part.subtype}`)));
    assert.ok(result.body.parts.some((part) => part.category === "output" && /rgb.*led/i.test(part.name)));
    assert.ok(result.body.parts.some((part) => /display|oled|lcd|tft|ips/i.test(`${part.name} ${part.subtype}`)));
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("a planner narrative that uses ToF drops an unmentioned redundant radar sensor", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "makeable-builds-"));
  const store = createLocalBuildStore(path.join(temp, "builds.jsonl"));
  const catalog = verifiedPartsCatalog();
  const controller = catalog.find((part) => /XIAO ESP32S3/i.test(part.name));
  const tof = catalog.find((part) => /VL53L1X/i.test(`${part.name} ${part.subtype}`));
  const radar = catalog.find((part) => /LD2410C/i.test(`${part.name} ${part.subtype}`));
  assert.ok(controller && tof && radar);
  try {
    const result = await createBuild(
      {
        idea: "a desk presence companion",
        email: "maker@example.com",
      },
      {
        env: { OPENAI_API_KEY: "test-key", MAKEABLE_SKIP_IMAGE_GENERATION: "1" },
        store,
        fetchFn: async () => new Response(JSON.stringify({
          output_text: JSON.stringify({
            title: "Desk companion",
            summary: "A ToF-based desk companion.",
            behavior: "The ToF sensor infers whether someone is nearby.",
            selectedPartIds: [controller.id, tof.id, radar.id],
            visibleHardwareCues: ["one sensor opening"],
            warnings: [],
          }),
        }), { status: 200, headers: { "Content-Type": "application/json" } }),
      },
    );

    assert.equal(result.status, 201);
    assert.ok(result.body.parts.some((part) => /VL53L1X/i.test(`${part.name} ${part.subtype}`)));
    assert.ok(!result.body.parts.some((part) => /LD2410C/i.test(`${part.name} ${part.subtype}`)));
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("image prompt stays inside a printable enclosure and avoids literal pets or domes", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "makeable-builds-"));
  const store = createLocalBuildStore(path.join(temp, "builds.jsonl"));
  const catalog = verifiedPartsCatalog();
  const controller = catalog.find((part) => /XIAO ESP32C3/i.test(part.name));
  const display = catalog.find((part) => /0\.91-inch.*OLED/i.test(part.name));
  let imagePayload = {};
  assert.ok(controller && display);
  try {
    const result = await createBuild(
      {
        idea: "a desk pet focus toy with a cute screen face",
        email: "maker@example.com",
      },
      {
        env: { OPENAI_API_KEY: "test-key" },
        store,
        fetchFn: async (url, options) => {
          if (String(url).endsWith("/v1/responses")) {
            return new Response(JSON.stringify({
              output_text: JSON.stringify({
                title: "Desk Pet Focus Toy",
                summary: "A tiny desk companion.",
                behavior: "Watches for presence and changes state on the display.",
                selectedPartIds: [controller.id, display.id],
                visibleHardwareCues: [
                  "transparent glass dome",
                  "physical cat figurine",
                  "small display face",
                  "invented rotary knob",
                  "unsupported touch button",
                  "unsupported RGB LED status light",
                ],
                warnings: [],
              }),
            }), { status: 200, headers: { "Content-Type": "application/json" } });
          }
          if (String(url).endsWith("/v1/images/generations")) {
            imagePayload = JSON.parse(String(options?.body || "{}"));
            return new Response(JSON.stringify({ data: [{ b64_json: "aGVsbG8=" }] }), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            });
          }
          throw new Error(`unexpected request: ${url}`);
        },
      },
    );

    assert.equal(result.status, 201);
    assert.equal(imagePayload.quality, "medium");
    assert.match(imagePayload.prompt, /physically credible project-documentation photograph/i);
    assert.match(imagePayload.prompt, /User intent:/i);
    assert.match(imagePayload.prompt, /without turning every idea into the same box/i);
    assert.match(imagePayload.prompt, /Any unsupported requested feature must become passive, manual, omitted, or visibly simplified/i);
    assert.match(imagePayload.prompt, /no transparent dome/i);
    assert.match(imagePayload.prompt, /no physical mascot/i);
    assert.match(imagePayload.prompt, /only as a simple low-resolution pixel graphic inside the selected display/i);
    assert.match(imagePayload.prompt, /zero screws, zero bolts/i);
    assert.match(imagePayload.prompt, /seamless medium cool-gray sweep/i);
    assert.match(imagePayload.prompt, /No wooden table/i);
    assert.match(imagePayload.prompt, /USB-C cutout belongs on the unseen rear or underside/i);
    assert.match(imagePayload.prompt, /must not be visible anywhere in the final hero photograph/i);
    assert.ok(result.body.visibleHardwareCues.some((cue) => /pixel companion.*selected display/i.test(cue)));
    assert.ok(!result.body.visibleHardwareCues.some((cue) => /\btransparent\b|\bglass\b|\bdome\b|\bfigurine\b|physical cat|\bknob\b|\btouch\b|\brgb\b|\bled\b|\blight\b/i.test(cue)));
    assert.ok(!result.body.parts.some((part) => /rotary encoder/i.test(`${part.name} ${part.subtype}`)));
    assert.ok(!result.body.parts.some((part) => /water level|rain sensor/i.test(`${part.name} ${part.subtype}`)));
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("character cues are removed when the selected build has no display", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "makeable-builds-"));
  const store = createLocalBuildStore(path.join(temp, "builds.jsonl"));
  const catalog = verifiedPartsCatalog();
  const controller = catalog.find((part) => /XIAO ESP32C3/i.test(part.name));
  const touch = catalog.find((part) => /touch sensor/i.test(`${part.name} ${part.subtype}`));
  let imagePrompt = "";
  assert.ok(controller && touch);
  try {
    const result = await createBuild(
      {
        idea: "a single touch button that counts presses",
        email: "maker@example.com",
      },
      {
        env: { OPENAI_API_KEY: "test-key", OPENAI_IMAGE_QUALITY: "low" },
        store,
        fetchFn: async (url, options) => {
          if (String(url).endsWith("/v1/responses")) {
            return new Response(JSON.stringify({
              output_text: JSON.stringify({
                title: "Touch Counter",
                summary: "A compact touch counter.",
                behavior: "Counts presses and sends the value over USB.",
                selectedPartIds: [controller.id, touch.id],
                visibleHardwareCues: ["cute cat mascot face", "one touch pad"],
                warnings: [],
              }),
            }), { status: 200, headers: { "Content-Type": "application/json" } });
          }
          const payload = JSON.parse(String(options?.body || "{}"));
          imagePrompt = payload.prompt;
          assert.equal(payload.quality, "low");
          return new Response(JSON.stringify({ data: [{ b64_json: "aGVsbG8=" }] }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        },
      },
    );

    assert.equal(result.status, 201);
    assert.ok(!result.body.parts.some((part) => part.category === "display"));
    assert.ok(!result.body.visibleHardwareCues.some((cue) => /\bcat\b|\bmascot\b|\bface\b|pixel companion/i.test(cue)));
    assert.match(imagePrompt, /No display is selected/i);
    assert.match(imagePrompt, /do not show any face, character, pet, cat, mascot/i);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("render brief separates retro Macintosh, exposed mechanisms, and translucent prototypes", () => {
  const catalog = verifiedPartsCatalog();
  const controller = catalog.find((part) => /XIAO ESP32S3/i.test(part.name));
  const display = catalog.find((part) => /0\.91-inch.*OLED/i.test(part.name));
  const cable = catalog.find((part) => /Female-to-Female Dupont/i.test(part.name));
  const servo = catalog.find((part) => /FS90R.*with wheels/i.test(part.name));
  assert.ok(controller && display && cable && servo);

  const macintosh = createBuildImagePrompt({
    idea: "a Macintosh-inspired retro desk companion",
    title: "Retro desk companion",
    behavior: "Shows a tiny status on the display.",
    parts: [controller, display],
  });
  assert.match(macintosh.designBrief.archetype, /1984-era compact Macintosh/i);
  assert.match(macintosh.designBrief.formLanguage, /upright one-piece computer posture/i);
  assert.match(macintosh.prompt, /It never means Mac mini, iMac, MacBook/i);

  const mechanism = createBuildImagePrompt({
    idea: "a compact two-wheel rover using FS90R servos",
    title: "Two-wheel rover",
    behavior: "Uses two selected continuous-rotation servos.",
    parts: [controller, servo],
  });
  assert.match(mechanism.designBrief.archetype, /low open-wheel mobile prototype/i);
  assert.match(mechanism.prompt, /exactly two wheels total/i);
  assert.match(mechanism.designBrief.signatureSilhouette, /bow-tie structural chassis/i);
  assert.match(mechanism.prompt, /Silhouette test/i);
  assert.match(mechanism.prompt, /mature small-batch hardware prototype/i);
  assert.match(mechanism.prompt, /Design-rationale gate/i);
  assert.match(mechanism.prompt, /zero screws, zero bolts/i);

  const nonWheeledServo = createBuildImagePrompt({
    idea: "a cat clock pen holder with one continuously waving arm",
    title: "Cat clock pen holder",
    behavior: "One printed arm rotates continuously beside the pen cup.",
    parts: [controller, display, servo],
  });
  assert.match(nonWheeledServo.prompt, /this project is not wheeled/i);
  assert.match(nonWheeledServo.prompt, /omit every wheel/i);
  assert.doesNotMatch(nonWheeledServo.geometryContract.visibleAffordances.map((item) => item.label).join(" "), /two verified .* wheels/i);

  const translucent = createBuildImagePrompt({
    idea: "a handheld status tag with a translucent back so the electronics are visible",
    title: "Visible electronics tag",
    behavior: "Shows status on the selected display.",
    parts: [controller, display, cable],
  });
  assert.match(translucent.designBrief.visibilityStrategy, /translucent PETG service panel/i);
  assert.match(translucent.prompt, /reveals only exact selected dimension-verified parts/i);
  assert.match(translucent.prompt, /never a dome or decorative bubble/i);
});

test("plant renders use one compact soil stake and fail closed without a verified sensor", () => {
  const catalog = verifiedPartsCatalog();
  const displayController = catalog.find((part) => /ESP32-C6 1\.47inch IPS Touch Display/i.test(part.name));
  assert.ok(displayController);

  const plant = createBuildImagePrompt({
    idea: "a compact plant soil moisture monitor placed directly in the soil",
    title: "Plant soil monitor",
    behavior: "Shows plant status on the selected display.",
    parts: [displayController],
  });

  assert.match(plant.prompt, /Plant\/soil fail-closed contract/i);
  assert.match(plant.prompt, /one compact above-soil environmental stake/i);
  assert.match(plant.prompt, /do not show a sensing blade, separate probe, external cable/i);
  assert.match(plant.prompt, /seamless medium cool-gray sweep/i);
  assert.match(plant.designBrief.signatureSilhouette, /compact upright above-soil environmental stake/i);
  assert.doesNotMatch(plant.designBrief.signatureSilhouette, /leaf-like arch/i);
});

test("Netlify AI Gateway routing is honored without a direct-OpenAI service tier", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "makeable-builds-"));
  const store = createLocalBuildStore(path.join(temp, "builds.jsonl"));
  const catalog = verifiedPartsCatalog();
  const controller = catalog.find((part) => /XIAO ESP32C3/i.test(part.name));
  const display = catalog.find((part) => /0\.91-inch.*OLED/i.test(part.name));
  const requests = [];
  assert.ok(controller && display);

  try {
    const result = await createBuild(
      {
        idea: "a compact desk status display",
        email: "maker@example.com",
      },
      {
        env: {
          OPENAI_API_KEY: "gateway-issued-test-token",
          OPENAI_BASE_URL: "https://makeable.example/.netlify/ai/openai/",
          OPENAI_BUILD_SERVICE_TIER: "priority",
        },
        store,
        fetchFn: async (url, options) => {
          requests.push({ url: String(url), body: JSON.parse(String(options?.body || "{}")) });
          if (String(url).endsWith("/v1/responses")) {
            return new Response(JSON.stringify({
              output_text: JSON.stringify({
                title: "Desk Status Display",
                summary: "A compact status display.",
                behavior: "Shows one simple status icon on the selected display.",
                selectedPartIds: [controller.id, display.id],
                visibleHardwareCues: ["one flush display opening"],
                warnings: [],
              }),
            }), { status: 200, headers: { "Content-Type": "application/json" } });
          }
          return new Response(JSON.stringify({ data: [{ b64_json: "aGVsbG8=" }] }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        },
      },
    );

    assert.equal(result.status, 201);
    assert.deepEqual(requests.map((request) => request.url), [
      "https://makeable.example/.netlify/ai/openai/v1/responses",
      "https://makeable.example/.netlify/ai/openai/v1/images/generations",
    ]);
    assert.equal(Object.hasOwn(requests[0].body, "service_tier"), false);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("image generation failure is surfaced after exactly one expensive request", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "makeable-builds-"));
  const store = createLocalBuildStore(path.join(temp, "builds.jsonl"));
  const catalog = verifiedPartsCatalog();
  const controller = catalog.find((part) => /XIAO ESP32C3/i.test(part.name));
  let imageRequests = 0;
  assert.ok(controller);

  try {
    await assert.rejects(
      createBuild(
        { idea: "a simple desk indicator", email: "maker@example.com" },
        {
          env: { OPENAI_API_KEY: "test-key" },
          store,
          fetchFn: async (url) => {
            if (String(url).endsWith("/v1/responses")) {
              return new Response(JSON.stringify({
                output_text: JSON.stringify({
                  title: "Desk Indicator",
                  summary: "A small desk indicator.",
                  behavior: "Shows a simple status using the selected hardware.",
                  selectedPartIds: [controller.id],
                  visibleHardwareCues: ["one compact enclosure"],
                  warnings: [],
                }),
              }), { status: 200, headers: { "Content-Type": "application/json" } });
            }
            imageRequests += 1;
            return new Response(JSON.stringify({ error: { message: "temporary image failure" } }), {
              status: 504,
              headers: { "Content-Type": "application/json" },
            });
          },
        },
      ),
      (error) => error?.code === "build_generation_failed" && /temporary image failure/i.test(error.message),
    );
    assert.equal(imageRequests, 1);
    assert.deepEqual(await listPublicBuilds(store), []);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("the background worker forwards Netlify's OpenAI gateway environment", async () => {
  const source = await readFile(
    path.resolve(import.meta.dirname, "../netlify/functions/build-background.mjs"),
    "utf8",
  );
  assert.match(source, /"OPENAI_BASE_URL"/);
  assert.match(source, /"OPENAI_IMAGE_TIMEOUT_MS"/);
});

test("invalid build requests are rejected before persistence", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "makeable-builds-"));
  const store = createLocalBuildStore(path.join(temp, "builds.jsonl"));
  try {
    const noIdea = await createBuild({ idea: "  ", email: "maker@example.com" }, { store });
    const badEmail = await createBuild({ idea: "a small desk clock", email: "not-email" }, { store });

    assert.equal(noIdea.status, 400);
    assert.equal(badEmail.status, 400);
    assert.deepEqual(await listPublicBuilds(store), []);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
