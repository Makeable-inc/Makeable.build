import { boardHumanGuide, selectBoardProfile, USB_SERIAL_FILTERS } from "./lib/board-profiles.mjs";
import {
  ESP32_IDENTITY_CONFIDENCE_THRESHOLD,
  esp32IdentityAssessment,
  expectedDiagnosticHits,
  findDiagnosticFailure,
  isStandalonePowerSourcePart,
  normalizeBeginnerPlan,
  resolveWorkflowStage,
  validateBeginnerPlan,
  wireDescription,
} from "./lib/beginner-plan.mjs";
import {
  buildAcaciaStageUrl,
  buildAcaciaProposalRequest,
  cleanOAuthCallbackUrl,
  groupAcaciaRequiredParts,
  normalizeAcaciaProposalResponse,
  parseAcaciaProgram,
} from "./lib/acacia-program.mjs";

const $ = (selector) => document.querySelector(selector);

const FRONTIER_MODEL = "gpt-5.6-terra";
const LEGACY_MODEL_DEFAULTS = new Set(["gpt-5.4-mini"]);
const DEFAULT_REASONING_EFFORT = "low";
const LEGACY_REASONING_EFFORT_DEFAULTS = new Set(["low"]);
const AI_BACKGROUND_TIMEOUT_MS = 8 * 60 * 1000;
const AI_POLL_BASE_INTERVAL_MS = 2200;
const AI_TRANSIENT_RETRY_ATTEMPTS = 2;
const ANNOTATION_LABEL_PADDING = 12;
const ANNOTATION_LABEL_GAP = 10;
const AUTH_STORAGE_KEY = "makeable.auth.v1";
const AUTH_FLOW_KEY = "makeable.auth.flow.v1";
const FIRMWARE_BLOCKING_PLAN_ISSUES = new Set([
  "missing-esp32",
  "missing-esp32-confidence",
  "low-esp32-confidence",
  "missing-part-id",
  "duplicate-part-id",
  "missing-connection-id",
  "duplicate-connection-id",
  "duplicate-pin",
]);
let serverConfig = window.MAKEABLE_CONFIG || window.CIRCUIT_CODEX_CONFIG || {};
const initialAuthSearch = window.location.search;
let storedAuthReturnUrl = "";
try {
  storedAuthReturnUrl = JSON.parse(sessionStorage.getItem(AUTH_FLOW_KEY) || "null")?.returnUrl || "";
} catch {
  storedAuthReturnUrl = "";
}
const initialAuthParams = new URLSearchParams(initialAuthSearch);
const isAuthCallback = initialAuthParams.has("code") || initialAuthParams.has("error");
const activeProgramId =
  parseAcaciaProgram(window.location.search) ||
  (isAuthCallback ? parseAcaciaProgram(storedAuthReturnUrl) : null);
const STANDARD_WORKFLOW_STAGES = [
  {
    hash: "#capture",
    label: "Step 1: Start",
    hint: "Start with an idea or show me the parts you have.",
  },
  {
    hash: "#plan",
    label: "Step 2: Check parts",
    hint: "Make the labels visible and confirm every required part.",
  },
  {
    hash: "#flash",
    label: "Step 3: Build",
    hint: "Connect one exact wire at a time, then load the board.",
  },
  {
    hash: "#verify",
    label: "Step 4: Test",
    hint: "Listen to the board and check the real behavior.",
  },
  {
    hash: "#document",
    label: "Step 5: Celebrate",
    hint: "Optionally add a photo, publish, and share the verified build.",
  },
];
const ACACIA_WORKFLOW_STAGES = [
  {
    hash: "#capture",
    label: "Step 1: Idea",
    hint: "Describe the outcome you want. Makeable already knows the Acacia kit.",
  },
  {
    hash: "#plan",
    label: "Step 2: Plan",
    hint: "Check the feasible first version, route, challenge level, and exact kit parts.",
  },
  {
    hash: "#flash",
    label: "Step 3: Build",
    hint: "Connect one registry-checked wire at a time, then load the board.",
  },
  {
    hash: "#verify",
    label: "Step 4: Test",
    hint: "Verify the board messages and the real-world behavior.",
  },
  {
    hash: "#document",
    label: "Step 5: Showcase",
    hint: "Package the working result as evidence for a hackathon or portfolio.",
  },
];
const WORKFLOW_STAGES = activeProgramId ? ACACIA_WORKFLOW_STAGES : STANDARD_WORKFLOW_STAGES;

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
  voiceEpoch: 0,
  serialEpoch: 0,
  entryMode: "idea",
  photoAnalysisBusy: false,
  photoAnalysisStartedAt: 0,
  preparationConfirmed: false,
  planIssues: [],
  completedConnectionIds: new Set(),
  manualResult: null,
  automaticTestStatus: "pending",
  diagnosticFailure: null,
  diagnosticLogOffset: 0,
  readme: "",
  compiledFirmware: null,
  flashStatus: "idle",
  flashPhase: "cable",
  completionMedia: {
    finishedBuild: null,
    creator: null,
  },
  completionSelectionEpoch: {
    finishedBuild: 0,
    creator: 0,
  },
  publishedProject: null,
  publishDraft: null,
  activeBuildStepIndex: 0,
  activeWorkflowStageIndex: 0,
  generationId: "",
  sessionEpoch: 0,
  verificationEpoch: 0,
  compilerReady: false,
  flashOperationActive: false,
  publishOperationActive: false,
  auth: loadStoredAuth(),
  account: null,
  programId: activeProgramId || "",
  program: null,
  programLoadStatus: activeProgramId ? "pending" : "idle",
  proposal: null,
  proposalStatus: "idle",
  proposalAbort: null,
  proposalRequestVersion: 0,
  difficultyOverride: "",
  acceptedPlanId: "",
  technicalRoute: null,
};

let photoAnalysisTimerId = null;

const els = {
  ideaNextButton: $("#ideaNextButton"),
  ideaPrompts: document.querySelectorAll("[data-idea]"),
  voiceTranscriptBox: $("#voiceTranscriptBox"),
  photoFirstStatus: $("#photoFirstStatus"),
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
  analyzeButton: $("#analyzeButton"),
  startPhotoFirstButton: $("#startPhotoFirstButton"),
  photoPickerLabel: $("#photoPickerLabel"),
  photoAnalysisProgress: $("#photoAnalysisProgress"),
  photoAnalysisTitle: $("#photoAnalysisTitle"),
  photoAnalysisDetail: $("#photoAnalysisDetail"),
  photoAnalysisElapsed: $("#photoAnalysisElapsed"),
  ideaFromPhotoPanel: $("#ideaFromPhotoPanel"),
  photoIdeaOptions: $("#photoIdeaOptions"),
  manualHelpButton: $("#manualHelpButton"),
  testTabItems: document.querySelectorAll(".test-tabs span"),
  workflowStages: document.querySelectorAll("[data-stage-index]"),
  timelineButtons: document.querySelectorAll("[data-workflow-stage]"),
  stageBackButton: $("#stageBackButton"),
  stageNextButton: $("#stageNextButton"),
  stageControlTitle: $("#stageControlTitle"),
  stageControlHint: $("#stageControlHint"),
  partsList: $("#partsList"),
  partsCountLabel: $("#partsCountLabel"),
  boardConfidence: $("#boardConfidence"),
  boardConfidenceValue: $("#boardConfidenceValue"),
  boardConfidenceDetail: $("#boardConfidenceDetail"),
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
  buildPreparation: $("#buildPreparation"),
  boardSupportBadge: $("#boardSupportBadge"),
  boardIdentity: $("#boardIdentity"),
  powerSourceTitle: $("#powerSourceTitle"),
  usbCableGuide: $("#usbCableGuide"),
  cableInventoryList: $("#cableInventoryList"),
  planIssues: $("#planIssues"),
  preparationConfirmed: $("#preparationConfirmed"),
  preparationConfirmationText: $("#preparationConfirmationText"),
  beginAssemblyButton: $("#beginAssemblyButton"),
  wireLegend: $("#wireLegend"),
  baudRateInput: $("#baudRateInput"),
  connectSerialButton: $("#connectSerialButton"),
  disconnectSerialButton: $("#disconnectSerialButton"),
  serialCommandInput: $("#serialCommandInput"),
  sendSerialButton: $("#sendSerialButton"),
  evaluateLogsButton: $("#evaluateLogsButton"),
  serialLog: $("#serialLog"),
  logEvaluation: $("#logEvaluation"),
  diagnosticRepairCard: $("#diagnosticRepairCard"),
  diagnosticRepairTitle: $("#diagnosticRepairTitle"),
  diagnosticConnection: $("#diagnosticConnection"),
  diagnosticEvidence: $("#diagnosticEvidence"),
  openRepairButton: $("#openRepairButton"),
  retryDiagnosticButton: $("#retryDiagnosticButton"),
  verifyBehaviorButton: $("#verifyBehaviorButton"),
  manualObservation: $("#manualObservation"),
  operatingGuide: $("#operatingGuide"),
  manualSuccessQuestion: $("#manualSuccessQuestion"),
  behaviorEvaluation: $("#behaviorEvaluation"),
  continueToCelebrateButton: $("#continueToCelebrateButton"),
  compileFlashButton: $("#compileFlashButton"),
  testHardwareButton: $("#testHardwareButton"),
  flashProgress: $("#flashProgress"),
  flashProgressBar: $("#flashProgressBar"),
  flashProgressLabel: $("#flashProgressLabel"),
  flashStateItems: document.querySelectorAll("[data-flash-state]"),
  usbCableName: $("#usbCableName"),
  boardUsbPort: $("#boardUsbPort"),
  usbPowerLoadNote: $("#usbPowerLoadNote"),
  esp32Status: $("#esp32Status"),
  generateReadmeButton: $("#generateReadmeButton"),
  repoNameInput: $("#repoNameInput"),
  privateRepoInput: $("#privateRepoInput"),
  publishGithubButton: $("#publishGithubButton"),
  publishGateNote: $("#publishGateNote"),
  finishedBuildPhotoInput: $("#finishedBuildPhotoInput"),
  creatorPhotoInput: $("#creatorPhotoInput"),
  finishedBuildPreview: $("#finishedBuildPreview"),
  creatorPhotoPreview: $("#creatorPhotoPreview"),
  includeFinishedBuildPhoto: $("#includeFinishedBuildPhoto"),
  includeCreatorPhoto: $("#includeCreatorPhoto"),
  coverAltText: $("#coverAltText"),
  projectCoverPreview: $("#projectCoverPreview"),
  projectTitlePreview: $("#projectTitlePreview"),
  shareBuildButton: $("#shareBuildButton"),
  githubStatus: $("#githubStatus"),
  readmePreview: $("#readmePreview"),
  accountButton: $("#accountButton"),
  creditBadge: $("#creditBadge"),
  accountName: $("#accountName"),
  programBadge: $("#programBadge"),
  startHeading: $("#startHeading"),
  startSubheading: $("#startSubheading"),
  acaciaKitIntro: $("#acaciaKitIntro"),
  planHeading: $("#planHeading"),
  planSubheading: $("#planSubheading"),
  planPrivacyNote: $("#planPrivacyNote"),
  acaciaPlanPanel: $("#acaciaPlanPanel"),
  acaciaPlanLoading: $("#acaciaPlanLoading"),
  acaciaPlanError: $("#acaciaPlanError"),
  acaciaPlanResult: $("#acaciaPlanResult"),
  acaciaRouteStatus: $("#acaciaRouteStatus"),
  acaciaFeasibleTitle: $("#acaciaFeasibleTitle"),
  acaciaFeasibleSummary: $("#acaciaFeasibleSummary"),
  acaciaFitBadge: $("#acaciaFitBadge"),
  acaciaOriginalIdea: $("#acaciaOriginalIdea"),
  acaciaAdaptation: $("#acaciaAdaptation"),
  acaciaAdaptationReason: $("#acaciaAdaptationReason"),
  acaciaPreservedIntent: $("#acaciaPreservedIntent"),
  acaciaDeferredFeatures: $("#acaciaDeferredFeatures"),
  acaciaRouteCard: document.querySelector(".acacia-route-card"),
  acaciaRouteLabel: $("#acaciaRouteLabel"),
  acaciaRouteReason: $("#acaciaRouteReason"),
  acaciaCapabilities: $("#acaciaCapabilities"),
  acaciaDifficultyCard: $("#acaciaDifficultyCard"),
  acaciaDifficultyReason: $("#acaciaDifficultyReason"),
  acaciaDifficultyButtons: document.querySelectorAll("[data-acacia-difficulty]"),
  acaciaCoreParts: $("#acaciaCoreParts"),
  acaciaSharedParts: $("#acaciaSharedParts"),
  acaciaNoSharedParts: $("#acaciaNoSharedParts"),
  acaciaChangesSection: $("#acaciaChangesSection"),
  acaciaChanges: $("#acaciaChanges"),
  editAcaciaIdeaButton: $("#editAcaciaIdeaButton"),
  acceptAcaciaRouteButton: $("#acceptAcaciaRouteButton"),
};

const hardwarePlanSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    schemaVersion: { type: "integer", enum: [2] },
    projectTitle: { type: "string" },
    summary: { type: "string" },
    boardProfile: {
      type: "object",
      additionalProperties: false,
      properties: {
        profileId: { type: "string" },
        manufacturer: { type: "string" },
        model: { type: "string" },
        revision: { type: "string" },
        identityConfidence: { type: "number", minimum: 0, maximum: 1 },
        supportStatus: {
          type: "string",
          enum: ["exactly_supported", "compatible_with_differences", "unverified"],
        },
        usbConnector: { type: "string" },
        resetLabel: { type: "string" },
        bootLabel: { type: "string" },
        printedLabels: { type: "array", items: { type: "string" } },
      },
      required: [
        "profileId",
        "manufacturer",
        "model",
        "revision",
        "identityConfidence",
        "supportStatus",
        "usbConnector",
        "resetLabel",
        "bootLabel",
        "printedLabels",
      ],
    },
    powerPlan: {
      type: "object",
      additionalProperties: false,
      properties: {
        mode: { type: "string", enum: ["usb_board_power", "external_supply_required"] },
        reason: { type: "string", enum: ["ordinary_low_current", "untethered_requested", "high_current_load"] },
        boardRail: { type: "string" },
        highCurrentLoads: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              partId: { type: "string" },
              reason: {
                type: "string",
                enum: ["current_over_usb_budget", "requires_separate_voltage", "inductive_load", "mains_load", "known_separate_power_load"],
              },
              requiredVoltageVolts: { type: "number", minimum: 0 },
              estimatedCurrentMilliamps: { type: "number", minimum: 0 },
              evidence: { type: "string" },
            },
            required: ["partId", "reason", "requiredVoltageVolts", "estimatedCurrentMilliamps", "evidence"],
          },
        },
        externalSupplies: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              partId: { type: "string" },
              outputVoltageVolts: { type: "number", minimum: 0 },
              maxCurrentMilliamps: { type: "number", minimum: 0 },
              evidence: { type: "string" },
            },
            required: ["partId", "outputVoltageVolts", "maxCurrentMilliamps", "evidence"],
          },
        },
        externalPowerRequired: { type: "boolean" },
        explanation: { type: "string" },
        keepUsbConnected: { type: "boolean" },
      },
      required: ["mode", "reason", "boardRail", "highCurrentLoads", "externalSupplies", "externalPowerRequired", "explanation", "keepUsbConnected"],
    },
    parts: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          type: { type: "string" },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          role: { type: "string" },
          profileId: { type: "string" },
          compatibilityStatus: {
            type: "string",
            enum: ["exactly_supported", "compatible_with_differences", "unverified"],
          },
          connectorType: { type: "string" },
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
        required: [
          "id",
          "name",
          "type",
          "confidence",
          "role",
          "profileId",
          "compatibilityStatus",
          "connectorType",
          "bbox",
        ],
      },
    },
    preparation: {
      type: "object",
      additionalProperties: false,
      properties: {
        orientation: { type: "string" },
        usbCable: { type: "string" },
        requiredPartIds: { type: "array", items: { type: "string" } },
        wires: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              connectionId: { type: "string" },
              color: { type: "string" },
              connectorType: { type: "string" },
              quantity: { type: "integer" },
            },
            required: ["connectionId", "color", "connectorType", "quantity"],
          },
        },
      },
      required: ["orientation", "usbCable", "requiredPartIds", "wires"],
    },
    warnings: { type: "array", items: { type: "string" } },
    wiringSteps: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          order: { type: "integer" },
          connectionId: { type: "string" },
          connectionNumber: { type: "integer" },
          title: { type: "string" },
          action: { type: "string" },
          instruction: { type: "string" },
          from: { type: "string" },
          to: { type: "string" },
          fromPartId: { type: "string" },
          toPartId: { type: "string" },
          pin: { type: "string" },
          fromPrintedPin: { type: "string" },
          toPrintedPin: { type: "string" },
          fromElectricalAlias: { type: "string" },
          toElectricalAlias: { type: "string" },
          pinLocationsConfirmed: { type: "boolean" },
          fromPinBbox: {
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
          toPinBbox: {
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
          wireColor: { type: "string" },
          wireType: { type: "string" },
          quickCheck: { type: "string" },
          check: { type: "string" },
          why: { type: "string" },
          warning: { type: "string" },
          requiredPartIds: { type: "array", items: { type: "string" } },
          accessibilityRank: { type: "integer" },
        },
        required: [
          "order",
          "connectionId",
          "connectionNumber",
          "title",
          "action",
          "instruction",
          "from",
          "to",
          "fromPartId",
          "toPartId",
          "pin",
          "fromPrintedPin",
          "toPrintedPin",
          "fromElectricalAlias",
          "toElectricalAlias",
          "pinLocationsConfirmed",
          "fromPinBbox",
          "toPinBbox",
          "wireColor",
          "wireType",
          "quickCheck",
          "check",
          "why",
          "warning",
          "requiredPartIds",
          "accessibilityRank",
        ],
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
          failureTitle: { type: "string" },
          recoveryAction: { type: "string" },
          connectionId: { type: "string" },
        },
        required: [
          "name",
          "purpose",
          "userAction",
          "expectedSerial",
          "failureTitle",
          "recoveryAction",
          "connectionId",
        ],
      },
    },
    operatingGuide: {
      type: "object",
      additionalProperties: false,
      properties: {
        summary: { type: "string" },
        steps: { type: "array", items: { type: "string" } },
        successQuestion: { type: "string" },
        unit: { type: "string" },
        resetInstruction: { type: "string" },
      },
      required: ["summary", "steps", "successQuestion", "unit", "resetInstruction"],
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
    "schemaVersion",
    "projectTitle",
    "summary",
    "boardProfile",
    "powerPlan",
    "parts",
    "preparation",
    "warnings",
    "wiringSteps",
    "diagnosticTests",
    "operatingGuide",
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
  "Adafruit MPU6050",
  "Adafruit BME280 Library",
  "BH1750",
  "Adafruit VL53L0X",
  "Adafruit PN532",
  "Adafruit SGP30 Sensor",
  "HX711 Arduino Library",
  "DHT sensor library",
  "Adafruit NeoPixel",
  "ESP32Servo",
  "Adafruit GFX Library",
  "Adafruit SSD1306",
  "ArduinoJson",
  "PubSubClient",
];

const ideaSuggestionSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    suggestions: {
      type: "array",
      minItems: 2,
      maxItems: 3,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: { type: "string" },
          description: { type: "string" },
          usesParts: { type: "array", items: { type: "string" } },
        },
        required: ["title", "description", "usesParts"],
      },
    },
  },
  required: ["suggestions"],
};

