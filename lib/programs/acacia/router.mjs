import {
  ACACIA_BOARD_ID,
  ACACIA_DIFFICULTIES,
  ACACIA_PROGRAM_ID,
  ACACIA_REGISTRY_VERSION,
  ACACIA_ROUTE_FAMILIES,
  getAcaciaHardware,
  isAcaciaHardwareId,
  validateAcaciaHardwareSelection,
} from "./registry.mjs";
import {
  ACACIA_CAPABILITIES,
  getAcaciaCapability,
} from "./capabilities.mjs";

const IDEA_MAX_LENGTH = 1_000;

const DEFAULT_CAPABILITY_BY_FAMILY = Object.freeze({
  rules: "interactive-feedback",
  connected: "connected-monitor",
  tinyml: "motion-classifier",
  cloud: "cloud-insight",
  hybrid: "hybrid-edge-alert",
});

const DELIVERY_BOUNDARY_BY_FAMILY = Object.freeze({
  connected: deliveryBoundary({
    code: "connected-runtime-deferred",
    change:
      "Build and verify the sensor and output flow locally first; defer live Wi-Fi, dashboard and persistent connected-service features.",
    reason:
      "This slice delivers deterministic kit routing and local build guidance, but not an end-to-end connected application runtime.",
  }),
  tinyml: deliveryBoundary({
    code: "tinyml-runtime-deferred",
    change:
      "Use this version for sensor verification, labelled data collection and a validation-ready dataset; defer model training, packaging and on-device inference.",
    reason:
      "A trained TinyML model and its end-to-end training pipeline are not delivered in this slice.",
  }),
  cloud: deliveryBoundary({
    code: "cloud-runtime-deferred",
    change:
      "Build a local sensor-and-rules demonstrator and prepare a bounded sample payload; defer cloud interpretation, notifications and remote delivery.",
    reason:
      "This slice does not yet deliver the end-to-end managed cloud runtime required for those features.",
  }),
  hybrid: deliveryBoundary({
    code: "hybrid-runtime-deferred",
    change:
      "Build and verify the supervised local sensing and control path; defer trained inference, autonomous operation, remote telemetry and cloud delivery.",
    reason:
      "This slice supports the local physical demonstrator, but not an end-to-end TinyML or connected runtime.",
  }),
});

const FORCED_RESHAPE_PRIORITY = Object.freeze([
  "unattended-dispensing-deferred",
  "fan-hardware-deferred",
  "automatic-watering-deferred",
  "fall-emergency-claim-deferred",
  "fire-gas-safety-claim-deferred",
  "security-lock-claim-deferred",
  "harmful-device-not-supported",
  "mains-power-not-supported",
  "medical-claims-not-supported",
  "full-vehicle-out-of-scope",
  "camera-not-in-kit",
  "nfc-hardware-deferred",
  "speech-content-not-supported",
  "location-hardware-not-in-kit",
  "environment-sensor-replaced",
  "distance-sensor-replaced",
]);

