import assert from "node:assert/strict";
import test from "node:test";

import {
  requestedCapabilitiesForIdea,
  semanticCapabilitiesForPart,
  validateSemanticCohesion,
  validateSemanticFulfillment,
} from "../lib/prompt2circuit-semantic-contract.mjs";

test("plural sensors cannot disappear from the reported Macintosh request",()=>{
 const idea="i want to build a macintosh with some sensors";
 assert.ok(requestedCapabilitiesForIdea(idea).includes("generic_sensing"));
 const validation=validateSemanticFulfillment({idea,parts:[{id:"controller",category:"controller",name:"ESP32"}]});
 assert.equal(validation.ok,false);
 assert.ok(validation.missingCapabilities.includes("generic_sensing"));
 assert.ok(!requestedCapabilitiesForIdea("Build a light without sensors").includes("generic_sensing"));
});

test("cohesion rejects the exact stale Door Chime contamination from 2fix", () => {
  const result = validateSemanticCohesion({
    idea: "Build a desktop indoor comfort station that measures temperature and humidity with a BME280",
    plan: {
      title: "Door Chime",
      summary: "A door monitor with a magnetic contact and indicator light.",
      behavior: "Chimes when the door opens.",
    },
    parts: [
      { id: "controller", category: "controller", name: "ESP32-C6 display" },
      { id: "bme280", category: "sensor", name: "BME280 temperature and humidity sensor" },
      { id: "bh1750", category: "sensor", name: "BH1750 ambient light sensor" },
      { id: "reed", category: "sensor", name: "Reed switch magnetic sensor" },
      { id: "rgb", category: "output", name: "RGB LED module" },
    ],
  });
  assert.equal(result.ok, false);
  assert.deepEqual(result.planUnrequestedCapabilities, ["light_output", "magnetic_contact"]);
  assert.deepEqual(result.unrelatedParts.map((part) => part.id), ["bh1750", "reed", "rgb"]);
});

test("extracts explicit multi-sensor intent deterministically", () => {
  assert.deepEqual(requestedCapabilitiesForIdea(
    "Build an indoor CO2, temperature, humidity, and ambient light monitor",
  ), ["ambient_light", "carbon_dioxide", "generic_sensing", "humidity", "temperature"]);
});

test("a paired emotion desk buddy carries implicit display intent", () => {
  assert.deepEqual(
    requestedCapabilitiesForIdea("I want to make a couple emotion desk buddy for me and my partner"),
    ["display"],
  );
});

test("rejects an attractive but semantically incomplete BOM", () => {
  const result = validateSemanticFulfillment({
    idea: "Build an indoor CO2, temperature, humidity, and ambient light monitor",
    parts: [
      { category: "controller", name: "ESP32-C3" },
      { category: "sensor", name: "Reed switch magnetic sensor" },
      { category: "output", name: "RGB LED module" },
    ],
  });
  assert.equal(result.ok, false);
  assert.deepEqual(result.missingCapabilities, ["ambient_light", "carbon_dioxide", "humidity", "temperature"]);
  assert.ok(result.providedCapabilities.includes("generic_sensing"));
});

test("accepts exact parts that cover every requested measurement", () => {
  const result = validateSemanticFulfillment({
    idea: "Build an indoor CO2, temperature, humidity, and ambient light monitor",
    parts: [
      { category: "controller", name: "ESP32-C3" },
      { category: "sensor", name: "Adafruit SCD-41 true CO2 sensor breakout" },
      { category: "sensor", name: "Adafruit SHT45 precision temperature and humidity sensor" },
      { category: "sensor", name: "Adafruit TSL2591 high dynamic range light sensor" },
    ],
  });
  assert.equal(result.ok, true);
  assert.equal(result.coveragePercent, 100);
});

test("plant-pot intent fails closed until a soil sensor is selected", () => {
  const result = validateSemanticFulfillment({
    idea: "Make a smart plant pot monitor",
    parts: [{ category: "sensor", name: "Adafruit SHT45 temperature humidity sensor" }],
  });
  assert.equal(result.ok, false);
  assert.deepEqual(result.missingCapabilities, ["soil_moisture"]);
});