applyProgramMode();
bindEvents();
renderEmptyPlan();
const initialStageIndex = WORKFLOW_STAGES.findIndex((stage) => stage.hash === window.location.hash);
setActiveWorkflowStage(Math.max(initialStageIndex, 0), {
  updateHash: true,
  replace: true,
});
drawPartsCanvas();
refreshServerConfig().then(async () => {
  if (isAcaciaMode()) await loadAcaciaProgramDefinition();
  await initializeAuth();
});
refreshEsp32Status();
if (/^(localhost|127\.0\.0\.1)$/.test(window.location.hostname)) {
  globalThis.__MAKEABLE_TEST_API__ = {
    getProgramState() {
      return {
        programId: state.programId,
        proposalStatus: state.proposalStatus,
        proposal: state.proposal,
        acceptedPlanId: state.acceptedPlanId,
      };
    },
    async loadPlan(plan, imageDataUrl = "", options = {}) {
      invalidatePendingGeneration();
      resetBuildEvidence();
      state.plan = normalizePlan(plan, { userRequest: String(options?.userRequest || "") });
      state.planIssues = validateBeginnerPlan(state.plan);
      if (imageDataUrl) {
        const fixtureImage = new Image();
        await new Promise((resolve, reject) => {
          fixtureImage.onload = resolve;
          fixtureImage.onerror = () => reject(new Error("The local QA image could not be loaded."));
          fixtureImage.src = imageDataUrl;
        });
        state.imageDataUrl = imageDataUrl;
        state.imageElement = fixtureImage;
        document.body.classList.add("has-parts-photo");
      }
      renderPlan();
      setActiveWorkflowStage(2);
    },
    setManualResult(result) {
      state.manualResult = { ...result, verificationEpoch: state.verificationEpoch };
      updatePublishControls();
    },
    setFlashStatus(status) {
      beginAutomaticTestAttempt();
      state.flashStatus = status;
      if (status === "success" && state.plan) {
        state.preparationConfirmed = true;
        state.completedConnectionIds = new Set(state.plan.wiringSteps.map(({ connectionId }) => connectionId));
        updatePreparationControls();
        setBuildMode("code");
      }
      renderFlashState(status === "success" ? "success" : "cable");
      if (status === "success") {
        if (els.compileFlashButton) {
          els.compileFlashButton.disabled = true;
          els.compileFlashButton.textContent = "Loading board...";
        }
        setFlashProgress(100, "Firmware loaded successfully");
      }
      updatePublishControls();
    },
    setAutomaticTestStatus(status) {
      beginAutomaticTestAttempt();
      state.automaticTestStatus = status;
      updatePublishControls();
    },
    setSerialLog(log) {
      state.serialLog = String(log || "");
      els.serialLog.textContent = state.serialLog;
      els.evaluateLogsButton.disabled = !state.serialLog.trim();
    },
    setCompiledFirmware(compiledFirmware) {
      state.compiledFirmware = compiledFirmware;
      updatePublishControls();
    },
    setOperationActive(kind, active) {
      setBlockingOperation(kind, Boolean(active));
    },
    getState() {
      return {
        board: selectBoardProfile(state.plan)?.id || null,
        compiled: Boolean(state.compiledFirmware),
        flashStatus: state.flashStatus,
        status: els.esp32Status.textContent,
        manualStatus: currentManualResult()?.status || null,
        automaticTestStatus: state.automaticTestStatus,
        planIssues: state.planIssues,
        flashOperationActive: state.flashOperationActive,
        publishOperationActive: state.publishOperationActive,
        publishReady: Boolean(
          state.plan &&
            state.compiledFirmware &&
            state.flashStatus === "success" &&
            state.automaticTestStatus === "pass" &&
            currentManualResult()?.status === "pass",
        ),
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

function isAcaciaMode() {
  return state.programId === "nus-acacia";
}

function acaciaStageUrl(
  hash = window.location.hash || "#capture",
  returnUrl = storedAuthReturnUrl,
) {
  return buildAcaciaStageUrl(
    window.location,
    returnUrl,
    hash,
  );
}

function applyProgramMode() {
  if (!isAcaciaMode()) return;
  document.body.classList.add("program-acacia");
  document.body.dataset.program = "acacia";
  document.body.dataset.programMode = "acacia";
  document.title = "Build with the Acacia kit · Makeable";
  if (els.programBadge) els.programBadge.hidden = false;
  if (els.acaciaKitIntro) els.acaciaKitIntro.hidden = false;
  document.querySelectorAll("[data-general-entry]").forEach((element) => {
    element.hidden = true;
  });
  document.querySelectorAll("[data-general-plan]").forEach((element) => {
    element.hidden = true;
  });
  if (els.acaciaPlanPanel) els.acaciaPlanPanel.hidden = false;
  if (els.startHeading) els.startHeading.innerHTML = "What do you want to <span>make happen?</span>";
  if (els.startSubheading) {
    els.startSubheading.textContent =
      "Start with the impact or experience you want. Makeable will fit it to Acacia’s known kit.";
  }
  if (els.ideaNextButton) els.ideaNextButton.textContent = "Find my build path";
  if (els.voiceTranscriptBox) {
    els.voiceTranscriptBox.textContent = "Type, tap an example, or describe the outcome in your own words.";
  }
  if (els.planHeading) els.planHeading.innerHTML = "Your idea. One<br /><span>feasible path.</span>";
  if (els.planSubheading) {
    els.planSubheading.textContent =
      "See what stays, what changes, and which Acacia parts make the first version possible.";
  }
  if (els.planPrivacyNote) {
    els.planPrivacyNote.textContent =
      "No parts photo needed. This route comes from Acacia’s fixed ESP32-S3 kit registry.";
  }
  const timelineLabels = ["Idea", "Plan", "Build", "Test", "Showcase"];
  document.querySelectorAll("[data-timeline-label]").forEach((label) => {
    const text = label.querySelector("strong") || label;
    text.textContent = timelineLabels[Number(label.dataset.timelineLabel)] || text.textContent;
  });
  renderAcaciaProposal();
}

function bindEvents() {
  els.homeButton?.addEventListener("click", showIntro);
  els.homeBrandLink?.addEventListener("click", showIntro);
  els.ideaNextButton?.addEventListener("click", advanceFromIdea);
  els.startPhotoFirstButton?.addEventListener("click", startPhotoFirst);
  els.ideaPrompts.forEach((button) => {
    button.addEventListener("click", () => {
      els.ideaText.value = button.dataset.idea || "";
      els.ideaText.focus();
      handleIdeaChange();
    });
  });
  els.ideaText?.addEventListener("input", handleIdeaChange);
  els.photoInput?.addEventListener("change", handlePhotoUpload);
  els.photoInput?.addEventListener("cancel", handlePhotoPickerCancel);
  els.clearPhotoButton?.addEventListener("click", clearPhoto);
  els.startVoiceButton?.addEventListener("click", startVoiceCapture);
  els.stopVoiceButton?.addEventListener("click", stopVoiceCapture);
  els.analyzeButton?.addEventListener("click", analyzeHardware);
  els.preparationConfirmed?.addEventListener("change", () => {
    state.preparationConfirmed = els.preparationConfirmed.checked;
    updatePreparationControls();
  });
  els.beginAssemblyButton?.addEventListener("click", beginAssembly);
  els.timelineButtons.forEach((button) => {
    button.addEventListener("click", () => setActiveWorkflowStage(Number(button.dataset.workflowStage || 0)));
  });
  els.stageBackButton.addEventListener("click", () => setActiveWorkflowStage(state.activeWorkflowStageIndex - 1));
  els.stageNextButton.addEventListener("click", () => {
    if (isAcaciaMode() && state.activeWorkflowStageIndex === 0) {
      void advanceFromIdea();
      return;
    }
    if (isAcaciaMode() && state.activeWorkflowStageIndex === 1 && !state.plan) {
      void acceptAcaciaProposal();
      return;
    }
    setActiveWorkflowStage(state.activeWorkflowStageIndex + 1);
  });
  els.prevBuildStepButton?.addEventListener("click", () => setActiveBuildStep(state.activeBuildStepIndex - 1));
  els.nextBuildStepButton?.addEventListener("click", advanceBuildStep);
  els.showWiringButton?.addEventListener("click", () => setBuildMode("wiring"));
  els.showCodeButton?.addEventListener("click", () => setBuildMode("code"));
  els.connectSerialButton?.addEventListener("click", connectSerial);
  els.disconnectSerialButton?.addEventListener("click", disconnectSerial);
  els.sendSerialButton?.addEventListener("click", sendSerialCommand);
  els.evaluateLogsButton?.addEventListener("click", evaluateSerialLogs);
  els.openRepairButton?.addEventListener("click", openDiagnosticConnection);
  els.retryDiagnosticButton?.addEventListener("click", prepareDiagnosticRetry);
  els.verifyBehaviorButton?.addEventListener("click", () => verifyBehavior("pass"));
  els.manualHelpButton?.addEventListener("click", () => {
    verifyBehavior("fail");
    goToRepairStep();
  });
  els.continueToCelebrateButton?.addEventListener("click", () => setActiveWorkflowStage(4));
  els.compileFlashButton?.addEventListener("click", compileAndFlashFirmware);
  els.testHardwareButton?.addEventListener("click", () => setActiveWorkflowStage(3));
  els.generateReadmeButton?.addEventListener("click", () => {
    state.readme = buildReadme();
    els.readmePreview.textContent = state.readme;
  });
  els.publishGithubButton?.addEventListener("click", publishToGitHub);
  els.finishedBuildPhotoInput?.addEventListener("change", (event) => handleCompletionPhoto(event, "finishedBuild"));
  els.creatorPhotoInput?.addEventListener("change", (event) => handleCompletionPhoto(event, "creator"));
  els.includeFinishedBuildPhoto?.addEventListener("change", refreshCompletionPreview);
  els.includeCreatorPhoto?.addEventListener("change", refreshCompletionPreview);
  els.coverAltText?.addEventListener("input", refreshCompletionPreview);
  els.shareBuildButton?.addEventListener("click", sharePublishedBuild);
  els.accountButton?.addEventListener("click", handleAccountButton);
  els.acaciaDifficultyButtons.forEach((button) => {
    button.addEventListener("click", () => selectAcaciaDifficulty(button.dataset.acaciaDifficulty));
  });
  els.editAcaciaIdeaButton?.addEventListener("click", reviseAcaciaIdea);
  els.acceptAcaciaRouteButton?.addEventListener("click", acceptAcaciaProposal);
  updateIdeaActions();
  updatePhotoReadiness();
}

function showIntro(event) {
  event?.preventDefault();
  if (resetIsBlocked()) return;
  stopVoiceCapture();
  void disconnectSerial({ announce: false });
  clearPhoto();
  state.entryMode = "idea";
  state.finalTranscript = "";
  state.interimTranscript = "";
  state.generationId = "";
  cancelAcaciaProposalRequest();
  state.proposal = null;
  state.proposalStatus = "idle";
  state.difficultyOverride = "";
  state.acceptedPlanId = "";
  state.technicalRoute = null;
  state.plan = null;
  resetBuildEvidence();
  renderEmptyPlan();
  renderAcaciaProposal();
  if (els.ideaText) els.ideaText.value = "";
  if (els.voiceTranscriptBox) els.voiceTranscriptBox.textContent = "Type, tap an example, or use your voice.";
  if (els.photoFirstStatus) els.photoFirstStatus.textContent = "I’ll look only after you choose or take a photo.";
  if (els.photoPickerLabel) els.photoPickerLabel.textContent = "Take or choose a photo";
  setPhotoAnalysisBusy(false);
  updateIdeaActions();
  document.body.classList.remove("intro-active");
  setActiveWorkflowStage(0, { updateHash: true, replace: true });
}

function focusIdeaEntry() {
  setActiveWorkflowStage(0);
  requestAnimationFrame(() => els.ideaText?.focus());
}

function startPhotoFirst() {
  state.entryMode = "photo";
  els.ideaText.removeAttribute("aria-invalid");
  if (els.photoFirstStatus) els.photoFirstStatus.textContent = "Choose one photo. I’ll start suggesting builds as soon as it is ready.";
  setActiveWorkflowStage(1);
  els.photoInput?.click();
}

function goToRepairStep() {
  beginAutomaticTestAttempt();
  state.automaticTestStatus = "pending";
  updatePublishControls();
  setActiveWorkflowStage(2);
  setBuildMode("wiring");
  if (state.diagnosticFailure?.connectionId) {
    const index = state.plan?.wiringSteps?.findIndex(
      ({ connectionId }) => connectionId === state.diagnosticFailure.connectionId,
    );
    if (index >= 0) setActiveBuildStep(index);
  }
  setStatus(
    els.behaviorEvaluation,
    "I moved you back to the wiring guide. Check the repair note on the step you were on.",
    "warn",
  );
}

function updateIdeaActions() {
  const hasIdea = Boolean(els.ideaText?.value.trim());
  if (els.ideaNextButton) {
    els.ideaNextButton.disabled = !hasIdea;
  }
  if (isAcaciaMode() && state.activeWorkflowStageIndex === 0 && els.stageNextButton) {
    els.stageNextButton.disabled = !hasIdea;
  }
  if (els.analyzeButton && !state.photoAnalysisBusy) {
    els.analyzeButton.textContent = hasIdea ? "Make my beginner guide" : "Suggest what I can build";
  }
}

function handleIdeaChange() {
  if (isAcaciaMode() && (state.proposal || state.proposalStatus === "loading")) {
    cancelAcaciaProposalRequest();
    state.proposal = null;
    state.proposalStatus = "idle";
    state.difficultyOverride = "";
    state.acceptedPlanId = "";
    state.technicalRoute = null;
    state.plan = null;
    resetBuildEvidence();
    renderEmptyPlan();
    renderAcaciaProposal();
  }
  if (state.generationId) {
    invalidatePendingGeneration();
    setPhotoAnalysisBusy(false);
    if (state.plan) {
      state.plan = null;
      resetBuildEvidence();
      renderEmptyPlan();
    }
  }
  updateIdeaActions();
  updatePhotoReadiness();
}

function updatePhotoReadiness(options = {}) {
  const hasPhoto = Boolean(state.imageDataUrl);
  const announce = options.announce !== false;
  if (els.analyzeButton) els.analyzeButton.disabled = state.photoAnalysisBusy || !hasPhoto;
  if (!announce || state.photoAnalysisBusy) return;
  if (!hasPhoto) {
    setStatus(els.transcriptBox, "Choose one clear photo. Build suggestions will start automatically.", "");
  } else {
    setStatus(
      els.transcriptBox,
      els.ideaText?.value.trim()
        ? "Photo ready. Choose “Make my beginner guide” when you want me to start."
        : "Photo ready. Choose “Suggest what I can build” to try again.",
      "ok",
    );
  }
}

function setPhotoAnalysisBusy(isBusy, options = {}) {
  const wasBusy = state.photoAnalysisBusy;
  state.photoAnalysisBusy = Boolean(isBusy);
  if (state.photoAnalysisBusy && !wasBusy) state.photoAnalysisStartedAt = Date.now();
  if (!state.photoAnalysisBusy) state.photoAnalysisStartedAt = 0;

  if (els.analyzeButton) {
    els.analyzeButton.disabled = state.photoAnalysisBusy || !state.imageDataUrl;
    els.analyzeButton.classList.toggle("is-loading", state.photoAnalysisBusy);
    if (state.photoAnalysisBusy) els.analyzeButton.setAttribute("aria-busy", "true");
    else els.analyzeButton.removeAttribute("aria-busy");
    if (options.buttonLabel) els.analyzeButton.textContent = options.buttonLabel;
  }
  if (els.photoAnalysisProgress) els.photoAnalysisProgress.hidden = !state.photoAnalysisBusy;
  if (options.title && els.photoAnalysisTitle) els.photoAnalysisTitle.textContent = options.title;
  if (options.detail && els.photoAnalysisDetail) els.photoAnalysisDetail.textContent = options.detail;

  if (photoAnalysisTimerId) window.clearInterval(photoAnalysisTimerId);
  photoAnalysisTimerId = null;
  if (state.photoAnalysisBusy) {
    renderPhotoAnalysisElapsed();
    photoAnalysisTimerId = window.setInterval(renderPhotoAnalysisElapsed, 1000);
    if (options.scroll === true) {
      requestAnimationFrame(() => els.photoAnalysisProgress?.scrollIntoView({ behavior: "smooth", block: "center" }));
    }
  }
}

function updatePhotoAnalysisMessage(title, detail) {
  if (title && els.photoAnalysisTitle) els.photoAnalysisTitle.textContent = title;
  if (detail && els.photoAnalysisDetail) els.photoAnalysisDetail.textContent = detail;
}

function setPartsPendingLabel(message) {
  if (!state.plan && els.partsCountLabel) els.partsCountLabel.textContent = message;
}

function renderPhotoAnalysisElapsed() {
  if (!state.photoAnalysisBusy || !els.photoAnalysisElapsed) return;
  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - state.photoAnalysisStartedAt) / 1000));
  els.photoAnalysisElapsed.textContent = elapsedSeconds < 2
    ? "Started just now · keep this tab open"
    : `Working for ${elapsedSeconds}s · keep this tab open`;
}

function announceStageGuard(requestedIndex, activeIndex) {
  if (requestedIndex >= 2 && !state.plan) {
    if (isAcaciaMode()) {
      if (els.acaciaPlanError) {
        setStatus(els.acaciaPlanError, "Accept one feasible Acacia build path before opening the build guide.", "warn");
        els.acaciaPlanError.hidden = false;
      }
      els.acceptAcaciaRouteButton?.focus();
    } else {
      setStatus(els.transcriptBox, "I need one confirmed photo and a safe parts plan before the first wire.", "warn");
      els.analyzeButton?.focus();
    }
    return;
  }
  if (requestedIndex >= 3 && state.flashStatus !== "success") {
    setStatus(els.esp32Status, "Load the board successfully before testing it.", "warn");
    els.compileFlashButton?.focus();
    return;
  }
  if (requestedIndex >= 4 && state.automaticTestStatus !== "pass") {
    setStatus(els.logEvaluation, "Pass the fresh board-message check before celebrating or publishing.", "warn");
    els.evaluateLogsButton?.focus();
    return;
  }
  if (requestedIndex >= 4 && currentManualResult()?.status !== "pass") {
    setStatus(els.behaviorEvaluation, "Try the finished build and confirm that it worked before publishing.", "warn");
    els.verifyBehaviorButton?.focus();
    return;
  }
  const stage = WORKFLOW_STAGES[activeIndex];
  if (stage) els.stageControlHint.textContent = stage.hint;
}

async function advanceFromIdea() {
  const idea = els.ideaText.value.trim();
  if (!idea) {
    els.ideaText.focus();
    els.ideaText.setAttribute("aria-invalid", "true");
    if (els.voiceTranscriptBox) els.voiceTranscriptBox.textContent = "Tell me the idea in one sentence first.";
    return;
  }
  state.entryMode = "idea";
  els.ideaText.removeAttribute("aria-invalid");
  if (serverConfig.hasAccounts && !(await getAccessToken({ interactive: false }))) {
    sessionStorage.setItem("makeable.pendingIdea", idea);
    sessionStorage.setItem("makeable.signInIntent", "plan");
    await startSignIn();
    return;
  }
  if (isAcaciaMode()) {
    await requestAcaciaProposal();
    return;
  }
  setActiveWorkflowStage(1);
}

async function loadAcaciaProgramDefinition() {
  if (!isAcaciaMode()) return null;
  state.programLoadStatus = "loading";
  try {
    const response = await apiJson("/api/programs/nus-acacia");
    if (response?.program?.id !== state.programId) {
      throw new Error("The Acacia program registry returned the wrong program.");
    }
    state.program = response.program;
    state.programLoadStatus = "ready";
    return response.program;
  } catch (error) {
    console.error(error);
    state.programLoadStatus = "error";
    if (els.acaciaPlanError) {
      setStatus(
        els.acaciaPlanError,
        `The Acacia kit registry is not available yet: ${error.message}`,
        "danger",
      );
      els.acaciaPlanError.hidden = false;
    }
    return null;
  }
}

function cancelAcaciaProposalRequest() {
  state.proposalRequestVersion += 1;
  state.proposalAbort?.abort();
  state.proposalAbort = null;
  document.body.removeAttribute("data-acacia-routing");
}

async function requestAcaciaProposal(options = {}) {
  if (!isAcaciaMode()) return;
  const idea = String(options.idea ?? els.ideaText?.value ?? "").trim();
  const difficulty = String(options.difficulty ?? state.difficultyOverride ?? "").trim();
  let request;
  try {
    request = buildAcaciaProposalRequest({
      idea,
      difficulty: difficulty || "recommended",
    });
  } catch (error) {
    if (els.acaciaPlanError) {
      setStatus(els.acaciaPlanError, error.message, "danger");
      els.acaciaPlanError.hidden = false;
    }
    els.ideaText?.focus();
    return;
  }

  cancelAcaciaProposalRequest();
  const requestVersion = state.proposalRequestVersion;
  const controller = new AbortController();
  state.proposalAbort = controller;
  invalidatePendingGeneration();
  state.proposal = null;
  state.proposalStatus = "loading";
  state.acceptedPlanId = "";
  state.technicalRoute = null;
  state.plan = null;
  resetBuildEvidence();
  renderEmptyPlan();
  document.body.dataset.acaciaRouting = "true";
  setActiveWorkflowStage(1);
  renderAcaciaProposal();

  try {
    const response = await apiJson("/api/programs/nus-acacia/proposals", {
      method: "POST",
      body: JSON.stringify(request),
      signal: controller.signal,
    });
    if (controller.signal.aborted || requestVersion !== state.proposalRequestVersion) return;
    state.proposal = normalizeAcaciaProposalResponse(response);
    state.proposalStatus = "ready";
    state.technicalRoute = state.proposal.proposal.family;
    renderAcaciaProposal();
    requestAnimationFrame(() => els.acaciaFeasibleTitle?.focus({ preventScroll: true }));
  } catch (error) {
    if (error?.name === "AbortError" || requestVersion !== state.proposalRequestVersion) return;
    console.error(error);
    state.proposalStatus = "error";
    if (els.acaciaPlanError) {
      setStatus(
        els.acaciaPlanError,
        `I couldn’t match that idea to the Acacia kit yet: ${error.message}`,
        "danger",
      );
      els.acaciaPlanError.hidden = false;
    }
    renderAcaciaProposal();
  } finally {
    if (requestVersion === state.proposalRequestVersion) {
      state.proposalAbort = null;
      document.body.removeAttribute("data-acacia-routing");
    }
  }
}

function renderAcaciaProposal() {
  if (!isAcaciaMode() || !els.acaciaPlanPanel) return;
  const normalized = state.proposal;
  const proposal = normalized?.proposal;
  const isLoading = state.proposalStatus === "loading";
  const isError = state.proposalStatus === "error";
  els.acaciaPlanPanel.hidden = false;
  els.acaciaPlanLoading.hidden = !isLoading && state.proposalStatus !== "idle";
  els.acaciaPlanResult.hidden = !proposal;
  if (!isError) els.acaciaPlanError.hidden = true;
  if (!proposal) {
    els.acaciaPlanPanel.dataset.planFeasibility = isError ? "error" : "pending";
    if (state.activeWorkflowStageIndex === 1 && els.stageNextButton) {
      els.stageNextButton.disabled = true;
    }
    return;
  }

  const reshaped = proposal.routeStatus === "reshaped";
  const grouped = groupAcaciaRequiredParts(normalized);
  const routeLabel = acaciaRouteLabel(proposal.family);
  const routeStatus = reshaped ? "reshaped" : "ready";
  els.acaciaPlanPanel.dataset.planFeasibility = routeStatus;
  els.acaciaPlanPanel.dataset.buildRoute = proposal.family;
  els.acaciaPlanResult.dataset.planStatus = routeStatus;
  els.acaciaRouteCard.dataset.technicalRoute = proposal.family;
  els.acaciaFeasibleTitle.textContent = proposal.projectTitle;
  els.acaciaFeasibleSummary.textContent = proposal.supportedIdea;
  els.acaciaFitBadge.textContent = reshaped ? "Goal preserved · path reshaped" : "Fits the Acacia kit";
  els.acaciaFitBadge.classList.toggle("is-adapted", reshaped);
  els.acaciaOriginalIdea.textContent = proposal.originalIdea;
  els.acaciaAdaptation.hidden = !reshaped;
  els.acaciaAdaptationReason.textContent = reshaped
    ? `${proposal.preservation?.change || "The first version was narrowed."} ${proposal.preservation?.reason || ""}`.trim()
    : "";
  renderTextList(
    els.acaciaPreservedIntent,
    reshaped ? [proposal.preservation?.originalGoal || proposal.originalIdea] : [],
    "data-preserved-intent",
  );
  renderTextList(
    els.acaciaDeferredFeatures,
    reshaped
      ? [proposal.preservation?.change || "The unsupported implementation is deferred."]
      : [],
    "data-deferred-feature",
  );
  els.acaciaRouteLabel.textContent = routeLabel;
  els.acaciaRouteReason.textContent = acaciaRouteExplanation(proposal);
  renderTextList(els.acaciaCapabilities, acaciaRouteCapabilities(proposal.family));
  els.acaciaDifficultyReason.textContent =
    acaciaDifficultyExplanation(proposal, grouped);
  els.acaciaDifficultyCard.dataset.difficultyRecommended = proposal.recommendedDifficulty;
  els.acaciaDifficultyButtons.forEach((button) => {
    const selected = button.dataset.acaciaDifficulty === proposal.difficulty;
    button.setAttribute("aria-pressed", String(selected));
    button.disabled = ["loading", "accepting", "generating"].includes(state.proposalStatus);
  });
  renderAcaciaParts(els.acaciaCoreParts, grouped.core);
  renderAcaciaParts(els.acaciaSharedParts, grouped.shared);
  els.acaciaNoSharedParts.hidden = grouped.shared.length > 0;
  const changes = [
    ...(reshaped && proposal.preservation?.change ? [proposal.preservation.change] : []),
    ...(proposal.warnings || []).map(({ message }) => message).filter(Boolean),
  ];
  renderTextList(els.acaciaChanges, [...new Set(changes)]);
  els.acaciaChangesSection.hidden = changes.length === 0;
  els.acceptAcaciaRouteButton.disabled = ["accepting", "generating"].includes(state.proposalStatus);
  els.acceptAcaciaRouteButton.textContent = state.proposalStatus === "accepting"
    ? "Preparing your build…"
    : state.proposalStatus === "generating"
      ? "Checking the board software…"
      : "Build this version";
  if (state.activeWorkflowStageIndex === 1 && els.stageNextButton) {
    els.stageNextButton.disabled = ["loading", "accepting", "generating"].includes(state.proposalStatus);
  }
}

function renderTextList(list, values, dataAttribute = "") {
  if (!list) return;
  list.innerHTML = "";
  for (const value of values.filter(Boolean)) {
    const item = document.createElement("li");
    item.textContent = value;
    if (dataAttribute) item.setAttribute(dataAttribute, "");
    list.append(item);
  }
}

function renderAcaciaParts(list, parts) {
  if (!list) return;
  list.innerHTML = "";
  for (const part of parts) {
    const item = document.createElement("li");
    item.dataset.partId = part.id;
    item.dataset.availability = part.availability;
    item.innerHTML = "<strong></strong><small></small>";
    item.querySelector("strong").textContent = part.label;
    item.querySelector("small").textContent = part.pool === "shared"
      ? `${part.kind} · reserve from Acacia’s shared advanced pool`
      : `${part.kind} · included in your team kit`;
    list.append(item);
  }
}

function acaciaRouteLabel(family) {
  return {
    rules: "Rule-based automation",
    connected: "Connection-ready sensing",
    tinyml: "TinyML data preparation",
    cloud: "Cloud-ready local prototype",
    hybrid: "Hybrid-ready local prototype",
  }[family] || "Acacia build route";
}

function capitalize(value) {
  const text = String(value || "");
  return text ? `${text[0].toUpperCase()}${text.slice(1)}` : "";
}

function acaciaRouteExplanation(proposal) {
  const explanations = {
    rules: "The ESP32 reads a sensor and responds with clear, testable rules. This is the shortest path to a working physical demo.",
    connected: "This slice verifies the sensor and formats bounded readings locally. Wi-Fi provisioning, device identity, ingestion and a live dashboard remain deferred.",
    tinyml: "Start by verifying the sensor and collecting labeled examples. A model is only claimed after it is trained and validated.",
    cloud: "This slice produces a local sensor-and-rules demonstrator plus a bounded sample payload. Managed interpretation, notifications and remote delivery remain deferred.",
    hybrid: "This slice verifies the supervised local sensing and stop-control path. Trained inference, autonomous control, telemetry and cloud delivery remain deferred.",
  };
  return `${explanations[proposal.family] || ""} ${proposal.supportedIdea}`.trim();
}

function acaciaDifficultyExplanation(proposal, grouped) {
  const trackCopy = {
    beginner:
      "Beginner keeps one dependable input-to-feedback loop and asks for a plain-language explanation.",
    builder:
      "Builder adds one approved challenge part, calibration from real readings, and a two-state comparison.",
    advanced:
      "Advanced adds up to two approved challenge parts plus nominal, boundary, and recovery evidence.",
  }[proposal.difficulty] || "";
  const poolCopy = grouped.shared.length
    ? ` This version needs ${grouped.shared.length} item${grouped.shared.length === 1 ? "" : "s"} from Acacia’s shared pool.`
    : " This version stays inside the team’s core kit.";
  const recommendationCopy = proposal.difficulty === proposal.recommendedDifficulty
    ? ` ${capitalize(proposal.recommendedDifficulty)} is Makeable’s recommended starting point for this route.`
    : ` You selected ${capitalize(proposal.difficulty)}; Makeable recommends ${capitalize(proposal.recommendedDifficulty)} for the first pass.`;
  return `${trackCopy}${poolCopy}${recommendationCopy}`.trim();
}

function acaciaRouteCapabilities(family) {
  if (family === "tinyml") {
    return [
      "Verify the sensor stream before collecting data",
      "Collect labeled examples for the chosen classes",
      "Train and validate a model before claiming on-device prediction",
    ];
  }
  if (family === "connected" || family === "cloud" || family === "hybrid") {
    return [
      "Verify the local physical path before any future connection",
      "Prepare bounded serial evidence or a sample payload",
      "Keep provisioning, remote delivery and autonomous control deferred",
      "Use Makeable-managed services—no student OpenAI key",
    ];
  }
  return [
    "Read a known Acacia sensor",
    "Apply a clear threshold or state rule",
    "Show a visible, audible, or physical result",
  ];
}

async function selectAcaciaDifficulty(difficulty) {
  if (!["beginner", "builder", "advanced"].includes(difficulty)) return;
  if (state.proposal?.proposal?.difficulty === difficulty && state.proposalStatus === "ready") return;
  state.difficultyOverride = difficulty;
  await requestAcaciaProposal({ difficulty });
}

function reviseAcaciaIdea() {
  cancelAcaciaProposalRequest();
  invalidatePendingGeneration();
  state.proposal = null;
  state.proposalStatus = "idle";
  state.difficultyOverride = "";
  state.acceptedPlanId = "";
  state.technicalRoute = null;
  state.plan = null;
  resetBuildEvidence();
  renderAcaciaProposal();
  setActiveWorkflowStage(0);
  requestAnimationFrame(() => els.ideaText?.focus());
}

async function acceptAcaciaProposal() {
  const proposal = state.proposal?.proposal;
  if (!proposal || ["accepting", "generating"].includes(state.proposalStatus)) return;
  const idea = proposal.originalIdea;
  const acceptanceVersion = state.proposalRequestVersion;
  const acceptedProposalId = proposal.planId;
  state.proposalStatus = "accepting";
  renderAcaciaProposal();
  try {
    const response = await apiJson(
      `/api/programs/nus-acacia/plans/${encodeURIComponent(proposal.planId)}/accept`,
      {
        method: "POST",
        body: JSON.stringify({
          idea,
          difficulty: proposal.difficulty,
          registryVersion: proposal.registryVersion,
        }),
      },
    );
    if (response?.planId !== proposal.planId || !response?.buildPlan) {
      throw new Error("The accepted Acacia build did not match the proposal.");
    }
    if (
      acceptanceVersion !== state.proposalRequestVersion ||
      state.proposal?.proposal?.planId !== acceptedProposalId
    ) {
      return;
    }
    state.acceptedPlanId = response.planId;
    state.technicalRoute = proposal.family;
    state.plan = normalizePlan(
      {
        ...response.buildPlan,
        programId: state.programId,
        acceptedPlanId: response.planId,
        technicalRoute: proposal.family,
        proposal,
      },
      { userRequest: idea },
    );
    state.planIssues = validateBeginnerPlan(state.plan);
    state.plan.warnings = [
      ...new Set([
        ...(state.plan.warnings || []),
        ...state.planIssues.map(({ message }) => message),
      ]),
    ];
    resetBuildEvidence();
    renderPlan();
    const generationContext = beginGenerationContext(idea);
    const acceptedPlan = state.plan;
    let firmwareNotice = "";
    if (serverConfig.hasOpenAIKey) {
      state.proposalStatus = "generating";
      renderAcaciaProposal();
      try {
        await generateFirmwareForPlan(idea, generationContext);
        if (serverConfig.hasAccounts) await refreshAccount();
      } catch (firmwareError) {
        console.error(firmwareError);
        firmwareNotice =
          `The physical guide is ready, but the board software still needs a retry: ${firmwareError.message}`;
      }
    } else {
      firmwareNotice =
        "The physical guide is ready. Makeable’s managed software service is not configured in this environment yet.";
    }
    if (!isGenerationCurrent(generationContext, acceptedPlan)) return;
    state.proposalStatus = "ready";
    renderPlan();
    renderAcaciaProposal();
    setActiveWorkflowStage(2);
    if (firmwareNotice) {
      setStatus(els.esp32Status, `${firmwareNotice} Return to Plan and choose “Build this version” to retry.`, "warn");
      if (els.compileFlashButton) {
        els.compileFlashButton.disabled = true;
        els.compileFlashButton.textContent = "Board software not ready";
      }
    }
  } catch (error) {
    console.error(error);
    if (
      acceptanceVersion !== state.proposalRequestVersion ||
      state.proposal?.proposal?.planId !== acceptedProposalId
    ) {
      return;
    }
    state.proposalStatus = "ready";
    renderAcaciaProposal();
    if (els.acaciaPlanError) {
      setStatus(
        els.acaciaPlanError,
        `I couldn’t prepare that build path yet: ${error.message}`,
        "danger",
      );
      els.acaciaPlanError.hidden = false;
    }
  }
}

function setActiveWorkflowStage(index, options = {}) {
  const previousIndex = state.activeWorkflowStageIndex;
  const requestedIndex = clamp(index, 0, WORKFLOW_STAGES.length - 1);
  const operationStage = state.flashOperationActive ? 2 : state.publishOperationActive ? 4 : null;
  if (operationStage !== null && requestedIndex !== operationStage && options.allowDuringOperation !== true) {
    resetIsBlocked();
    return;
  }
  const activeIndex = resolveWorkflowStage(requestedIndex, {
    hasPlan: Boolean(state.plan),
    flashStatus: state.flashStatus,
    automaticTestStatus: state.automaticTestStatus,
    manualTestStatus: currentManualResult()?.status || "pending",
  });
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
    if (buttonIndex === activeIndex) button.setAttribute("aria-current", "step");
    else button.removeAttribute("aria-current");
    const resolved = resolveWorkflowStage(buttonIndex, {
      hasPlan: Boolean(state.plan),
      flashStatus: state.flashStatus,
      automaticTestStatus: state.automaticTestStatus,
      manualTestStatus: currentManualResult()?.status || "pending",
    });
    const locked = resolved !== buttonIndex;
    button.setAttribute("aria-disabled", String(locked));
  });

  const stage = WORKFLOW_STAGES[activeIndex];
  els.stageControlTitle.textContent = stage.label;
  els.stageControlHint.textContent = stage.hint;
  els.stageBackButton.disabled = activeIndex === 0;
  els.stageNextButton.disabled =
    activeIndex === WORKFLOW_STAGES.length - 1 ||
    (isAcaciaMode() && activeIndex === 0 && !els.ideaText?.value.trim()) ||
    (isAcaciaMode() && activeIndex === 1 && !state.proposal?.proposal);
  els.stageNextButton.textContent = (isAcaciaMode()
    ? ["See my plan", "Build it", "Test my hardware", "Showcase", "All set"]
    : ["Check my parts", "Build it", "Test my hardware", "Celebrate", "All set"])[activeIndex];

  if (activeIndex === 2 && (!state.preparationConfirmed || els.codeWorkspace?.hidden !== false)) {
    setBuildMode(state.preparationConfirmed ? "wiring" : "prepare");
  }
  if (activeIndex === 3) renderOperatingGuide();
  if (activeIndex === 4) refreshCompletionPreview();

  if (requestedIndex !== activeIndex && options.silent !== true) {
    announceStageGuard(requestedIndex, activeIndex);
  }

  if (options.updateHash !== false) {
    const url = isAcaciaMode()
      ? acaciaStageUrl(stage.hash)
      : `${window.location.pathname}${stage.hash}`;
    window.history.replaceState(null, "", url);
  }

  requestAnimationFrame(() => {
    drawPartsCanvas();
    renderVisualSteps();
    if (activeIndex !== previousIndex && options.focus !== false) {
      const activeStage = els.workflowStages[activeIndex];
      if (activeStage) activeStage.scrollTop = 0;
      if (window.innerWidth < 900) window.scrollTo({ top: 0, behavior: "auto" });
      const heading = activeStage?.querySelector("h1");
      if (heading) {
        heading.setAttribute("tabindex", "-1");
        heading.focus({ preventScroll: true });
      }
    }
  });
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
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), 8000);
  try {
    const freshConfig = await apiJson("/api/config", { signal: controller.signal });
    serverConfig = freshConfig;
    settings.githubOwner = freshConfig.githubOwner || "";
    settings.openaiModel = pickModel("", freshConfig.openaiModel, FRONTIER_MODEL);
    settings.openaiReasoningModel = pickModel("", freshConfig.openaiReasoningModel, FRONTIER_MODEL);
    settings.openaiReasoningEffort = pickReasoningEffort("", freshConfig.openaiReasoningEffort);
    return freshConfig;
  } catch (error) {
    console.error(error);
    return serverConfig;
  } finally {
    window.clearTimeout(timeoutId);
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
      if (sessionStorage.getItem("makeable.signInIntent") === "plan") {
        if (isAcaciaMode()) await requestAcaciaProposal();
        else setActiveWorkflowStage(1);
      }
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
  const returnUrl = isAcaciaMode()
    ? acaciaStageUrl(window.location.hash || "#capture")
    : `${window.location.pathname}${window.location.hash || "#capture"}`;
  sessionStorage.setItem(AUTH_FLOW_KEY, JSON.stringify({ verifier, loginState, returnUrl }));
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
  const savedReturnUrl = flow.returnUrl
    ? new URL(flow.returnUrl, window.location.origin)
    : null;
  const returnHash = savedReturnUrl?.hash || "";
  const hash = window.location.hash || returnHash || "#capture";
  const cleanUrl = isAcaciaMode()
    ? acaciaStageUrl(hash, flow.returnUrl)
    : `${savedReturnUrl?.pathname || window.location.pathname}${hash}`;
  sessionStorage.removeItem(AUTH_FLOW_KEY);
  window.history.replaceState(
    null,
    "",
    isAcaciaMode() ? cleanOAuthCallbackUrl(cleanUrl, hash) : cleanUrl,
  );
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

function currentManualResult() {
  return state.manualResult?.verificationEpoch === state.verificationEpoch ? state.manualResult : null;
}

function beginAutomaticTestAttempt() {
  state.verificationEpoch += 1;
  state.manualResult = null;
  if (els.continueToCelebrateButton) els.continueToCelebrateButton.hidden = true;
  if (els.behaviorEvaluation) {
    setStatus(els.behaviorEvaluation, "Pass the fresh board check, then try the real behavior again.", "");
  }
}

function invalidatePendingGeneration() {
  state.sessionEpoch += 1;
  state.generationId = "";
  if (els.analyzeButton) els.analyzeButton.disabled = false;
  return state.sessionEpoch;
}

function beginGenerationContext(ideaText = els.ideaText?.value || "") {
  state.sessionEpoch += 1;
  state.generationId = crypto.randomUUID();
  return {
    generationId: state.generationId,
    sessionEpoch: state.sessionEpoch,
    imageDataUrl: state.imageDataUrl,
    ideaText: String(ideaText).trim(),
  };
}

function isGenerationCurrent(context, plan = null) {
  return Boolean(
    context &&
      state.generationId === context.generationId &&
      state.sessionEpoch === context.sessionEpoch &&
      state.imageDataUrl === context.imageDataUrl &&
      String(els.ideaText?.value || "").trim() === context.ideaText &&
      (!plan || state.plan === plan),
  );
}

function setBlockingOperation(kind, active) {
  if (kind === "flash") state.flashOperationActive = active;
  if (kind === "publish") state.publishOperationActive = active;
  const blocked = state.flashOperationActive || state.publishOperationActive;
  if (els.homeButton) els.homeButton.disabled = blocked;
  if (els.homeBrandLink) {
    els.homeBrandLink.setAttribute("aria-disabled", String(blocked));
    els.homeBrandLink.classList.toggle("is-disabled", blocked);
  }
  els.timelineButtons.forEach((button) => {
    button.disabled = blocked;
  });
  if (els.stageBackButton) els.stageBackButton.disabled = blocked || state.activeWorkflowStageIndex === 0;
  if (els.stageNextButton) {
    els.stageNextButton.disabled = blocked || state.activeWorkflowStageIndex === WORKFLOW_STAGES.length - 1;
  }
  if (els.photoInput) els.photoInput.disabled = blocked;
  if (els.clearPhotoButton) els.clearPhotoButton.disabled = blocked;
  const completionLocked = state.publishOperationActive || Boolean(state.publishedProject);
  if (els.finishedBuildPhotoInput) els.finishedBuildPhotoInput.disabled = completionLocked;
  if (els.creatorPhotoInput) els.creatorPhotoInput.disabled = completionLocked;
  if (els.includeFinishedBuildPhoto) {
    els.includeFinishedBuildPhoto.disabled = completionLocked || !state.completionMedia.finishedBuild;
  }
  if (els.includeCreatorPhoto) {
    els.includeCreatorPhoto.disabled = completionLocked || !state.completionMedia.creator;
  }
  if (els.coverAltText) els.coverAltText.disabled = completionLocked;
}

function resetIsBlocked() {
  if (state.flashOperationActive) {
    setActiveWorkflowStage(2, { allowDuringOperation: true });
    setStatus(
      els.esp32Status,
      "Finish this board load before starting over so the ESP32 is not left half-programmed.",
      "warn",
    );
    return true;
  }
  if (state.publishOperationActive) {
    setActiveWorkflowStage(4, { allowDuringOperation: true });
    setStatus(els.githubStatus, "Finish this secure save before starting another project.", "warn");
    return true;
  }
  return false;
}

function resetCompletionState() {
  state.completionSelectionEpoch.finishedBuild += 1;
  state.completionSelectionEpoch.creator += 1;
  state.completionMedia = { finishedBuild: null, creator: null };
  state.publishedProject = null;
  state.publishDraft = null;
  for (const input of [els.finishedBuildPhotoInput, els.creatorPhotoInput]) {
    if (input) {
      input.value = "";
      input.disabled = false;
    }
  }
  for (const consent of [els.includeFinishedBuildPhoto, els.includeCreatorPhoto]) {
    if (!consent) continue;
    consent.checked = false;
    consent.disabled = true;
  }
  for (const preview of [els.finishedBuildPreview, els.creatorPhotoPreview]) {
    if (!preview) continue;
    preview.hidden = true;
    preview.removeAttribute("src");
    preview.alt = "";
  }
  if (els.coverAltText) {
    els.coverAltText.value = "";
    els.coverAltText.disabled = false;
  }
  if (els.projectCoverPreview) {
    els.projectCoverPreview.src = "images/makeable/scan-parts.svg";
    els.projectCoverPreview.alt = "Illustrated Makeable electronics build";
  }
  if (els.shareBuildButton) els.shareBuildButton.hidden = true;
  if (els.repoNameInput) {
    els.repoNameInput.value = "makeable-build";
    els.repoNameInput.disabled = false;
  }
  if (els.privateRepoInput) {
    els.privateRepoInput.checked = true;
    els.privateRepoInput.disabled = false;
  }
  if (els.publishGithubButton) els.publishGithubButton.textContent = "Publish to GitHub";
  if (els.githubStatus) setStatus(els.githubStatus, "Your notes stay here with your build session.", "");
}

function resetBuildEvidence() {
  beginAutomaticTestAttempt();
  state.automaticTestStatus = "pending";
  state.diagnosticFailure = null;
  state.diagnosticLogOffset = 0;
  state.compiledFirmware = null;
  state.flashStatus = "idle";
  state.flashPhase = "cable";
  state.preparationConfirmed = false;
  state.planIssues = [];
  state.completedConnectionIds = new Set();
  state.activeBuildStepIndex = 0;
  state.serialLog = "";
  state.readme = "";
  if (els.preparationConfirmed) els.preparationConfirmed.checked = false;
  if (els.manualObservation) els.manualObservation.value = "";
  if (els.serialLog) els.serialLog.textContent = "Board messages will appear here after you connect.";
  if (els.connectSerialButton) els.connectSerialButton.disabled = false;
  if (els.disconnectSerialButton) els.disconnectSerialButton.disabled = true;
  if (els.sendSerialButton) els.sendSerialButton.disabled = true;
  if (els.evaluateLogsButton) els.evaluateLogsButton.disabled = true;
  if (els.diagnosticRepairCard) els.diagnosticRepairCard.hidden = true;
  if (els.continueToCelebrateButton) els.continueToCelebrateButton.hidden = true;
  if (els.logEvaluation) setStatus(els.logEvaluation, "I’ll help read these messages once they appear.", "");
  if (els.behaviorEvaluation) setStatus(els.behaviorEvaluation, "Try the operating steps, then choose the honest result.", "");
  if (els.compileFlashButton) {
    els.compileFlashButton.textContent = "Choose my ESP32";
    els.compileFlashButton.disabled = !state.compilerReady;
  }
  setBuildMode("prepare");
  setFlashProgress(0, "Waiting to connect");
  if (els.esp32Status) {
    setStatus(
      els.esp32Status,
      state.compilerReady
        ? "Makeable’s ESP32 compiler is ready. Connect your board when you’re ready."
        : "I’m checking whether the ESP32 compiler is ready.",
      state.compilerReady ? "ok" : "",
    );
  }
  resetCompletionState();
  renderFlashState("cable");
  updatePublishControls();
}

function handlePhotoPickerCancel() {
  if (state.imageDataUrl) return;
  setPhotoAnalysisBusy(false);
  setStatus(els.transcriptBox, "No photo was chosen. Choose one whenever you’re ready; nothing has started yet.", "");
  if (els.photoFirstStatus) els.photoFirstStatus.textContent = "No photo chosen yet.";
}

function showPhotoUploadError(message) {
  state.imageDataUrl = "";
  state.imageElement = null;
  state.imageFit = null;
  document.body.classList.remove("has-parts-photo");
  setPhotoAnalysisBusy(false);
  if (els.photoInput) els.photoInput.value = "";
  if (els.photoPickerLabel) els.photoPickerLabel.textContent = "Try another photo";
  drawPartsCanvas();
  setStatus(els.transcriptBox, message, "danger");
  if (els.photoFirstStatus) els.photoFirstStatus.textContent = "That photo did not load. Try another one.";
}

function handlePhotoUpload(event) {
  const [file] = event.target.files || [];
  if (!file) return;
  if (state.flashOperationActive || state.publishOperationActive) {
    event.target.value = "";
    resetIsBlocked();
    return;
  }
  const photoEpoch = invalidatePendingGeneration();

  state.imageDataUrl = "";
  state.imageElement = null;
  state.imageFit = null;
  state.plan = null;
  resetBuildEvidence();
  document.body.classList.remove("has-parts-photo");
  if (els.ideaFromPhotoPanel) els.ideaFromPhotoPanel.hidden = true;
  if (els.photoIdeaOptions) els.photoIdeaOptions.innerHTML = "";
  renderEmptyPlan();
  if (els.photoPickerLabel) els.photoPickerLabel.textContent = "Choose a different photo";
  setPhotoAnalysisBusy(true, {
    title: "Adding your photo…",
    detail: "I’m preparing the image so I can inspect the real parts.",
    buttonLabel: "Preparing photo…",
    scroll: true,
  });
  setStatus(els.transcriptBox, "Loading your photo...", "warn");

  const reader = new FileReader();
  reader.onload = () => {
    if (state.sessionEpoch !== photoEpoch) return;
    const img = new Image();
    img.onload = () => {
      if (state.sessionEpoch !== photoEpoch) return;
      try {
        state.imageDataUrl = resizePhotoForAi(img);
      } catch (error) {
        console.error(error);
        showPhotoUploadError("I couldn’t prepare that image. Try a JPG, PNG, or WebP; some HEIC photos need to be converted first.");
        return;
      }
      const displayImg = new Image();
      displayImg.onload = () => {
        if (state.sessionEpoch !== photoEpoch || displayImg.src !== state.imageDataUrl) return;
        state.imageElement = displayImg;
        document.body.classList.add("has-parts-photo");
        drawPartsCanvas();
        setActiveWorkflowStage(1);
        setPartsPendingLabel("Checking visible parts…");
        if (els.photoPickerLabel) els.photoPickerLabel.textContent = "Replace photo";
        const shouldSuggestAutomatically = !els.ideaText?.value.trim();
        if (shouldSuggestAutomatically) {
          setPhotoAnalysisBusy(true, {
            title: "Finding build ideas…",
            detail: "I’m checking which parts are visible. I won’t invent anything that is missing.",
            buttonLabel: "Finding build ideas…",
            scroll: true,
          });
          setStatus(els.transcriptBox, "Photo added. I’ve started looking for realistic build ideas automatically.", "warn");
          if (els.photoFirstStatus) els.photoFirstStatus.textContent = "Photo added. Suggestions are running now.";
          requestAnimationFrame(() => void analyzeHardware());
        } else {
          setPhotoAnalysisBusy(false);
          updateIdeaActions();
          updatePhotoReadiness();
          setPartsPendingLabel("Ready to identify project parts");
          els.analyzeButton?.focus();
          if (els.photoFirstStatus) els.photoFirstStatus.textContent = "Photo added. Your guide is ready to start.";
        }
      };
      displayImg.onerror = () => {
        if (state.sessionEpoch === photoEpoch) {
          showPhotoUploadError("I couldn’t display that image. Try a JPG, PNG, or WebP; some HEIC photos need to be converted first.");
        }
      };
      displayImg.src = state.imageDataUrl;
    };
    img.onerror = () => {
      if (state.sessionEpoch === photoEpoch) {
        showPhotoUploadError("I couldn’t read that image. Try a clear JPG, PNG, or WebP; some HEIC photos need to be converted first.");
      }
    };
    img.src = String(reader.result || "");
  };
  reader.onerror = () => {
    if (state.sessionEpoch === photoEpoch) {
      showPhotoUploadError("I couldn’t load that photo. Choose it again or try a JPG, PNG, or WebP.");
    }
  };
  reader.readAsDataURL(file);
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
  if (state.flashOperationActive || state.publishOperationActive) {
    resetIsBlocked();
    return;
  }
  invalidatePendingGeneration();
  state.imageDataUrl = "";
  state.imageElement = null;
  state.imageFit = null;
  state.plan = null;
  resetBuildEvidence();
  setPhotoAnalysisBusy(false);
  if (els.photoInput) els.photoInput.value = "";
  if (els.photoPickerLabel) els.photoPickerLabel.textContent = "Take or choose a photo";
  if (els.ideaFromPhotoPanel) els.ideaFromPhotoPanel.hidden = true;
  if (els.photoIdeaOptions) els.photoIdeaOptions.innerHTML = "";
  document.body.classList.remove("has-parts-photo");
  renderEmptyPlan();
  drawPartsCanvas();
  updatePhotoReadiness();
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

  ctx.save();
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.74;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(start.x, start.y);
  ctx.lineTo(end.x, end.y);
  ctx.stroke();
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
  const idea = els.ideaText.value.trim();
  if (!state.imageDataUrl) {
    setPhotoAnalysisBusy(false);
    setStatus(els.transcriptBox, "Start with one clear photo of your parts. I’ll use that as the map.", "danger");
    return;
  }
  const generationContext = beginGenerationContext(idea);
  setPhotoAnalysisBusy(true, {
    title: idea ? "Starting your beginner guide…" : "Finding build ideas…",
    detail: idea
      ? "I’m checking your photo and the service connection before I plan any wires."
      : "I’m checking your photo and the service connection before I suggest anything.",
    buttonLabel: idea ? "Making your guide…" : "Finding build ideas…",
    scroll: true,
  });
  await refreshServerConfig();
  if (!isGenerationCurrent(generationContext)) return;
  if (!idea) {
    await suggestProjectIdeas(generationContext);
    return;
  }

  updatePhotoAnalysisMessage(
    "Building your exact guide…",
    "I’m matching printed labels and checking the safest connection order.",
  );
  state.plan = null;
  resetBuildEvidence();
  renderEmptyPlan();
  setPartsPendingLabel("Checking visible parts…");

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
      "I’m matching the printed labels, checking every required part, and ordering the hardest-to-reach connections first.",
      "warn",
    );

    const payload = {
      model: settings.openaiModel,
      reasoning: { effort: settings.openaiReasoningEffort || DEFAULT_REASONING_EFFORT },
      input: [
        {
          role: "system",
          content:
            "You are Makeable's visual hardware planner for beginners. From the photo and chosen idea, return one schema-valid ESP32 build plan. Identify only real project parts, use readable labels, keep uncertainty honest, and never invent components or photo geometry. No source code in this step.",
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
              image_url: generationContext.imageDataUrl,
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
      generationId: generationContext.generationId,
      onProgress: ({ elapsedLabel, message }) => {
        if (!isGenerationCurrent(generationContext)) return;
        updatePhotoAnalysisMessage(
          "Building your exact guide…",
          message || `Still studying the photo (${elapsedLabel}). I’ll bring the guide back here.`,
        );
        setStatus(
          els.transcriptBox,
          message ||
          `I’m still studying the photo (${elapsedLabel}). Keep this tab open; I’ll bring the guide back here.`,
          "warn",
        );
      },
    });
    if (!isGenerationCurrent(generationContext)) return;
    const nextPlan = normalizePlan(parseStructuredJson(data, "hardware plan"), { userRequest: idea });
    state.plan = nextPlan;
    state.planIssues = validateBeginnerPlan(state.plan);
    state.plan.warnings = [
      ...new Set([
        ...state.plan.warnings,
        ...state.planIssues.map(({ message }) => message),
      ]),
    ];
    renderPlan();
    const projectBlockers = state.planIssues.filter(issueBlocksFirmware);
    const assemblyBlockers = state.planIssues.filter(
      (issue) => issue.severity === "block" && !issueBlocksFirmware(issue),
    );
    if (projectBlockers.length) {
      setStatus(
        els.transcriptBox,
        `I found the parts, but I still need one reliable board or pin assignment before I can prepare its code: ${projectBlockers[0].message}`,
        "danger",
      );
      return;
    }
    setStatus(
      els.transcriptBox,
      assemblyBlockers.length
        ? `I found the project and I’m keeping it moving. I’ll prepare the code now; one wiring detail still needs attention: ${assemblyBlockers[0].message}`
        : `I confirmed ${state.plan.parts.length} part(s). Now I’m preparing code for this exact plan.`,
      assemblyBlockers.length ? "warn" : "ok",
    );
    try {
      const firmwareReady = await generateFirmwareForPlan(idea, generationContext);
      if (!firmwareReady || !isGenerationCurrent(generationContext, nextPlan)) return;
      if (serverConfig.hasAccounts) await refreshAccount();
      if (!isGenerationCurrent(generationContext, nextPlan)) return;
      renderPlan();
      setStatus(
        els.transcriptBox,
        assemblyBlockers.length
          ? "Your project and code are ready. You can connect and load the ESP32 now; the wiring note stays visible until you resolve it."
          : "Your guide and code are ready. Let’s build it one step at a time.",
        assemblyBlockers.length ? "warn" : "ok",
      );
    } catch (firmwareError) {
      console.error(firmwareError);
      if (!isGenerationCurrent(generationContext, nextPlan)) return;
      renderPlan();
      setStatus(
        els.transcriptBox,
        `The picture guide is ready, but I couldn’t finish the code yet: ${firmwareError.message}`,
        "warn",
      );
    }
    if (!isGenerationCurrent(generationContext, nextPlan)) return;
    setActiveWorkflowStage(2);
  } catch (error) {
    console.error(error);
    if (isGenerationCurrent(generationContext)) {
      setStatus(els.transcriptBox, `I got stuck while making the guide: ${error.message}`, "danger");
    }
  } finally {
    if (isGenerationCurrent(generationContext)) {
      setPhotoAnalysisBusy(false);
      updateIdeaActions();
      updatePhotoReadiness({ announce: false });
    }
  }
}

