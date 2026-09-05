const checkedAt = "2026-08-29T00:00:00-07:00";

const candidates = Object.freeze({
  xiao: Object.freeze({
    id: "seeed-xiao-expansion-base-103030356",
    name: "Seeed Studio Expansion Board Base for XIAO",
    manufacturerSku: "103030356",
    state: "ready",
    compatibility: "Official XIAO socket footprint; manufacturer documentation says all XIAO boards support the expansion base, subject to published pin differences.",
    amazon: Object.freeze({ marketplace: "Amazon US", id: "B08P4GPR6M", url: "https://www.amazon.com/dp/B08P4GPR6M" }),
    aliexpress: null,
    manufacturerUrl: "https://www.seeedstudio.com/Seeeduino-XIAO-Expansion-board-p-4746.html",
    localGlb: Object.freeze({
      path: "artifacts/high-fidelity-glb/2026-08-28/seeed-xiao-expansion-base-103030356/models/seeed-xiao-expansion-base-103030356.glb",
      manifestPath: "artifacts/high-fidelity-glb/2026-08-28/seeed-xiao-expansion-base-103030356/manifest.json",
      sha256: "6eb3cc6be0872f3c79af55b8d004dfd2d9481fe24a646c59cbf9924a29916a9d",
    }),
    awsGlb: Object.freeze({
      url: "https://dvy6bet209exg.cloudfront.net/v1/approved-visual-catalog-v1/objects/sha256/6eb3cc6be0872f3c79af55b8d004dfd2d9481fe24a646c59cbf9924a29916a9d.glb",
      sha256: "6eb3cc6be0872f3c79af55b8d004dfd2d9481fe24a646c59cbf9924a29916a9d",
      registryRevision: "approved-visual-catalog-20260829-breakout-restricted-power-v6",
      selectionStatus: "ready",
    }),
    interfaceEligibility: "ready",
    assemblyEligibility: "ready",
    blocker: "",
  }),
  c3SuperMini: Object.freeze({
    id: "aitrip-esp32-c3-supermini-expansion-board-b0fbgfwfb1",
    name: "AITRIP ESP32-C3 SuperMini expansion board",
    state: "ready",
    compatibility: "Listing explicitly names the 16-pin ESP32-C3 SuperMini footprint and expansion-board-only option.",
    amazon: Object.freeze({ marketplace: "Amazon US", id: "B0FBGFWFB1", url: "https://www.amazon.com/dp/B0FBGFWFB1" }),
    aliexpress: Object.freeze({ marketplace: "AliExpress", id: "1005008585341920", url: "https://www.aliexpress.com/item/1005008585341920.html" }),
    localGlb: Object.freeze({
      path: "artifacts/high-fidelity-glb/2026-08-28/aitrip-esp32-c3-supermini-expansion-board-b0fbgfwfb1/models/aitrip-esp32-c3-supermini-expansion-board-b0fbgfwfb1.glb",
      manifestPath: "artifacts/high-fidelity-glb/2026-08-28/aitrip-esp32-c3-supermini-expansion-board-b0fbgfwfb1/manifest.json",
      sha256: "af48aac2094ae56e3350417f477b0068f1308e2523486c6d0d55f10eead4fe1d",
    }),
    awsGlb: Object.freeze({
      url: "https://dvy6bet209exg.cloudfront.net/v1/approved-visual-catalog-v1/objects/sha256/af48aac2094ae56e3350417f477b0068f1308e2523486c6d0d55f10eead4fe1d.glb",
      sha256: "af48aac2094ae56e3350417f477b0068f1308e2523486c6d0d55f10eead4fe1d",
      registryRevision: "approved-visual-catalog-20260829-breakout-restricted-power-v6",
      selectionStatus: "ready",
    }),
    interfaceEligibility: "ready",
    assemblyEligibility: "ready",
    selectionMode: "restricted_ready",
    mountContract: Object.freeze({ socketRows: 2, pinsPerRow: 8, orientation: "usb_c_toward_power_block" }),
    powerContract: Object.freeze({ controllerPowerSource: "controller_usb_c", peripheralVoltage: "3.3V", externalCarrierPowerConnected: false, batteryConnected: false, railModified: false }),
    blocker: "",
  }),
  esp32Devkit30: Object.freeze({
    id: "dorhea-esp32-30pin-gpio-1-to-2-expansion-board",
    name: "ESP32 30-pin GPIO 1-to-2 expansion board",
    state: "candidate_review",
    compatibility: "Listing explicitly names 30-pin ESP32S/ESP-WROOM-32 boards; 30-pin must not be substituted for 38-pin.",
    amazon: Object.freeze({ marketplace: "Amazon US", id: "B0FT3J8JB2", url: "https://www.amazon.com/dp/B0FT3J8JB2" }),
    aliexpress: Object.freeze({ marketplace: "AliExpress", id: "1005005553236672", url: "https://www.aliexpress.com/item/1005005553236672.html" }),
    blocker: "exact_socket_spacing_pin_labels_dimensions_and_glb_review_missing",
  }),
  esp32S3Devkit44: Object.freeze({
    id: "aitrip-esp32-s3-44pin-expansion-board-b0h336qrxx",
    name: "ESP32-S3 44-pin GPIO 1-to-2 expansion board",
    state: "ready",
    compatibility: "Listing explicitly names 44-pin ESP32-S3 N8R2/N16R8 development boards.",
    amazon: Object.freeze({ marketplace: "Amazon US", id: "B0H336QRXX", url: "https://www.amazon.com/dp/B0H336QRXX" }),
    aliexpress: Object.freeze({ marketplace: "AliExpress", id: "1005009901996625", url: "https://www.aliexpress.com/item/1005009901996625.html" }),
    localGlb: Object.freeze({
      path: "artifacts/high-fidelity-glb/2026-08-28/aitrip-esp32-s3-44pin-expansion-board-b0h336qrxx/models/aitrip-esp32-s3-44pin-expansion-board-b0h336qrxx.glb",
      manifestPath: "artifacts/high-fidelity-glb/2026-08-28/aitrip-esp32-s3-44pin-expansion-board-b0h336qrxx/manifest.json",
      sha256: "aec8e5e6e81deb28f3a1da8ab56a76aba0429501964e7c86227cef0e4006a9da",
    }),
    awsGlb: Object.freeze({
      url: "https://dvy6bet209exg.cloudfront.net/v1/approved-visual-catalog-v1/objects/sha256/aec8e5e6e81deb28f3a1da8ab56a76aba0429501964e7c86227cef0e4006a9da.glb",
      sha256: "aec8e5e6e81deb28f3a1da8ab56a76aba0429501964e7c86227cef0e4006a9da",
      registryRevision: "approved-visual-catalog-20260829-breakout-restricted-power-v6",
      selectionStatus: "ready",
    }),
    interfaceEligibility: "ready",
    assemblyEligibility: "ready",
    selectionMode: "restricted_ready",
    mountContract: Object.freeze({ socketRows: 2, pinsPerRow: 22, orientation: "usb_c_aligned_with_carrier_arrow" }),
    powerContract: Object.freeze({ controllerPowerSource: "controller_usb_c", peripheralVoltage: "3.3V_or_dedicated_carrier_5V", externalCarrierPowerConnected: false, dcBarrelConnected: false, fiveVoltPeripheralRailUsed: "allowed_for_user_bench_verified_routes" }),
    blocker: "",
  }),
  thingPlus: Object.freeze({
    id: "sparkfun-qwiic-shield-thing-plus-dev-16790",
    name: "SparkFun Qwiic Shield for Thing Plus",
    manufacturerSku: "DEV-16790",
    state: "blocked",
    compatibility: "Official Thing Plus/Feather footprint, four Qwiic ports, 3.3 V and GND buses.",
    amazon: null,
    aliexpress: null,
    manufacturerUrl: "https://www.sparkfun.com/sparkfun-qwiic-shield-for-thing-plus.html",
    blocker: "included_headers_require_soldering_use_controller_native_qwiic_instead",
  }),
});

