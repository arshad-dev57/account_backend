-- HRMS document layer (ERPNext-aligned): new hr_* tables and additive columns.
-- Generated from prisma migrate diff, filtered to HR-only statements.

-- AlterTable
ALTER TABLE "hr_attendance_corrections" ADD COLUMN     "action" TEXT NOT NULL DEFAULT 'Make Attendance',
ADD COLUMN     "approver_id" TEXT,
ADD COLUMN     "approver_name" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "doc_status" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "explain_half_day_status" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "from_date" DATE,
ADD COLUMN     "include_holidays" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "justify_attendance_for_leave_days" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "to_date" DATE
;
-- AlterTable
ALTER TABLE "hr_attendances" ADD COLUMN     "attendance_request_id" TEXT,
ADD COLUMN     "doc_status" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "early_exit" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "late_entry" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "leave_application_id" TEXT,
ADD COLUMN     "overtime_hours" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "overtime_type_id" TEXT,
ADD COLUMN     "remarks" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "shift_id" TEXT
;
-- AlterTable
ALTER TABLE "hr_employees" ADD COLUMN     "ctc" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "default_shift_id" TEXT,
ADD COLUMN     "department_id" TEXT,
ADD COLUMN     "designation_id" TEXT,
ADD COLUMN     "employee_grade_id" TEXT,
ADD COLUMN     "employee_group_id" TEXT,
ADD COLUMN     "employment_type_id" TEXT,
ADD COLUMN     "salary_currency" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "salary_mode" TEXT NOT NULL DEFAULT ''
;
-- AlterTable
ALTER TABLE "hr_feedbacks" ADD COLUMN     "appraisal_id" TEXT,
ADD COLUMN     "doc_status" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "ratings" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "reviewer_employee_id" TEXT
;
-- AlterTable
ALTER TABLE "hr_goals" ADD COLUMN     "appraisal_cycle_id" TEXT,
ADD COLUMN     "description" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "end_date" DATE,
ADD COLUMN     "kra_id" TEXT,
ADD COLUMN     "parent_goal_id" TEXT,
ADD COLUMN     "start_date" DATE
;
-- AlterTable
ALTER TABLE "hr_leave_balances" ADD COLUMN     "carry_forward_leaves" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "doc_status" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "from_date" DATE,
ADD COLUMN     "leave_period_id" TEXT,
ADD COLUMN     "new_leaves" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "policy_assignment_id" TEXT,
ADD COLUMN     "reason" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'Open',
ADD COLUMN     "to_date" DATE,
ADD COLUMN     "total_leaves_allocated" DOUBLE PRECISION NOT NULL DEFAULT 0
;
-- AlterTable
ALTER TABLE "hr_leave_types" ADD COLUMN     "allow_negative" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "earned_leave" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "leave_day_applicable_for_holiday" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "max_allowance_for_lop" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "max_carry_forward" INTEGER NOT NULL DEFAULT 0
;
-- AlterTable
ALTER TABLE "hr_leaves" ADD COLUMN     "applied_on" DATE,
ADD COLUMN     "approver_id" TEXT,
ADD COLUMN     "approver_name" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "doc_status" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "explanation" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "forwarding_note" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "is_lop" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "leave_balance_id" TEXT,
ADD COLUMN     "leave_period_id" TEXT,
ALTER COLUMN "status" SET DEFAULT 'Open'
;
-- AlterTable
ALTER TABLE "hr_overtimes" ADD COLUMN     "doc_status" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "overtime_type_id" TEXT,
ADD COLUMN     "pay_rate_multiplier" DOUBLE PRECISION NOT NULL DEFAULT 1,
ADD COLUMN     "salary_slip_id" TEXT
;
-- AlterTable
ALTER TABLE "hr_payroll_items" ADD COLUMN     "doc_status" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "income_tax_slab_id" TEXT,
ADD COLUMN     "leave_without_pay" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "payment_days" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "payroll_run_id" TEXT,
ADD COLUMN     "salary_slip_currency" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "salary_structure_assignment_id" TEXT,
ADD COLUMN     "salary_structure_id" TEXT,
ADD COLUMN     "total_earning" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "working_days" DOUBLE PRECISION NOT NULL DEFAULT 0
;
-- AlterTable
ALTER TABLE "hr_payroll_runs" ADD COLUMN     "currency" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "doc_status" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "filters" JSONB,
ADD COLUMN     "payable_account" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "payment_account" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "posting_date" DATE
;
-- AlterTable
ALTER TABLE "hr_performance_reviews" ADD COLUMN     "appraisal_cycle_id" TEXT,
ADD COLUMN     "appraisal_template_id" TEXT,
ADD COLUMN     "average_rating" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "doc_status" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "kra_assessments" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "max_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "remarks" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "self_ratings" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "total_score" DOUBLE PRECISION NOT NULL DEFAULT 0
;
-- AlterTable
ALTER TABLE "hr_shifts" ADD COLUMN     "calculate_overtime" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "early_exit_grace_minutes" INTEGER NOT NULL DEFAULT 15,
ADD COLUMN     "enable_auto_attendance" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "enable_early_exit_marking" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "enable_late_entry_marking" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "first_checkin_threshold_minutes" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "last_checkout_threshold_minutes" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "overtime_type_id" TEXT,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'Active',
ADD COLUMN     "working_hours" DOUBLE PRECISION NOT NULL DEFAULT 0
;
-- CreateTable
CREATE TABLE "hr_salary_components" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'Earning',
    "component_category" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "depends_on_payment_days" BOOLEAN NOT NULL DEFAULT true,
    "is_taxable_component" BOOLEAN NOT NULL DEFAULT false,
    "is_financial_component" BOOLEAN NOT NULL DEFAULT true,
    "statistical_component" BOOLEAN NOT NULL DEFAULT false,
    "round_to_nearest_integral" BOOLEAN NOT NULL DEFAULT true,
    "expense_account" TEXT NOT NULL DEFAULT '',
    "payable_account" TEXT NOT NULL DEFAULT '',
    "disabled" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hr_salary_components_pkey" PRIMARY KEY ("id")
)
;
-- CreateTable
CREATE TABLE "hr_salary_structures" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT '',
    "payroll_frequency_type" TEXT NOT NULL DEFAULT 'Monthly',
    "mode_of_payment" TEXT NOT NULL DEFAULT '',
    "payment_account" TEXT NOT NULL DEFAULT '',
    "leave_encashment_component_id" TEXT,
    "max_benefits" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "earnings" JSONB NOT NULL DEFAULT '[]',
    "deductions" JSONB NOT NULL DEFAULT '[]',
    "employer_contributions" JSONB NOT NULL DEFAULT '[]',
    "notes" TEXT NOT NULL DEFAULT '',
    "doc_status" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "disabled" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hr_salary_structures_pkey" PRIMARY KEY ("id")
)
;
-- CreateTable
CREATE TABLE "hr_salary_structure_assignments" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "salary_structure_id" TEXT,
    "income_tax_slab_id" TEXT,
    "base" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "variable" JSONB NOT NULL DEFAULT '{}',
    "currency" TEXT NOT NULL DEFAULT '',
    "payable_account" TEXT NOT NULL DEFAULT '',
    "cost_center" TEXT NOT NULL DEFAULT '',
    "from_date" DATE NOT NULL,
    "doc_status" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "notes" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hr_salary_structure_assignments_pkey" PRIMARY KEY ("id")
)
;
-- CreateTable
CREATE TABLE "hr_income_tax_slabs" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "effective_date" DATE NOT NULL,
    "currency" TEXT NOT NULL DEFAULT '',
    "standard_tax_exemption_amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "slabs" JSONB NOT NULL DEFAULT '[]',
    "other_charges" JSONB NOT NULL DEFAULT '[]',
    "consider_gross_pay_as_taxable" BOOLEAN NOT NULL DEFAULT true,
    "disabled" BOOLEAN NOT NULL DEFAULT false,
    "doc_status" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hr_income_tax_slabs_pkey" PRIMARY KEY ("id")
)
;
-- CreateTable
CREATE TABLE "hr_leave_periods" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hr_leave_periods_pkey" PRIMARY KEY ("id")
)
;
-- CreateTable
CREATE TABLE "hr_leave_policies" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "details" JSONB NOT NULL DEFAULT '[]',
    "doc_status" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hr_leave_policies_pkey" PRIMARY KEY ("id")
)
;
-- CreateTable
CREATE TABLE "hr_leave_policy_assignments" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "leave_policy_id" TEXT,
    "leave_period_id" TEXT,
    "holiday_list_id" TEXT,
    "allocate_on_days_before_start" INTEGER NOT NULL DEFAULT 0,
    "from_date" DATE,
    "to_date" DATE,
    "new_leaves" INTEGER NOT NULL DEFAULT 0,
    "carry_forward_leaves" INTEGER NOT NULL DEFAULT 0,
    "doc_status" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "notes" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hr_leave_policy_assignments_pkey" PRIMARY KEY ("id")
)
;
-- CreateTable
CREATE TABLE "hr_leave_encashments" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "leave_type_id" TEXT,
    "leave_period_id" TEXT,
    "leave_balance_id" TEXT,
    "allocatable_leave" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "encashment_days" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "daily_rate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "payable_amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "effective_date" DATE NOT NULL,
    "salary_component_id" TEXT,
    "expense_account" TEXT NOT NULL DEFAULT '',
    "payable_account" TEXT NOT NULL DEFAULT '',
    "reason" TEXT NOT NULL DEFAULT '',
    "payroll_item_id" TEXT,
    "doc_status" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hr_leave_encashments_pkey" PRIMARY KEY ("id")
)
;
-- CreateTable
CREATE TABLE "hr_leave_block_lists" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "from_date" DATE NOT NULL,
    "to_date" DATE NOT NULL,
    "block_description" TEXT NOT NULL DEFAULT '',
    "dates" JSONB NOT NULL DEFAULT '[]',
    "allowed_employee_ids" JSONB NOT NULL DEFAULT '[]',
    "apply_on_leave_types" JSONB NOT NULL DEFAULT '[]',
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hr_leave_block_lists_pkey" PRIMARY KEY ("id")
)
;
-- CreateTable
CREATE TABLE "hr_employee_checkins" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "log_time" TIMESTAMP(3) NOT NULL,
    "log_type" TEXT NOT NULL DEFAULT 'IN',
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "accuracy" DOUBLE PRECISION,
    "device_info" TEXT NOT NULL DEFAULT '',
    "source" TEXT NOT NULL DEFAULT 'mobile',
    "shift_id" TEXT,
    "attendance_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hr_employee_checkins_pkey" PRIMARY KEY ("id")
)
;
-- CreateTable
CREATE TABLE "hr_shift_requests" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "shift_id" TEXT,
    "from_date" DATE NOT NULL,
    "to_date" DATE NOT NULL,
    "reason" TEXT NOT NULL DEFAULT '',
    "approver_id" TEXT,
    "approver_name" TEXT NOT NULL DEFAULT '',
    "department" TEXT NOT NULL DEFAULT '',
    "assigned_by" TEXT,
    "assigned_at" TIMESTAMP(3),
    "doc_status" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hr_shift_requests_pkey" PRIMARY KEY ("id")
)
;
-- CreateTable
CREATE TABLE "hr_overtime_types" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "max_hours_per_day" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "include_holidays" BOOLEAN NOT NULL DEFAULT false,
    "include_week_off_days" BOOLEAN NOT NULL DEFAULT false,
    "salary_component_id" TEXT,
    "pay_rate_multipliers" JSONB NOT NULL DEFAULT '{}',
    "disabled" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hr_overtime_types_pkey" PRIMARY KEY ("id")
)
;
-- CreateTable
CREATE TABLE "hr_employee_grades" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "default_salary_component_id" TEXT,
    "default_role" TEXT NOT NULL DEFAULT '',
    "disabled" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hr_employee_grades_pkey" PRIMARY KEY ("id")
)
;
-- CreateTable
CREATE TABLE "hr_employee_groups" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "disabled" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hr_employee_groups_pkey" PRIMARY KEY ("id")
)
;
-- CreateTable
CREATE TABLE "hr_employment_types" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "enabled_for_leave_policy" BOOLEAN NOT NULL DEFAULT true,
    "include_holidays_in_total_days" BOOLEAN NOT NULL DEFAULT false,
    "leave_days_per_year" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "disabled" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hr_employment_types_pkey" PRIMARY KEY ("id")
)
;
-- CreateTable
CREATE TABLE "hr_job_openings" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "department" TEXT NOT NULL DEFAULT '',
    "department_id" TEXT,
    "designation" TEXT NOT NULL DEFAULT '',
    "designation_id" TEXT,
    "location" TEXT NOT NULL DEFAULT '',
    "employment_type" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'Open',
    "openings" INTEGER NOT NULL DEFAULT 1,
    "applied" INTEGER NOT NULL DEFAULT 0,
    "start_date" DATE,
    "end_date" DATE,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "description" TEXT NOT NULL DEFAULT '',
    "instructions" TEXT NOT NULL DEFAULT '',
    "hiring_manager" TEXT NOT NULL DEFAULT '',
    "job_requisition_id" TEXT,
    "lower_grade" TEXT NOT NULL DEFAULT '',
    "upper_grade" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hr_job_openings_pkey" PRIMARY KEY ("id")
)
;
-- CreateTable
CREATE TABLE "hr_job_applicants" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "applicant_name" TEXT NOT NULL,
    "email_id" TEXT NOT NULL DEFAULT '',
    "phone_no" TEXT NOT NULL DEFAULT '',
    "job_opening_id" TEXT,
    "job_title" TEXT NOT NULL DEFAULT '',
    "designation" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'Open',
    "source" TEXT NOT NULL DEFAULT '',
    "country" TEXT NOT NULL DEFAULT '',
    "city" TEXT NOT NULL DEFAULT '',
    "resume_url" TEXT NOT NULL DEFAULT '',
    "note" TEXT NOT NULL DEFAULT '',
    "rating" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "employee_referral_id" TEXT,
    "referred_by" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hr_job_applicants_pkey" PRIMARY KEY ("id")
)
;
-- CreateTable
CREATE TABLE "hr_interviews" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "job_applicant_id" TEXT NOT NULL,
    "job_opening_id" TEXT,
    "designation" TEXT NOT NULL DEFAULT '',
    "scheduled_on" DATE NOT NULL,
    "from_time" TIMESTAMP(3),
    "to_time" TIMESTAMP(3),
    "interview_type" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'Pending',
    "result" TEXT NOT NULL DEFAULT '',
    "average_rating" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "interviewers" JSONB NOT NULL DEFAULT '[]',
    "feedback" JSONB NOT NULL DEFAULT '[]',
    "summary" TEXT NOT NULL DEFAULT '',
    "created_round" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hr_interviews_pkey" PRIMARY KEY ("id")
)
;
-- CreateTable
CREATE TABLE "hr_job_offers" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "job_applicant_id" TEXT NOT NULL,
    "offer_date" DATE,
    "expected_joining_date" DATE,
    "designation" TEXT NOT NULL DEFAULT '',
    "department" TEXT NOT NULL DEFAULT '',
    "grade" TEXT NOT NULL DEFAULT '',
    "employment_type" TEXT NOT NULL DEFAULT '',
    "branch" TEXT NOT NULL DEFAULT '',
    "reports_to" TEXT NOT NULL DEFAULT '',
    "salary_structure_id" TEXT,
    "ctc" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "components" JSONB NOT NULL DEFAULT '[]',
    "terms" JSONB NOT NULL DEFAULT '[]',
    "offer_terms" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "employee_id" TEXT,
    "onboarding_id" TEXT,
    "doc_status" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hr_job_offers_pkey" PRIMARY KEY ("id")
)
;
-- CreateTable
CREATE TABLE "hr_job_requisitions" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "department" TEXT NOT NULL DEFAULT '',
    "designation" TEXT NOT NULL DEFAULT '',
    "employment_type" TEXT NOT NULL DEFAULT '',
    "no_of_positions" INTEGER NOT NULL DEFAULT 1,
    "expected_by" DATE,
    "closing_on" DATE,
    "status" TEXT NOT NULL DEFAULT 'Pending',
    "requested_by" TEXT NOT NULL DEFAULT '',
    "requested_by_id" TEXT,
    "description" TEXT NOT NULL DEFAULT '',
    "job_description" TEXT NOT NULL DEFAULT '',
    "reason" TEXT NOT NULL DEFAULT '',
    "staffing_plan" TEXT NOT NULL DEFAULT '',
    "approved_by" TEXT NOT NULL DEFAULT '',
    "approved_on" DATE,
    "job_opening_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hr_job_requisitions_pkey" PRIMARY KEY ("id")
)
;
-- CreateTable
CREATE TABLE "hr_employee_onboardings" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL DEFAULT '',
    "email" TEXT NOT NULL DEFAULT '',
    "designation" TEXT NOT NULL DEFAULT '',
    "department" TEXT NOT NULL DEFAULT '',
    "grade" TEXT NOT NULL DEFAULT '',
    "employment_type" TEXT NOT NULL DEFAULT '',
    "date_of_joining" DATE,
    "offer_date" DATE,
    "job_offer_id" TEXT,
    "employee_id" TEXT,
    "activities" JSONB NOT NULL DEFAULT '[]',
    "boarding_status" TEXT NOT NULL DEFAULT 'Pending',
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "doc_status" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hr_employee_onboardings_pkey" PRIMARY KEY ("id")
)
;
-- CreateTable
CREATE TABLE "hr_employee_separations" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "separation_date" DATE,
    "department" TEXT NOT NULL DEFAULT '',
    "designation" TEXT NOT NULL DEFAULT '',
    "reason" TEXT NOT NULL DEFAULT '',
    "activities" JSONB NOT NULL DEFAULT '[]',
    "boarding_status" TEXT NOT NULL DEFAULT 'Pending',
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "doc_status" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hr_employee_separations_pkey" PRIMARY KEY ("id")
)
;
-- CreateTable
CREATE TABLE "hr_grievance_types" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "document_type" TEXT NOT NULL DEFAULT '',
    "disabled" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hr_grievance_types_pkey" PRIMARY KEY ("id")
)
;
-- CreateTable
CREATE TABLE "hr_employee_grievances" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "grievance_type" TEXT NOT NULL DEFAULT '',
    "raised_by_employee_id" TEXT,
    "employee_against_id" TEXT,
    "reported_to" TEXT NOT NULL DEFAULT '',
    "filling_date" DATE NOT NULL,
    "date" DATE,
    "description" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'Open',
    "resolved_by" TEXT NOT NULL DEFAULT '',
    "resolution_date" DATE,
    "resolution_details" TEXT NOT NULL DEFAULT '',
    "doc_status" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hr_employee_grievances_pkey" PRIMARY KEY ("id")
)
;
-- CreateTable
CREATE TABLE "hr_kras" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'Goal',
    "unit" TEXT NOT NULL DEFAULT '',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hr_kras_pkey" PRIMARY KEY ("id")
)
;
-- CreateTable
CREATE TABLE "hr_appraisal_templates" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "appraisal_criteria" TEXT NOT NULL DEFAULT 'KRA-based',
    "goals" JSONB NOT NULL DEFAULT '[]',
    "kras" JSONB NOT NULL DEFAULT '[]',
    "disabled" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hr_appraisal_templates_pkey" PRIMARY KEY ("id")
)
;
-- CreateTable
CREATE TABLE "hr_appraisal_cycles" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "appraisal_template_id" TEXT,
    "rating_method" TEXT NOT NULL DEFAULT 'Out of 5',
    "department" TEXT NOT NULL DEFAULT '',
    "designation" TEXT NOT NULL DEFAULT '',
    "branch" TEXT NOT NULL DEFAULT '',
    "kra_based_on" TEXT NOT NULL DEFAULT 'Appraisal Template',
    "create_appraisals_for_all" BOOLEAN NOT NULL DEFAULT false,
    "include_held_employees" BOOLEAN NOT NULL DEFAULT false,
    "per_day_goals_allocation" BOOLEAN NOT NULL DEFAULT true,
    "feedback_reminder_days" INTEGER NOT NULL DEFAULT 0,
    "employee_appraisal_date" JSONB NOT NULL DEFAULT '[]',
    "appraisees" JSONB NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'Not Started',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hr_appraisal_cycles_pkey" PRIMARY KEY ("id")
)
;
-- CreateTable
CREATE TABLE "hr_employee_transfers" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "transfer_date" DATE NOT NULL,
    "from_department" TEXT NOT NULL DEFAULT '',
    "to_department" TEXT NOT NULL DEFAULT '',
    "from_designation" TEXT NOT NULL DEFAULT '',
    "to_designation" TEXT NOT NULL DEFAULT '',
    "from_branch" TEXT NOT NULL DEFAULT '',
    "to_branch" TEXT NOT NULL DEFAULT '',
    "reason" TEXT NOT NULL DEFAULT '',
    "remark" TEXT NOT NULL DEFAULT '',
    "new_employee_id" TEXT NOT NULL DEFAULT '',
    "property_history" JSONB NOT NULL DEFAULT '[]',
    "doc_status" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hr_employee_transfers_pkey" PRIMARY KEY ("id")
)
;
-- CreateTable
CREATE TABLE "hr_employee_promotions" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "promotion_date" DATE NOT NULL,
    "promotion_for" TEXT NOT NULL DEFAULT '',
    "promotion_by" TEXT NOT NULL DEFAULT '',
    "from_department" TEXT NOT NULL DEFAULT '',
    "to_department" TEXT NOT NULL DEFAULT '',
    "from_designation" TEXT NOT NULL DEFAULT '',
    "to_designation" TEXT NOT NULL DEFAULT '',
    "from_grade" TEXT NOT NULL DEFAULT '',
    "to_grade" TEXT NOT NULL DEFAULT '',
    "ctc" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "salary_structure_id" TEXT,
    "voucher_number" TEXT NOT NULL DEFAULT '',
    "reason" TEXT NOT NULL DEFAULT '',
    "property_history" JSONB NOT NULL DEFAULT '[]',
    "doc_status" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hr_employee_promotions_pkey" PRIMARY KEY ("id")
)
;
-- CreateTable
CREATE TABLE "hr_employee_skill_maps" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "skills" JSONB NOT NULL DEFAULT '[]',
    "trainings" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hr_employee_skill_maps_pkey" PRIMARY KEY ("id")
)
;
-- CreateTable
CREATE TABLE "hr_training_programs" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "trainer_name" TEXT NOT NULL DEFAULT '',
    "trainer_email" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "disabled" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hr_training_programs_pkey" PRIMARY KEY ("id")
)
;
-- CreateTable
CREATE TABLE "hr_training_events" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "event_name" TEXT NOT NULL,
    "training_program_id" TEXT,
    "start_time" TIMESTAMP(3),
    "end_time" TIMESTAMP(3),
    "location" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'Scheduled',
    "course_fee" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "trainer_name" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "employees" JSONB NOT NULL DEFAULT '[]',
    "doc_status" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hr_training_events_pkey" PRIMARY KEY ("id")
)
;
-- CreateTable
CREATE TABLE "hr_employee_benefits" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "salary_component_id" TEXT,
    "max_amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "max_amount_based_on" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "type" TEXT NOT NULL DEFAULT 'cash',
    "disabled" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hr_employee_benefits_pkey" PRIMARY KEY ("id")
)
;
-- CreateTable
CREATE TABLE "hr_employee_benefit_applications" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "payroll_period_id" TEXT,
    "max_benefits" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "total_amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "benefits" JSONB NOT NULL DEFAULT '[]',
    "currency" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "doc_status" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hr_employee_benefit_applications_pkey" PRIMARY KEY ("id")
)
;
-- CreateTable
CREATE TABLE "hr_employee_benefit_claims" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "benefit_application_id" TEXT,
    "component" TEXT NOT NULL DEFAULT '',
    "salary_component_id" TEXT,
    "amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "claimed_on" DATE NOT NULL,
    "is_paid" BOOLEAN NOT NULL DEFAULT false,
    "payroll_item_id" TEXT,
    "expense_proof" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "doc_status" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hr_employee_benefit_claims_pkey" PRIMARY KEY ("id")
)
;
-- CreateTable
CREATE TABLE "hr_tax_exemption_declarations" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "payroll_period_id" TEXT,
    "declarations" JSONB NOT NULL DEFAULT '[]',
    "total_exemption" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT '',
    "notes" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "doc_status" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hr_tax_exemption_declarations_pkey" PRIMARY KEY ("id")
)
;
-- CreateTable
CREATE TABLE "hr_tax_exemption_proof_submissions" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "declaration_id" TEXT,
    "payroll_period_id" TEXT,
    "submissions" JSONB NOT NULL DEFAULT '[]',
    "total_submitted" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "doc_status" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hr_tax_exemption_proof_submissions_pkey" PRIMARY KEY ("id")
)
;
-- CreateTable
CREATE TABLE "hr_tax_exemption_categories" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "max_exemption_amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "max_exemption_amount_based_on" TEXT NOT NULL DEFAULT 'Amount',
    "declaration_section" TEXT NOT NULL DEFAULT 'Employee Tax Exemption Declaration',
    "disabled" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hr_tax_exemption_categories_pkey" PRIMARY KEY ("id")
)
;
-- CreateTable
CREATE TABLE "hr_expense_claims" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "expense_approver_id" TEXT,
    "claim_date" DATE NOT NULL,
    "expenses" JSONB NOT NULL DEFAULT '[]',
    "advances" JSONB NOT NULL DEFAULT '[]',
    "total_claimed" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "approved_amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "paid_amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "sanctioned_amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "total_advance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "reimbursement" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT '',
    "payable_account" TEXT NOT NULL DEFAULT '',
    "expense_account" TEXT NOT NULL DEFAULT '',
    "cost_center" TEXT NOT NULL DEFAULT '',
    "project" TEXT NOT NULL DEFAULT '',
    "reason_for_rejection" TEXT NOT NULL DEFAULT '',
    "journal_entry_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "doc_status" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hr_expense_claims_pkey" PRIMARY KEY ("id")
)
;
-- CreateTable
CREATE TABLE "hr_expense_claim_types" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "expense_account" TEXT NOT NULL DEFAULT '',
    "requires_proof" BOOLEAN NOT NULL DEFAULT true,
    "is_advance" BOOLEAN NOT NULL DEFAULT false,
    "disabled" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hr_expense_claim_types_pkey" PRIMARY KEY ("id")
)
;
-- CreateTable
CREATE TABLE "hr_payroll_settings" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "deduction_max_leave_days" INTEGER NOT NULL DEFAULT 0,
    "consider_unmarked_attendance" BOOLEAN NOT NULL DEFAULT true,
    "include_holidays_in_leave_balance" BOOLEAN NOT NULL DEFAULT false,
    "email_salary_slip" BOOLEAN NOT NULL DEFAULT true,
    "role_to_payroll_manager" TEXT NOT NULL DEFAULT '',
    "process_payroll_account" TEXT NOT NULL DEFAULT '',
    "send_summary_email" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hr_payroll_settings_pkey" PRIMARY KEY ("id")
)
;
-- CreateIndex
CREATE INDEX "hr_salary_components_company_id_idx" ON "hr_salary_components"("company_id")
;
-- CreateIndex
CREATE UNIQUE INDEX "hr_salary_components_company_id_name_key" ON "hr_salary_components"("company_id", "name")
;
-- CreateIndex
CREATE INDEX "hr_salary_structures_company_id_idx" ON "hr_salary_structures"("company_id")
;
-- CreateIndex
CREATE UNIQUE INDEX "hr_salary_structures_company_id_name_key" ON "hr_salary_structures"("company_id", "name")
;
-- CreateIndex
CREATE INDEX "hr_salary_structure_assignments_company_id_employee_id_idx" ON "hr_salary_structure_assignments"("company_id", "employee_id")
;
-- CreateIndex
CREATE INDEX "hr_salary_structure_assignments_company_id_salary_structure_idx" ON "hr_salary_structure_assignments"("company_id", "salary_structure_id")
;
-- CreateIndex
CREATE INDEX "hr_income_tax_slabs_company_id_idx" ON "hr_income_tax_slabs"("company_id")
;
-- CreateIndex
CREATE UNIQUE INDEX "hr_income_tax_slabs_company_id_name_key" ON "hr_income_tax_slabs"("company_id", "name")
;
-- CreateIndex
CREATE INDEX "hr_leave_periods_company_id_idx" ON "hr_leave_periods"("company_id")
;
-- CreateIndex
CREATE UNIQUE INDEX "hr_leave_periods_company_id_name_key" ON "hr_leave_periods"("company_id", "name")
;
-- CreateIndex
CREATE INDEX "hr_leave_policies_company_id_idx" ON "hr_leave_policies"("company_id")
;
-- CreateIndex
CREATE UNIQUE INDEX "hr_leave_policies_company_id_name_key" ON "hr_leave_policies"("company_id", "name")
;
-- CreateIndex
CREATE INDEX "hr_leave_policy_assignments_company_id_employee_id_idx" ON "hr_leave_policy_assignments"("company_id", "employee_id")
;
-- CreateIndex
CREATE INDEX "hr_leave_encashments_company_id_employee_id_idx" ON "hr_leave_encashments"("company_id", "employee_id")
;
-- CreateIndex
CREATE INDEX "hr_leave_block_lists_company_id_idx" ON "hr_leave_block_lists"("company_id")
;
-- CreateIndex
CREATE UNIQUE INDEX "hr_leave_block_lists_company_id_name_key" ON "hr_leave_block_lists"("company_id", "name")
;
-- CreateIndex
CREATE INDEX "hr_employee_checkins_company_id_employee_id_log_time_idx" ON "hr_employee_checkins"("company_id", "employee_id", "log_time")
;
-- CreateIndex
CREATE INDEX "hr_employee_checkins_company_id_log_time_idx" ON "hr_employee_checkins"("company_id", "log_time")
;
-- CreateIndex
CREATE INDEX "hr_shift_requests_company_id_status_idx" ON "hr_shift_requests"("company_id", "status")
;
-- CreateIndex
CREATE INDEX "hr_shift_requests_company_id_employee_id_idx" ON "hr_shift_requests"("company_id", "employee_id")
;
-- CreateIndex
CREATE INDEX "hr_overtime_types_company_id_idx" ON "hr_overtime_types"("company_id")
;
-- CreateIndex
CREATE UNIQUE INDEX "hr_overtime_types_company_id_name_key" ON "hr_overtime_types"("company_id", "name")
;
-- CreateIndex
CREATE INDEX "hr_employee_grades_company_id_idx" ON "hr_employee_grades"("company_id")
;
-- CreateIndex
CREATE UNIQUE INDEX "hr_employee_grades_company_id_name_key" ON "hr_employee_grades"("company_id", "name")
;
-- CreateIndex
CREATE INDEX "hr_employee_groups_company_id_idx" ON "hr_employee_groups"("company_id")
;
-- CreateIndex
CREATE UNIQUE INDEX "hr_employee_groups_company_id_name_key" ON "hr_employee_groups"("company_id", "name")
;
-- CreateIndex
CREATE INDEX "hr_employment_types_company_id_idx" ON "hr_employment_types"("company_id")
;
-- CreateIndex
CREATE UNIQUE INDEX "hr_employment_types_company_id_name_key" ON "hr_employment_types"("company_id", "name")
;
-- CreateIndex
CREATE INDEX "hr_job_openings_company_id_status_idx" ON "hr_job_openings"("company_id", "status")
;
-- CreateIndex
CREATE INDEX "hr_job_applicants_company_id_status_idx" ON "hr_job_applicants"("company_id", "status")
;
-- CreateIndex
CREATE INDEX "hr_job_applicants_company_id_job_opening_id_idx" ON "hr_job_applicants"("company_id", "job_opening_id")
;
-- CreateIndex
CREATE INDEX "hr_interviews_company_id_status_idx" ON "hr_interviews"("company_id", "status")
;
-- CreateIndex
CREATE INDEX "hr_interviews_company_id_job_applicant_id_idx" ON "hr_interviews"("company_id", "job_applicant_id")
;
-- CreateIndex
CREATE INDEX "hr_job_offers_company_id_status_idx" ON "hr_job_offers"("company_id", "status")
;
-- CreateIndex
CREATE INDEX "hr_job_requisitions_company_id_status_idx" ON "hr_job_requisitions"("company_id", "status")
;
-- CreateIndex
CREATE INDEX "hr_employee_onboardings_company_id_status_idx" ON "hr_employee_onboardings"("company_id", "status")
;
-- CreateIndex
CREATE INDEX "hr_employee_separations_company_id_status_idx" ON "hr_employee_separations"("company_id", "status")
;
-- CreateIndex
CREATE INDEX "hr_grievance_types_company_id_idx" ON "hr_grievance_types"("company_id")
;
-- CreateIndex
CREATE UNIQUE INDEX "hr_grievance_types_company_id_name_key" ON "hr_grievance_types"("company_id", "name")
;
-- CreateIndex
CREATE INDEX "hr_employee_grievances_company_id_status_idx" ON "hr_employee_grievances"("company_id", "status")
;
-- CreateIndex
CREATE INDEX "hr_kras_company_id_idx" ON "hr_kras"("company_id")
;
-- CreateIndex
CREATE UNIQUE INDEX "hr_kras_company_id_name_key" ON "hr_kras"("company_id", "name")
;
-- CreateIndex
CREATE INDEX "hr_appraisal_templates_company_id_idx" ON "hr_appraisal_templates"("company_id")
;
-- CreateIndex
CREATE UNIQUE INDEX "hr_appraisal_templates_company_id_name_key" ON "hr_appraisal_templates"("company_id", "name")
;
-- CreateIndex
CREATE INDEX "hr_appraisal_cycles_company_id_status_idx" ON "hr_appraisal_cycles"("company_id", "status")
;
-- CreateIndex
CREATE UNIQUE INDEX "hr_appraisal_cycles_company_id_name_key" ON "hr_appraisal_cycles"("company_id", "name")
;
-- CreateIndex
CREATE INDEX "hr_employee_transfers_company_id_employee_id_idx" ON "hr_employee_transfers"("company_id", "employee_id")
;
-- CreateIndex
CREATE INDEX "hr_employee_promotions_company_id_employee_id_idx" ON "hr_employee_promotions"("company_id", "employee_id")
;
-- CreateIndex
CREATE UNIQUE INDEX "hr_employee_skill_maps_employee_id_key" ON "hr_employee_skill_maps"("employee_id")
;
-- CreateIndex
CREATE INDEX "hr_employee_skill_maps_company_id_idx" ON "hr_employee_skill_maps"("company_id")
;
-- CreateIndex
CREATE INDEX "hr_training_programs_company_id_idx" ON "hr_training_programs"("company_id")
;
-- CreateIndex
CREATE UNIQUE INDEX "hr_training_programs_company_id_name_key" ON "hr_training_programs"("company_id", "name")
;
-- CreateIndex
CREATE INDEX "hr_training_events_company_id_status_idx" ON "hr_training_events"("company_id", "status")
;
-- CreateIndex
CREATE UNIQUE INDEX "hr_training_events_company_id_event_name_key" ON "hr_training_events"("company_id", "event_name")
;
-- CreateIndex
CREATE INDEX "hr_employee_benefits_company_id_idx" ON "hr_employee_benefits"("company_id")
;
-- CreateIndex
CREATE UNIQUE INDEX "hr_employee_benefits_company_id_name_key" ON "hr_employee_benefits"("company_id", "name")
;
-- CreateIndex
CREATE INDEX "hr_employee_benefit_applications_company_id_employee_id_idx" ON "hr_employee_benefit_applications"("company_id", "employee_id")
;
-- CreateIndex
CREATE INDEX "hr_employee_benefit_claims_company_id_employee_id_idx" ON "hr_employee_benefit_claims"("company_id", "employee_id")
;
-- CreateIndex
CREATE INDEX "hr_tax_exemption_declarations_company_id_employee_id_idx" ON "hr_tax_exemption_declarations"("company_id", "employee_id")
;
-- CreateIndex
CREATE INDEX "hr_tax_exemption_proof_submissions_company_id_employee_id_idx" ON "hr_tax_exemption_proof_submissions"("company_id", "employee_id")
;
-- CreateIndex
CREATE INDEX "hr_tax_exemption_categories_company_id_idx" ON "hr_tax_exemption_categories"("company_id")
;
-- CreateIndex
CREATE UNIQUE INDEX "hr_tax_exemption_categories_company_id_name_key" ON "hr_tax_exemption_categories"("company_id", "name")
;
-- CreateIndex
CREATE INDEX "hr_expense_claims_company_id_status_idx" ON "hr_expense_claims"("company_id", "status")
;
-- CreateIndex
CREATE INDEX "hr_expense_claims_company_id_employee_id_idx" ON "hr_expense_claims"("company_id", "employee_id")
;
-- CreateIndex
CREATE INDEX "hr_expense_claim_types_company_id_idx" ON "hr_expense_claim_types"("company_id")
;
-- CreateIndex
CREATE UNIQUE INDEX "hr_expense_claim_types_company_id_name_key" ON "hr_expense_claim_types"("company_id", "name")
;
-- CreateIndex
CREATE UNIQUE INDEX "hr_payroll_settings_company_id_key" ON "hr_payroll_settings"("company_id")
;
-- AddForeignKey
ALTER TABLE "hr_employees" ADD CONSTRAINT "hr_employees_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "hr_departments"("id") ON DELETE SET NULL ON UPDATE CASCADE
;
-- AddForeignKey
ALTER TABLE "hr_employees" ADD CONSTRAINT "hr_employees_designation_id_fkey" FOREIGN KEY ("designation_id") REFERENCES "hr_designations"("id") ON DELETE SET NULL ON UPDATE CASCADE
;
-- AddForeignKey
ALTER TABLE "hr_employees" ADD CONSTRAINT "hr_employees_employee_grade_id_fkey" FOREIGN KEY ("employee_grade_id") REFERENCES "hr_employee_grades"("id") ON DELETE SET NULL ON UPDATE CASCADE
;
-- AddForeignKey
ALTER TABLE "hr_employees" ADD CONSTRAINT "hr_employees_employee_group_id_fkey" FOREIGN KEY ("employee_group_id") REFERENCES "hr_employee_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE
;
-- AddForeignKey
ALTER TABLE "hr_employees" ADD CONSTRAINT "hr_employees_employment_type_id_fkey" FOREIGN KEY ("employment_type_id") REFERENCES "hr_employment_types"("id") ON DELETE SET NULL ON UPDATE CASCADE
;
-- AddForeignKey
ALTER TABLE "hr_employees" ADD CONSTRAINT "hr_employees_default_shift_id_fkey" FOREIGN KEY ("default_shift_id") REFERENCES "hr_shifts"("id") ON DELETE SET NULL ON UPDATE CASCADE
;
-- AddForeignKey
ALTER TABLE "hr_attendances" ADD CONSTRAINT "hr_attendances_shift_id_fkey" FOREIGN KEY ("shift_id") REFERENCES "hr_shifts"("id") ON DELETE SET NULL ON UPDATE CASCADE
;
-- AddForeignKey
ALTER TABLE "hr_attendances" ADD CONSTRAINT "hr_attendances_leave_application_id_fkey" FOREIGN KEY ("leave_application_id") REFERENCES "hr_leaves"("id") ON DELETE SET NULL ON UPDATE CASCADE
;
-- AddForeignKey
ALTER TABLE "hr_leaves" ADD CONSTRAINT "hr_leaves_leave_period_id_fkey" FOREIGN KEY ("leave_period_id") REFERENCES "hr_leave_periods"("id") ON DELETE SET NULL ON UPDATE CASCADE
;
-- AddForeignKey
ALTER TABLE "hr_leaves" ADD CONSTRAINT "hr_leaves_leave_balance_id_fkey" FOREIGN KEY ("leave_balance_id") REFERENCES "hr_leave_balances"("id") ON DELETE SET NULL ON UPDATE CASCADE
;
-- AddForeignKey
ALTER TABLE "hr_performance_reviews" ADD CONSTRAINT "hr_performance_reviews_appraisal_cycle_id_fkey" FOREIGN KEY ("appraisal_cycle_id") REFERENCES "hr_appraisal_cycles"("id") ON DELETE SET NULL ON UPDATE CASCADE
;
-- AddForeignKey
ALTER TABLE "hr_payroll_items" ADD CONSTRAINT "hr_payroll_items_payroll_run_id_fkey" FOREIGN KEY ("payroll_run_id") REFERENCES "hr_payroll_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE
;
-- AddForeignKey
ALTER TABLE "hr_payroll_items" ADD CONSTRAINT "hr_payroll_items_salary_structure_id_fkey" FOREIGN KEY ("salary_structure_id") REFERENCES "hr_salary_structures"("id") ON DELETE SET NULL ON UPDATE CASCADE
;
-- AddForeignKey
ALTER TABLE "hr_payroll_items" ADD CONSTRAINT "hr_payroll_items_salary_structure_assignment_id_fkey" FOREIGN KEY ("salary_structure_assignment_id") REFERENCES "hr_salary_structure_assignments"("id") ON DELETE SET NULL ON UPDATE CASCADE
;
-- AddForeignKey
ALTER TABLE "hr_leave_balances" ADD CONSTRAINT "hr_leave_balances_leave_period_id_fkey" FOREIGN KEY ("leave_period_id") REFERENCES "hr_leave_periods"("id") ON DELETE SET NULL ON UPDATE CASCADE
;
-- AddForeignKey
ALTER TABLE "hr_leave_balances" ADD CONSTRAINT "hr_leave_balances_policy_assignment_id_fkey" FOREIGN KEY ("policy_assignment_id") REFERENCES "hr_leave_policy_assignments"("id") ON DELETE SET NULL ON UPDATE CASCADE
;
-- AddForeignKey
ALTER TABLE "hr_feedbacks" ADD CONSTRAINT "hr_feedbacks_appraisal_id_fkey" FOREIGN KEY ("appraisal_id") REFERENCES "hr_performance_reviews"("id") ON DELETE SET NULL ON UPDATE CASCADE
;
-- AddForeignKey
ALTER TABLE "hr_salary_structure_assignments" ADD CONSTRAINT "hr_salary_structure_assignments_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "hr_employees"("id") ON DELETE CASCADE ON UPDATE CASCADE
;
-- AddForeignKey
ALTER TABLE "hr_salary_structure_assignments" ADD CONSTRAINT "hr_salary_structure_assignments_salary_structure_id_fkey" FOREIGN KEY ("salary_structure_id") REFERENCES "hr_salary_structures"("id") ON DELETE SET NULL ON UPDATE CASCADE
;
-- AddForeignKey
ALTER TABLE "hr_salary_structure_assignments" ADD CONSTRAINT "hr_salary_structure_assignments_income_tax_slab_id_fkey" FOREIGN KEY ("income_tax_slab_id") REFERENCES "hr_income_tax_slabs"("id") ON DELETE SET NULL ON UPDATE CASCADE
;
-- AddForeignKey
ALTER TABLE "hr_leave_policy_assignments" ADD CONSTRAINT "hr_leave_policy_assignments_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "hr_employees"("id") ON DELETE CASCADE ON UPDATE CASCADE
;
-- AddForeignKey
ALTER TABLE "hr_leave_policy_assignments" ADD CONSTRAINT "hr_leave_policy_assignments_leave_policy_id_fkey" FOREIGN KEY ("leave_policy_id") REFERENCES "hr_leave_policies"("id") ON DELETE SET NULL ON UPDATE CASCADE
;
-- AddForeignKey
ALTER TABLE "hr_leave_policy_assignments" ADD CONSTRAINT "hr_leave_policy_assignments_leave_period_id_fkey" FOREIGN KEY ("leave_period_id") REFERENCES "hr_leave_periods"("id") ON DELETE SET NULL ON UPDATE CASCADE
;
-- AddForeignKey
ALTER TABLE "hr_leave_encashments" ADD CONSTRAINT "hr_leave_encashments_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "hr_employees"("id") ON DELETE CASCADE ON UPDATE CASCADE
;
-- AddForeignKey
ALTER TABLE "hr_leave_encashments" ADD CONSTRAINT "hr_leave_encashments_leave_type_id_fkey" FOREIGN KEY ("leave_type_id") REFERENCES "hr_leave_types"("id") ON DELETE SET NULL ON UPDATE CASCADE
;
-- AddForeignKey
ALTER TABLE "hr_leave_encashments" ADD CONSTRAINT "hr_leave_encashments_leave_period_id_fkey" FOREIGN KEY ("leave_period_id") REFERENCES "hr_leave_periods"("id") ON DELETE SET NULL ON UPDATE CASCADE
;
-- AddForeignKey
ALTER TABLE "hr_leave_encashments" ADD CONSTRAINT "hr_leave_encashments_leave_balance_id_fkey" FOREIGN KEY ("leave_balance_id") REFERENCES "hr_leave_balances"("id") ON DELETE SET NULL ON UPDATE CASCADE
;
-- AddForeignKey
ALTER TABLE "hr_employee_checkins" ADD CONSTRAINT "hr_employee_checkins_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "hr_employees"("id") ON DELETE CASCADE ON UPDATE CASCADE
;
-- AddForeignKey
ALTER TABLE "hr_employee_checkins" ADD CONSTRAINT "hr_employee_checkins_shift_id_fkey" FOREIGN KEY ("shift_id") REFERENCES "hr_shifts"("id") ON DELETE SET NULL ON UPDATE CASCADE
;
-- AddForeignKey
ALTER TABLE "hr_employee_checkins" ADD CONSTRAINT "hr_employee_checkins_attendance_id_fkey" FOREIGN KEY ("attendance_id") REFERENCES "hr_attendances"("id") ON DELETE SET NULL ON UPDATE CASCADE
;
-- AddForeignKey
ALTER TABLE "hr_shift_requests" ADD CONSTRAINT "hr_shift_requests_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "hr_employees"("id") ON DELETE CASCADE ON UPDATE CASCADE
;
-- AddForeignKey
ALTER TABLE "hr_shift_requests" ADD CONSTRAINT "hr_shift_requests_shift_id_fkey" FOREIGN KEY ("shift_id") REFERENCES "hr_shifts"("id") ON DELETE SET NULL ON UPDATE CASCADE
;
-- AddForeignKey
ALTER TABLE "hr_job_applicants" ADD CONSTRAINT "hr_job_applicants_job_opening_id_fkey" FOREIGN KEY ("job_opening_id") REFERENCES "hr_job_openings"("id") ON DELETE SET NULL ON UPDATE CASCADE
;
-- AddForeignKey
ALTER TABLE "hr_interviews" ADD CONSTRAINT "hr_interviews_job_applicant_id_fkey" FOREIGN KEY ("job_applicant_id") REFERENCES "hr_job_applicants"("id") ON DELETE CASCADE ON UPDATE CASCADE
;
-- AddForeignKey
ALTER TABLE "hr_job_offers" ADD CONSTRAINT "hr_job_offers_job_applicant_id_fkey" FOREIGN KEY ("job_applicant_id") REFERENCES "hr_job_applicants"("id") ON DELETE CASCADE ON UPDATE CASCADE
;
-- AddForeignKey
ALTER TABLE "hr_job_offers" ADD CONSTRAINT "hr_job_offers_salary_structure_id_fkey" FOREIGN KEY ("salary_structure_id") REFERENCES "hr_salary_structures"("id") ON DELETE SET NULL ON UPDATE CASCADE
;
-- AddForeignKey
ALTER TABLE "hr_employee_onboardings" ADD CONSTRAINT "hr_employee_onboardings_job_offer_id_fkey" FOREIGN KEY ("job_offer_id") REFERENCES "hr_job_offers"("id") ON DELETE SET NULL ON UPDATE CASCADE
;
-- AddForeignKey
ALTER TABLE "hr_employee_onboardings" ADD CONSTRAINT "hr_employee_onboardings_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "hr_employees"("id") ON DELETE SET NULL ON UPDATE CASCADE
;
-- AddForeignKey
ALTER TABLE "hr_employee_separations" ADD CONSTRAINT "hr_employee_separations_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "hr_employees"("id") ON DELETE CASCADE ON UPDATE CASCADE
;
-- AddForeignKey
ALTER TABLE "hr_employee_grievances" ADD CONSTRAINT "hr_employee_grievances_raised_by_employee_id_fkey" FOREIGN KEY ("raised_by_employee_id") REFERENCES "hr_employees"("id") ON DELETE SET NULL ON UPDATE CASCADE
;
-- AddForeignKey
ALTER TABLE "hr_employee_grievances" ADD CONSTRAINT "hr_employee_grievances_employee_against_id_fkey" FOREIGN KEY ("employee_against_id") REFERENCES "hr_employees"("id") ON DELETE SET NULL ON UPDATE CASCADE
;
-- AddForeignKey
ALTER TABLE "hr_employee_transfers" ADD CONSTRAINT "hr_employee_transfers_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "hr_employees"("id") ON DELETE CASCADE ON UPDATE CASCADE
;
-- AddForeignKey
ALTER TABLE "hr_employee_promotions" ADD CONSTRAINT "hr_employee_promotions_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "hr_employees"("id") ON DELETE CASCADE ON UPDATE CASCADE
;
-- AddForeignKey
ALTER TABLE "hr_employee_promotions" ADD CONSTRAINT "hr_employee_promotions_salary_structure_id_fkey" FOREIGN KEY ("salary_structure_id") REFERENCES "hr_salary_structures"("id") ON DELETE SET NULL ON UPDATE CASCADE
;
-- AddForeignKey
ALTER TABLE "hr_employee_skill_maps" ADD CONSTRAINT "hr_employee_skill_maps_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "hr_employees"("id") ON DELETE CASCADE ON UPDATE CASCADE
;
-- AddForeignKey
ALTER TABLE "hr_training_events" ADD CONSTRAINT "hr_training_events_training_program_id_fkey" FOREIGN KEY ("training_program_id") REFERENCES "hr_training_programs"("id") ON DELETE SET NULL ON UPDATE CASCADE
;
-- AddForeignKey
ALTER TABLE "hr_employee_benefit_applications" ADD CONSTRAINT "hr_employee_benefit_applications_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "hr_employees"("id") ON DELETE CASCADE ON UPDATE CASCADE
;
-- AddForeignKey
ALTER TABLE "hr_employee_benefit_claims" ADD CONSTRAINT "hr_employee_benefit_claims_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "hr_employees"("id") ON DELETE CASCADE ON UPDATE CASCADE
;
-- AddForeignKey
ALTER TABLE "hr_employee_benefit_claims" ADD CONSTRAINT "hr_employee_benefit_claims_benefit_application_id_fkey" FOREIGN KEY ("benefit_application_id") REFERENCES "hr_employee_benefit_applications"("id") ON DELETE SET NULL ON UPDATE CASCADE
;
-- AddForeignKey
ALTER TABLE "hr_tax_exemption_declarations" ADD CONSTRAINT "hr_tax_exemption_declarations_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "hr_employees"("id") ON DELETE CASCADE ON UPDATE CASCADE
;
-- AddForeignKey
ALTER TABLE "hr_tax_exemption_proof_submissions" ADD CONSTRAINT "hr_tax_exemption_proof_submissions_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "hr_employees"("id") ON DELETE CASCADE ON UPDATE CASCADE
;
-- AddForeignKey
ALTER TABLE "hr_tax_exemption_proof_submissions" ADD CONSTRAINT "hr_tax_exemption_proof_submissions_declaration_id_fkey" FOREIGN KEY ("declaration_id") REFERENCES "hr_tax_exemption_declarations"("id") ON DELETE SET NULL ON UPDATE CASCADE
;
-- AddForeignKey
ALTER TABLE "hr_expense_claims" ADD CONSTRAINT "hr_expense_claims_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "hr_employees"("id") ON DELETE CASCADE ON UPDATE CASCADE
;

-- Data alignment: leave application statuses follow the ERPNext vocabulary
-- (Open -> Approved/Rejected/Cancelled). 'Pending' rows become 'Open'.
UPDATE "hr_leaves" SET "status" = 'Open' WHERE "status" = 'Pending';
