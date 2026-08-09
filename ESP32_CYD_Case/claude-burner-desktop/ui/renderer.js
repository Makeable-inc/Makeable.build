'use strict';

/* ------------------------------------------------------------------
   The renderer consumes the shared animation catalog when the desktop
   process exposes one. This generated fallback keeps an older preload
   usable during an in-place upgrade without reintroducing a parallel,
   hand-maintained 15-scene table.
------------------------------------------------------------------ */
const SIZE_FAMILIES = [
  { key: 'small', level: 1, label: 'Small' },
  { key: 'medium', level: 2, label: 'Medium' },
  { key: 'large', level: 3, label: 'Large' },
];
const EMOTION_FAMILIES = [
  { key: 'moody', label: 'Moody', theme: { primary: '#182948', secondary: '#6682ad', base: '#0c1526' } },
  { key: 'hopeful', label: 'Hopeful', theme: { primary: '#33476f', secondary: '#ab89a3', base: '#141827' } },
  { key: 'cheerful', label: 'Cheerful', theme: { primary: '#5b3e43', secondary: '#da9166', base: '#211519' } },
  { key: 'excited', label: 'Excited', theme: { primary: '#773817', secondary: '#f09a39', base: '#281007' } },
  { key: 'explosion', label: 'Explosion', theme: { primary: '#9a3108', secondary: '#ffc34c', base: '#330b02' } },
];
const SHARE_QUOTES = {
  moody: ['Clocked out. Coal mode.', 'Low flame. Still iconic.', 'The grind can wait.'],
  hopeful: ['Small spark. Big comeback.', 'The comeback tab is open.', 'Plot development detected.'],
  cheerful: ['Calm flame. Serious tabs.', 'Locked in, allegedly.', 'Quiet burn, visible progress.'],
  excited: ['Work done. Ember upgraded.', 'The glow is getting louder.', 'Built different. Burning brighter.'],
  explosion: ['Maximum Ember behavior.', 'The volcano has entered the chat.', 'Full send. Full flame.'],
};
const LEGACY_EMOTIONS = {
  dormant: 'moody', exhausted: 'moody', sad_puppy: 'moody', worried_gloomy: 'moody', tired_concerned: 'moody',
  curious_hopeful: 'hopeful', neutral_attentive: 'cheerful', happy_confident: 'cheerful',
  energized: 'excited', supercharged: 'explosion',
};
const SIZE_BY_LEVEL = Object.fromEntries(SIZE_FAMILIES.map((size) => [size.level, size.key]));
const LEVEL_BY_SIZE = Object.fromEntries(SIZE_FAMILIES.map((size) => [size.key, size.level]));
const EMOTION_BY_KEY = Object.fromEntries(EMOTION_FAMILIES.map((emotion) => [emotion.key, emotion]));
const FALLBACK_CATALOG = SIZE_FAMILIES.flatMap((size) => EMOTION_FAMILIES.map((emotion) => ({
  key: `${size.key}_${emotion.key}`,
  size: size.key,
  level: size.level,
  emotion: emotion.key,
  label: `${size.label} · ${emotion.label}`,
  theme: emotion.theme,
  artwork: `scenes/${size.key}_${emotion.key}.png`,
})));
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;

