---
type: spec
id: SPEC-16
title: "Hardening and Delivery"
description: "Authentication and authorisation, input limits, pagination, error handling, the settings dashboard, CI gates and delivery documentation"
status: partially-implemented
domain: "platform"
last_updated: "2026-10-27"
---

# SPEC-16: Hardening and Delivery

## Summary

This specification covers the controls that make the other capabilities safe to run and the material needed to hand the project over: authentication and roles, ownership scoping, input validation, pagination, consistent error responses, a read-only settings dashboard, container and CI gates, and documentation. Most criteria are met. The gaps are listed below.

## Scope

- Authentication with API keys and HS256 JWTs, a sign-in page, and role-based access (`user`, `admin`).
- Ownership scoping of prompts, experiments, conversations and usage.
- Input limits, payload size, model identifier format, timeouts.
- `limit` and `offset` pagination on list endpoints.
- HTTP hardening: security headers, CORS, proxy trust, error responses.
- The read-only System Settings page for administrators.
- Containers, CI and dependency audit.
- Delivery documentation: README, architecture notes, demo script, known limitations.

## Requirements

### Authentication and authorisation

- Every route except the health probes MUST require authentication. A missing or invalid credential MUST return `401`; a valid credential without the required role MUST return `403`.
- Two credential forms MUST be supported: `x-api-key: <key>` for keys listed in `AUTH_API_KEYS` (compared as SHA-256 digests with a timing-safe comparison), and `Authorization: Bearer <jwt>`.
- JWTs MUST be verified with HS256 only (`alg: none` and other algorithms rejected), MUST carry `exp` and `iat`, MUST NOT exceed `AUTH_JWT_MAX_LIFETIME_SECONDS` (default 86,400), and MUST match the configured issuer and audience when set.
- `LITELLM_MASTER_KEY` MUST NOT be accepted as a user credential.
- Development tokens MUST be accepted only when `NODE_ENV` is `development` or `test` and `AUTH_DEV_TOKENS_ENABLED=true`.
- Each authenticated identity MUST be recorded as a user. An email conflict MUST return `409`.
- Prompts, experiments, conversations, checkpoints and usage MUST be scoped to the caller. A resource owned by someone else MUST be reported as not found.
- Quota policy updates, system settings, trace endpoints and demo endpoints MUST require the `admin` role. Demo endpoints MUST additionally require a development or test environment.

### Input and request limits

- Request bodies MUST be validated with `whitelist` and `forbidNonWhitelisted`, and MUST NOT exceed 256 kB (`413` otherwise).
- Text fields MUST have maximum lengths (32,768 characters for templates, messages and system prompts), numeric fields MUST have bounds, and model identifiers MUST match `^[a-zA-Z0-9._:/-]{1,128}$`.
- The API-side model call timeout MUST be configurable (`LLM_REQUEST_TIMEOUT_MS`, default 30 s) and MUST stay above the gateway timeout.
- List endpoints for prompts, experiments and conversations MUST accept `limit` (1 to 100) and `offset` (0 or more) with deterministic ordering, and MUST keep returning arrays.

### HTTP behaviour

- Responses MUST set security headers (Helmet). CORS MUST allow only the configured origins.
- `TRUST_PROXY` MUST be an explicit hop count or CIDR. `true` MUST be rejected.
- Errors MUST use RFC 9457 `application/problem+json`, MUST NOT contain stack traces, and MUST carry `X-Request-Id`. Domain errors MUST keep a machine-readable `code`.
- Containers MUST run as a non-root user, and published ports MUST be bound to `127.0.0.1`.

### Settings dashboard

- `GET /api/settings` MUST be read-only and admin-only, MUST NOT return secrets, and MUST mask credentials in URLs.

## Acceptance criteria

