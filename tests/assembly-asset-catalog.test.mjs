import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import assemblyAssetCsv from "../lib/assembly-asset-catalog-data.mjs";
import { verifiedPartsCatalog } from "../lib/makeable-builds.mjs";

test("all active AWS GLBs are explicitly accounted for in the CSV crosswalk", async () => {
  const source = await readFile(new URL("../lib/assembly-asset-catalog.csv", import.meta.url), "utf8");
  assert.equal(assemblyAssetCsv, source);
  const rows = parseCsv(source);
  const header = rows[0];
  const records = rows.slice(1).map((row) => Object.fromEntries(header.map((key, index) => [key, row[index] || ""])));

  assert.equal(records.length, 91);
  assert.equal(new Set(records.map((record) => record.assembly_asset_id)).size, 91);
  assert.equal(records.filter((record) => record.selection_status === "ready").length, 91);
  assert.equal(records.filter((record) => record.selection_status === "candidate_review").length, 0);
  assert.equal(records.filter((record) => record.approval_basis === "user_approved_2026-08-27").length, 25);
  assert.equal(records.filter((record) => record.approval_basis === "verified_exact_connection").length, 63);
  assert.equal(records.filter((record) => record.approval_basis === "user_requested_publication_2026-08-28").length, 3);
  assert.deepEqual([...new Set(records.map((record) => record.registry_revision))], ["approved-visual-catalog-20260829-breakout-restricted-power-v6"]);
  assert.ok(records.every((record) => /^https:\/\/dvy6bet209exg\.cloudfront\.net\//.test(record.glb_url)));
  assert.ok(records.every((record) => /^[a-f0-9]{64}$/.test(record.glb_sha256)));
  assert.ok(records.every((record) => /^\d{4}-\d{2}-\d{2}$/.test(record.last_checked_yyyy_mm_dd)));
  assert.ok(records.every((record) => record.catalog_binding === "verified_catalog"));
  assert.ok(records.every((record) => /^(factory_|solderless_|modeled_)/.test(record.connector_readiness)));

  const installed = records.filter((record) => record.sold_form_geometry === "installed-header-v1");
  assert.deepEqual(installed.map((record) => record.assembly_asset_id).sort(), [
    "adafruit-bno055-orientation-breakout-2472",
    "adafruit-pn532-nfc-breakout-364",
    "esp32-s3-devkit-n16r8",
    "esp32-s3-devkitc-1-n8r2",
    "sparkfun-hx711-load-cell-amplifier-sen-13879",
  ]);
  assert.equal(records.find((record) => record.assembly_asset_id === "heltec-wifi-lora-32-v4")?.sold_form_geometry, "existing-installed-header");
  assert.ok(records.filter((record) => /adapter|hooks|socket_cable/.test(record.connector_readiness)).every((record) => record.required_accessory));
  assert.match(records.find((record) => record.assembly_asset_id.startsWith("vibration-motor-module"))?.electrical_note || "", /Never power the motor from a GPIO pin/);
});

test("the parts suggester exposes only exact ready AWS assets by catalog key", () => {
  const catalog = verifiedPartsCatalog();
  const attached = catalog.flatMap((part) => part.assemblyAssets.map((asset) => ({ asin: part.asin, ...asset })));
  const readyIds = new Set(attached.filter((asset) => asset.ready).map((asset) => asset.partId));

  assert.equal(readyIds.size, 90);
  assert.ok(attached.every((asset) => asset.url.startsWith("https://dvy6bet209exg.cloudfront.net/")));
  assert.ok(attached.every((asset) => /^[a-f0-9]{64}$/.test(asset.sha256)));
  assert.equal(readyIds.has("esp32-s3-devkitc-1-n8r2"), true);
  assert.equal(readyIds.has("sparkfun-hx711-load-cell-amplifier-sen-13879"), true);
  assert.equal(readyIds.has("heltec-wifi-lora-32-v4"), true);
  assert.equal(readyIds.has("10pcs-max485-rs485-transceiver-module-ttl-serial-to-rs-485-module-b088q8td4v-19"), true);
  assert.equal(readyIds.has("buzzer-module"), true);
  assert.equal(readyIds.has("hall-effect-magnetic-sensor"), true);
  assert.equal(readyIds.has("vibration-motor-module-3-pcs-dc5v-9000rpm-for-diy-projects"), true);
  assert.equal(readyIds.has("adafruit-apds9960-gesture-breakout-3595"), true);
  assert.equal(readyIds.has("adafruit-ltr390-uv-breakout-4831"), true);
  assert.equal(readyIds.has("adafruit-4397-qwiic-to-female-sockets"), true);
  assert.equal(readyIds.has("waveshare-esp32-s3-1-91-amoled-display-board"), true);
  assert.equal(readyIds.has("adafruit-half-size-breadboard-64"), false);
  assert.equal(readyIds.has("aitrip-esp32-c3-supermini-expansion-board-b0fbgfwfb1"), true);
  assert.equal(readyIds.has("aitrip-esp32-s3-44pin-expansion-board-b0h336qrxx"), true);
});

test("every supported ESP32 exposes a fail-closed or fully approved breakout research result", () => {
  const controllers = verifiedPartsCatalog().filter((part) => (
    part.category === "controller" && /esp32/i.test(part.name)
  ));
  assert.equal(controllers.length, 26);
  assert.ok(controllers.every((part) => part.breakoutResearch));
  assert.ok(controllers.every((part) => ["ready", "candidate_review", "blocked"].includes(part.breakoutResearch.state)));
  const xiao = controllers.find((part) => part.asin === "B0DRNW9LJM");
  assert.equal(xiao.breakoutResearch.amazon.id, "B08P4GPR6M");
  assert.equal(xiao.breakoutResearch.interfaceEligibility, "ready");
  assert.equal(xiao.breakoutResearch.assemblyEligibility, "ready");
  assert.equal(xiao.breakoutResearch.state, "ready");
  assert.match(xiao.breakoutResearch.localGlb.path, /seeed-xiao-expansion-base-103030356\.glb$/);
  assert.match(xiao.breakoutResearch.localGlb.sha256, /^[a-f0-9]{64}$/);
  assert.equal(xiao.breakoutResearch.awsGlb.selectionStatus, "ready");
  assert.equal(xiao.breakoutResearch.awsGlb.sha256, xiao.breakoutResearch.localGlb.sha256);
  const c3 = controllers.find((part) => part.asin === "B0DD3ZB5XV");
  assert.equal(c3.breakoutResearch.amazon.id, "B0FBGFWFB1");
  assert.match(c3.breakoutResearch.localGlb.path, /b0fbgfwfb1\.glb$/);
  assert.equal(c3.breakoutResearch.awsGlb.sha256, c3.breakoutResearch.localGlb.sha256);
  assert.equal(c3.breakoutResearch.selectionMode, "restricted_ready");
  assert.equal(c3.breakoutResearch.mountContract.orientation, "usb_c_toward_power_block");
  assert.equal(c3.breakoutResearch.powerContract.railModified, false);
  const s3 = controllers.find((part) => part.asin === "B0BVVGNBB3");
  assert.equal(s3.breakoutResearch.amazon.id, "B0H336QRXX");
  assert.match(s3.breakoutResearch.localGlb.path, /b0h336qrxx\.glb$/);
  assert.equal(s3.breakoutResearch.awsGlb.sha256, s3.breakoutResearch.localGlb.sha256);
  assert.equal(s3.breakoutResearch.selectionMode, "restricted_ready");
  assert.equal(s3.breakoutResearch.mountContract.orientation, "usb_c_aligned_with_carrier_arrow");
  assert.equal(s3.breakoutResearch.powerContract.fiveVoltPeripheralRailUsed, false);
  const classic = controllers.find((part) => part.asin === "B0D8T53CQ5");
  assert.equal(classic.breakoutResearch.aliexpress.id, "1005005553236672");
});

test("published ESP32 breakout products expose exact restricted readiness", () => {
  const catalog = verifiedPartsCatalog();
  const c3 = catalog.find((part) => part.asin === "B0FBGFWFB1");
  const s3 = catalog.find((part) => part.asin === "B0H336QRXX");
  const xiao = catalog.find((part) => part.asin === "B08P4GPR6M");
  assert.ok(c3 && s3 && xiao);
  assert.ok([c3, s3, xiao].every((part) => part.category === "accessory" && part.assemblyAssets.length === 1));
  assert.ok([c3, s3].every((part) => part.modelSelectable === true));
  assert.ok([c3, s3].every((part) => part.assemblyAssets[0].selectionStatus === "ready" && part.assemblyAssets[0].ready === true));
  assert.equal(xiao.modelSelectable, true);
  assert.equal(xiao.assemblyAssets[0].selectionStatus, "ready");
  assert.equal(xiao.assemblyAssets[0].ready, true);
});

test("stale OLED asset labels are bound to the exact 0.91-inch marketplace variants", () => {
  const catalog = verifiedPartsCatalog();
  const blue = catalog.find((part) => part.asin === "B0DG8JZ2TT");
  const white = catalog.find((part) => part.asin === "B0DG8KYSPH");
  assert.ok(blue?.assemblyAssets.some((asset) => asset.partId === "ssd1306-096-oled-blue"));
  assert.ok(white?.assemblyAssets.some((asset) => asset.partId === "ssd1306-096-oled-white"));
});

test("marketplace pack quantities and the no-solder cable path remain product-accurate", () => {
  const catalog = verifiedPartsCatalog();
  assert.equal(catalog.find((part) => part.asin === "B0GSR68YH9")?.packQty, 2);
  assert.equal(catalog.find((part) => part.asin === "B0DYDN9RG4")?.packQty, 2);
  assert.equal(catalog.find((part) => part.asin === "B08D5ZD528")?.packQty, 3);
  assert.equal(catalog.find((part) => part.asin === "B0D8T53CQ5")?.packQty, 3);

  const qwiicCable = catalog.find((part) => part.asin === "B09WLRBKWT");
  assert.equal(qwiicCable?.connectionType, "factory_cable");
  assert.equal(qwiicCable?.assemblyAssetAvailable, true);
  assert.equal(qwiicCable?.assemblyAssets[0]?.partId, "adafruit-4397-qwiic-to-female-sockets");
  assert.equal(qwiicCable?.assemblyAssets[0]?.selectionStatus, "ready");
});

function parseCsv(input) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (quoted) {
      if (character === '"' && input[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') quoted = false;
      else field += character;
    } else if (character === '"') quoted = true;
    else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else field += character;
  }
  return rows.filter((candidate, index) => index === 0 || candidate.some(Boolean));
}
