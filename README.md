# PromptLab — Prompt Engineering Workspace & LLM Gateway

[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue.svg)](https://www.typescriptlang.org/)
[![NestJS](https://img.shields.io/badge/NestJS-10.0-E0234E.svg)](https://nestjs.com/)
[![Angular](https://img.shields.io/badge/Angular-19.0-DD0031.svg)](https://angular.dev/)
[![LiteLLM](https://img.shields.io/badge/LiteLLM-Proxy%20v1.0-412991.svg)](https://docs.litellm.ai/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-Prisma%20ORM-336791.svg)](https://www.prisma.io/)
[![OKF](https://img.shields.io/badge/Knowledge-OKF%20v0.2-green.svg)](docs/knowledge/index.md)

PromptLab is an enterprise-grade developer workspace for prompt engineering, side-by-side multi-model experimentation, context window budgeting with LLM compaction, atomic quota governance, and distributed LLM observability.

---

## 1. Open Knowledge Base (OKF v0.2)

This repository adopts the **Google Open Knowledge Format (OKF v0.2)**, organizing domain knowledge, architectural choices, and operational runbooks into a traversable, agent-friendly documentation graph.

| Knowledge Area | Description | Direct Link |
| :--- | :--- | :--- |
| **Root Index** | Master entry point for human engineers and AI agents | [`docs/knowledge/index.md`](docs/knowledge/index.md) |
| **Architecture Decisions (ADRs)** | Formal records documenting 8 core architectural decisions (ADR-001 through ADR-008) | [`docs/knowledge/decisions/`](docs/knowledge/decisions/index.md) |
| **Domain Concepts** | Comprehensive specifications for templates, experiments, context compaction, quotas, and traces | [`docs/knowledge/concepts/`](docs/knowledge/concepts/index.md) |
| **System Architecture** | Multi-tier network topology, component interactions, and relational data schemas | [`docs/knowledge/architecture/`](docs/knowledge/architecture/index.md) |
| **Operational Runbooks** | Step-by-step setup, troubleshooting procedures, and automated test execution | [`docs/knowledge/operations/`](docs/knowledge/operations/index.md) |
| **Knowledge Evolution Log** | Chronological log of milestones and specification changes | [`docs/knowledge/log.md`](docs/knowledge/log.md) |

---

## 2. System Architecture

PromptLab employs a modular monolith architecture for the application backend paired with an isolated LiteLLM Proxy gateway and a high-density Angular 19 frontend adhering to the developer design system in [`DESIGN_SYSTEM.md`](DESIGN_SYSTEM.md).

```
 ┌────────────────────────────────────────────────────────────────────────┐
 │                   Angular 19 Frontend (Port 4200)                      │
 │   Prompt Studio   │   Model Comparison   │   Chats & Compaction       │
 │   Usage & Quotas  │   Tracing & Spans    │   System Settings (Health) │
 └───────────────────────────────────┬────────────────────────────────────┘
                                     │ HTTP REST + SSE (/api)
                                     │ CORS Origin: http://localhost:4200
 ┌───────────────────────────────────▼────────────────────────────────────┐
 │                  NestJS Modular Monolith (Port 3100)                   │
 │   - PromptsModule & Versions (Immutable)   - Context Compactor (LLM)   │
 │   - ExperimentsModule & A/B Engine        - QuotaLedger (ACID Two-Ph)  │
 │   - Privacy Redaction Engine               - W3C Distributed Context   │
 │   - SettingsModule (Read-Only Diagnostics) - HealthModule              │
 └─────────────────┬────────────────────────────────────┬─────────────────┘
                   │ Prisma ORM (Port 5432)             │ HTTP REST (Port 4000)
                   │ PostgreSQL Database                │ W3C traceparent
 ┌─────────────────▼───────────────┐  ┌─────────────────▼─────────────────┐
 │   PostgreSQL Database (5432)    │  │   LiteLLM Proxy Gateway (4000)    │
 │   - prompts & prompt_versions   │  │   - Unified OpenAI-compatible API │
 │   - experiments & ratings       │  │   - Model routing & rate limiting │
 │   - conversations & messages    │  │   - Upstream provider credentials │
 │   - quota_ledger & quota_policy │  │     strictly isolated server-side │
 └─────────────────────────────────┘  └─────────────────┬─────────────────┘
                                                        │
                                   ┌────────────────────┴────────────────────┐
                                   │ Upstream LLM Providers                  │
                                   │ - OpenAI API (gpt-4o-mini)              │
                                   │ - Anthropic API (claude-3-5-sonnet)     │
                                   └─────────────────────────────────────────┘
```

---

## 3. Implemented Capabilities Matrix (Phases 0–6)

| Capability Area | Core Features | Status |
| :--- | :--- | :--- |
| **Prompt Studio (`/prompts`)** | Composable techniques (`zero-shot`, `few-shot`, `RTF`, `structured-output`), dynamic `{{variable}}` extraction, live resolved preview, monospaced template editor, immutable version history with parent pointers, and provenance attribution (`provider-reported` vs `estimated`). | **Complete** |
| **Model Comparison (`/compare`)** | Multi-model concurrent A/B execution, slot parameter tuning (temperature 0–2, maxTokens 1–32K), October 2024 reference cost estimation, 1–5 star human rating, winner selection, and experiment registry. | **Complete** |
| **Conversations (`/conversations`)** | Multi-turn conversational threads, real-time context window budget consumption tracking with warning thresholds (70%/85%), and LLM-powered context compaction (Summarize & Truncate) that compresses dialogue history while preserving memory. | **Complete** |
| **Quota Governance (`/usage`)** | Monthly token allowance (default 100K), request rate limiting (60 req/min), atomic two-phase reservations (reserve $\rightarrow$ commit/release) preventing concurrent overdrafts, ambiguous timeout recovery protection, and immutable audit ledger. | **Complete** |
| **Observability (`/observability`)** | W3C distributed trace context (`traceparent`), in-memory trace buffer (100 spans) with latency breakdowns, OpenTelemetry OTLP/HTTP exporter, Langfuse exporter, and in-process privacy redaction masking API keys and bearer tokens. | **Complete** |
| **System Settings (`/settings`)** | High-density read-only dashboard actively probing LiteLLM gateway status and PostgreSQL latency, reporting configured models and effective quota policy with guaranteed zero secret exposure. | **Complete** |
| **Data Completeness** | Backward-compatible limit/offset pagination with deterministic multi-column sorting across all list endpoints; class-validator bounds (32KB text ceilings, model ID regex, runtime enums). | **Complete** |

---

## 4. Quickstart & Installation

### Prerequisites
- **Node.js:** v20.0+ (Verified on **v22.13.0**)
- **npm:** v10.0+ (Verified on **v10.9.2**)
- **PostgreSQL:** Running on port 5432 (`promptlab` database created)
- **Python:** v3.10+ (Verified on **v3.12** for local LiteLLM runner)

### Step 1: Environment Setup
```bash
cp .env.example .env
```
Ensure required parameters are defined:
- `PORT=3100`
- `CORS_ORIGIN=http://localhost:4200`
- `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/promptlab?schema=public`
- `LITELLM_PROXY_URL=http://localhost:4000`
- `LITELLM_MASTER_KEY=sk-promptlab-dev-key`

> [!NOTE]
> Provider API keys (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`) are optional for local offline testing (templating, variable preview, version history, context compaction simulation, quota tracking, tracing, and settings). Upstream keys are only required when dispatching live model completions.

### Step 2: Install Monorepo Dependencies
```bash
npm install
```

### Step 3: Initialize Database Schema (Prisma)
Generate client types and synchronize the PostgreSQL schema:
```bash
npm run prisma:generate
npm run prisma:push
```

### Step 4: Launch LiteLLM Gateway
```bash
npm run start:gateway
# Gateway health check: http://127.0.0.1:4000/health/liveliness
```

### Step 5: Launch Backend API
```bash
npm run start:api
# API health check: http://localhost:3100/api/health
```

### Step 6: Launch Web Frontend
```bash
npm run start:web
# Web Application URL: http://localhost:4200
```

---

## 5. Verification Commands

All quality gates are automated and executed from the repository root:

| Command | Workspace Scope | Verified Status |
| :--- | :--- | :--- |
| `npm run test:api` | `@promptlab/api` Jest test suite | **PASS** (12 suites, 107 tests passing) |
| `npm run test:web` | `@promptlab/web` Karma/Jasmine headless suite | **PASS** (46 specs passing) |
| `npm run test` | Full monorepo test suite | **PASS** (153 total automated tests) |
| `npm run typecheck` | Strict TypeScript compiler validation (`tsc --noEmit`) | **PASS** (0 type errors) |
| `npm run lint` | ESLint static analysis across workspaces | **PASS** (0 warnings, 0 errors) |
| `npm run build` | Production bundle generation (NestJS + Angular) | **PASS** (Optimized production bundles) |

---

## 6. Primary API Endpoints

All backend endpoints are prefixed with `/api`:

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/health` | Active service health probe (PostgreSQL latency & LiteLLM liveliness) |
| `GET` | `/api/settings` | Read-only system configuration, gateway models, and effective quota policy |
| `GET` | `/api/prompts` | List prompt templates (supports `limit`, `offset`, `search`, `technique`) |
| `POST` | `/api/prompts` | Create a new prompt template with initial version `v1` |
| `POST` | `/api/prompts/:id/versions` | Append an immutable prompt version (`v2`, `v3`...) |
| `POST` | `/api/prompts/run` | Execute playground completion via LiteLLM with provenance metrics |
| `GET` | `/api/experiments` | List comparison experiments (supports `limit`, `offset`) |
| `POST` | `/api/experiments/compare` | Run side-by-side A/B execution with concurrent slot execution |
| `POST` | `/api/experiments/:id/rate` | Assign 1–5 star human rating and winning slot |
| `GET` | `/api/conversations` | List conversational threads (supports `limit`, `offset`) |
| `POST` | `/api/conversations` | Create conversational thread with custom context token budget |
| `POST` | `/api/conversations/:id/compact` | Perform LLM Summarize & Truncate context compaction |
| `GET` | `/api/usage/status` | Current quota consumption, remaining tokens, and rate limits |
| `GET` | `/api/usage/ledger` | Query immutable transaction audit ledger |
| `POST` | `/api/usage/reset-demo` | Reset usage counters for demonstration and test workflows |
| `GET` | `/api/observability/traces` | Retrieve buffered in-memory spans with latency breakdowns |
| `GET` | `/api/observability/status` | Current telemetry exporter status and privacy redaction state |

---

## 7. Additional Documentation

- **[10-Step Walkthrough Demo Script](docs/demo-script.md):** Complete reproducible demonstration covering all primary workflows.
- **[Known Technical Limitations](docs/known-limitations.md):** Transparent catalog of non-production boundaries (single-tenant developer mode, reference pricing assumptions, and external exporter verification status).
- **[Design System Guidelines](DESIGN_SYSTEM.md):** Aesthetic specification for restrained, dense, developer-oriented UI components.
- **[Implementation Plan](IMPLEMENTATION_PLAN.md):** Original phase-by-phase engineering plan and acceptance criteria.
