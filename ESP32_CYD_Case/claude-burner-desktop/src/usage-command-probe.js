'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_TIMEOUT_MS = 18_000;
const MAX_CAPTURE_LENGTH = 128 * 1024;
const MAX_RESET_HORIZON_MS = (5 * 60 + 15) * 60 * 1000;
const MAX_OWNED_PROBE_WORKSPACES = 24;
const TIME_ZONE_FORMATTERS = new Map();
const SAFE_ENVIRONMENT_KEYS = [
  'HOME', 'USER', 'LOGNAME', 'SHELL', 'PATH', 'TMPDIR',
  'CLAUDE_CONFIG_DIR',
  'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY',
  'http_proxy', 'https_proxy', 'all_proxy', 'no_proxy',
];

function probeEnvironment(input = process.env) {
  const environment = {};
  for (const key of SAFE_ENVIRONMENT_KEYS) {
    if (typeof input[key] === 'string' && input[key]) environment[key] = input[key];
  }
  return {
    ...environment,
    LANG: 'en_US.UTF-8',
    LC_ALL: 'en_US.UTF-8',
    TERM: 'xterm-256color',
    CLAUDE_CODE_DISABLE_TERMINAL_TITLE: '1',
    // Official Claude Code escape hatch: suppress transcripts and prompt
    // history in every mode. The probe must not pollute the user's sessions.
    CLAUDE_CODE_SKIP_PROMPT_HISTORY: '1',
  };
}

function prepareOwnedProbeWorkspace(userDataPath) {
  if (!path.isAbsolute(String(userDataPath || ''))) {
    throw new Error('Claude usage probe storage must be an absolute path.');
  }
  const canonicalRoot = fs.realpathSync.native(userDataPath);
  if (!fs.statSync(canonicalRoot).isDirectory()) {
    throw new Error('Claude Burner Application Support storage is not a directory.');
  }

  const workspaceRoot = path.join(userDataPath, 'usage-probe-workspaces');
  if (!fs.existsSync(workspaceRoot)) fs.mkdirSync(workspaceRoot, { mode: 0o700 });
  const rootLstat = fs.lstatSync(workspaceRoot);
  if (rootLstat.isSymbolicLink() || !rootLstat.isDirectory()) {
    throw new Error('The Claude usage probe workspace root is not a private directory.');
  }
  if (typeof process.getuid === 'function' && rootLstat.uid !== process.getuid()) {
    throw new Error('The Claude usage probe workspace root is not owned by the current user.');
  }
  fs.chmodSync(workspaceRoot, 0o700);

  const staleEntries = fs.readdirSync(workspaceRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^probe-\d+-\d+-[a-f0-9]+$/i.test(entry.name))
    .map((entry) => {
      const sourcePath = path.join(workspaceRoot, entry.name);
      try { return { sourcePath, modifiedAt: fs.statSync(sourcePath).mtimeMs }; }
      catch { return null; }
    })
    .filter(Boolean)
    .sort((left, right) => right.modifiedAt - left.modifiedAt);
  for (const stale of staleEntries.slice(MAX_OWNED_PROBE_WORKSPACES)) {
    fs.rmSync(stale.sourcePath, { recursive: true, force: true });
  }

  const suffix = Math.random().toString(16).slice(2, 10);
  const workspacePath = path.join(workspaceRoot, `probe-${process.pid}-${Date.now()}-${suffix}`);
  fs.mkdirSync(workspacePath, { mode: 0o700 });
  const workspaceLstat = fs.lstatSync(workspacePath);
  if (workspaceLstat.isSymbolicLink() || !workspaceLstat.isDirectory()) {
    throw new Error('The Claude usage probe workspace is not a private directory.');
  }
  fs.chmodSync(workspacePath, 0o700);

  const canonicalWorkspace = fs.realpathSync.native(workspacePath);
  const canonicalPrefix = canonicalRoot.endsWith(path.sep)
    ? canonicalRoot
    : `${canonicalRoot}${path.sep}`;
  if (!canonicalWorkspace.startsWith(canonicalPrefix)) {
    throw new Error('The Claude usage probe workspace escaped Application Support.');
  }
  return canonicalWorkspace;
}

