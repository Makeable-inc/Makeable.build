import { HologramBleClient, LatestFrameQueue } from "./ble-client.js";
import { crc32 } from "./ble-protocol.js";
import {
  OLED_HEIGHT,
  OLED_WIDTH,
  drawMediaCover,
  frameToImageData,
  imageDataToFrame,
} from "./frame-codec.js";

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const displayCanvas = $("#displayCanvas");
const displayContext = displayCanvas.getContext("2d", { alpha: false });
const previewBuffer = document.createElement("canvas");
previewBuffer.width = OLED_WIDTH;
previewBuffer.height = OLED_HEIGHT;
const previewBufferContext = previewBuffer.getContext("2d", { alpha: false });
const drawCanvas = $("#drawCanvas");
const drawContext = drawCanvas.getContext("2d", { alpha: false });
const sourceCanvas = $("#sourceCanvas");
const sourceContext = sourceCanvas.getContext("2d", { alpha: false, willReadFrequently: true });
const imageSource = $("#imageSource");
const videoSource = $("#videoSource");

const connectButton = $("#connectButton");
const connectionPill = $("#connectionPill");
const streamStats = $("#streamStats");
const modeLabel = $("#modeLabel");
const toast = $("#toast");

const client = new HologramBleClient();
const frameQueue = new LatestFrameQueue(client);

let currentMode = "draw";
let currentFrame = null;
let lastFrameChecksum = null;
let toastTimer = null;
let drawTool = "pen";
let drawing = false;
let previousPoint = null;
let drawPublishTimer = null;
let messagePlaying = false;
let messageStartedAt = performance.now();
let mediaPlaying = false;
let mediaKind = null;
let mediaObjectUrl = null;
let lastMessageRender = 0;
let lastMediaRender = 0;

const modeNames = { draw: "Draw", message: "Message", media: "GIF / Video" };

function showToast(message, duration = 3200) {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.hidden = false;
  toastTimer = setTimeout(() => { toast.hidden = true; }, duration);
}

function getFrameOptions({ media = false } = {}) {
  return {
    threshold: media ? Number($("#threshold").value) : 128,
    dither: media ? $("#ditherToggle").checked : false,
    invert: $("#invertToggle").checked,
    mirrorX: $("#mirrorToggle").checked,
    rotate: Number($("#rotation").value),
  };
}

function previewFrame(frame) {
  previewBufferContext.putImageData(frameToImageData(frame, previewBufferContext), 0, 0);
  displayContext.save();
  displayContext.fillStyle = "#000";
  displayContext.fillRect(0, 0, OLED_WIDTH, OLED_HEIGHT);
  if ($("#mirrorToggle").checked) {
    displayContext.translate(OLED_WIDTH, 0);
    displayContext.scale(-1, 1);
  }
  displayContext.drawImage(previewBuffer, 0, 0);
  displayContext.restore();
}

function publishImageData(imageData, { media = false, force = false, holdMilliseconds = 100 } = {}) {
  const frame = imageDataToFrame(imageData, getFrameOptions({ media }));
  const checksum = crc32(frame);
  currentFrame = frame;
  previewFrame(frame);
  if (force || checksum !== lastFrameChecksum) {
    lastFrameChecksum = checksum;
    if (client.connected) frameQueue.submit(frame, holdMilliseconds);
  }
}

function publishContext(context, options) {
  publishImageData(context.getImageData(0, 0, OLED_WIDTH, OLED_HEIGHT), options);
}

function setMode(mode) {
  currentMode = mode;
  $$(".mode-tab").forEach((tab) => {
    const active = tab.dataset.mode === mode;
    tab.classList.toggle("is-active", active);
    tab.setAttribute("aria-selected", String(active));
  });
  $$('[data-panel]').forEach((panel) => { panel.hidden = panel.dataset.panel !== mode; });
  modeLabel.textContent = modeNames[mode];

  if (mode === "draw") publishContext(drawContext, { force: true });
  if (mode === "message") renderMessageFrame(performance.now(), true);
  if (mode === "media") renderMediaFrame(true);
}

