---
type: Architecture
title: "Relational Data Model & Prisma Schema"
description: "Documentation of database tables, relationships, constraints, and Prisma schema definitions"
status: active
domain: "database"
---

# Relational Data Model & Prisma Schema

## Overview
PromptLab uses PostgreSQL as its primary relational store, managed via Prisma (`apps/api/prisma/schema.prisma`).

## Entity Relationship Overview

```mermaid
erDiagram
    Prompt ||--o{ PromptVersion : "has many versions"
    PromptVersion ||--o{ Experiment : "evaluated in"
    Conversation ||--o{ Message : "contains"
    User ||--o{ QuotaPolicy : "governed by"
    User ||--o{ QuotaLedger : "audited in"
    User ||--o{ Conversation : "owns"

    Prompt {
        string id PK
        string name
        string description
        json techniques
        datetime createdAt
        datetime updatedAt
    }

    PromptVersion {
        string id PK
        string promptId FK
        int versionNumber
        string templateBody
        string changeDescription
        string parentVersionId
        datetime createdAt
    }

    Experiment {
        string id PK
        string promptText
        json slotAConfig
        json slotBConfig
        string outputA
        string outputB
        int rating
        string winner
        datetime createdAt
    }

    Conversation {
        string id PK
        string title
        string model
        string systemPrompt
        int contextBudget
        int currentTokens
        string summary
        datetime createdAt
        datetime updatedAt
    }

    Message {
        string id PK
        string conversationId FK
        string role
        string content
        int tokenCount
        datetime createdAt
    }

    QuotaPolicy {
        string id PK
        string scope
        string scopeId
        int monthlyTokenLimit
        int requestRateLimit
        datetime effectiveFrom
    }

    QuotaLedger {
        string id PK
        string scope
        string scopeId
        int promptTokens
        int completionTokens
        int totalTokens
        string model
        datetime timestamp
    }
```

## Indexes
Besides the primary keys and unique constraints (which PostgreSQL also indexes), the schema defines indexes for every foreign key that is filtered on and for the hot list and background queries:

| Table | Index | Serves |
| :--- | :--- | :--- |
| `prompts` | `(ownerId, updatedAt)` | Prompt list, newest first |
| `experiments` | `(ownerId, createdAt)` | Comparison list, newest first |
| `experiment_runs` | `(experimentId)`, `(promptVersionId)` | Loading runs per experiment; `ON DELETE SET NULL` on prompt versions |
| `conversations` | `(ownerId, updatedAt)`, `(activeCheckpointId)` | Conversation list; `ON DELETE SET NULL` on checkpoints |
| `conversation_checkpoints` | `(conversationId, createdAt)` | Checkpoints per conversation, latest first |
| `quota_periods` | `(status, periodEnd)` | Closing expired periods (every minute) |
| `usage_records` | `(userId, createdAt)`, `(status, createdAt)` | Usage ledger; stale-reservation sweeper (every minute) |

`conversation_messages`, `prompt_versions` and `experiment_evaluations` are covered by their composite unique constraints, whose leading column is the parent ID.

## Schema Synchronization
- The database schema is versioned via Prisma migrations in `apps/api/prisma/migrations/`.
- Deploy migrations using `npm run prisma:push` or `npm run prisma:deploy` (`prisma migrate deploy`).
- Migrations are append-only: never edit one that has been applied; add a new migration instead.
- For new schema changes during development, use `npm run prisma:migrate` (`prisma migrate dev`).
