'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const firmwareRoot = path.resolve(projectRoot, '..', 'firmware', 'claude-burner-cyd');
const buildRoot = path.join(firmwareRoot, '.pio', 'build', 'cyd-esp32');
const outputRoot = path.join(projectRoot, 'build', 'firmware');
const packageJson = require(path.join(projectRoot, 'package.json'));
const esptoolPath = path.join(projectRoot, 'build', 'bin', 'esptool');

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function requireFile(filePath, label) {
  const stat = fs.statSync(filePath, { throwIfNoEntry: false });
  if (!stat?.isFile() || stat.size <= 0) {
    throw new Error(`${label} is missing. Build the firmware with PlatformIO before packaging.`);
  }
  return filePath;
}

function findBootApp0() {
  const packagesRoot = path.join(os.homedir(), '.platformio', 'packages');
  const exact = path.join(packagesRoot, 'framework-arduinoespressif32', 'tools', 'partitions', 'boot_app0.bin');
  if (fs.statSync(exact, { throwIfNoEntry: false })?.isFile()) return exact;
  const candidates = fs.readdirSync(packagesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('framework-arduinoespressif32'))
    .map((entry) => path.join(packagesRoot, entry.name, 'tools', 'partitions', 'boot_app0.bin'))
    .filter((candidate) => fs.statSync(candidate, { throwIfNoEntry: false })?.isFile());
  if (!candidates.length) throw new Error('PlatformIO boot_app0.bin is missing.');
  return candidates.sort().at(-1);
}

function copySegment(address, sourcePath, fileName) {
  const targetPath = path.join(outputRoot, fileName);
  fs.copyFileSync(sourcePath, targetPath);
  fs.chmodSync(targetPath, 0o644);
  return {
    address,
    file: fileName,
    bytes: fs.statSync(targetPath).size,
    sha256: sha256(targetPath),
  };
}

function main() {
  fs.rmSync(outputRoot, { recursive: true, force: true });
  fs.mkdirSync(outputRoot, { recursive: true, mode: 0o755 });

  const segments = [
    copySegment('0x1000', requireFile(path.join(buildRoot, 'bootloader.bin'), 'bootloader.bin'), 'bootloader.bin'),
    copySegment('0x8000', requireFile(path.join(buildRoot, 'partitions.bin'), 'partitions.bin'), 'partitions.bin'),
    copySegment('0xe000', requireFile(findBootApp0(), 'boot_app0.bin'), 'boot_app0.bin'),
    copySegment('0x10000', requireFile(path.join(buildRoot, 'firmware.bin'), 'firmware.bin'), 'firmware.bin'),
  ];

  const manifest = {
    version: 1,
    product: 'Claude Burner CYD',
    firmwareVersion: packageJson.version,
    targetChip: 'esp32',
    board: 'E32R28T / ESP32-2432S028',
    usb: { vendorId: '1a86', productId: '7523' },
    tool: {
      name: 'Espressif esptool',
      version: '5.3.0',
      sha256: sha256(requireFile(esptoolPath, 'bundled esptool')),
    },
    flash: {
      preferredBaud: 460800,
      fallbackBaud: 115200,
      mode: 'dio',
      frequency: '40m',
      size: 'detect',
      eraseAll: false,
      preserveLittleFs: true,
      updateSegments: ['0x10000'],
      provisioningSegments: segments.map((segment) => segment.address),
      storagePartition: {
        label: 'spiffs',
        subtype: 'spiffs',
        offset: '0x290000',
        bytes: 1408 * 1024,
        partitionTableSha256: segments.find((segment) => segment.address === '0x8000').sha256,
      },
      segments,
    },
  };
  fs.writeFileSync(path.join(outputRoot, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o644 });
  process.stdout.write(`Firmware bundle ${manifest.firmwareVersion}: ${segments.length} verified segments in ${outputRoot}\n`);
}

if (require.main === module) main();

module.exports = { main, sha256, findBootApp0 };
