-- Import Finance LC: UCP 600 fields, utilization, SoD, status cleanup

ALTER TABLE "import_finance_lcs" ADD COLUMN IF NOT EXISTS "applicant" TEXT;
ALTER TABLE "import_finance_lcs" ADD COLUMN IF NOT EXISTS "supplier_id" TEXT;
ALTER TABLE "import_finance_lcs" ADD COLUMN IF NOT EXISTS "incoterm" TEXT;
ALTER TABLE "import_finance_lcs" ADD COLUMN IF NOT EXISTS "presentation_period_days" INTEGER NOT NULL DEFAULT 21;
ALTER TABLE "import_finance_lcs" ADD COLUMN IF NOT EXISTS "confirmed" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "import_finance_lcs" ADD COLUMN IF NOT EXISTS "partial_shipment_allowed" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "import_finance_lcs" ADD COLUMN IF NOT EXISTS "transshipment_allowed" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "import_finance_lcs" ADD COLUMN IF NOT EXISTS "port_of_loading" TEXT;
ALTER TABLE "import_finance_lcs" ADD COLUMN IF NOT EXISTS "port_of_discharge" TEXT;
ALTER TABLE "import_finance_lcs" ADD COLUMN IF NOT EXISTS "amount_tolerance_percent" DECIMAL(8,2) NOT NULL DEFAULT 0;
ALTER TABLE "import_finance_lcs" ADD COLUMN IF NOT EXISTS "amount_drawn" DECIMAL(18,4) NOT NULL DEFAULT 0;
ALTER TABLE "import_finance_lcs" ADD COLUMN IF NOT EXISTS "issued_by" TEXT;
ALTER TABLE "import_finance_lcs" ADD COLUMN IF NOT EXISTS "issued_at" TIMESTAMP(3);
ALTER TABLE "import_finance_lcs" ADD COLUMN IF NOT EXISTS "approved_by" TEXT;
ALTER TABLE "import_finance_lcs" ADD COLUMN IF NOT EXISTS "approved_at" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "import_finance_lcs_supplier_id_idx"
  ON "import_finance_lcs"("supplier_id");

CREATE INDEX IF NOT EXISTS "import_finance_lcs_proforma_id_idx"
  ON "import_finance_lcs"("proforma_id");

UPDATE "import_finance_lcs"
SET "status" = 'Draft'
WHERE "status" IN ('Application Submitted', 'Draft Application', 'Pending');

UPDATE "import_finance_lcs"
SET "status" = 'Paid/Settled'
WHERE "status" IN ('Settled', 'Paid', 'Closed');

UPDATE "import_finance_lcs"
SET "status" = 'Documents Presented'
WHERE "status" IN ('Docs Presented', 'Presented');

ALTER TABLE "import_settings"
  ADD COLUMN IF NOT EXISTS "require_separate_lc_approver" BOOLEAN NOT NULL DEFAULT true;

UPDATE "import_settings"
SET "require_separate_lc_approver" = true
WHERE "require_separate_lc_approver" IS DISTINCT FROM true;

ALTER TABLE "import_proforma_invoices"
  ADD COLUMN IF NOT EXISTS "advance_payment_details" JSONB;
