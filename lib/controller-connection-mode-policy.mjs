export const CONNECTION_MODES = Object.freeze({
  CARRIER_REQUIRED: "carrier_required",
  XIAO_BASE_REQUIRED: "xiao_base_required",
  INTEGRATED_DIRECT_WIRE: "integrated_direct_wire",
  DEFERRED_NOT_SELECTABLE: "deferred_not_selectable",
});

const XIAO_BASE_ASSET_ID = "seeed-xiao-expansion-base-103030356";
const S3_CARRIER_ASSET_ID = "aitrip-esp32-s3-44pin-expansion-board-b0h336qrxx";
const C3_CARRIER_ASSET_ID = "aitrip-esp32-c3-supermini-expansion-board-b0fbgfwfb1";

const XIAO_CONTROLLERS = new Set([
  "seeed-xiao-esp32c3",
  "seeed-xiao-esp32c5",
  "seeed-xiao-esp32c6",
  "seeed-xiao-esp32s3",
  // Accept the dashed spelling used by older API fixtures and aliases.
  "seeed-xiao-esp32-c3",
  "seeed-xiao-esp32-c5",
  "seeed-xiao-esp32-c6",
  "seeed-xiao-esp32-s3",
]);

const S3_CARRIER_CONTROLLERS = new Set([
  "esp32-s3-devkitc-1-n8r2",
  "esp32-s3-devkit-n16r8",
]);

const C3_CARRIER_CONTROLLERS = new Set([
  "aoicrie-4pcs-esp32-esp32-c3-mini-development-board-pre-soldered",
  "esp32-c3-mini",
]);

export const INTEGRATED_DIRECT_WIRE_CONTROLLER_ASSET_IDS = Object.freeze([
  "esp32-2432s028r-smart-display",
  "esp32-c5-lcd-dev-board",
  "esp32-c6-1-3inch-lcd-display-development-board-with-pre-soldered-header",
  "esp32-c6-1-47inch-ips-touch-display-development-board-with-pre-soldered-header",
  // Exact B0F4DDDQSM is also a complete ESP32-C6 controller. Its marketplace
  // role is controller even though the interface extractor originally grouped
  // the populated board under display because of its integrated LCD.
  "esp32-c6-rgb-led-display-board",
  "waveshare-esp32-s3-1-91-amoled-display-board",
  "esp32-s3-cam-dev-kit-exact-pre-soldered-header-variant",
  "esp32-s3-wroom-n16r8-camera-board",
  "heltec-wifi-lora-32-v4",
  "waveshare-esp32-c6-lcd-1_47-m",
  "waveshare-esp32-s3-eth-ov5640-camera-board",
  // Exact B09ZJTVPNW has a hash-bound 2x20 header map, four externally
  // allocatable GPIOs, and complete camera reservations. No sold-form-specific
  // carrier was found, so the canonical goal's fallback is its own headers.
  "esp32-camera-board",
]);

const INTEGRATED_DIRECT_WIRE_CONTROLLERS = new Set(INTEGRATED_DIRECT_WIRE_CONTROLLER_ASSET_IDS);

const EXPLICITLY_DEFERRED_CONTROLLERS = new Set([
  "esp-wroom-32-multi-pack",
  "esp32-0-96-oled-integrated-board",
  "esp32-wroom-32-classic-dev-board",
  "thing-plus-esp32",
]);

export function controllerConnectionPolicy(controllerAssetId) {
  const assetId = String(controllerAssetId || "");
  if (XIAO_CONTROLLERS.has(assetId)) return policy({
    mode: CONNECTION_MODES.XIAO_BASE_REQUIRED,
    controllerAssetId: assetId,
    requiredCarrierAssetId: XIAO_BASE_ASSET_ID,
    maximumExternalPeripherals: 4,
    allowedPeripheralConnectorIntent: "grove_4p",
  });
  if (S3_CARRIER_CONTROLLERS.has(assetId)) return policy({
    mode: CONNECTION_MODES.CARRIER_REQUIRED,
    controllerAssetId: assetId,
    requiredCarrierAssetId: S3_CARRIER_ASSET_ID,
    maximumExternalPeripherals: 8,
  });
  if (C3_CARRIER_CONTROLLERS.has(assetId)) return policy({
    mode: CONNECTION_MODES.CARRIER_REQUIRED,
    controllerAssetId: assetId,
    requiredCarrierAssetId: C3_CARRIER_ASSET_ID,
    maximumExternalPeripherals: 4,
  });
  if (INTEGRATED_DIRECT_WIRE_CONTROLLERS.has(assetId)) return policy({
    mode: CONNECTION_MODES.INTEGRATED_DIRECT_WIRE,
    controllerAssetId: assetId,
    requiredCarrierAssetId: "",
    maximumExternalPeripherals: 2,
  });
  return policy({
    mode: CONNECTION_MODES.DEFERRED_NOT_SELECTABLE,
    controllerAssetId: assetId,
    requiredCarrierAssetId: "",
    maximumExternalPeripherals: 0,
    readinessBlocker: EXPLICITLY_DEFERRED_CONTROLLERS.has(assetId)
      ? "owner_deferred_controller"
      : "controller_connection_mode_not_approved",
  });
}

export function connectionModeRequiresCarrier(mode) {
  return mode === CONNECTION_MODES.CARRIER_REQUIRED || mode === CONNECTION_MODES.XIAO_BASE_REQUIRED;
}

function policy(value) {
  return Object.freeze({
    policyVersion: "controller-connection-mode-2026-09-01-v1",
    ...value,
  });
}
