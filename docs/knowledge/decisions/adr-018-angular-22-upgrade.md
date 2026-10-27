---
type: decision
id: ADR-018
title: "Upgrade the Web App to Angular 22 and Clear the Audit Allow-list"
status: accepted
date: "2026-10-27"
deciders: ["PromptLab Core Team"]
---

# ADR-018 — Upgrade the Web App to Angular 22 and Clear the Audit Allow-list

## Context

- **Angular 19 was out of support.** The web app ran on Angular 19.2, and every Angular advisory published since then is fixed only in newer majors.
- **CI was green only because of an allow-list.** Seven high-severity advisories in `@angular/common`, `@angular/compiler`, `@angular/core` and `@angular/router` were on the `audit-ci` allow-list, which expired on 2026-12-31. After that date every CI run would fail.
- **`re2` had moderate advisories.** `re2`, which runs user-supplied evaluation regexes safely, had four moderate-severity advisories (out-of-bounds reads and process aborts) fixed in 1.27.

## Decision

1. **Upgrade one major at a time (19 → 20 → 21 → 22)** and run each version's official migrations:
   - **Build system:** moved to the `@angular/build` application builder (esbuild), which replaces `@angular-devkit/build-angular`.
   - **Templates:** converted from `*ngIf` / `*ngFor` to the built-in `@if` / `@for` control flow.
   - **Change detection:** every component sets `changeDetection: ChangeDetectionStrategy.Eager`. Angular 22 changed the default, and this keeps the existing behaviour. Moving components to `OnPush` is a separate, deliberate step.
2. **TypeScript 6.0 for the web app only.** Angular 22 requires TypeScript 6.0. The API stays on TypeScript 5.9, because `ts-jest` 29 does not yet support 6.x. npm workspaces install a separate copy for the web app.
3. **Safe-navigation semantics.** In Angular 22, `a?.b` in templates evaluates to `undefined` (as in JavaScript) instead of `null`.
   - The migration wraps affected expressions in `$safeNavigationMigration(...)`. We replaced those wrappers with explicit `!= null` checks, which are correct under both behaviours.
   - This also fixes an Overview bug: a missing health response used to render "null ms".
4. **No suppressed diagnostics.** The migration suggested turning off the `optionalChainNotNullable` / `nullishCoalescingNotNullable` checks. Instead, the one template that triggered them was fixed with `@if (...; as dbError)`.
5. **HTTP backend.** The app uses Angular 22's default `fetch` backend instead of opting back into XHR, since nothing relies on XHR-only features.
6. **Dependency hygiene.**
   - Removed a duplicate `rxjs` copy and the `baseUrl`/`paths` workaround that masked it; `baseUrl` is deprecated in TypeScript 6.
   - Upgraded `re2` to 1.27.
   - Emptied the `audit-ci` allow-list.

## Consequences

- **Positive:**
  - `npm audit --omit=dev` reports 0 vulnerabilities, and CI no longer depends on an expiring allow-list.
  - The app is on a supported Angular major, with modern template syntax and the esbuild-based builder.
- **Negative:**
  - The repository uses two TypeScript versions until the API's test tooling supports 6.x. Re-check when `ts-jest` adds support and unify then.
- **Verification:**
  - Web: type check, lint, 110/110 unit tests and a production build, including a reproduction of the Dockerfile's `npm ci --workspace` build.
  - API: unit (379/379) and integration (65/65) tests on the updated lockfile.
  - `npm ci` and `npm install` with npm 10, which is what CI and Docker use.
