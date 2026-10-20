---
type: Decision
title: "ADR-004: Atomic Two-Phase Quota Reservations"
description: "Decision to implement two-phase atomic quota reservations to eliminate race conditions and concurrent overdrafts"
status: accepted
date: "2026-10-19"
decision_makers: ["PromptLab Core Team"]
---

# ADR-004: Atomic Two-Phase Quota Reservations

## Context
When multiple concurrent requests are dispatched for a user near their monthly token limit, naive check-then-act logic (`if currentUsage + tokens < limit then execute`) suffers from race conditions. Multiple threads read the same stale usage figure, simultaneously pass the quota check, and collectively exceed the quota.

## Alternatives Considered
1. **Post-Execution Accounting:** Allow all requests to execute and tally usage only after the provider responds. (Allows unbounded quota overdrafts during bursts).
2. **Distributed Redis Locks:** Acquire a Redis mutex lock around the quota check and completion call. (Introduces external dependency and locks threads during slow LLM streaming).
3. **Two-Phase Atomic Reservation in PostgreSQL:** Atomically reserve the estimated token budget within an ACID transaction before dispatching the request; commit actual usage (or release unused tokens) when the response returns.

## Decision
We chose **Two-Phase Atomic Reservation in PostgreSQL**.

### Protocol
1. **Phase 1 (Reservation):** Calculate `estimatedMaxTokens = inputTokens + maxTokens`. In an atomic transaction, verify that `currentUsage + reservedTokens + estimatedMaxTokens <= monthlyTokenLimit`. If valid, create a reservation record.
2. **Phase 2 (Settlement):**
   - **On Success:** Commit actual `provider-reported` tokens to `QuotaLedger` and release the difference between estimated and actual tokens.
   - **On Known Client Error:** Release the entire reservation.
   - **On Ambiguous Upstream Timeout:** Conservatively retain the reservation to prevent unbilled execution if the upstream provider processed the request.

## Consequences
- **Positive:** Mathematically eliminates race conditions; guarantees monthly budgets are never exceeded by concurrent requests.
- **Negative:** Requires handling abandoned reservations if worker processes crash mid-flight.
- **Mitigation:** Quota reservations include timestamps and can be reconciled during period maintenance.
