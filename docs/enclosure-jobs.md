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
- **Stuck jobs are cleaned up.** Every status read checks the job. Before counting running jobs, `reap()` checks all of them. A job that has gone quiet or run too long is stopped and failed, which frees the user and the place. `reap()` can also run on a schedule.
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
| `running/<id>` | One per running job, counted for the cap across all users |
| `daily/<owner>/<YYYY-MM-DD>` | Jobs the user started that day |
| `request/<owner>/<requestId>` | The job a client request id created |
| `picture/<pictureId>` | A picture saved for one user, and its file name |

## Where it runs

`MAKEABLE_ENCLOSURE_DISPATCH` picks the dispatch. Without it, the routes answer 503.

- `docker`: on a laptop, set by `npm run dev:local`. It runs the `makeable-enclosure` image (`enclosure/Dockerfile`) with `docker run`, passing `OPENAI_API_KEY` by name so the key never appears in a command line. The container writes to `enclosure/runs` (or `MAKEABLE_ENCLOSURE_RUNS_DIR`).
- AWS (planned): one Fargate task per job runs the same image, and files go to S3. Only the dispatch and the file reads change.

## Try it locally

```
docker build -f enclosure/Dockerfile -t makeable-enclosure .
npm run dev:local -- --skip-build
node scripts/enclosure-job.mjs start --design s3-screen-button --wait
node scripts/enclosure-job.mjs download <job id>
```

The CLI signs in as the local test user. For another server, pass `--base <url>` and set `MAKEABLE_SESSION_COOKIE`.

## Tests

`node --test tests/enclosure-jobs.test.mjs` runs 25 tests with a fake dispatch and the in-memory store. They use no Docker or AI. They cover:

- Sign-in: signed-out requests get 401 on every route.
- Requests: another site's origin gets 403, wrong methods get 405, bad or oversized bodies get 400, and the site API answers 503 when jobs are not set up.
- Ownership: other users can't see, cancel or download a job.
- Starting: two starts at once give one job, and a repeated request id gives the same job.
- Limits: the daily limit resets the next day, a failed container start doesn't count toward it, and the cap across all users is enforced.
- Cleanup: stuck jobs and jobs that run too long are stopped, and the cleanup frees their places.
- Results: a late result is ignored after a stop.
- Safety: file names and paths are checked, and the public view hides private fields.
- Pictures: only the owner's saved picture is accepted, and anything that is not an image is refused. The docker command doesn't change without a picture.

The generator side is in `enclosure/test_generate.py` and `enclosure/test_agent.py`. They check that without a picture the call is unchanged and a picture is still generated. With one, it reaches every attempt and none is generated. A file that is not an image fails before any AI call.

## Not built yet

- The picture-options step: generating 3 looks from the user's answers for them to choose from.

- The Fargate dispatch and S3 file reads.
- A schedule that calls `reap()`. Today, cleanup happens when someone reads a status or starts a job.
- Rate limits on status reads. They are cheap and owner-only, so only starts are limited.
