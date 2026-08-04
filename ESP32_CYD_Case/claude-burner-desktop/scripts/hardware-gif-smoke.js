'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { AnimationPack } = require('../src/animation-pack');
const { SerialManager } = require('../src/serial-manager');
const { StatusCode } = require('../src/serial-protocol');

const assets = new AnimationPack(path.resolve(__dirname, '..', 'assets'));
const requested = process.argv.slice(2);
const scenes = requested.length ? requested : ['lv1_dormant', 'lv3_supercharged'];
const holdMilliseconds = Number(process.env.BURNER_GIF_HOLD_MS || 5000);
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function observePlayback(serial, durationMs) {
  const startedAt = Date.now();
  let first = null;
  let last = null;
  let firstAt = null;
  let lastAt = null;
  while (Date.now() - startedAt < durationMs) {
    const acknowledgement = await serial.sendHeartbeat();
    if (!first) {
      first = acknowledgement;
      firstAt = Date.now();
    }
    last = acknowledgement;
    lastAt = Date.now();
    await sleep(400);
  }
  const elapsedSeconds = Math.max(0.001, (lastAt - firstAt) / 1000);
  const rendered = Math.max(0, (last?.framesPlayed || 0) - (first?.framesPlayed || 0));
  return {
    elapsedSeconds,
    framesPlayed: last?.framesPlayed,
    loopsCompleted: last?.loopsCompleted,
    lastFrameRenderMicros: last?.lastFrameRenderMicros,
    observedFps: rendered / elapsedSeconds,
  };
}

async function main() {
  const serial = new SerialManager();
  try {
    const devicePath = await serial.connect();
    await serial.sendStatus(StatusCode.STREAMING, 100, 3);
    const results = [];
    for (const scene of scenes) {
      const animation = assets.getDeviceGif(scene);
      const install = await serial.installGif(animation.bytes, animation.checksum, 100, 3);
      const playback = await observePlayback(serial, holdMilliseconds);
      const cached = await serial.installGif(animation.bytes, animation.checksum, 100, 3);
      if (playback.framesPlayed == null || playback.framesPlayed < 2) {
        throw new Error(`${scene} did not report local GIF frame playback`);
      }
      if (playback.loopsCompleted < 1) throw new Error(`${scene} did not complete a local GIF loop`);
      if (playback.observedFps < 23.8) {
        throw new Error(`${scene} missed the physical 24 FPS target (${playback.observedFps.toFixed(2)} FPS)`);
      }
      if (playback.lastFrameRenderMicros > 42_000) {
        throw new Error(`${scene} exceeded the 41.67 ms frame budget (${playback.lastFrameRenderMicros} us)`);
      }
      if (cached.uploaded) throw new Error(`${scene} was reuploaded instead of using the device cache`);
      results.push({ scene, sourceBytes: animation.bytes.length, install, playback, cached });
    }
    const report = { devicePath, protocol: 2, results };
    if (process.env.BURNER_GIF_AUDIT_PATH) {
      const auditPath = path.resolve(process.env.BURNER_GIF_AUDIT_PATH);
      fs.mkdirSync(path.dirname(auditPath), { recursive: true });
      fs.writeFileSync(auditPath, `${JSON.stringify(report, null, 2)}\n`);
    }
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } finally {
    await serial.disconnect().catch(() => {});
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
