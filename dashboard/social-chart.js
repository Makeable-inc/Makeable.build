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

export function measuredEngagementRuns(data) {
  const runs = [];
  let current = [];
  data.forEach((point, index) => {
    if (Number.isFinite(point.engagementRate)) {
      current.push({ index, point });
      return;
    }
    if (current.length) runs.push(current);
    current = [];
  });
  if (current.length) runs.push(current);
  return runs;
}

export function renderSocialChart({ chart, chartWrap, data }) {
  chart.replaceChildren();
  const width = Math.max(320, Math.round(chartWrap.clientWidth || 1200));
  const height = Math.max(220, Math.round(chartWrap.clientHeight || 286));
  const padding = {
    top: 34,
    right: width < 600 ? 40 : 48,
    bottom: 34,
    left: width < 600 ? 38 : 50,
  };
  const innerWidth = width - padding.left - padding.right;
  const innerHeight = height - padding.top - padding.bottom;
  const impressionsMax = niceMaximum(Math.max(1, ...data.map((point) => point.impressions)));
  const rates = data.map((point) => point.engagementRate).filter(Number.isFinite);
  const rateMax = Math.max(0.1, ...rates);
  const xStep = innerWidth / Math.max(data.length, 1);

  chart.setAttribute("viewBox", `0 0 ${width} ${height}`);
  appendDescription(chart, data.length);
  appendAxisNames(chart, padding, width);
  appendGrid(chart, { impressionsMax, innerHeight, padding, rateMax, width });
  appendBars(chart, { data, impressionsMax, innerHeight, padding, xStep });
  appendEngagement(chart, { data, innerHeight, padding, rateMax, xStep });
  labelDates(chart, data, padding, innerWidth, height, width < 600 ? 4 : 7);
}

function appendDescription(chart, pointCount) {
  const description = svg("desc", { id: "socialChartDescription" });
  description.textContent = `${pointCount} daily points. The left axis shows content exposures as blue bars. The right axis shows measured engagement rate as separate green line segments when data is available.`;
  chart.append(description);
}

function appendAxisNames(chart, padding, width) {
  const left = svg("text", {
    class: "social-chart-axis-name",
    "data-axis": "left",
    x: padding.left,
    y: 14,
    "text-anchor": "start",
  });
  left.textContent = "Content exposures";
  const right = svg("text", {
    class: "social-chart-axis-name social-chart-rate-label",
    "data-axis": "right",
    x: width - padding.right,
    y: 14,
    "text-anchor": "end",
  });
  right.textContent = "Engagement rate";
  chart.append(left, right);
}

function appendGrid(chart, options) {
  const { impressionsMax, innerHeight, padding, rateMax, width } = options;
  for (let index = 0; index <= 4; index += 1) {
    const y = padding.top + innerHeight - (innerHeight * index) / 4;
    chart.append(svg("line", {
      class: "social-chart-grid",
      x1: padding.left,
      x2: width - padding.right,
      y1: y,
      y2: y,
    }));
    const exposureLabel = svg("text", {
      class: "social-chart-label",
      x: padding.left - 10,
      y: y + 4,
      "text-anchor": "end",
    });
    exposureLabel.textContent = compactFormatter.format((impressionsMax * index) / 4);
    const rateLabel = svg("text", {
      class: "social-chart-label social-chart-rate-label",
      x: width - padding.right + 9,
      y: y + 4,
      "text-anchor": "start",
    });
    rateLabel.textContent = optionalPercent((rateMax * index) / 4);
    chart.append(exposureLabel, rateLabel);
  }
}

function appendBars(chart, options) {
  const { data, impressionsMax, innerHeight, padding, xStep } = options;
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
    title.textContent = `${formatDate(point.date)}: ${numberFormatter.format(point.impressions)} content exposures`;
    bar.append(title);
    chart.append(bar);
  });
}

function appendEngagement(chart, options) {
  const { data, innerHeight, padding, rateMax, xStep } = options;
  measuredEngagementRuns(data).forEach((run) => {
    const positions = run.map(({ index, point }) => [
      padding.left + index * xStep + xStep / 2,
      padding.top + innerHeight - (point.engagementRate / rateMax) * innerHeight,
    ]);
    chart.append(svg("path", {
      class: "social-chart-line",
      d: linePath(positions),
    }));
    run.forEach(({ point }, runIndex) => {
      const position = positions[runIndex];
      const dot = svg("circle", {
        class: "social-chart-dot",
        cx: position[0],
        cy: position[1],
        r: data.length < 16 ? 3 : 2,
      });
      const title = svg("title");
      title.textContent = `${formatDate(point.date)}: ${optionalPercent(point.engagementRate)} engagement rate`;
      dot.append(title);
      chart.append(dot);
    });
  });
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
    label.textContent = formatDate(data[index].date);
    chart.append(label);
  });
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

function optionalPercent(value) {
  return Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : "—";
}

function formatDate(value) {
  return dateFormatter.format(new Date(`${value}T00:00:00Z`));
}
