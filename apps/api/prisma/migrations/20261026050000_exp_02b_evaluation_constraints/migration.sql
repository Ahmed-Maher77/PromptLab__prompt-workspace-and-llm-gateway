-- Clean out-of-range legacy ratings (EXP-02b)
UPDATE "experiment_evaluations"
SET "rating" = NULL
WHERE "rating" IS NOT NULL AND "rating" NOT BETWEEN 1 AND 5;

-- Strip automated evaluation results stored in criteriaScores (EXP-02a)
UPDATE "experiment_evaluations" ev
SET "criteriaScores" = NULL
FROM "experiments" e
WHERE ev."experimentId" = e."id"
  AND ev."criteriaScores" IS NOT NULL
  AND ev."criteriaScores" = e."settings"->'evaluations'->ev."slot"->'criteriaResults';

-- Remove evaluation rows that carry no manual feedback (EXP-02a)
DELETE FROM "experiment_evaluations"
WHERE "rating" IS NULL
  AND "notes" IS NULL
  AND "criteriaScores" IS NULL;

-- Add database check constraints for rating and slot (EXP-02b)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'experiment_evaluations_rating_check'
  ) THEN
    ALTER TABLE "experiment_evaluations" ADD CONSTRAINT "experiment_evaluations_rating_check"
      CHECK ("rating" IS NULL OR "rating" BETWEEN 1 AND 5);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'experiment_evaluations_slot_check'
  ) THEN
    ALTER TABLE "experiment_evaluations" ADD CONSTRAINT "experiment_evaluations_slot_check"
      CHECK ("slot" IN ('A', 'B'));
  END IF;
END $$;
