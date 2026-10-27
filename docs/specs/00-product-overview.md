---
type: spec
id: SPEC-00
title: "Product Overview"
description: "Goal, users, in-scope capabilities and explicit non-goals of PromptLab"
status: active
domain: "product"
last_updated: "2026-10-27"
---

# SPEC-00: Product Overview

## Summary

PromptLab is a prompt engineering workspace with an LLM gateway behind it. Engineers write versioned prompt templates, compare prompt and model combinations side by side, run multi-turn conversations inside a visible context budget, and keep token spend within monthly quotas. Every model call goes through one execution path that applies quotas, idempotency, cost accounting and tracing.

The project is a working proof of concept. It is expected to demonstrate real behaviour backed by automated tests, not only a user interface.

## Users

| Role | Description | Access |
| :--- | :--- | :--- |
| User | An engineer who authors prompts, runs comparisons and conversations, and monitors their own usage. | All product routes, scoped to the caller's own prompts, experiments, conversations and usage. |
| Admin | An operator who manages quota policy and inspects the running system. | Everything a user can do, plus quota policy updates, system settings and traces. See [Authentication and roles](../../README.md#authentication-and-roles). |

Roles come from the configured API key entry or the JWT claims. There is no self-service sign-up.

## In-scope capabilities

| Capability | Summary | Specification |
| :--- | :--- | :--- |
| Foundation | Monorepo, configuration validation, migrations, health probes, local and containerised setup. | [SPEC-10](./10-foundation.md) |
| Prompt Studio | Templates built on prompting techniques, immutable versions, resolved preview, playground runs. | [SPEC-11](./11-prompt-studio.md) |
| Model comparison | Two slots (A and B) run on the same input, with metrics, criteria checks and manual ratings. | [SPEC-12](./12-model-comparison.md) |
| Conversations and compaction | Multi-turn chat with context inspection, budgeted context assembly, user-approved compaction and resumable checkpoints. | [SPEC-13](./13-conversations-and-compaction.md) |
| Quotas and usage | Monthly token quotas, atomic reservations, a usage ledger, idempotent execution and request-rate limits. | [SPEC-14](./14-quotas-and-usage.md) |
| Gateway and observability | LiteLLM as the single provider gateway, model catalog, trace propagation, trace viewer, redaction. | [SPEC-15](./15-gateway-and-observability.md) |
| Hardening and delivery | Authentication, input limits, pagination, settings dashboard, CI gates, documentation. | [SPEC-16](./16-hardening-and-delivery.md) |

## Product principles

- **One path for model calls.** Playground runs, comparison slots, conversation turns and compaction previews share the same execution service.
- **Honest numbers.** Token counts and costs state their source (`estimated`, `provider-reported`, `catalog-estimate`). A value that cannot be computed is shown as unavailable, never invented.
- **Server-side enforcement.** Quotas, rate limits, ownership and validation are enforced by the API. The browser is not trusted.
- **Provider credentials stay out of the browser.** The web app only ever holds the caller's own PromptLab credential.
- **Derived data never replaces source data.** A compaction checkpoint changes what is sent to the model. The original transcript is kept.

## Non-goals

The following are deliberately outside the product as built.

| Non-goal | Position |
| :--- | :--- |
| Microservices, message queues, vector databases, LangChain or LangGraph | Not used. The backend is a modular monolith ([ADR-001](../knowledge/decisions/adr-001-modular-monolith-nestjs.md)). The only background job is an in-process scheduled sweeper. |
| Displaying or requesting hidden model reasoning | Techniques are instructional templates and structured outputs. No feature asks for or shows private chain-of-thought. |
| Streaming responses | Completions are requested and returned as a single response. |
| Multi-tenant workspaces | Quota policies are scoped to a user. The schema's `scope` column leaves room for other scopes, but only `user` is used. |
| External identity provider integration | Authentication uses configured API keys and HS256 JWTs. OIDC or OAuth flows are not implemented. |
| Automated model-graded evaluation | Evaluation uses deterministic criteria (text, regex, JSON validity, length) and manual ratings. |
| Live pricing or billing feeds | Cost comes from the gateway's response cost header when present, otherwise from the cached gateway model catalog ([ADR-012](../knowledge/decisions/adr-012-model-catalog-and-structural-error-classification.md)). |
| Gateway-level financial budgets as the quota mechanism | Monthly token quotas are an application concept stored in PostgreSQL. Gateway budgets are not used as a substitute. |
| Distributed rate limiting | Request-rate counters are held in process memory ([ADR-011](../knowledge/decisions/adr-011-typed-timeout-reconciliation-and-per-user-throttling.md)). Quota correctness does not depend on them. |
| Durable trace storage | Traces are kept in a bounded in-memory buffer and exported to an external backend when configured ([ADR-017](../knowledge/decisions/adr-017-opentelemetry-sdk-tracing.md)). |
| A provider reconciliation worker | Ambiguous timeouts are settled with a configured charge ratio; usage is not later corrected from provider billing data. |

## Related

- Index of all specifications: [README](./README.md)
- Product description and feature table: [Features](../../README.md#features)
- Demonstration walkthrough: [demo-script.md](../demo-script.md)
- Known limitations: [known-limitations.md](../known-limitations.md)
- Design system: [DESIGN_SYSTEM.md](../../DESIGN_SYSTEM.md)
