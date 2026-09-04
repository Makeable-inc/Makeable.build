"use client";

import {
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent,
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  captureMakeableEvent,
  identifyMakeableAccount,
  makeableDistinctId,
  makeableReferringDomain,
} from "./analytics";
import { advanceBuildProgress } from "./generation-progress";
import {
  PartThumbnail,
  ProjectImage,
  ProjectOverview,
  partDisplayName,
  partPlainLabel as presentPartLabel,
  partPurpose as presentPartPurpose,
} from "./project-overview";
import { projectDisplayIdentity, withProjectDisplayIdentity } from "./project-identity.mjs";
import { RetailerBrand } from "./retailer-brand";
import { ProjectWiringGuide } from "./project-wiring-guide";
import { projectWiringReady } from "./project-wiring-data.mjs";
import { ArrowIcon, BuildClarificationPanel, GenerationWorkspace, LockedCodePanel, ProfileAvatar, WorkspaceContextBar, WorkspaceTopBar, type ProjectSurface } from "./workspace-ui";

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize(options: {
            client_id: string;
            callback: (response: { credential?: string }) => void;
            ux_mode?: "popup" | "redirect";
          }): void;
          renderButton(
            parent: HTMLElement,
            options: {
              theme?: "outline" | "filled_blue" | "filled_black";
              size?: "large" | "medium" | "small";
              shape?: "pill" | "rectangular" | "circle" | "square";
              text?: "signin_with" | "signup_with" | "continue_with" | "signin";
              width?: number;
            },
          ): void;
        };
      };
    };
  }
}

type BuildPart = {
  id?: string;
  name: string;
  category?: string;
  subtype?: string;
  price?: number | null;
  priceLabel?: string;
  packQty?: number;
  quantity?: number;
  packageQuantity?: number;
  includedComponents?: string[];
  asin?: string;
  url?: string;
  voltage?: string;
  notes?: string;
  why?: string;
  checkedDate?: string;
  presoldered?: boolean;
  role?: string;
  listingId?: string;
  amazonUrl?: string;
  aliexpressUrl?: string;
};

type RetailPriceQuote = {
  listingId: string;
  displayState: "fresh" | "recent" | "stale" | "unavailable" | "review-required";
  asOf?: string | null;
  destinationUrl?: string;
  price?: { amount: number; currency: string };
};

const COMMUNITY_PART_ESTIMATES: Record<string, number> = {
  controller: 14.99,
  display: 9.99,
  sensor: 7.99,
  input: 6.99,
  output: 6.99,
  connector: 6.99,
};

const ACTIVE_BUILD_JOB_STORAGE_KEY = "makeable:active-build-job:v1";

type BuildImage = {
  url: string;
  source?: string;
  status?: string;
  model?: string;
};

type BuildProject = {
  id: string;
  title: string;
  idea?: string;
  summary: string;
  behavior?: string;
  image: BuildImage;
  parts: BuildPart[];
  warnings?: string[];
  cost?: {
    knownSubtotalUsd: number;
    pricedParts: number;
    totalParts: number;
    estimateLabel: string;
    note: string;
  };
  status?: string;
  communityOnly?: boolean;
  createdAt?: string;
  makerName?: string;
  makerHandle?: string;
  makerPicture?: string;
  artifactStates?: {
    wiring?: { state?: string; reason?: string };
  };
  artifacts?: {
    assembly?: {
      state?: string;
      guideSteps?: Array<{
        id: string;
        title: string;
        beginnerInstruction?: string;
        safetyNote?: string;
        activeWires?: string[];
      }>;
      wires?: Array<{
        id: string;
        label?: string;
        signal?: string;
        color?: string;
        from?: { label?: string; partId?: string; nodeName?: string };
        to?: { label?: string; partId?: string; nodeName?: string };
      }>;
    };
  };
};

type AuthUser = {
  email: string;
  name?: string;
  picture?: string;
};

type BuildQuota = {
  limit: number;
  used: number;
  reserved: number;
  remaining: number;
};

type AccountBuildsResponse = {
  user: AuthUser;
  analyticsId?: string;
  builds: BuildProject[];
  quota?: BuildQuota;
};

type PublicConfig = {
  googleClientId?: string;
  hasGoogleSignIn?: boolean;
};

type BuildJobState = "queued" | "planning" | "fitting_parts" | "rendering" | "ready" | "failed" | "cancelled";

type BuildJob = {
  id: string;
  state: BuildJobState;
  idea?: string;
  createdAt?: string;
  updatedAt?: string;
  completedAt?: string;
  claimedAt?: string;
  buildId?: string;
  makerName?: string;
  error?: string;
  result?: BuildProject | null;
};

type StartBuildJobResponse = {
  job?: BuildJob | null;
  activeJob?: BuildJob | null;
  clarification?: BuildClarification | null;
  error?: string;
};

type ActiveBuildJobResponse = {
  job?: BuildJob | null;
  error?: string;
};

type BuildClarification = {
  status: "needs_clarification";
  reason: string;
  question: string;
  options: Array<{
    id: string;
    label: string;
    description: string;
    refinedIdea: string;
  }>;
};

type BuildJobStatusResponse = {
  job?: BuildJob | null;
  error?: string;
};

type ClaimBuildJobResponse = {
  job?: BuildJob | null;
  build?: BuildProject | null;
  quota?: BuildQuota;
  error?: string;
};

type LoginIntent = "generate" | "account";
type WorkspaceMode = "loading" | "clarification" | "result" | "library";

type HeroBuild = {
  id: string;
  title: string;
  description: string;
  image: string;
  mobileImage?: string;
  heroBackgroundPosition?: string;
  cardImage: string;
  cta: string;
  action: "preorder" | "soon";
};

type GenerationStage = {
  at: number;
  label: string;
  detail: string;
};

const API_ORIGIN = process.env.NEXT_PUBLIC_MAKEABLE_API_ORIGIN
  || (process.env.NODE_ENV === "development" ? "http://127.0.0.1:8787" : "");

function apiUrl(path: string) {
  return `${API_ORIGIN}${path}`;
}

function newBuildRequestId() {
  return `req_${globalThis.crypto.randomUUID().replaceAll("-", "")}`;
}

const DEFAULT_BUILD_QUOTA: BuildQuota = {
  limit: 10,
  used: 0,
  reserved: 0,
  remaining: 10,
};

const heroBuilds: HeroBuild[] = [
  {
    id: "ember",
    title: "Feed Ember Tokens.",
    description: "A desk pet that grows with every Claude and Codex token you burn.",
    image: "/concepts/homepage-v2/ember-flagship-hero-adult-neutral-v15.png",
    mobileImage: "/concepts/homepage-v2/ember-flagship-hero-adult-neutral-v15.png",
    cardImage: "/concepts/homepage-v2/ember-flagship-hero-adult-neutral-v15.png",
    cta: "Pre-order Ember",
    action: "preorder",
  },
  {
    id: "study-desk-companion",
    title: "Study Desk Companion",
    description: "A compact focus buddy with a real screen and a tactile desk control.",
    image: "/assets/landing/heroes-v3/study-desk-companion-hero-v6.png",
    heroBackgroundPosition: "40% 20%",
    cardImage: "/concepts/homepage-v2/study-desk-companion-v2.webp",
    cta: "Coming soon",
    action: "soon",
  },
  {
    id: "plant-companion",
    title: "Plant Companion",
    description: "Give your plant a simple way to show when it needs attention.",
    image: "/assets/landing/heroes-v3/plant-companion-hero-v5.png",
    heroBackgroundPosition: "40% 20%",
    cardImage: "/concepts/homepage-v2/plant-companion-v2.webp",
    cta: "Coming soon",
    action: "soon",
  },
  {
    id: "motion-light",
    title: "Motion Light",
    description: "A small printed light with a translucent FDM diffuser that wakes up gently when you walk by.",
    image: "/assets/landing/heroes-v3/motion-light-hero-v6.png",
    heroBackgroundPosition: "40% 20%",
    cardImage: "/concepts/homepage-v2/motion-light-v2.webp",
    cta: "Coming soon",
    action: "soon",
  },
  {
    id: "window-air-monitor",
    title: "Window Air Monitor",
    description: "A simple screen that helps you know when to open the window.",
    image: "/assets/landing/heroes-v3/window-air-monitor-hero-v6.png",
    heroBackgroundPosition: "40% 20%",
    cardImage: "/assets/landing/gallery-v2/window-air-final-v2.webp",
    cta: "Coming soon",
    action: "soon",
  },
  {
    id: "pet-water-reminder",
    title: "Pet Water Reminder",
    description: "A gentle desk reminder for keeping your pet's water fresh.",
    image: "/assets/landing/heroes-v3/pet-water-reminder-hero-v5.png",
    heroBackgroundPosition: "40% 20%",
    cardImage: "/assets/landing/gallery-v2/pet-water-final-v2.webp",
    cta: "Coming soon",
    action: "soon",
  },
  {
    id: "quiet-door-chime",
    title: "Quiet Door Chime",
    description: "A calm way to know when someone arrives.",
    image: "/assets/landing/heroes-v3/quiet-door-chime-hero-v5.png",
    heroBackgroundPosition: "40% 20%",
    cardImage: "/assets/landing/gallery-v2/quiet-chime-final-v3.webp",
    cta: "Coming soon",
    action: "soon",
  },
];

const starterBuilds = heroBuilds;

const generationStages: GenerationStage[] = [
  {
    at: 0,
    label: "Understanding your brief",
    detail: "Turning your idea into a clear hardware plan.",
  },
  {
    at: 24,
    label: "Matching real parts",
    detail: "Picking verified pre-soldered modules from the catalog.",
  },
  {
    at: 48,
    label: "Preparing the assembly",
    detail: "Checking how the selected parts and connections work together.",
  },
  {
    at: 70,
    label: "Preparing the preview",
    detail: "Turning the saved plan into a clear product view.",
  },
  {
    at: 88,
    label: "Preparing your folder",
    detail: "Laying out the render, parts, cost, and next steps.",
  },
  {
    at: 100,
    label: "Build ready",
    detail: "Opening your completed build details.",
  },
];

