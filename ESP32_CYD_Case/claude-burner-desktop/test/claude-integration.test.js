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
  resolvePlanForInstall,
  resolveClaudeBinary,
  detectClaude,
  readUsageSnapshot,
  persistUsageSnapshot,
  LAST_KNOWN_USAGE_MAX_AGE_MS,
  MIN_CLAUDE_SAFE_MODE_VERSION,
} = require('../src/claude-integration');

test('Claude version parsing enforces 2.1.80 accurately', () => {
  assert.deepEqual(parseVersion('2.1.150 (Claude Code)'), [2, 1, 150]);
  assert.equal(compareVersions([2, 1, 80], [2, 1, 80]), 0);
  assert.equal(compareVersions([2, 1, 79], [2, 1, 80]), -1);
  assert.equal(compareVersions([2, 2, 0], [2, 1, 80]), 1);
  assert.deepEqual(MIN_CLAUDE_SAFE_MODE_VERSION, [2, 1, 169]);
  assert.equal(compareVersions([2, 1, 168], MIN_CLAUDE_SAFE_MODE_VERSION), -1);
  assert.equal(compareVersions([2, 1, 169], MIN_CLAUDE_SAFE_MODE_VERSION), 0);
});

test('Claude discovery orders NVM installations by semantic Node version', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-burner-home-'));
  const older = path.join(home, '.nvm', 'versions', 'node', 'v9.11.2', 'bin', 'claude');
  const newer = path.join(home, '.nvm', 'versions', 'node', 'v20.19.4', 'bin', 'claude');
  fs.mkdirSync(path.dirname(older), { recursive: true });
  fs.mkdirSync(path.dirname(newer), { recursive: true });
  fs.writeFileSync(older, '#!/bin/sh\n');
  fs.writeFileSync(newer, '#!/bin/sh\n');
  fs.chmodSync(older, 0o755);
  fs.chmodSync(newer, 0o755);
  assert.equal(resolveClaudeBinary(home), newer);
});

test('Claude discovery retries through an atomic CLI update race', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-burner-home-'));
  const binary = path.join(home, '.local', 'bin', 'claude');
  fs.mkdirSync(path.dirname(binary), { recursive: true });
  fs.writeFileSync(binary, '#!/bin/sh\n');
  fs.chmodSync(binary, 0o755);
  let versionAttempts = 0;
  const runner = async (_binary, args) => {
    if (args[0] === '--version') {
      versionAttempts += 1;
      if (versionAttempts < 3) throw new Error('binary temporarily replaced');
      return { stdout: '2.1.225 (Claude Code)\n', stderr: '' };
    }
    return {
      stdout: JSON.stringify({ loggedIn: true, subscriptionType: 'max' }),
      stderr: '',
    };
  };
  const detected = await detectClaude({ home, runner, retryDelaysMs: [0, 0, 0] });
  assert.equal(versionAttempts, 3);
  assert.equal(detected.installed, true);
  assert.equal(detected.loggedIn, true);
  assert.equal(detected.plan, 'max');
  assert.equal(detected.authState, 'subscription');
});

test('Claude discovery treats signed-out exit 1 JSON as an actionable auth state', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-burner-home-'));
  const binary = path.join(home, '.local', 'bin', 'claude');
  fs.mkdirSync(path.dirname(binary), { recursive: true });
  fs.writeFileSync(binary, '#!/bin/sh\n');
  fs.chmodSync(binary, 0o755);
  const runner = async (_binary, args) => {
    if (args[0] === '--version') return { stdout: '2.1.226 (Claude Code)\n', stderr: '' };
    const error = new Error('Command failed with exit code 1');
    error.stdout = JSON.stringify({ loggedIn: false, authMethod: 'none', apiProvider: 'firstParty' });
    throw error;
  };
  const detected = await detectClaude({ home, runner, retryDelaysMs: [0] });
  assert.equal(detected.installed, true);
  assert.equal(detected.loggedIn, false);
  assert.equal(detected.authState, 'signed-out');
  assert.equal(detected.apiProvider, 'firstParty');
});

test('Claude auth metadata distinguishes a non-subscription credential source', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-burner-home-'));
  const binary = path.join(home, '.local', 'bin', 'claude');
  fs.mkdirSync(path.dirname(binary), { recursive: true });
  fs.writeFileSync(binary, '#!/bin/sh\n');
  fs.chmodSync(binary, 0o755);
  const runner = async (_binary, args) => args[0] === '--version'
    ? { stdout: '2.1.226 (Claude Code)\n', stderr: '' }
    : { stdout: JSON.stringify({ loggedIn: true, authMethod: 'apiKey', apiProvider: 'firstParty' }), stderr: '' };
  const detected = await detectClaude({ home, runner, retryDelaysMs: [0] });
  assert.equal(detected.loggedIn, true);
  assert.equal(detected.subscriptionAuth, false);
  assert.equal(detected.authState, 'authenticated');
});

