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
- **`Conversation`**: Dialogue thread entity. Contains `id`, `title`, `model`, `systemPrompt`, `contextBudget` (e.g. 4,000 tokens), `currentTokens`, `summary` (distilled history), `createdAt`, `updatedAt`.
- **`Message`**: Individual conversational turn. Contains `id`, `conversationId`, `role` (`system`, `user`, `assistant`), `content` (up to 32KB text), `tokenCount`, `createdAt`.

## Context Window Budgeting
- Each conversation specifies a `contextBudget` ceiling (default: 4,096 tokens, range: 512 to 1,048,576).
- The web UI displays an interactive progress bar showing current active token utilization.
- Warning thresholds:
  - `< 70%`: Normal / Neutral.
  - `70% – 85%`: Warning state (orange).
  - `> 85%`: Critical budget pressure (red), recommending context compaction.

## Summarize & Truncate Algorithm
When triggered manually or programmatically:
1. Pinned system prompt is preserved without modification.
2. The most recent 2 user-assistant turns are preserved verbatim to maintain short-term flow.
3. Older intermediate turns are passed to an LLM summarizer with instructions to preserve key decisions, variable assignments, and facts.
4. The generated summary is stored in `Conversation.summary`.
5. Compacted turns are archived, immediately recovering 60–85% of the token budget.
