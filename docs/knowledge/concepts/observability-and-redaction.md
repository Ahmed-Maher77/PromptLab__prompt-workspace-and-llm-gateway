---
type: Concept
title: "Observability & Privacy Redaction Specification"
description: "Specification for W3C distributed tracing, OpenTelemetry & Langfuse exporters, and regex redaction engine"
status: active
domain: "observability"
---

# Observability & Privacy Redaction Specification

## Overview
The Observability domain captures distributed traces across prompt runs, model comparisons, and conversational turns, providing full latency breakdowns while ensuring strict privacy redaction before exporting data.

## W3C Trace Context Propagation
Every execution traces span relationships using standard W3C headers:
- Format: `traceparent: 00-{traceId}-{spanId}-{flags}`
- Propagated to LiteLLM Proxy in outbound HTTP headers so upstream logs can correlate with PromptLab traces.

## Telemetry Exporters
- **In-Memory Ring Buffer:** Retains up to 100 recent traces with FIFO eviction for live inspection in the `/observability` dashboard.
- **OpenTelemetry (`OtlpHttpSpanExporter`):** Exports standard OTLP/HTTP JSON payloads to a configurable collector (`OTEL_EXPORTER_OTLP_ENDPOINT`, default `http://localhost:4318`).
- **Langfuse Exporter (`LangfuseSpanExporter`):** Formats spans for ingestion into Langfuse via its batch ingestion API.

## Privacy Redaction Engine
Executed in-process prior to serialization:
- Replaces any pattern matching `sk-[a-zA-Z0-9_-]{20,}` with `[REDACTED_API_KEY]`.
- Replaces Bearer tokens with `Bearer [REDACTED_TOKEN]`.
- Strips sensitive headers: `Authorization`, `Proxy-Authorization`, `x-api-key`, `cookie`.
- Preserves all numeric metric keys (`prompt_tokens`, `completion_tokens`, `duration_ms`).
