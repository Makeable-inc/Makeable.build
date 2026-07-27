import test from "node:test";
import assert from "node:assert/strict";
import {
  createAcaciaBuildPlan,
  validateAcaciaBuildPlan,
} from "../lib/programs/acacia/build-plan.mjs";
import {
  routeAcaciaIdea,
} from "../lib/programs/acacia/router.mjs";
import {
  normalizeBeginnerPlan,
  validateBeginnerPlan,
} from "../pilot/lib/beginner-plan.mjs";

function route(request) {
  const result = routeAcaciaIdea(request);
  assert.equal(result.ok, true, JSON.stringify(result.issues));
  return result.value;
}

function assertRegistryEvidence(plan, sourceRoute) {
  assert.equal(plan.schemaVersion, 2);
  assert.equal(plan.verificationSource, "program_registry");
  assert.equal(plan.boardProfile.profileId, "esp32-s3-n16r8");
  assert.equal(plan.boardProfile.manufacturer, "Waveshare");
  assert.equal(
    plan.boardProfile.model,
    "Waveshare ESP32-S3-DEV-KIT-N16R8-M (SKU 28836)",
  );
  assert.equal(plan.boardProfile.usbConnector, "USB Type-C");
  assert.equal(plan.boardProfile.supportStatus, "compatible_with_differences");
  assert.equal(plan.boardProfile.identityConfidence, null);
  assert.match(plan.boardProfile.revision, /bench validation pending/i);
  assert.match(plan.firmwareSpec.board, /FlashSize=16M/);
  assert.match(plan.firmwareSpec.board, /PartitionScheme=app3M_fat9M_16MB/);
  assert.match(plan.firmwareSpec.board, /PSRAM=opi/);
  assert.ok(plan.parts.every((part) => !Object.hasOwn(part, "bbox")));
  assert.ok(
    plan.wiringSteps.every(
      (step) =>
        step.pinLocationsConfirmed === false &&
        !Object.hasOwn(step, "fromPinBbox") &&
        !Object.hasOwn(step, "toPinBbox"),
    ),
  );
  assert.deepEqual(validateAcaciaBuildPlan(plan, sourceRoute), []);
  assert.equal(
    validateBeginnerPlan(plan).some(({ severity }) => severity === "block"),
    false,
  );
}

test("environment route creates a deterministic registry-backed low-current plan", () => {
  const sourceRoute = route({
    idea: "Monitor the room temperature and humidity and show when it gets uncomfortable.",
  });
  assert.equal(sourceRoute.capabilityId, "environment-guardian");

  const first = createAcaciaBuildPlan(sourceRoute);
  const second = createAcaciaBuildPlan(sourceRoute);
  assert.deepEqual(first, second);
  assertRegistryEvidence(first, sourceRoute);
  assert.equal(first.powerPlan.mode, "usb_board_power");
  assert.equal(first.powerPlan.externalPowerRequired, false);
  assert.equal(
    normalizeBeginnerPlan(first, { userRequest: sourceRoute.originalIdea }).powerPlan.externalPowerRequired,
    false,
    "the registered low-current sensor-and-display build must stay USB-powered",
  );
  assert.ok(first.parts.some(({ id }) => id === "bme280-environment"));
  assert.ok(first.parts.some(({ id }) => id === "ssd1306-oled"));
  assert.equal(first.parts.some(({ id }) => id === "bh1750-light"), false);
  assert.ok(
    first.firmwareSpec.pinAssignments.some(
      ({ gpio, mode }) => gpio === 8 && mode === "I2C SDA",
    ),
  );
});

test("motion classifier includes the registered IMU and bounded TinyML contract", () => {
  const sourceRoute = route({
    idea: "Classify three hand gestures with the IMU.",
    preferredFamily: "tinyml",
  });
  assert.equal(sourceRoute.capabilityId, "motion-classifier");

  const plan = createAcaciaBuildPlan(sourceRoute);
  assertRegistryEvidence(plan, sourceRoute);
  assert.ok(plan.parts.some(({ id }) => id === "mpu6050-imu"));
  assert.ok(plan.parts.some(({ id }) => id === "ssd1306-oled"));
  assert.equal(
    plan.parts.some(({ id }) => /ws2812|servo|motor|driver|supply|pump/.test(id)),
    false,
  );
  assert.equal(
    plan.firmwareSpec.libraries.some((library) =>
      /tensorflow|tflite|tflm/i.test(library),
    ),
    false,
  );
  assert.match(plan.firmwareSpec.behavior, /collect labelled examples/i);
  assert.match(plan.firmwareSpec.behavior, /validation-ready dataset/i);
  assert.match(plan.firmwareSpec.behavior, /does not claim a trained or on-device model/i);
  assert.doesNotMatch(
    plan.firmwareSpec.behavior,
    /\b(?:run|perform|execute|deploy)\w*\b.{0,24}\b(?:inference|trained model|on-device prediction)\b/i,
  );
  assert.ok(
    plan.diagnosticTests.some(
      ({ expectedSerial }) => expectedSerial === "ACACIA:MPU6050_IMU:OK",
    ),
  );
});

