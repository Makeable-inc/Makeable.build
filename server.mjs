import { createServer } from "node:http";
import { appendFile, readFile, mkdir, writeFile, rm, readdir } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import {
  DynamoDBClient,
  GetItemCommand,
  QueryCommand,
  TransactWriteItemsCommand,
  UpdateItemCommand,
} from "@aws-sdk/client-dynamodb";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { WebSocket, WebSocketServer } from "ws";
import { getBoardProfile, supportedBoardSummary } from "./lib/board-profiles.mjs";
import { createGoogleWaitlistResult } from "./lib/acquisition.mjs";
import {
  createPublishCapability,
  verifyPublishCapability,
} from "./lib/publish-capability.mjs";
import { waitlistSignupKey } from "./lib/waitlist-storage.mjs";
import {
  clearWaitlistSessionCookie,
  createWaitlistSession,
  forgetWaitlistSession,
  resolveWaitlistSession,
} from "./lib/waitlist-session.mjs";
import {
  ACACIA_API_BODY_MAX_BYTES,
  acceptAcaciaProposal,
  createAcaciaProgramResponse,
  createAcaciaProposal,
} from "./lib/programs/acacia/service.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const execFileAsync = promisify(execFile);
const initialEnv = getEnv();
const port = Number(initialEnv.PORT || 8787);
const MAX_REQUEST_BYTES = 512 * 1024;
const MAX_SKETCH_BYTES = 96 * 1024;
const MAX_GITHUB_PROJECT_FILES = 12;
const MAX_GITHUB_PROJECT_CONTENT_BYTES = 400 * 1024;
const GITHUB_PROJECT_ARTIFACT_PATHS = new Set([
  "README.md",
  "build-guide/README.md",
  "parts-list/README.md",
  "test-results/README.md",
  "images/finished-build.svg",
  "images/creator-and-build.svg",
]);
const DEFAULT_OPENAI_MODEL = "gpt-5.6-terra";
const DEFAULT_OPENAI_REASONING_EFFORT = "low";
const DEFAULT_OPENAI_SERVICE_TIER = "priority";
const MAX_CONCURRENT_COMPILES = Math.max(1, Number(initialEnv.MAX_CONCURRENT_COMPILES || 2));
const ARDUINO_COMPILE_JOBS = Math.max(1, Number(initialEnv.ARDUINO_COMPILE_JOBS || 1));
const COMPILE_TIMEOUT_MS = Math.max(30000, Number(initialEnv.COMPILE_TIMEOUT_MS || 240000));
const MAX_VOICE_SESSION_MS = Math.max(30000, Number(initialEnv.MAX_VOICE_SESSION_MS || 120000));
const INITIAL_FREE_CREDITS = Math.max(0, Number(initialEnv.INITIAL_FREE_CREDITS || 10));
const dynamodb = new DynamoDBClient({ region: initialEnv.AWS_REGION || "us-east-1" });
const jwksByIssuer = new Map();
const localWaitlistSessions = new Map();
let activeCompiles = 0;
const deepgramWebSocketServer = new WebSocketServer({
  noServer: true,
  maxPayload: 2 * 1024 * 1024,
  perMessageDeflate: false,
  handleProtocols(protocols) {
    return protocols.has("makeable") ? "makeable" : false;
  },
});

const mimeTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
  [".ico", "image/x-icon"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
]);

const server = createServer(async (req, res) => {
  try {
    const env = getEnv();
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    const localApiPath = normalizedLocalApiPath(url.pathname);

    applyCors(req, res, env);
    if (req.method === "OPTIONS") return sendText(res, "", "text/plain; charset=utf-8", 204);

    if (url.pathname === "/config.local.js") {
      return sendText(res, publicConfigScript(env), "text/javascript; charset=utf-8");
    }

    if (url.pathname === "/api/config") {
      return sendJson(res, publicConfig(env));
    }

    if (localApiPath === "/api/waitlist/status") {
      const sessionRequest = localWaitlistSessionRequest(req);
      if (req.method === "GET") {
        const status = await resolveWaitlistSession(sessionRequest, {
          sessionStore: localWaitlistSessionStore,
          signupStore: localWaitlistSignupStore,
        });
        if (status.clearCookie) {
          res.setHeader("Set-Cookie", clearWaitlistSessionCookie());
        }
        return sendJson(res, { joined: status.joined });
      }
      if (req.method === "DELETE") {
        await forgetWaitlistSession(sessionRequest, localWaitlistSessionStore);
        res.setHeader("Set-Cookie", clearWaitlistSessionCookie());
        return sendJson(res, { ok: true });
      }
      res.setHeader("Allow", "GET, DELETE");
      return sendJson(res, { error: "Method not allowed" }, 405);
    }

    if (localApiPath === "/api/waitlist") {
      return sendJson(res, { error: "Email-only waitlist signup is disabled." }, 410);
    }

    if (localApiPath === "/api/auth/google" && req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return sendJson(res, { error: "Method not allowed" }, 405);
    }

    if (localApiPath === "/api/auth/google") {
      return completeLocalGoogleWaitlist(req, res, env);
    }

    if (url.pathname === "/api/account" && req.method === "GET") {
      const user = await requireUser(req, res, env);
      if (!user) return;
      return sendJson(res, await accountSummary(user, env));
    }

    if (
      localApiPath === "/api/programs/nus-acacia" ||
      localApiPath === "/api/programs/acacia"
    ) {
      if (req.method === "GET") {
        return sendJson(res, createAcaciaProgramResponse());
      }
      res.setHeader("Allow", "GET");
      return sendJson(res, { error: "Method not allowed" }, 405);
    }

    if (
      localApiPath === "/api/programs/nus-acacia/proposals" ||
      localApiPath === "/api/programs/acacia/proposals"
    ) {
      if (req.method !== "POST") {
        res.setHeader("Allow", "POST");
        return sendJson(res, { error: "Method not allowed" }, 405);
      }
      const user = await requireUser(req, res, env);
      if (!user) return;
      const body = await readJsonBody(req, ACACIA_API_BODY_MAX_BYTES);
      return sendAcaciaServiceResult(res, createAcaciaProposal(body));
    }

    const acaciaAcceptMatch = localApiPath.match(
      /^\/api\/programs\/(?:nus-acacia|acacia)\/plans\/([^/]+)\/accept$/,
    );
    if (acaciaAcceptMatch) {
      if (req.method !== "POST") {
        res.setHeader("Allow", "POST");
        return sendJson(res, { error: "Method not allowed" }, 405);
      }
      const user = await requireUser(req, res, env);
      if (!user) return;
      const body = await readJsonBody(req, ACACIA_API_BODY_MAX_BYTES);
      return sendAcaciaServiceResult(
        res,
        acceptAcaciaProposal(acaciaAcceptMatch[1], body),
      );
    }

    if (url.pathname === "/api/deepgram/token" && req.method === "POST") {
      const user = await requireUser(req, res, env);
      if (!user) return;
      return createDeepgramToken(res, env);
    }

    if (url.pathname === "/api/openai/responses" && req.method === "POST") {
      const user = await requireUser(req, res, env);
      if (!user || !(await authorizeGeneration(req, res, user, env))) return;
      return proxyOpenAI(req, res, env);
    }

    if (url.pathname === "/api/openai/background" && req.method === "POST") {
      const user = await requireUser(req, res, env);
      if (!user || !(await authorizeGeneration(req, res, user, env))) return;
      return createOpenAIBackgroundResponse(req, res, env);
    }

    const responseMatch = url.pathname.match(/^\/api\/openai\/responses\/([^/]+)$/);
    if (responseMatch && req.method === "GET") {
      const user = await requireUser(req, res, env);
      if (!user || !(await verifyGenerationOwnership(req, res, user, env))) return;
      return retrieveOpenAIResponse(responseMatch[1], res, env);
    }

    if (url.pathname === "/api/esp32/status") {
      return esp32Status(req, res, env);
    }

    if (url.pathname === "/api/firmware/compile" && req.method === "POST") {
      const user = await requireUser(req, res, env);
      if (!user) return;
      return compileFirmware(req, res, env);
    }

    if (url.pathname === "/api/github/repos" && req.method === "POST") {
      const user = await requireUser(req, res, env);
      if (!user) return;
      return createGitHubRepo(req, res, env, user);
    }

    if (url.pathname === "/api/github/upload-file" && req.method === "POST") {
      const user = await requireUser(req, res, env);
      if (!user) return;
      return uploadGitHubFile(req, res, env, user);
    }

    if (url.pathname === "/api/github/publish-project" && req.method === "POST") {
      const user = await requireUser(req, res, env);
      if (!user) return;
      return publishGitHubProject(req, res, env, user);
    }

    if (url.pathname === "/api/health") {
      return sendJson(res, {
        ok: true,
        hasOpenAIKey: Boolean(env.OPENAI_API_KEY),
        hasGithubToken: Boolean(env.GITHUB_TOKEN),
        hasVoice: Boolean(env.DEEPGRAM_API_KEY),
        hasEsp32Compiler: Boolean(findArduinoCli(env)),
        hasAccounts: hasAccountConfig(env),
        hasGoogleSignIn: Boolean(env.GOOGLE_CLIENT_ID),
        hostedMode: true,
        firmwareCompileSupported: Boolean(findArduinoCli(env)),
        supportedBoards: supportedBoardSummary(),
      });
    }

    if (env.NODE_ENV === "production") return sendJson(res, { error: "Not found" }, 404);
    return serveStatic(url, res);
  } catch (error) {
    const status =
      Number.isInteger(error?.statusCode) && error.statusCode >= 400 && error.statusCode < 600
        ? error.statusCode
        : 500;
    if (status === 500) console.error(error);
    return sendJson(
      res,
      {
        error:
          status === 500
            ? "The Makeable server could not complete the request."
            : String(error.message || error),
      },
      status,
    );
  }
});