const RESHAPE_RULES = Object.freeze([
  reshapeRule({
    code: "unattended-dispensing-deferred",
    pattern: /\b(pet\s*feeder|feed(?:er|ing)\s+(?:machine|device)|dispens\w*)\b/i,
    capabilityId: "tabletop-machine",
    change:
      "Prototype the schedule, state machine and manual stop flow with on-screen states and inert tokens; defer physical dispensing, real food and unattended pet feeding.",
    reason:
      "The qualified pilot kit has no food-safe dispenser or bench-validated actuator path, and cannot verify portions, jams or unattended operation.",
  }),
  reshapeRule({
    code: "fan-hardware-deferred",
    pattern: /\b(?:mini\s+)?fan\b/i,
    capabilityId: "environment-guardian",
    change:
      "Keep the temperature-trigger goal, but demonstrate it with a local status light or display and defer the fan.",
    reason:
      "The safe core-kit route verifies environmental sensing without presenting an unguarded motor or fan as a finished appliance.",
  }),
  reshapeRule({
    code: "automatic-watering-deferred",
    pattern: /\b(self[- ]?watering|automatic(?:ally)?\s+water|water(?:ing)?\s+(?:the\s+)?plant)\b/i,
    capabilityId: "plant-care",
    change:
      "Measure soil conditions and show a local care prompt; defer the automatic pump and unattended watering.",
    reason:
      "The reliable first version keeps water away from live electronics and does not claim unattended irrigation.",
  }),
  reshapeRule({
    code: "fall-emergency-claim-deferred",
    pattern: /\b(fall(?:s|ing)?|emergency|sos|ambulance)\b/i,
    capabilityId: "motion-classifier",
    change:
      "Replace fall or emergency detection with a non-safety movement data-collection demonstrator; it must not trigger or replace emergency response.",
    reason:
      "The kit and this slice are not validated for safety-critical detection, dispatch or emergency reliance.",
  }),
  reshapeRule({
    code: "fire-gas-safety-claim-deferred",
    pattern: /\b(fire|smoke|gas|carbon monoxide|co(?:2)? alarm)\b/i,
    capabilityId: "environment-guardian",
    change:
      "Replace the fire or hazardous-gas claim with a non-safety environmental threshold demonstrator using local status feedback.",
    reason:
      "The registered prototype sensors and firmware are not certified fire, smoke, carbon-monoxide or gas safety detectors.",
  }),
  reshapeRule({
    code: "security-lock-claim-deferred",
    pattern: /\b(security|burglar|intruder|anti[- ]?theft|door\s*lock\w*|smart\s*lock\w*|unlock\s+(?:a\s+)?door)\b/i,
    capabilityId: "proximity-presence",
    change:
      "Replace security or door-lock control with a non-security presence demonstrator that only shows local status feedback.",
    reason:
      "The prototype cannot be relied on for access control, personal safety, property protection or a physical lock.",
  }),
  reshapeRule({
    code: "camera-not-in-kit",
    pattern: /\b(camera|video|facial|face recognition|image recognition|computer vision)\b/i,
    capabilityId: "proximity-presence",
    change:
      "Replace camera-based identification with privacy-friendly presence and distance sensing.",
    reason:
      "A camera is not in the fixed Acacia kit, and the pilot does not make identity claims.",
  }),
  reshapeRule({
    code: "speech-content-not-supported",
    pattern: /\b(transcrib|speech recognition|voice assistant|recognise words?|recognize words?)\b/i,
    capabilityId: "sound-classifier",
    change:
      "Replace speech capture or transcription with a small set of non-speech sound-event classes.",
    reason:
      "The kit supports bounded sound-event TinyML, not reliable speech transcription.",
  }),
  reshapeRule({
    code: "nfc-hardware-deferred",
    pattern: /\b(nfc|rfid|contactless\s+(?:tag|card)|tag\s+reader)\b/i,
    capabilityId: "contactless-check-in",
    change:
      "Use deliberate button input for the consent flow and local record; defer NFC/RFID identity until one exact reader SKU and wiring profile are qualified.",
    reason:
      "Generic PN532-style breakouts differ in mode switches and IRQ/reset wiring, so none is claimed as supported in this slice.",
  }),
  reshapeRule({
    code: "location-hardware-not-in-kit",
    pattern: /\b(gps|live location|location track|geofenc)\b/i,
    capabilityId: "contactless-check-in",
    change:
      "Replace continuous location tracking with a deliberate, button-confirmed local check-in at a known place.",
    reason:
      "The fixed kit has no GPS receiver, and no exact NFC reader has completed qualification for this slice.",
  }),
  reshapeRule({
    code: "full-vehicle-out-of-scope",
    pattern: /\b(drone|flying robot|autonomous car|self-driving)\b/i,
    capabilityId: "tabletop-machine",
    change:
      "Prototype the sensing, state-machine and emergency-stop logic as a supervised tabletop control demonstrator without a motor.",
    reason:
      "No motor, driver or supply SKU has completed Acacia bench qualification, and the pilot never supports flight or road-going autonomy.",
  }),
  reshapeRule({
    code: "mains-power-not-supported",
    pattern: /\b(mains|230\s*v|240\s*v|wall socket|ac appliance|high voltage)\b/i,
    capabilityId: "interactive-feedback",
    change:
      "Simulate the appliance response with low-voltage display or sound feedback.",
    reason: "Student builds in this program must stay within the kit's low-voltage power limits.",
  }),
  reshapeRule({
    code: "medical-claims-not-supported",
    pattern: /\b(diagnos\w*|medical device|detect disease|patient monitor|treat illness)\b/i,
    capabilityId: "motion-classifier",
    change:
      "Build a wellbeing or movement demonstrator that makes no diagnosis or safety-critical claim.",
    reason:
      "The kit can demonstrate sensing and classification, but it is not validated medical hardware.",
  }),
  reshapeRule({
    code: "harmful-device-not-supported",
    pattern: /\b(weapon|bomb|explosive|electrocute|harm someone)\b/i,
    capabilityId: "interactive-feedback",
    change:
      "Limit the concept to a harmless light-and-sound simulation of the interaction.",
    reason: "The Acacia program only supports safe, low-voltage demonstrators.",
  }),
  reshapeRule({
    code: "controller-replaced-with-acacia-board",
    pattern: /\b(arduino(?: uno| nano| mega)?|raspberry pi|micro:?bit|jetson)\b/i,
    capabilityId: null,
    change: `Use the fixed ${ACACIA_BOARD_ID} controller instead of an outside development board.`,
    reason:
      "Acacia routes target the documented Waveshare N16R8-M carrier (SKU 28836) and still require every printed label to match the loaned board.",
  }),
  reshapeRule({
    code: "environment-sensor-replaced",
    pattern: /\b(dht11|dht22|bmp180)\b/i,
    capabilityId: "environment-guardian",
    change: "Use the registered BME280 environmental sensor for the prototype.",
    reason: "The named sensor is not in the fixed kit; the BME280 covers the supported measurements.",
  }),
  reshapeRule({
    code: "distance-sensor-replaced",
    pattern: /\b(hc-?sr04|ultrasonic (?:distance )?sensor)\b/i,
    capabilityId: "proximity-presence",
    change: "Use the registered VL53L0X time-of-flight distance sensor.",
    reason:
      "The named distance sensor is not in the fixed kit; the VL53L0X avoids a 5 V echo-signal path.",
  }),
]);

