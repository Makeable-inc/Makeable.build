import { buildSocialView, mediaKind } from "./social-model.js";
import { renderSocialAccounts } from "./social-account-table.js";
import { renderSocialChart } from "./social-chart.js";

const numberFormatter = new Intl.NumberFormat();
const compactFormatter = new Intl.NumberFormat(undefined, {
  notation: "compact",
  maximumFractionDigits: 1,
});
const dateFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});
const dateTimeFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});
export function createSocialDashboard(options) {
  const state = {
    records: [],
    generatedAt: "",
    days: 30,
    rankBy: "impressions",
    attribution: { status: "not_connected", daily: [] },
    view: buildSocialView([], { days: 30 }),
    loading: false,
  };
  const els = socialElements();
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
      render(state, els, options);
    });
  });
  els.rankBy.addEventListener("change", () => {
    state.rankBy = els.rankBy.value;
    render(state, els, options);
  });
  els.importButton.addEventListener("click", () => els.csvInput.click());
  els.csvInput.addEventListener("change", () => {
    const [file] = els.csvInput.files || [];
    if (file) void importCsv(file, state, els, options);
  });
  els.dialogClose.addEventListener("click", () => els.dialog.close());
  els.dialog.addEventListener("click", (event) => {
    if (event.target === els.dialog) els.dialog.close();
  });
  els.dialog.addEventListener("close", () => resetDialog(els));

  return {
    clear() {
      state.records = [];
      state.generatedAt = "";
      state.attribution = { status: "not_connected", daily: [] };
      render(state, els, options);
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
        applyReport(payload, state, els, options);
        if (loadOptions.announce) options.showToast("Social data refreshed");
      } catch (error) {
        options.showToast(errorMessage(error, "Social refresh failed"));
      } finally {
        state.loading = false;
      }
    },
    show() {
      window.requestAnimationFrame(() => renderChart(state, els));
    },
  };
}

