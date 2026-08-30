import { createOverview } from "./overview.js";
import { createSocialDashboard } from "./social.js";
import { createWaitlistView } from "./waitlist.js";

const state = {
  records: [],
  activity: [],
  report: null,
  chartRange: 30,
  generatedAt: "",
  refreshTimer: null,
  toastTimer: null,
  currentSection: "overview",
  socialView: null,
};

const els = {
  authView: document.querySelector("#authView"),
  authForm: document.querySelector("#authForm"),
  accessKey: document.querySelector("#accessKey"),
  authError: document.querySelector("#authError"),
  authSubmit: document.querySelector("#authSubmit"),
  toggleAccessKey: document.querySelector("#toggleAccessKey"),
  dashboardView: document.querySelector("#dashboardView"),
  dashboardSection: document.querySelector("#dashboardSection"),
  dashboardSections: [...document.querySelectorAll("[data-dashboard-section]")],
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
  overviewExposures: document.querySelector("#overviewExposures"),
  overviewEngagements: document.querySelector("#overviewEngagements"),
  overviewEngagementRate: document.querySelector("#overviewEngagementRate"),
  overviewFollowers: document.querySelector("#overviewFollowers"),
  overviewContacts: document.querySelector("#overviewContacts"),
  overviewBuilders: document.querySelector("#overviewBuilders"),
  overviewDemoNote: document.querySelector("#overviewDemoNote"),
  overviewSocialRows: document.querySelector("#overviewSocialRows"),
  overviewWaitlistRows: document.querySelector("#overviewWaitlistRows"),
  toast: document.querySelector("#toast"),
};

const numberFormatter = new Intl.NumberFormat();
const overview = createOverview({ state, els });
const waitlist = createWaitlistView({ state, els });
const socialDashboard = createSocialDashboard({
  onReport(view) {
    state.socialView = view;
    overview.render();
  },
  onUnauthorized() {
    showAuth();
    els.authError.textContent = "Your dashboard session expired. Enter the access key again.";
  },
  showToast,
});

els.authForm.addEventListener("submit", authenticate);
els.toggleAccessKey.addEventListener("click", toggleAccessKeyVisibility);
els.refreshButton.addEventListener("click", () => refreshActiveSection({ announce: true }));
els.downloadButton.addEventListener("click", downloadCsv);
els.signOutButton.addEventListener("click", signOut);
els.dashboardSection.addEventListener("change", () => {
  setDashboardSection(els.dashboardSection.value);
});
document.querySelectorAll("[data-open-section]").forEach((button) => {
  button.addEventListener("click", () => setDashboardSection(button.dataset.openSection));
});
els.searchInput.addEventListener("input", waitlist.renderTable);
els.rangeButtons.forEach((button) => {
  button.addEventListener("click", () => {
    state.chartRange = button.dataset.range === "all" ? "all" : Number(button.dataset.range);
    els.rangeButtons.forEach((item) => {
      item.classList.toggle("is-selected", item === button);
      item.setAttribute("aria-pressed", String(item === button));
    });
    waitlist.renderChart();
  });
});
window.addEventListener("resize", waitlist.renderChart);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && !els.dashboardView.hidden) {
    void refreshActiveSection();
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
      await refreshActiveSection();
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
      headers: { Accept: "application/json", "Content-Type": "application/json" },
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
    await refreshActiveSection();
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
  els.toggleAccessKey.setAttribute("aria-label", isVisible ? "Show access key" : "Hide access key");
  els.accessKey.focus();
}

function showDashboard() {
  els.authView.hidden = true;
  els.dashboardView.hidden = false;
  setDashboardSection("overview");
  overview.render();
  window.clearInterval(state.refreshTimer);
  state.refreshTimer = window.setInterval(() => {
    if (document.visibilityState === "visible") void refreshActiveSection();
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
  if (options.manageButton !== false) setButtonBusy(els.refreshButton, true);
  try {
    const response = await fetch("/api/dashboard", { headers: { Accept: "application/json" } });
    if (response.status === 401) {
      showAuth();
      els.authError.textContent = "Your dashboard session expired. Enter the access key again.";
      return;
    }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "Live signup data could not be loaded.");
    state.records = Array.isArray(payload.records) ? payload.records.filter(validRecord) : [];
    state.activity = Array.isArray(payload.activity) ? payload.activity : [];
    state.report = payload;
    state.generatedAt = payload.generatedAt || new Date().toISOString();
    waitlist.renderDashboard();
    overview.render();
  } catch (error) {
    showToast(error instanceof Error ? error.message : "Dashboard refresh failed");
  } finally {
    if (options.manageButton !== false) setButtonBusy(els.refreshButton, false);
  }
}

async function refreshActiveSection(options = {}) {
  setButtonBusy(els.refreshButton, true);
  try {
    if (state.currentSection === "social") {
      await socialDashboard.load();
    } else if (state.currentSection === "waitlist") {
      await loadDashboard({ manageButton: false });
    } else {
      await Promise.all([loadDashboard({ manageButton: false }), socialDashboard.load()]);
    }
    if (options.announce) showToast("Dashboard refreshed");
  } finally {
    setButtonBusy(els.refreshButton, false);
  }
}

function setDashboardSection(section) {
  const next = new Set(["overview", "social", "waitlist"]).has(section)
    ? section
    : "overview";
  state.currentSection = next;
  els.dashboardSection.value = next;
  els.dashboardSections.forEach((element) => {
    element.hidden = element.dataset.dashboardSection !== next;
  });
  els.downloadButton.hidden = next !== "waitlist";
  document.title = `${next === "social" ? "Social" : next === "waitlist" ? "Waitlist" : "Growth"} dashboard · Makeable`;
  if (next === "social") socialDashboard.show();
  if (next === "waitlist") window.requestAnimationFrame(waitlist.renderChart);
}

function validRecord(record) {
  return record && typeof record.email === "string" && typeof record.createdAt === "string"
    && !Number.isNaN(new Date(record.createdAt).getTime());
}

async function downloadCsv() {
  setButtonBusy(els.downloadButton, true);
  try {
    const response = await fetch("/api/dashboard/export", { headers: { Accept: "text/csv" } });
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
    socialDashboard.clear();
    state.socialView = null;
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
