import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { compactStepNumbers, wiringCopy, wiringEndpointLabel } from "./wiring-presentation.mjs";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const form = document.querySelector("#idea-form");
const idea = document.querySelector("#idea");
const generate = document.querySelector("#generate");
const loading = document.querySelector("#loading");
const loadingDetail = document.querySelector("#loading-detail");
const emptyState = document.querySelector("#empty-state");
const trace = document.querySelector("#trace");
const parts = document.querySelector("#parts");
const nets = document.querySelector("#nets");
const steps = document.querySelector("#steps");
const raw = document.querySelector("#raw-json");
const runState = document.querySelector("#run-state");
const canvasStatus = document.querySelector("#canvas-status");
const sceneSummary = document.querySelector("#scene-summary");
const charCount = document.querySelector("#char-count");
const credentialBridge = document.querySelector("#credential-bridge");
const catalogCoverage = document.querySelector("#catalog-coverage");
const focusView = document.querySelector("#focus-view");
const resultEyebrow = document.querySelector("#result-eyebrow");
const resultTitle = document.querySelector("#result-title");
const resultSummary = document.querySelector("#result-summary");
const metricParts = document.querySelector("#metric-parts");
const metricWires = document.querySelector("#metric-wires");
const activeStep = document.querySelector("#active-step");
const activeStepNumber = document.querySelector("#active-step-number");
const stepBack = document.querySelector("#step-back");
const stepNext = document.querySelector("#step-next");
const stepProgress = document.querySelector("#step-progress");
const stepConnections = document.querySelector("#step-connections");
const stepSafety = document.querySelector("#step-safety");
const assemblyProgress = document.querySelector("#assembly-progress");
const buildMiniature = document.querySelector("#build-miniature");
const surfaceName = document.querySelector("#surface-name");
const surfaceBack = document.querySelector("#surface-back");
const partResolution = document.querySelector("#part-resolution");
const resolutionTitle = document.querySelector("#resolution-title");
const resolutionMessage = document.querySelector("#resolution-message");
const resolutionAttempt = document.querySelector("#resolution-attempt");
const unsupportedParts = document.querySelector("#unsupported-parts");
const resolutionControls = document.querySelector("#resolution-controls");
const resolutionNote = document.querySelector("#resolution-note");
const resolutionRetry = document.querySelector("#resolution-retry");
const resolutionFeedback = document.querySelector("#resolution-feedback");
const pageParams = new URLSearchParams(window.location.search);
const guideMode = pageParams.get("mode") === "guide";
const embeddedGuideMode = guideMode && pageParams.get("embed") === "1";
const sourceBuildId = pageParams.get("sourceBuildId")?.trim() || "";

document.body.classList.toggle("guide-mode", guideMode);
document.body.classList.toggle("embedded-guide-mode", embeddedGuideMode);
if (guideMode) surfaceName.textContent = "Step-by-step assembly";
const returnTo = pageParams.get("returnTo")?.trim() || "";
if (guideMode && returnTo.startsWith("/")) {
  surfaceBack.href = returnTo;
  surfaceBack.setAttribute("aria-label", "Back to project overview");
}
const requestedIdea = pageParams.get("idea")?.trim() || "";
if (requestedIdea) idea.value = requestedIdea;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xfafaf8);
const camera = new THREE.PerspectiveCamera(38, 1, 0.001, 10);
camera.position.set(0.18, 0.14, 0.22);
let renderer = null;
let controls = null;
try {
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.25;
  renderer.shadowMap.enabled = true;
  document.querySelector("#canvas").prepend(renderer.domElement);
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = .08;
  controls.target.set(0, 0.01, 0);
  controls.minDistance = .07;
  controls.maxDistance = 1.8;
  controls.screenSpacePanning = true;
} catch {
  document.querySelector("#canvas").classList.add("diagram-fallback");
}
scene.add(new THREE.HemisphereLight(0xffffff, 0xd4d9dc, 2.25));
const keyLight = new THREE.DirectionalLight(0xffffff, 3.1);
keyLight.position.set(.4, .65, .45);
keyLight.castShadow = true;
scene.add(keyLight);
const rim = new THREE.DirectionalLight(0xdcecff, 1.2);
rim.position.set(-.35, .2, -.25);
scene.add(rim);
const grid = new THREE.GridHelper(.6, 18, 0xaeb7bc, 0xe2e6e8);
grid.position.y = -.015;
scene.add(grid);

let assemblyGroup = new THREE.Group();
scene.add(assemblyGroup);
let renderGeneration = 0;
let activeBuildSteps = [];
let activeStepIndex = -1;
let activeAssembly = null;
let negotiationAttempt = 1;
let pendingResolution = null;
let approvedSubstitutions = [];
let embeddedRequestedStep = 0;
let savedViewerState = "loading";
const renderedWireMeshes = new Map();
const loader = new GLTFLoader();

window.addEventListener("message", (event) => {
  if (!embeddedGuideMode || event.origin !== window.location.origin || event.source !== window.parent) return;
  if (event.data?.type !== "makeable:wiring-step" || event.data?.buildId !== sourceBuildId) return;
  const requestedStep = Number(event.data.stepIndex);
  if (!Number.isInteger(requestedStep) || requestedStep < 0) return;
  embeddedRequestedStep = requestedStep;
  if (activeBuildSteps.length) selectStep(Math.min(embeddedRequestedStep, activeBuildSteps.length - 1));
  publishViewerState(savedViewerState);
});

function publishViewerState(state) {
  savedViewerState = state;
  document.body.dataset.viewerState = state;
  if (embeddedGuideMode) window.parent.postMessage({ type: "makeable:wiring-status", buildId: sourceBuildId, state }, window.location.origin);
}
document.querySelector("#reload-saved-viewer").addEventListener("click", () => {
  if (sourceBuildId) window.location.reload();
});

document.querySelectorAll("[data-guide-pane]").forEach((button) => button.addEventListener("click", () => {
  document.body.dataset.guidePane = button.dataset.guidePane;
  document.querySelectorAll("[data-guide-pane]").forEach(item => item.setAttribute("aria-pressed", String(item === button)));
}));
// Exact catalog GLBs may retain supplied cable geometry as hidden electrical
// evidence. Circuit Studio presents only compiler-owned logical guide lines,
// so unused cable meshes must never appear as a second, floating wire path.
const LOGICAL_GUIDE_HIDDEN_NODE_TOKENS = Object.freeze([
  "included-cable",
  "factory-cable",
  "factory-lead",
  "included-harness",
]);
const viewPresets = {
  iso: { direction: [1, .72, 1.12], distance: 1.82 },
  opposite: { direction: [-1, .72, -1.12], distance: 1.82 },
  top: { direction: [0, 1, .002], distance: 1.92 },
  side: { direction: [1, .16, 0], distance: 1.78 },
};
const wireDisplayColors = Object.freeze({
  black: 0x111820,
  red: 0xd6293a,
  yellow: 0xc78b00,
  green: 0x178a52,
  blue: 0x1769aa,
});

// The compiler supplies a collision-cleared, filleted polyline. Render that
// exact path by arc length; re-splining accepted points can overshoot the
// contract and visually drive a conductor through a GLB or another wire.
class AcceptedPolylineCurve3 extends THREE.Curve {
  constructor(points) {
    super();
    this.points = points;
    this.cumulativeLengths = [0];
    for (let index = 1; index < points.length; index += 1) {
      this.cumulativeLengths.push(this.cumulativeLengths.at(-1) + points[index - 1].distanceTo(points[index]));
    }
    this.totalLength = this.cumulativeLengths.at(-1) || 0;
  }

  getPoint(t, target = new THREE.Vector3()) {
    if (this.points.length === 1 || this.totalLength <= Number.EPSILON) return target.copy(this.points[0]);
    const distance = THREE.MathUtils.clamp(t, 0, 1) * this.totalLength;
    let segment = 1;
    while (segment < this.cumulativeLengths.length - 1 && this.cumulativeLengths[segment] < distance) segment += 1;
    const startDistance = this.cumulativeLengths[segment - 1];
    const segmentLength = this.cumulativeLengths[segment] - startDistance;
    const alpha = segmentLength > Number.EPSILON ? (distance - startDistance) / segmentLength : 0;
    return target.lerpVectors(this.points[segment - 1], this.points[segment], alpha);
  }

