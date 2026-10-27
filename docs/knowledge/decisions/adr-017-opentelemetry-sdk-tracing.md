---
type: decision
id: ADR-017
title: "Tracing on the OpenTelemetry SDK"
status: accepted
date: "2026-10-27"
deciders: ["PromptLab Core Team"]
---

# ADR-017 — Tracing on the OpenTelemetry SDK

## Context

Tracing was implemented by hand:
- Trace and span IDs came from `Math.random()`. They were not cryptographically random, and could in theory be all zeros, which W3C Trace Context forbids.
- Every finished trace triggered its own HTTP POST to the OTLP collector and another to the Langfuse ingestion API.
- The OTLP JSON and the Langfuse payloads were assembled manually.
- Nothing was batched, retried or flushed on shutdown.
- The default Langfuse URL in code (`:3000`) disagreed with `.env.example` and the topology docs (`:3001`).

## Decision

1. **Use the OpenTelemetry SDK for spans.** `ObservabilityService` creates real OTel spans through a `BasicTracerProvider` (`@opentelemetry/sdk-trace-base`). The root span's IDs form the `traceparent` forwarded to LiteLLM, so gateway-side traces join the same trace.
2. **Crypto-random IDs.** A custom `IdGenerator` uses `crypto.randomBytes` and rejects all-zero values. The SDK's default generator is based on `Math.random`.
3. **Batched export through the official OTLP exporter.**
   - Each backend gets its own `BatchSpanProcessor` with the OTLP/HTTP exporter: queue of 2,048 spans, batches of up to 256, a 2-second delay and a 5-second timeout.
   - Langfuse is reached through its OTLP endpoint (`/api/public/otel/v1/traces`, Basic auth with the key pair) instead of the ingestion API.
   - The root span carries `gen_ai.*` attributes so Langfuse shows model, provider, token usage and cost.
4. **Redaction before the SDK.** Attributes go through `sanitizeTelemetry` and are converted to valid OTel attribute values before they are set, so no exporter ever sees an unredacted value.
5. **Graceful shutdown.** The provider is flushed and shut down in `onApplicationShutdown` (the app enables shutdown hooks).
6. **Keep the in-memory viewer.** A redacted copy of the last 500 traces stays in memory for the Observability page; it is a developer convenience, not the system of record.
7. **Pin exact versions.** `@opentelemetry/api` 1.9.1, `sdk-trace-base` / `resources` / `core` 2.12.0, `exporter-trace-otlp-http` 0.223.0.

## Alternatives considered

- **`@opentelemetry/sdk-node` with auto-instrumentations (HTTP, Express, fetch, Prisma).** This gives the most coverage, but it monkey-patches modules at startup. It also has to load before Nest, which means restructuring the bootstrap and every test harness. It remains a sensible next step: the tracer provider used here can be swapped for the Node SDK without changing how spans are created.
- **Keep the hand-written exporter and only fix the IDs.** This would still mean one request per trace, no batching or retry, and a custom wire format to maintain.

## Consequences

- **Positive:**
  - Export is batched and bounded, and it is off the request path.
  - IDs are standard-compliant.
  - Any OTLP backend works, including Tempo, Honeycomb, Datadog and Langfuse.
  - About 130 lines of hand-built payload code were deleted.
- **Negative:**
  - Five new runtime dependencies, all from the OpenTelemetry project.
  - When the export queue is full, spans are dropped. This is the intended trade-off: telemetry must never slow down requests.
- **Verification:** `observability.service.spec.ts` captures spans with an in-memory exporter. It checks:
  - IDs match the `traceparent` and parent/child links are correct
  - typed attributes, `gen_ai` usage and resource attributes
  - redaction before export
  - auto-closed spans are exported
  - exporter failures never throw
  - spans are flushed on shutdown
  - one exporter per backend and URL normalisation
  - crypto IDs
