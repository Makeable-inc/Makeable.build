# Makeable backend, credits, and hosted API report

**Prepared:** July 17, 2026  
**Scope:** the current Makeable prototype, a server-owned OpenAI/Deepgram setup, hosted firmware compilation and browser flashing, user accounts, ten welcome credits, per-user usage tracking, and an affordable production deployment.

**Product scope decision:** Makeable supports the ESP32 family only: ESP32, ESP32-S2, ESP32-S3, ESP32-C3, and ESP32-C6. Arduino Uno, Nano, Mega, AVR, RP2040, STM32, and other board families are explicitly out of scope. Arduino CLI remains an invisible build engine for the ESP32 Arduino core; it is not an end-user dependency.

> **Implementation update (July 17, 2026):** Hosted ESP32 compilation is implemented as a pinned, cache-warmed Docker service on Amazon ECS Fargate Express Mode. The browser UI no longer exposes firmware source, downloads, provider settings, FQBN fields, or a local-app fallback. Amazon Cognito provides code-flow sign-in with PKCE; DynamoDB stores an encrypted, point-in-time-recoverable account balance and immutable usage entries. Every account gets ten welcome credits. A generation ID makes the two-call plan-plus-firmware workflow cost exactly one credit and makes retries idempotent. Deepgram is reached through an authenticated server-side WebSocket proxy, and OpenAI model choice is server-owned. Physical Web Serial flashing still requires the browser's one-time native USB permission and must be verified on real target boards before a production claim.

> **Deployment validation:** The production compiler keeps two always-warm 1-vCPU/2-GB Fargate tasks and can autoscale to ten tasks, each with 20 GB of ephemeral storage, private provider secrets, a CloudFront-only origin rule, and caching disabled. AWS's generated ECS hostname failed to publish an A/alias record even though the service, certificate, load balancer, target groups, and task were healthy, so the production path uses `d3maxnfgtzk18u.cloudfront.net`. The first direct build took 20.9 seconds, a warm repeat took 11.6 seconds, the secured CloudFront build took 8.2 seconds, and the complete `makeable.build` path took 9.7 seconds. Each returned one 4,194,304-byte merged image at address `0x0`; an arbitrary non-ESP32 target returned HTTP 400. The public site is connected to this endpoint. The signed-in account and ten-credit production flow is covered by the release validation described below. The current concurrency policy and its limits are recorded in `docs/CAPACITY.md`.

> **Account release validation:** A fresh Cognito account received 10 credits. Two production OpenAI calls carrying one shared generation ID completed while the atomic ledger charged exactly once, leaving 9 credits. Each paid generation is capped at the two normal provider steps plus one retry, preventing reuse as an unlimited proxy. A signed-in CloudFront compile returned a 4,194,304-byte merged ESP32 image in 9.79 seconds. An authenticated production voice WebSocket reached `MakeableVoiceReady`; unauthenticated account requests returned HTTP 401; backend source paths returned HTTP 404; and the Chrome QA console had no errors or warnings. Temporary QA users and ledger entries were removed after validation.

> **Fast release builds:** Normal CodeBuild releases use `Dockerfile.runtime` to overlay the API package and server files onto the last validated, prewarmed compiler image. Set `FULL_TOOLCHAIN_REBUILD=1` only when changing the ESP32 core, Arduino CLI, system packages, or bundled libraries. This avoids rebuilding five compiler caches for an API-only change.

## Executive recommendation

Use the deployed **Amazon ECS Fargate Express service** for the ESP32 compiler and hosted provider API, keep all provider secrets on the server, and enforce **Amazon Cognito** identity plus an atomic **DynamoDB** credit ledger before every paid generation.

- Using the original per-task estimate, the two-task always-warm floor is roughly **$70/month** and the ten-task ceiling under sustained load is roughly **$350/month** in `us-east-1`, before the shared load balancer, CloudFront, logs, and provider usage; AWS credits currently cover this deployment.
- Netlify hosts the frontend configuration shim; CloudFront fronts the private ECS compiler/API origin. The API verifies Cognito access tokens before provider, voice, compile, and account operations.
- The database is the authority for balances. Grant exactly ten welcome credits once, through an immutable ledger.
- A “generation” should mean one complete Makeable build package: parts plan + wiring guide + firmware. It costs one product credit even if Makeable makes two OpenAI calls internally.
- Do not expose a generic OpenAI proxy. The server, not the browser, must choose the model, prompt, reasoning effort, tools, output schema, and output limits.
- Use OpenAI background responses and signed webhooks. The browser polls Makeable job IDs, never OpenAI response IDs.
- Run hosted ESP32 compilation from the pinned Docker image in this repository. At scale, split the compiler into a private worker without provider or database secrets.

