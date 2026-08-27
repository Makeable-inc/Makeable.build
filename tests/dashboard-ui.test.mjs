import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const dashboardHtmlPath = new URL("../dashboard/index.html", import.meta.url);
const dashboardScriptPath = new URL("../dashboard/app.js", import.meta.url);
const socialScriptPath = new URL("../dashboard/social.js", import.meta.url);
const accountTableScriptPath = new URL("../dashboard/social-account-table.js", import.meta.url);
const socialModelScriptPath = new URL("../dashboard/social-model.js", import.meta.url);

test("dashboard keeps private auth and separates contacts, builders, and projects", async () => {
  const [html, script, socialScript] = await Promise.all([
    readFile(dashboardHtmlPath, "utf8"),
    readFile(dashboardScriptPath, "utf8"),
    readFile(socialScriptPath, "utf8"),
  ]);

  assert.match(html, /Contacts and builder activity/);
  assert.match(html, /Customer activity/);
  assert.match(html, /Builder accounts/);
  assert.match(html, /Content exposures/);
  assert.match(html, /First builder login/);
  assert.match(html, /Last activity/);
  assert.match(script, /fetch\("\/api\/dashboard\/session"/);
  assert.match(script, /fetch\("\/api\/dashboard"/);
  assert.match(script, /point\.newBuilders/);
  assert.match(script, /point\.projects/);
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
