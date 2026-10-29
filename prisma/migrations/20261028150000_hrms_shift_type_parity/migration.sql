-- Align HrShift / Shift Type with the ERPNext Shift Type form fields.
ALTER TABLE "hr_shifts" ADD COLUMN IF NOT EXISTS "holiday_list_id" TEXT;
ALTER TABLE "hr_shifts" ADD COLUMN IF NOT EXISTS "roster_color" TEXT NOT NULL DEFAULT 'Blue';
ALTER TABLE "hr_shifts" ADD COLUMN IF NOT EXISTS "determine_check_in_and_check_out" TEXT NOT NULL DEFAULT 'Alternating entries as IN and OUT during the same shift';
ALTER TABLE "hr_shifts" ADD COLUMN IF NOT EXISTS "working_hours_calculation_based_on" TEXT NOT NULL DEFAULT 'First Check-in and Last Check-out';
ALTER TABLE "hr_shifts" ADD COLUMN IF NOT EXISTS "mark_auto_attendance_on_holidays" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "hr_shifts" ADD COLUMN IF NOT EXISTS "working_hours_threshold_for_half_day" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "hr_shifts" ADD COLUMN IF NOT EXISTS "working_hours_threshold_for_absent" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "hr_shifts" ADD COLUMN IF NOT EXISTS "process_attendance_after" DATE;
ALTER TABLE "hr_shifts" ADD COLUMN IF NOT EXISTS "last_sync_of_checkin" TIMESTAMP(3);
ALTER TABLE "hr_shifts" ADD COLUMN IF NOT EXISTS "auto_update_last_sync" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "hr_shifts" ADD COLUMN IF NOT EXISTS "allow_overtime" BOOLEAN NOT NULL DEFAULT false;