function initializeDrawing() {
  drawContext.fillStyle = "#000";
  drawContext.fillRect(0, 0, OLED_WIDTH, OLED_HEIGHT);
  drawContext.strokeStyle = "#fff";
  drawContext.fillStyle = "#fff";
  drawContext.lineCap = "round";
  drawContext.lineJoin = "round";

  // A small starter glint keeps the first preview from appearing broken.
  drawContext.beginPath();
  drawContext.arc(64, 64, 3, 0, Math.PI * 2);
  drawContext.fill();
  drawContext.beginPath();
  drawContext.moveTo(64, 52);
  drawContext.lineTo(64, 76);
  drawContext.moveTo(52, 64);
  drawContext.lineTo(76, 64);
  drawContext.lineWidth = 1;
  drawContext.stroke();
  publishContext(drawContext, { force: true });
}

function pointerPoint(event) {
  const rect = drawCanvas.getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) / rect.width) * OLED_WIDTH,
    y: ((event.clientY - rect.top) / rect.height) * OLED_HEIGHT,
  };
}

function drawSegment(point) {
  const size = Number($("#brushSize").value);
  drawContext.strokeStyle = drawTool === "pen" ? "#fff" : "#000";
  drawContext.fillStyle = drawContext.strokeStyle;
  drawContext.lineWidth = size;
  if (!previousPoint) {
    drawContext.beginPath();
    drawContext.arc(point.x, point.y, size / 2, 0, Math.PI * 2);
    drawContext.fill();
  } else {
    drawContext.beginPath();
    drawContext.moveTo(previousPoint.x, previousPoint.y);
    drawContext.lineTo(point.x, point.y);
    drawContext.stroke();
  }
  previousPoint = point;
  clearTimeout(drawPublishTimer);
  drawPublishTimer = setTimeout(() => publishContext(drawContext), 55);
}

function beginDrawing(event) {
  drawing = true;
  previousPoint = null;
  drawCanvas.setPointerCapture(event.pointerId);
  drawSegment(pointerPoint(event));
}

function continueDrawing(event) {
  if (!drawing) return;
  const events = event.getCoalescedEvents?.() || [event];
  for (const coalesced of events) drawSegment(pointerPoint(coalesced));
}

function endDrawing() {
  if (!drawing) return;
  drawing = false;
  previousPoint = null;
  publishContext(drawContext, { force: true });
}

function messageLines() {
  return $("#messageInput").value
    .split(/\n+/)
    .map((line) => line.trim().toUpperCase())
    .filter(Boolean)
    .slice(0, 8);
}

function fitText(context, text, maximumWidth, startingSize, minimumSize = 9) {
  let size = startingSize;
  do {
    context.font = `900 ${size}px ui-rounded, system-ui, sans-serif`;
    if (context.measureText(text).width <= maximumWidth) break;
    size -= 1;
  } while (size > minimumSize);
  return size;
}

function renderPunch(lines, elapsed, speed) {
  const index = Math.floor(elapsed / speed) % lines.length;
  const phase = (elapsed % speed) / speed;
  const text = lines[index];
  const scale = 0.84 + (Math.sin(Math.min(1, phase * 2) * Math.PI / 2) * 0.16);
  const size = fitText(sourceContext, text, 116, 48);

  sourceContext.save();
  sourceContext.translate(64, 64);
  sourceContext.scale(scale, scale);
  sourceContext.textAlign = "center";
  sourceContext.textBaseline = "middle";
  sourceContext.font = `900 ${size}px ui-rounded, system-ui, sans-serif`;
  sourceContext.lineWidth = 2;
  sourceContext.strokeStyle = "#fff";
  sourceContext.strokeText(text, 0, 0, 118);
  sourceContext.fillStyle = "#fff";
  sourceContext.fillText(text, 0, 0, 118);
  sourceContext.restore();

  sourceContext.fillStyle = "#fff";
  const progress = Math.max(2, Math.round(118 * phase));
  sourceContext.fillRect(5, 119, progress, 3);
}

