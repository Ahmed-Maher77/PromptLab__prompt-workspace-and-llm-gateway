---
type: spec
id: SPEC-13
title: "Conversations and Compaction"
description: "Multi-turn conversations with budgeted context assembly, context inspection, user-approved compaction and resumable checkpoints"
status: partially-implemented
domain: "conversations"
last_updated: "2026-10-27"
---

# SPEC-13: Conversations and Compaction

## Summary

A conversation is a persisted, multi-turn exchange with one model. Before each turn the API assembles the exact payload from the system prompt, the active checkpoint, as many recent turns as fit the budget, and the new message. Users can inspect that payload, and can compact older turns into a checkpoint they review and approve. Original messages are never deleted, and any earlier checkpoint can be resumed.

## Scope

- Create, list, open and delete conversations. Choose provider and model, optional system instructions and an optional context budget.
- Messages persisted in PostgreSQL with per-conversation sequence numbers.
- Context inspector: window, budget, estimated tokens and the assembled messages with their source.
- Sliding-window truncation of older dialogue when the budget is exceeded.
- Two-step compaction: preview, then apply. Checkpoints with summary, retained facts and the sequence they cover.
- Resuming a conversation from a chosen checkpoint.
- Idempotent message sending. Failed turns are stored and excluded from context.

## Context policy

The policy is implemented in [context-policy.ts](../../apps/api/src/conversations/context-policy.ts) and shared by the inspector and by message sending, so the preview always matches what is dispatched ([ADR-009](../knowledge/decisions/adr-009-context-budget-sliding-window.md)).

1. The input budget MUST cover the system instruction, the active checkpoint (summary and facts), the retained dialogue and the new user message.
2. Output space MUST be reserved. The maximum input budget is the model's context window minus its reserved output tokens (the model's maximum output, or 1,024 when unknown). The context window and output limit come from the gateway model catalog.
3. The input budget MUST NOT be the whole context window. With no requested budget, it is the smaller of half the window and 8,192 tokens. When the window is unknown, the default is 4,096 tokens and the unknown status MUST be shown.
4. A requested budget (512 to 1,048,576 tokens) MUST be capped to the maximum input budget, both when it is stored and when it is applied.
5. Token counts MUST come from the model-aware tokenizer when one applies. Otherwise they MUST be labelled as approximate. Context figures MUST be reported as estimates (`tokenUsageSource: estimated`) together with the estimation method.
6. The system instruction (sequence 1), the active checkpoint and the new message MUST NOT be dropped to fit the budget.
7. When the total exceeds the budget, the oldest retained dialogue MUST be dropped in whole turns until it fits. The retained dialogue MUST NOT start with an assistant reply.
8. If the pinned parts alone exceed the budget, the request MUST fail with `409 CONTEXT_BUDGET_EXCEEDED` before any quota is reserved or model called.
9. Failed messages MUST be excluded from the assembled context.
10. A checkpoint is a derived summary. It MUST NOT replace or delete original messages. It MUST record the sequence it covers (`compactedThroughSequence`) and the policy version (`contextPolicyVersion`).
11. Compaction MUST NOT delete history on failure. If the model call fails or returns unusable output, the preview falls back to a deterministic summary and says so. Nothing is persisted until the user applies a checkpoint.
12. The compaction target MUST be beyond the active checkpoint and before the latest message. This MUST be checked under a row lock when the checkpoint is applied. A violation MUST return `400` with code `INVALID_COMPACTION_RANGE`.
13. Per-message framing overhead is counted in the quota reservation estimate. It is not counted in the context budget, which counts message text only.

## Rules

- A conversation and its messages MUST be visible only to their owner.
- Message content MUST NOT exceed 32,768 characters, and the system prompt MUST NOT exceed 32,768 characters.
- Compaction instructions MUST be sent as the system message and the transcript as a delimited user message, treated as data. The model MUST answer with JSON `{"summary": string, "retainedFacts": string[]}`, which is validated (summary up to 8,000 characters, at most 30 facts of up to 500 characters) ([ADR-016](../knowledge/decisions/adr-016-structured-compaction-output.md)).
- At least three non-system messages MUST exist before compaction is offered.
- A compaction preview is a model call. It consumes quota and is traced like any other.
- Sequence numbers MUST be allocated atomically, so concurrent sends cannot collide.
- A repeated `Idempotency-Key` MUST NOT send a second model request or store a second turn.

