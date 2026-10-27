---
type: spec
id: SPEC-12
title: "Model Comparison"
description: "Side-by-side runs of two prompt and model slots, with metrics, criteria checks, ratings and saved experiments"
status: partially-implemented
domain: "experiments"
last_updated: "2026-10-27"
---

# SPEC-12: Model Comparison

## Summary

A comparison runs one common input through two slots, A and B. Each slot has its own prompt (a saved version or ad hoc text), provider, model and generation settings. The two runs execute independently, and results appear side by side with latency, token usage, cost where it can be computed, deterministic criteria results and manual ratings. Comparisons are saved and can be reopened.

## Scope

- Two slots, each with a prompt version or inline template, a provider and model, temperature and maximum tokens.
- One shared set of input variables, and a "sync settings" option that mirrors slot A's generation settings to slot B (on by default).
- Independent execution with partial-failure tolerance.
- Per-run metrics: latency, input and output tokens, token source, cost.
- Evaluation: deterministic criteria (`contains_text`, `regex`, `json_validity`, `max_length`, `manual`) and manual 1-5 ratings with notes and per-criterion scores.
- Saved experiments, history, and reopening a past comparison.

## Rules

- Both slots MUST receive the same common input. Each slot is resolved against that input before any model call.
- A slot MUST name a prompt version the caller owns, or a non-empty inline template. An unknown or foreign version MUST return `404`, and a slot with neither MUST return `400`. Both checks MUST happen before any quota is reserved or model called.
- The two slots MUST run independently. If one fails, the other result MUST still be returned and saved.
- Each slot MUST go through the shared execution service, so quota, idempotency, cost and tracing behave as for every other model call. With an `Idempotency-Key`, the slots use derived keys `<key>:A` and `<key>:B`.
- Token usage MUST be labelled `provider-reported` or `estimated`. Cost MUST be `null` when it cannot be computed, and the UI MUST NOT display a value in that case.
- Evaluation regular expressions MUST be validated on input and evaluated in linear time. An invalid pattern MUST be rejected with `400`.
- A rating MUST be an integer from 1 to 5. Ratings for slots A and B MUST be stored independently, so concurrent updates cannot overwrite each other.
- Saved experiments MUST be visible only to their owner.
- Comparison output is nondeterministic. The UI MUST say that results from separate runs can differ.
- The API does not reject a comparison whose template still has unresolved placeholders. The UI blocks the run when common input is incomplete.
- An ad hoc slot template is trimmed at both ends. A template taken from a saved version is used unchanged.

## Acceptance criteria

