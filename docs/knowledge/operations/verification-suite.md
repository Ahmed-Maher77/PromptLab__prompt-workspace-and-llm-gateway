---
type: Guide
title: "Verification Suite Runbook"
description: "Procedure and exact commands for running automated testing, typechecking, linting, production builds, and Playwright flow suites"
status: active
domain: "testing"
---

# Verification Suite Runbook

## Automated Verification Protocol

The PromptLab monorepo enforces automated quality gates across backend, frontend, and end-to-end integration layers. Run these commands from the repository root:

### 1. API Test Suite (Jest)
Runs unit, service, controller, and HTTP integration tests across all NestJS modules:
```bash
npm run test:api
```
*Current Coverage:* **24 test suites, 155 unit & integration tests passing (100% green)**.
- Services: `ConversationsService`, `ExperimentsService`, `PromptsService`, `ProvidersService`, `UsageService`, `ObservabilityService`, `SettingsService`, `HealthService`, `PrismaService`.
- Controllers: `ConversationsController`, `ExperimentsController`, `PromptsController`, `ProvidersController`, `UsageController`, `ObservabilityController`, `SettingsController`, `HealthController`.
- Utilities & Policies: `AllExceptionsFilter`, `TokenEstimator`, `ContextPolicy`, `CostCalculator`, `RedactionUtil`, `EnvValidation`.

### 2. Web Test Suite (Karma & Jasmine)
Runs headless Chrome unit tests across all Angular components and services:
```bash
npm run test:web
```
*Current Coverage:* **15 test suites, 80 unit tests passing (100% green)**.
- Components: `AppComponent`, `OverviewComponent`, `PromptStudioComponent`, `CompareComponent`, `ConversationsComponent`, `UsageComponent`, `ObservabilityComponent`, `SettingsComponent`.
- Services: `ConversationService`, `ExperimentService`, `PromptService`, `UsageService`, `ObservabilityService`, `SettingsService`, `HealthService`.

### 3. Full Monorepo Unit Test Run
Runs both test suites sequentially:
```bash
npm run test
```
*Current Coverage:* **235 total automated tests passing**.

### 4. End-to-End User Flow Tests (Playwright)
Executes end-to-end user journeys against the active application:
```bash
npm run test:e2e
```
*Flows Covered:*
- **Flow 1 (`prompt-studio.flow.spec.ts`):** Technique filtering, template drafting, `{{variable}}` live interpolation, estimated token calculation, playground execution.
- **Flow 2 (`compare.flow.spec.ts`):** Side-by-side model comparison, parameter synchronization, criterion scoring, rating, history drawer.
- **Flow 3 (`conversations.flow.spec.ts`):** Session management, multi-turn messaging, context window budget inspection modal, LLM compaction preview and checkpoint resumption.
- **Flow 4 (`usage.flow.spec.ts`):** Monthly allowance, usage progress bar, audit ledger pagination, status badges.
- **Flow 5 (`observability.flow.spec.ts`):** In-memory distributed trace inspection, span waterfall, and privacy redaction validation.
- **Flow 6 (`settings.flow.spec.ts`):** Runtime metadata introspection, database health probe, gateway connectivity, and zero-secret DOM leak assertion.

### 5. Automated Flow Runner
A wrapper script that runs the Playwright flows and writes structured results for CI:
```bash
# Run all flows with structured summary output:
npm run test:flows

# Run a specific flow:
node scripts/run-e2e-flows.mjs --flow=prompt-studio

# Output machine-readable JSON results:
node scripts/run-e2e-flows.mjs --all --json
```
Artifacts are automatically captured under `e2e/artifacts/` (screenshots and `flow-report.json`).

### 6. TypeScript Typecheck
Validates strict TypeScript types across all workspaces with `tsc --noEmit`:
```bash
npm run typecheck
```
*Expected Result:* Zero type errors across `@promptlab/api` and `@promptlab/web`.

### 7. ESLint Code Quality
Validates linting rules with zero warnings allowed:
```bash
npm run lint
```
*Expected Result:* Clean exit with 0 errors and 0 warnings.

### 8. Production Bundle Build
Compiles production bundles for NestJS (`dist/`) and Angular (`apps/web/dist/web`):
```bash
npm run build
```
*Expected Result:* Successful build generation with route lazy-loading chunks and zero packaging errors.
