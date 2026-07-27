import {
  ACACIA_BOARD_ID,
  ACACIA_DIFFICULTIES,
  ACACIA_ROUTE_FAMILIES,
  getAcaciaHardware,
} from "./registry.mjs";

const REQUIRED_SUPPORT = [
  ACACIA_BOARD_ID,
  "usb-c-data-cable",
  "breadboard-400",
  "jumper-wire-set",
];

const CAPABILITIES = [
  capability({
    id: "interactive-feedback",
    label: "Interactive feedback prototype",
    family: "rules",
    difficulty: "beginner",
    required: [...REQUIRED_SUPPORT, "momentary-buttons", "ssd1306-oled"],
    optional: ["active-buzzer"],
    keywords: ["button", "interactive", "game", "quiz", "choice", "feedback"],
    supportedIdea:
      "Build an interactive prototype that turns a button or sensor event into visible or audible feedback.",
  }),
  capability({
    id: "environment-guardian",
    label: "Environmental guardian",
    family: "rules",
    difficulty: "beginner",
    required: [...REQUIRED_SUPPORT, "bme280-environment", "ssd1306-oled"],
    optional: ["bh1750-light", "active-buzzer", "sgp30-air-quality"],
    keywords: ["environment", "temperature", "humidity", "heat", "weather", "room", "light"],
    supportedIdea:
      "Monitor the local environment and turn clear thresholds into status lights, a display or an alert.",
  }),
  capability({
    id: "proximity-presence",
    label: "Privacy-friendly presence prototype",
    family: "rules",
    difficulty: "beginner",
    required: [...REQUIRED_SUPPORT, "vl53l0x-distance", "ssd1306-oled"],
    optional: ["hc-sr501-pir", "active-buzzer"],
    keywords: ["presence", "distance", "nearby", "visitor", "occupancy", "motion"],
    supportedIdea:
      "Detect nearby presence and distance without capturing images or identifying a person.",
  }),
  capability({
    id: "plant-care",
    label: "Plant care assistant",
    family: "rules",
    difficulty: "builder",
    required: [
      ...REQUIRED_SUPPORT,
      "capacitive-soil-moisture-v1-2",
      "bme280-environment",
      "ssd1306-oled",
    ],
    optional: ["bh1750-light", "active-buzzer"],
    keywords: ["plant", "soil", "garden", "watering", "moisture", "farm"],
    supportedIdea:
      "Measure plant conditions and explain when the plant may need attention.",
  }),
  capability({
    id: "connected-monitor",
    label: "Connected sensor dashboard",
    family: "connected",
    difficulty: "builder",
    required: [...REQUIRED_SUPPORT, "bme280-environment", "ssd1306-oled"],
    optional: [
      "bh1750-light",
      "capacitive-soil-moisture-v1-2",
      "sgp30-air-quality",
    ],
    keywords: ["dashboard", "phone", "wifi", "bluetooth", "connected", "remote", "monitor"],
    supportedIdea:
      "Verify a known Acacia sensor and its on-device status display offline, then format bounded readings for a later dashboard; live Wi-Fi and dashboard delivery are deferred in this slice.",
  }),
  capability({
    id: "remote-alert",
    label: "Remote condition alert",
    family: "cloud",
    difficulty: "builder",
    required: [...REQUIRED_SUPPORT, "bme280-environment", "ssd1306-oled"],
    optional: ["active-buzzer", "bh1750-light", "vl53l0x-distance"],
    keywords: ["alert", "notify", "message", "cloud", "email", "urgent", "warning"],
    supportedIdea:
      "Evaluate a known sensor condition locally and show a test status on the device; remote messages and managed alert delivery are deferred in this slice.",
  }),
  capability({
    id: "motion-classifier",
    label: "Motion and gesture classifier",
    family: "tinyml",
    difficulty: "builder",
    required: [...REQUIRED_SUPPORT, "mpu6050-imu", "ssd1306-oled"],
    optional: ["active-buzzer", "bme280-environment"],
    keywords: ["gesture", "activity", "movement", "fall", "exercise", "pose", "motion"],
    supportedIdea:
      "Verify the motion sensor, collect labelled examples and produce a validation-ready dataset for later training; this slice does not claim a trained or on-device model.",
  }),
  capability({
    id: "sound-classifier",
    label: "Sound event classifier",
    family: "tinyml",
    difficulty: "advanced",
    required: [...REQUIRED_SUPPORT, "inmp441-i2s-microphone", "ssd1306-oled"],
    optional: ["active-buzzer"],
    keywords: ["sound", "noise", "clap", "audio", "knock", "alarm"],
    supportedIdea:
      "Verify non-speech sound capture without recording speech content, collect labelled examples and produce a validation-ready dataset for later training; this slice does not claim a trained or on-device model.",
  }),
  capability({
    id: "anomaly-monitor",
    label: "On-device anomaly monitor",
    family: "tinyml",
    difficulty: "advanced",
    required: [...REQUIRED_SUPPORT, "mpu6050-imu", "ssd1306-oled"],
    optional: ["bme280-environment", "inmp441-i2s-microphone", "active-buzzer"],
    keywords: ["anomaly", "unusual", "abnormal", "fault", "vibration", "predictive"],
    supportedIdea:
      "Verify a known sensor, collect labelled baseline and comparison readings, and produce a validation-ready dataset; model training and on-device anomaly detection are deferred.",
  }),
  capability({
    id: "cloud-insight",
    label: "Cloud-assisted sensor insight",
    family: "cloud",
    difficulty: "builder",
    required: [...REQUIRED_SUPPORT, "bme280-environment", "ssd1306-oled"],
    optional: ["bh1750-light", "capacitive-soil-moisture-v1-2", "sgp30-air-quality"],
    keywords: ["advice", "recommend", "insight", "explain", "forecast", "assistant", "ai"],
    supportedIdea:
      "Create bounded, non-sensitive sensor summaries and test local rules for practical guidance; managed cloud or AI interpretation is deferred in this slice.",
  }),
  capability({
    id: "hybrid-edge-alert",
    label: "Offline-first intelligent alert",
    family: "hybrid",
    difficulty: "advanced",
    required: [...REQUIRED_SUPPORT, "mpu6050-imu", "ssd1306-oled"],
    optional: ["inmp441-i2s-microphone", "bme280-environment", "active-buzzer"],
    keywords: ["offline", "real-time", "edge", "hybrid", "send alert", "works without"],
    supportedIdea:
      "Verify local sensor capture and deterministic device feedback, then format a compact event record; trained inference and connected delivery are deferred in this slice.",
  }),
  capability({
    id: "contactless-check-in",
    label: "Consent-based check-in demonstrator",
    family: "connected",
    difficulty: "advanced",
    required: [...REQUIRED_SUPPORT, "momentary-buttons", "ssd1306-oled"],
    optional: ["active-buzzer"],
    keywords: ["check-in", "attendance", "tag", "rfid", "nfc", "access"],
    supportedIdea:
      "Use deliberate button input to demonstrate a consent-based local check-in record; NFC identity, persistent attendance and a connected service are deferred.",
  }),
  capability({
    id: "tabletop-machine",
    label: "Tabletop control-logic demonstrator",
    family: "hybrid",
    difficulty: "advanced",
    required: [...REQUIRED_SUPPORT, "mpu6050-imu", "momentary-buttons", "ssd1306-oled"],
    optional: ["vl53l0x-distance", "active-buzzer"],
    keywords: ["robot", "vehicle", "motor", "machine", "conveyor", "drone"],
    supportedIdea:
      "Build and verify the sensing, state-machine and stop-control logic on the tabletop with local feedback; motors, autonomous motion and connected telemetry are deferred.",
  }),
];

