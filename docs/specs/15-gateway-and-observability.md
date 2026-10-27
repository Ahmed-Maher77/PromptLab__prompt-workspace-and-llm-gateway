---
type: spec
id: SPEC-15
title: "Gateway and Observability"
description: "LiteLLM as the single provider gateway, the model catalog, gateway resilience, tracing, the trace viewer and telemetry redaction"
status: partially-implemented
domain: "gateway"
last_updated: "2026-10-27"
---

# SPEC-15: Gateway and Observability

## Summary

All provider traffic goes through a separate LiteLLM proxy that holds the provider credentials and applies timeouts, retries and cooldowns. The API reads the gateway's model catalog for context limits and prices, classifies gateway errors by HTTP status, and traces every model call with OpenTelemetry. Traces appear in an admin-only viewer and can be exported to an OTLP collector and to Langfuse. Secrets are redacted before anything is buffered or exported.

## Scope

- Gateway configuration: models, timeout, retry policy, cooldowns ([config.yaml](../../infra/litellm/config.yaml)). Three models are configured: `gpt-4o-mini`, `gpt-4o` and `claude-3-5-sonnet`. Others are added in that file.
- Model list, model catalog and cost lookup.
- Structural classification of gateway errors.
- Tracing of the five model operations: `playground.execute`, `comparison.slot`, `conversation.turn`, `compaction.preview`, `gateway.request`. Spans cover `quota.reserve`, `litellm.chat_completion` and `quota.reconcile`.
- Trace list and detail view, with filters.
- Optional export to an OTLP collector and to Langfuse.
- Redaction of telemetry.
- Request-rate limiting configuration (see [SPEC-14](./14-quotas-and-usage.md)).

## Requirements

- The API MUST reach providers only through the gateway, using its OpenAI-compatible API. Provider credentials MUST be configured in the gateway and MUST NOT be sent to the browser.
- The gateway's per-attempt timeout MUST be shorter than `LLM_REQUEST_TIMEOUT_MS`. The gateway MUST NOT retry timeouts, and MUST NOT fall back to a different model ([ADR-015](../knowledge/decisions/adr-015-health-probes-and-gateway-resilience.md)).
- Model availability MUST be read from the gateway. The product MUST NOT claim support for a provider or model that the gateway does not serve.
- Context limits and prices MUST come from the gateway catalog, cached with a TTL, with one shared in-flight fetch, failure backoff and stale-while-error behaviour. An unknown model MUST be reported as unknown, and its cost as `null` ([ADR-012](../knowledge/decisions/adr-012-model-catalog-and-structural-error-classification.md)).
- Gateway errors MUST be classified by HTTP status first, then by structured error type or code. Message text MUST NOT be pattern-matched.
- Each model call MUST create one trace. It MUST close all of its spans, including on error, and MUST record one of the statuses `success`, `error` or `rate_limited`. A provider rate limit, and a PromptLab quota or rate rejection, MUST be `rate_limited`.
- The trace context MUST be sent to the gateway as a W3C `traceparent` header.
- Trace and span IDs MUST be cryptographically random W3C IDs.
- Telemetry MUST be redacted before it is buffered or exported. Numeric token metrics MUST be preserved.
- Telemetry failures MUST NOT fail or delay a request. Queued spans MUST be flushed on shutdown.
- Trace list and detail endpoints MUST require the `admin` role.
- Traces MUST NOT capture prompt bodies or transcripts.

## Acceptance criteria