test('a confirmed Max 20x choice survives stale Pro plan detection', () => {
  assert.equal(resolvePlanForInstall('pro', 'max20', null), 'max20');
  assert.equal(resolvePlanForInstall('max', 'free', 20), 'max20');
  assert.equal(resolvePlanForInstall('max', 'free', 5), 'max5');
  assert.equal(resolvePlanForInstall('pro', 'free', null), 'pro');
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
  const config = JSON.parse(fs.readFileSync(resolveBridgePaths(userDataPath).configPath));
  assert.equal(config.version, 2);
  assert.equal(config.snapshotDirectory, resolveBridgePaths(userDataPath).snapshotDirectory);

  uninstallStatusLine({ userDataPath, home });
  const restored = JSON.parse(fs.readFileSync(path.join(home, '.claude', 'settings.json')));
  assert.deepEqual(restored.statusLine, { type: 'command', command: '/usr/local/bin/old-status', padding: 2 });
});

function writeSnapshot(directory, name, value) {
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, `${name}.json`), JSON.stringify(value));
}

test('usage aggregation rejects a freshly-written snapshot from an expired window', () => {
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-burner-usage-'));
  const now = Date.parse('2026-08-04T21:00:00.000Z');
  const { snapshotPath } = resolveBridgePaths(userDataPath);
  fs.writeFileSync(snapshotPath, JSON.stringify({
    sessionId: 'old-terminal', plan: 'max20', fiveHourUsedPct: 0,
    resetsAt: new Date(now - 2 * 60 * 60 * 1000).toISOString(),
    capturedAt: new Date(now - 1000).toISOString(), stale: false,
  }));
  const result = readUsageSnapshot(userDataPath, 30_000, now);
  assert.equal(result.stale, true);
  assert.equal(result.staleReason, 'expired-window');
});

test('usage aggregation rejects reset windows beyond the five-hour horizon', () => {
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-burner-usage-'));
  const now = Date.parse('2026-08-04T21:00:00.000Z');
  const { snapshotPath } = resolveBridgePaths(userDataPath);
  fs.writeFileSync(snapshotPath, JSON.stringify({
    sessionId: 'phantom-future',
    fiveHourUsedPct: 5,
    resetsAt: new Date(now + 23 * 60 * 60 * 1000).toISOString(),
    capturedAt: new Date(now - 1000).toISOString(),
    stale: false,
  }));
  const result = readUsageSnapshot(userDataPath, 30_000, now);
  assert.equal(result.stale, true);
  assert.equal(result.staleReason, 'future-reset');
});

test('usage aggregation skips corrupt files and prunes old session snapshots', () => {
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-burner-usage-'));
  const now = Date.parse('2026-08-04T21:00:00.000Z');
  const { snapshotPath, snapshotDirectory } = resolveBridgePaths(userDataPath);
  fs.writeFileSync(snapshotPath, '{interrupted');
  for (let index = 0; index < 70; index += 1) {
    writeSnapshot(snapshotDirectory, `session-${String(index).padStart(2, '0')}`, {
      source: 'statusline',
      sessionId: `session-${index}`,
      fiveHourUsedPct: index % 10,
      resetsAt: new Date(now + 4 * 60 * 60 * 1000).toISOString(),
      capturedAt: new Date(now - 1000).toISOString(),
      stale: false,
    });
    const sourceFile = path.join(snapshotDirectory, `session-${String(index).padStart(2, '0')}.json`);
    const stamp = new Date(now - index * 1000);
    fs.utimesSync(sourceFile, stamp, stamp);
  }
  const result = readUsageSnapshot(userDataPath, 30_000, now);
  assert.equal(result.stale, false);
  assert.ok(fs.readdirSync(snapshotDirectory).length <= 64);
});

test('usage aggregation merges sessions by newest reset window then highest usage', () => {
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-burner-usage-'));
  const now = Date.parse('2026-08-04T21:00:00.000Z');
  const { snapshotDirectory } = resolveBridgePaths(userDataPath);
  const common = { plan: 'max20', stale: false, capturedAt: new Date(now - 1000).toISOString() };
  writeSnapshot(snapshotDirectory, 'session-a', {
    ...common, sessionId: 'session-a', fiveHourUsedPct: 5,
    resetsAt: new Date(now + 2 * 60 * 60 * 1000).toISOString(),
  });
  writeSnapshot(snapshotDirectory, 'session-b', {
    ...common, sessionId: 'session-b', fiveHourUsedPct: 8,
    resetsAt: new Date(now + 2 * 60 * 60 * 1000).toISOString(),
  });
  writeSnapshot(snapshotDirectory, 'new-window', {
    ...common, sessionId: 'new-window', fiveHourUsedPct: 2,
    resetsAt: new Date(now + 5 * 60 * 60 * 1000).toISOString(),
  });
  const newest = readUsageSnapshot(userDataPath, 30_000, now);
  assert.equal(newest.sessionId, 'new-window');
  assert.equal(newest.fiveHourUsedPct, 2);
  assert.equal(newest.validSources, 3);

  fs.rmSync(path.join(snapshotDirectory, 'new-window.json'));
  const highest = readUsageSnapshot(userDataPath, 30_000, now);
  assert.equal(highest.sessionId, 'session-b');
  assert.equal(highest.fiveHourUsedPct, 8);
});

