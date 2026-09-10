-- Additive HCM layer. Does not alter geofence attendance write path.

ALTER TABLE "hr_employees" ADD COLUMN IF NOT EXISTS "manager_id" TEXT;
ALTER TABLE "hr_employees" ADD COLUMN IF NOT EXISTS "position" TEXT NOT NULL DEFAULT '';
ALTER TABLE "hr_employees" ADD COLUMN IF NOT EXISTS "cost_center" TEXT NOT NULL DEFAULT '';
ALTER TABLE "hr_employees" ADD COLUMN IF NOT EXISTS "tracking_enabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "hr_employees" ADD COLUMN IF NOT EXISTS "profile" JSONB;

ALTER TABLE "hr_leaves" ADD COLUMN IF NOT EXISTS "half_day" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "hr_leaves" ADD COLUMN IF NOT EXISTS "hours" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "hr_leaves" ADD COLUMN IF NOT EXISTS "leave_type_id" TEXT;

ALTER TABLE "hr_overtimes" ADD COLUMN IF NOT EXISTS "reason" TEXT NOT NULL DEFAULT '';

ALTER TABLE "hr_tasks" ADD COLUMN IF NOT EXISTS "progress" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "hr_tasks" ADD COLUMN IF NOT EXISTS "checklist" JSONB;
ALTER TABLE "hr_tasks" ADD COLUMN IF NOT EXISTS "notes" TEXT NOT NULL DEFAULT '';

ALTER TABLE "hr_performance_reviews" ADD COLUMN IF NOT EXISTS "self_rating" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "hr_performance_reviews" ADD COLUMN IF NOT EXISTS "kpis" JSONB;
ALTER TABLE "hr_performance_reviews" ADD COLUMN IF NOT EXISTS "recommend_promotion" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "hr_performance_reviews" ADD COLUMN IF NOT EXISTS "recommend_salary" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "hr_payroll_items" ADD COLUMN IF NOT EXISTS "journal_entry_id" TEXT;

