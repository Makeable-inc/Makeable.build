'use strict';

const VERSION = 2;
const DISPLAY_WIDTH = 320;
const DISPLAY_HEIGHT = 240;
const PIXEL_COUNT = DISPLAY_WIDTH * DISPLAY_HEIGHT;
const FRAME_BYTES = PIXEL_COUNT * 2;
const KEYFRAME_ROWS_PER_CHUNK = 8;
const HEADER_BYTES = 12;
const CRC_BYTES = 4;
const STREAM_FPS = 12;
const DELTA_COALESCE_GAP = 16;
const GIF_CHUNK_BYTES = 12 * 1024;

const PacketType = Object.freeze({
  HELLO: 1,
  HELLO_ACK: 2,
  KEYFRAME: 3,
  DELTA: 4,
  HEARTBEAT: 5,
  ACK: 6,
  NACK: 7,
  STATUS: 8,
  GIF_BEGIN: 9,
  GIF_CHUNK: 10,
  GIF_COMMIT: 11,
  HUD_UPDATE: 12,
});

const AckCode = Object.freeze({
  OKAY: 0,
  GIF_ALREADY_LOADED: 7,
});

const StatusCode = Object.freeze({
  STREAMING: 0,
  WAITING_FOR_CLAUDE: 1,
  NO_CONNECTION: 2,
});

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function cobsEncode(input) {
  const output = Buffer.allocUnsafe(input.length + Math.ceil(input.length / 254) + 1);
  let readIndex = 0;
  let writeIndex = 1;
  let codeIndex = 0;
  let code = 1;

  while (readIndex < input.length) {
    if (input[readIndex] === 0) {
      output[codeIndex] = code;
      codeIndex = writeIndex;
      writeIndex += 1;
      code = 1;
      readIndex += 1;
    } else {
      output[writeIndex] = input[readIndex];
      writeIndex += 1;
      readIndex += 1;
      code += 1;
      if (code === 0xff) {
        output[codeIndex] = code;
        codeIndex = writeIndex;
        writeIndex += 1;
        code = 1;
      }
    }
  }
  output[codeIndex] = code;
  return output.subarray(0, writeIndex);
}

function cobsDecode(input) {
  const output = Buffer.allocUnsafe(input.length);
  let readIndex = 0;
  let writeIndex = 0;
  while (readIndex < input.length) {
    const code = input[readIndex];
    if (code === 0) throw new Error('COBS input contains zero');
    readIndex += 1;
    const end = readIndex + code - 1;
    if (end > input.length) throw new Error('COBS code exceeds input');
    while (readIndex < end) {
      output[writeIndex] = input[readIndex];
      writeIndex += 1;
      readIndex += 1;
    }
    if (code !== 0xff && readIndex < input.length) {
      output[writeIndex] = 0;
      writeIndex += 1;
    }
  }
  return output.subarray(0, writeIndex);
}

function encodePacket(type, sequence, payload = Buffer.alloc(0), flags = 0) {
  const body = Buffer.allocUnsafe(HEADER_BYTES + payload.length + CRC_BYTES);
  body[0] = VERSION;
  body[1] = type;
  body[2] = flags;
  body[3] = 0;
  body.writeUInt32LE(sequence >>> 0, 4);
  body.writeUInt32LE(payload.length >>> 0, 8);
  payload.copy(body, HEADER_BYTES);
  body.writeUInt32LE(crc32(body.subarray(0, body.length - CRC_BYTES)), body.length - CRC_BYTES);
  return Buffer.concat([cobsEncode(body), Buffer.from([0])]);
}

function decodePacket(encoded) {
  const body = cobsDecode(encoded);
  if (body.length < HEADER_BYTES + CRC_BYTES) throw new Error('Packet is too short');
  if (body[0] !== VERSION) throw new Error(`Unsupported protocol version ${body[0]}`);
  const payloadLength = body.readUInt32LE(8);
  if (payloadLength !== body.length - HEADER_BYTES - CRC_BYTES) {
    throw new Error('Packet payload length mismatch');
  }
  const expected = body.readUInt32LE(body.length - CRC_BYTES);
  const actual = crc32(body.subarray(0, body.length - CRC_BYTES));
  if (expected !== actual) throw new Error('Packet CRC mismatch');
  return {
    version: body[0],
    type: body[1],
    flags: body[2],
    sequence: body.readUInt32LE(4),
    payload: body.subarray(HEADER_BYTES, body.length - CRC_BYTES),
  };
}

