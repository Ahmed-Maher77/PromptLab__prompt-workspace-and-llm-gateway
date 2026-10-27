# PromptLab — Known Limitations

What the proof of concept deliberately does not do, and where it would need more work before production. Each item states the current behaviour and what would change it.

---

## 1. Identity and access

- **Built-in credentials only.** Callers authenticate with an API key from `AUTH_API_KEYS` or an HS256 JWT signed with `AUTH_JWT_SECRET`. Two roles exist: `admin` and `user`, and data is scoped to its owner. There is no external identity provider, no login sessions, no refresh tokens and no key rotation API.
- **Browser storage.** The web app keeps the signed-in key or token in `localStorage`, so it is exposed to any script running on the page. A production deployment would use an identity provider with short-lived tokens or HTTP-only cookies.
- **No cross-user views.** Admins can change any user's quota policy through the API, but the usage ledger and the Usage page only show the caller's own records.

## 2. Scaling to several API instances

- **Rate limits are per instance.** Throttling uses the in-memory store of `@nestjs/throttler`. With several API replicas each enforces the limits separately. A shared store (e.g. Redis) would be needed for global limits. Quotas and idempotency are not affected: they are enforced in PostgreSQL and safe across instances.
- **Per-instance caches.** The recent-trace buffer behind the Observability page (500 traces, lost on restart) and the model-catalog cache are held in memory per instance. Traces are durable only when exported to an OTLP collector or Langfuse.
- **Migrations on start.** The API container runs `prisma migrate deploy` on start. That is correct for a single replica. Several replicas should run migrations as a separate deployment step.

## 3. Model calls

- **No streaming.** Responses are returned when the model finishes, so a request can take up to `LLM_REQUEST_TIMEOUT_MS` (30 s by default). Streaming would need server-sent events and usage taken from the final chunk.
- **Model identifiers.** IDs are validated for format, not against an allow-list. A model the gateway does not serve fails with a provider error after the quota reservation, which is then reconciled as failed.
- **Gateway budgets are not used.** Monthly quotas are enforced by the API. LiteLLM's own budgets and virtual keys are not configured.

## 4. Cost accuracy

- **Estimates.** Cost comes from the gateway's response-cost header when present, otherwise from the per-token prices in the gateway's model catalog. Models without catalog prices have no cost (`null`). Provider discounts (caching, batch, volume) are not reflected, and figures are estimates, not billing data.

## 5. Ambiguous timeouts

- When a model call times out after it was sent, the API cannot know whether the provider processed it. The record is marked `timeout-ambiguous` and charged `QUOTA_TIMEOUT_CHARGE_RATIO` (default 0.5) of the reserved tokens. Reservations that are never reconciled are released by a sweeper that runs every minute. There is no reconciliation against provider billing.

## 6. Conversations and comparisons

- **Manual compaction.** Compaction is always previewed and approved by the user. There is no automatic threshold; when a conversation outgrows its budget, older turns are dropped from the prompt (the full history stays stored).
- **Saved comparisons.** A saved comparison stores the prompt versions, models, outputs, metrics and ratings, but not each slot's temperature and max tokens or inline template text, so a rerun may not be identical. The API does not reject comparison inputs that leave template variables unresolved; the web page does.

## 7. Lists and history

- `GET /prompts`, `/experiments` and `/conversations` support `limit`/`offset` with deterministic ordering, and return plain arrays without totals. The usage ledger returns the newest records only (up to 100) and has no offset or period filter.

## 8. Telemetry

- Export uses the OpenTelemetry SDK (batched OTLP/HTTP) to a collector and to Langfuse. It is covered by unit tests with an in-memory exporter but has not been verified against a live collector or Langfuse instance.

## 9. Operations

- **Gateway secrets.** Provider keys reach LiteLLM through environment variables. A production deployment would inject them from a secret manager.
- **No end-to-end check of a fresh setup.** CI applies every migration to an empty PostgreSQL database, runs the integration suite and builds both Docker images, but it does not start the Compose stack or run the Playwright flows.

---

## Summary

| Area | Status | Needed for production |
| :--- | :--- | :--- |
| Prompt Studio and versioning | Implemented and tested | — |
| Model comparison | Implemented and tested | Store generation settings with saved comparisons |
| Conversations and compaction | Implemented and tested | Optional automatic compaction policy |
| Quotas, idempotency, usage ledger | Implemented, tested against PostgreSQL | Shared rate-limit store for several instances |
| Authentication and roles | API keys and JWT, two roles | Identity provider, sessions, key rotation |
| Telemetry export | Implemented, unit tested | Validation against a live collector / Langfuse |
| Cost | Gateway-reported or catalog estimate | Provider billing reconciliation |
| Database migrations | Versioned Prisma migrations | Separate migration step for several replicas |