CREATE TABLE IF NOT EXISTS "hr_departments" (
  "id" TEXT NOT NULL,
  "company_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "parent_id" TEXT,
  "cost_center" TEXT NOT NULL DEFAULT '',
  "manager_employee_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "hr_departments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "hr_designations" (
  "id" TEXT NOT NULL,
  "company_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "level" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "hr_designations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "hr_shifts" (
  "id" TEXT NOT NULL,
  "company_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "start_time" TEXT NOT NULL,
  "end_time" TEXT NOT NULL,
  "break_minutes" INTEGER NOT NULL DEFAULT 60,
  "grace_minutes" INTEGER NOT NULL DEFAULT 15,
  "working_days" JSONB,
  "is_night" BOOLEAN NOT NULL DEFAULT false,
  "is_flexible" BOOLEAN NOT NULL DEFAULT false,
  "overtime_after_hours" DOUBLE PRECISION NOT NULL DEFAULT 8,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "hr_shifts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "hr_holidays" (
  "id" TEXT NOT NULL,
  "company_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "date" DATE NOT NULL,
  "type" TEXT NOT NULL DEFAULT 'Public',
  "office_id" TEXT,
  "optional" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "hr_holidays_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "hr_leave_types" (
  "id" TEXT NOT NULL,
  "company_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "paid" BOOLEAN NOT NULL DEFAULT true,
  "annual_quota" INTEGER NOT NULL DEFAULT 14,
  "carry_forward" BOOLEAN NOT NULL DEFAULT false,
  "encashable" BOOLEAN NOT NULL DEFAULT false,
  "unit" TEXT NOT NULL DEFAULT 'day',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "hr_leave_types_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "hr_leave_balances" (
  "id" TEXT NOT NULL,
  "company_id" TEXT NOT NULL,
  "employee_id" TEXT NOT NULL,
  "leave_type_id" TEXT NOT NULL,
  "year" INTEGER NOT NULL,
  "accrued" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "used" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "carried" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "encashed" DOUBLE PRECISION NOT NULL DEFAULT 0,
  CONSTRAINT "hr_leave_balances_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "hr_rosters" (
  "id" TEXT NOT NULL,
  "company_id" TEXT NOT NULL,
  "employee_id" TEXT NOT NULL,
  "shift_id" TEXT NOT NULL,
  "work_date" DATE NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'Scheduled',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "hr_rosters_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "hr_shift_swaps" (
  "id" TEXT NOT NULL,
  "company_id" TEXT NOT NULL,
  "employee_id" TEXT NOT NULL,
  "roster_id" TEXT,
  "work_date" DATE NOT NULL,
  "reason" TEXT NOT NULL DEFAULT '',
  "status" TEXT NOT NULL DEFAULT 'Pending',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "hr_shift_swaps_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "hr_attendance_corrections" (
  "id" TEXT NOT NULL,
  "company_id" TEXT NOT NULL,
  "employee_id" TEXT NOT NULL,
  "work_date" DATE NOT NULL,
  "request_type" TEXT NOT NULL,
  "reason" TEXT NOT NULL DEFAULT '',
  "proposed_in" TEXT,
  "proposed_out" TEXT,
  "status" TEXT NOT NULL DEFAULT 'Pending',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "hr_attendance_corrections_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "hr_loans" (
  "id" TEXT NOT NULL,
  "company_id" TEXT NOT NULL,
  "employee_id" TEXT NOT NULL,
  "kind" TEXT NOT NULL DEFAULT 'loan',
  "amount" DOUBLE PRECISION NOT NULL,
  "installments" INTEGER NOT NULL DEFAULT 1,
  "remaining" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "monthly_deduct" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "reason" TEXT NOT NULL DEFAULT '',
  "status" TEXT NOT NULL DEFAULT 'Pending',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "hr_loans_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "hr_bonuses" (
  "id" TEXT NOT NULL,
  "company_id" TEXT NOT NULL,
  "employee_id" TEXT NOT NULL,
  "kind" TEXT NOT NULL DEFAULT 'performance',
  "amount" DOUBLE PRECISION NOT NULL,
  "period" TEXT NOT NULL DEFAULT '',
  "reason" TEXT NOT NULL DEFAULT '',
  "status" TEXT NOT NULL DEFAULT 'Pending',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "hr_bonuses_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "hr_documents" (
  "id" TEXT NOT NULL,
  "company_id" TEXT NOT NULL,
  "employee_id" TEXT,
  "title" TEXT NOT NULL,
  "category" TEXT NOT NULL DEFAULT 'HR',
  "reference" TEXT NOT NULL DEFAULT '',
  "expires_at" DATE,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "hr_documents_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "hr_lifecycle_events" (
  "id" TEXT NOT NULL,
  "company_id" TEXT NOT NULL,
  "employee_id" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "from_value" TEXT NOT NULL DEFAULT '',
  "to_value" TEXT NOT NULL DEFAULT '',
  "effective" DATE,
  "notes" TEXT NOT NULL DEFAULT '',
  "status" TEXT NOT NULL DEFAULT 'Completed',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "hr_lifecycle_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "hr_approvals" (
  "id" TEXT NOT NULL,
  "company_id" TEXT NOT NULL,
  "module" TEXT NOT NULL,
  "record_id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "requested_by" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'Pending',
  "payload" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "hr_approvals_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "hr_audit_logs" (
  "id" TEXT NOT NULL,
  "company_id" TEXT NOT NULL,
  "actor_id" TEXT NOT NULL DEFAULT '',
  "action" TEXT NOT NULL,
  "entity" TEXT NOT NULL,
  "entity_id" TEXT NOT NULL DEFAULT '',
  "detail" TEXT NOT NULL DEFAULT '',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "hr_audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "hr_goals" (
  "id" TEXT NOT NULL,
  "company_id" TEXT NOT NULL,
  "employee_id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "kpi" TEXT NOT NULL DEFAULT '',
  "weight" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "target" TEXT NOT NULL DEFAULT '',
  "progress" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "cycle" TEXT NOT NULL DEFAULT '',
  "status" TEXT NOT NULL DEFAULT 'Open',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "hr_goals_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "hr_feedbacks" (
  "id" TEXT NOT NULL,
  "company_id" TEXT NOT NULL,
  "employee_id" TEXT NOT NULL,
  "reviewer_name" TEXT NOT NULL,
  "relation" TEXT NOT NULL DEFAULT 'manager',
  "score" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "comments" TEXT NOT NULL DEFAULT '',
  "cycle" TEXT NOT NULL DEFAULT '',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "hr_feedbacks_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "hr_employees_manager_id_idx" ON "hr_employees"("manager_id");
CREATE INDEX IF NOT EXISTS "hr_departments_company_id_idx" ON "hr_departments"("company_id");
CREATE INDEX IF NOT EXISTS "hr_designations_company_id_idx" ON "hr_designations"("company_id");
CREATE INDEX IF NOT EXISTS "hr_shifts_company_id_idx" ON "hr_shifts"("company_id");
CREATE INDEX IF NOT EXISTS "hr_holidays_company_id_date_idx" ON "hr_holidays"("company_id", "date");
CREATE INDEX IF NOT EXISTS "hr_leave_types_company_id_idx" ON "hr_leave_types"("company_id");
CREATE UNIQUE INDEX IF NOT EXISTS "hr_leave_balances_employee_id_leave_type_id_year_key" ON "hr_leave_balances"("employee_id", "leave_type_id", "year");
CREATE UNIQUE INDEX IF NOT EXISTS "hr_rosters_employee_id_work_date_key" ON "hr_rosters"("employee_id", "work_date");
CREATE INDEX IF NOT EXISTS "hr_rosters_company_id_work_date_idx" ON "hr_rosters"("company_id", "work_date");
CREATE INDEX IF NOT EXISTS "hr_approvals_company_id_status_idx" ON "hr_approvals"("company_id", "status");
CREATE INDEX IF NOT EXISTS "hr_audit_logs_company_id_created_at_idx" ON "hr_audit_logs"("company_id", "created_at");

ALTER TABLE "hr_employees" DROP CONSTRAINT IF EXISTS "hr_employees_manager_id_fkey";
ALTER TABLE "hr_employees" ADD CONSTRAINT "hr_employees_manager_id_fkey" FOREIGN KEY ("manager_id") REFERENCES "hr_employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "hr_departments" DROP CONSTRAINT IF EXISTS "hr_departments_company_id_fkey";
ALTER TABLE "hr_departments" ADD CONSTRAINT "hr_departments_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "hr_departments" DROP CONSTRAINT IF EXISTS "hr_departments_parent_id_fkey";
ALTER TABLE "hr_departments" ADD CONSTRAINT "hr_departments_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "hr_departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "hr_designations" DROP CONSTRAINT IF EXISTS "hr_designations_company_id_fkey";
ALTER TABLE "hr_designations" ADD CONSTRAINT "hr_designations_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "hr_shifts" DROP CONSTRAINT IF EXISTS "hr_shifts_company_id_fkey";
ALTER TABLE "hr_shifts" ADD CONSTRAINT "hr_shifts_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "hr_holidays" DROP CONSTRAINT IF EXISTS "hr_holidays_company_id_fkey";
ALTER TABLE "hr_holidays" ADD CONSTRAINT "hr_holidays_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "hr_leave_types" DROP CONSTRAINT IF EXISTS "hr_leave_types_company_id_fkey";
ALTER TABLE "hr_leave_types" ADD CONSTRAINT "hr_leave_types_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "hr_leave_balances" DROP CONSTRAINT IF EXISTS "hr_leave_balances_company_id_fkey";
ALTER TABLE "hr_leave_balances" ADD CONSTRAINT "hr_leave_balances_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "hr_leave_balances" DROP CONSTRAINT IF EXISTS "hr_leave_balances_employee_id_fkey";
ALTER TABLE "hr_leave_balances" ADD CONSTRAINT "hr_leave_balances_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "hr_employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "hr_leave_balances" DROP CONSTRAINT IF EXISTS "hr_leave_balances_leave_type_id_fkey";
ALTER TABLE "hr_leave_balances" ADD CONSTRAINT "hr_leave_balances_leave_type_id_fkey" FOREIGN KEY ("leave_type_id") REFERENCES "hr_leave_types"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "hr_leaves" DROP CONSTRAINT IF EXISTS "hr_leaves_leave_type_id_fkey";
ALTER TABLE "hr_leaves" ADD CONSTRAINT "hr_leaves_leave_type_id_fkey" FOREIGN KEY ("leave_type_id") REFERENCES "hr_leave_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "hr_rosters" DROP CONSTRAINT IF EXISTS "hr_rosters_company_id_fkey";
ALTER TABLE "hr_rosters" ADD CONSTRAINT "hr_rosters_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "hr_rosters" DROP CONSTRAINT IF EXISTS "hr_rosters_employee_id_fkey";
ALTER TABLE "hr_rosters" ADD CONSTRAINT "hr_rosters_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "hr_employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "hr_rosters" DROP CONSTRAINT IF EXISTS "hr_rosters_shift_id_fkey";
ALTER TABLE "hr_rosters" ADD CONSTRAINT "hr_rosters_shift_id_fkey" FOREIGN KEY ("shift_id") REFERENCES "hr_shifts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

DO $$ BEGIN
  ALTER TABLE "hr_shift_swaps" ADD CONSTRAINT "hr_shift_swaps_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "hr_shift_swaps" ADD CONSTRAINT "hr_shift_swaps_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "hr_employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "hr_attendance_corrections" ADD CONSTRAINT "hr_attendance_corrections_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "hr_attendance_corrections" ADD CONSTRAINT "hr_attendance_corrections_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "hr_employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "hr_loans" ADD CONSTRAINT "hr_loans_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "hr_loans" ADD CONSTRAINT "hr_loans_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "hr_employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "hr_bonuses" ADD CONSTRAINT "hr_bonuses_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "hr_bonuses" ADD CONSTRAINT "hr_bonuses_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "hr_employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "hr_documents" ADD CONSTRAINT "hr_documents_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "hr_documents" ADD CONSTRAINT "hr_documents_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "hr_employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "hr_lifecycle_events" ADD CONSTRAINT "hr_lifecycle_events_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "hr_lifecycle_events" ADD CONSTRAINT "hr_lifecycle_events_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "hr_employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "hr_approvals" ADD CONSTRAINT "hr_approvals_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "hr_audit_logs" ADD CONSTRAINT "hr_audit_logs_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "hr_goals" ADD CONSTRAINT "hr_goals_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "hr_goals" ADD CONSTRAINT "hr_goals_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "hr_employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "hr_feedbacks" ADD CONSTRAINT "hr_feedbacks_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "hr_feedbacks" ADD CONSTRAINT "hr_feedbacks_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "hr_employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
