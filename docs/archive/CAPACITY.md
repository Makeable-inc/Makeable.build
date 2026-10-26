# Production capacity

## Incident finding

The July 22 outage was not caused by multiple ECS tasks or resource exhaustion. The service was
configured with exactly one task. During the failure window, ECS averaged 1.33% CPU and 2.44%
memory, with peaks of 68.34% CPU and 9.45% memory. Every restart was preceded by the same uncaught
`413 Request body is too large` error from the OpenAI background route.

The API now isolates rejected asynchronous requests instead of terminating the process, accepts the
compressed hardware-photo payload size, and drains active HTTP requests during ECS task shutdown.

## Fifty-user operating target

"Fifty concurrent users" means fifty active browser workflows using authentication, OpenAI
background creation and polling, account reads, and occasional firmware compilation. It does not
mean fifty simultaneous CPU-bound Arduino compilations.

The production service is configured for:

- two always-warm tasks, so one task can fail or deploy without removing all capacity;
- up to ten autoscaled tasks at a 35% average CPU target;
- one Arduino compilation per task, preventing two compiler processes from fighting for the same
  single vCPU and shared build cache;
- automatic browser retries with server-directed delay and jitter when all current compiler workers
  are occupied; and
- a roughly three-to-four-minute retry window, long enough for ECS to add capacity without turning a temporary `429`
  into a failed build.

At maximum scale this provides ten simultaneous firmware compilers. A sudden burst of more than ten
compile operations is smoothed by browser retries. If the product later requires fifty simultaneous
firmware compilations with a strict latency target, compilation should move to a durable job queue
with independently autoscaled workers; it should not be implemented by running fifty compiler
processes inside the web API.

OpenAI throughput remains subject to the provider account's rate limits. Those quotas need to be
reviewed before a public event or launch that is expected to start dozens of AI generations at the
same instant.

## Release validation

Every capacity release must pass:

1. the full Node test suite;
2. the production build checks;
3. the real ESP32 compiler integration test;
4. fifty concurrent local request failures followed by fifty successful health requests in the same
   process;
5. a fifty-request production health load check after deployment;
6. CloudFront CORS preflight and authenticated-route rejection checks; and
7. the complete ECS canary, bake, alarm, and old-task drain cycle.
