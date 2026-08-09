'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  SerialManager,
  GIF_CHUNK_MAX_RETRIES,
  DeviceNackError,
  SerialPortBusyError,
  DeviceProtocolError,
  isResourceBusyError,
  portAliases,
  dedupeCandidatePorts,
} = require('../src/serial-manager');
const {
  PacketType,
  AckCode,
  GIF_CHUNK_BYTES,
  crc32,
  decodePacket,
} = require('../src/serial-protocol');

function decodeWrite(encoded) {
  assert.equal(encoded[encoded.length - 1], 0);
  return decodePacket(encoded.subarray(0, -1));
}

function acknowledge(manager, sequence, code = AckCode.OKAY, type = PacketType.ACK) {
  const payload = Buffer.alloc(5);
  payload.writeUInt32LE(sequence, 0);
  payload[4] = code;
  queueMicrotask(() => manager.handlePacket({ type, payload }));
}

test('serial aliases cover both macOS dial-in and callout device names', () => {
  assert.deepEqual(
    portAliases('/dev/tty.usbserial-10').sort(),
    ['/dev/cu.usbserial-10', '/dev/tty.usbserial-10'].sort(),
  );
  assert.deepEqual(
    portAliases('/dev/cu.wchusbserial-110').sort(),
    ['/dev/cu.wchusbserial-110', '/dev/tty.wchusbserial-110'].sort(),
  );
});

test('macOS tty and cu aliases collapse into one physical serial candidate', () => {
  const candidates = dedupeCandidatePorts([
    { path: '/dev/tty.usbserial-10', vendorId: '1a86', productId: '7523', serialNumber: 'ABC' },
    { path: '/dev/cu.usbserial-10', vendorId: '1a86', productId: '7523', serialNumber: 'ABC' },
    { path: '/dev/cu.usbserial-20', vendorId: '1a86', productId: '7523', serialNumber: 'XYZ' },
  ], () => true);
  assert.equal(candidates.length, 2);
  assert.equal(candidates[0].path.startsWith('/dev/cu.'), true);
  assert.deepEqual(candidates.find(({ physicalId }) => physicalId === 'serial:ABC').aliases.sort(), [
    '/dev/cu.usbserial-10', '/dev/tty.usbserial-10',
  ]);
});

test('resource-busy errors are recognized across native serial messages', () => {
  assert.equal(isResourceBusyError(new Error('Resource busy, cannot open /dev/tty.usbserial-10')), true);
  assert.equal(isResourceBusyError(new Error('EBUSY: device is already open')), true);
  assert.equal(isResourceBusyError(new Error('Timed out waiting for ACK')), false);
});

test('connection failures carry durable recovery codes and owner guidance', () => {
  const busy = new SerialPortBusyError('/dev/cu.usbserial-10', [{ pid: 42, command: 'screen /dev/cu.usbserial-10' }]);
  assert.equal(busy.code, 'PORT_BUSY');
  assert.match(busy.message, /screen.*PID 42/);
  const firmware = new DeviceProtocolError('/dev/cu.usbserial-10', new Error('ACK timeout'));
  assert.equal(firmware.code, 'FIRMWARE_REQUIRED');
  assert.match(firmware.message, /Install or repair/);
});

test('ACK timeouts retry the identical encoded packet and sequence at most three times', async () => {
  const manager = new SerialManager();
  const writes = [];
  manager.write = async (encoded) => {
    const packet = decodeWrite(encoded);
    writes.push({ encoded: Buffer.from(encoded), packet });
    if (writes.length === GIF_CHUNK_MAX_RETRIES + 1) acknowledge(manager, packet.sequence);
  };

  const acknowledgement = await manager.send(PacketType.GIF_CHUNK, Buffer.from([1, 2, 3]), {
    timeoutMs: 4,
    maximumRetries: GIF_CHUNK_MAX_RETRIES,
  });

  assert.equal(acknowledgement.retries, GIF_CHUNK_MAX_RETRIES);
  assert.equal(writes.length, GIF_CHUNK_MAX_RETRIES + 1);
  assert.equal(new Set(writes.map(({ packet }) => packet.sequence)).size, 1);
  for (const write of writes.slice(1)) assert.deepEqual(write.encoded, writes[0].encoded);
  assert.equal(manager.sequence, 2, 'one logical send consumes one sequence');
});

