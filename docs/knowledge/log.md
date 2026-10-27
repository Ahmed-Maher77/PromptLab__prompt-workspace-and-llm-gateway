# PromptLab Knowledge Log

This log chronologically records architectural milestones, specification evolutions, and engineering iterations for the PromptLab Proof-of-Concept.

---

## 2026-10-20 — Documentation Knowledge Base & Final Delivery
- **Scope:** Organised the repository documentation into a structured knowledge base with indexed sections and front matter on every document.
- **Artifacts Created:**
  - Root `docs/knowledge/index.md` and `log.md`.
  - Architecture Decision Records (`adr-001` through `adr-008`) under `docs/knowledge/decisions/`.
  - Core domain concept specifications under `docs/knowledge/concepts/`.
  - Architecture topology and data model documentation under `docs/knowledge/architecture/`.
  - Operational runbooks and troubleshooting guides under `docs/knowledge/operations/`.
  - Updated `README.md` with links into the knowledge base.

## 2026-10-20 — Phase 6: Hardening, UI & Data Completeness
- **Scope:** Hardening, security review, input validation, and final POC completion.
- **Key Enhancements:**
  - Implemented read-only System Settings page (`/settings`) with live gateway/database connectivity checks, effective quota display, and zero credential leakage.
  - Implemented backward-compatible `limit`/`offset` query pagination across list endpoints (`/api/prompts`, `/api/experiments`, `/api/conversations`) with deterministic ordering.
  - Enforced strict class-validator DTO bounds (32KB text limits, numeric bounds, model ID regex, runtime enums).
  - Aligned API default port to 3100 and unified gateway URL resolution (`LITELLM_GATEWAY_URL` $\rightarrow$ `LITELLM_PROXY_URL` $\rightarrow$ `http://127.0.0.1:4000`).
  - Authored comprehensive documentation (`docs/demo-script.md`, `docs/known-limitations.md`).

## 2026-10-19 — Phase 5: Observability & Privacy Redaction
- **Scope:** Distributed tracing, telemetry export, and privacy-preserving log redaction.
- **Key Enhancements:**
  - Implemented W3C trace context propagation (`traceparent` header).
  - Built custom OpenTelemetry `OtlpHttpSpanExporter` and `LangfuseSpanExporter`.
  - Implemented an in-memory trace buffer with latency breakdowns.
  - Built a server-side privacy redaction engine masking API keys, bearer tokens, and sensitive headers.

## 2026-10-19 — Phase 4: Quotas & Budget Governance
- **Scope:** Monthly token limits, request rate limits, and quota accounting.
- **Key Enhancements:**
  - Implemented atomic two-phase quota reservation (reserve $\rightarrow$ commit / release) using database transactions to prevent concurrent overdrafts.
  - Implemented conservative recovery handling for ambiguous provider timeouts.
  - Built the immutable `QuotaLedger` audit table and demo period reset simulation.

## 2026-10-19 — Phase 3: Conversational Workspace & Compaction
- **Scope:** Multi-turn chat threads, context budgeting, and compaction.
- **Key Enhancements:**
  - Implemented conversation threads with real-time context window budget consumption tracking.
  - Built LLM-powered context compaction (Summarize & Truncate) that compresses historical turns while preserving essential conversation memory.

## 2026-10-18 — Phase 2: Model Comparison & Experimentation
- **Scope:** Side-by-side multi-model A/B execution and evaluation.
- **Key Enhancements:**
  - Built dual-slot playground executing completions concurrently against configured models.
  - Integrated October 2024 reference pricing calculations for cost estimations.
  - Built human evaluation interface (1–5 star ratings and winner selection) stored in the experiment registry.

## 2026-10-18 — Phase 1: Prompt Studio Vertical Slice
- **Scope:** Prompt library, template authoring, and immutable versioning.
- **Key Enhancements:**
  - Implemented composable prompt technique tagging (`few-shot`, `structured-output`, etc.).
  - Built dynamic `{{variable}}` extraction and live resolved preview.
  - Implemented immutable versioning history (v1, v2...) with full audit trail.
  - Integrated single-prompt playground connected to LiteLLM Proxy.

## 2026-10-18 — Phase 0: Foundations & Architecture
- **Scope:** Monorepo setup, database initialization, and gateway runner.
- **Key Enhancements:**
  - Initialized npm workspaces (`@promptlab/api` and `@promptlab/web`).
  - Defined PostgreSQL schema via Prisma.
  - Configured LiteLLM Proxy runner and virtual environment.
  - Established `DESIGN_SYSTEM.md` guidelines for dense, developer-oriented UI.
