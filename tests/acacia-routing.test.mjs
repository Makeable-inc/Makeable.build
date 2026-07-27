import assert from "node:assert/strict";
import test from "node:test";

import {
  ACACIA_CAPABILITIES,
  inferRouteFamily,
  routeAcaciaIdea,
  validateAcaciaIdeaRequest,
  validateAcaciaRoute,
} from "../lib/programs/acacia/index.mjs";

function routed(request) {
  const result = routeAcaciaIdea(request);
  assert.equal(result.ok, true, JSON.stringify(result.issues || []));
  return result.value;
}

test("an idea is routed before hardware selection and produces a valid core-kit route", () => {
  const route = routed({
    idea: "Help a student notice when their room is too hot or humid.",
  });

  assert.equal(route.programId, "nus-acacia");
  assert.equal(route.registryVersion, 1);
  assert.equal(route.routeStatus, "supported");
  assert.equal(route.family, "rules");
  assert.equal(route.capabilityId, "environment-guardian");
  assert.equal(route.hardware.boardId, "esp32-s3-n16r8");
  assert.ok(route.hardware.requiredIds.includes("bme280-environment"));
  assert.equal(route.hardware.sharedPoolRequired, false);
  assert.deepEqual(validateAcaciaRoute(route), []);
});

test("the deterministic route families cover rules, connected, TinyML, cloud and hybrid", () => {
  const scenarios = [
    ["A button quiz with colour feedback", "rules"],
    ["A WiFi dashboard for room readings", "connected"],
    ["A model that classifies three hand gestures", "tinyml"],
    ["AI advice based on the room environment", "cloud"],
    [
      "A TinyML gesture model that sends an alert to my phone but still works offline",
      "hybrid",
    ],
  ];

  for (const [idea, family] of scenarios) {
    assert.equal(inferRouteFamily(idea), family, idea);
    assert.equal(routed({ idea }).family, family, idea);
  }
});

test("motion classification uses the core IMU for honest TinyML preparation", () => {
  const route = routed({
    idea: "Learn and recognise three exercise movements.",
  });

  assert.equal(route.family, "tinyml");
  assert.equal(route.capabilityId, "motion-classifier");
  assert.equal(route.recommendedDifficulty, "builder");
  assert.ok(route.hardware.requiredIds.includes("mpu6050-imu"));
  assert.equal(route.hardware.sharedPoolRequired, false);
  assert.match(route.supportedIdea, /sensor|motion/i);
  assert.match(route.supportedIdea, /labelled examples/i);
  assert.match(route.supportedIdea, /validation-ready dataset/i);
  assert.match(route.supportedIdea, /does not claim a trained or on-device model/i);
  assert.equal(route.routeStatus, "reshaped");
});

test("difficulty promotes zero, one or two safe optional parts into the actual required build", () => {
  const beginner = routed({
    idea: "Make a room temperature status light.",
    difficulty: "beginner",
  });
  const builder = routed({
    idea: "Make a room temperature status light.",
    difficulty: "builder",
  });
  const advanced = routed({
    idea: "Make a room temperature status light.",
    difficulty: "advanced",
  });
  const baseRequired = ACACIA_CAPABILITIES.find(
    ({ id }) => id === "environment-guardian",
  ).requiredHardwareIds;

  assert.equal(beginner.capabilityId, "environment-guardian");
  assert.equal(beginner.difficulty, "beginner");
  assert.equal(beginner.recommendedDifficulty, "beginner");
  assert.deepEqual(beginner.hardware.requiredIds, baseRequired);
  assert.deepEqual(
    builder.hardware.requiredIds.slice(baseRequired.length),
    ["bh1750-light"],
  );
  assert.deepEqual(
    advanced.hardware.requiredIds.slice(baseRequired.length),
    ["bh1750-light", "active-buzzer"],
  );
  assert.ok(beginner.hardware.optionalIds.includes("bh1750-light"));
  assert.equal(builder.hardware.optionalIds.includes("bh1750-light"), false);
  assert.equal(advanced.hardware.optionalIds.includes("active-buzzer"), false);
  assert.equal(
    beginner.warnings.some(({ code }) => code === "difficulty-overridden"),
    false,
  );
  assert.ok(
    builder.warnings.some(({ code }) => code === "difficulty-hardware-promoted"),
  );
  assert.deepEqual(validateAcaciaRoute(beginner), []);
  assert.deepEqual(validateAcaciaRoute(builder), []);
  assert.deepEqual(validateAcaciaRoute(advanced), []);
});

