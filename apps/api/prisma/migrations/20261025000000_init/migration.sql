-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'user',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prompts" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "techniqueMetadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "prompts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prompt_versions" (
    "id" TEXT NOT NULL,
    "promptId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "templateBody" TEXT NOT NULL,
    "variables" JSONB NOT NULL DEFAULT '[]',
    "examples" JSONB NOT NULL DEFAULT '[]',
    "outputSchema" JSONB,
    "modelDefaults" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL,

    CONSTRAINT "prompt_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "experiments" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "commonInput" TEXT NOT NULL,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "experiments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "experiment_runs" (
    "id" TEXT NOT NULL,
    "experimentId" TEXT NOT NULL,
    "slot" TEXT NOT NULL,
    "promptVersionId" TEXT,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "output" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "tokenUsageSource" TEXT NOT NULL DEFAULT 'estimated',
    "latencyMs" INTEGER NOT NULL DEFAULT 0,
    "estimatedCost" DOUBLE PRECISION,
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "experiment_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversations" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation_messages" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "sequenceNumber" INTEGER NOT NULL,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "tokenUsageSource" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation_checkpoints" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "retainedFacts" JSONB NOT NULL DEFAULT '[]',
    "compactedThroughSequence" INTEGER NOT NULL,
    "contextPolicyVersion" TEXT NOT NULL DEFAULT 'v1',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_checkpoints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quota_policies" (
    "id" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'user',
    "scopeId" TEXT NOT NULL,
    "monthlyTokenLimit" INTEGER NOT NULL DEFAULT 1000000,
    "requestRateLimit" INTEGER NOT NULL DEFAULT 60,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quota_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quota_periods" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "tokenLimit" INTEGER NOT NULL,
    "reservedTokens" INTEGER NOT NULL DEFAULT 0,
    "actualTokens" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'active',

    CONSTRAINT "quota_periods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usage_records" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "conversationId" TEXT,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "tokenUsageSource" TEXT NOT NULL DEFAULT 'estimated',
    "reservedTokens" INTEGER NOT NULL DEFAULT 0,
    "estimatedCost" DOUBLE PRECISION,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reconciledAt" TIMESTAMP(3),

    CONSTRAINT "usage_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "prompt_versions_promptId_versionNumber_key" ON "prompt_versions"("promptId", "versionNumber");

-- CreateIndex
CREATE INDEX "conversation_messages_conversationId_sequenceNumber_idx" ON "conversation_messages"("conversationId", "sequenceNumber");

-- CreateIndex
CREATE UNIQUE INDEX "quota_policies_scope_scopeId_key" ON "quota_policies"("scope", "scopeId");

-- CreateIndex
CREATE UNIQUE INDEX "quota_periods_userId_periodStart_key" ON "quota_periods"("userId", "periodStart");

-- CreateIndex
CREATE UNIQUE INDEX "usage_records_requestId_key" ON "usage_records"("requestId");

-- CreateIndex
CREATE INDEX "usage_records_userId_createdAt_idx" ON "usage_records"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "prompts" ADD CONSTRAINT "prompts_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prompt_versions" ADD CONSTRAINT "prompt_versions_promptId_fkey" FOREIGN KEY ("promptId") REFERENCES "prompts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "experiments" ADD CONSTRAINT "experiments_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "experiment_runs" ADD CONSTRAINT "experiment_runs_experimentId_fkey" FOREIGN KEY ("experimentId") REFERENCES "experiments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "experiment_runs" ADD CONSTRAINT "experiment_runs_promptVersionId_fkey" FOREIGN KEY ("promptVersionId") REFERENCES "prompt_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_checkpoints" ADD CONSTRAINT "conversation_checkpoints_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quota_periods" ADD CONSTRAINT "quota_periods_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usage_records" ADD CONSTRAINT "usage_records_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