| # | Criterion | Status | Evidence |
| :--- | :--- | :--- | :--- |
| 1 | Authentication is required everywhere except the health probes, and credentials are verified strictly. | ✅ Met | [auth.guard.ts](../../apps/api/src/common/guards/auth.guard.ts), [public.decorator.ts](../../apps/api/src/common/decorators/public.decorator.ts). Tests in [auth-and-roles.guard.spec.ts](../../apps/api/src/common/guards/auth-and-roles.guard.spec.ts): *rejects unauthenticated requests with HTTP 401*, *rejects unsigned "alg: none" JWT*, *rejects JWT signed with the wrong secret*, *rejects JWT with NO exp claim even if signed correctly*, *rejects JWT whose lifetime (exp - iat) exceeds max configured lifetime*, *rejects JWT when issuer or audience does not match configured values*, *rejects LITELLM_MASTER_KEY when presented as a bearer token*, *authenticates valid API key via x-api-key header and timingSafeEqual*. Integration: *rejects unauthenticated requests to protected endpoints with 401 Unauthorized*. |
| 2 | Role checks protect admin routes, and demo endpoints are limited to development and test. | ✅ Met | [roles.guard.ts](../../apps/api/src/common/guards/roles.guard.ts), `ENABLE_DEMO_ENDPOINTS` in [env.validation.ts](../../apps/api/src/common/config/env.validation.ts). Tests: *rejects non-admin users attempting to access admin route with HTTP 403 ForbiddenException*, *allows POST /usage/reset ONLY when NODE_ENV is development AND ENABLE_DEMO_ENDPOINTS is true*, *rejects POST /usage/reset when NODE_ENV is production even if ENABLE_DEMO_ENDPOINTS is true*; integration: *rejects non-admin users attempting admin routes with 403 Forbidden*. |
| 3 | Resources are scoped to their owner. | ✅ Met | Owner filters in every service; tests *returns HTTP 404 NotFoundException when User A attempts to fetch User B conversation* and *…experiment*, plus the prompt, conversation and experiment ownership tests in [SPEC-11](./11-prompt-studio.md), [SPEC-12](./12-model-comparison.md) and [SPEC-13](./13-conversations-and-compaction.md). Integration: *allows a non-admin user to create a conversation after automatic User upsert*. |
| 4 | Input sizes, shapes and bounds are validated. | ✅ Met | Global pipe and 256 kB limit in [configure-app.ts](../../apps/api/src/configure-app.ts); DTOs per module; [is-string-record.validator.ts](../../apps/api/src/common/validators/is-string-record.validator.ts) for variable maps. Integration tests: *rejects forbidden non-whitelisted properties with 400 Bad Request*, *rejects a 300 KB body with 413 Payload Too Large*, *rejects conversation message exceeding 32768 characters*, *accepts valid preview and run payloads with boundary values*. |
| 5 | Request timeouts are bounded and consistent. | ✅ Met | `LLM_REQUEST_TIMEOUT_MS` validated at startup and applied as an abort signal to the gateway call ([providers.service.ts](../../apps/api/src/providers/providers.service.ts)); the sweeper cutoff derives from it. Tests: *parses custom PORT, CORS origins, and custom LLM_REQUEST_TIMEOUT_MS*, *uses a per-attempt request_timeout shorter than the API request timeout*. |
| 6 | Model IDs are validated against an allowed set. | ⚠️ Partially met | The identifier format is validated (see Requirements) on playground runs, comparison slots and conversations, but there is no allow-list or check against the gateway catalog. An identifier the gateway does not serve is rejected by the gateway and surfaced as a provider error after the quota reservation has been taken and released. |
| 7 | History and usage tables are paginated. | ⚠️ Partially met | `GET /prompts`, `/experiments` and `/conversations` accept `limit` and `offset` with deterministic order ([ADR-008](../knowledge/decisions/adr-008-backward-compatible-pagination.md)). Without either parameter they return everything. `GET /usage/ledger` accepts only `limit` (maximum 100, newest first) and has no `offset`. Responses are arrays with no total count. Tests: *supports limit and offset pagination on GET /api/prompts*, *…/experiments*, *…/conversations*, *rejects invalid pagination parameters on GET /api/prompts with 400 Bad Request*. |
| 8 | Security headers, CORS, proxy trust and secrets configuration are enforced. | ✅ Met | Helmet, CORS and trust-proxy setup in [configure-app.ts](../../apps/api/src/configure-app.ts); Nginx headers in [nginx.conf](../../apps/web/nginx.conf); non-root users in the Dockerfiles ([api](../../apps/api/Dockerfile), [web](../../apps/web/Dockerfile)); loopback port binding in [docker-compose.yml](../../docker-compose.yml). Tests: *sets Access-Control-Allow-Origin for configured frontend origin*, *response contains helmet security headers*, *with TRUST_PROXY unset, 25 requests within 1 s using different X-Forwarded-For values must receive 429*, *rejects TRUST_PROXY="true" with startup error*. |
| 9 | Errors are useful and have recovery paths. | ✅ Met | RFC 9457 filter with preserved `code`, `Retry-After` and request ID ([http-exception.filter.ts](../../apps/api/src/common/filters/http-exception.filter.ts), [http-exception.filter.spec.ts](../../apps/api/src/common/filters/http-exception.filter.spec.ts)). The web app keeps an idempotency key across unknown outcomes so a retry replays instead of re-spending ([http-retry.util.ts](../../apps/web/src/app/utils/http-retry.util.ts)), maps API errors to messages ([api-error.util.ts](../../apps/web/src/app/utils/api-error.util.ts)), and returns to sign-in on `401` ([auth.interceptor.ts](../../apps/web/src/app/interceptors/auth.interceptor.ts)). |
| 10 | Formatting, lint, typecheck, unit and integration tests run automatically. | ✅ Met | [ci.yml](../../.github/workflows/ci.yml): lint, typecheck, API unit, web unit, build, migrations, integration, audit; and a Docker job (Compose validation and image builds). `npm run lint` was run clean when these specifications were written. The Playwright journeys are not part of CI. |
| 11 | Migrations and a fresh local setup are verified. | ⚠️ Partially met | CI applies every migration to an empty PostgreSQL 16 database and builds both images, and the integration suite runs against that database. No job starts the Compose stack or follows the README from a clean checkout, so the fresh-setup path is documented but not exercised automatically. |
| 12 | Unused code, dead controls, temporary mock data and unused dependencies are removed. | ⚠️ Partially met | No placeholder markers or sample-data constants remain in the application code, and demo controls are gated by environment. There is no automated unused-code or unused-dependency check. `RunPlaygroundDto` accepts `promptId` and `versionNumber`, which the server does not use. |
| 13 | The settings dashboard is read-only, admin-only and free of secrets, and it reports the real configuration. | ⚠️ Partially met | Read-only, admin-only, masked URLs and live gateway and database checks are implemented ([settings.service.ts](../../apps/api/src/settings/settings.service.ts), [ADR-007](../knowledge/decisions/adr-007-read-only-system-settings.md)); journey [settings.flow.spec.ts](../../e2e/flows/settings.flow.spec.ts) asserts no secret reaches the page. The `security` block is constant: `authMode: 'single-tenant-developer'` and the default developer identity, and the quota policy shown is that identity's, not the caller's. The page text still describes a single-tenant development profile although the API authenticates with keys or JWTs. |
| 14 | Credentials are handled safely in the web app. | ✅ Met | The interceptor attaches the credential only to requests for the API base URL and clears it on `401`; no credential or fallback token is compiled into the bundle ([environment.ts](../../apps/web/src/environments/environment.ts)). Tests: [auth.interceptor.spec.ts](../../apps/web/src/app/interceptors/auth.interceptor.spec.ts), [auth.service.spec.ts](../../apps/web/src/app/services/auth.service.spec.ts), [login.component.spec.ts](../../apps/web/src/app/pages/login/login.component.spec.ts). The credential is kept in `localStorage`. |
| 15 | The UI follows the design system. | ⚠️ Partially met | Tokens and shared patterns are used across pages (see [SPEC-10](./10-foundation.md), criterion 10), and dialogs, focus and live regions have tests (e.g. [dialog.directive.spec.ts](../../apps/web/src/app/shared/a11y/dialog.directive.spec.ts)). Conformance is reviewed by hand; no automated check covers it. |
| 16 | Delivery documentation exists: demo script, known limitations, architecture diagram. | ✅ Met | [demo-script.md](../demo-script.md) (sign-in, every page, current routes and defaults), [known-limitations.md](../known-limitations.md) (current authentication, scaling, cost and telemetry boundaries), [docs/architecture.md](../architecture.md) and the README diagrams. |
| 17 | Quota and context compaction have automated tests. | ✅ Met | See the test lists in [SPEC-13](./13-conversations-and-compaction.md) and [SPEC-14](./14-quotas-and-usage.md). |
| 18 | The container stack starts in dependency order with health checks. | ✅ Met | `depends_on … condition: service_healthy` and per-service health checks in [docker-compose.yml](../../docker-compose.yml); [ADR-014](../knowledge/decisions/adr-014-containerized-stack.md); the entrypoint applies migrations before start. |
| 19 | Dependencies are audited with no waivers. | ✅ Met | `npm run audit` in CI with an empty allow-list ([audit-ci.json](../../audit-ci.json)); [ADR-018](../knowledge/decisions/adr-018-angular-22-upgrade.md). |

