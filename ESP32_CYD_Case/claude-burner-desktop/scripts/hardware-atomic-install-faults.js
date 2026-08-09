#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { AnimationPack } = require('../src/animation-pack');
const { SerialManager, DeviceNackError } = require('../src/serial-manager');
const {
  AckCode,
  GIF_CHUNK_BYTES,
  PacketType,
  StatusCode,
  buildGifBeginPayload,
  buildGifChunkPayload,
  buildGifCommitPayload,
} = require('../src/serial-protocol');

const assets = new AnimationPack(path.resolve(__dirname, '..', 'assets'));
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function stage(serial, animation, chunkLimit = Infinity) {
  await serial.send(
    PacketType.GIF_BEGIN,
    buildGifBeginPayload(animation.bytes, animation.checksum, 50, 2),
    { timeoutMs: 1200, acceptedCodes: [AckCode.OKAY] },
  );
  let chunks = 0;
  for (let offset = 0; offset < animation.bytes.length && chunks < chunkLimit; offset += GIF_CHUNK_BYTES) {
    await serial.send(PacketType.GIF_CHUNK, buildGifChunkPayload(animation.bytes, offset), {
      timeoutMs: 1000,
      maximumRetries: 3,
      retryOnNack: true,
    });
    chunks += 1;
  }
  return chunks;
}

async function reconnect(serial, devicePath) {
  await sleep(1800);
  await serial.connect(devicePath);
  await serial.sendStatus(StatusCode.STREAMING, 25, 1);
}

async function assertOldActive(serial, oldAnimation, label) {
  const result = await serial.installGif(oldAnimation.bytes, oldAnimation.checksum, 25, 1);
  assert.equal(result.uploaded, false, `${label}: the previous active GIF was replaced or lost`);
  assert.equal(result.activationConfirmed, true, `${label}: active GIF did not restart`);
  const heartbeat = await serial.sendHeartbeat();
  assert.ok(heartbeat.framesPlayed >= 1, `${label}: previous GIF did not resume frame playback`);
}

async function main() {
  const serial = new SerialManager();
  const oldAnimation = assets.getDeviceGif('small_moody');
  const candidate = assets.getDeviceGif('large_explosion');
  let devicePath;
  const results = [];

  try {
    devicePath = await serial.connect(process.env.CLAUDE_BURNER_PORT || null);
    await serial.sendStatus(StatusCode.STREAMING, 25, 1);
    await serial.installGif(oldAnimation.bytes, oldAnimation.checksum, 25, 1);

    await stage(serial, candidate, 0);
    await serial.disconnect();
    await reconnect(serial, devicePath);
    await assertOldActive(serial, oldAnimation, 'begin interruption');
    results.push('begin interruption preserved active.gif');

    await stage(serial, candidate, 3);
    await serial.disconnect();
    await reconnect(serial, devicePath);
    await assertOldActive(serial, oldAnimation, 'middle interruption');
    results.push('middle interruption preserved active.gif');

    await stage(serial, candidate);
    await assert.rejects(
      serial.send(
        PacketType.GIF_COMMIT,
        buildGifCommitPayload(candidate.bytes, (candidate.checksum ^ 0xffffffff) >>> 0),
        { timeoutMs: 1200 },
      ),
      DeviceNackError,
    );
    // A rejected packet deliberately does not advance the firmware's strict
    // receive sequence. Re-establish the protocol session before issuing a
    // different, higher sequence number, matching the app's production
    // recovery path after a terminal NACK.
    await serial.disconnect();
    await reconnect(serial, devicePath);
    await assertOldActive(serial, oldAnimation, 'bad commit CRC');
    results.push('bad commit CRC preserved active.gif');

    // Restart the known-good loop at frame zero, then disconnect immediately
    // after a valid COMMIT is written. The 1.5-second watchdog must abort the
    // pending swap before the four-second loop boundary can promote it.
    await serial.sendStatus(StatusCode.NO_CONNECTION, 25, 1);
    await serial.installGif(oldAnimation.bytes, oldAnimation.checksum, 25, 1);
    await stage(serial, candidate);
    await serial.sendPipelined(
      PacketType.GIF_COMMIT,
      buildGifCommitPayload(candidate.bytes, candidate.checksum),
      { timeoutMs: 10_000 },
    );
    await serial.disconnect();
    await reconnect(serial, devicePath);
    await assertOldActive(serial, oldAnimation, 'commit interruption');
    results.push('commit interruption preserved active.gif');

    process.stdout.write(`${JSON.stringify({ devicePath, results }, null, 2)}\n`);
  } finally {
    await serial.disconnect().catch(() => {});
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