export function routeAcaciaIdea(request) {
  const requestIssues = validateAcaciaIdeaRequest(request);
  if (requestIssues.length) return { ok: false, issues: requestIssues };

  const idea = cleanText(request.idea);
  const normalizedIdea = idea.toLowerCase();
  const desiredHardwareIds = normalizeHardwareRequest(
    request.desiredHardwareIds ?? request.hardwareIds ?? [],
  );
  const explicitReshapes = RESHAPE_RULES.filter(({ pattern }) => pattern.test(idea));
  const forcedReshape = selectForcedReshape(explicitReshapes);
  const inferredFamily = inferRouteFamily(normalizedIdea);
  const family = request.preferredFamily
    ? normalizeId(request.preferredFamily)
    : inferredFamily;
  const capability = forcedReshape
    ? getAcaciaCapability(forcedReshape.capabilityId)
    : selectCapability(normalizedIdea, family);
  const requestedDifficulty = request.difficulty
    ? normalizeId(request.difficulty)
    : capability.difficulty;
  const deliveryBoundary = DELIVERY_BOUNDARY_BY_FAMILY[capability.family] || null;
  const difficultyBoundary =
    ACACIA_DIFFICULTIES.indexOf(requestedDifficulty) <
    ACACIA_DIFFICULTIES.indexOf(capability.difficulty)
      ? deliveryBoundaryForDifficulty(capability, requestedDifficulty)
      : null;
  const reshapes = [
    ...explicitReshapes,
    ...(deliveryBoundary ? [deliveryBoundary] : []),
    ...(difficultyBoundary ? [difficultyBoundary] : []),
  ];

  const warnings = [];
  const omittedHardware = [];
  const acceptedOptionalIds = [];

  for (const hardwareId of desiredHardwareIds) {
    if (!isAcaciaHardwareId(hardwareId)) {
      omittedHardware.push(hardwareId);
      warnings.push({
        code: "unknown-hardware-omitted",
        message: `"${hardwareId}" is not in the Acacia kit and was not added to the route.`,
      });
      continue;
    }
    if (!capability.allowedHardwareIds.includes(hardwareId)) {
      omittedHardware.push(hardwareId);
      warnings.push({
        code: "incompatible-hardware-omitted",
        message: `"${hardwareId}" is in the Acacia registry but is not approved for "${capability.id}".`,
      });
      continue;
    }
    if (
      capability.optionalHardwareIds.includes(hardwareId) &&
      !acceptedOptionalIds.includes(hardwareId)
    ) {
      acceptedOptionalIds.push(hardwareId);
    }
  }

  if (reshapes.length) {
    warnings.unshift(
      ...reshapes.map((entry) => ({
        code: entry.code,
        message: entry.reason,
      })),
    );
  }

  const routeStatus = reshapes.length || omittedHardware.length ? "reshaped" : "supported";
  const change = [
    ...reshapes.map((entry) => entry.change),
    omittedHardware.length
      ? `Omit hardware outside the approved "${capability.id}" profile: ${omittedHardware.join(", ")}.`
      : "",
  ]
    .filter(Boolean)
    .join(" ");
  const reason = [
    ...reshapes.map((entry) => entry.reason),
    omittedHardware.length
      ? "The deterministic router can only select hardware registered and approved for the chosen capability."
      : "",
  ]
    .filter(Boolean)
    .join(" ");

  const promotionCandidates = unique([
    ...acceptedOptionalIds,
    ...capability.optionalHardwareIds,
  ]);
  const promotedHardwareIds = selectDifficultyPromotions(
    capability,
    requestedDifficulty,
    promotionCandidates,
  );
  const requiredIds = unique([
    ...capability.requiredHardwareIds,
    ...promotedHardwareIds,
  ]);
  const optionalIds = capability.optionalHardwareIds.filter(
    (hardwareId) => !requiredIds.includes(hardwareId),
  );

  if (promotedHardwareIds.length) {
    warnings.push({
      code: "difficulty-hardware-promoted",
      message: `${capitalize(requestedDifficulty)} challenge hardware moved into the required build: ${promotedHardwareIds.join(", ")}.`,
    });
  }

  if (request.difficulty && requestedDifficulty !== capability.difficulty) {
    warnings.push({
      code: "difficulty-overridden",
      message: `The student selected ${requestedDifficulty}; Makeable recommends ${capability.difficulty} for this route.`,
    });
  }

  const value = deepFreeze({
    schemaVersion: 1,
    programId: ACACIA_PROGRAM_ID,
    registryVersion: ACACIA_REGISTRY_VERSION,
    originalIdea: idea,
    projectTitle: capability.label,
    supportedIdea: capability.supportedIdea,
    routeStatus,
    family: capability.family,
    difficulty: requestedDifficulty,
    recommendedDifficulty: capability.difficulty,
    capabilityId: capability.id,
    hardware: {
      boardId: ACACIA_BOARD_ID,
      requiredIds,
      optionalIds,
      sharedPoolRequired: requiredIds.some(
        (hardwareId) => getAcaciaHardware(hardwareId)?.pool === "shared",
      ),
      sharedPoolOptional: optionalIds.some(
        (hardwareId) => getAcaciaHardware(hardwareId)?.pool === "shared",
      ),
    },
    preservation: {
      originalGoal: idea,
      change: change || null,
      reason: reason || null,
    },
    ai: {
      credentialMode: "makeable-managed",
      studentApiKeyRequired: false,
    },
    warnings,
  });

  const routeIssues = validateAcaciaRoute(value);
  if (routeIssues.length) {
    return {
      ok: false,
      issues: [
        issue(
          "invalid-generated-route",
          "route",
          "The Acacia registry rejected the generated route.",
        ),
        ...routeIssues,
      ],
    };
  }
  return { ok: true, value };
}