server.on("upgrade", handleDeepgramUpgrade);

server.listen(port, () => {
  console.log(`Makeable running at http://localhost:${port}`);
});

function handleDeepgramUpgrade(req, socket, head) {
  try {
    const env = getEnv();
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    if (url.pathname !== "/api/deepgram/listen") return rejectUpgrade(socket, 404, "Not found");
    if (!env.DEEPGRAM_API_KEY) return rejectUpgrade(socket, 503, "Voice input is not configured");
    if (!isAllowedBrowserOrigin(String(req.headers.origin || ""), env)) {
      return rejectUpgrade(socket, 403, "Origin not allowed");
    }
    verifyWebSocketUser(req, env)
      .then((user) => {
        if (!user) return rejectUpgrade(socket, 401, "Sign in required");
        deepgramWebSocketServer.handleUpgrade(req, socket, head, (client) => {
          proxyDeepgramWebSocket(client, url, env);
        });
      })
      .catch((error) => {
        console.error("Voice authentication failed", error.message);
        rejectUpgrade(socket, 401, "Sign in required");
      });
  } catch (error) {
    console.error("Deepgram WebSocket upgrade failed", error);
    rejectUpgrade(socket, 500, "Voice connection failed");
  }
}

function proxyDeepgramWebSocket(client, requestUrl, env) {
  const upstreamUrl = new URL("wss://api.deepgram.com/v1/listen");
  const allowedParams = new Set([
    "model",
    "language",
    "smart_format",
    "interim_results",
    "endpointing",
    "utterance_end_ms",
    "vad_events",
    "encoding",
    "sample_rate",
    "channels",
  ]);
  for (const [key, value] of requestUrl.searchParams) {
    if (allowedParams.has(key) && value.length <= 80) upstreamUrl.searchParams.set(key, value);
  }

  const upstream = new WebSocket(upstreamUrl, {
    headers: { Authorization: `Token ${env.DEEPGRAM_API_KEY}` },
    perMessageDeflate: false,
  });
  const pending = [];
  const sessionTimer = setTimeout(() => {
    closeWebSocket(client, 1000, "Voice session complete");
    closeWebSocket(upstream, 1000, "Voice session complete");
  }, MAX_VOICE_SESSION_MS);

  client.on("message", (data, isBinary) => {
    if (upstream.readyState === WebSocket.OPEN) upstream.send(data, { binary: isBinary });
    else if (upstream.readyState === WebSocket.CONNECTING && pending.length < 20) {
      pending.push({ data, isBinary });
    }
  });
  upstream.on("open", () => {
    for (const item of pending.splice(0)) upstream.send(item.data, { binary: item.isBinary });
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({ type: "MakeableVoiceReady" }));
    }
  });
  upstream.on("message", (data, isBinary) => {
    if (client.readyState === WebSocket.OPEN) client.send(data, { binary: isBinary });
  });
  upstream.on("unexpected-response", (_request, response) => {
    console.error(`Deepgram rejected the voice connection with HTTP ${response.statusCode}`);
    closeWebSocket(client, 1011, "Voice service rejected the connection");
  });
  upstream.on("error", (error) => {
    console.error("Deepgram WebSocket error", error.message);
    closeWebSocket(client, 1011, "Voice service unavailable");
  });
  client.on("error", () => closeWebSocket(upstream, 1000, "Browser connection ended"));
  client.on("close", () => {
    clearTimeout(sessionTimer);
    closeWebSocket(upstream, 1000, "Browser connection ended");
  });
  upstream.on("close", (code, reason) => {
    clearTimeout(sessionTimer);
    closeWebSocket(client, code === 1000 ? 1000 : 1011, reason.toString().slice(0, 100));
  });
}

function rejectUpgrade(socket, status, message) {
  if (socket.destroyed) return;
  const body = String(message || "Connection rejected");
  socket.write(
    `HTTP/1.1 ${status} ${body}\r\nConnection: close\r\nContent-Type: text/plain\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`,
  );
  socket.destroy();
}

function closeWebSocket(socket, code, reason) {
  if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
    socket.close(code, reason);
  }
}

function getEnv() {
  return { ...readEnv(path.join(__dirname, ".env")), ...process.env };
}

function readEnv(filePath) {
  if (!existsSync(filePath)) return {};
  const raw = readFileSync(filePath, "utf8");
  const output = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    output[key] = value;
  }
  return output;
}

