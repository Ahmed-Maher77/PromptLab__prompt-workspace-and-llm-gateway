---
okf_version: "0.2"
title: "PromptLab Knowledge Base"
description: "Open Knowledge Format (OKF) repository index for PromptLab — Prompt Engineering Workspace and LLM Gateway"
status: active
maintainer: "PromptLab Core Team"
last_updated: "2026-10-20"
---

# PromptLab Knowledge Base

Welcome to the PromptLab Knowledge Base, structured in accordance with the **Open Knowledge Format (OKF v0.2)**. This repository provides structured, traversable documentation, architectural decision records, domain concept definitions, and operational runbooks for both human engineers and autonomous AI agents.

---

## Knowledge Bundle Navigation

This knowledge bundle uses **progressive disclosure**. Start with the curated section indices below to navigate directly to relevant domain knowledge:

```
docs/knowledge/
├── index.md                 # Root OKF index (this file)
├── log.md                   # Chronological evolution log
├── architecture/            # System topology, data models, and component boundaries
│   ├── index.md
│   ├── system-topology.md
│   └── data-model.md
├── concepts/                # Core domain concepts & specifications
│   ├── index.md
│   ├── prompt-studio.md
│   ├── model-comparison.md
│   ├── context-window-compaction.md
│   ├── quota-governance.md
│   └── observability-and-redaction.md
├── decisions/               # Architecture Decision Records (ADRs)
│   ├── index.md
│   ├── adr-001-modular-monolith-nestjs.md
│   ├── adr-002-litellm-proxy-gateway.md
│   ├── adr-003-immutable-prompt-versioning.md
│   ├── adr-004-atomic-quota-reservations.md
│   ├── adr-005-summarize-and-truncate-compaction.md
│   ├── adr-006-privacy-redaction-engine.md
│   ├── adr-007-read-only-system-settings.md
│   └── adr-008-backward-compatible-pagination.md
└── operations/              # Operational runbooks, verification, and setup
    ├── index.md
    ├── local-development.md
    ├── troubleshooting.md
    └── verification-suite.md
```

---

## Curated Indices

| Section | Description | Entry Point |
| :--- | :--- | :--- |
| **Architecture** | Component boundaries, system interactions, network topology, and Prisma schema | [Architecture Index](file:///c:/Users/Ahmed.Maher/Downloads/PromptLab_POC_Docs/docs/knowledge/architecture/index.md) |
| **Concepts** | In-depth domain specifications (prompts, experiments, context compaction, quotas, tracing) | [Concepts Index](file:///c:/Users/Ahmed.Maher/Downloads/PromptLab_POC_Docs/docs/knowledge/concepts/index.md) |
| **Decisions (ADRs)** | Formal Architecture Decision Records documenting key technical and architectural choices | [Decisions Index](file:///c:/Users/Ahmed.Maher/Downloads/PromptLab_POC_Docs/docs/knowledge/decisions/index.md) |
| **Operations** | Local development setup, troubleshooting guides, and full verification test procedures | [Operations Index](file:///c:/Users/Ahmed.Maher/Downloads/PromptLab_POC_Docs/docs/knowledge/operations/index.md) |
| **Change Log** | Chronological log of project milestones, hardening steps, and knowledge updates | [Knowledge Log](file:///c:/Users/Ahmed.Maher/Downloads/PromptLab_POC_Docs/docs/knowledge/log.md) |

---

## Agent Guidance for Traversal

When inspecting this repository:
1. **Locate Intent:** Use this root `index.md` to identify the appropriate category before reading individual documents.
2. **Consult ADRs:** Check [docs/knowledge/decisions/](file:///c:/Users/Ahmed.Maher/Downloads/PromptLab_POC_Docs/docs/knowledge/decisions/index.md) to understand constraints and rationales behind existing patterns before proposing structural changes.
3. **Domain Invariants:** Review [docs/knowledge/concepts/](file:///c:/Users/Ahmed.Maher/Downloads/PromptLab_POC_Docs/docs/knowledge/concepts/index.md) to preserve domain rules (e.g., immutable prompt versions, two-phase quota reservation, privacy redaction).
