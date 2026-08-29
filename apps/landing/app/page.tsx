"use client";

import { useRouter } from "next/navigation";
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
import { ArrowIcon, GenerationWorkspace, ProfileAvatar, ProfileChip, WorkspaceIcon } from "./workspace-ui";

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
  dispatch?: {
    path: string;
    timestamp: string;
    signature: string;
  } | null;
  error?: string;
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
type WorkspaceMode = "loading" | "result" | "library";

type HeroBuild = {
  id: string;
  title: string;
  description: string;
  image: string;
  mobileImage?: string;
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
    image: "/concepts/homepage-v2/ember-flagship-hero-v2.webp",
    mobileImage: "/concepts/homepage-v2/ember-flagship-hero-physical-geometry-v9.png",
    cardImage: "/concepts/homepage-v2/ember-flagship-hero-v2.webp",
    cta: "Pre-order Ember",
    action: "preorder",
  },
  {
    id: "study-desk-companion",
    title: "Study Desk Companion",
    description: "A compact focus buddy with a real screen and a tactile desk control.",
    image: "/concepts/homepage-v2/study-desk-companion-v2.webp",
    cardImage: "/concepts/homepage-v2/study-desk-companion-v2.webp",
    cta: "Coming soon",
    action: "soon",
  },
  {
    id: "plant-companion",
    title: "Plant Companion",
    description: "Give your plant a simple way to show when it needs attention.",
    image: "/concepts/homepage-v2/plant-companion-v2.webp",
    cardImage: "/concepts/homepage-v2/plant-companion-v2.webp",
    cta: "Coming soon",
    action: "soon",
  },
  {
    id: "motion-light",
    title: "Motion Light",
    description: "A small printed light with a translucent FDM diffuser that wakes up gently when you walk by.",
    image: "/concepts/homepage-v2/motion-light-v2.webp",
    cardImage: "/concepts/homepage-v2/motion-light-v2.webp",
    cta: "Coming soon",
    action: "soon",
  },
  {
    id: "window-air-monitor",
    title: "Window Air Monitor",
    description: "A simple screen that helps you know when to open the window.",
    image: "/assets/landing/gallery-v2/window-air-final-v2.webp",
    cardImage: "/assets/landing/gallery-v2/window-air-final-v2.webp",
    cta: "Coming soon",
    action: "soon",
  },
  {
    id: "pet-water-reminder",
    title: "Pet Water Reminder",
    description: "A gentle desk reminder for keeping your pet's water fresh.",
    image: "/assets/landing/gallery-v2/pet-water-final-v2.webp",
    cardImage: "/assets/landing/gallery-v2/pet-water-final-v2.webp",
    cta: "Coming soon",
    action: "soon",
  },
  {
    id: "quiet-door-chime",
    title: "Quiet Door Chime",
    description: "A calm way to know when someone arrives.",
    image: "/assets/landing/gallery-v2/quiet-chime-final-v3.webp",
    cardImage: "/assets/landing/gallery-v2/quiet-chime-final-v3.webp",
    cta: "Coming soon",
    action: "soon",
  },
];

const starterBuilds = heroBuilds;

const generationStages: GenerationStage[] = [
  {
    at: 0,
    label: "Sketching the enclosure",
    detail: "Fitting the idea into one compact printable shell.",
  },
  {
    at: 24,
    label: "Matching real parts",
    detail: "Picking verified pre-soldered modules from the catalog.",
  },
  {
    at: 48,
    label: "Checking printability",
    detail: "Reserving room for ports, sensors, screens, and service access.",
  },
  {
    at: 70,
    label: "Rendering the build",
    detail: "Turning the plan into a clean product preview.",
  },
  {
    at: 88,
    label: "Preparing your folder",
    detail: "Laying out the render, parts, cost, and next steps.",
  },
  {
    at: 100,
    label: "Build ready",
    detail: "Opening your Makeable project workspace.",
  },
];

