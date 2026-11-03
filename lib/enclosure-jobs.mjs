// Enclosure jobs: one signed-in user asks for a 3D-printable case, and a
// container generates it in the background. The API only records the job,
// starts the container and reports what the container wrote. The generator
// itself lives in enclosure/ (Python), and runs on the laptop through Docker
// or, later, on AWS as a Fargate task. Only the dispatch differs.
//
// The job record in the store is the one source of truth. How a job moves:
//
//   start ─┬─ refused (bad input)        400, nothing saved
//          ├─ refused (limit)            REFUSED + reason, saved, nothing started
//          └─ STARTING ─┬─ dispatch fails ─────────────── FAIL (dispatch_failed)
//                       └─ RUNNING ─┬─ container writes its result ── PASS / PASS WITH WARNINGS / FAIL
//                                   ├─ user cancels ───────────────── CANCELLED
//                                   └─ no progress, or too long ───── FAIL (stuck / too_long)
//
// Docs: docs/enclosure-jobs.md.
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const ENCLOSURE_JOB_STORE = "makeable-enclosure-jobs";
const DESIGN_NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;
const REQUEST_ID = /^[A-Za-z0-9_-]{8,64}$/;
const JOB_ID = /^enc-[a-z0-9]{12}$/;
const PICTURE_ID = /^pic-[a-z0-9]{12}$/;
const PICTURE_MAX_BYTES = 10 * 1024 * 1024;
const FILE_NAME = /^(PRINT_[A-Za-z0-9]+\.stl|preview\.png|report\.json|design\.json)$/;
const FINAL = new Set(["PASS", "PASS WITH WARNINGS", "FAIL", "CANCELLED", "REFUSED"]);
const MINUTE = 60_000;

// A normal job takes 4 to 12 minutes and writes progress at least every few minutes.
// The limits are generous on time and strict on count, because each job costs AI tokens.
export const ENCLOSURE_JOB_LIMITS = Object.freeze({
  jobsPerUserPerDay: 5, // started jobs per user per UTC day; a failed container start does not count
  runningAtOnce: 3, // jobs running at the same time across all users
  noProgressMinutes: 20, // longer than one slow AI call plus its checks
  maxRunMinutes: 60, // longest a job may run, even while it reports progress
});

const MESSAGES = {
  busy_user: "You already have a case being made. Wait for it to finish, or cancel it.",
  daily_limit: "You have made today's limit of cases. You can make more tomorrow.",
  busy: "The case maker is busy. Try again in a minute.",
  dispatch_failed: "The case maker could not start. Try again in a minute.",
  stuck: "The case maker stopped responding, so this job was stopped. You can start it again.",
  too_long: "This job took too long, so it was stopped. You can start it again.",
};

export function newJobId(random = randomBytes) {
  return `enc-${random(9).toString("base64url").toLowerCase().replace(/[^a-z0-9]/g, "0").slice(0, 12)}`;
}

function newId(prefix, random = randomBytes) {
  return `${prefix}-${random(9).toString("base64url").toLowerCase().replace(/[^a-z0-9]/g, "0").slice(0, 12)}`;
}

// PNG or JPEG, by its first bytes. Returns the file extension, or null.
export function pictureType(bytes) {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpg";
  return null;
}

export function isJobId(value) {
  return JOB_ID.test(String(value || ""));
}

function designExists(design, root = ROOT) {
  return DESIGN_NAME.test(design) && existsSync(path.join(root, "enclosure", "base_designs", `${design}.json`));
}

// What the container has written so far: progress while it runs, then the final result.
export function readContainerStatus(jobId, runsDir) {
  const read = (name) => {
    const file = path.join(runsDir, "jobs", name);
    if (!existsSync(file)) return null;
    try {
      return JSON.parse(readFileSync(file, "utf8"));
    } catch {
      return null;
    }
  };
  return { result: read(`${jobId}.json`), progress: read(`${jobId}.progress.json`) };
}