## Acceptance criteria

| # | Criterion | Status | Evidence |
| :--- | :--- | :--- | :--- |
| 1 | Conversations can be created and listed, with provider, model and optional system instructions. | ✅ Met | `create`, `findAll` in [conversations.service.ts](../../apps/api/src/conversations/conversations.service.ts); [create-conversation.dto.ts](../../apps/api/src/conversations/dto/create-conversation.dto.ts). Test: *should create conversation and insert initial system prompt if provided*. |
| 2 | A conversation can start from a saved prompt template. | ⚠️ Partially met | Only free-form system instructions are supported. The create form takes a system prompt text ([conversations.component.html](../../apps/web/src/app/pages/conversations/conversations.component.html)) and the API has no prompt reference. A user can paste a template's text into it. |
| 3 | Messages are persisted in PostgreSQL. | ✅ Met | `ConversationMessage` with unique `(conversationId, sequenceNumber)` ([schema.prisma](../../apps/api/prisma/schema.prisma)); user and assistant messages written in one transaction in `sendMessage`. Test: *should append assistant response with provider-reported usage on success*. |
| 4 | The context-window configuration and an estimated usage figure are displayed. | ✅ Met | `inspectContext` returns `contextWindow`, `contextLimitStatus`, `inputBudget`, `reservedOutputTokens`, `totalEstimatedInputTokens` and `tokenEstimationMethod`. Tests: *should show known context window for gpt-4o-mini and calculate honest token estimates*, *should set contextWindow to null and status unknown for unregistered models*. |
| 5 | The exact payload to be sent can be inspected. | ✅ Met | `GET /conversations/:id/context` returns `assembledMessages` with `source` per message; the inspector modal renders it. Integration test: *truncates older messages via sliding window and inspectContext matches dispatched payload*. |
| 6 | Manual compaction is previewed and approved before it takes effect. | ✅ Met | `previewCompaction` persists nothing; `applyCompaction` creates the checkpoint. Tests: *should generate a proposed compaction preview with token savings*, *should apply compaction and persist checkpoint while retaining all original messages in database*; journey [conversations.flow.spec.ts](../../e2e/flows/conversations.flow.spec.ts). |
| 7 | An automatic compaction threshold exists as a configurable policy. | ❌ Not met | No code compacts automatically and there is no threshold setting. The behaviour that replaced it is sliding-window truncation to the budget ([ADR-009](../knowledge/decisions/adr-009-context-budget-sliding-window.md)). When truncation is active, the page shows a banner with a "Compact History" action. |
| 8 | Checkpoints can be saved, and a conversation can be resumed from one. | ✅ Met | `applyCompaction`, `resume` and `activeCheckpointId` ([ADR-010](../knowledge/decisions/adr-010-resumable-checkpoints-and-compaction-validation.md)). Tests: *persists activeCheckpointId and updates assembled context when resuming an older checkpoint*, *throws NotFoundException when resuming a non-existent checkpoint ID*; integration: *compacts twice, resumes first checkpoint, and asserts inspectContext and provider payload use it*. |
| 9 | Original messages remain intact and retrievable after compaction. | ✅ Met | Compaction only inserts a checkpoint and moves `activeCheckpointId`. Test: *should apply compaction and persist checkpoint while retaining all original messages in database*; `findOne` returns every message, marked as in-checkpoint by the UI. |
| 10 | Context assembly respects the configured budget. | ✅ Met | `assembleConversationContext` in deterministic tests. Tests: *drops oldest retained messages via sliding window…*, *caps effective contextBudget to model context limit*, *clamps stored contextBudget to model maximum on conversation creation*, *never starts the dialogue with an orphaned assistant reply across all budget ranges*, *fails fast with 409 CONTEXT_BUDGET_EXCEEDED without calling llmExecutionService when essential tokens alone exceed budget*. |
| 11 | Important facts survive compaction in the test dataset. | ⚠️ Partially met | The approved summary and retained facts are always included in later prompts, and are shown in the inspector (integration test asserts the checkpoint summary reaches the dispatched payload). The deterministic fallback keeps a fact per user question (*is deterministic and describes the compacted range*). Whether a model extracts every needed fact is not asserted, because that needs a live model. The review step lets the user edit facts before applying. |
| 12 | Resuming restores the correct conversation and checkpoint. | ✅ Met | Same tests as criterion 8, plus *should restore conversation context confirmation with retained history intact*. Conversations and checkpoints are stored in PostgreSQL, so they survive a restart; the journey test covers compaction preview and checkpoint resumption. |
| 13 | Concurrent messages are ordered or conflict-safe. | ✅ Met | `lastSequence` is incremented inside the same transaction that inserts the messages; a unique constraint backs it. Integration tests: *allocates sequence numbers atomically under parallel sends with different keys*, *serializes concurrent applyCompaction calls cleanly using row-level locking*. |
| 14 | A failed compaction does not corrupt the conversation. | ✅ Met | Provider failure or invalid JSON yields a fallback preview (`summarySource: fallback`, `fallbackReason`). Tests: *should fall back gracefully to deterministic summary when provider fails without corrupting history*, *falls back deterministically when the model reply does not match the JSON contract*; [compaction-summary.spec.ts](../../apps/api/src/conversations/compaction-summary.spec.ts). Invalid ranges are rejected under a lock (*rejects with 400 and INVALID_COMPACTION_RANGE…*). |
| 15 | Context numbers are labelled as estimated or provider-reported. | ✅ Met | Inspector results use `tokenUsageSource: 'estimated'` and a `tokenEstimationMethod`; stored message usage carries its source; the UI prefixes approximate counts with `~`. Integration tests: *a conversation's inspectContext tokens and its reservation estimate both come from the tokenizer, with the method reported*, *derives context budget and records cost from mocked LiteLLM gateway in a real conversation turn*. |
| 16 | The full transcript remains stored. | ✅ Met | See criteria 9 and 3. Failed turns are stored with `status: failed` and excluded only from context. Integration test: *persists a failed turn with status failed and excludes it from context on subsequent turns*. |
| 17 | Retried sends are idempotent, and conflicts are explicit. | ✅ Met | Replays return the stored turn; in-flight keys return `409 REQUEST_IN_PROGRESS`; unavailable results return `409 IDEMPOTENCY_RESULT_UNAVAILABLE`. Integration tests: *same key sent twice → 1 provider call, 1 reservation, identical response, and no duplicate messages*, *same key while first is in flight → 409 REQUEST_IN_PROGRESS and no duplicate messages*, *emits explicit code in 409 responses for in-flight, unavailable, and reused keys across endpoints*. |
| 18 | Conversations are scoped to their owner. | ✅ Met | Owner filters in `findOne`, `loadContextState`, `applyCompaction`. Test: *throws NotFoundException when the conversation is not owned by the caller*; *throws NotFoundException when checkpoint belongs to a different conversation or user*. |