  getLength() {
    return this.totalLength;
  }
}

idea.addEventListener("input", () => { charCount.textContent = `${idea.value.length} / 2000`; });
document.querySelectorAll("[data-example]").forEach((button) => button.addEventListener("click", () => {
  idea.value = button.dataset.example || "";
  charCount.textContent = `${idea.value.length} / 2000`;
  idea.focus();
}));
document.querySelector("#raw-toggle").addEventListener("click", () => { raw.hidden = !raw.hidden; });
document.querySelectorAll("[data-view]").forEach((button) => button.addEventListener("click", () => setView(button.dataset.view, button)));
focusView.addEventListener("click", () => {
  const focused = document.querySelector(".shell").classList.toggle("focus-view");
  focusView.classList.toggle("active", focused);
  focusView.setAttribute("aria-pressed", String(focused));
  focusView.textContent = focused ? "Close" : "Expand";
  requestAnimationFrame(() => resize());
});
stepBack.addEventListener("click", () => selectStep(activeStepIndex - 1));
stepNext.addEventListener("click", () => selectStep(activeStepIndex + 1));
steps.addEventListener("click", (event) => {
  const button = event.target.closest("[data-step-index]");
  if (button) selectStep(Number(button.dataset.stepIndex));
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const prompt = idea.value.trim();
  if (prompt.length < 12) return;
  negotiationAttempt = 1;
  pendingResolution = null;
  approvedSubstitutions = [];
  resolutionNote.value = "";
  hidePartResolution();
  await runBuild(prompt);
});

resolutionRetry.addEventListener("click", async () => {
  if (!pendingResolution || pendingResolution.status !== "needs-user-choice") return;
  const choices = [...unsupportedParts.querySelectorAll("input[type=radio]:checked")].map((input) => ({
    unsupportedCatalogId: input.dataset.unsupportedCatalogId,
    replacementCatalogId: input.value,
  }));
  const note = resolutionNote.value.trim();
  if (!choices.length && !note) {
    resolutionFeedback.hidden = false;
    resolutionFeedback.textContent = "Choose a supported part or tell us what you want to keep.";
    resolutionNote.focus();
    return;
  }
  const choiceByUnsupported = new Map(approvedSubstitutions.map((choice) => [choice.unsupportedCatalogId, choice]));
  for (const choice of choices) choiceByUnsupported.set(choice.unsupportedCatalogId, choice);
  approvedSubstitutions = [...choiceByUnsupported.values()];
  negotiationAttempt = Math.min(3, negotiationAttempt + 1);
  resolutionFeedback.hidden = true;
  await runBuild(idea.value.trim(), { clarification: note });
});

async function runBuild(prompt, { clarification = "" } = {}) {
  resetRun();
  setBusy(true, "Calling Sol parts planner…");
  resolutionRetry.disabled = true;
  const started = performance.now();
  try {
    const response = await fetch("/api/production-simulations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        idea: prompt,
        negotiationAttempt,
        substitutions: approvedSubstitutions,
        clarification,
      }),
    });
    const body = await response.json();
    raw.textContent = JSON.stringify(body, null, 2);
    if (!response.ok && body.resolution) {
      renderPartResolution(body.resolution);
      setBusy(false);
      runState.textContent = body.resolution.status === "unable-after-three-attempts" ? "Unable" : "Your choice";
      canvasStatus.textContent = "Waiting for a supported-part choice";
      return;
    }
    if (!response.ok) throw new Error(body.error || "The assembly API rejected this build.");
    hidePartResolution();
    const build = body.build;
    renderTrace(traceEntriesForBuild(build));
    renderInspector(build);
    renderBuildIdentity(build);
    loadingDetail.textContent = "Hash-checking and loading AWS GLBs…";
    await renderAssembly(build.artifacts.assembly);
    renderMachineGates(build);
    runState.textContent = `${((performance.now() - started) / 1000).toFixed(1)} s`;
    canvasStatus.textContent = "Assembly ready · machine gates passed";
    sceneSummary.textContent = assemblySummary(build.artifacts.assembly);
    setBusy(false);
  } catch (error) {
    setBusy(false);
    runState.textContent = "Blocked";
    canvasStatus.textContent = "Build blocked · no guessed assembly shown";
    clearAssemblyView();
    trace.innerHTML = `<li class="error"><span class="num">!</span><div><strong>Fail closed</strong><small>${escapeHtml(error.message)}</small></div><time>BLOCK</time></li>`;
    document.querySelectorAll(".gates li").forEach((item) => { item.className = "fail"; item.querySelector("b").textContent = "FAIL"; });
  } finally {
    resolutionRetry.disabled = false;
  }
}

function renderPartResolution(resolution) {
  pendingResolution = resolution;
  negotiationAttempt = Number(resolution.attempt || negotiationAttempt);
  partResolution.hidden = false;
  partResolution.classList.toggle("exhausted", resolution.status === "unable-after-three-attempts");
  document.body.classList.add("resolution-active");
  resolutionTitle.textContent = resolution.title || "Let’s adjust one of the parts";
  resolutionMessage.textContent = resolution.message || "Choose a supported option and try again.";
  resolutionAttempt.textContent = `Attempt ${resolution.attempt} of ${resolution.maxAttempts}`;
  unsupportedParts.innerHTML = (resolution.unsupported || []).map((part, partIndex) => `
    <section class="unsupported-part">
      <strong>${escapeHtml(part.name)}</strong>
      <p>${escapeHtml(part.reason)}</p>
      ${part.alternatives?.length ? `
        <div class="alternative-list" role="radiogroup" aria-label="Supported alternatives for ${escapeHtml(part.name)}">
          ${part.alternatives.map((alternative, alternativeIndex) => `
            <label class="alternative-option">
              <input type="radio" name="replacement-${partIndex}" value="${escapeHtml(alternative.catalogId)}" data-unsupported-catalog-id="${escapeHtml(part.catalogId)}" ${alternativeIndex === 0 ? "checked" : ""}>
              <span class="alternative-card"><strong>${escapeHtml(alternative.name)}</strong><small>${escapeHtml(alternative.whyItFits)}</small></span>
            </label>
          `).join("")}
        </div>
      ` : ""}
    </section>
  `).join("");
  const exhausted = resolution.status === "unable-after-three-attempts";
  resolutionControls.hidden = exhausted;
  resolutionFeedback.hidden = true;
  resultEyebrow.textContent = exhausted ? "Three attempts completed" : "A supported part is needed";
  resultTitle.textContent = resolution.title;
  resultSummary.textContent = resolution.message;
  clearAssemblyView();
  partResolution.scrollIntoView({ behavior: "smooth", block: "start" });
}

function hidePartResolution() {
  partResolution.hidden = true;
  document.body.classList.remove("resolution-active");
}

function resetRun() {
  clearAssemblyView();
  trace.innerHTML = workflowSkeleton();
  raw.textContent = "";
  runState.textContent = "Running";
  resultEyebrow.textContent = "Compiling one-shot build";
  resultTitle.textContent = "Resolving the exact circuit";
  resultSummary.textContent = "The API is selecting verified parts and compiling physical contacts, placement, and wiring.";
  canvasStatus.textContent = "API workflow active";
  document.querySelectorAll(".gates li").forEach((item) => { item.className = ""; item.querySelector("b").textContent = "WAIT"; });
  document.querySelector("#gate-count").textContent = "0 / 8";
}

function clearAssemblyView() {
  renderGeneration += 1;
  assemblyGroup.traverse((object) => {
    object.geometry?.dispose?.();
    if (Array.isArray(object.material)) {
      for (const material of object.material) material.dispose?.();
    } else {
      object.material?.dispose?.();
    }
  });
  scene.remove(assemblyGroup);
  assemblyGroup = new THREE.Group();
  scene.add(assemblyGroup);
  renderedWireMeshes.clear();
  activeAssembly = null;
  document.querySelector("#canvas").querySelector(".circuit-diagram")?.remove();
  parts.innerHTML = "";
  nets.innerHTML = "";
  steps.innerHTML = "";
  activeBuildSteps = [];
  activeStepIndex = -1;
  document.querySelector("#part-count").textContent = "0";
  document.querySelector("#wire-count").textContent = "0";
  document.querySelector("#step-count").textContent = "0";
  activeStepNumber.textContent = "0";
  stepProgress.style.width = "0";
  stepBack.disabled = true;
  stepNext.disabled = true;
  stepConnections.innerHTML = "";
  stepSafety.hidden = true;
  stepSafety.textContent = "";
  assemblyProgress.innerHTML = "";
  buildMiniature.innerHTML = "";
  metricParts.textContent = "—";
  metricWires.textContent = "—";
  sceneSummary.textContent = "0 parts · 0 wires";
}