// Where a job's output is read from. Local (Docker): files under runsDir. AWS: objects in the data bucket.
//   read(jobId)               -> { result, progress }
//   file(jobId, result, name) -> { file } (a local path) or { url } (a short-lived download link), or null
//   savePicture(file, bytes), hasPicture(file)
export function localOutputs(runsDir) {
  return {
    async read(jobId) {
      return readContainerStatus(jobId, runsDir);
    },
    async file(_jobId, result, name) {
      const folder = path.resolve(runsDir, path.relative("runs", result.model));
      const file = path.resolve(folder, name);
      return file.startsWith(path.resolve(runsDir) + path.sep) && existsSync(file) ? { file } : null;
    },
    async savePicture(file, bytes) {
      mkdirSync(path.join(runsDir, "pictures"), { recursive: true });
      writeFileSync(path.join(runsDir, "pictures", file), bytes);
    },
    async hasPicture(file) {
      return existsSync(path.join(runsDir, "pictures", file));
    },
  };
}

export const RUNS_PREFIX = "makeable-enclosure-runs/";
export const PICTURES_PREFIX = "makeable-enclosure-pictures/";

// On AWS the task writes <RUNS_PREFIX><job>/progress.json, files/<name> and result.json (enclosure/cloud_run.py).
// Files can be 35 MB, more than a Lambda can return, so the client gets a download link valid for 5 minutes.
export function s3Outputs({ client, bucket, sign }) {
  const commands = import("@aws-sdk/client-s3");
  async function readJson(key) {
    const { GetObjectCommand } = await commands;
    try {
      const object = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      return JSON.parse(await object.Body.transformToString());
    } catch (error) {
      if (error?.name === "NoSuchKey" || error?.$metadata?.httpStatusCode === 404) return null;
      throw error;
    }
  }
  return {
    async read(jobId) {
      const [result, progress] = await Promise.all([readJson(`${RUNS_PREFIX}${jobId}/result.json`), readJson(`${RUNS_PREFIX}${jobId}/progress.json`)]);
      return { result, progress };
    },
    async file(jobId, _result, name) {
      const { GetObjectCommand } = await commands;
      const command = new GetObjectCommand({ Bucket: bucket, Key: `${RUNS_PREFIX}${jobId}/files/${name}`, ResponseContentDisposition: `attachment; filename="${name}"` });
      return { url: await sign(client, command, { expiresIn: 300 }) };
    },
    async savePicture(file, bytes) {
      const { PutObjectCommand } = await commands;
      await client.send(new PutObjectCommand({ Bucket: bucket, Key: `${PICTURES_PREFIX}${file}`, Body: bytes, ContentType: file.endsWith(".png") ? "image/png" : "image/jpeg" }));
    },
    async hasPicture(file) {
      const { HeadObjectCommand } = await commands;
      try {
        await client.send(new HeadObjectCommand({ Bucket: bucket, Key: `${PICTURES_PREFIX}${file}` }));
        return true;
      } catch {
        return false;
      }
    },
  };
}

// The view a client sees. Never includes paths on the machine, machine errors or anything about other users.
export function publicJob(record, status = {}) {
  // Once the server has stopped a job, a result the container writes late is ignored.
  const result = record.stoppedByServer ? null : status.result;
  const view = {
    id: record.id,
    design: record.design,
    state: result ? result.status : record.state,
    createdAt: record.createdAt,
    ...(record.pictureId ? { pictureId: record.pictureId } : {}),
    progress: result || FINAL.has(record.state) ? null : status.progress || null,
  };
  if (record.reason) view.reason = record.reason;
  if (record.reason) view.message = MESSAGES[record.reason];
  if (result) {
    view.message = result.message;
    view.tokens = result.tokens;
    view.seconds = result.seconds;
    view.attempts = (result.attempts || []).map((a) => ({ outcome: a.outcome, reason: a.reason || null }));
    if (result.model) view.files = ["PRINT_Shell.stl", "PRINT_Base.stl", "preview.png", "report.json"].map((name) => `/api/enclosure-jobs/${record.id}/files/${name}`);
  }
  return view;
}