function buildHelloPayload() {
  const payload = Buffer.alloc(12);
  payload.writeUInt16LE(DISPLAY_WIDTH, 0);
  payload.writeUInt16LE(DISPLAY_HEIGHT, 2);
  payload.writeUInt32LE(2_000_000, 4);
  payload.writeUInt32LE(Math.round(1_000_000 / STREAM_FPS), 8);
  return payload;
}

function buildKeyframePayloads(rgb565, life, level) {
  if (!Buffer.isBuffer(rgb565) || rgb565.length !== FRAME_BYTES) {
    throw new Error(`Keyframe must contain exactly ${FRAME_BYTES} RGB565 bytes`);
  }
  const payloads = [];
  for (let row = 0; row < DISPLAY_HEIGHT; row += KEYFRAME_ROWS_PER_CHUNK) {
    const rowCount = Math.min(KEYFRAME_ROWS_PER_CHUNK, DISPLAY_HEIGHT - row);
    const startPixel = row * DISPLAY_WIDTH;
    const pixelCount = rowCount * DISPLAY_WIDTH;
    const payload = Buffer.allocUnsafe(14 + pixelCount * 2);
    payload.writeUInt16LE(DISPLAY_WIDTH, 0);
    payload.writeUInt16LE(DISPLAY_HEIGHT, 2);
    payload[4] = Math.max(0, Math.min(100, Math.round(life)));
    payload[5] = Math.max(1, Math.min(3, Math.round(level)));
    payload[6] = (row === 0 ? 1 : 0) | (row + rowCount === DISPLAY_HEIGHT ? 2 : 0);
    payload[7] = 0;
    payload.writeUInt32LE(startPixel, 8);
    payload.writeUInt16LE(pixelCount, 12);
    rgb565.copy(payload, 14, startPixel * 2, (startPixel + pixelCount) * 2);
    payloads.push(payload);
  }
  return payloads;
}

function appendSpan(spans, current, startPixel, endPixel) {
  let cursor = startPixel;
  while (cursor < endPixel) {
    const count = Math.min(1024, endPixel - cursor);
    spans.push({
      startPixel: cursor,
      count,
      bytes: current.subarray(cursor * 2, (cursor + count) * 2),
    });
    cursor += count;
  }
}

function buildDeltaPayload(previous, current, life, level, maxPayloadBytes = 18_000) {
  if (!Buffer.isBuffer(previous) || !Buffer.isBuffer(current)) {
    throw new Error('Delta frames must be Buffers');
  }
  if (previous.length !== FRAME_BYTES || current.length !== FRAME_BYTES) {
    throw new Error(`Delta frames must contain exactly ${FRAME_BYTES} bytes`);
  }

  const spans = [];
  for (let row = 0; row < DISPLAY_HEIGHT; row += 1) {
    const rowStart = row * DISPLAY_WIDTH;
    let column = 0;
    while (column < DISPLAY_WIDTH) {
      const pixel = rowStart + column;
      if (previous.readUInt16LE(pixel * 2) === current.readUInt16LE(pixel * 2)) {
        column += 1;
        continue;
      }
      const start = column;
      let lastChanged = column;
      column += 1;
      while (column < DISPLAY_WIDTH) {
        const candidate = rowStart + column;
        if (previous.readUInt16LE(candidate * 2) !== current.readUInt16LE(candidate * 2)) {
          lastChanged = column;
        } else if (column - lastChanged > DELTA_COALESCE_GAP) {
          break;
        }
        column += 1;
      }
      appendSpan(spans, current, rowStart + start, rowStart + lastChanged + 1);
    }
  }

  const payloadLength = 4 + spans.reduce((total, span) => total + 6 + span.bytes.length, 0);
  if (payloadLength > maxPayloadBytes || spans.length > 65_535) return null;
  const payload = Buffer.allocUnsafe(payloadLength);
  payload[0] = Math.max(0, Math.min(100, Math.round(life)));
  payload[1] = Math.max(1, Math.min(3, Math.round(level)));
  payload.writeUInt16LE(spans.length, 2);
  let offset = 4;
  for (const span of spans) {
    payload.writeUInt32LE(span.startPixel, offset);
    payload.writeUInt16LE(span.count, offset + 4);
    span.bytes.copy(payload, offset + 6);
    offset += 6 + span.bytes.length;
  }
  return payload;
}