const el = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const titleCase = (v) => String(v || '').replaceAll('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase());
const formatEnergy = (value, pad = false) => {
  const visible = Math.floor((clamp(Number(value) || 0, 0, 100) + Number.EPSILON) * 10) / 10;
  const formatted = Number.isInteger(visible) ? String(visible) : visible.toFixed(1);
  return pad && visible < 10 && Number.isInteger(visible) ? formatted.padStart(2, '0') : formatted;
};

function normalizeEmotion(value) {
  const key = String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (EMOTION_BY_KEY[key]) return key;
  return LEGACY_EMOTIONS[key] || 'moody';
}

function normalizeSize(value, level) {
  const key = String(value || '').trim().toLowerCase();
  if (LEVEL_BY_SIZE[key]) return key;
  return SIZE_BY_LEVEL[clamp(Math.round(Number(level) || 1), 1, 3)] || 'small';
}

function normalizeTheme(theme, emotion) {
  const fallback = EMOTION_BY_KEY[emotion]?.theme || EMOTION_BY_KEY.moody.theme;
  const colors = Array.isArray(theme) ? theme : null;
  return {
    primary: colors?.[0] || theme?.primary || theme?.moodPrimary || theme?.background || fallback.primary,
    secondary: colors?.[1] || theme?.secondary || theme?.moodSecondary || theme?.glow || fallback.secondary,
    base: colors?.[2] || theme?.base || theme?.moodBase || theme?.shadow || fallback.base,
  };
}

function normalizeCatalogEntry(entry, suppliedKey) {
  const candidateKey = String(entry?.key || entry?.id || suppliedKey || '').trim().toLowerCase();
  const keyMatch = candidateKey.match(/^(small|medium|large)_(moody|hopeful|cheerful|excited|explosion)$/);
  const legacyMatch = candidateKey.match(/^lv([123])_(.+)$/);
  const level = Number(entry?.level) || Number(legacyMatch?.[1]) || LEVEL_BY_SIZE[entry?.size];
  const size = normalizeSize(entry?.size || keyMatch?.[1], level);
  const emotion = normalizeEmotion(entry?.emotion || keyMatch?.[2] || legacyMatch?.[2]);
  const key = `${size}_${emotion}`;
  const sourceKey = entry?.sourceKey || candidateKey || key;
  const sizeLabel = SIZE_FAMILIES.find((item) => item.key === size)?.label || titleCase(size);
  const emotionLabel = EMOTION_BY_KEY[emotion]?.label || titleCase(emotion);
  return {
    ...entry,
    key,
    size,
    level: LEVEL_BY_SIZE[size],
    emotion,
    sourceKey,
    label: entry?.label || entry?.name || `${sizeLabel} · ${emotionLabel}`,
    theme: normalizeTheme(entry?.theme, emotion),
    artwork: entry?.artwork || entry?.anchorFile || entry?.poster || entry?.staticAnchor
      || (typeof entry?.anchor === 'string' ? entry.anchor : `scenes/${sourceKey}.png`),
  };
}

function rawCatalogEntries(raw) {
  if (Array.isArray(raw)) return raw.map((entry) => [entry?.key, entry]);
  if (Array.isArray(raw?.states)) return raw.states.map((entry) => [entry?.key, entry]);
  if (Array.isArray(raw?.entries)) return raw.entries.map((entry) => [entry?.key, entry]);
  if (raw?.scenes && typeof raw.scenes === 'object') return Object.entries(raw.scenes);
  return [];
}

function catalogFromSnapshot(snapshot) {
  const raw = snapshot?.animationCatalog || snapshot?.catalog || snapshot?.animations?.catalog;
  const supplied = new Map(rawCatalogEntries(raw).map(([key, entry]) => {
    const normalized = normalizeCatalogEntry(entry, key);
    return [normalized.key, normalized];
  }));
  return FALLBACK_CATALOG.map((fallback) => normalizeCatalogEntry({
    ...fallback,
    ...(supplied.get(fallback.key) || {}),
    theme: supplied.get(fallback.key)?.theme || fallback.theme,
  }, fallback.key));
}

let sceneCatalog = FALLBACK_CATALOG;
let catalogIndex = new Map(sceneCatalog.map((scene) => [scene.key, scene]));
let catalogSignature = '';
function syncCatalog(snapshot) {
  const next = catalogFromSnapshot(snapshot);
  const signature = next.map((scene) => `${scene.key}:${scene.label}:${scene.artwork}:${JSON.stringify(scene.theme)}`).join('|');
  if (signature === catalogSignature) return;
  catalogSignature = signature;
  sceneCatalog = next;
  catalogIndex = new Map(next.map((scene) => [scene.key, scene]));
  unlockKey = null;
}

function sceneKeyForState(state, suppliedScene) {
  const direct = String(suppliedScene || '').trim().toLowerCase();
  if (catalogIndex.has(direct)) return direct;
  const legacy = direct.match(/^lv([123])_(.+)$/);
  const size = normalizeSize(state?.size || legacy?.[1], state?.level || legacy?.[1]);
  const emotion = normalizeEmotion(state?.emotion || legacy?.[2]);
  const key = `${size}_${emotion}`;
  return catalogIndex.has(key) ? key : 'small_moody';
}

function assetUrl(relative, fallbackKey) {
  const value = String(relative || `scenes/${fallbackKey}.png`).replaceAll('\\', '/');
  if (/^(data:|blob:)/.test(value) || value.startsWith('../') || value.startsWith('./')) return value;
  return value.startsWith('assets/') ? `../${value}` : `../assets/${value.replace(/^\/+/, '')}`;
}

/* ------------------------------------------------------------------
   Spring — Apple's damping + response. Retargeting keeps the current
   value and velocity, so motion is interruptible and reversible.
------------------------------------------------------------------ */
function spring({ response = 0.4, damping = 1, onUpdate }) {
  let value = 0, target = 0, vel = 0, raf = null, last = 0, zeta = damping;
  const w0 = (2 * Math.PI) / response;
  function frame(t) {
    const dt = Math.min((t - last) / 1000, 1 / 30);
    last = t;
    vel += (-w0 * w0 * (value - target) - 2 * zeta * w0 * vel) * dt;
    value += vel * dt;
    onUpdate(value);
    if (Math.abs(value - target) < 0.002 && Math.abs(vel) < 0.002) {
      value = target; vel = 0; onUpdate(value); raf = null; return;
    }
    raf = requestAnimationFrame(frame);
  }
  return {
    get value() { return value; },
    to(v, iv) {
      target = v;
      if (iv !== undefined) vel = iv;
      if (REDUCED) { value = v; vel = 0; onUpdate(v); return; }
      if (raf === null) { last = performance.now(); raf = requestAnimationFrame(frame); }
    },
    set(v) { if (raf) { cancelAnimationFrame(raf); raf = null; } value = target = v; vel = 0; onUpdate(v); },
    track(v) { if (raf) { cancelAnimationFrame(raf); raf = null; } value = target = v; onUpdate(v); },
    setDamping(d) { zeta = d; },
  };
}
const project = (v, d = 0.998) => (v / 1000) * d / (1 - d);
const rubberband = (o, dim, c = 0.55) => (o * dim * c) / (dim + c * Math.abs(o));

/* ---------------- heat: one variable, sampled off the artwork ---------------- */
const STOPS = [[0, [62, 84, 147]], [38, [150, 86, 86]], [62, [226, 105, 28]], [100, [255, 190, 74]]];
const mix = (a, b, t) => Math.round(a + (b - a) * t);
function heat(life) {
  const L = clamp(life, 0, 100);
  for (let i = 0; i < STOPS.length - 1; i += 1) {
    const [p0, c0] = STOPS[i]; const [p1, c1] = STOPS[i + 1];
    if (L <= p1) {
      const t = (L - p0) / (p1 - p0);
      return `rgb(${mix(c0[0], c1[0], t)},${mix(c0[1], c1[1], t)},${mix(c0[2], c1[2], t)})`;
    }
  }
  return 'rgb(255,190,74)';
}
const lighten = (c, a) => c.replace(/\d+/g, (m) => Math.min(255, Math.round(Number(m) + (255 - Number(m)) * a)));
function withAlpha(color, alpha) {
  const hex = String(color || '').match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (hex) return `rgba(${parseInt(hex[1], 16)},${parseInt(hex[2], 16)},${parseInt(hex[3], 16)},${alpha})`;
  const rgb = String(color || '').match(/^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/i);
  if (rgb) return `rgba(${rgb[1]},${rgb[2]},${rgb[3]},${alpha})`;
  return color;
}

/* ---------------- unlocked-emotion carousel ---------------- */
const emotionStrip = el('emotionStrip');
let unlockKey = null;
let lastCarouselScene = null;
function updateCarouselButtons() {
  const maximum = Math.max(0, emotionStrip.scrollWidth - emotionStrip.clientWidth);
  el('carouselPrev').disabled = emotionStrip.scrollLeft <= 2;
  el('carouselNext').disabled = emotionStrip.scrollLeft >= maximum - 2;
}
function unlockedSceneKeys(snapshot, activeScene) {
  const persisted = snapshot?.liveState?.unlockedStates
    ?? snapshot?.unlockedStates
    ?? (!snapshot?.simulation?.active ? snapshot?.state?.unlockedStates : null);
  let values = [];
  if (Array.isArray(persisted)) values = persisted;
  else if (persisted && typeof persisted === 'object') {
    values = Object.entries(persisted).filter(([, visited]) => Boolean(visited)).map(([key]) => key);
  }
  const normalized = new Set(['small_moody']);
  values.forEach((value) => {
    const raw = typeof value === 'string' ? value : value?.key;
    const key = sceneKeyForState(null, raw);
    if (catalogIndex.has(key)) normalized.add(key);
  });
  const liveSource = snapshot?.liveState || (!snapshot?.simulation?.active ? snapshot?.state : null);
  if (liveSource) {
    const liveScene = sceneKeyForState(liveSource, snapshot?.liveScene);
    if (catalogIndex.has(liveScene)) normalized.add(liveScene);
  }
  if (!snapshot?.simulation?.active && catalogIndex.has(activeScene)) normalized.add(activeScene);
  return normalized;
}

function renderUnlockedCarousel(snapshot, activeScene) {
  const visited = unlockedSceneKeys(snapshot, activeScene);
  const unlocked = sceneCatalog.filter((scene) => visited.has(scene.key));
  const key = `${catalogSignature}//${unlocked.map((scene) => scene.key).join('|')}`;
  if (key !== unlockKey) {
    unlockKey = key;
    emotionStrip.replaceChildren();
    unlocked.forEach((scene) => {
      const card = document.createElement('article');
      card.className = 'emotion-card';
      card.dataset.k = scene.key;
      card.setAttribute('role', 'listitem');
      card.setAttribute('aria-label', `${scene.label}, collected`);
      card.title = scene.label;
      const thumb = document.createElement('i');
      thumb.setAttribute('aria-hidden', 'true');
      const image = document.createElement('img');
      image.alt = '';
      image.loading = 'lazy';
      image.src = assetUrl(scene.artwork, scene.key);
      image.addEventListener('error', async () => {
        if (REDUCED || image.dataset.fallback === 'true') return;
        image.dataset.fallback = 'true';
        try {
          const data = await window.claudeBurner.sceneDataUrl(scene.sourceKey || scene.key);
          if (data) image.src = data;
        } catch (_error) { /* The pin label remains useful without artwork. */ }
      }, { once: true });
      thumb.appendChild(image);
      const copy = document.createElement('span');
      const name = document.createElement('b');
      name.textContent = `${titleCase(scene.size)} ${EMOTION_BY_KEY[scene.emotion]?.label || titleCase(scene.emotion)}`;
      const meta = document.createElement('em');
      meta.textContent = `LV.${scene.level}`;
      copy.append(name, meta);
      card.append(thumb, copy);
      emotionStrip.appendChild(card);
    });
    el('unlockCount').textContent = `${unlocked.length} of ${sceneCatalog.length} collected`;
    requestAnimationFrame(updateCarouselButtons);
  }
  let activeCard = null;
  document.querySelectorAll('.emotion-card').forEach((card) => {
    const isActive = card.dataset.k === activeScene;
    card.classList.toggle('sel', isActive);
    if (isActive) {
      card.setAttribute('aria-current', 'true');
      activeCard = card;
    } else card.removeAttribute('aria-current');
  });
  if (activeCard && activeScene !== lastCarouselScene) {
    activeCard.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: REDUCED ? 'auto' : 'smooth' });
  }
  lastCarouselScene = activeCard ? activeScene : null;
}
el('carouselPrev').addEventListener('click', () => emotionStrip.scrollBy({ left: -320, behavior: REDUCED ? 'auto' : 'smooth' }));
el('carouselNext').addEventListener('click', () => emotionStrip.scrollBy({ left: 320, behavior: REDUCED ? 'auto' : 'smooth' }));
emotionStrip.addEventListener('scroll', updateCarouselButtons, { passive: true });
emotionStrip.addEventListener('wheel', (event) => {
  if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
  event.preventDefault();
  emotionStrip.scrollLeft += event.deltaY;
}, { passive: false });
window.addEventListener('resize', updateCarouselButtons);

