---
type: Decision
title: "ADR-005: Summarize & Truncate Context Compaction"
description: "Decision on context window compaction strategy for multi-turn conversational threads"
status: accepted
date: "2026-10-19"
decision_makers: ["PromptLab Core Team"]
---

# ADR-005: Summarize & Truncate Context Compaction

## Context
Multi-turn conversations quickly exhaust context window token budgets (e.g. 4,000 or 8,000 tokens), causing request failures or escalating latency and inference costs. We needed an automatic or on-demand compaction algorithm that reduces context size without losing critical discussion facts.

## Alternatives Considered
1. **FIFO Truncation:** Simply delete the oldest messages in the thread once the budget ceiling is approached. (Drops foundational user instructions and crucial context).
2. **Vector Retrieval (RAG) over History:** Embed past turns and retrieve only top-k relevant turns per prompt. (High complexity, loses conversational coherence and narrative flow).
3. **Summarize & Truncate:** Distill older turns into a structured summary paragraph via an LLM summarization call, replace historical turns with the summary, and keep the system prompt plus the last $N$ turns intact.

## Decision
We chose **Summarize & Truncate**.

### Compaction Mechanics
1. The `systemPrompt` is always pinned and never mutated or removed.
2. The last 2 user-assistant turns (recency buffer) are preserved verbatim.
3. Intermediate turns are extracted and fed to a lightweight summarization prompt (`Summarize the key facts, decisions, and context from this dialogue`).
4. The generated summary is saved to the `Conversation.summary` field and displayed prominently as a memory banner in the UI.
5. The compacted messages are archived, reducing total active context tokens by 60–85%.

## Consequences
- **Positive:** Preserves conversational memory, respects token budgets, and drastically reduces recurring inference latency.
- **Negative:** Requires an extra LLM call to generate the summary.
- **Mitigation:** Executed using fast, cost-effective models (`gpt-4o-mini`) and triggered only when requested by the user or when budget usage crosses 80%.