export function validateAcaciaIdeaRequest(request) {
  const issues = [];
  if (!request || typeof request !== "object" || Array.isArray(request)) {
    return [issue("invalid-request", "request", "The idea request must be an object.")];
  }
  const idea = cleanText(request.idea);
  if (!idea) {
    issues.push(issue("missing-idea", "idea", "Describe the idea before routing it."));
  } else if (idea.length > IDEA_MAX_LENGTH) {
    issues.push(
      issue(
        "idea-too-long",
        "idea",
        `Keep the idea at or below ${IDEA_MAX_LENGTH} characters.`,
      ),
    );
  }
  if (
    request.difficulty !== undefined &&
    !ACACIA_DIFFICULTIES.includes(normalizeId(request.difficulty))
  ) {
    issues.push(
      issue(
        "unknown-difficulty",
        "difficulty",
        `Difficulty must be one of: ${ACACIA_DIFFICULTIES.join(", ")}.`,
      ),
    );
  }
  if (
    request.preferredFamily !== undefined &&
    !ACACIA_ROUTE_FAMILIES.includes(normalizeId(request.preferredFamily))
  ) {
    issues.push(
      issue(
        "unknown-route-family",
        "preferredFamily",
        `Route family must be one of: ${ACACIA_ROUTE_FAMILIES.join(", ")}.`,
      ),
    );
  }
  const hardware = request.desiredHardwareIds ?? request.hardwareIds;
  if (
    hardware !== undefined &&
    (!Array.isArray(hardware) ||
      hardware.some((hardwareId) => typeof hardwareId !== "string"))
  ) {
    issues.push(
      issue(
        "invalid-desired-hardware",
        "desiredHardwareIds",
        "Desired hardware IDs must be an array of strings.",
      ),
    );
  }
  if (hasForbiddenApiKeyField(request)) {
    issues.push(
      issue(
        "student-api-key-not-accepted",
        "request",
        "Acacia uses Makeable-managed AI; student API keys must not be submitted.",
      ),
    );
  }
  return issues;
}