test('transient chunk NACK retries with the same sequence and then succeeds', async () => {
  const manager = new SerialManager();
  const writes = [];
  manager.write = async (encoded) => {
    const packet = decodeWrite(encoded);
    writes.push(packet);
    acknowledge(
      manager,
      packet.sequence,
      writes.length === 1 ? 6 : AckCode.OKAY,
      writes.length === 1 ? PacketType.NACK : PacketType.ACK,
    );
  };

  const acknowledgement = await manager.send(PacketType.GIF_CHUNK, Buffer.from([4, 5, 6]), {
    timeoutMs: 20,
    maximumRetries: GIF_CHUNK_MAX_RETRIES,
    retryOnNack: true,
  });

  assert.equal(acknowledgement.retries, 1);
  assert.equal(writes.length, 2);
  assert.equal(writes[0].sequence, writes[1].sequence);
});

test('persistent chunk NACK stops after the bounded retry budget', async () => {
  const manager = new SerialManager();
  const sequences = [];
  manager.write = async (encoded) => {
    const packet = decodeWrite(encoded);
    sequences.push(packet.sequence);
    acknowledge(manager, packet.sequence, 6, PacketType.NACK);
  };

  await assert.rejects(
    manager.send(PacketType.GIF_CHUNK, Buffer.from([7, 8, 9]), {
      timeoutMs: 20,
      maximumRetries: GIF_CHUNK_MAX_RETRIES,
      retryOnNack: true,
    }),
    DeviceNackError,
  );
  assert.equal(sequences.length, GIF_CHUNK_MAX_RETRIES + 1);
  assert.equal(new Set(sequences).size, 1);
});

test('GIF install retries only the failed chunk and confirms activation after commit', async () => {
  const manager = new SerialManager();
  const gif = Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(GIF_CHUNK_BYTES + 11, 0xa5)]);
  const checksum = crc32(gif);
  const writes = [];
  let rejectedFirstChunk = false;

  manager.write = async (encoded) => {
    const packet = decodeWrite(encoded);
    writes.push(packet);
    if (packet.type === PacketType.GIF_CHUNK && !rejectedFirstChunk) {
      rejectedFirstChunk = true;
      acknowledge(manager, packet.sequence, 6, PacketType.NACK);
      return;
    }
    acknowledge(manager, packet.sequence);
  };

  const result = await manager.installGif(gif, checksum, 63, 2);
  const chunks = writes.filter(({ type }) => type === PacketType.GIF_CHUNK);
  const commitIndex = writes.findIndex(({ type }) => type === PacketType.GIF_COMMIT);
  const hudIndex = writes.findIndex(({ type }) => type === PacketType.HUD_UPDATE);

  assert.deepEqual(result, {
    uploaded: true,
    activationConfirmed: true,
    bytes: gif.length,
    chunks: 2,
    chunkRetries: 1,
    checksum,
  });
  assert.equal(chunks.length, 3, 'one of two chunks is retransmitted once');
  assert.equal(chunks[0].sequence, chunks[1].sequence);
  assert.notEqual(chunks[1].sequence, chunks[2].sequence);
  assert.ok(commitIndex > writes.findLastIndex(({ type }) => type === PacketType.GIF_CHUNK));
  assert.ok(hudIndex > commitIndex);
});

test('GIF cache hit skips chunks and commit while still confirming the active scene', async () => {
  const manager = new SerialManager();
  const gif = Buffer.from('GIF89a-cache-hit');
  const checksum = crc32(gif);
  const packetTypes = [];
  manager.write = async (encoded) => {
    const packet = decodeWrite(encoded);
    packetTypes.push(packet.type);
    acknowledge(
      manager,
      packet.sequence,
      packet.type === PacketType.GIF_BEGIN ? AckCode.GIF_ALREADY_LOADED : AckCode.OKAY,
    );
  };

  const result = await manager.installGif(gif, checksum, 42, 2);

  assert.deepEqual(result, {
    uploaded: false,
    activationConfirmed: true,
    bytes: 0,
    chunks: 0,
    chunkRetries: 0,
    checksum,
  });
  assert.deepEqual(packetTypes, [PacketType.GIF_BEGIN, PacketType.HUD_UPDATE]);
});

test('GIF timing keeps chunk and deferred-COMMIT retries inside the link watchdog', async () => {
  const manager = new SerialManager();
  const calls = [];
  manager.send = async (type, _payload, options = {}) => {
    calls.push({ type, options });
    return { code: AckCode.OKAY, retries: 0 };
  };

  const gif = Buffer.from('GIF89a-watchdog-contract');
  await manager.installGif(gif, crc32(gif), 50, 2);

  const chunk = calls.find(({ type }) => type === PacketType.GIF_CHUNK);
  const commit = calls.find(({ type }) => type === PacketType.GIF_COMMIT);
  assert.equal(chunk.options.timeoutMs, 1000);
  assert.equal(chunk.options.maximumRetries, 3);
  assert.equal(commit.options.timeoutMs, 1000);
  assert.equal(commit.options.maximumRetries, 12);
});