const jobCheckpointStages: Record<BuildJobState, GenerationStage & { progress: number }> = {
  queued: {
    at: 0,
    progress: 8,
    label: "Queued in the workshop",
    detail: "Your idea is in line and the build job has been created.",
  },
  planning: {
    at: 24,
    progress: 24,
    label: "Sketching the enclosure",
    detail: "Fitting the idea into one compact printable shell.",
  },
  fitting_parts: {
    at: 48,
    progress: 48,
    label: "Matching real parts",
    detail: "Picking verified pre-soldered modules from the catalog.",
  },
  rendering: {
    at: 70,
    progress: 74,
    label: "Rendering the build",
    detail: "Turning the plan into a clean product preview.",
  },
  ready: {
    at: 92,
    progress: 96,
    label: "Build ready",
    detail: "Sign in to claim it, or opening your Makeable project workspace.",
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
  return jobState ? jobCheckpointStages[jobState] : generationStageFor(progress);
}

function progressForJob(job: BuildJob | null) {
  return job ? jobCheckpointStages[job.state]?.progress ?? 8 : 8;
}

function isActiveBuildJob(job: BuildJob | null) {
  return Boolean(job && !["failed", "cancelled"].includes(job.state) && !job.buildId);
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
    presoldered: true,
  };
}

