'use strict';

const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { SerialManager, portAliases } = require('./serial-manager');

const EXPECTED_PRODUCT = 'Claude Burner CYD';
const EXPECTED_TARGET = 'esp32';
const EXPECTED_STORAGE = Object.freeze({ label: 'spiffs', offset: '0x290000', bytes: 1408 * 1024 });
const EXPECTED_SEGMENTS = new Map([
  ['0x1000', 'bootloader.bin'],
  ['0x8000', 'partitions.bin'],
  ['0xe000', 'boot_app0.bin'],
  ['0x10000', 'firmware.bin'],
]);
const ESP32_USB_PATTERN = /(?:usbserial|wchusbserial|ch340|usbmodem|slab_usb)/i;
const SUPPORTED_USB_BRIDGES = new Set([
  '1a86:7523', // CH340/CH341 (most ESP32-2432S028 boards)
  '1a86:55d4', // CH9102 variants
  '10c4:ea60', // CP210x variants
]);

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function resolveFirmwareResources({ packaged, resourcesPath, projectRoot }) {
  if (packaged) {
    return {
      bundleRoot: path.join(resourcesPath, 'firmware'),
      esptoolPath: path.join(resourcesPath, 'bin', 'esptool'),
    };
  }
  return {
    bundleRoot: path.join(projectRoot, 'build', 'firmware'),
    esptoolPath: path.join(projectRoot, 'build', 'bin', 'esptool'),
  };
}

function readAndValidateBundle(bundleRoot) {
  const manifestPath = path.join(bundleRoot, 'manifest.json');
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    throw new Error(`Firmware manifest is unavailable: ${error.message}`);
  }
  if (manifest.version !== 1 || manifest.product !== EXPECTED_PRODUCT || manifest.targetChip !== EXPECTED_TARGET) {
    throw new Error('The bundled firmware does not identify as Claude Burner for ESP32.');
  }
  if (!manifest.flash || manifest.flash.eraseAll !== false || manifest.flash.preserveLittleFs !== true) {
    throw new Error('The bundled firmware does not preserve the device animation partition.');
  }
  const storage = manifest.flash.storagePartition;
  if (storage?.label !== EXPECTED_STORAGE.label
      || String(storage?.offset || '').toLowerCase() !== EXPECTED_STORAGE.offset
      || Number(storage?.bytes) !== EXPECTED_STORAGE.bytes) {
    throw new Error('The bundled firmware does not pin the expected animation storage partition.');
  }
  if (!Array.isArray(manifest.flash.segments) || manifest.flash.segments.length !== EXPECTED_SEGMENTS.size) {
    throw new Error('The bundled firmware segment map is incomplete.');
  }

  const normalizedRoot = fs.realpathSync.native(bundleRoot);
  const segments = manifest.flash.segments.map((segment) => {
    const address = String(segment.address || '').toLowerCase();
    const expectedFile = EXPECTED_SEGMENTS.get(address);
    if (!expectedFile || segment.file !== expectedFile || path.basename(segment.file) !== segment.file) {
      throw new Error(`Unexpected firmware segment ${address || '(missing)'}.`);
    }
    const filePath = fs.realpathSync.native(path.join(bundleRoot, segment.file));
    if (!filePath.startsWith(`${normalizedRoot}${path.sep}`)) throw new Error('Firmware segment escaped its bundle.');
    const stat = fs.statSync(filePath);
    if (!stat.isFile() || stat.size !== Number(segment.bytes) || sha256(filePath) !== segment.sha256) {
      throw new Error(`${segment.file} failed its SHA-256 integrity check.`);
    }
    return { ...segment, address, filePath };
  });
  const actual = new Map(segments.map((segment) => [segment.address, segment.file]));
  for (const [address, file] of EXPECTED_SEGMENTS) {
    if (actual.get(address) !== file) throw new Error(`Firmware segment ${address} is missing.`);
  }
  const partitionSegment = segments.find((segment) => segment.address === '0x8000');
  if (storage.partitionTableSha256 !== partitionSegment.sha256) {
    throw new Error('The storage layout does not match the bundled partition table.');
  }
  const updates = Array.isArray(manifest.flash.updateSegments) ? manifest.flash.updateSegments : [];
  if (updates.length !== 1 || String(updates[0]).toLowerCase() !== '0x10000') {
    throw new Error('Normal firmware updates must write only the application partition.');
  }
  return { manifest, segments };
}

