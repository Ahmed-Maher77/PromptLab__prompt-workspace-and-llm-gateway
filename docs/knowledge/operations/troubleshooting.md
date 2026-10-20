---
type: Guide
title: "Troubleshooting Guide"
description: "Diagnosing and resolving common setup, network, database, and gateway issues"
status: active
domain: "operations"
---

# Troubleshooting Guide

## 1. Port Collisions (Port 3100, 4000, or 4200)
- **Symptom:** `EADDRINUSE: address already in use :::3100` or `Errno 10048` when launching services.
- **Resolution:**
  - Find and terminate lingering Node or Python processes:
    - *Windows (PowerShell):* `Get-Process -Id (Get-NetTCPConnection -LocalPort 3100).OwningProcess | Stop-Process`
    - *Linux/macOS:* `lsof -ti:3100 | xargs kill -9`
  - Alternatively, modify `PORT` in `.env` and `apps/web/proxy.conf.json`.

## 2. LiteLLM Gateway Unreachable (`502 Bad Gateway` / `gateway_unreachable`)
- **Symptom:** The `/settings` page shows Gateway `Disconnected`, or running prompts reports `gateway_unreachable`.
- **Resolution:**
  - Verify that LiteLLM is running on port 4000: navigate to `http://127.0.0.1:4000/health/liveliness`.
  - Ensure the Python virtual environment has installed required packages:
    ```bash
    cd infra/litellm && pip install -r requirements.txt
    ```
  - Check that `infra/litellm/config.yaml` is valid YAML.

## 3. PostgreSQL Database Connection Failure
- **Symptom:** API fails at startup with `[Startup Error] Missing mandatory environment configuration: DATABASE_URL` or Prisma throws connection refused.
- **Resolution:**
  - Verify PostgreSQL service is active on port 5432:
    ```bash
    psql -h localhost -U postgres -d promptlab
    ```
  - If the database `promptlab` does not exist, create it: `CREATE DATABASE promptlab;`.
  - Re-run schema push: `npm run prisma:push`.

## 4. CORS Errors in Browser Console
- **Symptom:** `Access to XMLHttpRequest at 'http://localhost:3100/api/...' from origin 'http://localhost:4200' has been blocked by CORS policy`.
- **Resolution:**
  - Ensure `.env` includes `CORS_ORIGIN=http://localhost:4200`.
  - If accessing from a custom host/domain, add comma-separated origins: `CORS_ORIGIN=http://localhost:4200,http://127.0.0.1:4200`.