test("advanced proximity promotes only qualified PIR and core feedback hardware", () => {
  const route = routed({
    idea: "Notice a nearby visitor with a distance alert.",
    difficulty: "advanced",
  });

  assert.equal(route.capabilityId, "proximity-presence");
  assert.deepEqual(
    route.hardware.requiredIds.filter((id) =>
      ["hc-sr501-pir", "active-buzzer"].includes(id),
    ),
    ["hc-sr501-pir", "active-buzzer"],
  );
  assert.equal(route.hardware.sharedPoolRequired, true);
  assert.equal(route.hardware.sharedPoolOptional, false);
  assert.equal(
    [...route.hardware.requiredIds, ...route.hardware.optionalIds].some((id) =>
      /servo|motor|driver|supply|pump|ws2812|pn532/.test(id),
    ),
    false,
  );
});

test("a preferred technical family is honored when it is part of the program vocabulary", () => {
  const route = routed({
    idea: "Help me understand temperature and humidity.",
    preferredFamily: "cloud",
  });

  assert.equal(route.family, "cloud");
  assert.equal(route.capabilityId, "cloud-insight");
});

test("camera and facial-recognition ideas are reshaped to privacy-friendly kit hardware", () => {
  const route = routed({
    idea: "Use facial recognition camera footage to count visitors.",
  });

  assert.equal(route.routeStatus, "reshaped");
  assert.equal(route.capabilityId, "proximity-presence");
  assert.equal(route.family, "rules");
  assert.ok(route.hardware.requiredIds.includes("vl53l0x-distance"));
  assert.equal(route.hardware.requiredIds.includes("hc-sr501-pir"), false);
  assert.ok(route.hardware.optionalIds.includes("hc-sr501-pir"));
  assert.equal(route.hardware.sharedPoolRequired, false);
  assert.equal(route.hardware.sharedPoolOptional, true);
  assert.equal(
    route.hardware.requiredIds.some((id) => /camera/.test(id)),
    false,
  );
  assert.match(route.preservation.change, /privacy-friendly/i);
  assert.match(route.preservation.reason, /not in the fixed Acacia kit/i);
});

test("speech transcription is narrowed to non-speech sound-event classification", () => {
  const route = routed({
    idea: "Build a voice assistant that transcribes every conversation.",
  });

  assert.equal(route.routeStatus, "reshaped");
  assert.equal(route.capabilityId, "sound-classifier");
  assert.ok(route.hardware.requiredIds.includes("inmp441-i2s-microphone"));
  assert.match(route.supportedIdea, /without recording speech content/i);
  assert.match(route.preservation.change, /non-speech sound-event/i);
});

