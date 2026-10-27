---
type: spec
id: SPEC-01
title: "Engineering Standards"
description: "Engineering rules the PromptLab codebase follows and the mechanism that applies each one"
status: active
domain: "engineering"
last_updated: "2026-10-27"
---

# SPEC-01: Engineering Standards

## Summary

These are the rules the codebase is built and changed under. Each rule names the mechanism that applies it, such as a test suite, a CI gate or an architecture decision record, so the rule can be checked rather than taken on trust.

## Standards

### 1. Understand the existing system before changing it

Changes start from the current code, tests, commands and recorded decisions.

**How it is applied.** Architecture decisions are recorded with context, alternatives and consequences in [docs/knowledge/decisions](../knowledge/decisions/index.md). The [knowledge index](../knowledge/index.md) tells contributors to consult them before proposing structural changes.

### 2. Extend working choices instead of replacing them

A working framework or pattern is extended unless there is a recorded reason to change it.

**How it is applied.** The backend stayed a modular monolith ([ADR-001](../knowledge/decisions/adr-001-modular-monolith-nestjs.md)). Framework upgrades follow the vendor's official migrations and are recorded, for example the Angular 19 to 22 move in [ADR-018](../knowledge/decisions/adr-018-angular-22-upgrade.md).

### 3. Follow the design system for all UI work

The interface follows [DESIGN_SYSTEM.md](../../DESIGN_SYSTEM.md): a restrained neutral palette, dense layouts, shared patterns for tables, dialogs and states, visible focus and labelled controls.

**How it is applied.** The design tokens are CSS custom properties in [styles.css](../../apps/web/src/styles.css), and page stylesheets consume them. Dialogs share one accessibility directive ([dialog.directive.ts](../../apps/web/src/app/shared/a11y/dialog.directive.ts)) and feedback components ([toast](../../apps/web/src/app/shared/feedback/toast.service.ts), [confirm](../../apps/web/src/app/shared/feedback/confirm.service.ts)). Conformance is reviewed by people; there is no automated design-system check.

### 4. Ship in working vertical slices and keep the build green

Each change leaves the application buildable and runnable.

