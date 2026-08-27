import { buildSocialView, mediaKind } from "./social-model.js";
import { renderSocialAccounts } from "./social-account-table.js";

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
      "posts", "updated", "chartWrap", "chart", "chartDescription",
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
  const chart = els.chart;
  chart.replaceChildren();
  const data = state.view.daily;
  const width = Math.max(320, Math.round(els.chartWrap.clientWidth || 1200));
  const height = Math.max(220, Math.round(els.chartWrap.clientHeight || 286));
  const padding = { top: 18, right: width < 600 ? 40 : 48, bottom: 34, left: width < 600 ? 38 : 50 };
  const innerWidth = width - padding.left - padding.right;
  const innerHeight = height - padding.top - padding.bottom;
  const impressionsMax = niceMaximum(Math.max(1, ...data.map((point) => point.impressions)));
  const rates = data.map((point) => point.engagementRate).filter(Number.isFinite);
  const rateMax = Math.max(0.1, ...rates);
  const xStep = innerWidth / Math.max(data.length, 1);
  chart.setAttribute("viewBox", `0 0 ${width} ${height}`);
  for (let index = 0; index <= 4; index += 1) {
    const y = padding.top + innerHeight - (innerHeight * index) / 4;
    chart.append(svg("line", {
      class: "social-chart-grid",
      x1: padding.left,
      x2: width - padding.right,
      y1: y,
      y2: y,
    }));
    const label = svg("text", {
      class: "social-chart-label",
      x: padding.left - 10,
      y: y + 4,
      "text-anchor": "end",
    });
    label.textContent = compactFormatter.format((impressionsMax * index) / 4);
    chart.append(label);
    const rateLabel = svg("text", {
      class: "social-chart-label social-chart-rate-label",
      x: width - padding.right + 9,
      y: y + 4,
      "text-anchor": "start",
    });
    rateLabel.textContent = optionalPercent((rateMax * index) / 4);
    chart.append(rateLabel);
  }
  data.forEach((point, index) => {
    const barWidth = Math.max(3, Math.min(18, xStep * 0.64));
    const barHeight = (point.impressions / impressionsMax) * innerHeight;
    const bar = svg("rect", {
      class: "social-chart-bar",
      x: padding.left + index * xStep + (xStep - barWidth) / 2,
      y: padding.top + innerHeight - barHeight,
      width: barWidth,
      height: barHeight,
      rx: Math.min(3, barWidth / 3),
    });
    const title = svg("title");
    title.textContent = `${dateFormatter.format(new Date(`${point.date}T00:00:00Z`))}: ${numberFormatter.format(point.impressions)} content exposures`;
    bar.append(title);
    chart.append(bar);
  });
  const points = data.flatMap((point, index) => Number.isFinite(point.engagementRate)
    ? [{
        index,
        position: [
          padding.left + index * xStep + xStep / 2,
          padding.top + innerHeight - (point.engagementRate / rateMax) * innerHeight,
        ],
      }]
    : []);
  if (points.length) {
    chart.append(svg("path", {
      class: "social-chart-line",
      d: linePath(points.map((point) => point.position)),
    }));
    points.forEach(({ index, position }) => {
      const dot = svg("circle", {
        class: "social-chart-dot",
        cx: position[0],
        cy: position[1],
        r: data.length < 16 ? 3 : 2,
      });
      const title = svg("title");
      title.textContent = `${dateFormatter.format(new Date(`${data[index].date}T00:00:00Z`))}: ${optionalPercent(data[index].engagementRate)} engagement rate`;
      dot.append(title);
      chart.append(dot);
    });
  }
  labelDates(chart, data, padding, innerWidth, height, width < 600 ? 4 : 7);
  els.chartDescription.textContent = `${data.length} daily points showing content exposures as blue bars and measured engagement rate as a green line.`;
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

function labelDates(chart, data, padding, innerWidth, height, maximum) {
  if (!data.length) return;
  const count = Math.min(maximum, data.length);
  const indexes = [...new Set(Array.from({ length: count }, (_, index) =>
    Math.round((index / Math.max(1, count - 1)) * (data.length - 1))))];
  indexes.forEach((index) => {
    const label = svg("text", {
      class: "social-chart-label",
      x: padding.left + ((index + 0.5) / data.length) * innerWidth,
      y: height - 9,
      "text-anchor": index === 0 ? "start" : index === data.length - 1 ? "end" : "middle",
    });
    label.textContent = dateFormatter.format(new Date(`${data[index].date}T00:00:00Z`));
    chart.append(label);
  });
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
function svg(name, attributes = {}) {
  const element = document.createElementNS("http://www.w3.org/2000/svg", name);
  Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, String(value)));
  return element;
}
function linePath(points) {
  return points.map((point, index) => `${index ? "L" : "M"} ${point[0]} ${point[1]}`).join(" ");
}
function niceMaximum(value) {
  const magnitude = 10 ** Math.floor(Math.log10(value));
  return Math.ceil(value / magnitude) * magnitude;
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
