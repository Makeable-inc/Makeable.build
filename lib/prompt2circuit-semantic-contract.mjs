const CAPABILITY_RULES = Object.freeze([
  rule("soil_moisture", /\b(?:soil moisture|plant moisture|smart plant pot|plant watering|plant monitor)\b/i,
    /\b(?:soil[_ -]?moisture|plant[_ -]?moisture|capacitive soil|tlc555i)\b/i),
  rule("carbon_dioxide", /\b(?:co2|carbon dioxide)\b/i, /\b(?:scd[- ]?4[01]|true co2|carbon dioxide)\b/i),
  rule("air_quality", /\b(?:air quality|voc|tvoc|pollution|gas quality)\b/i,
    /\b(?:sgp30|pmsa003i|particulate matter|voc|air quality|scd[- ]?4[01])\b/i),
  rule("temperature", /\b(?:temperature|thermometer|thermal|climate)\b/i,
    /\b(?:temperature|bmp180|bmp280|bme280|sht45|dht22|am2302|scd[- ]?4[01]|ds18b20)\b/i),
  rule("barometric_pressure", /\b(?:barometric pressure|atmospheric pressure|air pressure|pressure sensor|pressure|altimeter|altitude)\b/i,
    /\b(?:barometric pressure|atmospheric pressure|pressure sensor|bmp180|bmp280|bme280)\b/i),
  rule("humidity", /\b(?:humidity|humid|hygrometer)\b/i,
    /\b(?:humidity|bme280|sht45|dht22|am2302|scd[- ]?4[01])\b/i),
  rule("ambient_light", /\b(?:ambient light|light level|lux|brightness|sunlight)\b/i,
    /\b(?:tsl2591|bh1750|ambient light|light sensor|ltr390|vcnl4040)\b/i),
  rule("uv_light", /\b(?:uv|ultraviolet)\b/i, /\b(?:ltr390|uv light|ultraviolet)\b/i),
  rule("spectral_color", /\b(?:spectral|spectrum|color sensor|colour sensor)\b/i,
    /\b(?:as7341|spectral|apds9960.*color)\b/i),
  rule("distance", /\b(?:distance|range|ranging|ultrasonic|sonar|time[- ]of[- ]flight|tof)\b/i,
    /\b(?:vl53l1x|hc[- ]?sr04p|ultrasonic|distance|ranging)\b/i),
  rule("presence", /\b(?:presence|occupancy|human detection|motion detector|motion detection|detect(?:s|ing)? nearby motion|someone approaches|person approaches)\b/i,
    /\b(?:ld2410|sths34pf80|presence|radar|pir|passive infrared)\b/i),
  rule("proximity", /\b(?:proximity|gesture|nearby (?:object|hand|obstacle|surface))\b/i,
    /\b(?:apds9960|vcnl4040|proximity|gesture)\b/i),
  rule("sound", /\b(?:sound[- ]level|noise[- ]level|sound sensor|noise sensor|microphone|clap(?: detection)?|detect(?:s|ing)? (?:sound|noise)|listen(?:s|ing)? for (?:sound|noise)|measur(?:e|es|ing|ement) (?:sound|noise))\b/i,
    /\b(?:sound sensor|microphone|ky[- ]?037)\b/i),
  rule("speech_audio_capture", /\b(?:transcrib(?:e|es|ing|er)|transcript(?:ion|ions)?|speech[- ]to[- ]text|meeting notes?|voice notes?|voice recording|record(?:s|ing)? (?:speech|voice|audio)|capture(?:s|d|ing)? (?:speech|voice|audio))\b/i,
    /\b(?:inmp441|i2s[_ -]?microphone|digital[_ -]?i2s|b0h4sfmvw1)\b/i),
  rule("magnetic_contact", /\b(?:door|window|mailbox|cabinet|drawer|reed|magnetic contact)\b/i,
    /\b(?:reed|hall effect|a3144|magnetic sensor)\b/i),
  rule("water_level", /\b(?:water level|rain|leak|liquid level)\b/i, /\b(?:rain water level|liquid surface|water level)\b/i),
  rule("water_flow", /\b(?:water flow|flow meter|flow rate)\b/i, /\b(?:yf[- ]?s201|water flow)\b/i),
  rule("gps_location", /\b(?:gps|gnss|location tracker|geolocation)\b/i, /\b(?:gps|gnss|neo[- ]?[67]m|l76k)\b/i),
  rule("motion_orientation", /\b(?:orientation|tilt|accelerometer|gyroscope|imu)\b/i,
    /\b(?:mpu6050|adxl345|bno055|orientation|accelerometer|gyroscope|imu)\b/i),
  rule("load_weight", /\b(?:weight|weigh|load cell|scale)\b/i, /\b(?:hx711|load[- ]cell|weight)\b/i),
  rule("display", /\b(?:screen|display|oled|dashboard|clock|pixel face|(?:emotion|mood|feeling)(?:\s+desk)?\s+(?:buddy|companion|messenger))\b/i,
    /\b(?:screen|display|oled|ssd1306|ssd1309)\b/i, { categories: ["display"] }),
  rule("audible_output", /\b(?:buzzer|beep|alarm|audible)\b/i, /\b(?:buzzer|piezo|sounder)\b/i),
  rule("light_output", /\b(?:rgb led|status light|indicator light|traffic light|glow|lamp)\b/i,
    /\b(?:rgb led|traffic light|led module)\b/i),
  rule("touch_input", /\b(?:touch(?:screen|[ -]screen|[ -]display)|touch sensor|touch button|touch input|capacitive button)\b/i,
    /\b(?:touch(?:screen|[ -]screen|[ -]display)|touch sensor|capacitive button)\b/i),
  rule("rotary_input", /\b(?:rotary|encoder|knob|dial)\b/i, /\b(?:rotary encoder|ky[- ]?040)\b/i),
  rule("keypad_input", /\b(?:keypad|numeric pad|number pad)\b/i, /\b(?:keypad|4x4 matrix)\b/i),
  rule("joystick_input", /\b(?:joystick|game controller)\b/i, /\b(?:joystick|game controller)\b/i),
  rule("camera", /\b(?:camera|photo|vision|image capture)\b/i, /\b(?:camera|ov5640|cam dev)\b/i),
  rule("remote_notification", /(?:\b(?:send|deliver|receive|message|notify|notification|alert)\b.{0,120}\b(?:phone|mobile|partner|someone|person|family|friend)\b|\b(?:phone|mobile|partner|someone|person|family|friend)\b.{0,120}\b(?:message|notification|alert|text)\b)/i,
    /\b(?:esp32|wi-fi|wifi|wireless|bluetooth)\b/i, { categories: ["controller"] }),
  rule("servo_motion", /\b(?:servo|robot pet|moving pet|pan tilt|two[- ]axis|2[- ]axis)\b/i,
    /\b(?:servo|fs90r)\b/i, { categories: ["actuator"] }),
]);

