import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const browserTest = process.env.MAKEABLE_BROWSER_E2E === "1" ? test : test.skip;
const require = createRequire(import.meta.url);

browserTest("dashboard switches sections and plays a social clip without leaving the page", async (t) => {
  // Given: an authenticated dashboard with one playable social post.
  const server = await startDashboardServer();
  let browser;
  t.after(async () => {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  });
  const playwright = require("playwright");
  const browserType = process.env.MAKEABLE_BROWSER_ENGINE === "webkit"
    ? playwright.webkit
    : playwright.chromium;
  const channel = process.env.MAKEABLE_BROWSER_CHANNEL;
  browser = await browserType.launch({ headless: true, ...(channel ? { channel } : {}) });
  const page = await browser.newPage({
    locale: "en-US",
    viewport: { width: 1280, height: 900 },
  });
  let attributionStatus = "not_connected";
  page.setDefaultTimeout(3_000);
  await page.route("**/api/dashboard/session", async (route) => {
    await route.fulfill({ json: { authenticated: true } });
  });
  await page.route("**/api/dashboard", async (route) => {
    await route.fulfill({ json: waitlistReport() });
  });
  await page.route("**/api/dashboard/social", async (route) => {
    await route.fulfill({ json: socialReport(attributionStatus) });
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/dashboard`);

  // When: the owner chooses Social from the persistent section dropdown.
  const selector = page.getByLabel("Dashboard section");
  await selector.selectOption("social");

  // Then: social metrics and the playable content card replace the overview.
  await page.getByRole("heading", { name: "Social performance" }).waitFor();
  assert.equal(await page.locator("[data-dashboard-section='social']").isVisible(), true);
  assert.equal(await page.getByText("@makeable.build", { exact: true }).first().isVisible(), true);
  assert.equal(await page.getByText("7.3K", { exact: true }).isVisible(), true);
  assert.equal(await page.getByText("Public snapshot", { exact: true }).isVisible(), true);
  assert.equal(await page.getByText("Platform only", { exact: true }).isVisible(), true);
  assert.equal(await page.getByText("Not connected", { exact: true }).first().isVisible(), true);

  // When: the account ranking changes to the measured website conversion field.
  await page.getByLabel("Rank accounts by").selectOption("websiteSessions");

  // Then: the corresponding semantic column reports the active sort.
  assert.equal(
    await page.getByRole("columnheader", { name: "Website conversions" }).getAttribute("aria-sort"),
    "descending",
  );
  const tableRegion = page.getByRole("region", { name: "Account ranking" });
  await tableRegion.focus();
  assert.notEqual(await tableRegion.evaluate((element) => getComputedStyle(element).outlineStyle), "none");

  const artifactDir = process.env.MAKEABLE_BROWSER_ARTIFACT_DIR;
  if (artifactDir) {
    await mkdir(artifactDir, { recursive: true });
    await page.screenshot({ path: path.join(artifactDir, "social-desktop.png"), fullPage: true });
  }

  // When: the owner plays the ranked clip.
  const urlBeforePlay = page.url();
  await page.getByRole("button", { name: "Play Building Ember on a real desk" }).click();

  // Then: a native video viewer opens inside the dashboard without navigation.
  const dialog = page.getByRole("dialog", { name: "Building Ember on a real desk" });
  await dialog.waitFor();
  assert.equal(await dialog.locator("video[controls]").isVisible(), true);
  assert.equal(page.url(), urlBeforePlay);
  assert.match(page.url(), /\/dashboard$/);

  // When: the viewer closes and the layout is reflowed to a narrow phone viewport.
  await dialog.getByRole("button", { name: "Close preview" }).click();
  await page.setViewportSize({ width: 375, height: 812 });

  // Then: only the table region owns horizontal overflow.
  const overflow = await page.evaluate(() => {
    const region = document.querySelector(".social-table")?.closest(".table-scroll");
    return {
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: document.documentElement.clientWidth,
      tableClientWidth: region?.clientWidth || 0,
      tableScrollWidth: region?.scrollWidth || 0,
    };
  });
  assert.equal(overflow.documentWidth, overflow.viewportWidth);
  assert.ok(overflow.tableScrollWidth > overflow.tableClientWidth);
  if (artifactDir) {
    await page.screenshot({ path: path.join(artifactDir, "social-mobile-375.png"), fullPage: true });
  }

  // When: attribution fails, then reconnects with a measured zero.
  attributionStatus = "unavailable";
  await page.getByRole("button", { name: "Refresh" }).click();
  assert.equal(await page.locator("#socialWebsiteSessions").textContent(), "Unavailable");
  assert.equal(await page.locator("#socialWebsiteVisitRate").textContent(), "Unavailable");
  attributionStatus = "connected";
  await page.getByRole("button", { name: "Refresh" }).click();
  assert.equal(await page.locator("#socialWebsiteSessions").textContent(), "0");
  assert.equal(await page.locator("#socialWebsiteVisitRate").textContent(), "0.0%");

  // When: the owner chooses Waitlist.
  await selector.selectOption("waitlist");

  // Then: the existing customer activity surface remains available.
  assert.equal(await page.getByRole("heading", { name: "Customer activity" }).isVisible(), true);
  assert.equal(await page.locator("[data-dashboard-section='waitlist']").isVisible(), true);
});

async function startDashboardServer() {
  const server = createServer(async (request, response) => {
    const url = new URL(request.url || "/", "http://127.0.0.1");
    const requestedPath = url.pathname === "/dashboard"
      ? "/dashboard/index.html"
      : url.pathname;
    const filePath = path.resolve(root, `.${requestedPath}`);
    if (!filePath.startsWith(root)) {
      response.writeHead(404).end();
      return;
    }
    try {
      const body = await readFile(filePath);
      const extension = path.extname(filePath);
      const contentType = extension === ".html"
        ? "text/html; charset=utf-8"
        : extension === ".css"
          ? "text/css; charset=utf-8"
          : "text/javascript; charset=utf-8";
      response.writeHead(200, { "Content-Type": contentType });
      response.end(body);
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return server;
}

function waitlistReport() {
  return {
    generatedAt: "2026-08-26T18:00:00.000Z",
    total: 80,
    builderAccountsTotal: 18,
    publicProjectsTotal: 9,
    projectOwnersTotal: 7,
    todayTotal: 3,
    activeTodayTotal: 6,
    dataHealth: {
      builderAccountsMissingFromWaitlist: 0,
      unmatchedProjectOwners: 0,
    },
    activity: [{
      date: "2026-08-26",
      newContacts: 3,
      newBuilders: 2,
      projects: 1,
      totalContacts: 80,
      totalBuilders: 18,
      totalProjects: 9,
    }],
    records: [{
      email: "builder@example.com",
      name: "Avery Chen",
      source: "google",
      sources: ["google"],
      createdAt: "2026-08-26T17:00:00.000Z",
      firstBuilderSeenAt: "2026-08-26T17:10:00.000Z",
      lastActivityAt: "2026-08-26T17:20:00.000Z",
      buildCount: 1,
      latestProject: "Desk Ember",
      latestProjectAt: "2026-08-26T17:20:00.000Z",
      builderAccount: true,
    }],
  };
}

function socialReport(attributionStatus) {
  const record = {
    id: "instagram:@makeable.build:reel-1",
    platform: "instagram",
    account: "@makeable.build",
    publishedAt: "2026-08-25T00:00:00.000Z",
    contentId: "reel-1",
    contentType: "reel",
    caption: "Building Ember on a real desk",
    impressions: 6000,
    engagements: 600,
    followers: 842,
    followersGained: 14,
    clicks: 36,
    thumbnailUrl: "/assets/ember/lv3-supercharged.gif",
    previewUrl: "https://media.example.com/ember-preview.mp4",
    postUrl: "https://instagram.com/p/reel-1",
    coverage: "platform-only",
    attributionKey: "makeable_build",
    engagementsComplete: true,
  };
  const publicSnapshot = {
    ...record,
    id: "instagram:@makeable.zak:reel-2",
    account: "@makeable.zak",
    contentId: "reel-2",
    caption: "Public snapshot post",
    impressions: 1300,
    engagements: 15,
    followersGained: null,
    clicks: null,
    previewUrl: "",
    postUrl: "https://instagram.com/p/reel-2",
    coverage: "public-snapshot",
    attributionKey: "makeable_zak",
    engagementsComplete: false,
  };
  return {
    generatedAt: "2026-08-26T18:00:00.000Z",
    totalImpressions: 7300,
    totalExposures: 7300,
    totalEngagements: 615,
    engagementRate: 0.1,
    followersGained: 14,
    totalClicks: 36,
    postsTotal: 2,
    attribution: { status: attributionStatus, daily: [] },
    accounts: [],
    daily: [],
    content: [record, publicSnapshot],
    records: [record, publicSnapshot],
  };
}
