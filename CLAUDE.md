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

1. `npm ci`, then `npm run dev:local`. It builds the site into `release-dist/` and serves it on http://localhost:3001, with `/api/*` and background builds running through the same Lambda adapter as AWS. Storage is in memory and resets on restart. `--skip-build` reuses the last build, `--port` picks another port.
2. Sign in at http://localhost:3001/__local-login?next=/ (a test user; this route exists only in `scripts/dev-local.mjs`).
3. `npm run dev:build -- "<idea>"` runs one real build against the running app and prints each stage, the parts and the artifact states.

How to verify a change end to end is in `.claude/skills/verify-setup/` and the `verify-*` skills next to it.

Gotchas:
- `NEXT_PUBLIC_MAKEABLE_API_ORIGIN` in `apps/landing/.env.local` is baked into the build. Leave it unset for the steps above.
- Google sign-in only works on origins registered on the OAuth client. Use the local login instead.
- `node server.mjs` runs a demo build workshop with a fixed timer and template parts. Use `dev:local` to test the real pipeline.

## AWS backend

`template.yaml` (SAM) defines the stack `makeable-prod` in us-east-1: the API and pipeline Lambdas, the S3 data bucket and the schedules. It becomes production when makeable.build's DNS points at it. Settings and secrets come from the Secrets Manager secret `makeable/prod`, never from the repo.

- Deploys are automatic: every push to `staging` runs `.github/workflows/deploy-aws.yml` (build, tests, backend, website, smoke build). Merging the PR is the approval. If the deploy itself fails it redeploys the tag `aws-last-good`, website first; "Run workflow" with a ref deploys that ref by hand. A rollback is a redeploy (minutes), not an instant switch.
- By hand (only if the workflow can't): `aws sso login --sso-session makeable`, then with `AWS_PROFILE=makeable`: `npm run aws:build`, `sam deploy`, `node scripts/deploy-site.mjs`.
- Check a deploy: `AWS_PROFILE=makeable node scripts/aws-smoke-build.mjs` runs one real build through the API URL, prints each stage and deletes its own test records. Exit 0 means ready. Each run calls OpenAI.
- A build can fail on the AI's side (for example `planner_identity_echo_mismatch`); rerun once before treating it as a deploy problem.

### When a deploy fails after a merge

The workflow already put the live site back on `aws-last-good`, so users are fine. `staging` still holds the change that failed, and the next merge would deploy it again, so clean it up through a PR (`staging` takes no direct pushes):

1. Read why: `gh run list --workflow deploy-aws.yml --limit 1`, then `gh run view <id> --log-failed`.
2. Clear cause and a small fix (a missing permission, a typo): open a PR with the fix. Merging it deploys it.
3. Unclear cause, or the fix will take a while: revert the merged PR (`gh pr view <n>` → "Revert" on GitHub, or `git revert -m 1 <merge-sha>` on a branch), merge the revert, and fix on a branch.
4. Changes to `aws/github-deploy-role.yaml` do not deploy through the workflow: apply them by hand (`aws cloudformation deploy --template-file aws/github-deploy-role.yaml --stack-name makeable-github-deploy --capabilities CAPABILITY_NAMED_IAM`, after checking the change set) before merging the PR that needs them.

## Working rules

- Reproduce a bug as a failing test before fixing it.
- Done means watched working in the running app, beyond tests passing.
- Keep secrets in `.env` (gitignored). This repo is public.