AWS is now the selected runtime because the account has credits and the ESP32 image needs more ephemeral storage than App Runner provides. ECS Express Mode supplies managed Fargate compute, TLS, load balancing, health checks, and deployment rollback. If the database is also moved to AWS, use a managed RDS/Aurora PostgreSQL option with backups and point-in-time recovery; do not run the paid credit ledger in an unmanaged database container.

> The detailed comparison and limitation sections below preserve the original pre-deployment audit. Where they mention Clerk, PostgreSQL, direct Deepgram keys, shared GitHub publishing, or missing authentication, the production implementation described above supersedes them: it uses Cognito, DynamoDB, an authenticated voice proxy, and no public GitHub publishing control.

## What exists now

The repository has two backend implementations:

1. `server.mjs`, a local Node server that serves the frontend, proxies provider requests, runs Arduino CLI, and uses one GitHub token.
2. `netlify/functions/api.mjs`, a hosted function that proxies OpenAI and GitHub but deliberately disables firmware compilation.

The frontend makes three kinds of OpenAI operation:

- high-detail image analysis and hardware planning;
- firmware generation from the returned plan;
- optional visual behavior verification from a camera frame and serial logs.

Therefore, “ten generations” must not be confused with “ten OpenAI requests.” One product generation currently creates two paid OpenAI responses, and behavior checks add more calls.

## Original backend limitations (pre-deployment audit)

### 1. There is no user boundary

There is no authentication, account table, session validation, ownership check, per-user usage history, balance, or credit ledger. Every public visitor reaches the same provider credentials.

### 2. The OpenAI endpoint is an unrestricted spending proxy

The browser supplies almost the complete Responses API request body. A caller can bypass the UI, choose models and reasoning settings, replace the prompts and schemas, and repeatedly call the endpoint. The backend only inserts a default model when one is missing.

This means hiding the OpenAI key is not enough. The key is secret, but its spending authority is effectively public.

### 3. Background response IDs have no owner

`GET /api/openai/responses/:id` retrieves any supplied provider response ID with the shared server key. The backend does not verify that the requesting user created that response. A production API must expose an internal generation ID and enforce `generation.user_id = authenticated_user.id` on every read.

### 4. Credits cannot be enforced safely in the browser

Local storage is used for settings, but any browser-only balance can be edited or cleared. A real balance requires a database transaction and an append-only ledger.

### 5. Provider choices and costly settings are user-controlled

The settings UI lets the browser select OpenAI models and stores those selections locally. The current defaults use `gpt-5.6-terra` with `xhigh` reasoning effort for both core calls. A production backend should own an allowlisted routing policy and expose no provider/model control to ordinary users.

### 6. The Deepgram secret can be exposed to the browser

The local server returns `DEEPGRAM_API_KEY` in public configuration. The Netlify function can also return the main Deepgram key when `ALLOW_BROWSER_DEEPGRAM_KEY=true`. Deepgram says normal API keys should not be placed in client code and provides short-lived token-based authentication specifically for browsers. The backend should issue a temporary token only to an authenticated, rate-limited user at connection time.

### 7. The shared GitHub token is the wrong ownership model

The current server creates repositories and writes arbitrary file paths with one `GITHUB_TOKEN`. That can only publish into the token owner's accessible accounts, not safely into each Makeable user's account. Production publishing needs a GitHub OAuth app or GitHub App connection per user. The server must restrict file paths and repository operations.

### 8. Hosted compile/flash was missing in the audited version

The audited Netlify function returned `501` for `/api/firmware/compile`. The implementation now proxies this route to the controlled Render compiler and flashes returned binaries through Web Serial.

### 9. No abuse or cost controls exist

The backend currently has no:

- per-user or per-IP rate limits;
- request/body/image size limits;
- concurrency cap;
- idempotency protection;
- daily spending cap;
- output-token limit enforced by the server;
- signup-abuse protection;
- provider-call audit log;
- cost reconciliation;
- timeout recovery or stuck-job sweeper.

