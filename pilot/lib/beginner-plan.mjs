const DEFAULT_WIRE_COLORS = Object.freeze([
  "orange",
  "yellow",
  "green",
  "blue",
  "purple",
  "red",
  "black",
  "white",
  "brown",
  "gray",
]);

const ESP32_BOOT_RISK_LABELS = new Set(["D0", "D2", "D12", "D15", "GPIO0", "GPIO2", "GPIO12", "GPIO15"]);
const SHAREABLE_POWER_LABELS = new Set(["GND", "3V3", "3.3V", "VIN", "5V"]);
const HIGH_CURRENT_LOAD_PATTERN = /\b(?:motor|servo|pump|solenoid|heater|heating element|led strip|ws2812\w*|neopixel\w*|led matrix|high[- ]power led|amplifier|powered speaker|fan|blower|electromagnet|high[- ]current relay load|mains|12\s*v|24\s*v)\b/i;
const ORDINARY_LOW_CURRENT_PART_PATTERN = /\b(?:esp32|microcontroller|controller|dev(?:elopment)?\s*(?:board|kit)|sensor|pir|hc[- ]?sr04|ultrasonic|display|screen|indicator|led|buzzer|relay|button|switch)\b/i;
const STANDALONE_POWER_SOURCE_PATTERN = /\b(?:batter(?:y|ies)|power bank|external power supply|dc power supply|buck converter|boost converter|step[- ]down converter|voltage regulator)\b/i;
const UNTETHERED_PROJECT_PATTERN = /\b(?:battery[- ]powered|portable|untethered|cordless|wearable)\b/i;

export const ESP32_IDENTITY_CONFIDENCE_THRESHOLD = 0.55;

export function esp32IdentityAssessment(plan = {}) {
  const parts = Array.isArray(plan.parts) ? plan.parts : [];
  const registrySourced = plan.verificationSource === "program_registry";
  const candidates = parts.filter((part) => /esp32/i.test(`${part?.name || ""} ${part?.type || ""}`));
  const candidate = candidates
    .slice()
    .sort((left, right) => {
      const controllerRank = esp32ControllerRank(right, plan.boardProfile) - esp32ControllerRank(left, plan.boardProfile);
      return controllerRank || finite(right?.confidence, 0) - finite(left?.confidence, 0);
    })[0] || null;
  const confidence = normalizedConfidence(plan.boardProfile?.identityConfidence);
  const thresholdPercent = Math.round(ESP32_IDENTITY_CONFIDENCE_THRESHOLD * 100);
  const percent = confidence === null ? null : Math.round(confidence * 1000) / 10;
  const reason = !candidate
    ? "missing-candidate"
    : registrySourced
      ? "registry-sourced"
      : confidence === null
        ? "missing-score"
        : confidence < ESP32_IDENTITY_CONFIDENCE_THRESHOLD
          ? "below-threshold"
          : "accepted";
  return {
    candidate,
    confidence,
    percent,
    threshold: ESP32_IDENTITY_CONFIDENCE_THRESHOLD,
    thresholdPercent,
    accepted: reason === "accepted" || reason === "registry-sourced",
    verificationSource: registrySourced ? "program_registry" : "photo",
    reason,
  };
}

export function normalizeBeginnerPlan(plan = {}, options = {}) {
  const rawSteps = Array.isArray(plan.wiringSteps) ? plan.wiringSteps : [];
  const wiringSteps = rawSteps
    .map((step, index) => normalizeStep(step, index))
    .sort((left, right) => {
      const accessibility = left.accessibilityRank - right.accessibilityRank;
      return accessibility || left.order - right.order;
    })
    .map((step, index) => ({
      ...step,
      order: index + 1,
      connectionNumber: index + 1,
      connectionId: step.connectionId || `connection-${index + 1}`,
    }));

  const connectionIds = new Set(wiringSteps.map(({ connectionId }) => connectionId));
  const diagnosticTests = (Array.isArray(plan.diagnosticTests) ? plan.diagnosticTests : []).map(
    (test, index) => ({
      name: clean(test?.name, `Check ${index + 1}`),
      purpose: clean(test?.purpose, "Confirm this part is responding."),
      userAction: clean(test?.userAction, "Operate the project once."),
      expectedSerial: clean(test?.expectedSerial, "READY"),
      failureTitle: clean(test?.failureTitle, "The expected board message was not detected."),
      recoveryAction: clean(test?.recoveryAction, "Check the related connection, then retry."),
      connectionId: connectionIds.has(clean(test?.connectionId)) ? clean(test.connectionId) : "",
    }),
  );

  return {
    ...plan,
    schemaVersion: 2,
    boardProfile: normalizeBoardProfile(plan.boardProfile),
    powerPlan: normalizePowerPlan(plan.powerPlan, plan, options),
    preparation: normalizePreparation(plan.preparation, wiringSteps),
    wiringSteps,
    diagnosticTests,
    operatingGuide: normalizeOperatingGuide(plan.operatingGuide),
    warnings: Array.isArray(plan.warnings) ? plan.warnings.map((value) => clean(value)).filter(Boolean) : [],
  };
}

export function isStandalonePowerSourcePart(part = {}) {
  const identityText = `${part?.name || ""} ${part?.type || ""}`;
  if (HIGH_CURRENT_LOAD_PATTERN.test(identityText) && !/\b(?:12\s*v|24\s*v)\b/i.test(identityText)) return false;
  return STANDALONE_POWER_SOURCE_PATTERN.test(identityText);
}