test("every shipped idea prompt has an explicit safe route instead of a silent fallback", () => {
  const scenarios = [
    {
      idea: "Build a pet feeder that serves food on a schedule.",
      capabilityId: "tabletop-machine",
      warningCode: "unattended-dispensing-deferred",
      change: /inert tokens.*unattended pet feeding/i,
      reason: /food safety|portions|jams/i,
    },
    {
      idea: "Build a mini fan that turns on when the room gets warm.",
      capabilityId: "environment-guardian",
      warningCode: "fan-hardware-deferred",
      change: /status light or display.*defer the fan/i,
      reason: /unguarded motor or fan/i,
    },
    {
      idea: "Build a self-watering plant that checks when the soil is dry.",
      capabilityId: "plant-care",
      warningCode: "automatic-watering-deferred",
      change: /defer the automatic pump and unattended watering/i,
      reason: /water away from live electronics/i,
    },
  ];

  for (const scenario of scenarios) {
    const route = routed({ idea: scenario.idea });
    assert.equal(route.routeStatus, "reshaped", scenario.idea);
    assert.equal(route.capabilityId, scenario.capabilityId, scenario.idea);
    assert.match(route.preservation.change, scenario.change, scenario.idea);
    assert.match(route.preservation.reason, scenario.reason, scenario.idea);
    assert.ok(
      route.warnings.some(({ code }) => code === scenario.warningCode),
      scenario.idea,
    );
  }
});

test("connected, cloud, hybrid and TinyML routes disclose deferred runtimes", () => {
  const scenarios = [
    {
      idea: "A WiFi dashboard for room readings",
      family: "connected",
      warningCode: "connected-runtime-deferred",
      deferred: /live Wi-Fi|dashboard/i,
    },
    {
      idea: "AI advice based on the room environment",
      family: "cloud",
      warningCode: "cloud-runtime-deferred",
      deferred: /cloud interpretation|remote delivery/i,
    },
    {
      idea: "A tabletop robot with remote telemetry",
      family: "hybrid",
      warningCode: "hybrid-runtime-deferred",
      deferred: /remote telemetry|cloud delivery/i,
    },
    {
      idea: "A model that classifies three hand gestures",
      family: "tinyml",
      warningCode: "tinyml-runtime-deferred",
      deferred: /model training.*on-device inference/i,
    },
  ];

  for (const scenario of scenarios) {
    const route = routed({ idea: scenario.idea });
    assert.equal(route.family, scenario.family, scenario.idea);
    assert.equal(route.routeStatus, "reshaped", scenario.idea);
    assert.match(route.preservation.change, scenario.deferred, scenario.idea);
    assert.ok(route.preservation.reason, scenario.idea);
    assert.ok(
      route.warnings.some(({ code }) => code === scenario.warningCode),
      scenario.idea,
    );
  }
});

test("TinyML capabilities promise verification and data, never a trained runtime", () => {
  const tinymlCapabilities = ACACIA_CAPABILITIES.filter(
    ({ family }) => family === "tinyml",
  );

  assert.ok(tinymlCapabilities.length > 0);
  for (const capability of tinymlCapabilities) {
    assert.match(capability.supportedIdea, /verif/i, capability.id);
    assert.match(capability.supportedIdea, /labelled/i, capability.id);
    assert.match(capability.supportedIdea, /validation-ready dataset/i, capability.id);
    assert.doesNotMatch(
      capability.supportedIdea,
      /\b(?:run|runs|running|use|uses)\b.*\b(?:trained|on-device) model\b/i,
      capability.id,
    );
  }
});

test("GPS and NFC ideas become a button-confirmed local check-in demonstrator", () => {
  const route = routed({
    idea: "Track live location around campus with GPS and confirm it using NFC.",
  });

  assert.equal(route.routeStatus, "reshaped");
  assert.equal(route.capabilityId, "contactless-check-in");
  assert.equal(route.hardware.sharedPoolRequired, false);
  assert.ok(route.hardware.requiredIds.includes("momentary-buttons"));
  assert.equal(
    route.hardware.requiredIds.some((id) => /gps|nfc|pn532/.test(id)),
    false,
  );
  assert.match(route.preservation.change, /button-confirmed local check-in/i);
  assert.match(route.preservation.change, /defer NFC\/RFID identity/i);
});