function setBusy(value, detail = "") {
  generate.disabled = value;
  loading.hidden = !value;
  if (detail) loadingDetail.textContent = detail;
  if (value) emptyState.hidden = true;
}

function traceEntriesForBuild(build) {
  const timeline = build?.artifacts?.pipeline?.timeline;
  if (Array.isArray(timeline) && timeline.length) return timeline;
  return [
    "planning_completed",
    "aws_registry_resolved",
    "named_endpoints_resolved",
    "assembly_contract_generated",
    "wiring_generated",
    "response_ready",
  ].map((name) => ({ name, elapsedMs: 0 }));
}

function renderTrace(entries = []) {
  const traceEntries = Array.isArray(entries) ? entries : [];
  const interesting = [
    ["planning_completed", "Parts plan", "POST /v1/responses · Sol xhigh · priority"],
    ["aws_registry_resolved", "Registry resolve", "GET CloudFront manifest"],
    ["named_endpoints_resolved", "Electrical graph", "Deterministic endpoint compiler"],
    ...(traceEntries.some((entry) => entry.name === "espnow_network_compiled")
      ? [["espnow_network_compiled", "ESP-NOW topology", "Deterministic node partition + transport contract"]]
      : []),
    ["assembly_contract_generated", "Placement", "Contract-owned transforms"],
    ["wiring_generated", "Wire routing", "POST /v1/responses · Sol 5.6 · xhigh · priority"],
    ["response_ready", "Browser delivery", "Verified AWS GLB scene"],
  ];
  trace.innerHTML = interesting.map(([eventName, title, route], index) => {
    const entry = traceEntries.find((item) => item.name === eventName);
    const ms = entry ? `${Number(entry.elapsedMs).toFixed(0)} ms` : "done";
    return `<li class="pass"><span class="num">${index + 1}</span><div><strong>${title}</strong><small>${route}</small></div><time>${ms}</time></li>`;
  }).join("");
}

function workflowSkeleton() {
  return ["Parts plan", "Registry resolve", "Electrical graph", "Placement", "Wire routing", "Browser delivery"]
    .map((title, index) => `<li><span class="num">${index + 1}</span><div><strong>${title}</strong><small>waiting for API</small></div><time>—</time></li>`).join("");
}

function renderInspector(build) {
  activeAssembly = build.artifacts.assembly;
  const assemblyParts = activeAssembly.parts;
  const partLabelById = new Map(assemblyParts.map((part) => [part.id, part.label]));
  document.querySelector("#part-count").textContent = assemblyParts.length;
  document.querySelector("#wire-count").textContent = activeAssembly.wires.length;
  metricParts.textContent = assemblyParts.length;
  parts.className = "parts";
  parts.innerHTML = assemblyParts.map((part, index) => `<article class="part-row"><span class="part-number">${index + 1}</span><div><strong>${escapeHtml(part.label)}</strong><small>${escapeHtml(partPurpose(part))}</small><span class="part-role">${escapeHtml(friendlyRole(part.role))}</span><code title="${escapeHtml(part.assetId)}">AWS model · ${escapeHtml(part.assetId)}</code></div></article>`).join("");
  nets.className = "nets";
  nets.innerHTML = [
    ...activeAssembly.wires.map((wire) => `<article class="net-row"><i style="background:${wire.color}"></i><div><strong>${escapeHtml(connectionHeading(wire))}</strong><small><span>From</span><code>${escapeHtml(friendlyEndpoint(wire.from, partLabelById))}</code><span>To</span><code>${escapeHtml(friendlyEndpoint(wire.to, partLabelById))}</code></small></div><b>${wire.connectionMode === "factory-harness" ? "KEYED" : escapeHtml(connectionKind(wire))}</b></article>`),
    ...(activeAssembly.wirelessLinks || []).map((link) => `<article class="net-row wireless-link"><i style="background:#16b8d4"></i><div><strong>ESP-NOW</strong><small>${escapeHtml(link.fromNodeId)} ⇄ ${escapeHtml(link.toNodeId)} · no physical wire</small></div><b>RADIO</b></article>`),
  ].join("");
  activeBuildSteps = normalizedGuideSteps(activeAssembly);
  document.querySelector("#step-count").textContent = activeBuildSteps.length;
  metricWires.textContent = activeBuildSteps.length;
  steps.className = "steps";
  steps.innerHTML = activeBuildSteps.map((step, index) => `<button type="button" class="step-row" data-step-index="${index}"><span class="step-number">${index + 1}</span><span><strong>${escapeHtml(step.title)}</strong><p>${escapeHtml(step.beginnerInstruction)}</p></span></button>`).join("");
  assemblyProgress.innerHTML = activeBuildSteps.map((step, index) => `<button type="button" data-progress-index="${index}" aria-label="Go to step ${index + 1}: ${escapeHtml(step.title)}"><span>${index + 1}</span><small>${escapeHtml(shortStepTitle(step, index))}</small></button>`).join("");
  assemblyProgress.querySelectorAll("[data-progress-index]").forEach((button) => button.addEventListener("click", () => selectStep(Number(button.dataset.progressIndex))));
  buildMiniature.innerHTML = buildMiniatureMarkup(activeAssembly);
  selectStep(activeBuildSteps.length ? Math.min(embeddedRequestedStep, activeBuildSteps.length - 1) : -1);
}

function normalizedGuideSteps(assembly) {
  if (Array.isArray(assembly.guideSteps) && assembly.guideSteps.length) return assembly.guideSteps;
  const allParts = (assembly.parts || []).map((part) => part.id);
  const partById = new Map((assembly.parts || []).map((part) => [part.id, part]));
  const groupedWires = new Map();
  for (const wire of assembly.wires || []) {
    const endpoints = [partById.get(wire.from?.partId), partById.get(wire.to?.partId)].filter(Boolean);
    const peripheral = endpoints.find((part) => !["carrier", "controller", "power", "power_distribution"].includes(part.role)) || endpoints.at(-1);
    const key = peripheral?.id || wire.to?.partId || wire.from?.partId || "connections";
    const group = groupedWires.get(key) || { part: peripheral, wires: [] };
    group.wires.push(wire);
    groupedWires.set(key, group);
  }
  const result = [{
    id: "guide-arrange-parts",
    kind: "placement",
    title: "Place the parts",
    beginnerInstruction: "Set every part text-side up in the positions shown. Keep USB power disconnected.",
    safetyNote: "Leave USB power disconnected until the final check.",
    visibleParts: allParts,
    activeWires: [],
    cameraView: "isometric",
  }];
  const mountedControllers = (assembly.parts || []).filter((part) => part.role === "controller" && part.mountedToPartId);
  for (const controller of mountedControllers) {
    result.push({
      id: `guide-seat-${controller.id}`,
      kind: "mount",
      title: `Seat ${shortPartName(controller.label)}`,
      beginnerInstruction: "Match the polarity and USB orientation shown, then press both header rows straight into the expansion board.",
      safetyNote: "Check both header rows before pressing. Never force a reversed board.",
      visibleParts: [controller.id, controller.mountedToPartId],
      activeWires: [],
      cameraView: "pin-close-up",
    });
  }
  for (const [groupId, group] of groupedWires) {
    const label = shortPartName(group.part?.label || "the labeled pins");
    result.push({
      id: `guide-connect-${groupId}`,
      kind: "connection",
      title: `Connect ${label}`,
      beginnerInstruction: `Follow only the highlighted lines from ${label} to the exact labeled expansion-board contacts.`,
      safetyNote: "Power off before connecting. Red is positive power, black is ground, and every other color is a signal.",
      visibleParts: allParts,
      activeWires: group.wires.map((wire) => wire.id),
      cameraView: "pin-close-up",
    });
  }
  const wirelessLinks = Array.isArray(assembly.wirelessLinks) ? assembly.wirelessLinks : [];
  if (wirelessLinks.length) {
    result.push({
      id: "guide-pair-wireless-nodes",
      kind: "wireless",
      title: wirelessLinks.length === 1 ? "Pair the two devices" : "Pair the wireless devices",
      beginnerInstruction: "Power each device separately and complete the pairing check. ESP-NOW carries updates over radio, so do not connect a wire between the devices.",
      safetyNote: "A dashed cyan arc represents radio, not a physical cable.",
      visibleParts: allParts,
      activeWires: [],
      wirelessLinkIds: wirelessLinks.map((link) => link.id),
      cameraView: "isometric",
    });
  }
  result.push({
    id: "guide-final-check",
    kind: "verification",
    title: (assembly.wires || []).length ? "Check every connection" : wirelessLinks.length ? "Test the wireless update" : "Check the controller",
    beginnerInstruction: (assembly.wires || []).length
      ? "Trace every colored line end to end and confirm each label before attaching USB power."
      : wirelessLinks.length
        ? "Change the value on one device and confirm that the other device updates, then repeat in the opposite direction."
        : "Confirm the controller is upright and its built-in screen or controls respond after power is connected.",
    safetyNote: (assembly.wires || []).length
      ? "Connect USB power only after every power, ground, signal, and controller-orientation check matches."
      : "Use a separate USB power connection for each device; the radio link does not carry power.",
    visibleParts: allParts,
    activeWires: (assembly.wires || []).map((wire) => wire.id),
    ...(wirelessLinks.length ? { wirelessLinkIds: wirelessLinks.map((link) => link.id) } : {}),
    cameraView: "isometric",
  });
  return result;
}

