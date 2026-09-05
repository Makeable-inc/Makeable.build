"use client";

import { useEffect, useRef, useState } from "react";

/** Adapter for Circuit Studio's existing, same-origin embedded guide contract.
 * The studio owns GLB loading, accepted wire geometry, camera and identity gates.
 * Do not replace it with a second renderer or regenerate a saved assembly here.
 */
export function SavedWiringViewer({ buildId, stepIndex }: { buildId: string; stepIndex: number }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<"loading" | "ready" | "unavailable">("loading");
  const src = `/circuit-studio/?mode=guide&embed=1&sourceBuildId=${encodeURIComponent(buildId)}`;

  function syncStep() {
    frame.current?.contentWindow?.postMessage({ type: "makeable:wiring-step", buildId, stepIndex }, window.location.origin);
  }

  useEffect(() => {
    frame.current?.contentWindow?.postMessage({ type: "makeable:wiring-step", buildId, stepIndex }, window.location.origin);
  }, [buildId, stepIndex, attempt]);

  useEffect(() => {
    // Only the exact embedded viewer may acknowledge its fully loaded scene.
    const timer = window.setTimeout(() => setStatus("unavailable"), 45_000);
    function receive(event: MessageEvent) {
      if (event.origin !== window.location.origin || event.source !== frame.current?.contentWindow) return;
      if (event.data?.type !== "makeable:wiring-status" || event.data.buildId !== buildId) return;
      if (event.data.state === "ready" || event.data.state === "unavailable") {
        window.clearTimeout(timer);
        setStatus(event.data.state);
      }
    }
    window.addEventListener("message", receive);
    return () => { window.clearTimeout(timer); window.removeEventListener("message", receive); };
  }, [buildId, attempt]);

  return (
    <div className="mk-saved-wiring-viewer" data-viewer-status={status}>
      <iframe key={`${buildId}:${attempt}`} ref={frame} src={src} onLoad={syncStep}
        title="Interactive 3D wiring assembly" allow="fullscreen" />
      {status !== "ready" && <div className="mk-wiring-viewer-status" role="status">
        {status === "loading" ? <p>Loading your 3D assembly…</p> : <>
          <h3>The 3D view couldn’t load</h3>
          <p>Your saved guide is unchanged.</p>
          <button type="button" onClick={() => { setStatus("loading"); setAttempt(value => value + 1); }}>Reload 3D view</button>
        </>}
      </div>}
    </div>
  );
}
