import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createMemoryStore } from "../lib/storage/memory-store.mjs";
import { EventEmitter } from "node:events";
import { createEnclosureJobs, dockerDispatch, enclosureJobsRoute, fargateDispatch, isJobId, newJobId, publicJob, s3Outputs } from "../lib/enclosure-jobs.mjs";
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
  const jobs = createEnclosureJobs({ store, dispatch, runsDir, now: () => new Date(clock.at), limits: options.limits, ...(options.outputs ? { outputs: options.outputs } : {}) });
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

test("the cap across all users holds when many users start at the same moment", async () => {
  // Each start used to count the running jobs before taking its own place, so all of them saw room.
  const { jobs, started, finish } = setup({ limits: { runningAtOnce: 3 } });
  const replies = await Promise.all(Array.from({ length: 8 }, (_, i) => jobs.start(`user-${i + 1}`, { design: DESIGN })));
  assert.equal(replies.filter((r) => r.status === 202).length, 3);
  assert.equal(replies.filter((r) => r.status === 503).length, 5);
  assert.equal(started.length, 3);
  const winner = replies.findIndex((r) => r.status === 202);
  const refused = replies.findIndex((r) => r.status === 503);
  const first = replies[winner].body.job.id;
  finish(first, passed(first));
  await jobs.status(`user-${winner + 1}`, first);
  assert.equal((await jobs.start(`user-${refused + 1}`, { design: DESIGN })).status, 202, "a refused user was not left holding a slot, and a finished job frees its place");
});

test("a place left by a job that crashed is freed by the cleanup, and a live job's place never is", async () => {
  const { jobs, store, later } = setup({ limits: { runningAtOnce: 1 } });
  const crashed = { id: "enc-crashed00000", owner: "user-9", design: DESIGN, state: "FAIL", createdAt: "2026-11-03T10:00:00.000Z", finishedAt: "2026-11-03T10:00:00.000Z" };
  await store.setJSON(`job/${crashed.id}`, crashed);
  await store.setJSON("place/0", { id: crashed.id, at: crashed.createdAt });
  later(2 * MINUTE);
  // Freeing is a read then a delete, so two starts doing it at once could free a live place. Only the schedule does it.
  assert.equal((await jobs.start("user-1", { design: DESIGN })).status, 503, "a start never frees places itself");
  await jobs.reap();
  assert.equal((await jobs.start("user-1", { design: DESIGN })).status, 202, "the scheduled cleanup freed the stale place");
  assert.equal((await jobs.start("user-2", { design: DESIGN })).status, 503, "the live job keeps its place");
});

test("cancel is idempotent: a second cancel while the task is starting changes nothing", async () => {
  const dispatch = slowDispatch();
  const { jobs, store } = setup({ dispatch, limits: { runningAtOnce: 1 } });
  const starting = jobs.start("user-1", { design: DESIGN });
  await new Promise((resolve) => setImmediate(resolve));
  const id = await onlyJobId(store);
  await jobs.cancel("user-1", id);
  const again = await jobs.cancel("user-1", id);
  assert.equal(again.body.job.state, "STOPPING");
  assert.equal((await jobs.start("user-2", { design: DESIGN })).status, 503, "a double click does not free the place while the task may still start");
  dispatch.release();
  await starting;
  assert.equal((await jobs.status("user-1", id)).body.job.state, "CANCELLED");
});

test("cancel stops a job that was already running before start and cancel shared a key", async () => {
  // Jobs started by the version before this one have no phase key.
  const { jobs, store, stopped } = setup();
  const { body } = await jobs.start("user-1", { design: DESIGN });
  await store.delete(`phase/${body.job.id}`);
  const reply = await jobs.cancel("user-1", body.job.id);
  assert.equal(reply.body.job.state, "CANCELLED");
  assert.deepEqual(stopped, [body.job.id]);
});

test("cancelling a job whose start failed leaves it failed", async () => {
  let fail;
  const gate = new Promise((resolve) => { fail = resolve; });
  const dispatch = { start: async () => { await gate; throw new Error("RunTask failed"); }, stop: async () => {} };
  // Cancel reads the job while it is starting, then pauses; the start fails; then cancel carries on with what it read.
  let pause = false;
  let resume;
  const outputs = {
    async read() {
      if (pause) {
        pause = false;
        await new Promise((resolve) => { resume = resolve; });
      }
      return { result: null, progress: null };
    },
    async file() { return null; },
  };
  const { jobs, store } = setup({ dispatch, outputs });
  const starting = jobs.start("user-1", { design: DESIGN });
  await new Promise((resolve) => setImmediate(resolve));
  const id = await onlyJobId(store);
  pause = true;
  const cancelling = jobs.cancel("user-1", id);
  await new Promise((resolve) => setImmediate(resolve));
  fail();
  await starting;
  resume();
  const reply = await cancelling;
  assert.equal(reply.body.job.state, "FAIL");
  assert.equal(reply.body.job.reason, "dispatch_failed");
});

