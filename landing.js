const config = window.MAKEABLE_CONFIG || {};
const status = document.querySelector("[data-signup-status]");
const googleSlot = document.querySelector("[data-google-slot]");
const googleFallback = document.querySelector("[data-google-fallback]");
let googleInitialized = false;
let googleButtonRendered = false;
let googleSubmissionInFlight = false;

const GOOGLE_SUBMISSION_ATTEMPTS = 3;
const GOOGLE_SUBMISSION_TIMEOUT_MS = 10_000;
const WAITLIST_STATUS_TIMEOUT_MS = 4_000;

setupWorkbenchComparison();
setupBuildStory();
setupMobileSignup();
setupRecognition();
setupConnect();
setupWorkflowConnect();
setupTestPanel();
setupGoogleWave();
setupHeroFit();

document.querySelector("[data-current-year]")?.replaceChildren(
  document.createTextNode(String(new Date().getFullYear())),
);
for (const link of document.querySelectorAll('a[href="#join"]')) {
  link.addEventListener("click", () => {
    window.setTimeout(() => {
      const firstControl = googleSlot?.querySelector("button, iframe");
      firstControl?.focus({ preventScroll: true });
    });
  });
}

googleFallback?.addEventListener("click", () => {
  if (config.googleClientId) {
    setStatus("Google sign-in is still loading. Please try again in a moment.", "info");
    loadGoogleIdentity();
    return;
  }
  const isLocal =
    window.location.hostname === "127.0.0.1" ||
    window.location.hostname === "localhost";
  setStatus(
    isLocal
      ? "Google sign-in needs GOOGLE_CLIENT_ID in .env. Add the Web OAuth client ID, then restart Makeable."
      : "Google sign-in is temporarily unavailable. Please try again shortly.",
    "error",
  );
});

if (config.googleClientId && googleSlot) void initializeWaitlistExperience();

async function initializeWaitlistExperience() {
  const controller = new AbortController();
  const timeout = window.setTimeout(
    () => controller.abort(),
    WAITLIST_STATUS_TIMEOUT_MS,
  );
  try {
    const response = await fetch("/api/waitlist/status", {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({}));
    if (response.ok && payload.joined === true) {
      showWaitlistSuccess({ returning: true });
      return;
    }
  } catch {
    // A status outage must not prevent a new visitor from joining.
  } finally {
    window.clearTimeout(timeout);
  }
  loadGoogleIdentity();
}

function loadGoogleIdentity() {
  if (!googleSlot || !config.googleClientId) return;
  if (window.google?.accounts?.id) {
    initializeGoogleIdentity();
    return;
  }
  if (document.querySelector('script[data-google-identity]')) return;

  const script = document.createElement("script");
  script.src = "https://accounts.google.com/gsi/client";
  script.async = true;
  script.defer = true;
  script.dataset.googleIdentity = "true";
  script.addEventListener("load", () => {
    initializeGoogleIdentity();
  });
  script.addEventListener("error", () => {
    script.remove();
    setStatus("Google sign-in could not load. Check your connection and try again.", "error");
  });
  document.head.append(script);
}

function initializeGoogleIdentity() {
  if (
    !window.google?.accounts?.id ||
    !googleSlot ||
    !config.googleClientId
  ) {
    return;
  }
  if (!googleInitialized) {
    window.google.accounts.id.initialize({
      client_id: config.googleClientId,
      callback: handleGoogleCredential,
      auto_select: false,
      ux_mode: "popup",
    });
    googleInitialized = true;
  }
  renderGoogleButton();
}

function renderGoogleButton() {
  if (
    googleButtonRendered ||
    !googleInitialized ||
    !window.google?.accounts?.id?.renderButton ||
    !googleSlot
  ) {
    return;
  }

  const buttonHost = document.createElement("div");
  const slotStyle = window.getComputedStyle(googleSlot);
  const horizontalPadding =
    Number.parseFloat(slotStyle.paddingLeft) +
    Number.parseFloat(slotStyle.paddingRight);
  const availableWidth = Math.floor(googleSlot.clientWidth - horizontalPadding);
  const width = Math.min(400, Math.max(220, availableWidth));

  try {
    googleSlot.replaceChildren(buttonHost);
    window.google.accounts.id.renderButton(buttonHost, {
      type: "standard",
      theme: "outline",
      size: "large",
      text: "continue_with",
      shape: "rectangular",
      logo_alignment: "left",
      width,
    });
    googleButtonRendered = true;
  } catch {
    googleSlot.replaceChildren(googleFallback);
    setStatus("Google sign-in could not load. Check your connection and try again.", "error");
  }
}

async function handleGoogleCredential(response) {
  if (googleSubmissionInFlight) return;
  const credential = response?.credential;
  if (!credential) {
    setStatus("Google sign-in did not return an identity. Please try again.", "error");
    return;
  }
  googleSubmissionInFlight = true;
  renderGoogleMessage("Adding you to the waitlist…", { disabled: true });
  setStatus("Adding you to the waitlist…", "info");

  try {
    const apiResponse = await submitGoogleCredential(credential);
    const payload = await apiResponse.json().catch(() => ({}));
    if (!apiResponse.ok) {
      throw new Error(payload.error || "Google sign-in could not be completed.");
    }
    showWaitlistSuccess();
  } catch (error) {
    googleButtonRendered = false;
    renderGoogleButton();
    setStatus(
      error?.message || "Google sign-in could not be completed. Please try again.",
      "error",
    );
  } finally {
    googleSubmissionInFlight = false;
  }
}

async function submitGoogleCredential(credential) {
  let lastError;
  for (let attempt = 0; attempt < GOOGLE_SUBMISSION_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timeout = window.setTimeout(
      () => controller.abort(),
      GOOGLE_SUBMISSION_TIMEOUT_MS,
    );
    try {
      const response = await fetch("/api/auth/google", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ credential, intent: "waitlist" }),
        signal: controller.signal,
      });
      if (!isRetryableStatus(response.status) || attempt === GOOGLE_SUBMISSION_ATTEMPTS - 1) {
        return response;
      }
      lastError = new Error("Google sign-in could not be completed. Please try again.");
    } catch (error) {
      lastError = error;
      if (attempt === GOOGLE_SUBMISSION_ATTEMPTS - 1) break;
    } finally {
      window.clearTimeout(timeout);
    }
    setStatus("Connection interrupted-retrying your signup…", "info");
    await wait(300 * 2 ** attempt);
  }
  throw new Error(
    lastError?.name === "AbortError"
      ? "The signup request timed out. Please try again."
      : "Google sign-in could not be completed. Please try again.",
  );
}

