'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  FirmwareInstaller,
  parseProgress,
  readAndValidateBundle,
  expectedBoard,
  strictExpectedBoard,
  parseEsp32Identity,
  parseFlashBytes,
  parseSecurityInfo,
} = require('../src/firmware-installer');

function digest(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'burner-firmware-'));
  const bundleRoot = path.join(root, 'firmware');
  const binRoot = path.join(root, 'bin');
  fs.mkdirSync(bundleRoot);
  fs.mkdirSync(binRoot);
  const esptoolPath = path.join(binRoot, 'esptool');
  fs.writeFileSync(esptoolPath, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  const segmentMap = [
    ['0x1000', 'bootloader.bin'],
    ['0x8000', 'partitions.bin'],
    ['0xe000', 'boot_app0.bin'],
    ['0x10000', 'firmware.bin'],
  ];
  const segments = segmentMap.map(([address, file], index) => {
    const contents = Buffer.alloc(16 + index, index + 1);
    fs.writeFileSync(path.join(bundleRoot, file), contents);
    return { address, file, bytes: contents.length, sha256: digest(contents) };
  });
  fs.writeFileSync(path.join(bundleRoot, 'manifest.json'), JSON.stringify({
    version: 1,
    product: 'Claude Burner CYD',
    firmwareVersion: '9.9.9',
    targetChip: 'esp32',
    board: 'E32R28T / ESP32-2432S028',
    usb: { vendorId: '1a86', productId: '7523' },
    tool: { name: 'Espressif esptool', version: '5.3.0', sha256: digest(fs.readFileSync(esptoolPath)) },
    flash: {
      preferredBaud: 460800,
      fallbackBaud: 115200,
      mode: 'dio',
      frequency: '40m',
      size: 'detect',
      eraseAll: false,
      preserveLittleFs: true,
      updateSegments: ['0x10000'],
      provisioningSegments: segmentMap.map(([address]) => address),
      storagePartition: {
        label: 'spiffs', subtype: 'spiffs', offset: '0x290000', bytes: 1408 * 1024,
        partitionTableSha256: segments.find((segment) => segment.address === '0x8000').sha256,
      },
      segments,
    },
  }));
  return { root, bundleRoot, esptoolPath };
}

test('firmware progress parser accepts esptool percentage output', () => {
  assert.equal(parseProgress('Writing at 0x00010000... (37 %)'), 37);
  assert.equal(parseProgress('12%\nthen 99%'), 99);
  assert.equal(parseProgress('Connecting...'), null);
});

test('firmware bundle validation pins identity, layout, byte sizes, and SHA-256', () => {
  const files = fixture();
  const result = readAndValidateBundle(files.bundleRoot);
  assert.equal(result.manifest.firmwareVersion, '9.9.9');
  assert.deepEqual(result.segments.map((segment) => segment.address), ['0x1000', '0x8000', '0xe000', '0x10000']);
  fs.appendFileSync(path.join(files.bundleRoot, 'firmware.bin'), 'tamper');
  assert.throws(() => readAndValidateBundle(files.bundleRoot), /integrity check/);
});

test('board selection accepts the CYD CH340 identity and rejects unrelated serial ports', () => {
  const manifest = { usb: { vendorId: '1a86', productId: '7523' } };
  assert.equal(expectedBoard({ path: '/dev/tty.usbserial-10', vendorId: '1a86', productId: '7523' }, manifest), true);
  assert.equal(expectedBoard({ path: '/dev/cu.SLAB_USBtoUART', vendorId: '10c4', productId: 'ea60' }, manifest), true);
  assert.equal(expectedBoard({ path: '/dev/cu.usbserial-10' }, manifest), true, 'missing macOS VID/PID still gets an explicit-confirmation path');
  assert.equal(expectedBoard({ path: '/dev/tty.usbserial-wrong', vendorId: '10c4', productId: 'ea60' }, manifest), false);
  assert.equal(expectedBoard({ path: '/dev/tty.Bluetooth-Incoming-Port' }, manifest), false);
  assert.equal(strictExpectedBoard({ path: '/dev/tty.usbserial-10', vendorId: '1A86', productId: '7523' }, manifest), true);
  assert.equal(strictExpectedBoard({ path: '/dev/tty.usbserial-10' }, manifest), false);
});

test('provisioning identity parsers pin MAC, flash capacity, and protected-chip state', () => {
  assert.deepEqual(parseEsp32Identity('Chip type: ESP32-D0WD-V3 (revision v3.1)\nMAC: b4:bf:e9:c9:a1:0c'), {
    chip: 'ESP32-D0WD-V3 (revision v3.1)', mac: 'b4:bf:e9:c9:a1:0c',
  });
  assert.equal(parseFlashBytes('Detected flash size: 4MB'), 4 * 1024 * 1024);
  assert.equal(parseSecurityInfo('Secure Boot: Enabled\nFlash Encryption: Disabled').secureBootEnabled, true);
  assert.equal(parseSecurityInfo('A fatal error occurred: Command not implemented').available, false);
});