### 10. Failure accounting is ambiguous

The existing client automatically retries transient OpenAI errors. Without an idempotency key and server-side job record, retries can create duplicate provider work. There is also no consistent policy for when a failed job consumes a product credit or receives a refund.

### 11. Data is ephemeral and not recoverable

The current hosted function has no database. Local builds are deleted after compilation. User projects, job status, usage, and balances do not survive as product data.

### 12. One server token publishes for everyone

Besides the authorization problem, GitHub creation and upload endpoints accept client-chosen owners, repositories, paths, branches, and content. That is too broad for an authenticated production API and much too broad for an unauthenticated one.

## Hosting comparison

Prices below are current as of July 17, 2026 and should be rechecked before purchase.

| Option | Small launch cost | Strengths | Important limitations | Verdict |
| --- | ---: | --- | --- | --- |
| **Render: paid web + paid Postgres** | About **$13–15/mo** | Predictable always-on service; managed Postgres; paid DB includes PITR; continuous health checks; zero-downtime deploy flow; private networking | Slightly higher floor; cheapest single instance is not high availability; Hobby recovery window is shorter than Pro | **Recommended** |
| **Railway Hobby: API + Postgres template** | **$5 minimum**, likely roughly $5–10 at very low load | Excellent developer experience; usage pricing; private networking; hard usage limits; can sleep idle app | Postgres template is unmanaged; backups and monitoring need configuration; health check is deploy-time, not continuous; Hobby can be deprioritized for new deployments | Good prototype/beta option |
| **Railway API + Supabase Free** | About **$5/mo** initially | Cheap; Supabase bundles auth and Postgres; little auth work | Free Supabase pauses after inactivity and has no automatic backups; two vendors; production Supabase Pro raises total to about $30/mo | Cheapest credible beta, not the cleanest long-term setup |
| **Netlify Functions + external DB** | Variable | Existing deployment path; good static hosting | Current code needed keepalive/background workarounds; state and ownership still need an external DB; firmware compilation remains unavailable | Keep only if avoiding migration is more important than operational clarity |

### Why Render wins here

Render's current pricing guidance puts a Starter web service plus Basic-256 MB Postgres at about $13/month on the free Hobby workspace before bandwidth/storage growth. Paid Render Postgres includes continuous point-in-time recovery; the Hobby workspace has a three-day recovery window. Render also performs ongoing health checks and restarts unhealthy instances.

Railway Hobby is attractive at $5/month including $5 of resource usage. Its published resource rates are $10/GB-month RAM, $20/vCPU-month CPU, $0.05/GB egress, and $0.15/GB-month volume storage. The issue is not raw compute. Railway documents its normal database templates as unmanaged: Makeable owns backup configuration, monitoring, tuning, maintenance, and disaster recovery. That is a poor trade for the system holding paid balances and the credit ledger.

Neither lowest-cost option is truly highly available. Start with one instance, health checks, backups, and reconciliation. Add a second API instance and database HA only when downtime cost justifies it.

## Proposed production architecture

```text
Browser
  ├─ Clerk sign-in / session token
  ├─ Makeable UI (same Render origin)
  └─ /v1 Makeable API
       ├─ JWT verification + authorization
       ├─ input validation + rate limits
       ├─ generation/credit transaction
       ├─ OpenAI background Responses API
       ├─ Deepgram temporary-token broker
       ├─ GitHub OAuth integration (later)
       └─ Render Postgres
            ├─ users
            ├─ credit_accounts
            ├─ credit_ledger
            ├─ generations
            ├─ ai_calls
            ├─ webhook_events
            └─ rate_limit_events / audit_events

OpenAI signed webhook ──> /v1/webhooks/openai ──> update job, usage, cost, refund
Scheduled reconciler ──> retrieve stuck provider jobs and repair missing webhooks
```

### Authentication

Use Clerk Hobby initially:

- current free plan includes up to 50,000 monthly retained users per app;
- prebuilt sign-up, sign-in, and account UI avoids implementing password security;
- the browser sends a Clerk session token, and the backend verifies it;
- Makeable still owns the product data and credit ledger in Postgres.

