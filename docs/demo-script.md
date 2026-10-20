# PromptLab POC — 10-Step Demonstration Script

This script provides an end-to-end, reproducible walkthrough of all primary capabilities implemented across Phases 0–6 of the PromptLab Proof-of-Concept.

---

## Prerequisites and Preparation

1. **Services Running:**
   - PostgreSQL running on port 5432 (`promptlab` database).
   - LiteLLM Proxy Gateway running on port 4000: `npm run start:gateway`
   - NestJS API running on port 3100: `npm run start:api`
   - Angular Web Application running on port 4200: `npm run start:web`
2. **Access:** Open your browser at [http://localhost:4200](http://localhost:4200).
3. **Provider Credentials Note:**
   - Steps requiring upstream model execution (Steps 4, 6, 7) require valid provider API keys (`OPENAI_API_KEY` or `ANTHROPIC_API_KEY`) configured in `.env` and loaded by LiteLLM.
   - If keys are unconfigured, LiteLLM returns honest configuration errors that the UI displays gracefully without crashing.
   - All other steps (templating, variable interpolation, version audits, context calculation, compaction simulation, quota reset, tracing inspection, settings) function completely offline.

---

## Walkthrough Steps

### Step 1: System Health, Environment & LiteLLM Gateway Status
- **Route:** `/settings`
- **Action:** Click **Settings** in the bottom of the left sidebar navigation.
- **Expected Result:**
  - The System Configuration & Health dashboard displays the active application status.
  - **Gateway Status:** Shows LiteLLM connectivity badge (`Connected` or `Disconnected`), endpoint (`http://localhost:4000`), and configured model count.
  - **Database Status:** Reports PostgreSQL connection state and latency in milliseconds.
  - **Effective Quota Policy:** Displays monthly token limit (`100,000`), request rate limit (`60 req/min`), and user scope (`dev-user-001`).
  - **Security:** Confirms single-tenant developer mode and that secrets are safely hidden from the browser.

---

### Step 2: Prompt Creation with Composable Techniques
- **Route:** `/prompts`
- **Action:**
  1. Click **Prompt Studio** in the navigation bar.
  2. Click **+ New Prompt**.
  3. Enter Name: `Customer Support Escalator`.
  4. Select Composable Techniques: select both `few-shot` and `structured-output`.
  5. In the Template Editor, enter:
     ```text
     You are an expert customer service triage agent.
     Analyze the following customer inquiry:
     "{{customer_message}}"

     Classification Categories: {{allowed_categories}}

     Respond with a JSON object:
     {
       "urgency": "low | medium | high",
       "category": string,
       "recommended_action": string
     }
     ```
  6. Click **Save Prompt**.
- **Expected Result:**
  - The prompt is persisted with version `v1`.
  - The technique badges (`few-shot`, `structured-output`) are visible in the header and library.

---

### Step 3: Dynamic Template Variables & Live Resolved Preview
- **Route:** `/prompts` (with `Customer Support Escalator` selected)
- **Action:**
  1. Observe the **Template Variables** panel in the lower left.
  2. Note that `customer_message` and `allowed_categories` were automatically detected from the double-bracket syntax `{{...}}`.
  3. Enter Test Values:
     - `customer_message`: `My credit card was charged twice for order #9821!`
     - `allowed_categories`: `Billing, Shipping, Account, General`
  4. Observe the **Live Resolved Preview** tab in the center-right panel.
- **Expected Result:**
  - The preview immediately displays the fully interpolated prompt text.
  - Character count and estimated input tokens update dynamically in real time without calling the server.

---

### Step 4: Playground Execution & Provenance Attribution
- **Route:** `/prompts` (Playground panel)
- **Prerequisite:** Valid `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` configured in `.env`.
- **Action:**
  1. Select Model: `gpt-4o-mini` (or `claude-3-5-sonnet`).
  2. Set Temperature: `0.2`, Max Tokens: `250`.
  3. Click **Run Prompt** (or press `Ctrl+Enter`).
- **Expected Result:**
  - A loading indicator indicates gateway processing.
  - Output panel displays the LLM's response JSON.
  - The metadata bar displays latency (e.g. `482 ms`), prompt tokens, completion tokens, and total tokens.
  - Token counts display explicit provenance labels (`provider-reported` when returned by LiteLLM, or `estimated` if calculated via fallback tokenizer).

---

### Step 5: Immutable Version History & Audit Trail
- **Route:** `/prompts`
- **Action:**
  1. In the Template Editor, append a line:
     `Also include a "sentiment" field: "positive | neutral | negative".`
  2. Enter change description: `Add sentiment analysis field`.
  3. Click **Save Version**.
  4. Switch to the **Version History** tab in the sidebar.
- **Expected Result:**
  - A new version `v2` is created.
  - The version timeline displays `v2 (current)` and `v1`.
  - Clicking `v1` loads the historical template in read-only mode, proving immutability of past revisions.

---

### Step 6: Side-by-Side Model Comparison (A/B Testing)
- **Route:** `/compare`
- **Action:**
  1. Click **Model Comparison** in the sidebar.
  2. In Slot A, select `gpt-4o-mini`, Temperature `0.2`.
  3. In Slot B, select `claude-3-5-sonnet`, Temperature `0.2`.
  4. Paste a prompt or load from library:
     `Explain the difference between optimistic concurrency control and pessimistic locking in 3 bullet points.`
  5. Click **Run Comparison**.
  6. Review outputs side-by-side.
  7. Under the preferred slot (e.g. Slot B), select rating `5 stars` and click **Select Winner B**.
- **Expected Result:**
  - Both slots execute concurrently.
  - Each slot displays its own output, latency, token usage, and calculated cost (labelled `Oct 2024 pricing estimate`).
  - Rating and winner selection are recorded in the PostgreSQL experiment registry.

---

### Step 7: Multi-Turn Conversation & Context Window Budgeting
- **Route:** `/conversations`
- **Action:**
  1. Click **Conversations** in the sidebar.
  2. Click **+ New Conversation**. Title: `Database Optimization Chat`.
  3. Select Model: `gpt-4o-mini`. Context Budget: `4,000 tokens`.
  4. Send Message 1: `What causes high sequential scan counts in PostgreSQL?`
  5. Send Message 2: `How can I identify missing indexes for those queries using pg_stat_statements?`
- **Expected Result:**
  - Messages appear in the conversational thread.
  - The **Context Window Budget Bar** at the top updates showing cumulative token consumption against the 4,000 token ceiling.
  - Warning colors trigger if usage nears 80% of budget.

---

### Step 8: Conversation Compaction & Summary Preservation
- **Route:** `/conversations` (with active conversation)
- **Action:**
  1. Click the **Compact Context** button in the conversation header.
  2. Choose Compaction Strategy: **Summarize & Truncate** (replaces older history with an LLM-generated summary, keeping the system prompt and last 2 user-assistant turns).
  3. Click **Confirm Compaction**.
- **Expected Result:**
  - A dedicated **Summary Banner** appears at the top of the conversation thread containing the distilled memory.
  - The Context Window Budget bar drops significantly (e.g., from 3,200 tokens down to 650 tokens).
  - The conversation remains fully functional for subsequent messages.

---

### Step 9: Quota Enforcement, Ledger Accounting & Reset Simulation
- **Route:** `/usage`
- **Action:**
  1. Click **Usage & Quotas** in the sidebar.
  2. Inspect the **Quota Consumption** gauge and ledger table.
  3. Observe the breakdown: Monthly Token Limit (`100,000`), Used Tokens, and Remaining Tokens.
  4. In the Audit Ledger, verify that every run from Steps 4, 6, and 7 is recorded as an immutable ledger transaction with timestamp, prompt tokens, completion tokens, and model ID.
  5. For demonstration purposes, click **Reset Period (Demo)**.
- **Expected Result:**
  - The usage counters reset to 0, archiving the prior ledger period.
  - The full monthly allowance of 100,000 tokens is restored.

---

### Step 10: Observability, Distributed Tracing & Privacy Redaction
- **Route:** `/observability`
- **Action:**
  1. Click **Observability** in the sidebar.
  2. Observe the **Traces Table** showing all recent spans (`prompt.run`, `experiment.compare`, `conversation.turn`).
  3. Click on the most recent trace row to expand its details.
  4. Inspect the **Span Details**:
     - Trace ID and Span ID formatted per W3C specification (`00-...`).
     - Request / response duration breakdown in milliseconds.
     - Redaction Verification: Notice that any API keys (`sk-...`), Authorization headers, or bearer tokens are masked as `[REDACTED_API_KEY]` while preserving token counts (`input_tokens: 42`, `output_tokens: 180`).
- **Expected Result:**
  - End-to-end auditability without exposing sensitive credentials or private telemetry data.
