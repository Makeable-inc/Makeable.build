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

export function createWaitlistView({ state, els }) {
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

  function renderChart() {
    const chart = els.growthChart;
    chart.replaceChildren();
    const data = chartSeries(state.activity, state.chartRange);
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
    const yMaximum = Math.max(4, Math.ceil(maximum * 1.08));
    const xAt = (index) =>
      padding.left + (data.length <= 1 ? 0 : (index / (data.length - 1)) * innerWidth);
    const yAt = (value) => padding.top + innerHeight - (value / yMaximum) * innerHeight;
    appendGradient(chart);
    appendGrid(chart, { innerWidth, padding, width, yAt, yMaximum });
    appendDateLabels(chart, { data, height, width, xAt });
    appendActivityBars(chart, { data, innerHeight, innerWidth, padding, xAt });

    const points = data.map((point, index) => [xAt(index), yAt(point.value)]);
    const linePath = smoothPath(points);
    const baseline = yAt(0);
    const areaPath = `${linePath} L ${points.at(-1)[0]} ${baseline} L ${points[0][0]} ${baseline} Z`;
    chart.append(
      svgElement("path", { class: "chart-area", d: areaPath }),
      svgElement("path", { class: "chart-line-glow", d: linePath }),
      svgElement("path", { class: "chart-line", d: linePath }),
    );
    appendChartInteraction(chart, { baseline, data, innerHeight, innerWidth, padding, points, width });
  }

  function renderTable() {
    const query = els.searchInput.value.trim().toLowerCase();
    const filtered = query
      ? state.records.filter((record) =>
          `${record.name || ""} ${record.email} ${record.latestProject || ""}`
            .toLowerCase()
            .includes(query))
      : state.records;
    els.signupRows.replaceChildren();
    filtered.forEach((record) => els.signupRows.append(contactRow(record)));
    els.emptyState.hidden = filtered.length > 0;
    els.signupRows.closest("table").hidden = filtered.length === 0;
    els.resultCount.textContent = `${numberFormatter.format(filtered.length)} ${
      filtered.length === 1 ? "contact" : "contacts"
    }`;
  }

  function appendChartInteraction(chart, options) {
    const { baseline, data, innerHeight, innerWidth, padding, points, width } = options;
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

  function showChartTooltip(event, point) {
    const wrapRect = els.chartWrap.getBoundingClientRect();
    const left = Math.min(wrapRect.width - 70, Math.max(70, event.clientX - wrapRect.left));
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

  return { renderChart, renderDashboard, renderTable };
}

function chartSeries(activity, range) {
  const points = activity.map((point) => ({
    date: new Date(`${point.date}T00:00:00.000Z`),
    value: Number(point.totalContacts) || 0,
    newContacts: Number(point.newContacts) || 0,
    newBuilders: Number(point.newBuilders) || 0,
    projects: Number(point.projects) || 0,
  }));
  if (!points.length) {
    return [{
      date: new Date(new Date().setHours(0, 0, 0, 0)),
      value: 0,
      newContacts: 0,
      newBuilders: 0,
      projects: 0,
    }];
  }
  return range === "all" ? points : points.slice(-range);
}

function appendGradient(chart) {
  const defs = svgElement("defs");
  const gradient = svgElement("linearGradient", {
    id: "areaGradient", x1: "0", x2: "0", y1: "0", y2: "1",
  });
  gradient.append(
    svgElement("stop", { offset: "0%", "stop-color": "var(--accent)", "stop-opacity": "0.48" }),
    svgElement("stop", { offset: "52%", "stop-color": "var(--accent-deep)", "stop-opacity": "0.17" }),
    svgElement("stop", { offset: "100%", "stop-color": "var(--surface)", "stop-opacity": "0" }),
  );
  defs.append(gradient);
  chart.append(defs);
}

function appendGrid(chart, options) {
  const { padding, width, yAt, yMaximum } = options;
  for (let index = 0; index <= 4; index += 1) {
    const value = (yMaximum / 4) * index;
    const y = yAt(value);
    chart.append(svgElement("line", {
      class: "chart-grid", x1: padding.left, x2: width - padding.right, y1: y, y2: y,
    }));
    const label = svgElement("text", {
      class: "chart-label", x: padding.left - 12, y: y + 4, "text-anchor": "end",
    });
    label.textContent = compactNumber(value);
    chart.append(label);
  }
}

function appendDateLabels(chart, { data, height, width, xAt }) {
  evenlySpacedIndexes(data.length, width < 600 ? 4 : 7).forEach((index) => {
    const label = svgElement("text", {
      class: "chart-label",
      x: xAt(index),
      y: height - 10,
      "text-anchor": index === 0 ? "start" : index === data.length - 1 ? "end" : "middle",
    });
    label.textContent = chartDateFormatter.format(data[index].date);
    chart.append(label);
  });
}

function appendActivityBars(chart, { data, innerHeight, innerWidth, padding, xAt }) {
  const dailyMaximum = Math.max(1, ...data.flatMap((point) => [
    point.newContacts, point.newBuilders, point.projects,
  ]));
  const stepWidth = innerWidth / Math.max(data.length - 1, 1);
  const groupWidth = Math.max(4.5, Math.min(28, stepWidth * 0.72));
  const barWidth = groupWidth / 3;
  data.forEach((point, index) => {
    [
      ["contact", point.newContacts, "new contacts"],
      ["builder", point.newBuilders, "new builders"],
      ["project", point.projects, "projects"],
    ].forEach(([kind, rawValue, label], seriesIndex) => {
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
}

function contactRow(record) {
  const row = document.createElement("tr");
  const person = document.createElement("td");
  const personWrap = document.createElement("div");
  const avatar = document.createElement("span");
  const name = document.createElement("span");
  personWrap.className = "person-cell";
  avatar.className = "person-avatar";
  name.className = "person-name";
  const displayName = record.name || emailName(record.email);
  avatar.textContent = initials(displayName);
  name.textContent = displayName;
  name.title = displayName;
  personWrap.append(avatar, name);
  person.append(personWrap);

  const email = textCell(record.email);
  email.title = record.email;
  const source = document.createElement("td");
  const sourceBadge = document.createElement("span");
  sourceBadge.className = "source-badge";
  const sources = Array.isArray(record.sources) ? record.sources : [record.source];
  sourceBadge.textContent = sources.includes("google") && sources.includes("make-a-build")
    ? "Google + build interest"
    : sources.includes("google") ? "Google sign-in" : "Build interest";
  source.append(sourceBadge);
  const projects = textCell(numberFormatter.format(Number(record.buildCount) || 0));
  projects.className = "project-count";
  const latestProject = textCell(record.latestProject
    ? `${record.latestProject} · ${formatTimestamp(record.latestProjectAt)}`
    : "Not available");
  latestProject.className = "latest-project";
  row.append(
    person,
    email,
    source,
    textCell(formatTimestamp(record.createdAt)),
    textCell(formatTimestamp(record.firstBuilderSeenAt)),
    textCell(formatTimestamp(record.lastActivityAt)),
    projects,
    latestProject,
  );
  return row;
}

function textCell(value) {
  const cell = document.createElement("td");
  cell.textContent = value;
  return cell;
}

function svgElement(name, attributes = {}) {
  const element = document.createElementNS("http://www.w3.org/2000/svg", name);
  Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, String(value)));
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

function compactNumber(value) {
  if (value >= 1_000_000) return `${Math.round(value / 100_000) / 10}M`;
  if (value >= 1_000) return `${Math.round(value / 100) / 10}K`;
  return numberFormatter.format(Math.round(value));
}

function evenlySpacedIndexes(length, maximumLabels) {
  if (length <= 1) return [0];
  const count = Math.min(maximumLabels, length);
  return [...new Set(Array.from({ length: count }, (_, index) =>
    Math.round((index / (count - 1)) * (length - 1))))];
}

function emailName(email) {
  return email.split("@")[0].split(/[._-]+/).filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() || ""}${part.slice(1)}`).join(" ") || "Subscriber";
}

function formatTimestamp(value) {
  if (!value) return "Not available";
  const timestamp = new Date(value);
  return Number.isNaN(timestamp.getTime()) ? "Not available" : dateTimeFormatter.format(timestamp);
}

function initials(value) {
  return value.trim().split(/\s+/).filter(Boolean).slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || "").join("") || "M";
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
