-- ERPNext Salary Component parity (Overview / Accounts / Condition & Formula / Flexible Benefits)

ALTER TABLE "hr_salary_components"
  ADD COLUMN IF NOT EXISTS "abbr" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "deduct_full_tax_on_selected_payroll_date" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "variable_based_on_taxable_salary" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "is_income_tax_component" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "exempted_from_income_tax" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "accrual_component" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "do_not_include_in_total" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "do_not_include_in_accounts" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "remove_if_zero_valued" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "arrear_component" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "accounts" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS "condition" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "amount_based_on_formula" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "formula" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "is_flexible_benefit" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "payout_method" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "final_cycle_accrual_payout" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "max_benefit_amount" DOUBLE PRECISION NOT NULL DEFAULT 0;

ALTER TABLE "hr_salary_components"
  ALTER COLUMN "is_taxable_component" SET DEFAULT true,
  ALTER COLUMN "round_to_nearest_integral" SET DEFAULT false;
