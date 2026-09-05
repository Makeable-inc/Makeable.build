import { projectDisplayIdentity } from "./project-identity.mjs";

export function partPlainLabel(part, build) {
  const text = `${part?.category || ""} ${part?.subtype || ""} ${part?.name || ""}`.toLowerCase();
  const projectText = `${build?.title || ""} ${build?.summary || ""} ${build?.idea || ""} ${build?.behavior || ""}`.toLowerCase();
  if (/thermal imaging|thermal camera/.test(text)) return "Thermal camera";
  if (part?.category === "controller") {
    if (/camera development|esp32.+cam|camera controller/.test(text) && /door|window|entry/.test(projectText)) {
      return "Door camera controller";
    }
    if (/esp32.+cam|camera development|camera controller/.test(text) && /camera|photo|image|vision|fpv/.test(projectText)) {
      return "Camera controller";
    }
    if (part?.compilerInjected && /display|oled|screen/.test(projectText)) {
      return "Display controller";
    }
    return "The brain";
  }
  if (/\bgnss\b|\bgps\b|\bl76\b/.test(text)) return "Location controller";
  if (part?.category === "display" || /oled|lcd|display|screen/.test(text)) return "The display";
  if (/vl53|time.of.flight|\btof\b|distance|ultrasonic|hc.?sr04/.test(text)) return "Distance sensor";
  if (/mlx.?90614|infrared temperature|non.contact temperature/.test(text)) return "Temperature sensor";
  if (/temperature|humidity|bme280|bme680|bmp180|bmp280/.test(text)) return "Climate sensor";
  if (/soil|water|moisture/.test(text)) return "Plant sensor";
  if (/particulate|air quality|pressure|gas|voc|co2|sen55/.test(text)) return "Air sensor";
  if (/uv.light|ultraviolet|spectral|ambient light|color sensor|light sensor|bh1750|tcs34725|ltr390|as7341|tsl2591/.test(text)) return "Light sensor";
  if (/current.power|ina260|power sensor|voltage sensor/.test(text)) return "Power sensor";
  if (/thermocouple|mcp9600/.test(text)) return "Thermocouple interface";
  if (/nfc.rfid|pn532|rfid|near.field/.test(text)) return "NFC reader";
  if (/pulse.oximeter|max3010|heart.rate/.test(text)) return "Health sensor";
  if (/microphone|inmp.?441|i2s.+mic|audio capture/.test(text)) return "Microphone";
  if (/reed|magnetic switch/.test(text)) return /door|window|cabinet|drawer|mailbox/.test(projectText) ? "Door sensor" : "Magnetic sensor";
  if (/hall effect|magnetic sensor/.test(text)) return "Magnetic sensor";
  if (/radar|presence/.test(text)) return "Presence sensor";
  if (/\bimu\b|orientation|accelerometer|gyroscope|mpu.?6050|mpu.?9250|gy.?521|gy.?9250|adxl.?345|bno.?0|icm.?20/.test(text)) return "Orientation sensor";
  if (/motion|\bpir\b|passive infrared/.test(text)) return "Motion sensor";
  if (/potentiometer|rotary|encoder|knob|dial/.test(text)) return "Control knob";
  if (/button|touch|input/.test(text)) return "User control";
  if (/sensor/.test(text) || part?.category === "sensor") return "Sensor";
  if (/buzzer|speaker|piezo/.test(text)) return "Sound feedback";
  if (/vibration/.test(text)) return "Vibration motor";
  if (/\bled\b|rgb|light/.test(text)) return "Status light";
  if (/servo|motor|actuator|wheel drive/.test(text) || part?.category === "actuator") return "Drive motor";
  if (/connector|qwiic|usb/.test(text)) return "Connector";
  if (/breadboard/.test(text)) return "Breadboard";
  if (/expansion.board|expansion base|gpio 1.to.2/.test(text)) return "Expansion board";
  return {
    input: "User control",
    output: "Output",
    power: "Power module",
    storage: "Storage",
    time: "Clock module",
    support: "Support module",
  }[part?.category || ""] || "Part";
}

export function projectPartPurpose(part, build) {
  const label = partPlainLabel(part, build);
  const project = build ? `“${projectDisplayIdentity(build).title}”` : "this project";
  const reason = {
    "The brain": "runs the control logic and coordinates the connected parts",
    "Vibration motor": "provides physical vibration feedback for the project",
    "The display": "makes readings, controls, and project status visible",
    "Climate sensor": "measures the temperature, humidity, or air-pressure values the project uses",
    "Temperature sensor": "measures surface temperature without requiring physical contact",
    "Light sensor": "measures ambient light so the project can respond to room brightness",
    "Distance sensor": "measures nearby distance for the project's sensing behavior",
    "Plant sensor": "measures the plant or soil condition the project needs to report",
    "Air sensor": "measures the air-quality values the project needs to report",
    "Motion sensor": "detects the movement, orientation, door state, or presence the project reacts to",
    "Door sensor": "detects whether the door is open or closed",
    "Magnetic sensor": "detects the magnetic state the project reacts to",
    "Presence sensor": "detects whether someone is present near the project",
    "Orientation sensor": "measures movement and orientation for the project's behavior",
    "Power sensor": "measures voltage, current, and power use for the project's monitoring behavior",
    "Thermocouple interface": "reads the thermocouple temperature signal the project depends on",
    "NFC reader": "reads nearby NFC or RFID tags for the project's interaction",
    "Health sensor": "measures pulse and blood-oxygen signals for the project's sensing behavior",
    "Microphone": "captures speech for the project's internet-connected transcription service",
    "Sensor": "provides the physical reading this project's behavior depends on",
    "Control knob": "gives the user a clear physical way to adjust settings or move through screens",
    "User control": "gives the user a direct way to start, stop, or change the project",
    "Status light": "provides immediate visual feedback about the project's current state",
    "Drive motor": "provides the continuous-rotation movement this build requires",
    "Sound feedback": "provides the audible feedback this build requires",
    "Camera controller": "captures images and runs the camera-driven behavior",
    "Door camera controller": "runs the door-side sensor and keeps the included camera available at the entry",
    "Display controller": "runs the separate status display and receives updates from the door-side node",
    "Thermal camera": "captures heat patterns for the project's temperature-aware behavior",
    "Location controller": "provides satellite positioning for the project's location-aware behavior",
    "Connector": "provides the required connection between the selected modules",
    "Breadboard": "provides a reusable surface for connecting and testing the circuit",
    "Expansion board": "breaks out the controller pins so the selected modules can be connected reliably",
    "Power module": "provides regulated power for the selected electronics",
    "Storage": "stores the data or media used by the project",
    "Clock module": "keeps time for the project's clock and schedule features",
    "Support module": "provides the supporting interface required by the selected hardware",
    "Output": "produces the visible or physical response described by the project",
    "Part": "provides a required hardware function in the selected build",
  }[label];
  return `Chosen for ${project} because it ${reason}.`;
}
