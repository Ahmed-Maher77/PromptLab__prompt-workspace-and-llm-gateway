-- AlterTable
ALTER TABLE "conversation_messages" ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'complete';
