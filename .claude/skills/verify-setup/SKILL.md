---
name: verify-setup
description: Use before verifying any Makeable change in the running app, to start the app locally, sign in as a test user and read results back.
---

# Run Makeable locally for verification

Last run: 2026-10-27 on 0a193c4 (staging) + dev/local-harness

## Start

1. `npm ci` once.
2. Start the server with node directly, in the background:
   `node scripts/dev-local.mjs` (builds the site first, a few minutes), or
   `node scripts/dev-local.mjs --skip-build` when nothing under `apps/landing/` changed since the last build.
3. Wait for the line `[dev-local] sign in: http://localhost:3001/__local-login?next=/`.

The app is http://localhost:3001 (`--port` for another). `/api/*` and background builds run through `lib/aws/lambda-http.mjs`, the same adapter as the AWS Lambdas. `OPENAI_API_KEY` comes from `.env`.

## Sign in

Open `http://localhost:3001/__local-login?next=/` in the browser. The header avatar shows "L" (Local Test). The route also clears the site's browser storage, so a saved job from an earlier run does not reopen. Google sign-in does not work on localhost.

## Reset

Storage is in memory: restart the server and every build, session and quota is gone. Sign in again after a restart.

## Read back

There is no database to query. Read state through the API as the signed-in user, in the page:
`await fetch('/api/account').then(r => r.json())` returns `builds` (id, title, parts) and `quota` (`used`, `remaining`).

From a shell, `node scripts/dev-build.mjs "<idea>"` signs in, runs one build and prints each state, the parts and the artifact states (exit 0 ready, 1 failed, 2 clarification).

## Traps

- Stop the server by stopping a `node …` command. Stopping `npm run dev:local` from a background task on Windows leaves node holding the port (`EADDRINUSE` on the next start); find it with `netstat -ano | grep 3001` and stop that PID.
- Every build makes real OpenAI calls: 85 to 110 s and a few cents each. Don't loop builds.
- Chrome screenshots time out while the Chrome window is behind other windows. `document.body.innerText` through the JS tool still works.