function publicConfig(env) {
  const config = {
    githubOwner: env.GITHUB_OWNER || "",
    openaiModel: env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL,
    openaiReasoningModel: env.OPENAI_REASONING_MODEL || DEFAULT_OPENAI_MODEL,
    openaiReasoningEffort: env.OPENAI_REASONING_EFFORT || DEFAULT_OPENAI_REASONING_EFFORT,
    openaiServiceTier: openAIServiceTier(env),
    hasOpenAIKey: Boolean(env.OPENAI_API_KEY),
    hasGithubToken: Boolean(env.GITHUB_TOKEN),
    hasEsp32Compiler: Boolean(findArduinoCli(env)),
    hasVoice: Boolean(env.DEEPGRAM_API_KEY),
    hasAccounts: hasAccountConfig(env),
    cognitoDomain: env.COGNITO_DOMAIN || "",
    cognitoClientId: env.COGNITO_CLIENT_ID || "",
    cognitoRedirectUri: env.COGNITO_REDIRECT_URI || "",
    googleClientId: env.GOOGLE_CLIENT_ID || "",
    hasGoogleSignIn: Boolean(env.GOOGLE_CLIENT_ID),
    githubAtomicPublishSupported: true,
    hostedMode: true,
    firmwareCompileSupported: Boolean(findArduinoCli(env)),
    supportedBoards: supportedBoardSummary(),
  };
  return config;
}

function normalizedLocalApiPath(pathname) {
  let normalized = pathname.replace(/\/+$/, "");
  if (normalized.endsWith(".html")) normalized = normalized.slice(0, -5);
  return normalized;
}

async function completeLocalGoogleWaitlist(req, res, env) {
  if (!env.GOOGLE_CLIENT_ID) {
    return sendJson(res, { error: "Google sign-in is not configured." }, 503);
  }
  const body = await readJsonBody(req, 20 * 1024);
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    typeof body.credential !== "string" ||
    !body.credential ||
    body.credential.length > 16_384 ||
    typeof body.intent !== "string" ||
    Object.keys(body).some((key) => !["credential", "intent"].includes(key))
  ) {
    return sendJson(res, { error: "Google sign-in request is invalid." }, 400);
  }

  let identity;
  try {
    const { OAuth2Client } = await import("google-auth-library");
    const client = new OAuth2Client(env.GOOGLE_CLIENT_ID);
    const ticket = await client.verifyIdToken({
      idToken: body.credential,
      audience: env.GOOGLE_CLIENT_ID,
    });
    identity = ticket.getPayload();
  } catch {
    return sendJson(res, { error: "Google could not verify this sign-in." }, 401);
  }

  const result = createGoogleWaitlistResult(identity, body.intent);
  if (!result.ok) {
    return sendJson(res, { error: result.error }, result.status);
  }
  await saveLocalWaitlistRecord(result.value.record);
  const confirmation = await createWaitlistSession(
    localWaitlistSessionStore,
    waitlistSignupKey(result.value.record.email),
  );
  res.setHeader("Set-Cookie", confirmation.cookie);
  return sendJson(res, { ok: true, user: result.value.user });
}

async function saveLocalWaitlistRecord(record) {
  const directory = path.join(__dirname, "data");
  const filePath = path.join(directory, "waitlist.jsonl");
  await mkdir(directory, { recursive: true });
  try {
    const existing = await readFile(filePath, "utf8");
    const duplicate = existing
      .split(/\r?\n/)
      .filter(Boolean)
      .some((line) => {
        try {
          return JSON.parse(line).email === record.email;
        } catch {
          return false;
        }
      });
    if (duplicate) return;
  } catch {
    // The first signup creates the local data file.
  }
  await appendFile(filePath, `${JSON.stringify(record)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}

const localWaitlistSessionStore = {
  async set(key, value) {
    localWaitlistSessions.set(key, JSON.parse(await value.text()));
    return { modified: true };
  },
  async get(key) {
    return localWaitlistSessions.get(key) || null;
  },
  async delete(key) {
    localWaitlistSessions.delete(key);
  },
};

const localWaitlistSignupStore = {
  async get(key) {
    const filePath = path.join(__dirname, "data", "waitlist.jsonl");
    try {
      const contents = await readFile(filePath, "utf8");
      for (const line of contents.split(/\r?\n/).filter(Boolean)) {
        try {
          const record = JSON.parse(line);
          if (waitlistSignupKey(record.email) === key) return record;
        } catch {
          // Skip malformed local development records.
        }
      }
    } catch {
      // No local signups have been recorded yet.
    }
    return null;
  },
};

function localWaitlistSessionRequest(req) {
  return new Request(`http://${req.headers.host || "localhost"}/api/waitlist/status`, {
    headers: { Cookie: String(req.headers.cookie || "") },
  });
}

function applyCors(req, res, env) {
  const origin = String(req.headers.origin || "");
  if (isAllowedBrowserOrigin(origin, env)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Makeable-Generation-Id");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Cache-Control", "no-store");
}

function isAllowedBrowserOrigin(origin, env) {
  const configured = String(env.ALLOWED_ORIGINS || "https://makeable.build,https://www.makeable.build")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const localOrigin = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  return configured.includes(origin) || localOrigin;
}

function hasAccountConfig(env) {
  return Boolean(
    env.COGNITO_USER_POOL_ID &&
      env.COGNITO_CLIENT_ID &&
      env.CREDIT_ACCOUNTS_TABLE &&
      env.CREDIT_LEDGER_TABLE,
  );
}

function cognitoIssuer(env) {
  const region = env.AWS_REGION || "us-east-1";
  return `https://cognito-idp.${region}.amazonaws.com/${env.COGNITO_USER_POOL_ID}`;
}

async function verifyAccessToken(token, env) {
  if (!hasAccountConfig(env)) throw new Error("Account service is not configured");
  const issuer = cognitoIssuer(env);
  let jwks = jwksByIssuer.get(issuer);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));
    jwksByIssuer.set(issuer, jwks);
  }
  const { payload } = await jwtVerify(token, jwks, { issuer });
  if (payload.token_use !== "access" || payload.client_id !== env.COGNITO_CLIENT_ID) {
    throw new Error("Invalid access token");
  }
  if (!payload.sub) throw new Error("Access token has no subject");
  return {
    userId: String(payload.sub),
    username: String(payload.username || payload["cognito:username"] || "Maker"),
  };
}

async function requireUser(req, res, env) {
  if (env.NODE_ENV === "test" && env.MAKEABLE_TEST_AUTH_BYPASS === "1") {
    return { userId: "compiler-integration-test", username: "compiler-integration-test" };
  }
  if (!hasAccountConfig(env) && isTrustedLocalDevelopmentRequest(req)) {
    return { userId: "local-development", username: "Local maker", localDevelopment: true };
  }
  const match = String(req.headers.authorization || "").match(/^Bearer\s+(.+)$/i);
  if (!match) {
    sendJson(res, { error: "Sign in to continue." }, 401);
    return null;
  }
  try {
    const user = await verifyAccessToken(match[1], env);
    await ensureCreditAccount(user, env);
    return user;
  } catch (error) {
    console.error("Authentication failed", error.message);
    sendJson(res, { error: "Your sign-in expired. Please sign in again." }, 401);
    return null;
  }
}

function isLoopbackRequest(req) {
  const remoteAddress = String(req.socket?.remoteAddress || "");
  const host = String(req.headers.host || "");
  const loopbackAddress = remoteAddress === "127.0.0.1" || remoteAddress === "::1" || remoteAddress === "::ffff:127.0.0.1";
  const loopbackHost = /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(host);
  return loopbackAddress && loopbackHost;
}

