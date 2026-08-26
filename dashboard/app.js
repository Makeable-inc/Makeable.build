const state = {
  records: [],
  activity: [],
  report: null,
  chartRange: 30,
  generatedAt: "",
  refreshTimer: null,
  toastTimer: null,
};

const els = {
  authView: document.querySelector("#authView"),
  authForm: document.querySelector("#authForm"),
  accessKey: document.querySelector("#accessKey"),
  authError: document.querySelector("#authError"),
  authSubmit: document.querySelector("#authSubmit"),
  toggleAccessKey: document.querySelector("#toggleAccessKey"),
  dashboardView: document.querySelector("#dashboardView"),
  refreshButton: document.querySelector("#refreshButton"),
  downloadButton: document.querySelector("#downloadButton"),
  signOutButton: document.querySelector("#signOutButton"),
  totalMetric: document.querySelector("#totalMetric"),
  builderMetric: document.querySelector("#builderMetric"),
  projectMetric: document.querySelector("#projectMetric"),
  ownerMetric: document.querySelector("#ownerMetric"),
  todayMetric: document.querySelector("#todayMetric"),
  activeMetric: document.querySelector("#activeMetric"),
  chartTotal: document.querySelector("#chartTotal"),
  lastUpdated: document.querySelector("#lastUpdated"),
  chartWrap: document.querySelector("#chartWrap"),
  growthChart: document.querySelector("#growthChart"),
  chartTooltip: document.querySelector("#chartTooltip"),
  searchInput: document.querySelector("#searchInput"),
  signupRows: document.querySelector("#signupRows"),
  emptyState: document.querySelector("#emptyState"),
  resultCount: document.querySelector("#resultCount"),
  dataHealth: document.querySelector("#dataHealth"),
  rangeButtons: [...document.querySelectorAll("[data-range]")],
  toast: document.querySelector("#toast"),
};

const numberFormatter = new Intl.NumberFormat();
const dateTimeFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});
const chartDateFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
});
const relativeTimeFormatter = new Intl.RelativeTimeFormat(undefined, {
  numeric: "auto",
});
const MS_PER_DAY = 86_400_000;

els.authForm.addEventListener("submit", authenticate);
els.toggleAccessKey.addEventListener("click", toggleAccessKeyVisibility);
els.refreshButton.addEventListener("click", () => loadDashboard({ announce: true }));
els.downloadButton.addEventListener("click", downloadCsv);
els.signOutButton.addEventListener("click", signOut);
els.searchInput.addEventListener("input", renderTable);
els.rangeButtons.forEach((button) => {
  button.addEventListener("click", () => {
    state.chartRange = button.dataset.range === "all" ? "all" : Number(button.dataset.range);
    els.rangeButtons.forEach((item) => {
      item.classList.toggle("is-selected", item === button);
    });
    renderChart();
  });
});
window.addEventListener("resize", renderChart);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && state.records.length) {
    void loadDashboard();
  }
});

void initialize();

async function initialize() {
  try {
    const response = await fetch("/api/dashboard/session", {
      headers: { Accept: "application/json" },
    });
    const payload = await response.json().catch(() => ({}));
    if (response.ok && payload.authenticated) {
      showDashboard();
      await loadDashboard();
      return;
    }
    if (response.status === 503) {
      els.authError.textContent = payload.error || "Dashboard access is not configured.";
      els.accessKey.disabled = true;
      els.authSubmit.disabled = true;
    }
  } catch {
    els.authError.textContent = "The dashboard could not connect. Please try again.";
  }
}

async function authenticate(event) {
  event.preventDefault();
  const accessKey = els.accessKey.value;
  if (!accessKey) return;
  setButtonBusy(els.authSubmit, true);
  els.authError.textContent = "";
  try {
    const response = await fetch("/api/dashboard/session", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ accessKey }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      els.authError.textContent = payload.error || "The dashboard could not be opened.";
      els.accessKey.select();
      return;
    }
    els.accessKey.value = "";
    showDashboard();
    await loadDashboard();
  } catch {
    els.authError.textContent = "The dashboard could not connect. Please try again.";
  } finally {
    setButtonBusy(els.authSubmit, false);
  }
}

function toggleAccessKeyVisibility() {
  const isVisible = els.accessKey.type === "text";
  els.accessKey.type = isVisible ? "password" : "text";
  els.toggleAccessKey.setAttribute("aria-pressed", String(!isVisible));
  els.toggleAccessKey.setAttribute(
    "aria-label",
    isVisible ? "Show access key" : "Hide access key",
  );
  els.accessKey.focus();
}

