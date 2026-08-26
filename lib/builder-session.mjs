import { createHash, randomBytes } from "node:crypto";

export const BUILDER_SESSION_COOKIE = "__Host-makeable_builder";
export const BUILDER_SESSION_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;

const SESSION_TOKEN_BYTES = 32;
const SESSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function builderSessionStoreName(context) {
  return context && context !== "production"
    ? "builder-sessions-preview"
    : "builder-sessions";
}

export function builderSessionStoreNameForFunctionContext(context) {
  const deployContext =
    typeof context?.deploy?.context === "string" ? context.deploy.context : "";
  return builderSessionStoreName(deployContext);
}

export function builderSessionKey(token) {
  return `builder-session-${createHash("sha256").update(token).digest("hex")}`;
}

export function normalizeGoogleBuilderIdentity(identity, options = {}) {
  const email = normalizeEmail(identity?.email);
  const subject =
    typeof identity?.sub === "string" ? identity.sub.trim().slice(0, 255) : "";
  if (!email || identity?.email_verified !== true || !subject) {
    return {
      ok: false,
      status: 401,
      error: "Google could not verify this email address.",
    };
  }
  return {
    ok: true,
    value: {
      sub: subject,
      email,
      name: cleanText(identity.name, 120),
      picture: cleanPicture(identity.picture),
      createdAt: timestamp(options.now),
    },
  };
}

export async function createBuilderSession(store, user, options = {}) {
  const normalized = normalizeBuilderUser(user);
  if (!normalized) throw new Error("A verified builder user is required");

  const now = validDate(options.now ?? Date.now());
  const maxAgeSeconds = positiveInteger(
    options.maxAgeSeconds,
    BUILDER_SESSION_MAX_AGE_SECONDS,
  );
  const token = (options.randomBytesImpl || randomBytes)(SESSION_TOKEN_BYTES)
    .toString("base64url");
  if (!SESSION_TOKEN_PATTERN.test(token)) {
    throw new Error("Builder session token generation failed");
  }

  const record = {
    schemaVersion: 1,
    user: normalized,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + maxAgeSeconds * 1_000).toISOString(),
  };
  const key = builderSessionKey(token);
  await store.set(key, new Blob([JSON.stringify(record)], { type: "application/json" }));
  const stored = await store.get(key, { type: "json", consistency: "strong" });
  if (!sameSessionRecord(stored, record)) {
    throw new Error("Builder session could not be verified after storage");
  }

  return {
    token,
    record,
    cookie: builderSessionCookie(token, maxAgeSeconds),
  };
}

export async function resolveBuilderSession(request, store, options = {}) {
  const cookie = builderSessionCookieState(request);
  if (cookie.state === "missing") return { authenticated: false, user: null, clearCookie: false };
  if (cookie.state === "invalid") return { authenticated: false, user: null, clearCookie: true };

  const key = builderSessionKey(cookie.token);
  const session = await store.get(key, { type: "json", consistency: "strong" });
  const now = validDate(options.now ?? Date.now());
  if (!validSessionRecord(session, now)) {
    await deleteQuietly(store, key);
    return { authenticated: false, user: null, clearCookie: true };
  }
  return { authenticated: true, user: session.user, clearCookie: false };
}

export async function forgetBuilderSession(request, store) {
  const cookie = builderSessionCookieState(request);
  if (cookie.state === "valid") {
    await store.delete(builderSessionKey(cookie.token));
  }
}

export function publicBuilderProfile(user) {
  const normalized = normalizeBuilderUser(user);
  if (!normalized) return null;
  return {
    email: normalized.email,
    name: normalized.name,
    picture: normalized.picture,
  };
}

export function builderSessionCookieState(request) {
  const token = cookieValue(request.headers.get("cookie"), BUILDER_SESSION_COOKIE);
  if (!token) return { state: "missing", token: "" };
  return SESSION_TOKEN_PATTERN.test(token)
    ? { state: "valid", token }
    : { state: "invalid", token: "" };
}

export function builderSessionCookie(token, maxAgeSeconds) {
  if (!SESSION_TOKEN_PATTERN.test(token)) {
    throw new Error("Builder session token is invalid");
  }
  return [
    `${BUILDER_SESSION_COOKIE}=${token}`,
    "Path=/",
    `Max-Age=${positiveInteger(maxAgeSeconds, BUILDER_SESSION_MAX_AGE_SECONDS)}`,
    "HttpOnly",
    "Secure",
    "SameSite=Strict",
  ].join("; ");
}

export function clearBuilderSessionCookie() {
  return [
    `${BUILDER_SESSION_COOKIE}=`,
    "Path=/",
    "Max-Age=0",
    "HttpOnly",
    "Secure",
    "SameSite=Strict",
  ].join("; ");
}

function normalizeBuilderUser(user) {
  const sub = typeof user?.sub === "string" ? user.sub.trim().slice(0, 255) : "";
  const email = normalizeEmail(user?.email);
  if (!sub || !email) return null;
  return {
    sub,
    email,
    name: cleanText(user.name, 120),
    picture: cleanPicture(user.picture),
  };
}

function normalizeEmail(value) {
  if (typeof value !== "string") return "";
  const email = value.trim().toLowerCase();
  if (!email || email.length > 254 || !EMAIL_PATTERN.test(email)) return "";
  return email;
}

function cleanText(value, maxLength) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLength);
}

function cleanPicture(value) {
  if (typeof value !== "string") return "";
  const picture = value.trim();
  if (!picture || picture.length > 2048) return "";
  try {
    const url = new URL(picture);
    return url.protocol === "https:" ? url.href : "";
  } catch {
    return "";
  }
}

function validSessionRecord(value, now) {
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    value.schemaVersion === 1 &&
    normalizeBuilderUser(value.user) !== null &&
    typeof value.createdAt === "string" &&
    typeof value.expiresAt === "string" &&
    validTimestamp(value.createdAt) <= now &&
    validTimestamp(value.expiresAt) > now
  );
}

function sameSessionRecord(stored, expected) {
  return (
    stored &&
    typeof stored === "object" &&
    !Array.isArray(stored) &&
    stored.schemaVersion === expected.schemaVersion &&
    stored.createdAt === expected.createdAt &&
    stored.expiresAt === expected.expiresAt &&
    stored.user?.sub === expected.user.sub &&
    stored.user?.email === expected.user.email &&
    String(stored.user?.name || "") === expected.user.name &&
    String(stored.user?.picture || "") === expected.user.picture
  );
}

function cookieValue(header, name) {
  if (typeof header !== "string" || !header) return "";
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue;
    return part.slice(separator + 1).trim();
  }
  return "";
}

function validTimestamp(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return new Date(Number.NaN);
  return date;
}

function validDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("A valid timestamp is required");
  return date;
}

function positiveInteger(value, fallback) {
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function timestamp(value) {
  const date = value instanceof Date ? value : new Date(value ?? Date.now());
  return date.toISOString();
}

async function deleteQuietly(store, key) {
  try {
    await store.delete(key);
  } catch {
    // Invalid sessions remain unusable even if cleanup fails.
  }
}
