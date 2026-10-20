# PromptLab — Prompt Engineering & LLM Gateway POC

PromptLab is a developer-focused workspace for prompt engineering, side-by-side model experimentation, conversational context compaction, quota governance, and LLM gateway observability.

---

## 1. Architecture & Implemented Capabilities (Phases 0–6)

PromptLab follows a modular monolith architecture for the backend paired with a standalone LiteLLM Proxy gateway and an Angular frontend adhering to the restrained, high-density developer design system in [`DESIGN_SYSTEM.md`](DESIGN_SYSTEM.md).

```
 ┌────────────────────────────────────────────────────────┐
 │           Angular 19 Frontend (Port 4200)              │
 │  Prompt Studio | Comparison | Chats | Quotas | Traces │
 └───────────────────────────┬────────────────────────────┘
                             │ HTTP (REST + SSE)
 ┌───────────────────────────▼────────────────────────────┐
 │           NestJS Modular Backend (Port 3100)           │
 │  - Prompts & Immutable Versions   - Context Compactor  │
 │  - A/B Experiments & Pricing      - Quota Ledger (ACID)│
 │  - Privacy Redaction Engine       - W3C Distributed Tx │
 └─────────────┬───────────────────────────┬──────────────┘
               │ Prisma ORM                │ HTTP Proxy
 ┌─────────────▼─────────────┐ ┌───────────▼──────────────┐
 │ PostgreSQL Database (5432)│ │ LiteLLM Proxy (Port 4000)│
 │ - Templates & Versions    │ │ - Model Routing          │
 │ - Experiments & Ratings   │ │ - OpenAI, Anthropic      │
 │ - Conversations & Messages│ │ - Server-Side Secrets    │
 │ - Quota Ledger & Policy   │ └──────────────────────────┘
 └───────────────────────────┘
```

### Key Capabilities Implemented
- **Phase 1 — Prompt Studio (`/prompts`):** Composable prompt techniques (`zero-shot`, `few-shot`, `RTF`, `structured-output`), dynamic `{{variable}}` extraction, live resolved preview, monospaced template editing, immutable version history, and single-prompt playground with provenance labeling (`provider-reported` vs `estimated`).
- **Phase 2 — Model Comparison & Experimentation (`/compare`):** Multi-model side-by-side A/B execution, latency/token metrics, October 2024 configurable reference cost estimates, output rating (1–5 stars), winner selection, and experiment history with limit/offset pagination.
- **Phase 3 — Conversational Workspace & Compaction (`/conversations`):** Multi-turn conversational threads, real-time context window budget consumption monitoring, and LLM-powered context compaction (Summarize & Truncate) that distills chat history while preserving essential memory.
- **Phase 4 — Quotas & Budget Governance (`/usage`):** Monthly token limits, request rate limits, atomic quota reservations (reserve $\rightarrow$ commit / release) preventing race conditions, ambiguous-timeout usage protection, an immutable audit ledger, and demo period reset simulation.
- **Phase 5 — Observability & Privacy Redaction (`/observability`):** W3C distributed trace context propagation (`traceparent`), OpenTelemetry (`OTLP/HTTP`) and Langfuse exporters, in-memory trace buffer with latency breakdowns, and a privacy redaction engine masking API keys, bearer tokens, and sensitive headers.
- **Phase 6 — Hardening, UI & Data Completeness (`/settings`):** Read-only System Settings page displaying live gateway connectivity, PostgreSQL health/latency, effective quota policies, and safe configuration status with zero credential exposure; backward-compatible limit/offset pagination; and strict input validation.

---

## 2. Prerequisites & Verified Environments

| Component | Minimum Required | Verified Version |
| :--- | :--- | :--- |
| **Node.js** | v20.0.0+ | **v22.13.0** |
| **npm** | v10.0.0+ | **v10.9.2** |
| **PostgreSQL** | v15.0+ | **v18.0** / Docker PostgreSQL |
| **Python** | v3.10+ | **v3.12** (for local LiteLLM runner) |

---

## 3. Environment Configuration

Copy the template configuration file:
```bash
cp .env.example .env
```

### Environment Variables Matrix

| Variable | Required? | Default | Purpose |
| :--- | :--- | :--- | :--- |
| `NODE_ENV` | Optional | `development` | Runtime environment mode |
| `PORT` | **Required** | `3100` | Port for the NestJS backend API |
| `CORS_ORIGIN` | Optional | `http://localhost:4200` | Allowed frontend origin for CORS |
| `DATABASE_URL` | **Required** | `postgresql://postgres:postgres@localhost:5432/promptlab?schema=public` | PostgreSQL connection string |
| `LITELLM_PROXY_URL` | **Required** | `http://localhost:4000` | LiteLLM Proxy endpoint |
| `LITELLM_MASTER_KEY`| **Required** | `sk-promptlab-dev-key` | Master key for LiteLLM internal requests |
| `OPENAI_API_KEY` | Optional* | *empty* | Upstream OpenAI key (*needed for live OpenAI completions) |
| `ANTHROPIC_API_KEY` | Optional* | *empty* | Upstream Anthropic key (*needed for live Claude completions) |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Optional | `http://localhost:4318` | Target OTLP/HTTP collector endpoint |
| `LANGFUSE_PUBLIC_KEY` | Optional | *empty* | Langfuse project public key |
| `LANGFUSE_SECRET_KEY` | Optional | *empty* | Langfuse project secret key |
| `LANGFUSE_HOST` | Optional | `http://localhost:3001` | Langfuse host URL |

