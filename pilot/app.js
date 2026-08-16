import { selectBoardProfile, USB_SERIAL_FILTERS } from "./lib/board-profiles.mjs";
import { cleanPinLabel, curvedArrowGeometry, friendlyWiringText } from "./lib/wiring-annotations.mjs";
import {
  explainMessagesForChild,
  explainProjectForChild,
  explainRunningForChild,
  explainStartupForChild,
} from "./lib/plain-language.mjs";

const $ = (selector) => document.querySelector(selector);

const FRONTIER_MODEL = "gpt-5.6-terra";
const LEGACY_MODEL_DEFAULTS = new Set(["gpt-5.4-mini"]);
const DEFAULT_REASONING_EFFORT = "xhigh";
const LEGACY_REASONING_EFFORT_DEFAULTS = new Set(["low"]);
const AI_BACKGROUND_TIMEOUT_MS = 8 * 60 * 1000;
const AI_POLL_BASE_INTERVAL_MS = 2200;
const AI_TRANSIENT_RETRY_ATTEMPTS = 2;
const COMPILE_BUSY_RETRY_ATTEMPTS = 36;
const ANNOTATION_LABEL_PADDING = 12;
const ANNOTATION_LABEL_GAP = 10;
const AUTH_STORAGE_KEY = "makeable.auth.v1";
const AUTH_FLOW_KEY = "makeable.auth.flow.v1";
let serverConfig = window.MAKEABLE_CONFIG || window.CIRCUIT_CODEX_CONFIG || {};
const initialAuthSearch = window.location.search;
const WORKFLOW_STAGES = [
  {
    hash: "#capture",
    label: "Step 1: Describe",
    hint: "Tell Makeable what you want to build.",
  },
  {
    hash: "#plan",
    label: "Step 2: Scan Parts",
    hint: "Show Makeable the real parts on your desk.",
  },
  {
    hash: "#flash",
    label: "Step 3: Build + Load",
    hint: "Connect one wire at a time, then let Makeable load the board.",
  },
  {
    hash: "#verify",
    label: "Step 4: Test",
    hint: "Listen to the board and check the real behavior.",
  },
  {
    hash: "#document",
    label: "Step 5: Finish",
    hint: "Review the guide, parts, and test results.",
  },
];
const PHOTO_PREP_STEPS = [
  {
    image: "images/makeable/photo-tip-lighting.jpg",
    alt: "A shadowy electronics photo compared with a clear, evenly lit photo",
    title: "Use clear, even light.",
    description: "Avoid deep shadows or a dark room. Bright, diffuse light lets me see labels and pins.",
  },
  {
    image: "images/makeable/photo-tip-spacing.jpg",
    alt: "Overlapping electronics compared with parts spaced neatly apart",
    title: "Give every part some room.",
    description: "Do not stack or overlap boards, sensors, displays, or wires. A little space makes every part easier to recognize.",
  },
  {
    image: "images/makeable/photo-tip-angle.jpg",
    alt: "An angled electronics photo compared with a straight overhead photo",
    title: "Shoot straight down.",
    description: "Hold the phone directly above the desk. Keep every part face-up and fully inside the frame.",
  },
];

const settings = {
  githubOwner: serverConfig.githubOwner || "",
  openaiModel: pickModel("", serverConfig.openaiModel, FRONTIER_MODEL),
  openaiReasoningModel: pickModel("", serverConfig.openaiReasoningModel, FRONTIER_MODEL),
  openaiReasoningEffort: pickReasoningEffort("", serverConfig.openaiReasoningEffort),
};

const state = {
  imageDataUrl: "",
  imageElement: null,
  imageFit: null,
  plan: null,
  finalTranscript: "",
  interimTranscript: "",
  serialPort: null,
  serialReader: null,
  serialReadableClosed: null,
  serialLog: "",
  deepgramSocket: null,
  voiceRecorder: null,
  voiceStream: null,
  readme: "",
  compiledFirmware: null,
  activeBuildStepIndex: 0,
  activeWorkflowStageIndex: 0,
  generationId: "",
  flashTransitionTimer: null,
  lastBehaviorChange: "",
  pendingBehaviorChange: "",
  analysisInProgress: false,
  photoPrepStep: 0,
  photoPrepComplete: false,
  auth: loadStoredAuth(),
  account: null,
};

const els = {
  ideaNextButton: $("#ideaNextButton"),
  addSketchButton: $("#addSketchButton"),
  ideaPrompts: document.querySelectorAll("[data-idea]"),
  voiceTranscriptBox: $("#voiceTranscriptBox"),
  homeButton: $("#homeButton"),
  homeBrandLink: $("#homeBrandLink"),
  canvas: $("#partsCanvas"),
  photoInput: $("#partsPhotoInput"),
  clearPhotoButton: $("#clearPhotoButton"),
  ideaText: $("#ideaText"),
  startVoiceButton: $("#startVoiceButton"),
  stopVoiceButton: $("#stopVoiceButton"),
  voiceStatus: $("#voiceStatus"),
  transcriptBox: $("#transcriptBox"),
  photoPrepButton: $("#photoPrepButton"),
  photoPrepDialog: $("#photoPrepDialog"),
  photoPrepImage: $("#photoPrepImage"),
  photoPrepTitle: $("#photoPrepTitle"),
  photoPrepDescription: $("#photoPrepDescription"),
  photoPrepCounter: $("#photoPrepCounter"),
  photoPrepBackButton: $("#photoPrepBackButton"),
  photoPrepNextButton: $("#photoPrepNextButton"),
  photoPrepCloseButton: $("#photoPrepCloseButton"),
  photoPrepProgress: document.querySelectorAll(".photo-prep-progress i"),
  projectBriefText: $("#projectBriefText"),
  scanProcessSteps: document.querySelectorAll("[data-scan-step]"),
  workflowStages: document.querySelectorAll("[data-stage-index]"),
  timelineButtons: document.querySelectorAll("[data-workflow-stage]"),
  stageBackButton: $("#stageBackButton"),
  stageNextButton: $("#stageNextButton"),
  stageControlTitle: $("#stageControlTitle"),
  stageControlHint: $("#stageControlHint"),
  partsList: $("#partsList"),
  partsCountLabel: $("#partsCountLabel"),
  wiringList: $("#wiringList"),
  diagnosticsList: $("#diagnosticsList"),
  visualStepList: $("#visualStepList"),
  buildStepCounter: $("#buildStepCounter"),
  buildStepDots: $("#buildStepDots"),
  prevBuildStepButton: $("#prevBuildStepButton"),
  nextBuildStepButton: $("#nextBuildStepButton"),
  showWiringButton: $("#showWiringButton"),
  showCodeButton: $("#showCodeButton"),
  wiringWorkspace: $("#wiringWorkspace"),
  codeWorkspace: $("#codeWorkspace"),
  baudRateInput: $("#baudRateInput"),
  connectSerialButton: $("#connectSerialButton"),
  disconnectSerialButton: $("#disconnectSerialButton"),
  serialCommandInput: $("#serialCommandInput"),
  sendSerialButton: $("#sendSerialButton"),
  evaluateLogsButton: $("#evaluateLogsButton"),
  serialLog: $("#serialLog"),
  logEvaluation: $("#logEvaluation"),
  behaviorSummary: $("#behaviorSummary"),
  codeFunctionList: $("#codeFunctionList"),
  openBehaviorTuneButton: $("#openBehaviorTuneButton"),
  behaviorTuneDialog: $("#behaviorTuneDialog"),
  closeBehaviorTuneButton: $("#closeBehaviorTuneButton"),
  cancelBehaviorTuneButton: $("#cancelBehaviorTuneButton"),
  behaviorChangeForm: $("#behaviorChangeForm"),
  behaviorChangeInput: $("#behaviorChangeInput"),
  applyBehaviorChangeButton: $("#applyBehaviorChangeButton"),
  behaviorChangeStatus: $("#behaviorChangeStatus"),
  verifyBackButton: $("#verifyBackButton"),
  verifyPublishButton: $("#verifyPublishButton"),
  compileFlashButton: $("#compileFlashButton"),
  flashProgressBar: $("#flashProgressBar"),
  esp32Status: $("#esp32Status"),
  flashSuccessTransition: $("#flashSuccessTransition"),
  flashCountdownText: $("#flashCountdownText"),
  flashCountdownNumber: $("#flashCountdownNumber"),
  testHardwareNowButton: $("#testHardwareNowButton"),
  generateReadmeButton: $("#generateReadmeButton"),
  repoNameInput: $("#repoNameInput"),
  privateRepoInput: $("#privateRepoInput"),
  publishGithubButton: $("#publishGithubButton"),
  githubStatus: $("#githubStatus"),
  readmePreview: $("#readmePreview"),
  accountButton: $("#accountButton"),
  creditBadge: $("#creditBadge"),
  accountName: $("#accountName"),
};

const hardwarePlanSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    projectTitle: { type: "string" },
    summary: { type: "string" },
    parts: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          type: { type: "string" },
          confidence: { type: "number" },
          role: { type: "string" },
          bbox: {
            type: "object",
            additionalProperties: false,
            properties: {
              x: { type: "number" },
              y: { type: "number" },
              width: { type: "number" },
              height: { type: "number" },
            },
            required: ["x", "y", "width", "height"],
          },
        },
        required: ["id", "name", "type", "confidence", "role", "bbox"],
      },
    },
    warnings: { type: "array", items: { type: "string" } },
    wiringSteps: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          order: { type: "integer" },
          title: { type: "string" },
          instruction: { type: "string" },
          from: { type: "string" },
          to: { type: "string" },
          fromPartId: { type: "string" },
          toPartId: { type: "string" },
          pin: { type: "string" },
          wireColor: { type: "string" },
          check: { type: "string" },
        },
        required: ["order", "title", "instruction", "from", "to", "fromPartId", "toPartId", "pin", "wireColor", "check"],
      },
    },
    diagnosticTests: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string" },
          purpose: { type: "string" },
          userAction: { type: "string" },
          expectedSerial: { type: "string" },
        },
        required: ["name", "purpose", "userAction", "expectedSerial"],
      },
    },
    firmwareSpec: {
      type: "object",
      additionalProperties: false,
      properties: {
        board: { type: "string" },
        behavior: { type: "string" },
        libraries: { type: "array", items: { type: "string" } },
        pinAssignments: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              label: { type: "string" },
              gpio: { type: "integer" },
              mode: { type: "string" },
              purpose: { type: "string" },
            },
            required: ["label", "gpio", "mode", "purpose"],
          },
        },
        serialProtocol: { type: "array", items: { type: "string" } },
      },
      required: ["board", "behavior", "libraries", "pinAssignments", "serialProtocol"],
    },
  },
  required: [
    "projectTitle",
    "summary",
    "parts",
    "warnings",
    "wiringSteps",
    "diagnosticTests",
    "firmwareSpec",
  ],
};

const firmwareSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    language: { type: "string" },
    sketch: { type: "string" },
    notes: { type: "string" },
  },
  required: ["language", "sketch", "notes"],
};

const HOSTED_FIRMWARE_LIBRARIES = [
  "ESP32 Arduino core built-ins (Arduino, Wire, SPI, WiFi, HTTPClient, Preferences, FS)",
  "Adafruit Unified Sensor",
  "DHT sensor library",
  "Adafruit NeoPixel",
  "ESP32Servo",
  "Adafruit GFX Library",
  "Adafruit SSD1306",
  "ArduinoJson",
  "PubSubClient",
];

bindEvents();
renderEmptyPlan();
renderProjectBrief();
setScanProcessStep(1);
const initialStageIndex = WORKFLOW_STAGES.findIndex((stage) => stage.hash === window.location.hash);
setActiveWorkflowStage(Math.max(initialStageIndex, 0), {
  updateHash: true,
  replace: true,
});
drawPartsCanvas();
refreshServerConfig().then(initializeAuth);
refreshEsp32Status();
if (/^(localhost|127\.0\.0\.1)$/.test(window.location.hostname)) {
  globalThis.__MAKEABLE_TEST_API__ = {
    loadPlan(plan) {
      state.plan = plan;
      state.compiledFirmware = null;
      renderPlan();
      setActiveWorkflowStage(2);
      setBuildMode("code");
    },
    getState() {
      return {
        board: selectBoardProfile(state.plan)?.id || null,
        compiled: Boolean(state.compiledFirmware),
        status: els.esp32Status.textContent,
      };
    },
  };
}
window.addEventListener("resize", () => {
  drawPartsCanvas();
  renderVisualSteps();
});
window.addEventListener("hashchange", () => {
  const hashIndex = WORKFLOW_STAGES.findIndex((stage) => stage.hash === window.location.hash);
  if (hashIndex >= 0 && hashIndex !== state.activeWorkflowStageIndex) {
    setActiveWorkflowStage(hashIndex, { updateHash: false });
  }
});