function isRetryableStatus(statusCode) {
  return statusCode === 408 || statusCode === 429 || statusCode >= 500;
}

function wait(milliseconds) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function showWaitlistSuccess({ returning = false } = {}) {
  const content = document.querySelector("[data-signup-content]");
  const note = content?.querySelector(".signup-note");
  const dataUse = content?.querySelector(".signup-data-use");
  if (!content || !googleSlot || !note || !dataUse) return;

  const waitlistState = returning ? "returning" : "joined";
  content.dataset.waitlistState = waitlistState;
  googleSlot.dataset.waitlistState = waitlistState;

  renderGoogleMessage(
    returning ? "You’re already on the waitlist!" : "You’re on the waitlist!",
    { confirmed: true, disabled: true },
  );
  note.classList.add("is-confirmed");
  note.replaceChildren(
    document.createTextNode(
      returning
        ? "You’re all set-this browser remembers your confirmed signup."
        : "Your confirmed waitlist signup is saved in this browser.",
    ),
  );
  dataUse.classList.add("is-confirmed");
  dataUse.replaceChildren(
    document.createTextNode("Want to use a different Google account? "),
  );
  const forgetButton = document.createElement("button");
  forgetButton.className = "forget-waitlist";
  forgetButton.type = "button";
  forgetButton.dataset.forgetWaitlist = "";
  forgetButton.textContent = "Forget this browser";
  dataUse.append(forgetButton, document.createTextNode("."));
  forgetButton.addEventListener("click", forgetWaitlistBrowser);
  setStatus("", "success");
}

function renderGoogleMessage(label, { confirmed = false, disabled = false } = {}) {
  if (!googleSlot) return;
  const control = document.createElement(confirmed ? "div" : "button");
  control.className = `google-fallback${confirmed ? " google-fallback--confirmed" : ""}`;
  control.setAttribute("aria-live", "polite");
  if (confirmed) {
    control.setAttribute("role", "status");
    control.innerHTML = `<span class="google-confirmation-mark" aria-hidden="true">✓</span><span>${label}</span>`;
  } else {
    control.type = "button";
    control.disabled = disabled;
    control.innerHTML = `<img src="/assets/icons/google-g.svg" alt="" width="34" height="34" aria-hidden="true" /><span>${label}</span>`;
  }
  googleSlot.replaceChildren(control);
}

