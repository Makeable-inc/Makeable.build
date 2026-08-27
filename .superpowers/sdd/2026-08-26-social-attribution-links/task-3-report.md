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

---

## Fix round 1: pagination and request timeout

### Findings addressed

- Incomplete PostHog query pages with `hasMore: true` now return
  `{ status: "unavailable", daily: [] }` instead of silently presenting partial
  aggregates as connected.
- Every configured PostHog request now receives an abort signal with a
  server-controlled 10-second default. Tests may inject a shorter positive
  `timeoutMs` so stalled-request behavior is deterministic without exposing an
  abort error.
- The deferred shallow-frozen fallback constant was not changed.

### RED command and exact output

Command:

```text
node --test tests/posthog-social.test.mjs
```

Output:

```text
✔ PostHog attribution stays disconnected without server credentials (0.568292ms)
✔ PostHog attribution returns only normalized daily session aggregates (11.070833ms)
✔ PostHog attribution rejects unsafe project identifiers without fetching (0.105583ms)
✖ PostHog attribution rejects incomplete paginated aggregates (0.697458ms)
✖ PostHog attribution aborts a stalled request within its timeout (102.586708ms)
▶ PostHog attribution hides network, HTTP, and schema failures
  ✔ network failure (0.242583ms)
  ✔ HTTP failure (0.155667ms)
  ✔ invalid response object (0.150792ms)
  ✔ invalid JSON (0.318584ms)
  ✔ invalid aggregate date (0.153792ms)
  ✔ unsupported aggregate platform (0.098083ms)
  ✔ invalid aggregate account key (0.114166ms)
  ✔ invalid aggregate session count (0.092ms)
✔ PostHog attribution hides network, HTTP, and schema failures (1.795375ms)
ℹ tests 14
ℹ suites 0
ℹ pass 12
ℹ fail 2
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 151.498667

✖ failing tests:

test at tests/posthog-social.test.mjs:79:1
✖ PostHog attribution rejects incomplete paginated aggregates (0.697458ms)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:
  + actual - expected

    {
  +   daily: [
  +     {
  +       accountKey: 'makeable_zak',
  +       date: '2026-08-26',
  +       platform: 'instagram',
  +       websiteSessions: 3
  +     }
  +   ],
  +   status: 'connected'
  -   daily: [],
  -   status: 'unavailable'
    }

test at tests/posthog-social.test.mjs:97:1
✖ PostHog attribution aborts a stalled request within its timeout (102.586708ms)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:
  + actual - expected

  + 'request remained pending'
  - {
  -   daily: [],
  -   status: 'unavailable'
  - }
```

The failures were the intended missing behaviors: a partial response was marked
connected, and the stalled request exceeded the bounded 100-millisecond test
guard.

### GREEN command and exact output

Command:

```text
node --test tests/posthog-social.test.mjs tests/social-dashboard.test.mjs tests/netlify-proxy.test.mjs && npm run check
```

Output:

