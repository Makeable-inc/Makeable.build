"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

type SafeUser = {
  email: string;
  name?: string;
  picture?: string;
};

type Stage = {
  label: string;
  detail: string;
};

export type ProjectSurface = "overview" | "wiring" | "code";

const checkpointLabels = [
  "Brief",
  "Parts",
  "Assembly",
  "Package",
];

export function ArrowIcon({ direction = "right" }: { direction?: "left" | "right" }) {
  return (
    <svg
      className="mk-arrow-icon"
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      style={direction === "left" ? { transform: "rotate(180deg)" } : undefined}
    >
      <path d="M5 12h13M13 6l6 6-6 6" />
    </svg>
  );
}

export function WorkspaceIcon({ kind }: { kind: "overview" | "parts" | "enclosure" | "wiring" | "code" | "info" }) {
  const paths = {
    overview: <><rect x="4" y="4" width="16" height="16" rx="5" /><path d="M8 12h8M12 8v8" /></>,
    parts: <><rect x="4" y="4" width="6" height="6" rx="1.5" /><rect x="14" y="4" width="6" height="6" rx="1.5" /><rect x="4" y="14" width="6" height="6" rx="1.5" /><rect x="14" y="14" width="6" height="6" rx="1.5" /></>,
    enclosure: <><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z" /><path d="m4.5 7.7 7.5 4.2 7.5-4.2M12 12v8.5" /></>,
    wiring: <><path d="M5 7h5a2 2 0 0 1 2 2v6a2 2 0 0 0 2 2h5" /><circle cx="5" cy="7" r="2" /><circle cx="19" cy="17" r="2" /></>,
    code: <><rect x="5" y="10" width="14" height="10" rx="2" /><path d="M8.5 10V7.5a3.5 3.5 0 0 1 7 0V10M12 14v2" /></>,
    info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></>,
  };
  return (
    <svg className="mk-workspace-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {paths[kind]}
    </svg>
  );
}

export function ProjectNavigation({
  surface,
  wiringAvailable,
  wiringLoading = false,
  onSelect,
}: {
  surface: ProjectSurface;
  wiringAvailable: boolean;
  wiringLoading?: boolean;
  onSelect: (surface: ProjectSurface) => void;
}) {
  return (
    <nav className="mk-project-nav" aria-label="Project areas">
      <button type="button" aria-current={surface === "overview" ? "true" : undefined} onClick={() => onSelect("overview")}>
        <WorkspaceIcon kind="overview" /> Overview
      </button>
      <button type="button" disabled={!wiringAvailable || wiringLoading} aria-current={surface === "wiring" ? "true" : undefined} onClick={() => onSelect("wiring")}>
        <WorkspaceIcon kind="wiring" /> {wiringLoading ? "Loading wiring" : "Wiring"}
      </button>
      <button type="button" aria-current={surface === "code" ? "true" : undefined} onClick={() => onSelect("code")}>
        <WorkspaceIcon kind="code" /> Code <span className="mk-nav-lock">Locked</span>
      </button>
    </nav>
  );
}

type WorkspaceProjectItem = {
  id: string;
  title: string;
};

