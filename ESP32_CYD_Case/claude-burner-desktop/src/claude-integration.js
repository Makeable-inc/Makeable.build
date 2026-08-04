'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { normalizePlan } = require('./pet-engine');

const execFileAsync = promisify(execFile);
const MIN_CLAUDE_VERSION = [2, 1, 80];

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
  const candidates = [
    path.join(home, '.local', 'bin', 'claude'),
    path.join(home, '.claude', 'local', 'claude'),
    path.join(home, '.npm-global', 'bin', 'claude'),
    '/opt/homebrew/bin/claude',
    '/usr/local/bin/claude',
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || 'claude';
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

async function detectClaude() {
  let version = null;
  let auth = null;
  const binary = resolveClaudeBinary();
  try {
    const result = await execFileAsync(binary, ['--version'], { timeout: 5000, maxBuffer: 128 * 1024 });
    version = parseVersion(result.stdout || result.stderr);
  } catch {
    return { installed: false, compatible: false, version: null, loggedIn: false, plan: 'free' };
  }
  try {
    const result = await execFileAsync(binary, ['auth', 'status', '--json'], { timeout: 8000, maxBuffer: 128 * 1024 });
    auth = JSON.parse(result.stdout);
  } catch {
    auth = {};
  }
  const rawSubscription = String(auth.subscriptionType || 'free').toLowerCase();
  const plan = rawSubscription === 'max' ? 'max' : normalizePlan(rawSubscription);
  return {
    installed: true,
    compatible: Boolean(version && compareVersions(version, MIN_CLAUDE_VERSION) >= 0),
    version: version ? version.join('.') : null,
    loggedIn: Boolean(auth.loggedIn),
    plan,
  };
}

function resolveBridgePaths(userDataPath) {
  return {
    configPath: path.join(userDataPath, 'bridge-config.json'),
    snapshotPath: path.join(userDataPath, 'usage-snapshot.json'),
    backupPath: path.join(userDataPath, 'statusline-backup.json'),
    installedBinaryPath: path.join(userDataPath, 'bin', 'claude-burner-statusline-bridge'),
  };
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
    version: 1,
    plan,
    maxMultiplier,
    previousCommand,
    snapshotPath: paths.snapshotPath,
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
  return {
    installed: [paths.installedBinaryPath, shellQuote(paths.installedBinaryPath)].includes(settings.statusLine?.command) && fs.existsSync(paths.installedBinaryPath),
    snapshotPath: paths.snapshotPath,
    hooksDisabled: settings.disableAllHooks === true,
  };
}

function readUsageSnapshot(userDataPath, maximumAgeMs = 30_000) {
  const { snapshotPath } = resolveBridgePaths(userDataPath);
  const snapshot = readJson(snapshotPath, null);
  if (!snapshot) return null;
  const age = Date.now() - Date.parse(snapshot.capturedAt);
  return { ...snapshot, stale: Boolean(snapshot.stale || !Number.isFinite(age) || age > maximumAgeMs) };
}

module.exports = {
  MIN_CLAUDE_VERSION,
  compareVersions,
  parseVersion,
  shellQuote,
  resolveClaudeBinary,
  detectClaude,
  installStatusLine,
  updateBridgePlan,
  uninstallStatusLine,
  statusLineState,
  readUsageSnapshot,
  resolveBridgePaths,
};
