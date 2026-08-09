'use strict';

const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { SerialPort } = require('serialport');
const {
  PacketType,
  AckCode,
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
  GIF_CHUNK_BYTES,
  parseAckPayload,
} = require('./serial-protocol');

const SERIAL_BAUD = 2_000_000;
const GIF_CHUNK_MAX_RETRIES = 3;
const execFileAsync = promisify(execFile);
const USB_SERIAL_PATTERN = /(?:usbserial|wchusbserial|ch340|usbmodem|slab_usb)/i;
const LEGACY_TAMAGOTCHI_MARKER = '.claude-tamagotchi/tamagotchi.pl';
const LEGACY_TAMAGOTCHI_PLIST = path.join(os.homedir(), 'Library', 'LaunchAgents', 'com.claude.tamagotchi.plist');

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

class AcknowledgementTimeoutError extends Error {
  constructor(sequence, pipelined = false) {
    super(`Timed out waiting for ${pipelined ? 'pipelined ' : ''}ACK of sequence ${sequence}`);
    this.name = 'AcknowledgementTimeoutError';
    this.sequence = sequence;
  }
}

class DeviceNackError extends Error {
  constructor(acknowledgement) {
    super(`Device NACK ${acknowledgement.code}`);
    this.name = 'DeviceNackError';
    this.sequence = acknowledgement.acknowledgedSequence;
    this.ackCode = acknowledgement.code;
    this.acknowledgement = acknowledgement;
  }
}

class SerialConnectionError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'SerialConnectionError';
    this.code = code;
    this.details = details;
  }
}

class SerialPortBusyError extends SerialConnectionError {
  constructor(devicePath, owners = [], cause = null) {
    const ownerLabel = owners.length
      ? owners.map((owner) => `${owner.command || 'another process'} (PID ${owner.pid})`).join(', ')
      : 'another application';
    super(
      'PORT_BUSY',
      `The CYD USB port is in use by ${ownerLabel}. Close that app, keep the cable connected, then retry.`,
      { devicePath, owners, cause: cause?.message || null },
    );
    this.name = 'SerialPortBusyError';
  }
}

class DeviceProtocolError extends SerialConnectionError {
  constructor(devicePath, cause) {
    super(
      'FIRMWARE_REQUIRED',
      `An ESP32 was found on ${devicePath}, but it did not answer as a Claude Burner display. Install or repair its bundled firmware.`,
      { devicePath, cause: cause?.message || null },
    );
    this.name = 'DeviceProtocolError';
  }
}

function isResourceBusyError(error) {
  return /(?:resource busy|\bEBUSY\b|cannot open)/i.test(String(error?.message || error || ''));
}

function portAliases(portPath) {
  if (!portPath) return [];
  const aliases = new Set([portPath]);
  const basename = path.basename(portPath);
  if (basename.startsWith('tty.')) aliases.add(path.join(path.dirname(portPath), `cu.${basename.slice(4)}`));
  if (basename.startsWith('cu.')) aliases.add(path.join(path.dirname(portPath), `tty.${basename.slice(3)}`));
  return [...aliases];
}

function dedupeCandidatePorts(discovered, exists = fs.existsSync) {
  const physical = new Map();
  for (const candidate of discovered) {
    const basename = path.basename(candidate.path).replace(/^(?:cu|tty)\./, '');
    const identityKey = candidate.serialNumber
      ? `serial:${candidate.serialNumber}`
      : candidate.locationId
        ? `location:${candidate.locationId}:${candidate.vendorId || ''}:${candidate.productId || ''}`
        : `path:${basename}`;
    const existing = physical.get(identityKey);
    const paths = new Set([...(existing?.aliases || []), ...portAliases(candidate.path)]);
    const callout = [...paths].find((devicePath) => path.basename(devicePath).startsWith('cu.') && exists(devicePath))
      || [...paths].find((devicePath) => path.basename(devicePath).startsWith('cu.'))
      || [...paths].find((devicePath) => exists(devicePath))
      || candidate.path;
    physical.set(identityKey, {
      ...(existing || {}),
      ...candidate,
      path: callout,
      aliases: [...paths],
      physicalId: identityKey,
    });
  }
  return [...physical.values()].sort((left, right) => {
    const leftCallout = path.basename(left.path).startsWith('cu.') ? 0 : 1;
    const rightCallout = path.basename(right.path).startsWith('cu.') ? 0 : 1;
    return leftCallout - rightCallout || left.path.localeCompare(right.path);
  });
}