function bindEvents() {
  els.homeButton?.addEventListener("click", showIntro);
  els.homeBrandLink?.addEventListener("click", showIntro);
  els.ideaNextButton?.addEventListener("click", advanceFromIdea);
  els.addSketchButton?.addEventListener("click", openPhotoPrepDialog);
  els.ideaText?.addEventListener("input", renderProjectBrief);
  els.ideaPrompts.forEach((button) => {
    button.addEventListener("click", () => {
      els.ideaText.value = button.dataset.idea || "";
      renderProjectBrief();
      els.ideaText.focus();
    });
  });
  els.photoInput.addEventListener("change", handlePhotoUpload);
  els.clearPhotoButton.addEventListener("click", clearPhoto);
  els.photoPrepButton?.addEventListener("click", openPhotoPrepDialog);
  els.photoPrepBackButton?.addEventListener("click", showPreviousPhotoPrepStep);
  els.photoPrepNextButton?.addEventListener("click", advancePhotoPrepStep);
  els.photoPrepCloseButton?.addEventListener("click", closePhotoPrepDialog);
  els.photoPrepDialog?.addEventListener("click", (event) => {
    if (event.target === els.photoPrepDialog) closePhotoPrepDialog();
  });
  els.startVoiceButton.addEventListener("click", startVoiceCapture);
  els.stopVoiceButton.addEventListener("click", stopVoiceCapture);
  els.timelineButtons.forEach((button) => {
    button.addEventListener("click", () => setActiveWorkflowStage(Number(button.dataset.workflowStage || 0)));
  });
  els.stageBackButton.addEventListener("click", () => setActiveWorkflowStage(state.activeWorkflowStageIndex - 1));
  els.stageNextButton.addEventListener("click", () => {
    if (state.activeWorkflowStageIndex === 2) goToTestStage();
    else setActiveWorkflowStage(state.activeWorkflowStageIndex + 1);
  });
  els.prevBuildStepButton.addEventListener("click", () => setActiveBuildStep(state.activeBuildStepIndex - 1));
  els.nextBuildStepButton.addEventListener("click", advanceBuildStep);
  els.showWiringButton?.addEventListener("click", () => setBuildMode("wiring"));
  els.showCodeButton?.addEventListener("click", () => setBuildMode("code"));
  els.connectSerialButton.addEventListener("click", connectSerial);
  els.disconnectSerialButton.addEventListener("click", disconnectSerial);
  els.sendSerialButton.addEventListener("click", sendSerialCommand);
  els.evaluateLogsButton.addEventListener("click", evaluateSerialLogs);
  els.openBehaviorTuneButton?.addEventListener("click", openBehaviorTuneDialog);
  els.closeBehaviorTuneButton?.addEventListener("click", closeBehaviorTuneDialog);
  els.cancelBehaviorTuneButton?.addEventListener("click", closeBehaviorTuneDialog);
  els.behaviorTuneDialog?.addEventListener("click", (event) => {
    if (event.target === els.behaviorTuneDialog) closeBehaviorTuneDialog();
  });
  els.behaviorChangeForm.addEventListener("submit", applyBehaviorChange);
  els.verifyBackButton?.addEventListener("click", () => setActiveWorkflowStage(2));
  els.verifyPublishButton?.addEventListener("click", () => setActiveWorkflowStage(4));
  els.compileFlashButton.addEventListener("click", compileAndFlashFirmware);
  els.testHardwareNowButton.addEventListener("click", goToTestStage);
  els.generateReadmeButton.addEventListener("click", () => {
    state.readme = buildReadme();
    els.readmePreview.textContent = state.readme;
  });
  els.publishGithubButton?.addEventListener("click", publishToGitHub);
  els.accountButton?.addEventListener("click", handleAccountButton);
}

function renderProjectBrief() {
  if (!els.projectBriefText) return;
  els.projectBriefText.textContent = els.ideaText.value.trim() || "Describe what you want the hardware to do.";
}

function setScanProcessStep(activeStep) {
  els.scanProcessSteps.forEach((item) => {
    const step = Number(item.dataset.scanStep || 1);
    item.classList.toggle("is-active", step === activeStep);
    item.classList.toggle("is-complete", step < activeStep);
  });
}

function openPhotoPrepDialog() {
  if (!els.ideaText.value.trim()) {
    setActiveWorkflowStage(0);
    els.ideaText.focus();
    els.ideaText.setAttribute("aria-invalid", "true");
    if (els.voiceTranscriptBox) els.voiceTranscriptBox.textContent = "Tell me what the build should do before adding its parts.";
    return;
  }
  els.ideaText.removeAttribute("aria-invalid");
  state.photoPrepComplete = false;
  state.photoPrepStep = 0;
  renderPhotoPrepStep();
  if (!els.photoPrepDialog.open) els.photoPrepDialog.showModal();
}

function closePhotoPrepDialog() {
  if (els.photoPrepDialog?.open) els.photoPrepDialog.close();
}

function openBehaviorTuneDialog() {
  setStatus(
    els.behaviorChangeStatus,
    "Heads up: your current build stays unchanged until you submit this update.",
    "",
  );
  if (!els.behaviorTuneDialog.open) els.behaviorTuneDialog.showModal();
  requestAnimationFrame(() => els.behaviorChangeInput.focus({ preventScroll: true }));
}

function closeBehaviorTuneDialog() {
  if (els.behaviorTuneDialog?.open) els.behaviorTuneDialog.close();
}

function renderPhotoPrepStep() {
  const step = PHOTO_PREP_STEPS[state.photoPrepStep];
  if (!step) return;
  els.photoPrepImage.src = step.image;
  els.photoPrepImage.alt = step.alt;
  els.photoPrepTitle.textContent = step.title;
  els.photoPrepDescription.textContent = step.description;
  els.photoPrepCounter.textContent = `Photo check · ${state.photoPrepStep + 1} of ${PHOTO_PREP_STEPS.length}`;
  els.photoPrepBackButton.hidden = state.photoPrepStep === 0;
  els.photoPrepNextButton.textContent = state.photoPrepStep === PHOTO_PREP_STEPS.length - 1
    ? "Looks good - choose photo"
    : "Got it - next";
  els.photoPrepProgress.forEach((marker, index) => {
    marker.classList.toggle("is-active", index === state.photoPrepStep);
    marker.classList.toggle("is-complete", index < state.photoPrepStep);
  });
}

function showPreviousPhotoPrepStep() {
  state.photoPrepStep = Math.max(0, state.photoPrepStep - 1);
  renderPhotoPrepStep();
}

function advancePhotoPrepStep() {
  if (state.photoPrepStep < PHOTO_PREP_STEPS.length - 1) {
    state.photoPrepStep += 1;
    renderPhotoPrepStep();
    return;
  }
  state.photoPrepComplete = true;
  closePhotoPrepDialog();
  els.photoInput.click();
}

function showIntro(event) {
  event?.preventDefault();
  document.body.classList.remove("intro-active");
  setActiveWorkflowStage(0, { updateHash: true, replace: true });
}

async function advanceFromIdea() {
  const idea = els.ideaText.value.trim();
  if (!idea) {
    els.ideaText.focus();
    els.ideaText.setAttribute("aria-invalid", "true");
    if (els.voiceTranscriptBox) els.voiceTranscriptBox.textContent = "Tell me the idea in one sentence first.";
    return;
  }
  els.ideaText.removeAttribute("aria-invalid");
  if (serverConfig.hasAccounts && !(await getAccessToken({ interactive: false }))) {
    sessionStorage.setItem("makeable.pendingIdea", idea);
    sessionStorage.setItem("makeable.signInIntent", "plan");
    await startSignIn();
    return;
  }
  setActiveWorkflowStage(1);
}

function setActiveWorkflowStage(index, options = {}) {
  const activeIndex = clamp(index, 0, WORKFLOW_STAGES.length - 1);
  state.activeWorkflowStageIndex = activeIndex;
  document.body.dataset.stage = String(activeIndex + 1);

  els.workflowStages.forEach((stage) => {
    const stageIndex = Number(stage.dataset.stageIndex || 0);
    const isActive = stageIndex === activeIndex;
    stage.hidden = !isActive;
    stage.classList.toggle("is-active", isActive);
  });

  els.timelineButtons.forEach((button) => {
    const buttonIndex = Number(button.dataset.workflowStage || 0);
    button.classList.toggle("is-active", buttonIndex === activeIndex);
    button.classList.toggle("is-complete", buttonIndex < activeIndex);
  });

  const stage = WORKFLOW_STAGES[activeIndex];
  els.stageControlTitle.textContent = stage.label;
  els.stageControlHint.textContent = stage.hint;
  els.stageBackButton.disabled = activeIndex === 0;
  els.stageNextButton.disabled = activeIndex === WORKFLOW_STAGES.length - 1;
  els.stageNextButton.textContent = ["Scan my parts", "Build it", "Let’s test it", "Publish my build", "All set"][activeIndex];

  if (activeIndex === 2 && els.codeWorkspace?.hidden !== false) setBuildMode("wiring");
  if (activeIndex === 1) renderProjectBrief();
  if (activeIndex === 3) renderCodeExplanation();
  if (activeIndex !== 2) stopFlashSuccessTransition();

  if (options.updateHash !== false) {
    const url = `${window.location.pathname}${stage.hash}`;
    window.history.replaceState(null, "", url);
  }

  requestAnimationFrame(() => {
    drawPartsCanvas();
    renderVisualSteps();
  });
}

function startFlashSuccessTransition() {
  stopFlashSuccessTransition();
  let secondsRemaining = 3;
  els.flashSuccessTransition.hidden = false;
  els.flashCountdownNumber.textContent = String(secondsRemaining);
  els.testHardwareNowButton.focus({ preventScroll: true });
  state.flashTransitionTimer = window.setInterval(() => {
    secondsRemaining -= 1;
    els.flashCountdownNumber.textContent = String(Math.max(0, secondsRemaining));
    if (secondsRemaining <= 0) goToTestStage();
  }, 1000);
}

function stopFlashSuccessTransition(options = {}) {
  if (state.flashTransitionTimer) window.clearInterval(state.flashTransitionTimer);
  state.flashTransitionTimer = null;
  if (options.hide) els.flashSuccessTransition.hidden = true;
}

function goToTestStage() {
  stopFlashSuccessTransition({ hide: true });
  setActiveWorkflowStage(3);
  window.setTimeout(() => connectSerial({ automatic: true }), 250);
}

function pickModel(localValue, serverValue, fallback) {
  if (localValue && !LEGACY_MODEL_DEFAULTS.has(localValue)) return localValue;
  if (serverValue && !LEGACY_MODEL_DEFAULTS.has(serverValue)) return serverValue;
  return fallback;
}

function pickReasoningEffort(localValue, serverValue) {
  if (localValue && !LEGACY_REASONING_EFFORT_DEFAULTS.has(localValue)) return localValue;
  return serverValue || DEFAULT_REASONING_EFFORT;
}

async function refreshServerConfig() {
  try {
    const freshConfig = await apiJson("/api/config");
    serverConfig = freshConfig;
    settings.githubOwner = freshConfig.githubOwner || "";
    settings.openaiModel = pickModel("", freshConfig.openaiModel, FRONTIER_MODEL);
    settings.openaiReasoningModel = pickModel("", freshConfig.openaiReasoningModel, FRONTIER_MODEL);
    settings.openaiReasoningEffort = pickReasoningEffort("", freshConfig.openaiReasoningEffort);
    return freshConfig;
  } catch (error) {
    console.error(error);
    return serverConfig;
  }
}

function loadStoredAuth() {
  try {
    return JSON.parse(sessionStorage.getItem(AUTH_STORAGE_KEY) || "null");
  } catch {
    return null;
  }
}

function saveAuth(auth) {
  state.auth = auth;
  if (auth) sessionStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(auth));
  else sessionStorage.removeItem(AUTH_STORAGE_KEY);
  renderAccount();
}

async function initializeAuth() {
  if (!serverConfig.hasAccounts) {
    renderAccount();
    return;
  }
  try {
    const params = new URLSearchParams(initialAuthSearch);
    if (params.has("error")) {
      throw new Error(params.get("error_description") || params.get("error") || "Sign-in was cancelled.");
    }
    if (params.has("code")) await finishSignIn(params);
    const token = await getAccessToken({ interactive: false });
    if (token) {
      await refreshAccount();
      const pendingIdea = sessionStorage.getItem("makeable.pendingIdea");
      if (pendingIdea && !els.ideaText.value.trim()) els.ideaText.value = pendingIdea;
      if (sessionStorage.getItem("makeable.signInIntent") === "plan") setActiveWorkflowStage(1);
      sessionStorage.removeItem("makeable.pendingIdea");
      sessionStorage.removeItem("makeable.signInIntent");
    }
  } catch (error) {
    console.error(error);
    saveAuth(null);
    if (els.accountName) els.accountName.textContent = error.message;
  }
  renderAccount();
}

function renderAccount() {
  if (!els.accountButton) return;
  const claims = decodeJwtPayload(state.auth?.idToken || state.auth?.accessToken || "");
  const signedIn = Boolean(state.auth?.accessToken && claims);
  els.accountButton.textContent = signedIn ? "Sign out" : "Sign in";
  els.accountButton.disabled = !serverConfig.hasAccounts;
  if (els.accountName) {
    els.accountName.textContent = signedIn
      ? String(claims?.email || claims?.["cognito:username"] || claims?.username || "Maker")
      : "10 free generations";
  }
  if (els.creditBadge) {
    els.creditBadge.hidden = !signedIn || !state.account;
    els.creditBadge.textContent = `${state.account?.credits ?? 0} credit${state.account?.credits === 1 ? "" : "s"}`;
  }
}

async function handleAccountButton() {
  if (state.auth?.accessToken) signOut();
  else await startSignIn();
}

async function startSignIn() {
  if (!serverConfig.cognitoDomain || !serverConfig.cognitoClientId) {
    throw new Error("Sign-in is not configured yet.");
  }
  const verifier = randomBase64Url(64);
  const loginState = randomBase64Url(32);
  const challengeBytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  const challenge = bytesToBase64Url(new Uint8Array(challengeBytes));
  sessionStorage.setItem(AUTH_FLOW_KEY, JSON.stringify({ verifier, loginState }));
  const authorizeUrl = new URL("/oauth2/authorize", normalizedCognitoDomain());
  authorizeUrl.search = new URLSearchParams({
    client_id: serverConfig.cognitoClientId,
    response_type: "code",
    scope: "openid email profile",
    redirect_uri: authRedirectUri(),
    state: loginState,
    code_challenge_method: "S256",
    code_challenge: challenge,
  });
  window.location.assign(authorizeUrl);
}

async function finishSignIn(params) {
  const flow = JSON.parse(sessionStorage.getItem(AUTH_FLOW_KEY) || "null");
  if (!flow?.verifier || !flow?.loginState || params.get("state") !== flow.loginState) {
    throw new Error("The sign-in response could not be verified. Please try again.");
  }
  const response = await fetch(new URL("/oauth2/token", normalizedCognitoDomain()), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: serverConfig.cognitoClientId,
      code: params.get("code") || "",
      redirect_uri: authRedirectUri(),
      code_verifier: flow.verifier,
    }),
  });
  const tokens = await response.json();
  if (!response.ok) throw new Error(tokens.error_description || tokens.error || "Could not complete sign-in.");
  saveAuth({
    accessToken: tokens.access_token,
    idToken: tokens.id_token,
    refreshToken: tokens.refresh_token,
    expiresAt: Date.now() + Number(tokens.expires_in || 3600) * 1000,
  });
  sessionStorage.removeItem(AUTH_FLOW_KEY);
  window.history.replaceState(null, "", `${window.location.pathname}${window.location.hash || "#capture"}`);
}

