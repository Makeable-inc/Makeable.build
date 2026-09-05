import { buildSocialView, mediaKind } from "./social-model.js";
import { formatSocialPercent, renderSocialAccounts } from "./social-account-table.js";
import { renderSocialChart } from "./social-chart.js";
import { renderSocialContent } from "./social-content.js";

const numberFormatter = new Intl.NumberFormat();
const compactFormatter = new Intl.NumberFormat(undefined, {
  notation: "compact",
  maximumFractionDigits: 1,
});
const dateFormatter = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
const dateTimeFormatter = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const CONFIGURED_ACCOUNTS = [
  ["instagram", "@makeable.build", "makeable_build", "https://www.instagram.com/makeable.build/"],
  ["instagram", "@makeable.zak", "makeable_zak", "https://www.instagram.com/makeable.zak/"],
  ["tiktok", "@trymakeable.build", "trymakeable_build", "https://www.tiktok.com/@trymakeable.build"],
  ["facebook", "Makeable Facebook", "makeable_facebook", "https://www.facebook.com/profile.php?id=61593473267038"],
  ["youtube", "@makeablebuild", "makeable_youtube", "https://www.youtube.com/@makeablebuild"],
];
export function createSocialDashboard(options) {
  const state = {
    records: [],
    generatedAt: "",
    days: 30,
    rankBy: "impressions",
    attribution: { status: "not_connected", daily: [] },
    view: buildSocialView([], { days: 30 }),
    photoDemo: new URLSearchParams(window.location.search).get("demo") === "photo",
    loading: false,
  };
  const els = socialElements();
  const mediaViewer = createMediaViewer(els, { showToast: options.showToast });
  const renderOptions = { ...options, mediaViewer };
  const resizeObserver = new ResizeObserver(() => renderChart(state, els));
  resizeObserver.observe(els.chartWrap);

  els.rangeButtons.forEach((button) => {
    button.addEventListener("click", () => {
      state.days = button.dataset.socialRange === "all"
        ? "all"
        : Number(button.dataset.socialRange);
      els.rangeButtons.forEach((item) => {
        item.classList.toggle("is-selected", item === button);
        item.setAttribute("aria-pressed", String(item === button));
      });
      render(state, els, renderOptions);
    });
  });
  els.rankBy.addEventListener("change", () => {
    state.rankBy = els.rankBy.value;
    render(state, els, renderOptions);
  });
  els.importButton.addEventListener("click", () => els.csvInput.click());
  els.refreshButton.addEventListener("click", () => void refreshPublicData(state, els, renderOptions));
  els.csvInput.addEventListener("change", () => {
    const [file] = els.csvInput.files || [];
    if (file) void importCsv(file, state, els, renderOptions);
  });

  return {
    clear() {
      state.records = [];
      state.generatedAt = "";
      state.attribution = { status: "not_connected", daily: [] };
      render(state, els, renderOptions);
    },
    async load(loadOptions = {}) {
      if (state.loading) return;
      state.loading = true;
      try {
        const response = await fetch("/api/dashboard/social", {
          headers: { Accept: "application/json" },
        });
        if (response.status === 401) {
          options.onUnauthorized();
          return;
        }
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload.error || "Social data could not be loaded.");
        }
        applyReport(payload, state, els, renderOptions);
        if (loadOptions.announce) options.showToast("Social data refreshed");
      } catch (error) {
        options.showToast(errorMessage(error, "Social refresh failed"));
      } finally {
        state.loading = false;
      }
    },
    async refresh() {
      return refreshPublicData(state, els, renderOptions);
    },
    show() {
      window.requestAnimationFrame(() => renderChart(state, els));
    },
  };
}

