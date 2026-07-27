import assert from "node:assert/strict";
import test from "node:test";

import {
  ACACIA_BOARD_ID,
  ACACIA_CAPABILITIES,
  ACACIA_DIFFICULTIES,
  ACACIA_HARDWARE,
  ACACIA_PROCUREMENT_SNAPSHOT,
  ACACIA_PROGRAM,
  ACACIA_PROGRAM_ID,
  ACACIA_REGISTRY_VERSION,
  ACACIA_ROUTE_FAMILIES,
  acaciaProgramManifest,
  getAcaciaCapability,
  getAcaciaHardware,
  isAcaciaHardwareId,
  listAcaciaCapabilities,
  listAcaciaHardware,
  summarizeAcaciaProcurement,
  validateAcaciaCapabilityRegistry,
  validateAcaciaHardwareSelection,
} from "../lib/programs/acacia/index.mjs";

test("the Acacia manifest describes an immutable idea-first fixed kit", () => {
  const manifest = acaciaProgramManifest();

  assert.equal(manifest, ACACIA_PROGRAM);
  assert.equal(manifest.id, "nus-acacia");
  assert.equal(ACACIA_PROGRAM_ID, "nus-acacia");
  assert.equal(ACACIA_REGISTRY_VERSION, 1);
  assert.equal(manifest.registryVersion, 1);
  assert.equal(manifest.interactionModel, "idea-first");
  assert.equal(manifest.hardwareModel, "fixed-kit");
  assert.equal(manifest.boardId, "esp32-s3-n16r8");
  assert.equal(Object.isFrozen(manifest), true);
  assert.equal(Object.isFrozen(manifest.pools), true);
  assert.throws(() => {
    manifest.pools.core.push("invented-part");
  }, TypeError);
});

test("the fixed controller binds one documented N16R8 carrier and memory configuration", () => {
  const board = getAcaciaHardware(ACACIA_BOARD_ID);

  assert.equal(board.id, "esp32-s3-n16r8");
  assert.equal(board.pool, "core");
  assert.equal(board.kind, "controller");
  assert.equal(board.profile.manufacturer, "Waveshare");
  assert.equal(board.profile.sku, "ESP32-S3-DEV-KIT-N16R8-M");
  assert.equal(board.profile.manufacturerSku, "28836");
  assert.equal(board.profile.module, "ESP32-S3-WROOM-1-N16R8");
  assert.match(board.profile.fqbn, /FlashSize=16M/);
  assert.match(board.profile.fqbn, /PartitionScheme=app3M_fat9M_16MB/);
  assert.match(board.profile.fqbn, /PSRAM=opi/);
  assert.equal(board.profile.usbConnector, "USB Type-C");
  assert.equal(board.profile.flashMb, 16);
  assert.equal(board.profile.psramMb, 8);
  assert.equal(
    board.profile.qualificationStatus,
    "documentation_matched_bench_validation_pending",
  );
  assert.ok(board.profile.requiredPrintedLabels.includes("18"));
  assert.ok(board.profile.requiredPrintedLabels.includes("RST"));
  assert.ok(board.profile.documentation.every((url) => url.startsWith("https://")));
  assert.deepEqual(board.profile.radios, [
    "2.4 GHz Wi-Fi",
    "Bluetooth Low Energy",
  ]);
  assert.equal(board.profile.radios.includes("Bluetooth Classic"), false);
});

test("core and shared pools are explicit, disjoint and registry-backed", () => {
  const core = listAcaciaHardware({ pool: "core" });
  const shared = listAcaciaHardware({ pool: "shared" });
  const coreIds = new Set(core.map(({ id }) => id));
  const sharedIds = new Set(shared.map(({ id }) => id));

  assert.ok(coreIds.has(ACACIA_BOARD_ID));
  assert.ok(coreIds.has("mpu6050-imu"));
  assert.ok(coreIds.has("inmp441-i2s-microphone"));
  assert.ok(coreIds.has("capacitive-soil-moisture-v1-2"));
  assert.equal(coreIds.has("hc-sr501-pir"), false);
  assert.ok(sharedIds.has("hc-sr501-pir"));
  assert.ok(sharedIds.has("hx711-load-cell"));
  assert.ok(sharedIds.has("sgp30-air-quality"));
  assert.equal([...coreIds].some((id) => sharedIds.has(id)), false);
  assert.equal(core.length + shared.length, ACACIA_HARDWARE.length);
  assert.deepEqual(ACACIA_PROGRAM.pools.core, [...coreIds]);
  assert.deepEqual(ACACIA_PROGRAM.pools.shared, [...sharedIds]);
});

