export const ENVIRONMENT_MONITOR_BUILD_ID = "environment-monitor-c3-2026-08-28";

export const AWS_OBJECT_ROOT =
  "https://dvy6bet209exg.cloudfront.net/v1/approved-visual-catalog-v1/objects/sha256";

export const ENVIRONMENT_MONITOR_PARTS = Object.freeze([
  {
    role: "controller",
    id: "aoicrie-4pcs-esp32-esp32-c3-mini-development-board-pre-soldered",
    label: "ESP32-C3 Super Mini (pre-soldered)",
    sha256: "9a89b82e82e6c0e44533f40d4b95f432b787cfd26028a7b9d21d5ecfb3b46c9c",
    selectionStatus: "ready",
  },
  {
    role: "carrier",
    id: "aitrip-esp32-c3-supermini-expansion-board-b0fbgfwfb1",
    label: "AITRIP ESP32-C3 SuperMini expansion board",
    sha256: "af48aac2094ae56e3350417f477b0068f1308e2523486c6d0d55f10eead4fe1d",
    selectionStatus: "ready",
  },
  {
    role: "sensor",
    id: "adafruit-sgp30-voc-breakout-3709",
    label: "SGP30 TVOC + eCO2",
    sha256: "dd3ee2f5022f81f51e55e395d16c5136bc1a3ccf51ac9ab71d73ca35c4438b33",
    address: "0x58",
    selectionStatus: "ready",
  },
  {
    role: "sensor",
    id: "adafruit-sht45-temp-humidity-breakout-5665",
    label: "SHT45 temperature + humidity",
    sha256: "c259e39df7ffbde1a4594fef1fadac544c8ca6f7d1facf9837113b1ed1d2ad2e",
    address: "0x44",
    selectionStatus: "ready",
  },
  {
    role: "sensor",
    id: "adafruit-sths34pf80-presence-breakout-6426",
    label: "STHS34PF80 human presence",
    sha256: "09680dc227ad4ef742d2e6a3914f4a847d8bc89adf626132873b248dea455ac4",
    address: "0x5A",
    selectionStatus: "ready",
  },
].map((part) => ({ ...part, glbUrl: `${AWS_OBJECT_ROOT}/${part.sha256}.glb` })));

export const ENVIRONMENT_MONITOR_NETS = Object.freeze([
  { key: "gnd", label: "GND", controllerPin: "GND", color: "#15191d" },
  { key: "vcc", label: "3V3", controllerPin: "3V3", color: "#ef5b58" },
  { key: "sda", label: "SDA", controllerPin: "GPIO8", color: "#45a9ff" },
  { key: "scl", label: "SCL", controllerPin: "GPIO9", color: "#f2c84b" },
]);

export const ENVIRONMENT_MONITOR_POLICY = Object.freeze({
  breadboardAllowed: false,
  controllerCarrierRule: "The exact 16-pin ESP32-C3 Super Mini is seated USB-C-forward in the matching carrier before any sensor wiring.",
  carrierMountContract: Object.freeze({ socketRows: 2, pinsPerRow: 8, orientation: "usb_c_toward_power_block" }),
  carrierPowerContract: Object.freeze({ controllerPowerSource: "controller_usb_c", peripheralVoltage: "3.3V", externalCarrierPowerConnected: false, batteryConnected: false, railModified: false }),
  wiringRule: "Three separated four-conductor STEMMA QT harnesses; no shared hidden junction and no wire crossings.",
  enclosureRule: "Generate and approve the hero first, then derive the enclosure STL/GLB from that hero.",
  electricalGate: "Restricted-ready only: controller USB-C power, factory-default 3.3V peripheral rails, no external carrier power, no battery, no rail modification, and no GPIO-sourced sensor load.",
});

export function assertEnvironmentMonitorContract() {
  const addresses = ENVIRONMENT_MONITOR_PARTS.filter((part) => part.address).map((part) => part.address);
  if (new Set(addresses).size !== addresses.length) throw new Error("I2C address collision");
  if (ENVIRONMENT_MONITOR_NETS.length !== 4) throw new Error("Expected four conductors per harness");
  if (ENVIRONMENT_MONITOR_PARTS.filter((part) => part.role === "sensor").length !== 3) throw new Error("Expected three sensors");
  if (ENVIRONMENT_MONITOR_POLICY.breadboardAllowed) throw new Error("Breadboard must remain disabled");
  if (ENVIRONMENT_MONITOR_POLICY.carrierMountContract.orientation !== "usb_c_toward_power_block") throw new Error("C3 carrier orientation contract changed");
  if (ENVIRONMENT_MONITOR_POLICY.carrierPowerContract.controllerPowerSource !== "controller_usb_c") throw new Error("C3 power source contract changed");
  if (ENVIRONMENT_MONITOR_POLICY.carrierPowerContract.peripheralVoltage !== "3.3V") throw new Error("C3 peripheral voltage contract changed");
  if (ENVIRONMENT_MONITOR_POLICY.carrierPowerContract.externalCarrierPowerConnected || ENVIRONMENT_MONITOR_POLICY.carrierPowerContract.batteryConnected || ENVIRONMENT_MONITOR_POLICY.carrierPowerContract.railModified) throw new Error("C3 restricted power contract changed");
  return { partCount: ENVIRONMENT_MONITOR_PARTS.length, sensorCount: 3, wireCount: 12, addresses };
}