const MEASUREMENT_CAPABILITY_IDS = Object.freeze(new Set([
  "soil_moisture", "carbon_dioxide", "air_quality", "temperature", "barometric_pressure", "humidity",
  "ambient_light", "uv_light", "spectral_color", "distance", "presence",
  "proximity", "sound", "magnetic_contact", "water_level", "water_flow",
  "gps_location", "motion_orientation", "load_weight",
]));

function rule(id, requestedPattern, providedPattern, options = {}) {
  return Object.freeze({ id, requestedPattern, providedPattern, categories: Object.freeze(options.categories || []) });
}

export function semanticCapabilitiesForPart(part = {}) {
  const text = partText(part);
  const category = String(part.category || "").toLowerCase();
  const capabilities = CAPABILITY_RULES.filter((entry) => (
    entry.providedPattern.test(text)
    || entry.categories.includes(category)
  )).map((entry) => entry.id);
  if (category === "sensor" || capabilities.some((capability) => MEASUREMENT_CAPABILITY_IDS.has(capability))) {
    capabilities.push("generic_sensing");
  }
  if (["input", "output", "display", "actuator"].includes(category)) capabilities.push("interactive_hardware");
  return [...new Set(capabilities)].sort();
}

export function requestedCapabilitiesForIdea(idea = "") {
  const text = String(idea);
  const requested = CAPABILITY_RULES.filter((entry) => hasAffirmativeMatch(text, entry.requestedPattern)).map((entry) => entry.id);
  const namedInteractiveInput = requested.some((capability) => [
    "touch_input", "rotary_input", "keypad_input", "joystick_input"
  ].includes(capability));
  const namedMeasurement = requested.some((capability) => ![
    "display", "audible_output", "light_output", "touch_input", "rotary_input",
    "keypad_input", "joystick_input", "camera", "servo_motion"
  ].includes(capability));
  if ((!namedInteractiveInput || namedMeasurement)
    && hasAffirmativeMatch(text, /\b(?:sensors?|detectors?|monitors?|measure|meters?|environmental station|environment monitor)\b/i)) {
    requested.push("generic_sensing");
  }
  if (hasAffirmativeMatch(text, /\b(?:environmental|environment)\s+(?:sensor|monitor|station)\b/i)) {
    requested.push("generic_sensing");
  }
  return [...new Set(requested)].sort();
}

function hasAffirmativeMatch(text, pattern) {
  const flags = [...new Set(`${pattern.flags.replace(/[gy]/g, "")}g`.split(""))].join("");
  const matcher = new RegExp(pattern.source, flags);
  for (const match of text.matchAll(matcher)) {
    const before = text.slice(0, match.index);
    const boundary = Math.max(
      before.lastIndexOf("."),
      before.lastIndexOf(";"),
      before.lastIndexOf(":"),
      before.lastIndexOf("\n"),
    );
    let localPrefix = before.slice(boundary + 1);
    const contrast = [...localPrefix.matchAll(/\b(?:but|however|instead|except)\b/gi)].at(-1);
    if (contrast) localPrefix = localPrefix.slice((contrast.index || 0) + contrast[0].length);
    const negated = /\b(?:do\s+not|don't|never|without|exclude|excluding|excluded|skip|skipping|omit|omitting|ignore|ignoring|forbid|forbidden|disable|disabled|must\s+not|should\s+not|cannot|can't)\b/i.test(localPrefix)
      || /\bno(?:\s+(?:additional|extra|other|any|new|more))*\s*$/i.test(localPrefix);
    if (!negated) return true;
  }
  return false;
}

