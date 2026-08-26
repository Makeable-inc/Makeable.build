import {
  Command,
  FRAME_CHUNK_BYTES,
  HOLOGRAM_RX_UUID,
  HOLOGRAM_SERVICE_UUID,
  HOLOGRAM_TX_UUID,
  PROTOCOL_VERSION,
  Status,
  crc32,
  makeFrameBegin,
  makeFrameChunk,
  makeSimpleCommand,
  parseEvent,
} from "./ble-protocol.js";
import { OLED_FRAME_BYTES, OLED_HEIGHT, OLED_WIDTH } from "./frame-codec.js";

const ACK_TIMEOUT_MS = 5000;

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export class HologramBleClient extends EventTarget {
  constructor() {
    super();
    this.device = null;
    this.rx = null;
    this.tx = null;
    this.sequence = 0;
    this.pendingAcks = new Map();
    this.ready = null;
  }

  get connected() {
    return Boolean(this.device?.gatt?.connected && this.rx && this.tx);
  }

  async connect() {
    if (!navigator.bluetooth) {
      throw new Error("Web Bluetooth is not available in this browser.");
    }

    this.device = await navigator.bluetooth.requestDevice({
      filters: [{ services: [HOLOGRAM_SERVICE_UUID] }],
    });
    this.device.addEventListener("gattserverdisconnected", () => this.handleDisconnect());

    const server = await this.device.gatt.connect();
    const service = await server.getPrimaryService(HOLOGRAM_SERVICE_UUID);
    this.rx = await service.getCharacteristic(HOLOGRAM_RX_UUID);
    this.tx = await service.getCharacteristic(HOLOGRAM_TX_UUID);
    await this.tx.startNotifications();
    this.tx.addEventListener("characteristicvaluechanged", (event) => {
      this.handleNotification(event.target.value);
    });

    await this.writeWithResponse(makeSimpleCommand(Command.PING));
    const startedAt = performance.now();
    while (!this.ready && performance.now() - startedAt < 2000) await delay(20);
    if (!this.ready) throw new Error("The device connected but did not return its display contract.");
    if (
      this.ready.version !== PROTOCOL_VERSION
      || this.ready.width !== OLED_WIDTH
      || this.ready.height !== OLED_HEIGHT
      || this.ready.frameBytes !== OLED_FRAME_BYTES
    ) {
      throw new Error("The connected firmware uses an incompatible display protocol.");
    }

    this.dispatchEvent(new CustomEvent("connected", { detail: this.ready }));
    return this.ready;
  }

  disconnect() {
    this.device?.gatt?.disconnect();
  }

  handleDisconnect() {
    this.rx = null;
    this.tx = null;
    this.ready = null;
    for (const pending of this.pendingAcks.values()) {
      pending.reject(new Error("Hologram disconnected."));
      clearTimeout(pending.timeout);
    }
    this.pendingAcks.clear();
    this.dispatchEvent(new Event("disconnected"));
  }

  handleNotification(value) {
    const event = parseEvent(value);
    if (!event) return;
    if (event.type === "ready") {
      this.ready = event;
      this.dispatchEvent(new CustomEvent("ready", { detail: event }));
      return;
    }
    if (event.type === "ack") {
      const key = `${event.command}:${event.sequence}`;
      const pending = this.pendingAcks.get(key);
      if (pending) {
        clearTimeout(pending.timeout);
        this.pendingAcks.delete(key);
        if (event.status === Status.OK) pending.resolve(event);
        else pending.reject(new Error(`Device rejected frame (${event.status}).`));
      }
      this.dispatchEvent(new CustomEvent("ack", { detail: event }));
    }
  }

  async writeWithResponse(bytes) {
    if (!this.rx) throw new Error("Connect the hologram first.");
    if (typeof this.rx.writeValueWithResponse === "function") {
      await this.rx.writeValueWithResponse(bytes);
    } else {
      await this.rx.writeValue(bytes);
    }
  }

  async writeWithoutResponse(bytes) {
    if (!this.rx) throw new Error("Connect the hologram first.");
    if (typeof this.rx.writeValueWithoutResponse === "function") {
      await this.rx.writeValueWithoutResponse(bytes);
    } else {
      await this.rx.writeValue(bytes);
    }
  }

  waitForAck(command, sequence) {
    const key = `${command}:${sequence}`;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingAcks.delete(key);
        reject(new Error("The hologram did not acknowledge the frame in time."));
      }, ACK_TIMEOUT_MS);
      this.pendingAcks.set(key, { resolve, reject, timeout });
    });
  }

  async sendFrame(frame, holdMilliseconds = 100) {
    if (!(frame instanceof Uint8Array) || frame.length !== OLED_FRAME_BYTES) {
      throw new RangeError(`Frames must be ${OLED_FRAME_BYTES} bytes.`);
    }
    this.sequence = (this.sequence + 1) & 0xffff;
    if (this.sequence === 0) this.sequence = 1;
    const sequence = this.sequence;
    const checksum = crc32(frame);

    await this.writeWithResponse(
      makeFrameBegin(sequence, frame.length, holdMilliseconds, checksum),
    );
    for (let offset = 0; offset < frame.length; offset += FRAME_CHUNK_BYTES) {
      const chunk = frame.subarray(offset, offset + FRAME_CHUNK_BYTES);
      await this.writeWithoutResponse(makeFrameChunk(sequence, offset, chunk));
      if (offset > 0 && offset % (FRAME_CHUNK_BYTES * 4) === 0) await delay(1);
    }
    const acknowledged = this.waitForAck(Command.FRAME_COMMIT, sequence);
    await this.writeWithResponse(makeSimpleCommand(Command.FRAME_COMMIT, sequence));
    return acknowledged;
  }

  async clear() {
    this.sequence = (this.sequence + 1) & 0xffff || 1;
    const acknowledged = this.waitForAck(Command.CLEAR, this.sequence);
    await this.writeWithResponse(makeSimpleCommand(Command.CLEAR, this.sequence));
    return acknowledged;
  }

  async setBrightness(value) {
    this.sequence = (this.sequence + 1) & 0xffff || 1;
    const acknowledged = this.waitForAck(Command.BRIGHTNESS, this.sequence);
    await this.writeWithResponse(
      makeSimpleCommand(Command.BRIGHTNESS, this.sequence, Math.round(value)),
    );
    return acknowledged;
  }
}

export class LatestFrameQueue extends EventTarget {
  constructor(client) {
    super();
    this.client = client;
    this.pending = null;
    this.sending = false;
    this.sentFrames = 0;
    this.droppedFrames = 0;
  }

  submit(frame, holdMilliseconds = 100) {
    if (this.pending) this.droppedFrames += 1;
    this.pending = { frame: frame.slice(), holdMilliseconds };
    if (!this.sending) void this.drain();
  }

  async drain() {
    this.sending = true;
    try {
      while (this.pending && this.client.connected) {
        const next = this.pending;
        this.pending = null;
        const ack = await this.client.sendFrame(next.frame, next.holdMilliseconds);
        this.sentFrames += 1;
        this.dispatchEvent(new CustomEvent("sent", {
          detail: { ack, sentFrames: this.sentFrames, droppedFrames: this.droppedFrames },
        }));
      }
    } catch (error) {
      this.pending = null;
      this.dispatchEvent(new CustomEvent("error", { detail: error }));
    } finally {
      this.sending = false;
    }
  }
}