function showDashboard() {
  els.authView.hidden = true;
  els.dashboardView.hidden = false;
  window.clearInterval(state.refreshTimer);
  state.refreshTimer = window.setInterval(() => {
    if (document.visibilityState === "visible") void loadDashboard();
  }, 60_000);
}

function showAuth() {
  els.dashboardView.hidden = true;
  els.authView.hidden = false;
  window.clearInterval(state.refreshTimer);
  state.refreshTimer = null;
  window.setTimeout(() => els.accessKey.focus(), 0);
}

async function loadDashboard(options = {}) {
  setButtonBusy(els.refreshButton, true);
  try {
    const response = await fetch("/api/dashboard", {
      headers: { Accept: "application/json" },
    });
    if (response.status === 401) {
      showAuth();
      els.authError.textContent = "Your dashboard session expired. Enter the access key again.";
      return;
    }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "Live signup data could not be loaded.");
    state.records = Array.isArray(payload.records)
      ? payload.records.filter(validRecord)
      : [];
    state.activity = Array.isArray(payload.activity) ? payload.activity : [];
    state.report = payload;
    state.generatedAt = payload.generatedAt || new Date().toISOString();
    renderDashboard();
    if (options.announce) showToast("Dashboard refreshed");
  } catch (error) {
    showToast(error instanceof Error ? error.message : "Dashboard refresh failed");
  } finally {
    setButtonBusy(els.refreshButton, false);
  }
}

function validRecord(record) {
  return (
    record &&
    typeof record.email === "string" &&
    typeof record.createdAt === "string" &&
    !Number.isNaN(new Date(record.createdAt).getTime())
  );
}

function renderDashboard() {
  const report = state.report || {};
  els.totalMetric.textContent = numberFormatter.format(Number(report.total) || 0);
  els.builderMetric.textContent = numberFormatter.format(Number(report.builderAccountsTotal) || 0);
  els.projectMetric.textContent = numberFormatter.format(Number(report.publicProjectsTotal) || 0);
  els.ownerMetric.textContent = numberFormatter.format(Number(report.projectOwnersTotal) || 0);
  els.todayMetric.textContent = numberFormatter.format(Number(report.todayTotal) || 0);
  els.activeMetric.textContent = numberFormatter.format(Number(report.activeTodayTotal) || 0);
  els.chartTotal.textContent = numberFormatter.format(Number(report.total) || 0);
  els.lastUpdated.textContent = `Updated ${relativeTimestamp(state.generatedAt)}`;
  const health = report.dataHealth || {};
  const missing = Number(health.builderAccountsMissingFromWaitlist) || 0;
  const unmatched = Number(health.unmatchedProjectOwners) || 0;
  els.dataHealth.textContent = missing || unmatched
    ? `Data check: ${numberFormatter.format(missing)} builder accounts are not yet stored in the waitlist and ${numberFormatter.format(unmatched)} project owners could not be matched. Email addresses stay inside this authenticated dashboard.`
    : "Data check passed: every builder account and project owner is matched. Email addresses stay inside this authenticated dashboard and are not sent to PostHog.";
  renderChart();
  renderTable();
}

function countSince(date) {
  const threshold = date.getTime();
  return state.records.reduce(
    (count, record) =>
      new Date(record.createdAt).getTime() >= threshold ? count + 1 : count,
    0,
  );
}

