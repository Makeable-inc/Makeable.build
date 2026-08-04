'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, ipcMain, shell, nativeTheme } = require('electron');
const { StateStore } = require('./state-store');
const {
  applyDecay,
  applyUsageSnapshot,
  applyManualLife,
  setPlan,
  simulatedLifeForUsage,
} = require('./pet-engine');
const {
  detectClaude,
  installStatusLine,
  updateBridgePlan,
  uninstallStatusLine,
  statusLineState,
  readUsageSnapshot,
} = require('./claude-integration');
const { SerialManager } = require('./serial-manager');
const { AnimationPack } = require('./animation-pack');
const { StreamController } = require('./stream-controller');

app.setName('Claude Burner');

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();

let mainWindow = null;
let store;
let state;
let claude = { installed: false, compatible: false, loggedIn: false, plan: 'free' };
let bridge = { installed: false, hooksDisabled: false };
let rawUsage = null;
let serial;
let animations;
let streamer;
let latestConnection = { connected: false, path: null, message: 'Searching for the CYD display…' };
let lastStateWriteAt = 0;
let simulation = null;

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
  return {
    state: { ...displayState, life: Math.round(displayState.life * 10) / 10 },
    liveState: { ...state, life: Math.round(state.life * 10) / 10 },
    claude,
    bridge,
    usage: displayUsage,
    usageFresh,
    simulation: simulation
      ? { active: true, usagePct: simulation.usagePct, liveLife: Math.round(state.life * 10) / 10 }
      : { active: false, usagePct: null, liveLife: Math.round(state.life * 10) / 10 },
    connection: latestConnection,
    streamStats: streamer?.stats || null,
    scene: animations?.sceneForEmotion(displayState.emotion) || 'lv1_dormant',
    needsMaxChoice: claude.plan === 'max' && !['max5', 'max20'].includes(state.plan),
  };
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
  claude = await detectClaude();
  bridge = statusLineState(app.getPath('userData'));
  // subscriptionType can be stale or less specific than the billing plan.
  // Seed only a fresh installation; never overwrite a persisted user choice.
  if (!bridge.installed && state.plan === 'free' && claude.plan === 'pro') {
    persist(setPlan(state, 'pro'));
  }
  broadcast();
}

function pollUsageAndDecay() {
  const snapshot = readUsageSnapshot(app.getPath('userData'));
  const priorAward = state.windowLifeAwarded;
  const priorUsageCapture = state.lastUsageCapturedAt;
  let next = applyDecay(state, Date.now());
  if (snapshot && !snapshot.stale) {
    rawUsage = snapshot;
    next = applyUsageSnapshot(next, snapshot);
  } else {
    rawUsage = snapshot;
  }
  const usageChanged = next.windowLifeAwarded !== priorAward || next.lastUsageCapturedAt !== priorUsageCapture;
  persist(next, usageChanged);
}

function createWindow() {
  nativeTheme.themeSource = 'dark';
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 920,
    minHeight: 650,
    title: 'Claude Burner',
    backgroundColor: '#080b12',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.setSize(1100, 760);
  mainWindow.center();
  let revealed = false;
  const revealWindow = () => {
    if (revealed || !mainWindow || mainWindow.isDestroyed()) return;
    revealed = true;
    mainWindow.setSize(1100, 760);
    mainWindow.center();
    mainWindow.show();
    mainWindow.focus();
  };
  // Large animated GIFs can delay or suppress ready-to-show in some Electron
  // builds. did-finish-load proves the UI is usable; the timer is a final
  // guarantee that the app cannot remain as a hidden background process.
  mainWindow.once('ready-to-show', revealWindow);
  mainWindow.webContents.once('did-finish-load', revealWindow);
  mainWindow.loadFile(path.join(__dirname, '..', 'ui', 'index.html'));
  setTimeout(revealWindow, 1500).unref();
}