> [!NOTE]
> All provider API keys and secrets are loaded **strictly server-side**. The frontend communicates exclusively with the NestJS API via `/api/*` proxies and never receives or handles upstream provider keys.

---

## 4. Setup & Initialization

### Step 1: Install Monorepo Dependencies
```bash
npm install
```

### Step 2: Initialize Database Schema (Prisma)
Generate the Prisma client types and push the schema directly to PostgreSQL:
```bash
npm run prisma:generate
npm run prisma:push
```

> [!IMPORTANT]
> The current POC uses `prisma db push` (`npm run prisma:push`) to synchronize the PostgreSQL schema directly with `apps/api/prisma/schema.prisma`. It **does not** utilize versioned Prisma migrations (`prisma migrate`). Schema alterations should be managed through `prisma db push` during development.

### Step 3: Start LiteLLM Gateway
The gateway routes requests to supported LLMs (`gpt-4o-mini`, `claude-3-5-sonnet`):
```bash
npm run start:gateway
```
*Health check:* [http://127.0.0.1:4000/health/liveliness](http://127.0.0.1:4000/health/liveliness)

### Step 4: Start Backend API
```bash
npm run start:api
```
*Health check:* [http://localhost:3100/api/health](http://localhost:3100/api/health)

### Step 5: Start Web Frontend
```bash
npm run start:web
```
*Web application URL:* [http://localhost:4200](http://localhost:4200)

---

## 5. Verification & Testing Commands

All scripts are executed from the monorepo root:

| Command | Action |
| :--- | :--- |
| `npm run test` | Runs the full test suite across both API and Web |
| `npm run test:api` | Runs Jest unit & integration tests for `@promptlab/api` |
| `npm run test:web` | Runs Karma/Jasmine headless unit tests for `@promptlab/web` |
| `npm run typecheck` | Validates TypeScript compiler types across all workspaces (`tsc --noEmit`) |
| `npm run lint` | Runs ESLint validation across both workspaces |
| `npm run build` | Generates production bundles for both backend and frontend |

---

## 6. Accessing the Application & Settings

- **Prompt Studio:** [http://localhost:4200/prompts](http://localhost:4200/prompts)
- **Model Comparison (A/B):** [http://localhost:4200/compare](http://localhost:4200/compare)
- **Conversations & Compaction:** [http://localhost:4200/conversations](http://localhost:4200/conversations)
- **Usage & Quotas:** [http://localhost:4200/usage](http://localhost:4200/usage)
- **Observability & Tracing:** [http://localhost:4200/observability](http://localhost:4200/observability)
- **System Settings (Read-Only):** [http://localhost:4200/settings](http://localhost:4200/settings)

---

## 7. Troubleshooting Common Issues

1. **Port 3100 or 4000 already in use:**
   - Verify if an existing Node or Python process is running. Terminate any orphan processes or modify `PORT` in `.env` and `apps/web/proxy.conf.json`.
2. **LiteLLM Gateway Unreachable (`502 Bad Gateway`):**
   - Ensure the Python virtual environment has installed `infra/litellm/requirements.txt`:
     ```bash
     cd infra/litellm && pip install -r requirements.txt
     ```
   - Confirm LiteLLM is listening on port 4000 by navigating to `http://127.0.0.1:4000/health/liveliness`.
3. **PostgreSQL Connection Refused:**
   - Verify PostgreSQL service status on port 5432 and ensure the database `promptlab` exists.
   - Run `npx prisma db push` to verify schema connectivity.
4. **CORS Errors in Browser Console:**
   - The backend defaults to allowing `http://localhost:4200`. If accessing the frontend from a different origin, set `CORS_ORIGIN=http://your-host:your-port` in `.env`.

---

## 8. Documentation Index

- **Walkthrough Demo Script:** [`docs/demo-script.md`](docs/demo-script.md) (10-step scripted end-to-end demonstration).
- **Known Limitations:** [`docs/known-limitations.md`](docs/known-limitations.md) (comprehensive catalog of non-production boundaries).
- **Architecture Overview:** [`docs/architecture.md`](docs/architecture.md).
- **Observability Architecture:** [`docs/observability.md`](docs/observability.md).
- **Design System Guidelines:** [`DESIGN_SYSTEM.md`](DESIGN_SYSTEM.md).
- **Implementation Plan:** [`IMPLEMENTATION_PLAN.md`](IMPLEMENTATION_PLAN.md).
