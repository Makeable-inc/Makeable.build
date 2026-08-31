import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const YOUTUBE_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const YOUTUBE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const YOUTUBE_TOKEN_KEY = "v1/youtube-owner-token.json";
const REQUIRED_SCOPES = [
  "https://www.googleapis.com/auth/youtube.readonly",
  "https://www.googleapis.com/auth/yt-analytics.readonly",
];
const STATE_LIFETIME_SECONDS = 10 * 60;
const ACCESS_REFRESH_WINDOW_MS = 5 * 60 * 1_000;
const STATE_PATTERN = /^(\d{10})\.([A-Za-z0-9_-]{32})\.([A-Za-z0-9_-]{43})$/;

export function createYouTubeState(secret, options = {}) {
  strongSecret(secret);
  const now = validDate(options.now ?? Date.now());
  const expiresAt = Math.floor(now.getTime() / 1_000) + STATE_LIFETIME_SECONDS;
  const nonce = (options.randomBytesImpl || randomBytes)(24).toString("base64url");
  const payload = `${expiresAt}.${nonce}`;
  return `${payload}.${signature(payload, secret)}`;
}

export function verifyYouTubeState(value, secret, options = {}) {
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

export function createYouTubeAuthorization({ clientId, redirectUri, state }) {
  const url = new URL(YOUTUBE_AUTHORIZE_URL);
  url.search = new URLSearchParams({
    client_id: requiredString(clientId, "YouTube OAuth client ID"),
    redirect_uri: httpsUrl(redirectUri, "YouTube redirect URI").href,
    response_type: "code",
    scope: REQUIRED_SCOPES.join(" "),
    access_type: "offline",
    include_granted_scopes: "true",
    prompt: "consent",
    state: requiredString(state, "YouTube OAuth state"),
  }).toString();
  return url;
}

export async function exchangeYouTubeCode(options) {
  return requestToken({
    clientId: options.clientId,
    clientSecret: options.clientSecret,
    fetchImpl: options.fetchImpl,
    now: options.now,
    body: {
      client_id: requiredString(options.clientId, "YouTube OAuth client ID"),
      client_secret: requiredString(options.clientSecret, "YouTube OAuth client secret"),
      code: requiredString(options.code, "YouTube authorization code"),
      grant_type: "authorization_code",
      redirect_uri: httpsUrl(options.redirectUri, "YouTube redirect URI").href,
    },
  });
}

export async function loadYouTubeAccessToken(options) {
  const stored = await readYouTubeToken(options.store);
  if (!stored) return optionalString(options.fallbackToken);
  const now = validDate(options.now ?? Date.now());
  if (new Date(stored.accessExpiresAt).getTime() > now.getTime() + ACCESS_REFRESH_WINDOW_MS) {
    return stored.accessToken;
  }
  const refreshed = await requestToken({
    clientId: options.clientId,
    clientSecret: options.clientSecret,
    fetchImpl: options.fetchImpl,
    now,
    retainedRefreshToken: stored.refreshToken,
    retainedScopes: stored.scopes,
    body: {
      client_id: requiredString(options.clientId, "YouTube OAuth client ID"),
      client_secret: requiredString(options.clientSecret, "YouTube OAuth client secret"),
      refresh_token: stored.refreshToken,
      grant_type: "refresh_token",
    },
  });
  await saveYouTubeToken(options.store, refreshed);
  return refreshed.accessToken;
}

export async function saveYouTubeToken(store, token) {
  if (!store || typeof store.setJSON !== "function") {
    throw new YouTubeOAuthError("YouTube token storage is unavailable.");
  }
  const normalized = normalizedToken(token);
  if (!normalized) throw new YouTubeOAuthError("Google returned an invalid YouTube token.");
  await store.setJSON(YOUTUBE_TOKEN_KEY, normalized);
}

async function readYouTubeToken(store) {
  if (!store || typeof store.get !== "function") return null;
  return normalizedToken(await store.get(YOUTUBE_TOKEN_KEY, { type: "json" }));
}

async function requestToken({ body, fetchImpl, now, retainedRefreshToken = "", retainedScopes = [] }) {
  if (typeof fetchImpl !== "function") throw new YouTubeOAuthError("YouTube token exchange is unavailable.");
  const response = await fetchImpl(YOUTUBE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response?.ok) throw new YouTubeOAuthError("Google rejected the YouTube token request.");
  const payload = await response.json();
  const token = tokenFromResponse(payload, validDate(now ?? Date.now()), retainedRefreshToken, retainedScopes);
  if (!token) throw new YouTubeOAuthError("Google returned an incomplete YouTube token response.");
  return token;
}

function tokenFromResponse(payload, now, retainedRefreshToken, retainedScopes) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const accessToken = optionalString(payload.access_token);
  const refreshToken = optionalString(payload.refresh_token) || optionalString(retainedRefreshToken);
  const expiresIn = positiveInteger(payload.expires_in);
  const responseScopes = optionalString(payload.scope).split(" ").map((scope) => scope.trim()).filter(Boolean);
  const scopes = (responseScopes.length ? responseScopes : retainedScopes).filter((scope) => REQUIRED_SCOPES.includes(scope)).sort();
  if (!accessToken || !refreshToken || !expiresIn) return null;
  if (!REQUIRED_SCOPES.every((scope) => scopes.includes(scope))) return null;
  return {
    accessToken,
    refreshToken,
    accessExpiresAt: new Date(now.getTime() + expiresIn * 1_000).toISOString(),
    scopes,
  };
}

function normalizedToken(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const accessToken = optionalString(value.accessToken);
  const refreshToken = optionalString(value.refreshToken);
  const accessExpiresAt = validTimestamp(value.accessExpiresAt);
  const scopes = Array.isArray(value.scopes)
    ? value.scopes.filter((scope) => typeof scope === "string" && REQUIRED_SCOPES.includes(scope)).sort()
    : [];
  if (!accessToken || !refreshToken || !accessExpiresAt) return null;
  if (!REQUIRED_SCOPES.every((scope) => scopes.includes(scope))) return null;
  return { accessToken, refreshToken, accessExpiresAt, scopes };
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
    throw new YouTubeOAuthError("A strong YouTube OAuth state secret is required.");
  }
}

function requiredString(value, label) {
  const normalized = optionalString(value);
  if (!normalized) throw new YouTubeOAuthError(`${label} is required.`);
  return normalized;
}

function optionalString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function httpsUrl(value, label) {
  try {
    const url = new URL(requiredString(value, label));
    if (url.protocol !== "https:") throw new YouTubeOAuthError(`${label} must use HTTPS.`);
    return url;
  } catch (error) {
    if (error instanceof YouTubeOAuthError) throw error;
    throw new YouTubeOAuthError(`${label} is invalid.`);
  }
}

function validTimestamp(value) {
  if (typeof value !== "string") return "";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : "";
}

function validDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new YouTubeOAuthError("YouTube OAuth received an invalid timestamp.");
  return date;
}

function positiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0 ? value : 0;
}

export class YouTubeOAuthError extends Error {}