export function validateBeginnerPlan(plan = {}) {
  const issues = [];
  const registrySourced = plan.verificationSource === "program_registry";
  const parts = Array.isArray(plan.parts) ? plan.parts : [];
  const normalizedPartIds = parts.map((part) => clean(part?.id));
  const partIds = new Set(normalizedPartIds.filter(Boolean));
  const partsById = new Map(parts.map((part) => [clean(part?.id), part]).filter(([partId]) => partId));
  const steps = Array.isArray(plan.wiringSteps) ? plan.wiringSteps : [];
  const usedTargetPins = new Map();
  const usedColors = new Map();
  const usedConnectionIds = new Set();

  normalizedPartIds.forEach((partId, index) => {
    if (!partId) {
      issues.push(issue("block", "missing-part-id", `Confirmed part ${index + 1} needs a stable non-empty id.`));
      return;
    }
    if (normalizedPartIds.indexOf(partId) !== index) {
      issues.push(issue("block", "duplicate-part-id", `The part id ${partId} is used more than once.`));
    }
  });

  const boardIdentity = esp32IdentityAssessment(plan);
  if (boardIdentity.reason === "missing-candidate") {
    const message = boardIdentity.percent === null
      ? "I could not identify a visible ESP32 or calculate a board-family confidence score. Show the ESP32 marking or metal radio module and try again."
      : `ESP32-family score: ${boardIdentity.percent}%, but I could not confirm which visible part is the ESP32. Show the ESP32 marking or metal radio module and try again.`;
    issues.push(
      issue(
        "block",
        "missing-esp32",
        message,
      ),
    );
  } else if (boardIdentity.reason === "missing-score") {
    issues.push(
      issue(
        "block",
        "missing-esp32-confidence",
        `I found a possible ESP32, but I could not calculate its identity confidence. I need a scored match of at least ${boardIdentity.thresholdPercent}% to continue.`,
      ),
    );
  } else if (boardIdentity.reason === "below-threshold") {
    issues.push(
      issue(
        "block",
        "low-esp32-confidence",
        `ESP32 match: ${boardIdentity.percent}%. I need at least ${boardIdentity.thresholdPercent}% to continue. Show the ESP32 label, metal radio module, USB connector, and both board buttons, then retry.`,
      ),
    );
  }

  if (plan.boardProfile?.supportStatus === "unverified") {
    const identityPrefix = boardIdentity.accepted
      ? `The ESP32 identity check passed at ${boardIdentity.percent}%, but `
      : "";
    issues.push(
      issue(
        "warn",
        "unverified-board",
        `${identityPrefix}this exact board layout is not verified yet. You can continue by matching the printed labels on your board; use a clearer photo if any label differs from the guide.`,
      ),
    );
  }

  if (!steps.length && planNeedsExternalWiring(plan, parts)) {
    issues.push(
      issue(
        "block",
        "missing-wiring-steps",
        registrySourced
          ? "This registered kit path needs external wiring, but it has no validated connection steps. Makeable will not invent the missing connections."
          : "I recognized parts that need wiring, but I could not confirm any safe connection steps. Take one closer photo with both wire ends and the printed pin labels visible; I will not invent the missing connections.",
      ),
    );
  }

  for (const step of steps) {
    const connectionId = clean(step.connectionId);
    if (!connectionId || step.connectionIdConfirmed === false) {
      issues.push(
        issue(
          "block",
          "missing-connection-id",
          `Connection ${step.connectionNumber || step.order} needs a stable non-empty id.`,
        ),
      );
    } else if (usedConnectionIds.has(connectionId)) {
      issues.push(
        issue(
          "block",
          "duplicate-connection-id",
          `The connection id ${connectionId} is used more than once, so the build cannot track both wires safely.`,
          connectionId,
        ),
      );
    } else {
      usedConnectionIds.add(connectionId);
    }
    const fromPin = canonicalPin(step.fromPrintedPin || step.from);
    const toPin = canonicalPin(step.toPrintedPin || step.pin || step.to);
    const action = clean(step.action || step.instruction);
    const normalizedAction = action.toUpperCase();
    const requiredPartIds = Array.isArray(step.requiredPartIds) ? step.requiredPartIds : [];
    const fromPartId = clean(step.fromPartId);
    const toPartId = clean(step.toPartId);
    const fromPart = fromPartId ? partsById.get(fromPartId) : null;
    const toPart = toPartId ? partsById.get(toPartId) : null;

    for (const partId of requiredPartIds) {
      if (partId && !partIds.has(partId)) {
        issues.push(
          issue(
            "block",
            "missing-required-part",
            `Connection ${step.connectionNumber || step.order} needs a part that was not confirmed: ${partId}.`,
            connectionId,
          ),
        );
      }
    }

    if (!fromPin || !toPin || !actionNamesExactPin(normalizedAction, fromPin) || !actionNamesExactPin(normalizedAction, toPin)) {
      issues.push(
        issue(
          "block",
          "imprecise-labels",
          `Connection ${step.connectionNumber || step.order} must name both printed pin labels in the action.`,
          connectionId,
        ),
      );
    }

    if (
      !registrySourced &&
      (
        step.pinLocationsConfirmed !== true ||
        !isConfirmedPinBox(step.fromPinBbox) ||
        !isConfirmedPinBox(step.toPinBbox)
      )
    ) {
      issues.push(
        issue(
          "warn",
          "unconfirmed-pin-location",
          `I could not place both photo markers confidently for connection ${step.connectionNumber || step.order}. You can continue by matching the two printed pin labels carefully.`,
          connectionId,
        ),
      );
    } else if (!registrySourced) {
      if (!fromPart || !toPart) {
        issues.push(
          issue(
            "warn",
            "unknown-pin-part",
            `The photo markers for connection ${step.connectionNumber || step.order} could not be tied to both parts. Match the named parts and printed labels before connecting.`,
            connectionId,
          ),
        );
      } else if (
        !pinBoxBelongsToPart(step.fromPinBbox, fromPart.bbox) ||
        !pinBoxBelongsToPart(step.toPinBbox, toPart.bbox)
      ) {
        issues.push(
          issue(
            "warn",
            "pin-outside-part",
            `A photo marker for connection ${step.connectionNumber || step.order} landed outside the part. Treat the marker as approximate and follow the printed pin label.`,
            connectionId,
          ),
        );
      }

      if (boxesAreEffectivelyIdentical(step.fromPinBbox, step.toPinBbox)) {
        issues.push(
          issue(
            "warn",
            "identical-pin-locations",
            `The two markers for connection ${step.connectionNumber || step.order} overlap. Use the named printed label at each end rather than the marker position.`,
            connectionId,
          ),
        );
      }
    }

    if (!clean(step.wireType)) {
      issues.push(
        issue(
          "warn",
          "missing-wire-type",
          `Connection ${step.connectionNumber || step.order} does not identify the jumper connector type. Check that each wire end physically fits before continuing.`,
          connectionId,
        ),
      );
    }

    if (ESP32_BOOT_RISK_LABELS.has(toPin)) {
      issues.push(
        issue(
          "warn",
          "boot-risk-pin",
          `${displayPin(toPin)} can affect startup on some ESP32 boards. Confirm this assignment before powering the build.`,
          connectionId,
        ),
      );
    }

    if (!SHAREABLE_POWER_LABELS.has(toPin)) {
      const previous = usedTargetPins.get(toPin);
      if (
        toPin &&
        previous &&
        !(
          registrySourced &&
          registryI2cConnectionsCanShare(previous.step, step)
        )
      ) {
        issues.push(
          issue(
            "block",
            "duplicate-pin",
            `${displayPin(toPin)} is assigned to both ${previous.connectionId} and ${connectionId}.`,
            connectionId,
          ),
        );
      } else if (toPin) {
        if (!previous) usedTargetPins.set(toPin, { connectionId, step });
      }
    }

    const color = clean(step.wireColor).toLowerCase();
    if (color) {
      const previous = usedColors.get(color);
      if (previous) {
        issues.push(
          issue(
            "warn",
            "reused-wire-color",
            `${capitalize(color)} is reused. Keep the connection number visible so the wires cannot be confused.`,
            connectionId,
          ),
        );
      } else {
        usedColors.set(color, connectionId);
      }
    }
  }

  const hasHcSr04 = parts.some(isHcSr04Part);
  const echoSteps = steps.filter((step) => Boolean(echoPartForStep(step, partsById)));
  if (hasHcSr04) {
    for (const echoStep of echoSteps) {
      const sourcePart = echoPartForStep(echoStep, partsById);
      if (hasConfirmedLowVoltageEcho(sourcePart)) continue;
      if (hasConfirmedEchoProtection(echoStep, parts, steps)) continue;
      issues.push(
        issue(
          "warn",
          "unconfirmed-echo-voltage",
          "A classic 5 V HC-SR04 can drive ECHO above the ESP32’s published 3.6 V GPIO limit. A direct one-off setup can work, but it remains outside the rated range and may stress that pin. A confirmed 3.3 V-compatible sensor or two ordinary resistors is the lower-risk option; no level-shifter board or battery is required.",
          echoStep.connectionId,
        ),
      );
    }

    for (const sensor of parts.filter(isHcSr04Part)) {
      const sensorId = clean(sensor?.id);
      const connectedPins = new Set();
      for (const step of steps) {
        if (clean(step.fromPartId) === sensorId) connectedPins.add(canonicalUltrasonicPin(step.fromPrintedPin || step.from));
        if (clean(step.toPartId) === sensorId) connectedPins.add(canonicalUltrasonicPin(step.toPrintedPin || step.to));
      }
      const missingPins = ["VCC", "GND", "TRIG", "ECHO"].filter((pin) => !connectedPins.has(pin));
      if (missingPins.length) {
        issues.push(
          issue(
            "block",
            "incomplete-hcsr04-wiring",
            `Before wiring the HC-SR04, this guide still needs ${missingPins.join(", ")}. A complete hookup maps VCC, GND, TRIG, and ECHO; USB powers the ESP32, but it does not replace the sensor's VCC and GND jumper wires. The project and code can continue while this wiring detail is repaired.`,
          ),
        );
      }
    }
  }

  validateExternalPowerPath(plan, partsById, steps, issues);

  return dedupeIssues(issues);
}

