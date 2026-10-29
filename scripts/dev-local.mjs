#!/usr/bin/env node
// Runs the whole app on this machine the way AWS will run it: static site from
// release-dist, /api/* through the same Lambda adapter the API Lambda uses, and
// background builds through the pipeline Lambda's adapter, all in one process.
// Storage is in memory, so nothing here reads or writes real data.
//
//   node scripts/dev-local.mjs [--port 3001] [--skip-build] [--fixtures <module>]
//        [--ai-record <dir> | --ai-replay <dir> [--ai-replay-delay <ms>]] [--fake-stripe]
//
// --fixtures loads a module whose default export seeds the in-memory storage
// before the server starts (used by the browser tests in tests/e2e).
//
// Builds call OpenAI for real (OPENAI_API_KEY in .env), about 90 s each.
// --ai-replay answers them from a recording instead, --ai-record makes one,
// and --fake-stripe fakes Stripe; see scripts/dev-local-outside.mjs.
// GET /__local-login signs in as a test user (?user=2 or ?user=3 for others;
// &keep=1 keeps the browser's saved data, like a real sign-in). It
// exists only in this script, which no deploy ships, and the server listens on
// 127.0.0.1 only.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { installOutsideServices, outsideServicesWanted } from "./dev-local-outside.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SITE = path.join(ROOT, "release-dist");
const DEPLOY_CONTEXT = "dev";

const args = process.argv.slice(2);
const port = Number(argValue("--port") || 3001);
const origin = `http://localhost:${port}`;

try {
  process.loadEnvFile(path.join(ROOT, ".env"));
} catch {
  console.warn("[dev-local] no .env found; builds need OPENAI_API_KEY");
}
// Always in memory: an inherited netlify or s3 setting would point a local run
// at real data.
process.env.MAKEABLE_STORAGE_BACKEND = "memory";
delete process.env.MAKEABLE_BUILD_DISPATCH;

if (!args.includes("--skip-build")) {
  console.log("[dev-local] npm run build");
  const build = spawnSync("npm run build", { cwd: ROOT, stdio: "inherit", shell: true });
  if (build.status !== 0) process.exit(build.status ?? 1);
}
if (!existsSync(path.join(SITE, "index.html"))) {
  console.error("[dev-local] release-dist/index.html is missing; run without --skip-build");
  process.exit(1);
}

// Before the app modules load: replay rewrites the AI settings it answers for.
const outside = outsideServicesWanted(args)
  ? installOutsideServices({
      record: argValue("--ai-record"),
      replay: argValue("--ai-replay"),
      replayDelayMs: Number(argValue("--ai-replay-delay") || 0),
      fakeStripe: args.includes("--fake-stripe"),
    })
  : null;

// Imported after the env is set: some modules read it at load time.
const { toBackgroundEventHandler, toLambdaHandler } = await import("../lib/aws/lambda-http.mjs");
const { default: api } = await import("../netlify/functions/api.mjs");
const { default: buildBackground } = await import("../netlify/functions/build-background.mjs");
const { openStore } = await import("../lib/storage/index.mjs");
const { builderSessionStoreNameForFunctionContext, createBuilderSession } = await import("../lib/builder-session.mjs");

const fixtures = argValue("--fixtures");
if (fixtures) {
  const { default: seed } = await import(pathToFileURL(path.resolve(fixtures)).href);
  await seed({ deployContext: DEPLOY_CONTEXT });
  console.log(`[dev-local] fixtures loaded from ${fixtures}`);
}

const apiHandler = toLambdaHandler(api, { deployContext: DEPLOY_CONTEXT, publicOrigin: origin });
const pipelineHandler = toBackgroundEventHandler(buildBackground, { deployContext: DEPLOY_CONTEXT });
const redirects = readRedirects(path.join(ROOT, "netlify.toml"));

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, origin);
    if (url.pathname === "/__local-login") return await localLogin(url, res);
    if (url.pathname === "/__outside-calls" && outside) return outsideCalls(req, res);
    if (url.pathname === "/.netlify/functions/build-background") return await startPipeline(req, res);
    if (url.pathname === "/config.local.js" || url.pathname.startsWith("/api/")) {
      return await callApi(req, url, res);
    }
    return serveStatic(url, res);
  } catch (error) {
    console.error("[dev-local]", req.method, req.url, error);
    if (!res.headersSent) res.writeHead(500, { "Content-Type": "text/plain" });
    res.end("dev-local error; see the server log");
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`[dev-local] ${origin}  (storage: memory)`);
  console.log(`[dev-local] sign in: ${origin}/__local-login?next=/`);
});

async function localLogin(url, res) {
  const store = openStore({
    name: builderSessionStoreNameForFunctionContext({ deploy: { context: DEPLOY_CONTEXT } }),
    consistency: "strong",
  });
  const user = LOCAL_USERS[url.searchParams.get("user")] || LOCAL_USERS[1];
  const session = await createBuilderSession(store, user);
  const next = url.searchParams.get("next") || "";
  if (next.startsWith("/") && !next.startsWith("//")) {
    // Storage resets with this server, so drop the browser's saved active job
    // (localStorage) or the site reopens a job that no longer exists.
    // &keep=1 skips that, for tests of what a real sign-in finds left behind.
    const keep = url.searchParams.get("keep") === "1";
    res.writeHead(302, {
      Location: next,
      "Set-Cookie": session.cookie,
      ...(keep ? {} : { "Clear-Site-Data": '"storage"' }),
    });
    return res.end();
  }
  res.writeHead(200, { "Content-Type": "application/json", "Set-Cookie": session.cookie });
  res.end(JSON.stringify({ ok: true }));
}

