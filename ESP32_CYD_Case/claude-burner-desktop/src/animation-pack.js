'use strict';

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const {
  crc32,
  FRAME_BYTES,
  DISPLAY_HEIGHT,
  DISPLAY_WIDTH,
} = require('./serial-protocol');

const CATALOG_VERSION = 2;
const CATALOG_FPS = 24;
const CATALOG_FRAME_COUNT = 96;
const CATALOG_FRAME_DURATION_MS = 1_000 / CATALOG_FPS;
const CATALOG_FRAME_TIMING_PATTERN_MS = Object.freeze([40, 40, 40, 40, 40, 50]);
const CATALOG_DURATION_MS = 4_000;
const MAX_DEVICE_GIF_BYTES = 550 * 1024;

const SIZES = Object.freeze(['small', 'medium', 'large']);
const EMOTIONS = Object.freeze(['moody', 'hopeful', 'cheerful', 'excited', 'explosion']);
const SYSTEM_STATES = Object.freeze(['no_connection', 'waiting_for_claude']);
const LEVEL_TO_SIZE = Object.freeze({ 1: 'small', 2: 'medium', 3: 'large' });
const SIZE_TO_LEVEL = Object.freeze({ small: 1, medium: 2, large: 3 });
const ACTIVE_STATE_KEYS = Object.freeze(
  SIZES.flatMap((size) => EMOTIONS.map((emotion) => `${size}_${emotion}`)),
);
const EXPECTED_ENVELOPES = Object.freeze({
  small: Object.freeze({ width: 112, height: 80 }),
  medium: Object.freeze({ width: 152, height: 108 }),
  large: Object.freeze({ width: 192, height: 136 }),
});

// Version-one compatibility for installed packs and persisted pre-v4 emotion values.
const EMOTION_SCENES = Object.freeze({
  dormant: 'lv1_dormant',
  exhausted: 'lv1_exhausted',
  sad_puppy: 'lv1_sad_puppy',
  curious_hopeful: 'lv1_curious_hopeful',
  worried_gloomy: 'lv2_worried_gloomy',
  neutral_attentive: 'lv2_neutral_attentive',
  energized: 'lv2_energized',
  tired_concerned: 'lv3_tired_concerned',
  happy_confident: 'lv3_happy_confident',
  supercharged: 'lv3_supercharged',
});

const EMOTION_ALIASES = Object.freeze({
  dormant: 'moody',
  exhausted: 'moody',
  sad_puppy: 'moody',
  worried_gloomy: 'moody',
  tired_concerned: 'moody',
  hope: 'hopeful',
  curious_hopeful: 'hopeful',
  cheer: 'cheerful',
  neutral_attentive: 'cheerful',
  happy_confident: 'cheerful',
  excitement: 'excited',
  energized: 'excited',
  supercharged: 'explosion',
});

const LEGACY_STATE_SCENES = Object.freeze({
  small_moody: 'lv1_dormant',
  small_hopeful: 'lv1_curious_hopeful',
  small_cheerful: 'lv1_curious_hopeful',
  small_excited: 'lv1_curious_hopeful',
  small_explosion: 'lv1_curious_hopeful',
  medium_moody: 'lv2_worried_gloomy',
  medium_hopeful: 'lv2_neutral_attentive',
  medium_cheerful: 'lv2_neutral_attentive',
  medium_excited: 'lv2_energized',
  medium_explosion: 'lv2_energized',
  large_moody: 'lv3_tired_concerned',
  large_hopeful: 'lv3_happy_confident',
  large_cheerful: 'lv3_happy_confident',
  large_excited: 'lv3_supercharged',
  large_explosion: 'lv3_supercharged',
});

function canonicalSize(level) {
  if (typeof level === 'string') {
    const normalized = level.trim().toLowerCase();
    if (SIZE_TO_LEVEL[normalized]) return normalized;
    const match = normalized.match(/^(?:lv|level)[_. -]?([123])$/);
    if (match) return LEVEL_TO_SIZE[Number(match[1])];
  }
  const numeric = Number(level);
  return LEVEL_TO_SIZE[numeric] || null;
}

function canonicalEmotion(emotion) {
  if (typeof emotion !== 'string') return null;
  const normalized = emotion.trim().toLowerCase().replace(/[ -]+/g, '_');
  if (EMOTIONS.includes(normalized)) return normalized;
  return EMOTION_ALIASES[normalized] || null;
}

function stateKeyFor(level, emotion) {
  const size = canonicalSize(level);
  const mood = canonicalEmotion(emotion);
  return size && mood ? `${size}_${mood}` : null;
}