function isTrustedLocalDevelopmentRequest(req) {
  if (!isLoopbackRequest(req)) return false;

  const method = String(req.method || "GET").toUpperCase();
  const origin = String(req.headers.origin || "").trim();
  const fetchSite = String(req.headers["sec-fetch-site"] || "").trim().toLowerCase();
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") return false;

  if (origin) {
    try {
      const parsedOrigin = new URL(origin);
      const sameHost = parsedOrigin.host.toLowerCase() === String(req.headers.host || "").toLowerCase();
      const loopbackOrigin = /^(?:localhost|127\.0\.0\.1|\[::1\])$/i.test(parsedOrigin.hostname);
      if (!sameHost || !loopbackOrigin || !/^https?:$/.test(parsedOrigin.protocol)) return false;
    } catch {
      return false;
    }
  } else if (method !== "GET" && method !== "HEAD") {
    return false;
  }

  if (method !== "GET" && method !== "HEAD") {
    const contentType = String(req.headers["content-type"] || "").split(";", 1)[0].trim().toLowerCase();
    if (contentType !== "application/json") return false;
  }
  return true;
}

async function verifyWebSocketUser(req, env) {
  const protocols = String(req.headers["sec-websocket-protocol"] || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const token = protocols.find((value) => value !== "makeable");
  if (!token) return null;
  const user = await verifyAccessToken(token, env);
  await ensureCreditAccount(user, env);
  return user;
}

async function ensureCreditAccount(user, env) {
  const now = new Date().toISOString();
  try {
    await dynamodb.send(
      new TransactWriteItemsCommand({
        TransactItems: [
          {
            Put: {
              TableName: env.CREDIT_ACCOUNTS_TABLE,
              Item: {
                userId: { S: user.userId },
                username: { S: user.username },
                credits: { N: String(INITIAL_FREE_CREDITS) },
                createdAt: { S: now },
                updatedAt: { S: now },
              },
              ConditionExpression: "attribute_not_exists(userId)",
            },
          },
          {
            Put: {
              TableName: env.CREDIT_LEDGER_TABLE,
              Item: {
                userId: { S: user.userId },
                entryId: { S: "welcome" },
                delta: { N: String(INITIAL_FREE_CREDITS) },
                kind: { S: "welcome" },
                createdAt: { S: now },
              },
              ConditionExpression: "attribute_not_exists(userId) AND attribute_not_exists(entryId)",
            },
          },
        ],
      }),
    );
  } catch (error) {
    if (error.name !== "TransactionCanceledException") throw error;
  }
}

async function getCreditAccount(userId, env) {
  const result = await dynamodb.send(
    new GetItemCommand({
      TableName: env.CREDIT_ACCOUNTS_TABLE,
      Key: { userId: { S: userId } },
      ConsistentRead: true,
    }),
  );
  return result.Item || null;
}

async function accountSummary(user, env) {
  const [account, ledger] = await Promise.all([
    getCreditAccount(user.userId, env),
    dynamodb.send(
      new QueryCommand({
        TableName: env.CREDIT_LEDGER_TABLE,
        KeyConditionExpression: "userId = :userId",
        ExpressionAttributeValues: { ":userId": { S: user.userId } },
        ScanIndexForward: false,
        Limit: 20,
      }),
    ),
  ]);
  return {
    user: { id: user.userId, username: user.username },
    credits: Number(account?.credits?.N || 0),
    freeCreditsGranted: INITIAL_FREE_CREDITS,
    usage: (ledger.Items || []).map((item) => ({
      id: item.entryId?.S || "",
      delta: Number(item.delta?.N || 0),
      kind: item.kind?.S || "generation",
      createdAt: item.createdAt?.S || "",
    })),
  };
}

async function authorizeGeneration(req, res, user, env) {
  const generationId = String(req.headers["x-makeable-generation-id"] || "").trim();
  if (!/^[a-zA-Z0-9_-]{8,100}$/.test(generationId)) {
    sendJson(res, { error: "A valid generation id is required." }, 400);
    return false;
  }
  if (user.localDevelopment === true) return true;
  const entryId = `generation#${generationId}`;
  const now = new Date().toISOString();
  try {
    await dynamodb.send(
      new TransactWriteItemsCommand({
        TransactItems: [
          {
            Update: {
              TableName: env.CREDIT_ACCOUNTS_TABLE,
              Key: { userId: { S: user.userId } },
              UpdateExpression: "SET updatedAt = :now ADD credits :minusOne",
              ConditionExpression: "attribute_exists(userId) AND credits >= :one",
              ExpressionAttributeValues: {
                ":now": { S: now },
                ":minusOne": { N: "-1" },
                ":one": { N: "1" },
              },
            },
          },
          {
            Put: {
              TableName: env.CREDIT_LEDGER_TABLE,
              Item: {
                userId: { S: user.userId },
                entryId: { S: entryId },
                delta: { N: "-1" },
                kind: { S: "generation" },
                providerCalls: { N: "1" },
                createdAt: { S: now },
              },
              ConditionExpression: "attribute_not_exists(userId) AND attribute_not_exists(entryId)",
            },
          },
        ],
      }),
    );
    return true;
  } catch (error) {
    if (error.name !== "TransactionCanceledException") throw error;
    const prior = await dynamodb.send(
      new GetItemCommand({
        TableName: env.CREDIT_LEDGER_TABLE,
        Key: { userId: { S: user.userId }, entryId: { S: entryId } },
        ConsistentRead: true,
      }),
    );
    if (prior.Item) {
      try {
        await dynamodb.send(
          new UpdateItemCommand({
            TableName: env.CREDIT_LEDGER_TABLE,
            Key: { userId: { S: user.userId }, entryId: { S: entryId } },
            UpdateExpression: "ADD providerCalls :one",
            ConditionExpression: "attribute_not_exists(providerCalls) OR providerCalls < :maxCalls",
            ExpressionAttributeValues: {
              ":one": { N: "1" },
              ":maxCalls": { N: "3" },
            },
          }),
        );
        return true;
      } catch (updateError) {
        if (updateError.name !== "ConditionalCheckFailedException") throw updateError;
        sendJson(res, { error: "This generation has reached its provider-call limit." }, 429);
        return false;
      }
    }
    sendJson(res, { error: "You have no generation credits left." }, 402);
    return false;
  }
}

async function verifyGenerationOwnership(req, res, user, env) {
  const generationId = String(req.headers["x-makeable-generation-id"] || "").trim();
  if (!/^[a-zA-Z0-9_-]{8,100}$/.test(generationId)) {
    sendJson(res, { error: "A valid generation id is required." }, 400);
    return false;
  }
  if (user.localDevelopment === true) return true;
  const result = await dynamodb.send(
    new GetItemCommand({
      TableName: env.CREDIT_LEDGER_TABLE,
      Key: { userId: { S: user.userId }, entryId: { S: `generation#${generationId}` } },
      ConsistentRead: true,
    }),
  );
  if (result.Item) return true;
  sendJson(res, { error: "This generation does not belong to your account." }, 403);
  return false;
}

async function createDeepgramToken(res, env) {
  if (!env.DEEPGRAM_API_KEY) {
    return sendJson(res, { error: "Voice input is not configured." }, 503);
  }
  const upstream = await fetch("https://api.deepgram.com/v1/auth/grant", {
    method: "POST",
    headers: {
      Authorization: `Token ${env.DEEPGRAM_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ttl_seconds: 60 }),
  });
  return pipeJson(upstream, res);
}

function publicConfigScript(env) {
  const config = publicConfig(env);
  return `window.MAKEABLE_CONFIG = ${JSON.stringify(config)};`;
}

async function serveStatic(url, res) {
  const { pathname, search } = url;
  if (pathname === "/index.html") {
    res.writeHead(302, {
      Location: `/${search}`,
      "Cache-Control": "no-store",
    });
    res.end();
    return;
  }

  if (pathname === "/pilot/") {
    res.writeHead(302, {
      Location: `/pilot${search}`,
      "Cache-Control": "no-store",
    });
    res.end();
    return;
  }

  if (pathname === "/ember/") {
    res.writeHead(302, {
      Location: `/ember${search}`,
      "Cache-Control": "no-store",
    });
    res.end();
    return;
  }

  if (pathname === "/privacy/" || pathname === "/privacy") {
    return serveFile("/privacy/index.html", res);
  }

  if (pathname === "/terms/" || pathname === "/terms") {
    return serveFile("/terms/index.html", res);
  }

  if (pathname === "/ember") {
    return serveFile("/ember/index.html", res);
  }

  if (pathname === "/downloads/ember-macos.dmg") {
    return serveFile(
      "/ESP32_CYD_Case/claude-burner-desktop/release/Claude Burner-1.0.12-arm64.dmg",
      res,
    );
  }

  const safePath =
    pathname === "/"
      ? "/index.html"
      : pathname === "/pilot"
        ? "/pilot/index.html"
        : decodeURIComponent(pathname);
  return serveFile(safePath, res);
}

async function serveFile(safePath, res) {
  const filePath = path.normalize(path.join(__dirname, safePath));
  const relativePath = path.relative(__dirname, filePath);

  if (
    relativePath.startsWith("..") ||
    path.isAbsolute(relativePath) ||
    path.basename(filePath).startsWith(".")
  ) {
    return sendText(res, "Not found", "text/plain; charset=utf-8", 404);
  }

  try {
    const data = await readFile(filePath);
    const contentType = mimeTypes.get(path.extname(filePath)) || "application/octet-stream";
    res.writeHead(200, { "Content-Type": contentType });
    res.end(data);
  } catch {
    sendText(res, "Not found", "text/plain; charset=utf-8", 404);
  }
}

function resolvePublicFile(pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return "";
  }
  const segments = decoded.split(/[\\/]+/).filter(Boolean);
  if (segments.some((segment) => segment.startsWith("."))) return "";
  if (pathname === "/" || pathname.startsWith("/build/")) {
    return path.join(__dirname, "index.html");
  }
  if (segments.length === 1 && publicRootFiles.has(segments[0])) {
    return path.join(__dirname, segments[0]);
  }

  const [publicRoot, ...relativeSegments] = segments;
  const allowedRoot =
    publicRoot === "src"
      ? relativeSegments.shift() === "makeable"
        ? publicDirectoryRoots.get("src")
        : ""
      : publicDirectoryRoots.get(publicRoot);
  if (!allowedRoot || !relativeSegments.length) return "";

  const filePath = path.resolve(allowedRoot, ...relativeSegments);
  const relativePath = path.relative(allowedRoot, filePath);
  if (!relativePath || relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    return "";
  }
  return filePath;
}

async function proxyOpenAI(req, res, env) {
  if (!env.OPENAI_API_KEY) return sendJson(res, { error: "OPENAI_API_KEY is missing in .env" }, 401);

  const body = await readJsonBody(req);
  body.model = env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL;
  body.service_tier = openAIServiceTier(env);

  const upstream = await requestOpenAIResponse(body, env);

  const text = await upstream.text();
  res.writeHead(upstream.status, {
    "Content-Type": upstream.headers.get("content-type") || "application/json; charset=utf-8",
  });
  res.end(text);
}

async function createOpenAIBackgroundResponse(req, res, env) {
  if (!env.OPENAI_API_KEY) return sendJson(res, { error: "OPENAI_API_KEY is missing in .env" }, 401);

  const body = await readJsonBody(req);
  const payload = {
    ...body,
    model: env.OPENAI_REASONING_MODEL || env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL,
    service_tier: openAIServiceTier(env),
    background: true,
    store: body.store ?? true,
  };
  delete payload.stream;

  const upstream = await requestOpenAIResponse(payload, env);
  return pipeJson(upstream, res);
}

function openAIServiceTier(env) {
  const tier = String(env.OPENAI_SERVICE_TIER || DEFAULT_OPENAI_SERVICE_TIER).toLowerCase();
  return ["auto", "default", "flex", "priority"].includes(tier)
    ? tier
    : DEFAULT_OPENAI_SERVICE_TIER;
}

async function requestOpenAIResponse(payload, env) {
  const upstream = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: openAIHeaders(env),
    body: JSON.stringify(payload),
  });
  if (openAIServiceTier(env) !== "priority" || upstream.ok) return upstream;

  const failure = await upstream.clone().text();
  if (!/service[_\s-]*tier|priority.*(?:unavailable|not enabled|not supported)/i.test(failure)) {
    return upstream;
  }

  console.warn("OpenAI priority tier is unavailable; retrying this request on the standard tier.");
  return fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: openAIHeaders(env),
    body: JSON.stringify({ ...payload, service_tier: "default" }),
  });
}

async function retrieveOpenAIResponse(responseId, res, env) {
  if (!env.OPENAI_API_KEY) return sendJson(res, { error: "OPENAI_API_KEY is missing in .env" }, 401);

  const id = encodeURIComponent(decodeURIComponent(responseId));
  const upstream = await fetch(`https://api.openai.com/v1/responses/${id}`, {
    headers: openAIHeaders(env),
  });
  return pipeJson(upstream, res);
}

function openAIHeaders(env) {
  return {
    Authorization: `Bearer ${env.OPENAI_API_KEY}`,
    "Content-Type": "application/json",
  };
}

async function esp32Status(req, res, env) {
  const cliPath = findArduinoCli(env);
  if (!cliPath) {
    return sendJson(res, {
      hasEsp32Compiler: false,
      hasEsp32Core: false,
      hostedMode: true,
      firmwareCompileSupported: false,
      message: "The hosted firmware compiler is temporarily unavailable.",
    });
  }

  try {
    const [versionResult, coreResult] = await Promise.all([
      execFileAsync(cliPath, ["version"], { timeout: 15000, maxBuffer: 2 * 1024 * 1024 }),
      execFileAsync(cliPath, ["core", "list"], { timeout: 30000, maxBuffer: 4 * 1024 * 1024 }),
    ]);
    return sendJson(res, {
      hasEsp32Compiler: true,
      hasEsp32Core: /\besp32:esp32\b/.test(coreResult.stdout),
      hostedMode: true,
      firmwareCompileSupported: true,
      supportedBoards: supportedBoardSummary(),
      version: versionResult.stdout.trim(),
      cores: coreResult.stdout.trim(),
    });
  } catch (error) {
    return sendJson(
      res,
      {
        hasEsp32Compiler: true,
        hasEsp32Core: false,
        error: error.message,
        stderr: error.stderr || "",
      },
      500,
    );
  }
}

async function compileFirmware(req, res, env) {
  const cliPath = findArduinoCli(env);
  if (!cliPath) {
    return sendJson(res, { error: "The hosted firmware compiler is temporarily unavailable." }, 503);
  }

  if (activeCompiles >= MAX_CONCURRENT_COMPILES) {
    res.setHeader("Retry-After", "5");
    return sendJson(res, { error: "The compiler is busy. Please retry in a few seconds." }, 429);
  }

  const body = await readJsonBody(req, MAX_REQUEST_BYTES);
  const sketch = String(body.sketch || "").trim();
  if (!sketch) return sendJson(res, { error: "sketch is required" }, 400);
  if (Buffer.byteLength(sketch, "utf8") > MAX_SKETCH_BYTES) {
    return sendJson(res, { error: "The generated firmware is too large to compile safely." }, 413);
  }

  const profile = getBoardProfile(body.boardProfile || body.fqbn || "esp32");
  if (!profile) return sendJson(res, { error: "Unsupported board profile." }, 400);
  const fqbn = profile.fqbn;
  const sketchName = "MakeableSketch";
  const buildRoot = path.join(__dirname, ".makeable", "builds", randomUUID());
  const sketchDir = path.join(buildRoot, sketchName);
  const outputDir = path.join(buildRoot, "out");

  activeCompiles += 1;

  try {
    await mkdir(sketchDir, { recursive: true });
    await mkdir(outputDir, { recursive: true });
    await writeFile(path.join(sketchDir, `${sketchName}.ino`), sketch, "utf8");
    const args = [
      "compile",
      "--jobs",
      String(ARDUINO_COMPILE_JOBS),
      "--fqbn",
      fqbn,
      "--build-path",
      outputDir,
      sketchDir,
    ];
    const compileResult = await execFileAsync(cliPath, args, {
      cwd: buildRoot,
      timeout: COMPILE_TIMEOUT_MS,
      maxBuffer: 24 * 1024 * 1024,
    });
    const images = await collectFirmwareImages(outputDir, sketchName, profile, env);
    if (!images.length) {
      return sendJson(
        res,
        {
          error: "Compile succeeded, but no flashable .bin files were found.",
          stdout: compileResult.stdout,
          stderr: compileResult.stderr,
        },
        500,
      );
    }
    return sendJson(res, {
      ok: true,
      board: profile.id,
      fqbn: profile.fqbn,
      flashConfig: {
        mode: profile.flashMode,
        frequency: profile.flashFrequency,
        size: profile.flashSize,
      },
      images,
      compiler: "arduino-cli",
    });
  } catch (error) {
    const compilerDetails = sanitizeCompilerError(
      [error.stdout, error.stderr, error.message].filter(Boolean).join("\n"),
    );
    console.error("Firmware compile failed", compilerDetails);
    return sendJson(
      res,
      {
        error: "The generated firmware did not compile for this board.",
        details: compilerDetails,
      },
      500,
    );
  } finally {
    activeCompiles -= 1;
    await rm(buildRoot, { recursive: true, force: true });
  }
}

function sanitizeCompilerError(value) {
  return String(value || "")
    .replaceAll(__dirname, "<workspace>")
    .replace(/\/[^\s:]+\/\.makeable\/builds\/[^\s:]+/g, "<build>")
    .slice(-4000);
}

function findArduinoCli(env) {
  const candidates = [
    env.ARDUINO_CLI_PATH,
    path.join(__dirname, ".makeable/toolchain/bin/arduino-cli"),
    "/opt/homebrew/bin/arduino-cli",
    "/usr/local/bin/arduino-cli",
  ].filter(Boolean);
  return candidates.find((candidate) => existsSync(candidate)) || "";
}

async function collectFirmwareImages(outputDir, sketchName, profile, env) {
  const files = await walkFiles(outputDir);
  const binFiles = files.filter((filePath) => filePath.endsWith(".bin"));
  const bootApp0 =
    findByPattern(binFiles, [/boot_app0\.bin$/i]) || (await findBootApp0Bin(files, env));
  const flashArgs = files.find((filePath) => path.basename(filePath) === "flash_args");
  if (flashArgs) {
    const manifestImages = await firmwareImagesFromFlashArgs(flashArgs, binFiles, bootApp0, sketchName);
    if (manifestImages.length) return manifestImages;
  }

  const bootloader = findByPattern(binFiles, [/bootloader.*\.bin$/i]);
  const partitions = findByPattern(binFiles, [/\.partitions\.bin$/i, /partitions.*\.bin$/i]);
  const app =
    findByPattern(binFiles, [new RegExp(`${sketchName}\\.ino\\.bin$`, "i")]) ||
    findByPattern(binFiles, [/\.ino\.bin$/i]);

  if (bootloader && partitions && bootApp0 && app) {
    const bootloaderAddress = profile?.id === "esp32" ? 0x1000 : 0x0;
    return Promise.all([
      firmwareImage(bootloader, bootloaderAddress, "Bootloader"),
      firmwareImage(partitions, 0x8000, "Partition table"),
      firmwareImage(bootApp0, 0xe000, "Boot app"),
      firmwareImage(app, 0x10000, "Application"),
    ]);
  }

  const merged = findByPattern(binFiles, [/\.merged\.bin$/i, /\.factory\.bin$/i, /merged/i]);
  return merged ? [await firmwareImage(merged, 0x0, "Merged ESP32 firmware")] : [];
}

async function firmwareImagesFromFlashArgs(flashArgsPath, binFiles, bootApp0, sketchName) {
  const binFileByName = new Map(binFiles.map((filePath) => [path.basename(filePath), filePath]));
  const entries = [];
  const seenAddresses = new Set();
  const flashArgs = await readFile(flashArgsPath, "utf8");

  for (const line of flashArgs.split(/\r?\n/)) {
    const match = line.trim().match(/^(0x[0-9a-f]+)\s+(.+\.bin)$/i);
    if (!match) continue;
    const address = Number.parseInt(match[1], 16);
    let fileName = match[2].trim();
    if (
      (fileName.startsWith('"') && fileName.endsWith('"')) ||
      (fileName.startsWith("'") && fileName.endsWith("'"))
    ) {
      fileName = fileName.slice(1, -1);
    }
    if (
      !Number.isSafeInteger(address) ||
      address < 0 ||
      address > 0x10000000 ||
      path.basename(fileName) !== fileName ||
      seenAddresses.has(address)
    ) {
      return [];
    }
    const filePath =
      binFileByName.get(fileName) ||
      (fileName.toLowerCase() === "boot_app0.bin" ? bootApp0 : "");
    if (!filePath) return [];
    seenAddresses.add(address);
    entries.push({
      address,
      filePath,
      label: firmwareSegmentLabel(fileName, sketchName),
    });
  }

  if (entries.length < 3) return [];
  entries.sort((left, right) => left.address - right.address);
  return Promise.all(
    entries.map(({ filePath, address, label }) => firmwareImage(filePath, address, label)),
  );
}

async function walkFiles(dir) {
  const output = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      output.push(...(await walkFiles(entryPath)));
    } else {
      output.push(entryPath);
    }
  }
  return output;
}