| # | Criterion | Status | Evidence |
| :--- | :--- | :--- | :--- |
| 1 | LiteLLM is the central provider gateway. | ✅ Met | [providers.service.ts](../../apps/api/src/providers/providers.service.ts) calls `/v1/chat/completions` and `/v1/models` on `LITELLM_GATEWAY_URL`; Compose runs the proxy with an image pinned by digest ([docker-compose.yml](../../docker-compose.yml)); [ADR-002](../knowledge/decisions/adr-002-litellm-proxy-gateway.md), [ADR-014](../knowledge/decisions/adr-014-containerized-stack.md). |
| 2 | Several providers and models are supported through gateway configuration. | ✅ Met | OpenAI and Anthropic models in [config.yaml](../../infra/litellm/config.yaml); the API lists whatever the gateway serves (`GET /api/providers/models`). Tests: *should return gateway models resolving provider from catalog*; *reports configured providers dynamically from catalog models* ([model-catalog.service.spec.ts](../../apps/api/src/providers/model-catalog.service.spec.ts)). |
| 3 | No provider or model is claimed unless it is configured. | ✅ Met | Model lists come from the gateway, not from a constant. The health payload reports configured providers and `missing_provider_credentials` ([health.service.ts](../../apps/api/src/health/health.service.ts)); test: *should mark provider readiness as missing_provider_credentials when no keys are set*. Automated tests use a stubbed gateway, so live provider calls are not covered by them. |
| 4 | Correlation and request IDs propagate across the frontend, API, gateway and telemetry. | ⚠️ Partially met | The trace ID is sent to the gateway (`traceparent`, `x-litellm-trace-id`), recorded on the trace, stored with the usage record's response and returned to the client as `traceId`. The usage request ID (the idempotency key, or a generated one) is sent as `x-request-id` and stored on the trace. The HTTP `X-Request-Id` that middleware assigns to each request is echoed on responses and error bodies but is not attached to traces or sent to the gateway, and the web app does not generate one. No test asserts the headers sent to the gateway. Code: [providers.service.ts](../../apps/api/src/providers/providers.service.ts), [request-id.middleware.ts](../../apps/api/src/common/middleware/request-id.middleware.ts). |
| 5 | API operations and provider calls are instrumented with OpenTelemetry. | ⚠️ Partially met | The five model operations are real OpenTelemetry traces with child spans for reservation, the gateway call and reconciliation ([observability.service.ts](../../apps/api/src/observability/observability.service.ts), [ADR-017](../knowledge/decisions/adr-017-opentelemetry-sdk-tracing.md)). Other routes (CRUD, health) and database calls are not traced. Test: *exports the root and child spans with the IDs used in the traceparent*. |
| 6 | Langfuse export is configurable. | ✅ Met | Enabled when both Langfuse keys are set; spans go through its OTLP endpoint with `gen_ai.*` attributes. Tests: *creates one batching exporter per configured backend*, *normalises the OTLP and Langfuse URLs* ([otel-tracing.ts](../../apps/api/src/observability/otel-tracing.ts)). Export has been verified against an in-memory exporter, not a live collector or Langfuse instance. |
| 7 | A request and trace list and detail view exists. | ✅ Met | `GET /api/observability/traces`, `GET /api/observability/traces/:traceId` (admin) and the Observability page with status, operation and model filters and a span waterfall ([observability.component.ts](../../apps/web/src/app/pages/observability/observability.component.ts)). Tests: *should select a trace and open the waterfall drawer*, *filters traces by status and operation*; journey [observability.flow.spec.ts](../../e2e/flows/observability.flow.spec.ts). |
| 8 | Duration, status, provider and model, token usage, errors and cost are captured. | ✅ Met | `TraceRecord` fields ([observability.types.ts](../../apps/api/src/observability/observability.types.ts)); cost is `null` when unknown. Test: *propagates provider-reported cost…*, *falls back to modelCatalog.calculateCost…* ([llm-execution.service.spec.ts](../../apps/api/src/llm/llm-execution.service.spec.ts)). |
| 9 | Request-rate limits are configured. | ✅ Met | Per-IP and per-user throttling ([app.module.ts](../../apps/api/src/app.module.ts)); see [SPEC-14](./14-quotas-and-usage.md), criterion 9. |
| 10 | Gateway-level budget configuration exists. | ❌ Not met | [config.yaml](../../infra/litellm/config.yaml) sets no budget and no gateway rate limit. Monthly token quotas are enforced by the API instead, which was the intended design ([SPEC-14](./14-quotas-and-usage.md)). |
| 11 | Secrets are redacted and sensitive prompt capture is minimised. | ✅ Met | `sanitizeTelemetry` is applied to the buffered trace and to span attributes before export ([redaction.util.ts](../../apps/api/src/observability/redaction.util.ts), [ADR-006](../knowledge/decisions/adr-006-privacy-redaction-engine.md)). Traces carry IDs, model, status, tokens and errors, not prompt text. Tests: *sanitizes API keys, authorization headers, and bearer tokens in metadata and spans*, *redacts secrets before they reach the exporter*, *preserves numeric token metrics…*. API logs are not passed through the redactor; no code path logs credentials. |
| 12 | A trace can be followed from the API to the gateway call, as far as instrumentation allows. | ✅ Met | Root span, child spans and the forwarded `traceparent` share one trace ID; the viewer shows the span tree. See criteria 4 and 5 for the limits. |
| 13 | Provider errors are traceable without leaking credentials. | ✅ Met | Gateway authentication failures return a fixed message plus a configuration hint instead of upstream text; the trace records an error code and message. Tests: the *Structural Gateway Error Classification* group, including *HTTP 500 mentioning "api_key" MUST NOT be classified as auth*. |
| 14 | Rate-limit responses are handled in the UI. | ✅ Met | `toApiErrorMessage` maps `429` using `Retry-After` ([api-error.util.ts](../../apps/web/src/app/utils/api-error.util.ts)). Tests: *maps 429 using Retry-After seconds when present* ([api-error.util.spec.ts](../../apps/web/src/app/utils/api-error.util.spec.ts)). |
| 15 | Telemetry failure does not break request execution. | ✅ Met | Batch export is asynchronous and bounded; errors are logged. Tests: *never throws on the request path when the exporter fails*, *flushes queued spans on application shutdown*. |
| 16 | An unavailable provider or model returns a clear error. | ✅ Met | An unreachable gateway returns `gateway_unreachable` with a hint to start it; credential, quota, rate-limit, timeout and invalid-request cases have their own types. Tests: *should return explicit provider_auth_error when upstream provider credentials are unconfigured* and the classification cases for 401, 403, 408, 422, 429, 5xx. An unknown model is reported with the gateway's own message. The unreachable-gateway branch of `executeChatCompletion` has no dedicated test; unreachable-gateway detection is tested in the health service (*should mark gateway as unreachable when fetch fails*). |
| 17 | The observability view uses real trace data. | ✅ Met | The page reads the API's trace buffer, which is filled only by real executions; there is no sample data. The buffer holds the newest 500 traces in memory and is lost on restart ([observability.service.ts](../../apps/api/src/observability/observability.service.ts)). |
| 18 | Gateway controls are documented and tested. | ✅ Met | Documented in comments in [config.yaml](../../infra/litellm/config.yaml) and [ADR-015](../knowledge/decisions/adr-015-health-probes-and-gateway-resilience.md). Tests: *uses a per-attempt request_timeout shorter than the API request timeout*, *never retries timeouts*, *does not retry errors a retry cannot fix*, *retries transient upstream failures*, *keeps every model the gateway serves on an environment-provided key* ([gateway-config.spec.ts](../../apps/api/src/providers/gateway-config.spec.ts)). |
| 19 | Provider keys remain server-side. | ✅ Met | Keys are configured for the gateway ([docker-compose.yml](../../docker-compose.yml), [config.yaml](../../infra/litellm/config.yaml) reads `os.environ/…`). The API code does not read them; it authenticates with `LITELLM_MASTER_KEY`. The browser holds only the caller's PromptLab credential. The `api` Compose service loads the whole `.env` through `env_file`, so provider keys set in that file are present in its environment even though the code does not use them. |
| 20 | Model context limits and prices come from the gateway, with safe behaviour when it is unavailable. | ✅ Met | [model-catalog.service.ts](../../apps/api/src/providers/model-catalog.service.ts). Tests: *shares one in-flight fetch across concurrent cache misses*, *serves stale last-good catalog when gateway encounters an error after initial success*, *falls back to explicit unknown model default when gateway is unreachable and no cache exists*. |
| 21 | Trace statuses distinguish rate limiting from errors, and all spans are closed. | ✅ Met | Tests: *records rate_limited as the trace status*, *closes and flags child spans left open when the trace completes* ([observability.service.spec.ts](../../apps/api/src/observability/observability.service.spec.ts)); *handles quota reservation failure (429)… marks trace rate_limited*, *keeps other provider failures as error, not rate_limited*. |

