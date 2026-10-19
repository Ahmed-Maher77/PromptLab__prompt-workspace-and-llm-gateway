# PromptLab — System Architecture

## 1. Overview

PromptLab is a developer-focused Prompt Engineering and LLM Gateway platform. It enables engineers to design prompts with established techniques, manage immutable versioning, run side-by-side model experiments, maintain multi-turn conversations with context inspection and compaction, track token usage, and enforce monthly user token quotas.

```mermaid
graph TD
    Client["Browser / Angular Web App<br/>(Port 4200)"]
    API["NestJS Application Backend<br/>(Port 3000)"]
    DB[(PostgreSQL Database<br/>Prisma ORM)]
    Gateway["LiteLLM Proxy Gateway<br/>(Port 4000)"]
    Providers["LLM Providers<br/>(OpenAI, Anthropic, etc.)"]

    Client -->|REST API| API
    API -->|Data persistence & Quota ledger| DB
    API -->|Gateway requests with correlation IDs| Gateway
    Gateway -->|Upstream calls| Providers
```

## 2. Component Architecture

### Frontend (`apps/web`)
- **Framework:** Angular 19 (TypeScript, standalone components).
- **Styling:** Vanilla CSS design system adhering to `DESIGN_SYSTEM.md` using central CSS custom property design tokens (neutral palette, 4px grid, accessible focus states, no gimmicks/gradients).
- **Core Views:**
  - Prompt Studio (Library, Editor, Version History, Playground)
  - Compare (Side-by-side A/B model/prompt evaluation)
  - Conversations (Context inspector, compaction, checkpoints)
  - Usage & Quotas (Monthly token allowances, ledger)
  - Gateway & Observability (Traces, latencies, provider status)
  - Settings (Model configs, preferences)

### Backend (`apps/api`)
- **Framework:** NestJS 11 (Modular monolith).
- **Modules:**
  - `health`: Service and database readiness checks.
  - `auth`: User context and authorization.
  - `prompts`: Prompt templates, metadata, and immutable version storage.
  - `experiments`: A/B run definitions, executions, and evaluation scores.
  - `conversations`: Conversation sessions, message persistence, and checkpoint storage.
  - `context`: Token budget management, message truncation, and context compaction.
  - `providers`: LiteLLM gateway integration client and model availability.
  - `usage`: Quota policy, monthly period tracking, concurrency-safe token reservations, and reconciliation.
  - `observability`: Request tracing, correlation ID propagation, and error redaction.
- **ORM:** Prisma Client with PostgreSQL.

### Gateway & External Services
- **LiteLLM Proxy:** Separately hosted reverse proxy handling model routing, failover, upstream provider credentials, and gateway-level financial/rate limits.
- **Database:** PostgreSQL storing immutable versions, conversations, original messages, checkpoints, and usage records.

## 3. Security & Governance Principles
1. **Secrets Management:** Provider API keys remain strictly server-side inside gateway secrets or environment variables. No secrets are ever exposed in client bundles or client logs.
2. **Quota Enforcement:** Monthly token quotas are enforced in the NestJS application backend prior to gateway calls with concurrent reservation locking and post-call reconciliation.
3. **Observability:** Input/output tokens are distinguished; token counts are labeled *estimated* prior to execution and *provider-reported* once reconciled.
