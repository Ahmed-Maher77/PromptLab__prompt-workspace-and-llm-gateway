---
type: spec
id: SPEC-02
title: "Architecture and Stack"
description: "Architecture, module boundaries and technology choices of PromptLab as built"
status: active
domain: "architecture"
last_updated: "2026-10-27"
---

# SPEC-02: Architecture and Stack

## Summary

PromptLab is an Angular single-page app in front of a NestJS modular monolith. The API stores product data and the quota ledger in PostgreSQL and sends every model request through a separate LiteLLM proxy, which holds the provider credentials. Tracing uses the OpenTelemetry SDK, and the whole stack runs under Docker Compose or as local processes.

This document describes the architecture as built and links to the diagrams instead of copying them:

- System diagram, request pipeline, usage state machine, compaction flow, data model: [README](../../README.md#architecture).
- Topology, ports and boundary invariants: [system-topology.md](../knowledge/architecture/system-topology.md).
- Schema reference: [data-model.md](../knowledge/architecture/data-model.md).
- UI conventions: [DESIGN_SYSTEM.md](../../DESIGN_SYSTEM.md).

## Technology

| Concern | Choice | Notes |
| :--- | :--- | :--- |
| Frontend | Angular 22, TypeScript 6.0 | Standalone components, signals, built-in control flow, esbuild-based builder ([ADR-018](../knowledge/decisions/adr-018-angular-22-upgrade.md)). |
| Backend | NestJS 11, Node.js 22, TypeScript 5.x | Modular monolith ([ADR-001](../knowledge/decisions/adr-001-modular-monolith-nestjs.md)). |
| Database | PostgreSQL 16 | Source of truth for product data, the usage ledger and quota periods. |
| ORM and migrations | Prisma 6 | Versioned migrations in [apps/api/prisma/migrations](../../apps/api/prisma/migrations), applied with `prisma migrate deploy`. Typed enums and `DECIMAL(14,8)` cost ([ADR-019](../knowledge/decisions/adr-019-typed-columns-and-decimal-cost.md)). |
| LLM gateway | LiteLLM proxy 1.106, separate service | Image pinned by tag and digest. Configuration in [config.yaml](../../infra/litellm/config.yaml) ([ADR-002](../knowledge/decisions/adr-002-litellm-proxy-gateway.md), [ADR-014](../knowledge/decisions/adr-014-containerized-stack.md)). |
| Model catalog | Gateway `/model/info`, cached | Context limits and prices ([ADR-012](../knowledge/decisions/adr-012-model-catalog-and-structural-error-classification.md)). |
| Token counting | `js-tiktoken` in process | Model-aware encoding selection ([ADR-013](../knowledge/decisions/adr-013-model-aware-token-counter.md)). |
| Instrumentation | OpenTelemetry SDK, OTLP/HTTP export | Optional export to a collector and to Langfuse through its OTLP endpoint ([ADR-017](../knowledge/decisions/adr-017-opentelemetry-sdk-tracing.md)). |
| Rate limiting | `@nestjs/throttler`, in-memory storage | Per IP and per user ([ADR-011](../knowledge/decisions/adr-011-typed-timeout-reconciliation-and-per-user-throttling.md)). |
| Scheduling | `@nestjs/schedule` | A once-a-minute sweeper for expired reservations and closed quota periods. |
| Health | `@nestjs/terminus` | Liveness, readiness and diagnostic endpoints ([ADR-015](../knowledge/decisions/adr-015-health-probes-and-gateway-resilience.md)). |
| Testing | Jest, supertest, Karma and Jasmine, Playwright | See [SPEC-01](./01-engineering-standards.md#9-use-tests-to-prove-behaviour). |
| Local environment | Docker Compose, plus npm scripts for local processes | Four services: `postgres`, `litellm`, `api`, `web` (Nginx). |

Provider availability is configuration-driven. The API lists the models the gateway serves (`GET /api/providers/models`) and does not hard-code a provider list.

## Backend modules

Source: [apps/api/src](../../apps/api/src). Domain code is separated by business responsibility.

| Module | Responsibility | Specification |
| :--- | :--- | :--- |
| `prompts` | Templates, immutable versions, preview, playground run | [SPEC-11](./11-prompt-studio.md) |
| `experiments` | Two-slot comparisons, criteria checks, ratings | [SPEC-12](./12-model-comparison.md) |
| `conversations` | Conversations, messages, context assembly and policy, compaction, checkpoints | [SPEC-13](./13-conversations-and-compaction.md) |
| `usage` | Quota policy and periods, reservations, reconciliation, ledger, sweeper | [SPEC-14](./14-quotas-and-usage.md) |
| `llm` | `LlmExecutionService`, the single path for model calls | [SPEC-14](./14-quotas-and-usage.md), [SPEC-15](./15-gateway-and-observability.md) |
| `providers` | Gateway client and model catalog | [SPEC-15](./15-gateway-and-observability.md) |
| `tokens` | Model-aware token counting and the estimate endpoint | [SPEC-13](./13-conversations-and-compaction.md), [SPEC-14](./14-quotas-and-usage.md) |
| `observability` | Tracing, exporters, redaction, trace endpoints | [SPEC-15](./15-gateway-and-observability.md) |
| `health` | Liveness, readiness and diagnostic endpoints | [SPEC-10](./10-foundation.md) |
| `settings` | Read-only runtime configuration for administrators | [SPEC-16](./16-hardening-and-delivery.md) |
| `common` | Authentication and role guards, throttlers, exception filter, request ID middleware, configuration validation, DTO helpers | [SPEC-16](./16-hardening-and-delivery.md) |
| `prisma`, `database` | Database client and the idempotent seed | [SPEC-10](./10-foundation.md) |

## Frontend feature areas

Routes are lazy-loaded ([app.routes.ts](../../apps/web/src/app/app.routes.ts)).

| Route | Page | Specification |
| :--- | :--- | :--- |
| `/` | Overview | [SPEC-10](./10-foundation.md) |
| `/prompt-studio` | Prompt Studio | [SPEC-11](./11-prompt-studio.md) |
| `/compare` | Compare | [SPEC-12](./12-model-comparison.md) |
| `/conversations` | Conversations | [SPEC-13](./13-conversations-and-compaction.md) |
| `/usage` | Usage and quotas | [SPEC-14](./14-quotas-and-usage.md) |
| `/observability` | Traces | [SPEC-15](./15-gateway-and-observability.md) |
| `/settings` | System settings | [SPEC-16](./16-hardening-and-delivery.md) |
| `/login` | Sign-in with an API key or JWT | [SPEC-16](./16-hardening-and-delivery.md) |

## Data and external services

- PostgreSQL holds all product data. Quota enforcement uses conditional updates and unique constraints inside transactions ([ADR-004](../knowledge/decisions/adr-004-atomic-quota-reservations.md)).
- LiteLLM routes requests, applies timeouts, retries and cooldowns, and holds provider credentials.
- Telemetry backends (an OTLP collector, Langfuse) are optional. The API runs without them.
- The data model is documented in the [README](../../README.md#data-model) and [data-model.md](../knowledge/architecture/data-model.md).

## Differences from the original proposal

| Original proposal | As built | Reference |
| :--- | :--- | :--- |
| Redis optional, for counters, coordination or rate limits. | Redis is not used. Quota correctness relies on PostgreSQL. Rate-limit counters are in process memory, which makes them per instance. | [ADR-004](../knowledge/decisions/adr-004-atomic-quota-reservations.md), [ADR-011](../knowledge/decisions/adr-011-typed-timeout-reconciliation-and-per-user-throttling.md) |
| Separate `auth`, `context` and `admin` modules. | Authentication lives in `common` guards. Context assembly and compaction live in `conversations`. Quota administration is in `usage`, and read-only configuration is in `settings`. | [ADR-001](../knowledge/decisions/adr-001-modular-monolith-nestjs.md) |
| Initial data model with `QuotaPolicy`, `QuotaPeriod` and `UsageRecord` (request ID as idempotency key). | Kept in spirit and extended: usage records are unique per user and request ID, carry a status state machine, an operation and a stored response for replay. Comparison ratings are stored per slot in `ExperimentEvaluation`. Status, role and source columns are enums. | [ADR-019](../knowledge/decisions/adr-019-typed-columns-and-decimal-cost.md), [README](../../README.md#usage-accounting) |
| A `RequestTrace` table, or export to the observability system with only the data the UI needs persisted. | Export only, plus a bounded in-memory buffer for the trace viewer. No trace table. | [ADR-017](../knowledge/decisions/adr-017-opentelemetry-sdk-tracing.md) |
| Langfuse as the AI observability backend. | Langfuse is an optional export target reached through its OTLP endpoint. It is not part of the Compose stack. | [ADR-017](../knowledge/decisions/adr-017-opentelemetry-sdk-tracing.md) |
| Quota policy scoped to a user or workspace. | Only user scope is implemented. | [SPEC-14](./14-quotas-and-usage.md) |

## Related

- Index: [README](./README.md)
- Concepts: [docs/knowledge/concepts](../knowledge/concepts/index.md)
- Decisions: [docs/knowledge/decisions](../knowledge/decisions/index.md)
- Architecture notes: [docs/architecture.md](../architecture.md), [docs/knowledge/architecture](../knowledge/architecture/index.md)
- Repository layout: [README](../../README.md#repository-layout)
