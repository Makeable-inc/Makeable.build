#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const appRoot = path.resolve(__dirname, '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(appRoot, 'package.json'), 'utf8'));
const productName = packageJson.build.productName;
const artifactName = `${productName}-${packageJson.version}-arm64.dmg`;
const sourceApp = path.join(appRoot, 'dist', 'mac-arm64', `${productName}.app`);
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-burner-package-'));
const signedApp = path.join(temporaryRoot, `${productName}.app`);
const temporaryOutput = path.join(temporaryRoot, 'dmg');
const mountPoint = path.join(temporaryRoot, 'mounted');
const builder = path.join(appRoot, 'node_modules', '.bin', 'electron-builder');
let mounted = false;

function run(file, args, options = {}) {
  return execFileSync(file, args, {
    cwd: appRoot,
    encoding: 'utf8',
    stdio: options.capture ? 'pipe' : 'inherit',
    env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' },
  });
}

try {
  if (!fs.existsSync(sourceApp)) throw new Error(`Packaged app is missing: ${sourceApp}`);
  fs.mkdirSync(temporaryOutput, { recursive: true });
  fs.mkdirSync(mountPoint, { recursive: true });

  // Documents may be managed by macOS File Provider, which attaches Finder
  // metadata to app/framework directories. Copy outside that domain so the
  // prototype can receive a coherent local ad-hoc seal before DMG creation.
  run('/usr/bin/ditto', ['--norsrc', '--noextattr', sourceApp, signedApp]);
  run('/usr/bin/xattr', ['-cr', signedApp]);
  run('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', signedApp]);
  run('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=2', signedApp]);

  run(builder, [
    '--mac',
    'dmg',
    '--arm64',
    '--prepackaged',
    signedApp,
    `--config.directories.output=${temporaryOutput}`,
  ]);

  const temporaryDmg = path.join(temporaryOutput, artifactName);
  const temporaryBlockmap = `${temporaryDmg}.blockmap`;
  if (!fs.existsSync(temporaryDmg)) throw new Error(`DMG was not created: ${temporaryDmg}`);
  run('/usr/bin/hdiutil', ['verify', temporaryDmg]);
  run('/usr/bin/hdiutil', [
    'attach',
    temporaryDmg,
    '-readonly',
    '-nobrowse',
    '-mountpoint',
    mountPoint,
  ]);
  mounted = true;
  run('/usr/bin/codesign', [
    '--verify',
    '--deep',
    '--strict',
    '--verbose=2',
    path.join(mountPoint, `${productName}.app`),
  ]);
  run('/usr/bin/hdiutil', ['detach', mountPoint, '-quiet']);
  mounted = false;

  fs.copyFileSync(temporaryDmg, path.join(appRoot, 'dist', artifactName));
  if (fs.existsSync(temporaryBlockmap)) {
    fs.copyFileSync(temporaryBlockmap, path.join(appRoot, 'dist', `${artifactName}.blockmap`));
  }
  process.stdout.write(`Built and verified ad-hoc-sealed prototype DMG: dist/${artifactName}\n`);
} finally {
  if (mounted) {
    try {
      run('/usr/bin/hdiutil', ['detach', mountPoint, '-quiet']);
    } catch {
      // The temporary mount will be cleaned by the OS if detach is unavailable.
    }
  }
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}