export default function Home() {
  const router = useRouter();
  const [activeHeroId, setActiveHeroId] = useState("ember");
  const [featuredBuildsExpanded, setFeaturedBuildsExpanded] = useState(false);
  const [featuredRailState, setFeaturedRailState] = useState({ canGoBack: false, canGoForward: false });
  const [idea, setIdea] = useState("");
  const [generationBusy, setGenerationBusy] = useState(false);
  const [generationProgress, setGenerationProgress] = useState(0);
  const [generationError, setGenerationError] = useState("");
  const [generatedBuilds, setGeneratedBuilds] = useState<BuildProject[]>([]);
  const [detailBuild, setDetailBuild] = useState<BuildProject | null>(null);
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>("loading");
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [workspaceBuild, setWorkspaceBuild] = useState<BuildProject | null>(null);
  const [accountBuilds, setAccountBuilds] = useState<BuildProject[]>([]);
  const [quota, setQuota] = useState<BuildQuota>(DEFAULT_BUILD_QUOTA);
  const [currentJob, setCurrentJob] = useState<BuildJob | null>(null);
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
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

  const activeHero = heroBuilds.find((build) => build.id === activeHeroId) || heroBuilds[0];
  const activeGenerationStage = generationStageForJob(currentJob?.state || "", generationProgress);
  const freeBuildLimit = quota.limit;
  const buildsRemaining = quota.remaining;
  const resumableJob = isActiveBuildJob(currentJob) ? currentJob : null;
  const communityBuilds = useMemo(
    () => [...generatedBuilds, ...seedCommunityBuilds],
    [generatedBuilds],
  );

  useEffect(() => {
    authUserRef.current = authUser;
  }, [authUser]);

  useEffect(() => {
    currentJobRef.current = currentJob;
  }, [currentJob]);

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
        return null;
      }
      if (!response.ok) return null;
      const result = await readJsonResponse<AccountBuildsResponse>(response);
      if (result.analyticsId) identifyMakeableAccount(result.analyticsId);
      authUserRef.current = result.user;
      setAuthUser(result.user);
      setAccountBuilds(result.builds || []);
      setQuota(normalizeQuota(result.quota));
      if (openLibrary) {
        setWorkspaceOpen(true);
        setWorkspaceMode("library");
        setWorkspaceBuild(result.builds?.[0] || null);
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
      return result;
    } catch {
      return null;
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

    if (result.job) setCurrentJob(result.job);
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
    await abortableDelay(220, signal || new AbortController().signal).catch(() => undefined);
    if (!signal?.aborted) router.push(`/app?build=${encodeURIComponent(buildId)}`);
    setGenerationBusy(false);
    return build;
  }, [fetchAccount, openLogin, router]);

  const runBuildJobPoll = useCallback(async (jobId: string, signal: AbortSignal): Promise<"claimed" | "waiting_for_auth"> => {
    setWorkspaceOpen(true);
    setWorkspaceMode("loading");
    setWorkspaceBuild(null);
    setGenerationBusy(true);
    window.scrollTo({ top: 0, behavior: "smooth" });

    while (!signal.aborted) {
      const response = await fetch(apiUrl(`/api/build-jobs/${encodeURIComponent(jobId)}`), {
        headers: { Accept: "application/json" },
        credentials: "include",
        signal,
      });
      const result = await readJsonResponse<BuildJobStatusResponse>(response);
      if (!response.ok || !result.job) {
        throw new Error(result.error || "Makeable could not check this build job.");
      }
      const job = result.job;
      setCurrentJob(job);
      setGenerationProgress(progressForJob(job));
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
    setCurrentJob(null);
    setGenerationBusy(true);
    setGenerationProgress(5);
    setGenerationError("");
    window.scrollTo({ top: 0, behavior: "smooth" });
    try {
      const response = await fetch(apiUrl("/api/build-jobs"), {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        credentials: "include",
        body: JSON.stringify({
          idea: nextIdea,
          posthogDistinctId: makeableDistinctId(),
        }),
        signal: requestController.signal,
      });
      const result = await readJsonResponse<StartBuildJobResponse>(response);
      const job = result.job || result.activeJob || null;
      if (!response.ok && !job) throw new Error(result.error || "Makeable could not start this build job.");
      if (!job) throw new Error("Makeable did not return a build job id.");
      if (result.dispatch) {
        const dispatchResponse = await fetch(apiUrl(result.dispatch.path), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Makeable-Background-Timestamp": result.dispatch.timestamp,
            "X-Makeable-Background-Signature": result.dispatch.signature,
          },
          credentials: "include",
          body: JSON.stringify({ jobId: job.id }),
          signal: requestController.signal,
        });
        if (!dispatchResponse.ok && dispatchResponse.status !== 202) {
          throw new Error("Makeable could not send this build to the workshop. Try again.");
        }
      }
      setCurrentJob(job);
      setGenerationProgress(progressForJob(job));
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
    }
    generateBuildForIdea(trimmed);
  }

  function onComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
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
        <p>{loginIntent === "generate" ? "Your build is already being prepared. Sign in to save it to your project folder and the community gallery." : "Sign in to see the builds you made."}</p>
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
          mode={workspaceMode}
          user={authUser}
          build={workspaceBuild}
          builds={accountBuilds}
          freeBuildLimit={freeBuildLimit}
          buildsRemaining={buildsRemaining}
          progress={generationProgress}
          stage={activeGenerationStage}
          error={generationError}
          onBack={() => {
            generationAbortRef.current?.abort();
            setGenerationBusy(false);
            setWorkspaceOpen(false);
            setGenerationError("");
            window.setTimeout(() => document.getElementById("top")?.scrollIntoView({ behavior: "smooth" }), 0);
          }}
          onSelectBuild={(build) => {
            setWorkspaceBuild(build);
            setWorkspaceMode("result");
          }}
          onCreateAnother={() => {
            setWorkspaceOpen(false);
            window.setTimeout(() => document.getElementById("make")?.scrollIntoView({ behavior: "smooth" }), 0);
          }}
          onDismiss={() => {
            generationAbortRef.current?.abort();
            setGenerationBusy(false);
            setWorkspaceOpen(false);
            setGenerationError("");
          }}
          onCancel={cancelCurrentBuildJob}
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
        style={{ "--mk-hero-image": `url(${activeHero.image})` } as CSSProperties}
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
            {authUser ? <><span>My builds</span><ProfileAvatar user={authUser} /></> : "Sign in"}
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
            <button className="mk-community-card" type="button" key={build.id} onClick={() => setDetailBuild(build)}>
              <img src={build.image.url} alt={`${build.title} product render`} />
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
        <div>
          <img src="/makeable-logo-tight.webp" alt="Makeable" />
          <p>Anything is Makeable</p>
        </div>
        <nav aria-label="Footer navigation">
          <a href="https://www.instagram.com/makeable.build/" target="_blank" rel="noreferrer">Instagram</a>
          <a href="https://www.tiktok.com/" target="_blank" rel="noreferrer">TikTok</a>
          <a href="/terms/">Terms</a>
        </nav>
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
            setDetailBuild(build);
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
  progress,
  stage,
  error,
  onBack,
  onSelectBuild,
  onCreateAnother,
  onDismiss,
  onCancel,
}: {
  mode: WorkspaceMode;
  user: AuthUser | null;
  build: BuildProject | null;
  builds: BuildProject[];
  freeBuildLimit: number;
  buildsRemaining: number;
  progress: number;
  stage: GenerationStage;
  error: string;
  onBack: () => void;
  onSelectBuild: (build: BuildProject) => void;
  onCreateAnother: () => void;
  onDismiss: () => void;
  onCancel: () => void;
}) {
  const isLoading = mode === "loading";
  const isLibrary = mode === "library" && !build;

  return (
    <main className="mk-app-shell">
      <header className="mk-app-header">
        <ProfileChip user={user} remaining={buildsRemaining} limit={freeBuildLimit} />
      </header>

      <aside className="mk-project-sidebar" aria-label="Project folder">
        <button className="mk-logo-link mk-sidebar-logo" type="button" onClick={onBack} aria-label="Makeable home">
          <img src="/makeable-logo-tight.webp" alt="Makeable" />
        </button>
        <button className="mk-sidebar-back" type="button" onClick={onBack}>
          <ArrowIcon direction="left" /> Back to home
        </button>
        <div className="mk-sidebar-project">
          <span>Project folder</span>
          <strong>{build?.title || (isLoading ? "Generating build" : "My builds")}</strong>
        </div>
        <button type="button" aria-current={mode === "library" ? "true" : undefined} onClick={() => build && onSelectBuild(build)}>
          <WorkspaceIcon kind="overview" /> Overview
        </button>
        <button type="button" disabled><WorkspaceIcon kind="parts" /> Parts</button>
        <button type="button" disabled><WorkspaceIcon kind="enclosure" /> Enclosure</button>
        <button type="button" disabled><WorkspaceIcon kind="wiring" /> Wiring</button>
        <button type="button" disabled><WorkspaceIcon kind="code" /> Code</button>
        <div className="mk-library-list">
          <span>Your builds</span>
          {builds.length ? builds.map((item) => (
            <button type="button" key={item.id} onClick={() => onSelectBuild(item)} aria-current={build?.id === item.id ? "true" : undefined}>
              {item.title}
            </button>
          )) : <small>No saved builds yet.</small>}
        </div>
      </aside>

      <section className="mk-workspace-main" aria-labelledby="workspace-title">
        {isLoading ? (
          <GenerationWorkspace stage={stage} progress={progress} error={error} onDismiss={onDismiss} onCancel={onCancel} />
        ) : isLibrary ? (
          <div className="mk-empty-library">
            <h1 id="workspace-title">My builds</h1>
            <p>You have not made a build on this browser yet.</p>
            <button className="mk-button mk-button-dark" type="button" onClick={onCreateAnother}>Create a build</button>
          </div>
        ) : build ? (
          <BuildWorkspaceResult build={build} />
        ) : null}
        {!isLoading && (
          <div className="mk-coming-banner">
            <span className="mk-banner-mark" aria-hidden="true"><WorkspaceIcon kind="info" /></span>
            <div>
              <strong>Full Build Coming Soon</strong>
              <span>CAD files, wiring, code, and the step-by-step build guide are still being prepared.</span>
            </div>
          </div>
        )}
      </section>

      <button className="mk-back-home" type="button" onClick={onBack}>
        <ArrowIcon direction="left" /> Back to home
      </button>
    </main>
  );
}