function buildStatusPayload(status, life = 0, level = 1) {
  return Buffer.from([
    status,
    Math.max(0, Math.min(100, Math.round(life))),
    Math.max(1, Math.min(3, Math.round(level))),
    0,
  ]);
}

function buildGifBeginPayload(gifBytes, checksum, life, level) {
  if (!Buffer.isBuffer(gifBytes) || gifBytes.length < 6) throw new Error('GIF bytes are required');
  const payload = Buffer.alloc(14);
  payload.writeUInt32LE(gifBytes.length, 0);
  payload.writeUInt32LE(checksum >>> 0, 4);
  payload.writeUInt16LE(DISPLAY_WIDTH, 8);
  payload.writeUInt16LE(DISPLAY_HEIGHT, 10);
  payload[12] = Math.max(0, Math.min(100, Math.round(life)));
  payload[13] = Math.max(1, Math.min(3, Math.round(level)));
  return payload;
}

function buildGifChunkPayload(gifBytes, offset) {
  if (!Buffer.isBuffer(gifBytes)) throw new Error('GIF bytes are required');
  if (!Number.isInteger(offset) || offset < 0 || offset >= gifBytes.length) throw new Error('Invalid GIF chunk offset');
  const length = Math.min(GIF_CHUNK_BYTES, gifBytes.length - offset);
  const payload = Buffer.allocUnsafe(4 + length);
  payload.writeUInt32LE(offset, 0);
  gifBytes.copy(payload, 4, offset, offset + length);
  return payload;
}

function buildGifCommitPayload(gifBytes, checksum) {
  const payload = Buffer.alloc(8);
  payload.writeUInt32LE(gifBytes.length, 0);
  payload.writeUInt32LE(checksum >>> 0, 4);
  return payload;
}

function buildHudPayload(life, level) {
  return Buffer.from([
    Math.max(0, Math.min(100, Math.round(life))),
    Math.max(1, Math.min(3, Math.round(level))),
  ]);
}

function parseAckPayload(payload) {
  if (payload.length < 5) throw new Error('ACK payload is too short');
  return {
    acknowledgedSequence: payload.readUInt32LE(0),
    code: payload[4],
    framesPlayed: payload.length >= 17 ? payload.readUInt32LE(5) : null,
    loopsCompleted: payload.length >= 17 ? payload.readUInt32LE(9) : null,
    lastFrameRenderMicros: payload.length >= 17 ? payload.readUInt32LE(13) : null,
    // Firmware >= the address-window diagnostic build. Older devices send a
    // 17-byte ACK and simply report null here.
    lastFrameRuns: payload.length >= 25 ? payload.readUInt32LE(17) : null,
    lastFramePushMicros: payload.length >= 25 ? payload.readUInt32LE(21) : null,
  };
}

module.exports = {
  VERSION,
  DISPLAY_WIDTH,
  DISPLAY_HEIGHT,
  FRAME_BYTES,
  STREAM_FPS,
  GIF_CHUNK_BYTES,
  PacketType,
  AckCode,
  StatusCode,
  crc32,
  cobsEncode,
  cobsDecode,
  encodePacket,
  decodePacket,
  buildHelloPayload,
  buildKeyframePayloads,
  buildDeltaPayload,
  buildStatusPayload,
  buildGifBeginPayload,
  buildGifChunkPayload,
  buildGifCommitPayload,
  buildHudPayload,
  parseAckPayload,
};