test("advanced vehicle ideas become a motorless state-machine and stop-control simulator", () => {
  const route = routed({
    idea: "Build an autonomous flying drone that responds to movement.",
  });

  assert.equal(route.routeStatus, "reshaped");
  assert.equal(route.capabilityId, "tabletop-machine");
  assert.equal(route.recommendedDifficulty, "advanced");
  assert.equal(route.hardware.sharedPoolRequired, false);
  assert.ok(route.hardware.requiredIds.includes("mpu6050-imu"));
  assert.ok(route.hardware.requiredIds.includes("momentary-buttons"));
  assert.equal(
    route.hardware.requiredIds.some((id) =>
      /motor|driver|supply|pump|servo/.test(id),
    ),
    false,
  );
  assert.match(route.supportedIdea, /state-machine and stop-control logic/i);
  assert.match(route.preservation.change, /tabletop control demonstrator without a motor/i);
});

test("a multi-constraint vehicle idea keeps the safe machine route while disclosing every reshape", () => {
  const route = routed({
    idea: "Build a camera-guided autonomous car that follows visitors.",
  });

  assert.equal(route.capabilityId, "tabletop-machine");
  assert.equal(route.routeStatus, "reshaped");
  assert.match(route.preservation.change, /privacy-friendly presence/i);
  assert.match(route.preservation.change, /tabletop control demonstrator without a motor/i);
  assert.ok(
    route.warnings.some(({ code }) => code === "camera-not-in-kit"),
  );
  assert.ok(
    route.warnings.some(({ code }) => code === "full-vehicle-out-of-scope"),
  );
});

test("tabletop robots, motors, machines and conveyors select the motorless hybrid simulator", () => {
  for (const idea of [
    "Build a tabletop robot",
    "Control a small motor machine",
    "Make a campus conveyor demonstrator",
  ]) {
    const route = routed({ idea });
    assert.equal(route.family, "hybrid", idea);
    assert.equal(route.capabilityId, "tabletop-machine", idea);
    assert.equal(route.routeStatus, "reshaped", idea);
    assert.equal(route.hardware.sharedPoolRequired, false, idea);
    assert.ok(route.hardware.requiredIds.includes("momentary-buttons"), idea);
    assert.equal(
      route.hardware.requiredIds.some((id) =>
        /motor|driver|supply|pump|servo/.test(id),
      ),
      false,
      idea,
    );
    assert.match(route.supportedIdea, /state-machine and stop-control logic/i, idea);
  }
});

test("outside development boards and common substitute sensors are explicitly reshaped", () => {
  const route = routed({
    idea: "Use an Arduino Uno and DHT11 for a room environment monitor.",
  });

  assert.equal(route.routeStatus, "reshaped");
  assert.equal(route.capabilityId, "environment-guardian");
  assert.equal(route.hardware.boardId, "esp32-s3-n16r8");
  assert.ok(route.hardware.requiredIds.includes("bme280-environment"));
  assert.equal(
    route.hardware.requiredIds.some((id) => /arduino|dht11/.test(id)),
    false,
  );
  assert.ok(
    route.warnings.some(
      ({ code }) => code === "controller-replaced-with-acacia-board",
    ),
  );
  assert.ok(
    route.warnings.some(({ code }) => code === "environment-sensor-replaced"),
  );
});

test("unsafe power and medical claims are converted to bounded demonstrators", () => {
  const powerRoute = routed({
    idea: "Switch a 240V wall socket when someone walks in.",
  });
  const medicalRoute = routed({
    idea: "Make a medical device that diagnoses a patient's disease.",
  });

  assert.equal(powerRoute.routeStatus, "reshaped");
  assert.equal(powerRoute.capabilityId, "interactive-feedback");
  assert.match(powerRoute.preservation.change, /low-voltage/i);
  assert.equal(medicalRoute.routeStatus, "reshaped");
  assert.equal(medicalRoute.capabilityId, "motion-classifier");
  assert.match(medicalRoute.preservation.change, /no diagnosis/i);
});

