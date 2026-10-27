---
type: spec
id: SPEC-11
title: "Prompt Studio"
description: "Prompt templates, composable techniques, variables, immutable versions, resolved preview and the playground"
status: implemented
domain: "prompts"
last_updated: "2026-10-27"
---

# SPEC-11: Prompt Studio

## Summary

Prompt Studio is where templates are written and run. A prompt is a named template with technique tags and `{{variable}}` placeholders. Saving a change appends a new immutable version, the resolved text is previewed live, and any version can be run in a playground through the gateway.

## Scope

- Prompt library: list, search, filter by technique, create and open a prompt.
- Technique metadata: `zero-shot`, `one-shot`, `few-shot`, `RTF`, `structured-output`, `custom`. A prompt can carry several.
- Variables detected from the template, with sample values for preview and run.
- Optional few-shot examples stored with each version.
- Version history and version selection.
- Resolved preview without calling a model.
- Playground run with model, temperature and maximum output tokens.

## Rules

- Techniques MUST be stored as non-exclusive metadata on the prompt. They MUST NOT change how a template is resolved.
- Saving content MUST append a new version with the next version number. Existing versions MUST NOT be modified or deleted. Two concurrent saves MUST NOT produce the same version number; the loser receives `409`.
- A placeholder is `{{name}}` with optional inner whitespace and a name of letters, digits, `_` or `-`. Resolution MUST preserve all whitespace, line breaks and indentation of the template, MUST replace in a single pass, and MUST NOT re-expand placeholders found inside substituted values.
- A variable with no value (absent or empty) MUST be reported as missing. A run with missing variables MUST be rejected with `400` before any model call.
- When examples are supplied and the template does not already contain `### Examples`, the examples MUST be appended under that heading in the resolved text.
- A prompt and its versions MUST be visible only to their owner. Another user's prompt MUST be reported as not found.
- A template MUST NOT exceed 32,768 characters. A variable map MUST NOT exceed 50 entries.
- The model identifier MUST match `^[a-zA-Z0-9._:/-]{1,128}$`. Temperature MUST be between 0 and 2, and maximum tokens between 1 and 32,768.
- When no gateway or provider credential is available, the run MUST return an explicit error and configuration hint, never a simulated success.
- Provider credentials MUST NOT reach the browser.
- The playground run executes the template text supplied in the request. `promptId` and `versionNumber` are accepted as context, but the server does not look the version up. The web app sends the text of the selected version.

## Acceptance criteria

