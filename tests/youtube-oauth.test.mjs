import assert from "node:assert/strict";
import test from "node:test";

import {
  createYouTubeAuthorization,
  createYouTubeState,
  exchangeYouTubeCode,
  loadYouTubeAccessToken,
  saveYouTubeToken,
  verifyYouTubeState,
} from "../lib/youtube-oauth.mjs";

const now = new Date("2026-08-30T12:00:00.000Z");
const secret = "dashboard-session-secret-with-at-least-32-characters";

test("YouTube OAuth state is signed, time limited, and tamper resistant", () => {
  const state = createYouTubeState(secret, { now, randomBytesImpl: () => Buffer.alloc(24, 9) });

  assert.equal(verifyYouTubeState(state, secret, { now }), true);
  assert.equal(verifyYouTubeState(`${state}x`, secret, { now }), false);
  assert.equal(verifyYouTubeState(state, secret, { now: new Date("2026-08-30T12:11:00.000Z") }), false);
});

test("YouTube authorization requests offline read-only owner analytics access", () => {
  const authorization = createYouTubeAuthorization({
    clientId: "client-id",
    redirectUri: "https://makeable.build/api/dashboard/youtube/callback",
    state: "signed-state",
  });

  assert.equal(authorization.origin, "https://accounts.google.com");
  assert.equal(authorization.pathname, "/o/oauth2/v2/auth");
  assert.equal(authorization.searchParams.get("access_type"), "offline");
  assert.equal(authorization.searchParams.get("prompt"), "consent");
  assert.equal(authorization.searchParams.get("state"), "signed-state");
  assert.deepEqual(authorization.searchParams.get("scope").split(" ").sort(), [
    "https://www.googleapis.com/auth/youtube.readonly",
    "https://www.googleapis.com/auth/yt-analytics.readonly",
  ]);
});

test("YouTube authorization code exchange preserves refreshable owner access", async () => {
  const token = await exchangeYouTubeCode({
    code: "authorization-code",
    clientId: "client-id",
    clientSecret: "client-secret",
    redirectUri: "https://makeable.build/api/dashboard/youtube/callback",
    now,
    fetchImpl: async (_url, options) => {
      assert.equal(options.method, "POST");
      assert.equal(options.body.get("grant_type"), "authorization_code");
      return Response.json({
        access_token: "access-token",
        refresh_token: "refresh-token",
        expires_in: 3600,
        scope: "https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/yt-analytics.readonly",
        token_type: "Bearer",
      });
    },
  });

  assert.equal(token.accessToken, "access-token");
  assert.equal(token.refreshToken, "refresh-token");
  assert.equal(token.accessExpiresAt, "2026-08-30T13:00:00.000Z");
});

test("YouTube stored access refreshes before expiry and retains Google's refresh token", async () => {
  const store = new MemoryStore();
  await saveYouTubeToken(store, {
    accessToken: "expiring-access",
    refreshToken: "persistent-refresh",
    accessExpiresAt: "2026-08-30T12:04:00.000Z",
    scopes: [
      "https://www.googleapis.com/auth/youtube.readonly",
      "https://www.googleapis.com/auth/yt-analytics.readonly",
    ],
  });

  const accessToken = await loadYouTubeAccessToken({
    store,
    clientId: "client-id",
    clientSecret: "client-secret",
    now,
    fetchImpl: async (_url, options) => {
      assert.equal(options.body.get("grant_type"), "refresh_token");
      assert.equal(options.body.get("refresh_token"), "persistent-refresh");
      return Response.json({
        access_token: "fresh-access",
        expires_in: 3600,
        scope: "https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/yt-analytics.readonly",
        token_type: "Bearer",
      });
    },
  });

  assert.equal(accessToken, "fresh-access");
  assert.equal((await store.get("v1/youtube-owner-token.json")).refreshToken, "persistent-refresh");
});

class MemoryStore {
  values = new Map();

  async get(key) {
    return this.values.get(key) || null;
  }

  async setJSON(key, value) {
    this.values.set(key, structuredClone(value));
  }
}