test('active usage probe and exact statusline epochs merge as one reset window', () => {
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-burner-usage-'));
  const now = Date.parse('2026-08-04T21:00:00.000Z');
  const { snapshotDirectory } = resolveBridgePaths(userDataPath);
  writeSnapshot(snapshotDirectory, 'statusline', {
    source: 'statusline', sessionId: 'statusline', plan: 'max20', stale: false,
    fiveHourUsedPct: 3, resetsAt: new Date(now + 4 * 60 * 60 * 1000 + 43_000).toISOString(),
    capturedAt: new Date(now - 1000).toISOString(),
  });
  const active = {
    source: 'usage-command', sessionId: 'active-usage-probe', stale: false,
    fiveHourUsedPct: 5, resetsAt: new Date(now + 4 * 60 * 60 * 1000).toISOString(),
    capturedAt: new Date(now - 2000).toISOString(), validForMs: 150_000,
  };
  const result = readUsageSnapshot(userDataPath, 30_000, now, [active]);
  assert.equal(result.source, 'usage-command');
  assert.equal(result.fiveHourUsedPct, 5);
  assert.equal(result.resetsAt, new Date(now + 4 * 60 * 60 * 1000 + 43_000).toISOString());
});

test('a valid same-window reading remains a degraded lower bound until reset', () => {
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-burner-usage-'));
  const now = Date.parse('2026-08-04T21:00:00.000Z');
  persistUsageSnapshot(userDataPath, {
    fiveHourUsedPct: 5,
    resetsAt: new Date(now + 2 * 60 * 60 * 1000).toISOString(),
    capturedAt: new Date(now - 45 * 60 * 1000).toISOString(),
  });
  const result = readUsageSnapshot(userDataPath, 180_000, now);
  assert.equal(result.stale, false);
  assert.equal(result.degraded, true);
  assert.equal(result.confidence, 'last-known');
  assert.equal(result.fiveHourUsedPct, 5);
  assert.ok(result.ageMs >= 45 * 60 * 1000);
  assert.equal(LAST_KNOWN_USAGE_MAX_AGE_MS, (5 * 60 + 15) * 60 * 1000);
});

test('last-known usage can outlive one hour but never survives its reset window', () => {
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-burner-usage-'));
  const now = Date.parse('2026-08-04T21:00:00.000Z');
  persistUsageSnapshot(userDataPath, {
    fiveHourUsedPct: 5,
    resetsAt: new Date(now + 2 * 60 * 60 * 1000).toISOString(),
    capturedAt: new Date(now - 61 * 60 * 1000).toISOString(),
  });
  const stillValid = readUsageSnapshot(userDataPath, 180_000, now);
  assert.equal(stillValid.stale, false);
  assert.equal(stillValid.degraded, true);
  assert.equal(stillValid.fiveHourUsedPct, 5);

  const expiredUserDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-burner-usage-'));
  persistUsageSnapshot(expiredUserDataPath, {
    fiveHourUsedPct: 6,
    resetsAt: new Date(now - 2 * 60 * 1000).toISOString(),
    capturedAt: new Date(now - 10 * 60 * 1000).toISOString(),
  });
  const expired = readUsageSnapshot(expiredUserDataPath, 180_000, now);
  assert.equal(expired.stale, true);
  assert.equal(expired.staleReason, 'expired-window');
});

test('active usage persistence is atomic and monotonic within one reset window', () => {
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-burner-usage-'));
  const now = Date.parse('2026-08-04T21:00:00.000Z');
  const reset = new Date(now + 2 * 60 * 60 * 1000).toISOString();
  persistUsageSnapshot(userDataPath, {
    fiveHourUsedPct: 7, resetsAt: reset, capturedAt: new Date(now - 2000).toISOString(),
  });
  const merged = persistUsageSnapshot(userDataPath, {
    fiveHourUsedPct: 5, resetsAt: reset, capturedAt: new Date(now - 1000).toISOString(),
  });
  assert.equal(merged.fiveHourUsedPct, 7);
  const stored = JSON.parse(fs.readFileSync(resolveBridgePaths(userDataPath).activeSnapshotPath, 'utf8'));
  assert.equal(stored.fiveHourUsedPct, 7);
  assert.equal(fs.readdirSync(userDataPath).some((name) => name.endsWith('.tmp')), false);
});

test('active usage persistence repairs an interrupted prior snapshot', () => {
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-burner-usage-'));
  const now = Date.parse('2026-08-04T21:00:00.000Z');
  const { activeSnapshotPath } = resolveBridgePaths(userDataPath);
  fs.writeFileSync(activeSnapshotPath, '{interrupted');
  const repaired = persistUsageSnapshot(userDataPath, {
    fiveHourUsedPct: 9,
    resetsAt: new Date(now + 2 * 60 * 60 * 1000).toISOString(),
    capturedAt: new Date(now).toISOString(),
  });
  assert.equal(repaired.fiveHourUsedPct, 9);
  assert.equal(JSON.parse(fs.readFileSync(activeSnapshotPath, 'utf8')).fiveHourUsedPct, 9);
});
