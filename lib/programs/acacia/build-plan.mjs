import {
  ACACIA_BOARD_ID,
  getAcaciaHardware,
} from "./registry.mjs";
import {
  validateAcaciaRoute,
} from "./router.mjs";

const BOARD_REGISTRY = getAcaciaHardware(ACACIA_BOARD_ID);
const BOARD_MODEL = "Waveshare ESP32-S3-DEV-KIT-N16R8-M (SKU 28836)";
const BOARD_FQBN = BOARD_REGISTRY.profile.fqbn;
const SUPPORT_KINDS = new Set(["controller", "support", "power", "power supply"]);
const UNSAFE_BOARD_PINS = new Set([
  "GPIO0",
  "GPIO3",
  "GPIO19",
  "GPIO20",
  "GPIO45",
  "GPIO46",
]);
const WIRE_COLORS = Object.freeze([
  "orange",
  "yellow",
  "green",
  "blue",
  "purple",
  "white",
  "brown",
  "gray",
]);

const DIFFICULTY_PROFILES = deepFreeze({
  beginner: {
    label: "Beginner",
    focus: "Complete one dependable sensor-to-feedback loop with step-by-step checks.",
    firmwareBehavior:
      "Keep the behavior single-purpose, use one clear threshold or state transition, and print the measured value before the output state.",
    milestones: [
      "Pass every registered part diagnostic.",
      "Trigger one input state and observe one matching output state.",
      "Explain the input, rule and output in one sentence.",
    ],
  },
  builder: {
    label: "Builder",
    focus: "Calibrate the build with real observations and compare more than one state.",
    firmwareBehavior:
      "Add an explicit calibration stage, distinguish at least two meaningful states, and print the calibrated value plus state.",
    milestones: [
      "Pass every registered part diagnostic.",
      "Record a baseline and choose a threshold from observed values.",
      "Demonstrate two states and explain one false trigger or limitation.",
    ],
  },
  advanced: {
    label: "Advanced",
    focus: "Integrate multiple registered signals and produce evidence against edge cases.",
    firmwareBehavior:
      "Combine the selected registered inputs or outputs, include a recoverable fault state, and emit structured evidence for at least three test cases.",
    milestones: [
      "Pass every registered part diagnostic.",
      "Integrate the additional registered hardware selected by the Advanced track.",
      "Run nominal, boundary and failure-recovery tests and retain their serial evidence.",
    ],
  },
});

const ROLE_BY_HARDWARE_ID = Object.freeze({
  [ACACIA_BOARD_ID]: "Runs the project logic and communicates over USB-C.",
  "usb-c-data-cable": "Powers, flashes and diagnoses the ESP32-S3.",
  "breadboard-400": "Holds the low-voltage prototype without soldering.",
  "jumper-wire-set": "Makes the registered low-voltage connections.",
  "mpu6050-imu": "Measures acceleration and rotation.",
  "inmp441-i2s-microphone": "Captures non-speech sound features.",
  "bme280-environment": "Measures temperature, humidity and air pressure.",
  "bh1750-light": "Measures ambient light.",
  "vl53l0x-distance": "Measures short-range distance.",
  "hc-sr501-pir": "Detects motion without recording images.",
  "capacitive-soil-moisture-v1-2": "Measures relative soil moisture.",
  "ssd1306-oled": "Shows readings, states and labelled data-collection status.",
  "active-buzzer": "Produces a simple audible status.",
  "momentary-buttons": "Provides a deliberate user input.",
  "hx711-load-cell": "Measures force or weight through the load cell.",
  "sgp30-air-quality": "Measures relative indoor air-quality signals.",
});

const LIBRARIES_BY_HARDWARE_ID = Object.freeze({
  "mpu6050-imu": ["Adafruit MPU6050", "Adafruit Unified Sensor"],
  "bme280-environment": ["Adafruit BME280 Library", "Adafruit Unified Sensor"],
  "bh1750-light": ["BH1750"],
  "vl53l0x-distance": ["Adafruit VL53L0X"],
  "ssd1306-oled": ["Adafruit GFX Library", "Adafruit SSD1306"],
  "hx711-load-cell": ["HX711 Arduino Library"],
  "sgp30-air-quality": ["Adafruit SGP30 Sensor"],
});