test("high-stakes safety ideas are forced into non-safety demonstrators", () => {
  const scenarios = [
    {
      idea: "Detect a fall and call emergency services",
      capabilityId: "motion-classifier",
      warningCode: "fall-emergency-claim-deferred",
      change: /non-safety movement data-collection demonstrator/i,
      reason: /not validated for safety-critical/i,
    },
    {
      idea: "Build a fire and gas detector",
      capabilityId: "environment-guardian",
      warningCode: "fire-gas-safety-claim-deferred",
      change: /non-safety environmental threshold demonstrator/i,
      reason: /not certified fire.*gas safety detectors/i,
    },
    {
      idea: "Make a security system that unlocks a door",
      capabilityId: "proximity-presence",
      warningCode: "security-lock-claim-deferred",
      change: /non-security presence demonstrator/i,
      reason: /cannot be relied on for access control/i,
    },
  ];

  for (const scenario of scenarios) {
    const route = routed({ idea: scenario.idea });
    assert.equal(route.routeStatus, "reshaped", scenario.idea);
    assert.equal(route.capabilityId, scenario.capabilityId, scenario.idea);
    assert.match(route.preservation.change, scenario.change, scenario.idea);
    assert.match(route.preservation.reason, scenario.reason, scenario.idea);
    assert.ok(
      route.warnings.some(({ code }) => code === scenario.warningCode),
      scenario.idea,
    );
  }
});

test("unknown and incompatible requested hardware is explained and never invented", () => {
  const route = routed({
    idea: "A room temperature status light.",
    desiredHardwareIds: [
      "raspberry-pi-camera",
      "hx711-load-cell",
      "bme280-environment",
    ],
  });
  const allHardware = [
    ...route.hardware.requiredIds,
    ...route.hardware.optionalIds,
  ];

  assert.equal(route.routeStatus, "reshaped");
  assert.equal(allHardware.includes("raspberry-pi-camera"), false);
  assert.equal(allHardware.includes("hx711-load-cell"), false);
  assert.ok(allHardware.includes("bme280-environment"));
  assert.ok(
    route.warnings.some(({ code }) => code === "unknown-hardware-omitted"),
  );
  assert.ok(
    route.warnings.some(({ code }) => code === "incompatible-hardware-omitted"),
  );
  assert.match(route.preservation.change, /raspberry-pi-camera/);
  assert.match(route.preservation.change, /hx711-load-cell/);
});

test("routing is stable for identical normalized input", () => {
  const first = routeAcaciaIdea({
    idea: "  A plant monitor\nthat shows soil moisture.  ",
    difficulty: "builder",
  });
  const second = routeAcaciaIdea({
    idea: "A plant monitor that shows soil moisture.",
    difficulty: "builder",
  });

  assert.deepEqual(first, second);
});

test("invalid requests fail with structured issues instead of guessing", () => {
  assert.ok(
    validateAcaciaIdeaRequest(null).some(({ code }) => code === "invalid-request"),
  );
  assert.ok(
    validateAcaciaIdeaRequest({ idea: " " }).some(
      ({ code }) => code === "missing-idea",
    ),
  );
  assert.ok(
    validateAcaciaIdeaRequest({ idea: "x".repeat(1_001) }).some(
      ({ code }) => code === "idea-too-long",
    ),
  );
  assert.ok(
    validateAcaciaIdeaRequest({ idea: "Blink", difficulty: "expert" }).some(
      ({ code }) => code === "unknown-difficulty",
    ),
  );
  assert.ok(
    validateAcaciaIdeaRequest({ idea: "Blink", preferredFamily: "magic" }).some(
      ({ code }) => code === "unknown-route-family",
    ),
  );
  assert.equal(routeAcaciaIdea({ idea: "" }).ok, false);
});

test("student API keys are rejected from requests and routes", () => {
  const requestIssues = validateAcaciaIdeaRequest({
    idea: "A plant helper",
    openaiApiKey: "student-secret",
  });
  assert.ok(
    requestIssues.some(({ code }) => code === "student-api-key-not-accepted"),
  );

  const tampered = structuredClone(
    routed({ idea: "A connected room dashboard." }),
  );
  tampered.ai = {
    credentialMode: "student-supplied",
    studentApiKeyRequired: true,
    apiKey: "student-secret",
  };
  const routeIssues = validateAcaciaRoute(tampered);
  assert.ok(
    routeIssues.some(({ code }) => code === "invalid-ai-credential-policy"),
  );
  assert.ok(routeIssues.some(({ code }) => code === "student-api-key-present"));
});