export function validateAcaciaRoute(route) {
  const issues = [];
  if (!route || typeof route !== "object" || Array.isArray(route)) {
    return [issue("invalid-route", "route", "The Acacia route must be an object.")];
  }

  if (route.schemaVersion !== 1) {
    issues.push(issue("wrong-schema-version", "schemaVersion", "Route schemaVersion must be 1."));
  }
  if (route.programId !== ACACIA_PROGRAM_ID) {
    issues.push(
      issue("wrong-program", "programId", `programId must be "${ACACIA_PROGRAM_ID}".`),
    );
  }
  if (route.registryVersion !== ACACIA_REGISTRY_VERSION) {
    issues.push(
      issue(
        "wrong-registry-version",
        "registryVersion",
        `registryVersion must be ${ACACIA_REGISTRY_VERSION}.`,
      ),
    );
  }
  if (!["supported", "reshaped"].includes(route.routeStatus)) {
    issues.push(
      issue(
        "unknown-route-status",
        "routeStatus",
        'routeStatus must be "supported" or "reshaped".',
      ),
    );
  }
  if (!ACACIA_ROUTE_FAMILIES.includes(route.family)) {
    issues.push(issue("unknown-route-family", "family", "Route family is not supported."));
  }
  if (!ACACIA_DIFFICULTIES.includes(route.difficulty)) {
    issues.push(issue("unknown-difficulty", "difficulty", "Difficulty is not supported."));
  }
  if (!ACACIA_DIFFICULTIES.includes(route.recommendedDifficulty)) {
    issues.push(
      issue(
        "unknown-recommended-difficulty",
        "recommendedDifficulty",
        "Recommended difficulty is not supported.",
      ),
    );
  }

  const capability = getAcaciaCapability(route.capabilityId);
  if (!capability) {
    issues.push(
      issue(
        "unknown-capability",
        "capabilityId",
        `"${String(route.capabilityId || "")}" is not an Acacia capability.`,
      ),
    );
  } else {
    if (route.family !== capability.family) {
      issues.push(
        issue(
          "capability-family-mismatch",
          "family",
          `"${capability.id}" belongs to the "${capability.family}" route family.`,
        ),
      );
    }
    if (route.recommendedDifficulty !== capability.difficulty) {
      issues.push(
        issue(
          "capability-difficulty-mismatch",
          "recommendedDifficulty",
          `"${capability.id}" recommends "${capability.difficulty}".`,
        ),
      );
    }
  }

  const requiredIds = route.hardware?.requiredIds;
  const optionalIds = route.hardware?.optionalIds;
  if (!route.hardware || typeof route.hardware !== "object") {
    issues.push(issue("missing-hardware", "hardware", "Route hardware is required."));
  } else {
    if (route.hardware.boardId !== ACACIA_BOARD_ID) {
      issues.push(
        issue(
          "wrong-acacia-board",
          "hardware.boardId",
          `The Acacia board must be "${ACACIA_BOARD_ID}".`,
        ),
      );
    }
    issues.push(
      ...prefixIssues(
        validateAcaciaHardwareSelection(requiredIds, { requireBoard: true }),
        "hardware.requiredIds",
      ),
    );
    issues.push(
      ...prefixIssues(
        validateAcaciaHardwareSelection(optionalIds, { requireBoard: false }),
        "hardware.optionalIds",
      ),
    );

    if (Array.isArray(requiredIds) && Array.isArray(optionalIds)) {
      const allIds = [...requiredIds, ...optionalIds];
      const overlap = requiredIds.filter((hardwareId) => optionalIds.includes(hardwareId));
      for (const hardwareId of unique(overlap)) {
        issues.push(
          issue(
            "hardware-list-overlap",
            "hardware.optionalIds",
            `"${hardwareId}" cannot be both required and optional.`,
          ),
        );
      }
      if (capability) {
        for (const requiredId of capability.requiredHardwareIds) {
          if (!requiredIds.includes(requiredId)) {
            issues.push(
              issue(
                "missing-capability-hardware",
                "hardware.requiredIds",
                `"${capability.id}" requires "${requiredId}".`,
              ),
            );
          }
        }
        for (const hardwareId of allIds) {
          if (
            isAcaciaHardwareId(hardwareId) &&
            !capability.allowedHardwareIds.includes(hardwareId)
          ) {
            issues.push(
              issue(
                "hardware-not-approved-for-capability",
                "hardware",
                `"${hardwareId}" is not approved for "${capability.id}".`,
              ),
            );
          }
        }
        for (const optionalId of capability.optionalHardwareIds) {
          if (!allIds.includes(optionalId)) {
            issues.push(
              issue(
                "missing-capability-option",
                "hardware",
                `"${capability.id}" must keep "${optionalId}" as required challenge hardware or an optional extension.`,
              ),
            );
          }
        }
        const promotedOptionIds = capability.optionalHardwareIds.filter(
          (hardwareId) => requiredIds.includes(hardwareId),
        );
        const expectedPromotionCount = Math.min(
          difficultyPromotionCount(route.difficulty),
          capability.optionalHardwareIds.filter((hardwareId) =>
            isSafeDifficultyPromotion(hardwareId),
          ).length,
        );
        if (promotedOptionIds.length !== expectedPromotionCount) {
          issues.push(
            issue(
              "wrong-difficulty-hardware-count",
              "hardware.requiredIds",
              `${route.difficulty} routes must promote ${expectedPromotionCount} safe optional hardware item(s); found ${promotedOptionIds.length}.`,
            ),
          );
        }
        for (const hardwareId of promotedOptionIds) {
          if (!isSafeDifficultyPromotion(hardwareId)) {
            issues.push(
              issue(
                "unsafe-difficulty-hardware-promotion",
                "hardware.requiredIds",
                `"${hardwareId}" cannot become required because it is not in the Acacia registry.`,
              ),
            );
          }
        }
      }
      const needsSharedPool = requiredIds.some(
        (hardwareId) => getAcaciaHardware(hardwareId)?.pool === "shared",
      );
      const canUseSharedPool = optionalIds.some(
        (hardwareId) => getAcaciaHardware(hardwareId)?.pool === "shared",
      );
      if (route.hardware.sharedPoolRequired !== needsSharedPool) {
        issues.push(
          issue(
            "wrong-shared-pool-requirement",
            "hardware.sharedPoolRequired",
            `sharedPoolRequired must be ${needsSharedPool}.`,
          ),
        );
      }
      if (route.hardware.sharedPoolOptional !== canUseSharedPool) {
        issues.push(
          issue(
            "wrong-shared-pool-option",
            "hardware.sharedPoolOptional",
            `sharedPoolOptional must be ${canUseSharedPool}.`,
          ),
        );
      }
    }
  }

  if (
    route.ai?.credentialMode !== "makeable-managed" ||
    route.ai?.studentApiKeyRequired !== false
  ) {
    issues.push(
      issue(
        "invalid-ai-credential-policy",
        "ai",
        "Acacia routes must use Makeable-managed AI without student API keys.",
      ),
    );
  }
  if (hasForbiddenApiKeyField(route)) {
    issues.push(
      issue(
        "student-api-key-present",
        "route",
        "API key material must not be present in an Acacia route.",
      ),
    );
  }
  if (!cleanText(route.originalIdea)) {
    issues.push(issue("missing-original-idea", "originalIdea", "The original idea is required."));
  }
  if (!cleanText(route.supportedIdea)) {
    issues.push(
      issue("missing-supported-idea", "supportedIdea", "The supported idea is required."),
    );
  }
  if (route.routeStatus === "reshaped" && !cleanText(route.preservation?.change)) {
    issues.push(
      issue(
        "missing-reshape-explanation",
        "preservation.change",
        "Reshaped routes must say what changed.",
      ),
    );
  }
  if (route.routeStatus === "reshaped" && !cleanText(route.preservation?.reason)) {
    issues.push(
      issue(
        "missing-reshape-reason",
        "preservation.reason",
        "Reshaped routes must explain why the first version changed.",
      ),
    );
  }
  return issues;
}

