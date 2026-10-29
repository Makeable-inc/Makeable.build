// Stand-ins for the services outside Makeable, used only by scripts/dev-local.mjs
// (which no deploy ships). They let the browser tests run every line of our
// own code (the API, the build pipeline, rule checks, saving) while nothing
// leaves this machine and nothing costs money.
//
//   --ai-record <dir>  real build: OpenAI and the parts' 3D models are fetched
//                      for real and saved to <dir> (no keys, no headers).
//   --ai-replay <dir>  answers those requests from <dir>; never uses the network.
//   --ai-replay-delay <ms>  waits this long before each AI answer, so a replayed
//                      build takes a few seconds and its progress can be seen.
//   --fake-stripe      answers Stripe's API with a fake checkout.
//
// How: dev-local runs the API and the build pipeline in this one process, and
// every outside call they make goes through the global fetch (OpenAI for the
// start route's idea check and each pipeline step, CloudFront for the 3D
// models, Stripe, PostHog). Wrapping fetch here needs no change to app code
// and keeps the requests exactly as production sends them. Pointing
// OPENAI_BASE_URL at a local fake would not: with a host other than
// api.openai.com the app drops service_tier, picks another image route, and
// refuses plain http (lib/makeable-builds.mjs, lib/prompt2circuit-production.mjs).
//
// When any of these flags is on, a request to any other outside host fails,
// so a test can never reach a real service by accident. PostHog analytics are
// answered locally and kept for the tests to read.
//
// GET /__outside-calls lists what was asked (Stripe and PostHog bodies, AI
// calls, and any request that had no answer); DELETE clears the list.
import { createHash } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const OPENAI_HOST = "api.openai.com";
const MODELS_HOST = "dvy6bet209exg.cloudfront.net";
const STRIPE_HOST = "api.stripe.com";
const POSTHOG_HOST = "us.i.posthog.com";
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

// Settings that shape what the app asks the AI. A recording saves them and a
// replay applies them, so CI asks exactly what the recording answered.
const AI_SETTINGS = [
  "OPENAI_MODEL",
  "OPENAI_BUILD_MODEL",
  "OPENAI_REASONING_MODEL",
  "OPENAI_REASONING_EFFORT",
  "OPENAI_SERVICE_TIER",
  "OPENAI_BUILD_SERVICE_TIER",
  "OPENAI_IMAGE_MODEL",
  "OPENAI_IMAGE_SIZE",
  "OPENAI_IMAGE_QUALITY",
  "OPENAI_IMAGE_TOOL_MODEL",
  "MAKEABLE_SKIP_IMAGE_GENERATION",
  "MAKEABLE_BUILD_GENERATION_ENABLED",
  "MAKEABLE_LOCAL_PRODUCTION_PIPELINE",
];
// Recording uses the direct OpenAI route only; these would send it elsewhere.
const OTHER_ROUTES = ["OPENAI_BASE_URL", "OPENAI_IMAGE_BASE_URL", "OPENAI_IMAGE_API_KEY", "GEMINI_API_KEY", "GOOGLE_GEMINI_BASE_URL"];
const SECRET_SETTINGS = ["OPENAI_API_KEY", "OPENAI_IMAGE_API_KEY", "GEMINI_API_KEY", "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET",
  "MAKEABLE_BACKGROUND_SECRET", "MAKEABLE_DRAFT_COOKIE_SECRET", "DASHBOARD_SESSION_SECRET", "GITHUB_TOKEN"];

// Values that change on every run (ids, the request fingerprint). They are
// saved as placeholders and filled with this run's values on replay, so the
// pipeline's identity checks pass for real. Stable hashes (part files) are
// caught too and simply map to themselves.
const VOLATILE = [
  ["fingerprint", /(?<![A-Za-z0-9])[a-f0-9]{64}(?![A-Za-z0-9])/g],
  ["build", /(?<![A-Za-z0-9_-])build_[a-z0-9-]{1,56}_[A-Za-z0-9_-]{14}(?![A-Za-z0-9_-])/g],
  ["job", /(?<![A-Za-z0-9_-])job_[A-Za-z0-9_-]{22}(?![A-Za-z0-9_-])/g],
  ["request", /(?<![A-Za-z0-9_-])req_[A-Za-z0-9_-]{8,64}(?![A-Za-z0-9_-])/g],
];

