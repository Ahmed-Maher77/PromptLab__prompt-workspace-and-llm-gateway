-- AlterTable
ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "activeCheckpointId" TEXT;

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'conversations_activeCheckpointId_fkey'
  ) THEN
    ALTER TABLE "conversations" ADD CONSTRAINT "conversations_activeCheckpointId_fkey"
      FOREIGN KEY ("activeCheckpointId") REFERENCES "conversation_checkpoints"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