// Starts the generator in Docker on this machine. The key is passed by name, so it never appears in the command line.
export function dockerDispatch({ runsDir, image = "makeable-enclosure", spawnFn = spawn, env = process.env } = {}) {
  return {
    async start(job) {
      const args = ["run", "-d", "--rm", "--platform", "linux/amd64", "--name", job.id, "-e", "OPENAI_API_KEY",
        "-e", `ENCLOSURE_PROGRESS_PATH=runs/jobs/${job.id}.progress.json`,
        "-v", `${runsDir}:/app/enclosure/runs`, image, "python", "-W", "ignore", "generate.py", `base_designs/${job.design}.json`, job.id,
        ...(job.pictureFile ? [`runs/pictures/${job.pictureFile}`] : [])];
      await new Promise((resolve, reject) => {
        const child = spawnFn("docker", args, { env: { ...env }, stdio: "ignore" });
        child.on("error", reject);
        child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`docker run exited with ${code}`))));
      });
    },
    async stop(job) {
      await new Promise((resolve) => {
        const child = spawnFn("docker", ["stop", job.id], { stdio: "ignore" });
        child.on("error", resolve);
        child.on("exit", resolve);
      });
    },
  };
}

// Starts the generator as one Fargate task per job (infra/enclosure.yml). The task has no inbound access, reaches
// only HTTPS, gets the OpenAI key from Secrets Manager, and may write only under RUNS_PREFIX. Returns { taskArn }.
export function fargateDispatch({ ecs, cluster, taskDefinition, subnets, securityGroups, bucket, container = "generator" }) {
  const commands = import("@aws-sdk/client-ecs");
  return {
    async start(job) {
      const { RunTaskCommand } = await commands;
      const environment = [
        { name: "ENCLOSURE_BUCKET", value: bucket },
        { name: "ENCLOSURE_PREFIX", value: `${RUNS_PREFIX}${job.id}/` },
        ...(job.pictureFile ? [{ name: "ENCLOSURE_PICTURE_KEY", value: `${PICTURES_PREFIX}${job.pictureFile}` }] : []),
      ];
      const reply = await ecs.send(new RunTaskCommand({
        cluster,
        taskDefinition,
        launchType: "FARGATE",
        count: 1,
        startedBy: job.id,
        networkConfiguration: { awsvpcConfiguration: { subnets, securityGroups, assignPublicIp: "ENABLED" } },
        overrides: { containerOverrides: [{ name: container, command: ["python", "-W", "ignore", "cloud_run.py", `base_designs/${job.design}.json`, job.id], environment }] },
      }));
      const task = reply.tasks?.[0];
      if (!task) throw new Error(`RunTask started nothing: ${JSON.stringify(reply.failures || [])}`);
      return { taskArn: task.taskArn };
    },
    async stop(job) {
      if (!job.taskArn) return;
      const { StopTaskCommand } = await commands;
      try {
        await ecs.send(new StopTaskCommand({ cluster, task: job.taskArn, reason: "Stopped by the enclosure job API" }));
      } catch (error) {
        console.warn(`enclosure job ${job.id}: stop failed: ${error?.message || error}`);
      }
    },
  };
}

