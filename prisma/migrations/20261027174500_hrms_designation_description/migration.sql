-- ERPNext Designation carries a description; additive only.
ALTER TABLE IF EXISTS "hr_designations" ADD COLUMN IF NOT EXISTS "description" TEXT NOT NULL DEFAULT '';