async function ownerDetails(devicePaths) {
  let stdout = '';
  try {
    ({ stdout } = await execFileAsync('/usr/sbin/lsof', ['-t', ...devicePaths], {
      timeout: 2000,
      maxBuffer: 64 * 1024,
    }));
  } catch (error) {
    // lsof can print owners but still return 1 when one alias has no owner.
    // Preserve that partial stdout so a busy cu.* device is not missed merely
    // because its tty.* twin is currently unused.
    stdout = error.stdout || '';
    if (!stdout) return [];
  }
  const pids = [...new Set(String(stdout).split(/\s+/).map(Number).filter((pid) => pid > 1 && pid !== process.pid))];
  return Promise.all(pids.map(async (pid) => {
    try {
      const result = await execFileAsync('/bin/ps', ['-p', String(pid), '-o', 'command='], {
        timeout: 1500,
        maxBuffer: 32 * 1024,
      });
      return { pid, command: result.stdout.trim() };
    } catch {
      return { pid, command: '' };
    }
  }));
}

async function bootoutLegacyTamagotchi() {
  if (!fs.existsSync(LEGACY_TAMAGOTCHI_PLIST) || typeof process.getuid !== 'function') return false;
  let changed = false;
  const serviceTarget = `gui/${process.getuid()}/com.claude.tamagotchi`;
  try {
    await execFileAsync('/bin/launchctl', ['disable', serviceTarget], {
      timeout: 3000,
      maxBuffer: 32 * 1024,
    });
    changed = true;
  } catch { /* it may already be disabled */ }
  try {
    await execFileAsync('/bin/launchctl', [
      'bootout',
      `gui/${process.getuid()}`,
      LEGACY_TAMAGOTCHI_PLIST,
    ], { timeout: 4000, maxBuffer: 32 * 1024 });
    changed = true;
  } catch {
    // A service that is already booted out is the desired state.
  }
  return changed;
}

function processExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function reclaimPortOwners(devicePaths, options = {}) {
  const owners = await ownerDetails(devicePaths);
  const eligible = owners.filter((owner) => owner.command.includes(LEGACY_TAMAGOTCHI_MARKER));
  if (!eligible.length) return [];

  if (eligible.some((owner) => owner.command.includes(LEGACY_TAMAGOTCHI_MARKER))) {
    await bootoutLegacyTamagotchi();
  }
  for (const owner of eligible) {
    if (!processExists(owner.pid)) continue;
    try { process.kill(owner.pid, 'SIGTERM'); } catch { /* already gone or not permitted */ }
  }
  await delay(350);
  for (const owner of eligible) {
    if (!processExists(owner.pid)) continue;
    try { process.kill(owner.pid, 'SIGKILL'); } catch { /* report through retry errors */ }
  }
  await delay(250);
  return eligible;
}

class SerialManager extends EventEmitter {
  constructor() {
    super();
    this.port = null;
    this.sequence = 1;
    this.encodedBuffer = Buffer.alloc(0);
    this.pending = new Map();
    this.lastReceivedAt = 0;
    this.path = null;
    this.asynchronousError = null;
    this.intentionalDisconnect = false;
    this.operation = Promise.resolve();
    this.lastConnectReport = null;
  }

  static async candidatePorts() {
    const listed = await SerialPort.list();
    const discovered = [];
    for (const port of listed) {
      const identity = `${port.path} ${port.manufacturer || ''} ${port.friendlyName || ''} ${port.vendorId || ''}:${port.productId || ''}`;
      if (!USB_SERIAL_PATTERN.test(identity) && !/^1a86:7523$/i.test(`${port.vendorId || ''}:${port.productId || ''}`)) continue;
      discovered.push({ ...port, path: port.path });
    }
    try {
      for (const entry of fs.readdirSync('/dev')) {
        if (!/^(?:cu|tty)\.(?:usbserial|wchusbserial|usbmodem|SLAB_USB)/i.test(entry)) continue;
        const devicePath = path.join('/dev', entry);
        if (!discovered.some((candidate) => candidate.path === devicePath)) discovered.push({ path: devicePath });
      }
    } catch { /* SerialPort.list remains the fallback */ }

    // macOS normally exposes the same physical UART as both tty.* and cu.*.
    // Trying both aliases caused the eight-attempt retry storm in the first-run
    // recording. Collapse them into one physical candidate and prefer cu.*.
    return dedupeCandidatePorts(discovered);
  }

  get connected() {
    return Boolean(this.port && this.port.isOpen);
  }

  runExclusive(operation) {
    const result = this.operation.then(operation, operation);
    this.operation = result.catch(() => {});
    return result;
  }

  connect(preferredPath = null) {
    return this.runExclusive(async () => {
      if (this.connected && (!preferredPath || portAliases(preferredPath).includes(this.path))) return this.path;
      const report = await this.connectUnlocked(preferredPath, { forceTakeover: false });
      return report.path;
    });
  }