export function findDiagnosticFailure(logText, plan = {}) {
  const log = clean(logText).toLowerCase();
  if (!log) return null;
  const diagnostics = Array.isArray(plan.diagnosticTests) ? plan.diagnosticTests : [];
  const steps = Array.isArray(plan.wiringSteps) ? plan.wiringSteps : [];

  const explicit = diagnostics.find((test) => {
    const candidates = [test.name, test.failureTitle, test.connectionId]
      .flatMap((value) => clean(value).toLowerCase().split(/[^a-z0-9]+/))
      .filter((token) => token.length >= 4 && !["check", "test", "connection", "expected"].includes(token));
    return candidates.some((token) => log.includes(token)) && /(error|fail|timeout|missing|invalid|nan)/.test(log);
  });

  const echoFallback = /echo/.test(log)
    ? diagnostics.find((test) => /echo/i.test(`${test.name} ${test.failureTitle} ${test.purpose}`)) ||
      { connectionId: steps.find((step) => /echo/i.test(`${step.action} ${step.fromPrintedPin}`))?.connectionId }
    : null;
  const diagnostic = explicit || echoFallback;
  if (!diagnostic && !/(error|failed|fail|nan|timeout|brownout|invalid|panic|rst:0x10)/i.test(log)) return null;

  const step = steps.find(({ connectionId }) => connectionId === diagnostic?.connectionId) || null;
  return {
    title: clean(diagnostic?.failureTitle, concreteFailureTitle(log)),
    evidence: concreteEvidence(log),
    recoveryAction: clean(
      diagnostic?.recoveryAction,
      step ? `Check ${wireDescription(step)}, then press RESET and retry.` : "Press the board’s RESET/EN button once, then retry.",
    ),
    connectionId: clean(step?.connectionId),
    connectionNumber: Number(step?.connectionNumber || step?.order || 0),
    wireColor: clean(step?.wireColor),
    fromPrintedPin: clean(step?.fromPrintedPin || step?.from),
    toPrintedPin: clean(step?.toPrintedPin || step?.pin || step?.to),
  };
}

export function expectedDiagnosticHits(logText, tests = []) {
  const log = clean(logText).toLowerCase();
  return tests.filter((test) => {
    const marker = clean(test?.expectedSerial).toLowerCase();
    return marker && log.includes(marker);
  });
}

export function resolveWorkflowStage(requestedIndex, workflow = {}) {
  const requested = Math.max(0, Math.min(4, Number(requestedIndex) || 0));
  if (requested >= 2 && !workflow.hasPlan) return 1;
  if (requested >= 3 && workflow.flashStatus !== "success") return 2;
  if (requested >= 4 && (workflow.automaticTestStatus !== "pass" || workflow.manualTestStatus !== "pass")) return 3;
  return requested;
}

export function wireDescription(step = {}) {
  const color = capitalize(clean(step.wireColor, "wire"));
  const number = Number(step.connectionNumber || step.order || 0);
  const from = clean(step.fromPrintedPin || step.from, "start pin");
  const to = clean(step.toPrintedPin || step.pin || step.to, "target pin");
  return `${color} wire · Connection ${number} · ${from} → ${to}`;
}

