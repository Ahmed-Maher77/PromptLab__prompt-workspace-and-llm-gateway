-- DropIndex
DROP INDEX IF EXISTS "conversation_messages_conversationId_sequenceNumber_idx";

-- AlterTable
ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "lastSequence" INTEGER NOT NULL DEFAULT 0;

-- Move duplicate rows (keep the earliest of each group) to fresh numbers after the conversation's current max
WITH dups AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY "conversationId", "sequenceNumber" ORDER BY "createdAt", id) AS dup_rank
  FROM "conversation_messages"
), to_move AS (
  SELECT m.id, m."conversationId",
         ROW_NUMBER() OVER (PARTITION BY m."conversationId" ORDER BY m."sequenceNumber", m."createdAt", m.id) AS k
  FROM dups d JOIN "conversation_messages" m ON m.id = d.id
  WHERE d.dup_rank > 1
), maxes AS (
  SELECT "conversationId", MAX("sequenceNumber") AS mx FROM "conversation_messages" GROUP BY "conversationId"
)
UPDATE "conversation_messages" cm SET "sequenceNumber" = mx.mx + t.k
FROM to_move t JOIN maxes mx ON mx."conversationId" = t."conversationId"
WHERE cm.id = t.id;

-- Backfill lastSequence from existing messages
UPDATE "conversations" c
SET "lastSequence" = COALESCE((
    SELECT MAX("sequenceNumber")
    FROM "conversation_messages"
    WHERE "conversationId" = c.id
), 0);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "conversation_messages_conversationId_sequenceNumber_key" ON "conversation_messages"("conversationId", "sequenceNumber");
