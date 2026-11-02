import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createMemoryStore } from "../lib/storage/memory-store.mjs";
import { EventEmitter } from "node:events";
import { createEnclosureJobs, dockerDispatch, enclosureJobsRoute, isJobId, newJobId, publicJob } from "../lib/enclosure-jobs.mjs";
import handler from "../netlify/functions/api.mjs";

const MINUTE = 60_000;

function setup(options = {}) {
  const runsDir = mkdtempSync(path.join(os.tmpdir(), "enclosure-jobs-"));
  mkdirSync(path.join(runsDir, "jobs"), { recursive: true });
  const started = [];
  const stopped = [];
  const clock = { at: Date.parse("2026-11-03T10:00:00Z") };
  const dispatch = options.dispatch || { start: async (job) => started.push(job.id) && (options.seen || []).push(job), stop: async (job) => stopped.push(job.id) };
  const store = createMemoryStore();
  const jobs = createEnclosureJobs({ store, dispatch, runsDir, now: () => new Date(clock.at), limits: options.limits });
  const write = (name, value) => writeFileSync(path.join(runsDir, "jobs", name), JSON.stringify(value));
  const finish = (id, result) => write(`${id}.json`, result);
  const progress = (id, at) => write(`${id}.progress.json`, { stage: "case", updated: new Date(at).toISOString() });
  const later = (ms) => { clock.at += ms; };
  return { jobs, store, started, stopped, finish, progress, later, runsDir };
}

const DESIGN = "s3-screen-button";
const passed = (id) => ({ status: "PASS", message: "Your case is ready.", model: `runs/agent/${id}/case/try-1`, tokens: 50000, seconds: 400, attempts: [] });

test("a job id has a fixed shape", () => {
  assert.ok(isJobId(newJobId()));
  assert.equal(isJobId("../etc"), false);
});

test("an unknown design is refused before anything starts", async () => {
  const { jobs, started } = setup();
  const reply = await jobs.start("user-1", { design: "../../secret" });
  assert.equal(reply.status, 400);
  assert.equal(started.length, 0);
});

test("a job starts once, and the same request id returns the same job", async () => {
  const { jobs, started } = setup();
  const first = await jobs.start("user-1", { design: DESIGN, requestId: "abcdefgh1" });
  assert.equal(first.status, 202);
  const again = await jobs.start("user-1", { design: DESIGN, requestId: "abcdefgh1" });
  assert.equal(again.body.job.id, first.body.job.id);
  assert.equal(started.length, 1);
});

test("one active job per user, even when two starts arrive together", async () => {
  const { jobs, started } = setup();
  const [a, b] = await Promise.all([jobs.start("user-1", { design: DESIGN }), jobs.start("user-1", { design: DESIGN })]);
  assert.deepEqual([a.status, b.status].sort(), [202, 409]);
  assert.equal(started.length, 1);
  assert.equal((await jobs.start("user-2", { design: DESIGN })).status, 202);
});

test("status shows the result once the container writes it, and frees the user for a new job", async () => {
  const { jobs, finish } = setup();
  const { body } = await jobs.start("user-1", { design: DESIGN });
  const id = body.job.id;
  assert.equal((await jobs.status("user-1", id)).body.job.state, "RUNNING");
  finish(id, { ...passed(id), status: "PASS WITH WARNINGS" });
  const done = (await jobs.status("user-1", id)).body.job;
  assert.equal(done.state, "PASS WITH WARNINGS");
  assert.equal(done.files.length, 4);
  assert.equal((await jobs.start("user-1", { design: DESIGN })).status, 202);
});

test("another user cannot see, cancel or download a job", async () => {
  const { jobs, finish } = setup();
  const { body } = await jobs.start("user-1", { design: DESIGN });
  finish(body.job.id, passed(body.job.id));
  assert.equal((await jobs.status("user-2", body.job.id)).status, 404);
  assert.equal((await jobs.cancel("user-2", body.job.id)).status, 404);
  assert.equal((await jobs.file("user-2", body.job.id, "report.json")).status, 404);
});

test("cancel stops the container and frees the user", async () => {
  const { jobs, stopped } = setup();
  const { body } = await jobs.start("user-1", { design: DESIGN });
  const reply = await jobs.cancel("user-1", body.job.id);
  assert.equal(reply.body.job.state, "CANCELLED");
  assert.deepEqual(stopped, [body.job.id]);
  assert.equal((await jobs.start("user-1", { design: DESIGN })).status, 202);
});

