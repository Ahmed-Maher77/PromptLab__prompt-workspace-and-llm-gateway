---
type: Architecture
title: "System Topology & Network Architecture"
description: "High-level component topology, network ports, protocol flows, and security boundaries"
status: active
domain: "infrastructure"
---

# System Topology & Network Architecture

## Architecture Diagram

```
 ┌────────────────────────────────────────────────────────┐
 │           Angular 19 Frontend (Port 4200)              │
 │  - Prompt Studio       - Model Comparison (/compare)   │
 │  - Conversations       - Usage & Quotas (/usage)       │
 │  - Observability       - System Settings (/settings)   │
 └───────────────────────────┬────────────────────────────┘
                             │ HTTP REST / SSE (Port 3100)
                             │ CORS Origin: http://localhost:4200
 ┌───────────────────────────▼────────────────────────────┐
 │           NestJS Modular Monolith (Port 3100)          │
 │  Prefix: /api                                          │
 │  - PromptsModule          - ExperimentsModule          │
 │  - ConversationsModule    - UsageModule (ACID Quotas)  │
 │  - ObservabilityModule    - SettingsModule             │
 │  - ProvidersModule        - HealthModule               │
 └─────────────┬───────────────────────────┬──────────────┘
               │ Prisma ORM (Port 5432)    │ HTTP (Port 4000)
               │ Local / Docker            │ W3C traceparent
 ┌─────────────▼─────────────┐ ┌───────────▼──────────────┐
 │ PostgreSQL Database (5432)│ │ LiteLLM Proxy (Port 4000)│
 │ - prompts & versions      │ │ - /v1/chat/completions   │
 │ - experiments & ratings   │ │ - /v1/models             │
 │ - conversations & messages│ │ - /health/liveliness     │
 │ - quota_ledger & policy   │ │ Upstream Secrets Loaded  │
 └───────────────────────────┘ └───────────┬──────────────┘
                                           │
                        ┌──────────────────┴──────────────────┐
                        │ External LLM Providers              │
                        │ - OpenAI API (gpt-4o-mini)          │
                        │ - Anthropic API (claude-3-5-sonnet) │
                        └─────────────────────────────────────┘
```

## Network Ports & Protocols

| Service | Port | Protocol | Purpose |
| :--- | :--- | :--- | :--- |
| **Angular Web App** | `4200` | HTTP | Developer UI serving single-page application |
| **NestJS Backend API** | `3100` | HTTP | REST API under `/api` global prefix |
| **LiteLLM Proxy** | `4000` | HTTP | OpenAI-compatible gateway with server-side secrets |
| **PostgreSQL Database** | `5432` | TCP | Relational data persistence managed via Prisma |
| **OTEL Collector (Opt.)** | `4318` | HTTP | OpenTelemetry protocol telemetry sink |
| **Langfuse Server (Opt.)**| `3001` | HTTP | LLM application tracing and evaluation platform |

## Security & Boundary Invariants
1. **Zero Client Secrets:** Client browsers never handle or receive provider API keys or database connection strings.
2. **CORS Isolation:** Backend enforces strict origin filtering via `CORS_ORIGIN` (defaulting strictly to `http://localhost:4200`).
3. **Payload Boundaries:** Inbound request bodies are enforced to $\le$ 32KB text limits with class-validator validation pipelines.