const familyByAsin = new Map([
  ["B0DRNVH8MQ", "xiao"], ["B0DRNW9LJM", "xiao"], ["B0GWPZR8C6", "xiao"], ["B0DRNSV5CS", "xiao"],
  ["B0DD3ZB5XV", "c3SuperMini"], ["B0GR8WYC8C", "c3SuperMini"],
  ["B0D8T53CQ5", "esp32Devkit30"],
  ["B0GVF97WTY", "esp32S3Devkit44"], ["B0BVVGNBB3", "esp32S3Devkit44"],
  ["B0BC29D9QG", "thingPlus"],
]);

const BOARD_SPECIFIC_ASINS = new Set([
  "B0CSD5NZDJ", "B0CZHJHF7K", "B0D2XSWQWZ", "B0DXP783CQ", "B0GQ3QLB5M",
  "B0HBP9HLW9", "B0CN4F354N", "B0F4DDDQSM", "B0F99KMRVL", "B0GJT1X7H5",
  "B0H6Z84SSN", "B09ZJTVPNW", "B0DHTMYTCY", "B0DJX8J1JK", "B0CG2WQGP9", "B0F18W86GC",
  "B0GSYZTJGX", "B0H5PXC6GM", "B0GQ3W9XZ2", "B0CHSGBG73", "B0D2CY4Y5H", "B0GQ3L822F",
]);

export function breakoutResearchForController(part) {
  const asin = String(part?.asin || "").toUpperCase();
  const family = familyByAsin.get(asin);
  if (family) return structuredClone({ checkedAt, footprintFamily: family, ...candidates[family] });
  if (BOARD_SPECIFIC_ASINS.has(asin)) {
    return {
      checkedAt,
      footprintFamily: "board-specific",
      state: "blocked",
      compatibility: "No exact no-solder carrier was verified for this board-specific display, camera, LoRa, or mini layout.",
      amazon: null,
      aliexpress: null,
      blocker: "exact_compatible_breakout_not_found_do_not_substitute_by_chip_name",
    };
  }
  return null;
}

export function esp32BreakoutCandidates() {
  return structuredClone(candidates);
}