test("route validation rejects invented or capability-incompatible hardware", () => {
  const invented = structuredClone(
    routed({ idea: "A temperature status light." }),
  );
  invented.hardware.optionalIds.push("made-up-sensor");
  const inventedIssues = validateAcaciaRoute(invented);
  assert.ok(inventedIssues.some(({ code }) => code === "unknown-hardware"));

  const incompatible = structuredClone(
    routed({ idea: "A temperature status light." }),
  );
  incompatible.hardware.optionalIds.push("hx711-load-cell");
  incompatible.hardware.sharedPoolOptional = true;
  const incompatibleIssues = validateAcaciaRoute(incompatible);
  assert.ok(
    incompatibleIssues.some(
      ({ code }) => code === "hardware-not-approved-for-capability",
    ),
  );
});

test("route validation enforces capability requirements, family, board and registry version", () => {
  const route = structuredClone(
    routed({ idea: "Recognise three hand gestures." }),
  );
  route.registryVersion = 999;
  route.family = "cloud";
  route.hardware.boardId = "another-board";
  route.hardware.requiredIds = route.hardware.requiredIds.filter(
    (id) => id !== "mpu6050-imu",
  );

  const issues = validateAcaciaRoute(route);
  assert.ok(issues.some(({ code }) => code === "wrong-registry-version"));
  assert.ok(issues.some(({ code }) => code === "capability-family-mismatch"));
  assert.ok(issues.some(({ code }) => code === "wrong-acacia-board"));
  assert.ok(issues.some(({ code }) => code === "missing-capability-hardware"));
});

test("route validation rejects difficulty hardware that is silently omitted or over-promoted", () => {
  const missingBuilderChallenge = structuredClone(
    routed({
      idea: "A room environment monitor",
      difficulty: "builder",
    }),
  );
  const promotedId = "bh1750-light";
  missingBuilderChallenge.hardware.requiredIds =
    missingBuilderChallenge.hardware.requiredIds.filter((id) => id !== promotedId);
  missingBuilderChallenge.hardware.optionalIds =
    missingBuilderChallenge.hardware.optionalIds.filter((id) => id !== promotedId);

  const beginnerOverPromotion = structuredClone(
    routed({
      idea: "A room environment monitor",
      difficulty: "beginner",
    }),
  );
  beginnerOverPromotion.hardware.requiredIds.push("bh1750-light");
  beginnerOverPromotion.hardware.optionalIds =
    beginnerOverPromotion.hardware.optionalIds.filter(
      (id) => id !== "bh1750-light",
    );

  const missingIssues = validateAcaciaRoute(missingBuilderChallenge);
  const overPromotionIssues = validateAcaciaRoute(beginnerOverPromotion);
  assert.ok(missingIssues.some(({ code }) => code === "missing-capability-option"));
  assert.ok(
    missingIssues.some(({ code }) => code === "wrong-difficulty-hardware-count"),
  );
  assert.ok(
    overPromotionIssues.some(({ code }) => code === "wrong-difficulty-hardware-count"),
  );
});

test("all successful routes use Makeable-managed AI and contain no secret input", () => {
  for (const idea of [
    "A room heat status light",
    "A WiFi environment dashboard",
    "Classify gestures",
    "AI advice for plant conditions",
    "Classify movement locally and send alerts remotely",
  ]) {
    const route = routed({ idea });
    assert.deepEqual(route.ai, {
      credentialMode: "makeable-managed",
      studentApiKeyRequired: false,
    });
    assert.equal(JSON.stringify(route).includes("apiKey"), false);
  }
});