function normalizeStep(step = {}, index) {
  const fromPrintedPin = clean(step.fromPrintedPin || endpointPin(step.from), clean(step.from, "START"));
  const toPrintedPin = clean(step.toPrintedPin || step.pin || endpointPin(step.to), clean(step.to, "TARGET"));
  const color = clean(step.wireColor, DEFAULT_WIRE_COLORS[index % DEFAULT_WIRE_COLORS.length]);
  const suppliedAction = clean(
    step.action || step.instruction,
    `Connect the ${color} wire from ${fromPrintedPin} to ${toPrintedPin}.`,
  );
  const action = actionWithEndpointLabels(suppliedAction, fromPrintedPin, toPrintedPin);
  return {
    ...step,
    order: finite(step.order, index + 1),
    connectionNumber: finite(step.connectionNumber, finite(step.order, index + 1)),
    connectionId: clean(step.connectionId, `connection-${index + 1}`),
    connectionIdConfirmed: Boolean(clean(step.connectionId)),
    title: clean(step.title, `Connect ${fromPrintedPin} to ${toPrintedPin}`),
    action,
    instruction: action,
    from: clean(step.from),
    to: clean(step.to),
    fromPartId: clean(step.fromPartId),
    toPartId: clean(step.toPartId),
    fromPrintedPin,
    toPrintedPin,
    fromElectricalAlias: clean(step.fromElectricalAlias),
    toElectricalAlias: clean(step.toElectricalAlias),
    pinLocationsConfirmed: step.pinLocationsConfirmed === true,
    fromPinBbox: step.fromPinBbox || null,
    toPinBbox: step.toPinBbox || null,
    pin: toPrintedPin,
    wireColor: color,
    wireType: clean(step.wireType),
    quickCheck: clean(step.quickCheck || step.check, "Both ends feel snug and the printed labels match."),
    check: clean(step.quickCheck || step.check, "Both ends feel snug and the printed labels match."),
    why: clean(step.why),
    warning: clean(step.warning),
    requiredPartIds: Array.isArray(step.requiredPartIds)
      ? step.requiredPartIds.map((value) => clean(value)).filter(Boolean)
      : [clean(step.fromPartId), clean(step.toPartId)].filter(Boolean),
    accessibilityRank: finite(step.accessibilityRank, index + 1),
  };
}

function actionWithEndpointLabels(action, fromPrintedPin, toPrintedPin) {
  if (actionNamesExactPin(action, fromPrintedPin) && actionNamesExactPin(action, toPrintedPin)) {
    return action;
  }
  const sentence = clean(action).replace(/[.\s]+$/, "");
  return `${sentence || "Connect the wire"}. (${fromPrintedPin} → ${toPrintedPin}).`;
}

function registryI2cConnectionsCanShare(left, right) {
  const leftSignal = i2cSignal(left);
  const rightSignal = i2cSignal(right);
  return Boolean(
    leftSignal &&
      leftSignal === rightSignal &&
      clean(left?.toPartId) === clean(right?.toPartId) &&
      clean(left?.fromPartId) &&
      clean(right?.fromPartId) &&
      clean(left?.fromPartId) !== clean(right?.fromPartId),
  );
}

function i2cSignal(step) {
  const text = `${clean(step?.toElectricalAlias)} ${clean(step?.fromElectricalAlias)}`.toUpperCase();
  if (text.includes("I2C SDA")) return "SDA";
  if (text.includes("I2C SCL")) return "SCL";
  return "";
}

function normalizeBoardProfile(profile = {}) {
  const supportStatus = ["exactly_supported", "compatible_with_differences", "unverified"].includes(
    profile?.supportStatus,
  )
    ? profile.supportStatus
    : "unverified";
  return {
    profileId: clean(profile?.profileId, "unverified-esp32"),
    manufacturer: clean(profile?.manufacturer, "Unknown manufacturer"),
    model: clean(profile?.model, "ESP32 board"),
    revision: clean(profile?.revision, "Unconfirmed revision"),
    identityConfidence: normalizedConfidence(profile?.identityConfidence),
    supportStatus,
    usbConnector: clean(profile?.usbConnector, "Connector not confirmed"),
    resetLabel: clean(profile?.resetLabel, "RESET / EN"),
    bootLabel: clean(profile?.bootLabel, "BOOT"),
    printedLabels: Array.isArray(profile?.printedLabels)
      ? profile.printedLabels.map((value) => clean(value)).filter(Boolean)
      : [],
  };
}

function normalizePowerPlan(powerPlan = {}, plan = {}, options = {}) {
  const parts = Array.isArray(plan.parts) ? plan.parts : [];
  const registrySourced = plan.verificationSource === "program_registry";
  const partsById = new Map(parts.map((part) => [clean(part?.id), part]).filter(([partId]) => partId));
  const suppliedLoadEvidence = (Array.isArray(powerPlan?.highCurrentLoads) ? powerPlan.highCurrentLoads : [])
    .map((entry) => normalizeLoadEvidence(entry))
    .filter((entry) => partsById.has(entry.partId));
  const evidenceByPartId = new Map(
    suppliedLoadEvidence.map((entry) => [entry.partId, entry]),
  );
  const highCurrentParts = parts.filter(
    (part) => {
      if (isStandalonePowerSourcePart(part)) return false;
      if (registrySourced) {
        const evidence = evidenceByPartId.get(clean(part?.id));
        return Boolean(evidence && hasCredibleLoadEvidence(part, evidence));
      }
      if (HIGH_CURRENT_LOAD_PATTERN.test(partText(part))) return true;
      const evidence = evidenceByPartId.get(clean(part?.id));
      return Boolean(evidence && hasCredibleLoadEvidence(part, evidence));
    },
  );
  const untetheredRequested = userRequestsUntethered(options?.userRequest);
  const externalPowerRequired = highCurrentParts.length > 0;
  const mode = externalPowerRequired ? "external_supply_required" : "usb_board_power";
  const reason = highCurrentParts.length
    ? "high_current_load"
    : untetheredRequested
      ? "untethered_requested"
      : "ordinary_low_current";
  const highCurrentNames = highCurrentParts.map((part) => clean(part?.name, "high-current load"));
  const highCurrentLoads = highCurrentParts.map((part) => {
    const partId = clean(part?.id);
    return evidenceByPartId.get(partId) || {
      partId,
      reason: /\b(?:motor|servo|pump|solenoid|fan|blower|electromagnet)\b/i.test(partText(part))
        ? "inductive_load"
        : "known_separate_power_load",
      requiredVoltageVolts: 0,
      estimatedCurrentMilliamps: 0,
      evidence: `The confirmed part is a ${clean(part?.name, "load")} that should not be powered as an ordinary GPIO load.`,
    };
  });
  const suppliedExternalSupplies = (Array.isArray(powerPlan?.externalSupplies) ? powerPlan.externalSupplies : [])
    .map((entry) => normalizeExternalSupplyEvidence(entry))
    .filter((entry) => {
      const part = partsById.get(entry.partId);
      const confidence = normalizedConfidence(part?.confidence);
      return Boolean(
        externalPowerRequired &&
        part &&
        isStandalonePowerSourcePart(part) &&
        confidence !== null &&
        confidence >= 0.7 &&
        entry.evidence,
      );
    });
  const explanation = highCurrentParts.length
    ? `USB powers the ESP32 itself. Confirm a separate supply for ${highCurrentNames.join(", ")}; do not combine supplies unless the guide explicitly shows the shared ground and power path.`
    : untetheredRequested
      ? "Build and test this project with the ESP32's USB data cable connected; no battery is needed to continue. Running it untethered later will need a compatible portable power source you confirm then."
    : "The USB data cable powers the ESP32 and this low-current build while it stays connected. No battery is needed.";
  return {
    mode,
    reason,
    boardRail: normalizeBoardRail(powerPlan?.boardRail, externalPowerRequired),
    highCurrentPartIds: highCurrentParts.map((part) => clean(part?.id)).filter(Boolean),
    highCurrentLoads,
    externalSupplyPartIds: suppliedExternalSupplies.map(({ partId }) => partId),
    externalSupplies: suppliedExternalSupplies,
    externalPowerRequired,
    explanation,
    keepUsbConnected: true,
  };
}