test("a job with no progress for too long is stopped, failed with a reason, and frees the user", async () => {
  const { jobs, stopped, progress, later } = setup();
  const { body } = await jobs.start("user-1", { design: DESIGN });
  const id = body.job.id;
  later(10 * MINUTE);
  progress(id, Date.parse("2026-11-03T10:10:00Z"));
  later(15 * MINUTE);
  assert.equal((await jobs.status("user-1", id)).body.job.state, "RUNNING", "progress 15 minutes ago is still alive");
  later(10 * MINUTE);
  const stuck = (await jobs.status("user-1", id)).body.job;
  assert.equal(stuck.state, "FAIL");
  assert.equal(stuck.reason, "stuck");
  assert.match(stuck.message, /stopped responding/);
  assert.deepEqual(stopped, [id]);
  assert.equal((await jobs.start("user-1", { design: DESIGN })).status, 202);
});

test("a job that keeps reporting progress is still stopped after the longest allowed run", async () => {
  const { jobs, stopped, progress, later } = setup();
  const { body } = await jobs.start("user-1", { design: DESIGN });
  for (let minute = 10; minute <= 70; minute += 10) {
    later(10 * MINUTE);
    progress(body.job.id, Date.parse("2026-11-03T10:00:00Z") + minute * MINUTE);
  }
  const job = (await jobs.status("user-1", body.job.id)).body.job;
  assert.equal(job.state, "FAIL");
  assert.equal(job.reason, "too_long");
  assert.deepEqual(stopped, [body.job.id]);
});

test("a result written after the server stopped the job does not change the answer", async () => {
  const { jobs, finish } = setup();
  const { body } = await jobs.start("user-1", { design: DESIGN });
  await jobs.cancel("user-1", body.job.id);
  finish(body.job.id, passed(body.job.id));
  const job = (await jobs.status("user-1", body.job.id)).body.job;
  assert.equal(job.state, "CANCELLED");
  assert.equal(job.files, undefined);
  assert.equal((await jobs.file("user-1", body.job.id, "report.json")).status, 404);
});

test("each user has a daily limit, and the refusal is recorded with its reason", async () => {
  const { jobs, store, finish, later } = setup({ limits: { jobsPerUserPerDay: 2 } });
  for (let n = 0; n < 2; n += 1) {
    const { body } = await jobs.start("user-1", { design: DESIGN });
    finish(body.job.id, passed(body.job.id));
    await jobs.status("user-1", body.job.id);
  }
  const refused = await jobs.start("user-1", { design: DESIGN });
  assert.equal(refused.status, 429);
  assert.equal(refused.body.job.state, "REFUSED");
  assert.equal(refused.body.job.reason, "daily_limit");
  assert.ok(refused.retryAfterSeconds > 0);
  assert.equal((await store.get(`job/${refused.body.job.id}`, { type: "json" })).reason, "daily_limit");
  assert.equal((await jobs.start("user-2", { design: DESIGN })).status, 202, "other users are not affected");
  later(24 * 60 * MINUTE);
  assert.equal((await jobs.start("user-1", { design: DESIGN })).status, 202, "the limit resets the next day");
});

test("a failed container start does not use up the daily limit", async () => {
  const dispatch = { start: async () => { throw new Error("docker is not running"); }, stop: async () => {} };
  const { jobs } = setup({ dispatch, limits: { jobsPerUserPerDay: 1 } });
  const first = await jobs.start("user-1", { design: DESIGN });
  assert.equal(first.status, 503);
  assert.equal(first.body.job.state, "FAIL");
  assert.equal(first.body.job.reason, "dispatch_failed");
  assert.equal(JSON.stringify(first.body).includes("docker"), false, "the machine error is not shown to the user");
  assert.equal((await jobs.start("user-1", { design: DESIGN })).status, 503, "the user was freed and the limit not used");
});

test("only a set number of jobs run at once across all users", async () => {
  const { jobs, finish, started } = setup({ limits: { runningAtOnce: 2 } });
  const a = await jobs.start("user-1", { design: DESIGN });
  await jobs.start("user-2", { design: DESIGN });
  const busy = await jobs.start("user-3", { design: DESIGN });
  assert.equal(busy.status, 503);
  assert.equal(busy.body.job.reason, "busy");
  assert.equal(started.length, 2);
  assert.equal((await jobs.start("user-3", { design: DESIGN })).status, 503, "a busy refusal does not hold the user's slot");
  finish(a.body.job.id, passed(a.body.job.id));
  assert.equal((await jobs.start("user-3", { design: DESIGN })).status, 202, "a finished job frees a place");
});