| # | Criterion | Status | Evidence |
| :--- | :--- | :--- | :--- |
| 1 | A user can create a template, save several versions, preview the resolved text and run a prompt through the gateway. | ✅ Met | [prompts.service.ts](../../apps/api/src/prompts/prompts.service.ts) (`create`, `createVersion`, `resolveTemplate`, `runPlayground`), [prompts.controller.ts](../../apps/api/src/prompts/prompts.controller.ts), [prompt-studio.component.ts](../../apps/web/src/app/pages/prompt-studio/prompt-studio.component.ts). Tests: *should create prompt and version 1*, *should create next version (v2) incrementing versionNumber immutably*, *should resolve variables and call providersService when inputs are valid* ([prompts.service.spec.ts](../../apps/api/src/prompts/prompts.service.spec.ts)); end-to-end journey in [prompt-studio.flow.spec.ts](../../e2e/flows/prompt-studio.flow.spec.ts). |
| 2 | Prompt text preserves whitespace. | ✅ Met | `resolveTemplate` substitutes in a single regex pass and does not trim the template. Test: *should resolve variables while strictly preserving whitespace and newlines*. The template is stored as submitted ([schema.prisma](../../apps/api/prisma/schema.prisma) `PromptVersion.templateBody`). |
| 3 | A version can be selected and re-run. | ✅ Met | `loadVersion` loads a version's template, examples, variables and model defaults into the editor, and `runPlayground` sends them ([prompt-studio.component.ts](../../apps/web/src/app/pages/prompt-studio/prompt-studio.component.ts)). The server runs the supplied text; see the last rule above. |
| 4 | Versions are append-only and concurrency-safe. | ✅ Met | The only write routes are `POST /prompts` and `POST /prompts/:id/versions`. Unique constraint `(promptId, versionNumber)` ([schema.prisma](../../apps/api/prisma/schema.prisma)); `createVersion` maps `P2002` to `409`. Tests: *should throw ConflictException if concurrent version creation hits unique constraint (P2002)*. [ADR-003](../knowledge/decisions/adr-003-immutable-prompt-versioning.md). |
| 5 | Techniques are composable metadata. | ✅ Met | Stored as `techniqueMetadata.techniques` (array). The library filters by technique in the database. Tests: *should toggle composable techniques without mutual exclusivity* ([prompt-studio.component.spec.ts](../../apps/web/src/app/pages/prompt-studio/prompt-studio.component.spec.ts)); *filters GET /api/prompts by technique in the database and paginates the filtered set* (integration). The server stores technique identifiers as supplied; the six listed above are what the UI offers. |
| 6 | Required variables are validated before a run. | ✅ Met | `runPlayground` throws `400` listing the missing names before calling the gateway; the UI blocks the run first. Tests: *should throw BadRequestException if required variables are missing*; *should set runError if required variables are empty when running playground* (web). |
| 7 | Few-shot examples can be attached to a version and are included in the resolved prompt. | ✅ Met | `FewShotExampleDto` and `PromptVersion.examples`; `resolveTemplate` appends the `### Examples:` block. Test: *should append few-shot examples when provided*. |
| 8 | Ownership is enforced server-side. | ✅ Met | Every query filters by `ownerId`. Tests: *should scope findAll strictly by caller ownerId*, *should reject findById when prompt is owned by another user*, *should reject createVersion when prompt is owned by another user*. |
| 9 | Gateway errors and a missing provider configuration produce explicit states. | ✅ Met | `executeChatCompletion` and `parseGatewayError` return a typed `errorType` and `configurationHint` ([providers.service.ts](../../apps/api/src/providers/providers.service.ts)). Tests: *should return explicit provider_auth_error when upstream provider credentials are unconfigured*, the *Structural Gateway Error Classification* group; web: *should handle empty model list from gateway gracefully and clear selectedModel*, *should handle gateway disconnection gracefully*. |
| 10 | The playground shows run state, latency, token usage with its source, and errors. | ✅ Met | `runResult` and `runError` in [prompt-studio.component.ts](../../apps/web/src/app/pages/prompt-studio/prompt-studio.component.ts). Test: *should execute runPlayground successfully and update runResult with latency and token metrics*. |
| 11 | Inputs are bounded and provider credentials stay server-side. | ✅ Met | DTO limits in [create-prompt.dto.ts](../../apps/api/src/prompts/dto/create-prompt.dto.ts) and [run-prompt.dto.ts](../../apps/api/src/prompts/dto/run-prompt.dto.ts). Integration tests: *rejects prompt templateBody exceeding 32768 characters*, *rejects playground run with invalid model identifier pattern*, *rejects playground run with out-of-bounds or non-numeric temperature*, *rejects playground run with out-of-bounds, decimal, or string maxTokens*. The browser only holds the caller's PromptLab credential ([auth.interceptor.ts](../../apps/web/src/app/interceptors/auth.interceptor.ts)). |
| 12 | Library, empty, loading and error states are handled in the UI. | ✅ Met | Empty-library and no-match messages, loading flags and error signals in [prompt-studio.component.html](../../apps/web/src/app/pages/prompt-studio/prompt-studio.component.html); debounced, cancellable search (web tests under *debounces keystrokes into a single request*). |

## Tests

- API: [prompts.service.spec.ts](../../apps/api/src/prompts/prompts.service.spec.ts), [prompts.controller.spec.ts](../../apps/api/src/prompts/prompts.controller.spec.ts), [providers.service.spec.ts](../../apps/api/src/providers/providers.service.spec.ts)
- API integration (validation, pagination, technique filter): [app.integration.spec.ts](../../apps/api/src/app.integration.spec.ts)
- Web: [prompt-studio.component.spec.ts](../../apps/web/src/app/pages/prompt-studio/prompt-studio.component.spec.ts), [prompt.service.spec.ts](../../apps/web/src/app/services/prompt.service.spec.ts)
- Journey: [prompt-studio.flow.spec.ts](../../e2e/flows/prompt-studio.flow.spec.ts)

## Related

- Concept: [Prompt Studio](../knowledge/concepts/prompt-studio.md)
- ADRs: [ADR-003](../knowledge/decisions/adr-003-immutable-prompt-versioning.md), [ADR-008](../knowledge/decisions/adr-008-backward-compatible-pagination.md), [ADR-002](../knowledge/decisions/adr-002-litellm-proxy-gateway.md)
- README: [Features](../../README.md#features), [API reference](../../README.md#api-reference)
- Next: [SPEC-12 Model comparison](./12-model-comparison.md)
- Index: [README](./README.md)
