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
import { createLocalBuildWorkshop } from "./lib/local-build-workshop.mjs";
import { createGoogleWaitlistResult } from "./lib/acquisition.mjs";
import {
  clearDashboardSessionCookie,
  createDashboardSessionCookie,
  dashboardAccessConfigured,
  dashboardSessionState,
  verifyDashboardAccessKey,
} from "./lib/dashboard-auth.mjs";
import {
  dashboardSocialResult,
} from "./lib/social-dashboard.mjs";
import { readSocialWebsiteSessions } from "./lib/posthog-social.mjs";
import { socialLinkRedirect } from "./lib/social-links.mjs";
import { waitlistSignupKey } from "./lib/waitlist-storage.mjs";
import { readVerifiedWaitlist, waitlistCsv } from "./lib/waitlist-report.mjs";
import {
  clearWaitlistSessionCookie,
  createWaitlistSession,
  forgetWaitlistSession,
  resolveWaitlistSession,
} from "./lib/waitlist-session.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const execFileAsync = promisify(execFile);
const initialEnv = getEnv();
const port = Number(initialEnv.PORT || 8787);
const localBuildWorkshop = createLocalBuildWorkshop();
const MAX_REQUEST_BYTES = 8 * 1024 * 1024;
const MAX_SKETCH_BYTES = 96 * 1024;
const DEFAULT_OPENAI_MODEL = "gpt-5.6-terra";
const DEFAULT_OPENAI_REASONING_EFFORT = "xhigh";
const DEFAULT_OPENAI_SERVICE_TIER = "priority";
const MAX_CONCURRENT_COMPILES = Math.max(1, Number(initialEnv.MAX_CONCURRENT_COMPILES || 2));
const ARDUINO_COMPILE_JOBS = Math.max(1, Number(initialEnv.ARDUINO_COMPILE_JOBS || 1));
const COMPILE_TIMEOUT_MS = Math.max(30000, Number(initialEnv.COMPILE_TIMEOUT_MS || 240000));
const MAX_VOICE_SESSION_MS = Math.max(30000, Number(initialEnv.MAX_VOICE_SESSION_MS || 120000));
const INITIAL_FREE_CREDITS = Math.max(0, Number(initialEnv.INITIAL_FREE_CREDITS || 10));
const HTTP_KEEP_ALIVE_TIMEOUT_MS = 65_000;
const HTTP_HEADERS_TIMEOUT_MS = 66_000;
const HTTP_REQUEST_TIMEOUT_MS = Math.max(COMPILE_TIMEOUT_MS + 10_000, 310_000);
const SHUTDOWN_GRACE_MS = 25_000;
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

const server = createServer((req, res) => {
  handleHttpRequest(req, res).catch((error) => handleHttpRequestError(res, error));
});

