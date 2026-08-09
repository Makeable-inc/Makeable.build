'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { normalizePlan, toTimestamp } = require('./pet-engine');

const execFileAsync = promisify(execFile);
const MIN_CLAUDE_VERSION = [2, 1, 80];
const MIN_CLAUDE_SAFE_MODE_VERSION = [2, 1, 169];
const RESET_WINDOW_TOLERANCE_MS = 10 * 60 * 1000;
const MAX_RESET_HORIZON_MS = (5 * 60 + 15) * 60 * 1000;
// A verified percentage is a safe lower bound until that exact five-hour
// window resets. Keeping it for the whole possible window prevents a brief
// Claude CLI update, terminal failure, or sleeping Mac from displaying 0%.
const LAST_KNOWN_USAGE_MAX_AGE_MS = MAX_RESET_HORIZON_MS;
const MAX_SESSION_SNAPSHOTS = 64;
const CLAUDE_DISCOVERY_RETRY_DELAYS_MS = [0, 180, 500];

function compareVersions(left, right) {
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (Number(left[index]) || 0) - (Number(right[index]) || 0);
    if (difference) return Math.sign(difference);
  }
  return 0;
}

function parseVersion(output) {
  const match = String(output || '').match(/(\d+)\.(\d+)\.(\d+)/);
  return match ? match.slice(1).map(Number) : null;
}

function settingsPath(home = os.homedir()) {
  return path.join(home, '.claude', 'settings.json');
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function resolveClaudeBinary(home = os.homedir()) {
  const childDirectories = (directory) => {
    try {
      return fs.readdirSync(directory, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(directory, entry.name))
        .sort((left, right) => {
          const leftVersion = parseVersion(path.basename(left));
          const rightVersion = parseVersion(path.basename(right));
          if (leftVersion && rightVersion) return -compareVersions(leftVersion, rightVersion);
          if (leftVersion) return -1;
          if (rightVersion) return 1;
          return right.localeCompare(left);
        });
    } catch {
      return [];
    }
  };
  const nvmCandidates = childDirectories(path.join(home, '.nvm', 'versions', 'node'))
    .map((directory) => path.join(directory, 'bin', 'claude'));
  const fnmCandidates = [
    path.join(home, 'Library', 'Application Support', 'fnm', 'node-versions'),
    path.join(home, '.local', 'share', 'fnm', 'node-versions'),
  ].flatMap((root) => childDirectories(root)
    .map((directory) => path.join(directory, 'installation', 'bin', 'claude')));
  const inheritedPathCandidates = String(process.env.PATH || '')
    .split(path.delimiter)
    .filter(Boolean)
    .map((directory) => path.join(directory, 'claude'));
  const candidates = [
    path.join(home, '.local', 'bin', 'claude'),
    path.join(home, '.claude', 'local', 'claude'),
    path.join(home, '.npm-global', 'bin', 'claude'),
    path.join(home, '.npm', 'bin', 'claude'),
    path.join(home, '.volta', 'bin', 'claude'),
    path.join(home, '.asdf', 'shims', 'claude'),
    path.join(home, '.local', 'share', 'mise', 'shims', 'claude'),
    path.join(home, '.mise', 'shims', 'claude'),
    path.join(home, '.bun', 'bin', 'claude'),
    path.join(home, 'Library', 'pnpm', 'claude'),
    path.join(home, '.local', 'share', 'pnpm', 'claude'),
    ...nvmCandidates,
    ...fnmCandidates,
    '/opt/homebrew/bin/claude',
    '/opt/local/bin/claude',
    '/usr/local/bin/claude',
    ...inheritedPathCandidates,
  ];
  return candidates.find((candidate) => {
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  }) || 'claude';
}

function resolvePlanForInstall(detectedPlan, persistedPlan, selectedMaxMultiplier = null) {
  const persisted = normalizePlan(persistedPlan);
  // A user-confirmed Max tier is more authoritative than subscriptionType,
  // which can be generic or stale. This prevents bridge reinstallation from
  // silently downgrading Max 20x progression to Pro.
  if (persisted === 'max5' || persisted === 'max20') return persisted;
  if (String(detectedPlan || '').trim().toLowerCase() === 'max') {
    return normalizePlan('max', selectedMaxMultiplier);
  }
  return normalizePlan(detectedPlan);
}

function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw error;
  }
}