function renderStack(lines, elapsed, speed) {
  const visible = lines.slice(0, 5);
  const active = Math.floor(elapsed / speed) % visible.length;
  const rowHeight = 116 / visible.length;
  sourceContext.textAlign = "center";
  sourceContext.textBaseline = "middle";
  visible.forEach((line, index) => {
    const y = 6 + (rowHeight * index);
    const size = fitText(sourceContext, line, 112, Math.min(30, rowHeight * 0.75), 8);
    sourceContext.font = `850 ${size}px ui-rounded, system-ui, sans-serif`;
    if (index === active) {
      sourceContext.fillStyle = "#fff";
      sourceContext.fillRect(4, y, 120, rowHeight - 2);
      sourceContext.fillStyle = "#000";
      sourceContext.fillText(line, 64, y + ((rowHeight - 2) / 2), 112);
    } else {
      sourceContext.strokeStyle = "#fff";
      sourceContext.lineWidth = 1;
      sourceContext.strokeText(line, 64, y + ((rowHeight - 2) / 2), 112);
    }
  });
}

function renderTicker(lines, elapsed, speed) {
  const text = lines.join("  •  ");
  sourceContext.font = "900 25px ui-rounded, system-ui, sans-serif";
  sourceContext.textBaseline = "middle";
  const width = sourceContext.measureText(text).width;
  const travel = width + 150;
  const x = 138 - ((elapsed / speed) * 54 % travel);
  sourceContext.fillStyle = "#fff";
  sourceContext.fillText(text, x, 64);
  sourceContext.fillRect(0, 26, 128, 2);
  sourceContext.fillRect(0, 100, 128, 2);
}

function renderMessageFrame(timestamp, force = false) {
  const lines = messageLines();
  sourceContext.fillStyle = "#000";
  sourceContext.fillRect(0, 0, OLED_WIDTH, OLED_HEIGHT);
  if (!lines.length) {
    publishContext(sourceContext, { force });
    return;
  }
  const elapsed = messagePlaying ? timestamp - messageStartedAt : 0;
  const speed = Number($("#messageSpeed").value);
  const style = $("#messageStyle").value;
  if (style === "stack") renderStack(lines, elapsed, speed);
  else if (style === "ticker") renderTicker(lines, elapsed, speed);
  else renderPunch(lines, elapsed, speed);
  publishContext(sourceContext, { force, holdMilliseconds: Math.min(250, speed) });
}

function drawMediaSource() {
  if (!mediaKind) return false;
  const source = mediaKind === "video" ? videoSource : imageSource;
  return drawMediaCover(sourceContext, source, $("#mediaFit").value);
}

function renderMediaFrame(force = false) {
  if (!drawMediaSource()) return;
  publishContext(sourceContext, {
    media: true,
    force,
    holdMilliseconds: Math.round(1000 / Number($("#mediaFps").value)),
  });
}

async function loadMediaFile(file) {
  if (!file) return;
  if (mediaObjectUrl) URL.revokeObjectURL(mediaObjectUrl);
  mediaObjectUrl = URL.createObjectURL(file);
  mediaPlaying = false;
  $("#mediaPlayButton").setAttribute("aria-pressed", "false");
  $("#mediaPlayButton").lastChild.textContent = " Play";
  $("#mediaName").textContent = `${file.name} · ${(file.size / 1024 / 1024).toFixed(1)} MB`;
  $("#mediaName").hidden = false;

  if (file.type.startsWith("video/")) {
    mediaKind = "video";
    imageSource.hidden = true;
    videoSource.hidden = true;
    videoSource.src = mediaObjectUrl;
    await new Promise((resolve, reject) => {
      videoSource.onloadedmetadata = resolve;
      videoSource.onerror = () => reject(new Error("This video format could not be decoded by the browser."));
    });
  } else {
    mediaKind = "image";
    videoSource.pause();
    videoSource.removeAttribute("src");
    imageSource.src = mediaObjectUrl;
    await new Promise((resolve, reject) => {
      imageSource.onload = resolve;
      imageSource.onerror = () => reject(new Error("This image or GIF could not be decoded by the browser."));
    });
  }

  $("#mediaPlayButton").disabled = false;
  setMode("media");
  renderMediaFrame(true);
  showToast("Media ready. Tap Play to stream the animation.");
}

