ALTER TABLE "hr_designations" ADD COLUMN IF NOT EXISTS "appraisal_template_id" TEXT;
ALTER TABLE "hr_designations" ADD COLUMN IF NOT EXISTS "skills" JSONB NOT NULL DEFAULT '[]';