/* ---------------- toast ---------------- */
let toastTimer = null;
function toast(message) {
  const t = el('toast');
  t.textContent = message;
  t.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('on'), 4200);
}

/* ---------------- scene loading (data URLs over IPC) ---------------- */
let currentScene = null;
let currentSourceScene = null;
let currentSceneEntry = catalogIndex.get('small_moody');
let sceneSeq = 0;
async function setScene(scene, suppliedSource) {
  if (!scene) return;
  const entry = catalogIndex.get(scene) || catalogIndex.get('small_moody');
  const requestedSource = String(suppliedSource || '').trim().toLowerCase();
  const sourceScene = /^lv[123]_[a-z0-9_]+$/.test(requestedSource)
    ? requestedSource
    : (entry?.sourceKey || scene);
  const mood = normalizeTheme(entry?.theme, entry?.emotion || 'moody');
  currentSceneEntry = entry;
  document.documentElement.style.setProperty('--mood-primary', mood.primary);
  document.documentElement.style.setProperty('--mood-secondary', mood.secondary);
  document.documentElement.style.setProperty('--mood-base', mood.base);
  document.documentElement.dataset.scene = scene;
  document.documentElement.dataset.emberSize = entry?.size || 'small';
  document.documentElement.dataset.emberEmotion = entry?.emotion || 'moody';
  el('scene').alt = `${entry?.label || titleCase(scene)} Ember animation`;
  if (scene === currentScene && sourceScene === currentSourceScene) return;
  currentScene = scene;
  currentSourceScene = sourceScene;
  const seq = (sceneSeq += 1);
  const anchor = assetUrl(sourceScene !== scene && sourceScene !== entry?.sourceKey
    ? `scenes/${sourceScene}.png`
    : entry?.artwork, sourceScene);
  el('scene').src = anchor;
  el('sceneGlow').src = anchor;
  el('moodAmbient').style.backgroundImage = `url("${anchor}")`;
  if (REDUCED) return;
  try {
    const data = await window.claudeBurner.sceneDataUrl(sourceScene);
    if (data && seq === sceneSeq && scene === currentScene && sourceScene === currentSourceScene) {
      el('scene').src = data;
      el('sceneGlow').src = data;
      el('moodAmbient').style.backgroundImage = `url("${data}")`;
    }
  } catch (_error) {
    /* Keep the catalog anchor visible if an older preload has no loop yet. */
  }
}

/* ------------------------------------------------------------------
   Render — the snapshot is the single source of truth. LIFE is
   derived by the engine, so it is displayed, never scrubbed here.
------------------------------------------------------------------ */
let latest = null;
let dragging = false;
let firmwareSelectionPort = null;
let firmwareSelectionProvision = false;
let lastFirstConnectPhase = null;
let planSelectionDirty = false;

function isBusy(button) {
  return button?.dataset.busy === 'true';
}

function formatUsageAge(milliseconds) {
  const minutes = Math.max(1, Math.round((Number(milliseconds) || 0) / 60_000));
  return minutes < 60 ? `${minutes} min ago` : `${Math.floor(minutes / 60)} hr ago`;
}