const CONNECTIONS_BY_HARDWARE_ID = Object.freeze({
  "mpu6050-imu": i2cConnections("MPU6050"),
  "bme280-environment": i2cConnections("BME280"),
  "bh1750-light": i2cConnections("BH1750"),
  "vl53l0x-distance": i2cConnections("VL53L0X"),
  "ssd1306-oled": i2cConnections("SSD1306", {
    sda: "GPIO10",
    scl: "GPIO11",
    busLabel: "secondary",
  }),
  "sgp30-air-quality": i2cConnections("SGP30"),
  "inmp441-i2s-microphone": Object.freeze([
    boardConnection("VDD", "3V3", "3.3 V microphone power", "3.3 V rail", "POWER"),
    boardConnection("GND", "GND", "Microphone ground", "Board ground", "GROUND"),
    boardConnection("SCK", "GPIO16", "I2S bit clock", "GPIO 16", "I2S BCLK"),
    boardConnection("WS", "GPIO17", "I2S word select", "GPIO 17", "I2S WS"),
    boardConnection("SD", "GPIO18", "I2S microphone data", "GPIO 18", "I2S DATA"),
    boardConnection(
      "L/R",
      "GND",
      "Left-channel select",
      "Board ground",
      "GROUND",
      "Tie L/R to GND so the firmware and wiring agree on the selected channel.",
    ),
  ]),
  "hc-sr501-pir": Object.freeze([
    boardConnection("VCC", "5V", "5 V module power", "USB-backed 5 V rail", "POWER"),
    boardConnection("GND", "GND", "PIR ground", "Board ground", "GROUND"),
    boardConnection("OUT", "GPIO7", "3.3 V-compatible motion output", "GPIO 7", "INPUT"),
  ]),
  "capacitive-soil-moisture-v1-2": Object.freeze([
    boardConnection("VCC", "3V3", "3.3 V sensor power", "3.3 V rail", "POWER"),
    boardConnection("GND", "GND", "Sensor ground", "Board ground", "GROUND"),
    boardConnection("AOUT", "GPIO1", "Analog moisture signal", "ADC GPIO 1", "ANALOG INPUT"),
  ]),
  "active-buzzer": Object.freeze([
    boardConnection("VCC", "3V3", "3.3 V buzzer power", "3.3 V rail", "POWER"),
    boardConnection("GND", "GND", "Buzzer ground", "Board ground", "GROUND"),
    boardConnection("SIG", "GPIO5", "Buzzer control", "GPIO 5", "OUTPUT"),
  ]),
  "momentary-buttons": Object.freeze([
    boardConnection("LEG-A", "GND", "Button return", "Board ground", "GROUND"),
    boardConnection(
      "LEG-B",
      "GPIO6",
      "Active-low button input",
      "GPIO 6 INPUT_PULLUP",
      "INPUT_PULLUP",
    ),
  ]),
  "hx711-load-cell": Object.freeze([
    boardConnection("VCC", "3V3", "3.3 V amplifier power", "3.3 V rail", "POWER"),
    boardConnection("GND", "GND", "Amplifier ground", "Board ground", "GROUND"),
    boardConnection("DT", "GPIO13", "Load-cell data", "GPIO 13", "INPUT"),
    boardConnection("SCK", "GPIO14", "Load-cell clock", "GPIO 14", "OUTPUT"),
  ]),
});

const OPERATING_GUIDES = Object.freeze({
  "environment-guardian": guide(
    "Watch the live room readings and the status output without making safety-critical claims.",
    [
      "Keep the assembled board connected over USB-C and allow the BME280 reading to settle.",
      "Warm the sensor gently with a nearby hand, without touching or breathing moisture onto it.",
      "Confirm that the serial reading changes and the status output follows the configured threshold.",
    ],
    "Did the reading and status output change together?",
    "temperature in °C, relative humidity in %, pressure in hPa",
  ),
  "motion-classifier": guide(
    "Verify the motion sensor and collect a balanced, labelled dataset for a later TinyML training stage.",
    [
      "Verify that stillness and deliberate movement produce distinct serial readings.",
      "Collect the same number of labelled windows for each chosen gesture and a neutral class.",
      "Review the captured counts and sensor ranges; this pilot does not claim that a model has been trained.",
    ],
    "Did every label receive balanced, visibly changing sensor samples without an inference claim?",
    "label, sample count and acceleration/rotation range",
  ),
  "proximity-presence": guide(
    "Demonstrate privacy-friendly presence and distance sensing without capturing images.",
    [
      "Keep the sensing area clear while the distance sensor starts.",
      "Move a hand or object slowly into the configured range.",
      "Confirm that presence, distance and the status output change without any image capture.",
    ],
    "Did proximity change the output without identifying or recording a person?",
    "distance in millimetres and presence state",
  ),
  "tabletop-machine": guide(
    "Verify the tabletop sensing, state-machine and manual-stop logic without energising a motor.",
    [
      "Use the IMU or distance input to enter the simulated movement state.",
      "Confirm that the OLED shows the current state and the serial log records the transition.",
      "Press the registered stop button and confirm the state returns to stopped.",
      "Treat all motors, drivers and autonomous movement as deferred until Acacia qualifies exact hardware.",
    ],
    "Did every simulated movement state stop immediately when the button was pressed?",
    "state transition and stop latency",
  ),
});

/**
 * Convert a validated routeAcaciaIdea value into a deterministic pilot build plan.
 * The function also accepts the { ok: true, value } result wrapper for API callers.
 */