function socialElements() {
  return {
    ...elementMap("social", [
      "importButton", "refreshButton", "csvInput", "importStatus", "rankBy", "exposures",
      "engagementRate", "websiteSessions", "websiteVisitRate", "followers",
      "posts", "updated", "chartWrap", "chart",
      "accountRows", "accountCount", "contentGrid", "contentCount", "emptyState",
    ]),
    ...elementMap("media", [
      "dialog", "dialogClose", "dialogTitle", "dialogVideo", "dialogEmbed", "dialogImage",
      "dialogUnavailable", "dialogCaption", "dialogImpressions", "dialogEngagements",
    ]),
    rangeButtons: [...document.querySelectorAll("[data-social-range]")],
  };
}
function elementMap(prefix, names) {
  return Object.fromEntries(names.map((name) => [
    name,
    document.querySelector(`#${prefix}${capitalize(name)}`),
  ]));
}
function applyReport(report, state, els, options) {
  state.records = Array.isArray(report?.records) ? report.records : [];
  state.generatedAt = typeof report?.generatedAt === "string" ? report.generatedAt : "";
  state.attribution = normalizeAttribution(report?.attribution);
  render(state, els, options);
}
function render(state, els, options) {
  state.view = buildSocialView(state.records, {
    days: state.days,
    rankBy: state.rankBy,
    attribution: state.attribution,
    configuredAccounts: CONFIGURED_ACCOUNTS,
  });
  const view = state.view;
  const display = state.photoDemo ? photoDemoView(view) : view;
  els.exposures.textContent = compact(display.totalExposures);
  els.engagementRate.textContent = formatSocialPercent(display.engagementRate);
  els.websiteSessions.textContent = attributionMetric(
    display.websiteSessions,
    display.attributionStatus,
    (value) => numberFormatter.format(value),
  );
  els.websiteVisitRate.textContent = attributionMetric(
    display.websiteVisitRate,
    display.attributionStatus,
    formatSocialPercent,
  );
  els.websiteSessions.classList.toggle("is-status", display.attributionStatus !== "connected");
  els.websiteVisitRate.classList.toggle("is-status", display.attributionStatus !== "connected");
  els.followers.textContent = optionalSigned(display.followersGained);
  els.posts.textContent = numberFormatter.format(display.postsTotal);
  els.updated.textContent = state.generatedAt
    ? `Updated ${dateTimeFormatter.format(new Date(state.generatedAt))}`
    : "No social data imported yet";
  if (state.photoDemo) {
    els.importStatus.textContent = "Demo preview — illustrative metrics, not live analytics.";
    els.importStatus.className = "import-status is-warning";
  }
  renderChart(state, els);
  renderSocialAccounts(view, { rows: els.accountRows, count: els.accountCount });
  renderSocialContent(view, els, options.mediaViewer, {
    compact,
    number: (value) => numberFormatter.format(value),
  });
  options.onReport(view);
}
function photoDemoView(view) {
  const exposures = Math.max(view.totalExposures, 36_700);
  const websiteSessions = Math.round(exposures * 0.0034);
  return { ...view, totalExposures: exposures, engagementRate: 0.036, websiteSessions,
    websiteVisitRate: websiteSessions / exposures, followersGained: 82, attributionStatus: "connected" };
}
function renderChart(state, els) {
  renderSocialChart({ chart: els.chart, chartWrap: els.chartWrap, data: state.view.daily });
}
export function createMediaViewer(els, viewerOptions = {}) {
  const documentRef = viewerOptions.documentRef || document;
  const windowRef = viewerOptions.windowRef || window;
  const showToast = viewerOptions.showToast || (() => {});
  let releaseScroll = null;
  let openRequest = 0;

  els.dialogUnavailable.setAttribute("role", "status");
  els.dialogUnavailable.setAttribute("aria-live", "polite");
  els.dialogUnavailable.setAttribute("aria-atomic", "true");
  els.dialogClose.addEventListener("click", () => els.dialog.close());
  els.dialog.addEventListener("click", (event) => {
    if (event.target === els.dialog) els.dialog.close();
  });
  els.dialog.addEventListener("close", closeViewer);
  els.dialogVideo.addEventListener("error", () => {
    if (els.dialog.open && !els.dialogVideo.hidden) showVideoUnavailable(els);
  });

  function closeViewer() {
    openRequest += 1;
    resetDialog(els);
    releasePageScroll();
  }

  function releasePageScroll() {
    const release = releaseScroll;
    releaseScroll = null;
    if (release) release();
  }

  return {
    async open(record) {
      const request = ++openRequest;
      resetDialog(els);
      prepareDialog(record, els);
      releaseScroll = lockDocumentScroll(documentRef, windowRef);
      try {
        els.dialog.showModal();
      } catch {
        resetDialog(els);
        releasePageScroll();
        showToast("Media preview could not be opened.");
        return false;
      }
      if (mediaKind(record) === "video" && record.previewUrl) {
        try {
          await els.dialogVideo.play();
        } catch {
          if (els.dialog.open && request === openRequest) showVideoUnavailable(els);
        }
      }
      return true;
    },
  };
}

