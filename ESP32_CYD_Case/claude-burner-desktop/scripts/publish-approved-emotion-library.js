'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { AnimationPack, ACTIVE_STATE_KEYS } = require('../src/animation-pack');
const { crc32 } = require('../src/serial-protocol');

const APP_ROOT = path.resolve(__dirname, '..');
const PROJECT_ROOT = path.resolve(APP_ROOT, '..');
const SOURCE_ROOT = path.join(PROJECT_ROOT, 'ember_animations', 'emotion-library-v2-production');
const SOURCE_CATALOG = path.join(SOURCE_ROOT, 'animation-catalog.json');
const ASSETS_ROOT = path.join(APP_ROOT, 'assets');
const TIMING_PATTERN = Object.freeze([40, 40, 40, 40, 40, 50]);
const FRAME_COUNT = 96;
const FRAME_DURATIONS = Array.from(
  { length: FRAME_COUNT },
  (_, index) => TIMING_PATTERN[index % TIMING_PATTERN.length],
);

function fail(message) {
  throw new Error(`Approved emotion publish failed: ${message}`);
}

function readJson(file) {
  if (!fs.existsSync(file)) fail(`missing ${file}`);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function ensureCanonicalStates(source) {
  if (!Array.isArray(source.states)) fail('source catalog has no states array');
  const keys = source.states.map((state) => state.key).sort();
  const expected = [...ACTIVE_STATE_KEYS].sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    fail('source catalog must contain exactly the canonical 15 states');
  }
  if (new Set(source.states.map((state) => state.sha256)).size !== expected.length) {
    fail('source catalog contains duplicate GIF payloads');
  }
  for (const state of source.states) {
    const geometry = state.geometry;
    if (!geometry?.aspectPreservingCentralArt || !geometry?.peripheralBackgroundExtensionOnly) {
      fail(`${state.key} does not declare aspect-preserving normalization`);
    }
    if (!Number.isFinite(geometry.relativeScaleError) || geometry.relativeScaleError > 0.005) {
      fail(`${state.key} has non-uniform central-art scaling`);
    }
  }
}

function copyState(staging, previousState, sourceState) {
  const key = sourceState.key;
  const sourceGif = path.join(SOURCE_ROOT, sourceState.file);
  const sourceAnchor = path.join(SOURCE_ROOT, sourceState.anchor);
  if (!fs.existsSync(sourceGif) || !fs.existsSync(sourceAnchor)) fail(`missing files for ${key}`);
  const targetGif = path.join(staging, 'gifs', `${key}.gif`);
  const targetAnchor = path.join(staging, 'scenes', `${key}.png`);
  fs.mkdirSync(path.dirname(targetGif), { recursive: true });
  fs.mkdirSync(path.dirname(targetAnchor), { recursive: true });
  fs.copyFileSync(sourceGif, targetGif);
  fs.copyFileSync(sourceAnchor, targetAnchor);

  const bytes = fs.readFileSync(targetGif);
  const checksum = crc32(bytes);
  if (bytes.length !== sourceState.bytes || checksum !== sourceState.crc32) {
    fail(`${key} does not match its source catalog`);
  }
  return {
    ...previousState,
    anchorFile: `scenes/${key}.png`,
    developmentAnchor: path.relative(APP_ROOT, sourceAnchor),
    gif: `gifs/${key}.gif`,
    frames: FRAME_COUNT,
    frameCount: FRAME_COUNT,
    frameDurationMs: 1_000 / 24,
    frameTimingPatternMs: [...TIMING_PATTERN],
    frameDurationsMs: [...FRAME_DURATIONS],
    fps: 24,
    durationMs: 4_000,
    loop: 0,
    frameLoadOrder: 'top-to-bottom',
    paletteColors: sourceState.emotion === 'explosion' ? 95 : 127,
    bytes: bytes.length,
    crc32: checksum,
    crc32Hex: checksum.toString(16).padStart(8, '0'),
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    source: path.relative(APP_ROOT, sourceGif),
    sourceKind: 'approved 3x5 emotion key art with deterministic bounded rig',
    geometry: { ...sourceState.geometry },
    evolutionPreview: false,
    motion: {
      type: 'authored-emotion-pose-flame-eyelid-particles',
      fps: 24,
      blink: true,
      authoredEmotionPose: true,
      flameWisps: true,
      eyeGlints: true,
      fissurePulse: true,
      emotionParticles: true,
      distantClouds: true,
      silhouetteExtraction: false,
      syntheticOutline: false,
      darkWisps: false,
      centralMountainSummitProtected: true,
      hudRegionProtected: true,
      fullOpaqueFirstFrame: true,
      transparentChangedPixelDeltas: true,
      loopSeamProtected: true,
    },
  };
}

