---
type: Decision
title: "ADR-007: Read-Only System Settings Dashboard"
description: "Decision to implement a read-only system settings page with active service health probes and zero secret leakage"
status: accepted
date: "2026-10-20"
decision_makers: ["PromptLab Core Team"]
---

# ADR-007: Read-Only System Settings Dashboard

## Context
Phase 6 required replacing the placeholder/disabled Settings navigation item in the web application with a functional route. We needed to decide whether this page should support runtime configuration editing or provide a read-only diagnostic dashboard.

## Alternatives Considered
1. **Interactive Configuration Editor:** Allow users to update environment variables, LiteLLM keys, and model parameters through form inputs. (High security risk, requires complex secret rotation, file-system writes, and process reloading).
2. **Read-Only Diagnostic Dashboard:** Display live runtime service health, gateway connectivity, configured models, effective quota policy, and safe environment metadata without exposing sensitive credentials or offering editing controls.

## Decision
We chose the **Read-Only Diagnostic Dashboard** (`/settings`).

### Key Invariants
- **Active Probing:** Gateway health and database connectivity are actively probed via live pings rather than reporting cached or assumed success.
- **Strict Credential Masking:** Upstream provider keys, master keys, and database passwords are excluded from the response payload (`secretsExposed: false`). URLs for external collectors are sanitized via `maskHost()` to strip query parameters or embedded credentials.
- **Design System Compliance:** The UI uses high-density tables and neutral status badges adhering strictly to `DESIGN_SYSTEM.md`.

## Consequences
- **Positive:** Gives operators immediate visibility into environment health and quota policies without introducing attack surfaces or secret leakage vectors.
- **Negative:** Changing configuration still requires updating `.env` or YAML configs and restarting the service.
