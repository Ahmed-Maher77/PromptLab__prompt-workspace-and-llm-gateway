-- AlterTable
ALTER TABLE "conversation_messages" ADD COLUMN "requestId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "conversation_messages_conversationId_requestId_role_key" ON "conversation_messages"("conversationId", "requestId", "role");