test("status reads never retry a failed stop; only the cleanup does", async () => {
  const dispatch = slowDispatch({ failStops: 1000 });
  dispatch.release();
  let stopCalls = 0;
  const counted = { start: dispatch.start, stop: async (job) => { stopCalls += 1; return dispatch.stop(job); } };
  const { jobs } = setup({ dispatch: counted });
  const { body } = await jobs.start("user-1", { design: DESIGN });
  await jobs.cancel("user-1", body.job.id);
  for (let i = 0; i < 5; i += 1) await jobs.status("user-1", body.job.id);
  assert.equal(stopCalls, 1, "five polls made no more StopTask calls");
  await jobs.reap();
  assert.equal(stopCalls, 2);
});

// A dispatch whose start waits until the test lets it finish, as RunTask does while AWS places the task.
function slowDispatch({ failStops = 0 } = {}) {
  const stopped = [];
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  return {
    stopped,
    release: () => release(),
    async start(job) {
      await gate;
      return { taskArn: `arn:task/${job.id}` };
    },
    async stop(job) {
      if (failStops > 0) {
        failStops -= 1;
        throw new Error("StopTask failed");
      }
      stopped.push(job.taskArn || job.id);
    },
  };
}

async function onlyJobId(store) {
  const { blobs } = await store.list({ prefix: "job/" });
  return blobs[0].key.slice("job/".length);
}

test("a cancel while the task is still starting stops it once it has started, and holds its place until then", async () => {
  const dispatch = slowDispatch();
  const { jobs, store } = setup({ dispatch, limits: { runningAtOnce: 1, jobsPerUserPerDay: 1 } });
  const starting = jobs.start("user-1", { design: DESIGN });
  await new Promise((resolve) => setImmediate(resolve));
  const id = await onlyJobId(store);
  const cancelled = await jobs.cancel("user-1", id);
  assert.equal(cancelled.body.job.state, "STOPPING");
  assert.equal((await jobs.start("user-2", { design: DESIGN })).status, 503, "the task may still start, so its place is still taken");
  dispatch.release();
  await starting;
  assert.deepEqual(dispatch.stopped, [`arn:task/${id}`], "the task that started after the cancel is stopped");
  assert.equal((await jobs.status("user-1", id)).body.job.state, "CANCELLED");
  assert.equal((await jobs.start("user-2", { design: DESIGN })).status, 202, "the place is free once the task is stopped");
  assert.equal((await jobs.start("user-1", { design: DESIGN })).status, 429, "a task that did start counts toward the day");
});

test("a stop that fails keeps the job tracked and its place taken, and the cleanup retries it", async () => {
  const dispatch = slowDispatch({ failStops: 2 }); // fails in cancel, and again in the cleanup that the next start runs;
  dispatch.release();
  const { jobs } = setup({ dispatch, limits: { runningAtOnce: 1 } });
  const { body } = await jobs.start("user-1", { design: DESIGN });
  const reply = await jobs.cancel("user-1", body.job.id);
  assert.equal(reply.body.job.state, "STOPPING", "it is not reported stopped while AWS has not stopped it");
  assert.equal((await jobs.start("user-2", { design: DESIGN })).status, 503);
  await jobs.reap();
  assert.deepEqual(dispatch.stopped, [`arn:task/${body.job.id}`]);
  assert.equal((await jobs.status("user-1", body.job.id)).body.job.state, "CANCELLED");
  assert.equal((await jobs.start("user-2", { design: DESIGN })).status, 202);
});

test("a failing stop on one job does not break the cleanup, status reads or other users' starts", async () => {
  const dispatch = slowDispatch({ failStops: 1 });
  dispatch.release();
  const { jobs, later } = setup({ dispatch, limits: { runningAtOnce: 3 } });
  const a = (await jobs.start("user-1", { design: DESIGN })).body.job.id;
  await jobs.start("user-2", { design: DESIGN });
  later(25 * MINUTE);
  await jobs.reap();
  assert.equal(dispatch.stopped.length, 1, "the second stuck job was still stopped after the first stop failed");
  assert.equal((await jobs.status("user-1", a)).status, 200);
  assert.equal((await jobs.start("user-3", { design: DESIGN })).status, 202);
});