```text
✔ Netlify proxies protected API requests to the metered backend (8.068042ms)
✔ production config keeps the pilot callback while using backend capabilities (0.473167ms)
✔ landing acquisition routes are reserved locally instead of reaching the AWS proxy (0.792666ms)
✔ Ember checkout is handled locally and creates a Stripe Checkout session (1.305333ms)
✔ Ember checkout completion is verified with Stripe before confirming payment (0.378917ms)
✔ Ember checkout completion rejects invalid session identifiers without calling Stripe (0.186166ms)
✔ Ember checkout uses fixed Singapore pricing for Singapore orders (0.2335ms)
✔ Ember checkout requires legal consent and validates order quantity before Stripe (0.216792ms)
✔ Make a Build interest endpoint validates email before durable storage (0.275583ms)
✔ Ember checkout fails closed when Stripe is unavailable or the method is unsupported (0.187583ms)
✔ waitlist browser confirmation routes are private, resettable, and never proxied (0.262792ms)
✔ landing acquisition rejects oversized request bodies (0.164ms)
✔ dashboard routes stay private and issue signed owner sessions (1.236708ms)
✔ dashboard routes fail closed when private access is not configured (0.106666ms)
✔ Google acquisition rejects null bodies and unsupported methods without proxying (0.160583ms)
✔ acquisition route variants cannot fall through to the AWS proxy (0.1905ms)
✔ Netlify passes CORS preflights through without adding a body to 204 responses (0.164542ms)
✔ PostHog attribution stays disconnected without server credentials (0.527416ms)
✔ PostHog attribution returns only normalized daily session aggregates (11.177666ms)
✔ PostHog attribution rejects unsafe project identifiers without fetching (0.096583ms)
✔ PostHog attribution rejects incomplete paginated aggregates (0.188709ms)
✔ PostHog attribution aborts a stalled request within its timeout (6.201792ms)
▶ PostHog attribution hides network, HTTP, and schema failures
  ✔ network failure (0.261875ms)
  ✔ HTTP failure (0.14425ms)
  ✔ invalid response object (0.148125ms)
  ✔ invalid JSON (0.302834ms)
  ✔ invalid aggregate date (0.270625ms)
  ✔ unsupported aggregate platform (0.13975ms)
  ✔ invalid aggregate account key (0.119709ms)
  ✔ invalid aggregate session count (0.088542ms)
✔ PostHog attribution hides network, HTTP, and schema failures (1.993917ms)
✔ parseSocialCsv creates safe normalized post records from a quoted CSV export (1.73025ms)
✔ parseSocialCsv rejects unsafe media URLs before they reach the dashboard (0.200584ms)
✔ parseSocialCsv keeps same-site dashboard media paths (0.145208ms)
✔ buildSocialDashboardReport ranks accounts and preserves the latest follower count (5.356083ms)
✔ buildSocialDashboardReport includes normalized website-session attribution (0.137209ms)
✔ mergeSocialRecords updates matching posts without duplicating prior imports (0.095667ms)
✔ dashboardSocialResult imports and persists new social posts (0.373ms)
✔ dashboardSocialResult rejects extra import fields before storage (0.062375ms)
ℹ tests 39
ℹ suites 0
ℹ pass 39
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 147.963917

> makeable-hardware-builder@0.1.0 check
> node --check app.js && node --check pilot/app.js && node --check dashboard/app.js && node --check dashboard/social.js && node --check dashboard/social-model.js && node --check hologram/hologram.js && node --check hologram/ble-client.js && node --check hologram/ble-protocol.js && node --check hologram/frame-codec.js && node --check hologram/sw.js && node --check lib/acquisition.mjs && node --check lib/build-jobs.mjs && node --check lib/builder-session.mjs && node --check lib/dashboard-auth.mjs && node --check lib/dashboard-report.mjs && node --check lib/posthog-social.mjs && node --check lib/social-dashboard.mjs && node --check lib/social-links.mjs && node --check lib/geometry-contract.mjs && node --check lib/makeable-builds.mjs && node --check lib/waitlist-report.mjs && node --check lib/waitlist-storage.mjs && node --check lib/waitlist-session.mjs && node --check scripts/waitlist-admin.mjs && node --check server.mjs && node --check netlify/functions/api.mjs && node --check netlify/functions/build-background.mjs && node --check netlify/functions/build-cleanup.mjs
```

### Security and self-review

- Pagination metadata is checked before any rows can become a connected result.
- Timeout aborts are handled by the existing fail-closed boundary and return only
  the normalized unavailable status; the abort reason and credentials are not
  returned or logged.
- The production default is fixed in the server-only module. The shorter test
  timeout is an internal option and is never read from an HTTP request.
- Existing authentication ordering, credential handling, row validation, and
  disconnected behavior were unchanged.

### Staged fix review

The pre-report staged diff contains only `lib/posthog-social.mjs` and
`tests/posthog-social.test.mjs`: 51 insertions across two files. The service diff
adds the 10-second default, validates the injected positive timeout, passes
`AbortSignal.timeout(timeoutMs)` to the fetch implementation, and rejects
`hasMore: true`. The test diff adds one pagination regression and one bounded
stalled-request regression. `git diff --cached --check` passed. All unrelated
worktree files remain unstaged.

The focused command and `npm run check` were repeated from a clean
`git checkout-index` snapshot of the final staged tree. The staged snapshot also
passed 39 tests with 0 failures and every configured syntax check.

### Fix-round concerns

- No live PostHog request was made; the response and abort boundaries use
  deterministic HTTP/test doubles.
- JavaScript language-server diagnostics remain unavailable. The focused runtime
  tests and Node syntax checks pass.
