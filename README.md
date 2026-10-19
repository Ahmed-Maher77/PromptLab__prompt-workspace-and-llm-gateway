# PromptLab — Prompt Engineering & LLM Gateway POC

PromptLab is a developer-focused workspace for prompt engineering, model experimentation, context compaction, and LLM gateway observability.

## Architecture

PromptLab uses a modular monolith architecture for the application backend with a separate LiteLLM Proxy gateway:

- **Frontend (`apps/web`):** Angular 19 + TypeScript standalone application adhering to the restrained, high-density developer design system in [`DESIGN_SYSTEM.md`](DESIGN_SYSTEM.md).
- **Backend (`apps/api`):** NestJS modular monolith with strict domain boundaries (`health`, `prompts`, `experiments`, `conversations`, `context`, `usage`, `observability`).
- **Database & ORM:** PostgreSQL managed via Prisma (`apps/api/prisma/schema.prisma`).
- **Gateway:** LiteLLM Proxy routing model requests with server-side secrets management.

See [`docs/architecture.md`](docs/architecture.md) for detailed architecture documentation.

## Prerequisites

- **Node.js:** v20+ (Node v22 recommended)
- **npm:** v10+
- **PostgreSQL:** Running locally on port 5432 or via Docker Compose.
- **Docker Compose:** (Optional) for running PostgreSQL and LiteLLM Proxy services.

## Quickstart

### 1. Configure Environment

Copy the example environment file:
```bash
cp .env.example .env
```
Ensure `DATABASE_URL` matches your PostgreSQL configuration (default: `postgresql://postgres:postgres@localhost:5432/promptlab?schema=public`).

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

### 4. Run the Applications

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

## Available Scripts

| Command | Description |
|---|---|
| `npm run start:api` | Starts NestJS API development server |
| `npm run start:web` | Starts Angular development server |
| `npm run build` | Builds both API and Web applications |
| `npm run test` | Runs unit tests across API and Web |
| `npm run typecheck` | Validates TypeScript types across the monorepo |
| `npm run lint` | Runs linters across the codebase |
| `npm run prisma:generate` | Generates Prisma client types |
| `npm run prisma:push` | Pushes Prisma schema to database |

## Design & Implementation Specs

- **Design System:** [`DESIGN_SYSTEM.md`](DESIGN_SYSTEM.md)
- **Implementation Plan:** [`IMPLEMENTATION_PLAN.md`](IMPLEMENTATION_PLAN.md)