function normalizeLoadEvidence(entry = {}) {
  return {
    partId: clean(entry?.partId),
    reason: ["current_over_usb_budget", "requires_separate_voltage", "inductive_load", "mains_load", "known_separate_power_load"].includes(entry?.reason)
      ? entry.reason
      : "known_separate_power_load",
    requiredVoltageVolts: Math.max(0, finite(entry?.requiredVoltageVolts, 0)),
    estimatedCurrentMilliamps: Math.max(0, finite(entry?.estimatedCurrentMilliamps, 0)),
    evidence: clean(entry?.evidence),
  };
}

function normalizeExternalSupplyEvidence(entry = {}) {
  return {
    partId: clean(entry?.partId),
    outputVoltageVolts: Math.max(0, finite(entry?.outputVoltageVolts, 0)),
    maxCurrentMilliamps: Math.max(0, finite(entry?.maxCurrentMilliamps, 0)),
    evidence: clean(entry?.evidence),
  };
}

function hasCredibleLoadEvidence(part, evidence) {
  if (ORDINARY_LOW_CURRENT_PART_PATTERN.test(partText(part))) return false;
  return (
    evidence.requiredVoltageVolts > 5.5 ||
    evidence.estimatedCurrentMilliamps >= 250 ||
    ["inductive_load", "mains_load"].includes(evidence.reason)
  );
}

function userRequestsUntethered(userRequest) {
  return clean(userRequest)
    .split(/[.;,!?]+/)
    .some((clause) => {
      if (!UNTETHERED_PROJECT_PATTERN.test(clause)) return false;
      return !/\b(?:not|never|without|do not|don't|dont|no need for|does not need|doesn't need)\b[^.;,!?]{0,80}\b(?:battery[- ]powered|portable|untethered|cordless|wearable)\b/i.test(clause);
    });
}

function validateExternalPowerPath(plan, partsById, steps, issues) {
  const powerPlan = plan?.powerPlan || {};
  if (!powerPlan.externalPowerRequired) return;
  if ((Array.isArray(powerPlan.highCurrentLoads) ? powerPlan.highCurrentLoads : []).some(({ reason }) => reason === "mains_load")) {
    issues.push(
      issue(
        "block",
        "unsupported-mains-wiring",
        "This beginner guide will not map exposed mains-voltage wiring. The ESP32 code can still be prepared, but use a properly enclosed, certified interface and qualified help for the mains side.",
      ),
    );
    return;
  }
  const loadIds = (Array.isArray(powerPlan.highCurrentPartIds) ? powerPlan.highCurrentPartIds : [])
    .map((partId) => clean(partId))
    .filter((partId) => partsById.has(partId));
  const supplyIds = (Array.isArray(powerPlan.externalSupplyPartIds) ? powerPlan.externalSupplyPartIds : [])
    .map((partId) => clean(partId))
    .filter((partId) => isStandalonePowerSourcePart(partsById.get(partId)));
  if (!supplyIds.length) {
    issues.push(
      issue(
        "block",
        "missing-external-load-supply",
        "This load needs more power than the ESP32's USB rail should provide, but no separate load supply was confirmed in the photo. You can still prepare and load the code; add a suitable supply before wiring or running the load.",
      ),
    );
    return;
  }

  const positiveGraph = connectionGraph(steps, isPositivePowerEndpoint);
  const groundGraph = connectionGraph(steps, isGroundEndpoint);
  const boardId = clean(esp32IdentityAssessment(plan).candidate?.id);
  const loadsById = new Map(
    (Array.isArray(powerPlan.highCurrentLoads) ? powerPlan.highCurrentLoads : [])
      .map((entry) => [clean(entry?.partId), entry])
      .filter(([partId]) => partId),
  );
  const suppliesById = new Map(
    (Array.isArray(powerPlan.externalSupplies) ? powerPlan.externalSupplies : [])
      .map((entry) => [clean(entry?.partId), entry])
      .filter(([partId]) => partId),
  );
  const incompatibleLoad = loadIds.find((loadId) => !supplyIds.some((supplyId) => (
    supplyCanPowerLoad(suppliesById.get(supplyId), loadsById.get(loadId))
  )));
  if (incompatibleLoad) {
    issues.push(
      issue(
        "block",
        "unconfirmed-external-supply-rating",
        `The confirmed supply rating does not yet match ${clean(partsById.get(incompatibleLoad)?.name, "the high-current load")}'s required voltage/current. You can still prepare and load the ESP32 code, but do not energize the load until those ratings are compatible.`,
      ),
    );
    return;
  }
  const blockedPositiveNodes = new Set([boardId].filter(Boolean));
  const incompleteLoad = loadIds.find((loadId) => !supplyIds.some((supplyId) => (
    supplyCanPowerLoad(suppliesById.get(supplyId), loadsById.get(loadId)) &&
    graphHasPath(positiveGraph, supplyId, loadId, blockedPositiveNodes) &&
    graphHasPath(groundGraph, supplyId, loadId) &&
    (!boardId || graphHasPath(groundGraph, supplyId, boardId))
  )));
  if (incompleteLoad) {
    issues.push(
      issue(
        "block",
        "incomplete-external-power-path",
        `Before wiring ${clean(partsById.get(incompleteLoad)?.name, "the high-current load")}, the guide must show the separate supply's power path and the shared ground back to the ESP32. The ESP32 code can still be prepared and loaded over USB.`,
      ),
    );
  }
}