function findByPattern(files, patterns) {
  return files.find((filePath) => patterns.some((pattern) => pattern.test(path.basename(filePath))));
}

async function findBootApp0Bin(files, env) {
  const candidates = [];
  const buildOptionsPath = files.find(
    (filePath) => path.basename(filePath) === "build.options.json",
  );
  if (buildOptionsPath) {
    try {
      const buildOptions = JSON.parse(await readFile(buildOptionsPath, "utf8"));
      for (const hardwareFolder of String(buildOptions.hardwareFolders || "").split(",")) {
        if (hardwareFolder.trim()) {
          candidates.push(path.join(hardwareFolder.trim(), "tools/partitions/boot_app0.bin"));
        }
      }
    } catch {
      // Fall through to the known Arduino data locations below.
    }
  }

  const home = env?.HOME || process.env.HOME || "";
  const dataRoots = [
    env?.ARDUINO_DIRECTORIES_DATA,
    path.join(__dirname, ".makeable/toolchain/data"),
    home ? path.join(home, "Library/Arduino15") : "",
    home ? path.join(home, ".arduino15") : "",
    "/opt/arduino/data",
  ].filter(Boolean);
  for (const dataRoot of dataRoots) {
    candidates.push(
      path.join(
        dataRoot,
        "packages/esp32/hardware/esp32/3.3.5/tools/partitions/boot_app0.bin",
      ),
      path.join(
        dataRoot,
        "packages/arduino/hardware/esp32/2.0.18-arduino.5/tools/partitions/boot_app0.bin",
      ),
    );
  }

  return candidates.find((candidate) => existsSync(candidate)) || "";
}

