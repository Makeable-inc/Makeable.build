'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { app, BrowserWindow, ipcMain, shell, nativeTheme, screen, clipboard } = require('electron');
const { StateStore } = require('./state-store');
const {
  applyDecay,
  applyUsageSnapshot,
  applyManualLife,
  setPlan,
  simulatedStateForUsage,
  progressionForUsage,
} = require('./pet-engine');
const {
  detectClaude,
  installStatusLine,
  updateBridgePlan,
  uninstallStatusLine,
  statusLineState,
  readUsageSnapshot,
  resolveBridgePaths,
  resolvePlanForInstall,
  resolveClaudeBinary,
} = require('./claude-integration');
const { SerialManager } = require('./serial-manager');
const { AnimationPack } = require('./animation-pack');
const { StreamController } = require('./stream-controller');
const { FirmwareInstaller, resolveFirmwareResources } = require('./firmware-installer');
const { restoreOrFit, MIN_WINDOW } = require('./window-layout');
const { Diagnostics } = require('./diagnostics');

app.setName('Claude Burner');
if (process.env.CLAUDE_BURNER_TEST_USER_DATA) {
  app.setPath('userData', path.resolve(process.env.CLAUDE_BURNER_TEST_USER_DATA));
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();

let mainWindow = null;
let store;
let state;
let claude = {
  installed: false,
  compatible: false,
  activeUsageCompatible: false,
  loggedIn: false,
  plan: 'free',
};
let bridge = { installed: false, hooksDisabled: false };
let rawUsage = null;
let serial;
let animations;
let streamer;
let firmwareInstaller;
let latestConnection = { connected: false, path: null, message: 'Searching for the CYD display…' };
let lastStateWriteAt = 0;
let simulation = null;
let usageProbe = {
  available: false,
  running: false,
  mode: 'statusline',
  lastSuccessAt: null,
  lastError: null,
};
let usageWatchers = [];
let usageWatchDebounce = null;
let quitRequestedDuringFirmware = false;
let firstConnect = {
  phase: 'scanning',
  running: false,
  progress: 0,
  port: null,
  firmwareVersion: null,
  boardFamily: 'ESP32-2432S028',
  message: 'Looking for an ESP32 CYD display…',
  lastError: null,
};
let firstConnectProvisioning = false;
let firstConnectScanPromise = null;
let firstConnectDismissedPort = null;
let diagnostics = null;
let claudeLoginMonitor = null;
let windowStateWriteTimer = null;
let claudeRefreshPromise = null;

function windowStatePath() {
  return path.join(app.getPath('userData'), 'window-state.json');
}

function readWindowState() {
  try { return JSON.parse(fs.readFileSync(windowStatePath(), 'utf8')); }
  catch { return null; }
}

function writeWindowState(bounds) {
  try {
    const destination = windowStatePath();
    fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
    const temporary = `${destination}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify({ version: 1, bounds }, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(temporary, destination);
  } catch (error) {
    diagnostics?.record('window.state-write-failed', { message: error.message });
  }
}

function scheduleWindowStateWrite() {
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.isMinimized() || mainWindow.isFullScreen()) return;
  if (windowStateWriteTimer) clearTimeout(windowStateWriteTimer);
  windowStateWriteTimer = setTimeout(() => {
    windowStateWriteTimer = null;
    if (mainWindow && !mainWindow.isDestroyed()) writeWindowState(mainWindow.getBounds());
  }, 250);
  windowStateWriteTimer.unref();
}

function trustedRenderer(event) {
  if (!mainWindow || mainWindow.isDestroyed() || event?.sender !== mainWindow.webContents) {
    throw new Error('The request did not come from the Claude Burner window.');
  }
}

function assetsPath() {
  return path.join(__dirname, '..', 'assets');
}

function bridgeBinaryPath() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'bin', 'claude-burner-statusline-bridge')
    : path.join(__dirname, '..', 'build', 'bin', 'claude-burner-statusline-bridge');
}

function publicSnapshot() {
  const displayState = simulation?.state || state;
  const displayUsage = simulation
    ? {
        ...(rawUsage || {}),
        plan: displayState.plan,
        maxMultiplier: displayState.maxMultiplier,
        fiveHourUsedPct: simulation.usagePct,
        capturedAt: new Date().toISOString(),
        stale: false,
        simulated: true,
      }
    : rawUsage;
  const usageFresh = Boolean(simulation || (rawUsage && !rawUsage.stale));
  const usageAgeMs = displayUsage?.capturedAt
    ? Math.max(0, Date.now() - Date.parse(displayUsage.capturedAt))
    : null;
  const progression = progressionForUsage(
    displayState.plan,
    displayState.maxMultiplier,
    displayUsage?.fiveHourUsedPct ?? 0,
  );
  let setupState = 'ready';
  let setupAction = null;
  let setupMessage = 'Claude usage is connected.';
  if (!claude.installed) {
    setupState = 'claude-not-installed';
    setupAction = 'install-claude';
    setupMessage = 'Install Claude Code to connect Ember to your work.';
  } else if (!claude.compatible) {
    setupState = 'claude-outdated';
    setupAction = 'install-claude';
    setupMessage = `Update Claude Code ${claude.version || ''} before connecting Ember.`.trim();
  } else if (!claude.loggedIn) {
    setupState = 'claude-signed-out';
    setupAction = 'sign-in';
    setupMessage = 'Claude Code is installed but signed out.';
  } else if (!claude.subscriptionAuth) {
    setupState = 'credential-source';
    setupAction = 'sign-in';
    setupMessage = 'Claude Code is authenticated, but not with a Claude.ai subscription.';
  } else if (!bridge.installed || !bridge.healthy) {
    setupState = 'bridge-needed';
    setupAction = 'install-bridge';
    setupMessage = 'Connect the local usage bridge to read Claude’s five-hour percentage.';
  } else if (!displayUsage || displayUsage.stale) {
    setupState = 'waiting-for-usage';
    setupAction = 'refresh';
    setupMessage = 'Open Claude Code and send one message so its first usage reading becomes available.';
  } else if (displayUsage.degraded) {
    setupState = 'usage-stale';
    setupAction = 'refresh';
    setupMessage = 'Showing the last verified reading while Claude Code refreshes it.';
  }
  return {
    state: { ...displayState, life: Math.round(displayState.life * 10) / 10 },
    liveState: { ...state, life: Math.round(state.life * 10) / 10 },
    claude,
    bridge,
    usageProbe,
    usage: displayUsage,
    usageFresh,
    usageHealth: {
      available: usageFresh,
      source: displayUsage?.source || null,
      degraded: Boolean(displayUsage?.degraded),
      confidence: displayUsage?.confidence || (usageFresh ? 'live' : 'unavailable'),
      ageMs: Number.isFinite(usageAgeMs) ? usageAgeMs : null,
      sourcesObserved: Number(displayUsage?.sourcesObserved) || 0,
      lastError: usageProbe.lastError,
    },
    setup: { state: setupState, action: setupAction, message: setupMessage },
    progression,
    simulation: simulation
      ? { active: true, usagePct: simulation.usagePct, liveLife: Math.round(state.life * 10) / 10 }
      : { active: false, usagePct: null, liveLife: Math.round(state.life * 10) / 10 },
    connection: latestConnection,
    streamStats: streamer?.stats || null,
    firmware: firmwareInstaller?.snapshot() || null,
    firstConnect,
    scene: animations?.sceneForState(displayState.level, displayState.emotion) || 'small_moody',
    animationCatalog: animations?.publicCatalog() || null,
    needsMaxChoice: claude.plan === 'max' && !['max5', 'max20'].includes(state.plan),
  };
}

function updateFirstConnect(patch) {
  firstConnect = { ...firstConnect, ...patch };
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('burner:first-connect-status', firstConnect);
  }
  broadcast();
}

async function scanFirstConnect() {
  if (firstConnectScanPromise || firstConnectProvisioning || firmwareInstaller?.snapshot().running) {
    return firstConnectScanPromise;
  }
  if (serial?.connected) {
    if (!['complete', 'idle'].includes(firstConnect.phase)) {
      updateFirstConnect({
        phase: 'idle', running: false, progress: 100,
        port: serial.path, message: 'Claude Burner display is ready.', lastError: null,
      });
    }
    return null;
  }
  firstConnectScanPromise = firmwareInstaller.scan().then((result) => {
    const supportedBoards = (result.boards || []).filter((board) => board.provisionEligible);
    if (supportedBoards.length > 1) {
      updateFirstConnect({
        phase: 'failed', running: false, progress: 0, port: null,
        message: 'More than one supported ESP32 is connected. Leave only the CYD attached, then retry.',
        lastError: 'Multiple supported USB devices were found.',
      });
      return result;
    }
    const board = supportedBoards[0] || null;
    if (board && board.path !== firstConnectDismissedPort) {
      updateFirstConnect({
        phase: 'authorization-needed', running: false, progress: 0,
        port: board.path,
        firmwareVersion: result.firmwareVersion,
        boardFamily: 'ESP32-2432S028',
        message: 'An ESP32 USB display is connected without the Ember protocol. Confirm it is your 2.8-inch CYD to install the bundled firmware.',
        lastError: null,
      });
    } else if (!board && !['idle', 'complete'].includes(firstConnect.phase)) {
      updateFirstConnect({
        phase: 'scanning', running: false, progress: 0, port: null,
        firmwareVersion: result.firmwareVersion || firstConnect.firmwareVersion,
        message: 'Connect the ESP32-2432S028 CYD with its USB cable.', lastError: null,
      });
    }
    return result;
  }).catch((error) => {
    updateFirstConnect({ phase: 'failed', running: false, progress: 0, message: error.message, lastError: error.message });
    return null;
  }).finally(() => { firstConnectScanPromise = null; });
  return firstConnectScanPromise;
}

function broadcast() {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('burner:snapshot', publicSnapshot());
}

function persist(nextState, forceWrite = true) {
  state = nextState;
  if (forceWrite || Date.now() - lastStateWriteAt >= 15_000) {
    store.save(state);
    lastStateWriteAt = Date.now();
  }
  broadcast();
}

async function refreshClaude() {
  if (claudeRefreshPromise) return claudeRefreshPromise;
  claudeRefreshPromise = (async () => {
    try {
      const detected = await detectClaude();
      const changed = JSON.stringify(claude) !== JSON.stringify(detected);
      claude = detected;
      bridge = statusLineState(app.getPath('userData'));
      const available = Boolean(
        claude.installed && claude.compatible && claude.loggedIn
        && claude.subscriptionAuth && bridge.installed && bridge.healthy,
      );
      let lastError = usageProbe.lastError;
      if (!claude.installed) lastError = 'Claude Code is not installed.';
      else if (!claude.compatible) lastError = `Claude Code ${claude.version || ''} must be updated.`.trim();
      else if (!claude.loggedIn) lastError = 'Claude Code is installed but signed out.';
      else if (!claude.subscriptionAuth) lastError = 'Claude is not using a Claude.ai subscription credential.';
      else if (!bridge.installed || !bridge.healthy) lastError = 'The Claude usage bridge is not connected.';
      else if (rawUsage && !rawUsage.stale) lastError = null;
      usageProbe = { ...usageProbe, available, lastError };
      // subscriptionType can be generic or stale. Seed only an untouched
      // installation and never overwrite a user-confirmed Max multiplier.
      if (!bridge.installed && state.plan === 'free' && claude.plan === 'pro') {
        persist(setPlan(state, 'pro'));
      } else {
        broadcast();
      }
      if (changed) diagnostics?.record('claude.state', {
        installed: claude.installed,
        compatible: claude.compatible,
        version: claude.version,
        authState: claude.authState,
        subscriptionAuth: claude.subscriptionAuth,
        bridgeInstalled: bridge.installed,
        bridgeHealthy: bridge.healthy,
      });
      return claude;
    } catch (error) {
      usageProbe = { ...usageProbe, available: false, lastError: `Claude check failed: ${error.message}` };
      diagnostics?.record('claude.detect-failed', { message: error.message });
      broadcast();
      return claude;
    }
  })().finally(() => { claudeRefreshPromise = null; });
  return claudeRefreshPromise;
}

function upgradeInstalledBridge() {
  if (!bridge.installed || !fs.existsSync(bridgeBinaryPath())) return false;
  installStatusLine({
    sourceBinaryPath: bridgeBinaryPath(),
    userDataPath: app.getPath('userData'),
    plan: state.plan,
    maxMultiplier: state.maxMultiplier,
  });
  bridge = statusLineState(app.getPath('userData'));
  return true;
}

function pollUsageAndDecay() {
  const now = Date.now();
  const snapshot = readUsageSnapshot(
    app.getPath('userData'),
    180_000,
    now,
  );
  const priorAward = state.windowLifeAwarded;
  const priorUsageCapture = state.lastUsageCapturedAt;
  let next = state;
  if (snapshot && !snapshot.stale) {
    rawUsage = snapshot;
    next = applyUsageSnapshot(next, snapshot);
    usageProbe = {
      ...usageProbe,
      lastSuccessAt: snapshot.capturedAt,
      lastError: snapshot.degraded ? 'Showing the last verified reading while waiting for Claude Code.' : null,
    };
  } else {
    rawUsage = snapshot;
  }
  // Respect event order exactly: decay to the usage capture, award new work,
  // then decay from that activity timestamp to the current wall clock.
  next = applyDecay(next, now);
  const usageChanged = next.windowLifeAwarded !== priorAward || next.lastUsageCapturedAt !== priorUsageCapture;
  persist(next, usageChanged);
}

function stopUsageWatchers() {
  if (usageWatchDebounce) clearTimeout(usageWatchDebounce);
  usageWatchDebounce = null;
  for (const watcher of usageWatchers) {
    try { watcher.close(); } catch { /* already closed */ }
  }
  usageWatchers = [];
}

function startUsageWatchers(userDataPath) {
  stopUsageWatchers();
  const paths = resolveBridgePaths(userDataPath);
  fs.mkdirSync(paths.snapshotDirectory, { recursive: true, mode: 0o700 });
  const relevantRootFiles = new Set([
    path.basename(paths.snapshotPath),
    path.basename(paths.activeSnapshotPath),
  ]);
  const scheduleRefresh = () => {
    if (usageWatchDebounce) clearTimeout(usageWatchDebounce);
    usageWatchDebounce = setTimeout(() => {
      usageWatchDebounce = null;
      if (state) pollUsageAndDecay();
    }, 80);
    usageWatchDebounce.unref();
  };
  try {
    usageWatchers.push(fs.watch(userDataPath, { persistent: false }, (_event, name) => {
      if (!name || relevantRootFiles.has(String(name))) scheduleRefresh();
    }));
  } catch (error) {
    console.warn(`Claude usage root watcher unavailable; polling remains active: ${error.message}`);
  }
  try {
    usageWatchers.push(fs.watch(paths.snapshotDirectory, { persistent: false }, scheduleRefresh));
  } catch (error) {
    console.warn(`Claude session watcher unavailable; polling remains active: ${error.message}`);
  }
}

async function refreshUsageFromBridge() {
  usageProbe = { ...usageProbe, running: true };
  broadcast();
  await refreshClaude();
  pollUsageAndDecay();
  let lastError = null;
  if (!claude.installed) lastError = 'Install Claude Code before refreshing usage.';
  else if (!claude.compatible) lastError = 'Update Claude Code before refreshing usage.';
  else if (!claude.loggedIn) lastError = 'Sign in to Claude Code before refreshing usage.';
  else if (!claude.subscriptionAuth) lastError = 'Sign in with your Claude.ai subscription before refreshing usage.';
  else if (!bridge.installed || !bridge.healthy) lastError = 'Connect the Claude usage bridge first.';
  else if (!rawUsage || rawUsage.stale) {
    lastError = 'Waiting for Claude Code’s first five-hour usage reading. Open Claude Code and send one message.';
  }
  usageProbe = {
    ...usageProbe,
    running: false,
    lastSuccessAt: rawUsage && !rawUsage.stale ? rawUsage.capturedAt : usageProbe.lastSuccessAt,
    lastError,
  };
  diagnostics?.record('usage.refresh', {
    success: Boolean(rawUsage && !rawUsage.stale),
    source: rawUsage?.source || null,
    staleReason: rawUsage?.staleReason || null,
    error: lastError,
  });
  broadcast();
  return rawUsage;
}

function stopClaudeLoginMonitor() {
  if (claudeLoginMonitor) clearInterval(claudeLoginMonitor);
  claudeLoginMonitor = null;
}

function startClaudeLoginMonitor() {
  stopClaudeLoginMonitor();
  const startedAt = Date.now();
  claudeLoginMonitor = setInterval(async () => {
    await refreshClaude();
    if (claude.loggedIn || Date.now() - startedAt >= 120_000) {
      stopClaudeLoginMonitor();
      if (claude.loggedIn) diagnostics?.record('claude.login-complete', { authState: claude.authState });
      else diagnostics?.record('claude.login-timeout');
    }
  }, 2_000);
  claudeLoginMonitor.unref();
}

function launchClaudeLogin() {
  if (!claude.installed) throw new Error('Install Claude Code before signing in.');
  const child = spawn(resolveClaudeBinary(), ['auth', 'login', '--claudeai'], {
    detached: true,
    stdio: 'ignore',
    env: process.env,
  });
  child.once('error', (error) => {
    diagnostics?.record('claude.login-launch-failed', { message: error.message });
  });
  child.unref();
  diagnostics?.record('claude.login-launched');
  startClaudeLoginMonitor();
  return { ok: true };
}

function createWindow() {
  nativeTheme.themeSource = 'system';
  const displays = screen.getAllDisplays();
  const primary = screen.getPrimaryDisplay();
  const saved = readWindowState();
  const fitted = restoreOrFit(saved?.bounds, displays, primary.workArea);
  mainWindow = new BrowserWindow({
    x: fitted.x,
    y: fitted.y,
    width: fitted.width,
    height: fitted.height,
    minWidth: Math.min(MIN_WINDOW.width, fitted.width),
    minHeight: Math.min(MIN_WINDOW.height, fitted.height),
    title: 'Claude Burner',
    backgroundColor: '#f3dcc0',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  let revealed = false;
  const revealWindow = () => {
    if (revealed || !mainWindow || mainWindow.isDestroyed()) return;
    revealed = true;
    mainWindow.show();
    mainWindow.focus();
  };
  // Large animated GIFs can delay or suppress ready-to-show in some Electron
  // builds. did-finish-load proves the UI is usable; the timer is a final
  // guarantee that the app cannot remain as a hidden background process.
  mainWindow.once('ready-to-show', revealWindow);
  mainWindow.webContents.once('did-finish-load', () => {
    mainWindow?.webContents.setZoomFactor(1);
    revealWindow();
  });
  mainWindow.on('move', scheduleWindowStateWrite);
  mainWindow.on('resize', scheduleWindowStateWrite);
  mainWindow.on('closed', () => { mainWindow = null; });
  mainWindow.on('unresponsive', () => diagnostics?.record('window.unresponsive'));
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    diagnostics?.record('window.renderer-gone', details);
  });
  mainWindow.loadFile(path.join(__dirname, '..', 'ui', 'index.html'));
  diagnostics?.record('window.created', {
    bounds: fitted,
    restored: fitted.restored,
    displayCount: displays.length,
    primaryWorkArea: primary.workArea,
    scaleFactor: primary.scaleFactor,
  });
  setTimeout(revealWindow, 1500).unref();
}

function registerIpc() {
  ipcMain.handle('burner:get-snapshot', () => publicSnapshot());
  ipcMain.handle('burner:install-bridge', async (event, selection = {}) => {
    trustedRenderer(event);
    if (!claude.installed) throw new Error('Claude Code is not installed. Install Claude Code 2.1.80 or newer first.');
    if (!claude.compatible) throw new Error(`Claude Code ${claude.version || ''} is too old. Version 2.1.80 or newer is required.`);
    if (!claude.loggedIn) throw new Error('Claude Code is signed out. Sign in first, then connect usage.');
    if (!claude.subscriptionAuth) throw new Error('Sign in to Claude Code with your Claude.ai subscription before connecting usage.');
    const chosenPlan = resolvePlanForInstall(claude.plan, state.plan, selection.maxMultiplier);
    const result = installStatusLine({
      sourceBinaryPath: bridgeBinaryPath(),
      userDataPath: app.getPath('userData'),
      plan: chosenPlan,
      maxMultiplier: chosenPlan === 'max20' ? 20 : chosenPlan === 'max5' ? 5 : null,
    });
    persist(setPlan(state, chosenPlan));
    bridge = statusLineState(app.getPath('userData'));
    await refreshUsageFromBridge();
    diagnostics?.record('usage.bridge-installed', { plan: chosenPlan, healthy: bridge.healthy });
    return { ok: true, result, snapshot: publicSnapshot() };
  });
  ipcMain.handle('burner:uninstall-bridge', (event) => {
    trustedRenderer(event);
    uninstallStatusLine({ userDataPath: app.getPath('userData') });
    bridge = statusLineState(app.getPath('userData'));
    rawUsage = null;
    usageProbe = { ...usageProbe, available: false, running: false, lastError: 'The Claude usage bridge is not connected.' };
    diagnostics?.record('usage.bridge-uninstalled');
    broadcast();
    return { ok: true };
  });
  ipcMain.handle('burner:start-claude-login', (event) => {
    trustedRenderer(event);
    return launchClaudeLogin();
  });
  ipcMain.handle('burner:open-claude-install', (event) => {
    trustedRenderer(event);
    diagnostics?.record('claude.install-docs-opened');
    return shell.openExternal('https://docs.anthropic.com/en/docs/claude-code/setup');
  });
  ipcMain.handle('burner:refresh-usage', async (event) => {
    trustedRenderer(event);
    await refreshUsageFromBridge();
    return publicSnapshot();
  });
  ipcMain.handle('burner:reconnect-display', async (event) => {
    trustedRenderer(event);
    if (firmwareInstaller?.snapshot().running) {
      throw new Error('Firmware installation is in progress. Keep the cable connected until verification finishes.');
    }
    const previousPath = serial.path;
    latestConnection = { connected: false, path: null, message: 'Reclaiming the CYD USB connection…' };
    broadcast();
    await streamer.pause();
    try {
      const result = await serial.forceReconnect(previousPath);
      streamer.requestKeyframe();
      latestConnection = { connected: true, path: result.path, message: 'CYD display connected' };
      diagnostics?.record('serial.reconnect-complete', { path: result.path, attempts: result.attempts });
      broadcast();
      return {
        ok: true,
        path: result.path,
        attempts: result.attempts,
        reclaimed: result.reclaimed.map(({ pid, command }) => ({ pid, command })),
      };
    } catch (error) {
      latestConnection = {
        connected: false,
        path: previousPath || null,
        message: error.message,
        code: error.code || 'CONNECT_FAILED',
        recovery: error.recovery || error.details?.recovery || null,
      };
      diagnostics?.record('serial.reconnect-failed', {
        code: error.code,
        message: error.message,
        details: error.details,
      });
      broadcast();
      if (error.code === 'FIRMWARE_REQUIRED') await scanFirstConnect();
      throw error;
    } finally {
      streamer.resume();
    }
  });
  ipcMain.handle('burner:firmware-scan', async (event) => {
    trustedRenderer(event);
    return firmwareInstaller.scan();
  });
  ipcMain.handle('burner:firmware-install', async (event, selection = {}) => {
    trustedRenderer(event);
    if (selection.confirmed !== true) throw new Error('Firmware installation requires explicit confirmation.');
    latestConnection = {
      connected: false,
      path: selection.port || firmwareInstaller.snapshot().port || null,
      message: 'Installing verified firmware…',
    };
    broadcast();
    try {
      const result = await firmwareInstaller.flash(selection.port || null, {
        provision: selection.provision === true,
        confirmedBoardFamily: selection.confirmedBoardFamily || null,
      });
      latestConnection = result.connected === false
        ? { connected: false, path: result.port, message: result.message }
        : { connected: true, path: result.port, message: 'CYD firmware installed and display connected' };
      broadcast();
      return result;
    } catch (error) {
      latestConnection = { connected: serial.connected, path: serial.path, message: error.message };
      broadcast();
      throw error;
    }
  });
  ipcMain.handle('burner:first-connect-authorize', async (event, selection = {}) => {
    trustedRenderer(event);
    if (selection.confirmed !== true || selection.boardFamily !== 'ESP32-2432S028') {
      throw new Error('Confirm that the connected board is an ESP32-2432S028 CYD.');
    }
    if (firstConnect.phase !== 'authorization-needed' || !firstConnect.port) {
      throw new Error('The first-connect CYD target changed. Rescan before installing.');
    }
    if (selection.port !== firstConnect.port) throw new Error('The selected USB port changed. Rescan before installing.');
    firstConnectProvisioning = true;
    firstConnectDismissedPort = null;
    updateFirstConnect({
      phase: 'identifying', running: true, progress: 2,
      message: 'Inspecting the exact ESP32, flash capacity, MAC, and security state…', lastError: null,
    });
    try {
      const result = await firmwareInstaller.flash(firstConnect.port, {
        provision: true,
        confirmedBoardFamily: 'ESP32-2432S028',
      });
      if (!result.installed || !result.connected) {
        throw new Error(result.lastError || 'Firmware was written but the Claude Burner display did not verify after reboot.');
      }
      updateFirstConnect({
        phase: 'complete', running: false, progress: 100,
        port: result.port, firmwareVersion: result.firmwareVersion,
        deviceMac: result.device?.mac || result.deviceMac || null,
        message: 'Firmware verified. Ember is live on the CYD display.', lastError: null,
      });
      setTimeout(() => {
        if (firstConnect.phase === 'complete') {
          updateFirstConnect({ phase: 'idle', running: false, message: 'Claude Burner display is ready.' });
        }
      }, 2_200).unref();
      return { ok: true, result, snapshot: publicSnapshot() };
    } catch (error) {
      updateFirstConnect({
        phase: 'failed', running: false,
        progress: Math.max(0, Number(firmwareInstaller.snapshot().progress) || 0),
        message: error.message, lastError: error.message,
      });
      throw error;
    } finally {
      firstConnectProvisioning = false;
    }
  });
  ipcMain.handle('burner:first-connect-retry', async (event) => {
    trustedRenderer(event);
    firstConnectDismissedPort = null;
    updateFirstConnect({ phase: 'scanning', running: false, progress: 0, message: 'Scanning for the CYD again…', lastError: null });
    await scanFirstConnect();
    return publicSnapshot();
  });
  ipcMain.handle('burner:first-connect-dismiss', (event) => {
    trustedRenderer(event);
    if (firstConnect.running) throw new Error('Keep the app open until firmware verification finishes.');
    firstConnectDismissedPort = firstConnect.port;
    updateFirstConnect({ phase: 'idle', running: false, progress: 0, message: 'Automatic setup was skipped for this USB connection.', lastError: null });
    return publicSnapshot();
  });
  ipcMain.handle('burner:set-plan', async (event, selection) => {
    trustedRenderer(event);
    if (!selection || !['free', 'pro', 'max'].includes(selection.plan)) throw new Error('Choose a supported Claude plan.');
    const chosen = selection.plan === 'max'
      ? (Number(selection.maxMultiplier) === 20 ? 'max20' : 'max5')
      : selection.plan;
    persist(setPlan(state, chosen, selection.maxMultiplier));
    updateBridgePlan(app.getPath('userData'), state.plan, state.maxMultiplier);
    await refreshUsageFromBridge();
    return publicSnapshot();
  });
  ipcMain.handle('burner:set-manual-life', (event, life) => {
    trustedRenderer(event);
    if (state.plan !== 'free') throw new Error('Manual LIFE is available only in Free/demo mode.');
    persist(applyManualLife(state, life));
    return publicSnapshot();
  });
  ipcMain.handle('burner:set-simulation-usage', (event, usagePct) => {
    trustedRenderer(event);
    const normalizedUsage = Math.max(0, Math.min(100, Number(usagePct) || 0));
    const basis = simulation?.state || state;
    simulation = {
      usagePct: normalizedUsage,
      state: simulatedStateForUsage(basis, normalizedUsage),
    };
    broadcast();
    return publicSnapshot();
  });
  ipcMain.handle('burner:clear-simulation', (event) => {
    trustedRenderer(event);
    simulation = null;
    streamer.requestKeyframe();
    broadcast();
    return publicSnapshot();
  });
  ipcMain.handle('burner:open-privacy-settings', (event) => {
    trustedRenderer(event);
    return shell.openExternal('x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension');
  });
  ipcMain.handle('burner:copy-diagnostics', (event) => {
    trustedRenderer(event);
    const primary = screen.getPrimaryDisplay();
    const report = diagnostics?.text({
      appVersion: app.getVersion(),
      electron: process.versions.electron,
      node: process.versions.node,
      platform: process.platform,
      arch: process.arch,
      workArea: primary.workArea,
      scaleFactor: primary.scaleFactor,
      claude: {
        installed: claude.installed, version: claude.version, authState: claude.authState,
        subscriptionAuth: claude.subscriptionAuth,
      },
      bridge: { installed: bridge.installed, healthy: bridge.healthy, lastSnapshotAt: bridge.lastSnapshotAt },
      connection: latestConnection,
      firmware: firmwareInstaller?.snapshot(),
    }) || 'Claude Burner diagnostics are not available yet.';
    clipboard.writeText(report);
    diagnostics?.record('diagnostics.copied');
    return { ok: true, eventCount: diagnostics?.events.length || 0 };
  });
  ipcMain.handle('burner:open-frame-folders', (event) => {
    trustedRenderer(event);
    if (app.isPackaged) return shell.openExternal('https://drive.google.com/drive/folders/1D26XOvX8tYM6Z-lRShN7MrlQ4q1kdVdV');
    return shell.openPath(path.join(
      __dirname,
      '..',
      '..',
      'ember_animations',
      'growth-emotion-v2',
      'production-v2',
      'frames',
    ));
  });
  ipcMain.handle('burner:scene-data-url', (event, scene) => {
    trustedRenderer(event);
    const safeScene = String(scene).replace(/[^a-z0-9_]/g, '');
    const relativePreview = animations.previewFile(safeScene);
    const preview = relativePreview ? path.join(assetsPath(), relativePreview) : null;
    if (preview && fs.existsSync(preview)) {
      return `data:image/gif;base64,${fs.readFileSync(preview).toString('base64')}`;
    }
    const fallback = path.join(assetsPath(), 'scenes', `${safeScene}.png`);
    if (!fs.existsSync(fallback)) return null;
    return `data:image/png;base64,${fs.readFileSync(fallback).toString('base64')}`;
  });
}

if (hasSingleInstanceLock) app.whenReady().then(async () => {
  const userDataPath = app.getPath('userData');
  app.setAppLogsPath();
  diagnostics = new Diagnostics(app.getPath('logs'), {
    appVersion: app.getVersion(),
    electron: process.versions.electron,
    platform: process.platform,
    arch: process.arch,
  });
  diagnostics.record('app.ready', { packaged: app.isPackaged, userDataPath });
  store = new StateStore(userDataPath);
  state = store.load();
  animations = new AnimationPack(assetsPath());
  serial = new SerialManager();
  streamer = new StreamController(serial, animations, () => ({
    state: simulation?.state || state,
    claudeReady: Boolean(simulation) || state.plan === 'free' || Boolean(rawUsage && !rawUsage.stale),
  }));
  firmwareInstaller = new FirmwareInstaller({
    serial,
    streamer,
    resources: resolveFirmwareResources({
      packaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
      projectRoot: path.join(__dirname, '..'),
    }),
  });
  firmwareInstaller.on('status', (firmwareStatus) => {
    diagnostics?.record('firmware.state', {
      phase: firmwareStatus.phase,
      progress: firmwareStatus.progress,
      running: firmwareStatus.running,
      port: firmwareStatus.port,
      error: firmwareStatus.lastError,
    });
    if (firmwareStatus.running) {
      latestConnection = {
        connected: false,
        path: firmwareStatus.port,
        message: firmwareStatus.message,
      };
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('burner:firmware-status', firmwareStatus);
    }
    if (firstConnectProvisioning) {
      const phaseMap = {
        preparing: 'identifying', identifying: 'identifying', flashing: 'flashing',
        reconnecting: 'verifying', complete: 'complete', failed: 'failed',
        'verification-pending': 'failed',
      };
      updateFirstConnect({
        phase: phaseMap[firmwareStatus.phase] || firstConnect.phase,
        running: Boolean(firmwareStatus.running),
        progress: Number(firmwareStatus.progress) || 0,
        port: firmwareStatus.port || firstConnect.port,
        firmwareVersion: firmwareStatus.firmwareVersion || firstConnect.firmwareVersion,
        deviceMac: firmwareStatus.deviceMac || firstConnect.deviceMac || null,
        message: firmwareStatus.message || firstConnect.message,
        lastError: firmwareStatus.lastError || null,
      });
    }
    broadcast();
    if (!firmwareStatus.running && quitRequestedDuringFirmware) {
      quitRequestedDuringFirmware = false;
      setImmediate(() => app.quit());
    }
  });
  serial.on('connected', ({ path: devicePath }) => {
    diagnostics?.record('serial.connected', { path: devicePath });
    latestConnection = { connected: true, path: devicePath, message: 'CYD display connected' };
    if (!firstConnectProvisioning) {
      updateFirstConnect({ phase: 'idle', running: false, progress: 100, port: devicePath, message: 'Claude Burner display is ready.', lastError: null });
    }
    broadcast();
  });
  serial.on('disconnected', (details = {}) => {
    diagnostics?.record('serial.disconnected', details);
    latestConnection = { connected: false, path: null, message: 'CYD display disconnected' };
    broadcast();
  });
  streamer.on('connection', (connection) => {
    latestConnection = connection.connected
      ? { connected: true, path: connection.path, message: 'CYD display connected' }
      : { connected: false, path: null, message: connection.error || 'Searching for the CYD display…' };
    broadcast();
  });
  streamer.on('stream-error', (error) => {
    latestConnection = {
      connected: false,
      path: serial?.path || null,
      message: error.message,
      code: error.code || 'STREAM_ERROR',
      recovery: error.recovery || error.details?.recovery || null,
    };
    diagnostics?.record('stream.error', { code: error.code, message: error.message, details: error.details });
    broadcast();
    if (error.code === 'FIRMWARE_REQUIRED') scanFirstConnect();
  });
  registerIpc();
  createWindow();
  await refreshClaude();
  // Existing users already consented to the reversible bridge install. Keep
  // that bridge current so reliability fixes do not require re-onboarding.
  try {
    upgradeInstalledBridge();
  } catch (error) {
    console.warn(`Could not refresh the Claude Burner bridge: ${error.message}`);
  }
  pollUsageAndDecay();
  startUsageWatchers(userDataPath);
  setInterval(pollUsageAndDecay, 5_000).unref();
  setInterval(refreshClaude, 60_000).unref();
  streamer.start();
  // Give an already-provisioned Burner time to complete its HELLO handshake.
  // Only a still-unclaimed exact VID/PID device is offered for first setup.
  setTimeout(() => {
    scanFirstConnect();
    setInterval(scanFirstConnect, 5_000).unref();
  }, 3_500).unref();
});

app.on('second-instance', () => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  } else if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
});

app.on('before-quit', (event) => {
  if (firmwareInstaller?.snapshot().running) {
    event.preventDefault();
    quitRequestedDuringFirmware = true;
    firmwareInstaller.update({
      message: 'Finishing and verifying firmware before Claude Burner quits. Keep the USB cable connected.',
    });
    return;
  }
  stopUsageWatchers();
  stopClaudeLoginMonitor();
  if (windowStateWriteTimer) clearTimeout(windowStateWriteTimer);
  windowStateWriteTimer = null;
  streamer?.stop();
  if (store && state) store.save(state);
  if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isMinimized() && !mainWindow.isFullScreen()) {
    writeWindowState(mainWindow.getBounds());
  }
  diagnostics?.record('app.quit');
  serial?.disconnect().catch(() => {});
});