export function inferRouteFamily(idea) {
  const text = cleanText(idea).toLowerCase();
  const hasLocalIntelligence =
    /\b(tinyml|machine learning|classif\w*|recogni[sz]\w*|learn\w*|model|gestur\w*|fall\w*|anomal\w*|pattern\w*|sound\w*|audio|clap\w*|knock\w*)\b/.test(
      text,
    );
  const hasConnectivity =
    /\b(wifi|bluetooth|dashboard|phone|remote|online|cloud|connect\w*|notif\w*|messag\w*|send\w*(?: an?)? alert\w*|email)\b/.test(
      text,
    );
  if (/\b(robot\w*|motor\w*|machine|conveyor|drone\w*)\b/.test(text)) {
    return "hybrid";
  }
  if (
    /\b(hybrid|offline-first|edge ai|works? (?:even )?without (?:wifi|internet))\b/.test(text) ||
    (hasLocalIntelligence && hasConnectivity)
  ) {
    return "hybrid";
  }
  if (hasLocalIntelligence || /\b(sound event|activity detection)\b/.test(text)) {
    return "tinyml";
  }
  if (/\b(ai|advice|recommend\w*|insight\w*|explain\w*|forecast\w*|cloud|email|notif\w*|messag\w*)\b/.test(text)) {
    return "cloud";
  }
  if (hasConnectivity) return "connected";
  return "rules";
}