function shortPartName(value) {
  const normalized = String(value || "part").replace(/\s+/g, " ").trim();
  const lower = normalized.toLowerCase();
  const purposeNames = [
    [/soil.{0,12}moisture|moisture.{0,12}soil/, "the soil moisture sensor"],
    [/\bco2\b|carbon dioxide|scd[- ]?4[01]/, "the CO2 sensor"],
    [/light intensity|ambient light|\blux\b|bh1750|tsl2591/, "the light sensor"],
    [/temperature.{0,18}humidity|humidity.{0,18}temperature|sht3[01]|dht(?:11|22)/, "the temperature and humidity sensor"],
    [/barometric|pressure|bme280|bmp280/, "the pressure sensor"],
    [/presence|\bpir\b|motion sensor|radar/, "the presence sensor"],
    [/rotary|encoder|\bknob\b/, "the rotary knob"],
    [/display|screen|lcd|oled|amoled/, "the screen"],
    [/servo|motor/, "the motor"],
    [/buzzer|sounder|speaker/, "the sound module"],
    [/camera/, "the camera"],
    [/gps|gnss|l76k/, "the location sensor"],
  ];
  const purpose = purposeNames.find(([pattern]) => pattern.test(lower));
  if (purpose) return purpose[1];
  return normalized.length <= 38 ? normalized : `${normalized.slice(0, 35).trimEnd()}…`;
}

function shortStepTitle(step, index) {
  if (index === 0) return "Start";
  if (index === activeBuildSteps.length - 1) return "All set";
  return String(step.title || `Step ${index + 1}`).replace(/^Connect\s+/i, "").slice(0, 24);
}

function buildMiniatureMarkup(assembly) {
  const circuitParts = assembly.parts || [];
  const controllers = circuitParts.filter((part) => ["controller", "carrier"].includes(part.role));
  const peripherals = circuitParts.filter((part) => !["controller", "carrier"].includes(part.role));
  const partPosition = new Map();
  controllers.forEach((part, index) => partPosition.set(part.id, { x: 118, y: 46 + index * 42 }));
  peripherals.forEach((part, index) => partPosition.set(part.id, { x: 30 + (index % 3) * 88, y: 148 + Math.floor(index / 3) * 54 }));
  const wires = (assembly.wires || []).map((wire) => {
    const from = partPosition.get(wire.from?.partId) || { x: 118, y: 88 };
    const to = partPosition.get(wire.to?.partId) || { x: 206, y: 148 };
    return `<path d="M${from.x} ${from.y} Q${(from.x + to.x) / 2} ${Math.min(from.y, to.y) - 18} ${to.x} ${to.y}" stroke="${escapeHtml(displayWireColor(wire))}"/>`;
  }).join("");
  const blocks = circuitParts.map((part) => {
    const position = partPosition.get(part.id) || { x: 118, y: 100 };
    const width = ["controller", "carrier"].includes(part.role) ? 82 : 55;
    const height = ["controller", "carrier"].includes(part.role) ? 26 : 34;
    return `<g transform="translate(${position.x - width / 2} ${position.y - height / 2})"><rect width="${width}" height="${height}" rx="6"/><text x="${width / 2}" y="${height / 2 + 3}">${escapeHtml(friendlyRole(part.role))}</text></g>`;
  }).join("");
  return `<svg viewBox="0 0 260 220" role="img" aria-label="Complete circuit overview"><g class="mini-wires">${wires}</g><g class="mini-parts">${blocks}</g></svg>`;
}

function friendlyRole(role) {
  return ({ carrier: "Expansion board", controller: "Main controller", display: "Screen", sensor: "Sensor", input: "Control", output: "Output", actuator: "Moving part" })[role] || role || "Circuit part";
}

function partPurpose(part) {
  return ({
    carrier: "Gives every module its own labeled power, ground, and signal connection.",
    controller: "Runs the project and reads or controls every connected module.",
    display: "Shows readings, alerts, or controls to the person using the project.",
    sensor: "Measures something in the environment and sends that reading to the controller.",
    input: "Lets a person control the project.",
    output: "Creates the visible or audible result.",
    actuator: "Turns an electrical command into physical movement.",
  })[part.role] || "A verified physical part selected for this exact build.";
}

function friendlyEndpoint(endpoint, partLabelById) {
  const label = String(endpoint?.label || "");
  const terminal = label.includes(" · ") ? label.split(" · ").at(-1) : label;
  const partName = endpoint?.partId === "carrier"
    ? "Expansion board"
    : partLabelById.get(endpoint?.partId) || endpoint?.partId || "Part";
  return `${partName} — ${terminal}`;
}

function connectionKind(wire) {
  const signal = String(wire.signal || wire.label || "").toUpperCase();
  if (/GND|GROUND/.test(signal)) return "GROUND";
  if (/VCC|3V3|5V|VIN|POWER|PLUS/.test(signal)) return "POWER";
  return "SIGNAL";
}

function connectionHeading(wire) {
  const kind = connectionKind(wire);
  const color = kind === "GROUND" ? "Black" : kind === "POWER" ? "Red" : friendlyColorName(wire.color);
  return `${color} ${kind.toLowerCase()} line · ${wire.signal || wire.label}`;
}

function friendlyColorName(value) {
  const color = String(value || "signal").toLowerCase();
  if (color.startsWith("#")) {
    return ({
      "#f2cc3d": "Yellow", "#3f8cff": "Blue", "#35c77a": "Green", "#a66cff": "Purple",
      "#ff9f43": "Orange", "#25c4c9": "Cyan", "#e879f9": "Pink", "#84cc16": "Lime",
      "#f59e0b": "Amber", "#6366f1": "Indigo", "#14b8a6": "Teal", "#ec4899": "Magenta",
      "#24b36b": "Green", "#f2b134": "Yellow", "#8d57d9": "Purple", "#ef7f31": "Orange",
    })[color] || "Signal";
  }
  return color.charAt(0).toUpperCase() + color.slice(1);
}

function renderBuildIdentity(build) {
  resultEyebrow.textContent = "One-shot build · machine verified";
  resultTitle.textContent = build.title || "Verified circuit assembly";
  resultSummary.textContent = build.summary || build.behavior || "Exact AWS parts, deterministic wiring, and a generated assembly guide.";
  if (guideMode) { surfaceName.textContent = build.title || "Circuit Studio"; surfaceName.title = surfaceName.textContent; }
}

