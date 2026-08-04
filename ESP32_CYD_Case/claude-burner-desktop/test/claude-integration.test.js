'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  compareVersions,
  parseVersion,
  installStatusLine,
  uninstallStatusLine,
  resolveBridgePaths,
  shellQuote,
} = require('../src/claude-integration');

test('Claude version parsing enforces 2.1.80 accurately', () => {
  assert.deepEqual(parseVersion('2.1.150 (Claude Code)'), [2, 1, 150]);
  assert.equal(compareVersions([2, 1, 80], [2, 1, 80]), 0);
  assert.equal(compareVersions([2, 1, 79], [2, 1, 80]), -1);
  assert.equal(compareVersions([2, 2, 0], [2, 1, 80]), 1);
});

test('status-line install is reversible and preserves the prior command', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-burner-test-'));
  const home = path.join(temporary, 'home');
  const userDataPath = path.join(temporary, 'appdata');
  const sourceBinaryPath = path.join(temporary, 'bridge');
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  fs.writeFileSync(sourceBinaryPath, '#!/bin/sh\n');
  fs.writeFileSync(path.join(home, '.claude', 'settings.json'), JSON.stringify({
    theme: 'dark',
    statusLine: { type: 'command', command: '/usr/local/bin/old-status', padding: 2 },
  }));

  const installed = installStatusLine({ sourceBinaryPath, userDataPath, plan: 'pro', home });
  const settings = JSON.parse(fs.readFileSync(path.join(home, '.claude', 'settings.json')));
  assert.equal(settings.theme, 'dark');
  assert.equal(settings.statusLine.command, shellQuote(resolveBridgePaths(userDataPath).installedBinaryPath));
  assert.equal(settings.statusLine.refreshInterval, 5);
  assert.equal(installed.chainedPreviousStatusLine, true);

  uninstallStatusLine({ userDataPath, home });
  const restored = JSON.parse(fs.readFileSync(path.join(home, '.claude', 'settings.json')));
  assert.deepEqual(restored.statusLine, { type: 'command', command: '/usr/local/bin/old-status', padding: 2 });
});