export function validateSemanticFulfillment({ idea = "", parts = [] } = {}) {
  const requestedCapabilities = requestedCapabilitiesForIdea(idea);
  const providedCapabilities = [...new Set((parts || []).flatMap(semanticCapabilitiesForPart))].sort();
  const missingCapabilities = requestedCapabilities.filter((capability) => !providedCapabilities.includes(capability));
  return {
    ok: missingCapabilities.length === 0,
    status: missingCapabilities.length ? 422 : 200,
    reason: missingCapabilities.length ? "semantic_capability_coverage_incomplete" : "semantic_capability_coverage_complete",
    message: missingCapabilities.length
      ? `Selected parts do not cover requested capabilities: ${missingCapabilities.join(", ")}.`
      : "Every deterministically extracted capability is covered by the exact selected BOM.",
    requestedCapabilities,
    providedCapabilities,
    missingCapabilities,
    coveragePercent: requestedCapabilities.length
      ? Math.round(((requestedCapabilities.length - missingCapabilities.length) / requestedCapabilities.length) * 100)
      : 100,
  };
}

const STRUCTURAL_PART_CATEGORIES = Object.freeze(new Set([
  "controller", "carrier", "cable", "connector", "power", "power_distribution",
  "storage", "clock", "accessory",
]));
const GENERIC_CAPABILITIES = Object.freeze(new Set(["generic_sensing", "interactive_hardware"]));
const ENVIRONMENTAL_SENSOR_INTENT = /\b(?:environmental|environment)\s+(?:sensor|monitor|station)\b/i;
const ENVIRONMENTAL_CAPABILITIES = Object.freeze(new Set([
  "air_quality", "ambient_light", "barometric_pressure", "carbon_dioxide",
  "humidity", "temperature", "uv_light",
]));

/**
 * Enforces both halves of semantic truth: every requested capability must be
 * present, and the BOM/plan must not quietly introduce a different project.
 */
export function validateSemanticCohesion({ idea = "", plan = {}, parts = [] } = {}) {
  const fulfillment = validateSemanticFulfillment({ idea, parts });
  const requested = new Set(fulfillment.requestedCapabilities);
  const allowed = new Set(requested);
  if (hasAffirmativeMatch(String(idea), ENVIRONMENTAL_SENSOR_INTENT)) {
    for (const capability of ENVIRONMENTAL_CAPABILITIES) allowed.add(capability);
  }
  const planText = [plan.title, plan.summary, plan.behavior, ...(plan.visibleHardwareCues || [])]
    .filter(Boolean)
    .join(" ");
  const planUnrequestedCapabilities = requestedCapabilitiesForIdea(planText)
    .filter((capability) => !GENERIC_CAPABILITIES.has(capability) && !allowed.has(capability));
  const unrelatedParts = (parts || []).flatMap((part) => {
    if (STRUCTURAL_PART_CATEGORIES.has(String(part?.category || "").toLowerCase())) return [];
    const specific = semanticCapabilitiesForPart(part)
      .filter((capability) => !GENERIC_CAPABILITIES.has(capability));
    if (!specific.length || specific.some((capability) => allowed.has(capability))) return [];
    return [{
      id: String(part?.id || part?.asin || part?.name || "unknown"),
      name: String(part?.name || "Unnamed part"),
      capabilities: specific,
    }];
  });
  const ok = fulfillment.ok && !planUnrequestedCapabilities.length && !unrelatedParts.length;
  const reasons = [
    ...(fulfillment.missingCapabilities.length ? ["missing requested capabilities"] : []),
    ...(planUnrequestedCapabilities.length ? ["generated plan describes unrequested capabilities"] : []),
    ...(unrelatedParts.length ? ["selected BOM contains unrelated functional parts"] : []),
  ];
  return {
    ...fulfillment,
    ok,
    status: ok ? 200 : 422,
    reason: ok ? "semantic_cohesion_complete" : "semantic_cohesion_failed",
    message: ok
      ? "The generated plan and exact BOM match the requested capabilities without unrelated functional parts."
      : `Build blocked because ${reasons.join("; ")}.`,
    unrelatedParts,
    planUnrequestedCapabilities: [...new Set(planUnrequestedCapabilities)].sort(),
  };
}

function partText(part) {
  return [
    part.id,
    part.name,
    part.category,
    part.subtype,
    part.notes,
    part.why,
    part.listingTitle,
    ...(Array.isArray(part.assemblyAssets)
      ? part.assemblyAssets.flatMap((asset) => [asset?.partId, asset?.name])
      : []),
  ].map((value) => String(value || "")).join(" ");
}

export const PROMPT2CIRCUIT_SEMANTIC_CAPABILITY_IDS = Object.freeze(CAPABILITY_RULES.map((entry) => entry.id));