function firmwareSegmentLabel(fileName, sketchName) {
  if (/bootloader.*\.bin$/i.test(fileName)) return "Bootloader";
  if (/partitions.*\.bin$/i.test(fileName)) return "Partition table";
  if (/boot_app0\.bin$/i.test(fileName)) return "Boot app";
  if (new RegExp(`^${sketchName}\\.ino\\.bin$`, "i").test(fileName)) return "Application";
  return "Firmware segment";
}

async function firmwareImage(filePath, address, label) {
  const data = await readFile(filePath);
  return {
    name: path.basename(filePath),
    label,
    address,
    size: data.length,
    dataBase64: data.toString("base64"),
  };
}

async function createGitHubRepo(req, res, env, user) {
  if (!env.GITHUB_TOKEN) {
    return sendJson(res, { error: "GITHUB_TOKEN is missing in .env" }, 401);
  }
  const body = await readJsonBody(req);
  const upstream = await fetch(`${githubApiOrigin(env)}/user/repos`, {
    method: "POST",
    headers: githubHeaders(env),
    body: JSON.stringify({
      name: body.name,
      description: body.description || "Hardware project generated with Makeable",
      private: Boolean(body.private),
      // GitHub cannot create refs in a completely empty repository. A benign
      // initial commit lets the later multi-file publish advance one ref only
      // after every consented file and the README are ready.
      auto_init: true,
    }),
  });
  const text = await upstream.text();
  if (!upstream.ok) {
    res.writeHead(upstream.status, {
      "Content-Type": upstream.headers.get("content-type") || "application/json; charset=utf-8",
    });
    res.end(text);
    return;
  }
  const repository = JSON.parse(text);
  const owner = String(repository?.owner?.login || env.GITHUB_OWNER || "");
  const repositoryName = String(repository?.name || body.name || "");
  return sendJson(res, {
    ...repository,
    publishCapability: createPublishCapability(
      { userId: user.userId, owner, repositoryName },
      env.GITHUB_TOKEN,
    ),
  }, upstream.status);
}