| # | Criterion | Status | Evidence |
| :--- | :--- | :--- | :--- |
| 1 | A user can compare two prompt versions, two models, or both. | ✅ Met | `SlotConfigDto` accepts `promptVersionId` or `templateBody` plus provider and model ([run-comparison.dto.ts](../../apps/api/src/experiments/dto/run-comparison.dto.ts)); `runComparison` in [experiments.service.ts](../../apps/api/src/experiments/experiments.service.ts). Test: *should execute both slots with shared inputs and return side-by-side results*; web: *should select prompt and version for Slot A and Slot B correctly* ([compare.component.spec.ts](../../apps/web/src/app/pages/compare/compare.component.spec.ts)). |
| 2 | Both slots use the same input, and shared settings by default. | ✅ Met | One `commonInput` is resolved into both slots. The "Sync Settings" option is on by default. Tests: *should execute both slots with shared inputs…* (API); *should sync settings between slots when syncSettings is true*, *should not sync settings when syncSettings is false* (web). |
| 3 | Slots run independently, and one can fail while the other remains available. | ✅ Met | `Promise.allSettled` in `runComparison`; a rejected slot becomes a `failed` run with `EXECUTION_EXCEPTION`. Tests: *should handle partial failure: slot A fails while slot B succeeds*; web: *should handle partial failure gracefully where Slot A fails and Slot B succeeds*. |
| 4 | Slot configuration is validated before any model call or reservation. | ✅ Met | `prepareSlot` runs for both slots first. Tests: *should throw NotFoundException (404) if promptVersionId does not exist and NOT call LLM or reserveUsage*, *…if user B uses user A's promptVersionId, with zero LLM and quota calls*, *should throw BadRequestException (400) if slot provides neither promptVersionId nor non-empty templateBody*. |
| 5 | Latency, input and output tokens, usage source and cost are shown, with cost only when it can be calculated. | ✅ Met | `SlotRunResult` carries `tokenUsageSource` and nullable `estimatedCost`. The page renders `$` and the cost only when it is not null ([compare.component.html](../../apps/web/src/app/pages/compare/compare.component.html)). Tests: *returns null if rates are null or undefined (no made-up numbers)* ([cost-calculator.spec.ts](../../apps/api/src/experiments/cost-calculator.spec.ts)); *falls back to modelCatalog.calculateCost…* ([llm-execution.service.spec.ts](../../apps/api/src/llm/llm-execution.service.spec.ts)). Cost source: [ADR-012](../knowledge/decisions/adr-012-model-catalog-and-structural-error-classification.md). |
| 6 | Each slot is accounted and idempotent like any other model call. | ✅ Met | Slots call `LlmExecutionService.execute` with `comparison.slot`. Integration test: *derives slot keys `${key}:A` and `${key}:B` for comparisons on POST /api/experiments/run*; API test *should pass caller userId to reserveUsage for both comparison slots*. |
| 7 | Experiment configuration and results are saved and can be reopened. | ✅ Met | `Experiment`, `ExperimentRun` and `ExperimentEvaluation` rows ([schema.prisma](../../apps/api/prisma/schema.prisma)); `findAll`, `findById`. Tests: *should reopen saved experiment by ID*, *should honour saveExperiment=false and create no experiment row*; web: *should toggle history drawer and view past experiments*, *applies only the latest saved experiment when responses arrive out of order*. |
| 8 | Results are repeatable from the saved configuration. | ⚠️ Partially met | Saved: name, common input, evaluation criteria, and per run the prompt version, provider, model, output, token counts and source, latency, cost and error code. Not saved: each slot's temperature and maximum tokens, and the template text of a slot that used inline text instead of a saved version. A comparison that used a saved version can be re-run with the same version, input and model, but its generation settings must be re-entered. |
| 9 | A small evaluation set with explicit criteria is supported, with manual rating. | ✅ Met | Five criterion types evaluated per slot (`evaluateCriteria`), stored with the experiment; manual rating, notes and per-criterion scores via `POST /experiments/:id/rate`. Criteria are defined per comparison; there is no reusable named set. Tests: *should accurately evaluate contains_text criterion*, *…json_validity…*, *…max_length…*, *should evaluate regex criterion matching and handle invalid regex safely*, *should update manual rating and feedback notes for a slot via experimentEvaluation.upsert*, *should persist criteriaScores in updateRating*. |
| 10 | Regular-expression criteria are safe. | ✅ Met | `compileSafeRegex` uses `re2` ([regex.util.ts](../../apps/api/src/common/utils/regex.util.ts)); DTO validation rejects invalid patterns. Tests: *should evaluate ReDoS patterns safely in linear time without event loop freeze*; *ValidationPipe rejects invalid regex pattern in evaluation criteria with 400 Bad Request* ([experiments.controller.spec.ts](../../apps/api/src/experiments/experiments.controller.spec.ts)). |
| 11 | Ratings for each slot persist independently under concurrency. | ✅ Met | Single-statement upsert on `(experimentId, slot)`. Integration tests: *two concurrent rating updates for slots A and B of the same experiment both persist (no lost update)*, *the same slot updated twice concurrently ends with one row*. |
| 12 | Nondeterminism is explained to the user. | ✅ Met | Notice in [compare.component.html](../../apps/web/src/app/pages/compare/compare.component.html) ("LLM generation outputs are nondeterministic…"), required by [DESIGN_SYSTEM.md](../../DESIGN_SYSTEM.md). |
| 13 | Comparison input is checked for unresolved variables. | ⚠️ Partially met | The web page blocks the run when a common input variable is empty (*Missing common input variable(s)*). The API resolves templates with `resolveTemplate` but ignores `missingVariables`, so a direct API call with an incomplete input sends the literal placeholder to the model. |
| 14 | Experiments are scoped to their owner. | ✅ Met | `findAll`, `findById`, `updateRating` filter by `ownerId`. Test: *should throw NotFoundException if experiment does not exist*. |

## Tests

- API: [experiments.service.spec.ts](../../apps/api/src/experiments/experiments.service.spec.ts), [experiments.controller.spec.ts](../../apps/api/src/experiments/experiments.controller.spec.ts), [cost-calculator.spec.ts](../../apps/api/src/experiments/cost-calculator.spec.ts), [regex.util.spec.ts](../../apps/api/src/common/utils/regex.util.spec.ts)
- API integration (validation, slot keys, concurrent ratings, rating migration, decimal cost): [app.integration.spec.ts](../../apps/api/src/app.integration.spec.ts)
- Web: [compare.component.spec.ts](../../apps/web/src/app/pages/compare/compare.component.spec.ts), [experiment.service.spec.ts](../../apps/web/src/app/services/experiment.service.spec.ts)
- Journey: [compare.flow.spec.ts](../../e2e/flows/compare.flow.spec.ts)

## Related

- Concept: [Model comparison](../knowledge/concepts/model-comparison.md)
- ADRs: [ADR-012](../knowledge/decisions/adr-012-model-catalog-and-structural-error-classification.md), [ADR-019](../knowledge/decisions/adr-019-typed-columns-and-decimal-cost.md), [ADR-004](../knowledge/decisions/adr-004-atomic-quota-reservations.md)
- README: [Features](../../README.md#features), [Data model](../../README.md#data-model)
- Previous: [SPEC-11](./11-prompt-studio.md). Next: [SPEC-13](./13-conversations-and-compaction.md)
- Index: [README](./README.md)
