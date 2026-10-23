-- Customs clearance / port formalities approval gate (Duty Paid → Pending Approval → Approved → Released)
ALTER TABLE "import_customs_clearances"
  ADD COLUMN IF NOT EXISTS "approval_requested_by" TEXT,
  ADD COLUMN IF NOT EXISTS "approval_requested_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "approved_by" TEXT,
  ADD COLUMN IF NOT EXISTS "approved_at" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "import_customs_clearances_company_id_clearance_status_idx"
  ON "import_customs_clearances"("company_id", "clearance_status");
