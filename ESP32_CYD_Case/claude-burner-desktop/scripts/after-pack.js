'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

function architectureList(file) {
  return execFileSync('/usr/bin/lipo', ['-archs', file], { encoding: 'utf8' })
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function keepOnlyArm64(file) {
  if (!fs.existsSync(file)) throw new Error(`Required native runtime is missing: ${file}`);
  const architectures = architectureList(file);
  if (!architectures.includes('arm64')) {
    throw new Error(`Native runtime has no arm64 slice: ${file} (${architectures.join(', ')})`);
  }
  if (architectures.length === 1) return;

  const temporary = `${file}.arm64`;
  const mode = fs.statSync(file).mode;
  execFileSync('/usr/bin/lipo', [file, '-thin', 'arm64', '-output', temporary]);
  fs.chmodSync(temporary, mode);
  fs.renameSync(temporary, file);
}

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  const unpacked = path.join(app, 'Contents', 'Resources', 'app.asar.unpacked', 'node_modules');
  keepOnlyArm64(path.join(
    unpacked,
    '@serialport',
    'bindings-cpp',
    'build',
    'Release',
    'bindings.node',
  ));
  keepOnlyArm64(path.join(unpacked, 'node-pty', 'build', 'Release', 'pty.node'));
  keepOnlyArm64(path.join(unpacked, 'node-pty', 'build', 'Release', 'spawn-helper'));
  const esptool = path.join(app, 'Contents', 'Resources', 'bin', 'esptool');
  keepOnlyArm64(esptool);
  fs.chmodSync(esptool, 0o755);
};