function selectCapability(idea, family) {
  const candidates = ACACIA_CAPABILITIES.filter((entry) => entry.family === family);
  if (!candidates.length) return getAcaciaCapability(DEFAULT_CAPABILITY_BY_FAMILY.rules);

  let selected = null;
  let selectedScore = 0;
  for (const candidate of candidates) {
    const score = candidate.keywords.reduce(
      (total, keyword) => total + (idea.includes(keyword) ? keyword.length : 0),
      0,
    );
    if (score > selectedScore) {
      selected = candidate;
      selectedScore = score;
    }
  }
  return (
    selected ||
    getAcaciaCapability(DEFAULT_CAPABILITY_BY_FAMILY[family]) ||
    candidates[0]
  );
}

function normalizeHardwareRequest(hardwareIds) {
  return unique(hardwareIds.map(normalizeId).filter(Boolean));
}

function selectDifficultyPromotions(capability, difficulty, candidates) {
  const count = difficultyPromotionCount(difficulty);
  const selected = [];
  for (const hardwareId of candidates) {
    if (selected.length >= count) break;
    if (
      capability.optionalHardwareIds.includes(hardwareId) &&
      isSafeDifficultyPromotion(hardwareId)
    ) {
      selected.push(hardwareId);
    }
  }
  return selected;
}

