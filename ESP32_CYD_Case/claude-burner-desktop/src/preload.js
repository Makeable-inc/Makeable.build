'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('claudeBurner', {
  getSnapshot: () => ipcRenderer.invoke('burner:get-snapshot'),
  installBridge: (selection) => ipcRenderer.invoke('burner:install-bridge', selection),
  uninstallBridge: () => ipcRenderer.invoke('burner:uninstall-bridge'),
  reconnectDisplay: () => ipcRenderer.invoke('burner:reconnect-display'),
  setPlan: (plan, maxMultiplier) => ipcRenderer.invoke('burner:set-plan', { plan, maxMultiplier }),
  setManualLife: (life) => ipcRenderer.invoke('burner:set-manual-life', life),
  setSimulationUsage: (usagePct) => ipcRenderer.invoke('burner:set-simulation-usage', usagePct),
  clearSimulation: () => ipcRenderer.invoke('burner:clear-simulation'),
  openPrivacySettings: () => ipcRenderer.invoke('burner:open-privacy-settings'),
  openFrameFolders: () => ipcRenderer.invoke('burner:open-frame-folders'),
  sceneDataUrl: (scene) => ipcRenderer.invoke('burner:scene-data-url', scene),
  onSnapshot: (callback) => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on('burner:snapshot', listener);
    return () => ipcRenderer.removeListener('burner:snapshot', listener);
  },
});
