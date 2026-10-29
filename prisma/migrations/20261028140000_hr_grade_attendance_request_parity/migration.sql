-- Employee Grade: ERPNext default_salary_structure / currency / default_base_pay
ALTER TABLE "hr_employee_grades"
  ADD COLUMN IF NOT EXISTS "default_salary_structure_id" TEXT,
  ADD COLUMN IF NOT EXISTS "currency" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "default_base_pay" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- Attendance Request: ERPNext half_day / half_day_date / explanation
ALTER TABLE "hr_attendance_corrections"
  ADD COLUMN IF NOT EXISTS "half_day" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "half_day_date" DATE,
  ADD COLUMN IF NOT EXISTS "explanation" TEXT NOT NULL DEFAULT '';