const ABOUT = "AI answers recorded from one real build by scripts/dev-local.mjs --ai-record and replayed by "
  + "--ai-replay (see scripts/dev-local-outside.mjs). Ids and fingerprints are placeholders filled in on replay; "
  + "pictures are shrunk; no keys or headers are kept.";

export function outsideServicesWanted(args) {
  return args.includes("--ai-record") || args.includes("--ai-replay") || args.includes("--fake-stripe");
}

// Call before the app modules are imported: replay rewrites the AI settings.
export function installOutsideServices({ record = "", replay = "", replayDelayMs = 0, fakeStripe = false, env = process.env, log = console }) {
  if (record && replay) throw new Error("--ai-record and --ai-replay cannot be used together");
  const realFetch = globalThis.fetch;
  const calls = [];
  const misses = [];
  const recording = record ? startRecording(record, env) : null;
  const replaying = replay ? loadRecording(replay, env, replayDelayMs) : null;
  const stripe = fakeStripe ? createFakeStripe(env) : null;

  globalThis.fetch = async function outsideFetch(input, init) {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (LOCAL_HOSTS.has(url.hostname)) return realFetch(input, init);

    const bodyText = request.method === "GET" || request.method === "HEAD" ? "" : await request.clone().text();
    const miss = (reason) => {
      const message = `[outside] no answer for ${request.method} ${url.origin}${url.pathname}: ${reason}`;
      misses.push({ method: request.method, url: `${url.origin}${url.pathname}`, reason });
      log.error(message);
      throw new TypeError(message);
    };

    if (url.hostname === POSTHOG_HOST) {
      calls.push({ service: "posthog", method: request.method, path: url.pathname, body: parseJson(bodyText) });
      return Response.json({ status: 1 });
    }
    if (url.hostname === STRIPE_HOST) {
      if (!stripe) return miss("Stripe is not faked (start with --fake-stripe)");
      const answer = stripe.answer(request, url, bodyText);
      calls.push({ service: "stripe", ...answer.logged });
      return answer.response;
    }
    if (url.hostname === OPENAI_HOST || url.hostname === MODELS_HOST) {
      const service = url.hostname === OPENAI_HOST ? "openai" : "models";
      if (recording) {
        const response = await realFetch(input, init);
        await recording.save(service, request, url, bodyText, response.clone());
        calls.push({ service, method: request.method, path: url.pathname, answeredBy: "network" });
        return response;
      }
      if (replaying) {
        const { response, match } = await replaying.answer(service, request, url, bodyText, miss);
        calls.push({
          service,
          method: request.method,
          path: url.pathname,
          answeredBy: "recording",
          match,
          ...(service === "openai" ? aiSummary(bodyText) : {}),
        });
        return response;
      }
      return miss("no recording (start with --ai-replay <dir>)");
    }
    if (recording) {
      log.warn(`[outside] not recorded, sent for real: ${request.method} ${url.origin}${url.pathname}`);
      return realFetch(input, init);
    }
    return miss("outside services are blocked in this mode");
  };

  log.log(`[dev-local] outside services: ${[
    recording && `recording AI to ${record}`,
    replaying && `replaying AI from ${replay} (${replaying.count} answers)`,
    stripe && "fake Stripe",
  ].filter(Boolean).join(", ")}; every other outside request fails`);

  return {
    report: () => ({ calls, misses }),
    clear() {
      calls.length = 0;
      misses.length = 0;
    },
  };
}

function startRecording(dir, env) {
  const routed = OTHER_ROUTES.filter((key) => env[key]);
  if (routed.length) throw new Error(`--ai-record records the direct OpenAI route only; unset ${routed.join(", ")}`);
  if (!env.OPENAI_API_KEY) throw new Error("--ai-record needs OPENAI_API_KEY (e.g. node --env-file=<path>/.env)");
  mkdirSync(path.join(dir, "models"), { recursive: true });
  const settings = Object.fromEntries(AI_SETTINGS.filter((key) => env[key]).map((key) => [key, env[key]]));
  const answers = [];
  const secrets = SECRET_SETTINGS.map((key) => String(env[key] || "")).filter((value) => value.length >= 8);

  return {
    async save(service, request, url, bodyText, response) {
      if (service === "models") {
        const bytes = Buffer.from(await response.arrayBuffer());
        const sha = modelSha(url);
        if (response.ok && sha && sha256(bytes) === sha) {
          writeFileSync(path.join(dir, "models", `${sha}.glb.gz`), gzipSync(bytes, { level: 9 }));
        }
        return;
      }
      const { normalized, values } = normalizeVolatile(bodyText);
      let responseText = await response.text();
      responseText = await slimResponse(responseText);
      for (const [placeholder, value] of Object.entries(values)) responseText = responseText.replaceAll(value, placeholder);
      const leaked = findSecrets(responseText, secrets);
      if (leaked) throw new Error(`[outside] refusing to save a response that looks like it holds a secret (${leaked})`);
      answers.push({
        method: request.method,
        path: url.pathname,
        key: aiKey(url, bodyText),
        requestSha256: sha256(normalized),
        response: {
          status: response.status,
          contentType: response.headers.get("content-type") || "application/json",
          body: responseText,
        },
      });
      writeFileSync(path.join(dir, "answers.json"), `${JSON.stringify({ settings, answers }, null, 1)}\n`);
    },
  };
}