export function createAcaciaBuildPlan(inputRoute) {
  const route = unwrapRoute(inputRoute);
  const routeIssues = validateAcaciaRoute(route);
  if (routeIssues.length) {
    throw new TypeError(
      `createAcaciaBuildPlan requires a valid Acacia route: ${routeIssues
        .map(({ code }) => code)
        .join(", ")}`,
    );
  }

  const selectedHardwareIds = selectedHardwareForRoute(route);
  assertSupportedProfiles(selectedHardwareIds);

  const parts = selectedHardwareIds.map(createPart);
  const rawConnections = registeredConnections(selectedHardwareIds);
  const wiringSteps = rawConnections.map((connection, index) =>
    createWiringStep(connection, index, parts),
  );
  const powerPlan = createPowerPlan();
  const diagnosticTests = createDiagnosticTests(
    selectedHardwareIds,
    wiringSteps,
    route,
  );
  const baseOperatingGuide =
    OPERATING_GUIDES[route.capabilityId] ||
    guide(
      "Operate the registered Acacia prototype once and compare the output with the serial evidence.",
      [
        "Keep the ESP32-S3 connected over USB-C.",
        "Trigger the registered input once.",
        "Confirm that the serial result and physical output agree.",
      ],
      "Did the registered input produce the intended bounded output?",
      "",
    );
  const difficultyProfile = createDifficultyProfile(route, selectedHardwareIds);
  const operatingGuide = createDifficultyOperatingGuide(
    baseOperatingGuide,
    difficultyProfile,
  );

  const plan = {
    schemaVersion: 2,
    verificationSource: "program_registry",
    projectTitle: route.projectTitle,
    summary:
      route.routeStatus === "reshaped" && route.preservation?.change
        ? `${route.supportedIdea} ${route.preservation.change}`
        : route.supportedIdea,
    difficultyProfile,
    boardProfile: createBoardProfile(wiringSteps),
    powerPlan,
    parts,
    preparation: createPreparation(selectedHardwareIds, wiringSteps),
    warnings: createWarnings(route),
    wiringSteps,
    diagnosticTests,
    operatingGuide,
    firmwareSpec: createFirmwareSpec(route, selectedHardwareIds, wiringSteps, diagnosticTests),
  };

  const planIssues = validateAcaciaBuildPlan(plan, route);
  if (planIssues.length) {
    throw new Error(
      `Generated Acacia build plan failed validation: ${planIssues
        .map(({ code }) => code)
        .join(", ")}`,
    );
  }
  return deepFreeze(plan);
}

/**
 * Validate the Acacia-specific invariants layered on the pilot schema.
 * Returns [] when the plan is safe and canonical.
 */
