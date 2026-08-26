import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const dashboardHtmlPath = new URL("../dashboard/index.html", import.meta.url);
const dashboardScriptPath = new URL("../dashboard/app.js", import.meta.url);

test("dashboard keeps private auth and separates contacts, builders, and projects", async () => {
  const [html, script] = await Promise.all([
    readFile(dashboardHtmlPath, "utf8"),
    readFile(dashboardScriptPath, "utf8"),
  ]);

  assert.match(html, /Contacts and builder activity/);
  assert.match(html, /Customer activity/);
  assert.match(html, /Builder accounts/);
  assert.match(html, /First builder login/);
  assert.match(html, /Last activity/);
  assert.match(script, /fetch\("\/api\/dashboard\/session"/);
  assert.match(script, /fetch\("\/api\/dashboard"/);
  assert.match(script, /point\.newBuilders/);
  assert.match(script, /point\.projects/);
  assert.doesNotMatch(script, /localStorage|sessionStorage/);
  assert.doesNotMatch(script, /\/api\/admin\/waitlist/);
});
