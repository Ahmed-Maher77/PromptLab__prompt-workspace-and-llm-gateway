---
type: decision
id: ADR-015
title: "Health Probes & Gateway Resilience"
status: accepted
date: "2026-10-26"
deciders: ["PromptLab Core Team"]
---

# ADR-015 — Health Probes & Gateway Resilience

## Context

Three related problems in health reporting, tracing and gateway timeouts:

- **Health checks.** `/api/health` was the only health endpoint. It always returned 200, so the Docker HEALTHCHECK could not tell a healthy API from one whose database was down. Its gateway probe also reused one `AbortController` for the fallback request, so once the first probe timed out the fallback started out already aborted and could never succeed.
- **Tracing.** Traces could finish with child spans still open: the `quota.reserve` span was never ended on the idempotent-replay path. An upstream 429 from the provider was recorded as a generic `error` rather than `rate_limited`.
- **Gateway timeouts.** The LiteLLM gateway had `request_timeout: 60` while the API aborts provider calls after `LLM_REQUEST_TIMEOUT_MS` (30 s by default). The API therefore gave up while LiteLLM was still working, and each such call ended as an ambiguous, partially charged timeout. The gateway also had no retry policy.

---

## Decision 1: Three health endpoints with distinct contracts

| Endpoint | Purpose | Checks | Status codes |
| :--- | :--- | :--- | :--- |
| `GET /api/health/live` | Liveness: "is the process able to serve HTTP?" | none | 200 |
| `GET /api/health/ready` | Readiness: "can this instance do useful work?" | PostgreSQL, LiteLLM gateway liveness | 200, or 503 with an RFC 9457 body that lists each dependency's state |
| `GET /api/health` | Diagnostic snapshot for the Overview/Settings UI | database latency, gateway liveness; admins also get gateway URL, environment and configured providers | always 200 (`status: ok | degraded`) |

**Rationale:**
- The container HEALTHCHECK (Dockerfile and `docker-compose.yml`) uses `/live`. A dependency outage must not get a healthy API container restarted in a loop; restarting does not fix a database that is down.
- An orchestrator or load balancer that should stop routing traffic during an outage uses `/ready`.
- `/api/health` keeps its status-code contract because the UI renders its body and shows nothing on an error status. The route stays public, but unauthenticated callers receive only status, timestamp, uptime, version and the database and gateway availability and latency; the full payload is returned to callers with a valid `admin` credential.
- `/live` and `/ready` use `@nestjs/terminus`. The global `AllExceptionsFilter` strips the reserved RFC 9457 members (`type`, `title`, `status`, `detail`, `instance`) from extension objects. Without that, Terminus's `status: "error"` would overwrite the numeric `status`. Titles now come from Node's `http.STATUS_CODES`, so 503 reads "Service Unavailable".
- Each gateway probe request (`/health/liveliness`, then `/health`) gets its own `AbortSignal.timeout(1200)`. A 401/403/404 response counts as "available", because it proves the gateway process is answering HTTP.

---

## Decision 2: Gateway timeout and retry budget

The gateway (`infra/litellm/config.yaml`) has to finish inside the API's budget:

```
API budget (LLM_REQUEST_TIMEOUT_MS)            30 s
Gateway per-attempt timeout (request_timeout)  25 s   < 30 s
Timeout retries                                 0     (a second 25 s attempt would outlive the API)
```

| Failure | Retries | Reason |
| :--- | :--- | :--- |
| `RateLimitError` (429) | 2, with exponential backoff | Transient and fails fast |
| `ServiceUnavailableError` (503) | 2 | Transient and fails fast |
| `InternalServerError` (500) | 1 | Sometimes transient. One retry is enough. |
| `Timeout` | 0 | Would exceed the API budget and double-charge |
| `Authentication`, `BadRequest`, `NotFound`, `ContentPolicyViolation` | 0 | A retry cannot fix these |

`allowed_fails: 3` and `cooldown_time: 30` take a failing deployment out of rotation briefly instead of continuing to send it traffic.

**No cross-model fallbacks.** Silently switching to another model would change the price, the behaviour and the token accounting without the user knowing. This matters most for Comparison runs, which exist to compare specific models. If a fallback is ever added, it has to be explicit and visible in the response.

**Guard rail.** `apps/api/src/providers/gateway-config.spec.ts` reads the YAML in the unit test suite and fails the build if any of these hold:
- `request_timeout` is not below the API timeout
- timeouts are retried
- a non-retryable error class gets retries
- a model's `api_key` stops coming from `os.environ/`

---

## Decision 3: Trace completeness

- `ObservabilityService.complete()` ends every child span that is still open. Each one gets the trace's outcome (`ok` or `error`) and the attribute `span.closed_by_trace: true`, so in the trace viewer an auto-closed span can be told apart from one the code ended explicitly.
- The replay path ends `quota.reserve` with `{ replayed: true }`.
- A provider failure classified as `provider_rate_limited` or `provider_quota_error` completes the trace with status `rate_limited`. Before this change it was `error`. Rate limiting is an expected capacity signal, so it shouldn't count toward error-rate alerts. Our own quota rejections were already `rate_limited`, with `errorCode: RATE_LIMIT_EXCEEDED`.

---

## Consequences

- **Positive:**
  - Container health reflects whether the process is alive, and readiness reflects whether its dependencies are reachable.
  - Gateway timeouts now come back as clean, typed errors inside the API budget, so ambiguous timeouts are rare.
  - Traces no longer contain dangling spans.
- **Negative / trade-offs:**
  - A provider that answers after 25–30 s now fails at the gateway; before, the call could still have succeeded. Raising the timeout means raising `LLM_REQUEST_TIMEOUT_MS` first, and the guard-rail test enforces that order.
  - Retrying 429s adds latency, bounded by the backoff, before the user sees the error.
- **Verification:**
  - Unit tests: health controller and service, the exception filter, observability, LLM execution, gateway config.
  - The integration suite has `liveness and readiness probes`.
  - The Docker HEALTHCHECK change is exercised by the CI `docker-images` job.
