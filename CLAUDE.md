# Makeable

Makeable turns a typed idea into an ESP32 build: a parts list and a 3D step-by-step wiring guide. The site also sells Ember, a desk pet.

## Production

`main` is production. Every push to `main` deploys makeable.build through `.github/workflows/netlify.yml`, and the whole site ships as one unit, so a deploy from any other branch rolls back pages it does not touch.

- Work on a branch and open a PR. A maintainer approves the merge.
- Deploy only through the workflow on `main`.
- The move from Netlify to AWS happens on `staging`. Base new work on `staging` and open PRs into it. `staging` never deploys to Netlify.

## Layout

- `apps/landing/`: the Next.js 16 site, exported as static files. Next 16 changed many APIs, so read `apps/landing/node_modules/next/dist/docs/` before writing Next code. UI work follows `apps/landing/DESIGN.md`.
- `netlify/functions/`: the backend. `api.mjs` serves `/api/*`, and `build-background.mjs` runs the build pipeline. Data lives in Netlify Blobs.
- `lib/`: shared logic, including the build pipeline (`production-build-pipeline.mjs`, `prompt2circuit-*.mjs`).
- `apps/circuit-lab/`: the 3D wiring viewer, served at `/circuit-studio`.
- `pilot/`, `server.mjs`, `infra/`: the older photo-to-firmware flow on AWS. Treat it as legacy.
- `docs/`: runbooks and specs, indexed in `docs/README.md`. `docs/archive/` is history and may not match the code.

## Build pipeline

The AI chooses and deterministic rules verify. AI calls pick parts and write wording; rule code assigns pins, routes wires and rejects anything physically wrong. New pipeline steps keep that split: the AI proposes, a rule checks.

## Running locally

1. `npm ci`, then `npm run build` (builds the site into `release-dist/`).
2. `npx -y netlify-cli@24.9.0 dev --offline --dir release-dist --functions netlify/functions --port 3001`, then open http://localhost:3001.

Gotchas:
- `NEXT_PUBLIC_MAKEABLE_API_ORIGIN` in `apps/landing/.env.local` is baked into the build. Leave it unset for the steps above.
- Google sign-in only works on origins registered on the OAuth client.
- `node server.mjs` runs a demo build workshop with a fixed timer and template parts. Use the Netlify setup to test the real pipeline.

## Working rules

- Reproduce a bug as a failing test before fixing it.
- Done means watched working in the running app, beyond tests passing.
- Keep secrets in `.env` (gitignored). This repo is public.
