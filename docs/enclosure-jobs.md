# Enclosure jobs

A signed-in user asks for a 3D-printable case. The API records a job, starts the generator in a container, and reports what the container writes. The generator itself is in `enclosure/` and is described in [enclosure.md](enclosure.md).

- Code: `lib/enclosure-jobs.mjs` (job logic and routes), wired in `netlify/functions/api.mjs`.
- CLI: `scripts/enclosure-job.mjs`.
- Tests: `tests/enclosure-jobs.test.mjs`.

## Routes

All routes need a signed-in session. Requests other than GET must come from the same site.

| Method and path | Does | Replies |
|---|---|---|
| `POST /api/enclosure-jobs` with `{ design, requestId?, pictureId? }` | Starts a job | 202 started, 200 same request id as before, 400 bad input or unknown picture, 409 you already have one running, 429 daily limit, 503 busy or could not start |
| `GET /api/enclosure-jobs/:id` | State, progress, result | 200, 404 if not yours |
| `DELETE /api/enclosure-jobs/:id` | Cancels and stops the container | 200, 404 if not yours |
| `GET /api/enclosure-jobs/:id/files/:name` | A file of a passed job: `PRINT_Shell.stl`, `PRINT_Base.stl`, `preview.png`, `report.json` | 200, 404 |

A 429 or 503 reply has a `Retry-After` header. Other users' jobs always answer 404, so a job id tells an outsider nothing.

## Calling the API

For anyone building a page or tool that makes a case. The flow is: start a job, check it every few seconds until it ends, then download the files.

```
POST /api/enclosure-jobs ──▶ 202 { job: RUNNING }
GET  /api/enclosure-jobs/:id  every 5 s ──▶ RUNNING + progress ... ──▶ PASS / PASS WITH WARNINGS / FAIL
GET  /api/enclosure-jobs/:id/files/PRINT_Shell.stl ──▶ the file (302 to a download link on AWS)
```

**Signing in.** Use the site's normal session cookie (the same sign-in as the builder). From a page on the site, `fetch` sends it by itself. POST and DELETE must come from the same site, so call the API from the site's own origin. Locally, `http://localhost:3001/__local-login` signs in as a test user.

**Errors.** Every error is JSON `{ "error": "<plain sentence for the user>" }`, and some also carry the `job`. The sentence is safe to show as it is.

### Start a job

```http
POST /api/enclosure-jobs
Content-Type: application/json

{ "design": "s3-devkit-bar-touch", "requestId": "ui-7f3c9a21b4" }
```