function updateResetClock() {
  const target = el('resetAt');
  if (!target) return;
  const resetAt = Date.parse(latest?.usage?.resetsAt);
  let label = '';
  if (latest?.usageFresh && Number.isFinite(resetAt)) {
    const seconds = Math.max(0, Math.ceil((resetAt - Date.now()) / 1000));
    const clock = new Date(resetAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    if (seconds <= 0) label = '· refreshing window';
    else if (seconds < 60) label = `· resets in ${seconds}s · ${clock}`;
    else {
      const hours = Math.floor(seconds / 3600);
      const minutes = Math.floor((seconds % 3600) / 60);
      label = `· resets in ${hours ? `${hours}h ` : ''}${minutes}m · ${clock}`;
    }
  }
  if (target.textContent !== label) target.textContent = label;
}

function setFirmwareConfirmation(open, firmware = latest?.firmware) {
  const panel = el('firmwareConfirm');
  if (!panel) return;
  panel.hidden = !open;
  panel.setAttribute('aria-hidden', String(!open));
  firmwareSelectionPort = open ? firmware?.port || null : null;
  firmwareSelectionProvision = Boolean(open && firmware?.provisionRecommended);
  if (open) {
    el('firmwareConfirmTitle').textContent = firmwareSelectionProvision ? 'Set up this display?' : 'Install firmware update?';
    el('firmwareConfirmDetail').textContent = firmwareSelectionProvision
      ? 'This writes the bundled Ember firmware to the confirmed ESP32-2432S028 CYD. Keep the cable connected until verification finishes.'
      : 'Ember’s display will restart. Keep the USB cable connected until verification finishes. Stored animations are preserved.';
    el('firmwareConfirmPort').textContent = firmwareSelectionPort || 'No display selected';
    el('firmwareConfirmVersion').textContent = firmware?.firmwareVersion ? `v${firmware.firmwareVersion}` : 'Version unavailable';
    panel.focus({ preventScroll: true });
  }
}

function renderFirmware(firmware) {
  const running = Boolean(firmware?.running);
  const available = Boolean(firmware?.available && firmware?.port);
  const phase = String(firmware?.phase || 'idle');
  const statusLabels = {
    idle: available ? 'Ready' : 'Not connected',
    preparing: 'Preparing', identifying: 'Identifying', flashing: 'Installing',
    reconnecting: 'Reconnecting', complete: 'Up to date',
    'installed-disconnected': 'Installed', failed: 'Needs attention',
  };
  el('firmwareStatus').textContent = statusLabels[phase] || titleCase(phase.replaceAll('-', '_'));
  el('firmwareStatus').title = firmware?.lastError || firmware?.message || '';
  el('firmwarePort').textContent = firmware?.port || 'Not found';
  el('firmwareVersion').textContent = firmware?.firmwareVersion ? `v${firmware.firmwareVersion}` : '—';
  el('firmwareDetail').textContent = firmware?.message || 'Connect the ESP32 CYD with its USB cable.';
  const progress = clamp(Number(firmware?.progress) || 0, 0, 100);
  el('firmwareProgress').setAttribute('aria-valuenow', String(Math.round(progress)));
  el('firmwareProgressFill').style.width = `${progress}%`;
  el('flashFirmware').textContent = firmware?.provisionRecommended ? 'Set up display…' : 'Install update…';
  el('scanFirmware').disabled = running || isBusy(el('scanFirmware'));
  el('flashFirmware').disabled = running || !available || isBusy(el('flashFirmware'));
  el('reconnect').disabled = running || isBusy(el('reconnect'));
  if (running || !available) setFirmwareConfirmation(false);
}

function renderFirstConnect(firstConnect) {
  const overlay = el('firstConnectOverlay');
  if (!overlay) return;
  const phase = String(firstConnect?.phase || 'idle');
  const visible = ['authorization-needed', 'identifying', 'flashing', 'verifying', 'failed', 'complete'].includes(phase);
  const running = Boolean(firstConnect?.running || ['identifying', 'flashing', 'verifying'].includes(phase));
  overlay.classList.toggle('on', visible);
  overlay.classList.toggle('running', running);
  overlay.setAttribute('aria-hidden', String(!visible));
  el('firstConnectBoard').textContent = firstConnect?.boardFamily || 'ESP32-2432S028';
  el('firstConnectPort').textContent = firstConnect?.port || 'Waiting for USB';
  el('firstConnectVersion').textContent = firstConnect?.firmwareVersion ? `v${firstConnect.firmwareVersion}` : 'Bundled build';
  el('firstConnectMessage').textContent = firstConnect?.message || 'Preparing the ESP32 CYD display.';
  const progress = clamp(Number(firstConnect?.progress) || 0, 0, 100);
  el('firstConnectProgress').setAttribute('aria-valuenow', String(Math.round(progress)));
  el('firstConnectProgressFill').style.width = `${progress}%`;
  const phaseLabels = {
    'authorization-needed': 'Confirm the board before any flash memory is changed.',
    identifying: 'Read-only hardware checks are running.',
    flashing: 'Writing and verifying the included firmware. Do not unplug.',
    verifying: 'The display is rebooting and proving the Claude Burner protocol.',
    failed: firstConnect?.lastError || 'Setup needs attention. The previous firmware is left untouched when writing did not start.',
    complete: 'Verified. Ember is live on your display.',
  };
  el('firstConnectStatus').textContent = phaseLabels[phase] || '';
  const authorize = el('authorizeFirstConnect');
  const retry = el('retryFirstConnect');
  const dismiss = el('dismissFirstConnect');
  authorize.hidden = phase !== 'authorization-needed';
  retry.hidden = phase !== 'failed';
  dismiss.hidden = !['authorization-needed', 'failed'].includes(phase);
  authorize.disabled = running;
  retry.disabled = running;
  dismiss.disabled = running;
  el('reconnect').disabled = running || Boolean(latest?.firmware?.running);
  if (visible && phase !== lastFirstConnectPhase) {
    requestAnimationFrame(() => {
      const focusTarget = phase === 'authorization-needed' ? authorize : phase === 'failed' ? retry : el('firstConnectCard');
      focusTarget?.focus({ preventScroll: true });
    });
  }
  lastFirstConnectPhase = phase;
}

function render(snapshot) {
  if (!snapshot) return;
  latest = snapshot;
  const { state, liveState, connection, claude, bridge, usage, usageHealth, usageProbe, simulation, progression, firmware, firstConnect, setup } = snapshot;
  syncCatalog(snapshot);
  const activeScene = sceneKeyForState(state, snapshot.scene);
  const activeEntry = catalogIndex.get(activeScene) || catalogIndex.get('small_moody');

  const life = clamp(Number(state.life) || 0, 0, 100);
  const spark = clamp(Number(state.spark) || 0, 0, 100);
  const h = heat(life);
  document.documentElement.style.setProperty('--accent', h);
  document.documentElement.style.setProperty('--accent-hi', lighten(h, 0.28));

  /* pad to two digits: a lone slashed pixel zero reads as a broken glyph */
  el('lifeNum').textContent = formatEnergy(life, true);
  el('lifeState').textContent = EMOTION_BY_KEY[activeEntry.emotion]?.label || titleCase(activeEntry.emotion);
  el('lifeForm').textContent = `LV.${state.level}`;
  el('nextEvolution').textContent = state.level >= 3
    ? 'Final form collected'
    : `Next evolution at ${state.level === 1 ? 36 : 69} LIFE`;
  el('lifeDial').style.setProperty('--life-deg', `${life * 3}deg`);
  el('lifeDial').style.setProperty('--dial-fill', h);
  const dialAngle = -150 + life * 3;
  el('lifeDial').querySelector('.dial-heart').style.transform = `rotate(${dialAngle}deg) translateY(calc(var(--dial-size) * -.44)) rotate(${-dialAngle}deg)`;
  setScene(activeScene, snapshot.scene);
  renderUnlockedCarousel(snapshot, activeScene);
  const sceneQuotes = SHARE_QUOTES[activeEntry.emotion] || ['Quiet burn, visible progress.'];
  el('momentQuote').textContent = sceneQuotes[0];
  el('momentLevel').textContent = `LV.${state.level} · ${titleCase(activeEntry.emotion)} · ${formatEnergy(spark)} SPARK`;

  /* connection */
  const dev = el('device');
  dev.classList.toggle('on', Boolean(connection.connected));
  el('deviceLabel').textContent = connection.connected
    ? 'Display ready'
    : 'Display offline';
  el('displayStatus').textContent = connection.connected ? connection.path : (connection.message || 'Searching');
  renderFirmware(firmware);
  renderFirstConnect(firstConnect);

  /* five-hour window — the slider scrubs this; the engine turns it into Life */
  const ready = state.plan === 'free' || Boolean(snapshot.usageFresh);
  const usedPct = clamp(Number(usage && usage.fiveHourUsedPct) || 0, 0, 100);
  const staleReason = usage && usage.staleReason;
  el('waiting').textContent = usageProbe?.running
    ? 'Checking Claude usage'
    : staleReason === 'expired-window' ? 'Refreshing Claude usage' : 'Waiting for Claude';
  el('waiting').classList.toggle('on', !ready);
  if (ready) {
    el('usePct').textContent = `${Math.round(usedPct)}%`;
  } else {
    el('usePct').textContent = '—';
  }
  updateResetClock();
  if (!dragging && ready) usage$.set(usedPct);
  const chargeMultiplier = Number(progression && progression.multiplier) || 0;
  const lifePerUsagePct = Number(progression && progression.lifePerRawUsagePct) || 0;
  const lifeGainLabel = Number.isInteger(lifePerUsagePct) ? String(lifePerUsagePct) : lifePerUsagePct.toFixed(1);
  el('progressionPace').textContent = state.plan === 'free'
    ? 'Demo mode · charging paused'
    : `${chargeMultiplier}× boost · 1% adds ${lifeGainLabel} LIFE`;

  /* setup vs instrument — binary, authentication, bridge, and the first
     reading are separate states. Never claim Claude is connected early. */
  const setupNeeded = Boolean(setup?.action);
  el('setup').classList.toggle('on', setupNeeded);
  el('meterbox').style.display = bridge.installed ? '' : 'none';
  const savedMaxPlan = state.plan === 'max5' || state.plan === 'max20';
  el('maxChoice').classList.toggle('off', setup?.action !== 'install-bridge' || (claude.plan !== 'max' && !savedMaxPlan));
  const savedMultiplier = state.plan === 'max20' ? '20' : state.plan === 'max5' ? '5' : null;
  const savedChoice = savedMultiplier && document.querySelector(`input[name="maxPlan"][value="${savedMultiplier}"]`);
  if (savedChoice) savedChoice.checked = true;
  const setupCopy = {
    'claude-not-installed': ['Install Claude Code', 'Install Claude Code', 'Claude Code was not found on this Mac.'],
    'claude-outdated': ['Update Claude Code', 'Open update guide', `Claude Code ${claude.version || ''} is too old for reliable usage sync.`],
    'claude-signed-out': ['Sign in to Claude', 'Sign in to Claude Code', 'A browser sign-in will open. Return here when it finishes.'],
    'credential-source': ['Use your Claude plan', 'Sign in with Claude.ai', 'Claude is using a non-subscription credential. Sign in with the Claude.ai plan you want Ember to track.'],
    'bridge-needed': ['Connect Claude usage', 'Connect usage privately', 'Claude Burner installs a local status-line bridge. It reads only rate-limit percentages and preserves your existing status line.'],
    'waiting-for-usage': ['Almost ready', 'Check for first reading', 'Open Claude Code and send one message. Anthropic supplies usage data only after the first response.'],
    'usage-stale': ['Refreshing Claude', 'Check usage again', 'The last verified reading is safe; a fresh one will replace it when Claude Code reports again.'],
  }[setup?.state] || ['Wake Ember up', 'Connect Claude Code', setup?.message || 'Connect Claude activity to wake Ember.'];
  el('setupTitle').textContent = setupCopy[0];
  el('setupDetail').textContent = setup?.message || setupCopy[2];
  el('installBridge').textContent = setupCopy[1];
  el('installBridge').dataset.action = setup?.action || '';
  el('installBridge').disabled = !setup?.action || isBusy(el('installBridge'));
  el('claudeVersion').textContent = claude.installed
    ? `Claude Code ${claude.version} · ${claude.loggedIn ? (claude.subscriptionAuth ? 'subscription signed in' : 'non-subscription credential') : 'signed out'}`
    : 'Claude Code was not found';

  /* tune */
  el('bridgeStatus').textContent = bridge.installed ? 'Active, private' : 'Not installed';
  const sourceLabel = usageHealth?.degraded
    ? `Last live reading · ${formatUsageAge(usageHealth.ageMs)}`
    : usage && !usage.stale ? 'Live Claude status line' : setup?.state === 'claude-signed-out' ? 'Signed out' : 'Waiting';
  el('usageSource').textContent = usageProbe?.running ? 'Refreshing…' : sourceLabel;
  el('usageSource').title = usageProbe?.lastError || '';
  if (!planSelectionDirty && el('planSelect') !== document.activeElement) {
    el('planSelect').value = ['pro', 'max5', 'max20'].includes(state.plan) ? state.plan : 'pro';
  }
  el('demo').classList.toggle('on', state.plan === 'free');
  el('manualLife').value = String(Math.round(life));
  el('manualOut').textContent = `${Math.round(life)}%`;
  el('returnLive').disabled = !simulation.active;

  /* status line */
  el('simBadge').classList.toggle('on', Boolean(simulation.active));
  el('simBadge').disabled = !simulation.active;
  const planLabel = state.plan === 'max20' ? 'Max 20×' : state.plan === 'max5' ? 'Max 5×' : titleCase(state.plan);
  if (simulation.active) {
    el('status').textContent = `Trying on a future Ember · live LIFE stays at ${Math.round(simulation.liveLife)}%`;
  } else if (setup?.action && setup?.state !== 'usage-stale') {
    el('status').textContent = setup.message;
  } else if (!ready) {
    el('status').textContent = staleReason === 'expired-window'
      ? 'Ember is checking for a fresh Claude session'
      : 'Ember is waiting for your next Claude spark';
  } else {
    el('status').textContent = `${planLabel} · Ember is charging from your Claude activity`;
  }

  if (shareOpen) updateShareComposer(false);
}

/* the slider's visual position is spring-driven and independent of renders */
const usage$ = spring({
  response: 0.4,
  damping: 1,
  onUpdate: (v) => {
    const p = clamp(v, 0, 100);
    el('useFill').style.width = `${p}%`;
    el('knob').style.left = `${p}%`;
    el('slider').setAttribute('aria-valuenow', String(Math.round(p)));
  },
});

/* ------------------------------------------------------------------
   Direct manipulation on the usage slider: 1:1 tracking, rubber-band
   at the bounds, momentum projection and velocity handoff on release.
------------------------------------------------------------------ */
const slider = el('slider');
let drag = null;
let sendSeq = 0;

async function pushUsage(value) {
  const seq = (sendSeq += 1);
  try {
    const snap = await window.claudeBurner.setSimulationUsage(clamp(value, 0, 100));
    if (seq === sendSeq) render(snap);
  } catch (error) {
    toast(error.message || String(error));
  }
}

slider.addEventListener('pointerdown', (e) => {
  slider.setPointerCapture(e.pointerId);
  slider.classList.add('dragging');
  dragging = true;
  usage$.track(usage$.value);
  drag = {
    w: slider.getBoundingClientRect().width,
    x: e.clientX,
    start: usage$.value,
    hist: [{ t: performance.now(), v: usage$.value }],
    moved: false,
  };
});

slider.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const dx = e.clientX - drag.x;
  if (!drag.moved && Math.abs(dx) < 3) return;
  drag.moved = true;
  let v = drag.start + (dx / drag.w) * 100;
  if (v < 0) v = -rubberband(-v, 100);
  if (v > 100) v = 100 + rubberband(v - 100, 100);
  usage$.track(v);
  drag.hist.push({ t: performance.now(), v });
  while (drag.hist.length > 5) drag.hist.shift();
  pushUsage(v);
});

