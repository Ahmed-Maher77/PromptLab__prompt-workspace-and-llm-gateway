---
type: Decision
title: "ADR-013: Model-Aware Local Tokenizer and Unified Estimation Service"
description: "Decision to use local js-tiktoken with model-aware encoding resolution, bounded LRU caching, and unified REST estimation endpoint over network-based token counting"
status: accepted
date: "2026-10-26"
decision_makers: ["PromptLab Core Team"]
---

# ADR-013: Model-Aware Local Tokenizer and Unified Estimation Service

## Context
In earlier versions of PromptLab (Phase 3 and before), token counting and context budgeting relied on coarse heuristics and fragmented logic:

1. **Naive Length Heuristics (`chars/4` and `chars/3.8`):**
   - The backend used `Math.ceil(length / 4)` (`common/utils/token-estimator.ts`), while the web frontend maintained its own independent `Math.ceil(length / 3.8)` formula in `conversations.component.ts`.
   - These heuristic estimates break down severely for non-Latin scripts: for Arabic text, `chars/4` under-counts by up to 2.5x; for CJK (Chinese, Japanese, Korean) characters, it under-counts by over 3x.
   - Dialogue message framing was completely ignored. In chat models (OpenAI ChatML, Anthropic, etc.), every message adds 3 tokens of framing overhead (`<|im_start|>{role}\n...<|im_end|>\n`) plus 3 priming tokens for the assistant. In a 10-message dialogue, heuristic estimation undercounted context by 33 tokens, risking silent token budget overflow and unexpected context clipping.

2. **Inconsistent Estimation Between Client and Server:**
   - Frontend users saw one estimate while typing, while context inspection and quota pre-flight reservation used another.

3. **Context Inspector Transparency:**
   - Users had no way of distinguishing whether an active context budget estimate was exact, an approximation, or a degraded fallback.

---

## Alternatives Considered

### 1. Network-Based Token Counting via LiteLLM (`POST /utils/token_counter`)
- Delegate all token counting to LiteLLM's `/utils/token_counter` endpoint.
- **Drawbacks:**
  - **Latency per keystroke:** Calling an HTTP service over the network as the user types in the web composer creates network chattiness, debounce lag, and poor responsiveness.
  - **CI & Offline Failure:** CI environments run with the LiteLLM gateway stopped. Any unit or integration test executing token estimation would fail unless mocked or requiring live gateway infrastructure.
  - **Availability Coupling:** If the gateway experiences downtime or restarts, context inspection and composer estimates would fail entirely.

### 2. Multi-Vendor Tokenizer Libraries (e.g., `@anthropic-ai/tokenizer`)
- Install vendor-specific packages for each provider family.
- **Drawbacks:**
  - `@anthropic-ai/tokenizer` is legacy and only supports Claude 2 BPE; it does not match Claude 3/3.5/3.7 tokenizers.
  - Adding multiple vendor tokenizer libraries introduces large binary/native dependencies and increases bundle size.

### 3. Local In-Process Tokenizer with `js-tiktoken`, Bounded LRU Cache, and Unified REST Endpoint (Selected)
- Embed `js-tiktoken` (version 1.0.21) directly within `TokenCounterService` in the API.
- Resolve model families to exact tiktoken encodings:
  - Default for OpenAI and modern reasoning models (`gpt-4o`, `gpt-4.1`, `gpt-5`, `o1`, `o3`, `o4`): `o200k_base` (`tiktoken:o200k_base`).
  - Explicit legacy OpenAI list (`gpt-4`, `gpt-4-0613`, `gpt-4-32k*`, `gpt-4-turbo*`, `gpt-3.5-turbo*`, `text-embedding-ada-002`, `text-embedding-3-*`): `cl100k_base` (`tiktoken:cl100k_base`).
  - Anthropic (`claude-*`) and unknown providers: modern multilingual proxy `o200k_base`, with estimation method explicitly labeled as approximate (`approximate:o200k_base`).
- Lazy-load encoding dictionaries on first access and cache them in memory.
- Add bounded LRU cache (1,000 entries) keyed by `(encoding, contentHash)` to eliminate redundant tokenization of immutable message history during repeated context assembly and inspection calls.
- Include chat message framing overhead (3 tokens per message + 3 priming tokens).
- Expose a single authenticated and rate-limited `POST /api/tokens/estimate` endpoint for both API clients and the Angular web frontend, eliminating the client's `/ 3.8` formula.
- Maintain `chars/4` strictly as an internal last-resort fallback if a tokenizer table fails to load.
- Upstream provider-reported token usage and cost (`x-litellm-response-cost`) remain the authoritative source of truth for final database persistence and ledger reconciliation.

---

## Decision

We chose **Alternative 3: Local In-Process Tokenizer with `js-tiktoken`, Bounded LRU Cache, and Unified REST Endpoint**.

### Architectural Invariants

1. **Local and Deterministic:**
   - Token estimation requires zero network calls and executes deterministically across local dev, CI runners, and production without depending on LiteLLM gateway uptime.

2. **Accurate Non-Latin and Dialogue Accounting:**
   - Non-Latin scripts (Arabic, CJK, Cyrillic) tokenize accurately according to vocabulary frequencies.
   - Chat dialogue estimates include per-message framing overhead, ensuring context budget compliance.

3. **Pure Context Assembly:**
   - `assembleConversationContext` remains a pure function; token estimation is injected via a `ContextTokenCounter` delegate (`tokenCounter.createCounter(model, provider)`).

4. **Transparent Method Provenance:**
   - Every estimate returns `{ tokens: number, method: TokenEstimationMethod, chunked?: boolean }`, where `method` is one of:
     - `'tiktoken:o200k_base'` (exact)
     - `'tiktoken:cl100k_base'` (exact)
     - `'approximate:o200k_base'` (closest approximation for Claude/unknown)
     - `'heuristic:chars/4'` (internal fallback)
   - The web frontend displays `"~"` with a tooltip containing the method when the count is approximate, and the Context Inspector exposes the method directly.

5. **Performance and Security Safeguards:**
   - **Chunking Guard on Unbroken Runs:** A direct `js-tiktoken` encode of 8,192 identical characters takes ~5s in pure JS. To prevent ReDoS and event-loop starvation, unbroken runs $> 128$ characters are chunked into 64-character segments. Counts are exact except inside unbroken runs $> 128$ characters, where chunking over-counts by a few percent (measured +0.6% to +6.6%), which is the safe direction for budgets and pre-flight reservations. The service flags `chunked: true` when this guard triggers.
   - **CPU Bound & Input Throttling:** Tokenisation is synchronous CPU work on the Node event loop. The estimate endpoint strictly caps input sizes via body limits (100KB), string maximums (131,072 chars), `@ArrayMaxSize(200)` on messages, and role enumeration `@IsIn(['system', 'user', 'assistant'])`. Rate limiting is enforced via the global per-IP throttler (with user throttler optional).

6. **Authoritative Reconciliation:**
   - Pre-flight quota reservations use model-aware message estimates; post-execution usage records and financial ledgers reconcile against provider-reported usage and costs.

---

## Consequences

- **Positive:**
  - Token counting is instantaneous (<1ms) and completely functional in CI without network access.
  - Substantially eliminates context window overflows caused by undercounting multi-message dialogues and non-English scripts.
  - Consistent single source of truth across web UI and backend services.
- **Negative / Considerations:**
  - Memory footprint of `js-tiktoken` rank tables (~2-4MB per loaded encoding). Lazy loading ensures only encodings actually requested are instantiated in memory.
  - Over-counting of a few percent on pathologically long non-spaced strings due to boundary splitting (safe direction for budgets).
