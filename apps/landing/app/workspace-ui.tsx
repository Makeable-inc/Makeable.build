"use client";

type SafeUser = {
  email: string;
  name?: string;
  picture?: string;
};

type Stage = {
  label: string;
  detail: string;
};

const checkpointLabels = [
  "Plan",
  "Fit parts",
  "Render",
  "Finish",
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
    code: <><path d="m9 7-5 5 5 5M15 7l5 5-5 5M13 5l-2 14" /></>,
    info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></>,
  };
  return (
    <svg className="mk-workspace-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {paths[kind]}
    </svg>
  );
}

export function ProfileChip({
  user,
  remaining,
  limit,
}: {
  user: SafeUser | null;
  remaining: number;
  limit: number;
}) {
  const label = user?.name || user?.email || "Google sign-in";
  const quotaLabel = remaining === 1 ? "1 free build remaining" : `${Math.max(0, remaining)} free builds remaining`;

  return (
    <div className="mk-app-user">
      <div className="mk-app-user-copy">
        <span>{label}</span>
        <small>{quotaLabel} <span aria-hidden="true">·</span> {limit} total</small>
      </div>
      <ProfileAvatar user={user} />
    </div>
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
  onDismiss,
  onCancel,
}: {
  stage: Stage;
  progress: number;
  error: string;
  onDismiss: () => void;
  onCancel: () => void;
}) {
  const safeProgress = Math.max(0, Math.min(100, Math.round(progress)));
  const checkpointIndex = safeProgress >= 92 ? 3 : safeProgress >= 48 ? 2 : safeProgress >= 24 ? 1 : 0;
  const visibleError = error && !/(daily limit|free build|quota|browser or network)/i.test(error) ? error : "";

  return (
    <div className="mk-workspace-grid mk-loading-layout" aria-busy="true">
      <div className="mk-generation-preview" aria-hidden="true">
        <div className="mk-product-blueprint">
          <span className="mk-blueprint-shell" />
          <span className="mk-blueprint-screen" />
          <span className="mk-blueprint-port" />
          <span className="mk-blueprint-scan" />
        </div>
        <small>Your product preview is being built</small>
      </div>

      <section className="mk-generation-status">
        <div className="mk-loader-copy" role="status" aria-live="polite" aria-atomic="true">
          <span>Building your idea</span>
          <strong id="workspace-title">{stage.label}</strong>
          <p>{stage.detail}</p>
        </div>

        <div
          className="mk-generation-progress"
          role="progressbar"
          aria-label="Build generation progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={safeProgress}
          aria-valuetext={`${stage.label}. ${safeProgress} percent complete.`}
        >
          <div className="mk-generation-progress-label">
            <span>Build progress</span>
            <strong>{safeProgress}%</strong>
          </div>
          <div className="mk-generation-bar-track">
            <div className="mk-generation-bar-fill" style={{ width: `${safeProgress}%` }} />
          </div>
        </div>

        <ol className="mk-generation-checkpoints" aria-label="Generation steps">
          {checkpointLabels.map((label, index) => (
            <li
              key={label}
              data-state={index < checkpointIndex ? "done" : index === checkpointIndex ? "current" : "upcoming"}
            >
              <span aria-hidden="true">{index < checkpointIndex ? "✓" : index + 1}</span>
              {label}
            </li>
          ))}
        </ol>

        <SkeletonPartRows />

        <div className="mk-progress-actions">
          <button className="mk-progress-dismiss" type="button" onClick={onDismiss}>Continue browsing</button>
          <button className="mk-progress-cancel" type="button" onClick={onCancel}>Cancel</button>
        </div>
        {visibleError && <p className="mk-form-error" role="alert">{visibleError}</p>}
      </section>
    </div>
  );
}