function connectionGraph(steps, endpointMatcher) {
  const graph = new Map();
  for (const step of steps) {
    const fromPartId = clean(step?.fromPartId);
    const toPartId = clean(step?.toPartId);
    if (!fromPartId || !toPartId || !endpointMatcher(step, "from") || !endpointMatcher(step, "to")) continue;
    if (!graph.has(fromPartId)) graph.set(fromPartId, new Set());
    if (!graph.has(toPartId)) graph.set(toPartId, new Set());
    graph.get(fromPartId).add(toPartId);
    graph.get(toPartId).add(fromPartId);
  }
  return graph;
}

function endpointPowerText(step, endpoint) {
  const printedPin = endpoint === "from" ? step?.fromPrintedPin || step?.from : step?.toPrintedPin || step?.to;
  const electricalAlias = endpoint === "from" ? step?.fromElectricalAlias : step?.toElectricalAlias;
  return `${printedPin || ""} ${electricalAlias || ""}`.toUpperCase();
}

function isPositivePowerEndpoint(step, endpoint) {
  const text = endpointPowerText(step, endpoint);
  return /(?:^|\b)(?:VCC|VIN|VBUS|VMOT|POWER|PWR|POSITIVE|OUT\+|V\+|3V3|3\.3\s*V|5\s*V|6\s*V|9\s*V|12\s*V|24\s*V)(?:\b|$)/.test(text) || /^\s*\+\s*$/.test(text);
}

function isGroundEndpoint(step, endpoint) {
  const text = endpointPowerText(step, endpoint);
  return /(?:^|\b)(?:GND|GROUND|NEGATIVE)(?:\b|$)/.test(text) || /(?:^|\s)(?:V-|OUT-|NEG|-)(?:\s|$)/.test(text);
}

function graphHasPath(graph, start, target, blocked = new Set()) {
  if (!start || !target) return false;
  if (start === target) return true;
  if (blocked.has(start) || blocked.has(target)) return false;
  const visited = new Set([start]);
  const queue = [start];
  while (queue.length) {
    const current = queue.shift();
    for (const neighbor of graph.get(current) || []) {
      if (blocked.has(neighbor)) continue;
      if (neighbor === target) return true;
      if (visited.has(neighbor)) continue;
      visited.add(neighbor);
      queue.push(neighbor);
    }
  }
  return false;
}

function supplyCanPowerLoad(supply = {}, load = {}) {
  const requiredVoltage = Math.max(0, finite(load?.requiredVoltageVolts, 0));
  const requiredCurrent = Math.max(0, finite(load?.estimatedCurrentMilliamps, 0));
  const supplyVoltage = Math.max(0, finite(supply?.outputVoltageVolts, 0));
  const supplyCurrent = Math.max(0, finite(supply?.maxCurrentMilliamps, 0));
  if (!requiredVoltage || !requiredCurrent || !supplyVoltage || !supplyCurrent) return false;
  const voltageMatches = Math.abs(supplyVoltage - requiredVoltage) <= Math.max(0.5, requiredVoltage * 0.1);
  const currentMatches = supplyCurrent >= requiredCurrent;
  return Boolean(supply?.partId && voltageMatches && currentMatches);
}

function normalizeBoardRail(boardRail, externalPowerRequired) {
  if (externalPowerRequired) return "USB for the ESP32; separate confirmed rail for the high-current load";
  const suppliedRail = clean(boardRail);
  return /(?:\b3V3\b|3(?:\.|\s*)3\s*V|\b5\s*V\b|\bVBUS\b|\bVIN\b|USB)/i.test(suppliedRail) && !/battery/i.test(suppliedRail)
    ? suppliedRail
    : "Confirmed 3V3 or USB-backed 5V/VBUS rail";
}

function normalizePreparation(preparation = {}, wiringSteps = []) {
  const suppliedWires = Array.isArray(preparation?.wires) ? preparation.wires : [];
  const wireByConnection = new Map(suppliedWires.map((wire) => [clean(wire?.connectionId), wire]));
  return {
    orientation: clean(
      preparation?.orientation,
      "Place every component label-side up with the printed pin names visible.",
    ),
    usbCable: clean(preparation?.usbCable, "Use a USB data cable that fits the confirmed board connector."),
    requiredPartIds: Array.isArray(preparation?.requiredPartIds)
      ? preparation.requiredPartIds.map((value) => clean(value)).filter(Boolean)
      : [],
    wires: wiringSteps.map((step) => {
      const supplied = wireByConnection.get(step.connectionId) || {};
      return {
        connectionId: step.connectionId,
        color: clean(supplied.color || step.wireColor),
        connectorType: clean(supplied.connectorType || step.wireType),
        quantity: Math.max(1, finite(supplied.quantity, 1)),
      };
    }),
  };
}

function normalizeOperatingGuide(guide = {}) {
  const steps = Array.isArray(guide?.steps) ? guide.steps.map((value) => clean(value)).filter(Boolean) : [];
  return {
    summary: clean(guide?.summary, "Operate the finished project once, then confirm what you observe."),
    steps: steps.length ? steps : ["Keep the board powered and operate the project once."],
    successQuestion: clean(guide?.successQuestion, "Did the finished project behave as described?"),
    unit: clean(guide?.unit),
    resetInstruction: clean(
      guide?.resetInstruction,
      "If the reading does not update, press the board’s RESET/EN button once—not BOOT—then watch again.",
    ),
  };
}

function endpointPin(value) {
  const text = clean(value);
  const match = text.match(/(?:pin\s*)?([A-Z]{1,5}\d*|\d+)$/i);
  return match?.[1] || "";
}

function canonicalPin(value) {
  return clean(value).toUpperCase().replace(/\s+/g, "");
}

function actionNamesExactPin(action, pin) {
  return actionPinAlternatives(pin).some((expected) => {
    const flexibleLabel = [...expected]
      .map((character) => character.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("\\s*");
    return new RegExp(`(?:^|[^A-Z0-9])${flexibleLabel}(?=$|[^A-Z0-9])`, "i").test(clean(action));
  });
}

function actionPinAlternatives(pin) {
  return clean(pin)
    .replace(/\s*\([^)]*(?:check|confirm|verify)[^)]*\)/gi, " ")
    .split(/\s+or\s+|\s*\/\s*/i)
    .map((value) => canonicalPin(value))
    .filter(Boolean);
}

function isConfirmedPinBox(bbox) {
  const normalized = normalizedBox(bbox);
  if (!normalized) return false;
  const { x, y, width, height } = normalized;
  return x >= 0 && y >= 0 && width > 0 && height > 0 && x + width <= 100 && y + height <= 100 && width <= 20 && height <= 20;
}

