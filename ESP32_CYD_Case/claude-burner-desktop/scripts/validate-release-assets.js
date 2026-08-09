'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  ACTIVE_STATE_KEYS,
  AnimationPack,
  SYSTEM_STATES,
} = require('../src/animation-pack');

const APP_ROOT = path.resolve(__dirname, '..');
const ASSETS_ROOT = path.join(APP_ROOT, 'assets');
const MAX_GIF_BYTES = 550 * 1024;

function fail(message) {
  throw new Error(`Release asset validation failed: ${message}`);
}

function readPngDimensions(file) {
  const bytes = fs.readFileSync(file);
  const signature = bytes.subarray(0, 8).toString('hex');
  if (signature !== '89504e470d0a1a0a' || bytes.length < 24) {
    fail(`${path.relative(APP_ROOT, file)} is not a valid PNG`);
  }
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
  };
}

function ensureRuntimeGif(relativeFile, label) {
  if (typeof relativeFile !== 'string' || !/^gifs\/[a-z0-9_]+\.gif$/.test(relativeFile)) {
    fail(`${label} must use one runtime GIF under assets/gifs`);
  }
  const absoluteFile = path.join(ASSETS_ROOT, relativeFile);
  if (!fs.existsSync(absoluteFile)) fail(`${label} is missing ${relativeFile}`);
  const bytes = fs.statSync(absoluteFile).size;
  if (bytes < 10 || bytes > MAX_GIF_BYTES) {
    fail(`${relativeFile} is ${bytes} bytes; expected 10..${MAX_GIF_BYTES}`);
  }
  return bytes;
}

function ensureAnchor(key) {
  const relativeFile = `scenes/${key}.png`;
  const absoluteFile = path.join(ASSETS_ROOT, relativeFile);
  if (!fs.existsSync(absoluteFile)) fail(`${key} is missing static anchor ${relativeFile}`);
  const { width, height } = readPngDimensions(absoluteFile);
  if (width !== 320 || height !== 240) {
    fail(`${relativeFile} is ${width}x${height}; expected 320x240`);
  }
}

function main() {
  const manifestFile = path.join(ASSETS_ROOT, 'animation-pack.json');
  if (!fs.existsSync(manifestFile)) fail('assets/animation-pack.json does not exist');

  const pack = new AnimationPack(ASSETS_ROOT);
  if (pack.version !== 2) fail(`catalog version is ${pack.version}; expected production version 2`);

  const activeKeys = pack.publicCatalog().states.map((state) => state.key);
  if (activeKeys.length !== ACTIVE_STATE_KEYS.length
    || ACTIVE_STATE_KEYS.some((key) => !activeKeys.includes(key))) {
    fail('catalog must contain exactly the canonical 15 active state keys');
  }

  let runtimeGifBytes = 0;
  for (const key of ACTIVE_STATE_KEYS) {
    const scene = pack.scenes[key];
    runtimeGifBytes += ensureRuntimeGif(scene.gif, key);
    // This also checks GIF header/canvas, manifest byte count, and CRC32.
    pack.getDeviceGif(key);
    ensureAnchor(key);
  }

  const noConnection = pack.systemStates.no_connection;
  if (noConnection?.delivery !== 'firmware-fallback') {
    fail('no_connection must remain an explicit firmware-fallback system state');
  }
  const waiting = pack.systemStates.waiting_for_claude;
  if (waiting?.delivery !== 'firmware-rendered') {
    fail('waiting_for_claude must remain an explicit firmware-rendered system state');
  }

  process.stdout.write(
    `Release assets valid: ${ACTIVE_STATE_KEYS.length} active states + ${SYSTEM_STATES.length} system states, `
    + `${runtimeGifBytes} GIF bytes.\n`,
  );
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
}