// Store keys:
//   job/<id>                        the job record (owner, design, state, reason, times)
//   active/<owner>                  the user's one running job; written only-if-new, so two starts cannot both win
//   running/<id>                    one per running job, counted for the cap across all users
//   daily/<owner>/<YYYY-MM-DD>      jobs the user started that day
//   request/<owner>/<requestId>     the job a client request id created, so a retried request finds it
//   picture/<pictureId>             a picture saved for one user (its file name; see outputs.savePicture)
export function createEnclosureJobs({ store, dispatch, runsDir, outputs = localOutputs(runsDir), now = () => new Date(), random, limits = {} } = {}) {
  const limit = { ...ENCLOSURE_JOB_LIMITS, ...limits };
  const day = () => now().toISOString().slice(0, 10);
  const secondsToTomorrow = () => {
    const at = now();
    return Math.ceil((Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate() + 1) - at.getTime()) / 1000);
  };

  async function load(id) {
    return isJobId(id) ? store.get(`job/${id}`, { type: "json" }) : null;
  }

  // Records a final state and frees the user's slot and the shared place.
  async function settle(record, state, fields = {}) {
    Object.assign(record, { state, finishedAt: now().toISOString() }, fields);
    await store.setJSON(`job/${record.id}`, record);
    await store.delete(`running/${record.id}`);
    const active = await store.get(`active/${record.owner}`, { type: "json" });
    if (active?.id === record.id) await store.delete(`active/${record.owner}`);
  }

  // Brings a record up to date: takes the container's result, or stops a job that has gone quiet or run too long.
  async function current(record) {
    const status = await outputs.read(record.id);
    if (FINAL.has(record.state)) return status;
    if (status.result) {
      await settle(record, status.result.status);
      return status;
    }
    const at = now().getTime();
    const lastSign = Math.max(Date.parse(record.createdAt), Date.parse(status.progress?.updated || "") || 0);
    const reason = at - Date.parse(record.createdAt) > limit.maxRunMinutes * MINUTE ? "too_long"
      : at - lastSign > limit.noProgressMinutes * MINUTE ? "stuck" : null;
    if (reason) {
      await dispatch.stop(record);
      await settle(record, "FAIL", { reason, stoppedByServer: true });
    }
    return status;
  }

  // Saves a refusal so it can be looked at later. Nothing is started.
  async function refuse(owner, design, reason, status, extra = {}) {
    const record = { id: newJobId(random), owner, design, state: "REFUSED", reason, createdAt: now().toISOString() };
    await store.setJSON(`job/${record.id}`, record);
    return { status, body: { error: MESSAGES[reason], job: publicJob(record), ...extra.body }, retryAfterSeconds: extra.retryAfterSeconds };
  }

  // Checks every running job and stops the ones that have gone quiet. Returns the ids it stopped.
  // Called before counting places, and can be run on a schedule.
  async function reap() {
    const { blobs } = await store.list({ prefix: "running/" });
    const stopped = [];
    for (const { key } of blobs) {
      const record = await load(key.slice("running/".length));
      if (!record) {
        await store.delete(key);
        continue;
      }
      await current(record);
      if (record.stoppedByServer) stopped.push(record.id);
    }
    return stopped;
  }

  // A picture the user may choose for the look, saved for that user only. The picture-options step will call this
  // with images it generated. Returns { status, pictureId }.
  async function savePicture(owner, bytes) {
    const type = pictureType(bytes);
    if (!type) return { status: 400, body: { error: "The picture must be a PNG or JPEG image." } };
    if (bytes.length > PICTURE_MAX_BYTES) return { status: 400, body: { error: "The picture must be at most 10 MB." } };
    const id = newId("pic", random);
    const file = `${id}.${type}`;
    await outputs.savePicture(file, bytes);
    await store.setJSON(`picture/${id}`, { owner, file, createdAt: now().toISOString() });
    return { status: 201, pictureId: id };
  }

  async function ownPicture(owner, pictureId) {
    if (!PICTURE_ID.test(String(pictureId || ""))) return null;
    const picture = await store.get(`picture/${pictureId}`, { type: "json" });
    return picture && picture.owner === owner && (await outputs.hasPicture(picture.file)) ? picture : null;
  }

  return {
    reap,
    savePicture,

    // Starts a job. requestId lets a client retry the same request safely: the same id returns the same job and never starts a second container.
    // pictureId is optional: a picture saved for this user, used as the look. Without it the design's own picture is made, as before.
    async start(owner, { design, requestId, pictureId } = {}) {
      if (!designExists(design)) return { status: 400, body: { error: "Unknown design." } };
      const picture = pictureId === undefined ? null : await ownPicture(owner, pictureId);
      if (pictureId !== undefined && !picture) return { status: 400, body: { error: "Unknown picture." } };
      if (requestId && !REQUEST_ID.test(requestId)) return { status: 400, body: { error: "requestId must be 8 to 64 letters, digits, - or _." } };
      if (requestId) {
        const earlier = await store.get(`request/${owner}/${requestId}`, { type: "json" });
        const record = earlier && (await load(earlier.id));
        if (record) return { status: 200, body: { job: publicJob(record, await current(record)) } };
      }

      // Claim the user's one slot. Only one of two starts at the same moment can write this key.
      const record = { id: newJobId(random), owner, design, state: "STARTING", createdAt: now().toISOString(), ...(picture ? { pictureId, pictureFile: picture.file } : {}) };
      const slot = { id: record.id, at: now().toISOString() };
      let claimed = await store.setJSON(`active/${owner}`, slot, { onlyIfNew: true });
      if (!claimed.modified) {
        const active = await store.get(`active/${owner}`, { type: "json" });
        const holder = active && (await load(active.id));
        if (holder) await current(holder);
        if (holder && !FINAL.has(holder.state)) return { status: 409, body: { error: MESSAGES.busy_user, job: publicJob(holder) } };
        // A slot with no record yet belongs to a start still in progress. Only one left by a crash, a minute old, is cleared.
        if (active && !holder && now().getTime() - Date.parse(active.at || 0) < MINUTE) return { status: 409, body: { error: MESSAGES.busy_user } };
        await store.delete(`active/${owner}`);
        claimed = await store.setJSON(`active/${owner}`, slot, { onlyIfNew: true });
        if (!claimed.modified) return { status: 409, body: { error: MESSAGES.busy_user } };
      }
      const release = () => store.delete(`active/${owner}`);

      const used = (await store.get(`daily/${owner}/${day()}`, { type: "json" }))?.count || 0;
      if (used >= limit.jobsPerUserPerDay) {
        await release();
        return refuse(owner, design, "daily_limit", 429, { retryAfterSeconds: secondsToTomorrow(), body: { limit: limit.jobsPerUserPerDay } });
      }
      await reap();
      const { blobs: running } = await store.list({ prefix: "running/" });
      if (running.length >= limit.runningAtOnce) {
        await release();
        return refuse(owner, design, "busy", 503, { retryAfterSeconds: 60 });
      }

      // Recorded before anything is paid for, so a retried request finds it.
      await store.setJSON(`job/${record.id}`, record);
      await store.setJSON(`running/${record.id}`, { owner });
      if (requestId) await store.setJSON(`request/${owner}/${requestId}`, { id: record.id });
      try {
        const started = await dispatch.start(record);
        if (started?.taskArn) record.taskArn = started.taskArn;
      } catch (error) {
        await settle(record, "FAIL", { reason: "dispatch_failed", error: String(error?.message || error) });
        return { status: 503, body: { error: MESSAGES.dispatch_failed, job: publicJob(record) }, retryAfterSeconds: 60 };
      }
      await store.setJSON(`daily/${owner}/${day()}`, { count: used + 1 });
      record.state = "RUNNING";
      record.startedAt = now().toISOString();
      await store.setJSON(`job/${record.id}`, record);
      return { status: 202, body: { job: publicJob(record) } };
    },

    async status(owner, id) {
      const record = await load(id);
      if (!record || record.owner !== owner) return { status: 404, body: { error: "Job not found." } };
      return { status: 200, body: { job: publicJob(record, await current(record)) } };
    },

    async cancel(owner, id) {
      const record = await load(id);
      if (!record || record.owner !== owner) return { status: 404, body: { error: "Job not found." } };
      await current(record);
      if (!FINAL.has(record.state)) {
        await dispatch.stop(record);
        await settle(record, "CANCELLED", { stoppedByServer: true });
      }
      return { status: 200, body: { job: publicJob(record) } };
    },

    // A printable file from a passed job, only for its owner.
    async file(owner, id, name) {
      const record = await load(id);
      if (!record || record.owner !== owner || !FILE_NAME.test(String(name || ""))) return { status: 404 };
      const { result } = await current(record);
      if (record.stoppedByServer || !result?.model) return { status: 404 };
      const found = await outputs.file(record.id, result, name);
      if (!found) return { status: 404 };
      return { status: 200, ...found };
    },
  };
}

