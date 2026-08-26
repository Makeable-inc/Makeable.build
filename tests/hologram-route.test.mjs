import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("the static build publishes the complete mobile hologram app", async () => {
  await import(`../scripts/build-static.mjs?hologram-test=${Date.now()}`);
  for (const relativePath of [
    "hologram/index.html",
    "hologram/hologram.css",
    "hologram/hologram.js",
    "hologram/ble-client.js",
    "hologram/ble-protocol.js",
    "hologram/frame-codec.js",
    "hologram/sw.js",
    "hologram/manifest.webmanifest",
    "hologram/firmware/hologram-c3-supermini.bin",
    "hologram/firmware/hologram-c3-source.zip",
    "hologram/firmware/manifest.json",
  ]) await access(path.join(root, "dist", relativePath));

  const html = await readFile(path.join(root, "dist", "hologram", "index.html"), "utf8");
  assert.match(html, /id="drawCanvas"/);
  assert.match(html, /accept="image\/\*,video\/\*,\.gif"/);
  assert.match(html, /id="messageInput"/);
  assert.match(html, /data-connect-label>Connect/);
  assert.match(html, /Processed on this device/);
  assert.doesNotMatch(html, /<script[^>]+https?:\/\//);
});

test("Netlify serves /hologram inside the explicit PWA scope and grants only self Bluetooth access", async () => {
  const config = await readFile(path.join(root, "netlify.toml"), "utf8");
  assert.match(config, /from = "\/hologram"[\s\S]*?to = "\/hologram\/index\.html"[\s\S]*?status = 200/);
  assert.match(config, /for = "\/hologram\/\*"[\s\S]*?Permissions-Policy = "bluetooth=\(self\)/);
  assert.match(config, /worker-src 'self'/);
  assert.match(config, /media-src 'self' blob:/);
  assert.match(config, /for = "\/hologram\/sw\.js"[\s\S]*?Service-Worker-Allowed = "\/hologram"/);
});

test("the firmware binary and protocol sources match their release manifest", async () => {
  const manifest = JSON.parse(await readFile(path.join(root, "hologram", "firmware", "manifest.json"), "utf8"));
  const binary = await readFile(path.join(root, "hologram", "firmware", manifest.file));
  await access(path.join(root, "hologram", "firmware", manifest.source));
  assert.equal(binary.length, manifest.sizeBytes);
  assert.equal(createHash("sha256").update(binary).digest("hex"), manifest.sha256);

  const firmwareProtocol = await readFile(path.join(root, "hardware", "hologram", "firmware", "hologram-c3", "protocol.h"), "utf8");
  const browserProtocol = await readFile(path.join(root, "hologram", "ble-protocol.js"), "utf8");
  for (const uuid of [
    "3f7c1000-6a1b-4ef3-8a42-1b6d0a7c9e10",
    "3f7c1001-6a1b-4ef3-8a42-1b6d0a7c9e10",
    "3f7c1002-6a1b-4ef3-8a42-1b6d0a7c9e10",
  ]) {
    assert.match(firmwareProtocol, new RegExp(uuid));
    assert.match(browserProtocol, new RegExp(uuid));
  }
  assert.match(firmwareProtocol, /FRAME_BYTES = WIDTH \* HEIGHT \/ 8/);
  assert.match(browserProtocol, /FRAME_CHUNK_BYTES = 160/);
});