function cleanupOwnedProbeWorkspace(workspacePath, userDataPath) {
  if (!workspacePath || !path.isAbsolute(String(workspacePath))) return false;
  const canonicalRoot = fs.realpathSync.native(userDataPath);
  const canonicalWorkspace = fs.existsSync(workspacePath)
    ? fs.realpathSync.native(workspacePath)
    : path.resolve(workspacePath);
  const canonicalPrefix = canonicalRoot.endsWith(path.sep)
    ? canonicalRoot
    : `${canonicalRoot}${path.sep}`;
  if (!canonicalWorkspace.startsWith(canonicalPrefix)) return false;
  fs.rmSync(canonicalWorkspace, { recursive: true, force: true });
  return true;
}

function stripTerminalControls(value) {
  return String(value || '')
    // Operating-system commands, including the terminal title.
    .replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, '')
    // Control Sequence Introducer commands used by Claude's full-screen UI.
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\u001b[()][A-Z0-9]/g, '')
    .replace(/\u001b./g, '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
}

function probeScreenText(value) {
  return stripTerminalControls(value).replace(/\s+/g, ' ').trim();
}

function isClaudePromptReady(value) {
  const text = probeScreenText(value);
  // Claude Code's incremental renderer can place cursor-control sequences in
  // the middle of every word. Work from the sanitized screen, and recognize
  // both the explicit safe-mode footer and the stable prompt/help chrome.
  return /manual\s*mode\s*on/i.test(text)
    || /safe\s*mode:[\s\S]{0,260}(?:restart|customizations)/i.test(text)
    || /try\s*["“][\s\S]{0,120}["”]/i.test(text);
}

function partsInTimeZone(timestamp, timeZone) {
  let formatter = TIME_ZONE_FORMATTERS.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    TIME_ZONE_FORMATTERS.set(timeZone, formatter);
  }
  const parts = Object.fromEntries(
    formatter.formatToParts(new Date(timestamp))
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)]),
  );
  // Some ICU builds represent midnight as 24:00. Date.UTC expects 00:00.
  if (parts.hour === 24) parts.hour = 0;
  return parts;
}

function nextResetTimestamp(hour12, minute, meridiem, timeZone, now = Date.now()) {
  let hour = Number(hour12) % 12;
  if (String(meridiem).toLowerCase() === 'pm') hour += 12;
  const targetMinute = Number(minute);
  // Search the actual upcoming UTC instants instead of guessing an offset.
  // During the fall DST fold, a wall time such as 1:30am occurs twice; this
  // selects the first occurrence that has not already passed.
  const firstMinute = Math.floor((now - 60_000) / 60_000) * 60_000;
  const lastMinute = now + MAX_RESET_HORIZON_MS;
  for (let candidate = firstMinute; candidate <= lastMinute; candidate += 60_000) {
    const parts = partsInTimeZone(candidate, timeZone);
    if (parts.hour === hour && parts.minute === targetMinute && candidate >= now - 60_000) {
      return candidate;
    }
  }
  throw new RangeError('Claude returned a reset time outside the five-hour window.');
}

function parseUsageCommandOutput(output, now = Date.now()) {
  const compact = stripTerminalControls(output).replace(/\s+/g, '');
  // Claude's incremental renderer sometimes overwrites one character in
  // "Current" while moving the cursor, hence the deliberately tolerant stem.
  const match = compact.match(
    /Curr[a-z]{1,5}session[\s\S]{0,360}?(\d+(?:\.\d+)?)%used[\s\S]{0,360}?Resets(\d{1,2})(?::(\d{2}))?(am|pm)\(([^)]+)\)/i,
  );
  if (!match) return null;
  const used = Number(match[1]);
  const timeZone = match[5];
  if (!Number.isFinite(used) || used < 0 || used > 100) return null;
  let resetsAt;
  try {
    // Claude Code 2.1.225 omits ":00" for resets on the hour (for example,
    // "Resets 9pm"). Treat a missing minute component as exactly zero.
    resetsAt = new Date(nextResetTimestamp(match[2], match[3] ?? 0, match[4], timeZone, now)).toISOString();
  } catch {
    return null;
  }
  return {
    sourceVersion: 1,
    source: 'usage-command',
    sessionId: 'active-usage-probe',
    fiveHourUsedPct: used,
    resetsAt,
    capturedAt: new Date(now).toISOString(),
    stale: false,
    validForMs: 180_000,
  };
}