function selectForcedReshape(reshapes) {
  for (const code of FORCED_RESHAPE_PRIORITY) {
    const match = reshapes.find(
      (entry) => entry.code === code && entry.capabilityId,
    );
    if (match) return match;
  }
  return reshapes.find(({ capabilityId }) => capabilityId) || null;
}

function difficultyPromotionCount(difficulty) {
  return Math.max(0, ACACIA_DIFFICULTIES.indexOf(normalizeId(difficulty)));
}

function isSafeDifficultyPromotion(hardwareId) {
  return Boolean(getAcaciaHardware(hardwareId));
}

function prefixIssues(issues, prefix) {
  return issues.map((entry) => ({
    ...entry,
    path: entry.path.startsWith("hardwareIds")
      ? `${prefix}${entry.path.slice("hardwareIds".length)}`
      : `${prefix}.${entry.path}`,
  }));
}

function hasForbiddenApiKeyField(value, seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return false;
  seen.add(value);
  for (const [key, child] of Object.entries(value)) {
    if (/api[-_ ]?key$/i.test(key)) return true;
    if (hasForbiddenApiKeyField(child, seen)) return true;
  }
  return false;
}

function reshapeRule({ code, pattern, capabilityId, change, reason }) {
  return Object.freeze({ code, pattern, capabilityId, change, reason });
}

function deliveryBoundary({ code, change, reason }) {
  return Object.freeze({ code, capabilityId: null, change, reason });
}

function deliveryBoundaryForDifficulty(capability, requestedDifficulty) {
  return deliveryBoundary({
    code: "difficulty-downscoped",
    change: `Use the ${capitalize(requestedDifficulty)} track for guided verification and its bounded milestones; defer the additional scope expected by the recommended ${capitalize(capability.difficulty)} track.`,
    reason: `"${capability.label}" is normally a ${capitalize(capability.difficulty)} route, so selecting ${capitalize(requestedDifficulty)} intentionally narrows what this first version proves.`,
  });
}

function issue(code, path, message) {
  return Object.freeze({ code, path, message });
}

function cleanText(value) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

function capitalize(value) {
  const text = normalizeId(value);
  return text ? `${text[0].toUpperCase()}${text.slice(1)}` : "";
}

function normalizeId(value) {
  return String(value || "").trim().toLowerCase();
}

function unique(values) {
  return [...new Set(values)];
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}
