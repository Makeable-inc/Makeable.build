export const HOLOGRAM_SERVICE_UUID = "3f7c1000-6a1b-4ef3-8a42-1b6d0a7c9e10";
export const HOLOGRAM_RX_UUID = "3f7c1001-6a1b-4ef3-8a42-1b6d0a7c9e10";
export const HOLOGRAM_TX_UUID = "3f7c1002-6a1b-4ef3-8a42-1b6d0a7c9e10";

export const PROTOCOL_VERSION = 1;
export const FRAME_CHUNK_BYTES = 160;

export const Command = Object.freeze({
  PING: 0x01,
  FRAME_BEGIN: 0x10,
  FRAME_CHUNK: 0x11,
  FRAME_COMMIT: 0x12,
  CLEAR: 0x20,
  BRIGHTNESS: 0x21,
});

export const Event = Object.freeze({
  READY: 0x80,
  ACK: 0x81,
});

export const Status = Object.freeze({
  OK: 0,
  BAD_PACKET: 1,
  BAD_SEQUENCE: 2,
  BAD_LENGTH: 3,
  BAD_CRC: 4,
  BUSY: 5,
});

export function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function makeFrameBegin(sequence, length, holdMilliseconds, checksum) {
  const packet = new Uint8Array(11);
  const view = new DataView(packet.buffer);
  view.setUint8(0, Command.FRAME_BEGIN);
  view.setUint16(1, sequence, true);
  view.setUint16(3, length, true);
  view.setUint16(5, Math.max(0, Math.min(65535, holdMilliseconds)), true);
  view.setUint32(7, checksum >>> 0, true);
  return packet;
}

export function makeFrameChunk(sequence, offset, bytes) {
  const packet = new Uint8Array(5 + bytes.length);
  const view = new DataView(packet.buffer);
  view.setUint8(0, Command.FRAME_CHUNK);
  view.setUint16(1, sequence, true);
  view.setUint16(3, offset, true);
  packet.set(bytes, 5);
  return packet;
}

export function makeSimpleCommand(command, sequence = 0, value) {
  const packet = new Uint8Array(value === undefined ? 3 : 4);
  const view = new DataView(packet.buffer);
  view.setUint8(0, command);
  view.setUint16(1, sequence, true);
  if (value !== undefined) view.setUint8(3, value);
  return packet;
}

export function parseEvent(value) {
  const bytes = value instanceof Uint8Array
    ? value
    : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  if (bytes.length === 0) return null;

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes[0] === Event.READY && bytes.length >= 8) {
    return {
      type: "ready",
      version: bytes[1],
      width: bytes[2],
      height: bytes[3],
      frameBytes: view.getUint16(4, true),
      maxChunkBytes: view.getUint16(6, true),
    };
  }
  if (bytes[0] === Event.ACK && bytes.length >= 6) {
    return {
      type: "ack",
      command: bytes[1],
      sequence: view.getUint16(2, true),
      status: bytes[4],
      renderMilliseconds: bytes[5],
    };
  }
  return { type: "unknown", bytes };
}

