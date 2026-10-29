import assert from "node:assert/strict";
import { test } from "node:test";
import { Jimp, JimpMime } from "jimp";
import { CARD_THUMBNAIL_WIDTH, getGalleryThumbnail, makeCardThumbnail } from "../lib/build-thumbnails.mjs";
import { createMemoryStore } from "../lib/storage/memory-store.mjs";

async function samplePng(width = 1536, height = 1024) {
  const image = new Jimp({ width, height, color: 0xd2c4b0ff });
  for (let x = 0; x < width; x += 7) for (let y = 0; y < height; y += 5) image.setPixelColor(((x * 97 + y * 31) % 0xffffff) * 256 + 0xff, x, y);
  return new Uint8Array(await image.getBuffer(JimpMime.png));
}

test("a card thumbnail is a small JPEG of the build image, card width, same proportions", async () => {
  const png = await samplePng();
  const thumbnail = await makeCardThumbnail(png);
  assert.deepEqual([...thumbnail.slice(0, 3)], [0xff, 0xd8, 0xff]);
  const decoded = await Jimp.read(Buffer.from(thumbnail));
  assert.equal(decoded.width, CARD_THUMBNAIL_WIDTH);
  assert.equal(decoded.height, Math.round(CARD_THUMBNAIL_WIDTH * 1024 / 1536));
  assert.ok(thumbnail.length < png.length / 5, `${thumbnail.length} vs ${png.length}`);
});

test("an image already narrower than a card is not enlarged", async () => {
  const thumbnail = await makeCardThumbnail(await samplePng(320, 200));
  assert.equal((await Jimp.read(Buffer.from(thumbnail))).width, 320);
});

function fullImages(images) {
  return { get: async (buildId) => images[buildId] || null };
}

test("a thumbnail is made once on first request, then served from storage", async () => {
  const png = await samplePng(800, 500);
  const thumbnails = createMemoryStore();
  let made = 0;
  const make = async (bytes) => { made += 1; return makeCardThumbnail(bytes); };
  const first = await getGalleryThumbnail({ thumbnails, fullImage: fullImages({ build_a: { bytes: png } }).get, buildId: "build_a", make });
  const second = await getGalleryThumbnail({ thumbnails, fullImage: fullImages({}).get, buildId: "build_a", make });
  assert.equal(first.contentType, "image/jpeg");
  assert.deepEqual([...second.bytes], [...first.bytes]);
  assert.equal(made, 1);
});

test("no full image means no thumbnail", async () => {
  const result = await getGalleryThumbnail({ thumbnails: createMemoryStore(), fullImage: fullImages({}).get, buildId: "missing" });
  assert.equal(result, null);
});

test("an image that cannot be decoded gives no thumbnail instead of an error", async () => {
  const result = await getGalleryThumbnail({
    thumbnails: createMemoryStore(),
    fullImage: fullImages({ bad: { bytes: new Uint8Array([1, 2, 3]) } }).get,
    buildId: "bad",
  });
  assert.equal(result, null);
});
