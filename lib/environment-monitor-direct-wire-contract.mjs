export const DIRECT_WIRE_BUILD_ID = "environment-monitor-c3-direct-wire-v2-2026-08-28";

export const DIRECT_WIRE_PARTS = Object.freeze([
  {
    id: "carrier",
    assetId: "aitrip-esp32-c3-supermini-expansion-board-b0fbgfwfb1",
    label: "AITRIP ESP32-C3 SuperMini expansion board",
    sha256: "af48aac2094ae56e3350417f477b0068f1308e2523486c6d0d55f10eead4fe1d",
    assetUrl: "https://dvy6bet209exg.cloudfront.net/v1/approved-visual-catalog-v1/objects/sha256/af48aac2094ae56e3350417f477b0068f1308e2523486c6d0d55f10eead4fe1d.glb",
    connectionType: "factory_socket_terminal_and_male_breakout_pins",
    selectionStatus: "ready",
  },
  {
    id: "controller",
    assetId: "aoicrie-4pcs-esp32-esp32-c3-mini-development-board-pre-soldered",
    label: "ESP32-C3 Super Mini (pre-soldered)",
    sha256: "9a89b82e82e6c0e44533f40d4b95f432b787cfd26028a7b9d21d5ecfb3b46c9c",
    assetUrl: "https://dvy6bet209exg.cloudfront.net/v1/approved-visual-catalog-v1/objects/sha256/9a89b82e82e6c0e44533f40d4b95f432b787cfd26028a7b9d21d5ecfb3b46c9c.glb",
    connectionType: "factory_male_header",
    selectionStatus: "ready",
  },
  {
    id: "bme280",
    assetId: "gy-bme280",
    label: "GY-BME280 environmental breakout",
    sha256: "b498209bfef45def23c2960f81b3f37216407220ad2f16e9694182293fe31e96",
    assetUrl: "https://dvy6bet209exg.cloudfront.net/v1/assembly-assets-v1.1.0/plant-companion-v1/gy-bme280.glb",
    connectionType: "factory_male_header",
    selectionStatus: "ready",
  },
  {
    id: "bh1750",
    assetId: "bh1750-light",
    label: "GY-302 / BH1750 light sensor breakout",
    sha256: "8495fb46908a4e49169d0a51c9a7514d3af5452ee800c1dd54e44485a483a0a6",
    assetUrl: "https://dvy6bet209exg.cloudfront.net/v1/smart-home-interface-v1.2.0/all-parts-v1/models/bh1750-light.glb",
    connectionType: "factory_male_header",
    selectionStatus: "ready",
  },
  {
    id: "microphone",
    assetId: "microphone-sound-detector",
    label: "Microphone / sound detector",
    sha256: "f096c39eb094cd75f9e754df8458475e2551b01845cfbd0ece23fcd3ba7884ba",
    assetUrl: "https://dvy6bet209exg.cloudfront.net/v1/approved-visual-catalog-v1/objects/sha256/f096c39eb094cd75f9e754df8458475e2551b01845cfbd0ece23fcd3ba7884ba.glb",
    connectionType: "factory_male_header",
    selectionStatus: "ready",
  },
]);

function wire(id, label, color, fromPin, sensor, toPin, stepIndex) {
  return Object.freeze({
    id,
    label,
    color,
    from: { part: "carrier", pin: fromPin },
    to: { part: sensor, pin: toPin },
    termination: "individual_1p_female_dupont_at_both_ends",
    stepIndex,
  });
}

export const DIRECT_WIRE_CONNECTIONS = Object.freeze([
  wire("bme-3v3", "BME280 3V3", "#ef5b58", "3V3-A", "bme280", "VCC", 3),
  wire("bme-gnd", "BME280 GND", "#15191d", "GND-A", "bme280", "GND", 3),
  wire("bh-3v3", "BH1750 3V3", "#ef5b58", "3V3-B", "bh1750", "VCC", 3),
  wire("bh-gnd", "BH1750 GND", "#15191d", "GND-B", "bh1750", "GND", 3),
  wire("mic-3v3", "Microphone 3V3", "#ef5b58", "3V3-C", "microphone", "+", 3),
  wire("mic-gnd", "Microphone GND", "#15191d", "GND-C", "microphone", "G", 3),
  wire("bme-sda", "BME280 SDA", "#45a9ff", "GPIO8-A", "bme280", "SDA", 4),
  wire("bme-scl", "BME280 SCL", "#f2c84b", "GPIO9-A", "bme280", "SCL", 4),
  wire("bh-sda", "BH1750 SDA", "#45a9ff", "GPIO8-B", "bh1750", "SDA", 4),
  wire("bh-scl", "BH1750 SCL", "#f2c84b", "GPIO9-B", "bh1750", "SCL", 4),
  wire("mic-ao", "Microphone analog output", "#45c883", "GPIO4", "microphone", "AO", 5),
]);

