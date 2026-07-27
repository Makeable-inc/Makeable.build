export const ACACIA_PROGRAM_ID = "nus-acacia";
export const ACACIA_REGISTRY_VERSION = 1;
export const ACACIA_BOARD_ID = "esp32-s3-n16r8";

export const ACACIA_DIFFICULTIES = Object.freeze([
  "beginner",
  "builder",
  "advanced",
]);

export const ACACIA_ROUTE_FAMILIES = Object.freeze([
  "rules",
  "connected",
  "tinyml",
  "cloud",
  "hybrid",
]);

const HARDWARE = [
  {
    id: ACACIA_BOARD_ID,
    label:
      "Waveshare ESP32-S3-DEV-KIT-N16R8-M (SKU 28836, pre-soldered headers)",
    pool: "core",
    kind: "controller",
    interface: "GPIO / I2C / SPI / I2S / ADC / PWM",
    power: "USB 5 V; 3.3 V logic",
    profile: {
      manufacturer: "Waveshare",
      sku: "ESP32-S3-DEV-KIT-N16R8-M",
      manufacturerSku: "28836",
      carrierRevision: "manufacturer N16R8 pinout, procurement lot to be recorded",
      module: "ESP32-S3-WROOM-1-N16R8",
      fqbn:
        "esp32:esp32:esp32s3:FlashMode=qio,FlashSize=16M,PartitionScheme=app3M_fat9M_16MB,PSRAM=opi",
      usbConnector: "USB Type-C",
      flashMb: 16,
      psramMb: 8,
      radios: ["2.4 GHz Wi-Fi", "Bluetooth Low Energy"],
      qualificationStatus: "documentation_matched_bench_validation_pending",
      requiredPrintedLabels: [
        "3V3",
        "5V",
        "GND",
        "RST",
        "RESET",
        "BOOT",
        "1",
        "4",
        "5",
        "6",
        "7",
        "8",
        "9",
        "10",
        "11",
        "13",
        "14",
        "16",
        "17",
        "18",
      ],
      documentation: [
        "https://www.waveshare.com/esp32-s3-dev-kit-n8r8.htm",
        "https://docs.waveshare.com/ESP32-S3-DEV-KIT-N8R8",
        "https://docs.espressif.com/projects/esp-dev-kits/en/latest/esp32s3/esp32-s3-devkitc-1/user_guide_v1.0.html",
      ],
    },
  },
  {
    id: "usb-c-data-cable",
    label: "USB-C data cable",
    pool: "core",
    kind: "support",
    interface: "USB",
    power: "5 V USB",
  },
  {
    id: "breadboard-400",
    label: "400-point solderless breadboard",
    pool: "core",
    kind: "support",
    interface: "2.54 mm breadboard",
    power: "Passive",
  },
  {
    id: "jumper-wire-set",
    label: "Jumper wire set",
    pool: "core",
    kind: "support",
    interface: "2.54 mm jumper",
    power: "Passive",
  },
  {
    id: "mpu6050-imu",
    label: "MPU6050 six-axis motion sensor",
    pool: "core",
    kind: "sensor",
    interface: "I2C",
    configuredI2cAddress: "0x68",
    power: "3.3 V",
    signals: ["acceleration", "rotation", "gesture", "movement"],
  },
  {
    id: "inmp441-i2s-microphone",
    label: "INMP441 digital microphone",
    pool: "core",
    kind: "sensor",
    interface: "I2S",
    power: "3.3 V",
    signals: ["sound", "audio event", "noise level"],
  },
  {
    id: "bme280-environment",
    label: "BME280 temperature, humidity and pressure sensor",
    pool: "core",
    kind: "sensor",
    interface: "I2C",
    configuredI2cAddress: "0x76",
    power: "3.3 V",
    signals: ["temperature", "humidity", "air pressure"],
  },
  {
    id: "bh1750-light",
    label: "BH1750 ambient light sensor",
    pool: "core",
    kind: "sensor",
    interface: "I2C",
    configuredI2cAddress: "0x23",
    power: "3.3 V",
    signals: ["light level"],
  },
  {
    id: "vl53l0x-distance",
    label: "VL53L0X time-of-flight distance sensor",
    pool: "core",
    kind: "sensor",
    interface: "I2C",
    configuredI2cAddress: "0x29",
    power: "3.3 V",
    signals: ["distance", "proximity"],
  },
  {
    id: "hc-sr501-pir",
    label: "HC-SR501 passive infrared motion sensor",
    pool: "shared",
    kind: "sensor",
    interface: "Digital",
    power: "5 V module; 3.3 V-compatible output",
    signals: ["presence", "motion"],
  },
  {
    id: "capacitive-soil-moisture-v1-2",
    label: "Capacitive soil moisture sensor v1.2",
    pool: "core",
    kind: "sensor",
    interface: "Analog",
    power: "3.3 V",
    signals: ["soil moisture"],
  },
  {
    id: "ssd1306-oled",
    label: "SSD1306 128×64 OLED display",
    pool: "core",
    kind: "output",
    interface: "I2C",
    configuredI2cAddress: "0x3C",
    power: "3.3 V",
    signals: ["text", "status", "measurement"],
  },
  {
    id: "active-buzzer",
    label: "Active buzzer",
    pool: "core",
    kind: "output",
    interface: "Digital",
    power: "3.3 V",
    signals: ["beep", "alert"],
  },
  {
    id: "momentary-buttons",
    label: "Momentary push-button set",
    pool: "core",
    kind: "input",
    interface: "Digital",
    power: "3.3 V logic",
    signals: ["press", "choice", "confirmation"],
  },
  {
    id: "hx711-load-cell",
    label: "HX711 amplifier and load cell",
    pool: "shared",
    kind: "sensor",
    interface: "Digital",
    power: "3.3 V",
    signals: ["weight", "force"],
  },
  {
    id: "sgp30-air-quality",
    label: "SGP30 air quality sensor",
    pool: "shared",
    kind: "sensor",
    interface: "I2C",
    configuredI2cAddress: "0x58",
    power: "3.3 V",
    signals: ["volatile organic compounds", "air quality"],
  },
];

