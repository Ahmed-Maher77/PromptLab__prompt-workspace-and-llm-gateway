---
type: Decision
title: "ADR-008: Backward-Compatible Limit/Offset Pagination"
description: "Decision to implement limit and offset query pagination while preserving array response contracts"
status: accepted
date: "2026-10-20"
decision_makers: ["PromptLab Core Team"]
---

# ADR-008: Backward-Compatible Limit/Offset Pagination

## Context
As prompts, experiments, and conversation threads accumulate, unpaginated list endpoints (`/api/prompts`, `/api/experiments`, `/api/conversations`) risk degraded database performance and high frontend memory usage. However, existing frontend components and extensive test suites expect direct array responses (`Entity[]`).

## Alternatives Considered
1. **Envelope Response Refactor:** Change responses to `{ data: Entity[], total: number, page: number, pageSize: number }`. (Breaks all existing Angular services, components, and unit tests).
2. **Backward-Compatible Query Slicing:** Add optional `limit` (1–100) and `offset` ($\ge$ 0) query parameters. When omitted, return the existing array directly; when provided, slice or paginate with deterministic ordering.

## Decision
We chose **Backward-Compatible Query Slicing**.

### Implementation Rules
- Query DTO (`PaginationQueryDto`) enforces `@IsInt()`, `@Min(1)`, `@Max(100)` for `limit`, and `@Min(0)` for `offset`.
- Deterministic multi-column ordering (e.g. `[{ updatedAt: 'desc' }, { id: 'asc' }]` or `[{ createdAt: 'desc' }, { id: 'asc' }]`) ensures records do not shift between pages.
- Responses remain raw JSON arrays (`Entity[]`), allowing frontend callers to adopt pagination incrementally without breaking contract changes.

## Consequences
- **Positive:** 100% backward compatibility with zero regressions in existing UI or test suites.
- **Negative:** Callers do not receive total record count or total page count in response headers/envelopes.
- **Mitigation:** Documented as a known limitation in `docs/known-limitations.md`; metadata headers can be introduced in a future API version.