async function handleHttpRequest(req, res) {
  try {
    const env = getEnv();
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    const localApiPath = normalizedLocalApiPath(url.pathname);
    const socialRedirect = url.search ? null : socialLinkRedirect(url.pathname);

    applyCors(req, res, env);
    if (socialRedirect && (req.method === "GET" || req.method === "HEAD")) {
      return sendSocialRedirect(res, socialRedirect.location);
    }
    if (req.method === "OPTIONS") return sendText(res, "", "text/plain; charset=utf-8", 204);

    if (url.pathname === "/config.local.js") {
      return sendText(res, publicConfigScript(env), "text/javascript; charset=utf-8");
    }

    if (url.pathname === "/api/config") {
      return sendJson(res, {
        ...publicConfig(env),
        localBuildMode: true,
        localDeveloperUser: localBuildWorkshop.builder,
      });
    }

    if (
      localApiPath === "/api/builds"
      || localApiPath === "/api/account/builds"
      || localApiPath === "/api/build-jobs"
      || localApiPath.startsWith("/api/build-jobs/")
    ) {
      const body = req.method === "POST" ? await readJsonBody(req, 8 * 1024) : undefined;
      const localResponse = await localBuildWorkshop.handle({
        method: req.method || "GET",
        path: localApiPath,
        body,
      });
      if (localResponse) return sendJson(res, localResponse.body, localResponse.status);
    }

    if (localApiPath === "/api/dashboard/session") {
      return localDashboardSession(req, res, env);
    }

    if (localApiPath === "/api/dashboard/export") {
      return localDashboardExport(req, res, env);
    }

    if (localApiPath === "/api/dashboard/social") {
      return localDashboardSocial(req, res, env);
    }

    if (localApiPath === "/api/dashboard") {
      return localDashboardData(req, res, env);
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
      return createGitHubRepo(req, res, env);
    }

    if (url.pathname === "/api/github/upload-file" && req.method === "POST") {
      const user = await requireUser(req, res, env);
      if (!user) return;
      return uploadGitHubFile(req, res, env);
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
    return handleHttpRequestError(res, error);
  }
}

function handleHttpRequestError(res, error) {
  const status =
    Number.isInteger(error?.statusCode) && error.statusCode >= 400 && error.statusCode < 600
      ? error.statusCode
      : 500;
  if (status === 500) console.error(error);
  if (res.headersSent) {
    if (!res.writableEnded) res.destroy(error);
    return;
  }
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

server.on("upgrade", handleDeepgramUpgrade);

server.keepAliveTimeout = HTTP_KEEP_ALIVE_TIMEOUT_MS;
server.headersTimeout = HTTP_HEADERS_TIMEOUT_MS;
server.requestTimeout = HTTP_REQUEST_TIMEOUT_MS;

server.listen(port, () => {
  console.log(`Makeable running at http://localhost:${port}`);
});

let shutdownStarted = false;
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => beginGracefulShutdown(signal));
}

function beginGracefulShutdown(signal) {
  if (shutdownStarted) return;
  shutdownStarted = true;
  console.log(`Makeable received ${signal}; draining active requests.`);
  const forceExit = setTimeout(() => {
    console.error("Makeable shutdown grace period expired.");
    process.exit(1);
  }, SHUTDOWN_GRACE_MS);
  forceExit.unref();
  server.close((error) => {
    clearTimeout(forceExit);
    if (error) console.error("Makeable could not close cleanly.", error);
    process.exit(error ? 1 : 0);
  });
  server.closeIdleConnections?.();
}

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

async function localDashboardSession(req, res, env) {
  if (req.method === "DELETE") {
    res.setHeader("Set-Cookie", clearDashboardSessionCookie());
    return sendJson(res, { ok: true });
  }
  if (!new Set(["GET", "POST"]).has(req.method)) {
    res.setHeader("Allow", "GET, POST, DELETE");
    return sendJson(res, { error: "Method not allowed" }, 405);
  }
  if (!dashboardAccessConfigured(
    env.DASHBOARD_ACCESS_KEY,
    env.DASHBOARD_SESSION_SECRET,
  )) {
    return sendJson(res, { error: "Dashboard access is not configured." }, 503);
  }
  const sessionRequest = localCookieRequest(req, "/api/dashboard/session");
  if (req.method === "GET") {
    const session = dashboardSessionState(sessionRequest, env.DASHBOARD_SESSION_SECRET);
    if (session.state === "invalid") {
      res.setHeader("Set-Cookie", clearDashboardSessionCookie());
    }
    return sendJson(res, { authenticated: session.authenticated });
  }

  const body = await readJsonBody(req, 4 * 1024);
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    typeof body.accessKey !== "string" ||
    Object.keys(body).some((key) => key !== "accessKey")
  ) {
    return sendJson(res, { error: "Enter a valid access key." }, 400);
  }
  if (!verifyDashboardAccessKey(body.accessKey, env.DASHBOARD_ACCESS_KEY)) {
    return sendJson(res, { error: "That access key is not valid." }, 401);
  }
  res.setHeader(
    "Set-Cookie",
    createDashboardSessionCookie(env.DASHBOARD_SESSION_SECRET),
  );
  return sendJson(res, { authenticated: true });
}

async function localDashboardData(req, res, env) {
  if (!localDashboardAuthorized(req, res, env)) return;
  const records = await readVerifiedWaitlist(localWaitlistSignupStore);
  records.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return sendJson(res, {
    generatedAt: new Date().toISOString(),
    records,
  });
}