export const ACACIA_HARDWARE = deepFreeze(HARDWARE);

const HARDWARE_BY_ID = new Map(ACACIA_HARDWARE.map((item) => [item.id, item]));

export const ACACIA_PROGRAM = deepFreeze({
  id: ACACIA_PROGRAM_ID,
  label: "NUS Acacia College",
  registryVersion: ACACIA_REGISTRY_VERSION,
  interactionModel: "idea-first",
  hardwareModel: "fixed-kit",
  boardId: ACACIA_BOARD_ID,
  pools: {
    core: ACACIA_HARDWARE.filter(({ pool }) => pool === "core").map(({ id }) => id),
    shared: ACACIA_HARDWARE.filter(({ pool }) => pool === "shared").map(({ id }) => id),
  },
  budget: {
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
  },
  difficultyIds: ACACIA_DIFFICULTIES,
  routeFamilies: ACACIA_ROUTE_FAMILIES,
  ai: {
    credentialMode: "makeable-managed",
    studentApiKeyRequired: false,
    studentApiKeyAccepted: false,
  },
});

// Internal planning snapshot. The public program API deliberately strips these
// estimates; refresh them against supplier quotes before Acacia purchases.
export const ACACIA_PROCUREMENT_SNAPSHOT = deepFreeze({
  snapshotVersion: 1,
  capturedOn: "2026-07-26",
  status: "planning_estimate_refresh_before_purchase",
  basis: "SGD planning estimates with delivery/GST allowance; not supplier quotes",
  currency: "SGD",
  teamCount: 12,
  corePerTeam: [
    procurementLine(ACACIA_BOARD_ID, 1, 20),
    procurementLine("usb-c-data-cable", 1, 2.2),
    procurementLine("breadboard-400", 1, 1.8),
    procurementLine("jumper-wire-set", 1, 1.8),
    procurementLine("mpu6050-imu", 1, 1.6),
    procurementLine("inmp441-i2s-microphone", 1, 1.8),
    procurementLine("bme280-environment", 1, 3),
    procurementLine("bh1750-light", 1, 1),
    procurementLine("vl53l0x-distance", 1, 3.5),
    procurementLine("capacitive-soil-moisture-v1-2", 1, 1.5),
    procurementLine("ssd1306-oled", 1, 2.5),
    procurementLine("active-buzzer", 1, 0.5),
    procurementLine("momentary-buttons", 1, 0.8),
  ],
  sharedPool: [
    procurementLine("hc-sr501-pir", 6, 1.5),
    procurementLine("hx711-load-cell", 6, 5),
    procurementLine("sgp30-air-quality", 6, 12),
  ],
  cohortSpares: [
    procurementLine(ACACIA_BOARD_ID, 2, 20),
    procurementLine("usb-c-data-cable", 2, 2.2),
    procurementLine("jumper-wire-set", 2, 1.8),
    procurementLine("bme280-environment", 2, 3),
    procurementLine("ssd1306-oled", 2, 2.5),
  ],
  contingencySgd: 120,
});

