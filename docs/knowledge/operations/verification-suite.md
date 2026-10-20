---
type: Guide
title: "Verification Suite Runbook"
description: "Procedure and exact commands for running automated testing, typechecking, linting, and production builds"
status: active
domain: "testing"
---

# Verification Suite Runbook

## Automated Verification Protocol

The PromptLab monorepo enforces automated quality gates across backend and frontend workspaces. Run these commands from the repository root:

### 1. API Test Suite (Jest)
Runs unit and HTTP integration tests for the NestJS application:
```bash
npm run test:api
```
*Current Coverage:* 12 test suites, 107 tests passing.

### 2. Web Test Suite (Karma & Jasmine)
Runs headless Chrome unit tests for the Angular application:
```bash
npm run test:web
```
*Current Coverage:* 46 specs passing.

### 3. Full Monorepo Test Run
Runs both test suites sequentially:
```bash
npm run test
```

### 4. TypeScript Typecheck
Validates strict TypeScript types across all workspaces with `tsc --noEmit`:
```bash
npm run typecheck
```
*Expected Result:* Zero type errors across `@promptlab/api` and `@promptlab/web`.

### 5. ESLint Code Quality
Validates linting rules with zero warnings allowed:
```bash
npm run lint
```
*Expected Result:* Clean exit with 0 errors and 0 warnings.

### 6. Production Bundle Build
Compiles production bundles for NestJS (`dist/`) and Angular (`apps/web/dist/web`):
```bash
npm run build
```
*Expected Result:* Successful build generation with optimized chunks and zero packaging errors.
