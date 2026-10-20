# PromptLab --- Implementation Plan

**Product:** PromptLab --- Prompt Engineering & LLM Gateway\
**Purpose:** Phased engineering specification and delivery roadmap\
**Approach:** Working vertical slices, modular monolith application
backend, separate LLM gateway\
**Default stack:** Angular + TypeScript, NestJS, PostgreSQL, Prisma,
LiteLLM Proxy, OpenTelemetry, Langfuse; Redis optional

## 1. Goal

Build a usable POC where users can: 1. Create prompts from
engineering-technique templates. 2. Edit prompts and preserve immutable
versions. 3. Run prompts in a playground. 4. Compare two prompt/model
runs. 5. Hold multi-turn conversations with visible context usage. 6.
Compact long context and save/resume sessions. 7. Track token usage and
enforce monthly user token quotas. 8. Route requests through an LLM
gateway with provider abstraction, rate limits and observability.

The POC must demonstrate working behavior and tests---not just a
polished UI.

## 2. Engineering and implementation standards

1.  **Inspect before changing.** Inspect the repository, README, package
    manifests, existing architecture, tests, lint/typecheck commands,
    and current UI before making changes.
2.  **Respect existing choices.** If a working framework or architecture
    already exists, extend it rather than rewriting it without a strong
    reason. If the repo is empty, use the default stack below.
3.  **Read `DESIGN_SYSTEM.md` before UI work** and follow it throughout
    every phase.
4.  **Work phase by phase.** Implement only the current phase, validate
    it, summarize results, and stop for review before starting the next
    phase unless explicitly instructed to continue.
5.  **Keep the app runnable.** Do not leave the main branch of work in a
    broken build between phases.
6.  **Avoid fake functionality.** No dead buttons, fabricated usage
    metrics, pretend provider responses, or mock data presented as real.
    If a stub is temporarily necessary, label it clearly and document
    its removal.
7.  **Prefer simple architecture.** Start with a modular monolith for
    product logic and a separately configured LiteLLM Proxy service. Do
    not introduce microservices, queues, vector databases, LangChain, or
    LangGraph without a demonstrated requirement.
8.  **Security first.** Provider API keys stay server-side/in gateway
    secrets. Never expose them to the browser or logs. Validate inputs,
    enforce authorization server-side, and redact sensitive telemetry.
9.  **Be explicit about uncertainty.** Token counts before a call are
    estimates unless a compatible tokenizer provides a model-specific
    count. Provider usage after a call should be labeled
    provider-reported. Costs are estimates unless based on configured
    pricing and usage.
10. **Use tests to prove behavior.** Add unit/integration tests for each
    phase and run the existing typecheck, lint, and test commands. Do
    not claim tests passed unless they were actually run.
11. **Keep dependencies minimal.** Explain and justify new dependencies.
12. **Do not expose chain-of-thought.** Support prompt techniques as
    instructional templates and structured outputs; do not build a
    feature that requests or displays private hidden reasoning.

## 3. Default technology choices

-   Frontend: Angular + TypeScript.
-   Backend: Node.js + TypeScript + NestJS.
-   Database: PostgreSQL.
-   ORM/migrations: Prisma.
-   LLM gateway: LiteLLM Proxy, deployed as a separate service.
-   Cache/rate-limit coordination: Redis only when needed; do not make
    it mandatory for the first vertical slice.
-   AI observability/evaluation UI: Langfuse.
-   Instrumentation: OpenTelemetry where supported, with trace/request
    IDs propagated through the application and gateway.
-   Testing: existing repository test stack; if new project, use
    Angular's supported test setup and Jest/Vitest where compatible with
    the chosen NestJS setup.
-   Local environment: Docker Compose for app dependencies and gateway
    where practical.

Use provider APIs through the gateway's supported OpenAI-compatible
interface where possible. Verify the selected provider/model is
supported by the installed gateway version. Do not hardcode a provider
list that claims all providers are available; make availability
configuration-driven.

## 4. High-level architecture

### Frontend

Feature areas: - Prompt Studio - Compare - Conversations - Usage -
Gateway & Observability (admin-oriented) - Settings

### Application backend

Keep modules separate by business responsibility: - `auth` --- user
identity and authorization. - `prompts` --- prompt templates, metadata
and immutable versions. - `experiments` --- comparison run definitions
and results. - `conversations` --- conversations and original
messages. - `context` --- context assembly, budget estimation and
compaction. - `providers` --- gateway client and model/provider
configuration. - `usage` --- usage ledger, quota periods, reservations
and reconciliation. - `observability` --- correlation IDs, trace
attributes, errors and redaction. - `admin` --- quota policies and
gateway configuration metadata.