export function summarizeAcaciaProcurement(
  snapshot = ACACIA_PROCUREMENT_SNAPSHOT,
) {
  const corePerTeamSgd = lineTotal(snapshot.corePerTeam);
  const coreCohortSgd = money(corePerTeamSgd * snapshot.teamCount);
  const sharedPoolSgd = lineTotal(snapshot.sharedPool);
  const cohortSparesSgd = lineTotal(snapshot.cohortSpares);
  const contingencySgd = money(snapshot.contingencySgd);
  return deepFreeze({
    currency: snapshot.currency,
    corePerTeamSgd,
    coreCohortSgd,
    sharedPoolSgd,
    cohortSparesSgd,
    contingencySgd,
    cohortTotalSgd: money(
      coreCohortSgd +
        sharedPoolSgd +
        cohortSparesSgd +
        contingencySgd,
    ),
  });
}

export function getAcaciaHardware(id) {
  return HARDWARE_BY_ID.get(normalizeId(id)) || null;
}

export function isAcaciaHardwareId(id) {
  return HARDWARE_BY_ID.has(normalizeId(id));
}

export function listAcaciaHardware({ pool, kind } = {}) {
  return ACACIA_HARDWARE.filter(
    (item) =>
      (!pool || item.pool === normalizeId(pool)) &&
      (!kind || item.kind === String(kind).trim().toLowerCase()),
  );
}

export function acaciaProgramManifest() {
  return ACACIA_PROGRAM;
}

export function validateAcaciaHardwareSelection(
  hardwareIds,
  { requireBoard = true, allowShared = true } = {},
) {
  const issues = [];
  if (!Array.isArray(hardwareIds)) {
    return [issue("invalid-hardware-list", "hardwareIds", "Hardware IDs must be an array.")];
  }

  const normalized = hardwareIds.map(normalizeId);
  const seen = new Set();
  for (const [index, id] of normalized.entries()) {
    if (!id || !HARDWARE_BY_ID.has(id)) {
      issues.push(
        issue(
          "unknown-hardware",
          `hardwareIds[${index}]`,
          id
            ? `"${id}" is not in the Acacia hardware registry.`
            : "Hardware IDs cannot be empty.",
        ),
      );
      continue;
    }
    if (seen.has(id)) {
      issues.push(
        issue(
          "duplicate-hardware",
          `hardwareIds[${index}]`,
          `"${id}" is listed more than once.`,
        ),
      );
    }
    seen.add(id);
    if (!allowShared && HARDWARE_BY_ID.get(id).pool === "shared") {
      issues.push(
        issue(
          "shared-hardware-not-allowed",
          `hardwareIds[${index}]`,
          `"${id}" requires the Acacia shared hardware pool.`,
        ),
      );
    }
  }

  if (requireBoard && !seen.has(ACACIA_BOARD_ID)) {
    issues.push(
      issue(
        "missing-acacia-board",
        "hardwareIds",
        `Every Acacia build must use "${ACACIA_BOARD_ID}".`,
      ),
    );
  }
  return issues;
}

function issue(code, path, message) {
  return Object.freeze({ code, path, message });
}

function normalizeId(value) {
  return String(value || "").trim().toLowerCase();
}

function procurementLine(hardwareId, quantity, estimatedUnitCostSgd) {
  return { hardwareId, quantity, estimatedUnitCostSgd };
}

function lineTotal(lines) {
  return money(
    lines.reduce(
      (total, line) =>
        total + line.quantity * line.estimatedUnitCostSgd,
      0,
    ),
  );
}

function money(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}