function renderChart() {
  const chart = els.growthChart;
  chart.replaceChildren();
  const data = chartSeries(state.records, state.chartRange);
  const width = Math.max(320, Math.round(els.chartWrap.clientWidth || 1200));
  const height = Math.max(220, Math.round(els.chartWrap.clientHeight || 320));
  const padding = {
    top: 18,
    right: 12,
    bottom: width < 600 ? 34 : 38,
    left: width < 600 ? 36 : 49,
  };
  chart.setAttribute("viewBox", `0 0 ${width} ${height}`);
  const innerWidth = width - padding.left - padding.right;
  const innerHeight = height - padding.top - padding.bottom;
  const maximum = Math.max(1, ...data.map((point) => point.value));
  const yMaximum = niceMaximum(maximum);
  const xAt = (index) =>
    padding.left + (data.length <= 1 ? 0 : (index / (data.length - 1)) * innerWidth);
  const yAt = (value) =>
    padding.top + innerHeight - (value / yMaximum) * innerHeight;

  const defs = svgElement("defs");
  const gradient = svgElement("linearGradient", {
    id: "areaGradient",
    x1: "0",
    x2: "0",
    y1: "0",
    y2: "1",
  });
  gradient.append(
    svgElement("stop", {
      offset: "0%",
      "stop-color": "#247cff",
      "stop-opacity": "0.48",
    }),
    svgElement("stop", {
      offset: "52%",
      "stop-color": "#1d64c8",
      "stop-opacity": "0.17",
    }),
    svgElement("stop", {
      offset: "100%",
      "stop-color": "#10243d",
      "stop-opacity": "0",
    }),
  );
  defs.append(gradient);
  chart.append(defs);

  for (let index = 0; index <= 4; index += 1) {
    const value = (yMaximum / 4) * index;
    const y = yAt(value);
    chart.append(
      svgElement("line", {
        class: "chart-grid",
        x1: padding.left,
        x2: width - padding.right,
        y1: y,
        y2: y,
      }),
    );
    const label = svgElement("text", {
      class: "chart-label",
      x: padding.left - 12,
      y: y + 4,
      "text-anchor": "end",
    });
    label.textContent = compactNumber(value);
    chart.append(label);
  }

  const xLabelIndexes = evenlySpacedIndexes(data.length, width < 600 ? 4 : 7);
  xLabelIndexes.forEach((index) => {
    const label = svgElement("text", {
      class: "chart-label",
      x: xAt(index),
      y: height - 10,
      "text-anchor":
        index === 0 ? "start" : index === data.length - 1 ? "end" : "middle",
    });
    label.textContent = chartDateFormatter.format(data[index].date);
    chart.append(label);
  });

  const dailyMaximum = Math.max(1, ...data.flatMap((point) => [
    point.newContacts,
    point.newBuilders,
    point.projects,
  ]));
  const stepWidth = innerWidth / Math.max(data.length - 1, 1);
  const groupWidth = Math.max(4.5, Math.min(28, stepWidth * 0.72));
  const barWidth = groupWidth / 3;
  data.forEach((point, index) => {
    const values = [
      ["contact", point.newContacts, "new contacts"],
      ["builder", point.newBuilders, "new builders"],
      ["project", point.projects, "projects"],
    ];
    values.forEach(([kind, rawValue, label], seriesIndex) => {
      const value = Number(rawValue) || 0;
      const barHeight = value ? Math.max(3, (innerHeight * 0.32 * value) / dailyMaximum) : 0;
      const bar = svgElement("rect", {
        class: `chart-bar chart-bar-${kind}`,
        x: xAt(index) - groupWidth / 2 + seriesIndex * barWidth,
        y: padding.top + innerHeight - barHeight,
        width: barWidth,
        height: barHeight,
        rx: Math.min(2, Math.max(0.5, barWidth * 0.15)),
      });
      const title = svgElement("title");
      title.textContent = `${chartDateFormatter.format(point.date)}: ${value} ${label}`;
      bar.append(title);
      chart.append(bar);
    });
  });

  const points = data.map((point, index) => [xAt(index), yAt(point.value)]);
  const linePath = smoothPath(points);
  const baseline = yAt(0);
  const areaPath = `${linePath} L ${points.at(-1)[0]} ${baseline} L ${points[0][0]} ${baseline} Z`;
  chart.append(
    svgElement("path", { class: "chart-area", d: areaPath }),
    svgElement("path", { class: "chart-line-glow", d: linePath }),
    svgElement("path", { class: "chart-line", d: linePath }),
  );

  const focusLine = svgElement("line", {
    class: "chart-focus-line",
    x1: points.at(-1)[0],
    x2: points.at(-1)[0],
    y1: padding.top,
    y2: baseline,
  });
  const focusDot = svgElement("circle", {
    class: "chart-focus-dot",
    cx: points.at(-1)[0],
    cy: points.at(-1)[1],
    r: 4,
  });
  focusLine.setAttribute("visibility", "hidden");
  focusDot.setAttribute("visibility", "hidden");
  chart.append(focusLine, focusDot);

  const hitArea = svgElement("rect", {
    class: "chart-hit-area",
    x: padding.left,
    y: padding.top,
    width: innerWidth,
    height: innerHeight,
  });
  hitArea.addEventListener("pointermove", (event) => {
    const rect = chart.getBoundingClientRect();
    const relativeX = Math.min(
      innerWidth,
      Math.max(0, ((event.clientX - rect.left) / rect.width) * width - padding.left),
    );
    const index = Math.round((relativeX / innerWidth) * (data.length - 1));
    const point = points[index];
    focusLine.setAttribute("visibility", "visible");
    focusDot.setAttribute("visibility", "visible");
    focusLine.setAttribute("x1", point[0]);
    focusLine.setAttribute("x2", point[0]);
    focusDot.setAttribute("cx", point[0]);
    focusDot.setAttribute("cy", point[1]);
    showChartTooltip(event, data[index]);
  });
  hitArea.addEventListener("pointerleave", () => {
    focusLine.setAttribute("visibility", "hidden");
    focusDot.setAttribute("visibility", "hidden");
    els.chartTooltip.hidden = true;
  });
  chart.append(hitArea);
}

