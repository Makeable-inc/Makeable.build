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
const execFileAsync = promisify(execFile);
const USB_SERIAL_PATTERN = /(?:usbserial|wchusbserial|ch340|usbmodem|slab_usb)/i;
const LEGACY_TAMAGOTCHI_MARKER = '.claude-tamagotchi/tamagotchi.pl';
const LEGACY_TAMAGOTCHI_PLIST = path.join(os.homedir(), 'Library', 'LaunchAgents', 'com.claude.tamagotchi.plist');

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

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
  const eligible = owners.filter((owner) => (
    options.forceAll || owner.command.includes(LEGACY_TAMAGOTCHI_MARKER)
  ));
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
    const candidates = new Map();
    for (const port of listed) {
      const identity = `${port.path} ${port.manufacturer || ''} ${port.friendlyName || ''} ${port.vendorId || ''}:${port.productId || ''}`;
      if (!USB_SERIAL_PATTERN.test(identity) && !/^1a86:7523$/i.test(`${port.vendorId || ''}:${port.productId || ''}`)) continue;
      for (const alias of portAliases(port.path)) candidates.set(alias, { ...port, path: alias });
    }
    try {
      for (const entry of fs.readdirSync('/dev')) {
        if (!/^(?:cu|tty)\.(?:usbserial|wchusbserial|usbmodem|SLAB_USB)/i.test(entry)) continue;
        const devicePath = path.join('/dev', entry);
        if (!candidates.has(devicePath)) candidates.set(devicePath, { path: devicePath });
      }
    } catch { /* SerialPort.list remains the fallback */ }
    return [...candidates.values()].sort((left, right) => {
      const leftCallout = path.basename(left.path).startsWith('cu.') ? 0 : 1;
      const rightCallout = path.basename(right.path).startsWith('cu.') ? 0 : 1;
      return leftCallout - rightCallout || left.path.localeCompare(right.path);
    });
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
    return this.runExclusive(() => this.connectUnlocked(preferredPath, { forceTakeover: true }));
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
      await new Promise((resolve) => port.close(() => resolve()));
    }
    this.intentionalDisconnect = false;
  }

  async openCandidateUnlocked(candidate, lock) {
    const selectedPath = candidate.path;
    this.path = selectedPath;
    const port = new SerialPort({ path: selectedPath, baudRate: SERIAL_BAUD, autoOpen: false, lock });
    this.port = port;
    port.on('data', (chunk) => this.onData(chunk));
    port.on('error', (error) => this.emit('port-error', error));
    port.on('close', () => {
      if (this.port !== port) return;
      this.port = null;
      this.path = null;
      this.rejectPending(new Error('Serial port closed'));
      this.emit('disconnected');
    });

    try {
      await new Promise((resolve, reject) => port.open((error) => (error ? reject(error) : resolve())));
      // CH340 opens can reset the ESP32. Wait for firmware, clear boot noise,
      // and retry the protocol HELLO once before moving to another alias.
      await delay(1100);
      await new Promise((resolve) => port.flush(() => resolve()));
      await this.write(Buffer.from([0]));
      try {
        await this.send(PacketType.HELLO, buildHelloPayload(), { timeoutMs: 2500 });
      } catch {
        await delay(500);
        await this.send(PacketType.HELLO, buildHelloPayload(), { timeoutMs: 2500 });
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

  async connectUnlocked(preferredPath, options) {
    const rememberedPath = preferredPath || this.path;
    await this.disconnectUnlocked();
    if (!options.forceTakeover) await bootoutLegacyTamagotchi();
    const errors = [];
    const reclaimed = [];
    const rounds = options.forceTakeover ? 3 : 2;

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
        const aliases = portAliases(candidate.path).filter((devicePath) => fs.existsSync(devicePath));
        const released = await reclaimPortOwners(aliases, { forceAll: options.forceTakeover });
        for (const owner of released) {
          if (!reclaimed.some((existing) => existing.pid === owner.pid)) reclaimed.push(owner);
        }
        const lockModes = options.forceTakeover ? [true, false] : [true];
        for (const lock of lockModes) {
          try {
            const connectedPath = await this.openCandidateUnlocked(candidate, lock);
            const report = { path: connectedPath, reclaimed, attempts: errors.length + 1, lock };
            this.lastConnectReport = report;
            return report;
          } catch (error) {
            errors.push(`${candidate.path}: ${error.message}`);
            if (!isResourceBusyError(error) && !options.forceTakeover) break;
            await delay(150);
          }
        }
      }
      await delay(300 * (round + 1));
    }

    const detail = errors.slice(-6).join(' · ');
    throw new Error(`Unable to claim the CYD serial connection after ${errors.length} attempts${detail ? `: ${detail}` : ''}`);
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
          pending.reject(new Error(`Device NACK ${acknowledgement.code}`));
        } else {
          pending.resolve(acknowledgement);
        }
      }
    }
    this.emit('packet', packet);
  }

  async write(buffer) {
    if (!this.connected) throw new Error('Serial port is not connected');
    await new Promise((resolve, reject) => this.port.write(buffer, (error) => (error ? reject(error) : resolve())));
  }

  async send(type, payload, options = {}) {
    const sequence = this.sequence;
    this.sequence = (this.sequence + 1) >>> 0 || 1;
    const encoded = encodePacket(type, sequence, payload, options.flags || 0);
    const timeoutMs = options.timeoutMs ?? 800;
    const acknowledgement = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(sequence);
        reject(new Error(`Timed out waiting for ACK of sequence ${sequence}`));
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
      return await acknowledgement;
    } catch (error) {
      const pending = this.pending.get(sequence);
      if (pending) clearTimeout(pending.timer);
      this.pending.delete(sequence);
      throw error;
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
        reject(new Error(`Timed out waiting for pipelined ACK of sequence ${sequence}`));
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
      return { uploaded: false, bytes: 0, chunks: 0, checksum };
    }

    let chunks = 0;
    for (let offset = 0; offset < gifBytes.length; offset += GIF_CHUNK_BYTES) {
      await this.send(PacketType.GIF_CHUNK, buildGifChunkPayload(gifBytes, offset), { timeoutMs: 2500 });
      chunks += 1;
    }
    await this.send(
      PacketType.GIF_COMMIT,
      buildGifCommitPayload(gifBytes, checksum),
      { timeoutMs: 5000 },
    );
    await this.sendHud(life, level);
    return { uploaded: true, bytes: gifBytes.length, chunks, checksum };
  }
}

module.exports = {
  SerialManager,
  SERIAL_BAUD,
  isResourceBusyError,
  portAliases,
  reclaimPortOwners,
};
