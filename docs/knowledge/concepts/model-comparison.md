---
type: Concept
title: "Model Comparison & Experimentation Specification"
description: "Specification for side-by-side multi-model A/B execution, human evaluation, and cost calculation"
status: active
domain: "experiments"
---

# Model Comparison & Experimentation Specification

## Overview
The Model Comparison domain allows developers and prompt engineers to evaluate candidate prompts and models side-by-side under identical or varied slot configurations.

## Core Entities
- **`Experiment`**: Record of an A/B or multi-model comparison. Stores prompt text, slot configurations (Slot A and Slot B), completion outputs, latency measurements, token metrics, cost estimates, human rating (1–5 stars), winner selection (`A` or `B`), and optional criterion evaluation results.

## Slot Configuration
Each execution slot defines:
- `model`: Configured model identifier (e.g. `gpt-4o-mini`, `claude-3-5-sonnet`).
- `temperature`: Float between `0.0` and `2.0`.
- `maxTokens`: Integer between `1` and `32,768`.

## Cost Calculation & Estimation
Model pricing rates are configurable in `apps/api/src/experiments/cost-calculator.ts`, defaulting to **October 2024 reference rates**:
- `gpt-4o-mini`: Prompt tokens: $0.150 / 1M; Completion tokens: $0.600 / 1M.
- `claude-3-5-sonnet`: Prompt tokens: $3.000 / 1M; Completion tokens: $15.000 / 1M.

All displayed costs are explicitly labelled as **Oct 2024 pricing estimates** rather than guaranteed live billing figures. Unknown models calculate $0.00 with provenance marked as estimated.

## Evaluation Workflow
1. User provides prompt text and configures Slot A and Slot B.
2. Both completions run concurrently via LiteLLM Proxy.
3. Outputs are rendered side-by-side with latency, tokens, and estimated costs.
4. User optionally assigns a 1–5 star rating and selects a winning slot.
5. All experiment outcomes are saved to PostgreSQL with deterministic limit/offset pagination.
