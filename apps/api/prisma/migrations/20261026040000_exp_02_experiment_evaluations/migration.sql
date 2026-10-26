-- CreateTable
CREATE TABLE IF NOT EXISTS "experiment_evaluations" (
    "id" TEXT NOT NULL,
    "experimentId" TEXT NOT NULL,
    "slot" TEXT NOT NULL,
    "rating" INTEGER,
    "notes" TEXT,
    "criteriaScores" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "experiment_evaluations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "experiment_evaluations_experimentId_slot_key" ON "experiment_evaluations"("experimentId", "slot");

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'experiment_evaluations_experimentId_fkey'
  ) THEN
    ALTER TABLE "experiment_evaluations" ADD CONSTRAINT "experiment_evaluations_experimentId_fkey"
      FOREIGN KEY ("experimentId") REFERENCES "experiments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- Backfill existing evaluations from settings JSON into experiment_evaluations (Slot A)
INSERT INTO "experiment_evaluations" ("id", "experimentId", "slot", "rating", "notes", "criteriaScores", "createdAt", "updatedAt")
SELECT
    md5(e."id" || '-A')::text,
    e."id",
    'A',
    CASE
      WHEN (e."settings"->'evaluations'->'A'->>'manualRating') ~ '^[0-9]+$'
      THEN (e."settings"->'evaluations'->'A'->>'manualRating')::integer
      ELSE NULL
    END,
    e."settings"->'evaluations'->'A'->>'manualNotes',
    e."settings"->'evaluations'->'A'->'criteriaResults',
    e."createdAt",
    e."createdAt"
FROM "experiments" e
WHERE e."settings"->'evaluations'->'A' IS NOT NULL
ON CONFLICT ("experimentId", "slot") DO NOTHING;

-- Backfill existing evaluations from settings JSON into experiment_evaluations (Slot B)
INSERT INTO "experiment_evaluations" ("id", "experimentId", "slot", "rating", "notes", "criteriaScores", "createdAt", "updatedAt")
SELECT
    md5(e."id" || '-B')::text,
    e."id",
    'B',
    CASE
      WHEN (e."settings"->'evaluations'->'B'->>'manualRating') ~ '^[0-9]+$'
      THEN (e."settings"->'evaluations'->'B'->>'manualRating')::integer
      ELSE NULL
    END,
    e."settings"->'evaluations'->'B'->>'manualNotes',
    e."settings"->'evaluations'->'B'->'criteriaResults',
    e."createdAt",
    e."createdAt"
FROM "experiments" e
WHERE e."settings"->'evaluations'->'B' IS NOT NULL
ON CONFLICT ("experimentId", "slot") DO NOTHING;
