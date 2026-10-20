---
type: Concept
title: "Quota Governance & Ledger Specification"
description: "Specification for token quotas, rate limits, atomic reservations, and audit ledger accounting"
status: active
domain: "usage"
---

# Quota Governance & Ledger Specification

## Overview
The Quota Governance domain manages consumption policy enforcement, token allowance budgeting, atomic two-phase reservations, and an immutable audit ledger for usage tracking.

## Core Entities
- **`QuotaPolicy`**: Governs limits for a specific scope (default: `scope: 'user'`, `scopeId: 'dev-user-001'`). Defines `monthlyTokenLimit` (e.g. 100,000 tokens) and `requestRateLimit` (e.g. 60 requests/min).
- **`QuotaLedger`**: Append-only transactional audit ledger. Records every committed consumption event: `id`, `scope`, `scopeId`, `promptTokens`, `completionTokens`, `totalTokens`, `model`, `endpoint`, `timestamp`.
- **`QuotaReservation`**: Ephemeral reservation record tracking in-flight requests to prevent concurrent overdrafts.

## Atomic Two-Phase Reservation Protocol
To prevent race conditions during concurrent request bursts:
1. **Pre-flight Estimation:** Prior to dispatching an LLM completion, the backend computes:
   $$\text{estimatedMaxTokens} = \text{inputTokens} + \text{maxTokens}$$
2. **Atomic Check & Reserve:** In a PostgreSQL transaction, verify:
   $$\text{currentUsage} + \text{activeReservations} + \text{estimatedMaxTokens} \le \text{monthlyTokenLimit}$$
   If approved, the reservation is created. If exceeded, HTTP 429 Too Many Requests is returned immediately without contacting the LLM gateway.
3. **Commit & Settlement:**
   - On completion response, actual tokens are recorded in `QuotaLedger`, and the reservation is released.
   - On timeout or upstream ambiguity, the reservation is conservatively retained to prevent unbilled execution.
