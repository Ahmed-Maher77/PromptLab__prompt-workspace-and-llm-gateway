---
type: spec
id: SPEC-14
title: "Quotas and Usage"
description: "Monthly token quotas, atomic reservations, reconciliation, the usage ledger, idempotent execution and request-rate limits"
status: partially-implemented
domain: "usage"
last_updated: "2026-10-27"
---

# SPEC-14: Quotas and Usage

## Summary

Each user has a monthly token allowance and a request-rate limit. Before a model call the API reserves an estimated number of tokens in PostgreSQL, calls the gateway only if the reservation succeeds, and then settles the reservation against actual usage. Every call has one usage record keyed by the caller's idempotency key, so retries replay the stored result instead of paying twice.

## Scope

- Quota policy per user: monthly token limit and request-rate limit. Default 1,000,000 tokens per month and 60 requests per minute.
- Quota periods: one row per user per UTC calendar month, with limit, reserved and actual tokens.
- Usage ledger: one record per model call, with status, input and output tokens, token source, cost, operation and timestamps.
- Reservation, reconciliation, expiry sweeping and period closing.
- Idempotent execution through the `Idempotency-Key` header.
- Request-rate limits, separate from token limits.
- The Usage page: allowance, used, reserved, remaining, reset date, ledger and policy editing.