async function suggestProjectIdeas(generationContext = beginGenerationContext()) {
  setPhotoAnalysisBusy(true, {
    title: "Finding build ideas…",
    detail: "I’m identifying only the parts I can actually see.",
    buttonLabel: "Finding build ideas…",
    scroll: true,
  });
  setPartsPendingLabel("Checking visible parts…");
  try {
    if (!serverConfig.hasOpenAIKey) {
      setStatus(els.transcriptBox, "The AI service is not ready yet, so I can’t inspect this photo.", "danger");
      if (els.photoFirstStatus) els.photoFirstStatus.textContent = "The suggestion service is not ready. You can retry from the photo screen.";
      setPartsPendingLabel("Photo ready to retry");
      return;
    }
    setStatus(
      els.transcriptBox,
      "I’m identifying only the parts I can see, then I’ll offer two or three realistic starter builds.",
      "warn",
    );
    const data = await openAiResponse(
      {
        model: settings.openaiModel,
        reasoning: { effort: settings.openaiReasoningEffort || DEFAULT_REASONING_EFFORT },
        input: [
          {
          role: "system",
          content:
              "You suggest two or three beginner projects from a parts photo. Use visible hardware only. Prefer useful ESP32 sensor or display builds powered by the board's USB cable; do not invent a battery, converter, or level-shifter. Avoid high-current ideas unless a suitable visible supply is present. Return only schema-valid JSON.",
          },
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text:
                  "Suggest two or three concrete, one-sentence projects. Name the visible parts each one uses.",
              },
              { type: "input_image", image_url: generationContext.imageDataUrl, detail: "high" },
            ],
          },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "beginner_project_ideas",
            strict: true,
            schema: ideaSuggestionSchema,
          },
        },
      },
      {
        label: "project ideas",
        generationId: generationContext.generationId,
        onProgress: ({ elapsedLabel }) => {
          if (!isGenerationCurrent(generationContext)) return;
          updatePhotoAnalysisMessage(
            "Still checking your parts…",
            `Working for ${elapsedLabel}. I won’t invent anything that is missing.`,
          );
          setStatus(els.transcriptBox, `Still checking the parts (${elapsedLabel}). I won’t invent anything that is missing.`, "warn");
        },
      },
    );
    if (!isGenerationCurrent(generationContext)) return;
    const result = parseStructuredJson(data, "project ideas");
    renderIdeaSuggestions(result.suggestions || []);
    setPartsPendingLabel("Choose an idea to identify its parts");
    setStatus(els.transcriptBox, "Choose one idea below. I’ll make the exact guide only after you pick.", "ok");
    if (els.photoFirstStatus) els.photoFirstStatus.textContent = "Suggestions ready. Choose the one you like.";
  } catch (error) {
    console.error(error);
    if (isGenerationCurrent(generationContext)) {
      setStatus(els.transcriptBox, `I couldn’t suggest a build from this photo yet: ${error.message}`, "danger");
      if (els.photoFirstStatus) els.photoFirstStatus.textContent = "Suggestions did not finish. Your photo is still here, so you can retry.";
      setPartsPendingLabel("Photo ready to retry");
    }
  } finally {
    if (isGenerationCurrent(generationContext)) {
      setPhotoAnalysisBusy(false);
      updateIdeaActions();
      updatePhotoReadiness({ announce: false });
    }
  }
}

