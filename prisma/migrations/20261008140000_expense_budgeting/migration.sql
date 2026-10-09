-- Expense: optional department / cost center
ALTER TABLE "expenses"
  ADD COLUMN IF NOT EXISTS "department_id" TEXT,
  ADD COLUMN IF NOT EXISTS "cost_center_id" TEXT;

CREATE INDEX IF NOT EXISTS "expenses_department_id_idx" ON "expenses"("department_id");
CREATE INDEX IF NOT EXISTS "expenses_cost_center_id_idx" ON "expenses"("cost_center_id");

DO $$ BEGIN
  ALTER TABLE "expenses"
    ADD CONSTRAINT "expenses_department_id_fkey"
    FOREIGN KEY ("department_id") REFERENCES "hr_departments"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "expenses"
    ADD CONSTRAINT "expenses_cost_center_id_fkey"
    FOREIGN KEY ("cost_center_id") REFERENCES "cost_centers"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Expense attachments
CREATE TABLE IF NOT EXISTS "expense_attachments" (
  "id" TEXT NOT NULL,
  "expense_id" TEXT NOT NULL,
  "company_id" TEXT NOT NULL,
  "file_url" TEXT NOT NULL,
  "file_name" TEXT NOT NULL DEFAULT '',
  "file_size" INTEGER NOT NULL DEFAULT 0,
  "mime_type" TEXT NOT NULL DEFAULT '',
  "cloudinary_public_id" TEXT NOT NULL DEFAULT '',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "expense_attachments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "expense_attachments_expense_id_idx" ON "expense_attachments"("expense_id");
CREATE INDEX IF NOT EXISTS "expense_attachments_company_id_idx" ON "expense_attachments"("company_id");

DO $$ BEGIN
  ALTER TABLE "expense_attachments"
    ADD CONSTRAINT "expense_attachments_expense_id_fkey"
    FOREIGN KEY ("expense_id") REFERENCES "expenses"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "expense_attachments"
    ADD CONSTRAINT "expense_attachments_company_id_fkey"
    FOREIGN KEY ("company_id") REFERENCES "companies"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Budgets
CREATE TABLE IF NOT EXISTS "budgets" (
  "id" TEXT NOT NULL,
  "company_id" TEXT NOT NULL,
  "fiscal_year_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "department_id" TEXT,
  "cost_center_id" TEXT,
  "start_date" TIMESTAMP(3) NOT NULL,
  "end_date" TIMESTAMP(3) NOT NULL,
  "notes" TEXT NOT NULL DEFAULT '',
  "status" TEXT NOT NULL DEFAULT 'Draft',
  "created_by" TEXT NOT NULL,
  "approved_by" TEXT,
  "approved_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "budgets_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "budgets_company_id_fiscal_year_id_name_key"
  ON "budgets"("company_id", "fiscal_year_id", "name");
CREATE INDEX IF NOT EXISTS "budgets_company_id_idx" ON "budgets"("company_id");
CREATE INDEX IF NOT EXISTS "budgets_fiscal_year_id_idx" ON "budgets"("fiscal_year_id");
CREATE INDEX IF NOT EXISTS "budgets_status_idx" ON "budgets"("status");
CREATE INDEX IF NOT EXISTS "budgets_department_id_idx" ON "budgets"("department_id");
CREATE INDEX IF NOT EXISTS "budgets_cost_center_id_idx" ON "budgets"("cost_center_id");

DO $$ BEGIN
  ALTER TABLE "budgets" ADD CONSTRAINT "budgets_company_id_fkey"
    FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "budgets" ADD CONSTRAINT "budgets_fiscal_year_id_fkey"
    FOREIGN KEY ("fiscal_year_id") REFERENCES "fiscal_years"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "budgets" ADD CONSTRAINT "budgets_department_id_fkey"
    FOREIGN KEY ("department_id") REFERENCES "hr_departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "budgets" ADD CONSTRAINT "budgets_cost_center_id_fkey"
    FOREIGN KEY ("cost_center_id") REFERENCES "cost_centers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "budgets" ADD CONSTRAINT "budgets_created_by_fkey"
    FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "budgets" ADD CONSTRAINT "budgets_approved_by_fkey"
    FOREIGN KEY ("approved_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "budget_lines" (
  "id" TEXT NOT NULL,
  "budget_id" TEXT NOT NULL,
  "account_id" TEXT NOT NULL,
  "department_id" TEXT,
  "cost_center_id" TEXT,
  "amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "notes" TEXT NOT NULL DEFAULT '',
  CONSTRAINT "budget_lines_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "budget_lines_budget_id_idx" ON "budget_lines"("budget_id");
CREATE INDEX IF NOT EXISTS "budget_lines_account_id_idx" ON "budget_lines"("account_id");
CREATE INDEX IF NOT EXISTS "budget_lines_department_id_idx" ON "budget_lines"("department_id");
CREATE INDEX IF NOT EXISTS "budget_lines_cost_center_id_idx" ON "budget_lines"("cost_center_id");

DO $$ BEGIN
  ALTER TABLE "budget_lines" ADD CONSTRAINT "budget_lines_budget_id_fkey"
    FOREIGN KEY ("budget_id") REFERENCES "budgets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "budget_lines" ADD CONSTRAINT "budget_lines_account_id_fkey"
    FOREIGN KEY ("account_id") REFERENCES "chart_of_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "budget_lines" ADD CONSTRAINT "budget_lines_department_id_fkey"
    FOREIGN KEY ("department_id") REFERENCES "hr_departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "budget_lines" ADD CONSTRAINT "budget_lines_cost_center_id_fkey"
    FOREIGN KEY ("cost_center_id") REFERENCES "cost_centers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "budget_period_allocations" (
  "id" TEXT NOT NULL,
  "budget_line_id" TEXT NOT NULL,
  "period_key" TEXT NOT NULL,
  "amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
  CONSTRAINT "budget_period_allocations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "budget_period_allocations_budget_line_id_period_key_key"
  ON "budget_period_allocations"("budget_line_id", "period_key");
CREATE INDEX IF NOT EXISTS "budget_period_allocations_budget_line_id_idx"
  ON "budget_period_allocations"("budget_line_id");
CREATE INDEX IF NOT EXISTS "budget_period_allocations_period_key_idx"
  ON "budget_period_allocations"("period_key");

DO $$ BEGIN
  ALTER TABLE "budget_period_allocations" ADD CONSTRAINT "budget_period_allocations_budget_line_id_fkey"
    FOREIGN KEY ("budget_line_id") REFERENCES "budget_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
