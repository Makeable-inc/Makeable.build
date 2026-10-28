import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { signOut } from "../apps/landing/app/sign-out.ts";

function fakeStorage(entries) {
  const map = new Map(Object.entries(entries));
  return {
    get length() { return map.size; },
    key: (index) => [...map.keys()][index] ?? null,
    getItem: (key) => map.get(key) ?? null,
    removeItem: (key) => map.delete(key),
    entries: () => Object.fromEntries(map),
  };
}

function recordingFetch(statusFor = () => 200) {
  const calls = [];
  const fetch = (url, init) => {
    calls.push({ url, method: init?.method, credentials: init?.credentials });
    return Promise.resolve(new Response("{}", { status: statusFor(url) }));
  };
  return { fetch, calls };
}

const jobUrl = (id) => `/api/build-jobs/${id}`;

test("log out ends the server session with a same-origin DELETE that sends the cookie", async () => {
  const { fetch, calls } = recordingFetch();
  assert.equal(await signOut({ fetch, url: "/api/auth/session", storages: [], jobUrl }), true);
  assert.deepEqual(calls, [{ url: "/api/auth/session", method: "DELETE", credentials: "include" }]);
});

test("an unfinished build is cancelled before the session ends, so its credit is not held by a build nobody can resume", async () => {
  const { fetch, calls } = recordingFetch();
  const local = fakeStorage({ "makeable:active-build-job:v1": "job_saved1" });
  const session = fakeStorage({ "makeable:active-build-job:v1": "job_saved1" });
  await signOut({ fetch, url: "/api/auth/session", storages: [local, session], jobUrl, jobIds: ["job_inmemory2", "", "not a job id"] });
  assert.deepEqual(calls.map((call) => `${call.method} ${call.url}`), [
    "DELETE /api/build-jobs/job_saved1",
    "DELETE /api/build-jobs/job_inmemory2",
    "DELETE /api/auth/session",
  ]);
  assert.ok(calls.every((call) => call.credentials === "include"));
});

test("a failed job cancel does not stop the log out", async () => {
  const { fetch, calls } = recordingFetch((url) => (url.startsWith("/api/build-jobs/") ? 409 : 200));
  assert.equal(await signOut({ fetch, url: "/api/auth/session", storages: [], jobUrl, jobIds: ["job_claimed"] }), true);
  assert.equal(calls.at(-1).url, "/api/auth/session");
});

test("after log out, Makeable's saved data is forgotten and nothing else is touched", async () => {
  const local = fakeStorage({ "makeable:active-build-job:v1": "job_1", ph_posthog: "x" });
  const session = fakeStorage({ "makeable:open-project": "{}", "makeable:active-build-job:v1": "job_1", other: "y" });
  await signOut({ fetch: recordingFetch().fetch, url: "/api/auth/session", storages: [local, session], jobUrl });
  assert.deepEqual(local.entries(), { ph_posthog: "x" });
  assert.deepEqual(session.entries(), { other: "y" });
});

test("a failed or unreachable log out reports failure and keeps the saved data of the still signed-in user", async () => {
  const local = fakeStorage({ "makeable:open-project": "{}" });
  assert.equal(await signOut({ fetch: recordingFetch(() => 403).fetch, url: "u", storages: [local], jobUrl }), false);
  assert.deepEqual(local.entries(), { "makeable:open-project": "{}" });
  assert.equal(await signOut({ fetch: () => Promise.reject(new TypeError("offline")), url: "u", storages: [local], jobUrl }), false);
  assert.deepEqual(local.entries(), { "makeable:open-project": "{}" });
});

test("analytics forgets the signed-in person on log out", async () => {
  const analytics = await readFile(new URL("../apps/landing/app/analytics.ts", import.meta.url), "utf8");
  assert.match(analytics, /export function resetMakeableAnalytics\(\) \{\s*posthog\.reset\(\);/);
});

test("Log out sits next to the profile on /app and in the homepage nav, resets analytics, and says so when it fails", async () => {
  const [ui, home, app] = await Promise.all([
    readFile(new URL("../apps/landing/app/workspace-ui.tsx", import.meta.url), "utf8"),
    readFile(new URL("../apps/landing/app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../apps/landing/app/app/page.tsx", import.meta.url), "utf8"),
  ]);
  // Outside the projects menu, beside the profile chip.
  assert.match(ui, /<\/details>\s*\)\}\s*<ProfileChip[\s\S]*?\/>\s*\{user && onSignOut && !building && \(/);
  assert.match(ui, /\{signOutError && <p className="mk-topbar-signout-error" role="alert">\{signOutError\}<\/p>\}/);
  assert.match(home, /\{authUser && \(\s*<button className="mk-nav-signout" type="button" onClick=\{\(\) => void logOut\(\)\}/);
  for (const page of [home, app]) {
    assert.match(page, /if \(ok\) \{\s*resetMakeableAnalytics\(\);\s*window\.location\.assign\(/);
    assert.match(page, /setSignOutError\("Makeable could not log you out\. You are still signed in, so try again\."\)/);
  }
  // The homepage also cancels the build it is following in memory.
  assert.match(home, /jobIds: \[currentJobRef\.current && !currentJobRef\.current\.claimedAt \? currentJobRef\.current\.id : ""\]/);
});