function selectStep(index) {
  if (!activeBuildSteps.length || index < 0) {
    activeStepIndex = -1;
    activeStepNumber.textContent = "0";
    stepProgress.style.width = "0";
    stepBack.disabled = true;
    stepNext.disabled = true;
    stepConnections.innerHTML = "";
    stepSafety.hidden = true;
    return;
  }
  activeStepIndex = Math.max(0, Math.min(index, activeBuildSteps.length - 1));
  const step = activeBuildSteps[activeStepIndex];
  const copy = wiringCopy(step, activeAssembly);
  document.querySelector("#mobile-step-title").textContent = `${activeStepIndex + 1} / ${activeBuildSteps.length} · ${copy.title}`;
  document.querySelector("#mobile-step-safety").textContent = copy.safety;
  activeStepNumber.textContent = String(activeStepIndex + 1);
  activeStep.innerHTML = `<span class="step-kicker">Step ${activeStepIndex + 1} of ${activeBuildSteps.length}</span><h3>${escapeHtml(copy.title)}</h3><p>${escapeHtml(copy.instruction)}</p><details class="original-step"><summary>Part details</summary><p>${escapeHtml(step.title)}</p><p>${escapeHtml(step.beginnerInstruction)}</p></details>`;
  assemblyProgress.innerHTML = compactStepNumbers(activeBuildSteps.length, activeStepIndex).map(entry => entry === "gap" ? '<span aria-hidden="true">…</span>' : `<button type="button" data-progress-index="${entry}" aria-label="Step ${entry + 1}: ${escapeHtml(wiringCopy(activeBuildSteps[entry], activeAssembly).title)}" aria-current="${entry === activeStepIndex ? "step" : "false"}">${entry + 1}</button>`).join("");
  assemblyProgress.querySelectorAll("button").forEach(button => button.addEventListener("click", () => selectStep(Number(button.dataset.progressIndex))));
  stepProgress.style.width = `${((activeStepIndex + 1) / activeBuildSteps.length) * 100}%`;
  stepBack.disabled = activeStepIndex === 0;
  stepNext.disabled = activeStepIndex === activeBuildSteps.length - 1;
  renderActiveConnections(step);
  applyAssemblyStepFocus(step);
  if (assemblyGroup.children.length && step.cameraView === "pin-close-up" && (step.activeWires?.length || step.kind === "mount")) {
    setView("pin", document.querySelector('[data-view="pin"]'));
  } else if (renderedWireMeshes.size) {
    setView("iso", document.querySelector('[data-view="iso"]'));
  }
  steps.querySelectorAll("[data-step-index]").forEach((button) => button.classList.toggle("active", Number(button.dataset.stepIndex) === activeStepIndex));
  steps.querySelector(`[data-step-index="${activeStepIndex}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  assemblyProgress.querySelectorAll("[data-progress-index]").forEach((button) => {
    const progressIndex = Number(button.dataset.progressIndex);
    button.classList.toggle("active", progressIndex === activeStepIndex);
    button.classList.toggle("complete", progressIndex < activeStepIndex);
    button.setAttribute("aria-current", progressIndex === activeStepIndex ? "step" : "false");
  });
}

function renderActiveConnections(step) {
  if (!activeAssembly) return;
  const activeIds = new Set(step.activeWires || []);
  const activeWires = (activeAssembly.wires || []).filter((wire) => activeIds.has(wire.id));
  const partLabelById = new Map((activeAssembly.parts || []).map((part) => [part.id, part.label]));
  stepConnections.innerHTML = activeWires.map((wire) => {
    const color = displayWireColor(wire);
    const colorName = connectionKind(wire) === "GROUND"
      ? "Black"
      : connectionKind(wire) === "POWER"
        ? "Red"
        : friendlyColorName(color);
    const from = wiringEndpointLabel(wire.from, activeAssembly);
    const to = wiringEndpointLabel(wire.to, activeAssembly);
    return `<article class="step-connection" style="--wire-color:${escapeHtml(color)}"><i></i><span><strong>${escapeHtml(colorName)}: ${escapeHtml(wire.signal || wire.label)}</strong><small>${escapeHtml(from)} → ${escapeHtml(to)}</small></span></article>`;
  }).join("");
  stepConnections.hidden = activeWires.length === 0;
  stepSafety.textContent = step.safetyNote || "Keep USB power disconnected while making connections.";
  stepSafety.hidden = !step.safetyNote && step.kind === "placement";
}

function displayWireColor(wire) {
  const kind = connectionKind(wire);
  if (kind === "GROUND") return "#111820";
  if (kind === "POWER") return "#d6293a";
  const color = String(wire?.color || "#c78b00").toLowerCase();
  return ({ black: "#111820", red: "#d6293a", yellow: "#c78b00", green: "#178a52", blue: "#1769aa" })[color] || color;
}

function applyAssemblyStepFocus(step) {
  const activeIds = new Set(step.activeWires || []);
  const activeIndexByWire = new Map();
  activeBuildSteps.forEach((candidate, index) => {
    for (const wireId of candidate.activeWires || []) {
      if (!activeIndexByWire.has(wireId)) activeIndexByWire.set(wireId, index);
    }
  });
  for (const [wireId, mesh] of renderedWireMeshes) {
    const wireStep = activeIndexByWire.get(wireId);
    const isActive = activeIds.has(wireId);
    const isComplete = Number.isInteger(wireStep) && wireStep < activeStepIndex;
    const originalColor = mesh.userData.displayColor;
    mesh.material.color.set(isActive || isComplete ? originalColor : 0xaeb4b8);
    mesh.material.opacity = isActive ? 1 : isComplete ? .34 : .18;
    mesh.material.transparent = !isActive;
    mesh.material.depthWrite = isActive;
    mesh.renderOrder = isActive ? 5 : isComplete ? 3 : 1;
  }
}

async function renderAssembly(assembly) {
  if (!renderer || !controls) {
    renderAssemblyDiagram(assembly);
    return;
  }
  const generation = ++renderGeneration;
  scene.remove(assemblyGroup);
  assemblyGroup.traverse((object) => { object.geometry?.dispose?.(); if (object.material?.dispose) object.material.dispose(); });
  const nextGroup = new THREE.Group();
  assemblyGroup = nextGroup;
  scene.add(nextGroup);
  const tasks = assembly.parts.map(async (part) => {
    const gltf = await loader.loadAsync(part.assetUrl);
    const model = gltf.scene;
    if (generation !== renderGeneration) {
      model.traverse((object) => { object.geometry?.dispose?.(); if (object.material?.dispose) object.material.dispose(); });
      return;
    }
    const root = new THREE.Group();
    root.userData.partId = part.id;
    model.traverse((object) => { if (object.isMesh) { object.castShadow = true; object.receiveShadow = true; } });
    const hiddenNodeTokens = new Set([
      ...LOGICAL_GUIDE_HIDDEN_NODE_TOKENS,
      ...(part.hiddenNodeIncludes || []),
    ]);
    for (const token of hiddenNodeTokens) {
      model.traverse((object) => { if (object.name.includes(token)) object.visible = false; });
    }
    for (const rule of part.nodeTransformRules || []) {
      model.traverse((object) => {
        if (!object.name.startsWith(rule.namePrefix)) return;
        if (Array.isArray(rule.matrix) && rule.matrix.length === 16) {
          object.applyMatrix4(new THREE.Matrix4().fromArray(rule.matrix));
        }
        if (rule.position) object.position.set(...rule.position);
        if (rule.rotation) object.rotation.set(...rule.rotation);
        if (rule.scale) object.scale.set(...rule.scale);
      });
    }
    const [x, y, z] = part.assembledPosition;
    root.position.set(x, z, -y);
    root.rotation.set(-Math.PI / 2, 0, 0);
    model.rotation.set(...part.rotation);
    model.scale.set(...part.scale);
    root.add(model);
    nextGroup.add(root);
  });
  await Promise.all(tasks);
  if (generation !== renderGeneration) return;
  for (const wire of assembly.wires) {
    const points = wire.points.map(([x, y, z]) => new THREE.Vector3(x, z, -y));
    const curve = new AcceptedPolylineCurve3(points);
    // Keep guides visually legible without changing their deterministic
    // centerlines, endpoint placement, or collision-tested routing.
    const radius = .000425;
    const geometry = new THREE.TubeGeometry(curve, Math.max(48, points.length * 5), radius, 8, false);
    const displayColor = displayWireColor(wire);
    const material = new THREE.MeshBasicMaterial({
      color: displayColor,
      toneMapped: false,
      transparent: true,
      opacity: .18,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = false;
    mesh.userData.wireId = wire.id;
    mesh.userData.displayColor = displayColor;
    renderedWireMeshes.set(wire.id, mesh);
    nextGroup.add(mesh);
  }
  for (const link of assembly.wirelessLinks || []) {
    const controlPoints = (link.points || []).map(([x, y, z]) => new THREE.Vector3(x, z, -y));
    if (controlPoints.length !== 3) continue;
    const curve = new THREE.QuadraticBezierCurve3(controlPoints[0], controlPoints[1], controlPoints[2]);
    const geometry = new THREE.BufferGeometry().setFromPoints(curve.getPoints(64));
    const material = new THREE.LineDashedMaterial({
      color: 0x16b8d4,
      dashSize: 0.006,
      gapSize: 0.004,
      transparent: true,
      opacity: 0.9,
      toneMapped: false,
    });
    const radioArc = new THREE.Line(geometry, material);
    radioArc.computeLineDistances();
    radioArc.userData.connectionMode = "wireless-protocol-link";
    nextGroup.add(radioArc);
    nextGroup.add(wirelessLabelSprite(controlPoints[1], link.protocol || "ESP-NOW"));
  }
  fitAssembly();
  if (activeStepIndex >= 0) applyAssemblyStepFocus(activeBuildSteps[activeStepIndex]);
}

function renderAssemblyDiagram(assembly) {
  const host = document.querySelector("#canvas");
  host.querySelector(".circuit-diagram")?.remove();
  const circuitParts = assembly.parts || [];
  const left = circuitParts.filter((part) => ["controller", "carrier"].includes(part.role));
  const right = circuitParts.filter((part) => !["controller", "carrier"].includes(part.role));
  const positions = new Map();
  left.forEach((part, index) => positions.set(part.id, { x: 220, y: 190 + index * 155 }));
  right.forEach((part, index) => positions.set(part.id, { x: 790, y: 120 + index * Math.max(120, 470 / Math.max(1, right.length)) }));
  const wireMarkup = (assembly.wires || []).map((wire, index) => {
    const from = positions.get(wire.from?.partId) || positions.get("carrier") || { x: 340, y: 280 };
    const to = positions.get(wire.to?.partId) || { x: 690, y: 180 + index * 25 };
    const lane = 460 + (index % 7) * 14;
    return `<path d="M ${from.x + 135} ${from.y} C ${lane} ${from.y}, ${lane} ${to.y}, ${to.x - 135} ${to.y}" stroke="${escapeHtml(wire.color || "#f3c64f")}"/><text x="${lane + 6}" y="${(from.y + to.y) / 2 - 5}">${escapeHtml(wire.signal || wire.label)}</text>`;
  }).join("");
  const wirelessMarkup = (assembly.wirelessLinks || []).map((link) => {
    const fromPartId = link.fromPartId;
    const toPartId = link.toPartId;
    const from = positions.get(fromPartId) || { x: 220, y: 120 };
    const to = positions.get(toPartId) || { x: 790, y: 120 };
    const middleX = (from.x + to.x) / 2;
    const middleY = Math.min(from.y, to.y) - 80;
    return `<path class="wireless" d="M ${from.x} ${from.y - 45} Q ${middleX} ${middleY}, ${to.x} ${to.y - 45}"/><text class="wireless-label" x="${middleX}" y="${middleY - 8}">ESP-NOW · WIRELESS</text>`;
  }).join("");
  const partMarkup = [...left, ...right].map((part) => {
    const point = positions.get(part.id);
    return `<g transform="translate(${point.x - 135} ${point.y - 42})"><rect width="270" height="84" rx="15"/><text class="part-name" x="18" y="34">${escapeHtml(part.label)}</text><text class="part-id" x="18" y="58">${escapeHtml(part.assetId)}</text></g>`;
  }).join("");
  host.insertAdjacentHTML("afterbegin", `<svg class="circuit-diagram" viewBox="0 0 1040 650" role="img" aria-label="Carrier-based circuit wiring diagram"><g class="diagram-wires">${wireMarkup}${wirelessMarkup}</g><g class="diagram-parts">${partMarkup}</g></svg>`);
}