test("the core kit stays within the user-defined useful-module and budget targets", () => {
  const usefulCoreModules = listAcaciaHardware({ pool: "core" }).filter(
    ({ kind }) => !["controller", "support"].includes(kind),
  );

  assert.equal(usefulCoreModules.length, 9);
  assert.ok(usefulCoreModules.length >= ACACIA_PROGRAM.budget.usefulCoreModuleTarget.minimum);
  assert.ok(usefulCoreModules.length <= ACACIA_PROGRAM.budget.usefulCoreModuleTarget.maximum);
  assert.deepEqual(ACACIA_PROGRAM.budget, {
    currency: "SGD",
    teamCount: 12,
    perTeamCoreKitTarget: {
      minimum: 30,
      maximum: 50,
    },
    cohortHardwareCeiling: 1_000,
    cohortHardwareIncludes: [
      "twelve-team-core-kits",
      "shared-advanced-hardware-pool",
    ],
    usefulCoreModuleTarget: {
      minimum: 8,
      maximum: 10,
    },
  });
  assert.equal(Object.hasOwn(ACACIA_PROGRAM.budget, "perItemPrices"), false);

  const estimate = summarizeAcaciaProcurement();
  assert.equal(ACACIA_PROCUREMENT_SNAPSHOT.snapshotVersion, 1);
  assert.equal(estimate.corePerTeamSgd, 42);
  assert.ok(
    estimate.corePerTeamSgd >=
      ACACIA_PROGRAM.budget.perTeamCoreKitTarget.minimum,
  );
  assert.ok(
    estimate.corePerTeamSgd <=
      ACACIA_PROGRAM.budget.perTeamCoreKitTarget.maximum,
  );
  assert.ok(
    estimate.cohortTotalSgd <=
      ACACIA_PROGRAM.budget.cohortHardwareCeiling,
  );
  assert.equal(estimate.cohortTotalSgd, 794);
});

test("hardware lookup is exact and arbitrary parts are never recognized", () => {
  assert.equal(isAcaciaHardwareId("  MPU6050-IMU "), true);
  assert.equal(getAcaciaHardware(" sgp30-air-quality ")?.pool, "shared");
  assert.equal(getAcaciaHardware(" pn532-nfc "), null);
  assert.equal(getAcaciaHardware("arduino-uno"), null);
  assert.equal(isAcaciaHardwareId("raspberry-pi-camera"), false);
  assert.deepEqual(
    listAcaciaHardware({ kind: "sensor" }).map(({ id }) => id),
    ACACIA_HARDWARE.filter(({ kind }) => kind === "sensor").map(({ id }) => id),
  );
});

test("hardware selection validation reports unknown, duplicate and missing board IDs", () => {
  const issues = validateAcaciaHardwareSelection([
    "mpu6050-imu",
    "mpu6050-imu",
    "made-up-camera",
  ]);

  assert.ok(issues.some(({ code }) => code === "duplicate-hardware"));
  assert.ok(issues.some(({ code }) => code === "unknown-hardware"));
  assert.ok(issues.some(({ code }) => code === "missing-acacia-board"));
});

test("hardware selection validation can restrict a route to the per-team core kit", () => {
  const coreIssues = validateAcaciaHardwareSelection(
    [ACACIA_BOARD_ID, "mpu6050-imu"],
    { allowShared: false },
  );
  const sharedIssues = validateAcaciaHardwareSelection(
    [ACACIA_BOARD_ID, "sgp30-air-quality"],
    { allowShared: false },
  );

  assert.deepEqual(coreIssues, []);
  assert.ok(
    sharedIssues.some(({ code }) => code === "shared-hardware-not-allowed"),
  );
});

test("only the three qualified sensors occupy the shared pool", () => {
  assert.deepEqual(
    listAcaciaHardware({ pool: "shared" }).map(({ id }) => id),
    ["hc-sr501-pir", "hx711-load-cell", "sgp30-air-quality"],
  );

  for (const hardwareId of [
    "sg90-servo",
    "pn532-nfc",
    "tb6612fng-motor-driver",
    "regulated-5v-supply",
    "tt-geared-motor",
    "mini-water-pump-5v",
    "ws2812b-rgb",
  ]) {
    assert.equal(getAcaciaHardware(hardwareId), null, hardwareId);
  }
});

test("difficulty and route families expose the complete bounded program vocabulary", () => {
  assert.deepEqual(ACACIA_DIFFICULTIES, [
    "beginner",
    "builder",
    "advanced",
  ]);
  assert.deepEqual(ACACIA_ROUTE_FAMILIES, [
    "rules",
    "connected",
    "tinyml",
    "cloud",
    "hybrid",
  ]);
  assert.deepEqual(
    new Set(ACACIA_CAPABILITIES.map(({ family }) => family)),
    new Set(ACACIA_ROUTE_FAMILIES),
  );
  assert.ok(
    ACACIA_DIFFICULTIES.every((difficulty) =>
      ACACIA_CAPABILITIES.some((entry) => entry.difficulty === difficulty),
    ),
  );
});

test("every capability references only registered hardware and requires the fixed board", () => {
  assert.deepEqual(validateAcaciaCapabilityRegistry(), []);

  for (const capability of ACACIA_CAPABILITIES) {
    assert.ok(capability.requiredHardwareIds.includes(ACACIA_BOARD_ID));
    assert.equal(new Set(capability.allowedHardwareIds).size, capability.allowedHardwareIds.length);
    assert.ok(
      capability.allowedHardwareIds.every((hardwareId) =>
        isAcaciaHardwareId(hardwareId),
      ),
    );
  }
});

test("capability queries are bounded by family and maximum difficulty", () => {
  assert.equal(getAcaciaCapability(" MOTION-CLASSIFIER ")?.family, "tinyml");
  assert.equal(getAcaciaCapability("made-up-capability"), null);
  assert.ok(
    listAcaciaCapabilities({ family: "tinyml", maximumDifficulty: "builder" }).every(
      ({ family, difficulty }) =>
        family === "tinyml" && difficulty !== "advanced",
    ),
  );
});

test("the program policy always uses Makeable-managed AI", () => {
  assert.deepEqual(ACACIA_PROGRAM.ai, {
    credentialMode: "makeable-managed",
    studentApiKeyRequired: false,
    studentApiKeyAccepted: false,
  });
});
