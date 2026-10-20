---
type: Concept
title: "Prompt Studio Specification"
description: "Specification for prompt templates, composable technique tagging, dynamic variables, and immutable versioning"
status: active
domain: "prompts"
---

# Prompt Studio Specification

## Overview
The Prompt Studio domain manages prompt templates, composable technique tagging, dynamic `{{variable}}` extraction, live resolved previews, and an append-only immutable versioning history.

## Core Entities
- **`Prompt`**: Top-level entity representing a prompt concept. Contains metadata: `id`, `name`, `description`, `techniques` (JSON array of strings), `createdAt`, `updatedAt`.
- **`PromptVersion`**: Immutable snapshot of the prompt template text. Contains: `id`, `promptId`, `versionNumber` (monotonically increasing integer), `templateBody` (max 32KB text), `changeDescription`, `parentVersionId`, `createdAt`.

## Composable Techniques
Techniques are metadata tags rather than mutually exclusive categories. A prompt template can combine multiple techniques simultaneously:
- `zero-shot`
- `one-shot`
- `few-shot`
- `RTF` (Role, Task, Format)
- `structured-output`
- `custom`

## Variable Extraction & Interpolation
- Templates support double-bracket variable interpolation syntax: `{{variable_name}}`.
- The system automatically extracts variable names using regex `\{\{\s*([a-zA-Z0-9_]+)\s*\}\}`.
- Test values can be supplied in the playground; missing variables block execution with descriptive validation notices.

## Provenance Labeling
Completion runs attribute token consumption to honest provenance sources:
- `provider-reported`: Tokens directly reported by LiteLLM / upstream provider response.
- `estimated`: Tokens estimated via fallback character-ratio heuristics when provider usage is absent.