function toggleMessagePlayback() {
  messagePlaying = !messagePlaying;
  messageStartedAt = performance.now();
  $("#messagePlayButton").setAttribute("aria-pressed", String(messagePlaying));
  $("#messagePlayButton").lastChild.textContent = messagePlaying ? " Pause" : " Play";
  renderMessageFrame(performance.now(), true);
}

async function toggleMediaPlayback() {
  if (!mediaKind) return;
  mediaPlaying = !mediaPlaying;
  if (mediaKind === "video") {
    if (mediaPlaying) await videoSource.play();
    else videoSource.pause();
  }
  $("#mediaPlayButton").setAttribute("aria-pressed", String(mediaPlaying));
  $("#mediaPlayButton").lastChild.textContent = mediaPlaying ? " Pause" : " Play";
  renderMediaFrame(true);
}

function animationLoop(timestamp) {
  if (currentMode === "message" && messagePlaying && timestamp - lastMessageRender >= 100) {
    lastMessageRender = timestamp;
    renderMessageFrame(timestamp);
  }
  if (currentMode === "media" && mediaPlaying) {
    const interval = 1000 / Number($("#mediaFps").value);
    if (timestamp - lastMediaRender >= interval) {
      lastMediaRender = timestamp;
      renderMediaFrame();
    }
  }
  requestAnimationFrame(animationLoop);
}

function rerenderCurrentMode(force = true) {
  if (currentMode === "draw") publishContext(drawContext, { force });
  else if (currentMode === "message") renderMessageFrame(performance.now(), force);
  else renderMediaFrame(force);
}

async function connectOrDisconnect() {
  if (client.connected) {
    client.disconnect();
    return;
  }
  connectButton.disabled = true;
  $("[data-connect-label]").textContent = "Connecting…";
  try {
    const contract = await client.connect();
    connectButton.classList.add("is-connected");
    $("[data-connect-label]").textContent = "Connected";
    connectionPill.textContent = "Live over BLE";
    connectionPill.classList.add("is-live");
    showToast(`Connected to ${contract.width} × ${contract.height} Hologram.`);
    await client.setBrightness(Number($("#brightness").value));
    if (currentFrame) frameQueue.submit(currentFrame, 100);
  } catch (error) {
    $("[data-connect-label]").textContent = "Connect";
    showToast(error.message, 5200);
  } finally {
    connectButton.disabled = false;
  }
}

client.addEventListener("disconnected", () => {
  connectButton.classList.remove("is-connected");
  $("[data-connect-label]").textContent = "Connect";
  connectionPill.textContent = "Preview mode";
  connectionPill.classList.remove("is-live");
  streamStats.textContent = "128 × 128 · 1-bit";
  showToast("Hologram disconnected. Your preview is still here.");
});

frameQueue.addEventListener("sent", (event) => {
  const { ack, sentFrames, droppedFrames } = event.detail;
  streamStats.textContent = `${ack.renderMilliseconds} ms OLED · ${sentFrames} sent · ${droppedFrames} skipped`;
});
frameQueue.addEventListener("error", (event) => showToast(event.detail.message, 4500));

connectButton.addEventListener("click", connectOrDisconnect);
$$(".mode-tab").forEach((tab) => tab.addEventListener("click", () => setMode(tab.dataset.mode)));

