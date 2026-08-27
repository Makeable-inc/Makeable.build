import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const dashboardHtmlPath = new URL("../dashboard/index.html", import.meta.url);
const dashboardScriptPath = new URL("../dashboard/app.js", import.meta.url);
const waitlistScriptPath = new URL("../dashboard/waitlist.js", import.meta.url);
const socialScriptPath = new URL("../dashboard/social.js", import.meta.url);
const socialChartScriptPath = new URL("../dashboard/social-chart.js", import.meta.url);
const accountTableScriptPath = new URL("../dashboard/social-account-table.js", import.meta.url);
const socialModelScriptPath = new URL("../dashboard/social-model.js", import.meta.url);

test("dashboard keeps private auth and separates contacts, builders, and projects", async () => {
  const [html, script, socialScript, waitlistScript] = await Promise.all([
    readFile(dashboardHtmlPath, "utf8"),
    readFile(dashboardScriptPath, "utf8"),
    readFile(socialScriptPath, "utf8"),
    readFile(waitlistScriptPath, "utf8"),
  ]);

  assert.match(html, /Contacts and builder activity/);
  assert.match(html, /Customer activity/);
  assert.match(html, /Builder accounts/);
  assert.match(html, /Content exposures/);
  assert.match(html, /First builder login/);
  assert.match(html, /Last activity/);
  assert.match(script, /fetch\("\/api\/dashboard\/session"/);
  assert.match(script, /fetch\("\/api\/dashboard"/);
  assert.match(waitlistScript, /point\.newBuilders/);
  assert.match(waitlistScript, /point\.projects/);
  assert.match(script, /setAttribute\("aria-pressed"/);
  assert.match(socialScript, /setAttribute\("aria-pressed"/);
  assert.match(html, /data-social-range="30" aria-pressed="true"/);
  assert.doesNotMatch(script, /localStorage|sessionStorage/);
  assert.doesNotMatch(script, /\/api\/admin\/waitlist/);
});

test("social UI names the exposure-to-website funnel and its sortable account measures", async () => {
  // Break caught: restoring the old clicks summary or omitting conversion ranking hides the funnel.
  const html = await readFile(dashboardHtmlPath, "utf8");

  assert.match(html, />Content exposures</);
  assert.match(html, />Website conversions</);
  assert.match(html, />Website visit rate</);
  assert.match(html, /<option value="websiteSessions">Website conversions<\/option>/);
  assert.match(html, /<option value="websiteVisitRate">Website visit rate<\/option>/);
  assert.match(html, />Platform link clicks<\/th>/);
  assert.doesNotMatch(html, />Site clicks</);
});

test("account table formatting preserves unknown and connected-zero values", async () => {
  // Break caught: coercing unknown attribution to zero makes disconnected accounts look measured.
  const { formatOptionalNumber } = await import(accountTableScriptPath);

  assert.equal(formatOptionalNumber(null), "—");
  assert.equal(formatOptionalNumber(undefined), "—");
  assert.equal(formatOptionalNumber(0), "0");
  assert.equal(formatOptionalNumber(1234), "1,234");
});

test("social chart rates exclude partial public engagement", async () => {
  // Break caught: dividing a public interaction snapshot by all exposure data invents a rate.
  const { buildSocialView } = await import(socialModelScriptPath);
  const shared = {
    platform: "instagram",
    publishedAt: "2026-08-20T00:00:00.000Z",
    impressions: 1000,
    engagements: 50,
    followersGained: 0,
    clicks: 0,
    attributionKey: "makeable_build",
  };
  const view = buildSocialView([
    { ...shared, id: "complete", account: "@makeable.build", engagementsComplete: true },
    { ...shared, id: "partial", account: "@makeable.zak", engagements: 15, engagementsComplete: false },
  ], { days: "all" });

  assert.equal(view.daily[0].engagementRate, 0.05);
});

test("social chart splits measured engagement runs at unknown days", async () => {
  // Break caught: filtering unknown days before drawing joins measurements across a gap.
  const { measuredEngagementRuns } = await import(socialChartScriptPath);
  const runs = measuredEngagementRuns([
    { date: "2026-08-20", engagementRate: 0.04 },
    { date: "2026-08-21", engagementRate: 0.05 },
    { date: "2026-08-22", engagementRate: null },
    { date: "2026-08-23", engagementRate: 0.07 },
    { date: "2026-08-24", engagementRate: 0.08 },
  ]);

  assert.deepEqual(runs.map((run) => run.map(({ index }) => index)), [[0, 1], [3, 4]]);
});

test("rendered social chart retains its description and names both axes", async () => {
  // Break caught: replaceChildren detached the described-by node and left numeric ticks unnamed.
  const { renderSocialChart } = await import(socialChartScriptPath);
  const previousDocument = globalThis.document;
  globalThis.document = {
    createElementNS(_namespace, name) {
      return new TestSvgNode(name);
    },
  };
  try {
    const chart = new TestSvgNode("svg");
    chart.setAttribute("aria-labelledby", "socialChartTitle socialChartDescription");
    renderSocialChart({
      chart,
      chartWrap: { clientWidth: 800, clientHeight: 286 },
      data: [
        { date: "2026-08-20", impressions: 1000, engagementRate: 0.04 },
        { date: "2026-08-21", impressions: 1200, engagementRate: null },
      ],
    });
    const descendants = allDescendants(chart);
    const description = descendants.find((node) =>
      node.name === "desc" && node.getAttribute("id") === "socialChartDescription");
    const leftAxis = descendants.find((node) => node.getAttribute("data-axis") === "left");
    const rightAxis = descendants.find((node) => node.getAttribute("data-axis") === "right");

    assert.equal(chart.getAttribute("aria-labelledby"), "socialChartTitle socialChartDescription");
    assert.ok(description);
    assert.match(description.textContent, /content exposures/i);
    assert.match(description.textContent, /engagement rate/i);
    assert.equal(leftAxis?.textContent, "Content exposures");
    assert.equal(rightAxis?.textContent, "Engagement rate");
  } finally {
    globalThis.document = previousDocument;
  }
});

test("edited dashboard source modules stay below 500 lines", async () => {
  // Break caught: oversized entrypoints make dashboard behavior harder to review safely.
  const paths = [
    "app.js", "overview.js", "waitlist.js", "social.js", "social-chart.js",
    "social-account-table.js", "social-model.js", "styles.css", "dashboard-shell.css",
    "waitlist.css", "dashboard-responsive.css", "social.css", "social-media.css",
  ];
  const sources = await Promise.all(paths.map((path) =>
    readFile(new URL(`../dashboard/${path}`, import.meta.url), "utf8")));

  paths.forEach((path, index) => {
    const lines = sources[index].split("\n").length;
    assert.ok(lines < 500, `${path} has ${lines} lines`);
  });
});

test("dashboard component colors come from the documented token palette", async () => {
  // Break caught: shared Social buttons and tables inherited undeclared literal colors.
  const paths = [
    "styles.css", "dashboard-shell.css", "waitlist.css", "dashboard-responsive.css",
    "social.css", "social-media.css",
  ];
  const sources = await Promise.all(paths.map((path) =>
    readFile(new URL(`../dashboard/${path}`, import.meta.url), "utf8")));
  sources[0] = sources[0].replace(/^:root \{[\s\S]*?\n\}/, "");

  paths.forEach((path, index) => {
    assert.doesNotMatch(sources[index], /#[0-9a-f]{3,8}\b|rgba?\(/i, `${path} has an orphan color`);
    const openingBraces = sources[index].match(/\{/g)?.length || 0;
    const closingBraces = sources[index].match(/\}/g)?.length || 0;
    assert.equal(openingBraces, closingBraces, `${path} has unbalanced blocks`);
  });
});

class TestSvgNode {
  constructor(name) {
    this.name = name;
    this.attributes = new Map();
    this.children = [];
    this.textContent = "";
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name) || null;
  }

  append(...children) {
    this.children.push(...children);
  }

  replaceChildren(...children) {
    this.children = children;
  }
}

function allDescendants(node) {
  return node.children.flatMap((child) => [child, ...allDescendants(child)]);
}
