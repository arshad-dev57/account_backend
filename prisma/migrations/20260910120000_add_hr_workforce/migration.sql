-- HR workforce: leaves, overtime, tasks, reviews, payroll, settings

CREATE TABLE IF NOT EXISTS "hr_leaves" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "from_date" DATE NOT NULL,
    "to_date" DATE NOT NULL,
    "days" INTEGER NOT NULL,
    "reason" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'Pending',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "hr_leaves_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "hr_overtimes" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "work_date" DATE NOT NULL,
    "hours" DOUBLE PRECISION NOT NULL,
    "rate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'Pending',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "hr_overtimes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "hr_tasks" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "employee_id" TEXT,
    "title" TEXT NOT NULL,
    "due_date" DATE,
    "priority" TEXT NOT NULL DEFAULT 'Medium',
    "status" TEXT NOT NULL DEFAULT 'Pending',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "hr_tasks_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "hr_performance_reviews" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "rating" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "goals" TEXT NOT NULL DEFAULT '',
    "reviewer" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'Pending',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "hr_performance_reviews_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "hr_payroll_items" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "base" DOUBLE PRECISION NOT NULL,
    "overtime" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "deductions" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "net" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "hr_payroll_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "hr_settings" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "hr_settings_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "hr_leaves_company_id_status_idx" ON "hr_leaves"("company_id", "status");
CREATE INDEX IF NOT EXISTS "hr_leaves_employee_id_idx" ON "hr_leaves"("employee_id");
CREATE INDEX IF NOT EXISTS "hr_overtimes_company_id_status_idx" ON "hr_overtimes"("company_id", "status");
CREATE INDEX IF NOT EXISTS "hr_overtimes_employee_id_idx" ON "hr_overtimes"("employee_id");
CREATE INDEX IF NOT EXISTS "hr_tasks_company_id_idx" ON "hr_tasks"("company_id");
CREATE INDEX IF NOT EXISTS "hr_performance_reviews_company_id_idx" ON "hr_performance_reviews"("company_id");
CREATE UNIQUE INDEX IF NOT EXISTS "hr_payroll_items_employee_id_period_key" ON "hr_payroll_items"("employee_id", "period");
CREATE INDEX IF NOT EXISTS "hr_payroll_items_company_id_period_idx" ON "hr_payroll_items"("company_id", "period");
CREATE UNIQUE INDEX IF NOT EXISTS "hr_settings_company_id_key" ON "hr_settings"("company_id");

ALTER TABLE "hr_leaves" ADD CONSTRAINT "hr_leaves_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "hr_leaves" ADD CONSTRAINT "hr_leaves_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "hr_employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "hr_overtimes" ADD CONSTRAINT "hr_overtimes_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "hr_overtimes" ADD CONSTRAINT "hr_overtimes_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "hr_employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "hr_tasks" ADD CONSTRAINT "hr_tasks_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "hr_tasks" ADD CONSTRAINT "hr_tasks_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "hr_employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "hr_performance_reviews" ADD CONSTRAINT "hr_performance_reviews_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "hr_performance_reviews" ADD CONSTRAINT "hr_performance_reviews_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "hr_employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "hr_payroll_items" ADD CONSTRAINT "hr_payroll_items_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "hr_payroll_items" ADD CONSTRAINT "hr_payroll_items_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "hr_employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "hr_settings" ADD CONSTRAINT "hr_settings_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