function probeClaudeUsage({
  binaryPath,
  cwd,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  ptyModule = null,
  now = () => Date.now(),
  acceptOwnedWorkspaceTrust = false,
} = {}) {
  if (!binaryPath) return Promise.reject(new Error('Claude Code binary was not provided.'));
  return new Promise((resolve, reject) => {
    let pty;
    try {
      // Lazy loading keeps the rest of the app usable if the optional native
      // PTY cannot load on an unsupported machine.
      pty = ptyModule || require('node-pty');
    } catch (error) {
      reject(new Error(`The active Claude usage probe is unavailable: ${error.message}`));
      return;
    }

    let terminal;
    let initialOutput = '';
    let usageOutput = '';
    let commandSent = false;
    let trustConfirmed = false;
    let settled = false;

    const closeTerminal = () => {
      if (!terminal) return;
      try { terminal.kill(); } catch { /* already closed */ }
    };
    const finish = (error, snapshot = null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      closeTerminal();
      if (error) reject(error);
      else resolve(snapshot);
    };
    const sendUsageCommand = () => {
      if (commandSent || settled) return;
      commandSent = true;
      usageOutput = '';
      // `/usage` is an official built-in UI command, not a model prompt. The
      // probe never writes any other content into the fresh Claude session.
      try { terminal.write('/usage\r'); }
      catch (error) { finish(error); }
    };

    const timeout = setTimeout(() => {
      finish(new Error('Claude Code did not return its Usage screen in time.'));
    }, timeoutMs);
    timeout.unref();

    try {
      terminal = pty.spawn(binaryPath, ['--safe-mode'], {
        name: 'xterm-256color',
        cols: 100,
        rows: 40,
        cwd: cwd || path.dirname(binaryPath),
        env: probeEnvironment(process.env),
      });
    } catch (error) {
      clearTimeout(timeout);
      reject(new Error(`Could not start the active Claude usage probe: ${error.message}`));
      return;
    }

    terminal.onData((data) => {
      if (settled) return;
      if (!commandSent) {
        initialOutput = `${initialOutput}${data}`.slice(-MAX_CAPTURE_LENGTH);
        if (acceptOwnedWorkspaceTrust && !trustConfirmed
            && /Quick\s*safety\s*check/i.test(probeScreenText(initialOutput))) {
          // The caller may opt in only for a dedicated, app-created empty
          // directory. Never auto-approve an arbitrary user workspace.
          trustConfirmed = true;
          try { terminal.write('\r'); } catch (error) { finish(error); }
          return;
        }
        if (isClaudePromptReady(initialOutput)) {
          setTimeout(sendUsageCommand, 250).unref();
        }
        return;
      }
      usageOutput = `${usageOutput}${data}`.slice(-MAX_CAPTURE_LENGTH);
      const snapshot = parseUsageCommandOutput(usageOutput, now());
      if (snapshot) finish(null, snapshot);
    });
    terminal.onExit(() => {
      if (!settled) finish(new Error('Claude Code exited before returning current usage.'));
    });
  });
}

module.exports = {
  probeEnvironment,
  prepareOwnedProbeWorkspace,
  cleanupOwnedProbeWorkspace,
  stripTerminalControls,
  probeScreenText,
  isClaudePromptReady,
  nextResetTimestamp,
  parseUsageCommandOutput,
  probeClaudeUsage,
};