function normalizedBox(bbox) {
  if (!bbox || typeof bbox !== "object") return null;
  const values = [bbox.x, bbox.y, bbox.width, bbox.height].map(Number);
  if (!values.every(Number.isFinite)) return null;
  let [x, y, width, height] = values;
  const largest = Math.max(...values.map(Math.abs));
  if (largest <= 1.5) [x, y, width, height] = values.map((value) => value * 100);
  else if (largest > 100 && largest <= 1000) [x, y, width, height] = values.map((value) => value / 10);
  else if (largest > 1000) return null;
  if (x < 0 || y < 0 || width <= 0 || height <= 0 || x + width > 100 || y + height > 100) return null;
  return { x, y, width, height };
}

function pinBoxBelongsToPart(pinBbox, partBbox) {
  const pin = normalizedBox(pinBbox);
  const part = normalizedBox(partBbox);
  if (!pin || !part) return false;
  const overlapWidth = Math.max(0, Math.min(pin.x + pin.width, part.x + part.width) - Math.max(pin.x, part.x));
  const overlapHeight = Math.max(0, Math.min(pin.y + pin.height, part.y + part.height) - Math.max(pin.y, part.y));
  const overlapArea = overlapWidth * overlapHeight;
  return overlapArea / (pin.width * pin.height) >= 0.5;
}

function boxesAreEffectivelyIdentical(leftBbox, rightBbox) {
  const left = normalizedBox(leftBbox);
  const right = normalizedBox(rightBbox);
  if (!left || !right) return false;
  return ["x", "y", "width", "height"].every((key) => Math.abs(left[key] - right[key]) < 0.1);
}

function hasConfirmedEchoProtection(echoStep, parts, steps) {
  const partsById = new Map(parts.map((part) => [clean(part?.id), part]).filter(([partId]) => partId));
  const sourcePartId = clean(echoStep.fromPartId);
  const protectionPartId = clean(echoStep.toPartId);
  const sourcePart = partsById.get(sourcePartId);
  const protectionPart = partsById.get(protectionPartId);
  const protectionType = confirmedProtectionType(protectionPart);

  if (!isHcSr04Part(sourcePart) || canonicalPin(echoStep.fromPrintedPin || echoStep.from) !== "ECHO") return false;
  if (!protectionType || !normalizedBox(protectionPart?.bbox)) return false;
  if (!requiredPartsInclude(echoStep, sourcePartId, protectionPartId)) return false;
  if (!stepEndpointsAreConfirmed(echoStep, sourcePart, protectionPart)) return false;
  if (!describesVoltageSide(echoStep, "to", "high")) return false;

  return steps.some((continuation) => {
    if (continuation === echoStep || clean(continuation.fromPartId) !== protectionPartId) return false;
    const boardPartId = clean(continuation.toPartId);
    const boardPart = partsById.get(boardPartId);
    if (!isEsp32Part(boardPart) || !requiredPartsInclude(continuation, protectionPartId, boardPartId)) return false;
    if (!stepEndpointsAreConfirmed(continuation, protectionPart, boardPart)) return false;
    if (!describesVoltageSide(continuation, "from", "low")) return false;
    if (boxesIdentifySameReceptacle(echoStep.toPinBbox, continuation.fromPinBbox)) return false;
    return protectionChannelsMatch(echoStep.toPrintedPin, continuation.fromPrintedPin, protectionType);
  });
}

function confirmedProtectionType(part) {
  const text = partText(part);
  const confidence = Number(part?.confidence);
  const profileId = clean(part?.profileId);
  const compatibilityStatus = clean(part?.compatibilityStatus);
  const explicitlyRated = /5\s*v/i.test(text) && /3(?:\.|\s*)3\s*v/i.test(text);
  const verifiedProfile =
    Number.isFinite(confidence) &&
    confidence >= 0.9 &&
    confidence <= 1 &&
    compatibilityStatus === "exactly_supported" &&
    profileId &&
    !/(?:unverified|unknown|possible|generic)/i.test(profileId);
  if (!verifiedProfile || !explicitlyRated) return "";
  if (/level shifter|logic(?:-level)? converter/i.test(text)) return "level-shifter";
  if (/voltage divider/i.test(text)) {
    return "rated-divider-module";
  }
  return "";
}

function requiredPartsInclude(step, ...partIds) {
  const requiredIds = new Set(
    (Array.isArray(step.requiredPartIds) ? step.requiredPartIds : [])
      .map((value) => clean(value))
      .filter(Boolean),
  );
  return partIds.every((partId) => partId && requiredIds.has(partId));
}

function stepEndpointsAreConfirmed(step, fromPart, toPart) {
  return (
    step.pinLocationsConfirmed === true &&
    isConfirmedPinBox(step.fromPinBbox) &&
    isConfirmedPinBox(step.toPinBbox) &&
    pinBoxBelongsToPart(step.fromPinBbox, fromPart?.bbox) &&
    pinBoxBelongsToPart(step.toPinBbox, toPart?.bbox)
  );
}

function describesVoltageSide(step, endpoint, side) {
  const printedPin = endpoint === "from" ? step.fromPrintedPin || step.from : step.toPrintedPin || step.to;
  const electricalAlias = endpoint === "from" ? step.fromElectricalAlias : step.toElectricalAlias;
  const text = `${printedPin || ""} ${electricalAlias || ""}`;
  const highSide = /\b(?:HV\d*|HIGH(?:[- ]SIDE)?|INPUT|IN\d*)\b|\b5\s*(?:\.0\s*)?V\b/i.test(text);
  const lowSide = /\b(?:LV\d*|LOW(?:[- ]SIDE)?|OUTPUT|OUT\d*|3V3)\b|\b3(?:\.|\s*)3\s*V\b/i.test(text);
  return side === "high" ? highSide && !lowSide : lowSide && !highSide;
}

function boxesIdentifySameReceptacle(leftBbox, rightBbox) {
  const left = normalizedBox(leftBbox);
  const right = normalizedBox(rightBbox);
  if (!left || !right) return true;
  const overlapWidth = Math.max(0, Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x));
  const overlapHeight = Math.max(0, Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y));
  const overlapArea = overlapWidth * overlapHeight;
  const smallerArea = Math.min(left.width * left.height, right.width * right.height);
  const centerDistance = Math.hypot(
    left.x + left.width / 2 - (right.x + right.width / 2),
    left.y + left.height / 2 - (right.y + right.height / 2),
  );
  const minimumCenterSeparation = Math.min(left.width, left.height, right.width, right.height) / 2;
  return overlapArea / smallerArea >= 0.25 || centerDistance < minimumCenterSeparation;
}