## Tests

- Gateway and catalog: [providers.service.spec.ts](../../apps/api/src/providers/providers.service.spec.ts), [model-catalog.service.spec.ts](../../apps/api/src/providers/model-catalog.service.spec.ts), [gateway-config.spec.ts](../../apps/api/src/providers/gateway-config.spec.ts), [providers.controller.spec.ts](../../apps/api/src/providers/providers.controller.spec.ts)
- Execution pipeline: [llm-execution.service.spec.ts](../../apps/api/src/llm/llm-execution.service.spec.ts)
- Tracing and redaction: [observability.service.spec.ts](../../apps/api/src/observability/observability.service.spec.ts), [redaction.util.spec.ts](../../apps/api/src/observability/redaction.util.spec.ts), [observability.controller.spec.ts](../../apps/api/src/observability/observability.controller.spec.ts)
- Tokenizer and estimate endpoint: [token-counter.service.spec.ts](../../apps/api/src/tokens/token-counter.service.spec.ts), [tokens.controller.spec.ts](../../apps/api/src/tokens/tokens.controller.spec.ts)
- Integration (catalog-driven budget and cost, error classification, token estimate): [app.integration.spec.ts](../../apps/api/src/app.integration.spec.ts), groups *Model Catalog & Gateway Error Classification*, *Model-Aware Token Counter*
- Web: [observability.component.spec.ts](../../apps/web/src/app/pages/observability/observability.component.spec.ts), [observability.service.spec.ts](../../apps/web/src/app/services/observability.service.spec.ts), [api-error.util.spec.ts](../../apps/web/src/app/utils/api-error.util.spec.ts)
- Journey: [observability.flow.spec.ts](../../e2e/flows/observability.flow.spec.ts)

## Related

- Concept: [Observability and redaction](../knowledge/concepts/observability-and-redaction.md)
- ADRs: [ADR-002](../knowledge/decisions/adr-002-litellm-proxy-gateway.md), [ADR-006](../knowledge/decisions/adr-006-privacy-redaction-engine.md), [ADR-012](../knowledge/decisions/adr-012-model-catalog-and-structural-error-classification.md), [ADR-013](../knowledge/decisions/adr-013-model-aware-token-counter.md), [ADR-015](../knowledge/decisions/adr-015-health-probes-and-gateway-resilience.md), [ADR-017](../knowledge/decisions/adr-017-opentelemetry-sdk-tracing.md)
- README: [Observability](../../README.md#observability), [Configuration](../../README.md#configuration)
- Operations guide: [observability.md](../observability.md)
- Previous: [SPEC-14](./14-quotas-and-usage.md). Next: [SPEC-16](./16-hardening-and-delivery.md)
- Index: [README](./README.md)