test("the cleanup frees places held by stuck jobs", async () => {
  const { jobs, later } = setup({ limits: { runningAtOnce: 1 } });
  const { body } = await jobs.start("user-1", { design: DESIGN });
  later(25 * MINUTE);
  const swept = await jobs.reap();
  assert.deepEqual(swept, [body.job.id]);
  assert.equal((await jobs.start("user-2", { design: DESIGN })).status, 202);
});

test("files are served only from the job's own model folder", async () => {
  const { jobs, finish, runsDir } = setup();
  const { body } = await jobs.start("user-1", { design: DESIGN });
  const id = body.job.id;
  const folder = path.join(runsDir, "agent", id, "case", "try-1");
  mkdirSync(folder, { recursive: true });
  writeFileSync(path.join(folder, "PRINT_Shell.stl"), "solid x");
  finish(id, passed(id));
  assert.equal((await jobs.file("user-1", id, "PRINT_Shell.stl")).status, 200);
  assert.equal((await jobs.file("user-1", id, "../../../.env")).status, 404);
});

test("the public view never shows the owner, machine paths or machine errors", () => {
  const view = publicJob({ id: "enc-aaaaaaaaaaaa", owner: "secret-sub", design: "x", state: "FAIL", error: "spawn docker ENOENT", createdAt: "t" }, { result: { status: "PASS", model: "runs/agent/x", attempts: [] } });
  const text = JSON.stringify(view);
  for (const hidden of ["secret-sub", "runs/agent", "ENOENT"]) assert.equal(text.includes(hidden), false, hidden);
});

// The HTTP layer: sign-in, origin, methods and body checks, in front of the job logic.
function routeSetup(user = { sub: "user-1" }) {
  const { jobs, finish } = setup();
  const route = enclosureJobsRoute({
    jobs,
    authenticate: async () => (user ? { ok: true, user } : { ok: false, response: Response.json({ error: "Log in" }, { status: 401 }) }),
  });
  const call = (method, pathname, { body, origin } = {}) => route(new Request(`https://makeable.build${pathname}`, {
    method,
    headers: { ...(origin ? { Origin: origin } : {}), ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  }), pathname);
  return { call, finish };
}

test("routes: signed-out requests get 401 and nothing starts", async () => {
  const { call } = routeSetup(null);
  for (const [method, route] of [["POST", "/api/enclosure-jobs"], ["GET", "/api/enclosure-jobs/enc-aaaaaaaaaaaa"], ["DELETE", "/api/enclosure-jobs/enc-aaaaaaaaaaaa"], ["GET", "/api/enclosure-jobs/enc-aaaaaaaaaaaa/files/report.json"]]) {
    assert.equal((await call(method, route, method === "POST" ? { body: { design: DESIGN } } : {})).status, 401, `${method} ${route}`);
  }
});

test("routes: a request from another site gets 403", async () => {
  const { call } = routeSetup();
  assert.equal((await call("POST", "/api/enclosure-jobs", { body: { design: DESIGN }, origin: "https://evil.example" })).status, 403);
  assert.equal((await call("POST", "/api/enclosure-jobs", { body: { design: DESIGN }, origin: "https://makeable.build" })).status, 202);
});

test("routes: wrong methods get 405, and bad or huge bodies get 400", async () => {
  const { call } = routeSetup();
  assert.equal((await call("GET", "/api/enclosure-jobs")).status, 405);
  assert.equal((await call("PUT", "/api/enclosure-jobs/enc-aaaaaaaaaaaa")).status, 405);
  assert.equal((await call("POST", "/api/enclosure-jobs", { body: "{not json" })).status, 400);
  assert.equal((await call("POST", "/api/enclosure-jobs", { body: { design: "x".repeat(5000) } })).status, 400);
  assert.equal((await call("POST", "/api/enclosure-jobs", { body: { design: DESIGN, requestId: "bad id!" } })).status, 400);
});

test("routes: a full run through HTTP, start, status, file and limit headers", async () => {
  const { call, finish } = routeSetup();
  const started = await call("POST", "/api/enclosure-jobs", { body: { design: DESIGN, requestId: "abcdefgh1" } });
  assert.equal(started.status, 202);
  assert.equal(started.headers.get("cache-control"), "no-store");
  const { job } = await started.json();
  assert.equal((await call("POST", "/api/enclosure-jobs", { body: { design: DESIGN } })).status, 409);
  finish(job.id, passed(job.id));
  assert.equal((await (await call("GET", `/api/enclosure-jobs/${job.id}`)).json()).job.state, "PASS");
  assert.equal((await call("GET", `/api/enclosure-jobs/${job.id}/files/..%2F..%2F.env`)).status, 404);
});

test("the site API answers 503 when enclosure jobs are not set up, and 401 when signed out", async () => {
  const saved = process.env.MAKEABLE_ENCLOSURE_DISPATCH;
  const savedBackend = process.env.MAKEABLE_STORAGE_BACKEND;
  process.env.MAKEABLE_STORAGE_BACKEND = "memory";
  try {
    delete process.env.MAKEABLE_ENCLOSURE_DISPATCH;
    assert.equal((await handler(new Request("https://makeable.build/api/enclosure-jobs", { method: "POST", body: "{}" }))).status, 503);
    process.env.MAKEABLE_ENCLOSURE_DISPATCH = "docker";
    assert.equal((await handler(new Request("https://makeable.build/api/enclosure-jobs", { method: "POST", body: "{}" }))).status, 401);
  } finally {
    if (saved === undefined) delete process.env.MAKEABLE_ENCLOSURE_DISPATCH;
    else process.env.MAKEABLE_ENCLOSURE_DISPATCH = saved;
    if (savedBackend === undefined) delete process.env.MAKEABLE_STORAGE_BACKEND;
    else process.env.MAKEABLE_STORAGE_BACKEND = savedBackend;
  }
});

// A picture the user chose for the look. Optional: without one, nothing changes.
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(100)]);