test("external API transcription requires a voice-capable I2S microphone", () => {
  const idea = "Build a desktop meeting transcription device that sends microphone audio over Wi-Fi to an external API";
  assert.ok(requestedCapabilitiesForIdea(idea).includes("speech_audio_capture"));

  const i2s = validateSemanticFulfillment({
    idea,
    parts: [
      { category: "controller", name: "ESP32-S3 Wi-Fi controller" },
      { id: "b0h4sfmvw1-70", category: "input", name: "INMP441 digital I2S microphone" },
    ],
  });
  assert.equal(i2s.ok, true);
  assert.ok(i2s.providedCapabilities.includes("speech_audio_capture"));

  const thresholdOnly = validateSemanticFulfillment({
    idea,
    parts: [
      { category: "controller", name: "ESP32-S3 Wi-Fi controller" },
      { id: "b0cn583k69-69", category: "input", name: "KY-037 sound sensor module" },
    ],
  });
  assert.equal(thresholdOnly.ok, false);
  assert.ok(thresholdOnly.missingCapabilities.includes("speech_audio_capture"));
});

test("robot-pet intent requires actual servo motion and a screen", () => {
  const result = validateSemanticFulfillment({
    idea: "Generate a two servo robot pet for my desktop with a screen",
    parts: [{ category: "display", name: "SSD1306 OLED Display" }],
  });
  assert.equal(result.ok, false);
  assert.deepEqual(result.missingCapabilities, ["servo_motion"]);
  assert.ok(semanticCapabilitiesForPart(result).length === 0);
});

test("a named touch sensor does not add an unrelated generic-sensing requirement", () => {
  assert.deepEqual(
    requestedCapabilitiesForIdea("a TTP223 touch sensor controls an RGB LED"),
    ["light_output", "touch_input"],
  );
});

