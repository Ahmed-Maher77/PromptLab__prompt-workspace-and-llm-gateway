# PromptLab --- Design System

**Status:** Initial implementation specification\
**Product:** PromptLab --- Prompt Engineering & LLM Gateway\
**Audience:** Engineers implementing the POC

## 1. Product principles

PromptLab is a developer-focused workspace for designing prompts,
comparing experiments, managing LLM conversations and context, and
observing/controlling usage.

The interface must feel like a credible engineering tool---not a
marketing site or a generic AI-generated dashboard.

### Design principles

-   **Clarity over decoration:** prioritize readable prompt text,
    visible state, and useful data.
-   **Dense but breathable:** support long prompts, tables, traces, and
    token statistics without wasting space.
-   **Neutral by default:** use a restrained neutral palette; reserve
    color for semantic status and important actions.
-   **No visual gimmicks:** no gradients, excessive shadows,
    glassmorphism, oversized hero sections, or decorative blobs.
-   **Consistent behavior:** shared patterns for navigation, forms,
    tables, dialogs, status, loading, errors, and empty states.
-   **Accessible:** keyboard-operable controls, visible focus, semantic
    HTML, sufficient contrast, and labels for all form controls.
-   **Honest observability:** clearly distinguish estimated from
    provider-reported token usage and cost.

## 2. Information architecture

Use a persistent application shell with: - A compact left sidebar for
primary navigation. - A top bar with current workspace/product name,
selected environment if applicable, and user menu. - A main content
region with page title, short explanatory text where needed, and primary
action. - Responsive behavior: sidebar collapses to an icon rail or
drawer on narrow screens; data tables may scroll horizontally.

### Primary navigation

1.  **Prompt Studio**
    -   Prompt library
    -   Create prompt
    -   Prompt detail/editor
    -   Version history
2.  **Compare**
    -   Side-by-side prompt/model experiments
    -   Results and evaluation
3.  **Conversations**
    -   Conversation list
    -   Conversation workspace
    -   Context inspector and compaction
4.  **Usage**
    -   Current-period usage
    -   Quota and request history
5.  **Gateway & Observability**
    -   Request traces
    -   Provider/model status and errors
    -   Rate-limit/budget configuration (admin-only where applicable)
6.  **Settings**
    -   Provider/model configuration (never expose secret values)
    -   User/workspace preferences

For the MVP, implement only pages required by the current phase. Do not
create non-functional navigation destinations. If a future module is
visible, label it as planned or keep it out of the navigation.

## 3. Visual language

### Color tokens

Prefer CSS custom properties so the theme can be changed centrally. Use
a light theme first, with dark mode considered later only if it does not
delay core functionality.

Suggested starting tokens (adjust after inspecting the existing
repository): - `--color-bg`: `#F7F8FA` --- app background -
`--color-surface`: `#FFFFFF` --- panels and editor surfaces -
`--color-surface-muted`: `#F1F3F5` --- secondary regions -
`--color-border`: `#DDE1E6` --- dividers and outlines - `--color-text`:
`#20242B` --- primary text - `--color-text-muted`: `#667085` ---
secondary text - `--color-primary`: `#2457C5` --- primary action and
selected state - `--color-primary-hover`: `#1D46A3` - `--color-success`:
`#18794E` - `--color-warning`: `#946200` - `--color-danger`: `#B42318` -
`--color-info`: `#175CD3` - `--color-focus`: `#84ADFF`

Rules: - Do not use the primary color for every icon or heading. - Use
semantic colors only when they communicate state. - Do not rely on color
alone to communicate success, warning, or failure. - Keep borders subtle
and shadows minimal; prefer borders and spacing over
cards-with-shadows. - Avoid purple as the dominant accent and avoid
gradients.

### Typography

Use a legible UI sans-serif stack such as Inter with system fallbacks.
Use a monospaced font for prompt text, code, IDs, and trace details.

Suggested scale: - Page title: 24--28 px, semibold - Section title:
16--18 px, semibold - Body: 14--16 px - Supporting labels: 12--13 px -
Dense data/table text: 13--14 px - Prompt/code editor: 13--14 px with
comfortable line height

Avoid oversized headings. Keep hierarchy consistent.

### Spacing and shape

Use a consistent 4 px base spacing scale: 4, 8, 12, 16, 20, 24, 32,
40. - Common page padding: 24 px desktop, 16 px tablet, 12--16 px
mobile. - Common component radius: 6--8 px. - Input/control height:
typically 36--40 px. - Prefer square-ish, compact controls over
pill-shaped everything. - Use spacing and borders to group content; do
not wrap every section in a card.

## 4. Core components

Implement reusable components and tokens rather than styling each page
independently.

### App shell

-   Sidebar navigation with active route indication.
-   Top bar and user menu.
-   Responsive collapse behavior.
-   Consistent content width and page gutters.

### Buttons

Variants: - Primary: one clear main action per view. - Secondary: normal
supporting actions. - Ghost: low-emphasis actions. - Danger: destructive
actions. Sizes: compact and standard. Requirements: loading state,
disabled state, focus state, accessible name, and no fake actions.

### Inputs and forms

-   Labels above inputs by default.
-   Inline help text for non-obvious fields.
-   Field-level validation messages.
-   Clear required/optional indication.
-   Use native form semantics.
-   Never use placeholder text as the only label.

### Tabs, filters, and selectors

-   Use tabs for closely related views.
-   Use dropdowns for provider/model and version selection.
-   Show the selected model/provider explicitly.
-   Preserve filter state when navigating back where practical.

### Tables

Use tables for prompt versions, requests, and usage history. - Clear
column headers. - Sorting only when implemented. - Search/filter only
when functional. - Row actions accessible by keyboard. - Responsive
horizontal scrolling where necessary. - Include loading, empty, and
error states.