export function validateAcaciaBuildPlan(plan, inputRoute) {
  const issues = [];
  const route = unwrapRoute(inputRoute, { allowInvalid: true });
  const routeIssues = validateAcaciaRoute(route);
  issues.push(
    ...routeIssues.map(({ code, path, message, detail }) =>
      issue(
        `route-${code}`,
        `route.${path || "route"}`,
        message || detail || "The source route is invalid.",
      ),
    ),
  );

  if (!plan || typeof plan !== "object" || Array.isArray(plan)) {
    return [...issues, issue("invalid-plan", "plan", "The build plan must be an object.")];
  }
  if (plan.schemaVersion !== 2) {
    issues.push(issue("wrong-schema-version", "schemaVersion", "Build plan schemaVersion must be 2."));
  }
  if (plan.verificationSource !== "program_registry") {
    issues.push(
      issue(
        "wrong-verification-source",
        "verificationSource",
        'Acacia build plans must use "program_registry".',
      ),
    );
  }
  if (plan.boardProfile?.profileId !== ACACIA_BOARD_ID) {
    issues.push(
      issue(
        "wrong-board-profile",
        "boardProfile.profileId",
        `The fixed board profile must be "${ACACIA_BOARD_ID}".`,
      ),
    );
  }
  if (
    plan.boardProfile?.model !== BOARD_MODEL ||
    plan.boardProfile?.usbConnector !== BOARD_REGISTRY.profile.usbConnector ||
    plan.boardProfile?.supportStatus !== "compatible_with_differences" ||
    plan.boardProfile?.identityConfidence !== null
  ) {
    issues.push(
      issue(
        "wrong-board-identity",
        "boardProfile",
        `The board must use the documented ${BOARD_MODEL} profile without claiming bench-validated exact support.`,
      ),
    );
  }

  const expectedHardwareIds =
    routeIssues.length === 0 ? selectedHardwareForRoute(route) : [];
  const expectedDifficulty =
    routeIssues.length === 0 ? DIFFICULTY_PROFILES[route.difficulty] : null;
  if (
    expectedDifficulty &&
    (plan.difficultyProfile?.id !== route.difficulty ||
      plan.difficultyProfile?.focus !== expectedDifficulty.focus ||
      !arraysEqual(
        plan.difficultyProfile?.milestones,
        expectedDifficulty.milestones,
      ) ||
      !arraysEqual(
        plan.difficultyProfile?.requiredHardwareIds,
        expectedHardwareIds,
      ))
  ) {
    issues.push(
      issue(
        "wrong-difficulty-profile",
        "difficultyProfile",
        "The build milestones and hardware must match the selected Acacia difficulty.",
      ),
    );
  }
  const parts = Array.isArray(plan.parts) ? plan.parts : [];
  const partIds = parts.map(({ id } = {}) => clean(id));
  if (!Array.isArray(plan.parts)) {
    issues.push(issue("missing-parts", "parts", "parts must be an array."));
  }
  if (new Set(partIds).size !== partIds.length) {
    issues.push(issue("duplicate-parts", "parts", "Every plan part ID must be unique."));
  }
  for (const [index, part] of parts.entries()) {
    if (!getAcaciaHardware(part?.id)) {
      issues.push(
        issue(
          "unregistered-part",
          `parts[${index}].id`,
          `"${clean(part?.id)}" is not in the Acacia registry.`,
        ),
      );
    }
    if (Object.prototype.hasOwnProperty.call(part || {}, "bbox")) {
      issues.push(
        issue(
          "fabricated-part-bbox",
          `parts[${index}].bbox`,
          "Registry plans must not fabricate photo coordinates.",
        ),
      );
    }
  }
  const i2cAddresses = new Map();
  for (const part of parts) {
    const address = clean(part?.configuredI2cAddress).toUpperCase();
    if (!address) continue;
    const previousPartId = i2cAddresses.get(address);
    if (previousPartId) {
      issues.push(
        issue(
          "i2c-address-conflict",
          "parts",
          `"${previousPartId}" and "${part.id}" both use ${address}; the Acacia profile will not place them on one shared I2C bus.`,
        ),
      );
    } else {
      i2cAddresses.set(address, part.id);
    }
  }
  if (
    expectedHardwareIds.length &&
    !arraysEqual(partIds, expectedHardwareIds)
  ) {
    issues.push(
      issue(
        "wrong-hardware-selection",
        "parts",
        "The build plan must contain all required route hardware and at most its one selected optional output.",
      ),
    );
  }

  const steps = Array.isArray(plan.wiringSteps) ? plan.wiringSteps : [];
  if (!Array.isArray(plan.wiringSteps)) {
    issues.push(issue("missing-wiring", "wiringSteps", "wiringSteps must be an array."));
  }
  const connectionIds = new Set();
  for (const [index, step] of steps.entries()) {
    if (step?.order !== index + 1 || step?.connectionNumber !== index + 1) {
      issues.push(
        issue(
          "noncanonical-wiring-order",
          `wiringSteps[${index}]`,
          "Wiring order and connection number must be sequential.",
        ),
      );
    }
    if (!clean(step?.connectionId) || connectionIds.has(step.connectionId)) {
      issues.push(
        issue(
          "invalid-connection-id",
          `wiringSteps[${index}].connectionId`,
          "Every wiring connection needs a unique stable ID.",
        ),
      );
    }
    connectionIds.add(step?.connectionId);
    if (step?.pinLocationsConfirmed !== false) {
      issues.push(
        issue(
          "fabricated-pin-confirmation",
          `wiringSteps[${index}].pinLocationsConfirmed`,
          "Registry wiring names pins but does not claim photo-confirmed locations.",
        ),
      );
    }
    if (
      Object.prototype.hasOwnProperty.call(step || {}, "fromPinBbox") ||
      Object.prototype.hasOwnProperty.call(step || {}, "toPinBbox")
    ) {
      issues.push(
        issue(
          "fabricated-pin-bbox",
          `wiringSteps[${index}]`,
          "Registry wiring must omit photo pin coordinates.",
        ),
      );
    }
    if (!partIds.includes(step?.fromPartId) || !partIds.includes(step?.toPartId)) {
      issues.push(
        issue(
          "unknown-wiring-part",
          `wiringSteps[${index}]`,
          "Both connection endpoints must be registered parts selected by the route.",
        ),
      );
    }
    for (const requiredPartId of step?.requiredPartIds || []) {
      if (!partIds.includes(requiredPartId)) {
        issues.push(
          issue(
            "unknown-required-part",
            `wiringSteps[${index}].requiredPartIds`,
            `"${requiredPartId}" is not selected for this build.`,
          ),
        );
      }
    }
    if (
      step?.toPartId === ACACIA_BOARD_ID &&
      UNSAFE_BOARD_PINS.has(canonicalPin(step?.toPrintedPin))
    ) {
      issues.push(
        issue(
          "unsafe-board-pin",
          `wiringSteps[${index}].toPrintedPin`,
          `${step.toPrintedPin} is reserved or startup-sensitive in the fixed Acacia profile.`,
        ),
      );
    }
  }

  const nonSupportPartIds = parts
    .filter((part) => !SUPPORT_KINDS.has(getAcaciaHardware(part.id)?.kind))
    .map(({ id }) => id);
  for (const partId of nonSupportPartIds) {
    if (
      !steps.some(
        ({ fromPartId, toPartId }) => fromPartId === partId || toPartId === partId,
      )
    ) {
      issues.push(
        issue(
          "unwired-required-hardware",
          "wiringSteps",
          `"${partId}" is selected but has no registered connection.`,
        ),
      );
    }
  }

  const powerPlan = plan.powerPlan || {};
  if (
    powerPlan.externalPowerRequired !== false ||
    powerPlan.mode !== "usb_board_power" ||
    powerPlan.reason !== "ordinary_low_current" ||
    powerPlan.keepUsbConnected !== true ||
    !arraysEqual(powerPlan.highCurrentPartIds, []) ||
    !arraysEqual(powerPlan.highCurrentLoads, []) ||
    !arraysEqual(powerPlan.externalSupplyPartIds, []) ||
    !arraysEqual(powerPlan.externalSupplies, [])
  ) {
    issues.push(
      issue(
        "wrong-power-mode",
        "powerPlan",
        "Acacia v1 routes must remain within the registered USB-powered sensor and local-feedback profile.",
      ),
    );
  }

  if (!plan.preparation || !arraysEqual(plan.preparation.requiredPartIds, partIds)) {
    issues.push(
      issue(
        "wrong-preparation-parts",
        "preparation.requiredPartIds",
        "Preparation must list the selected registered parts in canonical order.",
      ),
    );
  }
  if (
    !Array.isArray(plan.diagnosticTests) ||
    !plan.diagnosticTests.length ||
    !Array.isArray(plan.firmwareSpec?.serialProtocol)
  ) {
    issues.push(
      issue(
        "missing-diagnostics",
        "diagnosticTests",
        "The plan needs deterministic serial diagnostics.",
      ),
    );
  } else {
    for (const [index, diagnostic] of plan.diagnosticTests.entries()) {
      if (
        !clean(diagnostic.expectedSerial) ||
        !plan.firmwareSpec.serialProtocol.includes(diagnostic.expectedSerial)
      ) {
        issues.push(
          issue(
            "diagnostic-protocol-mismatch",
            `diagnosticTests[${index}].expectedSerial`,
            "Every expected diagnostic marker must be in firmwareSpec.serialProtocol.",
          ),
        );
      }
      if (
        diagnostic.connectionId &&
        !connectionIds.has(diagnostic.connectionId)
      ) {
        issues.push(
          issue(
            "diagnostic-connection-mismatch",
            `diagnosticTests[${index}].connectionId`,
            "A diagnostic connectionId must name a generated wiring step.",
          ),
        );
      }
    }
  }

  const assignments = Array.isArray(plan.firmwareSpec?.pinAssignments)
    ? plan.firmwareSpec.pinAssignments
    : [];
  if (
    plan.firmwareSpec?.board !==
    `${BOARD_MODEL} (${BOARD_FQBN})`
  ) {
    issues.push(
      issue(
        "wrong-firmware-board",
        "firmwareSpec.board",
        "The firmware target must be the fixed ESP32-S3 N16R8 board.",
      ),
    );
  }
  for (const [index, assignment] of assignments.entries()) {
    if (UNSAFE_BOARD_PINS.has(canonicalPin(assignment?.label))) {
      issues.push(
        issue(
          "unsafe-firmware-pin",
          `firmwareSpec.pinAssignments[${index}].label`,
          `${assignment.label} is not available to Acacia application firmware.`,
        ),
      );
    }
  }
  return dedupeIssues(issues);
}

