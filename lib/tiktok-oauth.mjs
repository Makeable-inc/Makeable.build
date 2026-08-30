import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const TIKTOK_AUTHORIZE_URL = "https://www.tiktok.com/v2/auth/authorize/";
const TIKTOK_TOKEN_URL = "https://open.tiktokapis.com/v2/oauth/token/";
const TIKTOK_TOKEN_KEY = "v1/tiktok-owner-token.json";
const REQUIRED_SCOPES = ["user.info.basic", "user.info.stats", "video.list"];
const STATE_LIFETIME_SECONDS = 10 * 60;
const ACCESS_REFRESH_WINDOW_MS = 5 * 60 * 1_000;
const STATE_PATTERN = /^(\d{10})\.([A-Za-z0-9_-]{32})\.([A-Za-z0-9_-]{43})$/;

export function createTikTokState(secret, options = {}) {
  strongSecret(secret);
  const now = validDate(options.now ?? Date.now());
  const expiresAt = Math.floor(now.getTime() / 1_000) + STATE_LIFETIME_SECONDS;
  const nonce = (options.randomBytesImpl || randomBytes)(24).toString("base64url");
  const payload = `${expiresAt}.${nonce}`;
  return `${payload}.${signature(payload, secret)}`;
}

export function verifyTikTokState(value, secret, options = {}) {
  if (typeof value !== "string" || typeof secret !== "string") return false;
  const match = value.match(STATE_PATTERN);
  if (!match) return false;
  const now = validDate(options.now ?? Date.now());
  const expiresAt = Number(match[1]);
  const nowSeconds = Math.floor(now.getTime() / 1_000);
  if (expiresAt <= nowSeconds || expiresAt > nowSeconds + STATE_LIFETIME_SECONDS) return false;
  const payload = `${match[1]}.${match[2]}`;
  return constantTimeEqual(match[3], signature(payload, secret));
}

export function createTikTokAuthorization({ clientKey, redirectUri, state }) {
  const key = requiredString(clientKey, "TikTok client key");
  const callback = httpsUrl(redirectUri, "TikTok redirect URI");
  const signedState = requiredString(state, "TikTok OAuth state");
  const url = new URL(TIKTOK_AUTHORIZE_URL);
  url.search = new URLSearchParams({
    client_key: key,
    scope: REQUIRED_SCOPES.join(","),
    response_type: "code",
    redirect_uri: callback.href,
    state: signedState,
  }).toString();
  return url;
}

export async function exchangeTikTokCode(options) {
  return requestToken({
    clientKey: options.clientKey,
    clientSecret: options.clientSecret,
    fetchImpl: options.fetchImpl,
    now: options.now,
    body: {
      client_key: requiredString(options.clientKey, "TikTok client key"),
      client_secret: requiredString(options.clientSecret, "TikTok client secret"),
      code: requiredString(options.code, "TikTok authorization code"),
      grant_type: "authorization_code",
      redirect_uri: httpsUrl(options.redirectUri, "TikTok redirect URI").href,
    },
  });
}

export async function loadTikTokAccessToken(options) {
  const stored = await readTikTokToken(options.store);
  if (!stored) return optionalString(options.fallbackToken);
  const now = validDate(options.now ?? Date.now());
  if (new Date(stored.accessExpiresAt).getTime() > now.getTime() + ACCESS_REFRESH_WINDOW_MS) {
    return stored.accessToken;
  }
  if (new Date(stored.refreshExpiresAt).getTime() <= now.getTime()) {
    return optionalString(options.fallbackToken);
  }
  const refreshed = await requestToken({
    clientKey: options.clientKey,
    clientSecret: options.clientSecret,
    fetchImpl: options.fetchImpl,
    now,
    body: {
      client_key: requiredString(options.clientKey, "TikTok client key"),
      client_secret: requiredString(options.clientSecret, "TikTok client secret"),
      grant_type: "refresh_token",
      refresh_token: stored.refreshToken,
    },
  });
  await saveTikTokToken(options.store, refreshed);
  return refreshed.accessToken;
}

