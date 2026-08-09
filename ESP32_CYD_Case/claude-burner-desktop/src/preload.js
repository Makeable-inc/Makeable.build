'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('claudeBurner', {
  getSnapshot: () => ipcRenderer.invoke('burner:get-snapshot'),
  installBridge: (selection) => ipcRenderer.invoke('burner:install-bridge', selection),
  uninstallBridge: () => ipcRenderer.invoke('burner:uninstall-bridge'),
  startClaudeLogin: () => ipcRenderer.invoke('burner:start-claude-login'),
  openClaudeInstall: () => ipcRenderer.invoke('burner:open-claude-install'),
  refreshUsage: () => ipcRenderer.invoke('burner:refresh-usage'),
  reconnectDisplay: () => ipcRenderer.invoke('burner:reconnect-display'),
  scanFirmwareDevice: () => ipcRenderer.invoke('burner:firmware-scan'),
  installFirmware: (selection) => ipcRenderer.invoke('burner:firmware-install', selection),
  authorizeFirstConnect: (selection) => ipcRenderer.invoke('burner:first-connect-authorize', selection),
  retryFirstConnect: () => ipcRenderer.invoke('burner:first-connect-retry'),
  dismissFirstConnect: () => ipcRenderer.invoke('burner:first-connect-dismiss'),
  onFirmwareStatus: (listener) => {
    const handler = (_event, status) => listener(status);
    ipcRenderer.on('burner:firmware-status', handler);
    return () => ipcRenderer.removeListener('burner:firmware-status', handler);
  },
  onFirstConnectStatus: (listener) => {
    const handler = (_event, status) => listener(status);
    ipcRenderer.on('burner:first-connect-status', handler);
    return () => ipcRenderer.removeListener('burner:first-connect-status', handler);
  },
  setPlan: (plan, maxMultiplier) => ipcRenderer.invoke('burner:set-plan', { plan, maxMultiplier }),
  setManualLife: (life) => ipcRenderer.invoke('burner:set-manual-life', life),
  setSimulationUsage: (usagePct) => ipcRenderer.invoke('burner:set-simulation-usage', usagePct),
  clearSimulation: () => ipcRenderer.invoke('burner:clear-simulation'),
  openPrivacySettings: () => ipcRenderer.invoke('burner:open-privacy-settings'),
  copyDiagnostics: () => ipcRenderer.invoke('burner:copy-diagnostics'),
  openFrameFolders: () => ipcRenderer.invoke('burner:open-frame-folders'),
  sceneDataUrl: (scene) => ipcRenderer.invoke('burner:scene-data-url', scene),
  onSnapshot: (callback) => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on('burner:snapshot', listener);
    return () => ipcRenderer.removeListener('burner:snapshot', listener);
  },
});
