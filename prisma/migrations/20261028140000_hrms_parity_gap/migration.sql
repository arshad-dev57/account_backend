-- Remaining ERPNext HR DocTypes that were previously stubbed in the workspace nav.
-- Additive only.

CREATE TABLE IF NOT EXISTS "hr_shift_schedules" (
  "id" TEXT NOT NULL,
  "company_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "shift_type_id" TEXT,
  "frequency" TEXT NOT NULL DEFAULT 'Every Week',
  "repeat_on_days" JSONB NOT NULL DEFAULT '[]',
  "status" TEXT NOT NULL DEFAULT 'Draft',
  "doc_status" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "hr_shift_schedules_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "hr_shift_schedules_company_id_name_key" ON "hr_shift_schedules"("company_id", "name");

CREATE INDEX IF NOT EXISTS "hr_shift_schedules_company_id_idx" ON "hr_shift_schedules"("company_id");

CREATE TABLE IF NOT EXISTS "hr_shift_schedule_assignments" (
  "id" TEXT NOT NULL,
  "company_id" TEXT NOT NULL,
  "employee_id" TEXT NOT NULL,
  "employee_name" TEXT NOT NULL DEFAULT '',
  "shift_schedule_id" TEXT,
  "shift_location_id" TEXT,
  "shift_status" TEXT NOT NULL DEFAULT 'Active',
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "create_shifts_after" DATE,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "hr_shift_schedule_assignments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "hr_shift_schedule_assignments_company_id_employee_id_idx" ON "hr_shift_schedule_assignments"("company_id", "employee_id");

CREATE TABLE IF NOT EXISTS "hr_purposes_of_travel" (
  "id" TEXT NOT NULL,
  "company_id" TEXT NOT NULL,
  "purpose_of_travel" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "hr_purposes_of_travel_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "hr_purposes_of_travel_company_id_purpose_of_travel_key" ON "hr_purposes_of_travel"("company_id", "purpose_of_travel");

CREATE INDEX IF NOT EXISTS "hr_purposes_of_travel_company_id_idx" ON "hr_purposes_of_travel"("company_id");

CREATE TABLE IF NOT EXISTS "hr_travel_requests" (
  "id" TEXT NOT NULL,
  "company_id" TEXT NOT NULL,
  "employee_id" TEXT NOT NULL,
  "employee_name" TEXT NOT NULL DEFAULT '',
  "travel_type" TEXT NOT NULL DEFAULT 'Domestic',
  "travel_funding" TEXT NOT NULL DEFAULT '',
  "travel_proof" TEXT NOT NULL DEFAULT '',
  "purpose_of_travel_id" TEXT,
  "details_of_sponsor" TEXT NOT NULL DEFAULT '',
  "description" TEXT NOT NULL DEFAULT '',
  "itinerary" JSONB NOT NULL DEFAULT '[]',
  "costings" JSONB NOT NULL DEFAULT '[]',
  "cost_center" TEXT NOT NULL DEFAULT '',
  "personal_id_type" TEXT NOT NULL DEFAULT '',
  "personal_id_number" TEXT NOT NULL DEFAULT '',
  "name_of_organizer" TEXT NOT NULL DEFAULT '',
  "address_of_organizer" TEXT NOT NULL DEFAULT '',
  "other_details" TEXT NOT NULL DEFAULT '',
  "status" TEXT NOT NULL DEFAULT 'Draft',
  "doc_status" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "hr_travel_requests_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "hr_travel_requests_company_id_employee_id_idx" ON "hr_travel_requests"("company_id", "employee_id");

CREATE TABLE IF NOT EXISTS "hr_vehicles" (
  "id" TEXT NOT NULL,
  "company_id" TEXT NOT NULL,
  "license_plate" TEXT NOT NULL,
  "make" TEXT NOT NULL DEFAULT '',
  "model" TEXT NOT NULL DEFAULT '',
  "employee_id" TEXT,
  "odometer" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "fuel_type" TEXT NOT NULL DEFAULT '',
  "uom" TEXT NOT NULL DEFAULT 'Litre',
  "location" TEXT NOT NULL DEFAULT '',
  "chassis_no" TEXT NOT NULL DEFAULT '',
  "acquisition_date" DATE,
  "disabled" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "hr_vehicles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "hr_vehicles_company_id_license_plate_key" ON "hr_vehicles"("company_id", "license_plate");

CREATE INDEX IF NOT EXISTS "hr_vehicles_company_id_idx" ON "hr_vehicles"("company_id");

CREATE TABLE IF NOT EXISTS "hr_drivers" (
  "id" TEXT NOT NULL,
  "company_id" TEXT NOT NULL,
  "full_name" TEXT NOT NULL,
  "employee_id" TEXT,
  "cell_number" TEXT NOT NULL DEFAULT '',
  "license_number" TEXT NOT NULL DEFAULT '',
  "issuing_date" DATE,
  "expiry_date" DATE,
  "address" TEXT NOT NULL DEFAULT '',
  "status" TEXT NOT NULL DEFAULT 'Active',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "hr_drivers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "hr_drivers_company_id_full_name_key" ON "hr_drivers"("company_id", "full_name");

CREATE INDEX IF NOT EXISTS "hr_drivers_company_id_idx" ON "hr_drivers"("company_id");

CREATE TABLE IF NOT EXISTS "hr_vehicle_logs" (
  "id" TEXT NOT NULL,
  "company_id" TEXT NOT NULL,
  "naming_series" TEXT NOT NULL DEFAULT 'HR-VLOG-.YYYY.-',
  "vehicle_id" TEXT,
  "employee_id" TEXT,
  "model" TEXT NOT NULL DEFAULT '',
  "make" TEXT NOT NULL DEFAULT '',
  "date" DATE,
  "odometer" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "last_odometer" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "fuel_qty" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "price" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "supplier" TEXT NOT NULL DEFAULT '',
  "invoice" TEXT NOT NULL DEFAULT '',
  "service_detail" JSONB NOT NULL DEFAULT '[]',
  "status" TEXT NOT NULL DEFAULT 'Draft',
  "doc_status" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "hr_vehicle_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "hr_vehicle_logs_company_id_idx" ON "hr_vehicle_logs"("company_id");

CREATE TABLE IF NOT EXISTS "hr_salary_withholdings" (
  "id" TEXT NOT NULL,
  "company_id" TEXT NOT NULL,
  "employee_id" TEXT NOT NULL,
  "employee_name" TEXT NOT NULL DEFAULT '',
  "posting_date" DATE,
  "from_date" DATE,
  "to_date" DATE,
  "status" TEXT NOT NULL DEFAULT 'Draft',
  "doc_status" INTEGER NOT NULL DEFAULT 0,
  "reason" TEXT NOT NULL DEFAULT '',
  "are_withheld_salaries_released" BOOLEAN NOT NULL DEFAULT false,
  "cycles" JSONB NOT NULL DEFAULT '[]',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "hr_salary_withholdings_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "hr_salary_withholdings_company_id_employee_id_idx" ON "hr_salary_withholdings"("company_id", "employee_id");

CREATE TABLE IF NOT EXISTS "hr_employee_benefit_ledgers" (
  "id" TEXT NOT NULL,
  "company_id" TEXT NOT NULL,
  "posting_date" DATE,
  "employee_id" TEXT,
  "employee_name" TEXT NOT NULL DEFAULT '',
  "salary_component_id" TEXT,
  "payroll_period" TEXT NOT NULL DEFAULT '',
  "reference_doctype" TEXT NOT NULL DEFAULT '',
  "reference_document" TEXT NOT NULL DEFAULT '',
  "salary_slip" TEXT NOT NULL DEFAULT '',
  "transaction_type" TEXT NOT NULL DEFAULT '',
  "amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "remarks" TEXT NOT NULL DEFAULT '',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "hr_employee_benefit_ledgers_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "hr_employee_benefit_ledgers_company_id_employee_id_idx" ON "hr_employee_benefit_ledgers"("company_id", "employee_id");

CREATE TABLE IF NOT EXISTS "hr_gratuity_rules" (
  "id" TEXT NOT NULL,
  "company_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "disable" BOOLEAN NOT NULL DEFAULT false,
  "calculate_gratuity_amount_based_on" TEXT NOT NULL DEFAULT 'Current Slab',
  "total_working_days_per_year" DOUBLE PRECISION NOT NULL DEFAULT 365,
  "work_experience_calculation_function" TEXT NOT NULL DEFAULT 'Round off Work Experience',
  "minimum_year_for_gratuity" INTEGER NOT NULL DEFAULT 0,
  "applicable_earnings_component" JSONB NOT NULL DEFAULT '[]',
  "gratuity_rule_slabs" JSONB NOT NULL DEFAULT '[]',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "hr_gratuity_rules_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "hr_gratuity_rules_company_id_name_key" ON "hr_gratuity_rules"("company_id", "name");

CREATE INDEX IF NOT EXISTS "hr_gratuity_rules_company_id_idx" ON "hr_gratuity_rules"("company_id");

CREATE TABLE IF NOT EXISTS "hr_gratuities" (
  "id" TEXT NOT NULL,
  "company_id" TEXT NOT NULL,
  "employee_id" TEXT NOT NULL,
  "employee_name" TEXT NOT NULL DEFAULT '',
  "department" TEXT NOT NULL DEFAULT '',
  "designation" TEXT NOT NULL DEFAULT '',
  "current_work_experience" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "posting_date" DATE,
  "gratuity_rule_id" TEXT,
  "amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "salary_component_id" TEXT,
  "pay_via_salary_slip" BOOLEAN NOT NULL DEFAULT true,
  "cost_center" TEXT NOT NULL DEFAULT '',
  "mode_of_payment" TEXT NOT NULL DEFAULT '',
  "expense_account" TEXT NOT NULL DEFAULT '',
  "payable_account" TEXT NOT NULL DEFAULT '',
  "paid_amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'Draft',
  "doc_status" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "hr_gratuities_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "hr_gratuities_company_id_employee_id_idx" ON "hr_gratuities"("company_id", "employee_id");

CREATE TABLE IF NOT EXISTS "hr_exit_interviews" (
  "id" TEXT NOT NULL,
  "company_id" TEXT NOT NULL,
  "naming_series" TEXT NOT NULL DEFAULT 'HR-EXIT-INT-',
  "employee_id" TEXT NOT NULL,
  "employee_name" TEXT NOT NULL DEFAULT '',
  "email" TEXT NOT NULL DEFAULT '',
  "status" TEXT NOT NULL DEFAULT 'Pending',
  "date" DATE,
  "department" TEXT NOT NULL DEFAULT '',
  "designation" TEXT NOT NULL DEFAULT '',
  "reports_to" TEXT NOT NULL DEFAULT '',
  "date_of_joining" DATE,
  "relieving_date" DATE,
  "ref_doctype" TEXT NOT NULL DEFAULT '',
  "questionnaire_email_sent" BOOLEAN NOT NULL DEFAULT false,
  "reference_document_name" TEXT NOT NULL DEFAULT '',
  "interviewers" JSONB NOT NULL DEFAULT '[]',
  "interview_summary" TEXT NOT NULL DEFAULT '',
  "employee_status" TEXT NOT NULL DEFAULT '',
  "doc_status" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "hr_exit_interviews_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "hr_exit_interviews_company_id_employee_id_idx" ON "hr_exit_interviews"("company_id", "employee_id");

CREATE TABLE IF NOT EXISTS "hr_full_and_final_statements" (
  "id" TEXT NOT NULL,
  "company_id" TEXT NOT NULL,
  "employee_id" TEXT NOT NULL,
  "employee_name" TEXT NOT NULL DEFAULT '',
  "transaction_date" DATE,
  "status" TEXT NOT NULL DEFAULT 'Draft',
  "doc_status" INTEGER NOT NULL DEFAULT 0,
  "date_of_joining" DATE,
  "relieving_date" DATE,
  "designation" TEXT NOT NULL DEFAULT '',
  "department" TEXT NOT NULL DEFAULT '',
  "payables" JSONB NOT NULL DEFAULT '[]',
  "receivables" JSONB NOT NULL DEFAULT '[]',
  "assets_allocated" JSONB NOT NULL DEFAULT '[]',
  "total_asset_recovery_cost" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "total_payable_amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "total_receivable_amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "hr_full_and_final_statements_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "hr_full_and_final_statements_company_id_employee_id_idx" ON "hr_full_and_final_statements"("company_id", "employee_id");

CREATE TABLE IF NOT EXISTS "hr_compensatory_leave_requests" (
  "id" TEXT NOT NULL,
  "company_id" TEXT NOT NULL,
  "employee_id" TEXT NOT NULL,
  "employee_name" TEXT NOT NULL DEFAULT '',
  "department" TEXT NOT NULL DEFAULT '',
  "leave_type_id" TEXT,
  "leave_allocation_id" TEXT,
  "work_from_date" DATE,
  "work_end_date" DATE,
  "half_day" BOOLEAN NOT NULL DEFAULT false,
  "half_day_date" DATE,
  "reason" TEXT NOT NULL DEFAULT '',
  "status" TEXT NOT NULL DEFAULT 'Draft',
  "doc_status" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "hr_compensatory_leave_requests_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "hr_compensatory_leave_requests_company_id_employee_id_idx" ON "hr_compensatory_leave_requests"("company_id", "employee_id");

CREATE TABLE IF NOT EXISTS "hr_leave_adjustments" (
  "id" TEXT NOT NULL,
  "company_id" TEXT NOT NULL,
  "naming_series" TEXT NOT NULL DEFAULT 'HR-LAD-.YYYY.-',
  "employee_id" TEXT NOT NULL,
  "employee_name" TEXT NOT NULL DEFAULT '',
  "leave_type_id" TEXT,
  "leave_allocation_id" TEXT,
  "leaves_to_adjust" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "posting_date" DATE,
  "reason_for_adjustment" TEXT NOT NULL DEFAULT '',
  "status" TEXT NOT NULL DEFAULT 'Draft',
  "doc_status" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "hr_leave_adjustments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "hr_leave_adjustments_company_id_employee_id_idx" ON "hr_leave_adjustments"("company_id", "employee_id");

CREATE TABLE IF NOT EXISTS "hr_daily_work_summary_groups" (
  "id" TEXT NOT NULL,
  "company_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "users" JSONB NOT NULL DEFAULT '[]',
  "send_emails_at" TEXT NOT NULL DEFAULT '17:00',
  "holiday_list_id" TEXT,
  "subject" TEXT NOT NULL DEFAULT 'What did you work on today?',
  "message" TEXT NOT NULL DEFAULT '',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "hr_daily_work_summary_groups_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "hr_daily_work_summary_groups_company_id_name_key" ON "hr_daily_work_summary_groups"("company_id", "name");

CREATE INDEX IF NOT EXISTS "hr_daily_work_summary_groups_company_id_idx" ON "hr_daily_work_summary_groups"("company_id");

CREATE TABLE IF NOT EXISTS "hr_daily_work_summaries" (
  "id" TEXT NOT NULL,
  "company_id" TEXT NOT NULL,
  "daily_work_summary_group_id" TEXT,
  "status" TEXT NOT NULL DEFAULT 'Open',
  "email_sent_to" TEXT NOT NULL DEFAULT '',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "hr_daily_work_summaries_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "hr_daily_work_summaries_company_id_idx" ON "hr_daily_work_summaries"("company_id");