async function localDashboardExport(req, res, env) {
  if (!localDashboardAuthorized(req, res, env)) return;
  const records = await readVerifiedWaitlist(localWaitlistSignupStore);
  records.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="makeable-waitlist-${new Date()
      .toISOString()
      .slice(0, 10)}.csv"`,
  );
  return sendText(res, waitlistCsv(records), "text/csv; charset=utf-8");
}

async function localDashboardSocial(req, res, env) {
  if (!localDashboardAuthorized(req, res, env, ["GET", "POST"])) return;
  const origin = String(req.headers.origin || "");
  if (req.method === "POST" && origin && !isAllowedBrowserOrigin(origin, env)) {
    return sendJson(res, { error: "Origin not allowed." }, 403);
  }
  const body = req.method === "POST"
    ? await readJsonBody(req, (2 * 1024 * 1024) + 8 * 1024)
    : null;
  const attribution = await readSocialWebsiteSessions({
    personalApiKey: env.POSTHOG_PERSONAL_API_KEY,
    projectId: env.POSTHOG_PROJECT_ID,
    fetchImpl: globalThis.fetch,
  });
  const result = await dashboardSocialResult(
    { method: req.method, body },
    { store: localSocialAnalyticsStore, attribution },
  );
  if (result.headers?.Allow) res.setHeader("Allow", result.headers.Allow);
  return sendJson(res, result.body, result.status);
}

function localDashboardAuthorized(req, res, env, methods = ["GET"]) {
  if (!methods.includes(req.method)) {
    res.setHeader("Allow", methods.join(", "));
    sendJson(res, { error: "Method not allowed" }, 405);
    return false;
  }
  if (!dashboardAccessConfigured(
    env.DASHBOARD_ACCESS_KEY,
    env.DASHBOARD_SESSION_SECRET,
  )) {
    sendJson(res, { error: "Dashboard access is not configured." }, 503);
    return false;
  }
  const session = dashboardSessionState(
    localCookieRequest(req, "/api/dashboard"),
    env.DASHBOARD_SESSION_SECRET,
  );
  if (session.authenticated) return true;
  if (session.state === "invalid") {
    res.setHeader("Set-Cookie", clearDashboardSessionCookie());
  }
  sendJson(res, { error: "Dashboard authentication required." }, 401);
  return false;
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
  async *list() {
    const records = await readLocalWaitlistRecords();
    yield {
      blobs: records.map((record) => ({
        key: waitlistSignupKey(record.email),
      })),
      directories: [],
    };
  },
};

const localSocialAnalyticsStore = {
  async get() {
    try {
      return JSON.parse(
        await readFile(path.join(__dirname, "data", "social-analytics.json"), "utf8"),
      );
    } catch {
      return null;
    }
  },
  async setJSON(_key, value) {
    const directory = path.join(__dirname, "data");
    await mkdir(directory, { recursive: true });
    await writeFile(
      path.join(directory, "social-analytics.json"),
      `${JSON.stringify(value, null, 2)}\n`,
      { encoding: "utf8", mode: 0o600 },
    );
  },
};

function localWaitlistSessionRequest(req) {
  return new Request(`http://${req.headers.host || "localhost"}/api/waitlist/status`, {
    headers: { Cookie: String(req.headers.cookie || "") },
  });
}

function localCookieRequest(req, pathname) {
  return new Request(`http://${req.headers.host || "localhost"}${pathname}`, {
    headers: { Cookie: String(req.headers.cookie || "") },
  });
}

async function readLocalWaitlistRecords() {
  const filePath = path.join(__dirname, "data", "waitlist.jsonl");
  try {
    const contents = await readFile(filePath, "utf8");
    return contents
      .split(/\r?\n/)
      .filter(Boolean)
      .flatMap((line) => {
        try {
          return [JSON.parse(line)];
        } catch {
          return [];
        }
      });
  } catch {
    return [];
  }
}