function loadRecording(dir, env, delayMs) {
  const file = path.join(dir, "answers.json");
  if (!existsSync(file)) throw new Error(`--ai-replay: ${file} is missing`);
  const { settings = {}, answers = [] } = JSON.parse(readFileSync(file, "utf8"));
  // Ask what the recording answered, and make a real call impossible even if
  // a local .env has a key: the pipeline needs some key to try, so use a dummy.
  for (const key of OTHER_ROUTES) delete env[key];
  Object.assign(env, settings, { OPENAI_API_KEY: "sk-replay-dummy-not-a-key" });

  return {
    count: answers.length,
    async answer(service, request, url, bodyText, miss) {
      if (service === "models") {
        const sha = modelSha(url);
        const modelFile = sha && path.join(dir, "models", `${sha}.glb.gz`);
        if (!modelFile || !existsSync(modelFile)) return miss(`model ${sha || url.pathname} is not in the recording`);
        // The pipeline checks the bytes against the hash in the parts manifest.
        const bytes = gunzipSync(readFileSync(modelFile));
        return { match: "exact", response: new Response(bytes, { status: 200, headers: { "Content-Type": "model/gltf-binary" } }) };
      }
      const { normalized, values } = normalizeVolatile(bodyText);
      const key = aiKey(url, bodyText);
      const candidates = answers.filter((entry) => entry.method === request.method && entry.path === url.pathname);
      let entry = candidates.find((candidate) => candidate.requestSha256 === sha256(normalized));
      let match = "exact";
      if (!entry) {
        // The app now asks something slightly different (a prompt was edited).
        // If only one recorded answer fits this step, use it and say so; the
        // pipeline's own checks still decide whether the answer is usable.
        const sameStep = candidates.filter((candidate) => candidate.key === key);
        if (sameStep.length !== 1) {
          return miss(`the request for ${key} does not match the recording; re-record with --ai-record`);
        }
        console.warn(`[outside] ${key}: request differs from the recording; replaying its only answer for this step`);
        entry = sameStep[0];
        match = "same step";
      }
      if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
      let body = entry.response.body;
      for (const placeholder of new Set(body.match(/⟪[a-z]+:\d+⟫/g) || [])) {
        if (!(placeholder in values)) return miss(`${key}: the recording needs ${placeholder}, which this request lacks`);
        body = body.replaceAll(placeholder, values[placeholder]);
      }
      return { match, response: new Response(body, { status: entry.response.status, headers: { "Content-Type": entry.response.contentType } }) };
    },
  };
}

