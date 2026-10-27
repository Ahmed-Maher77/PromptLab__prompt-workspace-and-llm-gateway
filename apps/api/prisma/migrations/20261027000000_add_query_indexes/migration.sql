-- Indexes for foreign keys and the hottest list / background queries.
-- Owner-scoped lists are ordered by recency, so the owner column leads and the sort column follows.

-- CreateIndex
CREATE INDEX "prompts_ownerId_updatedAt_idx" ON "prompts"("ownerId", "updatedAt");

-- CreateIndex
CREATE INDEX "experiments_ownerId_createdAt_idx" ON "experiments"("ownerId", "createdAt");

-- CreateIndex
CREATE INDEX "experiment_runs_experimentId_idx" ON "experiment_runs"("experimentId");

-- CreateIndex
CREATE INDEX "experiment_runs_promptVersionId_idx" ON "experiment_runs"("promptVersionId");

-- CreateIndex
CREATE INDEX "conversations_ownerId_updatedAt_idx" ON "conversations"("ownerId", "updatedAt");

-- CreateIndex
CREATE INDEX "conversations_activeCheckpointId_idx" ON "conversations"("activeCheckpointId");

-- CreateIndex
CREATE INDEX "conversation_checkpoints_conversationId_createdAt_idx" ON "conversation_checkpoints"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "quota_periods_status_periodEnd_idx" ON "quota_periods"("status", "periodEnd");

-- CreateIndex
CREATE INDEX "usage_records_status_createdAt_idx" ON "usage_records"("status", "createdAt");