### Data and external services

-   PostgreSQL is the source of truth for product data and quota ledger.
-   LiteLLM Proxy routes model requests and provides gateway-level
    controls.
-   Langfuse receives appropriate LLM traces/evaluations if configured.
-   Redis is optional for distributed counters, coordination or
    rate-limit support.

## 5. Data model --- initial proposal

Adapt to repository conventions and choose appropriate IDs, timestamps,
indexes, and foreign keys.

-   `User`: id, displayName, email/identity reference, role, createdAt.
-   `Prompt`: id, ownerId or workspaceId, name, description, technique
    metadata, createdAt, updatedAt.
-   `PromptVersion`: id, promptId, versionNumber, templateBody,
    inputSchema/variables, examples, outputSchema/format, model
    defaults, createdAt, createdBy.
-   `Experiment`: id, ownerId, commonInput, settings, createdAt.
-   `ExperimentRun`: id, experimentId, slot (A/B), promptVersionId,
    provider/model, output, status, inputTokens, outputTokens,
    tokenUsageSource, latencyMs, estimatedCost, errorCode, createdAt.
-   `Conversation`: id, ownerId, title, provider/model, status,
    createdAt, updatedAt.
-   `ConversationMessage`: id, conversationId, role, content,
    sequenceNumber, createdAt, provider usage fields where applicable.
-   `ConversationCheckpoint`: id, conversationId, summary, retainedFacts
    JSON, compactedThroughSequence, contextPolicyVersion, createdAt.
-   `QuotaPolicy`: id, scope (user/workspace), monthlyTokenLimit,
    requestRatePolicy, effectiveFrom.
-   `QuotaPeriod`: id, userId or workspaceId, periodStart, periodEnd,
    tokenLimit, reservedTokens, actualTokens, status.
-   `UsageRecord`: id, requestId (idempotency key), userId,
    conversationId nullable, provider/model, inputTokens, outputTokens,
    tokenUsageSource, reservedTokens, estimatedCost, status, createdAt,
    reconciledAt.
-   `RequestTrace` or trace metadata: prefer exporting traces to the
    observability system; persist only the product data needed for the
    UI.

Avoid duplicating all telemetry in PostgreSQL if the observability
backend already stores it. Do not store API keys in these tables.

## 6. Phased implementation

## Phase 0 --- Repository assessment and foundation

### Tasks

-   Inspect the repository and report its current framework,
    architecture, commands, existing UI, and test status.
-   Read `DESIGN_SYSTEM.md`.
-   Create or update a concise `README.md` with local setup and
    architecture.
-   Establish environment-variable validation and safe example
    configuration (`.env.example`, no real secrets).
-   If starting from scratch, scaffold the Angular frontend, NestJS API,
    PostgreSQL/Prisma setup, and local development configuration.
-   Establish formatting, lint, typecheck, test commands and a basic
    health endpoint.
-   Add Docker Compose only for services actually needed in this phase.

### Acceptance criteria

-   The app and API start using documented commands.
-   Database migration/setup works.
-   Health endpoint works.
-   No secrets are committed.
-   Baseline checks pass, or pre-existing failures are documented
    separately.

### Stop and report

Provide repository findings, architecture decisions, files changed,
commands run, results, and blockers. Do not start Phase 1 until
reviewed.

## Phase 1 --- Prompt Studio and one-provider playground

### Scope

-   Prompt library list and create/edit page.
-   Technique metadata: zero-shot, one-shot, few-shot, RTF, structured
    output, and custom.
-   Variables and optional few-shot examples.
-   Save prompt and create immutable versions.
-   Version history and version selection.
-   Resolved prompt preview using sample values.
-   Playground run using one configured model through LiteLLM Proxy.
-   Request/response states and basic error handling.

### Rules

-   Treat prompt technique as metadata/composable guidance; do not force
    techniques to be mutually exclusive.
-   Validate required variables before running.
-   Keep provider credentials server-side.
-   Save a version when content changes; don't overwrite history.
-   If no provider credentials are configured, show an explicit
    configuration state rather than a fake success.

### Tests

-   Prompt create/update/version behavior.
-   Variable resolution and missing-variable validation.
-   Authorization/ownership checks.
-   Gateway error and timeout handling.
-   UI loading, empty, validation and failure states.