test("nearby motion means presence sensing, not optical proximity", () => {
  const idea = "Build a Halloween desk display that detects nearby motion and shows a spooky animated face on a color screen.";
  assert.deepEqual(
    requestedCapabilitiesForIdea(idea),
    ["display", "presence"],
  );
  const result = validateSemanticCohesion({
    idea,
    plan: {
      title: "Motion-Activated Halloween Face Display",
      summary: "A spooky animated face wakes when a person approaches.",
      behavior: "An LD2410C presence radar wakes the color display when someone is nearby.",
    },
    parts: [
      { id: "display", category: "display", name: "ESP32 color display" },
      { id: "ld2410c", category: "sensor", name: "Hi-Link LD2410C human presence radar sensor" },
    ],
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.missingCapabilities, []);
});

test("a manufacturer Grove PIR fulfills motion-triggered presence intent", () => {
  const result = validateSemanticFulfillment({
    idea: "Build a display that detects nearby motion",
    parts: [
      { category: "display", name: "ESP32 AMOLED display" },
      { id: "mfg-seeed-101020020-122", category: "sensor", name: "Grove PIR Motion Sensor" },
    ],
  });
  assert.equal(result.ok, true);
  assert.ok(result.providedCapabilities.includes("presence"));
});

test("explicit optical proximity and gesture intent still requires a proximity sensor", () => {
  const result = validateSemanticFulfillment({
    idea: "Use a gesture and proximity sensor to detect a nearby hand",
    parts: [{ category: "sensor", name: "Hi-Link LD2410C human presence radar sensor" }],
  });
  assert.equal(result.ok, false);
  assert.deepEqual(result.missingCapabilities, ["proximity"]);
});

test("the exact production touchscreen environmental prompt accepts a concrete environmental sensor", () => {
  const idea = "Make me a display that shows environmental sensor I want touchscreen";
  assert.deepEqual(
    requestedCapabilitiesForIdea(idea),
    ["display", "generic_sensing", "touch_input"],
  );
  const result = validateSemanticCohesion({
    idea,
    plan: {
      title: "Touchscreen Environmental Monitor",
      summary: "A touchscreen dashboard for temperature, humidity, and barometric pressure.",
      behavior: "Tap the touchscreen to switch between environmental readings.",
    },
    parts: [
      {
        id: "touch-display",
        category: "controller",
        name: "ESP32-C6 IPS Touch Display Development Board",
      },
      {
        id: "bme280",
        category: "sensor",
        name: "BME280 temperature humidity and barometric pressure sensor",
      },
    ],
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.missingCapabilities, []);
  assert.deepEqual(result.planUnrequestedCapabilities, []);
  assert.deepEqual(result.unrelatedParts, []);
});

test("environmental sensor intent still rejects unrelated camera and motion hardware", () => {
  const result = validateSemanticCohesion({
    idea: "Make me a display that shows environmental sensor I want touchscreen",
    plan: {
      title: "Camera Robot Dashboard",
      summary: "A touchscreen camera with servo motion.",
      behavior: "Use the camera to move a servo.",
    },
    parts: [
      { id: "touch-display", category: "controller", name: "ESP32-C6 touchscreen display" },
      { id: "camera", category: "camera", name: "OV5640 camera" },
      { id: "servo", category: "actuator", name: "FS90R servo" },
    ],
  });
  assert.equal(result.ok, false);
  assert.deepEqual(result.planUnrequestedCapabilities, ["camera", "servo_motion"]);
  assert.deepEqual(result.unrelatedParts.map((part) => part.id), ["camera", "servo"]);
});

test("a catalog-classified input that performs a measurement satisfies generic sensing", () => {
  const part = {
    category: "input",
    subtype: "sound_sensor",
    name: "SHILLEHTEK KY-037 Sound Sensor Module with Analog",
  };
  assert.deepEqual(semanticCapabilitiesForPart(part), ["generic_sensing", "interactive_hardware", "sound"]);
  const result = validateSemanticFulfillment({
    idea: "Build a sound-level and clap-threshold monitor",
    parts: [part],
  });
  assert.equal(result.ok, true);
  assert.equal(result.coveragePercent, 100);
});

test("playing sound through a buzzer does not invent a microphone requirement", () => {
  const idea = "Build a motion-triggered spooky-face display using a PIR motion sensor; when a person approaches, an OLED display shows an animated ghost face and a passive buzzer plays an eerie sound.";
  assert.deepEqual(
    requestedCapabilitiesForIdea(idea),
    ["audible_output", "display", "generic_sensing", "presence"],
  );
  const result = validateSemanticFulfillment({
    idea,
    parts: [
      { category: "sensor", name: "Grove PIR Motion Sensor" },
      { category: "display", name: "0.91-inch SSD1306 OLED Display Module" },
      { category: "output", name: "5V Passive Buzzer Module with Piezoelectric Sounder" },
    ],
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.missingCapabilities, []);
});

test("a clarified Wi-Fi phone notification is covered by an ESP32 controller", () => {
  const idea = "Build a Wi-Fi arrival notifier that sends a push notification to my partner's phone when someone approaches.";
  const result = validateSemanticFulfillment({
    idea,
    parts: [
      { id: "esp32", name: "ESP32-S3 Wi-Fi development board", category: "controller" },
      { id: "presence", name: "LD2410C human presence radar sensor", category: "sensor" },
    ],
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.requestedCapabilities, ["presence", "remote_notification"]);
});

test("negated exclusions never become requested capabilities", () => {
  assert.deepEqual(
    requestedCapabilitiesForIdea(
      "Use one BMP280 pressure and temperature sensor. Do not add any other sensor, display, actuator, camera, or servo.",
    ),
    ["barometric_pressure", "generic_sensing", "temperature"],
  );
  assert.deepEqual(
    requestedCapabilitiesForIdea("Build an RGB status light without a display or buzzer."),
    ["light_output"],
  );
  assert.deepEqual(
    requestedCapabilitiesForIdea("No sensors; use a display instead."),
    ["display"],
  );
});

test("BMP280 satisfies explicit barometric pressure and temperature intent", () => {
  const result = validateSemanticFulfillment({
    idea: "Measure atmospheric pressure, altitude, and temperature with a BMP280; do not add a display.",
    parts: [{ category: "sensor", name: "SHILLEHTEK pre-soldered BMP280 pressure and temperature sensor" }],
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.missingCapabilities, []);
  assert.deepEqual(result.requestedCapabilities, ["barometric_pressure", "generic_sensing", "temperature"]);
});

test("NEO-6M and NEO-7M exact modules both satisfy GPS location intent", () => {
  for (const name of ["GY-NEO6MV2 GPS module", "NEO-7M GPS module"]) {
    const result = validateSemanticFulfillment({
      idea: `Build a GPS location tracker using ${name}`,
      parts: [{ category: "sensor", name }],
    });
    assert.equal(result.ok, true, name);
    assert.ok(result.providedCapabilities.includes("gps_location"), name);
  }
});