test("a result written while a job is stopping does not make it a pass", async () => {
  const dispatch = slowDispatch({ failStops: 1 });
  dispatch.release();
  const { jobs, finish } = setup({ dispatch });
  const { body } = await jobs.start("user-1", { design: DESIGN });
  await jobs.cancel("user-1", body.job.id);
  finish(body.job.id, passed(body.job.id));
  const job = (await jobs.status("user-1", body.job.id)).body.job;
  assert.equal(job.state, "CANCELLED");
  assert.equal(job.files, undefined);
});

test("a job that never confirms its stop does not stay stopping for ever", async () => {
  const dispatch = slowDispatch({ failStops: 1000 });
  dispatch.release();
  const { jobs, later } = setup({ dispatch, limits: { runningAtOnce: 1 } });
  const { body } = await jobs.start("user-1", { design: DESIGN });
  await jobs.cancel("user-1", body.job.id);
  later(61 * MINUTE);
  await jobs.reap();
  assert.equal((await jobs.status("user-1", body.job.id)).body.job.state, "CANCELLED", "past the longest run the task has ended by itself");
  assert.equal((await jobs.start("user-2", { design: DESIGN })).status, 202);
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

// AWS: one Fargate task per job, output in S3. Clients are faked; the real ones are checked on AWS.
function fakeEcs({ fail = false } = {}) {
  const sent = [];
  return {
    sent,
    async send(command) {
      sent.push({ name: command.constructor.name, input: command.input });
      if (command.constructor.name === "RunTaskCommand") {
        return fail ? { tasks: [], failures: [{ reason: "RESOURCE:CPU" }] } : { tasks: [{ taskArn: `arn:aws:ecs:task/${command.input.startedBy}` }] };
      }
      return {};
    },
  };
}

const FARGATE = { cluster: "makeable-enclosure", taskDefinition: "makeable-enclosure", subnets: ["subnet-a", "subnet-b"], securityGroups: ["sg-1"], bucket: "data-bucket" };

test("fargate: a job runs one task with its own output prefix, and no picture key unless one was chosen", async () => {
  const ecs = fakeEcs();
  const dispatch = fargateDispatch({ ecs, ...FARGATE });
  assert.deepEqual(await dispatch.start({ id: "enc-aaaaaaaaaaaa", design: DESIGN }), { taskArn: "arn:aws:ecs:task/enc-aaaaaaaaaaaa" });
  const input = ecs.sent[0].input;
  assert.equal(input.launchType, "FARGATE");
  assert.deepEqual(input.networkConfiguration.awsvpcConfiguration, { subnets: ["subnet-a", "subnet-b"], securityGroups: ["sg-1"], assignPublicIp: "ENABLED" });
  const override = input.overrides.containerOverrides[0];
  assert.deepEqual(override.command, ["python", "-W", "ignore", "cloud_run.py", `base_designs/${DESIGN}.json`, "enc-aaaaaaaaaaaa"]);
  assert.deepEqual(override.environment, [{ name: "ENCLOSURE_BUCKET", value: "data-bucket" }, { name: "ENCLOSURE_PREFIX", value: "makeable-enclosure-runs/enc-aaaaaaaaaaaa/" }]);
  assert.equal(JSON.stringify(input).includes("OPENAI"), false, "the key is never in the request; the task definition reads it from Secrets Manager");
  await dispatch.start({ id: "enc-bbbbbbbbbbbb", design: DESIGN, pictureFile: "pic-cccccccccccc.png" });
  assert.deepEqual(ecs.sent[1].input.overrides.containerOverrides[0].environment.at(-1), { name: "ENCLOSURE_PICTURE_KEY", value: "makeable-enclosure-pictures/pic-cccccccccccc.png" });
});

test("fargate: a task that cannot start fails the job, and cancel stops the task by its arn", async () => {
  const failing = fargateDispatch({ ecs: fakeEcs({ fail: true }), ...FARGATE });
  await assert.rejects(failing.start({ id: "enc-aaaaaaaaaaaa", design: DESIGN }), /RESOURCE:CPU/);
  const ecs = fakeEcs();
  const { jobs, store } = setup({ dispatch: fargateDispatch({ ecs, ...FARGATE }) });
  const { body } = await jobs.start("user-1", { design: DESIGN });
  assert.equal((await store.get(`job/${body.job.id}`, { type: "json" })).taskArn, `arn:aws:ecs:task/${body.job.id}`);
  assert.equal(JSON.stringify(body).includes("arn:aws"), false, "the task arn is not shown to the user");
  await jobs.cancel("user-1", body.job.id);
  assert.deepEqual(ecs.sent.at(-1), { name: "StopTaskCommand", input: { cluster: "makeable-enclosure", task: `arn:aws:ecs:task/${body.job.id}`, reason: "Stopped by the enclosure job API" } });
});

test("fargate: a failed StopTask is reported, and a task that is already gone counts as stopped", async () => {
  const failing = fargateDispatch({ ecs: { send: async () => { throw new Error("throttled"); } }, ...FARGATE });
  await assert.rejects(failing.stop({ id: "enc-aaaaaaaaaaaa", taskArn: "arn:x" }), /throttled/);
  const gone = fargateDispatch({ ecs: { send: async () => { throw Object.assign(new Error("The referenced task was not found."), { name: "InvalidParameterException" }); } }, ...FARGATE });
  await gone.stop({ id: "enc-aaaaaaaaaaaa", taskArn: "arn:x" });
  // A wrong cluster setting must not look like a stopped task, or places are freed while tasks keep running.
  const noCluster = fargateDispatch({ ecs: { send: async () => { throw Object.assign(new Error("Cluster not found."), { name: "ClusterNotFoundException" }); } }, ...FARGATE });
  await assert.rejects(noCluster.stop({ id: "enc-aaaaaaaaaaaa", taskArn: "arn:x" }), /Cluster not found/);
});

function fakeS3(objects = {}) {
  const sent = [];
  return {
    objects,
    sent,
    async send(command) {
      const { Key, Body } = command.input;
      sent.push(command.constructor.name);
      if (command.constructor.name === "PutObjectCommand") { objects[Key] = Body; return {}; }
      if (!(Key in objects)) throw Object.assign(new Error("missing"), { name: "NoSuchKey", $metadata: { httpStatusCode: 404 } });
      return { Body: { transformToString: async () => objects[Key] } };
    },
  };
}

test("s3: status, files and pictures come from the bucket, and files are short-lived links", async () => {
  const client = fakeS3();
  const signed = [];
  const outputs = s3Outputs({ client, bucket: "data-bucket", sign: async (_c, command, options) => { signed.push([command.input, options]); return "https://signed.example/file"; } });
  const { jobs } = setup({ outputs });
  const { body } = await jobs.start("user-1", { design: DESIGN });
  const id = body.job.id;
  assert.equal((await jobs.status("user-1", id)).body.job.state, "RUNNING", "no result yet in S3");
  client.objects[`makeable-enclosure-runs/${id}/progress.json`] = JSON.stringify({ stage: "body", updated: "2026-11-03T10:00:00Z" });
  assert.equal((await jobs.status("user-1", id)).body.job.progress.stage, "body");
  client.objects[`makeable-enclosure-runs/${id}/result.json`] = JSON.stringify(passed(id));
  assert.equal((await jobs.status("user-1", id)).body.job.state, "PASS");
  const file = await jobs.file("user-1", id, "PRINT_Shell.stl");
  assert.deepEqual(file, { status: 200, url: "https://signed.example/file" });
  assert.equal(signed[0][0].Key, `makeable-enclosure-runs/${id}/files/PRINT_Shell.stl`);
  assert.equal(signed[0][1].expiresIn, 300);
  assert.equal((await jobs.file("user-2", id, "PRINT_Shell.stl")).status, 404, "never signed for another user");
  assert.equal(signed.length, 1);
  const picture = await jobs.savePicture("user-1", PNG);
  assert.ok(client.objects[`makeable-enclosure-pictures/${picture.pictureId}.png`]);
});

test("routes: on AWS a file request redirects to the short-lived link", async () => {
  const route = enclosureJobsRoute({
    jobs: { file: async () => ({ status: 200, url: "https://signed.example/file" }) },
    authenticate: async () => ({ ok: true, user: { sub: "user-1" } }),
  });
  const response = await route(new Request("https://makeable.build/api/enclosure-jobs/enc-aaaaaaaaaaaa/files/PRINT_Shell.stl"), "/api/enclosure-jobs/enc-aaaaaaaaaaaa/files/PRINT_Shell.stl");
  assert.equal(response.status, 302);
  assert.equal(response.headers.get("location"), "https://signed.example/file");
});
