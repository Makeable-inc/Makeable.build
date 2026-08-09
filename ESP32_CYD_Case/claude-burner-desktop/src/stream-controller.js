'use strict';

const { EventEmitter } = require('node:events');
const { StatusCode } = require('./serial-protocol');

const HEARTBEAT_INTERVAL_MS = 500;

class StreamController extends EventEmitter {
  constructor(serial, animations, getSnapshot) {
    super();
    this.serial = serial;
    this.animations = animations;
    this.getSnapshot = getSnapshot;
    this.running = false;
    this.paused = false;
    this.activeTick = null;
    this.activeScene = null;
    this.forceInstall = true;
    this.lastConnectAttempt = 0;
    this.currentStatus = null;
    this.lastHudLife = null;
    this.lastHudLevel = null;
    this.stats = {
      mode: 'device-local-gif',
      gifUploads: 0,
      gifCacheHits: 0,
      gifBytesUploaded: 0,
      gifChunkRetries: 0,
      heartbeats: 0,
      activeScene: null,
      // Device-local render telemetry, lifted out of the extended ACK. This is
      // the only ground truth for on-device frame cost — everything else is a
      // guess about SPI bandwidth.
      render: null,
    };
    this.renderSamples = [];
    this.lastFramesPlayed = null;
    this.lastFramesPlayedAt = null;
  }

  // The firmware reports lastGifRenderMicros in every ACK (main.cpp
  // sendAcknowledgement, body+25). Keep a rolling window so a scene change or a
  // single slow frame can't dominate the reading.
  recordTelemetry(acknowledgement) {
    if (!acknowledgement) return;
    const micros = acknowledgement.lastFrameRenderMicros;
    if (typeof micros === 'number' && micros > 0) {
      this.renderSamples.push(micros);
      if (this.renderSamples.length > 240) this.renderSamples.shift();
      const sorted = [...this.renderSamples].sort((a, b) => a - b);
      const at = (q) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
      const frameBudgetMicros = Math.round(1_000_000 / (this.animations.fps || 12));
      this.stats.render = {
        scene: this.stats.activeScene,
        samples: sorted.length,
        lastMicros: micros,
        minMicros: sorted[0],
        medianMicros: at(0.5),
        p95Micros: at(0.95),
        maxMicros: sorted[sorted.length - 1],
        frameBudgetMicros,
        budgetUsedPct: Math.round((at(0.5) / frameBudgetMicros) * 1000) / 10,
        headroomFps: Math.floor(1_000_000 / Math.max(1, at(0.5))),
      };
    }

    const played = acknowledgement.framesPlayed;
    const now = Date.now();
    if (typeof played === 'number') {
      if (this.lastFramesPlayed !== null && played >= this.lastFramesPlayed && this.lastFramesPlayedAt) {
        const deltaFrames = played - this.lastFramesPlayed;
        const deltaMs = now - this.lastFramesPlayedAt;
        if (deltaMs > 500 && deltaFrames > 0 && this.stats.render) {
          this.stats.render.observedFps = Math.round((deltaFrames / deltaMs) * 1000 * 10) / 10;
        }
      }
      this.lastFramesPlayed = played;
      this.lastFramesPlayedAt = now;
    }
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.paused = false;
    this.schedule(0);
  }

  stop() {
    this.running = false;
    this.paused = true;
    if (this.timer) clearTimeout(this.timer);
  }

