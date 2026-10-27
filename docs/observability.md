# Observability & Distributed Tracing Guide (Phase 5)

## 1. Overview
PromptLab Phase 5 introduces unified, end-to-end distributed tracing across all LLM operations:
- **Playground Executions (`playground.execute`)**
- **Side-by-Side Comparison Runs (`comparison.slot`)**
- **Conversation Turns (`conversation.turn`)**
- **Compaction Previews (`compaction.preview`)**
- **Direct Gateway Requests (`gateway.request`)**

Tracing implements the W3C TraceContext standard (`traceparent` header `00-{traceId}-{spanId}-01`), propagates correlation identifiers to the LiteLLM Gateway (`x-litellm-trace-id`, `x-request-id`), supports optional OpenTelemetry (OTLP/HTTP) collectors, and integrates with Langfuse for generative AI observability.

### Instrumentation: OpenTelemetry SDK
PromptLab builds its traces with the OpenTelemetry SDK (`@opentelemetry/sdk-trace-base`) and exports them with the official OTLP/HTTP exporter (see [ADR-017](knowledge/decisions/adr-017-opentelemetry-sdk-tracing.md)):
- Every LLM operation is a real OTel trace. Trace and span IDs are W3C-compliant (32 and 16 hex characters), cryptographically random and never all zeros.
- Finished spans go through a `BatchSpanProcessor` per backend, so export is batched, bounded (queue of 2,048 spans) and off the request path.
- Langfuse receives the same spans through its OTLP endpoint (`/api/public/otel/v1/traces`). The root span carries `gen_ai.*` attributes (model, provider, input/output tokens), `user.id` and the estimated cost.
- Queued spans are flushed on graceful shutdown.
- A redacted copy of the most recent 500 traces is kept in memory for the Observability page.

---

## 2. Architecture & Span Hierarchy

Each LLM execution creates a root trace and child spans capturing specific stages of the lifecycle:

```mermaid
graph TD
    Root["Root Span<br/>(playground.execute | comparison.slot | conversation.turn)"]
    S1["1. [quota.reserve]<br/>Atomic reservation against monthly token budget"]
    S2["2. [litellm.chat_completion]<br/>Upstream call to LiteLLM Gateway / configured LLM provider"]
    S3["3. [quota.reconcile]<br/>Reconciles actual tokens against reservation in usage ledger"]
    S4["4. [evaluations.criteria]<br/>(Comparison experiments) Regex/automated criteria checks"]

    Root --> S1
    Root --> S2
    Root --> S3
    Root --> S4
```

### Trace Context Propagation
When invoking LiteLLM Gateway (`ProvidersService.executeChatCompletion`), PromptLab injects:
- `traceparent: 00-{traceId}-{spanId}-01` (W3C TraceContext)
- `x-litellm-trace-id: {traceId}` (Native LiteLLM upstream correlation)
- `x-request-id: {requestId}` (Audit and quota ledger correlation)

---

## 3. Configuration & Environment Variables

Telemetry is enabled by default with local in-memory storage (ring buffer of up to 500 recent traces). External collectors are completely optional; if an external collector or network connection is unavailable, telemetry failures are caught and logged in the background and will **never** interrupt or fail user prompt executions or quota operations.

| Variable | Description | Default |
| :--- | :--- | :--- |
| `ENABLE_TELEMETRY` | Master switch to enable (`true`) or disable (`false`) all tracing. | `true` |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | OpenTelemetry Collector OTLP/HTTP endpoint, with or without the `/v1/traces` suffix (e.g. `http://localhost:4318`). | *(Unset / local buffer only)* |
| `LANGFUSE_PUBLIC_KEY` | Langfuse public API key (e.g. `pk-lf-...`). | *(Unset)* |
| `LANGFUSE_SECRET_KEY` | Langfuse secret API key (e.g. `sk-lf-...`). | *(Unset)* |
| `LANGFUSE_HOST` / `LANGFUSE_BASEURL` | Langfuse base URL (e.g. `https://cloud.langfuse.com` or a self-hosted instance). Export to Langfuse is enabled only when both keys are set. | `http://localhost:3001` |

---

## 4. Privacy, Security & Access Controls