function selectedHardwareForRoute(route) {
  return unique(route.hardware.requiredIds);
}

function assertSupportedProfiles(hardwareIds) {
  for (const hardwareId of hardwareIds) {
    const hardware = getAcaciaHardware(hardwareId);
    if (!hardware) {
      throw new TypeError(`Acacia hardware "${hardwareId}" is not registered.`);
    }
    if (
      !SUPPORT_KINDS.has(hardware.kind) &&
      !CONNECTIONS_BY_HARDWARE_ID[hardwareId]
    ) {
      throw new Error(`Acacia hardware "${hardwareId}" has no fixed wiring profile.`);
    }
  }
}

function createPart(hardwareId) {
  const hardware = getAcaciaHardware(hardwareId);
  return {
    id: hardware.id,
    name: hardware.label,
    type: hardware.kind,
    confidence: null,
    pool: hardware.pool,
    role: ROLE_BY_HARDWARE_ID[hardware.id] || "Supports the registered Acacia build.",
    profileId: hardware.id,
    compatibilityStatus: "compatible_with_differences",
    connectorType: hardware.interface,
    ...(hardware.configuredI2cAddress
      ? { configuredI2cAddress: hardware.configuredI2cAddress }
      : {}),
  };
}

function registeredConnections(hardwareIds) {
  const connections = [];
  for (const hardwareId of hardwareIds) {
    for (const descriptor of CONNECTIONS_BY_HARDWARE_ID[hardwareId] || []) {
      connections.push({
        ...descriptor,
        fromPartId: hardwareId,
        toPartId: ACACIA_BOARD_ID,
      });
    }
  }
  return connections;
}

