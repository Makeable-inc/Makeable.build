export const BOARD_PROFILES = Object.freeze({
  esp32: board({ id: "esp32", label: "ESP32", fqbn: "esp32:esp32:esp32" }),
  esp32s2: board({ id: "esp32s2", label: "ESP32-S2", fqbn: "esp32:esp32:esp32s2" }),
  esp32s3: board({ id: "esp32s3", label: "ESP32-S3", fqbn: "esp32:esp32:esp32s3" }),
  "esp32-s3-n16r8": board({
    id: "esp32-s3-n16r8",
    label: "Waveshare ESP32-S3-DEV-KIT-N16R8-M (SKU 28836)",
    fqbn:
      "esp32:esp32:esp32s3:FlashMode=qio,FlashSize=16M,PartitionScheme=app3M_fat9M_16MB,PSRAM=opi",
    // Arduino-ESP32's QIO menu option selects a QIO bootloader, while its
    // emitted esptool flash arguments intentionally keep the image header DIO.
    flashMode: "dio",
    flashFrequency: "80m",
    flashSize: "16MB",
  }),
  esp32c3: board({ id: "esp32c3", label: "ESP32-C3", fqbn: "esp32:esp32:esp32c3" }),
  esp32c6: board({ id: "esp32c6", label: "ESP32-C6", fqbn: "esp32:esp32:esp32c6" }),
});

export const USB_SERIAL_FILTERS = Object.freeze([
  Object.freeze({ usbVendorId: 0x10c4 }), // Silicon Labs CP210x
  Object.freeze({ usbVendorId: 0x1a86 }), // WCH CH34x
  Object.freeze({ usbVendorId: 0x0403 }), // FTDI
  Object.freeze({ usbVendorId: 0x303a }), // Espressif native USB
]);

const BY_FQBN = new Map(Object.values(BOARD_PROFILES).map((profile) => [profile.fqbn, profile]));

export function getBoardProfile(value) {
  const key = String(value || "").trim().toLowerCase();
  return BOARD_PROFILES[key] || BY_FQBN.get(String(value || "").trim()) || null;
}

export function selectBoardProfile(plan) {
  const explicit = getBoardProfile(plan?.boardProfile?.profileId || plan?.boardProfile?.id);
  if (explicit) return explicit;
  const description = [
    plan?.summary,
    plan?.firmware?.notes,
    ...(plan?.parts || []).flatMap((part) => [part?.name, part?.type, part?.role]),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (!/esp32/.test(description)) return null;
  if (/esp32[\s-]*c6/.test(description)) return BOARD_PROFILES.esp32c6;
  if (/esp32[\s-]*c3/.test(description)) return BOARD_PROFILES.esp32c3;
  if (/esp32[\s-]*s3/.test(description)) return BOARD_PROFILES.esp32s3;
  if (/esp32[\s-]*s2/.test(description)) return BOARD_PROFILES.esp32s2;
  return BOARD_PROFILES.esp32;
}

export function supportedBoardSummary() {
  return Object.values(BOARD_PROFILES).map(
    ({ id, label, fqbn, flashMode, flashFrequency, flashSize }) => ({
      id,
      label,
      fqbn,
      flashMode,
      flashFrequency,
      flashSize,
    }),
  );
}

function board(profile) {
  return Object.freeze({
    flashMode: "dio",
    flashFrequency: "40m",
    flashSize: "4MB",
    ...profile,
  });
}
