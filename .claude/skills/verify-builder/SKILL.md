---
name: verify-builder
description: Use when verifying changes to making a build from an idea (idea box, build progress, parts, wiring viewer), or when files under netlify/functions/, lib/, aws/, apps/landing/app/ or apps/circuit-lab/ changed.
---

# Verify the builder

Covers: `netlify/functions/api.mjs`, `netlify/functions/build-background.mjs`, `lib/**`, `aws/**`, `apps/landing/app/**`, `apps/circuit-lab/**`, `scripts/dev-*.mjs`
Last run: 2026-10-27 on 0a193c4 (staging) + dev/local-harness

Start and sign in with verify-setup first.

## Get there

Home page → "Create your own" button → scrolls to `/#make`, heading "Create your own build.", a box "Describe what you want to build..." and "10 of 10 free builds left".

## Checks

1. Type an idea, click the round arrow button → screen shows "Planning your build." with steps "Plan your build", "Choose parts", "Prepare assembly", "Finish up" and an elapsed timer → server log prints `[dev-local] pipeline start job_…`.
2. Wait about 100 s → log prints `[dev-local] pipeline end job_… (200)` and the page moves to `/app?build=build_…` with the title, "Your parts" and an estimated parts total → read-back: `/api/account` `builds` has this id with parts > 0, `quota.used` is 1.
3. Click "Open wiring" → "Step 1 of 3", "Place the parts", a 3D view with the parts → no console errors.
4. Shell: `node scripts/dev-build.mjs "<idea>"` → prints `planning`, `fitting_parts`, `rendering`, `ready`, `claimed`, the parts and `artifacts` with overview, parts and wiring `ready` → exit 0. Its `open:` link shows the build in `/app`.

## Traps

- A build started from the CLI only appears in `/app` after it is claimed. `dev-build.mjs` claims it; a raw `POST /api/build-jobs` does not, and `/app` then says "We could not safely open this project".
- "This build did not finish … Build job not found." on the home page means a saved job from an earlier server run. Sign in through `__local-login?next=/` again to clear it.
- Some ideas come back with warnings that a requested feature (a buzzer, a presence sensor) is out of scope. That is pipeline behaviour, not a harness failure.