## Tests

- API: [conversations.service.spec.ts](../../apps/api/src/conversations/conversations.service.spec.ts), [context-policy.spec.ts](../../apps/api/src/conversations/context-policy.spec.ts), [compaction-summary.spec.ts](../../apps/api/src/conversations/compaction-summary.spec.ts), [conversations.controller.spec.ts](../../apps/api/src/conversations/conversations.controller.spec.ts), [token-counter.service.spec.ts](../../apps/api/src/tokens/token-counter.service.spec.ts)
- API integration (sliding window, checkpoints, sequence allocation, idempotent turns, failed turns): [app.integration.spec.ts](../../apps/api/src/app.integration.spec.ts)
- Web: [conversations.component.spec.ts](../../apps/web/src/app/pages/conversations/conversations.component.spec.ts), [conversation.service.spec.ts](../../apps/web/src/app/services/conversation.service.spec.ts)
- Journey: [conversations.flow.spec.ts](../../e2e/flows/conversations.flow.spec.ts)

## Related

- Concept: [Context window compaction](../knowledge/concepts/context-window-compaction.md)
- ADRs: [ADR-005](../knowledge/decisions/adr-005-summarize-and-truncate-compaction.md), [ADR-009](../knowledge/decisions/adr-009-context-budget-sliding-window.md), [ADR-010](../knowledge/decisions/adr-010-resumable-checkpoints-and-compaction-validation.md), [ADR-013](../knowledge/decisions/adr-013-model-aware-token-counter.md), [ADR-016](../knowledge/decisions/adr-016-structured-compaction-output.md)
- README: [Conversations and context compaction](../../README.md#conversations-and-context-compaction)
- Previous: [SPEC-12](./12-model-comparison.md). Next: [SPEC-14](./14-quotas-and-usage.md)
- Index: [README](./README.md)