async function getAccessToken({ interactive = true } = {}) {
  if (state.auth?.accessToken && Number(state.auth.expiresAt || 0) > Date.now() + 30000) {
    return state.auth.accessToken;
  }
  if (state.auth?.refreshToken) {
    try {
      const response = await fetch(new URL("/oauth2/token", normalizedCognitoDomain()), {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          client_id: serverConfig.cognitoClientId,
          refresh_token: state.auth.refreshToken,
        }),
      });
      const tokens = await response.json();
      if (!response.ok) throw new Error(tokens.error_description || tokens.error);
      saveAuth({
        ...state.auth,
        accessToken: tokens.access_token,
        idToken: tokens.id_token || state.auth.idToken,
        expiresAt: Date.now() + Number(tokens.expires_in || 3600) * 1000,
      });
      return state.auth.accessToken;
    } catch (error) {
      console.error("Token refresh failed", error);
      saveAuth(null);
    }
  }
  if (interactive) {
    await startSignIn();
    throw new Error("Opening sign-in…");
  }
  return "";
}

async function refreshAccount() {
  const account = await apiJson("/api/account");
  state.account = account;
  renderAccount();
  return account;
}

function signOut() {
  saveAuth(null);
  state.account = null;
  const logoutUrl = new URL("/logout", normalizedCognitoDomain());
  logoutUrl.search = new URLSearchParams({
    client_id: serverConfig.cognitoClientId,
    logout_uri: authRedirectUri(),
  });
  window.location.assign(logoutUrl);
}

function normalizedCognitoDomain() {
  const value = String(serverConfig.cognitoDomain || "").trim();
  return value.startsWith("http") ? value : `https://${value}`;
}

function authRedirectUri() {
  return serverConfig.cognitoRedirectUri || `${window.location.origin}/`;
}

function decodeJwtPayload(token) {
  try {
    const payload = token.split(".")[1];
    return JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
  } catch {
    return null;
  }
}

function randomBase64Url(length) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

function bytesToBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function handlePhotoUpload(event) {
  const [file] = event.target.files || [];
  if (!file) return;
  if (!state.photoPrepComplete) {
    event.target.value = "";
    return;
  }
  state.photoPrepComplete = false;

  if (state.activeWorkflowStageIndex === 0) setActiveWorkflowStage(1);
  state.plan = null;
  state.compiledFirmware = null;
  state.lastBehaviorChange = "";
  state.pendingBehaviorChange = "";
  stopFlashSuccessTransition({ hide: true });
  state.activeBuildStepIndex = 0;
  renderEmptyPlan();
  setScanProcessStep(2);
  setPhotoControlsBusy(true);
  setStatus(els.transcriptBox, "Loading your photo. Part recognition will start automatically...", "warn");

  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      state.imageDataUrl = resizePhotoForAi(img);
      const displayImg = new Image();
      displayImg.onload = () => {
        state.imageElement = displayImg;
        document.body.classList.add("has-parts-photo");
        drawPartsCanvas();
        setStatus(els.transcriptBox, "Photo ready. I’m naming the parts and building your guide now...", "warn");
        void analyzeHardware();
      };
      displayImg.onerror = () => handlePhotoLoadError("I couldn’t prepare that image. Try another photo.");
      displayImg.src = state.imageDataUrl;
    };
    img.onerror = () => handlePhotoLoadError("I couldn’t read that image. Try a clear JPG or PNG.");
    img.src = String(reader.result || "");
  };
  reader.onerror = () => handlePhotoLoadError("I couldn’t load that photo. Try choosing it again.");
  reader.readAsDataURL(file);
}

function handlePhotoLoadError(message) {
  setPhotoControlsBusy(false);
  setScanProcessStep(1);
  setStatus(els.transcriptBox, message, "danger");
}

function setPhotoControlsBusy(isBusy) {
  if (els.photoPrepButton) els.photoPrepButton.disabled = isBusy;
  if (els.clearPhotoButton) els.clearPhotoButton.disabled = isBusy;
}

function resizePhotoForAi(img) {
  const hostedMode = Boolean(serverConfig.hostedMode);
  const maxSide = hostedMode ? 1400 : 1800;
  const quality = hostedMode ? 0.78 : 0.86;
  const scale = Math.min(1, maxSide / img.naturalWidth, maxSide / img.naturalHeight);
  const width = Math.max(1, Math.round(img.naturalWidth * scale));
  const height = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);
  return canvas.toDataURL("image/jpeg", quality);
}

function clearPhoto() {
  state.imageDataUrl = "";
  state.imageElement = null;
  state.imageFit = null;
  state.plan = null;
  state.compiledFirmware = null;
  state.lastBehaviorChange = "";
  state.pendingBehaviorChange = "";
  state.photoPrepComplete = false;
  state.analysisInProgress = false;
  stopFlashSuccessTransition({ hide: true });
  state.activeBuildStepIndex = 0;
  els.photoInput.value = "";
  document.body.classList.remove("has-parts-photo");
  setPhotoControlsBusy(false);
  setScanProcessStep(1);
  renderEmptyPlan();
  drawPartsCanvas();
  setStatus(els.transcriptBox, "Start with the three photo checks. They take about ten seconds.", "");
}

function drawPartsCanvas() {
  const canvas = els.canvas;
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(320, rect.width || 900);
  const height = Math.max(220, rect.height || 520);
  const dpr = window.devicePixelRatio || 1;

  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  ctx.fillStyle = "#f8fafc";
  ctx.fillRect(0, 0, width, height);
  drawGrid(ctx, width, height);

  if (!state.imageElement) {
    return;
  }

  const img = state.imageElement;
  const scale = Math.min(width / img.naturalWidth, height / img.naturalHeight);
  const drawWidth = img.naturalWidth * scale;
  const drawHeight = img.naturalHeight * scale;
  const x = (width - drawWidth) / 2;
  const y = (height - drawHeight) / 2;
  state.imageFit = { x, y, width: drawWidth, height: drawHeight };
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, x, y, drawWidth, drawHeight);

  if (state.plan?.parts?.length) {
    drawAnnotations(ctx, state.plan.parts);
  }
}

function drawGrid(ctx, width, height) {
  ctx.save();
  ctx.strokeStyle = "rgba(136, 112, 84, 0.13)";
  ctx.lineWidth = 1;
  for (let x = 0; x <= width; x += 28) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
  for (let y = 0; y <= height; y += 28) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }
  ctx.restore();
}

function drawAnnotations(ctx, parts) {
  const fit = state.imageFit;
  if (!fit) return;
  const colors = ["#ef2d83", "#5169df", "#27a88a", "#f5b91f", "#8c76dc", "#f04e3e"];
  const placedLabels = [];

  const annotations = parts.map((part, index) => {
    const bbox = normalizeBbox(part.bbox, index, parts.length);
    return {
      part,
      index,
      bbox,
      box: {
        x: fit.x + (bbox.x / 100) * fit.width,
        y: fit.y + (bbox.y / 100) * fit.height,
        width: (bbox.width / 100) * fit.width,
        height: (bbox.height / 100) * fit.height,
      },
    };
  });

  annotations.forEach(({ part, index, box }) => {
    const color = colors[index % colors.length];
    const otherPartBoxes = annotations
      .filter((annotation) => annotation.part !== part)
      .map((annotation) => annotation.box);

    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.strokeRect(box.x, box.y, box.width, box.height);
    ctx.shadowColor = color;
    ctx.shadowBlur = 14;

    ctx.font = "800 13px Inter, system-ui, sans-serif";
    const maxLabelWidth = Math.min(150, fit.width - 12);
    const label = trimCanvasText(ctx, `${index + 1}. ${shortPartLabel(part.name)}`, maxLabelWidth - 18);
    const labelWidth = Math.min(ctx.measureText(label).width + 18, maxLabelWidth);
    const labelHeight = 28;
    const labelRect = placeAnnotationLabel(box, labelWidth, labelHeight, fit, placedLabels, otherPartBoxes);
    placedLabels.push(labelRect);

    ctx.shadowBlur = 0;
    drawLabelLeader(ctx, labelRect, box, color);
    ctx.fillStyle = color;
    ctx.fillRect(labelRect.x, labelRect.y, labelRect.width, labelRect.height);
    ctx.fillStyle = "#fff";
    ctx.fillText(label, labelRect.x + 9, labelRect.y + 18);
    ctx.restore();
  });
}

function shortPartLabel(name) {
  const value = String(name || "Part").trim();
  const normalized = value.toLowerCase();
  if (/esp32|devkit|microcontroller/.test(normalized)) return "ESP32";
  if (/\bpir\b|motion/.test(normalized)) return "PIR";
  if (/jumper|wire/.test(normalized)) return "Wires";
  if (/resistor/.test(normalized)) return "Resistor";
  if (/\bleds?\b|diode/.test(normalized)) return "LED";
  if (/servo/.test(normalized)) return "Servo";
  if (/relay/.test(normalized)) return "Relay";
  if (/display|screen|oled|lcd/.test(normalized)) return "Display";
  if (/power|battery|supply/.test(normalized)) return "Power";
  if (/bulb|lamp|light/.test(normalized)) return "Light";
  return value
    .replace(/\s+(with|including|and)\s+.*$/i, "")
    .replace(/\b(board|module|sensor|pack|strip|style|development)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 18) || "Part";
}