function renderIdeaSuggestions(suggestions) {
  if (!els.ideaFromPhotoPanel || !els.photoIdeaOptions) return;
  els.photoIdeaOptions.innerHTML = "";
  suggestions.forEach((suggestion, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "photo-idea-option";
    button.innerHTML = `<span>${index + 1}</span><strong></strong><p></p><small></small>`;
    button.querySelector("strong").textContent = suggestion.title;
    button.querySelector("p").textContent = suggestion.description;
    button.querySelector("small").textContent = `Uses: ${(suggestion.usesParts || []).join(", ")}`;
    button.addEventListener("click", () => {
      state.entryMode = "photo";
      els.ideaText.value = suggestion.description;
      handleIdeaChange();
      analyzeHardware();
    });
    els.photoIdeaOptions.append(button);
  });
  els.ideaFromPhotoPanel.hidden = false;
  els.ideaFromPhotoPanel.scrollIntoView({ behavior: "smooth", block: "center" });
  requestAnimationFrame(() => els.photoIdeaOptions.querySelector("button")?.focus({ preventScroll: true }));
}

function buildAnalysisPrompt(idea) {
  const hasIdea = Boolean(String(idea || "").trim());
  return [
    hasIdea
      ? `Project idea: ${idea}`
      : "Project idea: none yet. Suggest the simplest beginner-friendly build the visible parts support.",
    "",
    hasIdea
      ? "Build a clear, beginner-friendly plan from the parts in this image."
      : "Suggest the clearest beginner-friendly plan from the parts in this image.",
    "Include only parts needed for this project. Give each a short name, stable id, honest confidence, and tight photo bounds. If uncertain, say 'possible …' instead of guessing.",
    "Identify the likely ESP32, its USB connector, readable RESET/EN and BOOT labels, visible pin labels, and an ESP32-family confidence score. Keep a likely ESP32 visible even below 0.55; use unverified or compatible_with_differences when its exact layout is not proven.",
    "Treat the USB data cable and jumper wires as setup equipment, not photo-detected parts. Still draft every required jumper: connector type, a simple guide colour, and one connection per step. If wire colours are not visible, choose easy distinct guide colours rather than pretending the photo proves them.",
    "Use readable printed board labels in every action. When a known module's tiny connector legend cannot be read, use its standard connector name, mark the label for the user to check, and do not invent its physical position.",
    "For ordinary low-current sensors, displays, LEDs, and onboard outputs, use usb_board_power: the USB cable powers the ESP32 and no battery is needed. Power each small module from a clearly labelled matching board rail—3V3 for 3.3 V modules, or 5V/VIN/VBUS for 5 V modules—and connect GND. A different rail label is not a reason to stop the build or invent a converter.",
    "Use external_supply_required only for a real high-current or separately powered load. Then include the visible supply, its rating, the load power path, and a shared ground. Never route that load's power through the ESP32, drive it from a GPIO, or map exposed mains wiring.",
    "If the user wants a portable build but no portable supply is confirmed, plan usb_board_power now and describe portable power as a later choice.",
    "Choose ordinary beginner-safe ESP32 signal pins and put any caveat in warnings. Map VCC, GND, and every needed signal for each module. For a classic HC-SR04, map VCC, GND, TRIG, and direct ECHO; warn that direct 5 V ECHO is outside the published ESP32 GPIO range, but do not require a battery, converter, resistor, or level-shifter.",
    "Use one atomic wiring step with stable ids, exact endpoints, aliases, connector type, quick check, purpose, warning, required parts, and accessibility order. Repeat both endpoint labels exactly in the action sentence. Keep a viable label-based step when its photo marker is uncertain; set pinLocationsConfirmed false instead of blocking the build.",
    "Add a short operating guide, connection-linked diagnostics, and a compact firmwareSpec with pins, libraries, serial markers, and behavior. Do not generate source code yet.",
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
  const generationId = options.generationId || state.generationId;
  const backgroundPayload = {
    ...payload,
    background: true,
    store: payload.store ?? true,
  };
  delete backgroundPayload.stream;

  for (let attempt = 0; attempt <= AI_TRANSIENT_RETRY_ATTEMPTS; attempt += 1) {
    if (generationId && state.generationId !== generationId) throw new Error("This AI request was superseded by a newer build session.");
    try {
      const started = await apiJson("/api/openai/background", {
        method: "POST",
        generationId,
        body: JSON.stringify(backgroundPayload),
      });
      return waitForOpenAiResponse(started, label, progress, generationId);
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
      generationId,
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

async function waitForOpenAiResponse(started, label, progress, generationId) {
  const firstStatus = normalizeOpenAiStatus(started.status);
  if (!started.id || isOpenAiTerminalStatus(firstStatus)) return assertOpenAiResponseUsable(started, label);

  const startedAt = Date.now();
  let pollCount = 0;
  let latest = started;
  while (true) {
    if (generationId && state.generationId !== generationId) {
      throw new Error("This AI request was superseded by a newer build session.");
    }
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
      generationId,
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

async function generateFirmwareForPlan(idea, generationContext) {
  const plan = state.plan;
  if (!plan || !isGenerationCurrent(generationContext, plan)) return false;
  setStatus(els.transcriptBox, "Preparing the board software securely...", "warn");

  const payload = {
    model: settings.openaiReasoningModel,
    reasoning: { effort: settings.openaiReasoningEffort || DEFAULT_REASONING_EFFORT },
    input: [
      {
        role: "system",
        content:
          "You are Makeable's ESP32 firmware engineer. Generate a compact, compile-ready Arduino-core C++ sketch from the supplied ESP32 plan. Preserve its pins and diagnostics, use only listed libraries, return schema-valid JSON without markdown, and stay under 180 lines unless necessary.",
      },
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: buildFirmwarePrompt(idea, plan),
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
    generationId: generationContext.generationId,
    onProgress: ({ elapsedLabel, message }) => {
      if (!isGenerationCurrent(generationContext, plan)) return;
      setStatus(
        els.transcriptBox,
        message || `Still preparing the board software (${elapsedLabel}).`,
        "warn",
      );
    },
  });
  if (!isGenerationCurrent(generationContext, plan)) return false;
  plan.firmware = normalizeFirmware(parseStructuredJson(data, "firmware"));
  const profile = selectBoardProfile(plan);
  if (!profile) throw new Error("The generated guide does not contain a supported ESP32 board.");
  setStatus(els.transcriptBox, "Checking the board software with the hosted ESP32 compiler...", "warn");
  const compiledFirmware = await compileFirmwareWithAutomaticRepair(profile, {
    idea,
    plan,
    generationId: generationContext.generationId,
    onProgress(message) {
      if (!isGenerationCurrent(generationContext, plan)) return;
      setStatus(els.transcriptBox, message, "warn");
    },
  });
  if (!isGenerationCurrent(generationContext, plan)) return false;
  state.compiledFirmware = compiledFirmware;
  setStatus(els.transcriptBox, "The guide and verified board software are ready.", "ok");
  return true;
}

function buildFirmwarePrompt(idea, plan) {
  const technicalRoute = plan.technicalRoute || plan.proposal?.family || "rules";
  const routeGuard = technicalRoute === "tinyml"
    ? "- This is the pre-training TinyML stage. Generate sensor-verification and labeled-data-collection firmware only. Do not claim a trained model or on-device prediction exists."
    : ["connected", "cloud", "hybrid"].includes(technicalRoute)
      ? `- This ${technicalRoute} route is a local preparation stage only. Generate offline sensor, state-machine, serial-evidence and local-feedback firmware. Do not invent Wi-Fi credentials, device tokens, ingestion endpoints, dashboards, notifications, trained inference, autonomous control or remote delivery.`
      : `- Technical route: ${technicalRoute}. Implement only the bounded behavior and hardware already present in the validated plan.`;
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
        powerPlan: plan.powerPlan,
        firmwareSpec: plan.firmwareSpec,
        warnings: plan.warnings,
      },
      null,
      2,
    ),
    "",
    "Requirements:",
    `- Program: ${plan.programId || "standard"}; registry verification source: ${plan.verificationSource || "photo"}.`,
    routeGuard,
    "- Return one complete ESP32 Arduino-core C++ sketch with Serial.begin(115200).",
    "- Print CIRCUITCODEX_DIAGNOSTIC_READY in setup and the plan's diagnostic markers.",
    "- Keep boot-pin use and assumptions explicit in notes.",
    `- Use only these hosted libraries: ${HOSTED_FIRMWARE_LIBRARIES.join(", ")}. Do not invent APIs or headers.`,
    "- Return the sketch string without markdown fences.",
  ].join("\n");
}

async function compileFirmwareWithAutomaticRepair(profile, options = {}) {
  const targetPlan = options.plan || state.plan;
  let sketch = targetPlan?.firmware?.sketch || "";
  try {
    return await compileFirmwareSketch(sketch, profile);
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
      generationId: options.generationId,
    });
    if (options.generationId && state.generationId !== options.generationId) {
      throw new Error("This firmware request was superseded by a newer build session.");
    }
    targetPlan.firmware = repaired;
    sketch = repaired.sketch;
    options.onProgress?.("The repair is ready. Verifying it with the ESP32 compiler...");
    try {
      return await compileFirmwareSketch(sketch, profile);
    } catch (repairError) {
      console.error("Automatic firmware repair did not compile", repairError);
      throw new Error("The automatic code repair could not pass the ESP32 compiler. Please make the guide again.");
    }
  }
}

async function compileFirmwareSketch(sketch, profile) {
  const compiled = await apiJson("/api/firmware/compile", {
    method: "POST",
    body: JSON.stringify({ sketch, boardProfile: profile.id }),
  });
  compiled.sourceSketch = sketch;
  return compiled;
}

function compilerFailureDetails(error) {
  if (Number(error?.status) !== 500) return "";
  return String(error?.apiData?.details || "").trim();
}

async function repairFirmwareForCompilerError({ idea, profile, sketch, details, onProgress, generationId }) {
  const payload = {
    model: settings.openaiReasoningModel,
    reasoning: { effort: settings.openaiReasoningEffort || DEFAULT_REASONING_EFFORT },
    input: [
      {
        role: "system",
        content:
          "Repair the complete ESP32 Arduino-core sketch after a real compiler failure. Preserve behavior and pins, use only listed libraries, fix every reported error, and return schema-valid JSON without markdown.",
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
              "Return the complete corrected firmware using only those libraries.",
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
    generationId,
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

function normalizePlan(plan, options = {}) {
  const wiringSteps = Array.isArray(plan.wiringSteps) ? plan.wiringSteps : [];
  const rawParts = Array.isArray(plan.parts) ? plan.parts : [];
  const firmwareSpec = plan.firmwareSpec || {
    board: "ESP32",
    behavior: plan.summary || "",
    libraries: [],
    pinAssignments: [],
    serialProtocol: [],
  };
  const projectParts = plan.verificationSource === "program_registry"
    ? rawParts
    : filterProjectParts(rawParts, wiringSteps, firmwareSpec, plan.summary || "", plan.powerPlan);

  const normalizedPlan = normalizeBeginnerPlan({
    ...plan,
    projectTitle: plan.projectTitle || "Makeable Build",
    summary: plan.summary || "",
    parts: projectParts.length ? projectParts : rawParts,
    warnings: Array.isArray(plan.warnings) ? plan.warnings : [],
    wiringSteps,
    diagnosticTests: Array.isArray(plan.diagnosticTests) ? plan.diagnosticTests : [],
    firmwareSpec,
    firmware: plan.firmware ? normalizeFirmware(plan.firmware) : null,
    readmeMarkdown: plan.readmeMarkdown || "",
  }, options);
  return removeUnneededUsbPowerParts(normalizedPlan, options);
}

function filterProjectParts(parts, wiringSteps, firmwareSpec, summary, powerPlan = {}) {
  if (!parts.length || !wiringSteps.length) return parts;

  const explicitRefs = new Set();
  const projectText = normalizeText(
    [
      summary,
      firmwareSpec?.behavior,
      ...(firmwareSpec?.pinAssignments || []).map((pin) => `${pin.label} ${pin.purpose}`),
      ...wiringSteps.map(
        (step) =>
          `${step.title} ${step.action || step.instruction} ${step.from} ${step.to} ${step.fromPartId} ${step.toPartId} ${step.fromPrintedPin} ${step.toPrintedPin} ${step.pin}`,
      ),
    ].join(" "),
  );

  wiringSteps.forEach((step) => {
    [step.fromPartId, step.toPartId, step.from, step.to, ...(step.requiredPartIds || [])].forEach((value) => {
      const normalized = normalizeText(value);
      if (normalized) explicitRefs.add(normalized);
    });
  });
  const powerPartIds = [
    ...(Array.isArray(powerPlan?.highCurrentLoads) ? powerPlan.highCurrentLoads.map((entry) => entry?.partId) : []),
    ...(Array.isArray(powerPlan?.externalSupplies) ? powerPlan.externalSupplies.map((entry) => entry?.partId) : []),
  ];
  for (const partId of powerPartIds) {
    const normalized = normalizeText(partId);
    if (normalized) explicitRefs.add(normalized);
  }

  return parts.filter((part) => {
    const id = normalizeText(part.id);
    const name = normalizeText(part.name);
    const type = normalizeText(part.type);
    const role = normalizeText(part.role);
    const partText = `${id} ${name} ${type} ${role}`.trim();

    if (id && explicitRefs.has(id)) return true;
    if (name && explicitRefs.has(name)) return true;
    if (/\b(unused|not used|not needed|unrelated|spare|ignore|optional)\b/.test(role)) return false;
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

function removeUnneededUsbPowerParts(plan, options = {}) {
  if (plan?.powerPlan?.externalPowerRequired) return plan;
  const removedPowerParts = (Array.isArray(plan.parts) ? plan.parts : [])
    .filter(isStandalonePowerSourcePart);
  const removedPartIds = new Set(
    removedPowerParts.map((part) => String(part?.id || "").trim()).filter(Boolean),
  );

  const wiringSteps = (Array.isArray(plan.wiringSteps) ? plan.wiringSteps : [])
    .filter((step) => !removedPartIds.has(step.fromPartId) && !removedPartIds.has(step.toPartId))
    .map((step) => ({
      ...step,
      requiredPartIds: (Array.isArray(step.requiredPartIds) ? step.requiredPartIds : [])
        .filter((partId) => !removedPartIds.has(partId)),
    }));
  const preparation = {
    ...plan.preparation,
    orientation: mentionsRemovedPowerSource(plan.preparation?.orientation, removedPowerParts)
      ? "Place every component label-side up with the printed pin names visible."
      : plan.preparation?.orientation,
    requiredPartIds: (Array.isArray(plan.preparation?.requiredPartIds) ? plan.preparation.requiredPartIds : [])
      .filter((partId) => !removedPartIds.has(partId)),
  };
  const behaviorFallback = mentionsRemovedPowerSource(plan.firmwareSpec?.behavior, removedPowerParts)
    ? "Run the ESP32 project while its USB data cable stays connected."
    : plan.firmwareSpec?.behavior;
  const summary = mentionsRemovedPowerSource(plan.summary, removedPowerParts)
    ? behaviorFallback || "An ESP32 project powered over USB while it stays connected."
    : plan.summary;
  const operatingSteps = (Array.isArray(plan.operatingGuide?.steps) ? plan.operatingGuide.steps : [])
    .filter((step) => !mentionsRemovedPowerSource(step, removedPowerParts));
  const operatingGuide = {
    ...plan.operatingGuide,
    summary: mentionsRemovedPowerSource(plan.operatingGuide?.summary, removedPowerParts)
      ? summary
      : plan.operatingGuide?.summary,
    steps: operatingSteps.length
      ? operatingSteps
      : ["Keep the USB data cable connected and operate the finished project once."],
    resetInstruction: mentionsRemovedPowerSource(plan.operatingGuide?.resetInstruction, removedPowerParts)
      ? "If it stops responding, keep USB connected and press RESET/EN once—not BOOT—then try again."
      : plan.operatingGuide?.resetInstruction,
    successQuestion: mentionsRemovedPowerSource(plan.operatingGuide?.successQuestion, removedPowerParts)
      ? "Did the finished project behave as described while USB stayed connected?"
      : plan.operatingGuide?.successQuestion,
    unit: mentionsRemovedPowerSource(plan.operatingGuide?.unit, removedPowerParts)
      ? "Use the project output described above; no separate measurement unit is required."
      : plan.operatingGuide?.unit,
  };
  const firmware = plan.firmware
    ? {
        ...plan.firmware,
        notes: mentionsRemovedPowerSource(plan.firmware.notes, removedPowerParts)
          ? "Keep the USB data cable connected while using this build."
          : plan.firmware.notes,
      }
    : plan.firmware;
  const keptConnectionIds = new Set(wiringSteps.map(({ connectionId }) => connectionId).filter(Boolean));
  const diagnosticTests = (Array.isArray(plan.diagnosticTests) ? plan.diagnosticTests : [])
    .filter((test) => !test?.connectionId || keptConnectionIds.has(test.connectionId))
    .map((test, index) => ({
      ...test,
      name: mentionsRemovedPowerSource(test?.name, removedPowerParts)
        ? `USB-powered check ${index + 1}`
        : test?.name,
      purpose: mentionsRemovedPowerSource(test?.purpose, removedPowerParts)
        ? "Confirm the project responds while the ESP32 stays connected over USB."
        : test?.purpose,
      userAction: mentionsRemovedPowerSource(test?.userAction, removedPowerParts)
        ? "Keep USB connected and operate the project once."
        : test?.userAction,
      expectedSerial: mentionsRemovedPowerSource(test?.expectedSerial, removedPowerParts)
        ? "READY"
        : test?.expectedSerial,
      failureTitle: mentionsRemovedPowerSource(test?.failureTitle, removedPowerParts)
        ? "The expected USB-powered behavior was not detected."
        : test?.failureTitle,
      recoveryAction: mentionsRemovedPowerSource(test?.recoveryAction, removedPowerParts)
        ? "Keep USB connected, check the related jumper connection, then retry."
        : test?.recoveryAction,
    }));

  return normalizeBeginnerPlan({
    ...plan,
    projectTitle: mentionsRemovedPowerSource(plan.projectTitle, removedPowerParts)
      ? projectTitleWithoutRemovedPower(plan.projectTitle)
      : plan.projectTitle,
    summary,
    parts: plan.parts.filter((part) => !removedPartIds.has(String(part?.id || "").trim())),
    wiringSteps,
    preparation,
    warnings: (Array.isArray(plan.warnings) ? plan.warnings : [])
      .filter((warning) => !mentionsRemovedPowerSource(warning, removedPowerParts)),
    diagnosticTests,
    operatingGuide,
    firmwareSpec: { ...plan.firmwareSpec, behavior: behaviorFallback },
    firmware,
    readmeMarkdown: "",
  }, options);
}

function mentionsRemovedPowerSource(value, removedParts = []) {
  const text = String(value || "").toLowerCase();
  if (!text) return false;
  if (/\b(?:batter(?:y|ies)|power bank|external power supply|buck converter|boost converter|step[- ]down converter)\b/i.test(text)) {
    return true;
  }
  return removedParts.some((part) => [part?.id, part?.name]
    .map((label) => String(label || "").trim().toLowerCase())
    .some((label) => label.length >= 4 && text.includes(label)));
}

function projectTitleWithoutRemovedPower(value) {
  const title = String(value || "")
    .replace(/\b(?:\d+(?:\.\d+)?\s*v\s*)?(?:battery(?:[- ]powered| pack)?|power bank|external power supply)\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .replace(/^[-–—: ]+|[-–—: ]+$/g, "")
    .trim();
  return title || "Makeable Build";
}

function renderEmptyPlan() {
  els.partsList.innerHTML = "";
  if (els.partsCountLabel) {
    els.partsCountLabel.textContent = isAcaciaMode() ? "Waiting for an accepted plan" : "Waiting for a photo";
  }
  if (els.boardConfidence) {
    els.boardConfidence.hidden = true;
    delete els.boardConfidence.dataset.result;
  }
  els.wiringList.innerHTML = "";
  els.diagnosticsList.innerHTML = "";
  renderEmptyVisualSteps();
  updatePublishControls();
}

function renderEmptyVisualSteps() {
  const controls = getBuildStepControls();
  els.visualStepList.innerHTML = `<div class="visual-step-empty"><strong>Your guide will appear here</strong><span>${
    isAcaciaMode()
      ? "Accept a kit-aware path and I’ll show one exact registered connection at a time."
      : "Once I read the photo, I’ll show one clear move at a time."
  }</span></div>`;
  restoreBuildStepControls(controls);
  if (els.buildStepCounter) els.buildStepCounter.textContent = "Move 0 of 0";
  if (els.buildStepDots) els.buildStepDots.innerHTML = "";
  if (els.prevBuildStepButton) els.prevBuildStepButton.disabled = true;
  if (els.nextBuildStepButton) els.nextBuildStepButton.disabled = true;
}

function renderPlan() {
  const plan = state.plan;
  if (!plan) return renderEmptyPlan();

  drawPartsCanvas();
  renderBoardConfidence(plan);
  els.partsList.innerHTML = "";
  if (els.partsCountLabel) {
    els.partsCountLabel.textContent = `${plan.parts.length} ${plan.parts.length === 1 ? "part" : "parts"} found`;
  }
  plan.parts.forEach((part) => {
    const row = document.createElement("div");
    row.className = "item-row";
    row.innerHTML = `<strong></strong><span></span>`;
    row.querySelector("strong").textContent = part.name;
    const support = String(part.compatibilityStatus || "").replaceAll("_", " ");
    row.querySelector("span").textContent = plan.verificationSource === "program_registry"
      ? `${part.role} · ${part.pool === "shared" ? "Borrow from Acacia" : "Core team kit"}${support ? ` · ${support}` : ""}`
      : `${part.role} · ${Math.round((part.confidence || 0) * 100)}% confidence${support ? ` · ${support}` : ""}`;
    els.partsList.append(row);
  });
  if (!plan.parts.length) renderEmptyPlan();

  els.wiringList.innerHTML = "";
  plan.wiringSteps.forEach((step) => {
    const item = document.createElement("li");
    item.innerHTML = `<strong></strong><span></span>`;
    item.querySelector("strong").textContent = `${step.order}. ${step.title}`;
    item.querySelector("span").textContent = `${wireDescription(step)}. ${step.action} Check: ${step.quickCheck}`;
    els.wiringList.append(item);
  });

  els.diagnosticsList.innerHTML = "";
  [...plan.diagnosticTests, ...plan.warnings.map(warningToDiagnostic)].forEach((check) => {
    const row = document.createElement("div");
    row.className = "item-row";
    row.innerHTML = `<strong></strong><span></span>`;
    row.querySelector("strong").textContent = check.name;
    const related = plan.wiringSteps.find(({ connectionId }) => connectionId === check.connectionId);
    const repair = related ? ` If it fails, open ${wireDescription(related)}.` : "";
    row.querySelector("span").textContent = `${check.purpose} Expected: ${check.expectedSerial}.${repair}`;
    els.diagnosticsList.append(row);
  });

  state.planIssues = validateBeginnerPlan(plan);
  renderPreparation();
  renderWireLegend();
  renderVisualSteps();
  renderOperatingGuide();
  renderFlashState(state.flashStatus === "success" ? "success" : state.flashPhase || "cable");
  state.readme = buildReadme();
  els.readmePreview.textContent = state.readme;
  if (els.projectTitlePreview) els.projectTitlePreview.textContent = plan.projectTitle;
  updatePublishControls();
}

function renderBoardConfidence(plan) {
  if (!els.boardConfidence || !els.boardConfidenceValue || !els.boardConfidenceDetail) return;
  const assessment = esp32IdentityAssessment(plan);
  if (assessment.reason === "registry-sourced") {
    els.boardConfidence.hidden = false;
    els.boardConfidence.dataset.result = "pass";
    els.boardConfidenceValue.textContent = "Acacia N16R8 profile selected";
    els.boardConfidenceDetail.textContent =
      "The guide targets Acacia’s documented Waveshare carrier. Match the SKU and every printed pin label; bench qualification is still pending.";
    return;
  }
  const hasScore = assessment.percent !== null;
  els.boardConfidence.hidden = false;
  els.boardConfidence.dataset.result = assessment.accepted ? "pass" : "needs-photo";
  els.boardConfidenceValue.textContent = !hasScore
    ? "ESP32 score unavailable"
    : assessment.reason === "missing-candidate"
      ? `${assessment.percent}% score · ESP32 not confirmed`
      : `${assessment.percent}% ESP32 match`;
  if (assessment.accepted) {
    els.boardConfidenceDetail.textContent = `Passes the ${assessment.thresholdPercent}% identity minimum. Exact layout and pin labels are still checked separately.`;
  } else if (assessment.reason === "below-threshold") {
    els.boardConfidenceDetail.textContent = `Below the ${assessment.thresholdPercent}% minimum. Make the ESP32 label, metal module, USB connector, and board buttons clearer.`;
  } else if (hasScore) {
    els.boardConfidenceDetail.textContent = "I got a board-family score, but could not tie it to one visible ESP32. Try one closer board photo.";
  } else {
    els.boardConfidenceDetail.textContent = `I need both an ESP32 candidate and a confidence score of at least ${Math.round(ESP32_IDENTITY_CONFIDENCE_THRESHOLD * 100)}%.`;
  }
}

function warningToDiagnostic(warning) {
  return {
    name: "Warning",
    purpose: warning,
    userAction: "Review before wiring.",
    expectedSerial: "Manual review required.",
  };
}

function renderPreparation() {
  const plan = state.plan;
  if (!plan) return;
  const detectedProfile = selectBoardProfile(plan);
  const fallbackGuide = boardHumanGuide(detectedProfile?.id || "esp32");
  const profile = plan.boardProfile || {};
  const boardIdentity = esp32IdentityAssessment(plan);
  const supportStatus = profile.supportStatus || fallbackGuide.supportStatus;
  const supportLabels = {
    exactly_supported: "Exact layout confirmed",
    compatible_with_differences: "Compatible—match printed labels",
    unverified: "Board layout not verified",
  };
  if (els.boardSupportBadge) {
    els.boardSupportBadge.textContent = supportLabels[supportStatus] || supportLabels.unverified;
    els.boardSupportBadge.dataset.support = supportStatus;
  }
  const boardName = [profile.manufacturer, profile.model, profile.revision]
    .filter((value) => value && !/^unknown|unconfirmed$/i.test(value))
    .join(" · ");
  if (els.boardIdentity) {
    const confidenceLabel = boardIdentity.reason === "registry-sourced"
      ? "Documented Acacia carrier profile selected; printed-label check still required"
      : boardIdentity.percent === null
        ? "ESP32 identity score unavailable"
        : `${boardIdentity.percent}% ESP32-family confidence (${boardIdentity.thresholdPercent}% minimum)`;
    els.boardIdentity.textContent = `${boardName || detectedProfile?.label || "ESP32 board"}. ${confidenceLabel}. Reset is printed ${profile.resetLabel || fallbackGuide.resetLabel}; BOOT is printed ${profile.bootLabel || fallbackGuide.bootLabel}.`;
  }
  if (els.usbCableGuide) {
    const cable = plan.preparation?.usbCable || "Use a confirmed USB data cable.";
    const connector = profile.usbConnector || fallbackGuide.usbConnector;
    const powerPlan = plan.powerPlan || {};
    const buildsOnUsbBeforeUntetheredUse =
      powerPlan.reason === "untethered_requested" && !powerPlan.externalPowerRequired;
    if (els.powerSourceTitle) {
      els.powerSourceTitle.textContent = powerPlan.externalPowerRequired
        ? "USB powers the ESP32"
        : buildsOnUsbBeforeUntetheredUse
          ? "Build over USB — portable power can come later"
          : "Powered by USB — no battery needed";
    }
    const disconnectInstruction = powerPlan.externalPowerRequired
      ? "Leave both USB and the separate load supply disconnected while moving jumper wires; connect USB for loading, and energize the load only after its supply path and shared ground match the guide."
      : "Leave USB unplugged while moving jumper wires, then connect it for loading and use.";
    els.usbCableGuide.textContent = `${powerPlan.explanation || "The USB data cable powers the ESP32 while it stays connected."} Use ${cable}; ${disconnectInstruction} Board connector: ${connector}.`;
  }
  if (els.usbCableName) els.usbCableName.textContent = plan.preparation?.usbCable || "the confirmed USB data cable";
  if (els.boardUsbPort) els.boardUsbPort.textContent = profile.usbConnector || fallbackGuide.usbConnector;
  if (els.usbPowerLoadNote) {
    const powerPlan = plan.powerPlan || {};
    els.usbPowerLoadNote.textContent = powerPlan.externalPowerRequired
      ? "This cable powers the ESP32 and loads its instructions. The separate load supply must be confirmed and wired with the shared ground before you run the load."
      : powerPlan.reason === "untethered_requested"
        ? "This cable powers the ESP32 and the build while you make and test it. Choose portable power only when you are ready to run it unplugged."
        : "This one cable powers the ESP32 and this build while it loads the instructions. Keep it connected to keep the project running.";
  }

  if (els.cableInventoryList) {
    els.cableInventoryList.innerHTML = "";
    const wires = plan.preparation?.wires || [];
    for (const wire of wires) {
      const step = plan.wiringSteps.find(({ connectionId }) => connectionId === wire.connectionId);
      const item = document.createElement("li");
      item.textContent = `${wire.color || step?.wireColor || "One"} ${wire.connectorType || step?.wireType || "jumper wire"} · ${wireDescription(step || {})}`;
      els.cableInventoryList.append(item);
    }
    if (!wires.length) {
      const item = document.createElement("li");
      item.textContent = state.planIssues.some(({ code }) => code === "missing-wiring-steps")
        ? plan.verificationSource === "program_registry"
          ? "No registry-validated jumper-wire map is available for this route."
          : "No safe jumper-wire map was confirmed from this photo."
        : "No jumper wires are needed for this board-only build.";
      els.cableInventoryList.append(item);
    }
  }

  if (els.planIssues) {
    els.planIssues.innerHTML = "";
    for (const planIssue of state.planIssues) {
      const item = document.createElement("p");
      item.className = `plan-issue plan-issue--${planIssue.severity}`;
      item.textContent = `${planIssue.severity === "block" ? "Fix before building: " : "Heads-up — you can continue: "}${planIssue.message}`;
      els.planIssues.append(item);
    }
    els.planIssues.hidden = state.planIssues.length === 0;
  }
  updatePreparationControls();
}

function updatePreparationControls() {
  const hasPlan = Boolean(state.plan);
  const hasBlocker = state.planIssues.some(({ severity }) => severity === "block");
  const hasProjectBlocker = state.planIssues.some(issueBlocksFirmware);
  const hasWiringSteps = Boolean(state.plan?.wiringSteps?.length);
  const isBoardOnly = hasPlan && !hasWiringSteps && !hasBlocker;
  if (els.preparationConfirmationText) {
    const hasEchoAdvisory = state.planIssues.some(({ code }) => code === "unconfirmed-echo-voltage");
    els.preparationConfirmationText.textContent = isBoardOnly
      ? "My board and USB data cable are ready."
      : hasEchoAdvisory
        ? "I read the ECHO voltage note, and my board, USB cable, and wires are ready."
        : "I have these parts and my wire ends match the guide.";
  }
  if (els.beginAssemblyButton) {
    els.beginAssemblyButton.disabled = !hasPlan || !state.preparationConfirmed || hasBlocker;
    els.beginAssemblyButton.textContent = hasBlocker
      ? hasProjectBlocker
        ? "Confirm the board first"
        : "Wiring needs one more detail"
      : hasWiringSteps
        ? "Start connection 1"
        : "No wiring needed — continue to load";
  }
  if (els.showWiringButton) {
    els.showWiringButton.hidden = isBoardOnly;
    els.showWiringButton.disabled = isBoardOnly;
  }
  if (els.showCodeButton) {
    els.showCodeButton.disabled = !canOpenCodeWorkspace();
  }
}

function issueBlocksFirmware(issue = {}) {
  return issue.severity === "block" && FIRMWARE_BLOCKING_PLAN_ISSUES.has(issue.code);
}

function canOpenCodeWorkspace() {
  if (!state.plan || state.planIssues.some(issueBlocksFirmware)) return false;
  const hasAssemblyBlocker = state.planIssues.some(({ severity }) => severity === "block");
  const connectionCount = state.plan.wiringSteps?.length || 0;
  return hasAssemblyBlocker || state.completedConnectionIds.size >= connectionCount;
}

function beginAssembly() {
  state.preparationConfirmed = Boolean(els.preparationConfirmed?.checked);
  const blocker = state.planIssues.find(({ severity }) => severity === "block");
  if (blocker) {
    setStatus(els.esp32Status, `The project can continue to code, but this wiring detail needs attention: ${blocker.message}`, "warn");
    els.planIssues?.scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }
  if (!state.preparationConfirmed) {
    els.preparationConfirmed?.focus();
    return;
  }
  if (!state.plan?.wiringSteps?.length) {
    setBuildMode("code");
    return;
  }
  state.activeBuildStepIndex = 0;
  setBuildMode("wiring");
  renderVisualSteps();
}

function renderWireLegend() {
  if (!els.wireLegend) return;
  els.wireLegend.innerHTML = "";
  for (const step of state.plan?.wiringSteps || []) {
    const item = document.createElement("div");
    item.className = "wire-legend-item";
    item.dataset.connectionId = step.connectionId;
    item.innerHTML = "<i aria-hidden=\"true\"></i><span></span>";
    item.querySelector("i").style.setProperty("--wire-color", stepColor(step.wireColor, step.order - 1));
    item.querySelector("span").textContent = wireDescription(step);
    els.wireLegend.append(item);
  }
}

function renderVisualSteps() {
  if (!els.visualStepList) return;
  const plan = state.plan;
  if (!plan?.wiringSteps?.length) {
    renderEmptyVisualSteps();
    return;
  }

  const steps = plan.wiringSteps;
  const activeIndex = clamp(state.activeBuildStepIndex, 0, steps.length - 1);
  state.activeBuildStepIndex = activeIndex;
  const step = steps[activeIndex];

  restoreBuildStepControls();
  els.visualStepList.innerHTML = "";
  const card = document.createElement("div");
  card.className = "visual-step-card is-active";
  const photo = document.createElement("div");
  photo.className = "step-photo-pane";
  const registryPlan = plan.verificationSource === "program_registry";
  let canvas = null;
  let reference = null;
  if (registryPlan) {
    photo.classList.add("step-photo-pane--registry");
    const connectionMap = document.createElement("div");
    connectionMap.className = "registry-connection-map";
    connectionMap.innerHTML = `
      <span class="registry-map-source">Acacia kit registry · connection ${activeIndex + 1}</span>
      <div class="registry-map-route">
        <div><small>Start at</small><strong data-registry-from></strong><span data-registry-from-pin></span></div>
        <i aria-hidden="true">→</i>
        <div><small>Connect to</small><strong data-registry-to></strong><span data-registry-to-pin></span></div>
      </div>
      <p>Match the printed labels exactly. The route is registry-backed, so no photo confidence or guessed pin position is being used.</p>
    `;
    const fromPart = plan.parts.find(({ id }) => id === step.fromPartId);
    const toPart = plan.parts.find(({ id }) => id === step.toPartId);
    connectionMap.querySelector("[data-registry-from]").textContent = fromPart?.name || step.from;
    connectionMap.querySelector("[data-registry-from-pin]").textContent = step.fromPrintedPin;
    connectionMap.querySelector("[data-registry-to]").textContent = toPart?.name || step.to;
    connectionMap.querySelector("[data-registry-to-pin]").textContent = step.toPrintedPin;
    photo.append(connectionMap);
  } else {
    canvas = document.createElement("canvas");
    canvas.setAttribute("aria-label", `Photo showing connection ${activeIndex + 1}`);
    reference = document.createElement("aside");
    reference.className = "pin-reference";
    reference.innerHTML = `<span>Your photo · exact receptacles</span><div class="pin-reference-views"><figure><canvas data-pin-side="from"></canvas><figcaption></figcaption></figure><i aria-hidden="true">→</i><figure><canvas data-pin-side="to"></canvas><figcaption></figcaption></figure></div><p></p>`;
    reference.querySelector("[data-pin-side='from']").setAttribute("aria-label", `Close-up of ${step.fromPrintedPin} in your photo`);
    reference.querySelector("[data-pin-side='to']").setAttribute("aria-label", `Close-up of ${step.toPrintedPin} in your photo`);
    reference.querySelectorAll("figcaption")[0].textContent = step.fromPrintedPin;
    reference.querySelectorAll("figcaption")[1].textContent = step.toPrintedPin;
    reference.querySelector("p").textContent = state.imageElement
      ? "These are crops from your photo—not a guessed board layout. Match the highlighted metal pin or hole, then read the printed label once more."
      : "The exact crops appear here when the parts photo is available.";
    photo.append(canvas, reference);
  }
  const copy = document.createElement("div");
  copy.className = "visual-step-copy";
  const meta = document.createElement("p");
  const title = document.createElement("strong");
  const route = document.createElement("span");
  const body = document.createElement("span");
  meta.className = "step-copy-kicker";
  title.className = "step-copy-title";
  route.className = "step-copy-route";
  body.className = "step-copy-instruction";
  meta.textContent = `Connection ${activeIndex + 1} of ${steps.length}`;
  title.textContent = wireDescription(step);
  route.textContent = `${step.fromPrintedPin} → ${step.toPrintedPin}`;
  body.textContent = step.action;
  copy.append(meta, title, route, body);
  const aliases = [step.fromElectricalAlias, step.toElectricalAlias].filter(Boolean);
  if (aliases.length) {
    const alias = document.createElement("p");
    alias.className = "step-copy-alias";
    alias.textContent = `Electrical name: ${aliases.join(" → ")}. Follow the printed labels above.`;
    copy.append(alias);
  }
  if (step.quickCheck) {
    const check = document.createElement("aside");
    const checkLabel = document.createElement("span");
    const checkText = document.createElement("p");
    check.className = "step-copy-tip";
    checkLabel.className = "step-copy-tip-label";
    checkText.className = "step-copy-tip-text";
    checkLabel.textContent = "Quick check";
    checkText.textContent = step.quickCheck;
    check.append(checkLabel, checkText);
    copy.append(check);
  }
  const connectionAdvisories = state.planIssues.filter(
    ({ severity, connectionId }) => severity === "warn" && connectionId === step.connectionId,
  );
  const stepWarningRepeatsEchoAdvisory = connectionAdvisories.some(
    ({ code }) => code === "unconfirmed-echo-voltage" && /(?:echo|3\.6\s*v|5\s*v)/i.test(step.warning || ""),
  );
  if (step.warning && !stepWarningRepeatsEchoAdvisory) {
    const warning = document.createElement("aside");
    warning.className = "step-copy-warning";
    warning.innerHTML = "<strong>Heads-up</strong><p></p>";
    warning.querySelector("p").textContent = step.warning;
    copy.append(warning);
  }
  for (const advisory of connectionAdvisories) {
    const warning = document.createElement("aside");
    warning.className = "step-copy-warning";
    warning.innerHTML = "<strong>You can continue</strong><p></p>";
    warning.querySelector("p").textContent = advisory.message;
    copy.append(warning);
  }
  if (step.why) {
    const why = document.createElement("details");
    why.className = "step-copy-why";
    why.innerHTML = "<summary>Why this connection?</summary><p></p>";
    why.querySelector("p").textContent = step.why;
    copy.append(why);
  }
  if (els.wireLegend) {
    els.wireLegend.classList.add("is-inline");
    copy.append(els.wireLegend);
  }
  const controls = getBuildStepControls();
  if (controls) {
    controls.classList.add("is-inline");
  }
  card.append(photo, copy);
  els.visualStepList.append(card);
  restoreBuildStepControls(controls);

  if (els.buildStepCounter) els.buildStepCounter.textContent = `Connection ${activeIndex + 1} of ${steps.length}`;
  renderBuildStepDots(steps.length, activeIndex);
  if (els.prevBuildStepButton) els.prevBuildStepButton.disabled = activeIndex === 0;
  if (els.nextBuildStepButton) {
    els.nextBuildStepButton.disabled = false;
    els.nextBuildStepButton.textContent = activeIndex === steps.length - 1 ? "All wires connected" : "I connected it";
  }

  if (canvas && reference) {
    requestAnimationFrame(() => {
      drawVisualStep(canvas, step, activeIndex);
      drawPinReference(reference.querySelector("[data-pin-side='from']"), step.fromPinBbox, step.fromPrintedPin, "#4f46e5");
      drawPinReference(reference.querySelector("[data-pin-side='to']"), step.toPinBbox, step.toPrintedPin, stepColor(step.wireColor, activeIndex));
    });
  }
}

function getBuildStepControls() {
  return document.querySelector("#flash .carousel-controls");
}

function restoreBuildStepControls(controls = getBuildStepControls()) {
  const panel = document.querySelector("#flash .visual-guide-panel");
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
    const connectionId = state.plan?.wiringSteps?.[index]?.connectionId;
    dot.className = [index === activeIndex ? "is-active" : "", state.completedConnectionIds.has(connectionId) ? "is-complete" : ""]
      .filter(Boolean)
      .join(" ");
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
  const step = state.plan.wiringSteps[state.activeBuildStepIndex];
  if (step?.connectionId) state.completedConnectionIds.add(step.connectionId);
  if (state.activeBuildStepIndex >= count - 1) {
    if (els.showCodeButton) els.showCodeButton.disabled = false;
    setBuildMode("code");
    return;
  }
  setActiveBuildStep(state.activeBuildStepIndex + 1);
}

function setBuildMode(mode) {
  const resolvedMode = mode === "wiring" && !state.preparationConfirmed ? "prepare" : mode;
  const showPreparation = resolvedMode === "prepare";
  const showCode = resolvedMode === "code";
  if (showCode && !canOpenCodeWorkspace()) return;
  if (els.buildPreparation) els.buildPreparation.hidden = !showPreparation;
  if (els.wiringWorkspace) els.wiringWorkspace.hidden = showPreparation || showCode;
  if (els.codeWorkspace) els.codeWorkspace.hidden = !showCode;
  els.showWiringButton?.classList.toggle("is-active", !showPreparation && !showCode);
  els.showCodeButton?.classList.toggle("is-active", showCode);
  els.showWiringButton?.setAttribute("aria-selected", String(!showPreparation && !showCode));
  els.showCodeButton?.setAttribute("aria-selected", String(showCode));
  if (!showPreparation && !showCode) requestAnimationFrame(renderVisualSteps);
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

  ctx.save();
  ctx.fillStyle = "rgba(99, 102, 241, 0.08)";
  ctx.fillRect(fit.x, fit.y, fit.width, fit.height);
  ctx.restore();

  if (fromPart) drawStepPartFrame(ctx, fit, fromPart, "#4f46e5");
  if (toPart && toPart !== fromPart) drawStepPartFrame(ctx, fit, toPart, color);

  const fromPinBox = photoCoordinateBox(step.fromPinBbox, fit);
  const toPinBox = photoCoordinateBox(step.toPinBbox, fit);
  if (fromPinBox && toPinBox) {
    const fromCenter = rectCenter(fromPinBox);
    const toCenter = rectCenter(toPinBox);
    const fromPoint = pointOnRectEdge(fromPinBox, toCenter);
    const toPoint = pointOnRectEdge(toPinBox, fromCenter);
    drawArrow(ctx, fromPoint.x, fromPoint.y, toPoint.x, toPoint.y, color);
    drawExactPinFrame(ctx, fromPinBox, "#4f46e5");
    drawExactPinFrame(ctx, toPinBox, color);
  }

  if (fromPart) drawStepPartLabel(ctx, fit, fromPart, "#4f46e5", placedBadges);
  if (toPart && toPart !== fromPart) drawStepPartLabel(ctx, fit, toPart, color, placedBadges);

  if (fromPinBox && toPinBox) {
    drawPlacedStepBadge(ctx, cleanPinLabel(step.fromPrintedPin || "start"), fromPinBox, fit, "#4f46e5", placedBadges);
    drawPlacedStepBadge(ctx, cleanPinLabel(step.toPrintedPin || step.pin || "target"), toPinBox, fit, color, placedBadges);
  } else {
    drawPlacedStepBadge(
      ctx,
      cleanPinLabel(step.toPrintedPin || step.pin || step.from || "wire"),
      anchorBox(fit.x + fit.width / 2, fit.y + 28),
      fit,
      color,
      placedBadges,
    );
  }
}

function normalizedPhotoBbox(bbox) {
  if (!bbox || typeof bbox !== "object") return null;
  const values = [bbox.x, bbox.y, bbox.width, bbox.height].map(Number);
  if (!values.every(Number.isFinite)) return null;
  const scale = Math.max(...values) > 100 ? 0.1 : 1;
  const [x, y, width, height] = values.map((value) => value * scale);
  if (x < 0 || y < 0 || width <= 0 || height <= 0 || x + width > 100 || y + height > 100) return null;
  return { x, y, width, height };
}

function photoCoordinateBox(bbox, fit) {
  const normalized = normalizedPhotoBbox(bbox);
  if (!normalized || !fit) return null;
  return {
    x: fit.x + (normalized.x / 100) * fit.width,
    y: fit.y + (normalized.y / 100) * fit.height,
    width: (normalized.width / 100) * fit.width,
    height: (normalized.height / 100) * fit.height,
  };
}

function drawExactPinFrame(ctx, box, color) {
  const padding = 5;
  ctx.save();
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 8;
  ctx.strokeRect(box.x - padding, box.y - padding, box.width + padding * 2, box.height + padding * 2);
  ctx.strokeStyle = color;
  ctx.lineWidth = 4;
  ctx.strokeRect(box.x - padding, box.y - padding, box.width + padding * 2, box.height + padding * 2);
  ctx.fillStyle = `${color}26`;
  ctx.fillRect(box.x - padding, box.y - padding, box.width + padding * 2, box.height + padding * 2);
  ctx.restore();
}

function drawPinReference(canvas, bbox, label, color) {
  if (!canvas) return;
  const { ctx, width, height } = prepareCanvas(canvas);
  const normalized = normalizedPhotoBbox(bbox);
  const image = state.imageElement;
  ctx.fillStyle = "#f3f0e9";
  ctx.fillRect(0, 0, width, height);
  if (!image || !normalized) {
    ctx.fillStyle = "#5f5a53";
    ctx.font = "700 13px Inter, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(label || "Pin", width / 2, height / 2 + 5);
    return;
  }

  const imageWidth = image.naturalWidth;
  const imageHeight = image.naturalHeight;
  const pin = {
    x: (normalized.x / 100) * imageWidth,
    y: (normalized.y / 100) * imageHeight,
    width: (normalized.width / 100) * imageWidth,
    height: (normalized.height / 100) * imageHeight,
  };
  const cropSize = Math.min(
    imageWidth,
    imageHeight,
    Math.max(pin.width * 6, pin.height * 6, Math.min(imageWidth, imageHeight) * 0.14),
  );
  const cropX = clamp(pin.x + pin.width / 2 - cropSize / 2, 0, imageWidth - cropSize);
  const cropY = clamp(pin.y + pin.height / 2 - cropSize / 2, 0, imageHeight - cropSize);
  ctx.drawImage(image, cropX, cropY, cropSize, cropSize, 0, 0, width, height);

  const scaleX = width / cropSize;
  const scaleY = height / cropSize;
  const highlighted = {
    x: (pin.x - cropX) * scaleX,
    y: (pin.y - cropY) * scaleY,
    width: Math.max(8, pin.width * scaleX),
    height: Math.max(8, pin.height * scaleY),
  };
  drawExactPinFrame(ctx, highlighted, color);
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
  ctx.strokeStyle = color;
  ctx.lineWidth = 4;
  ctx.strokeRect(box.x, box.y, box.width, box.height);
  ctx.fillStyle = "rgba(99, 102, 241, 0.12)";
  ctx.fillRect(box.x, box.y, box.width, box.height);
  ctx.restore();
}

function drawStepPartLabel(ctx, fit, part, color, placedBadges) {
  const box = partBox(part, fit);
  drawPlacedStepBadge(ctx, shortPartLabel(part.name), box, fit, color, placedBadges);
}

function drawArrow(ctx, fromX, fromY, toX, toY, color) {
  const angle = Math.atan2(toY - fromY, toX - fromX);
  const headLength = 16;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 5;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(fromX, fromY);
  ctx.lineTo(toX, toY);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(toX, toY);
  ctx.lineTo(toX - headLength * Math.cos(angle - Math.PI / 6), toY - headLength * Math.sin(angle - Math.PI / 6));
  ctx.lineTo(toX - headLength * Math.cos(angle + Math.PI / 6), toY - headLength * Math.sin(angle + Math.PI / 6));
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function anchorBox(centerX, centerY) {
  return {
    x: centerX - 3,
    y: centerY - 3,
    width: 6,
    height: 6,
  };
}

function cleanPinLabel(value) {
  const text = String(value || "wire").trim();
  return text.replace(/\s+/g, " ").slice(0, 18);
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
  ctx.fillStyle = paleBadge ? "rgba(255,255,255,0.92)" : color;
  ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
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
  const voiceEpoch = ++state.voiceEpoch;

  try {
    const accessToken = await getAccessToken();
    if (state.voiceEpoch !== voiceEpoch) return;
    const apiBase = String(serverConfig.apiBaseUrl || window.location.origin).replace(/\/$/, "");
    const url = new URL(`${apiBase}/api/deepgram/listen`);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.searchParams.set("model", "nova-3");
    url.searchParams.set("smart_format", "true");
    url.searchParams.set("interim_results", "true");
    url.searchParams.set("endpointing", "500");
    url.searchParams.set("utterance_end_ms", "1000");
    url.searchParams.set("vad_events", "true");

    const socket = new WebSocket(url, ["makeable", accessToken]);
    state.deepgramSocket = socket;
    socket.onopen = async () => {
      if (state.voiceEpoch !== voiceEpoch || state.deepgramSocket !== socket) {
        socket.close();
        return;
      }
      const voiceStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (state.voiceEpoch !== voiceEpoch || state.deepgramSocket !== socket) {
        voiceStream.getTracks().forEach((track) => track.stop());
        socket.close();
        return;
      }
      state.voiceStream = voiceStream;
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
    socket.onmessage = (message) => {
      if (state.voiceEpoch === voiceEpoch && state.deepgramSocket === socket) {
        handleDeepgramMessage(message.data);
      }
    };
    socket.onerror = () => {
      if (state.voiceEpoch === voiceEpoch) setVoiceStatus("Voice paused", "danger");
    };
    socket.onclose = () => {
      if (state.voiceEpoch !== voiceEpoch) return;
      if (els.stopVoiceButton.disabled === false) setVoiceStatus("Stopped", "warn");
    };
  } catch (error) {
    console.error(error);
    if (state.voiceEpoch !== voiceEpoch) return;
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
    handleIdeaChange();
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
  state.voiceEpoch += 1;
  const socket = state.deepgramSocket;
  const recorder = state.voiceRecorder;
  const stream = state.voiceStream;
  state.voiceRecorder = null;
  state.voiceStream = null;
  state.deepgramSocket = null;
  try {
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "Finalize" }));
      socket.send(JSON.stringify({ type: "CloseStream" }));
    }
  } catch {
    // Best effort finalization.
  }
  try {
    if (recorder?.state !== "inactive") recorder?.stop();
  } catch {
    // The recorder may already be stopping.
  }
  stream?.getTracks().forEach((track) => track.stop());
  socket?.close();
  els.startVoiceButton.disabled = false;
  els.stopVoiceButton.disabled = true;
  setVoiceStatus("Ready", "");
}

function setVoiceStatus(text, tone) {
  els.voiceStatus.textContent = text;
  els.voiceStatus.className = `status-pill ${tone || ""}`.trim();
}

async function connectSerial() {
  if (!("serial" in navigator)) {
    setStatus(els.logEvaluation, "This browser can’t listen to the board. Use Chrome or Edge on desktop.", "danger");
    return;
  }

  const serialEpoch = ++state.serialEpoch;
  try {
    beginAutomaticTestAttempt();
    const port = await findOrRequestEspPort();
    if (state.serialEpoch !== serialEpoch) return;
    await port.open({ baudRate: Number(els.baudRateInput.value) || 115200 });
    if (state.serialEpoch !== serialEpoch) {
      await port.close().catch(() => {});
      return;
    }
    state.serialPort = port;
    els.connectSerialButton.disabled = true;
    els.disconnectSerialButton.disabled = false;
    els.sendSerialButton.disabled = false;
    els.evaluateLogsButton.disabled = false;
    appendSerial("Makeable: I’m listening now. If the board speaks, you’ll see it here.\n");
    state.diagnosticLogOffset = state.serialLog.length;
    state.automaticTestStatus = "pending";
    state.diagnosticFailure = null;
    renderDiagnosticFailure();
    setStatus(els.logEvaluation, "Connected. Waiting for the board to say something.", "ok");
    readSerialLoop(serialEpoch, port);
  } catch (error) {
    console.error(error);
    if (state.serialEpoch === serialEpoch) {
      setStatus(els.logEvaluation, `I couldn’t connect yet: ${error.message}`, "danger");
    }
  }
}

async function readSerialLoop(serialEpoch, port) {
  const decoder = new TextDecoderStream();
  state.serialReadableClosed = port.readable.pipeTo(decoder.writable).catch(() => {});
  const reader = decoder.readable.getReader();
  state.serialReader = reader;

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value && state.serialEpoch === serialEpoch && state.serialPort === port) appendSerial(value);
    }
  } catch (error) {
    if (state.serialEpoch === serialEpoch) appendSerial(`\n[serial read stopped] ${error.message}\n`);
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // The port may already have released the reader while disconnecting.
    }
    if (state.serialEpoch === serialEpoch && state.serialReader === reader) state.serialReader = null;
  }
}

async function disconnectSerial({ announce = true } = {}) {
  const disconnectEpoch = ++state.serialEpoch;
  const reader = state.serialReader;
  const readableClosed = state.serialReadableClosed;
  const port = state.serialPort;
  state.serialReader = null;
  state.serialReadableClosed = null;
  state.serialPort = null;
  els.connectSerialButton.disabled = false;
  els.disconnectSerialButton.disabled = true;
  els.sendSerialButton.disabled = true;

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
  if (announce && state.serialEpoch === disconnectEpoch) {
    appendSerial("Makeable: I stopped listening to the board.\n");
  }
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
  beginAutomaticTestAttempt();
  state.automaticTestStatus = "pending";
  const freshLog = state.serialLog.slice(state.diagnosticLogOffset).trim();
  const resetLabel = state.plan?.boardProfile?.resetLabel || "RESET / EN";
  if (!freshLog) {
    state.automaticTestStatus = "pending";
    setStatus(
      els.logEvaluation,
      `No fresh board message yet. Press the button printed ${resetLabel} once—not BOOT—then wait for a new line.`,
      "warn",
    );
    updatePublishControls();
    return;
  }

  const failure = findDiagnosticFailure(freshLog, state.plan);
  if (failure) {
    state.automaticTestStatus = "fail";
    state.diagnosticFailure = failure;
    renderDiagnosticFailure();
    setStatus(els.logEvaluation, `${failure.title} I linked it to one repair below.`, "danger");
  } else {
    const expected = state.plan?.diagnosticTests || [];
    const hits = expectedDiagnosticHits(freshLog, expected);
    const passed = expected.length
      ? hits.length === expected.length
      : /ready|ok|pass|sensor|boot|connected/i.test(freshLog);
    if (passed) {
      state.automaticTestStatus = "pass";
      state.diagnosticFailure = null;
      renderDiagnosticFailure();
      setStatus(
        els.logEvaluation,
        expected.length
          ? `Board check passed. I found all ${expected.length} expected fresh message${expected.length === 1 ? "" : "s"}.`
          : "Board check passed. The board is awake and reporting a healthy state.",
        "ok",
      );
    } else {
      state.automaticTestStatus = "pending";
      setStatus(
        els.logEvaluation,
        "The board is talking, but not all expected messages are here yet. Operate the project once, then check only the new messages again.",
        "warn",
      );
    }
  }
  updatePublishControls();
}

function renderDiagnosticFailure() {
  if (!els.diagnosticRepairCard) return;
  const failure = state.diagnosticFailure;
  els.diagnosticRepairCard.hidden = !failure;
  if (!failure) return;
  els.diagnosticRepairTitle.textContent = failure.title;
  els.diagnosticConnection.textContent = failure.connectionId
    ? `${wireDescription(failure)}. ${failure.recoveryAction}`
    : failure.recoveryAction;
  els.diagnosticEvidence.textContent = failure.evidence;
  els.openRepairButton.hidden = !failure.connectionId;
}

function openDiagnosticConnection() {
  const connectionId = state.diagnosticFailure?.connectionId;
  if (!connectionId || !state.plan) return;
  const index = state.plan.wiringSteps.findIndex((step) => step.connectionId === connectionId);
  if (index < 0) return;
  state.preparationConfirmed = true;
  if (els.preparationConfirmed) els.preparationConfirmed.checked = true;
  setActiveWorkflowStage(2);
  setBuildMode("wiring");
  setActiveBuildStep(index);
  requestAnimationFrame(() => els.visualStepList?.scrollIntoView({ behavior: "smooth", block: "start" }));
}

function prepareDiagnosticRetry() {
  beginAutomaticTestAttempt();
  state.diagnosticLogOffset = state.serialLog.length;
  state.diagnosticFailure = null;
  state.automaticTestStatus = "pending";
  renderDiagnosticFailure();
  const resetLabel = state.plan?.boardProfile?.resetLabel || "RESET / EN";
  const bootLabel = state.plan?.boardProfile?.bootLabel || "BOOT";
  setStatus(
    els.logEvaluation,
    `Old errors are cleared from this check. Press ${resetLabel} once—not ${bootLabel}—then wait for fresh messages.`,
    "warn",
  );
  updatePublishControls();
}

function renderOperatingGuide() {
  if (!els.operatingGuide) return;
  const guide = state.plan?.operatingGuide;
  if (!guide) {
    els.operatingGuide.innerHTML = "<p>Finish the guide and I’ll put the exact operating steps here.</p>";
    return;
  }
  els.operatingGuide.innerHTML = "";
  const summary = document.createElement("p");
  summary.className = "operating-summary";
  summary.textContent = guide.summary;
  const list = document.createElement("ol");
  for (const step of guide.steps) {
    const item = document.createElement("li");
    item.textContent = step;
    list.append(item);
  }
  const unit = document.createElement("p");
  unit.className = "operating-unit";
  unit.textContent = guide.unit
    ? `Reading unit: ${guide.unit}.`
    : "This project does not require a displayed measurement unit.";
  const reset = document.createElement("p");
  reset.className = "operating-reset";
  reset.textContent = guide.resetInstruction;
  const power = document.createElement("p");
  power.className = "operating-power";
  const powerPlan = state.plan?.powerPlan || {};
  power.textContent = powerPlan.externalPowerRequired
    ? "Keep the ESP32’s USB data cable connected while using the project. Energize the separate load supply only after its power path and shared ground have been confirmed."
    : powerPlan.reason === "untethered_requested"
      ? "Build and test with USB connected. When you later run it untethered, switch only to a compatible portable power source you have confirmed for this board."
      : "Keep the USB data cable connected while using the project; it is the power source, so no battery is needed.";
  els.operatingGuide.append(summary, list, unit, power, reset);
  if (els.manualSuccessQuestion) els.manualSuccessQuestion.textContent = guide.successQuestion;
}

function verifyBehavior(status = "pass") {
  if (status === "pass" && state.automaticTestStatus !== "pass") {
    setStatus(
      els.behaviorEvaluation,
      "First pass the fresh board-message check on the left, then confirm the real behavior.",
      "warn",
    );
    els.evaluateLogsButton?.focus();
    return;
  }
  const observation = String(els.manualObservation?.value || "").trim();
  const observations = [observation || "I followed the operating steps and observed the expected result."];
  const nextStep =
    status === "pass"
      ? "Celebrate or publish the verified build."
      : "Open the linked connection, repair it, and repeat both checks.";
  state.manualResult = { status, observations, nextStep, verificationEpoch: state.verificationEpoch };
  if (state.plan) {
    state.plan.tests = state.plan.tests || {};
    state.plan.tests.manual = {
      acknowledged: true,
      requestedAction: state.plan.operatingGuide?.successQuestion || "Did the finished project work?",
      action: status === "pass" ? "It worked." : "Help me fix it.",
      evaluation: { status, observations, nextStep },
    };
  }
  updatePublishControls();
  setStatus(
    els.behaviorEvaluation,
    status === "pass"
      ? "Manual check passed. No camera evidence was requested or required."
      : "This build is not marked complete. I’ll take you back to the exact connection to inspect.",
    status === "pass" ? "ok" : "warn",
  );
}

async function refreshEsp32Status() {
  try {
    const status = await apiJson("/api/esp32/status");
    state.compilerReady = Boolean(status.hasEsp32Compiler && status.hasEsp32Core);
    const tone = state.compilerReady ? "ok" : "warn";
    setStatus(
      els.esp32Status,
      state.compilerReady
        ? "Makeable’s ESP32 compiler is ready. Connect your board when you’re ready."
        : "The ESP32 compiler is warming up. Try again in a moment.",
      tone,
    );
    els.compileFlashButton.disabled = !state.compilerReady;
  } catch (error) {
    state.compilerReady = false;
    setStatus(els.esp32Status, `The ESP32 compiler is not ready yet: ${error.message}`, "danger");
    els.compileFlashButton.disabled = true;
  }
}

function renderFlashState(phase = "cable") {
  const normalized = ["cable", "permission", "compile", "load", "success", "error"].includes(phase)
    ? phase
    : "cable";
  state.flashPhase = normalized;
  const order = ["cable", "permission", "compile", "load"];
  const currentIndex = normalized === "success" ? order.length : Math.max(0, order.indexOf(normalized));
  els.flashStateItems.forEach((item) => {
    const itemIndex = order.indexOf(item.dataset.flashState);
    item.classList.toggle("is-current", normalized !== "success" && itemIndex === currentIndex);
    item.classList.toggle("is-complete", normalized === "success" || itemIndex < currentIndex);
  });
  const succeeded = normalized === "success";
  if (els.compileFlashButton) els.compileFlashButton.hidden = succeeded;
  if (els.testHardwareButton) els.testHardwareButton.hidden = !succeeded;
}

async function compileAndFlashFirmware() {
  const sketch = state.plan?.firmware?.sketch || "";
  if (!sketch) {
    setStatus(els.esp32Status, "Create the guide first, then I’ll have firmware to send.", "warn");
    return;
  }

  const profile = selectBoardProfile(state.plan);
  if (!profile) {
    setStatus(els.esp32Status, "Makeable supports ESP32-family boards only. Add an ESP32 to this build.", "danger");
    return;
  }

  if (!("serial" in navigator)) {
    setStatus(els.esp32Status, "This browser can’t talk to the ESP32. Use Chrome or Edge on desktop.", "danger");
    return;
  }

  setBlockingOperation("flash", true);
  beginAutomaticTestAttempt();
  state.automaticTestStatus = "pending";
  els.compileFlashButton.disabled = true;
  els.compileFlashButton.textContent = "Choose your ESP32";
  renderFlashState("permission");
  setFlashProgress(null, "Waiting for browser permission");
  state.flashStatus = "idle";
  setStatus(
    els.esp32Status,
    "Your browser will show a device chooser now. Select the ESP32 you just connected; this permission stays in this browser.",
    "warn",
  );
  updatePublishControls();

  let port;
  try {
    if (state.serialPort) await disconnectSerial();
    port = await findOrRequestEspPort();
  } catch (error) {
    renderFlashState("cable");
    els.compileFlashButton.disabled = false;
    els.compileFlashButton.textContent = "Choose my ESP32";
    setStatus(els.esp32Status, `No problem. Choose the ESP32 again when you’re ready. ${error.message}`, "warn");
    setFlashProgress(0, "Waiting to connect");
    setBlockingOperation("flash", false);
    return;
  }

  try {
    els.compileFlashButton.textContent = "Preparing code...";
    renderFlashState("compile");
    setFlashProgress(null, "Preparing and checking firmware");
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
    updatePublishControls();
    appendSerial("Makeable: Code is ready. Now I’m sending it to the board.\n");
    if (compiled.stderr) appendSerial(`Makeable: Setup note from the compiler:\n${compiled.stderr}\n`);

    els.compileFlashButton.textContent = "Loading board...";
    renderFlashState("load");
    setFlashProgress(0, "Starting the real board loader");
    const testAdapter = globalThis.__MAKEABLE_FLASH_TEST_ADAPTER__;
    if (typeof testAdapter === "function") await testAdapter({ port, images: compiled.images, profile });
    else await flashFirmwareImages(port, compiled.images, compiled.flashConfig);
    state.flashStatus = "success";
    state.automaticTestStatus = "pending";
    state.diagnosticLogOffset = state.serialLog.length;
    renderFlashState("success");
    updatePublishControls();
    setStatus(els.esp32Status, "Firmware is on the board. The only next step is to test the real hardware.", "ok");
    setFlashProgress(100, "Firmware loaded successfully");
  } catch (error) {
    console.error(error);
    appendSerial(`\nMakeable: I couldn’t finish loading the board. ${error.message}\n`);
    setStatus(els.esp32Status, `I couldn’t finish loading the ESP32: ${error.message}`, "danger");
    setFlashProgress(0, "Needs retry");
    state.flashStatus = "error";
    renderFlashState("error");
    updatePublishControls();
  } finally {
    if (state.flashStatus !== "success") {
      els.compileFlashButton.hidden = false;
      els.compileFlashButton.disabled = false;
      els.compileFlashButton.textContent = "Try loading again";
    }
    setBlockingOperation("flash", false);
  }
}

async function findOrRequestEspPort() {
  const granted = await navigator.serial.getPorts();
  return granted[0] || navigator.serial.requestPort({ filters: USB_SERIAL_FILTERS });
}

async function flashFirmwareImages(port, images, flashConfig = {}) {
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
      flashMode: flashConfig.mode || "dio",
      flashFreq: flashConfig.frequency || "40m",
      flashSize: flashConfig.size || "4MB",
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
  const indeterminate = percent == null;
  els.flashProgress?.classList.toggle("is-indeterminate", indeterminate);
  if (indeterminate) {
    els.flashProgress?.removeAttribute("aria-valuenow");
    els.flashProgressBar.style.width = "36%";
  } else {
    const value = clamp(percent, 0, 100);
    els.flashProgress?.setAttribute("aria-valuenow", String(value));
    els.flashProgressBar.style.width = `${value}%`;
  }
  if (els.flashProgressLabel) els.flashProgressLabel.textContent = label || "";
}

function buildReadme() {
  const plan = state.plan;
  if (!plan) return "Create your guide first, then I’ll write the project notes here.";
  const generated = new Date().toISOString();
  const firmwareNotes = plan.firmware?.notes || "Review all wiring before powering the board.";
  const powerPlan = plan.powerPlan || {};
  const usagePowerNote = powerPlan.externalPowerRequired
    ? "Keep the ESP32 USB data cable connected. Do not energize the load until the separate supply power path and shared ground match the guide."
    : powerPlan.reason === "untethered_requested"
      ? "Build and test with USB connected. Portable power is only needed later if you want to run the finished project unplugged."
      : "Keep the USB data cable connected while using the finished project.";
  const powerNotes = [
    powerPlan.explanation || "The USB data cable powers the ESP32 while it stays connected.",
    `Board rail: ${powerPlan.boardRail || "use only the rail confirmed in the guide"}.`,
    usagePowerNote,
  ].join("\n\n");
  const parts = plan.parts
    .map((part) => `- **${part.name}** — ${part.role}${part.connectorType ? ` (${part.connectorType})` : ""}`)
    .join("\n");
  const wiring = plan.wiringSteps
    .map(
      (step) =>
        `${step.order}. **${wireDescription(step)}**  \n   ${step.action}  \n   Check: ${step.quickCheck}${step.warning ? `  \n   ⚠️ ${step.warning}` : ""}`,
    )
    .join("\n");
  const checks = plan.diagnosticTests
    .map((test) => {
      const related = plan.wiringSteps.find(({ connectionId }) => connectionId === test.connectionId);
      return `- **${test.name}** — ${test.userAction} Expected serial: \`${test.expectedSerial}\`.${related ? ` Repair link: ${wireDescription(related)}.` : ""}`;
    })
    .join("\n");
  const warnings = plan.warnings.length
    ? `\n## Warnings\n\n${plan.warnings.map((warning) => `- ${warning}`).join("\n")}\n`
    : "";
  const guide = plan.operatingGuide;
  const operation = [
    guide?.summary,
    ...(guide?.steps || []).map((step, index) => `${index + 1}. ${step}`),
    guide?.unit ? `Reading unit: ${guide.unit}.` : "",
    guide?.resetInstruction,
  ]
    .filter(Boolean)
    .join("\n\n");
  const alt = String(els.coverAltText?.value || "Finished Makeable hardware build")
    .replace(/[\[\]\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const media = [
    els.includeFinishedBuildPhoto?.checked ? `![${alt}](images/finished-build.svg)` : "",
    els.includeCreatorPhoto?.checked ? `![Creator with ${alt}](images/creator-and-build.svg)` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  return `# ${plan.projectTitle}

Generated by Makeable on ${generated}.

## Idea

${els.ideaText.value.trim() || plan.summary}

${media ? `## Finished build\n\n${media}\n` : ""}

## Parts

${parts || "- Parts pending."}

## Power

${powerNotes}

## Wiring

${wiring || "Wiring pending."}

## Diagnostic Checks

${checks || "- Diagnostics pending."}
${warnings}
## How to use the finished build

${operation || "Follow the operating instructions shown in Makeable."}

## Verification

- Firmware compiled: ${state.compiledFirmware ? "passed" : "not recorded"}
- Firmware loaded to board: ${state.flashStatus === "success" ? "passed" : "not recorded"}
- Fresh board-message check: ${state.automaticTestStatus}
- Manual real-world check: ${currentManualResult()?.status || "not recorded"}
- Camera evidence: not required

## Board software

Makeable securely prepares and loads the board software from the browser. No source-code download or desktop IDE is required.

## Notes

${firmwareNotes}
`;
}

function updatePublishControls() {
  const selectedMedia = Boolean(
    els.includeFinishedBuildPhoto?.checked || els.includeCreatorPhoto?.checked,
  );
  const hasMediaDescription = !selectedMedia || Boolean(els.coverAltText?.value.trim());
  const mediaPublishingSupported = !selectedMedia || serverConfig.githubAtomicPublishSupported === true;
  const ready = Boolean(
    state.plan &&
      !state.publishedProject &&
      state.compiledFirmware &&
      state.flashStatus === "success" &&
      state.automaticTestStatus === "pass" &&
      currentManualResult()?.status === "pass" &&
      hasMediaDescription &&
      mediaPublishingSupported,
  );
  if (els.publishGithubButton) els.publishGithubButton.disabled = !ready;
  const automaticPassed = state.automaticTestStatus === "pass";
  if (els.verifyBehaviorButton) els.verifyBehaviorButton.disabled = !automaticPassed;
  if (els.manualHelpButton) els.manualHelpButton.disabled = !automaticPassed;
  if (els.continueToCelebrateButton) {
    els.continueToCelebrateButton.hidden = currentManualResult()?.status !== "pass";
  }
  els.testTabItems?.forEach((item, index) => {
    item.classList.toggle("is-active", automaticPassed ? index === 1 : index === 0);
  });
  if (els.publishGateNote) {
    if (state.publishedProject) {
      els.publishGateNote.textContent = "Published. GitHub keeps the files you chose in project history; manage or remove them from GitHub.";
    } else if (!state.plan) {
      els.publishGateNote.textContent = "Create the guide first, then publishing will unlock.";
    } else if (!state.compiledFirmware || state.flashStatus !== "success") {
      els.publishGateNote.textContent = "Load the firmware onto the board first.";
    } else if (state.automaticTestStatus !== "pass") {
      els.publishGateNote.textContent = "Pass the fresh board-message check before publishing.";
    } else if (!currentManualResult()) {
      els.publishGateNote.textContent = "Try the finished build and record the result before publishing.";
    } else if (currentManualResult().status !== "pass") {
      els.publishGateNote.textContent = "Fix the build and pass the manual check before publishing.";
    } else if (!hasMediaDescription) {
      els.publishGateNote.textContent = "Describe the photo you chose to publish.";
    } else if (!mediaPublishingSupported) {
      els.publishGateNote.textContent = "This preview server cannot publish photos atomically yet. Uncheck the photo to publish notes only; your photo stays in this browser.";
    } else {
      els.publishGateNote.textContent = "Verified and ready. Checked photos and notes will be saved together in one private-by-default update.";
    }
  }
  els.timelineButtons.forEach((button) => {
    const buttonIndex = Number(button.dataset.workflowStage || 0);
    const resolved = resolveWorkflowStage(buttonIndex, {
      hasPlan: Boolean(state.plan),
      flashStatus: state.flashStatus,
      automaticTestStatus: state.automaticTestStatus,
      manualTestStatus: currentManualResult()?.status || "pending",
    });
    button.setAttribute("aria-disabled", String(resolved !== buttonIndex));
  });
}

async function handleCompletionPhoto(event, kind) {
  const [file] = event.target.files || [];
  if (!file || !["finishedBuild", "creator"].includes(kind)) return;
  if (state.publishOperationActive) {
    event.target.value = "";
    resetIsBlocked();
    return;
  }
  const sessionEpoch = state.sessionEpoch;
  const selectionEpoch = ++state.completionSelectionEpoch[kind];
  const selectionIsCurrent = () =>
    state.sessionEpoch === sessionEpoch && state.completionSelectionEpoch[kind] === selectionEpoch;
  try {
    const rawDataUrl = await readFileAsDataUrl(file);
    if (!selectionIsCurrent()) return;
    const image = await loadImage(rawDataUrl);
    if (!selectionIsCurrent()) return;
    const resized = resizeCompletionPhoto(image);
    if (!selectionIsCurrent()) return;
    const mediaPath = kind === "finishedBuild" ? "images/finished-build.svg" : "images/creator-and-build.svg";
    state.completionMedia[kind] = {
      dataUrl: resized.dataUrl,
      content: rasterDataUrlToSvg(resized.dataUrl, resized.width, resized.height),
      path: mediaPath,
    };
    state.publishedProject = null;
    if (els.shareBuildButton) els.shareBuildButton.hidden = true;
    const preview = kind === "finishedBuild" ? els.finishedBuildPreview : els.creatorPhotoPreview;
    const consent = kind === "finishedBuild" ? els.includeFinishedBuildPhoto : els.includeCreatorPhoto;
    preview.src = resized.dataUrl;
    preview.alt = kind === "finishedBuild" ? "Selected finished-build photo" : "Selected creator photo";
    preview.hidden = false;
    consent.disabled = false;
    consent.checked = false;
    refreshCompletionPreview();
  } catch (error) {
    console.error(error);
    if (selectionIsCurrent()) {
      setStatus(els.githubStatus, `I couldn’t prepare that optional photo: ${error.message}`, "danger");
    }
  }
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("The photo could not be read."));
    reader.readAsDataURL(file);
  });
}

function loadImage(source) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("The selected file is not a readable image."));
    image.src = source;
  });
}

function resizeCompletionPhoto(image) {
  const sourceWidth = Math.max(1, Number(image.naturalWidth) || 1);
  const sourceHeight = Math.max(1, Number(image.naturalHeight) || 1);
  // Keep two separately consented photos plus the README below the server's
  // bounded atomic-publish payload, even after SVG wrapping and JSON escaping.
  const targetDataUrlLength = 160_000;
  const maxSides = [900, 760, 640, 520, 420];
  const qualities = [0.78, 0.68, 0.58, 0.48, 0.42];
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  let latest = null;

  for (const maxSide of maxSides) {
    const scale = Math.min(1, maxSide / sourceWidth, maxSide / sourceHeight);
    canvas.width = Math.max(1, Math.round(sourceWidth * scale));
    canvas.height = Math.max(1, Math.round(sourceHeight * scale));
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);

    for (const quality of qualities) {
      latest = {
        dataUrl: canvas.toDataURL("image/jpeg", quality),
        width: canvas.width,
        height: canvas.height,
      };
      if (latest.dataUrl.length <= targetDataUrlLength) return latest;
    }
  }

  if (!latest || latest.dataUrl.length > targetDataUrlLength) {
    throw new Error("That photo is too detailed to publish safely. Try a closer crop.");
  }
  return latest;
}

function rasterDataUrlToSvg(dataUrl, width, height) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}"><image width="${width}" height="${height}" href="${dataUrl}" /></svg>`;
}

function refreshCompletionPreview() {
  const finished = state.completionMedia.finishedBuild;
  const creator = state.completionMedia.creator;
  const selected =
    (els.includeFinishedBuildPhoto?.checked && finished) ||
    (els.includeCreatorPhoto?.checked && creator) ||
    null;
  if (els.projectCoverPreview) {
    els.projectCoverPreview.src = selected?.dataUrl || "images/makeable/scan-parts.svg";
    els.projectCoverPreview.alt = selected
      ? String(els.coverAltText?.value || "Selected project cover").trim()
      : "Illustrated Makeable electronics build";
  }
  if (els.projectTitlePreview) els.projectTitlePreview.textContent = state.plan?.projectTitle || "My Makeable project";
  state.readme = buildReadme();
  if (els.readmePreview) els.readmePreview.textContent = state.readme;
  updatePublishControls();
}

async function publishToGitHub() {
  const repoName = sanitizeRepoName(els.repoNameInput.value || "makeable-build");
  const isPrivate = els.privateRepoInput.checked;
  if (!state.plan) {
    setStatus(els.githubStatus, "Create the guide first, then I can save the project notes.", "warn");
    return;
  }
  if (!state.compiledFirmware || state.flashStatus !== "success") {
    setStatus(els.githubStatus, "Load the board first, then I can publish the project notes.", "warn");
    return;
  }
  if (state.automaticTestStatus !== "pass" || currentManualResult()?.status !== "pass") {
    setStatus(els.githubStatus, "Pass both the fresh board check and the real-world check before publishing.", "warn");
    return;
  }
  if (
    (els.includeFinishedBuildPhoto?.checked || els.includeCreatorPhoto?.checked) &&
    !els.coverAltText?.value.trim()
  ) {
    els.coverAltText?.focus();
    setStatus(els.githubStatus, "Add a short description for the photo you chose to publish.", "warn");
    return;
  }
  const selectedMedia = [
    els.includeFinishedBuildPhoto?.checked ? state.completionMedia.finishedBuild : null,
    els.includeCreatorPhoto?.checked ? state.completionMedia.creator : null,
  ].filter(Boolean);
  if (selectedMedia.length && serverConfig.githubAtomicPublishSupported !== true) {
    setStatus(
      els.githubStatus,
      "I won’t send a photo through a partial upload. Uncheck the photo to publish notes only; it will stay in this browser.",
      "warn",
    );
    return;
  }
  state.readme = buildReadme();
  const readmeToPublish = state.readme;
  const projectTitleToPublish = state.plan.projectTitle;
  els.githubStatus.textContent = state.publishDraft?.repoName === repoName
    ? "Resuming your secure project save..."
    : "Creating a home for your project...";
  els.publishGithubButton.disabled = true;
  let publishPhase = "create";
  setBlockingOperation("publish", true);

  try {
    let draft = state.publishDraft?.repoName === repoName ? state.publishDraft : null;
    if (!draft) {
      const repo = await apiJson("/api/github/repos", {
        method: "POST",
        body: JSON.stringify({
          name: repoName,
          description: "Verified hardware project generated with Makeable",
          private: isPrivate,
        }),
      });
      const owner = repo.owner?.login || settings.githubOwner;
      const publishCapability = repo.publishCapability;
      if (!owner || !publishCapability) throw new Error("GitHub did not return a secure publishing authorization.");
      draft = {
        repoName,
        owner,
        isPrivate,
        url: repo.html_url || `https://github.com/${owner}/${repoName}`,
        publishCapability,
      };
      state.publishDraft = draft;
      if (els.repoNameInput) els.repoNameInput.disabled = true;
      if (els.privateRepoInput) els.privateRepoInput.disabled = true;
    }
    publishPhase = "upload";
    const { owner, publishCapability } = draft;

    if (selectedMedia.length) {
      els.githubStatus.textContent = "Saving your checked photo and project notes together…";
      await apiJson("/api/github/publish-project", {
        method: "POST",
        body: JSON.stringify({
          owner,
          repo: repoName,
          files: [
            ...selectedMedia.map(({ path, content }) => ({ path, content })),
            { path: "README.md", content: readmeToPublish },
          ],
          message: "Publish verified Makeable project",
          publishCapability,
        }),
      });
    } else {
      await apiJson("/api/github/upload-file", {
        method: "POST",
        body: JSON.stringify({
          owner,
          repo: repoName,
          path: "README.md",
          content: readmeToPublish,
          message: "Add Makeable README",
          publishCapability,
        }),
      });
    }

    const repoUrl = draft.url;
    state.publishedProject = { url: repoUrl, title: projectTitleToPublish };
    els.githubStatus.innerHTML = `Saved: <a href="${repoUrl}" target="_blank" rel="noreferrer">${repoUrl}</a>`;
    if (els.shareBuildButton) els.shareBuildButton.hidden = false;
    if (els.publishGithubButton) els.publishGithubButton.textContent = "Published to GitHub";
    for (const input of [
      els.finishedBuildPhotoInput,
      els.creatorPhotoInput,
      els.includeFinishedBuildPhoto,
      els.includeCreatorPhoto,
      els.coverAltText,
    ]) {
      if (input) input.disabled = true;
    }
  } catch (error) {
    console.error(error);
    const message = Number(error?.status) === 422 && publishPhase === "create"
      ? "That repository name already exists. Choose a new name so Makeable can publish securely."
      : publishPhase === "upload"
        ? `I couldn’t finish saving it yet: ${error.message} You can retry without creating another repository.`
        : `I couldn’t create the repository yet: ${error.message}`;
    setStatus(els.githubStatus, message, "danger");
  } finally {
    setBlockingOperation("publish", false);
    updatePublishControls();
  }
}

async function sharePublishedBuild() {
  const project = state.publishedProject;
  if (!project) return;
  const shareData = {
    title: project.title,
    text: `I built and tested “${project.title}” with Makeable.`,
    url: project.url,
  };
  try {
    if (navigator.share) {
      await navigator.share(shareData);
    } else if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(`${shareData.text} ${shareData.url}`);
      setStatus(els.githubStatus, "Share link copied to your clipboard.", "ok");
    } else {
      window.prompt("Copy this project link", project.url);
    }
  } catch (error) {
    if (error?.name !== "AbortError") {
      setStatus(els.githubStatus, `I couldn’t open sharing: ${error.message}`, "warn");
    }
  }
}

async function apiJson(path, options = {}) {
  const base = String(serverConfig.apiBaseUrl || "").replace(/\/$/, "");
  const requestUrl = base && path !== "/api/config" ? `${base}${path}` : path;
  const protectedProgramPath =
    /^\/api\/programs\/(?:nus-acacia|acacia)\/(?:proposals|plans)(?:\/|$)/.test(path);
  const requiresAuth =
    serverConfig.hasAccounts &&
    (/^\/api\/(account|openai|firmware|github)(\/|$)/.test(path) || protectedProgramPath);
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
  element.className = `status-strip ${tone || ""}`.trim();
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