const jobCheckpointStages: Record<BuildJobState, GenerationStage & { progress: number }> = {
  queued: {
    at: 0,
    progress: 8,
    label: "Your build is queued.",
    detail: "Your idea is in line and the build job has been created.",
  },
  planning: {
    at: 24,
    progress: 8,
    label: "Planning your build.",
    detail: "Turning your idea into a clear hardware plan.",
  },
  fitting_parts: {
    at: 48,
    progress: 24,
    label: "Finding your parts.",
    detail: "Picking verified pre-soldered modules from the catalog.",
  },
  rendering: {
    at: 70,
    progress: 48,
    label: "Bringing it together.",
    detail: "Turning the saved plan into a clear product view.",
  },
  ready: {
    at: 92,
    progress: 96,
    label: "Build ready",
    detail: "Sign in to claim it, or opening your completed build details.",
  },
  failed: {
    at: 0,
    progress: 0,
    label: "Build failed",
    detail: "Makeable could not finish this build.",
  },
  cancelled: {
    at: 0,
    progress: 0,
    label: "Build paused",
    detail: "This build job was cancelled.",
  },
};

function generationStageFor(progress: number): GenerationStage {
  let activeStage: GenerationStage = generationStages[0];
  for (const stage of generationStages) {
    if (progress < stage.at) break;
    activeStage = stage;
  }
  return activeStage;
}

function generationStageForJob(jobState: BuildJobState | "", progress: number) {
  const checkpoints = { queued: 0, planning: 0, fitting_parts: 1, rendering: 2, ready: 3, failed: 0, cancelled: 0 };
  return jobState ? { ...jobCheckpointStages[jobState], checkpoint: checkpoints[jobState] } : generationStageFor(progress);
}

function isActiveBuildJob(job: BuildJob | null) {
  return Boolean(job && !["failed", "cancelled"].includes(job.state) && !job.claimedAt);
}

function normalizeQuota(value: BuildQuota | undefined | null): BuildQuota {
  if (!value) return DEFAULT_BUILD_QUOTA;
  const limit = Number.isFinite(value.limit) ? value.limit : DEFAULT_BUILD_QUOTA.limit;
  const used = Number.isFinite(value.used) ? value.used : DEFAULT_BUILD_QUOTA.used;
  const reserved = Number.isFinite(value.reserved) ? value.reserved : DEFAULT_BUILD_QUOTA.reserved;
  const remaining = Number.isFinite(value.remaining)
    ? value.remaining
    : Math.max(0, limit - used - reserved);
  return { limit, used, reserved, remaining: Math.max(0, remaining) };
}

async function readJsonResponse<T>(response: Response): Promise<T> {
  try {
    return await response.json() as T;
  } catch {
    return {} as T;
  }
}

function abortableDelay(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = window.setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      window.clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    }, { once: true });
  });
}

const seedCommunityBuilds: BuildProject[] = [
  {
    id: "window-air-monitor",
    makerName: "Maya Chen",
    makerHandle: "@mchen.workshop",
    makerPicture: "/avatars/maya-chen.svg",
    title: "Window Air Monitor",
    summary: "Track air quality near your window and know when to open up.",
    behavior: "Reads room conditions and ambient light, then shows a simple status on a small display.",
    image: { url: "/assets/landing/gallery-v2/window-air-final-v2.webp", source: "seed" },
    status: "Concept",
    communityOnly: true,
    parts: [
      catalogPart("The brain", "Seeed Studio XIAO ESP32S3", "controller", "B0DRNVH8MQ", "amz-us-xiao-s3-pre-soldered-v1", "Runs the monitor and connects all the parts.", "https://www.aliexpress.us/w/wholesale-xiao-esp32s3-pre-soldered.html"),
      catalogPart("Air sensor", "ENS160 + AHT21 air-quality module", "sensor", "", "", "Notices changes in air quality, temperature, and humidity.", "https://www.aliexpress.us/w/wholesale-ens160-aht21-module-soldered.html"),
      catalogPart("The display", "0.96-inch OLED module", "display", "", "", "Shows one clear message without needing your phone.", "https://www.aliexpress.us/w/wholesale-oled-0.96-soldered-pins.html"),
    ],
  },
  {
    id: "pet-water-reminder",
    makerName: "Noor Ali",
    makerHandle: "@noor.al",
    makerPicture: "/avatars/noor-ali.svg",
    title: "Pet Water Reminder",
    summary: "Gentle reminders to help keep your pet's water fresh.",
    behavior: "Senses water level and uses a tiny indicator when the bowl needs attention.",
    image: { url: "/assets/landing/gallery-v2/pet-water-final-v2.webp", source: "seed" },
    status: "Concept",
    communityOnly: true,
    parts: [
      catalogPart("The brain", "Seeed Studio XIAO ESP32S3", "controller", "B0DRNVH8MQ", "amz-us-xiao-s3-pre-soldered-v1", "Checks the sensor and decides when to remind you.", "https://www.aliexpress.us/w/wholesale-xiao-esp32s3-pre-soldered.html"),
      catalogPart("Water-level sensor", "HC-SR04P distance sensor", "sensor", "B0GL8NJCVT", "amz-us-hcsr04p-2pk-v1", "Looks down at the water and measures how far away it is.", "https://www.aliexpress.us/w/wholesale-hc-sr04p-soldered.html"),
      catalogPart("Reminder light", "Addressable RGB LED module", "output", "", "", "Glows softly when the bowl needs attention.", "https://www.aliexpress.us/w/wholesale-rgb-led-module-soldered-pins.html"),
    ],
  },
  {
    id: "quiet-door-chime",
    makerName: "Leo Park",
    makerHandle: "@parkbenchlab",
    makerPicture: "/avatars/leo-park.svg",
    title: "Quiet Door Chime",
    summary: "Know when someone arrives without loud or jarring sounds.",
    behavior: "Uses a magnetic reed sensor and a small visual alert.",
    image: { url: "/assets/landing/gallery-v2/quiet-chime-final-v3.webp", source: "seed" },
    status: "Concept",
    communityOnly: true,
    parts: [
      catalogPart("The display and brain", "2.8-inch ESP32 smart display", "display", "B0CG2WQGP9", "amz-us-esp32-2432s028r-v1", "Runs the whole build and provides the visual signal in one part.", "https://www.aliexpress.us/w/wholesale-esp32-2432s028r.html"),
      catalogPart("Door button", "Weather-resistant button module", "input", "", "", "Gives visitors one obvious button to press.", "https://www.aliexpress.us/w/wholesale-waterproof-button-module-pre-wired.html"),
      catalogPart("Easy connector", "JST cable pair", "connector", "", "", "Connects the outside button without soldering loose wires.", "https://www.aliexpress.us/w/wholesale-jst-cable-pair-pre-crimped.html"),
    ],
  },
];

function catalogPart(
  role: string,
  name: string,
  category: string,
  asin: string,
  listingId: string,
  why: string,
  aliexpressUrl: string,
): BuildPart {
  const amazonUrl = asin
    ? `https://www.amazon.com/dp/${asin}`
    : `https://www.amazon.com/s?k=${encodeURIComponent(`${name} pins soldered`)}`;
  return {
    role,
    name,
    asin,
    category,
    listingId,
    amazonUrl,
    aliexpressUrl,
    url: amazonUrl,
    why,
    price: COMMUNITY_PART_ESTIMATES[category] || 7.99,
    presoldered: true,
  };
}

