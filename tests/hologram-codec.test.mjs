import assert from "node:assert/strict";
import test from "node:test";

import {
  Command,
  FRAME_CHUNK_BYTES,
  crc32,
  makeFrameBegin,
  makeFrameChunk,
  parseEvent,
} from "../hologram/ble-protocol.js";
import {
  OLED_FRAME_BYTES,
  OLED_HEIGHT,
  OLED_WIDTH,
  imageDataToFrame,
} from "../hologram/frame-codec.js";

function blackImage() {
  return {
    width: OLED_WIDTH,
    height: OLED_HEIGHT,
    data: new Uint8ClampedArray(OLED_WIDTH * OLED_HEIGHT * 4),
  };
}

function setWhite(image, x, y) {
  const index = ((y * OLED_WIDTH) + x) * 4;
  image.data[index] = 255;
  image.data[index + 1] = 255;
  image.data[index + 2] = 255;
  image.data[index + 3] = 255;
}

test("the browser packs pixels in the Adafruit SH1107 page-major layout", () => {
  const image = blackImage();
  setWhite(image, 0, 0);
  setWhite(image, 127, 127);
  const frame = imageDataToFrame(image, { dither: false, mirrorX: false });
  assert.equal(frame.length, OLED_FRAME_BYTES);
  assert.equal(frame[0] & 0x01, 0x01);
  assert.equal(frame[127 + (15 * 128)] & 0x80, 0x80);
});

test("cube mirroring and rotation are applied before page packing", () => {
  const image = blackImage();
  setWhite(image, 0, 0);
  const mirrored = imageDataToFrame(image, { dither: false, mirrorX: true });
  assert.equal(mirrored[127] & 0x01, 0x01);
  const rotated = imageDataToFrame(image, { dither: false, mirrorX: false, rotate: 90 });
  assert.equal(rotated[127] & 0x01, 0x01);
});

test("CRC32 and frame packets match the binary firmware contract", () => {
  assert.equal(crc32(new TextEncoder().encode("123456789")), 0xcbf43926);
  const begin = makeFrameBegin(0x1234, OLED_FRAME_BYTES, 100, 0x89abcdef);
  const view = new DataView(begin.buffer);
  assert.equal(begin[0], Command.FRAME_BEGIN);
  assert.equal(view.getUint16(1, true), 0x1234);
  assert.equal(view.getUint16(3, true), OLED_FRAME_BYTES);
  assert.equal(view.getUint32(7, true), 0x89abcdef);

  const data = new Uint8Array(FRAME_CHUNK_BYTES).fill(0xa5);
  const chunk = makeFrameChunk(7, 320, data);
  assert.equal(chunk.length, FRAME_CHUNK_BYTES + 5);
  assert.equal(new DataView(chunk.buffer).getUint16(3, true), 320);
});

test("ready and acknowledgement notifications decode without text framing", () => {
  const ready = parseEvent(new Uint8Array([0x80, 1, 128, 128, 0, 8, 160, 0]));
  assert.deepEqual(ready, {
    type: "ready",
    version: 1,
    width: 128,
    height: 128,
    frameBytes: 2048,
    maxChunkBytes: 160,
  });
  const ack = parseEvent(new Uint8Array([0x81, 0x12, 7, 0, 0, 48]));
  assert.equal(ack.type, "ack");
  assert.equal(ack.sequence, 7);
  assert.equal(ack.renderMilliseconds, 48);
});