Do not grant credits directly from an unauthenticated Clerk webhook alone. On the first verified authenticated API request, run an idempotent user upsert and welcome grant. A unique key such as `welcome:<clerk_user_id>` ensures the ten-credit grant can happen only once. Clerk webhooks remain useful for email changes and account deletion.

For stronger free-credit abuse resistance, require a verified email and bot challenge. Email-only identity does not stop a determined user from opening multiple accounts; higher-value grants may eventually require phone verification or a payment method.

### Server-owned generation contract

The public endpoint should accept product inputs, not an OpenAI payload:

```http
POST /v1/generations
Authorization: Bearer <session JWT>
Idempotency-Key: <uuid>
Content-Type: application/json

{
  "idea": "Build a motion-triggered light",
  "photo": "data:image/jpeg;base64,..."
}
```

The server constructs all provider requests. It chooses:

- model and fallback model;
- reasoning effort;
- system/developer instructions;
- JSON schema;
- `max_output_tokens`;
- accepted image types and image detail;
- timeout/retry policy;
- a hashed OpenAI `safety_identifier` for the user;
- metadata such as internal generation ID and stage.

The response contains a Makeable ID only:

```json
{
  "id": "gen_...",
  "status": "queued",
  "creditsRemaining": 9
}
```

### Credit semantics

Keep the UI simple while tracking provider usage precisely:

- **Welcome grant:** 10 product credits once per verified account.
- **Complete build generation:** 1 credit. Includes hardware plan, wiring steps, and firmware.
- **Behavior verification:** include one check with the generation; additional checks cost 1 credit each or require a paid plan.
- **Voice transcription:** do not deduct generation credits initially, but apply a short duration cap and track seconds per user.
- **Compile/flash:** no AI credit. Hosted compilation is unavailable until the isolated worker exists.

This policy prevents users from being charged twice merely because the implementation uses a planning call followed by a firmware call.

### Atomic debit and refund algorithm

`POST /v1/generations` should:

1. Verify the JWT, verified-email state, request size, and rate limits.
2. Begin a database transaction.
3. Return the existing generation if `(user_id, idempotency_key)` already exists.
4. Lock the user's credit account row with `SELECT ... FOR UPDATE`.
5. Reject with `402`/product error if balance is below one.
6. Insert the generation, decrement the cached balance, and append a `-1 generation_reservation` ledger entry.
7. Commit before calling OpenAI so concurrent requests cannot overspend.
8. Create the OpenAI background response and store its provider ID in `ai_calls`.
9. If the provider never accepts the request, append a compensating `+1 system_refund` ledger entry in another transaction.

When a terminal provider result arrives, the webhook handler records token usage and final status. A Makeable/system/provider failure receives one idempotent refund; invalid user input or a user cancellation after paid processing starts normally does not. Publish this rule in the UI.

Never delete or edit ledger rows. Corrections are new compensating rows. Keep `credit_accounts.balance` as a transactionally maintained cache and periodically verify that it equals `SUM(credit_ledger.delta)`.

### Minimal schema

```sql
users(
  id uuid primary key,
  auth_subject text unique not null,
  email_hash text,
  status text not null,
  created_at timestamptz not null
)

credit_accounts(
  user_id uuid primary key references users(id),
  balance integer not null check (balance >= 0),
  updated_at timestamptz not null
)

credit_ledger(
  id uuid primary key,
  user_id uuid not null references users(id),
  delta integer not null,
  reason text not null,
  reference_key text not null,
  created_at timestamptz not null,
  unique(user_id, reference_key)
)

generations(
  id uuid primary key,
  user_id uuid not null references users(id),
  idempotency_key text not null,
  status text not null,
  credit_cost integer not null,
  request_hash text not null,
  result_json jsonb,
  error_code text,
  created_at timestamptz not null,
  completed_at timestamptz,
  unique(user_id, idempotency_key)
)

ai_calls(
  id uuid primary key,
  generation_id uuid not null references generations(id),
  stage text not null,
  provider text not null,
  model text not null,
  provider_response_id text unique,
  status text not null,
  input_tokens integer,
  cached_input_tokens integer,
  output_tokens integer,
  reasoning_tokens integer,
  estimated_cost_microusd bigint,
  created_at timestamptz not null,
  completed_at timestamptz
)

webhook_events(
  webhook_id text primary key,
  provider text not null,
  received_at timestamptz not null,
  processed_at timestamptz
)
```

### API surface

