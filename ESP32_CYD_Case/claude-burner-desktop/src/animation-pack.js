'use strict';

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { crc32 } = require('./serial-protocol');
const { FRAME_BYTES, DISPLAY_HEIGHT, DISPLAY_WIDTH } = require('./serial-protocol');

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

class AnimationPack {
  constructor(assetsPath) {
    this.assetsPath = assetsPath;
    this.manifest = JSON.parse(fs.readFileSync(path.join(assetsPath, 'animation-pack.json'), 'utf8'));
    if (this.manifest.width !== DISPLAY_WIDTH || this.manifest.height !== DISPLAY_HEIGHT || this.manifest.frameBytes !== FRAME_BYTES) {
      throw new Error('Animation pack does not match the 320x240 display protocol');
    }
    this.buffers = new Map();
    this.gifBuffers = new Map();
  }

  sceneForEmotion(emotion) {
    return EMOTION_SCENES[emotion] || 'lv1_dormant';
  }

  getFrame(sceneKey, frameIndex) {
    const scene = this.manifest.scenes[sceneKey];
    if (!scene) throw new Error(`Unknown animation scene: ${sceneKey}`);
    if (!this.buffers.has(sceneKey)) {
      const stored = fs.readFileSync(path.join(this.assetsPath, scene.file));
      const data = scene.compression === 'deflate' ? zlib.inflateSync(stored) : stored;
      if (data.length !== scene.frames * FRAME_BYTES) throw new Error(`Corrupt animation: ${sceneKey}`);
      this.buffers.set(sceneKey, data);
    }
    const normalized = ((frameIndex % scene.frames) + scene.frames) % scene.frames;
    const offset = normalized * FRAME_BYTES;
    return this.buffers.get(sceneKey).subarray(offset, offset + FRAME_BYTES);
  }

  get fps() {
    return this.manifest.fps;
  }

  frameCount(sceneKey) {
    const scene = this.manifest.scenes[sceneKey];
    if (!scene) throw new Error(`Unknown animation scene: ${sceneKey}`);
    return scene.frames;
  }

  previewFile(sceneKey) {
    const scene = this.manifest.scenes[sceneKey];
    if (!scene) return null;
    return scene.preview || null;
  }

  getDeviceGif(sceneKey) {
    const scene = this.manifest.scenes[sceneKey];
    if (!scene) throw new Error(`Unknown animation scene: ${sceneKey}`);
    if (!this.gifBuffers.has(sceneKey)) {
      const relative = scene.deviceGif || scene.preview;
      if (!relative) throw new Error(`Animation scene has no GIF: ${sceneKey}`);
      const bytes = fs.readFileSync(path.join(this.assetsPath, relative));
      if (bytes.length < 6 || !['GIF87a', 'GIF89a'].includes(bytes.subarray(0, 6).toString('ascii'))) {
        throw new Error(`Invalid GIF animation: ${sceneKey}`);
      }
      if (scene.deviceGifBytes != null && bytes.length !== scene.deviceGifBytes) {
        throw new Error(`GIF size does not match manifest: ${sceneKey}`);
      }
      const checksum = crc32(bytes);
      if (scene.deviceGifCrc32 != null && checksum !== scene.deviceGifCrc32) {
        throw new Error(`GIF checksum does not match manifest: ${sceneKey}`);
      }
      this.gifBuffers.set(sceneKey, { bytes, checksum });
    }
    return this.gifBuffers.get(sceneKey);
  }

  static transitionFrames(start, target, frames = 240) {
    if (!start || start.length !== FRAME_BYTES || target.length !== FRAME_BYTES) return [target];
    const working = Buffer.from(start);
    const output = [];
    // Replace rows strictly from y=0 down to y=239. With 240 requested frames,
    // this gives a deterministic ten-second reveal at the 24 FPS device rate.
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

module.exports = { AnimationPack, EMOTION_SCENES };