function applyCors(req, res, env) {
  const origin = String(req.headers.origin || "");
  if (isAllowedBrowserOrigin(origin, env)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
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

  if (pathname === "/privacy/" || pathname === "/privacy") {
    return serveFile("/privacy/index.html", res);
  }

  if (pathname === "/terms/" || pathname === "/terms") {
    return serveFile("/terms/index.html", res);
  }

  if (pathname === "/dashboard/" || pathname === "/dashboard") {
    return serveFile("/dashboard/index.html", res);
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
      "--output-dir",
      outputDir,
      "--export-binaries",
      sketchDir,
    ];
    const compileResult = await execFileAsync(cliPath, args, {
      cwd: buildRoot,
      timeout: COMPILE_TIMEOUT_MS,
      maxBuffer: 24 * 1024 * 1024,
    });
    const images = await collectFirmwareImages(outputDir, sketchName);
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

async function collectFirmwareImages(outputDir, sketchName) {
  const files = await walkFiles(outputDir);
  const binFiles = files.filter((filePath) => filePath.endsWith(".bin"));
  const merged = findByPattern(binFiles, [/\.merged\.bin$/i, /\.factory\.bin$/i, /merged/i]);
  if (merged) return [await firmwareImage(merged, 0x0, "Merged ESP32 firmware")];
  const bootloader = findByPattern(binFiles, [/bootloader.*\.bin$/i]);
  const partitions = findByPattern(binFiles, [/\.partitions\.bin$/i, /partitions.*\.bin$/i]);
  const bootApp0 = findByPattern(binFiles, [/boot_app0\.bin$/i]) || findBootApp0Bin();
  const app =
    findByPattern(binFiles, [new RegExp(`${sketchName}\\.ino\\.bin$`, "i")]) ||
    findByPattern(binFiles, [/\.ino\.bin$/i]);

  const images = [];
  if (bootloader) images.push(await firmwareImage(bootloader, 0x1000, "Bootloader"));
  if (partitions) images.push(await firmwareImage(partitions, 0x8000, "Partition table"));
  if (bootApp0) images.push(await firmwareImage(bootApp0, 0xe000, "Boot app"));
  if (app) images.push(await firmwareImage(app, 0x10000, "Application"));
  if (images.length) return images;

  return [];
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

function findBootApp0Bin() {
  const home = process.env.HOME || "";
  const candidates = [
    path.join(home, "Library/Arduino15/packages/esp32/hardware/esp32/3.3.5/tools/partitions/boot_app0.bin"),
    path.join(home, "Library/Arduino15/packages/arduino/hardware/esp32/2.0.18-arduino.5/tools/partitions/boot_app0.bin"),
  ];
  return candidates.find((candidate) => existsSync(candidate)) || "";
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

async function createGitHubRepo(req, res, env) {
  if (!env.GITHUB_TOKEN) {
    return sendJson(res, { error: "GITHUB_TOKEN is missing in .env" }, 401);
  }
  const body = await readJsonBody(req);
  const upstream = await fetch("https://api.github.com/user/repos", {
    method: "POST",
    headers: githubHeaders(env),
    body: JSON.stringify({
      name: body.name,
      description: body.description || "Hardware project generated with Makeable",
      private: Boolean(body.private),
      auto_init: false,
    }),
  });
  return pipeJson(upstream, res);
}

async function uploadGitHubFile(req, res, env) {
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

  const encodedPath = filePath.split("/").map(encodeURIComponent).join("/");
  const branchQuery = body.branch ? `?ref=${encodeURIComponent(body.branch)}` : "";
  let sha;
  const existing = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/contents/${encodedPath}${branchQuery}`,
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
    `https://api.github.com/repos/${owner}/${repo}/contents/${encodedPath}`,
    {
      method: "PUT",
      headers: githubHeaders(env),
      body: JSON.stringify(payload),
    },
  );
  return pipeJson(upstream, res);
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

function sendSocialRedirect(res, location) {
  res.writeHead(302, { Location: location, "Cache-Control": "no-store" });
  res.end();
}

function sendText(res, text, contentType, status = 200) {
  res.writeHead(status, { "Content-Type": contentType });
  res.end(text);
}
