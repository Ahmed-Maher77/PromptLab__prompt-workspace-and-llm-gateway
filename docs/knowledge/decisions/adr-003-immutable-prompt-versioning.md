---
type: Decision
title: "ADR-003: Append-Only Immutable Prompt Versioning"
description: "Decision to enforce immutable, append-only prompt template revisions with parent pointer audit chains"
status: accepted
date: "2026-10-18"
decision_makers: ["PromptLab Core Team"]
---

# ADR-003: Append-Only Immutable Prompt Versioning

## Context
In prompt engineering, editing an existing prompt in place destroys reproducibility: past experiment results, evaluation scores, and audit logs become decoupled from the exact text that generated them. We required a versioning model that guarantees reproducibility.

## Alternatives Considered
1. **Mutable Rows with Changelogs:** Updating the prompt in-place and logging diffs to a secondary audit table.
2. **Git-Backed Prompt Storage:** Storing prompt files in Git repositories and querying commits via Git APIs.
3. **Database-Backed Immutable Version Records:** Storing a parent `Prompt` metadata entity and an append-only collection of immutable `PromptVersion` entities with strictly increasing version numbers and parent pointers.

## Decision
We chose **Database-Backed Immutable Version Records**.

### Rationale
- **Deterministic Reproducibility:** Every `PromptVersion` record is immutable once created. When an engineer modifies a template, a new version (`v2`, `v3`...) is created, referencing the prior version as `parentVersionId`.
- **Fast Relational Queries:** Historical versions can be retrieved instantly via relational queries in PostgreSQL without cloning or shelling out to Git.
- **Audit Lineage:** Every experiment and prompt run references the exact `promptVersionId` used, ensuring absolute auditability.

## Consequences
- **Positive:** Complete template lineage, zero risk of accidental history overwrites, and reliable A/B testing against pinned versions.
- **Negative:** Storage footprint increases with frequent edits.
- **Mitigation:** Prompts are small text records (enforced $\le$ 32KB), making storage consumption negligible.