function endDrag() {
  if (!drag) return;
  slider.classList.remove('dragging');
  const { moved, hist } = drag;
  drag = null;
  dragging = false;
  if (!moved) return;
  const a = hist[0];
  const b = hist[hist.length - 1];
  const vel = (b.v - a.v) / Math.max((b.t - a.t) / 1000, 1 / 240);
  const target = clamp(usage$.value + project(vel), 0, 100);
  usage$.setDamping(Math.abs(vel) > 25 ? 0.8 : 1);   // bounce only when a flick earned it
  usage$.to(target, vel);
  pushUsage(target);
}
slider.addEventListener('pointerup', endDrag);
slider.addEventListener('pointercancel', endDrag);

slider.addEventListener('keydown', (e) => {
  const step = e.shiftKey ? 5 : 1;
  let next = null;
  if (e.key === 'ArrowRight' || e.key === 'ArrowUp') next = usage$.value + step;
  if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') next = usage$.value - step;
  if (e.key === 'Home') next = 0;
  if (e.key === 'End') next = 100;
  if (next === null) return;
  e.preventDefault();
  next = clamp(next, 0, 100);
  usage$.setDamping(1);
  usage$.to(next);
  pushUsage(next);
});
slider.addEventListener('wheel', (e) => {
  e.preventDefault();
  const next = clamp(usage$.value + (e.deltaY < 0 ? 1 : -1) * (e.shiftKey ? 5 : 0.5), 0, 100);
  usage$.track(next);
  pushUsage(next);
}, { passive: false });

