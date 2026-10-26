---
type: Decision
title: "ADR-012: Dynamic Model Catalog, Upstream Cost Authority, and Structural Error Classification"
description: "Decision to establish LiteLLM gateway as the authoritative source of truth for model metadata, pricing, provider readiness, and structural error classification"
status: accepted
date: "2026-10-26"
decision_makers: ["PromptLab Core Team"]
---

# ADR-012: Dynamic Model Catalog, Upstream Cost Authority, and Structural Error Classification

## Context
In PromptLab Phase 3 and earlier, several core architectural concerns relied on heuristic approximations, static configurations, or API-process assumptions:

1. **Static Pricing and Context Limits (COST-01):**
   - Context limits were hardcoded in `apps/api/src/conversations/context-policy.ts` (`KNOWN_MODEL_CONTEXT_LIMITS`).
   - Token pricing rates were hardcoded in `apps/api/src/experiments/cost-calculator.ts` (`KNOWN_MODEL_PRICING`).
   - Whenever upstream providers updated model context windows, input/output token pricing, or added new models, PromptLab code required manual edits and redeployment.

2. **Fragile Substring Provider Detection:**
   - `providers.service.ts` determined provider ownership using string prefix checks (`model.startsWith('gpt')` or `model.startsWith('claude')`), breaking custom or fine-tuned model identifiers.

