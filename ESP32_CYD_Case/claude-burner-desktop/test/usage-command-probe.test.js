'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  probeEnvironment,
  prepareOwnedProbeWorkspace,
  cleanupOwnedProbeWorkspace,
  isClaudePromptReady,
  nextResetTimestamp,
  parseUsageCommandOutput,
  probeClaudeUsage,
} = require('../src/usage-command-probe');

const NOW = Date.parse('2026-08-05T01:30:00.000Z'); // 6:30 PM Los Angeles

const USAGE_SCREEN = [
  '\u001b[3CCurrent\u001b[12Gsession\r\n',
  '\u001b[3C▌\u001b[55G5%\u001b[58Gused\r\n',
  '\u001b[3CResets\u001b[11G10:09pm\u001b[19G(America/Los_Angeles)\r\n',
  '\u001b[3CCurrent\u001b[12Gweek\u001b[17G(all\u001b[22Gmodels)\r\n',
  '\u001b[3C███▌\u001b[55G7%\u001b[58Gused\r\n',
].join('');

const USAGE_SCREEN_ON_THE_HOUR = [
  'Current session\r\n',
  '██████████████████████ 44% used\r\n',
  'Resets 9pm (America/Los_Angeles)\r\n',
  'Current week (all models) 39% used\r\n',
].join('');

test('active Usage screen parsing isolates the five-hour percentage and reset', () => {
  const snapshot = parseUsageCommandOutput(USAGE_SCREEN, NOW);
  assert.equal(snapshot.fiveHourUsedPct, 5);
  assert.equal(snapshot.resetsAt, '2026-08-05T05:09:00.000Z');
  assert.equal(snapshot.source, 'usage-command');
  assert.equal(snapshot.stale, false);
});

test('active Usage parsing tolerates Claude incremental-render cursor damage', () => {
  const damaged = USAGE_SCREEN.replace('Current', 'Curr\u001b[9Gnt');
  assert.equal(parseUsageCommandOutput(damaged, NOW).fiveHourUsedPct, 5);
  assert.equal(parseUsageCommandOutput('Current week 7% used', NOW), null);
});

test('active Usage parsing accepts Claude resets on the hour without :00', () => {
  const now = Date.parse('2026-08-08T01:30:00.000Z'); // 6:30 PM Los Angeles
  const snapshot = parseUsageCommandOutput(USAGE_SCREEN_ON_THE_HOUR, now);
  assert.equal(snapshot.fiveHourUsedPct, 44);
  assert.equal(snapshot.resetsAt, '2026-08-08T04:00:00.000Z');
});

test('active probe recognizes the current safe-mode prompt after ANSI rendering', () => {
  assert.equal(isClaudePromptReady(
    '\u001b[31m⚠ Safe mode: all customizations are disabled\u001b[0m\r\n'
      + 'Restart without --safe-mode to re-enable\r\n'
      + '⏸ manual\u001b[12G mode\u001b[22G on · ? for shortcuts',
  ), true);
  assert.equal(isClaudePromptReady('Quick safety check: choose whether to trust this folder'), false);
});

test('active Usage parsing rejects a stale reset that would roll to tomorrow', () => {
  const afterDisplayedReset = Date.parse('2026-08-05T05:11:00.000Z');
  assert.equal(parseUsageCommandOutput(USAGE_SCREEN, afterDisplayedReset), null);
});

test('reset parsing chooses the still-upcoming occurrence during the DST fold', () => {
  const beforeFirstOccurrence = Date.parse('2026-11-01T08:00:00.000Z');
  const betweenOccurrences = Date.parse('2026-11-01T08:45:00.000Z');
  assert.equal(
    nextResetTimestamp(1, 30, 'am', 'America/Los_Angeles', beforeFirstOccurrence),
    Date.parse('2026-11-01T08:30:00.000Z'),
  );
  assert.equal(
    nextResetTimestamp(1, 30, 'am', 'America/Los_Angeles', betweenOccurrences),
    Date.parse('2026-11-01T09:30:00.000Z'),
  );
});

test('active probe environment excludes API credentials, providers, and nested-session markers', () => {
  const environment = probeEnvironment({
    HOME: '/Users/test',
    PATH: '/usr/bin',
    HTTPS_PROXY: 'http://proxy.invalid',
    ANTHROPIC_API_KEY: 'secret',
    ANTHROPIC_AUTH_TOKEN: 'secret',
    CLAUDE_CODE_OAUTH_TOKEN: 'secret',
    CLAUDE_CODE_USE_BEDROCK: '1',
    CLAUDECODE: '1',
  });
  assert.equal(environment.HOME, '/Users/test');
  assert.equal(environment.HTTPS_PROXY, 'http://proxy.invalid');
  assert.equal(environment.ANTHROPIC_API_KEY, undefined);
  assert.equal(environment.ANTHROPIC_AUTH_TOKEN, undefined);
  assert.equal(environment.CLAUDE_CODE_OAUTH_TOKEN, undefined);
  assert.equal(environment.CLAUDE_CODE_USE_BEDROCK, undefined);
  assert.equal(environment.CLAUDECODE, undefined);
  assert.equal(environment.LC_ALL, 'en_US.UTF-8');
  assert.equal(environment.CLAUDE_CODE_SKIP_PROMPT_HISTORY, '1');
});

