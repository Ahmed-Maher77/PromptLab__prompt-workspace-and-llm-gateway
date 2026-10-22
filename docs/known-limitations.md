# PromptLab POC — Known Limitations & Non-Production Boundaries

This document provides an honest, rigorous catalog of known technical limitations, architectural constraints, and operational boundaries of the PromptLab Proof-of-Concept (POC).

---

## 1. Authentication and Multi-Tenancy

- **Single-Tenant Developer Mode:**
  - The application currently runs in a single-tenant developer mode (`authMode: 'single-tenant-developer'`).
  - Requests are attributed to a hardcoded developer identity (`userId: 'dev-user-001'`).
  - While domain schemas in Prisma (`QuotaLedger`, `QuotaPolicy`, `AuditLog`, `Conversation`) associate records with `userId`, there is no external identity provider (e.g. Auth0, Keycloak, Microsoft Entra ID), session management, JWT verification, or role-based access control (RBAC).
  - Anyone with network access to the API or web frontend can access all endpoints and data without credentials.

---

## 2. Observability & Telemetry Verification Status

- **Unit-Tested vs. Externally Verified:**
  - The OpenTelemetry (`OtlpHttpSpanExporter`) and Langfuse (`LangfuseSpanExporter`) exporters are fully implemented, unit-tested, and validated against W3C trace context format (`traceparent: 00-{traceId}-{spanId}-{flags}`), span parent-child relationships, and timing metrics.
  - **Limitation:** Telemetry export has **not** been pointed to or verified against a live OpenTelemetry Collector instance or live Langfuse SaaS/self-hosted deployment. Live collector ingestion tests remain a post-POC operational validation item.
- **In-Memory Buffer Retention:**
  - In-memory trace history is capped at 500 traces with FIFO eviction (configurable in `ObservabilityService`).
  - If the backend process restarts, buffered in-memory traces not exported externally are reset.

---

## 3. Model Pricing and Cost Estimation

- **Configurable October 2024 Reference Rates:**
  - Model pricing rates are configurable in [`apps/api/src/experiments/cost-calculator.ts`](file:///c:/Users/Ahmed.Maher/Downloads/PromptLab_POC_Docs/apps/api/src/experiments/cost-calculator.ts), defaulting to reference pricing published in **October 2024**:
    - `gpt-4o-mini`: $0.150 / 1M prompt tokens, $0.600 / 1M completion tokens.
    - `claude-3-5-sonnet`: $3.000 / 1M prompt tokens, $15.000 / 1M completion tokens.
  - **Limitation:** These figures are static estimation references, not real-time billing feeds. Upstream provider pricing changes, custom volume discounts, prompt caching discounts, or batch API discounts are not reflected automatically. Unknown models fall back to zero-cost estimates with explicit provenance labelling (`estimated`).

---

## 4. Ambiguous Timeout Usage Accounting

- **Conservative Recovery Heuristic:**
  - When an LLM request fails due to a network timeout (`GATEWAY_TIMEOUT` / 504) or upstream abort after being dispatched to LiteLLM, the backend cannot reliably determine whether the provider actually processed the tokens.
  - **Behavior:** The reservation is held conservatively (retaining the reserved quota allocation) rather than automatically releasing the tokens as zero-cost.
  - **Limitation:** In rare occurrences where upstream processing was immediately dropped, this may temporarily hold quota against the user until the billing cycle or demo reset. A provider reconciliation worker is not included in this POC.

---

## 5. Database Schema & Migration Management

- **Prisma Schema Synchronization via `db push`:**
  - The database schema is synchronized using `npx prisma db push` (`npm run prisma:push`).
  - **Limitation:** There are no versioned SQL migration files (`prisma/migrations/*`) and no `_prisma_migrations` tracking table in PostgreSQL. Schema alterations in production must transition to `prisma migrate dev` / `prisma migrate deploy` before being applied to live environments with persisted data.

---

## 6. Pagination & Query Surface

- **Array Slice Contract:**
  - The list endpoints (`/api/prompts`, `/api/experiments`, `/api/conversations`) support query parameters `limit` (1–100, default unpaginated/all) and `offset` (>= 0).
  - Data ordering is deterministic (`updatedAt DESC, id ASC` or `createdAt DESC, id ASC`).
  - **Limitation:** To maintain backward compatibility with existing Angular services and UI components, responses return direct arrays (`Entity[]`) rather than wrapped envelope objects (`{ data: [], total: number, page: number }`). Total record counts and page totals are not yet exposed via response headers or metadata envelopes.

---

## 7. LiteLLM Proxy Gateway & Secret Management

- **Local Process & Environment Secrets:**
  - The LiteLLM proxy runs as a local Python script (`infra/litellm/run_proxy.py`) using configuration from `infra/litellm/config.yaml`.
  - Upstream provider credentials (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`) are read from environment variables.
  - **Limitation:** In an enterprise deployment, LiteLLM must be containerized in Kubernetes/ECS with secrets injected via AWS Secrets Manager, GCP Secret Manager, or HashiCorp Vault. Virtual key generation, per-team budgets, and automated failover routing within LiteLLM are demonstrated via static configuration rather than dynamic administrative database models.

---

## 8. Summary Table of Implementation vs. External Verification

| Capability | Implementation Status | Verification Level | Production Readiness |
| :--- | :--- | :--- | :--- |
| **Prompt Studio & Versioning** | Complete | Full API & UI Automated Tests | POC Complete |
| **Model Comparison (A/B)** | Complete | Full API & UI Automated Tests | POC Complete |
| **Conversation Compaction** | Complete | Full API & UI Automated Tests | POC Complete |
| **Atomic Quota Reservation** | Complete | Unit & Integration Tested | POC Complete |
| **Privacy Redaction Engine** | Complete | Unit & E2E Pattern Tested | POC Complete |
| **OTLP / Langfuse Exporters** | Complete | Unit Tested (Payloads & Format) | **Requires Live Collector Validation** |
| **Authentication & RBAC** | Single-tenant stub | Stub / Developer Mode | **Requires Identity Integration** |
| **Prisma Migrations** | `db push` only | Functional in Local Postgres | **Requires Migration History** |
| **Live Provider Pricing** | Configurable Oct 2024 | Static Reference Calculations | **Requires Provider Billing API** |