PromptLab strictly enforces client and server-side secret scrubbing before traces are recorded or exported:
1. **Header and Secret Key Redaction:** Any key matching `/api[_-]?key/i`, `/secret/i`, `/auth(orization)?/i`, `/bearer/i`, `/password/i`, `/credential/i`, or auth token patterns has its value replaced with `[REDACTED]`.
2. **Raw Value Pattern Masking:** Strings matching `Bearer <token>`, `sk-...`, or `pk-...` are dynamically scrubbed and replaced with `[REDACTED_BEARER]` or `[REDACTED_API_KEY]`.
3. **Protection of Numeric Metrics:** Essential token count metrics (`inputTokens`, `outputTokens`, `totalTokens`, `promptTokens`, `completionTokens`, `reservedTokens`, `maxTokens`) and numeric properties are explicitly exempted from broad token-key redaction.
4. **No Prompt Payload Leaks:** Upstream provider API keys configured in LiteLLM are never forwarded into client-accessible spans. Traces retain operational metadata (IDs, models, latency, status, criteria results) without storing large prompt bodies or raw conversation transcripts in the trace record.
5. **Access control:** `GET /api/observability/traces`, `GET /api/observability/traces/:traceId` and `POST /api/observability/clear` require the `admin` role. `GET /api/observability/status` is available to any authenticated user.
6. **Redaction before export:** span attributes are passed through the same redaction before they are handed to the OpenTelemetry SDK, so exporters only ever see scrubbed values.

---

## 5. Fault Tolerance & Usage Ledger Isolation

- **Non-blocking Telemetry:** Spans are queued and exported in batches by the OpenTelemetry SDK (5-second export timeout per batch). A collector that is down or slow never fails, delays or blocks prompt executions, conversations or quota reservations; when the queue is full, the oldest spans are dropped instead of growing memory.
- **Bounded In-Memory Retention:** Local traces are stored in a ring buffer with a strict cap of 500 items, preventing memory leaks during long-running sessions.
- **Ledger Isolation (No Duplicate Accounting):** Telemetry export is purely observational and strictly isolated from the quota ledger. Token accounting and budget enforcement are persisted independently in PostgreSQL (`usage_records` and `quota_periods` tables). Telemetry exports never write duplicate ledger entries or mutate financial quotas.

---

## 6. Inspecting Traces in PromptLab UI

1. Open the PromptLab web UI (`http://localhost:4200`).
2. Click **Observability** in the left sidebar navigation (`/observability`).
3. **Telemetry Status Bar:** Displays tracing engine status, OTLP endpoint status, Langfuse connection state, privacy redaction guarantee, and total traces in the ring buffer.
4. **Trace Explorer:** Filter traces by status (`Success`, `Error`, `Rate Limited`), operation type, or model name.
5. **Waterfall Inspector:** Click on any trace row or **Inspect** button to open the waterfall drawer:
   - View root metadata, latency, tokens, cost, and W3C `traceparent` header with a 1-click copy button.
   - Inspect the child span timeline showing each operation's duration and relative start time.
   - Click any span to expand sanitized attributes.
6. **Clear Traces:** Allows clearing the local ring buffer for demo or test resets without impacting the persistent quota ledger.

---

## 7. Local Setup with OpenTelemetry or Langfuse (Optional)

### OpenTelemetry Collector (Docker Compose)
To forward traces to a local OpenTelemetry collector:
```yaml
# docker-compose.otel.yml (pin the image version you test with)
services:
  otel-collector:
    image: otel/opentelemetry-collector:latest
    ports:
      - "4318:4318" # OTLP HTTP receiver
```
Set in the root `.env`:
```env
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
```

### Langfuse (Cloud or Self-Hosted)
To forward LLM generations and traces to Langfuse:
1. Create a free account or project at [cloud.langfuse.com](https://cloud.langfuse.com).
2. Generate API keys in **Project Settings -> API Keys**.
3. Set in the root `.env`:
```env
LANGFUSE_PUBLIC_KEY=pk-lf-...
LANGFUSE_SECRET_KEY=sk-lf-...
LANGFUSE_BASEURL=https://cloud.langfuse.com
```
Restart the API (`npm run start:api`). Traces will appear in Langfuse with token usage, latency, cost and model metadata.
