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

test("log out ends the server session with a same-origin DELETE that sends the cookie", async () => {
  const calls = [];
  const fetch = (url, init) => { calls.push({ url, init }); return Promise.resolve(new Response("{}", { status: 200 })); };
  assert.equal(await signOut({ fetch, url: "/api/auth/session", storages: [] }), true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/api/auth/session");
  assert.equal(calls[0].init.method, "DELETE");
  assert.equal(calls[0].init.credentials, "include");
});

test("log out forgets Makeable's saved build job and opened project, and nothing else", async () => {
  const local = fakeStorage({ "makeable:active-build-job:v1": "job_1", "ph_posthog": "x" });
  const session = fakeStorage({ "makeable:open-project": "{}", "makeable:active-build-job:v1": "job_1", other: "y" });
  const fetch = () => Promise.resolve(new Response("{}", { status: 200 }));
  await signOut({ fetch, url: "/api/auth/session", storages: [local, session] });
  assert.deepEqual(local.entries(), { ph_posthog: "x" });
  assert.deepEqual(session.entries(), { other: "y" });
});

test("a failed or unreachable log out reports failure, so the page does not pretend you are signed out", async () => {
  assert.equal(await signOut({ fetch: () => Promise.resolve(new Response("{}", { status: 403 })), url: "u", storages: [] }), false);
  assert.equal(await signOut({ fetch: () => Promise.reject(new TypeError("offline")), url: "u", storages: [] }), false);
});

test("the projects menu offers Log out to a signed-in user, on the homepage workspace and on /app", async () => {
  const [ui, home, app] = await Promise.all([
    readFile(new URL("../apps/landing/app/workspace-ui.tsx", import.meta.url), "utf8"),
    readFile(new URL("../apps/landing/app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../apps/landing/app/app/page.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(ui, /\{user && onSignOut && \(/);
  assert.match(ui, />\s*Log out\s*</);
  assert.match(home, /onSignOut=\{/);
  assert.match(app, /onSignOut=\{/);
  // A full reload after logging out drops every piece of private state held in memory.
  assert.match(home, /signOut\(\{[^}]*\}\)[\s\S]{0,200}window\.location\.(assign|reload)/);
  assert.match(app, /signOut\(\{[^}]*\}\)[\s\S]{0,200}window\.location\.(assign|reload)/);
});