function writeJsonAtomic(filePath, value, mode = 0o600) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporary = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode });
  fs.renameSync(temporary, filePath);
  fs.chmodSync(filePath, mode);
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function runClaudeCommandWithRetry(
  binary,
  args,
  options,
  runner = execFileAsync,
  retryDelaysMs = CLAUDE_DISCOVERY_RETRY_DELAYS_MS,
) {
  let lastError = null;
  for (const delayMs of retryDelaysMs) {
    if (delayMs > 0) await wait(delayMs);
    try {
      return await runner(binary, args, options);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('Claude Code command failed.');
}

function parseClaudeJson(resultOrError) {
  const candidates = [
    resultOrError?.stdout,
    resultOrError?.stderr,
    resultOrError?.message,
  ];
  for (const candidate of candidates) {
    const text = String(candidate || '').trim();
    if (!text) continue;
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start < 0 || end <= start) continue;
    try {
      const parsed = JSON.parse(text.slice(start, end + 1));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    } catch { /* try the next output stream */ }
  }
  return null;
}

async function readClaudeAuthStatus(binary, runner, retryDelaysMs) {
  try {
    const result = await runClaudeCommandWithRetry(
      binary,
      ['auth', 'status'],
      { timeout: 8000, maxBuffer: 128 * 1024 },
      runner,
      retryDelaysMs,
    );
    return parseClaudeJson(result) || {};
  } catch (error) {
    // `claude auth status` intentionally exits 1 when signed out, while still
    // printing authoritative JSON. Treat that as a valid state rather than a
    // broken CLI. This is the fresh-machine case shown in Raymond's recording.
    return parseClaudeJson(error) || {};
  }
}

async function detectClaude({
  home = os.homedir(),
  runner = execFileAsync,
  retryDelaysMs = CLAUDE_DISCOVERY_RETRY_DELAYS_MS,
} = {}) {
  let version = null;
  let auth = null;
  const binary = resolveClaudeBinary(home);
  try {
    const result = await runClaudeCommandWithRetry(
      binary,
      ['--version'],
      { timeout: 5000, maxBuffer: 128 * 1024 },
      runner,
      retryDelaysMs,
    );
    version = parseVersion(result.stdout || result.stderr);
  } catch {
    return {
      installed: false,
      compatible: false,
      activeUsageCompatible: false,
      version: null,
      loggedIn: false,
      plan: 'free',
      authMethod: 'none',
      apiProvider: 'none',
      subscriptionAuth: false,
      authState: 'not-installed',
    };
  }
  auth = await readClaudeAuthStatus(binary, runner, retryDelaysMs);
  const rawSubscription = String(auth.subscriptionType || 'free').toLowerCase();
  const plan = rawSubscription === 'max' ? 'max' : normalizePlan(rawSubscription);
  const loggedIn = Boolean(auth.loggedIn);
  const authMethod = String(auth.authMethod || 'unknown');
  const apiProvider = String(auth.apiProvider || 'unknown');
  const subscriptionAuth = loggedIn && (
    rawSubscription === 'pro'
    || rawSubscription === 'max'
    || /oauth|claude/i.test(authMethod)
  ) && !/bedrock|vertex|foundry/i.test(apiProvider);
  return {
    installed: true,
    compatible: Boolean(version && compareVersions(version, MIN_CLAUDE_VERSION) >= 0),
    activeUsageCompatible: Boolean(
      version && compareVersions(version, MIN_CLAUDE_SAFE_MODE_VERSION) >= 0
    ),
    version: version ? version.join('.') : null,
    loggedIn,
    plan,
    authMethod,
    apiProvider,
    subscriptionAuth,
    authState: loggedIn ? (subscriptionAuth ? 'subscription' : 'authenticated') : 'signed-out',
  };
}

function resolveBridgePaths(userDataPath) {
  return {
    configPath: path.join(userDataPath, 'bridge-config.json'),
    snapshotPath: path.join(userDataPath, 'usage-snapshot.json'),
    snapshotDirectory: path.join(userDataPath, 'usage-snapshots'),
    activeSnapshotPath: path.join(userDataPath, 'active-usage-snapshot.json'),
    backupPath: path.join(userDataPath, 'statusline-backup.json'),
    installedBinaryPath: path.join(userDataPath, 'bin', 'claude-burner-statusline-bridge'),
  };
}

function persistUsageSnapshot(userDataPath, snapshot) {
  const paths = resolveBridgePaths(userDataPath);
  const used = Number(snapshot?.fiveHourUsedPct);
  const capturedAt = Date.parse(snapshot?.capturedAt);
  const resetAt = toTimestamp(snapshot?.resetsAt);
  if (!Number.isFinite(used) || used < 0 || used > 100
      || !Number.isFinite(capturedAt) || resetAt === null) {
    throw new Error('Refusing to persist an invalid Claude usage snapshot.');
  }

  const normalized = {
    ...snapshot,
    sourceVersion: Number(snapshot.sourceVersion) || 1,
    source: 'usage-command',
    sessionId: 'active-usage-probe',
    fiveHourUsedPct: used,
    capturedAt: new Date(capturedAt).toISOString(),
    resetsAt: new Date(resetAt).toISOString(),
    stale: false,
  };
  let prior = null;
  try {
    prior = readJson(paths.activeSnapshotPath, null);
  } catch {
    // An interrupted prior write is not authoritative. The new validated
    // snapshot repairs it atomically instead of breaking every later refresh.
    prior = null;
  }
  const priorResetAt = toTimestamp(prior?.resetsAt);
  const priorCapturedAt = Date.parse(prior?.capturedAt);
  if (priorResetAt !== null && priorResetAt - resetAt > RESET_WINDOW_TOLERANCE_MS) {
    return prior;
  }
  if (priorResetAt !== null && Math.abs(priorResetAt - resetAt) <= RESET_WINDOW_TOLERANCE_MS) {
    normalized.fiveHourUsedPct = Math.max(Number(prior?.fiveHourUsedPct) || 0, used);
    normalized.resetsAt = new Date(Math.max(priorResetAt, resetAt)).toISOString();
    normalized.capturedAt = new Date(Math.max(Number.isFinite(priorCapturedAt) ? priorCapturedAt : 0, capturedAt)).toISOString();
  }
  writeJsonAtomic(paths.activeSnapshotPath, normalized);
  return normalized;
}

function installStatusLine({ sourceBinaryPath, userDataPath, plan, maxMultiplier = null, home = os.homedir() }) {
  const paths = resolveBridgePaths(userDataPath);
  const settingsFile = settingsPath(home);
  const settings = readJson(settingsFile, {});
  const current = settings.statusLine || null;
  const installedCommand = shellQuote(paths.installedBinaryPath);
  const alreadyInstalled = current?.command === installedCommand || current?.command === paths.installedBinaryPath;
  const existingBackup = readJson(paths.backupPath, null);
  const previousStatusLine = alreadyInstalled ? existingBackup?.previousStatusLine ?? null : current;
  const previousCommand = previousStatusLine?.type === 'command' ? previousStatusLine.command : null;

  fs.mkdirSync(path.dirname(paths.installedBinaryPath), { recursive: true, mode: 0o700 });
  fs.copyFileSync(sourceBinaryPath, paths.installedBinaryPath);
  fs.chmodSync(paths.installedBinaryPath, 0o755);
  writeJsonAtomic(paths.backupPath, { version: 1, previousStatusLine });
  writeJsonAtomic(paths.configPath, {
    version: 2,
    plan,
    maxMultiplier,
    previousCommand,
    snapshotPath: paths.snapshotPath,
    snapshotDirectory: paths.snapshotDirectory,
  });
  settings.statusLine = {
    type: 'command',
    command: installedCommand,
    padding: current?.padding ?? 0,
    // This is a local UI refresh only; it does not make API requests or use tokens.
    refreshInterval: 5,
  };
  writeJsonAtomic(settingsFile, settings);
  return { ...paths, chainedPreviousStatusLine: Boolean(previousCommand), hooksDisabled: settings.disableAllHooks === true };
}

function updateBridgePlan(userDataPath, plan, maxMultiplier = null) {
  const { configPath } = resolveBridgePaths(userDataPath);
  const config = readJson(configPath, null);
  if (!config) return false;
  writeJsonAtomic(configPath, { ...config, plan, maxMultiplier });
  return true;
}

function uninstallStatusLine({ userDataPath, home = os.homedir() }) {
  const paths = resolveBridgePaths(userDataPath);
  const settingsFile = settingsPath(home);
  const settings = readJson(settingsFile, {});
  const backup = readJson(paths.backupPath, { previousStatusLine: null });
  if ([paths.installedBinaryPath, shellQuote(paths.installedBinaryPath)].includes(settings.statusLine?.command)) {
    if (backup.previousStatusLine) settings.statusLine = backup.previousStatusLine;
    else delete settings.statusLine;
    writeJsonAtomic(settingsFile, settings);
  }
  return true;
}

function statusLineState(userDataPath, home = os.homedir()) {
  const paths = resolveBridgePaths(userDataPath);
  const settings = readJson(settingsPath(home), {});
  const config = readJson(paths.configPath, null);
  const installed = [paths.installedBinaryPath, shellQuote(paths.installedBinaryPath)].includes(settings.statusLine?.command)
    && fs.existsSync(paths.installedBinaryPath);
  let lastSnapshotAt = null;
  for (const candidate of [paths.snapshotPath, paths.activeSnapshotPath]) {
    try {
      const modified = fs.statSync(candidate).mtime.toISOString();
      if (!lastSnapshotAt || modified > lastSnapshotAt) lastSnapshotAt = modified;
    } catch { /* no reading yet */ }
  }
  return {
    installed,
    healthy: Boolean(installed && config?.version >= 2 && config?.snapshotPath === paths.snapshotPath),
    snapshotPath: paths.snapshotPath,
    hooksDisabled: settings.disableAllHooks === true,
    refreshInterval: Number(settings.statusLine?.refreshInterval) || null,
    lastSnapshotAt,
  };
}

function usageSnapshotCandidates(userDataPath) {
  const { snapshotPath, activeSnapshotPath, snapshotDirectory } = resolveBridgePaths(userDataPath);
  const candidates = [];
  const readCandidate = (sourceFile) => {
    try {
      return readJson(sourceFile, null);
    } catch {
      // One interrupted or corrupt app-owned snapshot must not stop decay,
      // active usage sync, display streaming, or every later poll.
      return null;
    }
  };
  const canonical = readCandidate(snapshotPath);
  if (canonical) candidates.push({ ...canonical, sourceFile: snapshotPath });
  const active = readCandidate(activeSnapshotPath);
  if (active) candidates.push({ ...active, sourceFile: activeSnapshotPath });
  try {
    const sourceFiles = fs.readdirSync(snapshotDirectory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && path.extname(entry.name) === '.json')
      .map((entry) => path.join(snapshotDirectory, entry.name))
      .map((sourceFile) => {
        try { return { sourceFile, modifiedAt: fs.statSync(sourceFile).mtimeMs }; }
        catch { return null; }
      })
      .filter(Boolean)
      .sort((left, right) => right.modifiedAt - left.modifiedAt);
    for (const staleFile of sourceFiles.slice(MAX_SESSION_SNAPSHOTS)) {
      try { fs.unlinkSync(staleFile.sourceFile); } catch { /* next poll retries */ }
    }
    for (const { sourceFile } of sourceFiles.slice(0, MAX_SESSION_SNAPSHOTS)) {
      const snapshot = readCandidate(sourceFile);
      if (snapshot) candidates.push({ ...snapshot, sourceFile });
    }
  } catch { /* optional fallback directory is unavailable */ }
  return candidates;
}

function validateUsageSnapshot(snapshot, now, maximumAgeMs) {
  const capturedAt = Date.parse(snapshot.capturedAt);
  const resetAt = toTimestamp(snapshot.resetsAt);
  const used = Number(snapshot.fiveHourUsedPct);
  const age = now - capturedAt;
  let staleReason = null;
  if (snapshot.stale) staleReason = 'bridge-reported-stale';
  else if (!Number.isFinite(used) || used < 0 || used > 100) staleReason = 'invalid-usage';
  else if (!Number.isFinite(capturedAt)) staleReason = 'invalid-capture-time';
  else if (age < -60_000) staleReason = 'future-capture';
  else if (resetAt === null) staleReason = 'missing-reset';
  else if (resetAt > now + MAX_RESET_HORIZON_MS) staleReason = 'future-reset';
  // A process can keep invoking its status line long after its rate-limit
  // window expired. Its newly-written capturedAt must not make that old 0%
  // authoritative. A short grace absorbs timer and clock boundary jitter.
  else if (resetAt < now - 60_000) staleReason = 'expired-window';
  const freshForMs = Math.max(maximumAgeMs, Number(snapshot.validForMs) || 0);
  const degraded = !staleReason && age > freshForMs
    && age <= LAST_KNOWN_USAGE_MAX_AGE_MS
    && resetAt >= now;
  if (!staleReason && age > freshForMs && !degraded) staleReason = 'old-capture';
  return {
    ...snapshot,
    fiveHourUsedPct: Number.isFinite(used) ? used : snapshot.fiveHourUsedPct,
    resetsAt: resetAt === null ? snapshot.resetsAt : new Date(resetAt).toISOString(),
    stale: Boolean(staleReason),
    staleReason,
    degraded,
    ageMs: Number.isFinite(age) ? Math.max(0, age) : null,
    confidence: degraded ? 'last-known' : staleReason ? 'invalid' : 'live',
    _capturedAtMs: capturedAt,
    _resetAtMs: resetAt,
  };
}

function readUsageSnapshot(userDataPath, maximumAgeMs = 30_000, now = Date.now(), additionalSnapshots = []) {
  const candidates = [...usageSnapshotCandidates(userDataPath), ...additionalSnapshots]
    .map((snapshot) => validateUsageSnapshot(snapshot, now, maximumAgeMs));
  if (!candidates.length) return null;

  const valid = candidates.filter((snapshot) => !snapshot.stale);
  let canonicalResetAt = null;
  let pool = valid.length ? valid : candidates;
  if (valid.length) {
    canonicalResetAt = Math.max(...valid.map((snapshot) => snapshot._resetAtMs));
    // `/usage` displays only minute precision while status-line JSON carries
    // the exact epoch. Treat close reset timestamps as the same five-hour
    // window, then choose the highest observation within that window.
    pool = valid.filter((snapshot) => canonicalResetAt - snapshot._resetAtMs <= RESET_WINDOW_TOLERANCE_MS);
  }
  pool.sort((left, right) => {
    if (valid.length && left.fiveHourUsedPct !== right.fiveHourUsedPct) {
      return right.fiveHourUsedPct - left.fiveHourUsedPct;
    }
    if (left.source === 'usage-command' && right.source !== 'usage-command') return -1;
    if (right.source === 'usage-command' && left.source !== 'usage-command') return 1;
    return (right._capturedAtMs || 0) - (left._capturedAtMs || 0);
  });
  const selected = pool[0];
  const { _capturedAtMs, _resetAtMs, ...result } = selected;
  return {
    ...result,
    resetsAt: canonicalResetAt === null ? result.resetsAt : new Date(canonicalResetAt).toISOString(),
    stale: !valid.length,
    staleReason: valid.length ? null : result.staleReason,
    degraded: valid.length ? Boolean(result.degraded) : false,
    confidence: valid.length ? result.confidence : 'invalid',
    sourcesObserved: candidates.length,
    validSources: valid.length,
  };
}

module.exports = {
  MIN_CLAUDE_VERSION,
  MIN_CLAUDE_SAFE_MODE_VERSION,
  LAST_KNOWN_USAGE_MAX_AGE_MS,
  compareVersions,
  parseVersion,
  shellQuote,
  resolveClaudeBinary,
  resolvePlanForInstall,
  runClaudeCommandWithRetry,
  parseClaudeJson,
  readClaudeAuthStatus,
  detectClaude,
  installStatusLine,
  updateBridgePlan,
  uninstallStatusLine,
  statusLineState,
  readUsageSnapshot,
  persistUsageSnapshot,
  resolveBridgePaths,
};
