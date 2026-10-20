---
type: Decision
title: "ADR-001: Modular Monolith Backend with NestJS"
description: "Architectural decision to structure PromptLab backend as a modular monolith in NestJS"
status: accepted
date: "2026-10-18"
decision_makers: ["PromptLab Core Team"]
---

# ADR-001: Modular Monolith Backend with NestJS

## Context
PromptLab required a backend architecture capable of managing multiple domain concerns: prompt templates and immutable versioning, multi-model execution, side-by-side experiments, conversational context compaction, quota governance, and distributed telemetry export. We needed to choose between a microservice architecture and a modular monolith.

## Alternatives Considered
1. **Microservices Architecture:** Decomposing prompts, execution, quotas, and tracing into independent deployable microservices communicating over HTTP/gRPC.
2. **Modular Monolith in NestJS:** A single Node.js runtime process organized into strictly encapsulated NestJS modules (`prompts`, `providers`, `experiments`, `conversations`, `usage`, `observability`, `settings`, `health`).

## Decision
We chose the **Modular Monolith** using **NestJS**.

### Rationale
- **Encapsulated Boundaries:** NestJS provides dependency injection and explicit module encapsulation, allowing domain isolation without network serialization overhead.
- **Transactional Integrity:** Complex operations—such as atomic quota reservation during model dispatch—can execute within local ACID database transactions in PostgreSQL without distributed transaction managers (2PC/Saga).
- **Reduced Operational Overhead:** Single application lifecycle, simple deployment, and rapid end-to-end integration testing.

## Consequences
- **Positive:** Simpler developer workflow, zero network overhead between modules, and guaranteed ACID consistency.
- **Negative:** Horizontal scaling scales the entire monolith rather than individual high-load domains.
- **Mitigation:** Modules maintain clean service interfaces so individual domains can be extracted into microservices if future workload demands require it.
