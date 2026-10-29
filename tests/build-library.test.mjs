import assert from "node:assert/strict";
import test from "node:test";

import { buildLibrary, loadBuildLibrary } from "../apps/landing/app/app/build-library.ts";

test("signed-in workspaces list only the owner's saved builds", () => {
  const accountBuilds = [{ id: "mine" }];
  const publicBuilds = [{ id: "theirs" }];

  assert.deepEqual(buildLibrary(accountBuilds, publicBuilds, true), accountBuilds);
  assert.deepEqual(buildLibrary(accountBuilds, publicBuilds, false), publicBuilds);
});

const ACCOUNT = "/api/account/builds";
const PUBLIC = "/api/builds";
const PUBLIC_OK = { status: 200, body: JSON.stringify({ builds: [{ id: "theirs" }] }) };

// A fetch stand-in: each URL answers as configured; "hang" never answers but
// honours the abort signal like a real fetch.
function fakeFetch(answers) {
  return (url, init = {}) => {
    const answer = answers[url];
    if (answer === "hang") {
      return new Promise((_, reject) => {
        init.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
      });
    }
    if (answer === "network-error") return Promise.reject(new TypeError("Failed to fetch"));
    return Promise.resolve(new Response(answer.body, { status: answer.status, headers: { "Content-Type": "application/json" } }));
  };
}

function load(answers, timeoutMs = 50) {
  return loadBuildLibrary({ fetch: fakeFetch(answers), accountUrl: ACCOUNT, publicUrl: PUBLIC, timeoutMs });
}

test("a hanging account request does not hold back the public builds", async () => {
  const { account, publicBuilds } = load({ [ACCOUNT]: "hang", [PUBLIC]: PUBLIC_OK });
  assert.deepEqual(await publicBuilds, { state: "ok", builds: [{ id: "theirs" }] });
  assert.deepEqual(await account, { state: "unavailable" });
});

test("a malformed account response does not hide the public builds", async () => {
  const { account, publicBuilds } = load({ [ACCOUNT]: { status: 200, body: "<html>oops" }, [PUBLIC]: PUBLIC_OK });
  assert.deepEqual(await account, { state: "unavailable" });
  assert.equal((await publicBuilds).state, "ok");
});

test("signed out (401) is not an error and public builds still load", async () => {
  const { account, publicBuilds } = load({ [ACCOUNT]: { status: 401, body: "{}" }, [PUBLIC]: PUBLIC_OK });
  assert.deepEqual(await account, { state: "signed-out" });
  assert.equal((await publicBuilds).state, "ok");
});

test("an account server error or network error is 'unavailable', not signed out", async () => {
  assert.deepEqual(await load({ [ACCOUNT]: { status: 500, body: "{}" }, [PUBLIC]: PUBLIC_OK }).account, { state: "unavailable" });
  assert.deepEqual(await load({ [ACCOUNT]: "network-error", [PUBLIC]: PUBLIC_OK }).account, { state: "unavailable" });
});

test("a signed-in account returns its user, builds and quota", async () => {
  const body = JSON.stringify({ user: { sub: "me" }, builds: [{ id: "mine" }], quota: { limit: 10, used: 1, remaining: 9 } });
  assert.deepEqual(await load({ [ACCOUNT]: { status: 200, body }, [PUBLIC]: PUBLIC_OK }).account, {
    state: "signed-in",
    user: { sub: "me" },
    builds: [{ id: "mine" }],
    quota: { limit: 10, used: 1, remaining: 9 },
  });
});

test("a failing, hanging or malformed public list is a failure, never an empty success", async () => {
  const signedOut = { status: 401, body: "{}" };
  assert.deepEqual(await load({ [ACCOUNT]: signedOut, [PUBLIC]: { status: 500, body: "{}" } }).publicBuilds, { state: "failed" });
  assert.deepEqual(await load({ [ACCOUNT]: signedOut, [PUBLIC]: "hang" }).publicBuilds, { state: "failed" });
  assert.deepEqual(await load({ [ACCOUNT]: signedOut, [PUBLIC]: { status: 200, body: "not json" } }).publicBuilds, { state: "failed" });
  assert.deepEqual(await load({ [ACCOUNT]: signedOut, [PUBLIC]: { status: 200, body: "{\"builds\":{}}" } }).publicBuilds, { state: "failed" });
});

test("the account request sends cookies; the public list does not need them", async () => {
  const seen = {};
  const fetch = (url, init) => { seen[url] = init; return Promise.resolve(new Response(url === ACCOUNT ? "{}" : PUBLIC_OK.body, { status: url === ACCOUNT ? 401 : 200 })); };
  const { account, publicBuilds } = loadBuildLibrary({ fetch, accountUrl: ACCOUNT, publicUrl: PUBLIC, timeoutMs: 50 });
  await Promise.all([account, publicBuilds]);
  assert.equal(seen[ACCOUNT].credentials, "include");
  assert.notEqual(seen[PUBLIC].credentials, "include");
});

test("the build library page loads account and public builds independently", async () => {
  const { readFile } = await import("node:fs/promises");
  const page = await readFile(new URL("../apps/landing/app/app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /loadBuildLibrary</);
  // Waiting for both together let a hanging account request hold back the public list.
  assert.doesNotMatch(page, /Promise\.allSettled\(\[\s*fetch\(apiUrl\("\/api\/account\/builds"\)/);
});
