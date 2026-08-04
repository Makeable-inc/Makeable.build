'use strict';

const elements = Object.fromEntries([
  'connection-pill', 'connection-label', 'scene-preview', 'life-value', 'level-value', 'life-fill',
  'waiting-overlay', 'emotion-value', 'plan-chip', 'usage-value', 'usage-fill', 'usage-status',
  'reset-time', 'setup-panel', 'live-panel', 'demo-panel', 'max-choice', 'install-bridge',
  'claude-version', 'bridge-status', 'display-status', 'manual-life', 'manual-output', 'toast',
  'plan-select', 'save-plan',
  'sim-usage', 'sim-output', 'sim-life-output', 'sim-state', 'return-live',
].map((id) => [id, document.getElementById(id)]));

let latest = null;
let currentScene = null;
let toastTimer = null;
let simulationSequence = 0;
let sceneRequestSequence = 0;

function titleCase(value) {
  return String(value || '').replaceAll('_', ' ').replace(/\b\w/g, (character) => character.toUpperCase());
}

function lifeColor(life) {
  if (life <= 25) return `rgb(${112 + life * 3.5}, ${58 - life * .12}, ${61 - life * .9})`;
  if (life <= 70) return `rgb(${200 + (life - 25)}, ${55 + (life - 25) * 1.5}, ${38 - (life - 25) * .3})`;
  return `rgb(${244 + (life - 70) * .36}, ${122 + (life - 70) * 2.75}, ${24 + (life - 70) * 1.13})`;
}

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => elements.toast.classList.remove('visible'), 4200);
}

async function updateScene(scene) {
  if (scene === currentScene) return;
  currentScene = scene;
  const requestSequence = ++sceneRequestSequence;
  const data = await window.claudeBurner.sceneDataUrl(scene);
  if (data && requestSequence === sceneRequestSequence && scene === currentScene) {
    elements['scene-preview'].src = data;
  }
}