export function WorkspaceTopBar({
  user,
  remaining,
  limit,
  accountLoading = false,
  accountUnavailable = false,
  showBalance = true,
  onHome,
  surface = "overview",
  wiringAvailable = false,
  wiringLoading = false,
  onSelectSurface,
  building = false,
  progress = 0,
  projects = [],
  selectedProjectId,
  projectsLabel = "All projects",
  onSelectProject,
}: {
  user: SafeUser | null;
  remaining: number;
  limit: number;
  accountLoading?: boolean;
  accountUnavailable?: boolean;
  showBalance?: boolean;
  onHome: () => void;
  surface?: ProjectSurface;
  wiringAvailable?: boolean;
  wiringLoading?: boolean;
  onSelectSurface?: (surface: ProjectSurface) => void;
  building?: boolean;
  progress?: number;
  projects?: WorkspaceProjectItem[];
  selectedProjectId?: string;
  projectsLabel?: string;
  onSelectProject?: (id: string) => void;
}) {
  const switcherRef = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (switcherRef.current && !switcherRef.current.contains(event.target as Node)) switcherRef.current.open = false;
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && switcherRef.current?.open) {
        switcherRef.current.open = false;
        switcherRef.current.querySelector("summary")?.focus();
      }
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", escape); };
  }, []);
  return (
    <header className="mk-workspace-topbar">
      <button className="mk-logo-link mk-topbar-logo" type="button" onClick={onHome} aria-label="Makeable home">
        <img src="/makeable-logo-tight.webp" alt="Makeable" />
      </button>

      <div className="mk-topbar-navigation">
        {building ? (
          <ol className="mk-build-stage-list" aria-label="Build stages">
            <li data-state={progress >= 24 ? "done" : "current"}><span>{progress >= 24 ? "✓" : "1"}</span><strong>Brief</strong></li>
            <li data-state={progress >= 48 ? "done" : progress >= 24 ? "current" : "upcoming"}><span>{progress >= 48 ? "✓" : "2"}</span><strong>Parts</strong></li>
            <li data-state={progress >= 74 ? "done" : progress >= 48 ? "current" : "upcoming"}><span>{progress >= 74 ? "✓" : "3"}</span><strong>Assembly</strong></li>
            <li data-state={progress >= 96 ? "done" : progress >= 74 ? "current" : "upcoming"}><span>{progress >= 96 ? "✓" : "4"}</span><strong>Package</strong></li>
          </ol>
        ) : (
          <ProjectNavigation
            surface={surface}
            wiringAvailable={wiringAvailable}
            wiringLoading={wiringLoading}
            onSelect={onSelectSurface || (() => {})}
          />
        )}
      </div>

      <div className="mk-topbar-utilities">
        {!building && (
          <details className="mk-build-switcher" ref={switcherRef}>
            <summary>{projectsLabel} <span>{projects.length}</span></summary>
            <div>
              {projects.length ? projects.map((project) => (
                <button
                  type="button"
                  key={project.id}
                  onClick={() => {
                    if (switcherRef.current) switcherRef.current.open = false;
                    onSelectProject?.(project.id);
                  }}
                  aria-current={selectedProjectId === project.id ? "true" : undefined}
                >
                  {project.title}
                </button>
              )) : <small>No saved builds yet.</small>}
            </div>
          </details>
        )}
        <ProfileChip
          user={user}
          remaining={remaining}
          limit={limit}
          loading={accountLoading}
          unavailable={accountUnavailable}
          showBalance={showBalance}
        />
      </div>
    </header>
  );
}

export function WorkspaceContextBar({
  title,
  idea,
  label = "Project",
  onHome,
  action,
}: {
  title: string;
  idea?: string;
  label?: string;
  onHome: () => void;
  action?: ReactNode;
}) {
  return (
    <section className="mk-workspace-context" aria-label="Current project">
      <button className="mk-context-back" type="button" onClick={onHome} aria-label="Back to Makeable home">
        <ArrowIcon direction="left" /> <span>Home</span>
      </button>
      <div className="mk-context-title">
        <small>{label}</small>
        <strong title={title}>{title}</strong>
      </div>
      {idea && <div className="mk-context-idea"><small>Original idea</small><p>{idea}</p></div>}
      {action && <div className="mk-context-action">{action}</div>}
    </section>
  );
}

export function ProfileChip({
  user,
  remaining,
  limit,
  loading = false,
  unavailable = false,
  showBalance = true,
}: {
  user: SafeUser | null;
  remaining: number;
  limit: number;
  loading?: boolean;
  unavailable?: boolean;
  showBalance?: boolean;
}) {
  const label = user?.name || user?.email || (unavailable ? "Account unavailable" : loading ? "Checking account" : "Google sign-in");
  const quotaLabel = unavailable
    ? "Build balance unavailable"
    : loading
      ? user ? "Refreshing build access" : "Build access loading"
      : remaining === 1 ? "1 free build remaining" : `${Math.max(0, remaining)} free builds remaining`;

  return (
    <div className="mk-app-user">
      <div className="mk-app-user-copy">
        <span>{label}</span>
        {showBalance && <small>{quotaLabel}{!loading && !unavailable && <> <span aria-hidden="true">·</span> {limit} total</>}</small>}
      </div>
      <ProfileAvatar user={user} />
    </div>
  );
}