/* ---------------- Tune panel: same path in and out ---------------- */
const tune = el('tune');
const tuneBtn = el('tuneBtn');
const tuneBackdrop = el('tuneBackdrop');
let tuneOpen = false;
let tuneReturnFocus = null;
const tune$ = spring({
  response: 0.34,
  damping: 1,
  onUpdate: (p) => {
    tune.style.visibility = p > 0.002 ? 'visible' : 'hidden';
    tune.style.transform = `translateX(${(1 - p) * 100}%)`;
    tune.style.opacity = String(Math.min(1, p * 1.6));
  },
});
tune$.set(0);
function setTune(open) {
  tuneOpen = open;
  if (open) tuneReturnFocus = document.activeElement;
  tuneBtn.setAttribute('aria-expanded', String(open));
  tuneBtn.classList.toggle('on', open);
  tune.setAttribute('aria-hidden', String(!open));
  tuneBackdrop.classList.toggle('on', open);
  tune$.to(open ? 1 : 0);
  if (open) requestAnimationFrame(() => el('closeTune').focus());
  else if (tuneReturnFocus && typeof tuneReturnFocus.focus === 'function') tuneReturnFocus.focus();
}
tuneBtn.addEventListener('click', () => setTune(!tuneOpen));
el('device').addEventListener('click', () => setTune(true));
el('closeTune').addEventListener('click', () => setTune(false));
tuneBackdrop.addEventListener('click', () => setTune(false));

/* ---------------- renderer-only share-card maker ---------------- */
const shareOverlay = el('shareOverlay');
const shareSheet = el('shareSheet');
const shareCanvas = el('shareCanvas');
let shareOpen = false;
let shareReturnFocus = null;
let shareQuoteIndex = 0;
let shareQuoteScene = null;
let cardDrawSeq = 0;

function currentQuotes() {
  return SHARE_QUOTES[currentSceneEntry?.emotion] || ['Quiet burn, visible progress.'];
}

function selectedQuote() {
  const quotes = currentQuotes();
  return quotes[clamp(shareQuoteIndex, 0, quotes.length - 1)];
}

function setShare(open) {
  shareOpen = open;
  if (open) {
    shareReturnFocus = document.activeElement;
    if (tuneOpen) setTune(false);
    shareOverlay.classList.add('on');
    shareOverlay.setAttribute('aria-hidden', 'false');
    el('shareBackdrop').classList.add('on');
    updateShareComposer(true);
    requestAnimationFrame(() => el('closeShare').focus());
  } else {
    shareOverlay.classList.remove('on');
    shareOverlay.setAttribute('aria-hidden', 'true');
    el('shareBackdrop').classList.remove('on');
    if (shareReturnFocus && typeof shareReturnFocus.focus === 'function') shareReturnFocus.focus();
  }
}

function renderQuoteChoices() {
  const box = el('quoteOptions');
  const quotes = currentQuotes();
  if (shareQuoteScene !== currentScene) {
    shareQuoteScene = currentScene;
    shareQuoteIndex = 0;
  }
  box.replaceChildren();
  quotes.forEach((quote, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'quote-choice';
    button.setAttribute('role', 'radio');
    button.setAttribute('aria-checked', String(index === shareQuoteIndex));
    button.tabIndex = index === shareQuoteIndex ? 0 : -1;
    button.textContent = quote;
    button.addEventListener('click', () => {
      shareQuoteIndex = index;
      renderQuoteChoices();
      drawShareCard();
    });
    button.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowRight' && event.key !== 'ArrowUp' && event.key !== 'ArrowLeft') return;
      event.preventDefault();
      const delta = event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : -1;
      shareQuoteIndex = (shareQuoteIndex + delta + quotes.length) % quotes.length;
      renderQuoteChoices();
      box.querySelector('[tabindex="0"]')?.focus();
      drawShareCard();
    });
    box.appendChild(button);
  });
}

function roundRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function wrapText(ctx, text, x, y, maxWidth, lineHeight, maxLines = 3) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let line = '';
  words.forEach((word) => {
    const candidate = line ? `${line} ${word}` : word;
    if (ctx.measureText(candidate).width <= maxWidth || !line) line = candidate;
    else { lines.push(line); line = word; }
  });
  if (line) lines.push(line);
  lines.slice(0, maxLines).forEach((value, index) => ctx.fillText(value, x, y + index * lineHeight));
  return Math.min(lines.length, maxLines);
}

function loadImage(source) {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = source;
  });
}

async function loadCardFrame(scene) {
  const entry = catalogIndex.get(scene);
  const sourceScene = scene === currentScene ? (currentSourceScene || scene) : (entry?.sourceKey || scene);
  const artwork = sourceScene !== scene && sourceScene !== entry?.sourceKey
    ? `scenes/${sourceScene}.png`
    : entry?.artwork;
  const anchor = await loadImage(assetUrl(artwork, sourceScene));
  if (anchor) return anchor;
  try {
    const data = await window.claudeBurner.sceneDataUrl(sourceScene);
    return data ? loadImage(data) : null;
  } catch (_error) {
    return null;
  }
}