test('in-app firmware install releases serial, identifies ESP32, retries safely, and reconnects', async () => {
  const files = fixture();
  const calls = [];
  const serialCalls = [];
  const streamCalls = [];
  let writeAttempts = 0;
  const installer = new FirmwareInstaller({
    serial: {
      path: '/dev/cu.usbserial-test',
      disconnect: async () => serialCalls.push('disconnect'),
      connect: async (devicePath) => serialCalls.push(`connect:${devicePath}`),
    },
    streamer: {
      pause: async () => streamCalls.push('pause'),
      resume: () => streamCalls.push('resume'),
      requestKeyframe: () => streamCalls.push('keyframe'),
    },
    resources: files,
    listCandidates: async () => [{ path: '/dev/cu.usbserial-test', vendorId: '1a86', productId: '7523' }],
    runCommand: async (_binary, args, options = {}) => {
      calls.push(args);
      if (args.includes('chip-id')) return { combined: 'Chip type: ESP32-D0WD-V3' };
      writeAttempts += 1;
      options.onOutput?.('Writing at 0x00010000... (73 %)');
      if (writeAttempts === 1) throw new Error('Lost one high-speed packet');
      return { combined: 'Hash of data verified.' };
    },
  });

  const result = await installer.flash('/dev/cu.usbserial-test');
  assert.equal(result.phase, 'complete');
  assert.equal(result.progress, 100);
  assert.equal(writeAttempts, 2);
  assert.deepEqual(serialCalls, ['disconnect', 'connect:/dev/cu.usbserial-test']);
  assert.deepEqual(streamCalls, ['pause', 'keyframe', 'resume']);
  assert.ok(calls[1].includes('--skip-flashed'));
  assert.ok(calls[1].includes('460800'));
  assert.ok(calls[2].includes('115200'));
  assert.ok(calls[1].includes('0x10000'));
  assert.equal(calls[1].includes('0x8000'), false);
});

test('firmware install never falls through from a stale selected port to another board', async () => {
  const files = fixture();
  const installer = new FirmwareInstaller({
    serial: { path: null },
    streamer: { pause: async () => {}, resume: () => {} },
    resources: files,
    listCandidates: async () => [{ path: '/dev/cu.usbserial-other', vendorId: '1a86', productId: '7523' }],
    runCommand: async () => { throw new Error('must not run'); },
  });
  await assert.rejects(installer.flash('/dev/cu.usbserial-missing'), /no longer available/);
});

test('first-connect provisioning inspects the exact CYD then writes all four bundled segments', async () => {
  const files = fixture();
  const calls = [];
  const installer = new FirmwareInstaller({
    serial: {
      path: null,
      disconnect: async () => {},
      connect: async () => {},
    },
    streamer: { pause: async () => {}, resume: () => {}, requestKeyframe: () => {} },
    resources: files,
    listCandidates: async () => [{ path: '/dev/cu.usbserial-new', vendorId: '1a86', productId: '7523' }],
    runCommand: async (_binary, args) => {
      calls.push(args);
      if (args.includes('chip-id') || args.includes('read-mac')) {
        return { combined: 'Chip type: ESP32-D0WD-V3 (revision v3.1)\nMAC: b4:bf:e9:c9:a1:0c' };
      }
      if (args.includes('flash-id')) return { combined: 'Detected flash size: 4MB' };
      if (args.includes('get-security-info')) throw new Error('Command not implemented');
      return { combined: 'Hash of data verified.' };
    },
  });
  const result = await installer.flash('/dev/cu.usbserial-new', {
    provision: true,
    confirmedBoardFamily: 'ESP32-2432S028',
  });
  assert.equal(result.installed, true);
  assert.equal(result.device.mac, 'b4:bf:e9:c9:a1:0c');
  const write = calls.find((args) => args.includes('write-flash'));
  assert.ok(write);
  for (const address of ['0x1000', '0x8000', '0xe000', '0x10000']) assert.ok(write.includes(address));
});

test('first-connect provisioning inspects metadata-poor USB paths and refuses wrong or protected chips', async () => {
  const files = fixture();
  const regexOnly = new FirmwareInstaller({
    serial: { path: null },
    streamer: { pause: async () => {}, resume: () => {} },
    resources: files,
    listCandidates: async () => [{ path: '/dev/cu.usbserial-new' }],
    runCommand: async (_binary, args) => {
      if (args.includes('chip-id')) return { combined: 'Chip type: RP2040' };
      throw new Error('must not write');
    },
  });
  await assert.rejects(regexOnly.flash('/dev/cu.usbserial-new', {
    provision: true, confirmedBoardFamily: 'ESP32-2432S028',
  }), /did not identify as an ESP32/);

  const protectedBoard = new FirmwareInstaller({
    serial: { path: null, disconnect: async () => {}, connect: async () => {} },
    streamer: { pause: async () => {}, resume: () => {}, requestKeyframe: () => {} },
    resources: files,
    listCandidates: async () => [{ path: '/dev/cu.usbserial-protected', vendorId: '1a86', productId: '7523' }],
    runCommand: async (_binary, args) => {
      if (args.includes('chip-id') || args.includes('read-mac')) return { combined: 'Chip type: ESP32-D0WD-V3\nMAC: b4:bf:e9:c9:a1:0c' };
      if (args.includes('flash-id')) return { combined: 'Detected flash size: 4MB' };
      if (args.includes('get-security-info')) return { combined: 'Secure Boot: Enabled\nFlash Encryption: Disabled' };
      throw new Error('write must not run');
    },
  });
  await assert.rejects(protectedBoard.flash('/dev/cu.usbserial-protected', {
    provision: true, confirmedBoardFamily: 'ESP32-2432S028',
  }), /Secure Boot or Flash Encryption/);
});