test("camera idea preserves the goal through the proximity route without camera hardware", () => {
  const sourceRoute = route({
    idea: "Use a camera to notice when a visitor approaches my desk.",
  });
  assert.equal(sourceRoute.routeStatus, "reshaped");
  assert.equal(sourceRoute.capabilityId, "proximity-presence");

  const plan = createAcaciaBuildPlan(sourceRoute);
  assertRegistryEvidence(plan, sourceRoute);
  assert.match(plan.summary, /without capturing images/i);
  assert.ok(plan.parts.some(({ id }) => id === "vl53l0x-distance"));
  assert.ok(plan.parts.some(({ id }) => id === "ssd1306-oled"));
  assert.equal(plan.parts.some(({ id }) => id === "hc-sr501-pir"), false);
  assert.equal(
    plan.parts.some(({ id, name }) => /camera/i.test(`${id} ${name}`)),
    false,
  );
  assert.match(plan.operatingGuide.summary, /without capturing images/i);
});

test("tabletop machine is a USB-powered motorless state-machine and stop-control simulator", () => {
  const sourceRoute = route({
    idea: "Build an autonomous car as a low-voltage tabletop prototype.",
  });
  assert.equal(sourceRoute.capabilityId, "tabletop-machine");

  const plan = createAcaciaBuildPlan(sourceRoute);
  assertRegistryEvidence(plan, sourceRoute);
  const normalizedPlan = normalizeBeginnerPlan(plan, { userRequest: sourceRoute.originalIdea });
  assert.equal(plan.powerPlan.mode, "usb_board_power");
  assert.equal(plan.powerPlan.externalPowerRequired, false);
  assert.equal(normalizedPlan.powerPlan.externalPowerRequired, false);
  assert.deepEqual(normalizedPlan.powerPlan.externalSupplyPartIds, []);
  assert.equal(
    validateBeginnerPlan(normalizedPlan).some(({ code }) => code === "missing-external-load-supply"),
    false,
  );
  assert.ok(plan.parts.some(({ id }) => id === "momentary-buttons"));
  assert.equal(
    plan.parts.some(({ id }) => /motor|driver|supply|pump|servo/.test(id)),
    false,
  );
  assert.match(plan.firmwareSpec.behavior, /state-machine and stop-control logic/i);
  assert.match(plan.operatingGuide.summary, /without energising a motor/i);
  assert.match(plan.operatingGuide.steps.join(" "), /stop button/i);
});

test("all three difficulty plans differ in hardware, firmware behavior, and evidence milestones", () => {
  const tracks = ["beginner", "builder", "advanced"].map((difficulty) => {
    const sourceRoute = route({
      idea: "Make a room temperature status light.",
      difficulty,
    });
    const plan = createAcaciaBuildPlan(sourceRoute);
    assertRegistryEvidence(plan, sourceRoute);
    return plan;
  });

  assert.deepEqual(
    tracks.map(({ difficultyProfile }) => difficultyProfile.id),
    ["beginner", "builder", "advanced"],
  );
  assert.deepEqual(
    tracks.map(({ parts }) =>
      parts
        .map(({ id }) => id)
        .filter((id) => ["bh1750-light", "active-buzzer"].includes(id)),
    ),
    [[], ["bh1750-light"], ["bh1750-light", "active-buzzer"]],
  );
  assert.equal(
    new Set(tracks.map(({ difficultyProfile }) => difficultyProfile.focus)).size,
    3,
  );
  assert.equal(
    new Set(tracks.map(({ firmwareSpec }) => firmwareSpec.behavior)).size,
    3,
  );
  assert.equal(
    new Set(
      tracks.map(({ difficultyProfile }) =>
        difficultyProfile.milestones.join("\n"),
      ),
    ).size,
    3,
  );
  for (const plan of tracks) {
    assert.ok(plan.difficultyProfile.milestones.length >= 3);
    assert.ok(
      plan.diagnosticTests.some(({ expectedSerial }) =>
        expectedSerial.endsWith(
          `TRACK:${plan.difficultyProfile.id.toUpperCase()}:READY`,
        ),
      ),
    );
  }
});