The state machine and flow diagrams are in the [README](../../README.md#usage-accounting) and are not repeated here.

## Requirements

### Reservation and enforcement

- The API MUST estimate tokens as the counted input plus the requested maximum output (1,024 when unspecified), and MUST reserve that amount before calling the gateway.
- Reservation MUST be a single database transaction that claims the usage record and conditionally increments the period's `reservedTokens` only when `actualTokens + reservedTokens + estimate <= tokenLimit`. Concurrent requests MUST NOT be able to reserve beyond the limit.
- When the reservation does not fit, the API MUST return `429 QUOTA_EXCEEDED` with the limit, used, reserved, requested and remaining tokens and the reset date, and MUST NOT call the gateway.
- Quota MUST be enforced on the server. Token counts supplied by a client MUST NOT be trusted. The API computes its own estimate, and settlement uses provider-reported usage.
- Quota limits are an application concept. Gateway budgets MUST NOT be treated as equivalent to them.

### Reconciliation

- Reconciliation MUST run in a `finally` block after every reserved call, so a reservation is not left behind when the call throws.
- Reconciliation MUST be idempotent. A guarded status transition (`reserved` to `reconciling`) MUST ensure that concurrent or repeated reconciliations apply once.
- On success, the reservation MUST be released and the actual total tokens added. Input and output tokens MUST be stored separately, with their source (`provider-reported` or `estimated`). Actual usage above the reservation is recorded in full.
- On a definitive error, the whole reservation MUST be released and the record marked `failed`.
- Unknown final usage: on a timeout after dispatch, the record MUST be marked `timeout-ambiguous`, `QUOTA_TIMEOUT_CHARGE_RATIO` (default 0.5) of the reservation MUST be charged, the rest released, and the token source MUST be `estimated-timeout`. Timeouts MUST be identified by the typed error kind, never by parsing message text ([ADR-011](../knowledge/decisions/adr-011-typed-timeout-reconciliation-and-per-user-throttling.md)).
- A reservation still unreconciled after twice the API timeout plus 5 seconds MUST be marked `expired` and released by the scheduled sweeper. The sweeper MUST be safe to run on several instances at once.

### Idempotency

- `Idempotency-Key` MUST match `^[A-Za-z0-9._:-]{8,128}$`, otherwise the API returns `400`. Keys are scoped to the user.
- A key that was reconciled successfully MUST replay the stored response without calling the gateway. A key that is in progress MUST return `409 REQUEST_IN_PROGRESS`. A key that ended in `failed` or `timeout-ambiguous` MUST return `409 IDEMPOTENCY_KEY_REUSED`, so that a retry cannot make an uncharged call. The client then uses a new key.

### Periods and time

- Periods MUST follow UTC calendar months. Persisted timestamps MUST be UTC regardless of the database session time zone.
- The Usage page MUST show the allowance, used, reserved and remaining tokens, and the reset date.

### Rate limits

- Request-rate limits MUST be separate from token quotas. Per IP, the limits are 60 requests per minute and 20 per second, applied before authentication. Per user, the limit comes from the user's policy and applies to routes that call a model.
- A throttled request MUST return `429 RATE_LIMIT_EXCEEDED` with `Retry-After`. A replay of an already reconciled idempotency key MUST NOT consume a rate-limit unit.
- Rate-limit counters are held in process memory, so they apply per API instance.

## Acceptance criteria

| # | Criterion | Status | Evidence |
| :--- | :--- | :--- | :--- |
| 1 | A user has a quota policy and a monthly quota period. | ✅ Met | `getPolicy` (upsert with defaults), `getCurrentPeriodRecord` (one row per `(userId, periodStart)`) in [usage.service.ts](../../apps/api/src/usage/usage.service.ts). Tests: *should create default policy with 1,000,000 monthly tokens and 60 req/min if none exists*; integration: *handles concurrent first-of-month quota period and policy creation without P2002 conflict*. |
| 2 | Allowance, used, reserved, remaining and reset date are shown. | ✅ Met | `getStatus` returns them as distinct values and performs no writes. The page renders each ([usage.component.html](../../apps/web/src/app/pages/usage/usage.component.html)). Tests: *should return honest distinct values for used, reserved, remaining, and limit*, *should return active status and perform zero database writes…*; web: *should display distinct values for monthly allowance, used, reserved, and remaining*. |
| 3 | Each model request is recorded with an idempotent request ID. | ✅ Met | `UsageRecord` with unique `(userId, requestId)`; the claim is `INSERT … ON CONFLICT DO NOTHING`. Integration test: *executes 10 concurrent execute() calls with one key → exactly 1 provider call and 1 reservation*. |
| 4 | Quota is estimated and reserved before the gateway is called. | ✅ Met | `LlmExecutionService.execute` counts tokens, calls `reserveUsage`, and only the creator of the record calls the provider ([llm-execution.service.ts](../../apps/api/src/llm/llm-execution.service.ts)). Test: *executes full pipeline: trace -> reserve -> call gateway -> reconcile -> trace complete on success*. |
| 5 | Usage is reconciled against provider-reported usage after completion. | ✅ Met | `reconcileUsage` settles tokens, source and cost. Tests: *should reconcile successful response by updating actualTokens, releasing reservation, and computing cost*; *propagates provider-reported cost when returned by providersService*. |
| 6 | Failed requests, retries and timeouts are handled. | ✅ Met | Failure releases the reservation; timeouts charge the configured ratio; retries of failed or ambiguous keys return `409 IDEMPOTENCY_KEY_REUSED`. Tests: *should safely release reservation on failed or timed-out requests without charging actualTokens*, *should charge configured ratio on typed errorType="TIMEOUT" with no string parsing*, *should NOT treat an error containing "timed out" as a timeout when errorType is non-timeout*, *should charge 0 tokens when QUOTA_TIMEOUT_CHARGE_RATIO is 0*, *throws 409 ConflictException (IDEMPOTENCY_KEY_REUSED) on retry of a failed request…*. |
| 7 | Streaming disconnects are handled. | ⚠️ Partially met | Responses are not streamed, so there is no streaming path. An abandoned request is covered by the same mechanisms: reconciliation runs in `finally`, and the sweeper reclaims any reservation left behind (*should sweep stale reserved records, mark them expired, and release tokens*; integration: *releases a stale reservation exactly once across concurrent sweepers*). |
| 8 | Limits are enforced on the server. | ✅ Met | `reserveUsage` rejects with `429 QUOTA_EXCEEDED` before dispatch; the browser sends no token counts. Tests: *should reject reservation with 429 QUOTA_EXCEEDED when quota is exhausted*; *handles quota reservation failure (429) without attempting reconcile and marks trace rate_limited*. |
| 9 | Request-rate limits exist separately from monthly token limits. | ✅ Met | `IpThrottlerGuard` and `UserThrottlerGuard` in [app.module.ts](../../apps/api/src/app.module.ts); user limit read from `QuotaPolicy.requestRateLimit`. Tests: *uses dynamic limit from QuotaPolicy if set for the user*, *throws 429 RATE_LIMIT_EXCEEDED when storage reports isBlocked=true* ([user-throttler.guard.spec.ts](../../apps/api/src/common/guards/user-throttler.guard.spec.ts)); integration: *enforces per-user limit with 429 RATE_LIMIT_EXCEEDED when exceeded*, *limits two different users independently*. Counters are per instance ([ADR-011](../knowledge/decisions/adr-011-typed-timeout-reconciliation-and-per-user-throttling.md)). |
| 10 | Quota policy is configurable. | ✅ Met | `PUT /usage/policy` and `PUT /usage/policy/:userId` (admin), bounds 1,000 to 100,000,000 tokens and 1 to 10,000 requests per minute ([usage.dto.ts](../../apps/api/src/usage/dto/usage.dto.ts)); the Usage page edits the caller's own policy. Tests: *should update quota policy and active quota period limit*, *should update quota policy for existing target user*. |
| 11 | An admin view lists usage records and policies. | ⚠️ Partially met | Admins can read and change any user's policy through the API. The ledger endpoint and the Usage page show only the caller's own records, with no cross-user view. |
| 12 | Concurrent reservations cannot overspend. | ✅ Met | The conditional `UPDATE … WHERE actual + reserved + estimate <= limit` ([ADR-004](../knowledge/decisions/adr-004-atomic-quota-reservations.md)). Integration test: *executes 50 concurrent reserveUsage calls against a limit allowing 10 → exactly 10 succeed*; unit: *should reject second concurrent request when parallel reservations would collectively exceed quota*. |
| 13 | Reconciliation is idempotent. | ✅ Met | Guarded transition from `reserved`. Integration test: *executes 10 concurrent reconcileUsage calls for the same request → applies exactly once*; unit: *should be idempotent and not double-reconcile already completed records*. |
| 14 | A policy exists for requests with unknown final usage, and it is documented. | ✅ Met | Timeout charge ratio, `timeout-ambiguous` status and `estimated-timeout` source ([ADR-011](../knowledge/decisions/adr-011-typed-timeout-reconciliation-and-per-user-throttling.md)); gateway timeout kept below the API timeout so ambiguity is rare ([ADR-015](../knowledge/decisions/adr-015-health-probes-and-gateway-resilience.md)). Integration test: *round-trips timeout-ambiguous usage records through the ledger*. |
| 15 | Gateway budgets are not assumed to equal application quotas. | ✅ Met | Quotas live in `quota_periods`. [config.yaml](../../infra/litellm/config.yaml) defines no budget. |
| 16 | Input and output tokens are distinguished. | ✅ Met | `inputTokens` and `outputTokens` columns; the ledger returns both and a total. Test: *should expose hyphenated API values, numeric cost and the operation* (ledger). |
| 17 | Timestamps are UTC and the period boundary is defined. | ✅ Met | `getUtcMonthBounds`; `createdAt` written with `NOW() AT TIME ZONE 'UTC'`. Tests: *should calculate accurate UTC month boundaries*; integration: *stores UTC createdAt immune to session TimeZone and sweeps correctly under Asia/Baghdad*. |
| 18 | Token counts sent by the browser are never trusted. | ✅ Met | No request DTO accepts token counts; the estimate is computed server-side with the tokenizer ([token-counter.service.ts](../../apps/api/src/tokens/token-counter.service.ts)). `POST /tokens/estimate` is informational and does not feed enforcement. |
| 19 | Period rollover works. | ⚠️ Partially met | A new period row is created on first use in a new UTC month, with the limit copied from the policy, and the sweeper closes periods past `periodEnd` (`closeExpiredQuotaPeriods`). Reconciliation looks up the period by the record's creation month. The tests cover month boundaries and concurrent first-of-month creation, but none advances the clock across a boundary or exercises period closing. |
| 20 | Rate limits and token limits are enforced independently. | ✅ Met | Different mechanisms, different error codes (`RATE_LIMIT_EXCEEDED`, `QUOTA_EXCEEDED`). Tests: *does not consume an extra rate-limit unit on an idempotent replay*; quota tests above. |
| 21 | Usage is auditable by user and period. | ⚠️ Partially met | Every call has a ledger row with `createdAt`, and period rows keep limit, reserved and actual tokens per user and month, so the data supports an audit. The API exposes only the current period's totals and the newest records (up to 100, no offset or period filter). |
| 22 | The UI shows remaining quota and the reset date. | ✅ Met | "Remaining Allowance" card and "Resets on" line in [usage.component.html](../../apps/web/src/app/pages/usage/usage.component.html); the `QUOTA_EXCEEDED` response carries `resetDate`. Journey: [usage.flow.spec.ts](../../e2e/flows/usage.flow.spec.ts). |
| 23 | Idempotency keys are validated and scoped per user. | ✅ Met | [idempotency-key.decorator.ts](../../apps/api/src/common/decorators/idempotency-key.decorator.ts); unique `(userId, requestId)`. Tests: *validates Idempotency-Key header against ^[A-Za-z0-9._:-]{8,128}$ (otherwise 400)* (integration); *scopes idempotency to the user so user B does not collide with user A*. |

## Tests

- API unit: [usage.service.spec.ts](../../apps/api/src/usage/usage.service.spec.ts), [usage.controller.spec.ts](../../apps/api/src/usage/usage.controller.spec.ts), [llm-execution.service.spec.ts](../../apps/api/src/llm/llm-execution.service.spec.ts), [user-throttler.guard.spec.ts](../../apps/api/src/common/guards/user-throttler.guard.spec.ts), [usage.enums.spec.ts](../../apps/api/src/common/enums/usage.enums.spec.ts)
- API integration (concurrency, sweeper, UTC, idempotency, per-user rate limits, typed columns): [app.integration.spec.ts](../../apps/api/src/app.integration.spec.ts), groups *Concurrency & Quota Management*, *Client Idempotency Keys and Deduping*, *Per-User Rate Limiting & Idempotency Replay*, *Typed columns, decimal cost and usage operation*
- Web: [usage.component.spec.ts](../../apps/web/src/app/pages/usage/usage.component.spec.ts), [usage.service.spec.ts](../../apps/web/src/app/services/usage.service.spec.ts)
- Journey: [usage.flow.spec.ts](../../e2e/flows/usage.flow.spec.ts)

## Related

- Concept: [Quota governance](../knowledge/concepts/quota-governance.md)
- ADRs: [ADR-004](../knowledge/decisions/adr-004-atomic-quota-reservations.md), [ADR-011](../knowledge/decisions/adr-011-typed-timeout-reconciliation-and-per-user-throttling.md), [ADR-015](../knowledge/decisions/adr-015-health-probes-and-gateway-resilience.md), [ADR-019](../knowledge/decisions/adr-019-typed-columns-and-decimal-cost.md)
- README: [Usage accounting](../../README.md#usage-accounting), [How a model call works](../../README.md#how-a-model-call-works)
- Previous: [SPEC-13](./13-conversations-and-compaction.md). Next: [SPEC-15](./15-gateway-and-observability.md)
- Index: [README](./README.md)