export async function saveTikTokToken(store, token) {
  if (!store || typeof store.setJSON !== "function") {
    throw new TikTokOAuthError("TikTok token storage is unavailable.");
  }
  const normalized = normalizedToken(token);
  if (!normalized) throw new TikTokOAuthError("TikTok returned an invalid token.");
  await store.setJSON(TIKTOK_TOKEN_KEY, normalized);
}

async function readTikTokToken(store) {
  if (!store || typeof store.get !== "function") return null;
  return normalizedToken(await store.get(TIKTOK_TOKEN_KEY, { type: "json" }));
}

async function requestToken({ body, fetchImpl, now }) {
  if (typeof fetchImpl !== "function") throw new TikTokOAuthError("TikTok token exchange is unavailable.");
  const response = await fetchImpl(TIKTOK_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response?.ok) throw new TikTokOAuthError("TikTok rejected the token request.");
  const payload = await response.json();
  const token = tokenFromResponse(payload, validDate(now ?? Date.now()));
  if (!token) throw new TikTokOAuthError("TikTok returned an incomplete token response.");
  return token;
}

function tokenFromResponse(payload, now) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const accessToken = optionalString(payload.access_token);
  const refreshToken = optionalString(payload.refresh_token);
  const openId = optionalString(payload.open_id);
  const scopes = optionalString(payload.scope).split(",").map((scope) => scope.trim()).filter(Boolean).sort();
  const expiresIn = positiveInteger(payload.expires_in);
  const refreshExpiresIn = positiveInteger(payload.refresh_expires_in);
  if (!accessToken || !refreshToken || !openId || !expiresIn || !refreshExpiresIn) return null;
  if (!REQUIRED_SCOPES.every((scope) => scopes.includes(scope))) return null;
  return {
    accessToken,
    refreshToken,
    accessExpiresAt: new Date(now.getTime() + expiresIn * 1_000).toISOString(),
    refreshExpiresAt: new Date(now.getTime() + refreshExpiresIn * 1_000).toISOString(),
    openId,
    scopes,
  };
}

function normalizedToken(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const accessToken = optionalString(value.accessToken);
  const refreshToken = optionalString(value.refreshToken);
  const accessExpiresAt = validTimestamp(value.accessExpiresAt);
  const refreshExpiresAt = validTimestamp(value.refreshExpiresAt);
  const openId = optionalString(value.openId);
  const scopes = Array.isArray(value.scopes)
    ? value.scopes.filter((scope) => typeof scope === "string" && REQUIRED_SCOPES.includes(scope)).sort()
    : [];
  if (!accessToken || !refreshToken || !accessExpiresAt || !refreshExpiresAt || !openId) return null;
  if (!REQUIRED_SCOPES.every((scope) => scopes.includes(scope))) return null;
  return { accessToken, refreshToken, accessExpiresAt, refreshExpiresAt, openId, scopes };
}

function signature(payload, secret) {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function constantTimeEqual(left, right) {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

function strongSecret(value) {
  if (typeof value !== "string" || value.length < 32) {
    throw new TikTokOAuthError("A strong TikTok OAuth state secret is required.");
  }
}

function requiredString(value, label) {
  const normalized = optionalString(value);
  if (!normalized) throw new TikTokOAuthError(`${label} is required.`);
  return normalized;
}

function optionalString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function httpsUrl(value, label) {
  try {
    const url = new URL(requiredString(value, label));
    if (url.protocol !== "https:") throw new TikTokOAuthError(`${label} must use HTTPS.`);
    return url;
  } catch (error) {
    if (error instanceof TikTokOAuthError) throw error;
    throw new TikTokOAuthError(`${label} is invalid.`);
  }
}

function validTimestamp(value) {
  if (typeof value !== "string") return "";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : "";
}

function validDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new TikTokOAuthError("TikTok OAuth received an invalid timestamp.");
  return date;
}

function positiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0 ? value : 0;
}

export class TikTokOAuthError extends Error {}