function createWiringStep(connection, index, parts) {
  const fromPart = parts.find(({ id }) => id === connection.fromPartId);
  const toPart = parts.find(({ id }) => id === connection.toPartId);
  const wireColor =
    connection.mode === "POWER"
      ? "red"
      : connection.mode === "GROUND"
        ? "black"
        : WIRE_COLORS[index % WIRE_COLORS.length];
  const wireType = "male-to-male jumper wire";
  const connectionId = [
    connection.fromPartId,
    connection.fromPin,
    connection.toPartId,
    connection.toPin,
  ]
    .map(slug)
    .join("--");
  const action = `Connect the ${wireColor} ${wireType} from ${fromPart.name} ${connection.fromPin} to ${toPart.name} ${connection.toPin}.`;
  return {
    order: index + 1,
    connectionId,
    connectionNumber: index + 1,
    title: `Connect ${connection.fromPin} to ${connection.toPin}`,
    action,
    instruction: action,
    from: `${fromPart.name} ${connection.fromPin}`,
    to: `${toPart.name} ${connection.toPin}`,
    fromPartId: connection.fromPartId,
    toPartId: connection.toPartId,
    pin: connection.toPin,
    fromPrintedPin: connection.fromPin,
    toPrintedPin: connection.toPin,
    fromElectricalAlias: connection.fromAlias,
    toElectricalAlias: connection.toAlias,
    pinLocationsConfirmed: false,
    wireColor,
    wireType,
    quickCheck: `With all power disconnected, confirm ${connection.fromPin} and ${connection.toPin} match the printed labels.`,
    check: `With all power disconnected, confirm ${connection.fromPin} and ${connection.toPin} match the printed labels.`,
    why:
      connection.why ||
      `${connection.mode} is the registered interface for this fixed Acacia hardware profile.`,
    warning: connection.warning || "",
    requiredPartIds: [connection.fromPartId, connection.toPartId],
    accessibilityRank: index + 1,
  };
}

function createBoardProfile(wiringSteps) {
  const usedLabels = wiringSteps
    .filter(({ toPartId }) => toPartId === ACACIA_BOARD_ID)
    .map(({ toPrintedPin }) => toPrintedPin);
  return {
    profileId: ACACIA_BOARD_ID,
    manufacturer: BOARD_REGISTRY.profile.manufacturer,
    model: BOARD_MODEL,
    revision: `${BOARD_REGISTRY.profile.carrierRevision}; bench validation pending`,
    identityConfidence: null,
    supportStatus: "compatible_with_differences",
    usbConnector: BOARD_REGISTRY.profile.usbConnector,
    resetLabel: "RESET",
    bootLabel: "BOOT",
    printedLabels: unique([
      "3V3",
      "5V",
      "GND",
      "RST",
      "RESET",
      "BOOT",
      ...usedLabels,
    ]),
  };
}

function createPowerPlan() {
  return {
    mode: "usb_board_power",
    reason: "ordinary_low_current",
    boardRail:
      "USB-C powers the ESP32-S3 and the registered low-current sensor and local-feedback modules.",
    highCurrentPartIds: [],
    highCurrentLoads: [],
    externalSupplyPartIds: [],
    externalSupplies: [],
    externalPowerRequired: false,
    explanation:
      "The USB-C data cable powers this bounded sensor-and-feedback build. No battery or separate actuator supply is part of Acacia v1.",
    keepUsbConnected: true,
  };
}

function createPreparation(hardwareIds, wiringSteps) {
  return {
    orientation:
      "Disconnect USB-C. Place the ESP32-S3 across the breadboard centre gap, keep the antenna end clear, and keep every module label and printed pin name visible.",
    usbCable:
      "the registered USB-C data cable (not a charge-only cable)",
    requiredPartIds: [...hardwareIds],
    wires: wiringSteps.map(({ connectionId, wireColor, wireType }) => ({
      connectionId,
      color: wireColor,
      connectorType: wireType,
      quantity: 1,
    })),
  };
}