// A fake Stripe API: enough for checkout to start and report its status.
// Anything else gets Stripe's 404. Sessions live in memory.
function createFakeStripe(env) {
  const sessions = new Map();
  let counter = 0;
  const error = (status, message) => Response.json({ error: { type: "invalid_request_error", message } }, { status });

  return {
    answer(request, url, bodyText) {
      const authorization = request.headers.get("authorization") || "";
      const form = request.method === "POST" ? formObject(bodyText) : undefined;
      const logged = {
        method: request.method,
        path: url.pathname,
        // Never log a real key: only the dummy test key is shown in full.
        authorization: authorization === `Bearer ${env.STRIPE_SECRET_KEY}` && /^sk_test_e2e/.test(env.STRIPE_SECRET_KEY || "")
          ? authorization
          : authorization ? "Bearer (other key)" : "",
        stripeVersion: request.headers.get("stripe-version") || "",
        form,
      };
      if (!/^Bearer sk_test_/.test(authorization)) return { logged, response: error(401, "Invalid API Key provided.") };

      if (request.method === "POST" && url.pathname === "/v1/checkout/sessions") {
        counter += 1;
        const id = `cs_test_e2e${String(counter).padStart(4, "0")}${"x".repeat(20)}`;
        const session = {
          id,
          object: "checkout.session",
          mode: form.mode,
          status: "open",
          payment_status: "unpaid",
          currency: form["line_items[0][price_data][currency]"],
          amount_total: Number(form["line_items[0][price_data][unit_amount]"]) * Number(form["line_items[0][quantity]"]),
          metadata: prefixed(form, "metadata"),
          success_url: form.success_url,
          cancel_url: form.cancel_url,
          url: `https://checkout.stripe.com/c/pay/${id}`,
        };
        sessions.set(id, session);
        return { logged, response: Response.json(session) };
      }
      const sessionMatch = url.pathname.match(/^\/v1\/checkout\/sessions\/([^/]+)$/);
      if (request.method === "GET" && sessionMatch) {
        const session = sessions.get(decodeURIComponent(sessionMatch[1]));
        if (!session) return { logged, response: error(404, "No such checkout.session") };
        // The fake buyer always pays.
        return { logged, response: Response.json({ ...session, status: "complete", payment_status: "paid" }) };
      }
      return { logged, response: error(404, `The fake Stripe does not know ${request.method} ${url.pathname}`) };
    },
  };
}

function formObject(bodyText) {
  const form = {};
  for (const [key, value] of new URLSearchParams(bodyText)) {
    if (key.endsWith("[]")) (form[key] ||= []).push(value);
    else form[key] = value;
  }
  return form;
}

function prefixed(form, prefix) {
  return Object.fromEntries(Object.entries(form)
    .filter(([key]) => key.startsWith(`${prefix}[`) && key.indexOf("]") === key.length - 1)
    .map(([key, value]) => [key.slice(prefix.length + 1, -1), value]));
}

function normalizeVolatile(text) {
  const values = {};
  let normalized = text;
  for (const [kind, pattern] of VOLATILE) {
    const seen = [...new Set(text.match(pattern) || [])];
    seen.forEach((value, index) => {
      const placeholder = `⟪${kind}:${index}⟫`;
      values[placeholder] = value;
      normalized = normalized.replaceAll(value, placeholder);
    });
  }
  return { normalized, values };
}

// Which step a request is: the endpoint, the model and the answer format.
function aiKey(url, bodyText) {
  const body = parseJson(bodyText) || {};
  return [url.pathname, body.model || "", body.text?.format?.name || (body.tools?.[0]?.type ?? "")].filter(Boolean).join(" ");
}

function aiSummary(bodyText) {
  const body = parseJson(bodyText) || {};
  return { model: body.model || "", format: body.text?.format?.name || "" };
}

// Keeps the recording small: generated pictures become a small copy, and the
// model's reasoning items (opaque blobs the app never reads) are dropped.
export async function slimResponse(text) {
  const data = parseJson(text);
  if (!data) return text;
  if (Array.isArray(data.output)) data.output = data.output.filter((item) => item?.type !== "reasoning");
  const { Jimp, JimpMime } = await import("jimp");
  const shrink = async (b64) => {
    const image = await Jimp.read(Buffer.from(b64, "base64"));
    image.resize({ w: 96 });
    return (await image.getBuffer(JimpMime.png)).toString("base64");
  };
  for (const item of data.data || []) if (item?.b64_json) item.b64_json = await shrink(item.b64_json);
  for (const item of data.output || []) if (item?.type === "image_generation_call" && item.result) item.result = await shrink(item.result);
  return JSON.stringify(data);
}

function findSecrets(text, secrets) {
  if (secrets.some((secret) => text.includes(secret))) return "a configured secret";
  const pattern = [/\bsk-[A-Za-z0-9_-]{16,}/, /Bearer\s+[A-Za-z0-9._-]{16,}/i, /\borg-[A-Za-z0-9]{16,}/, /\bproj_[A-Za-z0-9]{16,}/]
    .find((regex) => regex.test(text));
  return pattern ? `matches ${pattern}` : "";
}

function modelSha(url) {
  return url.pathname.match(/\/([a-f0-9]{64})\.glb$/)?.[1] || "";
}

function parseJson(text) {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
