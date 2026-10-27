---
type: spec-index
title: "PromptLab Specifications"
description: "Index of the product specifications, with status and an overall acceptance checklist"
status: active
last_updated: "2026-10-27"
---

# PromptLab Specifications

These documents describe PromptLab as it is built. Each feature specification lists its rules and an acceptance table in which every criterion has been checked against the code and the automated tests, with a status and its evidence. They replace the former implementation plan.

Status markers used in the acceptance tables: ✅ Met, ⚠️ Partially met, ❌ Not met.

## Specifications

| ID | Title | Status | Area |
| :--- | :--- | :--- | :--- |
| [00](./00-product-overview.md) | Product overview | active | Product |
| [01](./01-engineering-standards.md) | Engineering standards | active | Engineering |
| [02](./02-architecture-and-stack.md) | Architecture and stack | active | Platform |
| [SPEC-10](./10-foundation.md) | Foundation | implemented | Platform, database, web shell |
| [SPEC-11](./11-prompt-studio.md) | Prompt Studio | implemented | `prompts`, Playground |
| [SPEC-12](./12-model-comparison.md) | Model Comparison | partially-implemented | `experiments`, Compare |
| [SPEC-13](./13-conversations-and-compaction.md) | Conversations and Compaction | partially-implemented | `conversations`, Chat |
| [SPEC-14](./14-quotas-and-usage.md) | Quotas and Usage | partially-implemented | `usage`, Usage page |
| [SPEC-15](./15-gateway-and-observability.md) | Gateway and Observability | partially-implemented | `llm`, `providers`, `observability`, `health` |
| [SPEC-16](./16-hardening-and-delivery.md) | Hardening and Delivery | partially-implemented | Security, settings, CI, documentation |

## How the specifications relate to other documentation

| Source | Role | Location |
| :--- | :--- | :--- |
| Specifications | What the product must do and whether it does | `docs/specs` (this folder) |
| Concepts | How a capability works and why | [docs/knowledge/concepts](../knowledge/concepts/index.md) |
| Decisions | Why a design choice was made | [docs/knowledge/decisions](../knowledge/decisions/index.md) |
| Architecture | Topology and data model | [docs/knowledge/architecture](../knowledge/architecture/index.md) |
| Operations | Setup, troubleshooting, verification | [docs/knowledge/operations](../knowledge/operations/index.md) |
| Design system | Visual and interaction rules for the web app | [DESIGN_SYSTEM.md](../../DESIGN_SYSTEM.md) |
| Demonstration | Walkthrough for a live demo | [demo-script.md](../demo-script.md) |
| Limitations | Known gaps and trade-offs | [known-limitations.md](../known-limitations.md) |

A specification states the rules and the evidence. A concept explains the mechanism. An ADR records the decision and alternatives. Specifications link to the concepts and ADRs behind them in their Related sections.

## Acceptance summary

| Spec | Criteria | ✅ Met | ⚠️ Partially met | ❌ Not met |
| :--- | :--- | :--- | :--- | :--- |
| [SPEC-10](./10-foundation.md) | 10 | 10 | 0 | 0 |
| [SPEC-11](./11-prompt-studio.md) | 12 | 12 | 0 | 0 |
| [SPEC-12](./12-model-comparison.md) | 14 | 12 | 2 | 0 |
| [SPEC-13](./13-conversations-and-compaction.md) | 18 | 15 | 2 | 1 |
| [SPEC-14](./14-quotas-and-usage.md) | 23 | 19 | 4 | 0 |
| [SPEC-15](./15-gateway-and-observability.md) | 21 | 18 | 2 | 1 |
| [SPEC-16](./16-hardening-and-delivery.md) | 19 | 13 | 6 | 0 |
| **Total** | **117** | **99** | **16** | **2** |

## Overall acceptance checklist

| Area | Status | Notes |
| :--- | :--- | :--- |
| Workspace builds, lints and tests in CI | ✅ Met | [SPEC-10](./10-foundation.md), [SPEC-16](./16-hardening-and-delivery.md) |
| Versioned prompt templates with preview and playground | ✅ Met | [SPEC-11](./11-prompt-studio.md) |
| Two-slot comparison with metrics, criteria and ratings | ⚠️ Partially met | Generation settings and inline templates are not stored with a saved comparison; the API does not reject unresolved placeholders ([SPEC-12](./12-model-comparison.md)) |
| Conversations with a context budget and resumable checkpoints | ⚠️ Partially met | Compaction is user-initiated; there is no automatic threshold ([SPEC-13](./13-conversations-and-compaction.md)) |
| Atomic quotas, idempotent calls and usage history | ⚠️ Partially met | No test advances the clock across a month boundary; the ledger has no offset or period filter ([SPEC-14](./14-quotas-and-usage.md)) |
| Single gateway path, health probes and tracing | ⚠️ Partially met | Gateway budgets are not used as a quota; correlation IDs and trace coverage are partial ([SPEC-15](./15-gateway-and-observability.md)) |
| Authentication, roles, ownership and input limits | ✅ Met | [SPEC-16](./16-hardening-and-delivery.md), criteria 1 to 5 |
| Model identifier allow-list | ⚠️ Partially met | Format is validated; there is no catalog check ([SPEC-16](./16-hardening-and-delivery.md), criterion 6) |
| Pagination of list endpoints | ⚠️ Partially met | Ledger has `limit` only ([SPEC-16](./16-hardening-and-delivery.md), criterion 7) |
| Delivery documentation current | ✅ Met | [Demo script](../demo-script.md), [known limitations](../known-limitations.md) ([SPEC-16](./16-hardening-and-delivery.md), criterion 16) |

The two criteria that are not met are the automatic compaction threshold ([SPEC-13](./13-conversations-and-compaction.md), criterion 7) and gateway-enforced budgets ([SPEC-15](./15-gateway-and-observability.md), criterion 10). Gateway budgets as the quota mechanism are a stated non-goal in the [product overview](./00-product-overview.md); compaction is user-approved only.