async function drawShareCard() {
  if (!latest) return;
  const seq = (cardDrawSeq += 1);
  const { state, usage } = latest;
  const scene = sceneKeyForState(state, latest.scene);
  const entry = catalogIndex.get(scene) || catalogIndex.get('small_moody');
  const life = clamp(Math.round(Number(state.life) || 0), 0, 100);
  const mood = normalizeTheme(entry?.theme, entry?.emotion || 'moody');
  const frame = await loadCardFrame(scene);
  if (seq !== cardDrawSeq) return;
  await document.fonts.ready;
  const ctx = shareCanvas.getContext('2d');
  ctx.clearRect(0, 0, 1200, 627);

  const bg = ctx.createLinearGradient(0, 0, 1200, 627);
  bg.addColorStop(0, '#2a1d1c');
  bg.addColorStop(.56, mood.primary);
  bg.addColorStop(1, '#5a2b1a');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 1200, 627);

  const glow = ctx.createRadialGradient(410, 290, 20, 410, 290, 470);
  glow.addColorStop(0, withAlpha(mood.secondary, .8));
  glow.addColorStop(1, 'rgba(17,12,14,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, 840, 627);

  ctx.save();
  roundRect(ctx, 38, 38, 684, 551, 34);
  ctx.clip();
  if (frame) {
    ctx.imageSmoothingEnabled = false;
    const scale = Math.max(684 / frame.width, 551 / frame.height);
    const width = frame.width * scale;
    const height = frame.height * scale;
    ctx.drawImage(frame, 38 + (684 - width) / 2, 38 + (551 - height) / 2, width, height);
  } else {
    ctx.fillStyle = mood.primary;ctx.fillRect(38, 38, 684, 551);
  }
  const imageFade = ctx.createLinearGradient(520, 0, 722, 0);
  imageFade.addColorStop(0, 'rgba(32,18,18,0)');
  imageFade.addColorStop(1, 'rgba(32,18,18,.72)');
  ctx.fillStyle = imageFade;ctx.fillRect(460, 38, 262, 551);
  ctx.restore();

  ctx.strokeStyle = 'rgba(255,224,173,.45)';ctx.lineWidth = 3;
  roundRect(ctx, 38, 38, 684, 551, 34);ctx.stroke();

  ctx.fillStyle = '#fff1d4';
  ctx.font = '400 39px PixelNum, monospace';
  ctx.fillText('EMBER', 774, 108);
  ctx.fillStyle = '#ff7842';ctx.font = '800 22px -apple-system, sans-serif';
  ctx.fillText(`LV.${state.level}  •  ${life} LIFE`, 777, 158);
  ctx.fillStyle = 'rgba(255,239,214,.68)';ctx.font = '700 17px -apple-system, sans-serif';
  ctx.fillText(titleCase(entry?.emotion).toUpperCase(), 777, 194);
  ctx.fillStyle = '#fff2d8';ctx.font = '750 38px -apple-system, sans-serif';
  const quoteLines = wrapText(ctx, selectedQuote(), 777, 270, 365, 48, 4);

  let detailY = 302 + quoteLines * 48;
  ctx.fillStyle = 'rgba(255,238,210,.58)';ctx.font = '600 16px -apple-system, sans-serif';
  if (el('cardShowPlan').checked) {
    const planName = state.plan === 'max20' ? 'MAX 20×' : state.plan === 'max5' ? 'MAX 5×' : String(state.plan || 'PRO').toUpperCase();
    ctx.fillText(`PLAN  ${planName}`, 777, detailY);detailY += 27;
  }
  if (el('cardShowUsage').checked) {
    ctx.fillText(`FIVE-HOUR USAGE  ${Math.round(Number(usage?.fiveHourUsedPct) || 0)}%`, 777, detailY);detailY += 27;
  }
  if (el('cardShowUnlocks').checked) {
    const count = unlockedSceneKeys(latest, scene).size;
    ctx.fillText(`MOOD PINS  ${count}/${sceneCatalog.length}`, 777, detailY);
  }

  ctx.fillStyle = '#ff7b42';ctx.font = '800 18px -apple-system, sans-serif';ctx.fillText('CLAUDE BURNER', 777, 552);
  ctx.fillStyle = 'rgba(255,238,210,.56)';ctx.font = '600 14px -apple-system, sans-serif';ctx.fillText('Proof of work, but make it volcanic.', 777, 577);

  shareCanvas.setAttribute('aria-label', `Ember brag card. Level ${state.level}, ${life} LIFE, ${titleCase(entry?.emotion)}. ${selectedQuote()}`);
}

function updateShareComposer(resetQuotes = false) {
  if (!latest) return;
  if (resetQuotes || shareQuoteScene !== currentScene) shareQuoteIndex = 0;
  renderQuoteChoices();
  drawShareCard();
}

function cardFileName() {
  const date = new Date().toISOString().slice(0, 10);
  const emotion = String(currentSceneEntry?.emotion || 'ember').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  return `claude-burner-lv${latest?.state?.level || 1}-${emotion}-${date}.png`;
}

function saveCardPng() {
  return new Promise((resolve, reject) => {
    shareCanvas.toBlob((blob) => {
      if (!blob) { reject(new Error('The card could not be rendered.')); return; }
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;link.download = cardFileName();
      document.body.appendChild(link);link.click();link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 3000);
      resolve();
    }, 'image/png');
  });
}

async function copyCaption(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch (_error) {
    const area = document.createElement('textarea');
    area.value = text;area.setAttribute('readonly', '');area.style.position = 'fixed';area.style.opacity = '0';
    document.body.appendChild(area);area.select();
    const copied = document.execCommand('copy');area.remove();return copied;
  }
}

function openShareUrl(url) {
  const link = document.createElement('a');
  link.href = url;link.target = '_blank';link.rel = 'noopener noreferrer';
  document.body.appendChild(link);link.click();link.remove();
}

function captionFor(platform) {
  const state = latest.state;
  const mood = titleCase(currentSceneEntry?.emotion);
  if (platform === 'x') return `${selectedQuote()}\n\nEmber reached LV.${state.level} with ${Math.round(state.life)} LIFE in ${mood} mode. #ClaudeBurner`;
  return `${selectedQuote()}\n\nMy Claude Burner companion reached Level ${state.level} with ${Math.round(state.life)} LIFE in ${mood} mode. A tiny, unnecessarily dramatic receipt for the work that got done.`;
}

async function shareTo(platform) {
  const caption = captionFor(platform);
  // Ask for clipboard access while the click still carries user activation.
  // Canvas drawing and download work can safely happen after that permission.
  const copied = await copyCaption(caption);
  await drawShareCard();
  await saveCardPng();
  if (platform === 'x') openShareUrl(`https://x.com/intent/tweet?text=${encodeURIComponent(caption)}`);
  else openShareUrl('https://www.linkedin.com/feed/?shareActive=true');
  toast(platform === 'x'
    ? `Card saved${copied ? ' and caption copied' : ''}. Attach the saved PNG to your X post.`
    : `Card saved${copied ? ' and caption copied' : ''}. Add the PNG in LinkedIn, then paste your caption.`);
}

el('shareCardBtn').addEventListener('click', () => setShare(true));
el('makeCardBtn').addEventListener('click', () => setShare(true));
el('closeShare').addEventListener('click', () => setShare(false));
el('shareBackdrop').addEventListener('click', () => setShare(false));
['cardShowPlan', 'cardShowUsage', 'cardShowUnlocks'].forEach((id) => el(id).addEventListener('change', drawShareCard));
el('saveCard').addEventListener('click', () => perform(el('saveCard'), async () => {
  await drawShareCard();await saveCardPng();toast(`Saved ${cardFileName()} to your Downloads folder.`);
}));
el('shareX').addEventListener('click', () => perform(el('shareX'), () => shareTo('x')));
el('shareLinkedIn').addEventListener('click', () => perform(el('shareLinkedIn'), () => shareTo('linkedin')));

