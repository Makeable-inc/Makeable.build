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
  checkpoint?: number;
};

export type ProjectSurface = "overview" | "wiring" | "code";

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
        Overview
      </button>
      <button type="button" disabled={!wiringAvailable || wiringLoading} aria-current={surface === "wiring" ? "true" : undefined} onClick={() => onSelect("wiring")}>
        {wiringLoading ? "Loading wiring" : "Wiring"}
      </button>
      <button type="button" aria-current={surface === "code" ? "true" : undefined} onClick={() => onSelect("code")}>
        <WorkspaceIcon kind="code" /> Code
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
  projects = [],
  selectedProjectId,
  projectsLabel = "My projects",
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
        {building ? null : (
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
            <summary>{projectsLabel === "All projects" ? "My projects" : projectsLabel}</summary>
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
      <div className="mk-context-title">
        <strong title={title}>{title}</strong>
      </div>
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
  retryLabel = "Try again",
  backLabel = "My projects",
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
  const planMismatch = /unrequested capabilities|unrelated functional parts|missing requested capabilities/i.test(technicalMessage);
  const plannerBlocked = /planner_output_blocked|planner_(?:warning|title|state)_blocked/i.test(technicalMessage);
  const interruptedConnection = /Connection interrupted while checking/i.test(technicalMessage);
  const friendlyMessage = interruptedConnection
    ? "Your build may still be running. Reconnect to check it without starting again."
    : plannerBlocked
    ? "Makeable couldn’t find a verified hardware plan for this idea. Your idea is saved."
    : planMismatch
    ? "The selected parts didn’t match your idea. Your idea is saved for another try."
    : /not found|exact project/i.test(technicalMessage)
    ? "We couldn’t open this project. Your other projects are unchanged."
    : "The build stopped, but your idea is saved. You can try again or make a change.";
  return (
    <section className="mk-build-failure" aria-labelledby="workspace-title" role="alert">
      <div className="mk-build-failure-body">
      <h1 id="workspace-title">{interruptedConnection ? "Let’s reconnect." : plannerBlocked || planMismatch ? "This build didn’t finish." : title}</h1>
      <p>{friendlyMessage}</p>
      {prompt && <div className="mk-generation-original"><span>Your idea</span><p>{prompt}</p></div>}
      </div>
      <footer className="mk-build-failure-footer">
      <div className="mk-progress-actions mk-failure-actions">
        <button className="mk-button mk-button-dark" type="button" onClick={onRetry}>{interruptedConnection ? "Reconnect" : retryLabel}</button>
        {onEdit && <button className="mk-button" type="button" onClick={onEdit}>Edit my idea</button>}
        <button className="mk-button mk-button-quiet" type="button" onClick={onBack}>{backLabel}</button>
      </div>
      <p className="mk-failure-credit">{interruptedConnection ? "The final status is not confirmed yet. Your other projects are unchanged." : "No completed replacement was saved."}</p>
      <details className="mk-failure-details">
        <summary>Build details</summary>
        {buildId && <dl><div><dt>Build ID</dt><dd>{buildId}</dd></div></dl>}
        <p>{technicalMessage}</p>
      </details>
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
          <strong id="workspace-title">Opening your project…</strong>
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
  const checkpointIndex = stage.checkpoint ?? 0;
  const waitingForSignIn = /sign in with google/i.test(error);
  const terminalFailure = Boolean(error && !busy && !waitingForSignIn);
  const localStart = useRef(0);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
    if (!busy) return undefined;
    if (!localStart.current) localStart.current = Date.now();
    const timestamp = Date.parse(startedAt || "");
    const start = Number.isFinite(timestamp) ? timestamp : localStart.current;
    const tick = () => setElapsedSeconds(Math.max(0, Math.floor((Date.now() - start) / 1000)));
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [busy, startedAt]);

  const elapsedLabel = `${Math.floor(elapsedSeconds / 60)}:${String(elapsedSeconds % 60).padStart(2, "0")}`;

  if (terminalFailure) return (
    <div className="mk-recovery-layout" aria-busy="false">
      <BuildFailurePanel technicalMessage={error} buildId={buildId} prompt={prompt} onRetry={onRetry} onEdit={onEdit} onBack={onDismiss} />
    </div>
  );

  return (
    <div className="mk-generation-workshop mk-generation-editorial" aria-busy={busy}>
      <section className="mk-generation-story">
        <div role="status" aria-live="polite" aria-atomic="true">
          <h1 id="workspace-title">{stage.label}</h1>
        </div>
        {prompt && <div className="mk-generation-original"><p>{prompt}</p></div>}
      </section>
      <section className="mk-generation-activity" aria-label="Build generation progress">
        <ol className="mk-generation-stage-rows" aria-label="Generation steps">
          {["Plan your build", "Choose parts", "Prepare assembly", "Finish up"].map((label, index) => (
            <li key={label} aria-current={index === checkpointIndex ? "step" : undefined} data-state={index < checkpointIndex ? "done" : index === checkpointIndex ? "current" : "upcoming"}>
              <span aria-hidden="true">{index < checkpointIndex ? "✓" : index + 1}</span><strong>{label}</strong>
            </li>
          ))}
        </ol>
        <div className="mk-generation-clock"><strong>{elapsedLabel} elapsed</strong>{elapsedSeconds >= 90 && <p>Still working on it.</p>}</div>
        <div className="mk-progress-actions">
          <button className="mk-progress-dismiss" type="button" onClick={onDismiss}>My projects</button>
          <button className="mk-progress-cancel" type="button" onClick={onCancel}>Cancel build</button>
        </div>
        <p className="mk-generation-leave-note">{buildId ? "You can leave this tab. We’ll keep working." : "Stay here while we save your idea."}</p>
        {buildId && <details className="mk-generation-job-details"><summary>Build details</summary><small className="mk-generation-job-id">Build ID · {buildId}</small></details>}
        {waitingForSignIn && <p className="mk-form-notice" role="status">{error}</p>}
      </section>
    </div>
  );
}

export function LockedCodePanel({ onBack }: { onBack: () => void }) {
  return (
    <section className="mk-code-locked" aria-labelledby="workspace-title">
      <div className="mk-code-locked-copy">
        <span className="mk-code-lock-mark" aria-hidden="true"><WorkspaceIcon kind="code" /></span>
        <h1 id="workspace-title">Coming soon</h1>
        <p>Firmware generation is next.</p>
        <p>Your project is saved. No credit is used here.</p>
        <button type="button" onClick={onBack}><ArrowIcon direction="left" /> Back to overview</button>
      </div>
    </section>
  );
}