  async pause() {
    this.paused = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.activeTick) await this.activeTick.catch(() => {});
  }

  resume() {
    if (!this.running) return;
    this.paused = false;
    this.schedule(0);
  }

  // Kept as the public recovery hook used by the existing reconnect UI. A
  // reconnect now reinstalls/activates the selected GIF instead of sending an
  // RGB565 keyframe followed by a permanent USB frame stream.
  requestKeyframe() {
    this.forceInstall = true;
    this.activeScene = null;
  }

  schedule(delay) {
    if (!this.running || this.paused) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      const execution = this.tick();
      this.activeTick = execution;
      execution.finally(() => {
        if (this.activeTick === execution) this.activeTick = null;
      }).catch((error) => this.emit('stream-error', error));
    }, Math.max(0, delay));
  }

  async ensureConnected() {
    if (this.serial.connected) return true;
    if (Date.now() - this.lastConnectAttempt < 2000) return false;
    this.lastConnectAttempt = Date.now();
    try {
      await this.serial.connect();
      this.forceInstall = true;
      this.activeScene = null;
      this.currentStatus = null;
      this.lastHudLife = null;
      this.lastHudLevel = null;
      this.emit('connection', { connected: true, path: this.serial.path });
      return true;
    } catch (error) {
      this.emit('connection', { connected: false, error: error.message });
      return false;
    }
  }

  async setDeviceStatus(status, state) {
    if (this.currentStatus === status) return;
    await this.serial.sendStatus(status, state.life, state.level);
    if (status !== StatusCode.STREAMING) {
      this.forceInstall = true;
      this.activeScene = null;
    }
    this.currentStatus = status;
  }

  async updateHud(state) {
    const life = Math.max(0, Math.min(100, Math.round(state.life)));
    const level = Math.max(1, Math.min(3, Math.round(state.level)));
    if (life === this.lastHudLife && level === this.lastHudLevel) return;
    await this.serial.sendHud(life, level);
    this.lastHudLife = life;
    this.lastHudLevel = level;
  }

  async installSelectedGif(scene, state) {
    const { bytes, checksum } = this.animations.getDeviceGif(scene);
    const result = await this.serial.installGif(bytes, checksum, state.life, state.level);
    if (!result?.activationConfirmed) {
      throw new Error(`Device did not confirm activation of GIF scene ${scene}`);
    }
    if (result.uploaded) {
      this.stats.gifUploads += 1;
      this.stats.gifBytesUploaded += result.bytes;
    } else {
      this.stats.gifCacheHits += 1;
    }
    this.stats.gifChunkRetries += result.chunkRetries || 0;
    this.activeScene = scene;
    this.stats.activeScene = scene;
    this.forceInstall = false;
    this.lastHudLife = Math.round(state.life);
    this.lastHudLevel = Math.round(state.level);
  }

  async tick() {
    if (this.paused || !this.running) return;
    const started = Date.now();
    try {
      if (!(await this.ensureConnected())) {
        this.schedule(250);
        return;
      }
      const deliveryError = this.serial.consumeAsynchronousError();
      if (deliveryError) throw deliveryError;

      const snapshot = this.getSnapshot();
      const displayState = snapshot.state;
      if (!snapshot.claudeReady) {
        await this.setDeviceStatus(StatusCode.WAITING_FOR_CLAUDE, displayState);
        this.recordTelemetry(await this.serial.sendHeartbeat());
        this.stats.heartbeats += 1;
        this.schedule(HEARTBEAT_INTERVAL_MS);
        return;
      }

      await this.setDeviceStatus(StatusCode.STREAMING, displayState);
      const scene = this.animations.sceneForState(displayState.level, displayState.emotion);
      if (this.forceInstall || scene !== this.activeScene) {
        await this.installSelectedGif(scene, displayState);
      } else {
        await this.updateHud(displayState);
      }
      this.recordTelemetry(await this.serial.sendHeartbeat());
      this.stats.heartbeats += 1;
    } catch (error) {
      this.forceInstall = true;
      this.activeScene = null;
      this.currentStatus = null;
      this.emit('stream-error', error);
      try { await this.serial.disconnect(); } catch { /* retry on next tick */ }
    }
    this.schedule(Math.max(0, HEARTBEAT_INTERVAL_MS - (Date.now() - started)));
  }
}

module.exports = { StreamController, HEARTBEAT_INTERVAL_MS };