function trapFocus(event, container) {
  if (event.key !== 'Tab') return;
  const focusable = [...container.querySelectorAll('button:not(:disabled),select:not(:disabled),input:not(:disabled),summary,[tabindex="0"]')]
    .filter((node) => node.offsetParent !== null);
  if (!focusable.length) return;
  const first = focusable[0];const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) { event.preventDefault();last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault();first.focus(); }
}

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    if (el('firstConnectOverlay')?.classList.contains('on')) {
      event.preventDefault();
      return;
    }
    if (!el('firmwareConfirm').hidden) { setFirmwareConfirmation(false);event.preventDefault();return; }
    if (shareOpen) { setShare(false);event.preventDefault();return; }
    if (tuneOpen) { setTune(false);event.preventDefault();return; }
  }
  if (el('firstConnectOverlay')?.classList.contains('on')) trapFocus(event, el('firstConnectCard'));
  else if (shareOpen) trapFocus(event, shareSheet);
  else if (!el('firmwareConfirm').hidden) trapFocus(event, el('firmwareConfirm'));
  else if (tuneOpen) trapFocus(event, tune);
});

/* ---------------- actions ---------------- */
async function perform(button, action) {
  button.disabled = true;
  try { return await action(); }
  catch (error) { toast(error.message || String(error)); return null; }
  finally { button.disabled = false; }
}

el('installBridge').addEventListener('click', () => perform(el('installBridge'), async () => {
  const picked = document.querySelector('input[name="maxPlan"]:checked');
  const result = await window.claudeBurner.installBridge({ maxMultiplier: picked ? Number(picked.value) : null });
  render(result.snapshot);
  toast('Claude Code connected. Active usage sync starts automatically.');
}));

el('refreshUsage').addEventListener('click', () => perform(el('refreshUsage'), async () => {
  const snapshot = await window.claudeBurner.refreshUsage();
  render(snapshot);
  if (snapshot.usageFresh && snapshot.usageProbe?.lastError) {
    toast('Using the latest valid Claude reading while live refresh retries in the background.');
  } else if (snapshot.usageFresh) {
    toast('Claude usage refreshed directly from the built-in Usage screen.');
  } else {
    toast('Claude is connected; waiting for the first live Usage reading.');
  }
}));

el('authorizeFirstConnect').addEventListener('click', () => perform(el('authorizeFirstConnect'), async () => {
  const target = latest?.firstConnect;
  if (!target?.port) throw new Error('The CYD USB port is no longer available.');
  const result = await window.claudeBurner.authorizeFirstConnect({
    confirmed: true,
    boardFamily: 'ESP32-2432S028',
    port: target.port,
  });
  render(result.snapshot);
  toast('CYD firmware installed and verified from the app bundle.');
}));

el('retryFirstConnect').addEventListener('click', () => perform(el('retryFirstConnect'), async () => {
  render(await window.claudeBurner.retryFirstConnect());
}));

el('dismissFirstConnect').addEventListener('click', () => perform(el('dismissFirstConnect'), async () => {
  render(await window.claudeBurner.dismissFirstConnect());
  toast('Skipped firmware setup for this USB connection.');
}));

el('reconnect').addEventListener('click', () => perform(el('reconnect'), async () => {
  const result = await window.claudeBurner.reconnectDisplay();
  const n = result.reclaimed && result.reclaimed.length;
  toast(`Display connected on ${result.path}${n ? ` · reclaimed ${n} stale connection${n === 1 ? '' : 's'}` : ''}`);
}));

el('scanFirmware').addEventListener('click', () => perform(el('scanFirmware'), async () => {
  const result = await window.claudeBurner.scanFirmwareDevice();
  renderFirmware(result);
  if (!result.available) toast(result.message || 'No supported ESP32 CYD was found.');
}));

el('flashFirmware').addEventListener('click', async () => {
  const button = el('flashFirmware');
  let result = latest?.firmware || null;
  button.disabled = true;
  try {
    result = await window.claudeBurner.scanFirmwareDevice();
    renderFirmware(result);
    if (!result.available || !result.port) throw new Error(result.message || 'No supported ESP32 CYD was found.');
    setFirmwareConfirmation(true, result);
  } catch (error) {
    toast(error.message || String(error));
  } finally {
    renderFirmware(result);
  }
});

el('cancelFirmware').addEventListener('click', () => {
  setFirmwareConfirmation(false);
  el('flashFirmware').focus({ preventScroll: true });
});

el('confirmFirmware').addEventListener('click', async () => {
  const button = el('confirmFirmware');
  const port = firmwareSelectionPort;
  setFirmwareConfirmation(false);
  button.disabled = true;
  try {
    const result = await window.claudeBurner.installFirmware({ confirmed: true, port, provision: false });
    toast(result.connected === false
      ? 'Firmware verified. Reconnect the USB cable to resume Ember.'
      : `Firmware ${result.firmwareVersion} installed and verified on ${result.port}.`);
  } catch (error) {
    toast(error.message || String(error));
  } finally {
    button.disabled = false;
  }
});

el('savePlan').addEventListener('click', () => perform(el('savePlan'), async () => {
  const picked = el('planSelect').value;
  const multiplier = picked === 'max20' ? 20 : picked === 'max5' ? 5 : null;
  render(await window.claudeBurner.setPlan(picked, multiplier));
  toast(`Plan saved as ${picked === 'max20' ? 'Max 20×' : picked === 'max5' ? 'Max 5×' : 'Pro'}.`);
}));

async function returnToLive(button) {
  return perform(button, async () => {
  sendSeq += 1;
  render(await window.claudeBurner.clearSimulation());
  toast('Returned to live Claude usage.');
  });
}
el('returnLive').addEventListener('click', () => returnToLive(el('returnLive')));
el('simBadge').addEventListener('click', () => returnToLive(el('simBadge')));

el('openFrames').addEventListener('click', () => window.claudeBurner.openFrameFolders());
el('openSecurity').addEventListener('click', () => window.claudeBurner.openPrivacySettings());

el('manualLife').addEventListener('input', () => {
  el('manualOut').textContent = `${el('manualLife').value}%`;
});
el('manualLife').addEventListener('change', async () => {
  try { render(await window.claudeBurner.setManualLife(Number(el('manualLife').value))); }
  catch (error) { toast(error.message || String(error)); }
});

/* ---------------- boot ---------------- */
window.claudeBurner.onSnapshot(render);
window.claudeBurner.onFirmwareStatus((firmware) => {
  if (latest) latest = { ...latest, firmware };
  renderFirmware(firmware);
});
window.claudeBurner.onFirstConnectStatus((firstConnect) => {
  if (latest) latest = { ...latest, firstConnect };
  renderFirstConnect(firstConnect);
});
window.claudeBurner.getSnapshot().then(render).catch((error) => toast(error.message || String(error)));
setInterval(updateResetClock, 1000);