function parseProgress(output) {
  const matches = [...String(output || '').matchAll(/(?:\(|\b)(\d{1,3})\s*%\)?/g)];
  if (!matches.length) return null;
  return Math.max(0, Math.min(100, Number(matches.at(-1)[1])));
}

function runCommand(binary, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, {
      cwd: options.cwd,
      env: { ...process.env, NO_COLOR: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
    });
    let stdout = '';
    let stderr = '';
    let finished = false;
    let timedOut = false;
    const onChunk = (chunk, isError) => {
      const text = chunk.toString('utf8');
      if (isError) stderr += text;
      else stdout += text;
      options.onOutput?.(text, isError);
    };
    child.stdout.on('data', (chunk) => onChunk(chunk, false));
    child.stderr.on('data', (chunk) => onChunk(chunk, true));
    const timer = setTimeout(() => {
      if (finished) return;
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 1500).unref();
    }, options.timeoutMs || 180_000);
    timer.unref();
    child.once('error', (error) => {
      finished = true;
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', (code, signal) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      const combined = `${stdout}\n${stderr}`.trim();
      if (code === 0) resolve({ code, stdout, stderr, combined });
      else if (timedOut) reject(new Error(`Espressif firmware tool timed out. ${combined}`.trim()));
      else reject(new Error(combined || `esptool exited with ${signal || code}`));
    });
  });
}

function canonicalPortPath(candidate) {
  const aliases = portAliases(candidate.path);
  return aliases.find((alias) => path.basename(alias).startsWith('cu.') && fs.existsSync(alias))
    || aliases.find((alias) => fs.existsSync(alias))
    || candidate.path;
}

function expectedBoard(candidate, manifest) {
  const vendorId = String(candidate.vendorId || '').toLowerCase();
  const productId = String(candidate.productId || '').toLowerCase();
  const expectedVendor = String(manifest.usb?.vendorId || '1a86').toLowerCase();
  const expectedProduct = String(manifest.usb?.productId || '7523').toLowerCase();
  if (vendorId || productId) {
    const identity = `${vendorId}:${productId}`;
    return (vendorId === expectedVendor && productId === expectedProduct) || SUPPORTED_USB_BRIDGES.has(identity);
  }
  return ESP32_USB_PATTERN.test(`${candidate.path} ${candidate.manufacturer || ''} ${candidate.friendlyName || ''}`);
}

function strictExpectedBoard(candidate, manifest) {
  const vendorId = String(candidate.vendorId || '').toLowerCase();
  const productId = String(candidate.productId || '').toLowerCase();
  const expectedVendor = String(manifest.usb?.vendorId || '1a86').toLowerCase();
  const expectedProduct = String(manifest.usb?.productId || '7523').toLowerCase();
  return vendorId === expectedVendor && productId === expectedProduct;
}

function parseEsp32Identity(output, options = {}) {
  const text = String(output || '');
  const chip = text.match(/Chip type:\s*(ESP32[^\r\n]*)/i)?.[1]?.trim() || null;
  const mac = text.match(/\bMAC:\s*([0-9a-f]{2}(?::[0-9a-f]{2}){5})\b/i)?.[1]?.toLowerCase() || null;
  if (!chip || !/^ESP32(?:\b|-)/i.test(chip)) {
    throw new Error('The selected USB serial device did not identify as an ESP32.');
  }
  if (!mac && options.requireMac !== false) throw new Error('The ESP32 did not return a stable hardware MAC address.');
  return { chip, mac };
}

function parseFlashBytes(output) {
  const match = String(output || '').match(/Detected flash size:\s*(\d+(?:\.\d+)?)\s*(KB|MB)/i);
  if (!match) throw new Error('The ESP32 flash capacity could not be verified.');
  const scalar = match[2].toUpperCase() === 'MB' ? 1024 * 1024 : 1024;
  return Math.round(Number(match[1]) * scalar);
}

function parseSecurityInfo(output) {
  const text = String(output || '');
  const unsupported = /command not implemented|failed to get security info/i.test(text);
  const secureBootEnabled = /secure\s*boot[^\r\n]*(?:enabled|true|active)/i.test(text)
    && !/secure\s*boot[^\r\n]*(?:disabled|false|not enabled)/i.test(text);
  const flashEncryptionEnabled = /flash\s*encrypt(?:ion)?[^\r\n]*(?:enabled|true|active)/i.test(text)
    && !/flash\s*encrypt(?:ion)?[^\r\n]*(?:disabled|false|not enabled)/i.test(text);
  return {
    available: !unsupported,
    secureBootEnabled,
    flashEncryptionEnabled,
  };
}

