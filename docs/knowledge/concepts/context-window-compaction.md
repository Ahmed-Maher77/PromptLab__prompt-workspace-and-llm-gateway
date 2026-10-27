---
type: Concept
title: "Context Window Compaction Specification"
description: "Specification for multi-turn conversation budgeting, threshold warnings, and Summarize & Truncate compaction"
status: active
domain: "conversations"
---

# Context Window Compaction Specification

## Overview
The Conversational Workspace domain manages multi-turn dialogue threads while tracking active token budget consumption in real-time and compressing long conversation histories when approaching model context window boundaries.

## Core Entities
- **`Conversation`**: Dialogue thread. Holds the model, an optional `contextBudget` (512 to 1,048,576 tokens, capped to the model's input limit), `activeCheckpointId` and `lastSequence`.
- **`ConversationMessage`**: One turn (`system`, `user` or `assistant`) with a per-conversation `sequenceNumber`. Failed turns are kept with `status = failed` and excluded from context.
- **`ConversationCheckpoint`**: A compaction result: `summary`, `retainedFacts` and `compactedThroughSequence`. Messages are never deleted; a checkpoint only changes what is sent to the model.

## Context Window Budgeting
- The web UI shows current context usage against the effective budget.
- Warning thresholds:
  - `< 70%`: normal.
  - `70% – 85%`: warning (orange).
  - `> 85%`: critical (red); compaction is recommended.
- A turn that cannot fit even after the sliding window is rejected with `409 CONTEXT_BUDGET_EXCEEDED` before any quota is reserved (see [ADR-009](../decisions/adr-009-context-budget-sliding-window.md)).

## Context Assembly
Each turn sends: the system prompt, the active checkpoint's summary and retained facts (if any), the most recent turns that fit the budget (whole turns only; the dialogue never starts with an assistant reply), and the new user message.

## Compaction
Compaction is a two-step, user-confirmed operation (see [ADR-010](../decisions/adr-010-resumable-checkpoints-and-compaction-validation.md) and [ADR-016](../decisions/adr-016-structured-compaction-output.md)):

1. **Preview** (`POST /api/conversations/:id/compact/preview`): the messages after the active checkpoint up to the target sequence (by default all but the last two) are sent to the model.
   - The instructions are the system message; the transcript is a separate user message inside `<transcript>` delimiters and is treated as data.
   - The model must answer with JSON: `{"summary": string, "retainedFacts": string[]}`. The reply is validated (non-empty summary up to 8,000 characters, at most 30 facts of up to 500 characters).
   - If the provider fails or the reply is not valid, a deterministic summary is built from the messages instead. The response reports `summarySource` (`model` or `fallback`) and `fallbackReason` (`provider_error` or `invalid_model_output`), and the UI shows a notice.
2. **Review**: the user can edit the summary and facts.
3. **Apply** (`POST /api/conversations/:id/compact/apply`): under a row lock, the range is validated and a new checkpoint becomes active. All original messages stay in the database.
4. **Resume** (`POST /api/conversations/:id/resume`): switches the active checkpoint, e.g. back to an earlier one.
