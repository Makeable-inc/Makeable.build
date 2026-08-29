const numberFormatter = new Intl.NumberFormat();
const compactFormatter = new Intl.NumberFormat(undefined, {
  notation: "compact",
  maximumFractionDigits: 1,
});

export function createOverview({ state, els }) {
  return {
    render() {
      const report = state.report || {};
      const social = state.socialView;
      const display = photoDemo() ? photoDemoSocial() : social;
      if (els.overviewDemoNote) {
        els.overviewDemoNote.hidden = !photoDemo();
        els.overviewDemoNote.className = "import-status is-warning";
      }
      els.overviewExposures.textContent = display ? compactFormatter.format(display.totalExposures) : "—";
      els.overviewEngagements.textContent = display ? compactFormatter.format(display.totalEngagements) : "—";
      els.overviewEngagementRate.textContent = display ? optionalPercent(display.engagementRate) : "—";
      els.overviewFollowers.textContent = display ? optionalSigned(display.followersGained) : "—";
      els.overviewContacts.textContent = numberFormatter.format(Number(report.total) || 0);
      els.overviewBuilders.textContent = numberFormatter.format(Number(report.builderAccountsTotal) || 0);
      els.overviewSocialRows.replaceChildren();
      appendPulseRow(
        els.overviewSocialRows,
        "Content exposures",
        display ? compactFormatter.format(display.totalExposures) : "Loading…",
      );
      appendPulseRow(
        els.overviewSocialRows,
        "Engagement rate",
        display ? optionalPercent(display.engagementRate) : "—",
      );
      if (display?.attributionStatus === "connected") {
        appendPulseRow(
          els.overviewSocialRows,
          "Website conversions",
          numberFormatter.format(display.websiteSessions),
        );
        appendPulseRow(
          els.overviewSocialRows,
          "Website visit rate",
          optionalPercent(display.websiteVisitRate),
        );
      } else {
        appendPulseRow(
          els.overviewSocialRows,
          "Website attribution",
          display ? (display.attributionStatus === "unavailable" ? "Unavailable" : "Not connected") : "Loading…",
        );
      }
      els.overviewWaitlistRows.replaceChildren();
      appendPulseRow(
        els.overviewWaitlistRows,
        "New contacts today",
        numberFormatter.format(Number(report.todayTotal) || 0),
      );
      appendPulseRow(
        els.overviewWaitlistRows,
        "Active today",
        numberFormatter.format(Number(report.activeTodayTotal) || 0),
      );
      appendPulseRow(
        els.overviewWaitlistRows,
        "Published projects",
        numberFormatter.format(Number(report.publicProjectsTotal) || 0),
      );
    },
  };
}

function photoDemo() {
  return typeof window !== "undefined" && new URLSearchParams(window.location.search).get("demo") === "photo";
}

function photoDemoSocial() {
  return { totalExposures: 36_700, totalEngagements: 1_321, engagementRate: 0.036, followersGained: 82,
    attributionStatus: "connected", websiteSessions: 125, websiteVisitRate: 0.0034 };
}

function appendPulseRow(container, label, value) {
  const row = document.createElement("div");
  const name = document.createElement("strong");
  const metric = document.createElement("span");
  row.className = "pulse-row";
  name.textContent = label;
  metric.textContent = value;
  row.append(name, metric);
  container.append(row);
}

function optionalPercent(value) {
  return Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : "—";
}

function optionalSigned(value) {
  if (!Number.isFinite(value)) return "—";
  return `${value > 0 ? "+" : ""}${numberFormatter.format(value)}`;
}