function createDiagnosticTests(hardwareIds, wiringSteps, route) {
  const diagnostics = [
    {
      name: "ESP32-S3 board identity",
      purpose: "Confirm the fixed N16R8 firmware target booted over USB-C.",
      userAction: "Connect the registered USB-C data cable and press RESET once.",
      expectedSerial: "ACACIA:BOARD:READY",
      failureTitle: "The fixed ESP32-S3 profile did not start.",
      recoveryAction:
        "Confirm the cable carries data, select the ESP32-S3 port, press RESET once and retry.",
      connectionId: "",
    },
  ];
  for (const hardwareId of hardwareIds) {
    const hardware = getAcaciaHardware(hardwareId);
    if (!hardware || SUPPORT_KINDS.has(hardware.kind)) continue;
    const related = wiringSteps.find(
      ({ fromPartId, toPartId }) =>
        fromPartId === hardwareId || toPartId === hardwareId,
    );
    diagnostics.push({
      name: `${hardware.label} diagnostic`,
      purpose: `Confirm the registered ${hardware.label} responds before the complete behavior runs.`,
      userAction: diagnosticAction(hardwareId),
      expectedSerial: `ACACIA:${diagnosticToken(hardwareId)}:OK`,
      failureTitle: `${hardware.label} did not pass its registered diagnostic.`,
      recoveryAction: related
        ? `Disconnect power and recheck ${related.fromPrintedPin} → ${related.toPrintedPin}, then retry.`
        : "Disconnect power, recheck the registered connection and retry.",
      connectionId: related?.connectionId || "",
    });
  }
  diagnostics.push({
    name: `${capitalize(route.difficulty)} track readiness`,
    purpose: DIFFICULTY_PROFILES[route.difficulty].focus,
    userAction: DIFFICULTY_PROFILES[route.difficulty].milestones.at(-1),
    expectedSerial: `ACACIA:TRACK:${route.difficulty.toUpperCase()}:READY`,
    failureTitle: `${capitalize(route.difficulty)} track evidence is incomplete.`,
    recoveryAction:
      "Return to the selected track milestones, complete the missing evidence, and retry.",
    connectionId: "",
  });
  return diagnostics;
}

function createFirmwareSpec(route, hardwareIds, wiringSteps, diagnosticTests) {
  const libraries = unique(
    hardwareIds.flatMap((hardwareId) => LIBRARIES_BY_HARDWARE_ID[hardwareId] || []),
  );
  const assignmentByLabel = new Map();
  for (const step of wiringSteps) {
    if (step.toPartId !== ACACIA_BOARD_ID) continue;
    const gpio = gpioNumber(step.toPrintedPin);
    if (gpio === null) continue;
    const previous = assignmentByLabel.get(step.toPrintedPin);
    const purpose = `${getAcaciaHardware(step.fromPartId)?.label || step.fromPartId}: ${step.fromElectricalAlias}`;
    if (previous) {
      previous.purpose = unique([...previous.purpose.split("; "), purpose]).join("; ");
      continue;
    }
    assignmentByLabel.set(step.toPrintedPin, {
      label: step.toPrintedPin,
      gpio,
      mode: firmwarePinMode(step.toElectricalAlias, step.fromElectricalAlias),
      purpose,
    });
  }

  return {
    board: `${BOARD_MODEL} (${BOARD_FQBN})`,
    behavior: `${route.supportedIdea} Use only the registered pins and emit a diagnostic marker before entering the application loop. ${difficultyBehavior(route.difficulty)}`,
    libraries: unique(libraries),
    pinAssignments: [...assignmentByLabel.values()],
    serialProtocol: diagnosticTests.map(({ expectedSerial }) => expectedSerial),
  };
}

function createDifficultyProfile(route, hardwareIds) {
  const profile = DIFFICULTY_PROFILES[route.difficulty];
  return {
    id: route.difficulty,
    label: profile.label,
    recommended: route.difficulty === route.recommendedDifficulty,
    focus: profile.focus,
    milestones: [...profile.milestones],
    requiredHardwareIds: [...hardwareIds],
  };
}

function createDifficultyOperatingGuide(baseGuide, difficultyProfile) {
  return {
    ...baseGuide,
    summary: `${baseGuide.summary} ${difficultyProfile.focus}`,
    steps: unique([...baseGuide.steps, ...difficultyProfile.milestones]),
    successQuestion: `${baseGuide.successQuestion} Did you also complete the ${difficultyProfile.label} evidence milestones?`,
  };
}

function difficultyBehavior(difficulty) {
  return DIFFICULTY_PROFILES[difficulty]?.firmwareBehavior || "";
}

function createWarnings(route) {
  const warnings = [
    "Use low-voltage registered hardware only; never connect exposed mains wiring.",
    "The ESP32-S3 GPIO level is 3.3 V. Do not apply 5 V to a GPIO pin.",
    "Disconnect USB-C before changing wires.",
    ...route.warnings.map(({ message }) => message),
  ];
  if (route.routeStatus === "reshaped" && route.preservation?.change) {
    warnings.push(`Idea reshaped: ${route.preservation.change}`);
  }
  return unique(warnings);
}