export default function Home() {
  const [activeHeroId, setActiveHeroId] = useState("ember");
  const [featuredBuildsExpanded, setFeaturedBuildsExpanded] = useState(false);
  const [featuredRailState, setFeaturedRailState] = useState({ canGoBack: false, canGoForward: false });
  const [idea, setIdea] = useState("");
  const [generationBusy, setGenerationBusy] = useState(false);
  const [generationProgress, setGenerationProgress] = useState(0);
  const [generationError, setGenerationError] = useState("");
  const [buildClarification, setBuildClarification] = useState<BuildClarification | null>(null);
  const [generatedBuilds, setGeneratedBuilds] = useState<BuildProject[]>([]);
  const [detailBuild, setDetailBuild] = useState<BuildProject | null>(null);
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>("loading");
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [workspaceBuild, setWorkspaceBuild] = useState<BuildProject | null>(null);
  const [accountBuilds, setAccountBuilds] = useState<BuildProject[]>([]);
  const [quota, setQuota] = useState<BuildQuota>(DEFAULT_BUILD_QUOTA);
  const [currentJob, setCurrentJob] = useState<BuildJob | null>(null);
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [authResolved, setAuthResolved] = useState(false);
  const [authUnavailable, setAuthUnavailable] = useState(false);
  const [publicConfig, setPublicConfig] = useState<PublicConfig>({});
  const [googleReady, setGoogleReady] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const [loginIntent, setLoginIntent] = useState<LoginIntent>("generate");
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState("");
  const [preorderOpen, setPreorderOpen] = useState(false);
  const [preorderTerms, setPreorderTerms] = useState(false);
  const [preorderBusy, setPreorderBusy] = useState(false);
  const [preorderError, setPreorderError] = useState("");
  const [communityIndex, setCommunityIndex] = useState(0);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const communityGridRef = useRef<HTMLDivElement>(null);
  const featuredBuildsRailRef = useRef<HTMLDivElement>(null);
  const googleButtonRef = useRef<HTMLDivElement>(null);
  const loginDialogRef = useRef<HTMLElement>(null);
  const preorderDialogRef = useRef<HTMLFormElement>(null);
  const countdownRef = useRef<HTMLDivElement>(null);
  const generationAbortRef = useRef<AbortController | null>(null);
  const pendingIdeaRef = useRef("");
  const pendingClaimJobIdRef = useRef("");
  const jobFlowActiveRef = useRef(false);
  const loginIntentRef = useRef<LoginIntent>("generate");
  const authUserRef = useRef<AuthUser | null>(null);
  const currentJobRef = useRef<BuildJob | null>(null);

  useEffect(() => {
    const preview = new URL(window.location.href).searchParams.get("preview");
    if (!["localhost", "127.0.0.1"].includes(window.location.hostname)) return;
    if (preview === "generation") {
      const previewIdea = "A smart indoor air quality monitor with a small display and quiet alerts";
      setIdea(previewIdea);
      setWorkspaceMode("loading");
      setWorkspaceBuild(null);
      setGenerationProgress(38);
      setGenerationBusy(true);
      setWorkspaceOpen(true);
    }
    if (preview === "project") {
      setWorkspaceMode("result");
      setWorkspaceBuild(withProjectDisplayIdentity(seedCommunityBuilds[0]));
      setWorkspaceOpen(true);
    }
  }, []);

  const activeHero = heroBuilds.find((build) => build.id === activeHeroId) || heroBuilds[0];
  const activeGenerationStage = generationStageForJob(currentJob?.state || "", generationProgress);
  const freeBuildLimit = quota.limit;
  const buildsRemaining = quota.remaining;
  const resumableJob = isActiveBuildJob(currentJob) ? currentJob : null;
  const communityBuilds = useMemo(
    () => [...generatedBuilds, ...seedCommunityBuilds].map(withProjectDisplayIdentity),
    [generatedBuilds],
  );

  useEffect(() => {
    authUserRef.current = authUser;
  }, [authUser]);

  useEffect(() => {
    currentJobRef.current = currentJob;
    if (currentJob && !currentJob.claimedAt && currentJob.state !== "cancelled") {
      window.sessionStorage.setItem(ACTIVE_BUILD_JOB_STORAGE_KEY, currentJob.id);
    } else if (currentJob) {
      window.sessionStorage.removeItem(ACTIVE_BUILD_JOB_STORAGE_KEY);
    }
  }, [currentJob]);

  useEffect(() => {
    if (!generationBusy || !currentJob || ["ready", "failed", "cancelled"].includes(currentJob.state)) return undefined;

    const advanceEstimatedProgress = () => {
      setGenerationProgress((visibleProgress) => advanceBuildProgress(visibleProgress, currentJob));
    };

    advanceEstimatedProgress();
    const timer = window.setInterval(advanceEstimatedProgress, 700);
    return () => window.clearInterval(timer);
  }, [currentJob, generationBusy]);

  const closeLogin = useCallback(() => {
    setLoginOpen(false);
    setAuthError("");
    if (loginIntentRef.current === "generate" && generationBusy && !authUser && !currentJobRef.current) {
      setGenerationBusy(false);
      setGenerationProgress(0);
      setWorkspaceOpen(false);
    }
  }, [authUser, generationBusy]);

  const openLogin = useCallback((intent: LoginIntent) => {
    loginIntentRef.current = intent;
    setLoginIntent(intent);
    setAuthError("");
    setLoginOpen(true);
    captureMakeableEvent("google sign in opened", {
      intent,
      placement: intent === "account" ? "navigation" : "build_flow",
      product_id: "makeable_builder",
    });
  }, []);

  const selectHeroBuild = useCallback((buildId: string, writeUrl = true) => {
    const selectedBuild = heroBuilds.find((build) => build.id === buildId);
    if (!selectedBuild) return;
    setActiveHeroId(selectedBuild.id);
    if (!writeUrl) return;
    const url = new URL(window.location.href);
    url.searchParams.set("build", selectedBuild.id);
    window.history.pushState({ makeableBuild: selectedBuild.id }, "", `${url.pathname}${url.search}${url.hash}`);
  }, []);

  const syncFeaturedBuildsRail = useCallback(() => {
    const rail = featuredBuildsRailRef.current;
    if (!rail || featuredBuildsExpanded) {
      setFeaturedRailState({ canGoBack: false, canGoForward: false });
      return;
    }
    const maxScrollLeft = Math.max(0, rail.scrollWidth - rail.clientWidth);
    setFeaturedRailState({
      canGoBack: rail.scrollLeft > 2,
      canGoForward: rail.scrollLeft < maxScrollLeft - 2,
    });
  }, [featuredBuildsExpanded]);

  const moveFeaturedBuildsRail = useCallback((direction: "back" | "forward") => {
    const rail = featuredBuildsRailRef.current;
    if (!rail) return;
    const firstCard = rail.querySelector<HTMLElement>(".mk-hero-build-card");
    const distance = (firstCard?.offsetWidth || rail.clientWidth * 0.92) + 16;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    rail.scrollBy({
      left: direction === "forward" ? distance : -distance,
      behavior: reduceMotion ? "auto" : "smooth",
    });
  }, []);

  useEffect(() => {
    const rail = featuredBuildsRailRef.current;
    if (!rail) return;
    const resizeObserver = new ResizeObserver(syncFeaturedBuildsRail);
    rail.addEventListener("scroll", syncFeaturedBuildsRail, { passive: true });
    resizeObserver.observe(rail);
    syncFeaturedBuildsRail();
    return () => {
      rail.removeEventListener("scroll", syncFeaturedBuildsRail);
      resizeObserver.disconnect();
    };
  }, [syncFeaturedBuildsRail]);

  useDialogFocusTrap(loginOpen, loginDialogRef, closeLogin, authBusy);
  useDialogFocusTrap(preorderOpen, preorderDialogRef, () => setPreorderOpen(false), preorderBusy);

  const fetchAccount = useCallback(async (openLibrary = false) => {
    setAuthUnavailable(false);
    try {
      const response = await fetch(apiUrl("/api/account/builds"), {
        headers: { Accept: "application/json" },
        credentials: "include",
      });
      if (response.status === 401) {
        authUserRef.current = null;
        setAuthUser(null);
        setAccountBuilds([]);
        setQuota(DEFAULT_BUILD_QUOTA);
        setAuthUnavailable(false);
        return null;
      }
      if (!response.ok) {
        setAuthUnavailable(true);
        return null;
      }
      const result = await readJsonResponse<AccountBuildsResponse>(response);
      if (result.analyticsId) identifyMakeableAccount(result.analyticsId);
      authUserRef.current = result.user;
      setAuthUser(result.user);
      setAccountBuilds(result.builds || []);
      setQuota(normalizeQuota(result.quota));
      setAuthUnavailable(false);
      if (openLibrary) {
        setWorkspaceOpen(true);
        setWorkspaceMode("library");
        setWorkspaceBuild(result.builds?.[0] || null);
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
      return result;
    } catch {
      setAuthUnavailable(true);
      return null;
    } finally {
      setAuthResolved(true);
    }
  }, []);

  const claimReadyBuildJob = useCallback(async (jobId: string, signal?: AbortSignal) => {
    pendingClaimJobIdRef.current = jobId;
    setWorkspaceOpen(true);
    setWorkspaceMode("loading");
    setGenerationBusy(true);
    setGenerationProgress(96);
    setGenerationError("");
    const response = await fetch(apiUrl(`/api/build-jobs/${encodeURIComponent(jobId)}/claim`), {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      credentials: "include",
      body: JSON.stringify({
        galleryName: authUserRef.current?.name || "Maker",
        posthogDistinctId: makeableDistinctId(),
        referringDomain: makeableReferringDomain(),
      }),
      signal,
    });
    const result = await readJsonResponse<ClaimBuildJobResponse>(response);
    if (response.status === 401) {
      openLogin("generate");
      setGenerationBusy(false);
      setGenerationError("Your build is ready. Sign in with Google to save it to My Builds.");
      return null;
    }
    if (!response.ok) throw new Error(result.error || "Makeable could not claim this build.");
    const buildResult = result.build || result.job?.result || null;
    const build = buildResult ? withCreatorSnapshot(buildResult, authUserRef.current) : null;
    const buildId = build?.id || result.job?.buildId || "";
    if (!build || !buildId) throw new Error("Makeable finished the job but did not return a build id.");
    if ((result.job && result.job.id !== jobId) || (result.job?.buildId && result.job.buildId !== build.id)) {
      throw new Error("The saved project did not match this build job. Your existing projects were left untouched.");
    }

    if (result.job) setCurrentJob({ ...result.job, claimedAt: result.job.claimedAt || new Date().toISOString() });
    window.sessionStorage.removeItem(ACTIVE_BUILD_JOB_STORAGE_KEY);
    if (result.quota) setQuota(normalizeQuota(result.quota));
    setGenerationProgress(100);
    setWorkspaceBuild(build);
    setWorkspaceMode("result");
    setGeneratedBuilds((current) => [build, ...current.filter((item) => item.id !== build.id)]);
    setAccountBuilds((current) => [build, ...current.filter((item) => item.id !== build.id)]);
    setIdea("");
    pendingIdeaRef.current = "";
    pendingClaimJobIdRef.current = "";
    void fetchAccount(false);
    if (!signal?.aborted) window.location.assign(`/app?build=${encodeURIComponent(buildId)}`);
    setGenerationBusy(false);
    return build;
  }, [fetchAccount, openLogin]);

  const runBuildJobPoll = useCallback(async (jobId: string, signal: AbortSignal): Promise<"claimed" | "waiting_for_auth"> => {
    setWorkspaceOpen(true);
    setWorkspaceMode("loading");
    setWorkspaceBuild(null);
    setBuildClarification(null);
    setGenerationBusy(true);
    window.scrollTo({ top: 0, behavior: "smooth" });

    let interruptedChecks = 0;
    while (!signal.aborted) {
      let response: Response;
      try {
        response = await fetch(apiUrl(`/api/build-jobs/${encodeURIComponent(jobId)}`), {
        headers: { Accept: "application/json" },
        credentials: "include",
        signal,
        });
        if (response.status >= 500 || response.status === 429) throw new Error("Temporary status check interruption");
        interruptedChecks = 0;
      } catch (error) {
        if (signal.aborted) throw error;
        if (++interruptedChecks <= 3) {
          await abortableDelay(1600 * interruptedChecks, signal);
          continue;
        }
        throw new Error("Connection interrupted while checking this build. The build may still be running. Try again to reconnect to the same job.");
      }
      const result = await readJsonResponse<BuildJobStatusResponse>(response);
      if (!response.ok || !result.job) {
        throw new Error(result.error || "Makeable could not check this build job.");
      }
      const job = result.job;
      if (job.id !== jobId) throw new Error("The returned build job did not match your request. Your existing projects were left untouched.");
      currentJobRef.current = job;
      setCurrentJob(job);
      setGenerationProgress((visibleProgress) => advanceBuildProgress(visibleProgress, job));
      setGenerationError("");

      if (job.state === "ready") {
        pendingClaimJobIdRef.current = job.id;
        if (!authUserRef.current) {
          setGenerationBusy(false);
          setGenerationError("Your build is ready. Sign in with Google to save it to My Builds.");
          openLogin("generate");
          return "waiting_for_auth";
        }
        await claimReadyBuildJob(job.id, signal);
        return "claimed";
      }
      if (job.state === "failed") throw new Error(job.error || "Makeable could not finish this build.");
      if (job.state === "cancelled") throw new Error("This build job was cancelled.");

      await abortableDelay(job.state === "queued" ? 1200 : 1600, signal);
    }

    throw new DOMException("Aborted", "AbortError");
  }, [claimReadyBuildJob, openLogin]);

  const resumeBuildJob = useCallback(async (jobId = currentJobRef.current?.id || "") => {
    if (!jobId) return;
    generationAbortRef.current?.abort();
    const requestController = new AbortController();
    generationAbortRef.current = requestController;
    jobFlowActiveRef.current = true;
    setGenerationError("");
    try {
      await runBuildJobPoll(jobId, requestController.signal);
    } catch (error) {
      if (requestController.signal.aborted) return;
      setWorkspaceMode("loading");
      setGenerationError(error instanceof Error ? error.message : "Makeable could not resume this build.");
    } finally {
      if (generationAbortRef.current === requestController) {
        generationAbortRef.current = null;
        jobFlowActiveRef.current = false;
        setGenerationBusy(false);
      }
    }
  }, [runBuildJobPoll]);

  useEffect(() => {
    if (!authResolved || currentJobRef.current || jobFlowActiveRef.current) return;
    const savedJobId = window.sessionStorage.getItem(ACTIVE_BUILD_JOB_STORAGE_KEY) || "";
    if (!savedJobId) return;
    void resumeBuildJob(savedJobId);
  }, [authResolved, resumeBuildJob]);

  const cancelCurrentBuildJob = useCallback(async () => {
    const jobId = currentJobRef.current?.id || "";
    generationAbortRef.current?.abort();
    setGenerationBusy(false);

    if (!jobId) {
      setWorkspaceOpen(false);
      setGenerationProgress(0);
      return;
    }

    try {
      const response = await fetch(apiUrl(`/api/build-jobs/${encodeURIComponent(jobId)}`), {
        method: "DELETE",
        headers: { Accept: "application/json" },
        credentials: "include",
      });
      const result = await readJsonResponse<BuildJobStatusResponse>(response);
      if (!response.ok) throw new Error(result.error || "Makeable could not cancel this build job.");
      setCurrentJob(null);
      currentJobRef.current = null;
      window.sessionStorage.removeItem(ACTIVE_BUILD_JOB_STORAGE_KEY);
      pendingClaimJobIdRef.current = "";
      pendingIdeaRef.current = "";
      setGenerationProgress(0);
      setGenerationError("");
      setWorkspaceOpen(false);
      captureMakeableEvent("makeable build job cancelled", { job_state: result.job?.state || "cancelled" });
    } catch (error) {
      setWorkspaceOpen(true);
      setWorkspaceMode("loading");
      setGenerationError(error instanceof Error ? error.message : "Makeable could not cancel this build job.");
    }
  }, []);

  const generateBuildForIdea = useCallback(async (nextIdea: string) => {
    generationAbortRef.current?.abort();
    const requestController = new AbortController();
    generationAbortRef.current = requestController;
    jobFlowActiveRef.current = true;
    setWorkspaceOpen(true);
    setWorkspaceMode("loading");
    setWorkspaceBuild(null);
    setBuildClarification(null);
    setCurrentJob(null);
    currentJobRef.current = null;
    window.sessionStorage.removeItem(ACTIVE_BUILD_JOB_STORAGE_KEY);
    setGenerationBusy(true);
    setGenerationProgress(5);
    setGenerationError("");
    window.scrollTo({ top: 0, behavior: "smooth" });
    try {
      // One idempotency key belongs to one click/clarification choice. Reuse it
      // only for recovery and transport retries; parallel tabs get distinct jobs.
      const requestId = newBuildRequestId();
      const startBuild = () => fetch(apiUrl("/api/build-jobs"), {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          credentials: "include",
          body: JSON.stringify({
            idea: nextIdea,
            requestId,
            posthogDistinctId: makeableDistinctId(),
          }),
          signal: requestController.signal,
        });
      let response = await startBuild();
      let result = await readJsonResponse<StartBuildJobResponse>(response);
      if (response.ok && !result.job && !result.activeJob && !result.clarification) {
        captureMakeableEvent("makeable build start response recovery", { recovery_step: "active_job" });
        setGenerationProgress((visibleProgress) => Math.max(visibleProgress, 8));
        const activeResponse = await fetch(
          apiUrl(`/api/build-jobs/active?requestId=${encodeURIComponent(requestId)}`),
          {
          method: "GET",
          headers: { Accept: "application/json" },
          credentials: "include",
          signal: requestController.signal,
          },
        );
        const activeResult = await readJsonResponse<ActiveBuildJobResponse>(activeResponse);
        if (activeResponse.ok && activeResult.job) {
          result = { job: activeResult.job };
          response = activeResponse;
        } else {
          captureMakeableEvent("makeable build start response recovery", { recovery_step: "retry_start" });
          response = await startBuild();
          result = await readJsonResponse<StartBuildJobResponse>(response);
        }
      }
      if (result.clarification?.status === "needs_clarification") {
        setGenerationBusy(false);
        setGenerationProgress(0);
        setGenerationError("");
        setBuildClarification(result.clarification);
        setWorkspaceMode("clarification");
        captureMakeableEvent("makeable build clarification shown", {
          option_count: result.clarification.options.length,
        });
        return;
      }
      const job = result.job || result.activeJob || null;
      if (!response.ok && !job) throw new Error(result.error || "Makeable could not start this build job.");
      if (!job) throw new Error("Makeable could not reconnect to the workshop. Your idea is safe—please try again.");
      currentJobRef.current = job;
      setCurrentJob(job);
      setGenerationProgress((visibleProgress) => advanceBuildProgress(visibleProgress, job));
      captureMakeableEvent("makeable build job started", {
        job_state: job.state,
      });
      await runBuildJobPoll(job.id, requestController.signal);
    } catch (error) {
      if (requestController.signal.aborted) return;
      setWorkspaceMode("loading");
      setGenerationError(error instanceof Error ? error.message : "Makeable could not generate this build.");
    } finally {
      if (generationAbortRef.current === requestController) {
        generationAbortRef.current = null;
        jobFlowActiveRef.current = false;
        setGenerationBusy(false);
      }
    }
  }, [runBuildJobPoll]);

  const handleGoogleCredential = useCallback(async (response: { credential?: string }) => {
    if (!response.credential) {
      setAuthError("Google did not return a sign-in token. Try again.");
      return;
    }
    setAuthBusy(true);
    setAuthError("");
    try {
      const authResponse = await fetch(apiUrl("/api/auth/google"), {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        credentials: "include",
        body: JSON.stringify({
          credential: response.credential,
          intent: "build",
          posthogDistinctId: makeableDistinctId(),
        }),
      });
      const result = await authResponse.json() as {
        ok?: boolean;
        created?: boolean;
        user?: AuthUser;
        analyticsId?: string;
        error?: string;
      };
      if (!authResponse.ok || !result.user) throw new Error(result.error || "Google sign-in failed.");
      if (result.analyticsId) identifyMakeableAccount(result.analyticsId);
      captureMakeableEvent("google sign in completed", {
        intent: loginIntentRef.current,
        new_waitlist_signup: result.created === true,
        product_id: "makeable_builder",
      });
      authUserRef.current = result.user;
      setAuthUser(result.user);
      setLoginOpen(false);
      const account = await fetchAccount(false);
      if (loginIntentRef.current === "account") {
        setWorkspaceOpen(true);
        setWorkspaceMode("library");
        setWorkspaceBuild(account?.builds?.[0] || null);
        window.scrollTo({ top: 0, behavior: "smooth" });
      } else if (pendingClaimJobIdRef.current) {
        await claimReadyBuildJob(pendingClaimJobIdRef.current);
      } else if (currentJobRef.current?.id) {
        await resumeBuildJob(currentJobRef.current.id);
      } else if (jobFlowActiveRef.current) {
        setGenerationError("");
      } else if (pendingIdeaRef.current) {
        await generateBuildForIdea(pendingIdeaRef.current);
      }
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Google sign-in failed.");
      if (loginIntentRef.current === "generate") setGenerationBusy(false);
    } finally {
      setAuthBusy(false);
    }
  }, [claimReadyBuildJob, fetchAccount, generateBuildForIdea, resumeBuildJob]);

  useEffect(() => {
    let cancelled = false;
    const applyHeroFromUrl = () => {
      const selectedBuild = new URL(window.location.href).searchParams.get("build");
      if (selectedBuild && heroBuilds.some((build) => build.id === selectedBuild)) {
        selectHeroBuild(selectedBuild, false);
        return;
      }
      selectHeroBuild(heroBuilds[0].id, false);
    };
    applyHeroFromUrl();
    window.addEventListener("popstate", applyHeroFromUrl);

    fetch(apiUrl("/api/config"), { headers: { Accept: "application/json" }, credentials: "include" })
      .then((response) => response.ok ? response.json() : {})
      .then((config: PublicConfig) => {
        if (!cancelled) setPublicConfig(config || {});
      })
      .catch(() => {
        if (!cancelled) setPublicConfig({});
      });

    fetch(apiUrl("/api/builds"), { headers: { Accept: "application/json" } })
      .then((response) => response.ok ? response.json() : { builds: [] })
      .then((data: { builds?: BuildProject[] }) => {
        if (!cancelled && Array.isArray(data.builds)) setGeneratedBuilds(data.builds);
      })
      .catch(() => {
        if (!cancelled) setGeneratedBuilds([]);
      });

    const accountTimer = window.setTimeout(() => {
      if (!cancelled) void fetchAccount(false);
    }, 0);
    return () => {
      cancelled = true;
      window.removeEventListener("popstate", applyHeroFromUrl);
      window.clearTimeout(accountTimer);
    };
  }, [fetchAccount, selectHeroBuild]);

  useEffect(() => {
    if (!publicConfig.googleClientId) return undefined;
    if (window.google?.accounts?.id) {
      const readyTimer = window.setTimeout(() => setGoogleReady(true), 0);
      return () => window.clearTimeout(readyTimer);
    }
    const existing = document.getElementById("google-identity-services") as HTMLScriptElement | null;
    if (existing) {
      const onLoad = () => setGoogleReady(true);
      existing.addEventListener("load", onLoad);
      return () => existing.removeEventListener("load", onLoad);
    }
    const script = document.createElement("script");
    script.id = "google-identity-services";
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.onload = () => setGoogleReady(true);
    script.onerror = () => setAuthError("Google sign-in could not load. Refresh and try again.");
    document.head.appendChild(script);
    return undefined;
  }, [publicConfig.googleClientId]);

  useEffect(() => {
    const container = googleButtonRef.current;
    if (!loginOpen || !container || !googleReady || !publicConfig.googleClientId || !window.google?.accounts?.id) return;
    container.innerHTML = "";
    window.google.accounts.id.initialize({
      client_id: publicConfig.googleClientId,
      callback: handleGoogleCredential,
      ux_mode: "popup",
    });
    window.google.accounts.id.renderButton(container, {
      theme: "outline",
      size: "large",
      shape: "pill",
      text: "signin_with",
      width: Math.min(360, Math.max(280, container.clientWidth || 320)),
    });
  }, [googleReady, handleGoogleCredential, loginOpen, publicConfig.googleClientId]);

  useEffect(() => () => generationAbortRef.current?.abort(), []);

  useEffect(() => {
    const grid = communityGridRef.current;
    if (!grid) return undefined;
    const resetGallery = () => {
      grid.scrollTo({ left: 0, behavior: "auto" });
      setCommunityIndex(0);
    };
    resetGallery();
    const frame = window.requestAnimationFrame(() => window.requestAnimationFrame(resetGallery));
    window.addEventListener("pageshow", resetGallery);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("pageshow", resetGallery);
    };
  }, [communityBuilds.length]);

  useEffect(() => {
    if (countdown == null) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    countdownRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [countdown]);

  useEffect(() => {
    if (countdown == null) return undefined;
    if (countdown <= 0) {
      const timer = window.setTimeout(() => setCountdown(null), 350);
      return () => window.clearTimeout(timer);
    }
    const timer = window.setTimeout(() => setCountdown((current) => (current == null ? null : current - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [countdown]);

  function submitBuild(event?: FormEvent) {
    event?.preventDefault();
    if (jobFlowActiveRef.current || generationBusy) return;
    const trimmed = idea.trim();
    if (!trimmed) {
      setGenerationError("Describe what you want to build first.");
      return;
    }
    pendingIdeaRef.current = trimmed;
    setGenerationError("");
    setWorkspaceOpen(true);
    setWorkspaceMode("loading");
    setWorkspaceBuild(null);
    setGenerationBusy(true);
    setGenerationProgress(5);
    captureMakeableEvent("makeable build idea submitted", { placement: "composer" });
    if (!authUser) {
      openLogin("generate");
      return;
    }
    void generateBuildForIdea(trimmed);
  }

  function onComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submitBuild();
    }
  }

  function openBuildLibrary() {
    if (!authUser) {
      openLogin("account");
      return;
    }
    fetchAccount(true);
  }

  function openProject(build: BuildProject) {
    window.sessionStorage.setItem("makeable:open-project", JSON.stringify(build));
    window.location.assign(`/app?build=${encodeURIComponent(build.id)}`);
  }

  function updateCommunityIndex() {
    const grid = communityGridRef.current;
    const firstCard = grid?.firstElementChild as HTMLElement | null;
    if (!grid || !firstCard) return;
    const gap = Number.parseFloat(window.getComputedStyle(grid).columnGap || "0");
    const step = firstCard.offsetWidth + gap;
    const nextIndex = step > 0 ? Math.round(grid.scrollLeft / step) : 0;
    setCommunityIndex(Math.max(0, Math.min(communityBuilds.length - 1, nextIndex)));
  }

  function showCommunityBuild(index: number) {
    const grid = communityGridRef.current;
    const card = grid?.children.item(index) as HTMLElement | null;
    if (!grid || !card) return;
    grid.scrollTo({ left: card.offsetLeft - grid.offsetLeft, behavior: "smooth" });
    setCommunityIndex(index);
  }

  function startPreorder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!preorderTerms) {
      setPreorderError("Agree to the Terms and acknowledge the Privacy Policy to continue.");
      return;
    }
    setPreorderBusy(true);
    setPreorderError("");
    captureMakeableEvent("checkout started", {
      color: "bone",
      market: "US",
      quantity: 1,
      placement: "preorder_modal",
    });
    fetch(apiUrl("/api/checkout"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        color: "bone",
        market: "US",
        quantity: 1,
        termsAccepted: true,
        marketingConsent: false,
        posthogDistinctId: makeableDistinctId(),
      }),
    })
      .then(async (response) => {
        const result = await response.json() as { url?: string; error?: string };
        if (!response.ok || !result.url) throw new Error(result.error || "Checkout is not ready in this environment.");
        window.location.assign(result.url);
      })
      .catch((error) => {
        captureMakeableEvent("checkout failed", {
          color: "bone",
          market: "US",
          placement: "preorder_modal",
        });
        setPreorderError(error instanceof Error ? error.message : "Checkout is not ready in this environment.");
        setPreorderBusy(false);
      });
  }

  function handleHeroAction() {
    if (activeHero.action === "preorder") {
      captureMakeableEvent("preorder opened", {
        build_id: activeHero.id,
        placement: "hero",
      });
      setPreorderOpen(true);
      return;
    }
    setCountdown(3);
    captureMakeableEvent("makeable coming soon shown", { build_id: activeHero.id });
  }

  const loginModal = loginOpen ? (
    <div className="mk-modal-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !authBusy) closeLogin();
    }}>
      <section ref={loginDialogRef} className="mk-login-modal" role="dialog" aria-modal="true" aria-labelledby="login-title" tabIndex={-1}>
        <button type="button" className="mk-modal-close" aria-label="Close login" onClick={closeLogin} disabled={authBusy}>x</button>
        <h2 id="login-title">Log in with Google</h2>
        <p>{loginIntent === "generate" ? currentJob ? "Your build is saved. Sign in to continue to your project folder." : "Your idea is ready. Sign in to start the build and save it to your project folder." : "Sign in to see the builds you made."}</p>
        <div className="mk-google-button" ref={googleButtonRef} aria-live="polite">
          {!googleReady && <span>Loading Google...</span>}
        </div>
        {!publicConfig.googleClientId && <p className="mk-form-error" role="alert">Google sign-in is not configured on this deployment.</p>}
        {authError && <p className="mk-form-error" role="alert">{authError}</p>}
      </section>
    </div>
  ) : null;

  if (workspaceOpen) {
    return (
      <>
        <BuildWorkspace
          key={`${workspaceMode}:${workspaceBuild?.id || "none"}`}
          mode={workspaceMode}
          user={authUser}
          build={workspaceBuild}
          builds={accountBuilds}
          freeBuildLimit={freeBuildLimit}
          buildsRemaining={buildsRemaining}
          authLoading={!authResolved}
          authUnavailable={authUnavailable}
          generationBusy={generationBusy}
          jobId={currentJob?.id || ""}
          startedAt={currentJob?.createdAt}
          prompt={currentJob?.idea || idea}
          progress={currentJob ? jobCheckpointStages[currentJob.state].progress : 0}
          stage={activeGenerationStage}
          error={generationError}
          clarification={buildClarification}
          onBack={() => {
            generationAbortRef.current?.abort();
            setGenerationBusy(false);
            setWorkspaceOpen(false);
            setGenerationError("");
            window.setTimeout(() => document.getElementById("top")?.scrollIntoView({ behavior: "smooth" }), 0);
          }}
          onSelectBuild={(build) => {
            generationAbortRef.current?.abort();
            window.location.assign(`/app?build=${encodeURIComponent(build.id)}`);
          }}
          onCreateAnother={() => {
            setWorkspaceOpen(false);
            window.setTimeout(() => document.getElementById("make")?.scrollIntoView({ behavior: "smooth" }), 0);
          }}
          onDismiss={() => {
            generationAbortRef.current?.abort();
            window.location.assign("/app");
          }}
          onCancel={cancelCurrentBuildJob}
          onRetry={() => {
            if (isActiveBuildJob(currentJob)) {
              void resumeBuildJob(currentJob!.id);
              return;
            }
            const retryIdea = (currentJob?.idea || pendingIdeaRef.current || idea).trim();
            if (retryIdea) void generateBuildForIdea(retryIdea);
          }}
          onChooseClarification={(refinedIdea) => {
            setIdea(refinedIdea);
            pendingIdeaRef.current = refinedIdea;
            setBuildClarification(null);
            void generateBuildForIdea(refinedIdea);
          }}
          onEdit={() => {
            generationAbortRef.current?.abort();
            window.sessionStorage.removeItem(ACTIVE_BUILD_JOB_STORAGE_KEY);
            setGenerationBusy(false);
            const retryIdea = (currentJob?.idea || pendingIdeaRef.current || idea).trim();
            if (retryIdea) setIdea(retryIdea);
            setWorkspaceOpen(false);
            setGenerationError("");
            window.setTimeout(() => document.getElementById("make")?.scrollIntoView({ behavior: "smooth" }), 0);
          }}
        />
        {loginModal}
      </>
    );
  }

  return (
    <main className="mk-page">
      <section
        className="mk-hero"
        id="top"
        aria-label="Makeable flagship build"
        style={{
          "--mk-hero-image": `url(${activeHero.image})`,
          "--hero-background-position": activeHero.heroBackgroundPosition ?? "0 20%",
        } as CSSProperties}
      >
        <nav className="mk-nav" aria-label="Primary navigation">
          <a className="mk-logo-link" href="#top" aria-label="Makeable home">
            <img src="/makeable-logo-tight.webp" alt="Makeable" />
          </a>
          <div className="mk-nav-links">
            <a href="#builds">Builds</a>
            <a href="#make">Create</a>
            <a href="#community">Community</a>
          </div>
          <button className="mk-nav-cta" type="button" onClick={openBuildLibrary}>
            {!authResolved ? "Checking…" : authUser ? <><span>My builds</span><ProfileAvatar user={authUser} /></> : "Sign in"}
          </button>
        </nav>
        <div
          className="mk-mobile-hero-media"
          aria-hidden="true"
          style={{ backgroundImage: `url(${activeHero.mobileImage ?? activeHero.image})` }}
        />

        <div className="mk-hero-copy">
          <h1>{activeHero.title}</h1>
          <p>{activeHero.description}</p>
          <div className="mk-hero-actions">
            <button className="mk-button mk-button-light" type="button" onClick={handleHeroAction}>
              {activeHero.cta}
            </button>
            <a className="mk-link-action" href="#make">
              Create your own <ArrowIcon />
            </a>
          </div>
        </div>

        <div className="mk-hero-builds" id="builds" data-builds-expanded={featuredBuildsExpanded || undefined}>
          <div className="mk-hero-builds-copy">
            <h2>Builds to get you started</h2>
            <button
              className="mk-featured-view-all"
              type="button"
              aria-pressed={featuredBuildsExpanded}
              onClick={() => setFeaturedBuildsExpanded((expanded) => !expanded)}
            >
              {featuredBuildsExpanded ? "Show carousel" : "View all builds"}
              <ArrowIcon />
            </button>
          </div>
          <div className="mk-featured-rail-shell">
            {featuredRailState.canGoBack ? (
              <button className="mk-featured-rail-control mk-featured-rail-control-back" type="button" aria-label="Show previous builds" onClick={() => moveFeaturedBuildsRail("back")}>
                <ArrowIcon direction="left" />
              </button>
            ) : null}
            <div ref={featuredBuildsRailRef} className="mk-hero-build-grid" aria-label="Featured builds" onScroll={syncFeaturedBuildsRail}>
              {starterBuilds.map((build) => (
                <button
                  className="mk-hero-build-card"
                  type="button"
                  key={build.id}
                  aria-current={activeHeroId === build.id ? "true" : undefined}
                  onClick={() => selectHeroBuild(build.id)}
                >
                  <img src={build.cardImage} alt={`${build.title} product render`} />
                  <span>{build.title}</span>
                  <small>{build.cta}</small>
                </button>
              ))}
            </div>
            {featuredRailState.canGoForward ? (
              <button className="mk-featured-rail-control mk-featured-rail-control-forward" type="button" aria-label="Show more builds" onClick={() => moveFeaturedBuildsRail("forward")}>
                <ArrowIcon />
              </button>
            ) : null}
          </div>
        </div>
      </section>

      <section className="mk-builder" id="make" aria-labelledby="make-title">
        <div className="mk-builder-inner">
          <h2 id="make-title">Create your own build.</h2>
          <p>Bring any idea to life.</p>
          <form className="mk-composer" onSubmit={submitBuild}>
            <label className="mk-sr-only" htmlFor="build-idea">Describe what you want to build</label>
            <textarea
              id="build-idea"
              value={idea}
              onChange={(event) => setIdea(event.target.value)}
              onKeyDown={onComposerKeyDown}
              placeholder="Describe what you want to build..."
              rows={3}
            />
            <button className="mk-plus" type="button" aria-label="Add details" onClick={() => document.getElementById("build-idea")?.focus()}>
              +
            </button>
            <button className="mk-submit" type="submit" aria-label="Generate build">
              <ArrowIcon />
            </button>
          </form>
          {authUser ? (
            <p className="mk-free-builds">{buildsRemaining} of {freeBuildLimit} free builds left</p>
          ) : null}
          {resumableJob && !workspaceOpen && (
            <button className="mk-resume-job" type="button" onClick={() => resumeBuildJob(resumableJob.id)}>
              Resume {resumableJob.state === "ready" ? "saving this build" : "build progress"}
            </button>
          )}
          {generationError && <p className="mk-form-error" role="status">{generationError}</p>}
        </div>
      </section>

      <section className="mk-community" id="community" aria-labelledby="community-title">
        <div className="mk-community-head">
          <div>
            <h2 id="community-title">Made with Makeable</h2>
            <p>See what others made.</p>
          </div>
          <button type="button" onClick={openBuildLibrary}>See my builds <ArrowIcon /></button>
        </div>
        <div className="mk-community-grid" ref={communityGridRef} onScroll={updateCommunityIndex}>
          {communityBuilds.map((build) => (
            <button className="mk-community-card" type="button" key={build.id} onClick={() => openProject(build)}>
              <ProjectImage src={build.image.url} alt={`${build.title} product render`} />
              <CreatorBadge build={build} />
              <span>{build.title}</span>
              <small>{build.image.source === "seed" ? "Makeable example" : build.status || "Concept"}</small>
              <p>{build.summary}</p>
              <b>Parts matched</b>
              <i aria-hidden="true"><ArrowIcon /></i>
            </button>
          ))}
        </div>
        <div className="mk-gallery-dots" aria-label="Community build pages">
          {communityBuilds.map((build, index) => (
            <button
              type="button"
              key={build.id}
              aria-label={`Show ${build.title}`}
              aria-current={communityIndex === index ? "true" : undefined}
              onClick={() => showCommunityBuild(index)}
            />
          ))}
        </div>
        <div className="mk-gallery-footer">
          <button type="button" onClick={() => setGalleryOpen(true)}>
            Full gallery <ArrowIcon />
          </button>
        </div>
      </section>

      <footer className="mk-footer">
        <div className="mk-footer-brand">
          <img src="/makeable-logo-tight.webp" alt="Makeable" />
          <p>Anything is Makeable</p>
        </div>
        <nav className="mk-footer-social" aria-label="Follow Makeable">
          <a href="mailto:makeable.build@gmail.com" aria-label="Email Makeable">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 6.5A2.5 2.5 0 0 1 6 4h12a2.5 2.5 0 0 1 2.5 2.5v11A2.5 2.5 0 0 1 18 20H6a2.5 2.5 0 0 1-2.5-2.5v-11Z" fill="none" stroke="currentColor" strokeWidth="1.8" /><path d="m4.5 6 7.5 5.6L19.5 6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" /></svg>
          </a>
          <a href="https://www.instagram.com/makeable.build/" target="_blank" rel="noreferrer" aria-label="Instagram">
            <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5" /><circle cx="12" cy="12" r="4" /><circle cx="17.5" cy="6.5" r="1" /></svg>
          </a>
          <a href="https://www.tiktok.com/@trymakeable.build?lang=en" target="_blank" rel="noreferrer" aria-label="TikTok">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3c.7 2.4 2.1 3.9 4.5 4.5v3.1c-1.6-.1-3.1-.6-4.5-1.5v6.2a5.3 5.3 0 1 1-4.6-5.2v3.2a2.1 2.1 0 1 0 1.4 2V3h3.2Z" /></svg>
          </a>
          <a href="https://discord.gg/vJa8XH5Vg" target="_blank" rel="noreferrer" aria-label="Discord">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19.54 4.12A16.6 16.6 0 0 0 15.46 3c-.2.36-.43.85-.59 1.24a15.3 15.3 0 0 0-5.74 0A13.4 13.4 0 0 0 8.54 3 16.6 16.6 0 0 0 4.46 4.12C1.88 7.95 1.18 11.68 1.53 15.36a16.7 16.7 0 0 0 5 2.52c.4-.54.76-1.11 1.06-1.72a10.7 10.7 0 0 1-1.67-.79c.14-.1.27-.2.4-.3 3.22 1.47 6.72 1.47 9.9 0 .13.11.27.21.4.3-.53.31-1.08.58-1.66.79.3.61.65 1.18 1.05 1.72a16.6 16.6 0 0 0 5-2.52c.42-4.27-.72-7.96-2.54-11.24ZM8.68 13.1c-.97 0-1.76-.9-1.76-2s.78-2 1.76-2 1.77.9 1.76 2c0 1.1-.78 2-1.76 2Zm6.64 0c-.97 0-1.76-.9-1.76-2s.78-2 1.76-2 1.77.9 1.76 2c0 1.1-.78 2-1.76 2Z" /></svg>
          </a>
          <a href="https://www.youtube.com/@makeablebuild" target="_blank" rel="noreferrer" aria-label="YouTube">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12c0 3.2-.4 5.2-1.1 6-.7.7-2.5 1-7.9 1s-7.2-.3-7.9-1C3.4 17.2 3 15.2 3 12s.4-5.2 1.1-6C4.8 5.3 6.6 5 12 5s7.2.3 7.9 1c.7.8 1.1 2.8 1.1 6Z" /><path className="mk-footer-social-play" d="m10 8.8 5 3.2-5 3.2V8.8Z" /></svg>
          </a>
          <a href="https://www.facebook.com/1321564764369821" target="_blank" rel="noreferrer" aria-label="Facebook">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13.7 21v-7.7h2.6l.4-3h-3V8.4c0-.9.3-1.5 1.6-1.5h1.7V4.2c-.3 0-1.3-.2-2.4-.2-2.4 0-4.1 1.5-4.1 4.2v2.1H8v3h2.5V21h3.2Z" /></svg>
          </a>
        </nav>
        <div className="mk-footer-legal">
          <span>© Makeable 2026</span>
          <span aria-hidden="true">·</span>
          <a href="/terms/">Terms</a>
          <span aria-hidden="true">·</span>
          <a href="/privacy/">Privacy</a>
        </div>
      </footer>

      {loginModal}

      {detailBuild && (
        <BuildDetail
          build={detailBuild}
          onClose={() => setDetailBuild(null)}
          onMake={() => {
            setIdea(`Make a ${detailBuild.title}`);
            setDetailBuild(null);
            window.setTimeout(() => document.getElementById("make")?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
          }}
        />
      )}

      {galleryOpen && (
        <FullGallery
          builds={communityBuilds}
          onClose={() => setGalleryOpen(false)}
          onSelect={(build) => {
            setGalleryOpen(false);
            openProject(build);
          }}
        />
      )}

      {preorderOpen && (
        <div className="mk-modal-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget && !preorderBusy) setPreorderOpen(false);
        }}>
          <form ref={preorderDialogRef} className="mk-preorder-modal" role="dialog" aria-modal="true" aria-labelledby="preorder-title" tabIndex={-1} onSubmit={startPreorder}>
            <button type="button" className="mk-modal-close" aria-label="Close preorder" onClick={() => setPreorderOpen(false)} disabled={preorderBusy}>x</button>
            <span>Build 001 preorder</span>
            <h2 id="preorder-title">Make Ember yours.</h2>
            <p>Free shipping. Estimated shipping: October 2026.</p>
            <strong>USD $34.99</strong>
            <label className="mk-check">
              <input type="checkbox" checked={preorderTerms} onChange={(event) => setPreorderTerms(event.target.checked)} />
              <span>I agree to the <a href="/terms/" target="_blank" rel="noreferrer">Terms</a> and acknowledge the <a href="/privacy/" target="_blank" rel="noreferrer">Privacy Policy</a>.</span>
            </label>
            <button className="mk-button mk-button-dark" type="submit" disabled={preorderBusy || !preorderTerms}>
              {preorderBusy ? "Opening checkout..." : "Continue to secure checkout"}
            </button>
            {preorderError && <p className="mk-form-error" role="alert">{preorderError}</p>}
          </form>
        </div>
      )}

      {countdown != null && (
        <div ref={countdownRef} className="mk-countdown" role="dialog" aria-modal="true" aria-labelledby="countdown-title" tabIndex={-1}>
          <div>
            <p>Coming soon</p>
            <h2 id="countdown-title" aria-live="assertive">{countdown > 0 ? countdown : "Soon"}</h2>
            <span>Full build access is not open yet.</span>
          </div>
        </div>
      )}
    </main>
  );
}

