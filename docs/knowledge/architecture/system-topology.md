---
type: Architecture
title: "System Topology & Network Architecture"
description: "High-level component topology, network ports, protocol flows, and security boundaries"
status: active
domain: "infrastructure"
---

# System Topology & Network Architecture

## Architecture Diagram

```mermaid
graph TD
    Client["Angular 22 Frontend (Port 4200)<br/>• Prompt Studio &nbsp;&nbsp;&nbsp;&nbsp; • Model Comparison (/compare)<br/>• Conversations &nbsp;&nbsp;&nbsp;&nbsp; • Usage & Quotas (/usage)<br/>• Observability &nbsp;&nbsp;&nbsp;&nbsp; • System Settings (/settings)"]
    API["NestJS Modular Monolith (Port 3100)<br/>Prefix: /api<br/>• PromptsModule &nbsp;&nbsp;&nbsp;&nbsp; • ExperimentsModule<br/>• ConversationsModule &nbsp;&nbsp;&nbsp;&nbsp; • UsageModule (ACID Quotas)<br/>• ObservabilityModule &nbsp;&nbsp;&nbsp;&nbsp; • SettingsModule<br/>• ProvidersModule &nbsp;&nbsp;&nbsp;&nbsp; • HealthModule"]
    DB[("PostgreSQL Database (Port 5432)<br/>• prompts & versions<br/>• experiments & ratings<br/>• conversations & messages<br/>• quota_ledger & policy")]
    Gateway["LiteLLM Proxy (Port 4000)<br/>• /v1/chat/completions<br/>• /v1/models<br/>• /health/liveliness<br/>(Upstream Secrets Loaded)"]
    Providers["External LLM Providers<br/>• OpenAI API (gpt-4o-mini)<br/>• Anthropic API (claude-3-5-sonnet)"]

    Client -->|"HTTP REST / SSE (Port 3100)<br/>CORS Origin: http://localhost:4200"| API
    API -->|"Prisma ORM (Port 5432)<br/>Local / Docker"| DB
    API -->|"HTTP (Port 4000)<br/>W3C traceparent"| Gateway
    Gateway --> Providers
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