### Acceptance criteria

-   A user can create a template, save multiple versions, preview
    resolved text and run a prompt through the gateway.
-   Prompt text preserves whitespace.
-   A version can be selected and re-run.
-   Tests and typecheck pass.

### Stop and report

Summarize implementation, demonstrate the end-to-end path, report tests,
and list remaining issues.

## Phase 2 --- Prompt comparison and basic evaluation

### Scope

-   Create a comparison with two slots, A and B.
-   Choose a prompt version and provider/model for each slot.
-   Use the same input and shared settings by default.
-   Run each independently and show side-by-side output.
-   Display latency, input/output tokens, usage source, and cost only
    when it can be calculated.
-   Save experiment configuration and results.
-   Add a small repeatable evaluation set with explicit expected
    criteria; support manual rating first if automated evaluation is out
    of scope.

### Tests

-   Both runs receive the intended input/settings.
-   Partial failure: one run can fail while the other result remains
    available.
-   Usage provenance is labeled correctly.
-   Saved experiment can be reopened.
-   No fake metrics are displayed.

### Acceptance criteria

-   User can compare two prompt versions, two models, or both.
-   A and B outputs and available metrics are visible together.
-   Results are persisted and repeatable by configuration.
-   Limitations due to nondeterministic model output are explained.

### Stop and report

Provide a comparison demonstration, tests, and any missing evaluation
capabilities.

## Phase 3 --- Conversations, context inspection, compaction and resume

### Scope

-   Create and list conversations.
-   Select provider/model and start with free-form system/user
    instructions or a saved prompt template.
-   Persist messages in PostgreSQL.
-   Display context usage estimate and model context-window
    configuration.
-   Build the exact message payload that will be sent: system
    instructions, summary, retained messages/facts, and current input.
-   Show a context inspector before or after each request.
-   Support manual compaction with preview/approval.
-   Add an automatic compaction threshold as a configurable policy.
-   Save checkpoints and resume conversations.
-   Keep original messages intact after compaction.

### Context policy

-   Account for system instructions, current user input,
    history/summary, tool or format overhead where applicable, and
    reserved output tokens.
-   Use a model-specific tokenizer when available; otherwise label
    counts as estimates.
-   Never use the entire context window as the input budget.
-   Preserve recent turns and important explicit facts/decisions.
-   A summary is a derived checkpoint, not a replacement for the
    original transcript.
-   Record compaction policy/version and which messages were summarized.
-   If compaction fails, do not silently delete history; return a
    recoverable error.

### Tests

-   Context assembly respects configured input budget in deterministic
    fixtures.
-   Important test facts survive compaction.
-   Original messages remain retrievable.
-   Resume restores the correct conversation/checkpoint.
-   Concurrent messages are ordered or conflict-handled safely.
-   Compaction failure does not corrupt the conversation.
-   Context numbers are labeled estimated or provider-reported.

### Acceptance criteria

-   A conversation can be saved, compacted, and resumed.
-   The user can inspect what context is sent.
-   Compaction respects the budget and retains required facts in the
    test dataset.
-   The full transcript remains stored.
-   Tests pass.

### Stop and report

Show a scripted long-conversation → compact → close/reopen → follow-up
demonstration.

## Phase 4 --- Monthly token quotas, usage ledger and rate limits

### Scope

-   Add user quota policy and monthly quota period.
-   Show token allowance, used, reserved, remaining, and reset date.
-   Record each model request with an idempotent request ID.
-   Estimate/reserve quota before calling the gateway.
-   Reconcile against provider-reported usage after completion.
-   Handle failed requests, retries, timeouts and streaming disconnects.
-   Enforce limits server-side; never rely on the UI.
-   Add request-rate limits separately from monthly token limits.
-   Make quota policy configurable for development/demo.
-   Add admin view for usage records and policy configuration if time
    permits.

### Correctness requirements

-   Use database transactions/locking or another concurrency-safe
    reservation strategy to prevent parallel requests overspending the
    same quota.
-   Make reconciliation idempotent.
-   Define a documented policy for requests with unknown final usage.
-   Do not assume gateway financial budgets equal application monthly
    token quotas.
-   Distinguish input and output tokens.
-   Use UTC for persisted timestamps and clearly define the monthly
    period/timezone.
-   Never trust token counts sent by the browser.

### Tests

-   Request rejected when quota is exhausted.
-   Concurrent requests cannot exceed the reservation policy.
-   Successful response reconciles estimated reservation to actual
    usage.