test("a saved picture can be chosen by its owner, and the container is given it", async () => {
  const seen = [];
  const { jobs } = setup({ seen });
  const saved = await jobs.savePicture("user-1", PNG);
  assert.equal(saved.status, 201);
  const reply = await jobs.start("user-1", { design: DESIGN, pictureId: saved.pictureId });
  assert.equal(reply.status, 202);
  assert.equal(reply.body.job.pictureId, saved.pictureId);
  assert.equal(seen[0].pictureFile, `${saved.pictureId}.png`);
});

test("another user's picture, a made-up id, or a file that is not an image is refused before anything starts", async () => {
  const { jobs, started } = setup();
  const saved = await jobs.savePicture("user-1", PNG);
  assert.equal((await jobs.start("user-2", { design: DESIGN, pictureId: saved.pictureId })).status, 400);
  assert.equal((await jobs.start("user-1", { design: DESIGN, pictureId: "pic-aaaaaaaaaaaa" })).status, 400);
  assert.equal((await jobs.start("user-1", { design: DESIGN, pictureId: "../../.env" })).status, 400);
  assert.equal((await jobs.savePicture("user-1", Buffer.from("<svg>not a png</svg>"))).status, 400);
  assert.equal(started.length, 0);
});

test("the docker command is unchanged without a picture, and adds only the picture path with one", async () => {
  const commands = [];
  const spawnFn = (cmd, args) => {
    commands.push([cmd, ...args]);
    const child = new EventEmitter();
    setImmediate(() => child.emit("exit", 0));
    return child;
  };
  const dispatch = dockerDispatch({ runsDir: "/runs", spawnFn, env: {} });
  await dispatch.start({ id: "enc-aaaaaaaaaaaa", design: DESIGN });
  await dispatch.start({ id: "enc-bbbbbbbbbbbb", design: DESIGN, pictureFile: "pic-cccccccccccc.png" });
  const before = ["docker", "run", "-d", "--rm", "--platform", "linux/amd64", "--name", "enc-aaaaaaaaaaaa", "-e", "OPENAI_API_KEY",
    "-e", "ENCLOSURE_PROGRESS_PATH=runs/jobs/enc-aaaaaaaaaaaa.progress.json", "-v", "/runs:/app/enclosure/runs", "makeable-enclosure",
    "python", "-W", "ignore", "generate.py", `base_designs/${DESIGN}.json`, "enc-aaaaaaaaaaaa"];
  assert.deepEqual(commands[0], before);
  assert.deepEqual(commands[1].at(-1), "runs/pictures/pic-cccccccccccc.png");
  assert.equal(commands[1].length, before.length + 1);
});

test("routes: pictureId is passed through, and a bad one gets 400", async () => {
  const { call } = routeSetup();
  assert.equal((await call("POST", "/api/enclosure-jobs", { body: { design: DESIGN, pictureId: "pic-aaaaaaaaaaaa" } })).status, 400);
});
