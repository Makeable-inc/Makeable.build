'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { AnimationPack } = require('../src/animation-pack');
const { DISPLAY_WIDTH, FRAME_BYTES } = require('../src/serial-protocol');

const assetsPath = path.resolve(__dirname, '..', 'assets');

test('production animation pack contains 48 FPS previews and 24 FPS device loops', () => {
  const pack = new AnimationPack(assetsPath);
  const previewAudit = JSON.parse(fs.readFileSync(path.join(assetsPath, pack.manifest.previewAudit), 'utf8'));
  assert.equal(pack.fps, 48);
  assert.equal(pack.manifest.frameLoadOrder, 'top-to-bottom');
  for (const scene of Object.keys(pack.manifest.scenes)) {
    assert.equal(pack.frameCount(scene), 96, scene);
    assert.ok(fs.existsSync(path.join(assetsPath, pack.previewFile(scene))), scene);
    assert.ok(fs.existsSync(path.join(assetsPath, pack.manifest.scenes[scene].deviceGif)), scene);
    assert.equal(pack.manifest.scenes[scene].deviceGifFps, 24, scene);
    assert.equal(pack.manifest.scenes[scene].deviceGifFrames, 48, scene);
    assert.equal(pack.manifest.scenes[scene].deviceGifDurationMs, 2000, scene);
    const deviceGif = pack.getDeviceGif(scene);
    assert.ok(deviceGif.bytes.length < 1_400 * 1024, `${scene} exceeds the CYD LittleFS partition`);
    assert.equal(deviceGif.checksum, pack.manifest.scenes[scene].deviceGifCrc32, scene);
    if (scene !== 'no_connection') {
      assert.equal(previewAudit[scene].frames, 96, scene);
      assert.equal(previewAudit[scene].effectiveFps, 48, scene);
      assert.ok(previewAudit[scene].uniqueFrames >= 80, scene);
      assert.ok(previewAudit[scene].meaningfulTransitions >= 72, scene);
      assert.ok(previewAudit[scene].medianChangedPixels >= 100, scene);
    }
  }
});

test('scene transitions reveal exactly from the display top down', () => {
  const start = Buffer.alloc(FRAME_BYTES, 0x00);
  const target = Buffer.alloc(FRAME_BYTES, 0xff);
  const transition = AnimationPack.transitionFrames(start, target, 240);
  assert.equal(transition.length, 240);
  const bytesPerRow = DISPLAY_WIDTH * 2;
  assert.ok(transition[0].subarray(0, bytesPerRow).equals(target.subarray(0, bytesPerRow)));
  assert.ok(transition[0].subarray(bytesPerRow).equals(start.subarray(bytesPerRow)));
  assert.ok(transition.at(-1).equals(target));
});
