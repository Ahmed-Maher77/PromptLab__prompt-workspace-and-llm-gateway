-- DropIndex
DROP INDEX "usage_records_requestId_key";

-- AlterTable
ALTER TABLE "usage_records" ADD COLUMN "responseBody" JSONB;

-- CreateIndex
CREATE UNIQUE INDEX "usage_records_userId_requestId_key" ON "usage_records"("userId", "requestId");