function protectionChannelsMatch(highSidePin, lowSidePin, protectionType) {
  const highPin = canonicalProtectionPin(highSidePin);
  const lowPin = canonicalProtectionPin(lowSidePin);
  const highChannel = protectionChannelId(highPin, "high");
  const lowChannel = protectionChannelId(lowPin, "low");

  if (
    protectionType === "rated-divider-module" &&
    !highChannel &&
    !lowChannel &&
    /^(?:IN|INPUT|HV)$/.test(highPin) &&
    /^(?:OUT|OUTPUT|LV)$/.test(lowPin)
  ) {
    return true;
  }
  return Boolean(highChannel && lowChannel && highChannel === lowChannel);
}

function canonicalProtectionPin(pin) {
  return canonicalPin(pin).replace(/[^A-Z0-9]/g, "");
}

function protectionChannelId(pin, side) {
  const withoutSide = side === "high"
    ? pin.replace(/^(?:HIGHSIDE|HIGH|HV|INPUT|IN)/, "")
    : pin.replace(/^(?:LOWSIDE|LOW|LV|OUTPUT|OUT)/, "");
  if (withoutSide && withoutSide !== pin) return withoutSide;
  return pin.match(/\d+$/)?.[0] || "";
}

function isHcSr04Part(part) {
  return /hc[- ]?sr04/i.test(`${partText(part)} ${clean(part?.profileId)}`);
}

function canonicalUltrasonicPin(pin) {
  const value = canonicalPin(pin);
  if (/^(?:VCC|5V|VIN)$/.test(value)) return "VCC";
  if (/^(?:GND|GROUND)$/.test(value)) return "GND";
  if (/^(?:TRIG|TRIGGER)$/.test(value)) return "TRIG";
  if (value === "ECHO") return "ECHO";
  return value;
}

function echoPartForStep(step, partsById) {
  const fromPart = partsById.get(clean(step.fromPartId));
  const toPart = partsById.get(clean(step.toPartId));
  const fromPin = canonicalPin(step.fromPrintedPin || step.from);
  const toPin = canonicalPin(step.toPrintedPin || step.to);
  if (isHcSr04Part(fromPart) && (fromPin === "ECHO" || /echo/i.test(`${step.action || ""}`))) return fromPart;
  if (isHcSr04Part(toPart) && (toPin === "ECHO" || /echo/i.test(`${step.action || ""}`))) return toPart;
  return null;
}

function hasConfirmedLowVoltageEcho(part) {
  const text = `${partText(part)} ${clean(part?.profileId)}`;
  const confidence = normalizedConfidence(part?.confidence);
  const explicitlyCompatible = /(?:hc[- ]?sr04(?:-33|-r|p)|3(?:\.|\s*)3\s*v[^.]{0,30}(?:compatible|logic|echo)|(?:compatible|logic|echo)[^.]{0,30}3(?:\.|\s*)3\s*v)/i.test(text);
  return confidence !== null && confidence >= 0.8 && part?.compatibilityStatus === "exactly_supported" && explicitlyCompatible;
}

function isEsp32Part(part) {
  return /esp32/i.test(partText(part));
}

function planNeedsExternalWiring(plan, parts) {
  const boardCandidate = esp32IdentityAssessment(plan).candidate;
  const boardCandidateId = clean(boardCandidate?.id);
  const hasExternalPart = parts.some((part) => {
    const text = partText(part);
    if (part === boardCandidate || (boardCandidateId && clean(part?.id) === boardCandidateId)) return false;
    if (/\b(?:built[- ]?in|onboard|internal)\b/i.test(text)) return false;
    return !/(?:jumper|dupont|hookup)\s*wires?|usb(?:-c|\s+data)?\s+cable/i.test(text);
  });
  const hasExternalPin = (Array.isArray(plan.firmwareSpec?.pinAssignments)
    ? plan.firmwareSpec.pinAssignments
    : []
  ).some((pin) => !/(?:built[- ]?in|onboard|internal)/i.test(`${pin?.label || ""} ${pin?.purpose || ""}`));
  return hasExternalPart || hasExternalPin;
}

function esp32ControllerRank(part, boardProfile = {}) {
  const name = clean(part?.name);
  const type = clean(part?.type);
  const role = clean(part?.role);
  const profileId = clean(part?.profileId);
  const boardProfileId = clean(boardProfile?.profileId);
  const model = clean(boardProfile?.model);
  let rank = 0;
  if (/\b(?:microcontroller|controller|development board|dev(?:elopment)?\s*kit|main board)\b/i.test(type)) rank += 8;
  if (/\b(?:runs|controls|controller|main board|brain)\b/i.test(role)) rank += 4;
  if (/\b(?:dev(?:elopment)?\s*kit|development board)\b/i.test(name)) rank += 3;
  if (boardProfileId && profileId === boardProfileId) rank += 2;
  if (model && name.toLowerCase().includes(model.toLowerCase())) rank += 2;
  if (/\b(?:relay|display|sensor|shield|adapter|accessory)\b/i.test(`${type} ${role}`)) rank -= 6;
  return rank;
}

function partText(part = {}) {
  return `${part.name || ""} ${part.type || ""} ${part.role || ""}`.trim();
}

function displayPin(value) {
  return /^GPIO\d+$/.test(value) ? value.replace("GPIO", "GPIO ") : value;
}

function concreteFailureTitle(log) {
  if (/echo/.test(log)) return "The ultrasonic ECHO signal was not detected.";
  if (/brownout/.test(log)) return "The board reported a power drop.";
  if (/timeout/.test(log)) return "The expected board message did not arrive in time.";
  if (/nan/.test(log)) return "A sensor returned a reading that is not a number.";
  return "The board reported an error that needs a specific repair.";
}

function concreteEvidence(log) {
  const line = log
    .split(/\r?\n/)
    .map((value) => value.trim())
    .find((value) => /(error|failed|fail|nan|timeout|brownout|invalid|panic|echo)/i.test(value));
  return line ? `Board message: “${line.slice(0, 180)}”` : "The expected diagnostic marker was not present.";
}

function issue(severity, code, message, connectionId = "") {
  return { severity, code, message, connectionId };
}

function dedupeIssues(issues) {
  const seen = new Set();
  return issues.filter((entry) => {
    const key = `${entry.code}:${entry.message}:${entry.connectionId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function finite(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizedConfidence(value) {
  if (value === null || value === undefined || value === "") return null;
  let number = Number(value);
  if (!Number.isFinite(number)) return null;
  if (number > 1 && number <= 100) number /= 100;
  return Math.min(1, Math.max(0, number));
}

function clean(value, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function capitalize(value) {
  const text = clean(value);
  return text ? `${text[0].toUpperCase()}${text.slice(1)}` : "";
}
