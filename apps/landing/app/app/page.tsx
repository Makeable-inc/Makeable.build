"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowIcon, FolderSkeleton, ProfileChip, WorkspaceIcon } from "../workspace-ui";
import { buildLibrary } from "./build-library";
import { ProjectOverview } from "../project-overview";

type BuildPart = {
  id?: string;
  name: string;
  category?: string;
  subtype?: string;
  priceLabel?: string;
  asin?: string;
  url?: string;
  why?: string;
  checkedDate?: string;
};

type BuildProject = {
  id: string;
  title: string;
  summary: string;
  behavior?: string;
  image: {
    url: string;
    source?: string;
  };
  parts: BuildPart[];
  warnings?: string[];
  cost?: {
    estimateLabel: string;
    note: string;
  };
  status?: string;
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
  builds: BuildProject[];
  quota?: BuildQuota;
};

const DEFAULT_BUILD_QUOTA: BuildQuota = {
  limit: 10,
  used: 0,
  reserved: 0,
  remaining: 10,
};

const API_ORIGIN = process.env.NEXT_PUBLIC_MAKEABLE_API_ORIGIN
  || (process.env.NODE_ENV === "development" ? "http://127.0.0.1:8787" : "");

function apiUrl(path: string) {
  return `${API_ORIGIN}${path}`;
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

function sharedProjectFromSession(): BuildProject | null {
  if (typeof window === "undefined") return null;
  try {
    const value = window.sessionStorage.getItem("makeable:open-project");
    if (!value) return null;
    const project = JSON.parse(value) as BuildProject;
    return project?.id && project?.title && Array.isArray(project.parts) && project.image?.url ? project : null;
  } catch {
    return null;
  }
}

export default function BuildAppPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [user, setUser] = useState<AuthUser | null>(null);
  const [accountBuilds, setAccountBuilds] = useState<BuildProject[]>([]);
  const [publicBuilds, setPublicBuilds] = useState<BuildProject[]>([]);
  const [sharedProject] = useState<BuildProject | null>(sharedProjectFromSession);
  const [selectedBuildId, setSelectedBuildId] = useState(() => (
    typeof window === "undefined" ? "" : new URL(window.location.href).searchParams.get("build") || ""
  ));
  const [quota, setQuota] = useState<BuildQuota>(DEFAULT_BUILD_QUOTA);
  const freeBuildLimit = quota.limit;
  const buildsRemaining = quota.remaining;

  const builds = buildLibrary(accountBuilds, publicBuilds, Boolean(user));

  const activeBuild = useMemo(() => {
    const selected = builds.find((build) => build.id === selectedBuildId)
      || publicBuilds.find((build) => build.id === selectedBuildId)
      || (sharedProject?.id === selectedBuildId ? sharedProject : null);
    return selected || builds[0] || publicBuilds[0] || null;
  }, [builds, publicBuilds, selectedBuildId, sharedProject]);

  useEffect(() => {
    let cancelled = false;

    async function loadBuilds() {
      setLoading(true);
      setLoadError("");
      try {
        const [accountResult, publicResult] = await Promise.allSettled([
          fetch(apiUrl("/api/account/builds"), {
            headers: { Accept: "application/json" },
            credentials: "include",
          }),
          fetch(apiUrl("/api/builds"), { headers: { Accept: "application/json" } }),
        ]);

        if (cancelled) return;

        let loadedAnyBuilds = false;
        if (accountResult.status === "fulfilled" && accountResult.value.ok) {
          const accountResponse = accountResult.value;
          const account = await accountResponse.json() as AccountBuildsResponse;
          if (!cancelled) {
            setUser(account.user);
            setAccountBuilds(Array.isArray(account.builds) ? account.builds : []);
            setQuota(normalizeQuota(account.quota));
            loadedAnyBuilds = Array.isArray(account.builds) && account.builds.length > 0;
          }
        } else if (accountResult.status === "fulfilled" && accountResult.value.status === 401) {
          setUser(null);
          setAccountBuilds([]);
          setQuota(DEFAULT_BUILD_QUOTA);
        }

        if (publicResult.status === "fulfilled" && publicResult.value.ok) {
          const publicResponse = publicResult.value;
          const publicData = await publicResponse.json() as { builds?: BuildProject[] };
          if (!cancelled) {
            const nextPublicBuilds = Array.isArray(publicData.builds) ? publicData.builds : [];
            setPublicBuilds(nextPublicBuilds);
            loadedAnyBuilds = loadedAnyBuilds || nextPublicBuilds.length > 0;
          }
        }
        if (!loadedAnyBuilds && accountResult.status === "rejected" && publicResult.status === "rejected") {
          setLoadError("Makeable could not load this project folder.");
        }
      } catch {
        if (!cancelled) setLoadError("Makeable could not load this project folder.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadBuilds();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const restoreBuildFromUrl = () => {
      setSelectedBuildId(new URL(window.location.href).searchParams.get("build") || "");
    };
    window.addEventListener("popstate", restoreBuildFromUrl);
    return () => window.removeEventListener("popstate", restoreBuildFromUrl);
  }, []);

  const selectBuild = useCallback((build: BuildProject) => {
    if (build.id === selectedBuildId) return;
    setSelectedBuildId(build.id);
    const url = new URL(window.location.href);
    url.searchParams.set("build", build.id);
    window.history.pushState({ makeableBuild: build.id }, "", `${url.pathname}${url.search}${url.hash}`);
  }, [selectedBuildId]);

  const goHome = useCallback(() => {
    router.push("/");
  }, [router]);

  return (
    <main className="mk-app-shell">
      <header className="mk-app-header">
        <ProfileChip user={user} remaining={buildsRemaining} limit={freeBuildLimit} />
      </header>

      <aside className="mk-project-sidebar" aria-label="Project folder">
        <button className="mk-logo-link mk-sidebar-logo" type="button" onClick={goHome} aria-label="Makeable home">
          <img src="/makeable-logo-tight.webp" alt="Makeable" />
        </button>
        <button className="mk-sidebar-back" type="button" onClick={goHome}>
          <ArrowIcon direction="left" /> Back to home
        </button>
        <div className="mk-sidebar-project">
          <span>Project folder</span>
          <strong>{activeBuild?.title || "My builds"}</strong>
        </div>
        <button type="button" aria-current="true" onClick={() => activeBuild && selectBuild(activeBuild)}>
          <WorkspaceIcon kind="overview" /> Overview
        </button>
        <button type="button" disabled><WorkspaceIcon kind="parts" /> Parts</button>
        <button type="button" disabled><WorkspaceIcon kind="enclosure" /> Enclosure</button>
        <button type="button" disabled><WorkspaceIcon kind="wiring" /> Wiring</button>
        <button type="button" disabled><WorkspaceIcon kind="code" /> Code</button>
        <div className="mk-library-list">
          <span>{user ? "Your builds" : "Community builds"}</span>
          {builds.length ? builds.map((build) => (
            <button
              type="button"
              key={build.id}
              onClick={() => selectBuild(build)}
              aria-current={activeBuild?.id === build.id ? "true" : undefined}
            >
              {build.title}
            </button>
          )) : <small>No saved builds yet.</small>}
        </div>
      </aside>

      <section className="mk-workspace-main" aria-labelledby="workspace-title">
        {loading ? (
          <FolderSkeleton />
        ) : activeBuild ? (
          <BuildWorkspaceResult build={activeBuild} />
        ) : (
          <div className="mk-empty-library">
            <h1 id="workspace-title">My builds</h1>
            <p>{loadError || "No build was found for this link yet. Sign in from the homepage to save new builds here."}</p>
            <button className="mk-button mk-button-dark" type="button" onClick={goHome}>Back to main page</button>
          </div>
        )}

        {!loading && activeBuild && (
          <div className="mk-coming-banner">
            <span className="mk-banner-mark" aria-hidden="true"><WorkspaceIcon kind="info" /></span>
            <div>
              <strong>More project areas are coming soon</strong>
              <span>Parts, enclosure files, wiring, code, and the step-by-step guide will appear in these tabs as the build is completed.</span>
            </div>
          </div>
        )}
      </section>

      <button className="mk-back-home" type="button" onClick={goHome}>
        <ArrowIcon direction="left" /> Back to home
      </button>
    </main>
  );
}

function BuildWorkspaceResult({ build }: { build: BuildProject }) {
  return <ProjectOverview build={build} />;
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