function i2cConnections(
  label,
  {
    warning = "",
    sda = "GPIO8",
    scl = "GPIO9",
    busLabel = "primary",
  } = {},
) {
  return Object.freeze([
    boardConnection("VCC", "3V3", `3.3 V ${label} power`, "3.3 V rail", "POWER", "", warning),
    boardConnection("GND", "GND", `${label} ground`, "Board ground", "GROUND"),
    boardConnection(
      "SDA",
      sda,
      `${label} ${busLabel} I2C data`,
      `${busLabel} I2C SDA on ${sda.replace("GPIO", "GPIO ")}`,
      "I2C SDA",
    ),
    boardConnection(
      "SCL",
      scl,
      `${label} ${busLabel} I2C clock`,
      `${busLabel} I2C SCL on ${scl.replace("GPIO", "GPIO ")}`,
      "I2C SCL",
    ),
  ]);
}

function boardConnection(
  fromPin,
  toPin,
  fromAlias,
  toAlias,
  mode,
  why = "",
  warning = "",
) {
  return Object.freeze({
    fromPin,
    toPin: printedBoardLabel(toPin),
    fromAlias,
    toAlias,
    mode,
    why,
    warning,
  });
}

function guide(summary, steps, successQuestion, unit) {
  return Object.freeze({
    summary,
    steps: Object.freeze([...steps]),
    successQuestion,
    unit,
    resetInstruction:
      "If the project stops updating, press RESET once—not BOOT—and watch the USB serial diagnostic again.",
  });
}

function firmwarePinMode(toAlias, fromAlias) {
  const text = `${toAlias} ${fromAlias}`.toUpperCase();
  if (text.includes("INPUT_PULLUP") || text.includes("PULL-UP")) return "INPUT_PULLUP";
  if (text.includes("ANALOG")) return "INPUT";
  if (text.includes("I2C SDA")) return "I2C SDA";
  if (text.includes("I2C SCL")) return "I2C SCL";
  if (text.includes("I2S BCLK") || text.includes("I2S BIT CLOCK")) return "I2S BCLK";
  if (
    text.includes("I2S WS") ||
    text.includes("I2S WORD SELECT") ||
    text.includes("I2S LRC")
  ) return "I2S WS";
  if (text.includes("I2S")) return "I2S DATA";
  if (text.includes("PWM")) return "OUTPUT";
  if (text.includes("INPUT")) return "INPUT";
  return "OUTPUT";
}

function diagnosticAction(hardwareId) {
  if (hardwareId === "mpu6050-imu") return "Hold the board still, then tilt it gently once.";
  if (hardwareId === "inmp441-i2s-microphone") return "Make one short non-speech sound near the microphone.";
  if (hardwareId === "hc-sr501-pir") return "Move once across the PIR field of view.";
  if (hardwareId === "vl53l0x-distance") return "Move a flat object through the sensing range.";
  if (hardwareId === "momentary-buttons") return "Press and release one registered button.";
  return "Run this part's registered one-step diagnostic.";
}

function diagnosticToken(hardwareId) {
  return hardwareId.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
}

function gpioNumber(label) {
  const match = canonicalPin(label).match(/^GPIO(\d+)$/);
  return match ? Number(match[1]) : null;
}

function canonicalPin(value) {
  const normalized = clean(value).toUpperCase().replace(/\s+/g, "");
  return /^\d+$/.test(normalized) ? `GPIO${normalized}` : normalized;
}

function printedBoardLabel(value) {
  const normalized = clean(value).toUpperCase().replace(/\s+/g, "");
  const match = normalized.match(/^GPIO(\d+)$/);
  return match ? match[1] : clean(value);
}

function unwrapRoute(inputRoute, { allowInvalid = false } = {}) {
  if (
    inputRoute &&
    typeof inputRoute === "object" &&
    inputRoute.ok === true &&
    inputRoute.value
  ) {
    return inputRoute.value;
  }
  if (!allowInvalid && inputRoute?.ok === false) {
    throw new TypeError("Cannot create a build plan from a rejected Acacia route.");
  }
  return inputRoute;
}

function issue(code, path, message) {
  return Object.freeze({ code, path, message });
}

function dedupeIssues(issues) {
  const seen = new Set();
  return issues.filter((entry) => {
    const key = `${entry.code}|${entry.path}|${entry.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function arraysEqual(left, right) {
  return (
    Array.isArray(left) &&
    Array.isArray(right) &&
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function unique(values) {
  return [...new Set(values)];
}

function slug(value) {
  return clean(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function clean(value) {
  return String(value || "").trim();
}

function capitalize(value) {
  const text = clean(value);
  return text ? `${text[0].toUpperCase()}${text.slice(1)}` : "";
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}