function render(snapshot) {
  latest = snapshot;
  const { state, connection, claude, bridge, usage, simulation } = snapshot;
  const life = Math.max(0, Math.min(100, state.life));
  elements['life-value'].textContent = `${Math.round(life)}%`;
  elements['level-value'].textContent = `LV.${state.level}`;
  elements['life-fill'].style.width = `${life}%`;
  elements['life-fill'].style.background = lifeColor(life);
  elements['emotion-value'].textContent = titleCase(state.emotion);
  updateScene(snapshot.scene);

  elements['connection-pill'].classList.toggle('connected', connection.connected);
  elements['connection-label'].textContent = connection.connected ? 'Display online' : 'Display offline';
  elements['display-status'].textContent = connection.connected ? connection.path : connection.message;
  elements['plan-chip'].textContent = state.plan === 'max5' ? 'Max 5×' : state.plan === 'max20' ? 'Max 20×' : state.plan;
  elements['plan-select'].value = state.plan;

  const ready = state.plan === 'free' || Boolean(snapshot.usageFresh && bridge.installed);
  elements['waiting-overlay'].classList.toggle('visible', !ready);
  if (ready) {
    const used = Math.round(Number(usage.fiveHourUsedPct));
    elements['usage-value'].textContent = `${used}%`;
    elements['usage-fill'].style.width = `${used}%`;
    elements['usage-status'].textContent = simulation.active
      ? 'Simulation preview · live LIFE is unchanged'
      : 'Claude activity is charging Ember';
    const reset = new Date(usage.resetsAt);
    elements['reset-time'].textContent = Number.isNaN(reset.valueOf()) ? '' : `resets ${reset.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
  } else {
    elements['usage-value'].textContent = '—';
    elements['usage-fill'].style.width = '0%';
    elements['usage-status'].textContent = bridge.installed ? 'Run Claude Code to receive usage' : 'Connect the status-line bridge';
    elements['reset-time'].textContent = '';
  }

  elements['setup-panel'].classList.toggle('hidden', bridge.installed);
  elements['live-panel'].classList.toggle('hidden', !bridge.installed);
  elements['demo-panel'].classList.toggle('hidden', state.plan !== 'free');
  elements['max-choice'].classList.toggle('hidden', claude.plan !== 'max');
  elements['bridge-status'].textContent = bridge.installed ? 'Active · private' : 'Not installed';
  elements['claude-version'].textContent = claude.installed
    ? `Claude Code ${claude.version} · ${claude.loggedIn ? 'signed in' : 'not signed in'}`
    : 'Claude Code was not found';
  elements['install-bridge'].disabled = !claude.installed || !claude.compatible || !claude.loggedIn;
  elements['manual-life'].value = Math.round(life);
  elements['manual-output'].textContent = `${Math.round(life)}%`;
  const displayedUsage = simulation.active
    ? Number(simulation.usagePct)
    : Math.max(0, Math.min(100, Number(usage?.fiveHourUsedPct) || 0));
  if (document.activeElement !== elements['sim-usage']) elements['sim-usage'].value = displayedUsage;
  elements['sim-output'].textContent = `${displayedUsage.toFixed(1)}%`;
  elements['sim-life-output'].textContent = `LIFE ${Math.round(life)}%`;
  elements['sim-state'].textContent = simulation.active
    ? `Simulating · live LIFE ${Math.round(simulation.liveLife)}%`
    : 'Live mode';
  elements['return-live'].disabled = !simulation.active;
}

async function perform(button, action) {
  button.disabled = true;
  try {
    return await action();
  } catch (error) {
    showToast(error.message || String(error));
    return null;
  } finally {
    button.disabled = false;
  }
}

elements['install-bridge'].addEventListener('click', () => perform(elements['install-bridge'], async () => {
  const selected = document.querySelector('input[name="max-plan"]:checked');
  const result = await window.claudeBurner.installBridge({ maxMultiplier: selected ? Number(selected.value) : null });
  render(result.snapshot);
  showToast('Claude Code connected. Usage appears after your next Claude response.');
}));

document.getElementById('reconnect-display').addEventListener('click', (event) => {
  const button = event.currentTarget;
  return perform(button, async () => {
  const previousLabel = button.textContent;
  button.textContent = 'Reclaiming USB…';
  try {
    const result = await window.claudeBurner.reconnectDisplay();
    const reclaimed = result.reclaimed?.length
      ? ` · reclaimed ${result.reclaimed.length} stale connection${result.reclaimed.length === 1 ? '' : 's'}`
      : '';
    showToast(`Display connected on ${result.path}${reclaimed}`);
  } finally {
    button.textContent = previousLabel;
  }
  });
});
document.getElementById('open-frames').addEventListener('click', () => window.claudeBurner.openFrameFolders());
document.getElementById('open-security').addEventListener('click', () => window.claudeBurner.openPrivacySettings());
elements['save-plan'].addEventListener('click', () => perform(elements['save-plan'], async () => {
  const selected = elements['plan-select'].value;
  const multiplier = selected === 'max20' ? 20 : selected === 'max5' ? 5 : null;
  render(await window.claudeBurner.setPlan(selected, multiplier));
  const label = selected === 'max20' ? 'Max 20×' : selected === 'max5' ? 'Max 5×' : 'Pro';
  showToast(`Plan saved as ${label}.`);
}));
async function sendSimulationUsage(value) {
  const sequence = ++simulationSequence;
  const snapshot = await window.claudeBurner.setSimulationUsage(value);
  if (sequence === simulationSequence) render(snapshot);
}

elements['sim-usage'].addEventListener('input', () => {
  const value = Number(elements['sim-usage'].value);
  elements['sim-output'].textContent = `${value.toFixed(1)}%`;
  sendSimulationUsage(value).catch((error) => showToast(error.message));
});
elements['sim-usage'].addEventListener('wheel', (event) => {
  event.preventDefault();
  const increment = event.shiftKey ? 1 : 0.1;
  const direction = event.deltaY < 0 ? 1 : -1;
  const next = Math.max(0, Math.min(100, Number(elements['sim-usage'].value) + direction * increment));
  elements['sim-usage'].value = next.toFixed(1);
  elements['sim-usage'].dispatchEvent(new Event('input', { bubbles: true }));
}, { passive: false });
elements['return-live'].addEventListener('click', () => perform(elements['return-live'], async () => {
  simulationSequence += 1;
  render(await window.claudeBurner.clearSimulation());
  showToast('Returned to live Claude usage.');
}));
elements['manual-life'].addEventListener('input', () => { elements['manual-output'].textContent = `${elements['manual-life'].value}%`; });
elements['manual-life'].addEventListener('change', async () => render(await window.claudeBurner.setManualLife(Number(elements['manual-life'].value))));

window.claudeBurner.onSnapshot(render);
window.claudeBurner.getSnapshot().then(render).catch((error) => showToast(error.message));
