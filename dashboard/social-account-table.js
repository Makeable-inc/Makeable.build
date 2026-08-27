const numberFormatter = new Intl.NumberFormat("en-US");
const coverageLabels = {
  connected: "Connected",
  "platform-only": "Platform only",
  "public-snapshot": "Public snapshot",
  "attribution-only": "Attribution only",
  unavailable: "Unavailable",
};

export function renderSocialAccounts(view, { rows, count }) {
  rows.replaceChildren();
  view.accounts.forEach((account) => {
    const row = document.createElement("tr");
    row.append(
      cell(`#${account.rank}`, "rank-cell"),
      accountCell(account),
      cell(account.platform, "platform-name"),
      cell(numberFormatter.format(account.impressions)),
      cell(optionalPercent(account.engagementRate)),
      cell(formatOptionalNumber(account.clicks)),
      cell(formatOptionalNumber(account.websiteSessions)),
      cell(optionalPercent(account.websiteVisitRate)),
      cell(
        formatOptionalSigned(account.followersGained),
        account.followersGained > 0 ? "positive-value" : "",
      ),
      cell(numberFormatter.format(account.posts)),
    );
    rows.append(row);
  });
  const table = rows.closest("table");
  table.hidden = view.accounts.length === 0;
  table.querySelectorAll("th[data-rank-field]").forEach((header) => {
    header.setAttribute(
      "aria-sort",
      header.dataset.rankField === view.rankBy ? "descending" : "none",
    );
  });
  count.textContent = `${numberFormatter.format(view.accounts.length)} accounts`;
}

export function formatOptionalNumber(value) {
  return Number.isFinite(value) ? numberFormatter.format(value) : "—";
}

function accountCell(account) {
  const element = document.createElement("td");
  const wrapper = document.createElement("div");
  const name = document.createElement("span");
  const coverage = document.createElement("span");
  wrapper.className = "account-cell";
  name.className = "account-name";
  name.textContent = account.account;
  coverage.className = `coverage-badge is-${account.coverage}`;
  coverage.textContent = coverageLabels[account.coverage] || "Unavailable";
  wrapper.append(name, coverage);
  element.append(wrapper);
  return element;
}

function cell(value, className = "") {
  const element = document.createElement("td");
  element.textContent = value;
  if (className) element.className = className;
  return element;
}

function optionalPercent(value) {
  return Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : "—";
}

function formatOptionalSigned(value) {
  if (!Number.isFinite(value)) return "—";
  return `${value > 0 ? "+" : ""}${numberFormatter.format(value)}`;
}
