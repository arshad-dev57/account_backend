-- Employee ↔ User: Employee can exist without application login
ALTER TABLE "hr_employees" DROP CONSTRAINT IF EXISTS "hr_employees_user_id_fkey";
ALTER TABLE "hr_employees" ALTER COLUMN "user_id" DROP NOT NULL;
ALTER TABLE "hr_employees"
  ADD CONSTRAINT "hr_employees_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Quality Inspection: primary inspector is application User; HR employee optional
ALTER TABLE "manufacturing_quality_inspections"
  ADD COLUMN IF NOT EXISTS "inspector_user_id" TEXT;

ALTER TABLE "manufacturing_quality_inspections"
  ALTER COLUMN "inspector_id" DROP NOT NULL;

-- Backfill inspector_user_id from linked HR employee login
UPDATE "manufacturing_quality_inspections" qi
SET "inspector_user_id" = he."user_id"
FROM "hr_employees" he
WHERE qi."inspector_id" = he."id"
  AND qi."inspector_user_id" IS NULL
  AND he."user_id" IS NOT NULL;

-- Fallback: use created_by when still null
UPDATE "manufacturing_quality_inspections"
SET "inspector_user_id" = "created_by"
WHERE "inspector_user_id" IS NULL
  AND "created_by" IS NOT NULL;

ALTER TABLE "manufacturing_quality_inspections" DROP CONSTRAINT IF EXISTS "manufacturing_quality_inspections_inspector_user_id_fkey";
ALTER TABLE "manufacturing_quality_inspections"
  ADD CONSTRAINT "manufacturing_quality_inspections_inspector_user_id_fkey"
  FOREIGN KEY ("inspector_user_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "manufacturing_quality_inspections_inspector_user_id_idx"
  ON "manufacturing_quality_inspections"("inspector_user_id");