const LOCAL_USERS = {
  1: { sub: "local-test-user", email: "local-test@example.com", name: "Local Test" },
  2: { sub: "local-test-user-2", email: "local-test-2@example.com", name: "Second Tester" },
  3: { sub: "local-test-user-3", email: "local-test-3@example.com", name: "Build Tester" },
};

// What the stand-ins for outside services were asked (see dev-local-outside.mjs).
function outsideCalls(req, res) {
  if (req.method === "DELETE") outside.clear();
  res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(outside.report()));
}

// Same hand-off as AWS: the API's signed dispatch becomes a pipeline event.
// Answers 202 at once and runs the build in the background, like an async invoke.
async function startPipeline(req, res) {
  const { jobId } = JSON.parse((await readBody(req)).toString("utf8") || "{}");
  const event = {
    jobId,
    timestamp: req.headers["x-makeable-background-timestamp"] || "",
    signature: req.headers["x-makeable-background-signature"] || "",
  };
  res.writeHead(202).end();
  console.log(`[dev-local] pipeline start ${jobId}`);
  const result = await pipelineHandler(event).catch((error) => {
    console.error(`[dev-local] pipeline ${jobId} threw`, error);
    return { statusCode: 500 };
  });
  console.log(`[dev-local] pipeline end ${jobId} (${result.statusCode})`);
}

// Turns the request into a Lambda Function URL event (payload 2.0), so the
// adapter code that runs on AWS is the code that runs here.
async function callApi(req, url, res) {
  const headers = {};
  for (const [key, value] of Object.entries(req.headers)) {
    if (key !== "cookie") headers[key] = Array.isArray(value) ? value.join(",") : value;
  }
  const body = await readBody(req);
  const event = {
    rawPath: url.pathname,
    rawQueryString: url.search.slice(1),
    headers,
    cookies: req.headers.cookie ? req.headers.cookie.split(/;\s*/) : undefined,
    requestContext: { http: { method: req.method, sourceIp: req.socket.remoteAddress || "127.0.0.1" } },
    body: body.length ? body.toString("base64") : undefined,
    isBase64Encoded: body.length > 0,
  };
  const result = await apiHandler(event);
  const outHeaders = { ...result.headers };
  if (result.cookies?.length) outHeaders["set-cookie"] = result.cookies;
  res.writeHead(result.statusCode, outHeaders);
  res.end(result.body == null ? undefined : Buffer.from(result.body, result.isBase64Encoded ? "base64" : "utf8"));
}

function serveStatic(url, res) {
  const rule = redirects.find((entry) => entry.from === url.pathname);
  if (rule && rule.status !== 200) {
    res.writeHead(rule.status, { Location: rule.to, "Cache-Control": "no-store" });
    return res.end();
  }
  const pathname = rule ? rule.to : decodeURIComponent(url.pathname);
  const file = resolveSiteFile(pathname);
  if (file) return sendFile(res, 200, file);
  const notFound = path.join(SITE, "404.html");
  if (existsSync(notFound)) return sendFile(res, 404, notFound);
  res.writeHead(404, { "Content-Type": "text/plain" }).end("Not found");
}

// Netlify-style lookup: exact file, then .html, then index.html in the folder.
function resolveSiteFile(pathname) {
  const base = path.join(SITE, path.normalize(pathname));
  if (base !== SITE && !base.startsWith(SITE + path.sep)) return null;
  for (const candidate of [base, `${base}.html`, path.join(base, "index.html")]) {
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch {}
  }
  return null;
}

function sendFile(res, status, file) {
  res.writeHead(status, { "Content-Type": contentType(file), "X-Content-Type-Options": "nosniff" });
  res.end(readFileSync(file));
}

// Reads the [[redirects]] blocks of netlify.toml; only from/to/status are used.
function readRedirects(file) {
  const text = readFileSync(file, "utf8");
  return text.split("[[redirects]]").slice(1).map((block) => ({
    from: block.match(/from\s*=\s*"([^"]+)"/)?.[1],
    to: block.match(/to\s*=\s*"([^"]+)"/)?.[1],
    status: Number(block.match(/status\s*=\s*(\d+)/)?.[1] || 301),
  })).filter((rule) => rule.from && rule.to);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function argValue(name) {
  const index = args.indexOf(name);
  return index === -1 ? "" : args[index + 1];
}

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".glb": "model/gltf-binary",
  ".gltf": "model/gltf+json",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".wasm": "application/wasm",
  ".webmanifest": "application/manifest+json",
};

function contentType(file) {
  return CONTENT_TYPES[path.extname(file).toLowerCase()] || "application/octet-stream";
}
