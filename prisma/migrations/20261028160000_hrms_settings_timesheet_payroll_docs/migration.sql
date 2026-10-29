-- HR Settings as a proper single-record DocType, Activity Type / Timesheet,
-- and geofence fields on Branch (hr_offices). Additive only.

CREATE TABLE IF NOT EXISTS "hr_settings_docs" (
  "id" TEXT NOT NULL,
  "company_id" TEXT NOT NULL,
  "emp_created_by" TEXT NOT NULL DEFAULT 'Naming Series',
  "employee_name_format" TEXT NOT NULL DEFAULT '',
  "retirement_age" DOUBLE PRECISION NOT NULL DEFAULT 60,
  "emp_created_on" TEXT NOT NULL DEFAULT '',
  "send_work_anniversary_reminders" BOOLEAN NOT NULL DEFAULT false,
  "send_birthday_reminders" BOOLEAN NOT NULL DEFAULT false,
  "send_holiday_reminders" BOOLEAN NOT NULL DEFAULT false,
  "frequency" TEXT NOT NULL DEFAULT 'Monthly',
  "leave_approval_notification" BOOLEAN NOT NULL DEFAULT true,
  "leave_status_notification" BOOLEAN NOT NULL DEFAULT true,
  "allow_multiple_leave_apps" BOOLEAN NOT NULL DEFAULT false,
  "restrict_backdated_leave" BOOLEAN NOT NULL DEFAULT false,
  "show_leaves_of_past_years" BOOLEAN NOT NULL DEFAULT false,
  "expense_approver_mandatory" BOOLEAN NOT NULL DEFAULT true,
  "allow_employee_checkin" BOOLEAN NOT NULL DEFAULT true,
  "allow_geolocation" BOOLEAN NOT NULL DEFAULT true,
  "auto_attendance" BOOLEAN NOT NULL DEFAULT false,
  "checkin_radius" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "exit_questionnaire_webhook" TEXT NOT NULL DEFAULT '',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "hr_settings_docs_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "hr_settings_docs_company_id_key" ON "hr_settings_docs"("company_id");

CREATE TABLE IF NOT EXISTS "hr_activity_types" (
  "id" TEXT NOT NULL,
  "company_id" TEXT NOT NULL,
  "activity_type" TEXT NOT NULL,
  "costing_rate" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "billing_rate" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "disabled" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "hr_activity_types_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "hr_activity_types_company_id_activity_type_key" ON "hr_activity_types"("company_id", "activity_type");
CREATE INDEX IF NOT EXISTS "hr_activity_types_company_id_idx" ON "hr_activity_types"("company_id");

CREATE TABLE IF NOT EXISTS "hr_timesheets" (
  "id" TEXT NOT NULL,
  "company_id" TEXT NOT NULL,
  "employee_id" TEXT,
  "employee_name" TEXT NOT NULL DEFAULT '',
  "start_date" DATE,
  "end_date" DATE,
  "title" TEXT NOT NULL DEFAULT '',
  "status" TEXT NOT NULL DEFAULT 'Draft',
  "doc_status" INTEGER NOT NULL DEFAULT 0,
  "total_hours" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "note" TEXT NOT NULL DEFAULT '',
  "time_logs" JSONB NOT NULL DEFAULT '[]',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "hr_timesheets_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "hr_timesheets_company_id_employee_id_idx" ON "hr_timesheets"("company_id", "employee_id");

-- Branch / office geofence fields used by ERPNext Shift Location & attendance
ALTER TABLE "hr_offices" ADD COLUMN IF NOT EXISTS "latitude" DOUBLE PRECISION;
ALTER TABLE "hr_offices" ADD COLUMN IF NOT EXISTS "longitude" DOUBLE PRECISION;
ALTER TABLE "hr_offices" ADD COLUMN IF NOT EXISTS "radius_meters" INTEGER NOT NULL DEFAULT 150;
ALTER TABLE "hr_offices" ADD COLUMN IF NOT EXISTS "address" TEXT NOT NULL DEFAULT '';