function BuildWorkspace({
  mode,
  user,
  build,
  builds,
  freeBuildLimit,
  buildsRemaining,
  authLoading,
  authUnavailable,
  generationBusy,
  jobId,
  startedAt,
  prompt,
  progress,
  stage,
  error,
  clarification,
  onBack,
  onSelectBuild,
  onCreateAnother,
  onDismiss,
  onCancel,
  onRetry,
  onChooseClarification,
  onEdit,
}: {
  mode: WorkspaceMode;
  user: AuthUser | null;
  build: BuildProject | null;
  builds: BuildProject[];
  freeBuildLimit: number;
  buildsRemaining: number;
  authLoading: boolean;
  authUnavailable: boolean;
  generationBusy: boolean;
  jobId: string;
  startedAt?: string;
  prompt: string;
  progress: number;
  stage: GenerationStage;
  error: string;
  clarification: BuildClarification | null;
  onBack: () => void;
  onSelectBuild: (build: BuildProject) => void;
  onCreateAnother: () => void;
  onDismiss: () => void;
  onCancel: () => void;
  onRetry: () => void;
  onChooseClarification: (refinedIdea: string) => void;
  onEdit: () => void;
}) {
  const isLoading = mode === "loading";
  const isClarifying = mode === "clarification" && Boolean(clarification);
  const isLibrary = mode === "library" && !build;
  const activeIdentity = build ? projectDisplayIdentity(build) : null;
  const [surface, setSurface] = useState<ProjectSurface>("overview");
  const wiringReady = Boolean(build && projectWiringReady(build));

  return (
    <main className="mk-app-shell" data-flow={isLoading || isClarifying ? "generation" : "project"}>
      <WorkspaceTopBar
        user={user}
        remaining={buildsRemaining}
        limit={freeBuildLimit}
        accountLoading={authLoading}
        accountUnavailable={authUnavailable}
        showBalance={!isLoading}
        onHome={onBack}
        building={isLoading || isClarifying}
        progress={isLoading ? progress : 0}
        surface={surface}
        wiringAvailable={wiringReady}
        onSelectSurface={setSurface}
        projects={builds.map((item) => ({ id: item.id, title: projectDisplayIdentity(item).title }))}
        selectedProjectId={build?.id}
        onSelectProject={(id) => {
          const selected = builds.find((item) => item.id === id);
          if (selected) {
            setSurface("overview");
            onSelectBuild(selected);
          }
        }}
      />

      {!isLoading && !isClarifying && <WorkspaceContextBar
        title={isLoading ? "Building your project" : activeIdentity?.title || (isClarifying ? "Choose a direction" : "My builds")}
        idea={isLoading || isClarifying ? prompt : build?.idea || build?.summary}
        label={isLoading ? "In the workshop" : isClarifying ? "Clarification" : build ? "Project" : "Library"}
        onHome={onBack}
        action={build && surface === "overview" && wiringReady ? (
          <button className="mk-context-primary" type="button" onClick={() => setSurface("wiring")}>
            Open wiring <ArrowIcon />
          </button>
        ) : undefined}
      />}

      <section className="mk-workspace-main" aria-labelledby="workspace-title">
        {isLoading ? (
          <GenerationWorkspace stage={stage} progress={progress} error={error} busy={generationBusy} buildId={jobId} startedAt={startedAt} prompt={prompt} onDismiss={onDismiss} onCancel={onCancel} onRetry={onRetry} onEdit={onEdit} />
        ) : isClarifying && clarification ? (
          <BuildClarificationPanel clarification={clarification} prompt={prompt} onChoose={onChooseClarification} onEdit={onEdit} />
        ) : isLibrary ? (
          <div className="mk-empty-library">
            <h1 id="workspace-title">My builds</h1>
            <p>You have not made a build on this browser yet.</p>
            <button className="mk-button mk-button-dark" type="button" onClick={onCreateAnother}>Create a build</button>
          </div>
        ) : build ? (
          surface === "code"
            ? <LockedCodePanel onBack={() => setSurface("overview")} />
            : surface === "wiring" && wiringReady
              ? <ProjectWiringGuide build={build} />
              : <BuildWorkspaceResult build={build} />
        ) : null}
      </section>

    </main>
  );
}

