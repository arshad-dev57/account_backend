-- ERPNext recruitment, lifecycle and training documents. Additive only: new
-- tables (and their foreign keys) never touch rows owned by other modules.

CREATE TABLE IF NOT EXISTS "hr_skills" (
  "id" TEXT NOT NULL,
  "company_id" TEXT NOT NULL,
  "skill_name" TEXT NOT NULL,
  "description" TEXT NOT NULL DEFAULT '',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "hr_skills_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "hr_skills_company_id_skill_name_key" ON "hr_skills"("company_id", "skill_name");
CREATE INDEX IF NOT EXISTS "hr_skills_company_id_idx" ON "hr_skills"("company_id");

CREATE TABLE IF NOT EXISTS "hr_offer_terms" (
  "id" TEXT NOT NULL,
  "company_id" TEXT NOT NULL,
  "offer_term" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "hr_offer_terms_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "hr_offer_terms_company_id_offer_term_key" ON "hr_offer_terms"("company_id", "offer_term");
CREATE INDEX IF NOT EXISTS "hr_offer_terms_company_id_idx" ON "hr_offer_terms"("company_id");

CREATE TABLE IF NOT EXISTS "hr_job_opening_templates" (
  "id" TEXT NOT NULL,
  "company_id" TEXT NOT NULL,
  "template_title" TEXT NOT NULL,
  "department_id" TEXT,
  "designation_id" TEXT,
  "employment_type_id" TEXT,
  "location_id" TEXT,
  "currency" TEXT NOT NULL DEFAULT '',
  "upper_range" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "lower_range" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "salary_per" TEXT NOT NULL DEFAULT 'Month',
  "publish_salary_range" BOOLEAN NOT NULL DEFAULT false,
  "description" TEXT NOT NULL DEFAULT '',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "hr_job_opening_templates_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "hr_job_opening_templates_company_id_template_title_key" ON "hr_job_opening_templates"("company_id", "template_title");
CREATE INDEX IF NOT EXISTS "hr_job_opening_templates_company_id_idx" ON "hr_job_opening_templates"("company_id");

CREATE TABLE IF NOT EXISTS "hr_job_offer_term_templates" (
  "id" TEXT NOT NULL,
  "company_id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "offer_terms" JSONB NOT NULL DEFAULT '[]',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "hr_job_offer_term_templates_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "hr_job_offer_term_templates_company_id_title_key" ON "hr_job_offer_term_templates"("company_id", "title");
CREATE INDEX IF NOT EXISTS "hr_job_offer_term_templates_company_id_idx" ON "hr_job_offer_term_templates"("company_id");

CREATE TABLE IF NOT EXISTS "hr_appointment_letter_templates" (
  "id" TEXT NOT NULL,
  "company_id" TEXT NOT NULL,
  "template_name" TEXT NOT NULL,
  "introduction" TEXT NOT NULL DEFAULT '',
  "terms" JSONB NOT NULL DEFAULT '[]',
  "closing_notes" TEXT NOT NULL DEFAULT '',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "hr_appointment_letter_templates_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "hr_appointment_letter_templates_company_id_template_name_key" ON "hr_appointment_letter_templates"("company_id", "template_name");
CREATE INDEX IF NOT EXISTS "hr_appointment_letter_templates_company_id_idx" ON "hr_appointment_letter_templates"("company_id");

CREATE TABLE IF NOT EXISTS "hr_appointment_letters" (
  "id" TEXT NOT NULL,
  "company_id" TEXT NOT NULL,
  "job_applicant_id" TEXT NOT NULL,
  "applicant_name" TEXT NOT NULL DEFAULT '',
  "appointment_date" DATE,
  "template_id" TEXT,
  "introduction" TEXT NOT NULL DEFAULT '',
  "terms" JSONB NOT NULL DEFAULT '[]',
  "closing_notes" TEXT NOT NULL DEFAULT '',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "hr_appointment_letters_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "hr_appointment_letters_company_id_idx" ON "hr_appointment_letters"("company_id");
DO $$ BEGIN
  ALTER TABLE "hr_appointment_letters" ADD CONSTRAINT "hr_appointment_letters_job_applicant_id_fkey"
    FOREIGN KEY ("job_applicant_id") REFERENCES "hr_job_applicants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "hr_appointment_letters" ADD CONSTRAINT "hr_appointment_letters_template_id_fkey"
    FOREIGN KEY ("template_id") REFERENCES "hr_appointment_letter_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "hr_staffing_plans" (
  "id" TEXT NOT NULL,
  "company_id" TEXT NOT NULL,
  "department_id" TEXT,
  "from_date" DATE NOT NULL,
  "to_date" DATE NOT NULL,
  "staffing_details" JSONB NOT NULL DEFAULT '[]',
  "total_estimated_budget" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "hr_staffing_plans_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "hr_staffing_plans_company_id_idx" ON "hr_staffing_plans"("company_id");

CREATE TABLE IF NOT EXISTS "hr_employee_referrals" (
  "id" TEXT NOT NULL,
  "company_id" TEXT NOT NULL,
  "first_name" TEXT NOT NULL,
  "last_name" TEXT NOT NULL DEFAULT '',
  "full_name" TEXT NOT NULL DEFAULT '',
  "date" DATE,
  "status" TEXT NOT NULL DEFAULT 'Pending',
  "for_designation_id" TEXT,
  "email" TEXT NOT NULL DEFAULT '',
  "contact_no" TEXT NOT NULL DEFAULT '',
  "resume_link" TEXT NOT NULL DEFAULT '',
  "current_employer" TEXT NOT NULL DEFAULT '',
  "current_job_title" TEXT NOT NULL DEFAULT '',
  "resume" TEXT NOT NULL DEFAULT '',
  "referrer_employee_id" TEXT,
  "referrer_name" TEXT NOT NULL DEFAULT '',
  "is_applicable_for_referral_bonus" BOOLEAN NOT NULL DEFAULT true,
  "referral_payment_status" TEXT NOT NULL DEFAULT '',
  "department_id" TEXT,
  "qualification_reason" TEXT NOT NULL DEFAULT '',
  "work_references" TEXT NOT NULL DEFAULT '',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "hr_employee_referrals_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "hr_employee_referrals_company_id_status_idx" ON "hr_employee_referrals"("company_id", "status");

CREATE TABLE IF NOT EXISTS "hr_employee_onboarding_templates" (
  "id" TEXT NOT NULL,
  "company_id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "department_id" TEXT,
  "designation_id" TEXT,
  "employee_grade_id" TEXT,
  "activities" JSONB NOT NULL DEFAULT '[]',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "hr_employee_onboarding_templates_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "hr_employee_onboarding_templates_company_id_title_key" ON "hr_employee_onboarding_templates"("company_id", "title");
CREATE INDEX IF NOT EXISTS "hr_employee_onboarding_templates_company_id_idx" ON "hr_employee_onboarding_templates"("company_id");

CREATE TABLE IF NOT EXISTS "hr_employee_separation_templates" (
  "id" TEXT NOT NULL,
  "company_id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "department_id" TEXT,
  "designation_id" TEXT,
  "employee_grade_id" TEXT,
  "activities" JSONB NOT NULL DEFAULT '[]',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "hr_employee_separation_templates_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "hr_employee_separation_templates_company_id_title_key" ON "hr_employee_separation_templates"("company_id", "title");
CREATE INDEX IF NOT EXISTS "hr_employee_separation_templates_company_id_idx" ON "hr_employee_separation_templates"("company_id");

CREATE TABLE IF NOT EXISTS "hr_training_feedbacks" (
  "id" TEXT NOT NULL,
  "company_id" TEXT NOT NULL,
  "employee_id" TEXT NOT NULL,
  "employee_name" TEXT NOT NULL DEFAULT '',
  "department" TEXT NOT NULL DEFAULT '',
  "course" TEXT NOT NULL DEFAULT '',
  "training_event_id" TEXT NOT NULL,
  "event_name" TEXT NOT NULL DEFAULT '',
  "trainer_name" TEXT NOT NULL DEFAULT '',
  "feedback" TEXT NOT NULL DEFAULT '',
  "status" TEXT NOT NULL DEFAULT 'Draft',
  "doc_status" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "hr_training_feedbacks_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "hr_training_feedbacks_company_id_training_event_id_idx" ON "hr_training_feedbacks"("company_id", "training_event_id");
DO $$ BEGIN
  ALTER TABLE "hr_training_feedbacks" ADD CONSTRAINT "hr_training_feedbacks_training_event_id_fkey"
    FOREIGN KEY ("training_event_id") REFERENCES "hr_training_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "hr_training_results" (
  "id" TEXT NOT NULL,
  "company_id" TEXT NOT NULL,
  "training_event_id" TEXT NOT NULL,
  "employees" JSONB NOT NULL DEFAULT '[]',
  "employee_emails" TEXT NOT NULL DEFAULT '',
  "status" TEXT NOT NULL DEFAULT 'Draft',
  "doc_status" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "hr_training_results_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "hr_training_results_company_id_training_event_id_idx" ON "hr_training_results"("company_id", "training_event_id");
DO $$ BEGIN
  ALTER TABLE "hr_training_results" ADD CONSTRAINT "hr_training_results_training_event_id_fkey"
    FOREIGN KEY ("training_event_id") REFERENCES "hr_training_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "hr_holiday_list_assignments" (
  "id" TEXT NOT NULL,
  "company_id" TEXT NOT NULL,
  "applicable_for" TEXT NOT NULL DEFAULT 'Employee',
  "assigned_to_id" TEXT NOT NULL,
  "employee_name" TEXT NOT NULL DEFAULT '',
  "employee_company_id" TEXT NOT NULL DEFAULT '',
  "holiday_list_id" TEXT NOT NULL,
  "from_date" DATE NOT NULL,
  "holiday_list_start" DATE,
  "holiday_list_end" DATE,
  "status" TEXT NOT NULL DEFAULT 'Draft',
  "doc_status" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "hr_holiday_list_assignments_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "hr_holiday_list_assignments_company_id_assigned_to_id_idx" ON "hr_holiday_list_assignments"("company_id", "assigned_to_id");
DO $$ BEGIN
  ALTER TABLE "hr_holiday_list_assignments" ADD CONSTRAINT "hr_holiday_list_assignments_holiday_list_id_fkey"
    FOREIGN KEY ("holiday_list_id") REFERENCES "hr_holiday_lists"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "hr_employee_feedback_criteria" (
  "id" TEXT NOT NULL,
  "company_id" TEXT NOT NULL,
  "criteria" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "hr_employee_feedback_criteria_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "hr_employee_feedback_criteria_company_id_criteria_key" ON "hr_employee_feedback_criteria"("company_id", "criteria");
CREATE INDEX IF NOT EXISTS "hr_employee_feedback_criteria_company_id_idx" ON "hr_employee_feedback_criteria"("company_id");
