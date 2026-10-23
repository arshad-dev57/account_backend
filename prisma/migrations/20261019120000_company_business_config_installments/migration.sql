-- Company-level business model configuration
CREATE TABLE IF NOT EXISTS "company_business_configs" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "operational_business_type" TEXT NOT NULL DEFAULT 'Other',
    "sales_model" TEXT NOT NULL DEFAULT 'standard',
    "purchase_model" TEXT NOT NULL DEFAULT 'standard',
    "installment_revenue_policy" TEXT NOT NULL DEFAULT 'full_on_sale',
    "allow_child_config_override" BOOLEAN NOT NULL DEFAULT true,
    "inherited_from_parent" BOOLEAN NOT NULL DEFAULT false,
    "source_parent_company_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "company_business_configs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "company_business_configs_company_id_key" ON "company_business_configs"("company_id");
CREATE INDEX IF NOT EXISTS "company_business_configs_sales_model_idx" ON "company_business_configs"("sales_model");
CREATE INDEX IF NOT EXISTS "company_business_configs_purchase_model_idx" ON "company_business_configs"("purchase_model");

ALTER TABLE "company_business_configs"
  ADD CONSTRAINT "company_business_configs_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill default standard config for existing companies
INSERT INTO "company_business_configs" ("id", "company_id", "operational_business_type", "sales_model", "purchase_model", "updated_at")
SELECT gen_random_uuid()::text, c."id", 'Other', 'standard', 'standard', CURRENT_TIMESTAMP
FROM "companies" c
WHERE NOT EXISTS (
  SELECT 1 FROM "company_business_configs" bc WHERE bc."company_id" = c."id"
);

-- Sales invoice installment fields
ALTER TABLE "sales_invoices" ADD COLUMN IF NOT EXISTS "is_installment_sale" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "sales_invoices" ADD COLUMN IF NOT EXISTS "down_payment_amount" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "sales_invoices" ADD COLUMN IF NOT EXISTS "installment_count" INTEGER;
ALTER TABLE "sales_invoices" ADD COLUMN IF NOT EXISTS "installment_frequency" TEXT;
ALTER TABLE "sales_invoices" ADD COLUMN IF NOT EXISTS "installment_amount" DOUBLE PRECISION;

CREATE INDEX IF NOT EXISTS "sales_invoices_is_installment_sale_idx" ON "sales_invoices"("is_installment_sale");

CREATE TABLE IF NOT EXISTS "sales_installment_schedules" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "invoice_id" TEXT NOT NULL,
    "installment_number" INTEGER NOT NULL,
    "due_date" TIMESTAMP(3) NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "paid_amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'Pending',
    "paid_at" TIMESTAMP(3),
    "sales_payment_id" TEXT,
    "notes" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "sales_installment_schedules_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "sales_installment_schedules_invoice_id_installment_number_key"
  ON "sales_installment_schedules"("invoice_id", "installment_number");
CREATE INDEX IF NOT EXISTS "sales_installment_schedules_company_id_idx" ON "sales_installment_schedules"("company_id");
CREATE INDEX IF NOT EXISTS "sales_installment_schedules_invoice_id_idx" ON "sales_installment_schedules"("invoice_id");
CREATE INDEX IF NOT EXISTS "sales_installment_schedules_due_date_idx" ON "sales_installment_schedules"("due_date");
CREATE INDEX IF NOT EXISTS "sales_installment_schedules_status_idx" ON "sales_installment_schedules"("status");

ALTER TABLE "sales_installment_schedules"
  ADD CONSTRAINT "sales_installment_schedules_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sales_installment_schedules"
  ADD CONSTRAINT "sales_installment_schedules_invoice_id_fkey"
  FOREIGN KEY ("invoice_id") REFERENCES "sales_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Purchase invoice installment fields
ALTER TABLE "purchase_invoices" ADD COLUMN IF NOT EXISTS "is_installment_purchase" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "purchase_invoices" ADD COLUMN IF NOT EXISTS "down_payment_amount" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "purchase_invoices" ADD COLUMN IF NOT EXISTS "installment_count" INTEGER;
ALTER TABLE "purchase_invoices" ADD COLUMN IF NOT EXISTS "installment_frequency" TEXT;
ALTER TABLE "purchase_invoices" ADD COLUMN IF NOT EXISTS "installment_amount" DOUBLE PRECISION;

CREATE INDEX IF NOT EXISTS "purchase_invoices_is_installment_purchase_idx" ON "purchase_invoices"("is_installment_purchase");

CREATE TABLE IF NOT EXISTS "purchase_installment_schedules" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "invoice_id" TEXT NOT NULL,
    "installment_number" INTEGER NOT NULL,
    "due_date" TIMESTAMP(3) NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "paid_amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'Pending',
    "paid_at" TIMESTAMP(3),
    "purchase_payment_id" TEXT,
    "notes" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "purchase_installment_schedules_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "purchase_installment_schedules_invoice_id_installment_number_key"
  ON "purchase_installment_schedules"("invoice_id", "installment_number");
CREATE INDEX IF NOT EXISTS "purchase_installment_schedules_company_id_idx" ON "purchase_installment_schedules"("company_id");
CREATE INDEX IF NOT EXISTS "purchase_installment_schedules_invoice_id_idx" ON "purchase_installment_schedules"("invoice_id");
CREATE INDEX IF NOT EXISTS "purchase_installment_schedules_due_date_idx" ON "purchase_installment_schedules"("due_date");
CREATE INDEX IF NOT EXISTS "purchase_installment_schedules_status_idx" ON "purchase_installment_schedules"("status");

ALTER TABLE "purchase_installment_schedules"
  ADD CONSTRAINT "purchase_installment_schedules_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "purchase_installment_schedules"
  ADD CONSTRAINT "purchase_installment_schedules_invoice_id_fkey"
  FOREIGN KEY ("invoice_id") REFERENCES "purchase_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