class FirmwareInstaller extends EventEmitter {
  constructor(options) {
    super();
    this.serial = options.serial;
    this.streamer = options.streamer;
    this.resources = options.resources;
    this.run = options.runCommand || runCommand;
    this.listCandidates = options.listCandidates || (() => SerialManager.candidatePorts());
    this.state = {
      available: false,
      running: false,
      phase: 'idle',
      progress: 0,
      message: 'Connect an ESP32 CYD to install its firmware.',
      port: null,
      firmwareVersion: null,
      lastSuccessAt: null,
      lastError: null,
      installMode: 'update',
    };
  }

  snapshot() {
    return { ...this.state };
  }

  update(patch) {
    this.state = { ...this.state, ...patch };
    this.emit('status', this.snapshot());
  }

  loadResources() {
    const bundle = readAndValidateBundle(this.resources.bundleRoot);
    const toolStat = fs.statSync(this.resources.esptoolPath, { throwIfNoEntry: false });
    if (!toolStat?.isFile() || !(toolStat.mode & 0o111)) {
      throw new Error('The bundled Espressif flashing tool is unavailable.');
    }
    if (bundle.manifest.tool?.sha256 !== sha256(this.resources.esptoolPath)) {
      throw new Error('The bundled Espressif flashing tool failed its SHA-256 integrity check.');
    }
    return bundle;
  }

  async boards(manifest, options = {}) {
    const candidates = await this.listCandidates();
    const unique = new Map();
    const predicate = options.strict ? strictExpectedBoard : expectedBoard;
    for (const candidate of candidates.filter((entry) => predicate(entry, manifest))) {
      const devicePath = canonicalPortPath(candidate);
      const key = path.basename(devicePath).replace(/^(?:cu|tty)\./, '');
      if (!unique.has(key) || path.basename(devicePath).startsWith('cu.')) {
        unique.set(key, { ...candidate, path: devicePath });
      }
    }
    return [...unique.values()];
  }

  async scan() {
    try {
      const { manifest } = this.loadResources();
      const boards = await this.boards(manifest);
      const preferred = this.serial?.path;
      const board = boards.find((candidate) => portAliases(candidate.path).includes(preferred)) || boards[0] || null;
      this.update({
        available: Boolean(board),
        port: board?.path || null,
        firmwareVersion: manifest.firmwareVersion,
        autoProvisionEligible: Boolean(board && strictExpectedBoard(board, manifest)),
        provisionEligible: Boolean(board),
        provisionRecommended: Boolean(board && !this.serial?.connected),
        message: board
          ? (this.serial?.connected
            ? `Claude Burner display ready on ${board.path}`
            : `ESP32 USB device found on ${board.path}; firmware setup may be required.`)
          : 'Connect the ESP32 CYD over USB.',
        lastError: null,
      });
      return {
        ...this.snapshot(),
        boardFamily: manifest.board,
        boards: boards.map((candidate) => ({
          path: candidate.path,
          vendorId: candidate.vendorId,
          productId: candidate.productId,
          autoProvisionEligible: strictExpectedBoard(candidate, manifest),
          provisionEligible: expectedBoard(candidate, manifest),
          usbIdentityConfidence: strictExpectedBoard(candidate, manifest) ? 'exact-ch340' : 'supported-bridge',
        })),
      };
    } catch (error) {
      this.update({ available: false, lastError: error.message, message: error.message });
      return this.snapshot();
    }
  }

