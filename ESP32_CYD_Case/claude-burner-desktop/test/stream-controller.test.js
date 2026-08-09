'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { StreamController } = require('../src/stream-controller');

function animationStub() {
  return {
    getDeviceGif(scene) {
      assert.equal(scene, 'medium_cheerful');
      return { bytes: Buffer.from('GIF89a-scene'), checksum: 1234 };
    },
  };
}

test('new scene is not reported active until device activation is acknowledged', async () => {
  let confirmInstall;
  const serial = {
    installGif() {
      return new Promise((resolve) => { confirmInstall = resolve; });
    },
  };
  const controller = new StreamController(serial, animationStub(), () => null);
  controller.activeScene = 'small_hopeful';
  controller.stats.activeScene = 'small_hopeful';

  const installing = controller.installSelectedGif('medium_cheerful', { life: 50, level: 2 });
  assert.equal(controller.activeScene, 'small_hopeful');
  assert.equal(controller.stats.activeScene, 'small_hopeful');
  assert.equal(controller.forceInstall, true);

  confirmInstall({
    uploaded: true,
    activationConfirmed: true,
    bytes: 1024,
    chunkRetries: 2,
  });
  await installing;

  assert.equal(controller.activeScene, 'medium_cheerful');
  assert.equal(controller.stats.activeScene, 'medium_cheerful');
  assert.equal(controller.stats.gifUploads, 1);
  assert.equal(controller.stats.gifBytesUploaded, 1024);
  assert.equal(controller.stats.gifChunkRetries, 2);
  assert.equal(controller.forceInstall, false);
});

test('missing activation acknowledgement leaves the prior scene and install request intact', async () => {
  const serial = {
    async installGif() {
      return { uploaded: true, bytes: 1024, chunkRetries: 0 };
    },
  };
  const controller = new StreamController(serial, animationStub(), () => null);
  controller.activeScene = 'small_hopeful';
  controller.stats.activeScene = 'small_hopeful';

  await assert.rejects(
    controller.installSelectedGif('medium_cheerful', { life: 50, level: 2 }),
    /did not confirm activation/,
  );

  assert.equal(controller.activeScene, 'small_hopeful');
  assert.equal(controller.stats.activeScene, 'small_hopeful');
  assert.equal(controller.stats.gifUploads, 0);
  assert.equal(controller.forceInstall, true);
});

test('cache-hit acknowledgement activates the scene without counting an upload', async () => {
  const serial = {
    async installGif() {
      return {
        uploaded: false,
        activationConfirmed: true,
        bytes: 0,
        chunkRetries: 0,
      };
    },
  };
  const controller = new StreamController(serial, animationStub(), () => null);

  await controller.installSelectedGif('medium_cheerful', { life: 50, level: 2 });

  assert.equal(controller.activeScene, 'medium_cheerful');
  assert.equal(controller.stats.gifCacheHits, 1);
  assert.equal(controller.stats.gifUploads, 0);
  assert.equal(controller.forceInstall, false);
});

test('failed GIF delivery still disconnects so the normal reconnect fallback can restart it', async () => {
  let disconnects = 0;
  let resolvedState = null;
  const serial = {
    connected: true,
    consumeAsynchronousError() { return null; },
    async sendStatus() {},
    async installGif() { throw new Error('GIF chunk retries exhausted'); },
    async disconnect() {
      disconnects += 1;
      this.connected = false;
    },
  };
  const animations = {
    sceneForState(level, emotion) {
      resolvedState = { level, emotion };
      return 'medium_cheerful';
    },
    ...animationStub(),
  };
  const controller = new StreamController(serial, animations, () => ({
    claudeReady: true,
    state: { emotion: 'cheerful', life: 50, level: 2 },
  }));
  controller.running = true;
  controller.schedule = () => {};

  await controller.tick();

  assert.deepEqual(resolvedState, { level: 2, emotion: 'cheerful' });
  assert.equal(disconnects, 1);
  assert.equal(controller.forceInstall, true);
  assert.equal(controller.activeScene, null);
  assert.equal(controller.currentStatus, null);
});
