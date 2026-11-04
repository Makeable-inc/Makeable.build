"use client";

import { ProjectLibrary } from "../project-library";
import { appendGalleryPage, loadGalleryPage, galleryPageUrl } from "../gallery-pages";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowIcon, BuildFailurePanel, FolderSkeleton, LockedCodePanel, WorkspaceContextBar, WorkspaceTopBar, type ProjectSurface } from "../workspace-ui";
import { buildLibrary, loadBuildLibrary } from "./build-library";
import { browserStorages, signOut } from "../sign-out";
import { forgetEndedMakeableAccount, resetMakeableAnalytics } from "../analytics";
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
  publishState?: string;
  createdAt?: string;
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
  const [publicFailed, setPublicFailed] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState("");
  const [accountBuilds, setAccountBuilds] = useState<BuildProject[]>([]);
  const [moreCursor, setMoreCursor] = useState<string | null>(null);
  const [moreBusy, setMoreBusy] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
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
    return null;
  }, [builds, publicBuilds, selectedBuildId, sharedProject, hydratedBuild]);
  const activeIdentity = activeBuild ? projectDisplayIdentity(activeBuild) : null;

  useEffect(() => {
    let cancelled = false;

    async function loadBuilds() {
      setLoading(true);
      setLoadError("");
      setAccountUnavailable(false);
      setPublicFailed(false);
      setAccountBuilds([]);
      setPublicBuilds([]);
      const { account, publicBuilds: publicLoad } = loadBuildLibrary<AuthUser, BuildProject, BuildQuota>({
        fetch: (url, init) => fetch(url, init),
        accountUrl: apiUrl("/api/account/builds"),
        publicUrl: apiUrl(galleryPageUrl("")),
      });
      // The two requests settle independently: public builds show as soon as
      // they arrive, whatever happens to the account request.
      const publicDone = publicLoad.then((result) => {
        if (cancelled) return result;
        if (result.state === "ok") { setPublicBuilds(result.builds); setMoreCursor(result.nextCursor || null); }
        setLoading(false);
        return result;
      });
      const accountDone = account.then((result) => {
        if (cancelled) return result;
        if (result.state === "signed-in") {
          setUser(result.user);
          setAccountBuilds(result.builds);
          setQuota(normalizeQuota(result.quota));
        } else if (result.state === "signed-out") {
          forgetEndedMakeableAccount();
          setUser(null);
          setAccountBuilds([]);
          setQuota(DEFAULT_BUILD_QUOTA);
        } else {
          setUser(null);
          setAccountUnavailable(true);
          setLoadError("Your projects could not be loaded. Try again to reconnect to your account.");
        }
        return result;
      });
      const [publicResult, accountResult] = await Promise.all([publicDone, accountDone]);
      if (cancelled) return;
      // A failed public list is an error to retry, never an empty gallery.
      if (publicResult.state === "failed" && accountResult.state !== "signed-in") {
        setPublicFailed(true);
        setLoadError("Makeable could not load the community builds. Try again.");
      }
    }

    void loadBuilds();
    return () => {
      cancelled = true;
    };
  }, [loadAttempt]);

  useEffect(() => {
    const restoreBuildFromUrl = () => {
      const query = new URL(window.location.href).searchParams;
      const tab = query.get("tab");
      setSurface(tab === "wiring" || tab === "code" ? tab : "overview");
      setWiringError("");
      setSelectedBuildId(query.get("build") || "");
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
    url.searchParams.delete("tab");
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
    if (activeBuild && projectWiringReady(activeBuild)) {
      setSurface("wiring");
      const url = new URL(window.location.href); url.searchParams.set("tab", "wiring");
      window.history.pushState({}, "", `${url.pathname}${url.search}${url.hash}`);
    }
  }, [activeBuild]);

  useEffect(() => {
    if (loading || !selectedBuildId || activeBuild) {setDetailLoading(false);return;}
    const controller = new AbortController();
    setDetailLoading(true);
    let current = true;
    const timer = window.setTimeout(() => controller.abort(), 10000);
    void fetch(apiUrl(`/api/builds/${encodeURIComponent(selectedBuildId)}`), {signal: controller.signal, credentials: "include"})
      .then(async r => { const data = await r.json(); if (current && !controller.signal.aborted && r.ok && data.build?.id === selectedBuildId) setHydratedBuild(data.build); })
      .catch(() => {})
      .finally(() => {window.clearTimeout(timer);if (current) setDetailLoading(false);});
    return () => {window.clearTimeout(timer);current = false;controller.abort();};
  }, [loading, selectedBuildId, activeBuild, loadAttempt]);

  async function loadMore() {
    if (!moreCursor || moreBusy) return;
    setMoreBusy(true);
    const result = await loadGalleryPage<BuildProject>(fetch, apiUrl(galleryPageUrl(moreCursor)));
    if (result.ok) {setPublicBuilds(items => appendGalleryPage(items,result.builds));setMoreCursor(result.nextCursor);setLoadError("");}
    else setLoadError("More community builds could not be loaded. Please try again.");
    setMoreBusy(false);
  }

  function selectSurface(next: ProjectSurface) {
    if (next === "wiring" && !projectWiringReady(activeBuild)) return;
    setSurface(next);
    const url = new URL(window.location.href);
    if (next === "overview") url.searchParams.delete("tab"); else url.searchParams.set("tab",next);
    window.history.pushState({}, "", `${url.pathname}${url.search}${url.hash}`);
  }

  const goHome = useCallback(() => {
    router.push("/");
  }, [router]);

  async function logOut() {
    if (signingOut) return;
    setSigningOut(true);
    setSignOutError("");
    const ok = await signOut({
      fetch,
      url: apiUrl("/api/auth/session"),
      storages: browserStorages(),
    });
    if (ok) {
      resetMakeableAnalytics();
      window.location.assign("/app/");
      return;
    }
    setSigningOut(false);
    setSignOutError("Makeable could not log you out. You are still signed in, so try again.");
  }

  const openProjects = useCallback(() => {
    setSurface("overview");
    setWiringError("");
    setSelectedBuildId("");
    const url = new URL(window.location.href);
    url.searchParams.delete("build");
    url.searchParams.delete("tab");
    window.history.pushState({}, "", `${url.pathname}${url.search}${url.hash}`);
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
        onSelectSurface={selectSurface}
        projects={builds.map((build) => ({ id: build.id, title: projectDisplayIdentity(build).title }))}
        selectedProjectId={activeBuild?.id}
        projectsLabel={user ? "All projects" : "Community projects"}
        onSelectProject={(id) => {
          const selected = builds.find((build) => build.id === id);
          if (selected) selectBuild(selected);
        }}
        onSignOut={() => void logOut()}
        signingOut={signingOut}
        signOutError={signOutError}
      />

      <WorkspaceContextBar
        title={activeIdentity?.title || (loading ? "Opening your project" : user ? "My builds" : "Community builds")}
        idea={activeBuild?.idea || activeBuild?.summary}
        label={loading ? "Opening" : activeBuild ? "Project" : "Library"}
        onHome={goHome}
      />

      <section className="mk-workspace-main" aria-labelledby="workspace-title">
        {selectedBuildId && <div className="project-return"><button type="button" onClick={openProjects} className="library-nav">← {user ? "My builds" : "Community builds"}</button></div>}
        {loading || detailLoading ? (
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
        ) : !selectedBuildId && !publicFailed && (!accountUnavailable || publicBuilds.length > 0) ? (
          <ProjectLibrary builds={builds} signedIn={Boolean(user)} onOpen={build => selectBuild(build as BuildProject)} moreAvailable={!user && Boolean(moreCursor)} loadingMore={moreBusy} onMore={loadMore} />
        ) : activeBuild ? (
          surface === "code"
            ? <LockedCodePanel onBack={() => selectSurface("overview")} />
            : surface === "wiring" && projectWiringReady(activeBuild)
              ? <ProjectWiringGuide key={activeBuild.id} build={activeBuild} />
              : <ProjectOverview key={activeBuild.id} build={activeBuild} onOpenWiring={() => void openWiring()} wiringLoading={wiringLoading} />
        ) : (
          <div className="mk-empty-library">
            <h1 id="workspace-title">{accountUnavailable ? "Your projects are temporarily unavailable" : user ? "My builds" : "Community builds"}</h1>
            <p>{loadError || "No build was found for this link yet. Sign in from the homepage to save new builds here."}</p>
            {(accountUnavailable || publicFailed) && <button className="mk-button mk-button-dark" type="button" onClick={() => setLoadAttempt((attempt) => attempt + 1)}>Try again</button>}
            <button className="mk-button mk-button-dark" type="button" onClick={goHome}>Back to main page</button>
          </div>
        )}

        {loadError && !publicFailed && (!accountUnavailable || publicBuilds.length > 0) && <p role="alert">{loadError}</p>}
        {wiringError && <p className="mk-wiring-load-error" role="alert">{wiringError}</p>}
      </section>

    </main>
  );
}

function BuildWorkspaceResult({ build }: { build: BuildProject }) {
  return <ProjectOverview build={build} />;
}