  forceReconnect(preferredPath = null) {
    return this.runExclusive(() => this.connectUnlocked(preferredPath, { diagnoseBusy: true }));
  }

  disconnect() {
    return this.runExclusive(() => this.disconnectUnlocked());
  }

  async disconnectUnlocked() {
    if (!this.port) {
      this.asynchronousError = null;
      return;
    }
    const port = this.port;
    this.port = null;
    this.path = null;
    this.intentionalDisconnect = true;
    this.rejectPending(new Error('Serial connection ended'));
    // Allow pipelined acknowledgement rejection handlers to settle while the
    // disconnect is still marked intentional, then discard those stale errors.
    await delay(0);
    this.asynchronousError = null;
    if (port.isOpen) {
      try {
        await new Promise((resolve) => port.drain(() => resolve()));
      } catch { /* a disconnected device cannot be drained */ }
      await new Promise((resolve) => port.close(() => resolve()));
    }
    this.intentionalDisconnect = false;
  }

  async openCandidateUnlocked(candidate) {
    const selectedPath = candidate.path;
    this.path = selectedPath;
    const port = new SerialPort({ path: selectedPath, baudRate: SERIAL_BAUD, autoOpen: false, lock: true });
    this.port = port;
    port.on('data', (chunk) => this.onData(chunk));
    port.on('error', (error) => this.emit('port-error', error));
    port.on('close', (error) => {
      if (this.port !== port) return;
      this.port = null;
      this.path = null;
      this.rejectPending(error || new Error('Serial port closed'));
      this.emit('disconnected', { error: error || null, disconnected: Boolean(error?.disconnected) });
    });

    try {
      await new Promise((resolve, reject) => port.open((error) => (error ? reject(error) : resolve())));
      // CH340 opens can reset the ESP32. Wait for firmware, clear boot noise,
      // and retry the protocol HELLO once before moving to another alias.
      await delay(700);
      await new Promise((resolve) => port.flush(() => resolve()));
      this.sequence = 1;
      await this.write(Buffer.from([0]));
      try {
        await this.send(PacketType.HELLO, buildHelloPayload(), { timeoutMs: 1200, maximumRetries: 1 });
      } catch (error) {
        if (error instanceof AcknowledgementTimeoutError) throw new DeviceProtocolError(selectedPath, error);
        throw error;
      }
      this.emit('connected', { path: selectedPath, baudRate: SERIAL_BAUD });
      this.encodedBuffer = Buffer.alloc(0);
      this.asynchronousError = null;
      return selectedPath;
    } catch (error) {
      await this.disconnectUnlocked();
      throw error;
    }
  }

  async connectUnlocked(preferredPath, options = {}) {
    const rememberedPath = preferredPath || this.path;
    await this.disconnectUnlocked();
    await bootoutLegacyTamagotchi();
    const errors = [];
    const reclaimed = [];
    let lastBusyError = null;
    let lastProtocolError = null;
    const rounds = options.diagnoseBusy ? 3 : 2;

    for (let round = 0; round < rounds; round += 1) {
      let candidates = await SerialManager.candidatePorts();
      if (rememberedPath) {
        const preferredAliases = portAliases(rememberedPath);
        candidates = candidates.sort((left, right) => {
          const leftRank = preferredAliases.includes(left.path) ? 0 : 1;
          const rightRank = preferredAliases.includes(right.path) ? 0 : 1;
          return leftRank - rightRank;
        });
      }
      if (!candidates.length) {
        errors.push('No CH340/USB serial device found');
        await delay(250 * (round + 1));
        continue;
      }

      for (const candidate of candidates) {
        const aliases = (candidate.aliases || portAliases(candidate.path)).filter((devicePath) => fs.existsSync(devicePath));
        const released = await reclaimPortOwners(aliases);
        for (const owner of released) {
          if (!reclaimed.some((existing) => existing.pid === owner.pid)) reclaimed.push(owner);
        }
        try {
          const connectedPath = await this.openCandidateUnlocked(candidate);
          const report = { path: connectedPath, reclaimed, attempts: errors.length + 1, lock: true, physicalId: candidate.physicalId || null };
          this.lastConnectReport = report;
          return report;
        } catch (error) {
          errors.push(`${candidate.path}: ${error.message}`);
          if (error instanceof DeviceProtocolError) lastProtocolError = error;
          if (isResourceBusyError(error)) {
            const owners = await ownerDetails(aliases.length ? aliases : portAliases(candidate.path));
            lastBusyError = new SerialPortBusyError(candidate.path, owners, error);
          }
          await delay(150);
        }
      }
      await delay(300 * (round + 1));
    }

    if (lastBusyError) throw lastBusyError;
    if (lastProtocolError) throw lastProtocolError;
    const detail = errors.slice(-4).join(' · ');
    throw new SerialConnectionError(
      errors.length ? 'CONNECT_FAILED' : 'NO_DEVICE',
      errors.length
        ? `Unable to connect to the CYD after ${errors.length} bounded attempts${detail ? `: ${detail}` : ''}`
        : 'No supported ESP32 USB serial device was found. Check the data cable and reconnect the CYD.',
      { attempts: errors.length, errors: errors.slice(-4) },
    );
  }