3. **Decoupled Provider Health Credentials:**
   - `HealthService` checked whether API-process environment variables (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`) existed, even though LiteLLM proxy gateway is the entity that maintains upstream credentials and manages provider access.

4. **Ignored Upstream Reported Costs:**
   - LiteLLM returns exact token execution costs computed upstream via the `x-litellm-response-cost` response header. PromptLab discarded this telemetry and computed costs using static offline rate multiplication.

5. **Heuristic Error Substring Matching (ERRCLS-01):**
   - `providers.service.ts` `parseGatewayError()` classified errors by searching substrings in the message body (`message.includes('quota')`, `message.includes('api_key')`, `message.includes('authentication')`).
   - Consequently, an internal server error (HTTP 500) from an upstream database or reverse proxy that mentioned the word "quota" in its diagnostic message was falsely classified as an account quota exhaustion (HTTP 429), misleading users and triggering incorrect retry/recovery behaviors.

---

## Alternatives Considered

1. **Keep Static Tables with Periodic Sync Scripts:**
   - Run a CLI script to dump LiteLLM config into static JSON/TypeScript files at build time.
   - *Downside:* Fails when gateway models or rate cards update dynamically without restarting or rebuilding the API service.

2. **Query LiteLLM `/model/info` on Every Turn:**
   - Issue an HTTP request to LiteLLM's `/model/info` endpoint during every prompt run, context inspection, and message dispatch.
   - *Downside:* Adds unnecessary network roundtrips and latency to every user interaction, introducing a critical dependency and potential bottleneck.

3. **Injectable `ModelCatalogService` with TTL Single-Flight Cache and Structural Error Classification (Selected):**
   - Query LiteLLM `GET /model/info` once and cache the catalog in memory with a configurable TTL (`MODEL_CATALOG_TTL_MS`, default 300,000ms / 5 minutes).
   - Share concurrent in-flight fetch promises to prevent thundering-herd issues on cache expiry.
   - Fall back to the last known good catalog if the gateway becomes temporarily unreachable, or an explicit conservative unknown-model default (`isUnknownDefault: true`) if no catalog has ever been fetched.
   - Respect upstream `x-litellm-response-cost` header as the primary authority, using catalog rates only for pre-flight reservation estimates or fallback.
   - Inspect HTTP status codes first for error classification (401/403 -> auth, 429 -> quota, 408/504 -> timeout, 400/422 -> invalid request, 5xx -> provider error), followed by LiteLLM structured error codes/types, completely eliminating substring matching.

---

## Decision

We chose **Alternative 3: Injectable ModelCatalogService with TTL Single-Flight Cache, Upstream Cost Authority, and Structural Error Classification**.

### Architectural Rules

1. **Authoritative Model Catalog (`ModelCatalogService`):**
   - `ModelCatalogService` calls LiteLLM `GET /model/info` with `LITELLM_GATEWAY_URL` (with fallback to `LITELLM_BASE_URL`) and `LITELLM_MASTER_KEY`.
   - Maps gateway responses into normalized entries: `{ modelId, provider, maxInputTokens, maxOutputTokens, inputCostPerToken, outputCostPerToken, isUnknownDefault }`.
   - Note on LiteLLM metadata: when `max_input_tokens` is omitted in LiteLLM `/model/info`, falling back to `max_tokens` is conservative because in LiteLLM `max_tokens` often denotes the model's maximum output limit rather than full context window.
   - Concurrent misses share a single in-flight fetch promise (`inFlightFetch`). The shared promise applies the fallback handling internally, ensuring concurrent callers never observe an unhandled promise rejection.
   - Cache TTL is validated and configured via `MODEL_CATALOG_TTL_MS` (positive integer, default 300,000ms).
   - When the gateway is unreachable:
     - Returns stale cached catalog if available, logging a warning.
     - Enforces a failure backoff window via `MODEL_CATALOG_FAILURE_BACKOFF_MS` (default 30,000ms) to avoid hammering an offline gateway.
     - If no cache exists, returns an explicit fallback model with conservative limits (4,096 total window, 1,024 target output, 3,072 max input budget) and null costs, marked with `isUnknownDefault: true`. Never hardcodes pricing.

2. **Pure Context Assembly & Conservative Input Caps:**
   - `assembleConversationContext(conv, proposedInput, policy)` remains pure, synchronous, and side-effect free.
   - Callers asynchronously resolve `policy = await modelCatalog.getModelContextPolicy(model)` and pass it into `assembleConversationContext`.
   - The maximum input budget cap subtracts the model's *maximum* configured output tokens (`maxInputTokens - maxOutputTokens`, e.g. subtracting 16,384 for `gpt-4o-mini`), which is deliberately conservative compared to subtracting the turn's specific requested `maxTokens` (e.g. 1,024).
   - Context policy helper functions accept strictly typed catalog entries or policies; string model names are rejected at compile time.

3. **Cost Authority & Attribution:**
   - When LiteLLM responds with the `x-litellm-response-cost` header, that value is authoritative and recorded as `costSource: 'provider-reported'`.
   - When the header is missing or during pre-flight quota reservation, costs are calculated via `modelCatalog.calculateCost()` and attributed as `costSource: 'catalog-estimate'`.
   - Both `cost` and `costSource` are persisted on usage records (`UsageRecord.estimatedCost` and `UsageRecord.responseBody.costSource`) and propagated through distributed trace spans.

4. **Gateway-Driven Provider Health:**
   - `HealthService` queries `await this.modelCatalog.getConfiguredProviders()` instead of inspecting API-process `*_API_KEY` environment variables.
   - Gateway configuration in `infra/litellm/config.yaml` explicitly includes all supported models (`gpt-4o-mini`, `gpt-4o`, `claude-3-5-sonnet`).

5. **Structural Error Classification (ERRCLS-01):**
   - `parseGatewayError()` inspects HTTP status codes first:
     - `401` or `403` -> `authentication_error`
     - `429` -> `quota_exceeded`
     - `408` or `504` -> `timeout`
     - `400` or `422` -> `invalid_request`
     - `5xx` -> `provider_error`
   - If HTTP status is not conclusive, inspects structured `error.type` and `error.code` returned in the JSON payload (e.g. `insufficient_quota`, `invalid_api_key`).
   - Zero substring search is performed against `message` strings. A 500 error whose message contains "quota" or "api_key" is classified strictly as `provider_error` with `upstreamStatus: 500`.
   - `upstreamStatus` is preserved across completion results, error exceptions, usage records, and trace metadata.

---

## Consequences

### Positive
- Model additions and pricing adjustments in LiteLLM gateway automatically reflect in PromptLab without code changes or redeployments.
- Accurate financial accounting by capturing real provider-reported execution costs via `x-litellm-response-cost`.
- Elimination of false-positive quota and auth errors caused by naive message text searches.
- Decoupling of API runtime process from provider credentials; credentials reside exclusively within LiteLLM gateway configuration.

### Negative / Trade-Offs
- Startup or first-turn dependency on LiteLLM gateway `/model/info` endpoint (mitigated by stale-cache fallback and conservative unknown-model defaults).
- Requires mock HTTP responses for `/model/info` and `/chat/completions` during integration and e2e testing.
