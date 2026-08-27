# Task 3 Report: Server-only PostHog session aggregates

## Outcome

Implemented a server-only PostHog HogQL reader for normalized daily unique-session
aggregates and attached its result to authenticated social dashboard reports on
the local and Netlify paths.

## RED evidence

Command:

```text
node --test tests/posthog-social.test.mjs
```

Result: exit 1. Node reported `ERR_MODULE_NOT_FOUND` for
`lib/posthog-social.mjs`; 0 passed and 1 failed. This was the expected missing
service boundary.

Command:

```text
node --test tests/social-dashboard.test.mjs
```

Result: exit 1. Five tests passed and three failed because report
`attribution` was `undefined` for the fallback, connected report, and POST
report cases.

## GREEN evidence

Command:

```text
node --test tests/posthog-social.test.mjs tests/social-dashboard.test.mjs tests/netlify-proxy.test.mjs && npm run check
```

Result: exit 0. All 37 tests passed with 0 failures, and every configured
`node --check` syntax check passed, including `lib/posthog-social.mjs`,
`lib/social-dashboard.mjs`, `server.mjs`, and `netlify/functions/api.mjs`.
The same command was then run from a clean `git checkout-index` snapshot of the
staged tree; it again passed 37 tests and all syntax checks. This proves the
commit contents independently from the extra unstaged worktree changes.

The focused suite covers missing credentials, the exact outbound query shape,
unsafe project IDs, network failures, HTTP failures, malformed JSON, malformed
response structure, invalid dates, unsupported platforms, invalid account keys,
invalid session counts, normalized dashboard attachment, and an unauthorized
dashboard social request with configured PostHog credentials making zero fetches.

## Security checks

- `POSTHOG_PERSONAL_API_KEY` and `POSTHOG_PROJECT_ID` are read only by server
  handlers. The local environment reader already merges all `.env` and process
  variables; the Netlify allowlist now includes both names explicitly.
- Both local and Netlify handlers finish dashboard authentication before calling
  `readSocialWebsiteSessions`.
- The numeric project ID is validated before it is interpolated into the PostHog
  URL. Unsafe identifiers return `{ status: "unavailable", daily: [] }` without
  fetching.
- Every PostHog row is validated for a real `YYYY-MM-DD` date, supported social
  platform, normalized account key, and non-negative safe-integer session count.
- Network, HTTP, JSON, and schema failures return `unavailable`. No upstream
  response or thrown error is returned or logged.
- A staged-diff scan found the personal key only at the outbound Authorization
  header seam, environment-variable references, and clearly synthetic test
  fixtures. No real credentials or secret values are staged.

## Files

- Added `lib/posthog-social.mjs`.
- Added `tests/posthog-social.test.mjs`.
- Added and extended the required social dashboard foundation in
  `lib/social-dashboard.mjs` and `tests/social-dashboard.test.mjs`.
- Wired authenticated local and Netlify handlers in `server.mjs` and
  `netlify/functions/api.mjs`.
- Strengthened the unauthorized fetch regression in
  `tests/netlify-proxy.test.mjs`.
- Added syntax checks for the two server-side social modules in `package.json`.

## Staged-diff review

Before this report, the staged diff contained eight intended files with 1,043
insertions and 4 deletions. The full staged `lib/social-dashboard.mjs` and its
tests were reviewed because the foundation was untracked and cannot be partially
represented. The prerequisite dashboard route, handler, storage, import, and
syntax-check hunks were included under the controller ruling so the commit is
valid in isolation.

The unrelated `@netlify/blobs` dependency upgrade, landing application changes,
dashboard UI assets, CSS, legal pages, and other dirty-worktree files remain
unstaged. `git diff --cached --check` passed.

## Self-review

- The HogQL query counts `uniqExact(properties['$session_id'])`, groups only by
  date, platform, and account key, and selects only `social_landing_view` events.
- Missing either credential is distinct from a configured integration failure:
  `not_connected` versus `unavailable`.
- GET and successful POST social reports receive the same normalized
  `{ status, daily }` attribution contract.
- A connected empty PostHog result remains connected with an empty daily list;
  it is not confused with missing credentials or query failure.
- No retries, raw events, person-level data, or browser-facing credentials were
  added.

## Concerns

- No live PostHog request was made because this task has no production
  credentials. The HTTP boundary is exercised with complete Response fixtures.
- TypeScript/JavaScript language-server diagnostics were unavailable because the
  workspace has no language server installed. Node syntax checks and the focused
  runtime suites passed instead.