function socialElements() {
  return {
    ...elementMap("social", [
      "importButton", "csvInput", "importStatus", "rankBy", "exposures",
      "engagementRate", "websiteSessions", "websiteVisitRate", "followers",
      "posts", "updated", "chartWrap", "chart",
      "accountRows", "accountCount", "contentGrid", "contentCount", "emptyState",
    ]),
    ...elementMap("media", [
      "dialog", "dialogClose", "dialogTitle", "dialogVideo", "dialogImage",
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
  });
  const view = state.view;
  els.exposures.textContent = compact(view.totalExposures);
  els.engagementRate.textContent = optionalPercent(view.engagementRate);
  els.websiteSessions.textContent = attributionMetric(
    view.websiteSessions,
    view.attributionStatus,
    (value) => numberFormatter.format(value),
  );
  els.websiteVisitRate.textContent = attributionMetric(
    view.websiteVisitRate,
    view.attributionStatus,
    optionalPercent,
  );
  els.websiteSessions.classList.toggle("is-status", view.attributionStatus !== "connected");
  els.websiteVisitRate.classList.toggle("is-status", view.attributionStatus !== "connected");
  els.followers.textContent = optionalSigned(view.followersGained);
  els.posts.textContent = numberFormatter.format(view.postsTotal);
  els.updated.textContent = state.generatedAt
    ? `Updated ${dateTimeFormatter.format(new Date(state.generatedAt))}`
    : "No social data imported yet";
  renderChart(state, els);
  renderSocialAccounts(view, { rows: els.accountRows, count: els.accountCount });
  renderContent(view, els);
  options.onReport(view);
}

function renderChart(state, els) {
  renderSocialChart({ chart: els.chart, chartWrap: els.chartWrap, data: state.view.daily });
}

function renderContent(view, els) {
  els.contentGrid.replaceChildren();
  view.content.slice(0, 12).forEach((record) => {
    const card = document.createElement("article");
    const media = document.createElement("div");
    const body = document.createElement("div");
    card.className = "content-card";
    media.className = "content-media";
    body.className = "content-card-body";
    appendMedia(media, record, els);
    body.append(
      metaRow(record),
      paragraph(record.caption || "Untitled social post", "content-card-caption"),
      statRow(record),
    );
    card.append(media, body);
    els.contentGrid.append(card);
  });
  els.emptyState.hidden = view.content.length > 0;
  els.contentCount.textContent = `${numberFormatter.format(view.content.length)} posts`;
}

function appendMedia(container, record, els) {
  const kind = mediaKind(record);
  if (record.thumbnailUrl) {
    const image = document.createElement("img");
    image.src = record.thumbnailUrl;
    image.alt = `${capitalize(record.platform)} preview for ${record.caption || "social post"}`;
    image.loading = "lazy";
    image.width = 640;
    image.height = 360;
    container.append(image);
  } else if (kind === "video") {
    const video = document.createElement("video");
    video.src = record.previewUrl;
    video.muted = true;
    video.playsInline = true;
    video.preload = "metadata";
    video.setAttribute("aria-hidden", "true");
    container.append(video);
  } else {
    container.append(paragraph("Preview unavailable", "media-unavailable"));
  }
  if (kind !== "unavailable") {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "play-control";
    button.setAttribute(
      "aria-label",
      kind === "video"
        ? `Play ${record.caption || "social preview"}`
        : `View ${record.caption || "social preview"}`,
    );
    button.addEventListener("click", () => openDialog(record, els));
    if (kind === "image") button.classList.add("image-control");
    container.append(button);
  }
}

function openDialog(record, els) {
  const kind = mediaKind(record);
  els.dialogTitle.textContent = record.caption || "Content preview";
  els.dialogCaption.textContent = `${capitalize(record.platform)} ${record.account} · ${dateFormatter.format(new Date(record.publishedAt))}`;
  els.dialogImpressions.textContent = `${compact(record.impressions)} content exposures`;
  els.dialogEngagements.textContent = `${compact(record.engagements)} engagements`;
  if (kind === "video") {
    els.dialogVideo.src = record.previewUrl;
    if (record.thumbnailUrl) els.dialogVideo.poster = record.thumbnailUrl;
    els.dialogVideo.hidden = false;
  } else if (kind === "image") {
    els.dialogImage.src = record.thumbnailUrl;
    els.dialogImage.alt = `${capitalize(record.platform)} preview for ${record.caption || "social post"}`;
    els.dialogImage.hidden = false;
  } else {
    els.dialogUnavailable.hidden = false;
  }
  els.dialog.showModal();
  if (kind === "video") void els.dialogVideo.play().catch(() => {});
}

function resetDialog(els) {
  els.dialogVideo.pause();
  els.dialogVideo.removeAttribute("src");
  els.dialogVideo.removeAttribute("poster");
  els.dialogVideo.load();
  els.dialogVideo.hidden = true;
  els.dialogImage.removeAttribute("src");
  els.dialogImage.alt = "";
  els.dialogImage.hidden = true;
  els.dialogUnavailable.hidden = true;
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

function metaRow(record) {
  const row = document.createElement("div");
  row.className = "content-card-meta";
  row.append(span(capitalize(record.platform)), span(record.account));
  return row;
}

function statRow(record) {
  const row = document.createElement("div");
  row.className = "content-card-stats";
  row.append(
    span(`${compact(record.impressions)} content exposures`),
    span(`${compact(record.engagements)} engagements`),
  );
  return row;
}

function paragraph(value, className) {
  return textElement("p", value, className);
}
function span(value) {
  return textElement("span", value);
}
function textElement(name, value, className = "") {
  const element = document.createElement(name);
  if (className) element.className = className;
  element.textContent = value;
  return element;
}
function compact(value) {
  return compactFormatter.format(Number(value) || 0);
}
function optionalPercent(value) {
  return Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : "—";
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