export function BuildFailurePanel({
  title = "This build did not finish",
  technicalMessage,
  buildId,
  prompt,
  retryLabel = "Try this build again",
  backLabel = "Return to projects",
  onRetry,
  onEdit,
  onBack,
}: {
  title?: string;
  technicalMessage: string;
  buildId?: string;
  prompt?: string;
  retryLabel?: string;
  backLabel?: string;
  onRetry: () => void;
  onEdit?: () => void;
  onBack: () => void;
}) {
  const friendlyMessage = /not found|exact project/i.test(technicalMessage)
    ? "We could not safely open this project, so we left the rest of your projects untouched."
    : "Something interrupted this build before it finished. Your idea is safe, and you can try it again without starting over.";
  return (
    <section className="mk-build-failure" aria-labelledby="workspace-title" role="alert">
      <div className="mk-build-failure-body">
      <small>Build safely stopped</small>
      <h1 id="workspace-title">{title}</h1>
      <p>{friendlyMessage}</p>
      {(buildId || prompt) && <dl>
        {buildId && <div><dt>Build ID</dt><dd>{buildId}</dd></div>}
        {prompt && <div><dt>Your idea</dt><dd>{prompt}</dd></div>}
      </dl>}
      <details className="mk-failure-details">
        <summary>View failure details</summary>
        <p>{technicalMessage}</p>
      </details>
      </div>
      <footer className="mk-build-failure-footer">
      <div className="mk-progress-actions mk-failure-actions">
        <button className="mk-button mk-button-dark" type="button" onClick={onRetry}>{retryLabel}</button>
        {onEdit && <button className="mk-button" type="button" onClick={onEdit}>Edit my idea</button>}
        <button className="mk-button mk-button-quiet" type="button" onClick={onBack}>{backLabel}</button>
      </div>
      <p className="mk-failure-credit">No completed replacement was saved.</p>
      </footer>
    </section>
  );
}

type BuildClarification = {
  reason: string;
  question: string;
  options: Array<{
    id: string;
    label: string;
    description: string;
    refinedIdea: string;
  }>;
};

export function BuildClarificationPanel({
  clarification,
  prompt,
  onChoose,
  onEdit,
}: {
  clarification: BuildClarification;
  prompt: string;
  onChoose: (refinedIdea: string) => void;
  onEdit: () => void;
}) {
  const [selectedId, setSelectedId] = useState("");
  const [customIdea, setCustomIdea] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const selected = clarification.options.find((option) => option.id === selectedId);
  const nextIdea = customIdea.trim() || selected?.refinedIdea || "";
  const customIdeaPlaceholder = /\b(?:phone|mobile|message|notify|notification|alert)\b/i.test(prompt)
    ? "For example: send a push notification when the desk button is touched"
    : "For example: a pumpkin light that glows when someone walks past";

  return (
    <section className="mk-build-clarification" aria-labelledby="workspace-title">
      <div className="mk-clarification-heading">
        <small>One quick choice</small>
        <h1 id="workspace-title">One detail before we build</h1>
        <p>{clarification.question}</p>
      </div>
      <p className="mk-clarification-original"><span>Your idea</span>{prompt}</p>
      <div className="mk-clarification-options" role="radiogroup" aria-label="Build directions">
        {clarification.options.map((option, index) => (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={selectedId === option.id}
            tabIndex={selectedId ? selectedId === option.id ? 0 : -1 : index === 0 ? 0 : -1}
            className="mk-clarification-option"
            disabled={submitting}
            onClick={() => { setSelectedId(option.id); setCustomIdea(""); }}
            onKeyDown={(event) => {
              if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
              event.preventDefault();
              const offset = event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1;
              const next = (index + offset + clarification.options.length) % clarification.options.length;
              setSelectedId(clarification.options[next].id);
              setCustomIdea("");
              (event.currentTarget.parentElement?.children[next] as HTMLElement)?.focus();
            }}
          >
            <span aria-hidden="true" />
            <strong>{option.label}</strong>
            <small>{option.description}</small>
          </button>
        ))}
      </div>
      <label className="mk-clarification-custom">
        <span>Or describe what you have in mind</span>
        <textarea
          value={customIdea}
          disabled={submitting}
          onChange={(event) => { setCustomIdea(event.target.value); setSelectedId(""); }}
          placeholder={customIdeaPlaceholder}
          rows={3}
        />
      </label>
      <div className="mk-clarification-actions">
        <button className="mk-button mk-button-dark" type="button" disabled={!nextIdea || submitting} onClick={() => { setSubmitting(true); onChoose(nextIdea); }}>
          {submitting ? "Starting your build…" : <>Build this idea <ArrowIcon /></>}
        </button>
        <button className="mk-button mk-button-quiet" type="button" disabled={submitting} onClick={onEdit}>Edit original idea</button>
      </div>
      <p className="mk-clarification-credit" role="status" aria-live="polite">
        {submitting ? "Your choice is saved. Opening the live build progress now…" : "No build has started, and this question does not use a build credit."}
      </p>
    </section>
  );
}