function clone(value) {
  if (value == null) return value;
  return JSON.parse(JSON.stringify(value));
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function finiteNumber(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function sceneFrameCount(scene, manifest) {
  return finiteNumber(scene.frameCount ?? scene.frames, finiteNumber(manifest.frameCount ?? manifest.frames));
}

function sceneFrameDuration(scene, manifest) {
  return finiteNumber(scene.frameDurationMs, finiteNumber(manifest.frameDurationMs));
}

function numericArray(value) {
  if (!Array.isArray(value) || value.length === 0) return null;
  const values = value.map((entry) => finiteNumber(entry));
  return values.every((entry) => entry != null) ? values : null;
}

function sceneFrameTimingPattern(scene, manifest) {
  return numericArray(scene.frameTimingPatternMs) || numericArray(manifest.frameTimingPatternMs);
}

function timingPatternMatches(actual, expected) {
  return Array.isArray(actual)
    && actual.length === expected.length
    && actual.every((value, index) => value === expected[index]);
}

function sceneDuration(scene, manifest) {
  const explicit = finiteNumber(scene.durationMs, finiteNumber(manifest.durationMs));
  if (explicit != null) return explicit;
  const frames = sceneFrameCount(scene, manifest);
  const frameDuration = sceneFrameDuration(scene, manifest);
  return frames != null && frameDuration != null ? frames * frameDuration : null;
}

function gifFileFor(scene) {
  if (!scene) return null;
  if (typeof scene.gif === 'string' && scene.gif) return scene.gif;
  if (scene.deviceGif && scene.preview && scene.deviceGif !== scene.preview) return scene.deviceGif;
  return scene.deviceGif || scene.preview || null;
}

function expectedGifBytes(scene) {
  return finiteNumber(scene.bytes ?? scene.gifBytes ?? scene.deviceGifBytes);
}

function expectedGifCrc32(scene) {
  return finiteNumber(scene.crc32 ?? scene.gifCrc32 ?? scene.deviceGifCrc32);
}

function systemConfigEntries(systemStates) {
  if (Array.isArray(systemStates)) {
    return systemStates.map((entry) => [entry.key, entry]);
  }
  if (systemStates && typeof systemStates === 'object') return Object.entries(systemStates);
  return [];
}

function normalizedScenes(manifest) {
  const scenes = {};
  if (manifest.scenes && typeof manifest.scenes === 'object' && !Array.isArray(manifest.scenes)) {
    for (const [key, value] of Object.entries(manifest.scenes)) {
      scenes[key] = { key, ...value };
    }
  }
  if (Array.isArray(manifest.states)) {
    for (const state of manifest.states) {
      if (!state || typeof state.key !== 'string' || !state.key) {
        throw new Error('Animation catalog states must each have a non-empty key');
      }
      scenes[state.key] = { ...(scenes[state.key] || {}), ...state, key: state.key };
    }
  }
  for (const [key, config] of systemConfigEntries(manifest.systemStates)) {
    if (!key) throw new Error('Animation catalog system states must each have a non-empty key');
    if (config && typeof config === 'object' && gifFileFor(config)) {
      scenes[key] = { ...(scenes[key] || {}), ...config, key, system: true };
    }
  }
  return scenes;
}

function systemStatesObject(manifest) {
  return Object.fromEntries(
    systemConfigEntries(manifest.systemStates).map(([key, config]) => [
      key,
      typeof config === 'string' ? { scene: config } : { ...(config || {}), key },
    ]),
  );
}

function validateTheme(theme, key) {
  if (!theme || typeof theme !== 'object') throw new Error(`Animation state ${key} has no theme`);
  for (const field of ['primary', 'secondary', 'base']) {
    if (typeof theme[field] !== 'string' || !/^#[0-9a-f]{6}$/i.test(theme[field])) {
      throw new Error(`Animation state ${key} has an invalid theme.${field}`);
    }
  }
}

class AnimationPack {
  constructor(assetsPath) {
    this.assetsPath = assetsPath;
    this.manifest = JSON.parse(fs.readFileSync(path.join(assetsPath, 'animation-pack.json'), 'utf8'));
    this.version = finiteNumber(this.manifest.version, 1);
    if (![1, CATALOG_VERSION].includes(this.version)) {
      throw new Error(`Unsupported animation catalog version: ${this.manifest.version}`);
    }
    if (
      this.manifest.width !== DISPLAY_WIDTH
      || this.manifest.height !== DISPLAY_HEIGHT
      || (this.manifest.frameBytes != null && this.manifest.frameBytes !== FRAME_BYTES)
    ) {
      throw new Error('Animation pack does not match the 320x240 display protocol');
    }

    this.scenes = normalizedScenes(this.manifest);
    this.systemStates = systemStatesObject(this.manifest);
    // Keep legacy integrations data-driven even when v2 uses a states array.
    this.manifest.scenes = this.scenes;
    this.buffers = new Map();
    this.gifBuffers = new Map();
    this.defaultScene = this._resolveDefaultScene();

    if (this.version === CATALOG_VERSION) this._validateV2Catalog();
    this._catalog = this._buildPublicCatalog();
  }

  _resolveDefaultScene() {
    const requested = this.manifest.defaultState;
    if (requested && this.scenes[requested]) return requested;
    if (this.scenes.small_moody) return 'small_moody';
    if (this.scenes.lv1_dormant) return 'lv1_dormant';
    return Object.keys(this.scenes)[0] || null;
  }

  _isSystemScene(key, scene) {
    if (scene.system === true || SYSTEM_STATES.includes(key)) return true;
    return Object.values(this.systemStates).some((config) => config.scene === key);
  }

  _validateV2Catalog() {
    const activeKeys = Object.entries(this.scenes)
      .filter(([key, scene]) => !this._isSystemScene(key, scene))
      .map(([key]) => key)
      .sort();
    const expectedKeys = [...ACTIVE_STATE_KEYS].sort();
    if (activeKeys.length !== expectedKeys.length || activeKeys.some((key, index) => key !== expectedKeys[index])) {
      const missing = expectedKeys.filter((key) => !activeKeys.includes(key));
      const extra = activeKeys.filter((key) => !expectedKeys.includes(key));
      throw new Error(
        `Animation catalog v2 must contain exactly 15 active states`
        + `${missing.length ? `; missing: ${missing.join(', ')}` : ''}`
        + `${extra.length ? `; unexpected: ${extra.join(', ')}` : ''}`,
      );
    }

    if (finiteNumber(this.manifest.fps) !== CATALOG_FPS) {
      throw new Error(`Animation catalog v2 must run at ${CATALOG_FPS} FPS`);
    }
    for (const systemState of SYSTEM_STATES) {
      if (!this.systemStates[systemState] && !this.scenes[systemState]) {
        throw new Error(`Animation catalog v2 is missing system state: ${systemState}`);
      }
    }

    const gifPaths = new Set();
    for (const key of ACTIVE_STATE_KEYS) {
      const scene = this.scenes[key];
      const [size, emotion] = key.split('_');
      if (scene.size !== size || Number(scene.level) !== SIZE_TO_LEVEL[size] || scene.emotion !== emotion) {
        throw new Error(`Animation state metadata does not match its key: ${key}`);
      }
      const envelope = scene.envelope;
      const expectedEnvelope = EXPECTED_ENVELOPES[size];
      if (!envelope || envelope.width !== expectedEnvelope.width || envelope.height !== expectedEnvelope.height) {
        throw new Error(`Animation state ${key} does not use the ${size} body envelope`);
      }
      const centerX = finiteNumber(scene.anchor?.centerX ?? scene.centerX);
      const groundY = finiteNumber(scene.anchor?.groundY ?? scene.groundY);
      if (centerX !== 160 || groundY !== 204) {
        throw new Error(`Animation state ${key} must use centerX=160 and groundY=204`);
      }
      if (typeof scene.anchorFile !== 'string' || !scene.anchorFile) {
        throw new Error(`Animation state ${key} must declare its static anchor file`);
      }
      if (sceneFrameCount(scene, this.manifest) !== CATALOG_FRAME_COUNT) {
        throw new Error(`Animation state ${key} must contain ${CATALOG_FRAME_COUNT} frames`);
      }
      const nominalFrameDuration = sceneFrameDuration(scene, this.manifest);
      if (nominalFrameDuration == null || Math.abs(nominalFrameDuration - CATALOG_FRAME_DURATION_MS) > 1e-6) {
        throw new Error(`Animation state ${key} must use a nominal ${CATALOG_FRAME_DURATION_MS}ms frame duration`);
      }
      const timingPattern = sceneFrameTimingPattern(scene, this.manifest);
      if (!timingPatternMatches(timingPattern, CATALOG_FRAME_TIMING_PATTERN_MS)) {
        throw new Error(
          `Animation state ${key} must use the ${CATALOG_FRAME_TIMING_PATTERN_MS.join('/')}`
          + 'ms exact-12-FPS timing pattern',
        );
      }
      if (sceneDuration(scene, this.manifest) !== CATALOG_DURATION_MS) {
        throw new Error(`Animation state ${key} must last ${CATALOG_DURATION_MS}ms`);
      }
      const relativeGif = scene.gif;
      if (typeof relativeGif !== 'string' || !relativeGif) {
        throw new Error(`Animation state ${key} must declare one shared gif`);
      }
      if (gifPaths.has(relativeGif)) throw new Error(`Animation states must use distinct GIF files: ${relativeGif}`);
      gifPaths.add(relativeGif);
      const bytes = expectedGifBytes(scene);
      const checksum = expectedGifCrc32(scene);
      if (!Number.isInteger(bytes) || bytes < 10 || bytes > MAX_DEVICE_GIF_BYTES) {
        throw new Error(`Animation state ${key} has an invalid GIF byte count`);
      }
      if (!Number.isInteger(checksum) || checksum < 0 || checksum > 0xffffffff) {
        throw new Error(`Animation state ${key} has an invalid GIF CRC32`);
      }
      validateTheme(scene.theme, key);
    }
  }

  _buildPublicCatalog() {
    const activeKeys = this.version === CATALOG_VERSION
      ? ACTIVE_STATE_KEYS
      : Object.keys(this.scenes).filter((key) => !this._isSystemScene(key, this.scenes[key]));
    const states = activeKeys.map((key) => {
      const scene = this.scenes[key];
      return {
        key,
        size: scene.size || canonicalSize(scene.level),
        level: finiteNumber(scene.level),
        emotion: scene.emotion || null,
        label: scene.label || key,
        envelope: clone(scene.envelope) || null,
        anchor: clone(scene.anchor) || null,
        anchorFile: scene.anchorFile || scene.poster || scene.staticAnchor || null,
        theme: clone(scene.theme) || null,
        preview: this.previewFile(key),
        frameCount: sceneFrameCount(scene, this.manifest),
        frameDurationMs: sceneFrameDuration(scene, this.manifest),
        frameTimingPatternMs: clone(sceneFrameTimingPattern(scene, this.manifest)),
        durationMs: sceneDuration(scene, this.manifest),
        bytes: expectedGifBytes(scene),
        crc32: expectedGifCrc32(scene),
      };
    });
    return deepFreeze({
      version: this.version,
      width: this.manifest.width,
      height: this.manifest.height,
      fps: this.fps,
      frameCount: finiteNumber(this.manifest.frameCount ?? this.manifest.frames),
      durationMs: finiteNumber(this.manifest.durationMs),
      frameTimingPatternMs: clone(sceneFrameTimingPattern({}, this.manifest)),
      states,
      systemStates: clone(this.systemStates),
    });
  }

  get catalog() {
    return this._catalog;
  }

  publicCatalog() {
    return this._catalog;
  }

  sceneForState(level, emotion) {
    const stateKey = stateKeyFor(level, emotion);
    if (!stateKey) return this.defaultScene;
    if (this.scenes[stateKey]) return stateKey;
    const legacyScene = LEGACY_STATE_SCENES[stateKey];
    return legacyScene && this.scenes[legacyScene] ? legacyScene : this.defaultScene;
  }

  sceneForEmotion(emotion, level = null) {
    if (level != null) return this.sceneForState(level, emotion);
    const normalized = typeof emotion === 'string'
      ? emotion.trim().toLowerCase().replace(/[ -]+/g, '_')
      : '';
    const legacyScene = EMOTION_SCENES[normalized];
    if (legacyScene && this.scenes[legacyScene]) return legacyScene;
    const defaultLevel = SIZE_TO_LEVEL[this.defaultScene?.split('_')[0]] || 1;
    return this.sceneForState(defaultLevel, normalized);
  }

  systemScene(systemState) {
    const config = this.systemStates[systemState];
    if (config?.scene && this.scenes[config.scene]) return config.scene;
    return this.scenes[systemState] ? systemState : null;
  }

  hasScene(sceneKey) {
    return Boolean(this.scenes[sceneKey]);
  }

  getFrame(sceneKey, frameIndex) {
    const scene = this.scenes[sceneKey];
    if (!scene) throw new Error(`Unknown animation scene: ${sceneKey}`);
    const rawFile = scene.raw?.file || scene.rawFile || (this.version < CATALOG_VERSION ? scene.file : null);
    if (!rawFile) {
      throw new Error(`Animation scene has no raw RGB565 frames; use its GIF instead: ${sceneKey}`);
    }
    if (!this.buffers.has(sceneKey)) {
      const stored = fs.readFileSync(path.join(this.assetsPath, rawFile));
      const compression = scene.raw?.compression || scene.compression;
      const data = compression === 'deflate' ? zlib.inflateSync(stored) : stored;
      const frames = scene.raw?.frames || sceneFrameCount(scene, this.manifest);
      if (!Number.isInteger(frames) || data.length !== frames * FRAME_BYTES) {
        throw new Error(`Corrupt animation: ${sceneKey}`);
      }
      this.buffers.set(sceneKey, { data, frames });
    }
    const { data, frames } = this.buffers.get(sceneKey);
    const normalized = ((frameIndex % frames) + frames) % frames;
    const offset = normalized * FRAME_BYTES;
    return data.subarray(offset, offset + FRAME_BYTES);
  }

  get fps() {
    return finiteNumber(this.manifest.fps, null);
  }

  frameCount(sceneKey) {
    const scene = this.scenes[sceneKey];
    if (!scene) throw new Error(`Unknown animation scene: ${sceneKey}`);
    return sceneFrameCount(scene, this.manifest);
  }

  frameTimingPattern(sceneKey) {
    const scene = this.scenes[sceneKey];
    if (!scene) throw new Error(`Unknown animation scene: ${sceneKey}`);
    return Object.freeze([...(sceneFrameTimingPattern(scene, this.manifest) || [])]);
  }

  previewFile(sceneKey) {
    const scene = this.scenes[sceneKey];
    if (!scene) return null;
    return scene.gif || scene.preview || scene.deviceGif || null;
  }

  getDeviceGif(sceneKey) {
    const scene = this.scenes[sceneKey];
    if (!scene) throw new Error(`Unknown animation scene: ${sceneKey}`);
    const relative = gifFileFor(scene);
    if (!relative) throw new Error(`Animation scene has no GIF: ${sceneKey}`);
    if (!this.gifBuffers.has(relative)) {
      const bytes = fs.readFileSync(path.join(this.assetsPath, relative));
      if (bytes.length < 10 || !['GIF87a', 'GIF89a'].includes(bytes.subarray(0, 6).toString('ascii'))) {
        throw new Error(`Invalid GIF animation: ${sceneKey}`);
      }
      const width = bytes.readUInt16LE(6);
      const height = bytes.readUInt16LE(8);
      if (width !== DISPLAY_WIDTH || height !== DISPLAY_HEIGHT) {
        throw new Error(`GIF canvas does not match the 320x240 display: ${sceneKey}`);
      }
      this.gifBuffers.set(relative, { bytes, checksum: crc32(bytes), file: relative });
    }
    const result = this.gifBuffers.get(relative);
    const expectedBytes = expectedGifBytes(scene);
    if (expectedBytes != null && result.bytes.length !== expectedBytes) {
      throw new Error(`GIF size does not match manifest: ${sceneKey}`);
    }
    const expectedChecksum = expectedGifCrc32(scene);
    if (expectedChecksum != null && result.checksum !== expectedChecksum) {
      throw new Error(`GIF checksum does not match manifest: ${sceneKey}`);
    }
    if (this.version === CATALOG_VERSION && result.bytes.length > MAX_DEVICE_GIF_BYTES) {
      throw new Error(`GIF exceeds the ${MAX_DEVICE_GIF_BYTES}-byte atomic-install limit: ${sceneKey}`);
    }
    return result;
  }

  static transitionFrames(start, target, frames = 240) {
    if (!start || start.length !== FRAME_BYTES || target.length !== FRAME_BYTES) return [target];
    const working = Buffer.from(start);
    const output = [];
    // Replace rows strictly from y=0 down to y=239.
    const rowOrder = Array.from({ length: DISPLAY_HEIGHT }, (_, row) => row);
    const rowsPerFrame = Math.ceil(DISPLAY_HEIGHT / frames);
    for (let index = 0; index < frames; index += 1) {
      for (let inner = 0; inner < rowsPerFrame; inner += 1) {
        const orderIndex = index * rowsPerFrame + inner;
        if (orderIndex >= rowOrder.length) break;
        const row = rowOrder[orderIndex];
        const offset = row * DISPLAY_WIDTH * 2;
        target.copy(working, offset, offset, offset + DISPLAY_WIDTH * 2);
      }
      output.push(Buffer.from(working));
    }
    if (!output.at(-1).equals(target)) output.push(target);
    return output;
  }
}

module.exports = {
  AnimationPack,
  ACTIVE_STATE_KEYS,
  CATALOG_VERSION,
  CATALOG_FPS,
  CATALOG_FRAME_COUNT,
  CATALOG_FRAME_TIMING_PATTERN_MS,
  EMOTION_SCENES,
  EMOTIONS,
  EXPECTED_ENVELOPES,
  MAX_DEVICE_GIF_BYTES,
  SIZES,
  SYSTEM_STATES,
  canonicalEmotion,
  canonicalSize,
  stateKeyFor,
};