  rejectPending(error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  onData(chunk) {
    this.lastReceivedAt = Date.now();
    this.encodedBuffer = Buffer.concat([this.encodedBuffer, chunk]);
    while (true) {
      const delimiter = this.encodedBuffer.indexOf(0);
      if (delimiter < 0) break;
      const encoded = this.encodedBuffer.subarray(0, delimiter);
      this.encodedBuffer = this.encodedBuffer.subarray(delimiter + 1);
      if (!encoded.length) continue;
      try {
        const packet = decodePacket(encoded);
        this.handlePacket(packet);
      } catch (error) {
        this.emit('protocol-error', error);
      }
    }
    if (this.encodedBuffer.length > 170_000) {
      this.encodedBuffer = Buffer.alloc(0);
      this.emit('protocol-error', new Error('Incoming packet exceeded safety limit'));
    }
  }

  handlePacket(packet) {
    if (packet.type === PacketType.ACK || packet.type === PacketType.NACK) {
      const acknowledgement = parseAckPayload(packet.payload);
      const pending = this.pending.get(acknowledgement.acknowledgedSequence);
      if (pending) {
        clearTimeout(pending.timer);
        this.pending.delete(acknowledgement.acknowledgedSequence);
        const acceptedCodes = pending.acceptedCodes || [AckCode.OKAY];
        if (packet.type === PacketType.NACK || !acceptedCodes.includes(acknowledgement.code)) {
          pending.reject(new DeviceNackError(acknowledgement));
        } else {
          pending.resolve(acknowledgement);
        }
      }
    }
    this.emit('packet', packet);
  }

  async write(buffer) {
    if (!this.connected) throw new Error('Serial port is not connected');
    const port = this.port;
    await new Promise((resolve, reject) => port.write(buffer, (error) => (error ? reject(error) : resolve())));
    if (port.writableNeedDrain && port.isOpen) {
      await new Promise((resolve, reject) => port.drain((error) => (error ? reject(error) : resolve())));
    }
  }

  async send(type, payload, options = {}) {
    const sequence = this.sequence;
    this.sequence = (this.sequence + 1) >>> 0 || 1;
    const encoded = encodePacket(type, sequence, payload, options.flags || 0);
    const timeoutMs = options.timeoutMs ?? 800;
    const maximumRetries = Math.max(0, Math.floor(options.maximumRetries ?? 0));
    let retries = 0;

    while (true) {
      const acknowledgement = new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          this.pending.delete(sequence);
          reject(new AcknowledgementTimeoutError(sequence));
        }, timeoutMs);
        this.pending.set(sequence, {
          resolve,
          reject,
          timer,
          acceptedCodes: options.acceptedCodes || [AckCode.OKAY],
        });
      });
      this.pending.get(sequence).promise = acknowledgement;
      try {
        await this.write(encoded);
        const result = await acknowledgement;
        result.retries = retries;
        return result;
      } catch (error) {
        const pending = this.pending.get(sequence);
        if (pending) clearTimeout(pending.timer);
        this.pending.delete(sequence);
        const retryable = error instanceof AcknowledgementTimeoutError
          || (options.retryOnNack && error instanceof DeviceNackError);
        if (!retryable || retries >= maximumRetries) throw error;
        retries += 1;
      }
    }
  }

  async sendPipelined(type, payload, options = {}) {
    const maximumInFlight = options.maximumInFlight ?? 2;
    while (this.pending.size >= maximumInFlight) {
      const inFlight = [...this.pending.values()].map((pending) => pending.promise).filter(Boolean);
      if (!inFlight.length) break;
      await Promise.race(inFlight);
    }
    const sequence = this.sequence;
    this.sequence = (this.sequence + 1) >>> 0 || 1;
    const encoded = encodePacket(type, sequence, payload, options.flags || 0);
    const timeoutMs = options.timeoutMs ?? 1800;
    const acknowledgement = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(sequence);
        reject(new AcknowledgementTimeoutError(sequence, true));
      }, timeoutMs);
      this.pending.set(sequence, {
        resolve,
        reject,
        timer,
        acceptedCodes: options.acceptedCodes || [AckCode.OKAY],
      });
    });
    this.pending.get(sequence).promise = acknowledgement;
    acknowledgement.catch((error) => {
      if (!this.intentionalDisconnect) this.asynchronousError = error;
    });
    try {
      await this.write(encoded);
      return sequence;
    } catch (error) {
      const pending = this.pending.get(sequence);
      if (pending) clearTimeout(pending.timer);
      this.pending.delete(sequence);
      throw error;
    }
  }

  async waitForPipelineIdle() {
    while (this.pending.size) {
      const inFlight = [...this.pending.values()].map((pending) => pending.promise).filter(Boolean);
      if (!inFlight.length) return;
      await Promise.race(inFlight);
    }
  }

  consumeAsynchronousError() {
    const error = this.asynchronousError;
    this.asynchronousError = null;
    return error;
  }

  async sendKeyframe(rgb565, life, level) {
    let acknowledgement = null;
    for (const payload of buildKeyframePayloads(rgb565, life, level)) {
      acknowledgement = await this.send(PacketType.KEYFRAME, payload, { timeoutMs: 1200 });
    }
    return acknowledgement;
  }

  sendDelta(previous, current, life, level, options = {}) {
    const payload = buildDeltaPayload(previous, current, life, level);
    if (!payload) return null;
    return options.pipelined
      ? this.sendPipelined(PacketType.DELTA, payload, { timeoutMs: 1800, maximumInFlight: 2 })
      : this.send(PacketType.DELTA, payload, { timeoutMs: 900 });
  }

  sendHeartbeat() {
    return this.send(PacketType.HEARTBEAT, Buffer.alloc(0), { timeoutMs: 800 });
  }

  sendStatus(status, life, level) {
    return this.send(PacketType.STATUS, buildStatusPayload(status, life, level), { timeoutMs: 800 });
  }

  sendHud(life, level) {
    return this.send(PacketType.HUD_UPDATE, buildHudPayload(life, level), { timeoutMs: 800 });
  }

  async installGif(gifBytes, checksum, life, level) {
    if (!Buffer.isBuffer(gifBytes)) throw new Error('GIF installation requires a Buffer');
    const begin = await this.send(
      PacketType.GIF_BEGIN,
      buildGifBeginPayload(gifBytes, checksum, life, level),
      {
        timeoutMs: 2500,
        acceptedCodes: [AckCode.OKAY, AckCode.GIF_ALREADY_LOADED],
      },
    );
    if (begin.code === AckCode.GIF_ALREADY_LOADED) {
      await this.sendHud(life, level);
      return {
        uploaded: false,
        activationConfirmed: true,
        bytes: 0,
        chunks: 0,
        chunkRetries: 0,
        checksum,
      };
    }

    let chunks = 0;
    let chunkRetries = 0;
    for (let offset = 0; offset < gifBytes.length; offset += GIF_CHUNK_BYTES) {
      const acknowledgement = await this.send(
        PacketType.GIF_CHUNK,
        buildGifChunkPayload(gifBytes, offset),
        {
          // Retry before the firmware's 1.5-second link watchdog can classify
          // a lost ACK as a disconnected host. Retries reuse this sequence.
          timeoutMs: 1000,
          maximumRetries: GIF_CHUNK_MAX_RETRIES,
          retryOnNack: true,
        },
      );
      chunkRetries += acknowledgement.retries || 0;
      chunks += 1;
    }
    await this.send(
      PacketType.GIF_COMMIT,
      buildGifCommitPayload(gifBytes, checksum),
      // Firmware withholds this ACK until the old 4-second loop reaches its
      // boundary and the validated replacement has drawn its complete first
      // frame. Same-sequence timeout retries double as keepalives, preserving
      // the strict 1.5-second cable-loss watchdog without re-running COMMIT.
      { timeoutMs: 1000, maximumRetries: 12 },
    );
    await this.sendHud(life, level);
    return {
      uploaded: true,
      activationConfirmed: true,
      bytes: gifBytes.length,
      chunks,
      chunkRetries,
      checksum,
    };
  }
}

module.exports = {
  SerialManager,
  SERIAL_BAUD,
  GIF_CHUNK_MAX_RETRIES,
  AcknowledgementTimeoutError,
  DeviceNackError,
  SerialConnectionError,
  SerialPortBusyError,
  DeviceProtocolError,
  isResourceBusyError,
  portAliases,
  dedupeCandidatePorts,
  ownerDetails,
  reclaimPortOwners,
};
