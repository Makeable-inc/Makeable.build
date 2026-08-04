'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  FRAME_BYTES,
  STREAM_FPS,
  PacketType,
  crc32,
  cobsEncode,
  cobsDecode,
  encodePacket,
  decodePacket,
  buildKeyframePayloads,
  buildDeltaPayload,
  buildHelloPayload,
  buildGifBeginPayload,
  buildGifChunkPayload,
  buildGifCommitPayload,
  buildHudPayload,
  GIF_CHUNK_BYTES,
  parseAckPayload,
} = require('../src/serial-protocol');

test('HELLO advertises the conservative 24 FPS device cadence', () => {
  const payload = buildHelloPayload();
  assert.equal(STREAM_FPS, 24);
  assert.equal(payload.readUInt16LE(0), 320);
  assert.equal(payload.readUInt16LE(2), 240);
  assert.equal(payload.readUInt32LE(8), 41_667);
});

test('CRC32 matches the standard check vector', () => {
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926);
});

test('COBS round-trips empty, zero-rich, and long input', () => {
  for (const original of [
    Buffer.alloc(0), Buffer.from([0]), Buffer.from([1, 0, 2, 0, 0, 3]),
    Buffer.from(Array.from({ length: 700 }, (_, index) => index & 0xff)),
  ]) {
    assert.deepEqual(cobsDecode(cobsEncode(original)), original);
  }
});

test('packet framing round-trips and rejects corruption', () => {
  const framed = encodePacket(PacketType.STATUS, 42, Buffer.from([1, 2, 0, 4]));
  const decoded = decodePacket(framed.subarray(0, -1));
  assert.equal(decoded.type, PacketType.STATUS);
  assert.equal(decoded.sequence, 42);
  assert.deepEqual(decoded.payload, Buffer.from([1, 2, 0, 4]));

  const corrupt = Buffer.from(framed.subarray(0, -1));
  corrupt[2] ^= 0x20;
  assert.throws(() => decodePacket(corrupt));
});

test('keyframes require an exact 320x240 RGB565 buffer', () => {
  assert.throws(() => buildKeyframePayloads(Buffer.alloc(4), 50, 2));
  const payloads = buildKeyframePayloads(Buffer.alloc(FRAME_BYTES, 0xab), 50, 2);
  assert.equal(payloads.length, 30);
  assert.equal(payloads[0][4], 50);
  assert.equal(payloads[0][5], 2);
  assert.equal(payloads[0][6], 1);
  assert.equal(payloads.at(-1)[6], 2);
  assert.deepEqual(
    payloads.map((payload) => payload.readUInt32LE(8)),
    Array.from({ length: 30 }, (_, index) => index * 8 * 320),
  );
  assert.equal(payloads.reduce((total, payload) => total + payload.length - 14, 0), FRAME_BYTES);
});

test('delta spans reconstruct the current frame exactly', () => {
  const previous = Buffer.alloc(FRAME_BYTES);
  const current = Buffer.alloc(FRAME_BYTES);
  for (const pixel of [0, 1, 5, 319, 320, 48_123, 76_799]) {
    current.writeUInt16LE((pixel * 31) & 0xffff, pixel * 2);
  }
  const payload = buildDeltaPayload(previous, current, 44, 2);
  assert.ok(payload);
  assert.equal(payload[0], 44);
  assert.equal(payload[1], 2);
  const reconstructed = Buffer.from(previous);
  const spanCount = payload.readUInt16LE(2);
  let offset = 4;
  for (let index = 0; index < spanCount; index += 1) {
    const startPixel = payload.readUInt32LE(offset);
    const count = payload.readUInt16LE(offset + 4);
    payload.copy(reconstructed, startPixel * 2, offset + 6, offset + 6 + count * 2);
    offset += 6 + count * 2;
  }
  assert.deepEqual(reconstructed, current);
  assert.equal(offset, payload.length);
});

test('oversized deltas signal that a keyframe is required', () => {
  const previous = Buffer.alloc(FRAME_BYTES);
  const current = Buffer.alloc(FRAME_BYTES, 0xff);
  assert.equal(buildDeltaPayload(previous, current, 100, 3), null);
});

test('GIF installation packets preserve identity, order, and HUD state', () => {
  const gif = Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(GIF_CHUNK_BYTES + 17, 0xa5)]);
  const checksum = crc32(gif);
  const begin = buildGifBeginPayload(gif, checksum, 84.6, 3);
  assert.equal(begin.readUInt32LE(0), gif.length);
  assert.equal(begin.readUInt32LE(4), checksum);
  assert.equal(begin.readUInt16LE(8), 320);
  assert.equal(begin.readUInt16LE(10), 240);
  assert.equal(begin[12], 85);
  assert.equal(begin[13], 3);

  const first = buildGifChunkPayload(gif, 0);
  const second = buildGifChunkPayload(gif, GIF_CHUNK_BYTES);
  assert.equal(first.readUInt32LE(0), 0);
  assert.equal(first.length, GIF_CHUNK_BYTES + 4);
  assert.equal(second.readUInt32LE(0), GIF_CHUNK_BYTES);
  assert.deepEqual(Buffer.concat([first.subarray(4), second.subarray(4)]), gif);

  const commit = buildGifCommitPayload(gif, checksum);
  assert.equal(commit.readUInt32LE(0), gif.length);
  assert.equal(commit.readUInt32LE(4), checksum);
  assert.deepEqual(buildHudPayload(49.5, 2), Buffer.from([50, 2]));
});

test('extended ACK telemetry reports device-local GIF playback', () => {
  const payload = Buffer.alloc(17);
  payload.writeUInt32LE(91, 0);
  payload[4] = 0;
  payload.writeUInt32LE(240, 5);
  payload.writeUInt32LE(2, 9);
  payload.writeUInt32LE(7123, 13);
  assert.deepEqual(parseAckPayload(payload), {
    acknowledgedSequence: 91,
    code: 0,
    framesPlayed: 240,
    loopsCompleted: 2,
    lastFrameRenderMicros: 7123,
  });
});
