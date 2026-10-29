-- AlterTable: Additional Salary notes + Attendance Request shift link
ALTER TABLE "hr_bonuses" ADD COLUMN IF NOT EXISTS "notes" TEXT NOT NULL DEFAULT '';
ALTER TABLE "hr_attendance_corrections" ADD COLUMN IF NOT EXISTS "shift_id" TEXT;

-- AlterTable: Goal department/designation attribution
ALTER TABLE "hr_goals" ADD COLUMN IF NOT EXISTS "department" TEXT NOT NULL DEFAULT '';
ALTER TABLE "hr_goals" ADD COLUMN IF NOT EXISTS "designation" TEXT NOT NULL DEFAULT '';

-- AlterTable: Performance Feedback submit lifecycle
ALTER TABLE "hr_feedbacks" ADD COLUMN IF NOT EXISTS "appraisal_cycle_id" TEXT;
ALTER TABLE "hr_feedbacks" ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'Draft';
ALTER TABLE "hr_feedbacks" ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Data alignment: legacy workflow values mapped to the ERPNext vocabularies.
UPDATE "hr_attendance_corrections" SET "status" = 'Open' WHERE "status" = 'Pending';
UPDATE "hr_bonuses" SET "status" = 'Draft' WHERE "status" = 'Pending';
UPDATE "hr_overtimes" SET "status" = 'Draft' WHERE "status" = 'Pending';
UPDATE "hr_goals" SET "status" = 'Pending' WHERE "status" = 'Open';

-- AlterTable: Attendance Request keeps its own attendance status next to the document status
ALTER TABLE "hr_attendance_corrections" ADD COLUMN IF NOT EXISTS "attendance_status" TEXT NOT NULL DEFAULT 'Present';