-   Failed request and retry behavior is safe and idempotent.
-   Period rollover works.
-   Rate limits and monthly token limits are independently enforced.

### Acceptance criteria

-   Usage is auditable by user and period.
-   The backend enforces quotas.
-   The UI clearly shows remaining quota and reset date.
-   Concurrency and reconciliation tests pass.

### Stop and report

Demonstrate successful usage, quota exhaustion, and monthly-period
behavior using test data.

## Phase 5 --- Gateway controls and observability

### Scope

-   Configure LiteLLM Proxy as the central provider gateway.
-   Support multiple configured providers/models through gateway
    configuration.
-   Do not claim support for a provider/model unless it is configured
    and tested.
-   Propagate correlation/request IDs through frontend (where
    appropriate), application backend, gateway, and telemetry.
-   Instrument API operations and provider calls with OpenTelemetry
    where supported.
-   Configure Langfuse for traces/evaluation if credentials and
    environment permit.
-   Build a request/trace list and detail view.
-   Capture duration, status, provider/model, token usage, errors and
    cost where known.
-   Add rate-limit and gateway budget configuration.
-   Redact secrets and minimize sensitive prompt/response capture.

### Tests

-   Correlation ID appears across application logs/traces.
-   Provider errors are traceable without leaking credentials.
-   Rate-limit response is handled in the UI.
-   Telemetry failure does not break core request execution.
-   Sensitive fields are redacted.
-   Unavailable provider/model returns a clear error.

### Acceptance criteria

-   A request can be followed from application API to gateway and
    provider call to the extent supported by instrumentation.
-   The observability view uses actual trace/usage data, not hardcoded
    sample data.
-   Gateway controls are documented and tested.
-   Provider keys remain server-side.

### Stop and report

Demonstrate a successful trace, a failed request, and a
rate/quota-limited request.

## Phase 6 --- Hardening and final POC delivery

### Tasks

-   Review authentication and authorization boundaries.
-   Validate input sizes, prompt variables, request timeouts, and
    allowed model IDs.
-   Add pagination to history/usage tables.
-   Review logging, redaction, CORS, secrets and environment
    configuration.
-   Add useful error messages and recovery paths.
-   Run formatting, lint, typecheck, unit and integration tests.
-   Verify migrations and fresh local setup from documented
    instructions.
-   Remove unused code, dead controls, temporary mock data and unused
    dependencies.
-   Prepare demo script, known limitations and architecture diagram.

### Final acceptance criteria

-   Fresh setup works from README.
-   All implemented features work end-to-end with configured
    credentials.
-   No API secrets are present in the client bundle or logs.
-   Quota and context compaction have automated tests.
-   UI follows `DESIGN_SYSTEM.md`.
-   Known limitations are documented.
-   Final demo script covers all implemented POC requirements.

## 7. Suggested repository structure

Adapt to the existing repository; this is a guide, not a reason to force
a rewrite.

``` text
promptlab/
  DESIGN_SYSTEM.md
  IMPLEMENTATION_PLAN.md
  README.md
  .env.example
  docker-compose.yml
  apps/
    web/                    # Angular
    api/                    # NestJS
  packages/
    shared-types/           # Optional shared contracts
  infra/
    litellm/
      config.yaml
  docs/
    architecture.md
    demo-script.md
```

Inside the API, keep business modules separated by domain rather than
creating one giant service. Do not create a shared package unless it
reduces real duplication.

## 8. Final demo script

1.  Create a zero-shot prompt and run it.
2.  Create a few-shot version and compare both with the same
    input/model.
3.  Save and select an older prompt version.
4.  Start a conversation from a saved template.
5.  Continue until context reaches the configured compaction threshold.
6.  Inspect the proposed summary and retained facts; approve compaction.
7.  Restart/reopen the session and ask a follow-up requiring an earlier
    fact.
8.  Show input/output usage and the monthly quota ledger.
9.  Trigger quota exhaustion and show the server-side rejection.
10. Open the request trace and show the application/gateway path and
    error/latency details.

## 9. Final phase acceptance checklist

Each phase delivery must verify: - What was implemented. - Key files
created/changed. - Architecture decisions and tradeoffs. - Commands
actually run and their real results. - Tests added and coverage of
acceptance criteria. - Screenshots or a concise UI walkthrough where
supported. - Known issues, limitations, and the next phase's
prerequisites.

Do not mark a phase complete if its acceptance criteria are not met. Do
not silently skip failed tests or replace failing behavior with mocks.
