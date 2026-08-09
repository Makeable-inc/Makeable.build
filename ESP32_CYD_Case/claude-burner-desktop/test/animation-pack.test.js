'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  AnimationPack,
  ACTIVE_STATE_KEYS,
  EMOTIONS,
  EXPECTED_ENVELOPES,
  SIZES,
  stateKeyFor,
} = require('../src/animation-pack');
const { crc32, DISPLAY_WIDTH, FRAME_BYTES } = require('../src/serial-protocol');

function testGif(width = 320, height = 240) {
  const bytes = Buffer.alloc(14);
  bytes.write('GIF89a', 0, 'ascii');
  bytes.writeUInt16LE(width, 6);
  bytes.writeUInt16LE(height, 8);
  bytes[13] = 0x3b;
  return bytes;
}

function makeLegacyCatalogFixture(t) {
  const assetsPath = fs.mkdtempSync(path.join(os.tmpdir(), 'ember-animation-pack-v1-'));
  t.after(() => fs.rmSync(assetsPath, { recursive: true, force: true }));
  const keys = [
    'lv1_dormant',
    'lv1_exhausted',
    'lv1_sad_puppy',
    'lv1_curious_hopeful',
    'lv2_worried_gloomy',
    'lv2_neutral_attentive',
    'lv2_energized',
    'lv3_tired_concerned',
    'lv3_happy_confident',
    'lv3_supercharged',
  ];
  const manifest = {
    version: 1,
    width: 320,
    height: 240,
    fps: 48,
    defaultScene: 'lv1_dormant',
    scenes: Object.fromEntries(keys.map((key) => [key, {
      preview: `previews/${key}.gif`,
      frames: 144,
    }])),
  };
  fs.writeFileSync(path.join(assetsPath, 'animation-pack.json'), JSON.stringify(manifest));
  return assetsPath;
}

function makeCatalogFixture(t, mutate = null) {
  const assetsPath = fs.mkdtempSync(path.join(os.tmpdir(), 'ember-animation-pack-'));
  t.after(() => fs.rmSync(assetsPath, { recursive: true, force: true }));
  fs.mkdirSync(path.join(assetsPath, 'gifs'));
  const gif = testGif();
  const states = ACTIVE_STATE_KEYS.map((key) => {
    const [size, emotion] = key.split('_');
    const relativeGif = `gifs/${key}.gif`;
    fs.writeFileSync(path.join(assetsPath, relativeGif), gif);
    return {
      key,
      size,
      level: SIZES.indexOf(size) + 1,
      emotion,
      label: `${size} ${emotion}`,
      envelope: { ...EXPECTED_ENVELOPES[size] },
      anchor: { centerX: 160, groundY: 204 },
      anchorFile: `scenes/${key}.png`,
      theme: { primary: '#ff6b24', secondary: '#ffc857', base: '#14172b' },
      gif: relativeGif,
      frameCount: 96,
      frameDurationMs: 1_000 / 24,
      frameTimingPatternMs: [40, 40, 40, 40, 40, 50],
      durationMs: 4_000,
      bytes: gif.length,
      crc32: crc32(gif),
    };
  });
  const noConnectionGif = 'gifs/no_connection.gif';
  fs.writeFileSync(path.join(assetsPath, noConnectionGif), gif);
  const manifest = {
    version: 2,
    width: 320,
    height: 240,
    fps: 24,
    frameCount: 96,
    frameDurationMs: 1_000 / 24,
    frameTimingPatternMs: [40, 40, 40, 40, 40, 50],
    durationMs: 4_000,
    defaultState: 'small_moody',
    states,
    systemStates: {
      no_connection: {
        delivery: 'firmware-fallback',
        gif: noConnectionGif,
        bytes: gif.length,
        crc32: crc32(gif),
      },
      waiting_for_claude: { delivery: 'firmware-rendered' },
    },
  };
  if (mutate) mutate({ assetsPath, gif, manifest, states });
  fs.writeFileSync(path.join(assetsPath, 'animation-pack.json'), JSON.stringify(manifest));
  return { assetsPath, gif, manifest };
}

test('catalog v2 resolves the complete 3x5 state matrix', (t) => {
  const { assetsPath } = makeCatalogFixture(t);
  const pack = new AnimationPack(assetsPath);

  assert.equal(pack.catalog.version, 2);
  assert.equal(pack.catalog.fps, 24);
  assert.equal(pack.catalog.frameCount, 96);
  assert.equal(pack.catalog.durationMs, 4_000);
  assert.deepEqual(pack.catalog.frameTimingPatternMs, [40, 40, 40, 40, 40, 50]);
  assert.deepEqual(pack.catalog.states.map(({ key }) => key), ACTIVE_STATE_KEYS);
  assert.equal(new Set(pack.catalog.states.map(({ key }) => key)).size, 15);
  assert.ok(Object.isFrozen(pack.catalog));
  assert.ok(Object.isFrozen(pack.catalog.states[0].theme));
  assert.equal(pack.catalog.states[0].anchorFile, 'scenes/small_moody.png');

  for (let level = 1; level <= SIZES.length; level += 1) {
    for (const emotion of EMOTIONS) {
      assert.equal(pack.sceneForState(level, emotion), `${SIZES[level - 1]}_${emotion}`);
    }
  }
  assert.equal(pack.sceneForState('level-2', 'cheer'), 'medium_cheerful');
  assert.equal(pack.sceneForState('large', 'supercharged'), 'large_explosion');
  assert.equal(pack.sceneForState('not-a-level', 'hopeful'), 'small_moody');
  assert.equal(pack.sceneForState(1, 'not-an-emotion'), 'small_moody');
  assert.equal(stateKeyFor(3, 'excitement'), 'large_excited');
  assert.equal(pack.systemScene('no_connection'), 'no_connection');
  assert.equal(pack.systemScene('waiting_for_claude'), null);
});