- `design`: a file name in `enclosure/base_designs/`, without `.json`. An unknown name gives 400.
- `requestId` (optional, recommended): 8 to 64 letters, digits, `-` or `_`, new for each click. If the request fails on the network, send it again with the same id: you get the same job back (200), never a second one.
- `pictureId` (optional): a picture saved for this user (see [A chosen picture](#a-chosen-picture)). There is no upload route yet.

Reply `202`:

```json
{ "job": { "id": "enc-f08ls3w083gh", "design": "s3-devkit-bar-touch", "state": "RUNNING", "createdAt": "2026-11-03T08:41:12.000Z", "progress": null } }
```

Refusals: `409` you already have a job running (`job` is that job, so you can show it), `429` today's limit is reached (`limit` in the body), `503` busy or the job could not start. 429 and 503 have `Retry-After` in seconds.

### Check a job

```http
GET /api/enclosure-jobs/enc-f08ls3w083gh
```

While it runs, `progress` says where it is. It changes about every 30 s on AWS:

```json
{ "job": { "id": "enc-f08ls3w083gh", "design": "s3-devkit-bar-touch", "state": "RUNNING", "createdAt": "2026-11-03T08:41:12.000Z",
           "progress": { "stage": "case", "attempt": 1, "attempt_try": 3, "failed": [], "tokens_so_far": 41210, "updated": "2026-11-03T08:46:40Z" } } }
```

- `stage`: `body` (the outer shape) then `case` (holes, parts, screws). `done` at the end.
- `attempt`: 1, or 2 when the generator started again by itself. `attempt_try`: which try within that attempt.
- `tokens_so_far`: AI tokens used so far.

When it ends, `state` is one of the final states and `progress` is `null`:

```json
{ "job": { "id": "enc-f08ls3w083gh", "design": "s3-devkit-bar-touch", "state": "PASS WITH WARNINGS", "createdAt": "2026-11-03T08:41:12.000Z", "progress": null,
           "message": "Your case is ready. Check the print checklist before printing.",
           "tokens": 52025, "seconds": 386,
           "attempts": [{ "outcome": "pass_with_warnings", "reason": null }],
           "files": ["/api/enclosure-jobs/enc-f08ls3w083gh/files/PRINT_Shell.stl", "/api/enclosure-jobs/enc-f08ls3w083gh/files/PRINT_Base.stl",
                     "/api/enclosure-jobs/enc-f08ls3w083gh/files/preview.png", "/api/enclosure-jobs/enc-f08ls3w083gh/files/report.json"] } }
```

| `state` | Final | Show the user |
|---|---|---|
| `STARTING`, `RUNNING` | no | "Making your case" and the progress |
| `PASS` | yes | `message` and the files |
| `PASS WITH WARNINGS` | yes | `message`, the files, and the warnings in `report.json` as a print checklist |
| `FAIL` | yes | `message`. No files. They can start again |
| `STOPPING` | no | "Stopping the case maker". The server asked for the container to stop and waits until it has: it still counts toward the limits |
| `CANCELLED` | yes | Cancelled |
| `REFUSED` | yes | `message` (a limit was reached; nothing ran) |

Check every 5 seconds and stop at a final state. A job takes 4 to 20 minutes. Checks are cheap, so the page can be left open.

### Download a file

```http
GET /api/enclosure-jobs/enc-f08ls3w083gh/files/PRINT_Shell.stl
```

Use the links in `files`. Locally the file comes back directly. On AWS the reply is `302` to a download link that works for 5 minutes, so ask for a new one each time and don't store it. Browsers and `fetch` follow the 302 by themselves, so an `<img src>` or `<a href>` works the same in both places. Files of a job that did not pass answer 404.

### Cancel

```http
DELETE /api/enclosure-jobs/enc-f08ls3w083gh
```

Stops the container and answers with the job, now `CANCELLED`. A finished job is returned unchanged.

### Example from a page

```js
async function makeCase(design, onProgress) {
  const requestId = "ui-" + crypto.randomUUID().slice(0, 12);
  let reply = await fetch("/api/enclosure-jobs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ design, requestId }) });
  let data = await reply.json();
  if (!reply.ok && reply.status !== 409) throw new Error(data.error);
  const id = data.job.id;
  const final = ["PASS", "PASS WITH WARNINGS", "FAIL", "CANCELLED", "REFUSED"];
  while (!final.includes(data.job.state)) {
    await new Promise((resolve) => setTimeout(resolve, 5000));
    data = await (await fetch(`/api/enclosure-jobs/${id}`)).json();
    onProgress(data.job);
  }
  return data.job; // data.job.files has the download links when it passed
}
```

### Test page

`npm run dev:local`, then open `http://localhost:3001/__enclosure-test` (`scripts/enclosure-test.html`). It starts a job, shows its progress, can cancel it, and shows the preview and links when it passes. The local server serves it only; it is not part of the site. To run jobs on AWS from a laptop, start `dev:local` with an AWS login (`AWS_PROFILE=makeable`) and `MAKEABLE_ENCLOSURE_DISPATCH=fargate`, `MAKEABLE_ENCLOSURE_CLUSTER=makeable-enclosure`, `MAKEABLE_ENCLOSURE_TASK_DEFINITION=makeable-enclosure`, `MAKEABLE_ENCLOSURE_SUBNETS`, `MAKEABLE_ENCLOSURE_SECURITY_GROUP` (the `makeable-enclosure` stack's outputs) and `MAKEABLE_STORAGE_BUCKET` (the data bucket). Job records stay in memory, so restarting the server forgets running jobs, though their tasks carry on.

## How a job moves

```
start ─┬─ bad input ─────────────────── 400, nothing saved
       ├─ a limit is reached ───────── REFUSED + reason, saved, nothing started
       └─ STARTING ─┬─ container does not start ─────────── FAIL (dispatch_failed)
                    └─ RUNNING ─┬─ container writes its result ─── PASS / PASS WITH WARNINGS / FAIL
                                ├─ user cancels ──────────────── CANCELLED
                                └─ no progress, or too long ──── FAIL (stuck / too_long)
```

The job record in the store is the one source of truth. Every job, even a refused one, is saved with a `reason` when it did not run, so refusals can be counted later. The user sees a plain message for each reason and never sees machine errors, paths or other users.

## Limits

Set in `ENCLOSURE_JOB_LIMITS`. Each job costs about 45k to 110k AI tokens, so the limits are strict on count and generous on time.

| Limit | Value | What happens |
|---|---|---|
| Running jobs per user | 1 | 409, with the running job |
| Jobs per user per UTC day | 5 | 429 `daily_limit`. A container that failed to start does not count |
| Running jobs across all users | 3 | 503 `busy`, try again in a minute |
| No progress | 20 min | The container is stopped, FAIL `stuck` |
| Longest run | 60 min | The container is stopped, FAIL `too_long` |

A normal job takes 4 to 12 minutes. The generator writes progress at each body and case try (`agent.report_progress`), so 20 minutes of silence means the container has crashed or hung. Since the 60-minute cap is longer than the generator's own retry, it never cuts off a retry that is still running.

## Protections

- **One job per user, even under a race.** The user's slot (`active/<owner>`) is written only if new (S3 `IfNoneMatch`). When two starts arrive together, one gets the slot and the other gets 409. A slot with no job record is treated as a start still in progress for one minute, then cleared, so a crash cannot block a user for good.
- **Safe retries from the client.** A client sends a `requestId`. The same id returns the same job and never starts a second container, so a dropped connection can be retried.
- **The cap across users holds under a race.** There are `runningAtOnce` numbered places (`place/0`, `place/1`, ...), each written only if new. A start that gets none answers 503 `busy`, so eight users starting at the same moment start three jobs, not eight. A finished job frees its place. A place left by a crash (its job ended over a minute ago, or has no record) is freed only by `reap()`: the store has no conditional delete, so two starts freeing places at once could free a live one.
- **Cancel and start can't both win.** Whichever writes `phase/<id>` first wins, and the key is written only if new. If cancel comes first while the container is still starting, the job becomes `STOPPING`, and the start stops the container the moment it has started. A container that started counts toward the day.
- **A job is reported stopped only once it is.** `dispatch.stop` throws when AWS didn't stop the task (a task AWS no longer knows about counts as stopped). The job then stays `STOPPING`, keeps its places, hides any result, and `reap()` tries again. One job's failure never stops the sweep or another user's start. Past the longest run (60 min) a `STOPPING` job is settled anyway, because the container has ended by itself.
- **Stuck jobs are cleaned up.** Every status read checks the job. `reap()` checks all of them, on every start and every 5 minutes on AWS. A job that has gone quiet or run too long is stopped and failed, which frees the user and the place.
- **A late result is ignored.** After the server cancels or stops a job, a result file written later does not change the answer and gives no files.
- **Files.** Only the listed names are served, only from that job's own model folder, only for its owner.
- **Input.** The design name must match a fixed pattern and exist in `enclosure/base_designs/`. The body must be JSON under 2 KB.

## A chosen picture

The generator designs the outer body to match a concept picture. A reviewer AI compares each render with the picture and lists what to change. Without a picture, the generator makes one from the design's `picture_prompt`, as it always has.

To let the user choose the look, a job can name a picture with `pictureId`:

- `savePicture(owner, bytes)` stores a PNG or JPEG of at most 10 MB in `runs/pictures/`, for that user only. The picture-options step will call it with the images it generates. There is no upload route, so only pictures we made can be used.
- `start` refuses a `pictureId` that is not that user's (400) before anything starts.
- The container gets the path as a third argument: `generate.py <design> <job> runs/pictures/<id>.png`. The generator checks the file is a real image before any paid call, then uses it in place of the one it would have made. Everything after that is unchanged.

The picture only guides the look. Part sizes come from the part cards, so the case can differ from the picture, for example in its proportions.

Without a `pictureId`, the job and the `docker run` command are exactly as before. A test checks the command word for word.

## Store keys

| Key | Holds |
|---|---|
| `job/<id>` | The job record: owner, design, state, reason, times |
| `active/<owner>` | The user's one running job |
| `running/<id>` | One per job that may still have a container, so `reap()` checks it |
| `place/<n>` | One of the `runningAtOnce` shared places and the job holding it |
| `phase/<id>` | Written once, by whichever of start (container started) and cancel came first |
| `daily/<owner>/<YYYY-MM-DD>` | Jobs the user started that day |
| `request/<owner>/<requestId>` | The job a client request id created |
| `picture/<pictureId>` | A picture saved for one user, and its file name |

## Where it runs

`MAKEABLE_ENCLOSURE_DISPATCH` picks the dispatch. Without it, the routes answer 503.

- `docker`: on a laptop, set by `npm run dev:local`. It runs the `makeable-enclosure` image (`enclosure/Dockerfile`) with `docker run`, passing `OPENAI_API_KEY` by name so the key never appears in a command line. The container writes to `enclosure/runs` (or `MAKEABLE_ENCLOSURE_RUNS_DIR`).
- `fargate`: on AWS, set by `template.yaml` once `EnclosureSubnets` is filled in. One Fargate task per job runs the same image with `cloud_run.py`. Results and files go to the data bucket, and a file request redirects to a 5-minute download link, because files can be 35 MB and a Lambda reply can't exceed 6 MB.

## AWS

```
 makeable-prod (template.yaml)                     makeable-enclosure (infra/enclosure.yml, by hand)
 ┌──────────────────────────────────┐   RunTask   ┌──────────────────────────────────────────┐
 │ ApiFunction ─────────────────────┼───────────▶ │ cluster ─▶ one Fargate task per job       │
 │ EnclosureReapFunction (5 min)    │  StopTask   │   image: ECR makeable-enclosure           │
 │                                  │             │   key: makeable/prod OPENAI_API_KEY field │
 │ DataBucket                       │ ◀───────────┼── writes makeable-enclosure-runs/<job>/    │
 │  makeable-enclosure-jobs/  (API) │   S3 only   │   reads makeable-enclosure-pictures/      │
 │  makeable-enclosure-runs/  (task)│             │ network: no inbound, HTTPS out, no NAT    │
 │  makeable-enclosure-pictures/    │             └──────────────────────────────────────────┘
 └──────────────────────────────────┘
```

- **Separate stack.** `infra/enclosure.yml` holds the network, cluster, image repository, task definition and its two roles. It is deployed by hand and uses fixed names (`makeable-enclosure*`), so `template.yaml` needs only two settings: `EnclosureSubnets` and `EnclosureSecurityGroup`. While they are empty, enclosure jobs are off and nothing new is created in `makeable-prod`.
- **The task's access.** Its own role may only write `makeable-enclosure-runs/*` and read `makeable-enclosure-pictures/*`. ECS reads the OpenAI key from Secrets Manager with a separate role that the container never sees.
- **The AI's code.** It runs as the `runner` user, which can't read the generator's environment, so it can't see the key. The import screen blocks network modules, so the code can't reach the task's role either.
- **The API's access.** `ApiFunction` and the reaper may run and stop only the `makeable-enclosure` task family on that cluster, and pass only the two enclosure roles.
- **Cost.** About $0.03 of compute per job (4 vCPU, 8 GB, about 10 minutes) and about $0.25 a month for images. There's no NAT gateway, and S3 traffic goes through a free gateway endpoint.

Setup, once, with an admin login:

```
aws cloudformation deploy --stack-name makeable-enclosure --template-file infra/enclosure.yml   --capabilities CAPABILITY_NAMED_IAM   --parameter-overrides DataBucketName=<makeable-prod DataBucketName> SecretArn=<full makeable/prod ARN>
docker build --platform linux/amd64 -f enclosure/Dockerfile -t <RepositoryUri>:latest .
aws ecr get-login-password | docker login --username AWS --password-stdin <account>.dkr.ecr.us-east-1.amazonaws.com
docker push <RepositoryUri>:latest
```

Then add `EnclosureSubnets=<Subnets> EnclosureSecurityGroup=<SecurityGroup>` (the stack's outputs) to `parameter_overrides` in `samconfig.toml`. The next deploy of `makeable-prod` turns jobs on.

### Before merging the PR that turns it on

Merging into `staging` deploys `makeable-prod`, the backend behind the staging Amplify URL. With `EnclosureSubnets` set in `samconfig.toml`, that deploy turns enclosure jobs on.

| Needed | State on 3 Nov |
|---|---|
| Stack `makeable-enclosure` deployed from `infra/enclosure.yml` | Done |
| Its outputs in `samconfig.toml` (`EnclosureSubnets`, `EnclosureSecurityGroup`) | Done |
| The image in ECR as `makeable-enclosure:latest` | Done. It includes the screw-gap and see-through checks |
| `OPENAI_API_KEY` in the `makeable/prod` secret | Done. Tasks have used it |
| The PRs below this one merged first (generator, then job API) | Pending |

What the deploy adds to `makeable-prod`: settings on `ApiFunction`, the `EnclosureTasksPolicy` permission, and `EnclosureReapFunction` with its log group and 5-minute schedule. If any of these fails, the workflow puts `aws-last-good` back and the site is unchanged.

After the deploy, check it from a laptop:

```
MAKEABLE_SESSION_COOKIE='<a signed-in cookie from the Amplify site>' \
  node scripts/enclosure-job.mjs start --design s3-devkit-bar-touch --wait --base <Amplify URL>
aws ecs list-tasks --cluster makeable-enclosure --started-by <job id>     # the task the deployed API started
aws logs tail /makeable/makeable-prod/enclosure-reap --since 15m          # the reaper ran
```

To turn jobs off again, set `EnclosureSubnets=` (empty) and deploy. The routes then answer 503 and nothing else changes.

The image is not built by CI. After a change under `enclosure/`, build and push it by hand (the commands above). Tasks always pull `:latest`, so the next job uses it.

## Try it locally

```
docker build -f enclosure/Dockerfile -t makeable-enclosure .
npm run dev:local -- --skip-build
node scripts/enclosure-job.mjs start --design s3-screen-button --wait
node scripts/enclosure-job.mjs download <job id>
```

The CLI signs in as the local test user. For another server, pass `--base <url>` and set `MAKEABLE_SESSION_COOKIE`.

## Tests

`node --test tests/enclosure-jobs.test.mjs` runs 29 tests with a fake dispatch and the in-memory store. They use no Docker or AI. They cover:

- Sign-in: signed-out requests get 401 on every route.
- Requests: another site's origin gets 403, wrong methods get 405, bad or oversized bodies get 400, and the site API answers 503 when jobs are not set up.
- Ownership: other users can't see, cancel or download a job.
- Starting: two starts at once give one job, and a repeated request id gives the same job.
- Limits: the daily limit resets the next day, a failed container start doesn't count toward it, and the cap across all users is enforced.
- Cleanup: stuck jobs and jobs that run too long are stopped, and the cleanup frees their places.
- Results: a late result is ignored after a stop.
- Safety: file names and paths are checked, and the public view hides private fields.
- AWS: the Fargate request (its command, prefix and picture key, and never the key), a task that can't start, cancel by task ARN, status and files from S3, and the file redirect.
- Pictures: only the owner's saved picture is accepted, and anything that is not an image is refused. The docker command doesn't change without a picture.

The generator side is in `enclosure/test_generate.py` and `enclosure/test_agent.py`. They check that without a picture the call is unchanged and a picture is still generated. With one, it reaches every attempt and none is generated. A file that is not an image fails before any AI call. `enclosure/test_cloud_run.py` checks the files are uploaded before the result, the picture is fetched, a crash still writes a plain failure, and progress is sent only when it changes. `enclosure/test_sandbox.py` checks the runner user.

## Not built yet

- The picture-options step: generating 3 looks from the user's answers for them to choose from.
- Full isolation of the AI's code in its own runner with no internet. Today it runs in the task as a separate user.
- Failing a job as soon as its task stops without a result. Today the 20-minute no-progress rule catches it.
- Rate limits on status reads. They are cheap and owner-only, so only starts are limited.
