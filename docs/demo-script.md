# PromptLab — Demonstration Script

An end-to-end walkthrough of the main capabilities. It takes about 15 minutes and works with the Docker stack or a local setup (see the [README](../README.md#getting-started)).

---

## Before you start

1. **Start the stack.**
   - Docker: `docker compose up --build -d`, then wait until `docker compose ps` shows every service as healthy. With `SEED_DEMO_DATA=true` (the default in `.env.example`) the three reference prompts are loaded automatically.
   - Local: start PostgreSQL, run `npm run prisma:deploy` and `npm run seed`, then `npm run start:gateway`, `npm run start:api` and `npm run start:web`.
2. **Credentials.** You need an API key from `AUTH_API_KEYS` (or, in development with `AUTH_DEV_TOKENS_ENABLED=true`, a dev token) to sign in. Use an `admin` key to see every page.
3. **Provider keys.** Steps that call a model (4, 6, 7, 8) need `OPENAI_API_KEY` and/or `ANTHROPIC_API_KEY` configured for the LiteLLM gateway. Without them those steps show the provider's error message in the UI; every other step works offline.

---

## Step 1 — Sign in and check platform health
- **Route:** `/login`, then `/`
- **Action:** Paste your API key or token and sign in. You land on **Platform health**.
- **Expected:**
  - Cards for the application API, PostgreSQL and the model gateway with live status and latency.
  - As an admin you also see the environment, gateway endpoint and configured providers; other users see "Visible to admins only".
  - The sidebar footer shows the real gateway state ("Gateway online" / "Gateway unreachable"), refreshed every 30 seconds.

## Step 2 — Browse and create a prompt
- **Route:** `/prompt-studio`
- **Action:**
  1. Type `query` in the search box. The list filters after you stop typing and shows *PostgreSQL Query Generator*.
  2. Filter by technique (e.g. `few-shot`).
  3. Create a new prompt named `Customer Support Escalator` with the techniques `few-shot` and `structured-output` and this template:
     ```text
     Analyze the following customer inquiry:
     "{{customer_message}}"

     Classification categories: {{allowed_categories}}

     Respond with a JSON object: {"urgency": "low | medium | high", "category": string, "recommended_action": string}
     ```
  4. Save it.
- **Expected:** The prompt is stored as `v1`, and `customer_message` and `allowed_categories` are detected as variables.

## Step 3 — Variables and live preview
- **Action:** Fill in the variables:
  - `customer_message`: `My card was charged twice for order #9821!`
  - `allowed_categories`: `Billing, Shipping, Account, General`
- **Expected:**
  - The resolved preview updates as you type, with a model-aware token estimate. Approximate counts are labelled as such.
  - Values are inserted literally: a value such as `{{secret}}` appears as text and is never expanded.

## Step 4 — Run in the playground
- **Action:** In **Run settings** choose `gpt-4o-mini`, temperature `0.2`, max tokens `250`, and run the prompt.
- **Expected:**
  - The response appears with latency, prompt, completion and total tokens, and the cost.
  - Token counts are labelled `provider-reported` when the gateway returned usage, otherwise `estimated`.
  - Cost comes from the gateway's model catalog.

## Step 5 — Immutable versions
- **Action:** Add the line `Also include a "sentiment" field.` to the template and save it as a new version. Open the version history.
- **Expected:** `v2` is the current version. `v1` is still available read-only, so past runs stay reproducible.

## Step 6 — Compare two prompts or models
- **Route:** `/compare`
- **Action:**
  1. Choose a prompt (or inline text) and a model for each slot, e.g. `v1` with `gpt-4o-mini` in slot A and `v2` in slot B.
  2. Enter the common input and run the comparison.
  3. Rate the better slot (1–5 stars), add a note, and open the history drawer to reload the saved comparison.
- **Expected:**
  - Both slots run in parallel and show their output, latency, tokens, cost and any evaluation-criteria results.
  - Ratings are saved per slot.
  - Reloading a saved comparison always shows the one you clicked last, even if you click quickly.

## Step 7 — Conversation with a context budget
- **Route:** `/conversations`
- **Action:**
  1. Start a new conversation: title `Database Optimization Chat`, model `gpt-4o-mini`, context budget `4,000` tokens, and an optional system prompt.
  2. Send: `What causes high sequential scan counts in PostgreSQL?`
  3. Send: `How do I find missing indexes with pg_stat_statements?`
  4. Open the context inspector.
- **Expected:**
  - The budget indicator turns orange above 70% and red above 85%.
  - The inspector shows exactly what is sent to the model: the system prompt, the active checkpoint summary, the recent turns that fit, and the new message.
  - If a message cannot fit even after older turns are dropped, the API refuses it with `CONTEXT_BUDGET_EXCEEDED` before any tokens are charged.

## Step 8 — Compact and resume
- **Action:**
  1. Click **Compact History**. A preview is generated: a summary plus retained facts, returned by the model as structured JSON.
  2. Review and edit the summary, then apply it.
  3. Open **Compaction Checkpoints** to see the checkpoint, and resume from an earlier one if you have several.
- **Expected:**
  - Later turns send the summary instead of the compacted messages, and the budget usage drops.
  - All original messages are kept in the database.
  - If the model is unavailable or returns something unusable, the preview falls back to an automatic summary and the dialog says so.

## Step 9 — Usage, quotas and the ledger
- **Route:** `/usage`
- **Action:** Review the monthly allowance and the ledger, filter by status, and (in development, as an admin) use **Reset Period for Demo**.
- **Expected:**
  - The default allowance is 1,000,000 tokens per user per month, and the rate limit is 60 requests per minute.
  - Every model call from steps 4, 6, 7 and 8 appears with its operation (Playground, Comparison, Conversation, Compaction), status, tokens and cost.
  - Repeating a request with the same idempotency key does not create a second charge.

## Step 10 — Traces and redaction
- **Route:** `/observability` (admin)
- **Action:** Filter the trace list, then open a trace with the mouse or the keyboard (Enter). Press Escape to close it.
- **Expected:**
  - Traces for `playground.execute`, `comparison.slot`, `conversation.turn` and `compaction.preview`, each with spans for quota reservation, the gateway call and reconciliation.
  - The W3C `traceparent` can be copied.
  - API keys, bearer tokens and similar values appear as `[REDACTED]`, `[REDACTED_API_KEY]` or `[REDACTED_BEARER]`, while token counts stay readable.
  - When an OTLP collector or Langfuse is configured, the same spans are exported there.

## Step 11 — Settings
- **Route:** `/settings` (admin)
- **Expected:** A read-only view of the runtime configuration, gateway models, effective quota policy and telemetry status, with no secrets shown.
