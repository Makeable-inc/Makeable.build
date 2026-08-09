'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const projectRoot = path.resolve(__dirname, '..');
const firmwareRoot = path.resolve(projectRoot, '..', 'firmware', 'claude-burner-cyd');

function resolvePlatformIo() {
  const candidates = [
    process.env.PLATFORMIO_CLI,
    path.join(os.homedir(), '.platformio', 'penv', 'bin', 'pio'),
    '/opt/homebrew/bin/pio',
    '/usr/local/bin/pio',
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch { /* try the next known installation */ }
  }
  throw new Error('PlatformIO Core was not found. Install PlatformIO or set PLATFORMIO_CLI to its executable.');
}

function main() {
  const result = spawnSync(resolvePlatformIo(), [
    'run', '--project-dir', firmwareRoot, '--environment', 'cyd-esp32',
  ], { cwd: projectRoot, stdio: 'inherit', shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}

if (require.main === module) main();

module.exports = { main, resolvePlatformIo };