export function ProfileAvatar({ user }: { user: SafeUser | null }) {
  const label = user?.name || user?.email || "Maker";
  const initial = label.trim().charAt(0).toUpperCase() || "M";
  return (
    <span className="mk-app-avatar-frame" aria-hidden="true">
      <span className="mk-app-avatar mk-app-avatar-fallback">{initial}</span>
      {user?.picture && (
        <img
          className="mk-app-avatar mk-app-avatar-image"
          src={user.picture}
          alt=""
          referrerPolicy="no-referrer"
          onError={(event) => { event.currentTarget.style.display = "none"; }}
        />
      )}
    </span>
  );
}

function SkeletonPartRows() {
  return (
    <div className="mk-skeleton-parts" aria-hidden="true">
      {[0, 1, 2].map((row) => (
        <div className="mk-skeleton-part" key={row}>
          <span className="mk-skeleton-part-thumb" />
          <span className="mk-skeleton-part-copy">
            <i />
            <i />
          </span>
          <span className="mk-skeleton-part-action" />
        </div>
      ))}
    </div>
  );
}

export function FolderSkeleton() {
  return (
    <div className="mk-workspace-grid mk-loading-layout" aria-busy="true" aria-label="Loading build folder">
      <div className="mk-skeleton-render" aria-hidden="true">
        <span className="mk-skeleton-product" />
      </div>
      <section className="mk-skeleton-brief">
        <div className="mk-loader-copy" role="status" aria-live="polite">
          <span>Opening project</span>
          <strong id="workspace-title">Loading your build</strong>
          <p>Bringing in the preview and matched parts.</p>
        </div>
        <div className="mk-skeleton-lines" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <SkeletonPartRows />
      </section>
    </div>
  );
}