## Tests

- Authentication, roles, ownership, demo gating: [auth-and-roles.guard.spec.ts](../../apps/api/src/common/guards/auth-and-roles.guard.spec.ts)
- Configuration: [env.validation.spec.ts](../../apps/api/src/common/config/env.validation.spec.ts)
- Errors and request IDs: [http-exception.filter.spec.ts](../../apps/api/src/common/filters/http-exception.filter.spec.ts), [request-id.middleware.spec.ts](../../apps/api/src/common/middleware/request-id.middleware.spec.ts)
- Validation helpers: [is-string-record.validator.spec.ts](../../apps/api/src/common/validators/is-string-record.validator.spec.ts)
- Settings: [settings.service.spec.ts](../../apps/api/src/settings/settings.service.spec.ts), [settings.controller.spec.ts](../../apps/api/src/settings/settings.controller.spec.ts), [settings.component.spec.ts](../../apps/web/src/app/pages/settings/settings.component.spec.ts)
- HTTP pipeline, validation, CORS, headers, pagination, payload limit, proxy trust: [app.integration.spec.ts](../../apps/api/src/app.integration.spec.ts), groups *Authentication & Authorization Guards*, *Validation Pipeline and Exception Filter*, *CORS Headers*, *Pagination Across List Endpoints*, *Payload Limit Enforcement*, *Proxy Trust & Rate Limiting*, *System Settings Endpoint*
- Web: [auth.interceptor.spec.ts](../../apps/web/src/app/interceptors/auth.interceptor.spec.ts), [http-retry.util.spec.ts](../../apps/web/src/app/utils/http-retry.util.spec.ts), [api-error.util.spec.ts](../../apps/web/src/app/utils/api-error.util.spec.ts), [login.component.spec.ts](../../apps/web/src/app/pages/login/login.component.spec.ts)
- Journeys: [settings.flow.spec.ts](../../e2e/flows/settings.flow.spec.ts) and the other [flows](../../e2e/flows/prompt-studio.flow.spec.ts)

## Related

- Concepts: [Observability and redaction](../knowledge/concepts/observability-and-redaction.md)
- ADRs: [ADR-007](../knowledge/decisions/adr-007-read-only-system-settings.md), [ADR-008](../knowledge/decisions/adr-008-backward-compatible-pagination.md), [ADR-014](../knowledge/decisions/adr-014-containerized-stack.md), [ADR-015](../knowledge/decisions/adr-015-health-probes-and-gateway-resilience.md), [ADR-018](../knowledge/decisions/adr-018-angular-22-upgrade.md)
- README: [Authentication and roles](../../README.md#authentication-and-roles), [Security](../../README.md#security), [Testing and CI](../../README.md#testing-and-ci)
- Demonstration: [demo-script.md](../demo-script.md). Limitations: [known-limitations.md](../known-limitations.md)
- Previous: [SPEC-15](./15-gateway-and-observability.md)
- Index: [README](./README.md)
