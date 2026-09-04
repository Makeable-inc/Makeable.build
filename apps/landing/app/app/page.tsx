"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowIcon, BuildFailurePanel, FolderSkeleton, LockedCodePanel, WorkspaceContextBar, WorkspaceTopBar, type ProjectSurface } from "../workspace-ui";
import { buildLibrary } from "./build-library";
import { ProjectOverview } from "../project-overview";
import { projectDisplayIdentity } from "../project-identity.mjs";
import { ProjectWiringGuide } from "../project-wiring-guide";
import { projectWiringDeclaredReady, projectWiringReady } from "../project-wiring-data.mjs";

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
  idea?: string;
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
  const [accountUnavailable, setAccountUnavailable] = useState(false);
  const [accountBuilds, setAccountBuilds] = useState<BuildProject[]>([]);
  const [publicBuilds, setPublicBuilds] = useState<BuildProject[]>([]);
  const [sharedProject, setSharedProject] = useState<BuildProject | null>(null);
  const [selectedBuildId, setSelectedBuildId] = useState("");
  const [quota, setQuota] = useState<BuildQuota>(DEFAULT_BUILD_QUOTA);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [surface, setSurface] = useState<ProjectSurface>("overview");
  const [wiringLoading, setWiringLoading] = useState(false);
  const [wiringError, setWiringError] = useState("");
  const [hydratedBuild, setHydratedBuild] = useState<BuildProject | null>(null);
  const freeBuildLimit = quota.limit;
  const buildsRemaining = quota.remaining;

  const builds = buildLibrary(accountBuilds, publicBuilds, Boolean(user));

  const activeBuild = useMemo(() => {
    if (hydratedBuild && hydratedBuild.id === selectedBuildId) return hydratedBuild;
    if (selectedBuildId) return builds.find((build) => build.id === selectedBuildId)
      || publicBuilds.find((build) => build.id === selectedBuildId)
      || (sharedProject?.id === selectedBuildId ? sharedProject : null)
      || null;
    return builds[0] || publicBuilds[0] || null;
  }, [builds, publicBuilds, selectedBuildId, sharedProject, hydratedBuild]);
  const activeIdentity = activeBuild ? projectDisplayIdentity(activeBuild) : null;

  useEffect(() => {
    let cancelled = false;

    async function loadBuilds() {
      setLoading(true);
      setLoadError("");
      setAccountUnavailable(false);
      setAccountBuilds([]);
      setPublicBuilds([]);
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
            setAccountUnavailable(false);
            loadedAnyBuilds = Array.isArray(account.builds) && account.builds.length > 0;
          }
        } else if (accountResult.status === "fulfilled" && accountResult.value.status === 401) {
          setUser(null);
          setAccountBuilds([]);
          setQuota(DEFAULT_BUILD_QUOTA);
          setAccountUnavailable(false);
        } else {
          setAccountUnavailable(true);
          setLoadError("Your projects could not be loaded. Try again to reconnect to your account.");
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
          setAccountUnavailable(true);
          setLoadError("Makeable could not load this project folder.");
        }
      } catch {
        if (!cancelled) {
          setAccountUnavailable(true);
          setLoadError("Makeable could not load this project folder.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadBuilds();
    return () => {
      cancelled = true;
    };
  }, [loadAttempt]);

  useEffect(() => {
    const restoreBuildFromUrl = () => {
      setSurface("overview");
      setWiringError("");
      setSelectedBuildId(new URL(window.location.href).searchParams.get("build") || "");
    };
    setSharedProject(sharedProjectFromSession());
    restoreBuildFromUrl();
    window.addEventListener("popstate", restoreBuildFromUrl);
    return () => window.removeEventListener("popstate", restoreBuildFromUrl);
  }, []);

  const selectBuild = useCallback((build: BuildProject) => {
    if (build.id === selectedBuildId) return;
    setSurface("overview");
    setWiringError("");
    setSelectedBuildId(build.id);
    const url = new URL(window.location.href);
    url.searchParams.set("build", build.id);
    window.history.pushState({ makeableBuild: build.id }, "", `${url.pathname}${url.search}${url.hash}`);
  }, [selectedBuildId]);

  useEffect(() => {
    if (!activeBuild || !projectWiringDeclaredReady(activeBuild) || projectWiringReady(activeBuild)) return;
    const requestedId = activeBuild.id;
    const controller = new AbortController();
    setWiringLoading(true);
    setWiringError("");
    void (async () => { try {
      const response = await fetch(apiUrl(`/api/builds/${encodeURIComponent(requestedId)}`), {
        cache: "no-store",
        headers: { Accept: "application/json" },
        credentials: "include",
        signal: controller.signal,
      });
      const payload = await response.json() as { build?: BuildProject; error?: string };
      if (!response.ok || !payload.build || payload.build.id !== requestedId || !projectWiringReady(payload.build)) {
        throw new Error(payload.error || "The exact saved wiring guide is not available.");
      }
      if (!controller.signal.aborted) setHydratedBuild(payload.build);
    } catch {
      if (!controller.signal.aborted) setWiringError("The saved wiring guide is unavailable. Your project is unchanged. Refresh to try again.");
    } finally {
      if (!controller.signal.aborted) setWiringLoading(false);
    } })();
    return () => { controller.abort(); setWiringLoading(false); };
  }, [activeBuild]);

  const openWiring = useCallback(() => {
    if (activeBuild && projectWiringReady(activeBuild)) setSurface("wiring");
  }, [activeBuild]);

  const goHome = useCallback(() => {
    router.push("/");
  }, [router]);

  const openProjects = useCallback(() => {
    setSurface("overview");
    setWiringError("");
    setSelectedBuildId("");
    const url = new URL(window.location.href);
    url.searchParams.delete("build");
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  }, []);

  return (
    <main className="mk-app-shell">
      <WorkspaceTopBar
        user={user}
        remaining={buildsRemaining}
        limit={freeBuildLimit}
        accountLoading={loading}
        accountUnavailable={accountUnavailable}
        onHome={goHome}
        surface={surface}
        wiringAvailable={Boolean(activeBuild && projectWiringReady(activeBuild))}
        wiringLoading={wiringLoading}
        onSelectSurface={(nextSurface) => nextSurface === "wiring" ? void openWiring() : setSurface(nextSurface)}
        projects={builds.map((build) => ({ id: build.id, title: projectDisplayIdentity(build).title }))}
        selectedProjectId={activeBuild?.id}
        projectsLabel={user ? "All projects" : "Community projects"}
        onSelectProject={(id) => {
          const selected = builds.find((build) => build.id === id);
          if (selected) selectBuild(selected);
        }}
      />

      <WorkspaceContextBar
        title={activeIdentity?.title || (loading ? "Opening your project" : "My builds")}
        idea={activeBuild?.idea || activeBuild?.summary}
        label={loading ? "Opening" : activeBuild ? "Project" : "Library"}
        onHome={goHome}
        action={activeBuild && surface === "overview" && projectWiringReady(activeBuild) ? (
          <button className="mk-context-primary" type="button" onClick={() => void openWiring()} disabled={wiringLoading}>
            {wiringLoading ? "Opening guide…" : <>Open wiring <ArrowIcon /></>}
          </button>
        ) : undefined}
      />

      <section className="mk-workspace-main" aria-labelledby="workspace-title">
        {loading ? (
          <FolderSkeleton />
        ) : selectedBuildId && !activeBuild ? (
          <BuildFailurePanel
            title="We could not safely open this project"
            technicalMessage="The exact project was not found. Makeable did not substitute a different build."
            buildId={selectedBuildId}
            retryLabel="Try again"
            onRetry={() => setLoadAttempt((attempt) => attempt + 1)}
            onEdit={() => router.push("/#make")}
            onBack={openProjects}
          />
        ) : activeBuild ? (
          surface === "code"
            ? <LockedCodePanel onBack={() => setSurface("overview")} />
            : surface === "wiring" && projectWiringReady(activeBuild)
              ? <ProjectWiringGuide key={activeBuild.id} build={activeBuild} />
              : <BuildWorkspaceResult build={activeBuild} />
        ) : (
          <div className="mk-empty-library">
            <h1 id="workspace-title">{accountUnavailable ? "Your projects are temporarily unavailable" : "My builds"}</h1>
            <p>{loadError || "No build was found for this link yet. Sign in from the homepage to save new builds here."}</p>
            {accountUnavailable && <button className="mk-button mk-button-dark" type="button" onClick={() => setLoadAttempt((attempt) => attempt + 1)}>Try again</button>}
            <button className="mk-button mk-button-dark" type="button" onClick={goHome}>Back to main page</button>
          </div>
        )}

        {wiringError && <p className="mk-wiring-load-error" role="alert">{wiringError}</p>}
      </section>

    </main>
  );
}

function BuildWorkspaceResult({ build }: { build: BuildProject }) {
  return <ProjectOverview build={build} />;
}