export function GenerationWorkspace({
  stage,
  progress,
  error,
  busy,
  buildId,
  prompt,
  startedAt,
  onDismiss,
  onCancel,
  onRetry,
  onEdit,
}: {
  stage: Stage;
  progress: number;
  error: string;
  busy: boolean;
  buildId?: string;
  prompt?: string;
  startedAt?: string;
  onDismiss: () => void;
  onCancel: () => void;
  onRetry: () => void;
  onEdit: () => void;
}) {
  const safeProgress = Math.max(0, Math.min(100, Math.round(progress)));
  const checkpointIndex = safeProgress >= 92 ? 3 : safeProgress >= 48 ? 2 : safeProgress >= 24 ? 1 : 0;
  const waitingForSignIn = /sign in with google/i.test(error);
  const terminalFailure = Boolean(error && !busy && !waitingForSignIn);
  const localStart = useRef(Date.now());
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
    if (!busy) return undefined;
    const timestamp = Date.parse(startedAt || "");
    const start = Number.isFinite(timestamp) ? timestamp : localStart.current;
    const tick = () => setElapsedSeconds(Math.max(0, Math.floor((Date.now() - start) / 1000)));
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [busy, startedAt]);

  const elapsedLabel = `${Math.floor(elapsedSeconds / 60)}:${String(elapsedSeconds % 60).padStart(2, "0")}`;

  if (terminalFailure) return (
    <div className="mk-workspace-grid mk-terminal-failure-layout" aria-busy="false">
      <div className="mk-terminal-failure-visual" aria-hidden="true"><span>!</span><small>Build paused safely</small></div>
      <BuildFailurePanel technicalMessage={error} buildId={buildId} prompt={prompt} onRetry={onRetry} onEdit={onEdit} onBack={onDismiss} />
    </div>
  );

  return (
    <div className="mk-generation-workshop" aria-busy={busy}>
      <header className="mk-generation-workshop-header">
        <div>
          <span>Makeable workshop</span>
          <h1 id="workspace-title">Building your project</h1>
        </div>
        <p><span aria-hidden="true">{buildId ? "✓" : "…"}</span> {buildId ? "Saved — safe to close this tab" : "Saving your request"}</p>
      </header>

      <div className="mk-generation-workshop-body">
        <div className="mk-generation-drawing" aria-hidden="true">
          <div className="mk-product-blueprint">
            <span className="mk-blueprint-shell" />
            <span className="mk-blueprint-screen" />
            <span className="mk-blueprint-port" />
            <span className="mk-blueprint-scan" />
          </div>
          <span className="mk-drawing-callout mk-drawing-callout-one">Build layout</span>
          <span className="mk-drawing-callout mk-drawing-callout-two">Part compatibility</span>
          <small>Technical preview develops as the build progresses</small>
        </div>

        <section className="mk-generation-workshop-status">
          <div className="mk-loader-copy" role="status" aria-live="polite" aria-atomic="true">
            <span>In progress</span>
            <strong>{stage.label}</strong>
            <p>{stage.detail}</p>
          </div>

          <div className="mk-generation-time">
            <p><strong>{elapsedLabel}</strong><span>elapsed</span></p>
            <small>Most projects take 3–6 minutes</small>
          </div>

          <div
            className="mk-generation-segments"
            role="progressbar"
            aria-label="Build generation progress"
            aria-valuemin={0}
            aria-valuemax={4}
            aria-valuenow={checkpointIndex + 1}
            aria-valuetext={`${stage.label}. Stage ${checkpointIndex + 1} of ${checkpointLabels.length}.`}
          >
            {checkpointLabels.map((label, index) => (
              <span key={label} data-state={index < checkpointIndex ? "done" : index === checkpointIndex ? "current" : "upcoming"} />
            ))}
          </div>

          <ol className="mk-generation-checkpoints" aria-label="Generation steps">
            {checkpointLabels.map((label, index) => (
              <li
                key={label}
                data-state={index < checkpointIndex ? "done" : index === checkpointIndex ? "current" : "upcoming"}
              >
                <span aria-hidden="true">{index < checkpointIndex ? "✓" : index === checkpointIndex ? "•" : ""}</span>
                <div><strong>{label}</strong><small>{index === checkpointIndex ? stage.detail : index < checkpointIndex ? "Complete" : "Waiting"}</small></div>
              </li>
            ))}
          </ol>

          {prompt && <div className="mk-generation-brief">
            <span>Your brief</span>
            <p>“{prompt}”</p>
          </div>}

          <div className="mk-progress-actions">
            <button className="mk-progress-dismiss" type="button" onClick={onDismiss}>View my projects</button>
            <button className="mk-progress-cancel" type="button" onClick={onCancel}>Cancel build</button>
          </div>
          <p className="mk-generation-leave-note">{buildId ? "We’ll keep working if you leave." : "Keep this tab open while we save your request."}</p>
          {waitingForSignIn && <p className="mk-form-notice" role="status">{error}</p>}
        </section>
      </div>
    </div>
  );
}

export function LockedCodePanel({ onBack }: { onBack: () => void }) {
  return (
    <section className="mk-code-locked" aria-labelledby="workspace-title">
      <div className="mk-code-editor-ghost" aria-hidden="true">
        <span /><span /><span /><span /><span /><span />
      </div>
      <div className="mk-code-locked-copy">
        <span className="mk-code-lock-mark" aria-hidden="true"><WorkspaceIcon kind="code" /></span>
        <small>Coming soon</small>
        <h1 id="workspace-title">Firmware is the next part of your project</h1>
        <p>Your saved project will stay ready while we finish guided code generation.</p>
        <button type="button" onClick={onBack}><ArrowIcon direction="left" /> Back to overview</button>
        <span>Code generation won’t use another credit until it is available.</span>
      </div>
    </section>
  );
}
