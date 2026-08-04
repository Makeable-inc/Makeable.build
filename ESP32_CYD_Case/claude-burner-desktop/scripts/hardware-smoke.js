#!/usr/bin/env node
'use strict';

const path = require('node:path');
const { SerialManager } = require('../src/serial-manager');
const { AnimationPack } = require('../src/animation-pack');
const { StatusCode, buildDeltaPayload } = require('../src/serial-protocol');

const durationSeconds = Math.max(5, Number(process.argv[2] || 10));
const assets = new AnimationPack(path.join(__dirname, '..', 'assets'));
const serial = new SerialManager();
const availableScenes = Object.keys(assets.manifest.scenes).filter((scene) => scene !== 'no_connection');
const requestedScene = process.env.CLAUDE_BURNER_SCENE;
if (requestedScene && !availableScenes.includes(requestedScene)) {
  throw new Error(`Unknown CLAUDE_BURNER_SCENE: ${requestedScene}`);
}
const scenes = requestedScene ? [requestedScene] : availableScenes;

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function main() {
  const port = await serial.connect(process.env.CLAUDE_BURNER_PORT || null);
  await serial.sendStatus(StatusCode.STREAMING, 100, 3);
  let sceneIndex = 0;
  let frameIndex = 0;
  let transitionQueue = [];
  let previous = assets.getFrame(scenes[0], 0);
  await serial.sendKeyframe(previous, 100, 3);
  const deadline = Date.now() + durationSeconds * 1000;
  let frames = 0;
  let missed = 0;
  let deltaBytes = 0;
  let keyframes = 1;
  const sceneStats = Object.fromEntries(scenes.map((scene) => [scene, { frames: 0, missed: 0 }]));
  let nextTickAt = Date.now();
  const frameInterval = 1000 / assets.fps;
  while (Date.now() < deadline) {
    const tickStart = Date.now();
    const deliveryError = serial.consumeAsynchronousError();
    if (deliveryError) throw deliveryError;
    frameIndex += 1;
    if (scenes.length > 1 && frameIndex % (assets.fps * 5) === 0) {
      sceneIndex = (sceneIndex + 1) % scenes.length;
      transitionQueue = AnimationPack.transitionFrames(previous, assets.getFrame(scenes[sceneIndex], frameIndex));
    }
    const scene = scenes[sceneIndex];
    const current = transitionQueue.length ? transitionQueue.shift() : assets.getFrame(scene, frameIndex);
    const level = Number(scene[2]) || 1;
    const life = Math.min(100, Math.round(sceneIndex / Math.max(1, scenes.length - 1) * 100));
    const payload = buildDeltaPayload(previous, current, life, level);
    if (payload) {
      await serial.sendDelta(previous, current, life, level, { pipelined: true });
      deltaBytes += payload.length;
    } else {
      await serial.sendKeyframe(current, life, level);
      keyframes += 1;
    }
    previous = Buffer.from(current);
    frames += 1;
    sceneStats[scene].frames += 1;
    const elapsed = Date.now() - tickStart;
    if (elapsed > frameInterval) {
      missed += 1;
      sceneStats[scene].missed += 1;
    }
    nextTickAt += frameInterval;
    await wait(Math.max(0, nextTickAt - Date.now()));
  }
  await serial.waitForPipelineIdle();
  const deliveryError = serial.consumeAsynchronousError();
  if (deliveryError) throw deliveryError;
  await serial.disconnect();
  const report = {
    port,
    durationSeconds,
    frames,
    fps: frames / durationSeconds,
    missedDeadlines: missed,
    missedPercent: frames ? missed / frames * 100 : 0,
    averageDeltaKBps: deltaBytes / durationSeconds / 1000,
    keyframes,
    sceneStats,
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.missedPercent >= 1) process.exitCode = 2;
}

main().catch(async (error) => {
  try { await serial.disconnect(); } catch { /* ignore cleanup failure */ }
  console.error(error.stack || error);
  process.exitCode = 1;
});