  async inspectProvisioningTarget(board, manifest) {
    const common = [
      '--chip', 'esp32', '--port', board.path, '--baud', '115200',
      '--before', 'default-reset', '--after', 'hard-reset', '--connect-attempts', '10',
    ];
    const identityOutput = await this.run(this.resources.esptoolPath, [...common, 'chip-id'], { timeoutMs: 30_000 });
    const identity = parseEsp32Identity(identityOutput.combined);
    const macOutput = await this.run(this.resources.esptoolPath, [...common, 'read-mac'], { timeoutMs: 30_000 });
    const confirmedIdentity = parseEsp32Identity(macOutput.combined);
    if (confirmedIdentity.mac !== identity.mac) {
      throw new Error('The ESP32 identity changed during inspection. Unplug other serial devices and retry.');
    }
    const flashOutput = await this.run(this.resources.esptoolPath, [...common, 'flash-id'], { timeoutMs: 30_000 });
    const flashBytes = parseFlashBytes(flashOutput.combined);
    if (flashBytes < 4 * 1024 * 1024) {
      throw new Error('This ESP32 has less than 4 MB of flash and is not compatible with Claude Burner.');
    }
    let security = { available: false, secureBootEnabled: false, flashEncryptionEnabled: false };
    try {
      const securityOutput = await this.run(this.resources.esptoolPath, [...common, 'get-security-info'], { timeoutMs: 30_000 });
      security = parseSecurityInfo(securityOutput.combined);
    } catch (error) {
      security = parseSecurityInfo(error.message);
      if (!security.available) {
        // Classic ESP32 ROMs used by the CYD may not implement this command.
        // Explicit first-connect authorization remains required in that case.
      } else {
        throw error;
      }
    }
    if (security.secureBootEnabled || security.flashEncryptionEnabled) {
      throw new Error('This ESP32 has Secure Boot or Flash Encryption enabled; automatic CYD provisioning was refused.');
    }
    return {
      ...identity,
      flashBytes,
      security,
      boardFamily: manifest.board,
      usbVendorId: String(board.vendorId || '').toLowerCase(),
      usbProductId: String(board.productId || '').toLowerCase(),
    };
  }