function BuildWorkspaceResult({ build }: { build: BuildProject }) {
  return (
    <div className="mk-workspace-grid">
      <figure className="mk-build-render">
        <img src={build.image.url} alt={`${build.title} product render`} />
        <figcaption>{build.image.source === "openai" ? "Generated render" : "Preview render"}</figcaption>
      </figure>
      <section className="mk-build-brief" aria-labelledby="workspace-title">
        <div className="mk-workspace-title">
          <small>{build.status || "ESP32 Project"}</small>
          <h1 id="workspace-title">{build.title}</h1>
          <p>{build.summary}</p>
        </div>
        {build.behavior && <p className="mk-build-behavior">{build.behavior}</p>}
        {build.warnings?.length ? (
          <details className="mk-build-notes">
            <summary>Design notes <span>{build.warnings.length}</span></summary>
            <ul className="mk-warnings">
              {build.warnings.map((warning) => <li key={warning}>{warning}</li>)}
            </ul>
          </details>
        ) : null}
      </section>
      <section className="mk-parts mk-workspace-parts" aria-labelledby="parts-title">
        <h2 id="parts-title">Parts you need</h2>
        <ul>
          {build.parts.map((part) => (
            <li key={`${part.id || part.asin || part.name}`}>
              <div className="mk-part-thumb" aria-hidden="true">{partCategoryLabel(part).slice(0, 1)}</div>
              <div>
                <small>{partPlainLabel(part)}</small>
                <strong>{part.name}</strong>
                <span>{[partCategoryLabel(part), part.priceLabel].filter(Boolean).join(" - ")}</span>
                <p className="mk-part-purpose">{partPurpose(part)}</p>
                <time className="mk-part-checked" dateTime={part.checkedDate}>Checked {part.checkedDate || "in the verified catalog"}</time>
              </div>
              <b className="mk-part-quantity" aria-label="Quantity one">×1</b>
              {part.url && <a href={part.url} target="_blank" rel="noreferrer">Buy</a>}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
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
          <img src={build.image.url} alt={`${build.title} product render`} />
          <div>
            <small>{build.status || "Concept"}</small>
            <strong>{build.title}</strong>
          </div>
        </div>
        <div className="mk-detail-content">
          <header className="mk-detail-header">
            <CreatorBadge build={build} variant="detail" />
            <small>{build.status || "Concept"}</small>
            <h2 id="detail-title">{build.title}</h2>
            <p>{build.summary}</p>
            {build.behavior && <p>{build.behavior}</p>}
          </header>
          <PartsList parts={build.parts} />
          <footer className="mk-detail-footer">
            <div>
              <small>Beginner-friendly concept</small>
              <strong>{build.parts.length} ready-to-connect parts</strong>
            </div>
            <button className="mk-button mk-button-dark" type="button" onClick={onMake}>
              Make this build <ArrowIcon />
            </button>
          </footer>
        </div>
      </section>
    </div>
  );
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
                <img src={build.image.url} alt={`${build.title} product render`} />
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
      <span className="mk-creator-copy">
        <strong>{creator.name}</strong>
        <small>{creator.handle}</small>
      </span>
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

function PartsList({ parts }: { parts: BuildPart[] }) {
  const listingIds = useMemo(
    () => [...new Set(parts.map((part) => part.listingId).filter((value): value is string => Boolean(value)))],
    [parts],
  );
  const [quotes, setQuotes] = useState<Record<string, RetailPriceQuote>>({});
  const [priceStatus, setPriceStatus] = useState<"checking" | "ready" | "partial" | "fallback">(
    listingIds.length ? "checking" : "fallback",
  );

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
        setQuotes(nextQuotes);
        const liveCount = Object.values(nextQuotes).filter((quote) =>
          ["fresh", "recent"].includes(quote.displayState) && validRetailPrice(quote.price),
        ).length;
        setPriceStatus(liveCount === listingIds.length ? "ready" : liveCount ? "partial" : "fallback");
      })
      .catch(() => {
        if (active) setPriceStatus("fallback");
      })
      .finally(() => window.clearTimeout(timeout));
    return () => {
      active = false;
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [listingIds]);

  const liveQuotes = Object.values(quotes).filter((quote) =>
    ["fresh", "recent"].includes(quote.displayState) && validRetailPrice(quote.price),
  );
  const priceSummary = priceStatus === "checking"
    ? "Checking current prices"
    : priceStatus === "ready"
      ? `${formatRetailTotal(liveQuotes)} across ${liveQuotes.length} priced parts`
      : priceStatus === "partial"
        ? `${liveQuotes.length} of ${parts.length} current prices found`
        : "Open a retailer for today’s price";

  return (
    <section className="mk-detail-parts" aria-labelledby="detail-parts-title">
      <div className="mk-detail-parts-head">
        <div>
          <h3 id="detail-parts-title">Parts you need</h3>
          <p>Ready to connect—every module has its pins already soldered.</p>
        </div>
        <span className="mk-detail-price-state" data-status={priceStatus}>
          <i aria-hidden="true" /> {priceSummary}
        </span>
      </div>
      <div className="mk-detail-part-list">
        {parts.map((part, index) => {
          const quote = part.listingId ? quotes[part.listingId] : undefined;
          const amazonUrl = quote?.destinationUrl || part.amazonUrl || part.url || retailerSearchUrl("amazon", part.name);
          const aliexpressUrl = part.aliexpressUrl || retailerSearchUrl("aliexpress", part.name);
          return (
            <article className="mk-detail-part-card" key={`${part.id || part.asin || part.name}`}>
              <span className="mk-detail-part-number" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
              <div className="mk-detail-part-copy">
                <strong>{part.role || partPlainLabel(part)}</strong>
                <span>{part.name}</span>
                <p>{partPurpose(part)}</p>
              </div>
              <div className="mk-detail-part-shop">
                <strong>{retailPriceLabel(part, quote, priceStatus)}</strong>
                <span>{retailCheckedLabel(part, quote)}</span>
                <div>
                  {amazonUrl && <a href={amazonUrl} target="_blank" rel="noopener noreferrer sponsored">Amazon <span aria-hidden="true">↗</span></a>}
                  <a href={aliexpressUrl} target="_blank" rel="noopener noreferrer sponsored">AliExpress <span aria-hidden="true">↗</span></a>
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function retailPriceLabel(
  part: BuildPart,
  quote: RetailPriceQuote | undefined,
  status: "checking" | "ready" | "partial" | "fallback",
) {
  if (status === "checking" && part.listingId) return "Checking price…";
  if (quote && ["fresh", "recent"].includes(quote.displayState) && validRetailPrice(quote.price)) {
    return formatRetailPrice(quote.price);
  }
  if (quote?.displayState === "stale" && validRetailPrice(quote.price)) {
    return `Last seen ${formatRetailPrice(quote.price)}`;
  }
  return part.priceLabel && !/live price/i.test(part.priceLabel) ? part.priceLabel : "See current price";
}

function retailCheckedLabel(part: BuildPart, quote?: RetailPriceQuote) {
  if (quote && ["fresh", "recent"].includes(quote.displayState) && quote.asOf) {
    const elapsedMinutes = Math.max(1, Math.round((Date.now() - Date.parse(quote.asOf)) / 60000));
    return elapsedMinutes < 60 ? `Checked ${elapsedMinutes} min ago` : `Checked ${Math.round(elapsedMinutes / 60)} hr ago`;
  }
  if (part.checkedDate) return `Checked ${part.checkedDate}`;
  return "Price shown on retailer site";
}

function validRetailPrice(price?: { amount: number; currency: string }): price is { amount: number; currency: string } {
  return Boolean(price && Number.isInteger(price.amount) && price.amount > 0 && /^[A-Z]{3}$/.test(price.currency));
}

function formatRetailPrice(price: { amount: number; currency: string }) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: price.currency }).format(price.amount / 100);
}

function formatRetailTotal(quotes: RetailPriceQuote[]) {
  const prices = quotes.map((quote) => quote.price).filter(validRetailPrice);
  if (!prices.length || prices.some((price) => price.currency !== prices[0].currency)) return "Current prices found";
  return formatRetailPrice({
    amount: prices.reduce((sum, price) => sum + price.amount, 0),
    currency: prices[0].currency,
  });
}

function retailerSearchUrl(marketplace: "amazon" | "aliexpress", partName: string) {
  const query = encodeURIComponent(`${partName} pins soldered`);
  return marketplace === "amazon"
    ? `https://www.amazon.com/s?k=${query}`
    : `https://www.aliexpress.us/w/wholesale-${query}.html`;
}

function partCategoryLabel(part: BuildPart) {
  return {
    controller: "Controller",
    display: "Display",
    sensor: "Sensor",
    input: "Input",
    output: "Output",
    connector: "Connector",
    power: "Power",
    storage: "Storage",
    time: "Time",
  }[part.category || ""] || part.category || "Part";
}

function partPlainLabel(part: BuildPart) {
  const text = `${part.category || ""} ${part.subtype || ""} ${part.name || ""}`.toLowerCase();
  if (part.category === "controller") return "The brain";
  if (part.category === "display" || /oled|lcd|display|screen/.test(text)) return "The display";
  if (/vl53|time.of.flight|\btof\b|distance|ultrasonic|hc.?sr04/.test(text)) return "Distance sensor";
  if (/temperature|humidity|bme280|bme680|bmp280/.test(text)) return "Climate sensor";
  if (/soil|water|moisture/.test(text)) return "Plant sensor";
  if (/air quality|pressure|gas|voc|co2/.test(text)) return "Air sensor";
  if (/ambient light|color sensor|bh1750|tcs34725/.test(text)) return "Light sensor";
  if (/radar|presence|motion|pir|reed|imu|accelerometer/.test(text)) return "Motion sensor";
  if (/button|touch|encoder|knob|input/.test(text)) return "User control";
  if (/sensor/.test(text)) return "Sensor";
  if (/buzzer|speaker|piezo/.test(text)) return "Sound feedback";
  if (/led|rgb|output|light/.test(text)) return "Status light";
  if (/connector|qwiic|usb/.test(text)) return "Connector";
  return "Verified module";
}

function partPurpose(part: BuildPart) {
  if (part.why) return part.why;
  return `${partPlainLabel(part)} selected for this build's main interaction.`;
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
