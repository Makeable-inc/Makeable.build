'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const appRoot = path.resolve(__dirname, '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(appRoot, 'package.json'), 'utf8'));

test('prototype release is arm64-only and intentionally unsigned', () => {
  assert.equal(packageJson.version, '1.3.0');
  assert.equal(packageJson.build.mac.identity, null);
  assert.deepEqual(packageJson.build.mac.target, [{ target: 'dmg', arch: ['arm64'] }]);
  assert.match(packageJson.scripts['dist:mac'], /--arm64/);
  assert.match(packageJson.scripts['dist:mac'], /package-prototype-dmg\.js/);
  assert.equal(packageJson.build.afterPack, 'scripts/after-pack.js');
  assert.deepEqual(packageJson.build.asarUnpack, [
    'node_modules/@serialport/bindings-cpp/build/Release/bindings.node',
    'node_modules/node-pty/build/Release/pty.node',
    'node_modules/node-pty/build/Release/spawn-helper',
  ]);
  for (const target of ['firmware', 'bin/esptool', 'licenses/ESPTOOL-GPL-2.0.txt']) {
    assert.ok(packageJson.build.extraResources.some((resource) => resource.to === target), `missing ${target}`);
  }
});

test('prototype DMG receives a coherent local ad-hoc seal before packaging', () => {
  const packager = fs.readFileSync(
    path.join(appRoot, 'scripts', 'package-prototype-dmg.js'),
    'utf8',
  );
  assert.match(packager, /--noextattr/);
  assert.match(packager, /'--deep', '--sign', '-'/);
  assert.match(packager, /'--verify', '--deep', '--strict'/);
  assert.match(packager, /'--prepackaged'/);
  assert.match(packager, /hdiutil/);
});

test('prepack validates production animations without regenerating source art', () => {
  assert.match(packageJson.scripts.prepack, /build:firmware/);
  assert.match(packageJson.scripts.prepack, /build:firmware-bundle/);
  assert.match(packageJson.scripts.prepack, /validate:release-assets/);
  assert.doesNotMatch(packageJson.scripts.prepack, /build:assets/);
});

test('packaged firmware installer has matching renderer, preload, and IPC surfaces', () => {
  const preload = fs.readFileSync(path.join(appRoot, 'src', 'preload.js'), 'utf8');
  const renderer = fs.readFileSync(path.join(appRoot, 'ui', 'renderer.js'), 'utf8');
  const main = fs.readFileSync(path.join(appRoot, 'src', 'main.js'), 'utf8');
  assert.match(preload, /scanFirmwareDevice:[\s\S]*burner:firmware-scan/);
  assert.match(preload, /installFirmware:[\s\S]*burner:firmware-install/);
  assert.match(renderer, /scanFirmwareDevice\(\)/);
  assert.match(renderer, /installFirmware\(\{ confirmed: true, port, provision: false \}\)/);
  assert.doesNotMatch(renderer, /\.flashFirmware\(/);
  assert.match(main, /selection\.confirmed !== true/);
  assert.match(preload, /authorizeFirstConnect:[\s\S]*burner:first-connect-authorize/);
  assert.match(renderer, /authorizeFirstConnect\(\{[\s\S]*confirmed: true[\s\S]*ESP32-2432S028/);
  assert.match(main, /selection\.boardFamily !== 'ESP32-2432S028'/);
  assert.match(main, /provision: true,[\s\S]*confirmedBoardFamily: 'ESP32-2432S028'/);
});

test('afterPack preserves an executable arm64 Espressif tool inside the app', () => {
  const afterPack = fs.readFileSync(path.join(appRoot, 'scripts', 'after-pack.js'), 'utf8');
  assert.match(afterPack, /Resources', 'bin', 'esptool/);
  assert.match(afterPack, /chmodSync\(esptool, 0o755\)/);
});

test('the canonical asset build publishes the 15-state v2 library', () => {
  assert.match(packageJson.scripts['build:assets'], /build-approved-emotion-library\.py/);
  assert.match(packageJson.scripts['build:assets'], /publish-approved-emotion-library\.js/);
  assert.match(packageJson.scripts['build:assets:character-only-legacy'], /build-character-only-library\.py --publish-assets/);
  assert.doesNotMatch(packageJson.scripts['build:assets'], /build-animation-pack\.py/);
  assert.match(packageJson.scripts['build:assets:legacy'], /build-animation-pack\.py/);
});

test('DMG allowlist excludes development and duplicate animation libraries', () => {
  const files = packageJson.build.files;
  assert.ok(files.includes('assets/animation-pack.json'));
  for (const pattern of [
    'assets/gifs/small_*.gif',
    'assets/gifs/medium_*.gif',
    'assets/gifs/large_*.gif',
    'assets/scenes/small_*.png',
    'assets/scenes/medium_*.png',
    'assets/scenes/large_*.png',
  ]) {
    assert.ok(files.includes(pattern), `missing runtime allowlist pattern: ${pattern}`);
  }
  assert.ok(!files.includes('assets/**/*'));
  assert.ok(!files.some((pattern) => pattern.startsWith('assets/animations/')));
  assert.ok(!files.some((pattern) => pattern.startsWith('assets/previews/')));
  assert.ok(!files.includes('assets/gifs/no_connection.gif'));
  assert.ok(!files.includes('assets/gifs/waiting_for_claude.gif'));
  assert.ok(!files.includes('assets/scenes/no_connection.png'));
  assert.ok(!files.includes('assets/scenes/waiting_for_claude.png'));
  assert.ok(files.includes('!node_modules/@serialport/bindings-cpp/prebuilds/**'));
  assert.ok(files.includes('!node_modules/node-pty/prebuilds/**'));
  assert.ok(files.includes('!ui/frames/**/*'));
  assert.ok(files.includes('!ui/redesign/**/*'));
});