function renderMachineGates(build) {
  const artifacts = build.artifacts || {};
  const assembly = artifacts.assembly || {};
  const delivery = artifacts.delivery || {};
  const timeline = artifacts.pipeline?.timeline || [];
  const wires = Array.isArray(assembly.wires) ? assembly.wires : [];
  const requiredAssets = Array.isArray(assembly.requiredAssets) ? assembly.requiredAssets : [];
  const modelFetches = Array.isArray(delivery.modelFetches) ? delivery.modelFetches : [];
  const networkNodes = Array.isArray(assembly.networkNodes) ? assembly.networkNodes : [];
  const wirelessLinks = Array.isArray(assembly.wirelessLinks) ? assembly.wirelessLinks : [];
  const networkContractValid = networkNodes.length <= 1
    ? wirelessLinks.length === 0
    : wirelessLinks.length === networkNodes.length - 1
      && wirelessLinks.every((link) => link.physicalConductor === false
        && !wires.some((wire) => wire.id === link.id));
  const evidence = {
    identity: timeline.some((entry) => entry.name === "prompt_package_locked")
      || (build.identity?.buildId === build.id
        && build.manifest?.identity?.buildId === build.id
        && build.identity?.requestFingerprint === build.manifest?.identity?.requestFingerprint),
    semantic: build.semanticFulfillment?.ok === true
      && build.semanticFulfillment?.coveragePercent === 100,
    catalog: assembly.readiness?.assetEligibility?.state === "ready",
    hash: requiredAssets.length > 0 && modelFetches.length === requiredAssets.length
      && modelFetches.every((entry) => /^[a-f0-9]{64}$/.test(entry.sha256 || "")),
    endpoint: assembly.readiness?.namedNodesResolved === true
      && wires.every((wire) => wire.from?.nodeName && wire.to?.nodeName),
    connector: assembly.readiness?.electricalGraphValidated === true
      && assembly.readiness?.controllerNodesResolved !== false
      && assembly.readiness?.espNowTopologyValidated !== false
      && networkContractValid,
    collision: assembly.state === "ready" && /collision-cleared/.test(artifacts.wiring?.standard || "")
      && wires.every((wire) => Array.isArray(wire.points) && wire.points.length >= 2),
    loop: assembly.state === "ready" && /collision-cleared/.test(artifacts.wiring?.standard || "")
      && !wires.some((wire) => projectedRouteSelfIntersects(wire.points))
      && !projectedRoutesCross(wires)
      && !routesPhysicallyIntersect(wires)
      && wires.every((wire) => (
        Array.isArray(wire.points)
        && wire.points.length >= 2
        && wire.loopCount === 0
        && wire.selfIntersectionCount === 0
        && Number(wire.projectedSelfIntersectionCount || 0) === 0
        && Number(wire.projectedCrossingCount || 0) === 0
        && Math.hypot(...wire.points[0].map((value, axis) => value - wire.points.at(-1)[axis])) > 0.001
      )),
  };
  let passed = 0;
  document.querySelectorAll(".gates li").forEach((item) => {
    const ok = evidence[item.dataset.gate] === true;
    item.className = ok ? "pass" : "fail";
    item.querySelector("b").textContent = ok ? "PASS" : "FAIL";
    if (ok) passed += 1;
  });
  document.querySelector("#gate-count").textContent = `${passed} / 8`;
  if (passed !== 8) throw new Error(`Machine evidence incomplete: ${passed} of 8 gates passed.`);
}

function projectedRouteSelfIntersects(points) {
  if (!Array.isArray(points) || points.length < 4) return false;
  for (let left = 1; left < points.length; left += 1) {
    for (let right = left + 2; right < points.length; right += 1) {
      if (segmentsCrossInTopView(
        points[left - 1], points[left],
        points[right - 1], points[right]
      )) return true;
    }
  }
  return false;
}