  async flash(preferredPath = null, options = {}) {
    if (this.state.running) throw new Error('Firmware installation is already running.');
    const { manifest, segments } = this.loadResources();
    const boards = await this.boards(manifest);
    const requestedPath = preferredPath || this.serial?.path || null;
    const preferredAliases = portAliases(requestedPath);
    const board = requestedPath
      ? boards.find((candidate) => preferredAliases.includes(candidate.path))
      : boards.length === 1 ? boards[0] : null;
    if (requestedPath && !board) {
      throw new Error(`The selected ESP32 CYD is no longer available on ${requestedPath}. Rescan before installing.`);
    }
    if (!requestedPath && boards.length > 1) {
      throw new Error('More than one supported ESP32 is connected. Select the exact display before installing.');
    }
    if (!board) throw new Error('No supported CH340 ESP32 CYD was found. Reconnect its USB cable and try again.');

    const provisioning = options.provision === true;
    if (provisioning && !expectedBoard(board, manifest)) {
      throw new Error('First-connect provisioning requires a supported ESP32 USB bridge and explicit board confirmation.');
    }
    if (provisioning && options.confirmedBoardFamily !== 'ESP32-2432S028') {
      throw new Error('Confirm that the connected device is an ESP32-2432S028 CYD before provisioning.');
    }
    const allowedAddresses = new Set((provisioning
      ? manifest.flash.provisioningSegments
      : manifest.flash.updateSegments).map((address) => String(address).toLowerCase()));
    const selectedSegments = segments.filter((segment) => allowedAddresses.has(segment.address));
    if (!selectedSegments.length || (!provisioning && selectedSegments.some((segment) => segment.address !== '0x10000'))) {
      throw new Error('The selected firmware install mode has no safe segment map.');
    }

    this.update({
      available: true,
      running: true,
      phase: 'preparing',
      progress: 2,
      port: board.path,
      firmwareVersion: manifest.firmwareVersion,
      installMode: provisioning ? 'provision' : 'update',
      message: 'Releasing the display connection safely…',
      lastError: null,
    });
    await this.streamer.pause();
    await this.serial.disconnect();
    await delay(350);

    let reconnected = false;
    let inspectedDevice = null;
    try {
      this.update({ phase: 'identifying', progress: 6, message: 'Identifying the ESP32 bootloader…' });
      if (provisioning) {
        inspectedDevice = await this.inspectProvisioningTarget(board, manifest);
        this.update({
          progress: 9,
          deviceMac: inspectedDevice.mac,
          message: `Verified ${inspectedDevice.chip} · ${Math.round(inspectedDevice.flashBytes / (1024 * 1024))} MB flash.`,
        });
      } else {
        const identity = await this.run(this.resources.esptoolPath, [
          '--chip', 'esp32', '--port', board.path, '--baud', '115200',
          '--before', 'default-reset', '--after', 'hard-reset', '--connect-attempts', '10',
          'chip-id',
        ], { timeoutMs: 30_000 });
        parseEsp32Identity(identity.combined, { requireMac: false });
      }

      const speeds = [...new Set([
        Number(manifest.flash.preferredBaud) || 460800,
        Number(manifest.flash.fallbackBaud) || 115200,
      ])];
      let flashError = null;
      for (let attempt = 0; attempt < speeds.length; attempt += 1) {
        const baud = speeds[attempt];
        this.update({
          phase: 'flashing',
          progress: 10,
          message: attempt ? `Retrying safely at ${baud.toLocaleString()} baud…` : `Installing at ${baud.toLocaleString()} baud…`,
        });
        const args = [
          '--chip', 'esp32', '--port', board.path, '--baud', String(baud),
          '--before', 'default-reset', '--after', 'hard-reset', '--connect-attempts', '10',
          'write-flash', '--flash-mode', manifest.flash.mode, '--flash-freq', manifest.flash.frequency,
          '--flash-size', manifest.flash.size, '--compress', '--skip-flashed',
          ...selectedSegments.flatMap((segment) => [segment.address, segment.filePath]),
        ];
        try {
          await this.run(this.resources.esptoolPath, args, {
            timeoutMs: 240_000,
            onOutput: (text) => {
              const percentage = parseProgress(text);
              if (percentage !== null) {
                this.update({ progress: 10 + Math.round(percentage * 0.82), message: `Writing and verifying firmware… ${percentage}%` });
              }
            },
          });
          flashError = null;
          break;
        } catch (error) {
          flashError = error;
          if (attempt + 1 < speeds.length) await delay(900);
        }
      }
      if (flashError) throw flashError;

      this.update({ phase: 'reconnecting', progress: 94, message: 'Firmware verified. Reconnecting Ember…' });
      await delay(1400);
      let reconnectError = null;
      for (let attempt = 1; attempt <= 6; attempt += 1) {
        try {
          if (typeof this.serial.forceReconnect === 'function') await this.serial.forceReconnect(board.path);
          else await this.serial.connect(board.path);
          this.streamer.requestKeyframe();
          reconnected = true;
          break;
        } catch (error) {
          reconnectError = error;
          if (attempt < 6) {
            this.update({
              progress: 94 + Math.min(4, attempt),
              message: `Firmware verified. Waiting for the ESP32 to reappear… (${attempt}/6)`,
            });
            await delay(Math.min(2_500, 450 * (2 ** (attempt - 1))));
          }
        }
      }
      if (reconnected) {
        this.update({
          running: false,
          phase: 'complete',
          progress: 100,
          message: `Firmware ${manifest.firmwareVersion} installed and display reconnected.`,
          lastSuccessAt: new Date().toISOString(),
          lastError: null,
          deviceMac: inspectedDevice?.mac || this.state.deviceMac || null,
        });
      } else {
        this.update({
          running: false,
          phase: provisioning ? 'verification-pending' : 'installed-disconnected',
          progress: provisioning ? 96 : 100,
          message: provisioning
            ? `Firmware was written, but the new Claude Burner identity could not be verified. Keep the cable connected and retry verification.`
            : `Firmware ${manifest.firmwareVersion} is verified. Reconnect the USB cable to resume the display.`,
          lastSuccessAt: provisioning ? null : new Date().toISOString(),
          lastError: reconnectError?.message || 'Display reconnect is pending.',
        });
      }
      return { ...this.snapshot(), installed: reconnected || !provisioning, connected: reconnected, device: inspectedDevice };
    } catch (error) {
      this.update({
        running: false,
        phase: 'failed',
        progress: 0,
        message: error.message,
        lastError: error.message,
      });
      throw error;
    } finally {
      this.streamer.resume();
      if (!reconnected && this.state.phase === 'failed') {
        const reconnect = typeof this.serial.forceReconnect === 'function'
          ? this.serial.forceReconnect(board.path)
          : this.serial.connect(board.path);
        reconnect.then(() => this.streamer.requestKeyframe()).catch(() => {});
      }
    }
  }
}

module.exports = {
  FirmwareInstaller,
  EXPECTED_STORAGE,
  EXPECTED_SEGMENTS,
  sha256,
  resolveFirmwareResources,
  readAndValidateBundle,
  parseProgress,
  runCommand,
  expectedBoard,
  strictExpectedBoard,
  parseEsp32Identity,
  parseFlashBytes,
  parseSecurityInfo,
  SUPPORTED_USB_BRIDGES,
};