test('published emotion library uses the approved protected-motion contract', () => {
  const catalog = JSON.parse(fs.readFileSync(
    path.resolve(__dirname, '..', 'assets', 'animation-pack.json'),
    'utf8',
  ));

  assert.equal(catalog.pipelineVersion, '6.1.0-aspect-correct-15-state-emotion-24fps');
  assert.equal(new Set(catalog.states.map((state) => state.sha256)).size, 15);
  for (const state of catalog.states) {
    assert.equal(state.evolutionPreview, false, `${state.key} still claims to use the three-loop preview`);
    assert.equal(state.motion?.authoredEmotionPose, true, `${state.key} has no authored emotion pose`);
    assert.equal(state.motion?.blink, true, `${state.key} has no blink`);
    assert.equal(state.motion?.flameWisps, true, `${state.key} has no flame wisps`);
    assert.equal(state.motion?.distantClouds, true, `${state.key} has no cloud motion`);
    assert.equal(state.motion?.syntheticOutline, false, `${state.key} reintroduced an outline`);
    assert.equal(state.motion?.darkWisps, false, `${state.key} reintroduced dark wisps`);
    assert.equal(
      state.geometry?.aspectPreservingCentralArt,
      true,
      `${state.key} does not preserve Ember's source aspect ratio`,
    );
    assert.equal(
      state.geometry?.peripheralBackgroundExtensionOnly,
      true,
      `${state.key} does not confine width expansion to peripheral scenery`,
    );
    assert.ok(
      state.geometry?.relativeScaleError <= 0.005,
      `${state.key} has non-uniform central-art scaling`,
    );
    assert.equal(
      state.motion?.centralMountainSummitProtected,
      true,
      `${state.key} does not protect the mountain summit`,
    );
  }
});

test('one catalog GIF serves both desktop preview and device playback', (t) => {
  const { assetsPath, gif } = makeCatalogFixture(t);
  const pack = new AnimationPack(assetsPath);
  const scene = 'medium_cheerful';

  assert.equal(pack.previewFile(scene), `gifs/${scene}.gif`);
  assert.equal(pack.frameCount(scene), 96);
  assert.deepEqual(pack.frameTimingPattern(scene), [40, 40, 40, 40, 40, 50]);
  const first = pack.getDeviceGif(scene);
  const second = pack.getDeviceGif(scene);
  assert.strictEqual(first, second);
  assert.deepEqual(first.bytes, gif);
  assert.equal(first.checksum, crc32(gif));
  assert.equal(first.file, pack.previewFile(scene));
  assert.throws(() => pack.getFrame(scene, 0), /no raw RGB565 frames/);
});

test('catalog v2 rejects an incomplete or duplicated active library', (t) => {
  const missing = makeCatalogFixture(t, ({ states }) => states.pop());
  assert.throws(
    () => new AnimationPack(missing.assetsPath),
    /must contain exactly 15 active states; missing: large_explosion/,
  );

  const duplicated = makeCatalogFixture(t, ({ states }) => {
    states[1].gif = states[0].gif;
  });
  assert.throws(
    () => new AnimationPack(duplicated.assetsPath),
    /must use distinct GIF files/,
  );
});

test('unknown catalog versions fail closed', (t) => {
  const fixture = makeCatalogFixture(t, ({ manifest }) => {
    manifest.version = 99;
  });
  assert.throws(() => new AnimationPack(fixture.assetsPath), /Unsupported animation catalog version: 99/);
});

test('catalog v2 validates GIF canvas dimensions when loading', (t) => {
  const wrongCanvas = testGif(240, 240);
  const fixture = makeCatalogFixture(t, ({ assetsPath, states }) => {
    const state = states.find(({ key }) => key === 'small_moody');
    fs.writeFileSync(path.join(assetsPath, state.gif), wrongCanvas);
    state.bytes = wrongCanvas.length;
    state.crc32 = crc32(wrongCanvas);
  });
  const pack = new AnimationPack(fixture.assetsPath);
  assert.throws(() => pack.getDeviceGif('small_moody'), /canvas does not match the 320x240 display/);
});

test('version-one packs retain legacy emotion and state compatibility', (t) => {
  const pack = new AnimationPack(makeLegacyCatalogFixture(t));
  assert.equal(pack.sceneForEmotion('dormant'), 'lv1_dormant');
  assert.equal(pack.sceneForEmotion('supercharged'), 'lv3_supercharged');
  assert.equal(pack.sceneForState(2, 'excited'), 'lv2_energized');
  assert.equal(pack.sceneForState(3, 'cheerful'), 'lv3_happy_confident');
  assert.ok(pack.previewFile('lv1_dormant'));
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