async function uploadGitHubFile(req, res, env, user) {
  if (!env.GITHUB_TOKEN) {
    return sendJson(res, { error: "GITHUB_TOKEN is missing in .env" }, 401);
  }
  const body = await readJsonBody(req);
  const owner = body.owner || env.GITHUB_OWNER;
  const repo = body.repo;
  const filePath = body.path;
  if (!owner || !repo || !filePath) {
    return sendJson(res, { error: "owner, repo, and path are required" }, 400);
  }
  if (!isAllowedGitHubProjectArtifactPath(filePath)) {
    return sendJson(res, { error: `Path is not an allowed Makeable project artifact: ${filePath}` }, 400);
  }
  if (
    !verifyPublishCapability(
      body.publishCapability,
      { userId: user.userId, owner, repositoryName: repo },
      env.GITHUB_TOKEN,
    )
  ) {
    return sendJson(res, { error: "This GitHub upload authorization is missing or expired." }, 403);
  }

  const encodedPath = filePath.split("/").map(encodeURIComponent).join("/");
  const branchQuery = body.branch ? `?ref=${encodeURIComponent(body.branch)}` : "";
  const apiOrigin = githubApiOrigin(env);
  let sha;
  const existing = await fetch(
    `${apiOrigin}/repos/${owner}/${repo}/contents/${encodedPath}${branchQuery}`,
    { headers: githubHeaders(env) },
  );
  if (existing.ok) {
    const existingJson = await existing.json();
    sha = existingJson.sha;
  } else if (existing.status !== 404) {
    return pipeJson(existing, res);
  }

  const payload = {
    message: body.message || `Update ${filePath}`,
    content: Buffer.from(body.content || "", "utf8").toString("base64"),
    ...(body.branch ? { branch: body.branch } : {}),
    ...(sha ? { sha } : {}),
  };

  const upstream = await fetch(
    `${apiOrigin}/repos/${owner}/${repo}/contents/${encodedPath}`,
    {
      method: "PUT",
      headers: githubHeaders(env),
      body: JSON.stringify(payload),
    },
  );
  return pipeJson(upstream, res);
}

