import test from "node:test";
import assert from "node:assert/strict";
import { getBoardProfile, selectBoardProfile, supportedBoardSummary } from "../lib/board-profiles.mjs";
import {
  getBoardProfile as getPilotBoardProfile,
} from "../pilot/lib/board-profiles.mjs";

test("compiler targets are restricted to supported profiles", () => {
  assert.equal(getBoardProfile("esp32:esp32:esp32c3")?.id, "esp32c3");
  assert.equal(getBoardProfile("attacker:arbitrary:board"), null);
  assert.equal(supportedBoardSummary().length, 6);
  const acacia = getBoardProfile("esp32-s3-n16r8");
  assert.equal(
    acacia.label,
    "Waveshare ESP32-S3-DEV-KIT-N16R8-M (SKU 28836)",
  );
  assert.equal(acacia.flashSize, "16MB");
  assert.equal(acacia.flashMode, "dio");
  assert.equal(acacia.flashFrequency, "80m");
  assert.equal(
    acacia.fqbn,
    "esp32:esp32:esp32s3:FlashMode=qio,FlashSize=16M,PartitionScheme=app3M_fat9M_16MB,PSRAM=opi",
  );
  const pilotAcacia = getPilotBoardProfile("esp32-s3-n16r8");
  assert.equal(pilotAcacia.supportStatus, "compatible_with_differences");
  assert.match(pilotAcacia.usbConnector, /USB Type-C/i);
  assert.match(pilotAcacia.labelNote, /match every printed label/i);
});

test("board profile is inferred from the recognized hardware", () => {
  assert.equal(
    selectBoardProfile({ boardProfile: { profileId: "esp32-s3-n16r8" } }).id,
    "esp32-s3-n16r8",
  );
  assert.equal(selectBoardProfile({ parts: [{ name: "ESP32-S3 DevKitC" }] }).id, "esp32s3");
  assert.equal(selectBoardProfile({ parts: [{ name: "ESP32 C6 board" }] }).id, "esp32c6");
  assert.equal(selectBoardProfile({ parts: [{ name: "ESP32 development board" }] }).id, "esp32");
  assert.equal(selectBoardProfile({ parts: [{ name: "Arduino Uno" }] }), null);
});
