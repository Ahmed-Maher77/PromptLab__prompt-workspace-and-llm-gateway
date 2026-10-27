---
type: Guide
title: "Local Development Setup Runbook"
description: "Step-by-step procedure to configure, initialize, and run PromptLab locally"
status: active
domain: "operations"
---

# Local Development Setup Runbook

## Prerequisites
- **Node.js:** v20.0+ (Tested on v22.13.0)
- **npm:** v10.0+ (Tested on v10.9.2)
- **PostgreSQL:** Running on port 5432 (`promptlab` database created)
- **Python:** v3.10+ (for local LiteLLM runner)

## Step 1: Environment Setup
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```
Ensure required parameters are present:
- `PORT=3100`
- `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/promptlab?schema=public`
- `LITELLM_PROXY_URL=http://localhost:4000`
- `LITELLM_MASTER_KEY=sk-promptlab-dev-key`
- `AUTH_DEV_TOKENS_ENABLED=true`
- `AUTH_DEV_ADMIN_TOKEN=dev-admin-token`
- `AUTH_DEV_USER_TOKEN=dev-user-token`
- `AUTH_API_KEYS=dev-admin-key:dev-user-001:admin,dev-user-key:user-002:user`
- `AUTH_JWT_SECRET=promptlab-dev-jwt-secret-at-least-32-chars-long!`

## Step 2: Install Workspace Dependencies
```bash
npm install
```

## Step 3: Initialize Database Schema
Generate Prisma client and apply versioned migrations to PostgreSQL:
```bash
npm run prisma:generate
npm run prisma:push # runs prisma migrate deploy
npm run seed        # optional: default developer user + reference prompt templates
```
The seed is idempotent: running it again skips prompts that already exist. The API itself no longer writes demo data on startup.

## Step 4: Start LiteLLM Gateway
In a terminal, start the gateway:
```bash
npm run start:gateway
# Or using docker compose:
docker compose up -d litellm
```
Verify liveliness: [http://127.0.0.1:4000/health/liveliness](http://127.0.0.1:4000/health/liveliness)

## Step 5: Start Backend API
In another terminal, start the NestJS backend:
```bash
npm run start:api
```
Verify health: [http://localhost:3100/api/health](http://localhost:3100/api/health)

## Step 6: Start Web Frontend
In another terminal, launch the Angular application:
```bash
npm run start:web
```
Open browser at [http://localhost:4200](http://localhost:4200).
Navigate to [http://localhost:4200/settings](http://localhost:4200/settings) to confirm all services report healthy status.