async function publishGitHubProject(req, res, env, user) {
  if (!env.GITHUB_TOKEN) {
    return sendJson(res, { error: "GITHUB_TOKEN is missing in .env" }, 401);
  }

  const body = await readJsonBody(req);
  const owner = String(body.owner || env.GITHUB_OWNER || "").trim();
  const repo = String(body.repo || "").trim();
  if (!owner || !repo) {
    return sendJson(res, { error: "owner and repo are required" }, 400);
  }
  if (!isValidGitHubOwner(owner) || !isValidGitHubRepositoryName(repo)) {
    return sendJson(res, { error: "owner or repo is not a valid GitHub name" }, 400);
  }
  if (
    !verifyPublishCapability(
      body.publishCapability,
      { userId: user.userId, owner, repositoryName: repo },
      env.GITHUB_TOKEN,
    )
  ) {
    return sendJson(res, { error: "This GitHub upload authorization is missing or expired." }, 403);
  }

  const fileResult = normalizedGitHubProjectFiles(body.files);
  if (fileResult.error) return sendJson(res, { error: fileResult.error }, 400);

  if (body.branch !== undefined && typeof body.branch !== "string") {
    return sendJson(res, { error: "branch must be a string" }, 400);
  }
  const requestedBranch = String(body.branch || "").trim();
  if (requestedBranch && !isValidGitReferenceName(requestedBranch)) {
    return sendJson(res, { error: "branch is not a valid Git reference" }, 400);
  }

  if (body.message !== undefined && typeof body.message !== "string") {
    return sendJson(res, { error: "message must be a string" }, 400);
  }
  const message = String(body.message || "Publish Makeable project").trim();
  if (!message || Buffer.byteLength(message, "utf8") > 1_000) {
    return sendJson(res, { error: "message must be between 1 and 1,000 UTF-8 bytes" }, 400);
  }

  const apiOrigin = githubApiOrigin(env);
  const repositoryPath = `${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  const repositoryResponse = await fetch(`${apiOrigin}/repos/${repositoryPath}`, {
    headers: githubHeaders(env),
  });
  if (!repositoryResponse.ok) return pipeJson(repositoryResponse, res);
  const repository = await repositoryResponse.json();
  const branch = requestedBranch || String(repository.default_branch || "main").trim();
  if (!isValidGitReferenceName(branch)) {
    return sendJson(res, { error: "The repository default branch is not a valid Git reference." }, 502);
  }

  const encodedBranch = branch.split("/").map(encodeURIComponent).join("/");
  const refResponse = await fetch(
    `${apiOrigin}/repos/${repositoryPath}/git/ref/heads/${encodedBranch}`,
    { headers: githubHeaders(env) },
  );
  if (!refResponse.ok) {
    if (refResponse.status === 404 || refResponse.status === 409) {
      return sendJson(
        res,
        { error: "The repository is not initialized yet. Retry after GitHub finishes its initial commit." },
        409,
      );
    }
    return pipeJson(refResponse, res);
  }
  const ref = await refResponse.json();
  const headSha = String(ref?.object?.sha || "");
  if (!headSha) {
    return sendJson(res, { error: "GitHub returned a branch without a commit." }, 502);
  }
  const baseCommitResponse = await fetch(
    `${apiOrigin}/repos/${repositoryPath}/git/commits/${encodeURIComponent(headSha)}`,
    { headers: githubHeaders(env) },
  );
  if (!baseCommitResponse.ok) return pipeJson(baseCommitResponse, res);
  const baseCommit = await baseCommitResponse.json();
  const baseTreeSha = String(baseCommit?.tree?.sha || "");
  if (!baseTreeSha) {
    return sendJson(res, { error: "GitHub returned a commit without a tree." }, 502);
  }

  const treeEntries = [];
  for (const file of fileResult.files) {
    const blobResponse = await fetch(`${apiOrigin}/repos/${repositoryPath}/git/blobs`, {
      method: "POST",
      headers: githubHeaders(env),
      body: JSON.stringify({ content: file.content, encoding: "utf-8" }),
    });
    if (!blobResponse.ok) return pipeJson(blobResponse, res);
    const blob = await blobResponse.json();
    const blobSha = String(blob?.sha || "");
    if (!blobSha) return sendJson(res, { error: "GitHub returned a blob without an id." }, 502);
    treeEntries.push({ path: file.path, mode: "100644", type: "blob", sha: blobSha });
  }

  const treeResponse = await fetch(`${apiOrigin}/repos/${repositoryPath}/git/trees`, {
    method: "POST",
    headers: githubHeaders(env),
    body: JSON.stringify({
      base_tree: baseTreeSha,
      tree: treeEntries,
    }),
  });
  if (!treeResponse.ok) return pipeJson(treeResponse, res);
  const tree = await treeResponse.json();
  const treeSha = String(tree?.sha || "");
  if (!treeSha) return sendJson(res, { error: "GitHub returned a tree without an id." }, 502);

  const commitResponse = await fetch(`${apiOrigin}/repos/${repositoryPath}/git/commits`, {
    method: "POST",
    headers: githubHeaders(env),
    body: JSON.stringify({
      message,
      tree: treeSha,
      parents: [headSha],
    }),
  });
  if (!commitResponse.ok) return pipeJson(commitResponse, res);
  const commit = await commitResponse.json();
  const commitSha = String(commit?.sha || "");
  if (!commitSha) return sendJson(res, { error: "GitHub returned a commit without an id." }, 502);

  const updateRefResponse = await fetch(
    `${apiOrigin}/repos/${repositoryPath}/git/refs/heads/${encodedBranch}`,
    {
      method: "PATCH",
      headers: githubHeaders(env),
      body: JSON.stringify({ sha: commitSha, force: false }),
    },
  );
  if (!updateRefResponse.ok) return pipeJson(updateRefResponse, res);

  const repositoryUrl = String(
    repository.html_url || `https://github.com/${owner}/${repo}`,
  ).replace(/\/$/, "");
  return sendJson(res, {
    ok: true,
    owner,
    repo,
    branch,
    commitSha,
    commitUrl: `${repositoryUrl}/commit/${commitSha}`,
    files: fileResult.files.map((file) => file.path),
  });
}

function normalizedGitHubProjectFiles(files) {
  if (!Array.isArray(files) || files.length === 0) {
    return { error: "files must contain at least one UTF-8 file" };
  }
  if (files.length > MAX_GITHUB_PROJECT_FILES) {
    return { error: `files cannot contain more than ${MAX_GITHUB_PROJECT_FILES} entries` };
  }

  const normalized = [];
  const paths = new Set();
  let contentBytes = 0;
  for (const file of files) {
    if (!file || typeof file.path !== "string" || typeof file.content !== "string") {
      return { error: "Every file needs a string path and UTF-8 string content" };
    }
    const filePath = file.path;
    if (!isAllowedGitHubProjectArtifactPath(filePath)) {
      return { error: `Path is not an allowed Makeable project artifact: ${filePath}` };
    }
    const segments = filePath.split("/");
    const unsafePath =
      filePath !== filePath.trim() ||
      filePath.startsWith("/") ||
      filePath.endsWith("/") ||
      filePath.includes("\\") ||
      /[\u0000-\u001f\u007f]/.test(filePath) ||
      segments.some((segment) => !segment || segment === "." || segment === "..");
    if (unsafePath) return { error: `File path is not safe: ${filePath || "(empty)"}` };
    if (paths.has(filePath)) return { error: `File path is duplicated: ${filePath}` };
    paths.add(filePath);
    contentBytes += Buffer.byteLength(file.content, "utf8");
    normalized.push({ path: filePath, content: file.content });
  }
  if (contentBytes > MAX_GITHUB_PROJECT_CONTENT_BYTES) {
    return {
      error: `Project files cannot exceed ${MAX_GITHUB_PROJECT_CONTENT_BYTES} UTF-8 bytes`,
    };
  }
  return { files: normalized };
}

function isAllowedGitHubProjectArtifactPath(filePath) {
  return typeof filePath === "string" && GITHUB_PROJECT_ARTIFACT_PATHS.has(filePath);
}

function isValidGitHubOwner(owner) {
  return /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(owner);
}

function isValidGitHubRepositoryName(repo) {
  return /^[A-Za-z0-9_.-]{1,100}$/.test(repo);
}

function isValidGitReferenceName(reference) {
  if (!reference || Buffer.byteLength(reference, "utf8") > 255) return false;
  if (
    reference === "@" ||
    reference.startsWith("/") ||
    reference.endsWith("/") ||
    reference.endsWith(".") ||
    reference.includes("//") ||
    reference.includes("..") ||
    reference.includes("@{") ||
    /[\u0000-\u0020\u007f~^:?*[\\]/.test(reference)
  ) {
    return false;
  }
  return reference.split("/").every(
    (component) =>
      component &&
      !component.startsWith(".") &&
      !component.endsWith(".lock"),
  );
}

function githubApiOrigin(env) {
  const configured = env.NODE_ENV === "test" ? String(env.GITHUB_API_ORIGIN || "") : "";
  return (configured || "https://api.github.com").replace(/\/+$/, "");
}

function githubHeaders(env) {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${env.GITHUB_TOKEN}`,
    "Content-Type": "application/json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

async function pipeJson(upstream, res) {
  const text = await upstream.text();
  res.writeHead(upstream.status, {
    "Content-Type": upstream.headers.get("content-type") || "application/json; charset=utf-8",
  });
  res.end(text);
}

async function readJsonBody(req, maxBytes = MAX_REQUEST_BYTES) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) {
      const error = new Error("Request body is too large.");
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    const error = new Error("Request body must be valid JSON.");
    error.statusCode = 400;
    throw error;
  }
}

function sendJson(res, data, status = 200) {
  sendText(res, JSON.stringify(data), "application/json; charset=utf-8", status);
}

function sendAcaciaServiceResult(res, result) {
  const { status, ...body } = result;
  return sendJson(res, body, result.ok ? 200 : status || 500);
}

function sendText(res, text, contentType, status = 200) {
  res.writeHead(status, { "Content-Type": contentType });
  res.end(text);
}
