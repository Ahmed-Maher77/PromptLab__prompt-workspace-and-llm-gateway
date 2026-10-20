---
type: Decision
title: "ADR-006: Server-Side Privacy Redaction Engine"
description: "Decision to enforce regex-based server-side privacy redaction before exporting telemetry and traces"
status: accepted
date: "2026-10-19"
decision_makers: ["PromptLab Core Team"]
---

# ADR-006: Server-Side Privacy Redaction Engine

## Context
When instrumenting LLM calls with OpenTelemetry and Langfuse, span attributes, HTTP headers, and metadata often contain sensitive data: upstream API keys (`sk-...`), Bearer tokens, Authorization headers, and private credentials. Transmitting these to external collectors poses severe compliance and security risks.

## Alternatives Considered
1. **Collector-Side Redaction:** Export raw telemetry and rely on OpenTelemetry Collector processors (`transform`, `redaction`) to mask secrets. (Leaks unencrypted secrets over the wire before reaching the collector).
2. **Client-Side Redaction in Browser:** Strip secrets in Angular before sending payloads. (Vulnerable to bypass and irrelevant for server-to-gateway telemetry).
3. **In-Process Server-Side Redaction Engine:** Apply strict regex-based and structural attribute masking on every span immediately prior to in-memory buffering or external exporter dispatch.

## Decision
We chose the **In-Process Server-Side Redaction Engine**.

### Implementation Rules
- Masks any string matching known API key patterns (`sk-[a-zA-Z0-9_-]{20,}` $\rightarrow$ `[REDACTED_API_KEY]`).
- Redacts sensitive headers: `Authorization`, `Proxy-Authorization`, `x-api-key`, `cookie`.
- Masks bearer tokens (`Bearer [a-zA-Z0-9._-]+` $\rightarrow$ `Bearer [REDACTED_TOKEN]`).
- Crucial invariant: Numeric metric fields (such as `prompt_tokens`, `completion_tokens`, `latency_ms`) are strictly whitelisted and never corrupted by broad token-word regexes.

## Consequences
- **Positive:** Guarantees zero credential leakage in traces, whether displayed on the `/observability` UI or sent over OTLP/Langfuse.
- **Negative:** Minor CPU overhead per exported span.
- **Mitigation:** Regex patterns are compiled once and executed only on telemetry payload serialization boundaries.