function BuildWorkspaceResult({ build }: { build: BuildProject }) {
  return <ProjectOverview build={build} />;
}

function BuildDetail({ build, onClose, onMake }: { build: BuildProject; onClose: () => void; onMake: () => void }) {
  const dialogRef = useRef<HTMLElement>(null);
  useDialogFocusTrap(true, dialogRef, onClose);

  return (
    <div className="mk-modal-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section ref={dialogRef} className="mk-build-detail" role="dialog" aria-modal="true" aria-labelledby="detail-title" tabIndex={-1}>
        <button type="button" className="mk-modal-close" aria-label="Close build details" onClick={onClose}>x</button>
        <div className="mk-detail-visual">
          <ProjectImage src={build.image.url} alt={`${build.title} product render`} />
          <div>
            <small>{build.status || "Concept"}</small>
            <strong>{build.title}</strong>
          </div>
        </div>
        <div className="mk-detail-content">
          <header className="mk-detail-header">
            <div className="mk-detail-brand-row">
              <img src="/makeable-logo-tight.webp" alt="Makeable" />
              <CreatorBadge build={build} variant="detail" />
            </div>
            <h2 id="detail-title">{build.title}</h2>
            <p>{build.summary}</p>
            {build.behavior && <p>{build.behavior}</p>}
            <ul className="mk-detail-traits" aria-label="Build highlights">
              <li><DetailTraitIcon kind="ready" /> Beginner-friendly</li>
              <li><DetailTraitIcon kind="time" /> 2–3 hours</li>
              <li><DetailTraitIcon kind="gift" /> Great for gifting</li>
            </ul>
            <button className="mk-detail-primary-action" type="button" onClick={onMake}>
              Make this build <span aria-hidden="true">→</span>
            </button>
          </header>
          <PartsList build={build} />
          <footer className="mk-detail-footer">
            <div>
              <span className="mk-detail-trust-mark" aria-label="Makeable"><i aria-hidden="true" /></span>
              <small>All parts link directly to trusted retailers.</small>
              <small>We select verified, pre-soldered parts to help ensure reliable hardware compatibility.</small>
            </div>
          </footer>
        </div>
      </section>
    </div>
  );
}