export const ACACIA_CAPABILITIES = deepFreeze(CAPABILITIES);

const CAPABILITY_BY_ID = new Map(
  ACACIA_CAPABILITIES.map((entry) => [entry.id, entry]),
);

export function getAcaciaCapability(id) {
  return CAPABILITY_BY_ID.get(normalizeId(id)) || null;
}

export function listAcaciaCapabilities({ family, maximumDifficulty } = {}) {
  const maximumRank =
    maximumDifficulty === undefined
      ? Number.POSITIVE_INFINITY
      : difficultyRank(maximumDifficulty);
  return ACACIA_CAPABILITIES.filter(
    (entry) =>
      (!family || entry.family === normalizeId(family)) &&
      entry.difficultyRank <= maximumRank,
  );
}

export function validateAcaciaCapabilityRegistry() {
  const issues = [];
  const ids = new Set();
  for (const [index, entry] of ACACIA_CAPABILITIES.entries()) {
    if (ids.has(entry.id)) {
      issues.push(issue("duplicate-capability", `[${index}].id`, entry.id));
    }
    ids.add(entry.id);
    if (!ACACIA_ROUTE_FAMILIES.includes(entry.family)) {
      issues.push(issue("unknown-family", `[${index}].family`, entry.family));
    }
    if (!ACACIA_DIFFICULTIES.includes(entry.difficulty)) {
      issues.push(issue("unknown-difficulty", `[${index}].difficulty`, entry.difficulty));
    }
    for (const [listName, hardwareIds] of [
      ["requiredHardwareIds", entry.requiredHardwareIds],
      ["optionalHardwareIds", entry.optionalHardwareIds],
    ]) {
      for (const hardwareId of hardwareIds) {
        if (!getAcaciaHardware(hardwareId)) {
          issues.push(
            issue(
              "unknown-hardware",
              `[${index}].${listName}`,
              hardwareId,
            ),
          );
        }
      }
    }
    if (!entry.requiredHardwareIds.includes(ACACIA_BOARD_ID)) {
      issues.push(issue("missing-board", `[${index}].requiredHardwareIds`, entry.id));
    }
  }
  return issues;
}

export function difficultyRank(value) {
  return ACACIA_DIFFICULTIES.indexOf(normalizeId(value));
}

function capability({
  id,
  label,
  family,
  difficulty,
  required,
  optional,
  keywords,
  supportedIdea,
}) {
  const requiredHardwareIds = unique(required);
  const optionalHardwareIds = unique(optional).filter(
    (hardwareId) => !requiredHardwareIds.includes(hardwareId),
  );
  return {
    id,
    label,
    family,
    difficulty,
    difficultyRank: difficultyRank(difficulty),
    requiredHardwareIds,
    optionalHardwareIds,
    allowedHardwareIds: unique([...requiredHardwareIds, ...optionalHardwareIds]),
    keywords: unique(keywords.map((keyword) => keyword.toLowerCase())),
    supportedIdea,
  };
}

function unique(values) {
  return [...new Set(values)];
}

function issue(code, path, detail) {
  return Object.freeze({ code, path, detail });
}

function normalizeId(value) {
  return String(value || "").trim().toLowerCase();
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}
