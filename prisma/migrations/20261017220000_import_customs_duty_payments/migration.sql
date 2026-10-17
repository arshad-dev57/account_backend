-- Customs duty payments (partial payments, bank account, journal link)
CREATE TABLE IF NOT EXISTS "import_customs_duty_payments" (
  "id" TEXT NOT NULL,
  "company_id" TEXT NOT NULL,
  "clearance_id" TEXT NOT NULL,
  "amount" DECIMAL(18,4) NOT NULL,
  "payment_date" TIMESTAMP(3) NOT NULL,
  "payment_method" TEXT NOT NULL,
  "reference" TEXT NOT NULL,
  "bank_account_id" TEXT NOT NULL,
  "bank_account_name" TEXT,
  "chart_of_account_id" TEXT,
  "journal_entry_id" TEXT,
  "journal_entry_number" TEXT,
  "difference_reason" TEXT,
  "difference_approved" BOOLEAN NOT NULL DEFAULT false,
  "created_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "import_customs_duty_payments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "import_customs_duty_payments_company_bank_ref_key"
  ON "import_customs_duty_payments"("company_id", "bank_account_id", "reference");
CREATE INDEX IF NOT EXISTS "import_customs_duty_payments_clearance_id_idx"
  ON "import_customs_duty_payments"("clearance_id");
CREATE INDEX IF NOT EXISTS "import_customs_duty_payments_company_date_idx"
  ON "import_customs_duty_payments"("company_id", "payment_date");
CREATE INDEX IF NOT EXISTS "import_customs_duty_payments_journal_entry_id_idx"
  ON "import_customs_duty_payments"("journal_entry_id");

DO $$ BEGIN
  ALTER TABLE "import_customs_duty_payments"
    ADD CONSTRAINT "import_customs_duty_payments_company_id_fkey"
    FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "import_customs_duty_payments"
    ADD CONSTRAINT "import_customs_duty_payments_clearance_id_fkey"
    FOREIGN KEY ("clearance_id") REFERENCES "import_customs_clearances"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "import_customs_duty_payments"
    ADD CONSTRAINT "import_customs_duty_payments_bank_account_id_fkey"
    FOREIGN KEY ("bank_account_id") REFERENCES "bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "import_customs_duty_payments"
    ADD CONSTRAINT "import_customs_duty_payments_journal_entry_id_fkey"
    FOREIGN KEY ("journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "import_customs_duty_payments"
    ADD CONSTRAINT "import_customs_duty_payments_created_by_fkey"
    FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "import_customs_clearances"
  ADD COLUMN IF NOT EXISTS "duty_paid_total_usd" DECIMAL(18,4) NOT NULL DEFAULT 0;
ALTER TABLE "import_customs_clearances"
  ADD COLUMN IF NOT EXISTS "last_journal_entry_id" TEXT;

ALTER TABLE "import_settings"
  ADD COLUMN IF NOT EXISTS "additional_duty_account_id" TEXT;
ALTER TABLE "import_settings"
  ADD COLUMN IF NOT EXISTS "regulatory_duty_account_id" TEXT;
ALTER TABLE "import_settings"
  ADD COLUMN IF NOT EXISTS "import_vat_account_id" TEXT;
ALTER TABLE "import_settings"
  ADD COLUMN IF NOT EXISTS "advance_income_tax_account_id" TEXT;
ALTER TABLE "import_settings"
  ADD COLUMN IF NOT EXISTS "clearing_broker_account_id" TEXT;
ALTER TABLE "import_settings"
  ADD COLUMN IF NOT EXISTS "require_separate_customs_payer" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "import_settings"
  ADD COLUMN IF NOT EXISTS "block_insufficient_balance" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "import_settings"
  ADD COLUMN IF NOT EXISTS "duty_payment_difference_threshold_pct" DECIMAL(8,2) NOT NULL DEFAULT 5;
