import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { savedBuildJobRefused, savedBuildJobToResume } from "../apps/landing/app/saved-build-job.ts";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("a saved build job is resumed only for a signed-in account", () => {
  assert.equal(savedBuildJobToResume("job_saved1", true), "job_saved1");
  assert.equal(savedBuildJobToResume("job_saved1", false), "");
  assert.equal(savedBuildJobToResume("", true), "");
});

test("a saved build job the server refuses (another account's, or gone) is forgotten", () => {
  assert.equal(savedBuildJobRefused(403), true);
  assert.equal(savedBuildJobRefused(404), true);
  for (const status of [200, 401, 429, 500, 0]) assert.equal(savedBuildJobRefused(status), false);
});

test("an ended session stops counting events toward that account, but anonymous visitors keep their id", async () => {
  const analytics = await read("../apps/landing/app/analytics.ts");
  assert.match(analytics, /export function forgetEndedMakeableAccount\(\) \{\s*if \(posthog\.get_property\("\$user_state"\) === "identified"\) posthog\.reset\(\);/);
});

test("the homepage treats an expired session as signed out", async () => {
  const home = await read("../apps/landing/app/page.tsx");
  // Account check answers 401: forget the account in memory and in analytics.
  assert.match(home, /if \(response\.status === 401\) \{\s*forgetSignedInAccount\(\);/);
  assert.match(home, /const forgetSignedInAccount = useCallback\(\(\) => \{[^}]*forgetEndedMakeableAccount\(\);/);
  // Starting a build after the session ended asks to sign in instead of failing the build.
  assert.match(home, /let response = await startBuild\(\);\s*if \(response\.status === 401\) \{\s*forgetSignedInAccount\(\);\s*pendingIdeaRef\.current = nextIdea;/);
  // The saved job reopens only for a signed-in account, and is dropped when refused.
  assert.match(home, /const savedJobId = savedBuildJobToResume\(savedBuildJobId\(\), Boolean\(authUserRef\.current\)\);/);
  assert.match(home, /if \(savedBuildJobRefused\(response\.status\)\) throw new SavedBuildJobRefusedError/);
});

test("the projects page forgets an ended account in analytics", async () => {
  const app = await read("../apps/landing/app/app/page.tsx");
  assert.match(app, /\} else if \(result\.state === "signed-out"\) \{\s*forgetEndedMakeableAccount\(\);/);
});