export const DIRECT_WIRE_STEPS = Object.freeze([
  { id: "hero", title: "Generate the finished-product hero", description: "Sol writes one production-photography brief and gpt-image-2 renders one complete, non-exploded product hero. No visual correction loop is used." },
  { id: "seat", title: "Seat the exact ESP32-C3", description: "Insert the pre-soldered 16-pin ESP32-C3 Super Mini into the matching carrier sockets with USB-C facing the service side." },
  { id: "mount", title: "Mount the three sensor modules", description: "Align the BME280 with its vent, the BH1750 with its light window, and the microphone capsule with its acoustic grille." },
  { id: "power", title: "Connect individual power leads", description: "Push separate 1P female Dupont housings onto each exposed carrier and sensor pin: three red 3V3 leads and three black GND leads." },
  { id: "i2c", title: "Connect the shared I2C bus", description: "Use individual blue GPIO8/SDA and yellow GPIO9/SCL jumpers for BME280 and BH1750. No grouped quick connector is present." },
  { id: "analog", title: "Connect microphone AO", description: "Connect one green individual jumper from microphone AO to GPIO4/ADC1_CH4. Leave DO visibly unused." },
  { id: "housing", title: "Fit the post-hero housing", description: "Install the assembly in the hero-derived tray, preserve the three sensor openings and rear service access, then snap on the lid." },
]);

export const DIRECT_WIRE_POLICY = Object.freeze({
  breadboardAllowed: false,
  quickConnectorsAllowed: false,
  carrierMountContract: Object.freeze({ socketRows: 2, pinsPerRow: 8, orientation: "usb_c_toward_power_block" }),
  carrierPowerContract: Object.freeze({ controllerPowerSource: "controller_usb_c", peripheralVoltage: "3.3V", externalCarrierPowerConnected: false, batteryConnected: false, railModified: false }),
  quickConnectorException: "Only the Seeed Studio XIAO expansion base may use its modeled Grove quick connectors; that board is not in this build.",
  connectorRule: "Every C3-carrier-to-sensor conductor terminates in its own 1P female Dupont housing over one exposed male pin.",
  heroRule: "One complete-product studio hero, never an exploded view or wiring infographic.",
  cadRule: "Housing generation starts only after the one-shot hero image exists and its SHA-256 is recorded.",
  electricalGate: "Restricted-ready only: controller USB-C power, factory-default 3.3V peripheral rails, no external carrier power, no battery, no rail modification, and no GPIO-sourced sensor load.",
});

export function assertDirectWireContract() {
  if (DIRECT_WIRE_PARTS.length !== 5) throw new Error("Expected five AWS parts.");
  if (DIRECT_WIRE_CONNECTIONS.length !== 11) throw new Error("Expected exactly eleven conductors.");
  if (DIRECT_WIRE_CONNECTIONS.some((entry) => entry.termination !== "individual_1p_female_dupont_at_both_ends")) throw new Error("Grouped connector detected.");
  if (DIRECT_WIRE_POLICY.breadboardAllowed || DIRECT_WIRE_POLICY.quickConnectorsAllowed) throw new Error("C3 connector policy violated.");
  if (DIRECT_WIRE_PARTS.find((part) => part.id === "carrier")?.selectionStatus !== "ready") throw new Error("C3 carrier is not ready.");
  if (DIRECT_WIRE_POLICY.carrierMountContract.orientation !== "usb_c_toward_power_block") throw new Error("C3 mount contract changed.");
  if (DIRECT_WIRE_POLICY.carrierPowerContract.controllerPowerSource !== "controller_usb_c" || DIRECT_WIRE_POLICY.carrierPowerContract.peripheralVoltage !== "3.3V") throw new Error("C3 power contract changed.");
  const ids = DIRECT_WIRE_CONNECTIONS.map((entry) => entry.id);
  if (new Set(ids).size !== ids.length) throw new Error("Duplicate wire id.");
  return { partCount: 5, wireCount: 11, stepCount: DIRECT_WIRE_STEPS.length };
}
