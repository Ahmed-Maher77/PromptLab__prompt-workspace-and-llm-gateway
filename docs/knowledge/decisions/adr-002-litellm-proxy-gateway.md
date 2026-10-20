---
type: Decision
title: "ADR-002: Standalone LiteLLM Proxy Gateway"
description: "Decision to use LiteLLM Proxy as a dedicated routing gateway with server-side secret isolation"
status: accepted
date: "2026-10-18"
decision_makers: ["PromptLab Core Team"]
---

# ADR-002: Standalone LiteLLM Proxy Gateway

## Context
PromptLab must support multiple LLM providers (e.g. OpenAI, Anthropic) while shielding upstream API credentials from browser clients and centralizing provider routing, model fallbacks, and format normalization.

## Alternatives Considered
1. **Direct Backend SDK Calls:** Installing official vendor SDKs (`openai`, `@anthropic-ai/sdk`, etc.) directly inside the NestJS backend and writing custom multi-provider adapters.
2. **Standalone LiteLLM Proxy Gateway:** Running LiteLLM Proxy as an independent HTTP service listening on port 4000, presenting an OpenAI-compatible unified API.

## Decision
We chose the **Standalone LiteLLM Proxy Gateway**.

### Rationale
- **Single Standard Protocol:** LiteLLM exposes standard OpenAI-compatible endpoints (`/v1/chat/completions`, `/v1/models`) for all supported models, radically simplifying backend dispatch logic.
- **Strict Credential Isolation:** Upstream keys (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`) remain strictly confined to the gateway environment. The backend interacts using an internal master key (`LITELLM_MASTER_KEY`), and the frontend never encounters any credentials.
- **Provider Agnostic:** Adding new models (Gemini, Mistral, Ollama) requires only updating `infra/litellm/config.yaml` without backend recompilation.

## Consequences
- **Positive:** Uniform completion interface, centralized rate-limiting, and complete credential isolation from clients.
- **Negative:** Introduces an additional network hop and process to manage during local development.
- **Mitigation:** The gateway can be run via Python virtual environment script (`npm run start:gateway`) or Docker Compose (`docker compose up litellm`).
