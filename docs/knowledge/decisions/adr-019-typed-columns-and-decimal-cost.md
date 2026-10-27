---
type: decision
id: ADR-019
title: "Typed Columns, Decimal Cost and a Usage Operation"
status: accepted
date: "2026-10-27"
deciders: ["PromptLab Core Team"]
---

# ADR-019 — Typed Columns, Decimal Cost and a Usage Operation

## Context

- **Status and role columns were free strings.** Values such as `status`, `role` and `tokenUsageSource` were validated only by convention. `usage_records.status` even defaulted to `pending`, a state no code path ever wrote.
- **Money was a float.** `estimatedCost` was stored as `DOUBLE PRECISION`, so sums of small costs drifted.
- **Two shortcuts hid structure.** `experiments.commonInput` was a JSON object serialised into a text column, and `usage_records.conversationId` was a plain string with no foreign key.
- **The ledger could not say what a record was for.** The web app guessed the operation from the request ID prefix, which fails for client-supplied idempotency keys.

## Decision

1. **Enums for closed sets.** `UserRole`, `ConversationStatus`, `MessageRole`, `MessageStatus`, `ExperimentRunStatus`, `TokenUsageSource`, `QuotaPeriodStatus` and `UsageStatus` replace the string columns. Each enum holds exactly the values the code writes. `UsageStatus` defaults to `reserved`.
2. **Hyphenated values keep their stored form.** `timeout-ambiguous`, `provider-reported` and `estimated-timeout` use `@map`, so the database and API values are unchanged. The Prisma client returns `timeout_ambiguous` and friends, so explicit helpers (`toApiUsageStatus`, `fromApiUsageStatus`, `toApiTokenUsageSource`, `fromApiTokenUsageSource`) convert at the boundary: ledger and experiment responses, conversation messages, and every write.
3. **Decimal cost.** `estimatedCost` becomes `DECIMAL(14,8)`. `decimalToNumber()` converts at the boundary so responses still carry JSON numbers or `null`; writes use `new Prisma.Decimal(value)`.
4. **JSONB common input.** `experiments.commonInput` becomes `JSONB`; the service no longer stringifies or parses it. Rows that were not a JSON object are wrapped as `{"input": "<text>"}`, which is what the old reader returned for them.
5. **Conversation relation.** `usage_records.conversationId` references `conversations` with `ON DELETE SET NULL`, and is indexed. Orphan IDs are cleared before the constraint is added.
6. **Usage operation.** A nullable `UsageOperation` enum is set on every new reservation from `LlmExecutionService`. The ledger response gains an optional `operation` field (the only API addition), and the Usage page prefers it over request ID parsing. Existing rows are backfilled from the request ID prefixes the pipeline generates; client-supplied keys stay `NULL`.
7. **One migration, strict conversion.** `20261027100000_typed_columns_and_usage_operation` runs in a single transaction. Legacy `pending` usage records become `failed`, because no reservation was ever taken for them. Any other unknown value makes the enum conversion fail instead of being rewritten silently.

## Consequences

- **Positive:**
  - The database rejects invalid statuses and roles, and the default state of a usage record is correct.
  - Cost sums are exact, and the ledger can be filtered by operation.
  - Deleting a conversation no longer leaves dangling references in the ledger.
- **Negative:**
  - Raw SQL must cast enum parameters (`${value}::"UsageOperation"`), and new hyphenated values need a mapping in `usage.enums.ts`.
  - `JSONB` does not preserve key order, so `commonInput` keys may come back in a different order.
  - Costs are rounded to 8 decimal places on write.
- **Verification:** the migration was applied to a database populated with legacy rows (pending, `timeout-ambiguous`, float costs, a plain-text `commonInput`, an orphan conversation ID) and checked value by value; unknown role and status values were confirmed to abort it.