### Status badges

Use restrained semantic labels such as `Draft`, `Saved`, `Running`,
`Completed`, `Failed`, `Estimated`, and `Provider reported`. Do not use
badges as decoration or repeat the same status in multiple places
unnecessarily.

### Code/prompt editor

-   Monospaced text.
-   Preserve whitespace and line breaks.
-   Show variable syntax clearly, e.g. `{{task}}`.
-   Include character/token estimate when available.
-   Distinguish template content from resolved prompt preview.
-   Avoid pretending a plain textarea is syntax-aware; if using a
    textarea for MVP, label it honestly and ensure it remains usable.

### Dialogs and confirmations

Use dialogs for destructive actions, manual compaction review, and
important confirmations. - State the consequence clearly. - Provide
cancel and confirm actions. - Do not use a dialog for routine low-risk
interactions.

### Feedback states

Every async feature needs: - Loading/progress state. - Empty state with
a useful next action. - Success feedback. - Recoverable error with a
retry path where appropriate. - Disabled controls while an action is in
flight where duplicate submission would be harmful.

## 5. Feature-specific UX

### Prompt Studio

-   Prompt library table/list with name, description, technique tags,
    latest version, updated time.
-   Create/edit form with name, description, technique, template body,
    variables, optional examples, and output requirements.
-   Save creates a new immutable version when an existing prompt's
    content changes; do not silently overwrite historical versions.
-   Show a resolved prompt preview using sample variable values.
-   Make it easy to run the prompt against a selected model.
-   Treat technique as metadata; do not imply that every technique is a
    mutually exclusive category.

### Compare

-   Two clearly labeled experiment columns: A and B.
-   Allow selection of prompt version, provider/model, and common input.
-   Offer a "use same settings" option and default to identical
    inputs/settings where possible.
-   Display response, input/output tokens, latency, cost estimate, and
    evaluation result if available.
-   Show usage provenance (provider-reported vs estimated).
-   Clearly state when results are from separate runs and may vary.

### Conversations and context

-   Conversation list with title, last activity, model/provider, and
    status.
-   Chat area with clear user/assistant message distinction.
-   Display current context estimate and model context limit; avoid
    implying that the entire persisted transcript is sent every turn.
-   Context inspector lists what will be sent: system prompt, summary,
    retained messages, relevant facts, and current user input.
-   Manual compaction should show a proposed summary and allow review
    before applying.
-   Automatic compaction must be configurable and visible.
-   Keep original messages in persistent storage even after compaction.
-   Explain whether context/token values are estimated or
    provider-reported.
-   Checkpoint/resume should visibly confirm the restored conversation
    and retained summary/facts.

### Usage and quotas

-   Show monthly quota, consumed amount, remaining amount, and reset
    date.
-   Separate token quota from request-rate limits and monetary budgets.
-   Provide a usage history with model/provider and input/output totals.
-   Explain that usage may be provisional until provider usage is
    reconciled.
-   Avoid implying an exact bill if provider prices are not configured
    or current.

### Gateway and observability

-   Request list with timestamp, request ID, user, provider/model,
    duration, status, input/output tokens, and cost if known.
-   Trace detail should expose stages such as request validation, quota
    check, context assembly, gateway call, and usage reconciliation.
-   Redact secrets and avoid storing API keys in logs.
-   Make failures actionable without exposing internal secrets or full
    sensitive prompt contents by default.

## 6. Content and interaction rules

-   Use concise, literal labels: "Compact context", "Save new version",
    "Compare runs".
-   Avoid vague buttons such as "Magic", "Boost", or "Optimize" unless
    the behavior is explicitly explained.
-   Confirm before destructive operations.
-   Keep the user informed about token estimates, quota reservations,
    and provider errors.
-   Do not expose private chain-of-thought. If a reasoning technique is
    supported, present concise explanations or requested structured
    outputs rather than hidden internal reasoning.
-   Never show provider API secrets in the UI, browser logs, or
    client-side configuration.

## 7. Responsive and accessibility requirements

-   Must be usable at desktop width (primary target), tablet, and mobile
    widths.
-   Prompt editing and comparison may prioritize desktop, but should not
    break on mobile.
-   All actions must be keyboard accessible.
-   Maintain visible focus indicators.
-   Inputs require programmatic labels.
-   Use semantic landmarks and correct heading order.
-   Respect reduced-motion preferences.
-   Do not communicate state by color alone.

## 8. Frontend implementation guidance

-   Inspect the existing repository and follow its framework, routing,
    linting, and component conventions before introducing dependencies.
-   If starting from an empty repository, use Angular + TypeScript as
    the frontend.
-   Centralize theme tokens in CSS variables.
-   Build shared shell/components first, then implement feature pages in
    phases.
-   Keep API types in a shared typed client layer.
-   Use real API data when a feature's backend exists; use clearly
    marked mock data only during a phase that explicitly permits it.
-   Do not leave dead controls, fake charts, fabricated token counts, or
    buttons that do nothing.
-   Avoid unnecessary dependencies and do not introduce a component
    library without a clear benefit.

## 9. Design acceptance checklist

-   [ ] The UI follows a restrained, neutral, developer-tool aesthetic.
-   [ ] No gradients, dominant purple theme, excessive shadows, or
    oversized marketing sections.
-   [ ] Shared tokens and components are used consistently.
-   [ ] Every async page has loading, empty, error, and success states
    as applicable.
-   [ ] Prompt text preserves whitespace and is easy to inspect.
-   [ ] Estimated and provider-reported metrics are clearly
    distinguished.
-   [ ] Responsive layout and keyboard accessibility are checked.
-   [ ] No visible control is inert or falsely suggests a working
    capability.