function projectedRoutesCross(wires) {
  for (let leftWire = 0; leftWire < wires.length; leftWire += 1) {
    const leftPoints = wires[leftWire]?.points || [];
    for (let rightWire = leftWire + 1; rightWire < wires.length; rightWire += 1) {
      if (wires[leftWire]?.planarCrossingForbidden !== true
        && wires[rightWire]?.planarCrossingForbidden !== true) continue;
      const rightPoints = wires[rightWire]?.points || [];
      for (let left = 1; left < leftPoints.length; left += 1) {
        for (let right = 1; right < rightPoints.length; right += 1) {
          if (segmentsCrossInTopView(
            leftPoints[left - 1], leftPoints[left],
            rightPoints[right - 1], rightPoints[right]
          )) return true;
        }
      }
    }
  }
  return false;
}

function routesPhysicallyIntersect(wires, tolerance = 1e-7) {
  for (let leftWire = 0; leftWire < wires.length; leftWire += 1) {
    const leftPoints = wires[leftWire]?.points || [];
    for (let rightWire = leftWire + 1; rightWire < wires.length; rightWire += 1) {
      const rightPoints = wires[rightWire]?.points || [];
      const sharedTerminals = sharedPhysicalTerminals(wires[leftWire], wires[rightWire]);
      for (let left = 1; left < leftPoints.length; left += 1) {
        for (let right = 1; right < rightPoints.length; right += 1) {
          if (sharedTerminals.some((terminal) => (
            terminalSegmentMatches(wires[leftWire], left, terminal.leftSide)
            && terminalSegmentMatches(wires[rightWire], right, terminal.rightSide)
          ))) continue;
          if (segmentDistance3d(
            leftPoints[left - 1], leftPoints[left],
            rightPoints[right - 1], rightPoints[right]
          ) < tolerance) return true;
        }
      }
    }
  }
  return false;
}

function sharedPhysicalTerminals(leftWire, rightWire) {
  const authorizationId = leftWire?.terminalOccupancyAuthorizationId;
  if (!authorizationId || authorizationId !== rightWire?.terminalOccupancyAuthorizationId) return [];
  const terminals = [];
  for (const leftSide of ["from", "to"]) {
    const left = leftWire?.[leftSide];
    if (!left?.partId || !left?.nodeName) continue;
    for (const rightSide of ["from", "to"]) {
      const right = rightWire?.[rightSide];
      if (left.partId === right?.partId && left.nodeName === right?.nodeName) {
        terminals.push({ leftSide, rightSide });
      }
    }
  }
  return terminals;
}

function terminalSegmentMatches(wire, segmentIndex, side) {
  const points = wire?.points || [];
  // Filleting can split the short shared terminal lead into two sampled
  // segments before logical guides branch into their independent lanes.
  const terminalJoinWindowSegments = 2;
  return side === "from"
    ? segmentIndex <= terminalJoinWindowSegments
    : segmentIndex >= points.length - terminalJoinWindowSegments;
}

function segmentDistance3d(a0, a1, b0, b1) {
  const subtract = (left, right) => left.map((value, axis) => value - right[axis]);
  const dot = (left, right) => left.reduce((sum, value, axis) => sum + value * right[axis], 0);
  const clamp = (value) => Math.max(0, Math.min(1, value));
  const u = subtract(a1, a0), v = subtract(b1, b0), w = subtract(a0, b0);
  const aa = dot(u, u), bb = dot(u, v), cc = dot(v, v), dd = dot(u, w), ee = dot(v, w);
  const denominator = aa * cc - bb * bb;
  let s = denominator < 1e-15 ? 0 : clamp((bb * ee - cc * dd) / denominator);
  let t = cc < 1e-15 ? 0 : clamp((bb * s + ee) / cc);
  if (t === 0 || t === 1) s = aa < 1e-15 ? 0 : clamp((bb * t - dd) / aa);
  const left = a0.map((value, axis) => value + u[axis] * s);
  const right = b0.map((value, axis) => value + v[axis] * t);
  return Math.hypot(...subtract(left, right));
}

function segmentsCrossInTopView(a, b, c, d, tolerance = 1e-9) {
  if (![a, b, c, d].every((point) => Array.isArray(point) && point.length >= 2)) return false;
  const rx = b[0] - a[0], ry = b[1] - a[1];
  const sx = d[0] - c[0], sy = d[1] - c[1];
  const cross = (ux, uy, vx, vy) => ux * vy - uy * vx;
  const denominator = cross(rx, ry, sx, sy);
  const qx = c[0] - a[0], qy = c[1] - a[1];
  if (Math.abs(denominator) <= tolerance) {
    if (Math.abs(cross(qx, qy, rx, ry)) > tolerance) return false;
    const axis = Math.abs(rx) >= Math.abs(ry) ? 0 : 1;
    const overlap = Math.min(Math.max(a[axis], b[axis]), Math.max(c[axis], d[axis]))
      - Math.max(Math.min(a[axis], b[axis]), Math.min(c[axis], d[axis]));
    return overlap > tolerance;
  }
  const t = cross(qx, qy, sx, sy) / denominator;
  const u = cross(qx, qy, rx, ry) / denominator;
  // Shared physical endpoints are legal engagement points, not crossings.
  return t > tolerance && t < 1 - tolerance && u > tolerance && u < 1 - tolerance;
}

function setView(name, button) {
  document.querySelectorAll("[data-view]").forEach((item) => { item.classList.toggle("active", item === button); item.setAttribute("aria-pressed", String(item === button)); });
  if (!controls) return;
  if (name === "fit") return fitAssembly();
  if (name === "pin") return focusActiveConnections();
  const preset = viewPresets[name];
  if (!preset) return;
  const box = new THREE.Box3().setFromObject(assemblyGroup);
  if (box.isEmpty()) return;
  frameBounds(box, new THREE.Vector3(...preset.direction));
}

function focusActiveConnections() {
  if (!controls) return;
  const step = activeBuildSteps[activeStepIndex];
  const activeIds = new Set(step?.activeWires || []);
  const box = new THREE.Box3();
  let included = false;
  for (const [wireId, mesh] of renderedWireMeshes) {
    if (!activeIds.has(wireId)) continue;
    box.expandByObject(mesh);
    included = true;
  }
  if (step?.kind === "mount") {
    const visible = new Set(step.visibleParts || []);
    for (const child of assemblyGroup.children) if (visible.has(child.userData.partId)) { box.expandByObject(child); included = true; }
  }
  if (!included || box.isEmpty()) return fitAssembly();
  // Include the connected modules, not just their wire endpoints.
  const partIds = new Set((activeAssembly?.wires || []).filter(wire => activeIds.has(wire.id)).flatMap(wire => [wire.from?.partId, wire.to?.partId]));
  for (const child of assemblyGroup.children) if (partIds.has(child.userData.partId)) box.expandByObject(child);
  frameBounds(box, new THREE.Vector3(.72, .95, 1.15));
}

function fitAssembly() {
  if (!controls) return;
  const box = new THREE.Box3().setFromObject(assemblyGroup);
  if (box.isEmpty()) return;
  frameBounds(box, new THREE.Vector3(1.02, .76, 1.12));
}

// Fit projected bounds to the actual viewport. Camera-only presentation change:
// every GLB transform, pin endpoint and accepted wire sample remains untouched.
function frameBounds(box, direction) {
  const center = box.getCenter(new THREE.Vector3());
  direction.normalize();
  const right = new THREE.Vector3().crossVectors(camera.up, direction).normalize();
  const up = new THREE.Vector3().crossVectors(direction, right).normalize();
  const tangent = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  let distance = .07;
  for (const x of [box.min.x,box.max.x]) for (const y of [box.min.y,box.max.y]) for (const z of [box.min.z,box.max.z]) {
    const corner = new THREE.Vector3(x,y,z).sub(center);
    const depth = corner.dot(direction);
    distance = Math.max(distance, depth + Math.abs(corner.dot(up)) * 1.16 / tangent, depth + Math.abs(corner.dot(right)) * 1.16 / (tangent * Math.max(camera.aspect, .1)));
  }
  controls.target.copy(center);
  camera.position.copy(center).addScaledVector(direction, distance);
  camera.near = .00035;
  camera.far = Math.max(5, distance * 20);
  camera.updateProjectionMatrix();
  controls.update();
}