function buildStaging() {
  const source = readJson(SOURCE_CATALOG);
  ensureCanonicalStates(source);
  const previous = readJson(path.join(ASSETS_ROOT, 'animation-pack.json'));
  const previousByKey = new Map(previous.states.map((state) => [state.key, state]));
  const staging = fs.mkdtempSync(path.join(path.dirname(ASSETS_ROOT), '.assets-emotion-next-'));
  fs.cpSync(ASSETS_ROOT, staging, { recursive: true });
  const states = source.states.map((sourceState) => {
    const prior = previousByKey.get(sourceState.key);
    if (!prior) fail(`current catalog is missing ${sourceState.key}`);
    return copyState(staging, prior, sourceState);
  });
  const next = {
    ...previous,
    pipelineVersion: '6.1.0-aspect-correct-15-state-emotion-24fps',
    complete: true,
    frames: FRAME_COUNT,
    frameCount: FRAME_COUNT,
    frameDurationMs: 1_000 / 24,
    frameTimingPatternMs: [...TIMING_PATTERN],
    frameDurationsMs: [...FRAME_DURATIONS],
    fps: 24,
    durationMs: 4_000,
    loop: 0,
    previewAndDeviceUseSameGif: true,
    visualContract: {
      approvedEmotionMatrix: true,
      authoredEmotionPoses: true,
      backgroundAnimation: 'far-left cloud light only',
      blink: true,
      syntheticOutline: false,
      silhouetteExtraction: false,
      darkWisps: false,
      protectedHudAndSummit: true,
      aspectPreservingCentralArt: true,
      peripheralBackgroundExtensionOnly: true,
    },
    evolutionPreview: {
      approved: true,
      forms: ['small', 'medium', 'large'],
      emotions: ['moody', 'hopeful', 'cheerful', 'excited', 'explosion'],
      note: 'Complete approved 3x5 emotion library; every state has unique key art and GIF bytes.',
    },
    states,
  };
  fs.writeFileSync(path.join(staging, 'animation-pack.json'), `${JSON.stringify(next, null, 2)}\n`);

  // Validate the full staged pack before the atomic directory swap.
  const pack = new AnimationPack(staging);
  for (const key of ACTIVE_STATE_KEYS) pack.getDeviceGif(key);
  return { staging, next };
}

function atomicPublish(staging) {
  const backup = `${ASSETS_ROOT}.previous-${process.pid}`;
  fs.renameSync(ASSETS_ROOT, backup);
  try {
    fs.renameSync(staging, ASSETS_ROOT);
  } catch (error) {
    fs.renameSync(backup, ASSETS_ROOT);
    throw error;
  }
  fs.rmSync(backup, { recursive: true, force: true });
}

function main() {
  const { staging, next } = buildStaging();
  try {
    atomicPublish(staging);
  } catch (error) {
    if (fs.existsSync(staging)) fs.rmSync(staging, { recursive: true, force: true });
    throw error;
  }
  process.stdout.write(
    `Published ${next.states.length} unique approved emotion loops at 24 FPS from ${SOURCE_ROOT}.\n`,
  );
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
}
