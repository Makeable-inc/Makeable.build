import assert from "node:assert/strict";
import test from "node:test";

import {
  BUILDER_SESSION_COOKIE,
  builderSessionKey,
  builderSessionStoreName,
  builderSessionStoreNameForFunctionContext,
  clearBuilderSessionCookie,
  createBuilderSession,
  normalizeGoogleBuilderIdentity,
  publicBuilderProfile,
  resolveBuilderSession,
} from "../lib/builder-session.mjs";

class MemoryStore {
  constructor(values = []) {
    this.values = new Map(values);
  }

  async set(key, value) {
    this.values.set(key, JSON.parse(await value.text()));
    return { modified: true };
  }

  async get(key, options) {
    assert.equal(options.type, "json");
    return this.values.get(key) || null;
  }

  async delete(key) {
    this.values.delete(key);
  }
}

test("Google builder identities require verified email and normalize public profile fields", () => {
  const now = new Date("2026-08-21T18:00:00.000Z");
  const result = normalizeGoogleBuilderIdentity({
    email: "Maker@Example.com",
    email_verified: true,
    sub: "google-subject",
    name: "Maker",
    picture: "https://example.com/avatar.png",
  }, { now });

  assert.equal(result.ok, true);
  assert.deepEqual(result.value, {
    sub: "google-subject",
    email: "maker@example.com",
    name: "Maker",
    picture: "https://example.com/avatar.png",
    createdAt: now.toISOString(),
  });
  assert.deepEqual(publicBuilderProfile(result.value), {
    email: "maker@example.com",
    name: "Maker",
    picture: "https://example.com/avatar.png",
  });
  assert.equal(
    normalizeGoogleBuilderIdentity({ email: "maker@example.com", email_verified: false, sub: "x" }).status,
    401,
  );
});

test("builder sessions use an opaque HttpOnly host cookie and isolated stores", async () => {
  const store = new MemoryStore();
  const session = await createBuilderSession(
    store,
    { sub: "google-subject", email: "maker@example.com", name: "Maker", picture: "https://example.com/a.png" },
    {
      now: new Date("2026-08-21T18:00:00.000Z"),
      maxAgeSeconds: 1_000,
      randomBytesImpl: (length) => Buffer.alloc(length, 17),
    },
  );

  assert.match(session.token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(store.values.has(builderSessionKey(session.token)), true);
  assert.match(session.cookie, new RegExp(`^${BUILDER_SESSION_COOKIE}=`));
  assert.match(session.cookie, /; HttpOnly/);
  assert.match(session.cookie, /; Secure/);
  assert.match(session.cookie, /; SameSite=Strict/);
  assert.doesNotMatch(session.cookie, /Domain=/i);
  assert.equal(builderSessionStoreName("production"), "builder-sessions");
  assert.equal(builderSessionStoreName("deploy-preview"), "builder-sessions-preview");
  assert.equal(
    builderSessionStoreNameForFunctionContext({ deploy: { context: "branch-deploy" } }),
    "builder-sessions-preview",
  );
});

test("builder session resolution clears malformed or expired cookies", async () => {
  const store = new MemoryStore();
  const session = await createBuilderSession(
    store,
    { sub: "google-subject", email: "maker@example.com" },
    {
      now: new Date("2026-08-21T18:00:00.000Z"),
      maxAgeSeconds: 60,
      randomBytesImpl: (length) => Buffer.alloc(length, 19),
    },
  );
  const valid = new Request("https://makeable.build/api/account/builds", {
    headers: { Cookie: `${BUILDER_SESSION_COOKIE}=${session.token}` },
  });
  assert.deepEqual(
    await resolveBuilderSession(valid, store, { now: new Date("2026-08-21T18:00:30.000Z") }),
    {
      authenticated: true,
      user: { sub: "google-subject", email: "maker@example.com", name: "", picture: "" },
      clearCookie: false,
    },
  );

  assert.deepEqual(
    await resolveBuilderSession(valid, store, { now: new Date("2026-08-21T18:02:00.000Z") }),
    { authenticated: false, user: null, clearCookie: true },
  );

  const malformed = new Request("https://makeable.build/api/account/builds", {
    headers: { Cookie: `${BUILDER_SESSION_COOKIE}=bad` },
  });
  assert.deepEqual(
    await resolveBuilderSession(malformed, store),
    { authenticated: false, user: null, clearCookie: true },
  );
  assert.match(clearBuilderSessionCookie(), /Max-Age=0/);
});
