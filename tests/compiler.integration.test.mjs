import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = process.env.MAKEABLE_TEST_ARDUINO_CLI;

test("hosted compiler produces sparse ESP32 images and blocks arbitrary targets", { skip: !cliPath }, async (t) => {
  const port = 18787;
  const toolchain = path.resolve(root, ".makeable/toolchain");
  const child = spawn(process.execPath, ["server.mjs"], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(port),
      ARDUINO_CLI_PATH: cliPath,
      ARDUINO_DIRECTORIES_DATA: path.join(toolchain, "data"),
      ARDUINO_DIRECTORIES_DOWNLOADS: path.join(toolchain, "downloads"),
      ARDUINO_DIRECTORIES_USER: path.join(toolchain, "user"),
      NODE_ENV: "test",
      MAKEABLE_TEST_AUTH_BYPASS: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(() => child.kill("SIGTERM"));

  const base = `http://127.0.0.1:${port}`;
  await waitForServer(`${base}/api/health`);

  const statusResponse = await fetch(`${base}/api/esp32/status`);
  const status = await statusResponse.json();
  assert.equal(statusResponse.status, 200);
  assert.equal(status.hasEsp32Core, true);
  assert.equal(status.hostedMode, true);

  const compileResponse = await fetch(`${base}/api/firmware/compile`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      boardProfile: "esp32",
      sketch: "void setup() { pinMode(2, OUTPUT); }\nvoid loop() { digitalWrite(2, !digitalRead(2)); delay(100); }",
    }),
  });
  const compiled = await compileResponse.json();
  assert.equal(compileResponse.status, 200, JSON.stringify(compiled));
  assert.equal(compiled.board, "esp32");
  assert.deepEqual(
    compiled.images.map((image) => image.address),
    [0x1000, 0x8000, 0xe000, 0x10000],
  );
  assert.equal(compiled.images.some((image) => /merged|factory/i.test(image.name)), false);
  assert.ok(compiled.images.reduce((total, image) => total + image.size, 0) < 1_000_000);
  for (const image of compiled.images) {
    assert.ok(image.size > 0);
    assert.ok(image.dataBase64.length > image.size);
  }
  assert.deepEqual(compiled.flashConfig, {
    mode: "dio",
    frequency: "40m",
    size: "4MB",
  });
  assert.equal("stdout" in compiled, false);

  const acaciaResponse = await fetch(`${base}/api/firmware/compile`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      boardProfile: "esp32-s3-n16r8",
      sketch:
        "void setup() { Serial.begin(115200); }\nvoid loop() { Serial.println(\"ACACIA:BOARD:READY\"); delay(1000); }",
    }),
  });
  const acaciaCompiled = await acaciaResponse.json();
  assert.equal(acaciaResponse.status, 200, JSON.stringify(acaciaCompiled));
  assert.equal(acaciaCompiled.board, "esp32-s3-n16r8");
  assert.equal(
    acaciaCompiled.fqbn,
    "esp32:esp32:esp32s3:FlashMode=qio,FlashSize=16M,PartitionScheme=app3M_fat9M_16MB,PSRAM=opi",
  );
  assert.deepEqual(acaciaCompiled.flashConfig, {
    mode: "dio",
    frequency: "80m",
    size: "16MB",
  });
  assert.deepEqual(
    acaciaCompiled.images.map((image) => image.address),
    [0x0, 0x8000, 0xe000, 0x10000],
  );
  assert.equal(acaciaCompiled.images.some((image) => /merged|factory/i.test(image.name)), false);
  assert.ok(acaciaCompiled.images.reduce((total, image) => total + image.size, 0) < 1_000_000);

  const invalidResponse = await fetch(`${base}/api/firmware/compile`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      boardProfile: "esp32",
      sketch: "void setup() { makeableUndefinedCall(); }\nvoid loop() {}",
    }),
  });
  const invalid = await invalidResponse.json();
  assert.equal(invalidResponse.status, 500);
  assert.match(invalid.details, /makeableUndefinedCall/);
  assert.match(invalid.details, /(not declared|was not declared)/i);
  assert.doesNotMatch(invalid.details, /build-cache-path has been deprecated/i);

  const blockedResponse = await fetch(`${base}/api/firmware/compile`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ boardProfile: "attacker:board", sketch: "void setup(){} void loop(){}" }),
  });
  assert.equal(blockedResponse.status, 400);
});

async function waitForServer(url) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Test server did not start.");
}