function reply(body, status, headers = {}) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", Vary: "Cookie", ...headers } });
}

function fromSameSite(req) {
  const origin = req.headers.get("origin");
  if (!origin) return true;
  try {
    return origin === new URL(req.url).origin;
  } catch {
    return false;
  }
}

async function readSmallJson(req, maxBytes) {
  const text = await req.text();
  if (text.length > maxBytes) return null;
  try {
    const value = JSON.parse(text || "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

// The HTTP routes, in front of the job logic. authenticate(req) returns { ok, user } or { ok: false, response }.
//   POST   /api/enclosure-jobs                   start   { design, requestId?, pictureId? }
//   GET    /api/enclosure-jobs/:id               status
//   DELETE /api/enclosure-jobs/:id               cancel
//   GET    /api/enclosure-jobs/:id/files/:name   download a file of a passed job
export function enclosureJobsRoute({ jobs, authenticate }) {
  const send = (result) => reply(result.body, result.status, result.retryAfterSeconds ? { "Retry-After": String(result.retryAfterSeconds) } : {});
  return async function route(req, routePath) {
    const auth = await authenticate(req);
    if (!auth.ok) return auth.response;
    if (req.method !== "GET" && !fromSameSite(req)) return reply({ error: "Origin not allowed." }, 403);
    const owner = auth.user.sub;

    if (routePath === "/api/enclosure-jobs") {
      if (req.method !== "POST") return reply({ error: "Method not allowed" }, 405, { Allow: "POST" });
      const body = await readSmallJson(req, 2048);
      if (!body) return reply({ error: "Send a small JSON body: { design, requestId }." }, 400);
      return send(await jobs.start(owner, {
        design: String(body.design || ""),
        requestId: body.requestId ? String(body.requestId) : undefined,
        pictureId: body.pictureId === undefined ? undefined : String(body.pictureId),
      }));
    }

    const fileMatch = routePath.match(/^\/api\/enclosure-jobs\/([^/]+)\/files\/([^/]+)$/);
    if (fileMatch) {
      if (req.method !== "GET") return reply({ error: "Method not allowed" }, 405, { Allow: "GET" });
      let name;
      try {
        name = decodeURIComponent(fileMatch[2]);
      } catch {
        return reply({ error: "File not found." }, 404);
      }
      const found = await jobs.file(owner, fileMatch[1], name);
      if (found.status !== 200) return reply({ error: "File not found." }, 404);
      // On AWS the file is in S3 and can be larger than a Lambda reply, so the client follows a short-lived link.
      if (found.url) return new Response(null, { status: 302, headers: { "Cache-Control": "no-store", Location: found.url } });
      const type = name.endsWith(".png") ? "image/png" : name.endsWith(".json") ? "application/json" : "model/stl";
      return new Response(await readFile(found.file), { status: 200, headers: { "Cache-Control": "no-store", Vary: "Cookie", "Content-Type": type, "Content-Disposition": `attachment; filename="${name}"` } });
    }

    const jobMatch = routePath.match(/^\/api\/enclosure-jobs\/([^/]+)$/);
    if (!jobMatch) return reply({ error: "Not found" }, 404);
    if (req.method === "GET") return send(await jobs.status(owner, jobMatch[1]));
    if (req.method === "DELETE") return send(await jobs.cancel(owner, jobMatch[1]));
    return reply({ error: "Method not allowed" }, 405, { Allow: "GET, DELETE" });
  };
}