drawCanvas.addEventListener("pointerdown", beginDrawing);
drawCanvas.addEventListener("pointermove", continueDrawing);
drawCanvas.addEventListener("pointerup", endDrawing);
drawCanvas.addEventListener("pointercancel", endDrawing);
$("#clearDrawButton").addEventListener("click", () => {
  drawContext.fillStyle = "#000";
  drawContext.fillRect(0, 0, OLED_WIDTH, OLED_HEIGHT);
  publishContext(drawContext, { force: true });
});
$$("[data-tool]").forEach((button) => button.addEventListener("click", () => {
  drawTool = button.dataset.tool;
  $$("[data-tool]").forEach((item) => item.classList.toggle("is-active", item === button));
}));

$("#messagePlayButton").addEventListener("click", toggleMessagePlayback);
$("#messageInput").addEventListener("input", () => renderMessageFrame(performance.now(), true));
$("#messageStyle").addEventListener("change", () => renderMessageFrame(performance.now(), true));
$("#messageSpeed").addEventListener("change", () => { messageStartedAt = performance.now(); });
$$("[data-message-template]").forEach((button) => button.addEventListener("click", () => {
  $("#messageInput").value = button.dataset.messageTemplate.replaceAll("\\n", "\n");
  renderMessageFrame(performance.now(), true);
}));

$("#mediaInput").addEventListener("change", (event) => {
  loadMediaFile(event.target.files?.[0]).catch((error) => showToast(error.message, 5000));
});
$("#mediaPlayButton").addEventListener("click", () => {
  toggleMediaPlayback().catch((error) => showToast(error.message, 5000));
});
for (const eventName of ["dragenter", "dragover"]) {
  $("#mediaDropZone").addEventListener(eventName, (event) => {
    event.preventDefault();
    $("#mediaDropZone").classList.add("is-dragging");
  });
}
for (const eventName of ["dragleave", "drop"]) {
  $("#mediaDropZone").addEventListener(eventName, (event) => {
    event.preventDefault();
    $("#mediaDropZone").classList.remove("is-dragging");
  });
}
$("#mediaDropZone").addEventListener("drop", (event) => {
  loadMediaFile(event.dataTransfer.files?.[0]).catch((error) => showToast(error.message, 5000));
});
$("#mediaFit").addEventListener("change", () => renderMediaFrame(true));
$("#mediaFps").addEventListener("change", () => { lastMediaRender = 0; });
$("#threshold").addEventListener("input", () => {
  $("#thresholdOutput").textContent = $("#threshold").value;
  renderMediaFrame(true);
});
$("#ditherToggle").addEventListener("change", () => renderMediaFrame(true));

for (const selector of ["#mirrorToggle", "#invertToggle", "#rotation"]) {
  $(selector).addEventListener("change", () => rerenderCurrentMode(true));
}
$("#brightness").addEventListener("input", () => {
  const value = Number($("#brightness").value);
  $("#brightnessOutput").textContent = `${Math.round((value / 255) * 100)}%`;
});
$("#brightness").addEventListener("change", async () => {
  if (!client.connected) return;
  try { await client.setBrightness(Number($("#brightness").value)); }
  catch (error) { showToast(error.message); }
});

const helpDialog = $("#helpDialog");
for (const selector of ["#helpButton", "#footerHelpButton"]) {
  $(selector).addEventListener("click", () => helpDialog.showModal());
}
$("#closeHelpButton").addEventListener("click", () => helpDialog.close());
helpDialog.addEventListener("click", (event) => {
  if (event.target === helpDialog) helpDialog.close();
});

if (!("bluetooth" in navigator)) $("#compatibilityNotice").hidden = false;
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register(
    "/hologram/sw.js",
    { scope: "/hologram" },
  ).catch(() => {}));
}

initializeDrawing();
requestAnimationFrame(animationLoop);
