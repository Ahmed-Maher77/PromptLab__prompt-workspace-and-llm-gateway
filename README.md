# PromptLab — Prompt Engineering & LLM Gateway POC

PromptLab is a developer-focused workspace for prompt engineering, model experimentation, context compaction, and LLM gateway observability.

## Architecture

PromptLab uses a modular monolith architecture for the application backend with a separate LiteLLM Proxy gateway:

- **Frontend (`apps/web`):** Angular 19 + TypeScript standalone application adhering to the restrained, high-density developer design system in [`DESIGN_SYSTEM.md`](DESIGN_SYSTEM.md).
- **Backend (`apps/api`):** NestJS modular monolith with strict domain boundaries (`health`, `prompts`, `providers`, `experiments`, `conversations`, `context`, `usage`, `observability`).
- **Database & ORM:** PostgreSQL managed via Prisma (`apps/api/prisma/schema.prisma`).
- **Gateway:** LiteLLM Proxy routing model requests with server-side secrets management.

See [`docs/architecture.md`](docs/architecture.md) for detailed architecture documentation.

## Prerequisites

- **Node.js:** v20+ (Node v22 recommended)
- **npm:** v10+
- **PostgreSQL:** Running locally on port 5432 or via Docker Compose.
- **Python 3.10+:** (Optional/Local) for running local LiteLLM Proxy, or Docker Desktop.

## Quickstart

### 1. Configure Environment

Copy the example environment file:
```bash
cp .env.example .env
```
Ensure `DATABASE_URL` matches your PostgreSQL configuration (default: `postgresql://postgres:postgres@localhost:5432/promptlab?schema=public`).
Ensure provider keys (e.g. `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`) are set for live provider completions.

### 2. Install Dependencies

Install all monorepo dependencies across the workspace:
```bash
npm install
```

### 3. Setup Database (Prisma)

Generate the Prisma Client and push schema to PostgreSQL:
```bash
npm run prisma:generate
npm run prisma:push
```

### 4. Start LiteLLM Gateway

Start the LiteLLM Proxy (runs on port 4000):
```bash
npm run start:gateway
# Or using Docker:
docker compose up -d litellm
```
Check gateway liveliness: `http://127.0.0.1:4000/health/liveliness`

### 5. Run the Applications

Start the backend API (runs on port 3100):
```bash
npm run start:api
```
Check health endpoint: [http://localhost:3100/api/health](http://localhost:3100/api/health)

Start the Angular frontend (runs on port 4200):
```bash
npm run start:web
```
Open browser at: [http://localhost:4200](http://localhost:4200)

---

## Phase 1: Prompt Studio

PromptLab Phase 1 introduces the complete Prompt Studio vertical slice:

- **Prompt Library:** Filterable data table of prompt templates, composable technique badges (`zero-shot`, `one-shot`, `few-shot`, `RTF`, `structured-output`, `custom`), latest immutable version, and last updated timestamps.
- **Composable Techniques:** Techniques are treated as composable metadata tags rather than mutually exclusive categories.
- **Template Authoring:** Monospaced template editor strictly preserving whitespace, line breaks, and indentation.
- **Dynamic Variable Extraction & Resolution:** Detects `{{variable_name}}` tokens, validates required variables prior to execution, and provides test sample values.
- **Immutable Versioning:** Each save of updated template content creates a new immutable version (v1, v2, v3...) without mutating or deleting historical versions. Includes full version audit timeline.
- **Live Resolved Preview:** Real-time preview of exact assembled prompt text with character count and estimated token metrics.
- **LiteLLM Gateway Playground:** Executes completions through the configured model (e.g. `gpt-4o-mini`, `claude-3-5-sonnet`), capturing response text, latency in ms, and token usage with honest provenance labels (`provider-reported` vs `estimated`).
- **Provider Credential Handling:** If upstream provider API keys are unconfigured, displays an explicit configuration notice rather than an opaque crash or fake success.

## Available Scripts

| Command | Description |
|---|---|
| `npm run start:api` | Starts NestJS API development server on port 3100 |
| `npm run start:web` | Starts Angular development server on port 4200 |
| `npm run start:gateway` | Starts LiteLLM Proxy gateway on port 4000 |
| `npm run build` | Builds both API and Web production bundles |
| `npm run build:api` | Builds NestJS API bundle |
| `npm run build:web` | Builds Angular production bundle |
| `npm run test` | Runs unit tests across API and Web |
| `npm run test:api` | Runs Jest unit tests for backend API |
| `npm run typecheck` | Validates TypeScript types across the monorepo |
| `npm run lint` | Runs linters across the codebase |
| `npm run prisma:generate` | Generates Prisma client types |
| `npm run prisma:push` | Pushes Prisma schema to database |

## Design & Implementation Specs

- **Design System:** [`DESIGN_SYSTEM.md`](DESIGN_SYSTEM.md)
- **Implementation Plan:** [`IMPLEMENTATION_PLAN.md`](IMPLEMENTATION_PLAN.md)
- **System Architecture:** [`docs/architecture.md`](docs/architecture.md)
