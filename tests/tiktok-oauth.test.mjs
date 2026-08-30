import assert from "node:assert/strict";
import test from "node:test";

import {
  createTikTokAuthorization,
  createTikTokState,
  exchangeTikTokCode,
  loadTikTokAccessToken,
  saveTikTokToken,
  verifyTikTokState,
} from "../lib/tiktok-oauth.mjs";

const now = new Date("2026-08-30T12:00:00.000Z");
const secret = "dashboard-session-secret-with-at-least-32-characters";

test("TikTok OAuth state is signed, time limited, and tamper resistant", () => {
  // Given: a deterministic nonce for an owner-initiated connection.
  const state = createTikTokState(secret, { now, randomBytesImpl: () => Buffer.alloc(24, 7) });

  // When/Then: the exact state verifies while mutations and expiry fail.
  assert.equal(verifyTikTokState(state, secret, { now }), true);
  assert.equal(verifyTikTokState(`${state}x`, secret, { now }), false);
  assert.equal(verifyTikTokState(state, secret, { now: new Date("2026-08-30T12:11:00.000Z") }), false);
});

test("TikTok authorization requests only the analytics scopes used by Makeable", () => {
  const authorization = createTikTokAuthorization({
    clientKey: "client-key",
    redirectUri: "https://makeable.build/api/dashboard/tiktok/callback",
    state: "signed-state",
  });

  assert.equal(authorization.origin, "https://www.tiktok.com");
  assert.equal(authorization.pathname, "/v2/auth/authorize/");
  assert.equal(authorization.searchParams.get("scope"), "user.info.basic,user.info.stats,video.list");
  assert.equal(authorization.searchParams.get("state"), "signed-state");
});

test("TikTok authorization code exchange preserves refreshable owner access", async () => {
  // Given: TikTok returns the three approved scopes and refreshable tokens.
  const fetchImpl = async (_url, options) => {
    assert.equal(options.method, "POST");
    assert.equal(options.body.get("grant_type"), "authorization_code");
    return Response.json({
      access_token: "access-token",
      refresh_token: "refresh-token",
      expires_in: 86_400,
      refresh_expires_in: 31_536_000,
      open_id: "owner-open-id",
      scope: "user.info.basic,user.info.stats,video.list",
      token_type: "Bearer",
    });
  };

  // When: Makeable exchanges the one-time callback code.
  const token = await exchangeTikTokCode({
    code: "authorization-code",
    clientKey: "client-key",
    clientSecret: "client-secret",
    redirectUri: "https://makeable.build/api/dashboard/tiktok/callback",
    fetchImpl,
    now,
  });

  // Then: only normalized server-side token metadata is retained.
  assert.equal(token.accessToken, "access-token");
  assert.equal(token.refreshToken, "refresh-token");
  assert.equal(token.accessExpiresAt, "2026-08-31T12:00:00.000Z");
  assert.equal(token.refreshExpiresAt, "2027-08-30T12:00:00.000Z");
});

test("TikTok stored access refreshes before expiry and rotates the refresh token", async () => {
  // Given: an access token inside its five-minute refresh window.
  const store = new MemoryStore();
  await saveTikTokToken(store, {
    accessToken: "expiring-access",
    refreshToken: "old-refresh",
    accessExpiresAt: "2026-08-30T12:04:00.000Z",
    refreshExpiresAt: "2027-08-30T12:00:00.000Z",
    openId: "owner-open-id",
    scopes: ["user.info.basic", "user.info.stats", "video.list"],
  });
  const fetchImpl = async (_url, options) => {
    assert.equal(options.body.get("grant_type"), "refresh_token");
    assert.equal(options.body.get("refresh_token"), "old-refresh");
    return Response.json({
      access_token: "fresh-access",
      refresh_token: "rotated-refresh",
      expires_in: 86_400,
      refresh_expires_in: 31_536_000,
      open_id: "owner-open-id",
      scope: "user.info.basic,user.info.stats,video.list",
      token_type: "Bearer",
    });
  };

  // When: the scheduled refresh asks for a usable token.
  const accessToken = await loadTikTokAccessToken({
    store,
    clientKey: "client-key",
    clientSecret: "client-secret",
    fetchImpl,
    now,
  });

  // Then: the new access and rotated refresh credentials are retained.
  assert.equal(accessToken, "fresh-access");
  assert.equal((await store.get("v1/tiktok-owner-token.json")).refreshToken, "rotated-refresh");
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