function chartSeries(_records, range) {
  const activity = state.activity.map((point) => ({
    date: new Date(`${point.date}T00:00:00.000Z`),
    value: Number(point.totalContacts) || 0,
    newContacts: Number(point.newContacts) || 0,
    newBuilders: Number(point.newBuilders) || 0,
    projects: Number(point.projects) || 0,
  }));
  if (!activity.length) {
    return [{
      date: startOfLocalDay(new Date()),
      value: 0,
      newContacts: 0,
      newBuilders: 0,
      projects: 0,
    }];
  }
  return range === "all" ? activity : activity.slice(-range);
}

function renderTable() {
  const query = els.searchInput.value.trim().toLowerCase();
  const filtered = query
    ? state.records.filter((record) =>
        `${record.name || ""} ${record.email} ${record.latestProject || ""}`
          .toLowerCase()
          .includes(query),
      )
    : state.records;
  els.signupRows.replaceChildren();
  filtered.forEach((record) => {
    const row = document.createElement("tr");
    const person = document.createElement("td");
    const personWrap = document.createElement("div");
    const avatar = document.createElement("span");
    const name = document.createElement("span");
    const email = document.createElement("td");
    const source = document.createElement("td");
    const sourceBadge = document.createElement("span");
    const firstContact = document.createElement("td");
    const firstBuilder = document.createElement("td");
    const lastActivity = document.createElement("td");
    const projects = document.createElement("td");
    const latestProject = document.createElement("td");

    personWrap.className = "person-cell";
    avatar.className = "person-avatar";
    name.className = "person-name";
    sourceBadge.className = "source-badge";
    const displayName = record.name || emailName(record.email);
    avatar.textContent = initials(displayName);
    name.textContent = displayName;
    name.title = displayName;
    personWrap.append(avatar, name);
    person.append(personWrap);
    email.textContent = record.email;
    email.title = record.email;
    const sources = Array.isArray(record.sources) ? record.sources : [record.source];
    sourceBadge.textContent = sources.includes("google") && sources.includes("make-a-build")
      ? "Google + build interest"
      : sources.includes("google")
        ? "Google sign-in"
        : "Build interest";
    source.append(sourceBadge);
    firstContact.textContent = formatTimestamp(record.createdAt);
    firstBuilder.textContent = formatTimestamp(record.firstBuilderSeenAt);
    lastActivity.textContent = formatTimestamp(record.lastActivityAt);
    projects.textContent = numberFormatter.format(Number(record.buildCount) || 0);
    projects.className = "project-count";
    latestProject.className = "latest-project";
    latestProject.textContent = record.latestProject
      ? `${record.latestProject} · ${formatTimestamp(record.latestProjectAt)}`
      : "—";
    row.append(
      person,
      email,
      source,
      firstContact,
      firstBuilder,
      lastActivity,
      projects,
      latestProject,
    );
    els.signupRows.append(row);
  });
  els.emptyState.hidden = filtered.length > 0;
  els.signupRows.closest("table").hidden = filtered.length === 0;
  els.resultCount.textContent = `${numberFormatter.format(filtered.length)} ${
    filtered.length === 1 ? "contact" : "contacts"
  }`;
}

