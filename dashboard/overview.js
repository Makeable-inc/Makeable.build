const numberFormatter = new Intl.NumberFormat();
const compactFormatter = new Intl.NumberFormat(undefined, {
  notation: "compact",
  maximumFractionDigits: 1,
});

export function createOverview({ state, els }) {
  return {
    render() {
      const report = state.report || {};
      const social = state.socialView || {
        totalExposures: 0,
        totalEngagements: 0,
        engagementRate: null,
        attributionStatus: "not_connected",
        websiteSessions: null,
        websiteVisitRate: null,
        followersGained: 0,
      };
      els.overviewExposures.textContent = compactFormatter.format(social.totalExposures || 0);
      els.overviewEngagements.textContent = compactFormatter.format(social.totalEngagements || 0);
      els.overviewEngagementRate.textContent = optionalPercent(social.engagementRate);
      els.overviewFollowers.textContent = optionalSigned(social.followersGained);
      els.overviewContacts.textContent = numberFormatter.format(Number(report.total) || 0);
      els.overviewBuilders.textContent = numberFormatter.format(Number(report.builderAccountsTotal) || 0);
      els.overviewSocialRows.replaceChildren();
      appendPulseRow(
        els.overviewSocialRows,
        "Content exposures",
        compactFormatter.format(social.totalExposures || 0),
      );
      appendPulseRow(
        els.overviewSocialRows,
        "Engagement rate",
        optionalPercent(social.engagementRate),
      );
      if (social.attributionStatus === "connected") {
        appendPulseRow(
          els.overviewSocialRows,
          "Website conversions",
          numberFormatter.format(social.websiteSessions),
        );
        appendPulseRow(
          els.overviewSocialRows,
          "Website visit rate",
          optionalPercent(social.websiteVisitRate),
        );
      } else {
        appendPulseRow(
          els.overviewSocialRows,
          "Website attribution",
          social.attributionStatus === "unavailable" ? "Unavailable" : "Not connected",
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