| Endpoint | Purpose |
| --- | --- |
| `GET /v1/me` | Account, balance, plan, and limits |
| `GET /v1/usage` | Credit ledger and per-generation usage summaries |
| `POST /v1/generations` | Atomically reserve one credit and start a complete build |
| `GET /v1/generations/:id` | Poll internal job state; ownership required |
| `POST /v1/generations/:id/verifications` | Included/paid behavior check with ownership and caps |
| `POST /v1/voice/token` | Authenticated, rate-limited Deepgram temporary token |
| `POST /v1/webhooks/openai` | Raw-body signature-verified OpenAI webhook |
| `POST /v1/webhooks/clerk` | Signature-verified identity lifecycle events |
| `GET /healthz` | Liveness/readiness for Render |

### Background work without a launch-day worker

OpenAI background mode is already the right primitive for long calls. OpenAI documents polling while a response is `queued` or `in_progress`, and supports a signed `response.completed` webhook. Webhook delivery may be duplicated and retries for up to 72 hours, so store `webhook-id` as the deduplication key and make processing idempotent.

At launch:

1. API reserves the credit and starts a background response.
2. OpenAI webhook updates the call and starts the next stage if required.
3. Browser polls `GET /v1/generations/:id` for UX progress.
4. A Render cron job every few minutes reconciles jobs that have been nonterminal too long, protecting against a missed webhook or process crash.

This avoids a paid always-on queue/worker initially. Add a durable queue and worker when throughput or non-OpenAI jobs justify them.

### Usage and cost tracking

Every completed Responses API object includes token usage fields. Store input, cached input, output, reasoning, and total tokens per `ai_call`. Maintain a versioned server-side pricing table and calculate estimated provider cost in integer microdollars.

Current standard `gpt-5.6-sol` pricing is $5 per million input tokens, $0.50 per million cached input tokens, and $30 per million output tokens. A purely illustrative build totaling 8,000 uncached input tokens and 4,000 output/reasoning tokens would cost about **$0.16**. Ten such builds are about **$1.60 per activated user**. Actual image and reasoning usage can differ substantially, so measure real calls before setting a permanent free allowance.

Recommended cost controls:

- separate OpenAI projects for development and production;
- project spend/rate limits and billing alerts;
- server-enforced model routing and `max_output_tokens`;
- no client-provided tools, models, prompts, schemas, or service tier;
- no automatic retry after a provider response was accepted unless the same internal job is resumed;
- per-user daily and concurrent-generation caps;
- an application-wide daily dollar circuit breaker;
- alert on anomalous cost/user, failures, and duplicate refunds;
- store provider request IDs and hashed user safety identifiers.

### Deepgram

Replace the settings field with this flow:

1. Authenticated client calls `POST /v1/voice/token`.
2. Makeable rate-limits by user and IP and checks the account status.
3. Makeable calls Deepgram `/v1/auth/grant` with the secret server key.
4. Client receives the short-lived token and opens the WebSocket directly.

Deepgram tokens default to a 30-second TTL for connection establishment; the WebSocket may remain connected after the token expires. This keeps realtime audio off the Makeable server without revealing the long-lived key.

### GitHub publishing

Remove `GITHUB_TOKEN` as a shared end-user publishing credential. The choices are:

1. **Recommended:** GitHub OAuth/GitHub App per user, with the narrowest repository permissions and encrypted token storage.
2. **Simplest MVP:** publish documentation only and keep firmware source private inside Makeable.

Do not publish all user projects into the owner's account unless that is an explicit product feature with clear naming, quotas, and moderation.

### Hosted firmware compilation

The feature has now moved online in the repository implementation. Before broad production traffic:

- put Arduino CLI in a separate build worker/container;
- give it no OpenAI, Clerk, GitHub, or database admin secrets;
- enforce CPU, memory, disk, output, and wall-clock limits;
- disable outbound network during builds after dependencies are preinstalled;
- accept only an allowlist of board FQBNs and installed libraries;
- delete workspaces after every build;
- scan/validate returned binaries and cap their size;
- queue builds so one user cannot exhaust CPU.

Browser Web Serial can still flash returned binaries. The compilation service should never share a process or filesystem with the public API.

## Abuse controls for ten free credits

Ten free credits create a direct cash incentive for account farming. At minimum:

