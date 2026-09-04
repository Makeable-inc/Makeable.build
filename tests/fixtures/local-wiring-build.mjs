// Localhost-only visual QA fixture. It follows the same saved-build and
// assembly-artifact contract consumed by the production-facing workspace.
export const localWiringBuildFixture = {
  id: "local-contract-wiring-air-monitor-v3",
  title: "Compact Air-quality Monitor",
  idea: "Build a compact bedside air-quality monitor with a color display, temperature sensing, a quiet status light, and USB-C power.",
  summary: "A compact sensor display that keeps indoor air conditions visible without noisy alerts.",
  behavior: "The ESP32 reads the climate sensor, updates the display, and uses the status light for quiet feedback.",
  status: "Ready",
  image: { url: "/assets/landing/gallery-v2/window-air-final-v2.webp", source: "preview_fallback" },
  parts: [
    { id: "controller-xiao", name: "Seeed Studio XIAO ESP32C3", category: "controller", quantity: 1 },
    { id: "sensor-bme280", name: "BME280 temperature and humidity sensor", category: "sensor", quantity: 1 },
    { id: "display-tft", name: "Pre-soldered TFT display module", category: "display", quantity: 1 },
  ],
  cost: {
    knownSubtotalUsd: 0,
    pricedParts: 0,
    totalParts: 3,
    estimateLabel: "Pricing pending",
    note: "Local wiring QA fixture — confirm live retailer prices separately.",
  },
  artifactStates: {
    overview: { state: "ready" },
    wiring: { state: "ready" },
  },
  artifacts: {
    assembly: {
      state: "ready",
      parts: [
        { id: "controller", catalogPartId: "controller-xiao", role: "controller", label: "Seeed Studio XIAO ESP32C3" },
        { id: "climate", catalogPartId: "sensor-bme280", role: "climate sensor", label: "BME280" },
        { id: "display", catalogPartId: "display-tft", role: "display", label: "Pre-soldered TFT display" },
      ],
      wires: [
        { id: "climate-gnd", label: "GND", signal: "GND", color: "#171717", from: { partId: "climate", label: "BME280 · GND" }, to: { partId: "controller", label: "XIAO ESP32C3 · GND" } },
        { id: "climate-vcc", label: "VCC", signal: "3V3", color: "#ef3340", from: { partId: "climate", label: "BME280 · VIN" }, to: { partId: "controller", label: "XIAO ESP32C3 · 3V3" } },
        { id: "climate-sda", label: "SDA", signal: "I2C data", color: "#f5c92e", from: { partId: "climate", label: "BME280 · SDA" }, to: { partId: "controller", label: "XIAO ESP32C3 · GPIO6" } },
        { id: "climate-scl", label: "SCL", signal: "I2C clock", color: "#1688ff", from: { partId: "climate", label: "BME280 · SCL" }, to: { partId: "controller", label: "XIAO ESP32C3 · GPIO7" } },
      ],
      wirelessLinks: [],
      guideSteps: [
        { id: "place", kind: "placement", title: "Place the parts", beginnerInstruction: "Set the controller, display, and climate sensor on a non-conductive surface.", visibleParts: ["controller", "climate", "display"], activeWires: [] },
        { id: "seat", kind: "placement", title: "Seat the controller", beginnerInstruction: "Align the controller so the USB-C port remains reachable.", visibleParts: ["controller", "display"], activeWires: [] },
        { id: "connect-climate", kind: "wire", title: "Connect the climate sensor", beginnerInstruction: "Match each labeled climate-sensor pin to the exact controller pin shown here.", safetyNote: "Disconnect USB-C power before moving or connecting wires.", visibleParts: ["climate", "controller", "display"], activeWires: ["climate-gnd", "climate-vcc", "climate-sda", "climate-scl"] },
        { id: "check", kind: "check", title: "Check every connection", beginnerInstruction: "Confirm power, ground, data, and clock before reconnecting USB-C.", safetyNote: "If any wire feels loose, reseat it before powering the project.", visibleParts: ["climate", "controller", "display"], activeWires: ["climate-gnd", "climate-vcc", "climate-sda", "climate-scl"] },
      ],
    },
  },
};