function compactPartName(name) {
  const value = String(name || "Part").trim();
  const normalized = value.toLowerCase();
  if (/esp32|devkit/.test(normalized)) return "ESP32 DevKit";
  if (/\bpir\b|motion/.test(normalized)) return "PIR sensor";
  if (/jumper|wire/.test(normalized)) return "jumper wires";
  if (/resistor/.test(normalized)) return "resistor";
  if (/\bleds?\b/.test(normalized)) return "LED";
  return value
    .replace(/\s+(with|including|and)\s+.*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function trimCanvasText(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  const suffix = "...";
  let trimmed = text.trim();
  while (trimmed.length > 1 && ctx.measureText(`${trimmed}${suffix}`).width > maxWidth) {
    trimmed = trimmed.slice(0, -1).trimEnd();
  }
  return `${trimmed}${suffix}`;
}

function placeAnnotationLabel(box, width, height, fit, placedLabels, avoidRects = []) {
  const gap = ANNOTATION_LABEL_GAP;
  const candidates = [
    { x: box.x + box.width / 2 - width / 2, y: box.y - height - gap },
    { x: box.x, y: box.y - height - gap },
    { x: box.x + box.width - width, y: box.y - height - gap },
    { x: box.x + box.width / 2 - width / 2, y: box.y + box.height + gap },
    { x: box.x, y: box.y + box.height + gap },
    { x: box.x + box.width - width, y: box.y + box.height + gap },
    { x: box.x + box.width + gap, y: box.y },
    { x: box.x - width - gap, y: box.y },
    { x: box.x + box.width + gap, y: box.y + box.height / 2 - height / 2 },
    { x: box.x - width - gap, y: box.y + box.height / 2 - height / 2 },
    { x: box.x + gap, y: box.y + gap },
  ].map((candidate) => clampLabelRect(candidate.x, candidate.y, width, height, fit));

  const cleanCandidate = candidates.find((candidate) =>
    labelPlacementIsClean(candidate, box, placedLabels, avoidRects),
  );
  if (cleanCandidate) return cleanCandidate;

  for (let y = fit.y + gap; y <= fit.y + fit.height - height - gap; y += height + gap) {
    const scanXs = [box.x, box.x + box.width + gap, box.x - width - gap, fit.x + gap, fit.x + fit.width - width - gap];
    for (const scanX of scanXs) {
      const scanned = clampLabelRect(scanX, y, width, height, fit);
      if (labelPlacementIsClean(scanned, box, placedLabels, avoidRects)) return scanned;
    }
  }

  return candidates
    .map((candidate) => ({
      candidate,
      score: labelPlacementScore(candidate, box, placedLabels, avoidRects),
    }))
    .sort((a, b) => a.score - b.score)[0].candidate;
}

function labelPlacementIsClean(candidate, sourceBox, placedLabels, avoidRects) {
  return (
    !placedLabels.some((label) => rectsOverlap(candidate, label, ANNOTATION_LABEL_PADDING)) &&
    !avoidRects.some((rect) => rectsOverlap(candidate, rect, 4)) &&
    labelAvoidsLine(candidate, sourceBox, placedLabels)
  );
}

function labelPlacementScore(candidate, sourceBox, placedLabels, avoidRects) {
  const labelPenalty = placedLabels.reduce(
    (total, label) => total + overlapArea(expandRect(candidate, ANNOTATION_LABEL_PADDING), label) * 100,
    0,
  );
  const partPenalty = avoidRects.reduce((total, rect) => total + overlapArea(candidate, rect) * 40, 0);
  const linePenalty = labelAvoidsLine(candidate, sourceBox, placedLabels) ? 0 : 9000;
  const sourceCenter = rectCenter(sourceBox);
  const candidateCenter = rectCenter(candidate);
  const distancePenalty = Math.hypot(candidateCenter.x - sourceCenter.x, candidateCenter.y - sourceCenter.y) * 0.08;
  return labelPenalty + partPenalty + linePenalty + distancePenalty;
}

function clampLabelRect(x, y, width, height, fit) {
  const inset = 6;
  return {
    x: Math.max(fit.x + inset, Math.min(x, fit.x + fit.width - width - inset)),
    y: Math.max(fit.y + inset, Math.min(y, fit.y + fit.height - height - inset)),
    width,
    height,
  };
}

function rectsOverlap(a, b, padding = 0) {
  return !(
    a.x + a.width + padding <= b.x ||
    b.x + b.width + padding <= a.x ||
    a.y + a.height + padding <= b.y ||
    b.y + b.height + padding <= a.y
  );
}

function overlapArea(a, b) {
  const xOverlap = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const yOverlap = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return xOverlap * yOverlap;
}

function expandRect(rect, padding) {
  return {
    x: rect.x - padding,
    y: rect.y - padding,
    width: rect.width + padding * 2,
    height: rect.height + padding * 2,
  };
}

function rectCenter(rect) {
  return {
    x: rect.x + rect.width / 2,
    y: rect.y + rect.height / 2,
  };
}

function labelAvoidsLine(label, box, placedLabels) {
  const lineStart = pointOnRectEdge(label, rectCenter(box));
  const lineEnd = pointOnRectEdge(box, rectCenter(label));
  return !placedLabels.some((placed) => lineIntersectsRect(lineStart, lineEnd, expandRect(placed, 3)));
}

function pointOnRectEdge(rect, toward) {
  const center = rectCenter(rect);
  const dx = toward.x - center.x;
  const dy = toward.y - center.y;
  if (!dx && !dy) return center;
  const scaleX = dx ? rect.width / 2 / Math.abs(dx) : Number.POSITIVE_INFINITY;
  const scaleY = dy ? rect.height / 2 / Math.abs(dy) : Number.POSITIVE_INFINITY;
  const scale = Math.min(scaleX, scaleY);
  return {
    x: center.x + dx * scale,
    y: center.y + dy * scale,
  };
}

function lineIntersectsRect(start, end, rect) {
  if (pointInRect(start, rect) || pointInRect(end, rect)) return true;
  const topLeft = { x: rect.x, y: rect.y };
  const topRight = { x: rect.x + rect.width, y: rect.y };
  const bottomRight = { x: rect.x + rect.width, y: rect.y + rect.height };
  const bottomLeft = { x: rect.x, y: rect.y + rect.height };
  return (
    segmentsIntersect(start, end, topLeft, topRight) ||
    segmentsIntersect(start, end, topRight, bottomRight) ||
    segmentsIntersect(start, end, bottomRight, bottomLeft) ||
    segmentsIntersect(start, end, bottomLeft, topLeft)
  );
}

function pointInRect(point, rect) {
  return point.x >= rect.x && point.x <= rect.x + rect.width && point.y >= rect.y && point.y <= rect.y + rect.height;
}

function segmentsIntersect(a, b, c, d) {
  const direction = (p, q, r) => (r.x - p.x) * (q.y - p.y) - (q.x - p.x) * (r.y - p.y);
  const d1 = direction(c, d, a);
  const d2 = direction(c, d, b);
  const d3 = direction(a, b, c);
  const d4 = direction(a, b, d);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

function drawLabelLeader(ctx, label, box, color) {
  const labelCenter = rectCenter(label);
  const boxCenter = rectCenter(box);
  if (Math.abs(labelCenter.x - boxCenter.x) < 28 && Math.abs(labelCenter.y - boxCenter.y) < 28) return;
  const start = pointOnRectEdge(label, boxCenter);
  const end = pointOnRectEdge(box, labelCenter);
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const distance = Math.max(1, Math.hypot(dx, dy));
  const bend = Math.min(18, distance * 0.18);
  const bendDirection = labelCenter.x <= boxCenter.x ? -1 : 1;
  const control = {
    x: (start.x + end.x) / 2 + (-dy / distance) * bend * bendDirection,
    y: (start.y + end.y) / 2 + (dx / distance) * bend * bendDirection,
  };
  const drawLeader = () => {
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.quadraticCurveTo(control.x, control.y, end.x, end.y);
    ctx.stroke();
  };

  ctx.save();
  ctx.lineCap = "round";
  ctx.strokeStyle = "rgba(255, 255, 255, 0.86)";
  ctx.lineWidth = 6;
  drawLeader();
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.82;
  ctx.lineWidth = 2;
  drawLeader();
  ctx.restore();
}

function normalizeBbox(bbox, index, total) {
  if (
    bbox &&
    Number.isFinite(bbox.x) &&
    Number.isFinite(bbox.y) &&
    Number.isFinite(bbox.width) &&
    Number.isFinite(bbox.height)
  ) {
    let { x, y, width, height } = bbox;
    const largest = Math.max(Math.abs(x), Math.abs(y), Math.abs(width), Math.abs(height));
    if (largest <= 1.5) {
      x *= 100;
      y *= 100;
      width *= 100;
      height *= 100;
    } else if (largest > 100 && largest <= 1000) {
      x /= 10;
      y /= 10;
      width /= 10;
      height /= 10;
    }
    x = clamp(x, 0, 99);
    y = clamp(y, 0, 99);
    width = clamp(width, 2, 100 - x);
    height = clamp(height, 2, 100 - y);
    return {
      x,
      y,
      width,
      height,
    };
  }
  const cols = Math.ceil(Math.sqrt(total || 1));
  const col = index % cols;
  const row = Math.floor(index / cols);
  return { x: 6 + col * 26, y: 8 + row * 28, width: 20, height: 18 };
}

async function analyzeHardware() {
  if (state.analysisInProgress) return;
  await refreshServerConfig();
  const idea = els.ideaText.value.trim();
  if (!state.imageDataUrl) {
    setStatus(els.transcriptBox, "Start with one clear photo of your parts. I’ll use that as the map.", "danger");
    return;
  }
  if (!idea) {
    setStatus(els.transcriptBox, "Tell me the goal in plain language. One sentence is enough.", "danger");
    return;
  }

  state.analysisInProgress = true;
  setPhotoControlsBusy(true);
  setScanProcessStep(2);
  state.generationId = crypto.randomUUID();

  try {
    if (!serverConfig.hasOpenAIKey) {
      setStatus(
        els.transcriptBox,
        "I can’t reach the AI key yet. Once the key is in place, I can make your guide.",
        "danger",
      );
      return;
    }

    setStatus(
      els.transcriptBox,
      "I’m looking closely at the photo and planning the safest order. This can take a minute.",
      "warn",
    );

    const payload = {
      model: settings.openaiModel,
      reasoning: { effort: settings.openaiReasoningEffort || DEFAULT_REASONING_EFFORT },
      input: [
        {
          role: "system",
          content:
            "You are Makeable, an expert hardware build agent for beginners. Identify only the actual visible parts needed for the user's stated project, produce tight normalized bounding boxes for those required parts, make conservative ESP32 wiring choices, flag uncertainty, avoid unsafe pins, and output only schema-valid JSON. Ignore visible parts that are unrelated to the requested build. Never use canned/demo component names or boxes. In user-facing wiring copy, say pin 22 or D22 / 22 instead of GPIO22, and preserve useful signal names such as SCL or SDA. Write firmwareSpec.behavior in everyday English an eight-year-old can understand: say motion sensor instead of PIR, screen instead of OLED display, and avoid bus names or code terms. Do not generate source code in this step.",
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: buildAnalysisPrompt(idea),
            },
            {
              type: "input_image",
              image_url: state.imageDataUrl,
              detail: "high",
            },
          ],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "hardware_project_plan",
          strict: true,
          schema: hardwarePlanSchema,
        },
      },
    };

    const data = await openAiResponse(payload, {
      label: "hardware plan",
      onProgress: ({ elapsedLabel, message }) => {
        setStatus(
          els.transcriptBox,
          message ||
          `I’m still studying the photo (${elapsedLabel}). Keep this tab open; I’ll bring the guide back here.`,
          "warn",
        );
      },
    });
    state.plan = normalizePlan(parseStructuredJson(data, "hardware plan"));
    state.lastBehaviorChange = "";
    state.pendingBehaviorChange = "";
    state.plan.warnings = [...validatePlan(state.plan), ...state.plan.warnings];
    state.activeBuildStepIndex = 0;
    renderPlan();
    setScanProcessStep(3);
    setStatus(
      els.transcriptBox,
      `I found ${state.plan.parts.length} part(s). Now I’m writing the code that matches your build.`,
      "ok",
    );
    try {
      await generateFirmwareForPlan(idea);
      await refreshAccount();
      renderPlan();
      setStatus(
        els.transcriptBox,
        "Your guide and code are ready. Let’s build it one step at a time.",
        "ok",
      );
    } catch (firmwareError) {
      console.error(firmwareError);
      renderPlan();
      setStatus(
        els.transcriptBox,
        `The picture guide is ready, but I couldn’t finish the code yet: ${firmwareError.message}`,
        "warn",
      );
    }
    setActiveWorkflowStage(2);
  } catch (error) {
    console.error(error);
    setStatus(els.transcriptBox, `I got stuck while making the guide: ${error.message}`, "danger");
  } finally {
    state.analysisInProgress = false;
    setPhotoControlsBusy(false);
  }
}

function buildAnalysisPrompt(idea) {
  return [
    `Project idea: ${idea}`,
    "",
    "Return a beginner-safe hardware plan for the actual visible parts in this uploaded image.",
    "Only include parts that are necessary for the described project. Ignore unrelated visible parts even if you can identify them.",
    "Every returned part must either appear in a wiring step or be required to make those wiring steps possible, such as a controller, sensor, output, current-limiting resistor, power connection, or jumper wire.",
    "Use short label-friendly names, such as ESP32 DevKit, PIR sensor, LED, resistor, and jumper wires.",
    "Do not use example/demo/static values. Every part name and bounding box must be based on visual evidence in this exact photo.",
    "Use tight bounding boxes around each physical component. Coordinates may be 0-100 percentages or 0-1000 normalized image coordinates.",
    "Assign stable part ids like esp32_main, pir_sensor, led_pack, resistor_strip, servo_motor. Use those ids in wiringSteps.fromPartId and wiringSteps.toPartId.",
    "For an ESP32 DevKit, look for the module with a metal RF shield, USB connector, boot/reset buttons, and two rows of pins.",
    "For a PIR sensor, look for a white Fresnel dome. Do not label a black circular speaker/display/module as PIR unless it visually matches.",
    "For LEDs/resistors, distinguish loose LEDs, resistor bags/strips, jumper wires, servo motors, displays, relay/audio modules, and breadboards if visible.",
    "If a part is ambiguous, name it as 'possible ...' and reduce confidence rather than guessing.",
    "Prefer ESP32 pins that are usually safe for beginner projects.",
    "For every wiring step, include fromPartId, toPartId, from, to, pin, and a beginner-friendly wireColor.",
    "In titles, instructions, and checks, call ESP32 pins 'pin 22' or 'D22 / 22', not 'GPIO22'. Keep signal roles such as SCL, SDA, CLK, RX, and TX visible.",
    "Do not claim certainty for ambiguous modules; put uncertainty in warnings.",
    "Do not generate source code in this vision/planning step.",
    "Instead, return a compact firmwareSpec with chosen pins, libraries, serial protocol markers, and behavior.",
    "Write firmwareSpec.behavior in short everyday sentences for a child. Say motion sensor, screen, light, fan, or pump instead of technical module names. Do not mention PIR, I2C, OLED, setup(), loop(), HIGH, LOW, SDA, or SCL in the behavior explanation.",
    "Include diagnostic tests that can be judged from serial logs and simple camera observations.",
  ].join("\n");
}

function extractOutputText(data) {
  if (typeof data.output_text === "string" && data.output_text.trim()) return data.output_text;
  const chunks = [];
  for (const output of data.output || []) {
    for (const content of output.content || []) {
      if (typeof content.text === "string") chunks.push(content.text);
      if (typeof content.value === "string") chunks.push(content.value);
    }
  }
  const text = chunks.join("\n").trim();
  if (!text) throw new Error("OpenAI response did not contain output text.");
  return text;
}

function parseStructuredJson(data, label) {
  if (data.status === "failed") {
    throw new Error(`${label} failed: ${openAiErrorMessage(data)}`);
  }
  if (data.status === "cancelled") {
    throw new Error(`${label} was cancelled before it finished.`);
  }
  if (data.status === "incomplete") {
    const reason = data.incomplete_details?.reason || "unknown reason";
    throw new Error(`${label} response was incomplete (${reason}). Try again with the same photo; I’ll keep the long request in the background now.`);
  }
  const text = extractOutputText(data);
  try {
    return JSON.parse(text);
  } catch (error) {
    const preview = text.slice(Math.max(0, text.length - 240));
    throw new Error(
      `${label} JSON was invalid, likely because the model response was truncated. ${error.message}. Tail: ${preview}`,
    );
  }
}

async function openAiResponse(payload, options = {}) {
  const label = options.label || "AI response";
  const progress = typeof options.onProgress === "function" ? options.onProgress : () => {};
  const backgroundPayload = {
    ...payload,
    background: true,
    store: payload.store ?? true,
  };
  delete backgroundPayload.stream;

  for (let attempt = 0; attempt <= AI_TRANSIENT_RETRY_ATTEMPTS; attempt += 1) {
    try {
      const started = await apiJson("/api/openai/background", {
        method: "POST",
        generationId: options.generationId || state.generationId,
        body: JSON.stringify(backgroundPayload),
      });
      return waitForOpenAiResponse(started, label, progress);
    } catch (error) {
      if (shouldFallbackToDirectOpenAi(error)) break;
      if (!isTransientOpenAiError(error) || attempt === AI_TRANSIENT_RETRY_ATTEMPTS) {
        if (isTransientOpenAiError(error)) break;
        throw error;
      }
      const retryDelay = 1200 + attempt * 1800;
      progress({
        status: "retrying",
        elapsedMs: retryDelay,
        elapsedLabel: formatElapsed(retryDelay),
        message: `OpenAI had a temporary hiccup while making the ${label}. Retrying now...`,
      });
      await sleep(retryDelay);
    }
  }

  progress({
    status: "direct",
    elapsedMs: 0,
    elapsedLabel: "0s",
    message: `OpenAI's background request stumbled, so I'm trying the ${label} directly now.`,
  });
  try {
    return await apiJson("/api/openai/responses", {
      method: "POST",
      generationId: options.generationId || state.generationId,
      body: JSON.stringify(payload),
    });
  } catch (error) {
    if (isTransientOpenAiError(error)) {
      throw new Error(
        `OpenAI had a temporary server problem while making the ${label}. Wait a few seconds and press the button again.`,
      );
    }
    throw error;
  }
}

function shouldFallbackToDirectOpenAi(error) {
  return /\b(404|405)\b|not found|unknown parameter.*background|unsupported.*background/i.test(
    String(error?.message || error),
  );
}

function isTransientOpenAiError(error) {
  return /\b(408|409|429|500|502|503|504|529)\b|server had an error|temporarily|timeout|rate limit/i.test(
    String(error?.message || error),
  );
}

async function waitForOpenAiResponse(started, label, progress) {
  const firstStatus = normalizeOpenAiStatus(started.status);
  if (!started.id || isOpenAiTerminalStatus(firstStatus)) return assertOpenAiResponseUsable(started, label);

  const startedAt = Date.now();
  let pollCount = 0;
  let latest = started;
  while (true) {
    const elapsedMs = Date.now() - startedAt;
    progress({
      status: normalizeOpenAiStatus(latest.status),
      elapsedMs,
      elapsedLabel: formatElapsed(elapsedMs),
      id: started.id,
    });

    if (elapsedMs > AI_BACKGROUND_TIMEOUT_MS) {
      throw new Error(
        `${label} is still running after ${formatElapsed(elapsedMs)}. Please try again in a moment; the hosted app is keeping long AI work in the background now.`,
      );
    }

    await sleep(Math.min(6500, AI_POLL_BASE_INTERVAL_MS + pollCount * 450));
    latest = await apiJson(`/api/openai/responses/${encodeURIComponent(started.id)}`, {
      generationId: state.generationId,
    });
    const status = normalizeOpenAiStatus(latest.status);
    if (isOpenAiTerminalStatus(status)) return assertOpenAiResponseUsable(latest, label);
    pollCount += 1;
  }
}

function assertOpenAiResponseUsable(data, label) {
  if (data.status === "failed") {
    throw new Error(`${label} failed: ${openAiErrorMessage(data)}`);
  }
  if (data.status === "cancelled") {
    throw new Error(`${label} was cancelled before it finished.`);
  }
  return data;
}

function isOpenAiTerminalStatus(status) {
  return !status || ["completed", "failed", "cancelled", "incomplete"].includes(status);
}

function normalizeOpenAiStatus(status) {
  return String(status || "completed").toLowerCase();
}

function openAiErrorMessage(data) {
  if (typeof data.error === "string") return data.error;
  if (data.error?.message) return data.error.message;
  if (data.incomplete_details?.reason) return data.incomplete_details.reason;
  return "OpenAI could not finish the request.";
}

function formatElapsed(ms) {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (!minutes) return `${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function generateFirmwareForPlan(idea) {
  if (!state.plan) return;
  setStatus(els.transcriptBox, "Preparing the board software securely...", "warn");

  const payload = {
    model: settings.openaiReasoningModel,
    reasoning: { effort: settings.openaiReasoningEffort || DEFAULT_REASONING_EFFORT },
    input: [
      {
        role: "system",
        content:
          "You are Makeable's ESP32 firmware engineer. Generate a compact, compile-ready ESP32 Arduino-core C++ sketch from the provided hardware plan. Support ESP32-family targets only. Use only the libraries explicitly listed as available in the user prompt. Output only schema-valid JSON. Do not include markdown fences. Keep the sketch under 180 lines unless absolutely required.",
      },
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: buildFirmwarePrompt(idea, state.plan),
          },
        ],
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "esp32_firmware",
        strict: true,
        schema: firmwareSchema,
      },
    },
  };

  const data = await openAiResponse(payload, {
    label: "firmware",
    onProgress: ({ elapsedLabel, message }) => {
      setStatus(
        els.transcriptBox,
        message || `Still preparing the board software (${elapsedLabel}).`,
        "warn",
      );
    },
  });
  state.plan.firmware = normalizeFirmware(parseStructuredJson(data, "firmware"));
  const profile = selectBoardProfile(state.plan);
  if (!profile) throw new Error("The generated guide does not contain a supported ESP32 board.");
  setStatus(els.transcriptBox, "Checking the board software with the hosted ESP32 compiler...", "warn");
  state.compiledFirmware = await compileFirmwareWithAutomaticRepair(profile, {
    idea,
    onProgress(message) {
      setStatus(els.transcriptBox, message, "warn");
    },
  });
  setStatus(els.transcriptBox, "The guide and verified board software are ready.", "ok");
}

function buildFirmwarePrompt(idea, plan) {
  return [
    `Project idea: ${idea}`,
    "",
    "Hardware plan JSON:",
    JSON.stringify(
      {
        projectTitle: plan.projectTitle,
        summary: plan.summary,
        parts: plan.parts.map(({ id, name, type, confidence, role }) => ({
          id,
          name,
          type,
          confidence,
          role,
        })),
        wiringSteps: plan.wiringSteps,
        diagnosticTests: plan.diagnosticTests,
        firmwareSpec: plan.firmwareSpec,
        warnings: plan.warnings,
      },
      null,
      2,
    ),
    "",
    "Requirements:",
    "- Generate one complete ESP32 Arduino-core C++ sketch.",
    "- Include Serial.begin(115200).",
    "- Print CIRCUITCODEX_DIAGNOSTIC_READY in setup().",
    "- Print clear diagnostic markers matching the diagnostic tests.",
    "- Avoid unsafe boot pins unless the plan explicitly requires them.",
    "- If the hardware plan is uncertain, make the sketch conservative and explain the assumption in notes.",
    `- Use only these hosted compiler libraries: ${HOSTED_FIRMWARE_LIBRARIES.join(", ")}.`,
    "- Do not invent headers, packages, classes, methods, pin aliases, or APIs that are not supplied by those libraries.",
    "- Do not include markdown fences in the sketch string.",
  ].join("\n");
}

async function compileFirmwareWithAutomaticRepair(profile, options = {}) {
  let sketch = state.plan?.firmware?.sketch || "";
  try {
    return await compileFirmwareSketch(sketch, profile, options.onProgress);
  } catch (error) {
    const details = compilerFailureDetails(error);
    if (!details || !state.generationId) throw error;

    options.onProgress?.("The first version had a compiler issue. I’m repairing it automatically...");
    appendSerial("Makeable: The first code version needs a small repair. Fixing it automatically.\n");
    const repaired = await repairFirmwareForCompilerError({
      idea: options.idea || els.ideaText.value.trim(),
      profile,
      sketch,
      details,
      onProgress: options.onProgress,
    });
    state.plan.firmware = repaired;
    sketch = repaired.sketch;
    options.onProgress?.("The repair is ready. Verifying it with the ESP32 compiler...");
    try {
      return await compileFirmwareSketch(sketch, profile, options.onProgress);
    } catch (repairError) {
      console.error("Automatic firmware repair did not compile", repairError);
      throw new Error("The automatic code repair could not pass the ESP32 compiler. Please make the guide again.");
    }
  }
}

async function compileFirmwareSketch(sketch, profile, onProgress) {
  for (let attempt = 0; attempt <= COMPILE_BUSY_RETRY_ATTEMPTS; attempt += 1) {
    try {
      const compiled = await apiJson("/api/firmware/compile", {
        method: "POST",
        body: JSON.stringify({ sketch, boardProfile: profile.id }),
      });
      compiled.sourceSketch = sketch;
      return compiled;
    } catch (error) {
      const compilerIsBusy = Number(error?.status) === 429 && /compiler is busy/i.test(error.message);
      if (!compilerIsBusy || attempt === COMPILE_BUSY_RETRY_ATTEMPTS) throw error;
      const retryAfterMs = Math.max(1, Number(error.retryAfterSeconds) || 5) * 1000;
      const jitterMs = Math.round(Math.random() * 1200);
      onProgress?.("The compiler is helping another build. I’ll retry automatically...");
      await sleep(retryAfterMs + jitterMs);
    }
  }
  throw new Error("The hosted compiler stayed busy for too long. Please try again in a moment.");
}

function compilerFailureDetails(error) {
  if (Number(error?.status) !== 500) return "";
  return String(error?.apiData?.details || "").trim();
}

async function repairFirmwareForCompilerError({ idea, profile, sketch, details, onProgress }) {
  const payload = {
    model: settings.openaiReasoningModel,
    reasoning: { effort: settings.openaiReasoningEffort || DEFAULT_REASONING_EFFORT },
    input: [
      {
        role: "system",
        content:
          "You repair ESP32 Arduino-core C++ after a real compiler failure. Return a complete corrected sketch, not a patch. Preserve the intended behavior and pin assignments. Use only the explicitly available libraries. Resolve every reported diagnostic. Output only schema-valid JSON without markdown fences.",
      },
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: [
              `Project idea: ${idea || "ESP32 project"}`,
              `Target board profile: ${profile.id} (${profile.fqbn})`,
              `Available libraries: ${HOSTED_FIRMWARE_LIBRARIES.join(", ")}`,
              "",
              "Compiler diagnostic:",
              details,
              "",
              "Original sketch:",
              sketch,
              "",
              "Return the complete corrected firmware. Do not add a library that is not available.",
            ].join("\n"),
          },
        ],
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "esp32_firmware_repair",
        strict: true,
        schema: firmwareSchema,
      },
    },
  };
  const data = await openAiResponse(payload, {
    label: "firmware repair",
    onProgress: ({ elapsedLabel, message }) => {
      onProgress?.(message || `Repairing the board software (${elapsedLabel}).`);
    },
  });
  return normalizeFirmware(parseStructuredJson(data, "firmware repair"));
}

function normalizeFirmware(firmware) {
  return {
    language: firmware?.language || "ESP32 C++",
    sketch: String(firmware?.sketch || "").trim(),
    notes: firmware?.notes || "",
  };
}

function normalizePlan(plan) {
  const wiringSteps = Array.isArray(plan.wiringSteps) ? plan.wiringSteps.map(normalizeWiringStep) : [];
  const rawParts = Array.isArray(plan.parts) ? plan.parts : [];
  const firmwareSpec = plan.firmwareSpec || {
    board: "ESP32",
    behavior: plan.summary || "",
    libraries: [],
    pinAssignments: [],
    serialProtocol: [],
  };
  const projectParts = filterProjectParts(rawParts, wiringSteps, firmwareSpec, plan.summary || "");

  return {
    projectTitle: plan.projectTitle || "Makeable Build",
    summary: plan.summary || "",
    parts: projectParts.length ? projectParts : rawParts,
    warnings: Array.isArray(plan.warnings) ? plan.warnings : [],
    wiringSteps,
    diagnosticTests: Array.isArray(plan.diagnosticTests) ? plan.diagnosticTests : [],
    firmwareSpec,
    firmware: plan.firmware ? normalizeFirmware(plan.firmware) : null,
    readmeMarkdown: plan.readmeMarkdown || "",
  };
}

function filterProjectParts(parts, wiringSteps, firmwareSpec, summary) {
  if (!parts.length || !wiringSteps.length) return parts;

  const explicitRefs = new Set();
  const projectText = normalizeText(
    [
      summary,
      firmwareSpec?.behavior,
      ...(firmwareSpec?.pinAssignments || []).map((pin) => `${pin.label} ${pin.purpose}`),
      ...wiringSteps.map((step) => `${step.title} ${step.instruction} ${step.from} ${step.to} ${step.fromPartId} ${step.toPartId} ${step.pin}`),
    ].join(" "),
  );

  wiringSteps.forEach((step) => {
    [step.fromPartId, step.toPartId, step.from, step.to].forEach((value) => {
      const normalized = normalizeText(value);
      if (normalized) explicitRefs.add(normalized);
    });
  });

  return parts.filter((part) => {
    const id = normalizeText(part.id);
    const name = normalizeText(part.name);
    const type = normalizeText(part.type);
    const role = normalizeText(part.role);
    const partText = `${id} ${name} ${type} ${role}`.trim();

    if (/\b(unused|not used|not needed|unrelated|spare|ignore|optional)\b/.test(role)) return false;
    if (id && explicitRefs.has(id)) return true;
    if (name && explicitRefs.has(name)) return true;
    if (id && projectText.includes(id)) return true;
    if (name && projectText.includes(name)) return true;
    if (type && projectText.includes(type)) return true;
    if (/esp32|devkit|microcontroller|controller/.test(partText)) return true;
    if (/jumper|wire|dupont/.test(partText)) return true;
    if (/resistor|current limit/.test(partText) && /leds?|resistor|current limit/.test(projectText)) return true;
    if (/\bleds?\b|light/.test(partText) && /\bleds?\b|light|lamp|output/.test(projectText)) return true;
    if (/\bpir\b|motion/.test(partText) && /\bpir\b|motion|movement|nearby|presence/.test(projectText)) return true;
    if (/sensor/.test(partText) && /sensor|detect|nearby|motion|measure|input/.test(projectText)) return true;
    return false;
  });
}

function normalizeWiringStep(step, index) {
  return {
    order: Number.isFinite(step.order) ? step.order : index + 1,
    title: friendlyWiringText(step.title || `Connection ${index + 1}`),
    instruction: friendlyWiringText(step.instruction || ""),
    from: friendlyWiringText(step.from || ""),
    to: friendlyWiringText(step.to || ""),
    fromPartId: step.fromPartId || "",
    toPartId: step.toPartId || "",
    pin: step.pin || "",
    wireColor: step.wireColor || "",
    check: friendlyWiringText(step.check || ""),
  };
}

function validatePlan(plan) {
  const warnings = [];
  const avoidPins = new Set(["GPIO0", "GPIO2", "GPIO12", "GPIO15", "0", "2", "12", "15"]);
  for (const step of plan.wiringSteps || []) {
    const pin = String(step.pin || "").toUpperCase().replace(/\s+/g, "");
    if (avoidPins.has(pin)) {
      warnings.push(`Review ${friendlyWiringText(step.pin)}: it can affect ESP32 boot behavior on some boards.`);
    }
  }
  if (!plan.parts.some((part) => /esp32/i.test(part.name))) {
    warnings.push("No ESP32 was confidently identified in the image.");
  }
  return warnings;
}

function renderEmptyPlan() {
  const controls = getBuildStepControls();
  els.partsList.innerHTML = "";
  if (els.partsCountLabel) {
    els.partsCountLabel.textContent = "Waiting for a photo";
    els.partsCountLabel.classList.remove("has-parts");
  }
  els.wiringList.innerHTML = "";
  els.diagnosticsList.innerHTML = "";
  els.visualStepList.innerHTML = `<div class="visual-step-empty"><strong>Your guide will appear here</strong><span>Once I read the photo, I’ll show one clear move at a time.</span></div>`;
  restoreBuildStepControls(controls);
  if (els.buildStepCounter) els.buildStepCounter.textContent = "Move 0 of 0";
  if (els.buildStepDots) els.buildStepDots.innerHTML = "";
  if (els.prevBuildStepButton) els.prevBuildStepButton.disabled = true;
  if (els.nextBuildStepButton) els.nextBuildStepButton.disabled = true;
  renderCodeExplanation();
}

function renderPlan() {
  const plan = state.plan;
  if (!plan) return renderEmptyPlan();

  drawPartsCanvas();
  els.partsList.innerHTML = "";
  if (els.partsCountLabel) {
    els.partsCountLabel.textContent = `${plan.parts.length} ${plan.parts.length === 1 ? "part" : "parts"} found`;
    els.partsCountLabel.classList.toggle("has-parts", plan.parts.length > 0);
  }
  plan.parts.forEach((part, index) => {
    const row = document.createElement("div");
    row.className = `item-row item-row--tone-${index % 4}`;
    row.dataset.partNumber = String(index + 1);
    row.innerHTML = `<strong></strong><span></span>`;
    row.querySelector("strong").textContent = part.name;
    row.querySelector("span").textContent = `${part.role} · ${Math.round((part.confidence || 0) * 100)}% confidence`;
    els.partsList.append(row);
  });
  if (!plan.parts.length) renderEmptyPlan();

  els.wiringList.innerHTML = "";
  plan.wiringSteps.forEach((step) => {
    const item = document.createElement("li");
    item.innerHTML = `<strong></strong><span></span>`;
    item.querySelector("strong").textContent = `${step.order}. ${step.title}`;
    item.querySelector("span").textContent = `${step.instruction} Check: ${step.check}`;
    els.wiringList.append(item);
  });

  els.diagnosticsList.innerHTML = "";
  [...plan.diagnosticTests, ...plan.warnings.map(warningToDiagnostic)].forEach((check) => {
    const row = document.createElement("div");
    row.className = "item-row";
    row.innerHTML = `<strong></strong><span></span>`;
    row.querySelector("strong").textContent = check.name;
    row.querySelector("span").textContent = `${check.purpose} Expected: ${check.expectedSerial}`;
    els.diagnosticsList.append(row);
  });

  renderVisualSteps();
  renderCodeExplanation();
  state.readme = buildReadme();
  els.readmePreview.textContent = state.readme;
}

function warningToDiagnostic(warning) {
  return {
    name: "Warning",
    purpose: warning,
    userAction: "Review before wiring.",
    expectedSerial: "Manual review required.",
  };
}

function renderVisualSteps() {
  if (!els.visualStepList) return;
  const plan = state.plan;
  if (!plan?.wiringSteps?.length || !state.imageElement) {
    renderEmptyPlan();
    return;
  }

  const steps = plan.wiringSteps;
  const activeIndex = clamp(state.activeBuildStepIndex, 0, steps.length - 1);
  state.activeBuildStepIndex = activeIndex;
  const step = steps[activeIndex];

  const controls = getBuildStepControls();
  els.visualStepList.innerHTML = "";
  const card = document.createElement("div");
  card.className = "visual-step-card is-active";
  const canvas = document.createElement("canvas");
  const copy = document.createElement("div");
  copy.className = "visual-step-copy";
  const meta = document.createElement("p");
  const title = document.createElement("strong");
  const body = document.createElement("span");
  meta.className = "step-copy-kicker";
  title.className = "step-copy-title";
  body.className = "step-copy-instruction";
  meta.textContent = `Move ${step.order || activeIndex + 1} of ${steps.length}`;
  title.textContent = step.title || "Next connection";
  body.textContent = step.instruction;
  copy.append(meta, title, body);
  if (step.check) {
    const check = document.createElement("aside");
    const checkLabel = document.createElement("span");
    const checkText = document.createElement("p");
    check.className = "step-copy-tip";
    checkLabel.className = "step-copy-tip-label";
    checkText.className = "step-copy-tip-text";
    checkLabel.textContent = "Quick check";
    checkText.textContent = step.check;
    check.append(checkLabel, checkText);
    copy.append(check);
  }
  if (controls) {
    controls.classList.add("is-inline");
    copy.append(controls);
  }
  card.append(canvas, copy);
  els.visualStepList.append(card);

  if (els.buildStepCounter) els.buildStepCounter.textContent = `Move ${activeIndex + 1} of ${steps.length}`;
  renderBuildStepDots(steps.length, activeIndex);
  if (els.prevBuildStepButton) els.prevBuildStepButton.disabled = activeIndex === 0;
  if (els.nextBuildStepButton) {
    els.nextBuildStepButton.disabled = false;
    els.nextBuildStepButton.textContent = activeIndex === steps.length - 1 ? "Connect & load" : "I connected it";
  }

  requestAnimationFrame(() => drawVisualStep(canvas, step, activeIndex));
}

function getBuildStepControls() {
  return document.querySelector("#plan .carousel-controls");
}

function restoreBuildStepControls(controls = getBuildStepControls()) {
  const panel = document.querySelector("#plan .visual-guide-panel");
  if (!controls || !panel) return;
  controls.classList.remove("is-inline");
  panel.append(controls);
}

function renderBuildStepDots(count, activeIndex) {
  if (!els.buildStepDots) return;
  els.buildStepDots.innerHTML = "";
  for (let index = 0; index < count; index += 1) {
    const dot = document.createElement("button");
    dot.type = "button";
    dot.className = index === activeIndex ? "is-active" : "";
    dot.setAttribute("aria-label", `Go to build step ${index + 1}`);
    dot.addEventListener("click", () => setActiveBuildStep(index));
    els.buildStepDots.append(dot);
  }
}

function setActiveBuildStep(index) {
  const count = state.plan?.wiringSteps?.length || 0;
  if (!count) return;
  state.activeBuildStepIndex = clamp(index, 0, count - 1);
  renderVisualSteps();
}

function advanceBuildStep() {
  const count = state.plan?.wiringSteps?.length || 0;
  if (!count) return;
  if (state.activeBuildStepIndex >= count - 1) {
    setBuildMode("code");
    return;
  }
  setActiveBuildStep(state.activeBuildStepIndex + 1);
}

function setBuildMode(mode) {
  const showCode = mode === "code";
  if (els.wiringWorkspace) els.wiringWorkspace.hidden = showCode;
  if (els.codeWorkspace) els.codeWorkspace.hidden = !showCode;
  els.showWiringButton?.classList.toggle("is-active", !showCode);
  els.showCodeButton?.classList.toggle("is-active", showCode);
  els.showWiringButton?.setAttribute("aria-selected", String(!showCode));
  els.showCodeButton?.setAttribute("aria-selected", String(showCode));
  if (!showCode) requestAnimationFrame(renderVisualSteps);
}

function drawVisualStep(canvas, step, index) {
  const prepared = prepareCanvas(canvas);
  const { ctx, width, height } = prepared;
  const fit = drawImageCanvasBase(ctx, width, height);
  if (!fit || !state.plan?.parts?.length) return;

  const parts = state.plan.parts;
  const fromPart = findStepPart(step.fromPartId || step.from, step, parts, "from");
  const toPart = findStepPart(step.toPartId || step.to, step, parts, "to");
  const color = stepColor(step.wireColor, index);
  const placedBadges = [];
  let connector = null;

  ctx.save();
  ctx.fillStyle = "rgba(99, 102, 241, 0.08)";
  ctx.fillRect(fit.x, fit.y, fit.width, fit.height);
  ctx.restore();

  if (fromPart) drawStepPartFrame(ctx, fit, fromPart, "#4f46e5");
  if (toPart && toPart !== fromPart) drawStepPartFrame(ctx, fit, toPart, color);

  if (fromPart && toPart && fromPart !== toPart) {
    const fromBox = partBox(fromPart, fit);
    const toBox = partBox(toPart, fit);
    const fromCenter = rectCenter(fromBox);
    const toCenter = rectCenter(toBox);
    const fromPoint = pointOnRectEdge(fromBox, toCenter);
    const toPoint = pointOnRectEdge(toBox, fromCenter);
    connector = drawArrow(ctx, fromPoint.x, fromPoint.y, toPoint.x, toPoint.y, color, {
      bounds: fit,
      fromOutward: { x: fromPoint.x - fromCenter.x, y: fromPoint.y - fromCenter.y },
      toOutward: { x: toPoint.x - toCenter.x, y: toPoint.y - toCenter.y },
      obstacles: parts
        .filter((part) => part !== fromPart && part !== toPart)
        .map((part) => partBox(part, fit)),
    });
  }

  if (fromPart) drawStepPartLabel(ctx, fit, fromPart, "#4f46e5", placedBadges);
  if (toPart && toPart !== fromPart) drawStepPartLabel(ctx, fit, toPart, color, placedBadges);

  if (fromPart && toPart && fromPart !== toPart) {
    const fromCenter = partCenter(fromPart, fit);
    const toCenter = partCenter(toPart, fit);
    const labelPoint = connector?.labelPoint || {
      x: (fromCenter.x + toCenter.x) / 2,
      y: (fromCenter.y + toCenter.y) / 2,
    };
    drawPlacedStepBadge(
      ctx,
      cleanPinLabel(step.pin || "wire", `${step.instruction || ""} ${step.from || ""} ${step.to || ""}`),
      anchorBox(labelPoint.x, labelPoint.y),
      fit,
      color,
      placedBadges,
    );
  } else {
    drawPlacedStepBadge(
      ctx,
      cleanPinLabel(step.pin || step.from || "wire"),
      anchorBox(fit.x + fit.width / 2, fit.y + 28),
      fit,
      color,
      placedBadges,
    );
  }
}

function prepareCanvas(canvas) {
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(280, rect.width || 520);
  const height = Math.max(180, rect.height || width * 0.625);
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  return { ctx, width, height };
}

function drawImageCanvasBase(ctx, width, height) {
  ctx.fillStyle = "#f8fafc";
  ctx.fillRect(0, 0, width, height);
  drawGrid(ctx, width, height);
  if (!state.imageElement) return null;

  const img = state.imageElement;
  const scale = Math.min(width / img.naturalWidth, height / img.naturalHeight);
  const drawWidth = img.naturalWidth * scale;
  const drawHeight = img.naturalHeight * scale;
  const x = (width - drawWidth) / 2;
  const y = (height - drawHeight) / 2;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, x, y, drawWidth, drawHeight);
  return { x, y, width: drawWidth, height: drawHeight };
}

function findStepPart(reference, step, parts, side) {
  const direct = matchPart(reference, parts);
  if (direct) return direct;
  const sideText = side === "from" ? step.from : step.to;
  const textMatch = matchPart(sideText, parts);
  if (textMatch) return textMatch;

  const allText = `${step.title} ${step.instruction} ${step.from} ${step.to}`.toLowerCase();
  if (side === "from") {
    return parts.find((part) => /esp32|devkit|microcontroller/.test(`${part.id} ${part.name} ${part.type}`.toLowerCase())) || null;
  }
  return (
    parts.find((part) => {
      const key = normalizeText(`${part.id} ${part.name} ${part.type}`);
      return key && allText.includes(key.split(" ")[0]);
    }) || null
  );
}

function matchPart(reference, parts) {
  const ref = normalizeText(reference || "");
  if (!ref) return null;
  return (
    parts.find((part) => normalizeText(part.id) === ref) ||
    parts.find((part) => ref.includes(normalizeText(part.id)) || normalizeText(part.name).includes(ref)) ||
    parts.find((part) => ref.includes(normalizeText(part.name)) || normalizeText(part.name).includes(ref.split(" ")[0]))
  );
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function partBox(part, fit) {
  const bbox = normalizeBbox(part.bbox, 0, 1);
  return {
    x: fit.x + (bbox.x / 100) * fit.width,
    y: fit.y + (bbox.y / 100) * fit.height,
    width: (bbox.width / 100) * fit.width,
    height: (bbox.height / 100) * fit.height,
  };
}

function partCenter(part, fit) {
  const box = partBox(part, fit);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

function drawStepPartFrame(ctx, fit, part, color) {
  const box = partBox(part, fit);
  ctx.save();
  roundedRectPath(ctx, box, 12);
  ctx.fillStyle = "rgba(99, 102, 241, 0.1)";
  ctx.fill();
  ctx.strokeStyle = "rgba(255, 255, 255, 0.88)";
  ctx.lineWidth = 8;
  ctx.stroke();
  roundedRectPath(ctx, box, 12);
  ctx.strokeStyle = color;
  ctx.lineWidth = 3.5;
  ctx.stroke();
  ctx.restore();
}

function drawStepPartLabel(ctx, fit, part, color, placedBadges) {
  const box = partBox(part, fit);
  drawPlacedStepBadge(ctx, shortPartLabel(part.name), box, fit, color, placedBadges);
}

function drawArrow(ctx, fromX, fromY, toX, toY, color, options = {}) {
  const curve = curvedArrowGeometry({ x: fromX, y: fromY }, { x: toX, y: toY }, options);
  const angle = Math.atan2(toY - curve.control2.y, toX - curve.control2.x);
  const headLength = 18;
  const drawCurve = () => {
    ctx.beginPath();
    ctx.moveTo(curve.start.x, curve.start.y);
    ctx.bezierCurveTo(
      curve.control1.x,
      curve.control1.y,
      curve.control2.x,
      curve.control2.y,
      curve.end.x,
      curve.end.y,
    );
    ctx.stroke();
  };

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
  ctx.lineWidth = 12;
  drawCurve();
  ctx.strokeStyle = color;
  ctx.lineWidth = 5;
  drawCurve();

  ctx.beginPath();
  ctx.arc(fromX, fromY, 6, 0, Math.PI * 2);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(toX, toY);
  ctx.lineTo(toX - headLength * Math.cos(angle - Math.PI / 6), toY - headLength * Math.sin(angle - Math.PI / 6));
  ctx.lineTo(toX - headLength * Math.cos(angle + Math.PI / 6), toY - headLength * Math.sin(angle + Math.PI / 6));
  ctx.closePath();
  ctx.strokeStyle = "rgba(255, 255, 255, 0.95)";
  ctx.lineWidth = 7;
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();
  return curve;
}

function anchorBox(centerX, centerY) {
  return {
    x: centerX - 3,
    y: centerY - 3,
    width: 6,
    height: 6,
  };
}

function roundedRectPath(ctx, rect, radius = 10) {
  const corner = Math.max(0, Math.min(radius, rect.width / 2, rect.height / 2));
  ctx.beginPath();
  ctx.moveTo(rect.x + corner, rect.y);
  ctx.lineTo(rect.x + rect.width - corner, rect.y);
  ctx.quadraticCurveTo(rect.x + rect.width, rect.y, rect.x + rect.width, rect.y + corner);
  ctx.lineTo(rect.x + rect.width, rect.y + rect.height - corner);
  ctx.quadraticCurveTo(
    rect.x + rect.width,
    rect.y + rect.height,
    rect.x + rect.width - corner,
    rect.y + rect.height,
  );
  ctx.lineTo(rect.x + corner, rect.y + rect.height);
  ctx.quadraticCurveTo(rect.x, rect.y + rect.height, rect.x, rect.y + rect.height - corner);
  ctx.lineTo(rect.x, rect.y + corner);
  ctx.quadraticCurveTo(rect.x, rect.y, rect.x + corner, rect.y);
  ctx.closePath();
}

function drawPlacedStepBadge(ctx, text, anchor, fit, color, placedBadges = []) {
  const safeText = String(text || "").slice(0, 18);
  ctx.save();
  ctx.font = "800 13px Inter, system-ui, sans-serif";
  const width = Math.min(ctx.measureText(safeText).width + 18, 150);
  const height = 28;
  const rect = placeAnnotationLabel(anchor, width, height, fit, placedBadges);
  placedBadges.push(rect);
  drawLabelLeader(ctx, rect, anchor, color);
  const paleBadge = color === "#ffffff" || color === "#e5e7eb" || color === "#f5f5f5" || color === "#f8fafc";
  roundedRectPath(ctx, rect, 7);
  ctx.shadowColor = "rgba(15, 23, 42, 0.22)";
  ctx.shadowBlur = 7;
  ctx.shadowOffsetY = 2;
  ctx.fillStyle = paleBadge ? "rgba(255,255,255,0.92)" : color;
  ctx.fill();
  ctx.shadowColor = "transparent";
  ctx.strokeStyle = "rgba(255, 255, 255, 0.86)";
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.fillStyle = paleBadge ? "#0f172a" : "#fff";
  ctx.fillText(safeText, rect.x + 9, rect.y + 18, rect.width - 18);
  ctx.restore();
  return rect;
}

function stepColor(value, index) {
  const palette = ["#ef2d83", "#5169df", "#11100f", "#27a88a", "#8c76dc", "#f04e3e"];
  const normalized = String(value || "").toLowerCase();
  if (normalized.includes("red")) return "#ef4444";
  if (normalized.includes("black")) return "#111827";
  if (normalized.includes("yellow")) return "#ca8a04";
  if (normalized.includes("blue")) return "#2563eb";
  if (normalized.includes("green")) return "#16a34a";
  return palette[index % palette.length];
}

async function startVoiceCapture() {
  if (!navigator.mediaDevices?.getUserMedia) {
    setVoiceStatus("Mic unavailable", "danger");
    return;
  }

  setVoiceStatus("Getting ready", "warn");
  els.startVoiceButton.disabled = true;
  els.stopVoiceButton.disabled = false;

  try {
    const accessToken = await getAccessToken();
    const apiBase = String(serverConfig.apiBaseUrl || window.location.origin).replace(/\/$/, "");
    const url = new URL(`${apiBase}/api/deepgram/listen`);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.searchParams.set("model", "nova-3");
    url.searchParams.set("smart_format", "true");
    url.searchParams.set("interim_results", "true");
    url.searchParams.set("endpointing", "500");
    url.searchParams.set("utterance_end_ms", "1000");
    url.searchParams.set("vad_events", "true");

    state.deepgramSocket = new WebSocket(url, ["makeable", accessToken]);
    state.deepgramSocket.onopen = async () => {
      state.voiceStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm";
      state.voiceRecorder = new MediaRecorder(state.voiceStream, { mimeType });
      state.voiceRecorder.ondataavailable = async (event) => {
        if (event.data.size && state.deepgramSocket?.readyState === WebSocket.OPEN) {
          state.deepgramSocket.send(await event.data.arrayBuffer());
        }
      };
      state.voiceRecorder.start(250);
      setVoiceStatus("Listening", "ok");
    };
    state.deepgramSocket.onmessage = (message) => handleDeepgramMessage(message.data);
    state.deepgramSocket.onerror = () => setVoiceStatus("Voice paused", "danger");
    state.deepgramSocket.onclose = () => {
      if (els.stopVoiceButton.disabled === false) setVoiceStatus("Stopped", "warn");
    };
  } catch (error) {
    console.error(error);
    setVoiceStatus(error.message, "danger");
    stopVoiceCapture();
  }
}

function handleDeepgramMessage(raw) {
  let message;
  try {
    message = JSON.parse(raw);
  } catch {
    return;
  }
  if (message.type !== "Results") return;
  const transcript = message.channel?.alternatives?.[0]?.transcript || "";
  if (!transcript) return;

  if (message.is_final || message.speech_final) {
    state.finalTranscript = [state.finalTranscript, transcript].filter(Boolean).join(" ").trim();
    state.interimTranscript = "";
    els.ideaText.value = [els.ideaText.value.trim(), transcript].filter(Boolean).join(" ").trim();
  } else {
    state.interimTranscript = transcript;
  }
  els.transcriptBox.textContent = [state.finalTranscript, state.interimTranscript]
    .filter(Boolean)
    .join(" ");
  if (els.voiceTranscriptBox) {
    els.voiceTranscriptBox.textContent = [state.finalTranscript, state.interimTranscript]
      .filter(Boolean)
      .join(" ");
  }
}

function stopVoiceCapture() {
  try {
    if (state.deepgramSocket?.readyState === WebSocket.OPEN) {
      state.deepgramSocket.send(JSON.stringify({ type: "Finalize" }));
      state.deepgramSocket.send(JSON.stringify({ type: "CloseStream" }));
    }
  } catch {
    // Best effort finalization.
  }
  state.voiceRecorder?.stop();
  state.voiceStream?.getTracks().forEach((track) => track.stop());
  state.deepgramSocket?.close();
  state.voiceRecorder = null;
  state.voiceStream = null;
  state.deepgramSocket = null;
  els.startVoiceButton.disabled = false;
  els.stopVoiceButton.disabled = true;
  setVoiceStatus("Ready", "");
}

function setVoiceStatus(text, tone) {
  els.voiceStatus.textContent = text;
  els.voiceStatus.className = `status-pill ${tone || ""}`.trim();
}

async function connectSerial(options = {}) {
  if (!("serial" in navigator)) {
    setStatus(els.logEvaluation, "This browser can’t listen to the board. Use Chrome or Edge on desktop.", "danger");
    return;
  }
  if (state.serialPort) return;

  try {
    if (options.automatic) {
      const [grantedPort] = await navigator.serial.getPorts();
      if (!grantedPort) {
        setStatus(els.logEvaluation, "Click Listen to board once so the browser can reconnect to your ESP32.", "warn");
        return;
      }
      state.serialPort = grantedPort;
    } else {
      state.serialPort = await findOrRequestEspPort();
    }
    await state.serialPort.open({ baudRate: Number(els.baudRateInput.value) || 115200 });
    els.connectSerialButton.disabled = true;
    els.disconnectSerialButton.disabled = false;
    els.sendSerialButton.disabled = false;
    appendSerial("Makeable: I’m listening now. If the board speaks, you’ll see it here.\n");
    setStatus(els.logEvaluation, "Connected. Waiting for the board to say something.", "ok");
    readSerialLoop();
  } catch (error) {
    console.error(error);
    setStatus(els.logEvaluation, `I couldn’t connect yet: ${error.message}`, "danger");
  }
}

async function readSerialLoop() {
  const decoder = new TextDecoderStream();
  state.serialReadableClosed = state.serialPort.readable.pipeTo(decoder.writable).catch(() => {});
  const reader = decoder.readable.getReader();
  state.serialReader = reader;

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) appendSerial(value);
    }
  } catch (error) {
    appendSerial(`\n[serial read stopped] ${error.message}\n`);
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // The port may already have released the reader while disconnecting.
    }
    if (state.serialReader === reader) state.serialReader = null;
  }
}

async function disconnectSerial() {
  const reader = state.serialReader;
  const readableClosed = state.serialReadableClosed;
  const port = state.serialPort;
  state.serialReader = null;
  state.serialReadableClosed = null;
  state.serialPort = null;

  try {
    await reader?.cancel();
  } catch (error) {
    if (!/released|closed|lock/i.test(String(error?.message || error))) console.warn(error);
  }
  try {
    await readableClosed;
  } catch {
    // The pipe normally rejects when a USB serial device changes modes.
  }
  try {
    await port?.close();
  } catch (error) {
    if (!/closed|forgotten|lost/i.test(String(error?.message || error))) console.warn(error);
  }
  els.connectSerialButton.disabled = false;
  els.disconnectSerialButton.disabled = true;
  els.sendSerialButton.disabled = true;
  appendSerial("Makeable: I stopped listening to the board.\n");
  setStatus(els.logEvaluation, "Listening paused. The board can stay connected over USB.", "warn");
}

async function sendSerialCommand() {
  const command = els.serialCommandInput.value;
  if (!state.serialPort || !command) return;

  const writer = state.serialPort.writable.getWriter();
  try {
    await writer.write(new TextEncoder().encode(`${command}\n`));
    appendSerial(`> ${command}\n`);
    els.serialCommandInput.value = "";
  } finally {
    writer.releaseLock();
  }
}

function appendSerial(text) {
  if (els.serialLog.textContent === "Board messages will appear here after you connect.") {
    els.serialLog.textContent = "";
  }
  state.serialLog += text;
  if (state.serialLog.length > 25000) state.serialLog = state.serialLog.slice(-25000);
  els.serialLog.textContent = state.serialLog;
  els.serialLog.scrollTop = els.serialLog.scrollHeight;
}

function evaluateSerialLogs() {
  const log = state.serialLog.trim();
  if (!log) {
    setStatus(els.logEvaluation, "Nothing from the board yet. Try pressing reset on the ESP32.", "warn");
    return;
  }

  const bad = /(error|failed|fail|nan|timeout|brownout|invalid|panic|rst:0x10)/i.test(log);
  const expected = state.plan?.diagnosticTests || [];
  const hits = expected.filter((test) => {
    const token = String(test.expectedSerial || "").split(/\s+/)[0];
    return token && log.includes(token);
  });

  if (bad) {
    setStatus(els.logEvaluation, "Something looks off. I see words that usually mean the board is stuck or unhappy.", "danger");
  } else if (expected.length && hits.length >= Math.max(1, Math.ceil(expected.length / 2))) {
    setStatus(els.logEvaluation, "This looks good. The board is saying the things we expected.", "ok");
  } else if (/ready|ok|pass|sensor|boot|connected/i.test(log)) {
    setStatus(els.logEvaluation, "Good sign. The board is awake and talking.", "ok");
  } else {
    setStatus(els.logEvaluation, "I can hear the board, but I’m not sure yet. Try the action your project is meant to react to.", "warn");
  }
}

function renderCodeExplanation() {
  if (!els.behaviorSummary || !els.codeFunctionList) return;
  const plan = state.plan;
  if (!plan) {
    els.behaviorSummary.textContent = "Create your guide first, then I’ll explain the behavior here.";
    els.codeFunctionList.innerHTML = "";
    return;
  }

  const spec = plan.firmwareSpec || {};
  const explanationProject = {
    idea: els.ideaText.value.trim(),
    summary: plan.summary,
    behavior: spec.behavior,
    pinAssignments: spec.pinAssignments || [],
    serialProtocol: spec.serialProtocol || [],
  };
  const behavior = explainProjectForChild(explanationProject);
  els.behaviorSummary.textContent = state.lastBehaviorChange
    ? `${behavior} Your latest change: ${compactSentence(state.lastBehaviorChange)}`
    : behavior;

  const functions = [
    {
      name: "When it turns on",
      description: explainStartupForChild(explanationProject),
    },
    {
      name: "While it is running",
      description: explainRunningForChild(explanationProject),
    },
    {
      name: "What the messages mean",
      description: explainMessagesForChild(explanationProject),
    },
  ];

  els.codeFunctionList.innerHTML = "";
  functions.forEach((item) => {
    const row = document.createElement("li");
    const name = document.createElement("strong");
    const description = document.createElement("span");
    name.textContent = item.name;
    description.textContent = item.description;
    row.append(name, description);
    els.codeFunctionList.append(row);
  });
}

async function applyBehaviorChange(event) {
  event.preventDefault();
  const change = els.behaviorChangeInput.value.trim();
  if (!change) {
    els.behaviorChangeInput.focus();
    setStatus(els.behaviorChangeStatus, "Describe the small change you want first.", "warn");
    return;
  }
  if (!state.plan?.firmware?.sketch) {
    setStatus(els.behaviorChangeStatus, "Create and load the first version before changing its behavior.", "warn");
    return;
  }

  await refreshServerConfig();
  if (!serverConfig.hasOpenAIKey) {
    setStatus(els.behaviorChangeStatus, "I can’t reach the code generator yet. Try again in a moment.", "danger");
    return;
  }

  els.applyBehaviorChangeButton.disabled = true;
  els.behaviorChangeInput.disabled = true;
  setStatus(els.behaviorChangeStatus, "Updating the behavior and checking the new code...", "warn");
  stopFlashSuccessTransition({ hide: true });
  closeBehaviorTuneDialog();
  setActiveWorkflowStage(2);
  setBuildMode("code");
  setStatus(els.esp32Status, "Updating the behavior you requested. I’ll reload the board next.", "warn");
  state.generationId = crypto.randomUUID();

  try {
    await regenerateFirmwareForBehaviorChange(change);
    await refreshAccount();
    state.pendingBehaviorChange = change;
    setStatus(els.behaviorChangeStatus, "The update is ready. Reloading it onto your board now...", "warn");
    setStatus(els.esp32Status, "The updated code passed its check. Reconnecting to your ESP32...", "ok");
    const flashed = await compileAndFlashFirmware();
    if (!flashed) {
      setStatus(
        els.behaviorChangeStatus,
        "The updated code is ready, but it did not load. Use Connect & load automatically to retry.",
        "warn",
      );
    }
  } catch (error) {
    console.error(error);
    setStatus(els.esp32Status, `I couldn’t prepare that update: ${error.message}`, "danger");
    setStatus(els.behaviorChangeStatus, `I couldn’t apply that change: ${error.message}`, "danger");
  } finally {
    els.applyBehaviorChangeButton.disabled = false;
    els.behaviorChangeInput.disabled = false;
  }
}

async function regenerateFirmwareForBehaviorChange(change) {
  const profile = selectBoardProfile(state.plan);
  if (!profile) throw new Error("This build does not contain a supported ESP32 board.");
  const currentSketch = state.plan.firmware.sketch;
  const payload = {
    model: settings.openaiReasoningModel,
    reasoning: { effort: settings.openaiReasoningEffort || DEFAULT_REASONING_EFFORT },
    input: [
      {
        role: "system",
        content:
          "You update an existing ESP32 Arduino-core C++ sketch for a beginner. Make only the requested behavior change. Preserve the existing board, wiring, pin assignments, safety choices, diagnostic markers, and supported libraries. Return one complete compile-ready sketch, not a patch. Output only schema-valid JSON without markdown fences.",
      },
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: [
              `Original project goal: ${els.ideaText.value.trim() || state.plan.summary}`,
              `Requested behavior change: ${change}`,
              `Target board: ${profile.id} (${profile.fqbn})`,
              `Available libraries: ${HOSTED_FIRMWARE_LIBRARIES.join(", ")}`,
              "",
              "Hardware and behavior contract:",
              JSON.stringify(
                {
                  projectTitle: state.plan.projectTitle,
                  summary: state.plan.summary,
                  firmwareSpec: state.plan.firmwareSpec,
                  diagnosticTests: state.plan.diagnosticTests,
                  warnings: state.plan.warnings,
                },
                null,
                2,
              ),
              "",
              "Current complete sketch:",
              currentSketch,
              "",
              "Return the complete updated firmware. Keep Serial.begin(115200) and CIRCUITCODEX_DIAGNOSTIC_READY.",
            ].join("\n"),
          },
        ],
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "esp32_behavior_update",
        strict: true,
        schema: firmwareSchema,
      },
    },
  };

  const data = await openAiResponse(payload, {
    label: "behavior update",
    onProgress: ({ elapsedLabel, message }) => {
      setStatus(
        els.esp32Status,
        message || `Still updating the board behavior (${elapsedLabel}). Keep this tab open.`,
        "warn",
      );
    },
  });
  state.plan.firmware = normalizeFirmware(parseStructuredJson(data, "behavior update"));
  state.compiledFirmware = await compileFirmwareWithAutomaticRepair(profile, {
    idea: `${els.ideaText.value.trim() || state.plan.summary}. Requested change: ${change}`,
    onProgress(message) {
      setStatus(els.esp32Status, message, "warn");
    },
  });
}

function compactSentence(value, maxLength = 280) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1).trimEnd()}…`;
}

async function refreshEsp32Status() {
  try {
    const status = await apiJson("/api/esp32/status");
    const tone = status.hasEsp32Compiler && status.hasEsp32Core ? "ok" : "warn";
    setStatus(
      els.esp32Status,
      status.hasEsp32Compiler && status.hasEsp32Core
        ? "Makeable’s ESP32 compiler is ready. Connect your board when you’re ready."
        : "The ESP32 compiler is warming up. Try again in a moment.",
      tone,
    );
    els.compileFlashButton.disabled = !(status.hasEsp32Compiler && status.hasEsp32Core);
  } catch (error) {
    setStatus(els.esp32Status, `The ESP32 compiler is not ready yet: ${error.message}`, "danger");
    els.compileFlashButton.disabled = true;
  }
}

async function compileAndFlashFirmware() {
  stopFlashSuccessTransition({ hide: true });
  const sketch = state.plan?.firmware?.sketch || "";
  if (!sketch) {
    setStatus(els.esp32Status, "Create the guide first, then I’ll have firmware to send.", "warn");
    return false;
  }

  const profile = selectBoardProfile(state.plan);
  if (!profile) {
    setStatus(els.esp32Status, "Makeable supports ESP32-family boards only. Add an ESP32 to this build.", "danger");
    return false;
  }

  if (!("serial" in navigator)) {
    setStatus(els.esp32Status, "This browser can’t talk to the ESP32. Use Chrome or Edge on desktop.", "danger");
    return false;
  }

  els.compileFlashButton.disabled = true;
  els.compileFlashButton.textContent = "Connecting...";
  setFlashProgress(0, "Finding your board");

  let port;
  try {
    if (state.serialPort) await disconnectSerial();
    port = await findOrRequestEspPort();
  } catch (error) {
    els.compileFlashButton.disabled = false;
    els.compileFlashButton.textContent = "Connect & load automatically";
    setStatus(els.esp32Status, `No problem. Choose the ESP32 again when you’re ready. ${error.message}`, "warn");
    setFlashProgress(0, "");
    return false;
  }

  let flashed = false;
  try {
    els.compileFlashButton.textContent = "Preparing code...";
    setStatus(els.esp32Status, "I’m preparing firmware for your ESP32.", "warn");
    appendSerial("\nMakeable: Preparing the code for your board.\n");

    const compiled =
      state.compiledFirmware?.board === profile.id && state.compiledFirmware?.sourceSketch === sketch
        ? state.compiledFirmware
        : await compileFirmwareWithAutomaticRepair(profile, {
            onProgress(message) {
              setStatus(els.esp32Status, message, "warn");
            },
          });
    state.compiledFirmware = compiled;
    appendSerial("Makeable: Code is ready. Now I’m sending it to the board.\n");
    if (compiled.stderr) appendSerial(`Makeable: Setup note from the compiler:\n${compiled.stderr}\n`);

    els.compileFlashButton.textContent = "Loading board...";
    const testAdapter = globalThis.__MAKEABLE_FLASH_TEST_ADAPTER__;
    if (typeof testAdapter === "function") await testAdapter({ port, images: compiled.images, profile });
    else await flashFirmwareImages(port, compiled.images);
    setStatus(els.esp32Status, "Done. The firmware is on your ESP32. Opening Test now so you can watch it work.", "ok");
    setFlashProgress(100, "Done");
    flashed = true;
    if (state.pendingBehaviorChange) {
      state.lastBehaviorChange = state.pendingBehaviorChange;
      state.pendingBehaviorChange = "";
      els.behaviorChangeInput.value = "";
      setStatus(els.behaviorChangeStatus, `Loaded your change: ${state.lastBehaviorChange}`, "ok");
      renderCodeExplanation();
      state.readme = buildReadme();
      els.readmePreview.textContent = state.readme;
    }
    startFlashSuccessTransition();
  } catch (error) {
    console.error(error);
    appendSerial(`\nMakeable: I couldn’t finish loading the board. ${error.message}\n`);
    setStatus(els.esp32Status, `I couldn’t finish loading the ESP32: ${error.message}`, "danger");
    setFlashProgress(0, "Needs retry");
  } finally {
    els.compileFlashButton.disabled = false;
    els.compileFlashButton.textContent = "Connect & load automatically";
  }
  return flashed;
}

async function findOrRequestEspPort() {
  const granted = await navigator.serial.getPorts();
  return granted[0] || navigator.serial.requestPort({ filters: USB_SERIAL_FILTERS });
}

async function flashFirmwareImages(port, images) {
  if (!images?.length) throw new Error("No firmware images were returned from the compiler.");

  const esptool = await import("https://unpkg.com/esptool-js@0.5.7/bundle.js");
  const transport = new esptool.Transport(port, true);
  const terminal = {
    clean() {
      appendSerial("\nMakeable: Starting a fresh board load.\n");
    },
    writeLine(data) {
      appendSerial(`Board loader: ${data}\n`);
    },
    write(data) {
      appendSerial(`Board loader: ${data}`);
    },
  };

  try {
    const esploader = new esptool.ESPLoader({
      transport,
      baudrate: 115200,
      terminal,
      debugLogging: false,
    });
    appendSerial("Makeable: Looking for the ESP32. If it waits here, hold BOOT on the board for a moment.\n");
    const chip = await esploader.main("default_reset");
    appendSerial(`Makeable: Found the board (${chip}).\n`);

    const fileArray = images.map((image) => ({
      data: base64ToBinaryString(image.dataBase64),
      address: image.address,
    }));
    appendSerial("Makeable: Sending the code now.\n");
    await esploader.writeFlash({
      fileArray,
      flashMode: "dio",
      flashFreq: "40m",
      flashSize: "4MB",
      eraseAll: true,
      compress: true,
      reportProgress: (fileIndex, written, total) => {
        const percent = total ? Math.round((written / total) * 100) : 0;
        const image = images[fileIndex] || images[0];
        setFlashProgress(percent, `${image?.name || "image"} ${percent}%`);
      },
    });
    await esploader.after("hard_reset");
    appendSerial("Makeable: Board restarted with the new code.\n");
  } finally {
    await transport.disconnect();
  }
}

function base64ToBinaryString(base64) {
  return atob(base64);
}

function setFlashProgress(percent, label) {
  els.flashProgressBar.style.width = `${clamp(percent, 0, 100)}%`;
  els.flashProgressBar.textContent = label || "";
}

function buildReadme() {
  const plan = state.plan;
  if (!plan) return "Create your guide first, then I’ll write the project notes here.";
  const generated = new Date().toISOString();
  const firmwareNotes = plan.firmware?.notes || "Review all wiring before powering the board.";
  const parts = plan.parts.map((part) => `- ${part.name}: ${part.role}`).join("\n");
  const wiring = plan.wiringSteps
    .map((step) => `${step.order}. ${step.title}: ${step.instruction}`)
    .join("\n");
  const checks = plan.diagnosticTests
    .map((test) => `- ${test.name}: ${test.userAction} Expected serial: \`${test.expectedSerial}\``)
    .join("\n");
  const warnings = plan.warnings.length
    ? `\n## Warnings\n\n${plan.warnings.map((warning) => `- ${warning}`).join("\n")}\n`
    : "";
  const behaviorChange = state.lastBehaviorChange
    ? `\n## Latest behavior change\n\n${state.lastBehaviorChange}\n`
    : "";

  return `# ${plan.projectTitle}

Generated by Makeable on ${generated}.

## Idea

${els.ideaText.value.trim() || plan.summary}

## Parts

${parts || "- Parts pending."}

## Wiring

${wiring || "Wiring pending."}

## Diagnostic Checks

${checks || "- Diagnostics pending."}
${warnings}
## Board software

Makeable securely prepares and loads the board software from the browser. No source-code download or desktop IDE is required.
${behaviorChange}
## Notes

${firmwareNotes}
`;
}

async function publishToGitHub() {
  const repoName = sanitizeRepoName(els.repoNameInput.value || "makeable-build");
  const isPrivate = els.privateRepoInput.checked;
  if (!state.plan) {
    setStatus(els.githubStatus, "Create the guide first, then I can save the project notes.", "warn");
    return;
  }
  state.readme = state.readme || buildReadme();
  els.githubStatus.textContent = "Creating a home for your project...";
  els.publishGithubButton.disabled = true;

  try {
    let owner = settings.githubOwner;
    try {
      const repo = await apiJson("/api/github/repos", {
        method: "POST",
        body: JSON.stringify({
          name: repoName,
          description: "Hardware project generated with Makeable",
          private: isPrivate,
        }),
      });
      owner = repo.owner?.login || owner;
    } catch (error) {
      if (!String(error.message).includes("422") || !owner) throw error;
      els.githubStatus.textContent = "I found the project space. Now I’m saving the files...";
    }

    if (!owner) throw new Error("GitHub publishing is not configured on the server.");

    await apiJson("/api/github/upload-file", {
      method: "POST",
      body: JSON.stringify({
        owner,
        repo: repoName,
        path: "README.md",
        content: state.readme,
        message: "Add Makeable README",
      }),
    });

    const repoUrl = `https://github.com/${owner}/${repoName}`;
    els.githubStatus.innerHTML = `Saved: <a href="${repoUrl}" target="_blank" rel="noreferrer">${repoUrl}</a>`;
  } catch (error) {
    console.error(error);
    setStatus(els.githubStatus, `I couldn’t save it yet: ${error.message}`, "danger");
  } finally {
    els.publishGithubButton.disabled = false;
  }
}

async function apiJson(path, options = {}) {
  const base = String(serverConfig.apiBaseUrl || "").replace(/\/$/, "");
  const requestUrl = base && path !== "/api/config" ? `${base}${path}` : path;
  const requiresAuth = /^\/api\/(account|openai|firmware|github)(\/|$)/.test(path);
  const accessToken = requiresAuth ? await getAccessToken() : await getAccessToken({ interactive: false });
  const { generationId, ...fetchOptions } = options;
  const response = await fetch(requestUrl, {
    ...fetchOptions,
    headers: {
      "Content-Type": "application/json",
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...(generationId ? { "X-Makeable-Generation-Id": generationId } : {}),
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { message: text };
  }
  if (!response.ok) {
    const message = formatApiError(response.status, data, text);
    const error = new Error(`${response.status} ${message}`);
    error.status = response.status;
    error.apiData = data;
    const retryAfterSeconds = Number(response.headers.get("Retry-After"));
    if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
      error.retryAfterSeconds = retryAfterSeconds;
    }
    throw error;
  }
  if (data?.upstreamStatus && data?.error) {
    throw new Error(`${data.upstreamStatus} ${formatApiError(data.upstreamStatus, data, text)}`);
  }
  return data;
}

function formatApiError(status, data, rawText) {
  const rawMessage = data.error?.message || data.message || data.error || `HTTP ${status}`;
  const text = String(rawMessage || rawText || "").trim();
  if (status === 504 && /inactivity timeout/i.test(`${rawText} ${text}`)) {
    return "The hosted AI request went quiet for too long. I’ve moved long guide work into the background; refresh and try again.";
  }
  if (/^\s*</.test(text) || /<html/i.test(text)) {
    return stripHtml(text).slice(0, 260) || `HTTP ${status}`;
  }
  return text;
}

function stripHtml(value) {
  return String(value || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function setStatus(element, text, tone) {
  element.textContent = text;
  element.classList.add("status-strip");
  element.classList.remove("ok", "warn", "danger");
  if (tone) element.classList.add(tone);
}

function sanitizeRepoName(value) {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_.-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "makeable-build"
  );
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