async function downloadCsv() {
  setButtonBusy(els.downloadButton, true);
  try {
    const response = await fetch("/api/dashboard/export", {
      headers: { Accept: "text/csv" },
    });
    if (response.status === 401) {
      showAuth();
      els.authError.textContent = "Your dashboard session expired. Enter the access key again.";
      return;
    }
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || "The CSV could not be downloaded.");
    }
    const blob = await response.blob();
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.href = url;
    link.download = `makeable-waitlist-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
    showToast(`Downloaded ${numberFormatter.format(state.records.length)} contacts`);
  } catch (error) {
    showToast(error instanceof Error ? error.message : "The CSV could not be downloaded.");
  } finally {
    setButtonBusy(els.downloadButton, false);
  }
}

async function signOut() {
  els.signOutButton.disabled = true;
  try {
    await fetch("/api/dashboard/session", { method: "DELETE" });
  } finally {
    state.records = [];
    state.activity = [];
    state.report = null;
    showAuth();
    els.authError.textContent = "";
    els.signOutButton.disabled = false;
  }
}

function setButtonBusy(button, busy) {
  button.disabled = busy;
  button.classList.toggle("is-spinning", busy);
  button.setAttribute("aria-busy", String(busy));
}

function showToast(message) {
  window.clearTimeout(state.toastTimer);
  els.toast.textContent = message;
  els.toast.hidden = false;
  state.toastTimer = window.setTimeout(() => {
    els.toast.hidden = true;
  }, 3_200);
}

function showChartTooltip(event, point) {
  const wrapRect = els.chartWrap.getBoundingClientRect();
  const left = Math.min(
    wrapRect.width - 70,
    Math.max(70, event.clientX - wrapRect.left),
  );
  const top = Math.max(60, event.clientY - wrapRect.top);
  els.chartTooltip.replaceChildren();
  const value = document.createElement("strong");
  const date = document.createElement("span");
  value.textContent = `${numberFormatter.format(point.value)} total`;
  date.textContent = `${chartDateFormatter.format(point.date)} · ${point.newContacts} contacts · ${point.newBuilders} builders · ${point.projects} projects`;
  els.chartTooltip.append(value, date);
  els.chartTooltip.style.left = `${left}px`;
  els.chartTooltip.style.top = `${top}px`;
  els.chartTooltip.hidden = false;
}

function svgElement(name, attributes = {}) {
  const element = document.createElementNS("http://www.w3.org/2000/svg", name);
  Object.entries(attributes).forEach(([key, value]) => {
    element.setAttribute(key, String(value));
  });
  return element;
}

function smoothPath(points) {
  if (points.length === 1) return `M ${points[0][0]} ${points[0][1]}`;
  return points.reduce((path, point, index) => {
    if (index === 0) return `M ${point[0]} ${point[1]}`;
    const previous = points[index - 1];
    const midpointX = (previous[0] + point[0]) / 2;
    return `${path} C ${midpointX} ${previous[1]}, ${midpointX} ${point[1]}, ${point[0]} ${point[1]}`;
  }, "");
}

function niceMaximum(value) {
  return Math.max(4, Math.ceil(value * 1.08));
}

function compactNumber(value) {
  if (value >= 1_000_000) return `${Math.round(value / 100_000) / 10}M`;
  if (value >= 1_000) return `${Math.round(value / 100) / 10}K`;
  return numberFormatter.format(Math.round(value));
}

function evenlySpacedIndexes(length, maximumLabels) {
  if (length <= 1) return [0];
  const count = Math.min(maximumLabels, length);
  return [...new Set(
    Array.from({ length: count }, (_, index) =>
      Math.round((index / (count - 1)) * (length - 1)),
    ),
  )];
}

function startOfLocalDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function localDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function emailName(email) {
  return email
    .split("@")[0]
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() || ""}${part.slice(1)}`)
    .join(" ") || "Subscriber";
}

function formatTimestamp(value) {
  if (!value) return "—";
  const timestamp = new Date(value);
  return Number.isNaN(timestamp.getTime()) ? "—" : dateTimeFormatter.format(timestamp);
}

function initials(value) {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  return parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || "")
    .join("") || "M";
}

function relativeTimestamp(value) {
  const date = new Date(value);
  const seconds = Math.round((date.getTime() - Date.now()) / 1_000);
  if (!Number.isFinite(seconds)) return "just now";
  if (Math.abs(seconds) < 60) return relativeTimeFormatter.format(seconds, "second");
  const minutes = Math.round(seconds / 60);
  if (Math.abs(minutes) < 60) return relativeTimeFormatter.format(minutes, "minute");
  return dateTimeFormatter.format(date);
}