function registerIpc() {
  ipcMain.handle('burner:get-snapshot', () => publicSnapshot());
  ipcMain.handle('burner:install-bridge', async (_event, selection = {}) => {
    if (!claude.installed) throw new Error('Claude Code is not installed. Install Claude Code 2.1.80 or newer first.');
    if (!claude.compatible) throw new Error(`Claude Code ${claude.version || ''} is too old. Version 2.1.80 or newer is required.`);
    const chosenPlan = claude.plan === 'max'
      ? (Number(selection.maxMultiplier) === 20 ? 'max20' : 'max5')
      : claude.plan;
    const result = installStatusLine({
      sourceBinaryPath: bridgeBinaryPath(),
      userDataPath: app.getPath('userData'),
      plan: chosenPlan,
      maxMultiplier: chosenPlan === 'max20' ? 20 : chosenPlan === 'max5' ? 5 : null,
    });
    persist(setPlan(state, chosenPlan));
    bridge = statusLineState(app.getPath('userData'));
    return { ok: true, result, snapshot: publicSnapshot() };
  });
  ipcMain.handle('burner:uninstall-bridge', () => {
    uninstallStatusLine({ userDataPath: app.getPath('userData') });
    bridge = statusLineState(app.getPath('userData'));
    broadcast();
    return { ok: true };
  });
  ipcMain.handle('burner:reconnect-display', async () => {
    const previousPath = serial.path;
    latestConnection = { connected: false, path: null, message: 'Reclaiming the CYD USB connection…' };
    broadcast();
    await streamer.pause();
    try {
      const result = await serial.forceReconnect(previousPath);
      streamer.requestKeyframe();
      latestConnection = { connected: true, path: result.path, message: 'CYD display connected' };
      broadcast();
      return {
        ok: true,
        path: result.path,
        attempts: result.attempts,
        reclaimed: result.reclaimed.map(({ pid, command }) => ({ pid, command })),
      };
    } catch (error) {
      latestConnection = { connected: false, path: null, message: error.message };
      broadcast();
      throw error;
    } finally {
      streamer.resume();
    }
  });
  ipcMain.handle('burner:set-plan', (_event, selection) => {
    const chosen = selection.plan === 'max'
      ? (Number(selection.maxMultiplier) === 20 ? 'max20' : 'max5')
      : selection.plan;
    persist(setPlan(state, chosen, selection.maxMultiplier));
    updateBridgePlan(app.getPath('userData'), state.plan, state.maxMultiplier);
    return publicSnapshot();
  });
  ipcMain.handle('burner:set-manual-life', (_event, life) => {
    if (state.plan !== 'free') throw new Error('Manual LIFE is available only in Free/demo mode.');
    persist(applyManualLife(state, life));
    return publicSnapshot();
  });
  ipcMain.handle('burner:set-simulation-usage', (_event, usagePct) => {
    const normalizedUsage = Math.max(0, Math.min(100, Number(usagePct) || 0));
    const basis = simulation?.state || state;
    const simulatedLife = simulatedLifeForUsage(state.plan, state.maxMultiplier, normalizedUsage);
    simulation = {
      usagePct: normalizedUsage,
      state: applyManualLife(basis, simulatedLife),
    };
    broadcast();
    return publicSnapshot();
  });
  ipcMain.handle('burner:clear-simulation', () => {
    simulation = null;
    streamer.requestKeyframe();
    broadcast();
    return publicSnapshot();
  });
  ipcMain.handle('burner:open-privacy-settings', () => shell.openExternal('x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension'));
  ipcMain.handle('burner:open-frame-folders', () => {
    if (app.isPackaged) return shell.openExternal('https://drive.google.com/drive/folders/1D26XOvX8tYM6Z-lRShN7MrlQ4q1kdVdV');
    return shell.openPath(path.join(__dirname, '..', '..', 'ember_growth_visuals', 'final-v1', 'frame_folders_320x240_48fps'));
  });
  ipcMain.handle('burner:scene-data-url', (_event, scene) => {
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
  store = new StateStore(userDataPath);
  state = store.load();
  animations = new AnimationPack(assetsPath());
  serial = new SerialManager();
  streamer = new StreamController(serial, animations, () => ({
    state: simulation?.state || state,
    claudeReady: Boolean(simulation) || state.plan === 'free' || Boolean(bridge.installed && rawUsage && !rawUsage.stale),
  }));
  serial.on('connected', ({ path: devicePath }) => {
    latestConnection = { connected: true, path: devicePath, message: 'CYD display connected' };
    broadcast();
  });
  serial.on('disconnected', () => {
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
    latestConnection = { connected: false, path: null, message: error.message };
    broadcast();
  });
  registerIpc();
  createWindow();
  await refreshClaude();
  pollUsageAndDecay();
  setInterval(pollUsageAndDecay, 1000).unref();
  setInterval(refreshClaude, 60_000).unref();
  streamer.start();
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

app.on('before-quit', () => {
  streamer?.stop();
  if (store && state) store.save(state);
  serial?.disconnect().catch(() => {});
});