function DetailTraitIcon({ kind }: { kind: "ready" | "time" | "gift" }) {
  const common = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  if (kind === "ready") return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5" {...common} /><path d="m8.5 12 2.2 2.3 4.8-5" {...common} /></svg>;
  if (kind === "time") return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5" {...common} /><path d="M12 7.4v5l3 1.7" {...common} /></svg>;
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5.5 10.2h13v9h-13zM12 10.2v9M5.5 13.5h13M12 10.2c0-3.4-5.2-3.7-5.2-.8 0 1.2 1.5 1.8 5.2 1.8M12 10.2c0-3.4 5.2-3.7 5.2-.8 0 1.2-1.5 1.8-5.2 1.8" {...common} /></svg>;
}

function FullGallery({
  builds,
  onClose,
  onSelect,
}: {
  builds: BuildProject[];
  onClose: () => void;
  onSelect: (build: BuildProject) => void;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  useDialogFocusTrap(true, dialogRef, onClose);

  return (
    <div className="mk-modal-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section ref={dialogRef} className="mk-full-gallery" role="dialog" aria-modal="true" aria-labelledby="full-gallery-title" tabIndex={-1}>
        <button type="button" className="mk-modal-close" aria-label="Close full gallery" onClick={onClose}>x</button>
        <header>
          <small>Community builds</small>
          <h2 id="full-gallery-title">See what others made.</h2>
          <p>Open a project to see the idea, approachable part roles, and current retailer options.</p>
        </header>
        <div className="mk-full-gallery-grid">
          {builds.map((build) => (
            <button type="button" key={build.id} onClick={() => onSelect(build)}>
              <div>
                <ProjectImage src={build.image.url} alt={`${build.title} product render`} />
                <CreatorBadge build={build} />
              </div>
              <span>{build.title}</span>
              {build.image.source === "seed" && <small className="mk-example-badge">Makeable example</small>}
              <p>{build.summary}</p>
              <b>View build <ArrowIcon /></b>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

function CreatorBadge({ build, variant = "card" }: { build: BuildProject; variant?: "card" | "detail" }) {
  const creator = buildCreator(build);
  const isDetail = variant === "detail";
  return (
    <div className={`mk-community-creator mk-community-creator-${variant}`}>
      <span className="mk-creator-avatar" aria-hidden="true">
        <span>{creator.initial}</span>
        {creator.picture && (
          <img
            src={creator.picture}
            alt=""
            referrerPolicy="no-referrer"
            onError={(event) => { event.currentTarget.style.display = "none"; }}
          />
        )}
      </span>
      {isDetail ? (
        <span className="mk-creator-made-by">Made by {creator.handle}</span>
      ) : (
        <span className="mk-creator-copy">
          <strong>{creator.name}</strong>
          <small>{creator.handle}</small>
        </span>
      )}
    </div>
  );
}

function withCreatorSnapshot(build: BuildProject, user: AuthUser | null): BuildProject {
  if (!user) return build;
  const name = user.name?.trim() || "Makeable Maker";
  return {
    ...build,
    makerName: build.makerName || name,
    makerHandle: build.makerHandle || creatorHandle(name),
    makerPicture: build.makerPicture || user.picture || "",
  };
}

function buildCreator(build: BuildProject) {
  const name = build.makerName?.trim() || "Makeable Maker";
  return {
    name,
    handle: build.makerHandle?.trim() || creatorHandle(name),
    picture: build.makerPicture?.trim() || "",
    initial: name.charAt(0).toUpperCase() || "M",
  };
}

function creatorHandle(name: string) {
  const slug = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 24);
  return `@${slug || "makeablemaker"}`;
}

function PartsList({ build }: { build: BuildProject }) {
  const parts = build.parts;
  const listingIds = useMemo(
    () => [...new Set(parts.map((part) => part.listingId).filter((value): value is string => Boolean(value)))],
    [parts],
  );
  const [quotes, setQuotes] = useState<Record<string, RetailPriceQuote>>({});

  useEffect(() => {
    if (!listingIds.length) return;
    const controller = new AbortController();
    let active = true;
    const timeout = window.setTimeout(() => controller.abort(), 5500);
    fetch(apiUrl(`/api/part-prices?listingIds=${encodeURIComponent(listingIds.join(","))}`), {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("Price service unavailable");
        return await response.json() as { quotes?: RetailPriceQuote[] };
      })
      .then((payload) => {
        const nextQuotes = Object.fromEntries((payload.quotes || []).map((quote) => [quote.listingId, quote]));
        if (active) setQuotes(nextQuotes);
      })
      .catch(() => {})
      .finally(() => window.clearTimeout(timeout));
    return () => {
      active = false;
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [listingIds]);

  return (
    <section
      className="mk-detail-parts"
      aria-labelledby="detail-parts-title"
      aria-describedby="detail-parts-description"
    >
      <p className="mk-sr-only" id="detail-parts-description">Beginner-friendly: every module has its pins already soldered.</p>
      <div className="mk-detail-parts-head">
        <h3 id="detail-parts-title">Parts</h3>
        <span>Compare retailer prices</span>
      </div>
      <div className="mk-detail-part-list">
        {parts.map((part, index) => {
          const quote = part.listingId ? quotes[part.listingId] : undefined;
          const amazonUrl = quote?.destinationUrl || part.amazonUrl || part.url || retailerSearchUrl("amazon", part.name);
          const aliexpressUrl = part.aliexpressUrl || retailerSearchUrl("aliexpress", part.name);
          const amazonPrice = retailerPartPrice(part, "amazon", quote);
          const aliexpressPrice = retailerPartPrice(part, "aliexpress");
          return (
            <article className="mk-detail-part-card" key={`${part.id || part.asin || part.name}`}>
              <PartThumbnail part={part} />
              <div className="mk-detail-part-copy">
                <div className="mk-part-title-row">
                  <strong>{`${index + 1}. ${presentPartLabel(part, build)}`}</strong>
                  <span className="mk-detail-part-quantity">Qty {part.quantity || 1}</span>
                </div>
                <span>{partDisplayName(part)}</span>
                {partPackageNote(part) && <span className="mk-part-package-note">{partPackageNote(part)}</span>}
                <details className="mk-detail-part-why">
                  <summary>Why we picked this <i aria-hidden="true">i</i></summary>
                  <p>{presentPartPurpose(part, build)}</p>
                </details>
              </div>
              <div className="mk-detail-part-retailers" aria-label={`${part.name} retailer options`}>
                {amazonUrl && <a className="mk-detail-retailer mk-detail-retailer-amazon" href={amazonUrl} target="_blank" rel="noopener noreferrer sponsored">
                  <RetailerWordmark retailer="amazon" />
                  <strong>{amazonPrice}</strong>
                  <span>View on Amazon <i aria-hidden="true">↗</i></span>
                </a>}
                <a className="mk-detail-retailer mk-detail-retailer-aliexpress" href={aliexpressUrl} target="_blank" rel="noopener noreferrer sponsored">
                  <RetailerWordmark retailer="aliexpress" />
                  <strong>{aliexpressPrice}</strong>
                  <span>View on AliExpress <i aria-hidden="true">↗</i></span>
                </a>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function RetailerWordmark({ retailer }: { retailer: "amazon" | "aliexpress" }) {
  return <RetailerBrand retailer={retailer} />;
}

function partPackageNote(part: BuildPart) {
  const notes = [];
  const packageQuantity = Number(part.packageQuantity || part.packQty || 1);
  if (packageQuantity > 1) notes.push(`${packageQuantity} included in the pack`);
  if (part.includedComponents?.length) notes.push(`Includes ${part.includedComponents.join(" and ")}`);
  return notes.join(" · ");
}

function retailerPartPrice(part: BuildPart, retailer: "amazon" | "aliexpress", quote?: RetailPriceQuote) {
  if (retailer === "amazon" && quote?.price && Number.isInteger(quote.price.amount) && quote.price.amount > 0) {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: quote.price.currency }).format(quote.price.amount / 100);
  }
  const base = typeof part.price === "number" && Number.isFinite(part.price) && part.price > 0 ? part.price : 7.99;
  const amount = retailer === "aliexpress" ? Math.max(1.99, base * 0.62) : base;
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount);
}

function retailerSearchUrl(marketplace: "amazon" | "aliexpress", partName: string) {
  const query = encodeURIComponent(`${partName} pins soldered`);
  return marketplace === "amazon"
    ? `https://www.amazon.com/s?k=${query}`
    : `https://www.aliexpress.us/w/wholesale-${query}.html`;
}

function useDialogFocusTrap(
  active: boolean,
  dialogRef: RefObject<HTMLElement | null>,
  onClose: () => void,
  closeDisabled = false,
  initialFocusRef?: RefObject<HTMLElement | null>,
) {
  const closeRef = useRef(onClose);
  const closeDisabledRef = useRef(closeDisabled);

  useEffect(() => {
    closeRef.current = onClose;
    closeDisabledRef.current = closeDisabled;
  }, [onClose, closeDisabled]);

  useEffect(() => {
    if (!active) return undefined;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const focusable = () => Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ) || []).filter((element) => !element.hasAttribute("hidden") && element.getAttribute("aria-hidden") !== "true");

    const focusTimer = window.setTimeout(() => {
      (initialFocusRef?.current || focusable()[0] || dialogRef.current)?.focus();
    }, 0);

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape" && !closeDisabledRef.current) {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const elements = focusable();
      if (!elements.length) {
        event.preventDefault();
        dialogRef.current?.focus();
        return;
      }
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus();
    };
  }, [active, dialogRef, initialFocusRef]);
}