function setStatus(message, tone) {
  if (!status) return;
  status.textContent = message;
  status.dataset.tone = tone;
  status.setAttribute("role", tone === "error" ? "alert" : "status");
}

async function shareWaitlist() {
  const shareData = {
    title: "Makeable",
    text:
      "Turn ideas into working physical products in hours. " +
      "Makeable early access opens August 9.",
    url: new URL("/", window.location.href).href,
  };

  try {
    if (navigator.share) {
      await navigator.share(shareData);
      setStatus("Share sheet opened.", "success");
      return;
    }
    await navigator.clipboard.writeText(shareData.url);
    setStatus("Waitlist link copied.", "success");
  } catch (error) {
    if (error?.name === "AbortError") return;
    setStatus("Copy this page’s address to share Makeable.", "error");
  }
}

async function forgetWaitlistBrowser() {
  setStatus("Forgetting this browser…", "info");
  try {
    const response = await fetch("/api/waitlist/status", {
      method: "DELETE",
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw new Error();
    window.location.reload();
  } catch {
    setStatus("This browser could not be reset. Please try again.", "error");
  }
}

function setupBuildStory() {
  const root = document.querySelector("[data-story-root]");
  const chapters = [...document.querySelectorAll("[data-story-chapter]")];
  if (!root || !chapters.length) return;

  const activate = (chapter) => {
    const story = chapter.dataset.storyChapter;
    if (!story) return;
    root.dataset.activeStory = story;
    chapters.forEach((item) => {
      item.setAttribute("aria-current", String(item === chapter));
    });
  };

  activate(chapters[0]);
  if (!("IntersectionObserver" in window)) return;

  const observer = new IntersectionObserver(
    (entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (visible) activate(visible.target);
    },
    { rootMargin: "-28% 0px -42% 0px", threshold: [0.15, 0.35, 0.55] },
  );
  chapters.forEach((chapter) => observer.observe(chapter));
}

function setupWorkbenchComparison() {
  const comparison = document.querySelector("[data-comparison]");
  const toggle = comparison?.querySelector("[data-comparison-toggle]");
  if (!comparison || !toggle) return;

  toggle.addEventListener("click", () => {
    const visible = comparison.dataset.recognitionVisible === "true";
    comparison.dataset.recognitionVisible = String(!visible);
    toggle.setAttribute("aria-pressed", String(!visible));
    toggle.setAttribute(
      "aria-label",
      visible ? "Show Makeable part labels" : "Hide Makeable part labels",
    );
  });
}

function setupRecognition() {
  const chips = document.querySelector("[data-part-chips]");
  const count = document.querySelector("[data-recognized-count]");
  if (!chips || !count) return;

  chips.addEventListener("click", (event) => {
    const chip = event.target.closest("[data-part-chip]");
    if (!chip || !chips.contains(chip)) return;
    const allChips = [...chips.querySelectorAll("[data-part-chip]")];
    const index = allChips.indexOf(chip);
    const nextChip = allChips[index + 1] || allChips[index - 1];
    chip.closest("li")?.remove();
    const remaining = chips.querySelectorAll("[data-part-chip]").length;
    count.textContent = remaining
      ? `We found ${remaining} ${remaining === 1 ? "thing" : "things"}!`
      : "No parts left to recognise.";
    nextChip?.focus();
  });
}

function setupConnect() {
  const scene = document.querySelector(".story-scene--connect");
  const scope = scene?.querySelector("[data-connection-scope]");
  const scopeLabel = scope?.querySelector("[data-scope-label]");
  const controls = [...(scene?.querySelectorAll("[data-wire]") || [])];
  if (!scene || !scope || !scopeLabel || !controls.length) return;

  const wireOrder = ["vcc", "gnd", "sig"];
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const details = {
    vcc: "VCC → 5V",
    gnd: "GND → GND",
    sig: "SIG → A0",
  };
  let autoCycleTimer = null;

  const selectWire = (wire) => {
    scene.dataset.selectedWire = wire;
    scope.dataset.wire = wire;
    scopeLabel.textContent = details[wire];
    controls.forEach((control) => {
      const selected = control.dataset.wire === wire;
      control.classList.toggle("is-selected", selected);
      control.setAttribute("aria-pressed", String(selected));
    });
  };

  const stopAutoCycle = () => {
    if (autoCycleTimer === null) return;
    window.clearInterval(autoCycleTimer);
    autoCycleTimer = null;
  };

  const startAutoCycle = () => {
    if (reducedMotion.matches || document.hidden || autoCycleTimer !== null) return;
    autoCycleTimer = window.setInterval(() => {
      const currentIndex = wireOrder.indexOf(scene.dataset.selectedWire);
      selectWire(wireOrder[(currentIndex + 1) % wireOrder.length]);
    }, 1000);
  };

  const restartAutoCycle = () => {
    stopAutoCycle();
    startAutoCycle();
  };

  controls.forEach((control) => {
    control.addEventListener("click", () => {
      selectWire(control.dataset.wire);
      restartAutoCycle();
    });
  });

  scene.addEventListener("pointerenter", stopAutoCycle);
  scene.addEventListener("pointerleave", startAutoCycle);
  scene.addEventListener("focusin", stopAutoCycle);
  scene.addEventListener("focusout", (event) => {
    if (!scene.contains(event.relatedTarget)) startAutoCycle();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stopAutoCycle();
    else startAutoCycle();
  });
  reducedMotion.addEventListener?.("change", restartAutoCycle);

  selectWire("vcc");
  startAutoCycle();
}

function setupWorkflowConnect() {
  const scene = document.querySelector("[data-workflow-connect]");
  const scope = scene?.querySelector("[data-workflow-scope]");
  const scopeLabel = scope?.querySelector("[data-workflow-scope-label]");
  const controls = [...(scene?.querySelectorAll("[data-workflow-wire]") || [])];
  if (!scene || !scope || !scopeLabel || !controls.length) return;

  const wireOrder = ["vcc", "gnd", "sig"];
  const details = {
    vcc: "VCC → 5V",
    gnd: "GND → GND",
    sig: "SIG → A0",
  };
  const desktop = window.matchMedia("(min-width: 1280px)");
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let autoCycleTimer = null;

  const selectWire = (wire) => {
    scene.dataset.selectedWire = wire;
    scope.dataset.wire = wire;
    scopeLabel.textContent = details[wire];
    controls.forEach((control) => {
      const selected = control.dataset.workflowWire === wire;
      control.classList.toggle("is-selected", selected);
      control.setAttribute("aria-pressed", String(selected));
    });
  };

  const stopAutoCycle = () => {
    if (autoCycleTimer === null) return;
    window.clearInterval(autoCycleTimer);
    autoCycleTimer = null;
  };

  const startAutoCycle = () => {
    if (
      !desktop.matches ||
      reducedMotion.matches ||
      document.hidden ||
      autoCycleTimer !== null
    ) return;
    autoCycleTimer = window.setInterval(() => {
      const currentIndex = wireOrder.indexOf(scene.dataset.selectedWire);
      selectWire(wireOrder[(currentIndex + 1) % wireOrder.length]);
    }, 1000);
  };

  const restartAutoCycle = () => {
    stopAutoCycle();
    startAutoCycle();
  };

  controls.forEach((control) => {
    control.addEventListener("click", () => {
      selectWire(control.dataset.workflowWire);
      restartAutoCycle();
    });
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stopAutoCycle();
    else startAutoCycle();
  });
  desktop.addEventListener("change", restartAutoCycle);
  reducedMotion.addEventListener?.("change", restartAutoCycle);

  selectWire("vcc");
  startAutoCycle();
}

function setupTestPanel() {
  const panel = document.querySelector("[data-test-panel]");
  const run = panel?.querySelector("[data-test-run]");
  const progress = panel?.querySelector("#demo-progress");
  const progressCopy = panel?.querySelector("[data-test-progress-copy]");
  const checks = [...(panel?.querySelectorAll("[data-test-check]") || [])];
  if (!panel || !run || !progress || !progressCopy || !checks.length) return;

  let running = false;
  const updateProgress = () => {
    const completed = checks.filter((check) => check.classList.contains("is-complete")).length;
    const percentage = Math.round((completed / checks.length) * 100);
    progress.value = percentage;
    progressCopy.textContent = `${percentage}%`;
    run.textContent = completed === checks.length ? "Run checks again" : "Checking hardware…";
  };
  const setComplete = (check, complete) => {
    check.classList.toggle("is-complete", complete);
    check.setAttribute("aria-pressed", String(complete));
    const result = check.querySelector("strong");
    if (result) result.textContent = complete ? "OK" : "…";
  };
  checks.forEach((check) => {
    check.addEventListener("click", () => {
      if (running) return;
      setComplete(check, !check.classList.contains("is-complete"));
      updateProgress();
    });
  });
  run.addEventListener("click", () => {
    if (running) return;
    running = true;
    run.disabled = true;
    checks.forEach((check) => setComplete(check, false));
    updateProgress();
    let index = 0;
    const completeNext = () => {
      if (index >= checks.length) {
        running = false;
        run.disabled = false;
        updateProgress();
        return;
      }
      setComplete(checks[index], true);
      index += 1;
      updateProgress();
      window.setTimeout(completeNext, 420);
    };
    window.setTimeout(completeNext, 280);
  });
}

function setupMobileSignup() {
  if (document.body.classList.contains("waitlist-page--static-hero")) return;
  const anchor = document.querySelector("[data-signup-anchor]");
  const signup = anchor?.querySelector(".hero-signup");
  if (!anchor || !signup || !("IntersectionObserver" in window)) return;

  const mobile = window.matchMedia("(max-width: 1279px)");
  const clearStickyState = () => {
    signup.classList.remove("is-mobile-sticky");
    document.body.classList.remove("has-mobile-sticky-signup");
    document.body.style.removeProperty("--sticky-signup-clearance");
  };
  const update = (entry) => {
    if (!mobile.matches) {
      clearStickyState();
      return;
    }

    const shouldStick = entry.intersectionRatio < 0.98;
    signup.classList.toggle("is-mobile-sticky", shouldStick);
    document.body.classList.toggle("has-mobile-sticky-signup", shouldStick);
    if (shouldStick) {
      document.body.style.setProperty(
        "--sticky-signup-clearance",
        `${Math.ceil(signup.getBoundingClientRect().height + 40)}px`,
      );
    } else {
      document.body.style.removeProperty("--sticky-signup-clearance");
    }
  };

  const observer = new IntersectionObserver(([entry]) => update(entry), {
    threshold: [0, 0.98, 1],
  });
  observer.observe(anchor);
  mobile.addEventListener("change", () => {
    if (!mobile.matches) clearStickyState();
  });
}

/*
  Draws the "Continue with Google" button's squiggly pink border: a
  rounded rectangle whose four straight sides each carry two gentle sine
  oscillations (zero at the corners, so they blend into the rounded
  corners). Rendered as an SVG data-URI on the slot's ::after via a CSS
  variable, so the Google button's replaceChildren() never removes it.
  Regenerated at the slot's real pixel size whenever it changes.
*/
function setupGoogleWave() {
  const slot = document.querySelector("[data-google-slot]");
  if (!slot) return;

  const PINK = "%23e22670"; // --bench-pink
  const STROKE = 3;
  const AMPLITUDE = 1.4;
  const CYCLES = 2;
  const SEG = 26;

  const round = (v) => Math.round(v * 100) / 100;

  function buildPath(w, h, radius) {
    const pad = STROKE / 2 + AMPLITUDE + 0.5;
    const x0 = pad;
    const y0 = pad;
    const x1 = w - pad;
    const y1 = h - pad;
    const r = Math.max(0, Math.min(radius - pad, (x1 - x0) / 2, (y1 - y0) / 2));

    // Keep a consistent wavelength on every side: the long top/bottom
    // sides carry the full 2 oscillations, and the short left/right sides
    // get proportionally fewer so they don't look cramped. Integer
    // half-cycle counts keep the wave at zero on the corners.
    const topLen = x1 - r - (x0 + r);
    const sideLen = y1 - r - (y0 + r);
    const halfWave = topLen / (2 * CYCLES);
    const hcTop = Math.max(1, Math.round(topLen / halfWave));
    const hcSide = Math.max(1, Math.round(sideLen / halfWave));
    const waveH = (t) => AMPLITUDE * Math.sin(hcTop * Math.PI * t);
    const waveV = (t) => AMPLITUDE * Math.sin(hcSide * Math.PI * t);

    let d = `M ${round(x0 + r)} ${round(y0)}`;
    for (let i = 1; i <= SEG; i++) {
      const t = i / SEG;
      const x = x0 + r + (x1 - r - (x0 + r)) * t;
      d += ` L ${round(x)} ${round(y0 + waveH(t))}`;
    }
    d += ` A ${round(r)} ${round(r)} 0 0 1 ${round(x1)} ${round(y0 + r)}`;
    for (let i = 1; i <= SEG; i++) {
      const t = i / SEG;
      const y = y0 + r + (y1 - r - (y0 + r)) * t;
      d += ` L ${round(x1 + waveV(t))} ${round(y)}`;
    }
    d += ` A ${round(r)} ${round(r)} 0 0 1 ${round(x1 - r)} ${round(y1)}`;
    for (let i = 1; i <= SEG; i++) {
      const t = i / SEG;
      const x = x1 - r - (x1 - r - (x0 + r)) * t;
      d += ` L ${round(x)} ${round(y1 + waveH(t))}`;
    }
    d += ` A ${round(r)} ${round(r)} 0 0 1 ${round(x0)} ${round(y1 - r)}`;
    for (let i = 1; i <= SEG; i++) {
      const t = i / SEG;
      const y = y1 - r - (y1 - r - (y0 + r)) * t;
      d += ` L ${round(x0 + waveV(t))} ${round(y)}`;
    }
    d += ` A ${round(r)} ${round(r)} 0 0 1 ${round(x0 + r)} ${round(y0)} Z`;
    return d;
  }

  function generate() {
    const rect = slot.getBoundingClientRect();
    const w = Math.max(40, Math.round(rect.width));
    const h = Math.max(20, Math.round(rect.height));
    const radius =
      parseFloat(getComputedStyle(slot).borderTopLeftRadius) || 20;
    const d = buildPath(w, h, radius);
    const svg =
      `%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${w} ${h}' ` +
      `fill='none' stroke='${PINK}' stroke-width='${STROKE}' ` +
      `stroke-linejoin='round' stroke-linecap='round'%3E` +
      `%3Cpath d='${d}'/%3E%3C/svg%3E`;
    slot.style.setProperty(
      "--google-wave",
      `url("data:image/svg+xml,${svg}")`,
    );
  }

  generate();

  if ("ResizeObserver" in window) {
    let frame = 0;
    const observer = new ResizeObserver(() => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(generate);
    });
    observer.observe(slot);
  } else {
    window.addEventListener("resize", generate);
  }
}

/*
  Scale-to-fit for the sticky left rail. On the two-column desktop layout the
  hero is scroll-locked (overflow: hidden) and must never reflow, so instead
  of compacting the composition on short windows we scale the whole
  .hero-message as one unit to fit the available height. The design keeps its
  exact layout at every window size - it only ever shrinks, never grows past
  its natural (width-driven) size.
*/
function setupHeroFit() {
  const hero = document.querySelector(".waitlist-hero");
  const content = hero?.querySelector(".hero-message");
  if (!hero || !content) return;

  const twoColumn = window.matchMedia("(min-width: 1280px)");
  const round = (v) => Math.round(v * 1000) / 1000;

  function fit() {
    // The stacked single-column layout flows naturally - no scaling there.
    if (!twoColumn.matches) {
      content.style.transform = "";
      return;
    }
    const styles = getComputedStyle(hero);
    const availW =
      hero.clientWidth -
      parseFloat(styles.paddingLeft) -
      parseFloat(styles.paddingRight);
    const availH =
      hero.clientHeight -
      parseFloat(styles.paddingTop) -
      parseFloat(styles.paddingBottom);
    // offsetWidth/Height report the un-transformed layout size, so measuring
    // while a scale is applied stays stable (no reset needed).
    const natW = content.offsetWidth;
    const natH = content.offsetHeight;
    if (!natW || !natH || availW <= 0 || availH <= 0) return;
    const scale = Math.min(availW / natW, availH / natH, 1);
    content.style.transform = scale < 1 ? `scale(${round(scale)})` : "none";
  }

  let frame = 0;
  function schedule() {
    window.cancelAnimationFrame(frame);
    frame = window.requestAnimationFrame(fit);
  }

  fit();
  if ("ResizeObserver" in window) {
    const observer = new ResizeObserver(schedule);
    observer.observe(hero);
    observer.observe(content);
  }
  window.addEventListener("resize", schedule);
  twoColumn.addEventListener("change", schedule);
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(fit);
  }
}