**How it is applied.** [ci.yml](../../.github/workflows/ci.yml) runs on every push to `main` or a `remediation/**` branch and on pull requests into `main`. It runs lint, typecheck, API unit tests, web unit tests, production builds, migrations against PostgreSQL 16, API integration tests and a dependency audit. A second job validates the Compose file and builds both images. Migrations are only ever added, never edited ([Data model](../../README.md#data-model)).

### 5. No fake functionality

The product has no dead controls, fabricated metrics, pretend provider responses or mock data presented as real.

**How it is applied.**
- When the gateway or a provider credential is missing, the API returns a typed error with a configuration hint ([providers.service.ts](../../apps/api/src/providers/providers.service.ts)) and the UI shows it.
- Cost is `null` when no price is known, and the comparison page renders a cost only when it is present.
- Demo-only endpoints (`POST /api/usage/reset`, `POST /api/observability/clear`) work only when `NODE_ENV` is `development` or `test` and `ENABLE_DEMO_ENDPOINTS=true` ([env.validation.ts](../../apps/api/src/common/config/env.validation.ts)).
- Reference prompts are loaded only when seeding is requested (`SEED_DEMO_DATA` or `npm run seed`).

### 6. Prefer simple architecture

Product logic lives in one NestJS application with separated domain modules. Provider access goes through a separately deployed LiteLLM proxy.

**How it is applied.** [ADR-001](../knowledge/decisions/adr-001-modular-monolith-nestjs.md) and [ADR-002](../knowledge/decisions/adr-002-litellm-proxy-gateway.md). There are no queues, vector stores or orchestration frameworks. Cross-instance safety for quotas comes from PostgreSQL ([ADR-004](../knowledge/decisions/adr-004-atomic-quota-reservations.md)), not from a cache or lock service.

### 7. Security first

Provider keys stay in the gateway. Input is validated, authorisation is enforced on the server, and telemetry is redacted.

**How it is applied.**
- Startup validation rejects missing, short or example secrets in production, and development tokens work only in `development` or `test` ([env.validation.spec.ts](../../apps/api/src/common/config/env.validation.spec.ts)).
- A global guard chain handles IP throttling, authentication, roles and per-user throttling ([app.module.ts](../../apps/api/src/app.module.ts)).
- Request bodies pass a global `ValidationPipe` with `whitelist` and `forbidNonWhitelisted`, and a 256 kB body limit ([configure-app.ts](../../apps/api/src/configure-app.ts)).
- Telemetry passes through [redaction.util.ts](../../apps/api/src/observability/redaction.util.ts) before it is buffered or exported ([ADR-006](../knowledge/decisions/adr-006-privacy-redaction-engine.md)).
- Details: [SPEC-16](./16-hardening-and-delivery.md) and the [Security](../../README.md#security) section.

### 8. State uncertainty explicitly

A number is labelled with where it came from.

**How it is applied.**
- Usage carries `tokenUsageSource`: `provider-reported`, `estimated` or `estimated-timeout` ([schema.prisma](../../apps/api/prisma/schema.prisma)).
- Cost carries `costSource`: `provider-reported` or `catalog-estimate` ([llm-execution.service.ts](../../apps/api/src/llm/llm-execution.service.ts)).
- Local token counts report their method, for example `tiktoken:o200k_base` or `approximate:o200k_base` ([token-counter.service.ts](../../apps/api/src/tokens/token-counter.service.ts), [ADR-013](../knowledge/decisions/adr-013-model-aware-token-counter.md)).
- A compaction preview reports whether the summary came from the `model` or a deterministic `fallback` ([ADR-016](../knowledge/decisions/adr-016-structured-compaction-output.md)).

### 9. Use tests to prove behaviour

Behaviour is demonstrated by automated tests at the lowest level that can show it.

**How it is applied.**

| Level | Tooling | Location |
| :--- | :--- | :--- |
| API unit and controller tests | Jest | `apps/api/src/**/*.spec.ts`, run by `npm run test:unit` |
| API integration tests | Jest, supertest, a real PostgreSQL database | [app.integration.spec.ts](../../apps/api/src/app.integration.spec.ts), run by `npm run test:integration` |
| Web unit tests | Karma and Jasmine in headless Chrome | `apps/web/src/**/*.spec.ts`, run by `npm run test:web` |
| User journeys | Playwright | [e2e/flows](../../e2e/flows/prompt-studio.flow.spec.ts), run by `npm run test:e2e` or `npm run test:flows` |

The run procedure is in the [verification suite runbook](../knowledge/operations/verification-suite.md). CI runs the API and web unit tests and the integration tests. It does not run the Playwright journeys, which need a running stack.

### 10. Keep dependencies minimal and audited

New dependencies need a stated reason, and known vulnerabilities are not waived.

**How it is applied.** `npm run audit` runs `audit-ci` at high severity with an empty allow-list ([audit-ci.json](../../audit-ci.json)), in CI. The gateway image is pinned by tag and digest ([ADR-014](../knowledge/decisions/adr-014-containerized-stack.md)). Notable additions are recorded in ADRs: the tokenizer ([ADR-013](../knowledge/decisions/adr-013-model-aware-token-counter.md)), the OpenTelemetry SDK ([ADR-017](../knowledge/decisions/adr-017-opentelemetry-sdk-tracing.md)) and `re2` for linear-time evaluation regexes ([ADR-018](../knowledge/decisions/adr-018-angular-22-upgrade.md)).

### 11. Do not expose model reasoning

Prompt techniques are templates and structured outputs. No feature requests or displays private reasoning.

**How it is applied.** Technique tags in [Prompt Studio](./11-prompt-studio.md) are metadata. Compaction asks the model only for a summary and a list of retained facts ([compaction-summary.ts](../../apps/api/src/conversations/compaction-summary.ts)).

### 12. Report status from evidence

A capability is called complete only when its acceptance criteria are met.

**How it is applied.** Every feature specification in this folder has an acceptance table with a status and evidence per criterion. The overall checklist is in the [specification index](./README.md#overall-acceptance-checklist). Criteria that are not fully met are listed as such rather than omitted.

## Related

- Index: [README](./README.md)
- Architecture and stack: [SPEC-02](./02-architecture-and-stack.md)
- Decisions: [docs/knowledge/decisions](../knowledge/decisions/index.md)
- Test procedure: [verification-suite.md](../knowledge/operations/verification-suite.md)