export function lockDocumentScroll(documentRef, windowRef) {
  const root = documentRef.documentElement;
  const body = documentRef.body;
  const scrollX = windowRef.scrollX;
  const scrollY = windowRef.scrollY;
  const scrollbarWidth = Math.max(0, windowRef.innerWidth - root.clientWidth);
  const bodyPadding = Number.parseFloat(windowRef.getComputedStyle(body).paddingRight) || 0;
  const rootHadState = root.classList.contains("is-media-viewer-open");
  const bodyHadState = body.classList.contains("is-media-viewer-open");
  const previous = {
    bodyLeft: body.style.left,
    bodyOverflow: body.style.overflow,
    bodyPaddingRight: body.style.paddingRight,
    bodyPosition: body.style.position,
    bodyRight: body.style.right,
    bodyTop: body.style.top,
    bodyWidth: body.style.width,
    rootOverflow: root.style.overflow,
  };

  root.classList.add("is-media-viewer-open");
  body.classList.add("is-media-viewer-open");
  root.style.overflow = "hidden";
  body.style.position = "fixed";
  body.style.top = `-${scrollY}px`;
  body.style.left = `-${scrollX}px`;
  body.style.right = "0";
  body.style.width = "100%";
  body.style.overflow = "hidden";
  body.style.paddingRight = `${bodyPadding + scrollbarWidth}px`;

  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (!rootHadState) root.classList.remove("is-media-viewer-open");
    if (!bodyHadState) body.classList.remove("is-media-viewer-open");
    root.style.overflow = previous.rootOverflow;
    body.style.position = previous.bodyPosition;
    body.style.top = previous.bodyTop;
    body.style.left = previous.bodyLeft;
    body.style.right = previous.bodyRight;
    body.style.width = previous.bodyWidth;
    body.style.overflow = previous.bodyOverflow;
    body.style.paddingRight = previous.bodyPaddingRight;
    windowRef.scrollTo(scrollX, scrollY);
  };
}

function prepareDialog(record, els) {
  const kind = mediaKind(record);
  const sources = Array.isArray(record.crossPosts) ? record.crossPosts : [record];
  els.dialogTitle.textContent = record.caption || "Content preview";
  els.dialogCaption.textContent = `${sources.map((source) => `${capitalize(source.platform)} ${source.account}`).join(" + ")} · ${dateFormatter.format(new Date(record.publishedAt))}`;
  els.dialogImpressions.textContent = `${compact(record.impressions)} content exposures`;
  els.dialogEngagements.textContent = `${compact(record.engagements)} engagements`;
  if (kind === "video") {
    if (record.previewUrl) {
      els.dialogVideo.src = record.previewUrl;
      if (record.thumbnailUrl) els.dialogVideo.poster = record.thumbnailUrl;
      els.dialogVideo.hidden = false;
    } else {
      els.dialogEmbed.src = record.embedUrl;
      els.dialogEmbed.title = `${capitalize(record.platform)} player for ${record.caption || "social post"}`;
      els.dialogEmbed.hidden = false;
    }
  } else if (kind === "image") {
    els.dialogImage.src = record.thumbnailUrl;
    els.dialogImage.alt = `${capitalize(record.platform)} preview for ${record.caption || "social post"}`;
    els.dialogImage.hidden = false;
  } else {
    els.dialogUnavailable.hidden = false;
    els.dialogUnavailable.textContent = "Preview unavailable.";
  }
}

function showVideoUnavailable(els) {
  els.dialogVideo.pause();
  els.dialogVideo.hidden = true;
  els.dialogVideo.removeAttribute("src");
  els.dialogVideo.removeAttribute("poster");
  els.dialogVideo.load();
  els.dialogEmbed.removeAttribute("src");
  els.dialogEmbed.title = "";
  els.dialogEmbed.hidden = true;
  els.dialogUnavailable.hidden = false;
  els.dialogUnavailable.textContent = "Video preview unavailable.";
}