function setInteractionMode(mode) {
  if (!controls || !renderer) return;
  const modes = { rotate: THREE.MOUSE.ROTATE, pan: THREE.MOUSE.PAN, zoom: THREE.MOUSE.DOLLY };
  if (!(mode in modes)) return;
  controls.mouseButtons.LEFT = modes[mode];
  controls.mouseButtons.RIGHT = THREE.MOUSE.PAN;
  controls.touches.ONE = mode === "pan" ? THREE.TOUCH.PAN : THREE.TOUCH.ROTATE;
  controls.touches.TWO = THREE.TOUCH.DOLLY_PAN;
  renderer.domElement.style.cursor = mode === "zoom" ? "ns-resize" : "grab";
  document.querySelectorAll("[data-interaction]").forEach(button => button.setAttribute("aria-pressed", String(button.dataset.interaction === mode)));
  document.querySelector("#interaction-hint").textContent = mode === "pan" ? "Drag to move the view · scroll or pinch to zoom" : mode === "zoom" ? "Drag up or down to zoom · pinch on touchscreens" : "Drag to rotate · scroll or pinch to zoom";
}
document.querySelectorAll("[data-interaction]").forEach(button => button.addEventListener("click", () => setInteractionMode(button.dataset.interaction)));
setInteractionMode("rotate");

function resize() {
  if (!renderer) return;
  const host = document.querySelector("#canvas");
  const width = host.clientWidth;
  const height = host.clientHeight;
  // A mobile instructions pane hides the canvas; do not fit to a zero viewport.
  if (width < 1 || height < 1) return;
  renderer.setSize(width, height, false);
  camera.aspect = width / Math.max(1, height);
  camera.updateProjectionMatrix();
  if (activeAssembly && assemblyGroup.children.length) {
    const selected = document.querySelector('[data-view].active');
    setView(selected?.dataset.view || "iso", selected);
  }
}
new ResizeObserver(resize).observe(document.querySelector("#canvas"));
if (renderer && controls) renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene, camera); });
resize();
trace.innerHTML = workflowSkeleton();
charCount.textContent = `${idea.value.length} / 2000`;
loadRuntimeStatus();
loadInitialBuild().then((loadedMatchingBuild) => {
  if (!loadedMatchingBuild && !sourceBuildId && requestedIdea && pageParams.get("autorun") === "1") {
    form.requestSubmit();
  }
});

async function loadRuntimeStatus() {
  try {
    const healthResponse = await fetch("/api/health");
    const health = await healthResponse.json();
    credentialBridge.lastChild.textContent = health.credentialBridge === "netlify-context"
      ? "Netlify credential bridge"
      : health.buildPipeline ? "Verified build API" : "Server credential bridge";
    catalogCoverage.lastChild.textContent = health.prompt2circuit
      ? `${health.prompt2circuit.supportedPartsCatalogCount} one-shot parts`
      : health.catalogRevision || "Verified AWS catalog";
  } catch {
    credentialBridge.lastChild.textContent = "API bridge offline";
    catalogCoverage.lastChild.textContent = "AWS catalog unavailable";
  }
}

async function loadInitialBuild() {
  try {
    if (sourceBuildId) {
      emptyState.hidden = true;
      loading.hidden = false;
      loading.querySelector("strong").textContent = "Loading your 3D assembly";
      loadingDetail.textContent = "Opening the saved parts and connections…";
      if (!renderer || !controls) throw new Error("This browser could not start the 3D viewer");
    }
    const requestedBuildId = sourceBuildId || pageParams.get("buildId")?.trim();
    const endpoint = sourceBuildId
      ? `/api/account/builds/${encodeURIComponent(sourceBuildId)}`
      : requestedBuildId
      ? `/api/production-simulations/${encodeURIComponent(requestedBuildId)}`
      : "/api/production-simulations/latest";
    let response = await fetch(endpoint, {
      cache: "no-store",
      credentials: sourceBuildId ? "include" : "same-origin",
      headers: { Accept: "application/json" },
    });
    if (sourceBuildId && [401, 403, 404].includes(response.status)) {
      response = await fetch(`/api/builds/${encodeURIComponent(sourceBuildId)}`, {
        cache: "no-store",
        credentials: "same-origin",
        headers: { Accept: "application/json" },
      });
    }
    if (response.status === 404 && !sourceBuildId) return false;
    const body = await response.json();
    if (!response.ok || !body?.build) {
      if (sourceBuildId) throw new Error("The saved assembly is currently unavailable");
      return false;
    }
    const build = body.build;
    if (sourceBuildId) assertExactStoredBuild(build, sourceBuildId);
    if (requestedIdea && String(build.idea || "").trim() !== requestedIdea) return false;
    emptyState.hidden = true;
    if (typeof build.idea === "string" && build.idea) {
      idea.value = build.idea;
      charCount.textContent = `${idea.value.length} / 2000`;
    }
    raw.textContent = JSON.stringify(body, null, 2);
    renderTrace(traceEntriesForBuild(build));
    renderInspector(build);
    renderBuildIdentity(build);
    await renderAssembly(build.artifacts.assembly);
    selectStep(activeStepIndex);
    loading.hidden = true;
    publishViewerState("ready");
    renderMachineGates(build);
    const totalMs = Number(build.artifacts.pipeline?.metrics?.totalMs || 0);
    runState.textContent = totalMs > 0 ? `${(totalMs / 1000).toFixed(1)} s` : "Ready";
    canvasStatus.textContent = "Latest all-Sol assembly · machine gates passed";
    sceneSummary.textContent = assemblySummary(build.artifacts.assembly);
    return true;
  } catch (error) {
    if (sourceBuildId) {
      publishViewerState("unavailable");
      loading.hidden = false;
      loading.classList.add("viewer-error");
      loading.querySelector("strong").textContent = "The 3D view couldn’t load";
      loadingDetail.textContent = "Your saved guide is unchanged. Refresh to try again.";
      document.querySelector("#reload-saved-viewer").hidden = false;
      clearAssemblyView();
      emptyState.hidden = true;
      runState.textContent = "Blocked";
      canvasStatus.textContent = "Exact build unavailable · no substitute shown";
      resultEyebrow.textContent = "Build safely stopped";
      resultTitle.textContent = "Could not open this exact wiring guide";
      resultSummary.textContent = `${error.message}. Return to the project and retry the exact build.`;
      trace.innerHTML = `<li class="error"><span class="num">!</span><div><strong>Fail closed</strong><small>${escapeHtml(error.message)}</small></div><time>NO CREDIT</time></li>`;
    }
    // A fresh server legitimately has no latest build. Keep the prompt screen
    // usable instead of converting that empty state into a UI failure.
    return false;
  }
}

function assertExactStoredBuild(build, expectedBuildId) {
  if (!build || build.id !== expectedBuildId) throw new Error("Exact build identity mismatch");
  const identity = build.identity;
  const manifestIdentity = build.manifest?.identity;
  if (!identity || !manifestIdentity || !build.manifest?.manifestSha256) {
    throw new Error("Atomic build manifest is missing");
  }
  if (identity.buildId !== expectedBuildId || manifestIdentity.buildId !== expectedBuildId
    || identity.requestFingerprint !== manifestIdentity.requestFingerprint) {
    throw new Error("Build fingerprint lineage mismatch");
  }
  if (build.artifactStates?.wiring?.state !== "ready"
    || build.artifacts?.assembly?.state !== "ready"
    || !Array.isArray(build.artifacts.assembly.guideSteps)
    || !build.artifacts.assembly.guideSteps.length) {
    throw new Error("Stored wiring artifact is incomplete");
  }
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
}

function assemblySummary(assembly) {
  const links = assembly.wirelessLinks?.length || 0;
  return `${assembly.parts.length} parts · ${assembly.wires.length} wires${links ? ` · ${links} ESP-NOW link${links === 1 ? "" : "s"}` : ""}`;
}

function wirelessLabelSprite(position, label) {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 96;
  const context = canvas.getContext("2d");
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "rgba(255,255,255,0.92)";
  context.roundRect(4, 4, 504, 88, 24);
  context.fill();
  context.strokeStyle = "#16b8d4";
  context.lineWidth = 5;
  context.stroke();
  context.fillStyle = "#08758a";
  context.font = "700 34px system-ui, sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(`${label} · WIRELESS`, 256, 49);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false, toneMapped: false });
  const sprite = new THREE.Sprite(material);
  sprite.position.copy(position);
  sprite.scale.set(0.075, 0.014, 1);
  sprite.renderOrder = 20;
  return sprite;
}