test('active probe workspace is private, empty, and contained by Application Support', () => {
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-burner-probe-'));
  try {
    const workspace = prepareOwnedProbeWorkspace(userDataPath);
    assert.equal(path.dirname(path.dirname(workspace)), fs.realpathSync.native(userDataPath));
    assert.equal(fs.statSync(workspace).mode & 0o777, 0o700);
    assert.deepEqual(fs.readdirSync(workspace), []);
    fs.writeFileSync(path.join(workspace, 'unexpected-file'), 'stop safely');
    const nextWorkspace = prepareOwnedProbeWorkspace(userDataPath);
    assert.notEqual(nextWorkspace, workspace);
    assert.deepEqual(fs.readdirSync(nextWorkspace), []);
    assert.equal(cleanupOwnedProbeWorkspace(workspace, userDataPath), true);
    assert.equal(fs.existsSync(workspace), false);
  } finally {
    fs.rmSync(userDataPath, { recursive: true, force: true });
  }
});

test('PTY probe writes only the built-in usage command', async () => {
  const writes = [];
  let onData = null;
  let onExit = null;
  const terminal = {
    onData(callback) { onData = callback; },
    onExit(callback) { onExit = callback; },
    write(value) {
      writes.push(value);
      if (value === '/usage\r') queueMicrotask(() => onData(USAGE_SCREEN));
    },
    kill() { queueMicrotask(() => onExit({ exitCode: 0 })); },
  };
  const ptyModule = {
    spawn() {
      queueMicrotask(() => onData('manual\u001b[12Gmode\u001b[17Gon'));
      return terminal;
    },
  };
  const snapshot = await probeClaudeUsage({
    binaryPath: '/tmp/fake-claude',
    cwd: '/tmp',
    timeoutMs: 2_000,
    ptyModule,
    now: () => NOW,
  });
  assert.equal(snapshot.fiveHourUsedPct, 5);
  assert.deepEqual(writes, ['/usage\r']);
});

test('PTY probe may confirm trust only when the caller marks its workspace as app-owned', async () => {
  const writes = [];
  let onData = null;
  let onExit = null;
  const terminal = {
    onData(callback) { onData = callback; },
    onExit(callback) { onExit = callback; },
    write(value) {
      writes.push(value);
      if (value === '\r') queueMicrotask(() => onData('manual\u001b[12Gmode\u001b[17Gon'));
      if (value === '/usage\r') queueMicrotask(() => onData(USAGE_SCREEN));
    },
    kill() { queueMicrotask(() => onExit({ exitCode: 0 })); },
  };
  const ptyModule = {
    spawn() {
      queueMicrotask(() => onData(
        'Quick \u001b[14Gsafety \u001b[25Gcheck: Is this a project you created or one you trust?',
      ));
      return terminal;
    },
  };
  const snapshot = await probeClaudeUsage({
    binaryPath: '/tmp/fake-claude',
    cwd: '/tmp/app-owned-empty-directory',
    timeoutMs: 2_000,
    ptyModule,
    now: () => NOW,
    acceptOwnedWorkspaceTrust: true,
  });
  assert.equal(snapshot.fiveHourUsedPct, 5);
  assert.deepEqual(writes, ['\r', '/usage\r']);
});

test('PTY probe fails closed without typing on an unrecognized trust screen', async () => {
  const writes = [];
  let onData = null;
  let onExit = null;
  const terminal = {
    onData(callback) { onData = callback; },
    onExit(callback) { onExit = callback; },
    write(value) { writes.push(value); },
    kill() {},
  };
  const ptyModule = {
    spawn() {
      queueMicrotask(() => onData('Quick safety check: Is this a project you trust?'));
      setTimeout(() => onExit({ exitCode: 1 }), 20);
      return terminal;
    },
  };
  await assert.rejects(
    probeClaudeUsage({
      binaryPath: '/tmp/fake-claude',
      cwd: '/tmp/untrusted-directory',
      timeoutMs: 2_000,
      ptyModule,
      now: () => NOW,
      acceptOwnedWorkspaceTrust: false,
    }),
    /exited before returning current usage/,
  );
  assert.deepEqual(writes, []);
});
