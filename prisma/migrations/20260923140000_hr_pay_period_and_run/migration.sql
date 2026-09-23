-- CreateTable
CREATE TABLE "hr_pay_periods" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "period_key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "pay_date" DATE,
    "frequency" TEXT NOT NULL DEFAULT 'monthly',
    "branch_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "opened_at" TIMESTAMP(3),
    "calculated_at" TIMESTAMP(3),
    "approved_at" TIMESTAMP(3),
    "finalized_at" TIMESTAMP(3),
    "paid_at" TIMESTAMP(3),
    "closed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hr_pay_periods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_payroll_runs" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "pay_period_id" TEXT NOT NULL,
    "initiated_by_id" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "employee_count" INTEGER NOT NULL DEFAULT 0,
    "processed_count" INTEGER NOT NULL DEFAULT 0,
    "excluded_count" INTEGER NOT NULL DEFAULT 0,
    "gross_total" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "deduction_total" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "tax_total" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "net_total" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "validation_warnings" JSONB,
    "validation_errors" JSONB,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hr_payroll_runs_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "hr_payroll_items" ADD COLUMN "pay_period_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "hr_pay_periods_company_id_period_key_key" ON "hr_pay_periods"("company_id", "period_key");

-- CreateIndex
CREATE INDEX "hr_pay_periods_company_id_status_idx" ON "hr_pay_periods"("company_id", "status");

-- CreateIndex
CREATE INDEX "hr_pay_periods_branch_id_idx" ON "hr_pay_periods"("branch_id");

-- CreateIndex
CREATE INDEX "hr_payroll_runs_company_id_pay_period_id_idx" ON "hr_payroll_runs"("company_id", "pay_period_id");

-- CreateIndex
CREATE INDEX "hr_payroll_runs_pay_period_id_started_at_idx" ON "hr_payroll_runs"("pay_period_id", "started_at");

-- CreateIndex
CREATE INDEX "hr_payroll_items_pay_period_id_idx" ON "hr_payroll_items"("pay_period_id");

-- AddForeignKey
ALTER TABLE "hr_pay_periods" ADD CONSTRAINT "hr_pay_periods_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_pay_periods" ADD CONSTRAINT "hr_pay_periods_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "hr_offices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_payroll_runs" ADD CONSTRAINT "hr_payroll_runs_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_payroll_runs" ADD CONSTRAINT "hr_payroll_runs_pay_period_id_fkey" FOREIGN KEY ("pay_period_id") REFERENCES "hr_pay_periods"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_payroll_runs" ADD CONSTRAINT "hr_payroll_runs_initiated_by_id_fkey" FOREIGN KEY ("initiated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_payroll_items" ADD CONSTRAINT "hr_payroll_items_pay_period_id_fkey" FOREIGN KEY ("pay_period_id") REFERENCES "hr_pay_periods"("id") ON DELETE SET NULL ON UPDATE CASCADE;