- verified email before grant or before first spend;
- bot challenge on signup and suspicious generation requests;
- limit concurrent generation jobs to one or two per user;
- per-user and per-IP rolling limits;
- one welcome grant per immutable auth subject;
- alert on many accounts from one IP/device fingerprint;
- optional disposable-email blocking;
- no credit transfer between accounts;
- lower initial daily spend, for example three free generations/day even when balance is ten;
- require stronger verification before paid/high-volume tiers.

Do not treat IP address as identity; households and schools share IPs. Use it as a risk signal, not the only rule.

## Migration plan

### Phase 1 - Secure foundation

1. Create a production OpenAI project/key with spend limits and a webhook signing secret.
2. Provision Render Starter web service and paid Render Postgres in the same region.
3. Add Clerk and JWT verification.
4. Introduce migrations for users, credit account, immutable ledger, generations, AI calls, and webhook events.
5. Add `/healthz`, structured logs, request IDs, body limits, and error redaction.

### Phase 2 - Replace the proxy

1. Create `POST /v1/generations` and `GET /v1/generations/:id`.
2. Move prompts, schemas, model selection, reasoning effort, and retry rules to server modules.
3. Add idempotent debit/refund transactions.
4. Use OpenAI background responses, signed webhooks, and a reconciliation cron.
5. Record token usage and estimated cost per call.
6. Delete or permanently reject the generic `/api/openai/*` routes.

### Phase 3 - Simplify the frontend

1. Remove Deepgram key, OpenAI model, reasoning model, and provider status controls from Settings.
2. Add sign-in, balance, usage history, “credits remaining,” and clear charge/refund messages.
3. Replace direct OpenAI polling with internal generation polling.
4. Add the authenticated Deepgram token endpoint.

### Phase 4 - Integrations and hardware

1. Replace shared GitHub token publishing with user OAuth, or ship download-only first.
2. Design the isolated compile worker.
3. Add a durable queue only when compilation or job volume requires it.

## Launch checklist

- [ ] No production provider secret appears in HTML, JavaScript, public config, logs, or API responses.
- [ ] Generic OpenAI proxy routes are gone.
- [ ] All product routes require verified authentication except health and signed webhooks.
- [ ] Every generation has an idempotency key and user owner.
- [ ] Welcome grant has a database uniqueness guarantee.
- [ ] Debit and refund logic is transaction-tested under concurrent requests.
- [ ] OpenAI webhook raw-body signature is verified and duplicate events are safe.
- [ ] Reconciliation repairs stuck jobs and missing webhooks.
- [ ] Image MIME, dimensions, and byte size are validated server-side.
- [ ] Per-user, IP, concurrency, daily spend, and global cost limits are active.
- [ ] Credit ledger and cached balance are reconciled.
- [ ] Database PITR is enabled and a restore has been tested.
- [ ] Provider usage and estimated dollars appear in admin telemetry.
- [ ] Shared GitHub publishing token is removed from the public workflow.
- [ ] Hosted compiler stays off until isolated.

## Sources

- [OpenAI background mode](https://developers.openai.com/api/docs/guides/background)
- [OpenAI webhooks](https://developers.openai.com/api/docs/guides/webhooks)
- [OpenAI production best practices](https://developers.openai.com/api/docs/guides/production-best-practices)
- [OpenAI API pricing](https://developers.openai.com/api/docs/pricing)
- [Render pricing](https://render.com/pricing)
- [Render cost snapshot and billing model](https://render.com/articles/how-much-does-cloud-application-hosting-cost-for-small-businesses)
- [Render Postgres backup and PITR](https://render.com/articles/how-to-backup-and-restore-postgresql-databases)
- [Render health checks](https://render.com/docs/health-checks)
- [Render deploy behavior](https://render.com/docs/deploys)
- [Railway pricing](https://docs.railway.com/pricing/plans)
- [Railway PostgreSQL](https://docs.railway.com/databases/postgresql)
- [Railway database responsibilities](https://docs.railway.com/databases)
- [Railway health checks](https://docs.railway.com/deployments/healthchecks)
- [Railway cost controls](https://docs.railway.com/pricing/cost-control)
- [Supabase pricing](https://supabase.com/pricing)
- [Clerk pricing](https://clerk.com/pricing)
- [Deepgram token-based authentication](https://developers.deepgram.com/guides/fundamentals/token-based-authentication)
