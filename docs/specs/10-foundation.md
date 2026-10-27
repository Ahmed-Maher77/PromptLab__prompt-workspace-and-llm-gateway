---
type: spec
id: SPEC-10
title: "Foundation"
description: "Monorepo, configuration validation, migrations, health probes and the local and containerised runtime"
status: implemented
domain: "platform"
last_updated: "2026-10-27"
---

# SPEC-10: Foundation

## Summary

The foundation is an npm-workspaces monorepo with an Angular app and a NestJS API, a Prisma-managed PostgreSQL schema, validated configuration, health probes, and two ways to run the stack: Docker Compose or local processes. It establishes the lint, typecheck, test and build commands that every other capability relies on.

## Scope

- Repository layout: `apps/api`, `apps/web`, `e2e`, `infra/litellm`, `docs` ([layout](../../README.md#repository-layout)).
- Environment validation at startup and a safe example configuration ([.env.example](../../.env.example)).
- Versioned database migrations and an opt-in, idempotent seed of reference prompts.
- Health endpoints for liveness, readiness and diagnostics.
- A Docker Compose stack with health-gated startup, and local development scripts.
- Root commands for lint, typecheck, tests, build and dependency audit.
- Design tokens from [DESIGN_SYSTEM.md](../../DESIGN_SYSTEM.md) implemented as CSS custom properties.

## Requirements

- The API MUST validate its configuration once at startup and refuse to start when a required value is missing or invalid. Any `NODE_ENV` other than `development` or `test` MUST be treated as production.
- In production, `LITELLM_MASTER_KEY`, API keys and the JWT secret MUST NOT be missing, shorter than 32 characters (keys and JWT secret) or equal to a known example value. `TRUST_PROXY=true` MUST be rejected.
- `.env.example` MUST contain placeholders only. Real secrets MUST NOT be committed, and `.env` MUST be ignored by version control.
- Schema changes MUST be made as new migrations. Existing migrations MUST NOT be edited.
- The container entrypoint MUST apply migrations before the API starts. Demo data MUST be loaded only when `SEED_DEMO_DATA=true`, and loading it MUST be idempotent.
- `GET /api/health/live` MUST NOT depend on any external service. `GET /api/health/ready` MUST return 503 when PostgreSQL or the gateway is unreachable. `GET /api/health` MUST keep answering 200 with a degraded status so the Overview page can render, and it MUST return a reduced body to callers that are not administrators.
- Compose services MUST start in dependency order, each waiting for its dependency to report healthy. Published ports MUST be bound to `127.0.0.1`.
- Compose MUST define only the services the stack needs: `postgres`, `litellm`, `api`, `web`.

## Acceptance criteria

| # | Criterion | Status | Evidence |
| :--- | :--- | :--- | :--- |
| 1 | The application and API start with the documented commands, either through Docker Compose or as local processes. | ✅ Met | [Getting started](../../README.md#getting-started); [docker-compose.yml](../../docker-compose.yml) (`depends_on` with `service_healthy`); [docker-entrypoint.sh](../../apps/api/docker-entrypoint.sh); root scripts in [package.json](../../package.json) (`start:api`, `start:web`, `start:gateway`); [ADR-014](../knowledge/decisions/adr-014-containerized-stack.md). CI validates the Compose file and builds both images. |
| 2 | Database migrations apply to an empty database. | ✅ Met | Eleven migrations in [prisma/migrations](../../apps/api/prisma/migrations); `prisma migrate deploy` in the entrypoint and as `prisma:deploy`; the CI step "Apply database migrations" runs on a fresh PostgreSQL 16 service ([ci.yml](../../.github/workflows/ci.yml)). Integration tests exercise data-carrying migrations (*de-duplicates existing duplicate sequence rows during the sequence-uniqueness migration*, *migration moves existing settings-JSON ratings into the new table*) in [app.integration.spec.ts](../../apps/api/src/app.integration.spec.ts). |
| 3 | The health endpoints work and have distinct contracts. | ✅ Met | [health.controller.ts](../../apps/api/src/health/health.controller.ts), [health.service.ts](../../apps/api/src/health/health.service.ts); [ADR-015](../knowledge/decisions/adr-015-health-probes-and-gateway-resilience.md). Tests: *GET /api/health/live answers 200 without credentials or dependency checks*, *GET /api/health/ready answers 503 with the failing dependency when the gateway is down*, *GET /api/health keeps answering 200 for the UI even when the gateway is down* (integration); *live still returns ok when the database and gateway are down*, *returns only the reduced payload to anonymous callers* ([health.controller.spec.ts](../../apps/api/src/health/health.controller.spec.ts)). |
| 4 | No secrets are committed, and unsafe defaults are refused in production. | ✅ Met | [.env.example](../../.env.example) holds placeholders and development-only values; `.env` is listed in [.gitignore](../../.gitignore); `KNOWN_EXAMPLE_SECRETS` and the production checks in [env.validation.ts](../../apps/api/src/common/config/env.validation.ts), covered by [env.validation.spec.ts](../../apps/api/src/common/config/env.validation.spec.ts). Compose requires `POSTGRES_PASSWORD` and `LITELLM_MASTER_KEY` to be set. |
| 5 | Environment variables are validated, and an example configuration documents them. | ✅ Met | `validateEnvironment` in [env.validation.ts](../../apps/api/src/common/config/env.validation.ts) (ranges for `QUOTA_TIMEOUT_CHARGE_RATIO`, `MODEL_CATALOG_TTL_MS`, `TRUST_PROXY`, API key format); [Configuration](../../README.md#configuration); [env.validation.spec.ts](../../apps/api/src/common/config/env.validation.spec.ts). |
| 6 | Lint, typecheck, test and build commands exist at the repository root, and baseline checks pass. | ✅ Met | Scripts `lint`, `typecheck`, `test:unit`, `test:integration`, `test:web`, `test:e2e`, `build`, `audit` in [package.json](../../package.json); formatter script `format` in [apps/api/package.json](../../apps/api/package.json); all run as CI gates in [ci.yml](../../.github/workflows/ci.yml). `npm run lint` was run clean when these specifications were written. |
| 7 | A README documents local setup and the architecture. | ✅ Met | [README.md](../../README.md): Architecture, Getting started, Configuration, API reference, Testing and CI. |
| 8 | Docker Compose contains only the services the stack needs. | ✅ Met | [docker-compose.yml](../../docker-compose.yml) defines `postgres`, `litellm`, `api` and `web`. Telemetry backends and caches are not part of it. |
| 9 | Reference data is loaded only on request and repeated loading is safe. | ✅ Met | [seed.ts](../../apps/api/src/database/seed.ts), [reference-prompts.ts](../../apps/api/src/database/reference-prompts.ts); the entrypoint seeds only when `SEED_DEMO_DATA=true`; [seed.spec.ts](../../apps/api/src/database/seed.spec.ts). |
| 10 | The design tokens in the design system are available to every page. | ✅ Met | Custom properties (`--color-*`, `--space-*`, `--radius-*`, font families) in [styles.css](../../apps/web/src/styles.css), consumed by the page stylesheets. Fonts are self-hosted through `@fontsource` packages, so the app makes no third-party requests ([ADR-014](../knowledge/decisions/adr-014-containerized-stack.md)). |

## Tests

- API configuration: [env.validation.spec.ts](../../apps/api/src/common/config/env.validation.spec.ts)
- Health: [health.controller.spec.ts](../../apps/api/src/health/health.controller.spec.ts), [health.service.spec.ts](../../apps/api/src/health/health.service.spec.ts), and the *liveness and readiness probes* group in [app.integration.spec.ts](../../apps/api/src/app.integration.spec.ts)
- Database client and seed: [prisma.service.spec.ts](../../apps/api/src/prisma/prisma.service.spec.ts), [seed.spec.ts](../../apps/api/src/database/seed.spec.ts)
- Overview page and health client: [overview.component.spec.ts](../../apps/web/src/app/pages/overview/overview.component.spec.ts), [health.service.spec.ts](../../apps/web/src/app/services/health.service.spec.ts)
- Pipeline: [ci.yml](../../.github/workflows/ci.yml)

## Related

- Concepts: none specific; see [operations runbooks](../knowledge/operations/index.md)
- ADRs: [ADR-014](../knowledge/decisions/adr-014-containerized-stack.md), [ADR-015](../knowledge/decisions/adr-015-health-probes-and-gateway-resilience.md), [ADR-018](../knowledge/decisions/adr-018-angular-22-upgrade.md)
- README: [Getting started](../../README.md#getting-started), [Configuration](../../README.md#configuration), [Testing and CI](../../README.md#testing-and-ci)
- Local setup: [local-development.md](../knowledge/operations/local-development.md), [troubleshooting.md](../knowledge/operations/troubleshooting.md)
- Index: [README](./README.md)