function resetDialog(els) {
  els.dialogVideo.pause();
  els.dialogVideo.hidden = true;
  els.dialogVideo.removeAttribute("src");
  els.dialogVideo.removeAttribute("poster");
  els.dialogVideo.load();
  els.dialogEmbed.removeAttribute("src");
  els.dialogEmbed.title = "";
  els.dialogEmbed.hidden = true;
  els.dialogImage.removeAttribute("src");
  els.dialogImage.alt = "";
  els.dialogImage.hidden = true;
  els.dialogUnavailable.hidden = true;
  els.dialogUnavailable.textContent = "";
}

async function importCsv(file, state, els, options) {
  setImportState(els, true, "Reading CSV…");
  try {
    if (file.size > 2 * 1024 * 1024) throw new Error("The social CSV must be 2 MB or smaller.");
    const response = await fetch("/api/dashboard/social", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ csv: await file.text() }),
    });
    if (response.status === 401) {
      options.onUnauthorized();
      return;
    }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "The social CSV could not be imported.");
    applyReport(payload.report, state, els, options);
    setImportState(
      els,
      false,
      `Imported ${numberFormatter.format(payload.imported)} posts. ${numberFormatter.format(payload.total)} tracked in total.`,
      "success",
    );
    options.showToast("Social data imported");
  } catch (error) {
    setImportState(els, false, errorMessage(error, "Social import failed"), "error");
  } finally {
    els.csvInput.value = "";
    if (els.importButton.disabled) setImportState(els, false, els.importStatus.textContent);
  }
}

function setImportState(els, busy, message, tone = "") {
  els.importButton.disabled = busy;
  els.importButton.setAttribute("aria-busy", String(busy));
  els.importStatus.textContent = message;
  els.importStatus.className = `import-status${tone ? ` is-${tone}` : ""}`;
}

async function refreshPublicData(state, els, options) {
  setRefreshState(els, true, "Refreshing public social data…");
  try {
    const response = await fetch("/api/dashboard/social/refresh-public", {
      method: "POST",
      headers: { Accept: "application/json" },
    });
    if (response.status === 401) return options.onUnauthorized();
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "Public social refresh failed.");
    applyReport(payload.report, state, els, options);
    const unavailable = Array.isArray(payload.partialFailures)
      ? payload.partialFailures.map((failure) => failure.platform).filter(Boolean) : [];
    const refreshed = Array.isArray(payload.refreshedPlatforms)
      ? payload.refreshedPlatforms.map(capitalize).filter(Boolean) : [];
    const sourceSummary = refreshed.length ? ` from ${refreshed.join(", ")}` : "";
    const message = unavailable.length
      ? `Refreshed ${numberFormatter.format(payload.imported)} public posts${sourceSummary}. ${unavailable.join(", ")} will retry automatically.`
      : `Refreshed ${numberFormatter.format(payload.imported)} public posts${sourceSummary}.`;
    setRefreshState(els, false, message, "success");
    options.showToast(unavailable.length ? "Public social data partially refreshed" : "Public social data refreshed");
    return true;
  } catch (error) {
    setRefreshState(els, false, errorMessage(error, "Public social refresh failed"), "error");
    return false;
  }
}

function setRefreshState(els, busy, message, tone = "") {
  els.refreshButton.disabled = busy;
  els.refreshButton.setAttribute("aria-busy", String(busy));
  els.importStatus.textContent = message;
  els.importStatus.className = `import-status${tone ? ` is-${tone}` : ""}`;
}

function compact(value) {
  return compactFormatter.format(Number(value) || 0);
}
function optionalSigned(value) {
  if (!Number.isFinite(value)) return "—";
  return `${value > 0 ? "+" : ""}${numberFormatter.format(value)}`;
}
function attributionMetric(value, status, format) {
  return status === "connected" && Number.isFinite(value)
    ? format(value)
    : status === "not_connected" ? "Not connected" : "Unavailable";
}
function normalizeAttribution(value) {
  if (value?.status === "connected" && Array.isArray(value.daily)) return value;
  if (value?.status === "unavailable") return { status: "unavailable", daily: [] };
  return { status: "not_connected", daily: [] };
}
function capitalize(value) {
  return `${value?.charAt(0)?.toUpperCase() || ""}${value?.slice(1) || ""}`;
}
function errorMessage(error, fallback) {
  return error instanceof Error ? error.message : fallback;
}
