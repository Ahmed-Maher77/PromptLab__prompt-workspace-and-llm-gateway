---
type: index
title: "Architecture Decision Records (ADRs)"
description: "Index of formal architectural decisions made during the design and delivery of PromptLab"
status: active
maintainer: "PromptLab Core Team"
last_updated: "2026-10-26"
---

# Architecture Decision Records (ADRs)

This directory documents all significant technical and architectural decisions for PromptLab. Each ADR captures the context, considered alternatives, rationale, and consequences of a specific technical choice.

---

## Index of Decisions

| ADR | Title | Status | Date | Decision Summary |
| :--- | :--- | :--- | :--- | :--- |
| [ADR-001](./adr-001-modular-monolith-nestjs.md) | Modular Monolith Backend with NestJS | **Accepted** | 2026-10-18 | Adopt a single NestJS application with strictly encapsulated domain modules instead of microservices. |
| [ADR-002](./adr-002-litellm-proxy-gateway.md) | Standalone LiteLLM Proxy Gateway | **Accepted** | 2026-10-18 | Use LiteLLM Proxy as a separate routing service with strictly server-side upstream API credentials. |
| [ADR-003](./adr-003-immutable-prompt-versioning.md) | Append-Only Immutable Prompt Versioning | **Accepted** | 2026-10-18 | Preserve complete prompt history through immutable versions (v1, v2...) with parent pointers. |
| [ADR-004](./adr-004-atomic-quota-reservations.md) | Atomic Two-Phase Quota Reservations | **Accepted** | 2026-10-19 | Use ACID transactions to reserve quota upfront, preventing race conditions and concurrent overdrafts. |
| [ADR-005](./adr-005-summarize-and-truncate-compaction.md) | Summarize & Truncate Context Compaction | **Accepted** | 2026-10-19 | Distill conversation history using LLM summarization while preserving the system prompt and recent turns. |
| [ADR-006](./adr-006-privacy-redaction-engine.md) | Server-Side Privacy Redaction Engine | **Accepted** | 2026-10-19 | Redact API keys, bearer tokens, and sensitive headers before exporting spans or writing logs. |
| [ADR-007](./adr-007-read-only-system-settings.md) | Read-Only System Settings Dashboard | **Accepted** | 2026-10-20 | Implement a read-only `/settings` dashboard with active health probes and zero credential leakage. |
| [ADR-008](./adr-008-backward-compatible-pagination.md) | Backward-Compatible Limit/Offset Pagination | **Accepted** | 2026-10-20 | Implement limit/offset query pagination with deterministic sorting while preserving array return contracts. |
| [ADR-009](./adr-009-context-budget-sliding-window.md) | Sliding Window Context Budget Enforcement | **Accepted** | 2026-10-25 | Enforce context budgets via sliding window over dialogue turns and definitive 409 before quota reservation. |
| [ADR-010](./adr-010-resumable-checkpoints-and-compaction-validation.md) | Resumable Checkpoints & Compaction Validation | **Accepted** | 2026-10-26 | Persist active checkpoint pointer, retain messages post-checkpoint, validate range, and serialize with row lock. |
| [ADR-011](./adr-011-typed-timeout-reconciliation-and-per-user-throttling.md) | Typed Timeout Reconciliation & Per-User Throttling | **Accepted** | 2026-10-26 | Typed timeout error kinds, configurable timeout charge ratio, and per-user throttling with idempotency bypass. |
| [ADR-012](./adr-012-model-catalog-and-structural-error-classification.md) | Dynamic Model Catalog & Structural Error Classification | **Accepted** | 2026-10-26 | Single-flight cached LiteLLM /model/info as source of truth for limits/pricing, response cost header authority, and HTTP status-first structural error classification. |
| [ADR-013](./adr-013-model-aware-token-counter.md) | Model-Aware Local Tokenizer & Unified Estimation Service | **Accepted** | 2026-10-26 | In-process js-tiktoken with model-aware encoding resolution, bounded LRU caching, and unified REST estimation endpoint over network-based token counting. |
| [ADR-014](./adr-014-containerized-stack.md) | Containerized Stack — Image Pinning, Migration Strategy, Proxy Trust, and Offline Fonts | **Accepted** | 2026-10-26 | LiteLLM image pinned by tag + digest; `prisma migrate deploy` in entrypoint (single-replica); `TRUST_PROXY=1` for correct per-IP throttling behind Nginx; `optimization.fonts: false` for offline CI builds. |
| [ADR-015](./adr-015-health-probes-and-gateway-resilience.md) | Health Probes & Gateway Resilience | **Accepted** | 2026-10-26 | Split `/api/health` into liveness, readiness and a diagnostic endpoint; gateway per-attempt timeout (25 s) below the API timeout (30 s), no timeout retries, bounded retries for fast-failing 429/5xx, no cross-model fallbacks; every trace closes all its spans and upstream 429s are recorded as `rate_limited`. |

