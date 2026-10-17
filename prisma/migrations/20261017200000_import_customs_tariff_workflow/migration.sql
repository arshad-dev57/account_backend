-- Import customs: tariff table, clearance lines, declaration workflow fields, settings, review flags

-- Settings
ALTER TABLE "import_settings"
  ADD COLUMN IF NOT EXISTS "default_customs_duty_rate_pct" DECIMAL(8,2) NOT NULL DEFAULT 10;
ALTER TABLE "import_settings"
  ADD COLUMN IF NOT EXISTS "default_import_vat_rate_pct" DECIMAL(8,2) NOT NULL DEFAULT 5;
ALTER TABLE "import_settings"
  ADD COLUMN IF NOT EXISTS "require_separate_customs_assessor" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "import_settings"
  ADD COLUMN IF NOT EXISTS "company_country_code" TEXT;

-- Clearance header extensions
ALTER TABLE "import_customs_clearances" ADD COLUMN IF NOT EXISTS "customs_office" TEXT;
ALTER TABLE "import_customs_clearances" ADD COLUMN IF NOT EXISTS "assessment_date" TIMESTAMP(3);
ALTER TABLE "import_customs_clearances" ADD COLUMN IF NOT EXISTS "demurrage_days" DECIMAL(10,2);
ALTER TABLE "import_customs_clearances" ADD COLUMN IF NOT EXISTS "demurrage_charges_usd" DECIMAL(18,4);
ALTER TABLE "import_customs_clearances" ADD COLUMN IF NOT EXISTS "clearing_broker_fee_usd" DECIMAL(18,4);
ALTER TABLE "import_customs_clearances" ADD COLUMN IF NOT EXISTS "additional_duty_rate_pct" DECIMAL(8,2);
ALTER TABLE "import_customs_clearances" ADD COLUMN IF NOT EXISTS "additional_duty_usd" DECIMAL(18,4);
ALTER TABLE "import_customs_clearances" ADD COLUMN IF NOT EXISTS "regulatory_duty_rate_pct" DECIMAL(8,2);
ALTER TABLE "import_customs_clearances" ADD COLUMN IF NOT EXISTS "regulatory_duty_usd" DECIMAL(18,4);
ALTER TABLE "import_customs_clearances" ADD COLUMN IF NOT EXISTS "advance_income_tax_rate_pct" DECIMAL(8,2);
ALTER TABLE "import_customs_clearances" ADD COLUMN IF NOT EXISTS "advance_income_tax_usd" DECIMAL(18,4);
ALTER TABLE "import_customs_clearances" ADD COLUMN IF NOT EXISTS "foreign_goods_value" DECIMAL(18,4);
ALTER TABLE "import_customs_clearances" ADD COLUMN IF NOT EXISTS "freight_foreign" DECIMAL(18,4);
ALTER TABLE "import_customs_clearances" ADD COLUMN IF NOT EXISTS "insurance_foreign" DECIMAL(18,4);
ALTER TABLE "import_customs_clearances" ADD COLUMN IF NOT EXISTS "rate_source" TEXT;
ALTER TABLE "import_customs_clearances" ADD COLUMN IF NOT EXISTS "fx_review_flag" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "import_customs_clearances" ADD COLUMN IF NOT EXISTS "fx_review_note" TEXT;
ALTER TABLE "import_customs_clearances" ADD COLUMN IF NOT EXISTS "duty_payment_date" TIMESTAMP(3);
ALTER TABLE "import_customs_clearances" ADD COLUMN IF NOT EXISTS "duty_payment_method" TEXT;
ALTER TABLE "import_customs_clearances" ADD COLUMN IF NOT EXISTS "duty_payment_bank" TEXT;
ALTER TABLE "import_customs_clearances" ADD COLUMN IF NOT EXISTS "duty_payment_amount" DECIMAL(18,4);
ALTER TABLE "import_customs_clearances" ADD COLUMN IF NOT EXISTS "duty_payment_difference_reason" TEXT;
ALTER TABLE "import_customs_clearances" ADD COLUMN IF NOT EXISTS "assessed_by" TEXT;
ALTER TABLE "import_customs_clearances" ADD COLUMN IF NOT EXISTS "assessed_at" TIMESTAMP(3);
ALTER TABLE "import_customs_clearances" ADD COLUMN IF NOT EXISTS "base_currency_code" TEXT;

-- Official declaration number uniqueness per customs office (when both present)
CREATE UNIQUE INDEX IF NOT EXISTS "import_customs_office_boe_unique"
  ON "import_customs_clearances" ("company_id", "customs_office", "bill_of_entry_no")
  WHERE "customs_office" IS NOT NULL AND trim("customs_office") <> ''
    AND "bill_of_entry_no" IS NOT NULL AND trim("bill_of_entry_no") <> ''
    AND "clearance_status" <> 'Cancelled';

-- Tariff master
CREATE TABLE IF NOT EXISTS "import_hs_tariff_rates" (
  "id" TEXT NOT NULL,
  "company_id" TEXT,
  "hs_code" TEXT NOT NULL,
  "description" TEXT,
  "country_code" TEXT,
  "duty_rate_pct" DECIMAL(8,2) NOT NULL DEFAULT 0,
  "additional_duty_rate_pct" DECIMAL(8,2) NOT NULL DEFAULT 0,
  "regulatory_duty_rate_pct" DECIMAL(8,2) NOT NULL DEFAULT 0,
  "sales_tax_rate_pct" DECIMAL(8,2) NOT NULL DEFAULT 0,
  "effective_from" TIMESTAMP(3),
  "effective_to" TIMESTAMP(3),
  "status" TEXT NOT NULL DEFAULT 'Active',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "import_hs_tariff_rates_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "import_hs_tariff_rates_hs_code_idx" ON "import_hs_tariff_rates"("hs_code");
CREATE INDEX IF NOT EXISTS "import_hs_tariff_rates_company_id_idx" ON "import_hs_tariff_rates"("company_id");

-- Clearance lines
CREATE TABLE IF NOT EXISTS "import_customs_clearance_lines" (
  "id" TEXT NOT NULL,
  "clearance_id" TEXT NOT NULL,
  "shipment_item_id" TEXT,
  "import_po_item_id" TEXT,
  "product_id" TEXT,
  "product_name" TEXT NOT NULL,
  "sku" TEXT,
  "hs_code" TEXT NOT NULL,
  "quantity" DECIMAL(18,4) NOT NULL DEFAULT 0,
  "uom" TEXT NOT NULL DEFAULT 'PCS',
  "assessable_value_base" DECIMAL(18,4) NOT NULL DEFAULT 0,
  "duty_rate_pct" DECIMAL(8,2) NOT NULL DEFAULT 0,
  "duty_amount_base" DECIMAL(18,4) NOT NULL DEFAULT 0,
  "additional_duty_rate_pct" DECIMAL(8,2) NOT NULL DEFAULT 0,
  "additional_duty_base" DECIMAL(18,4) NOT NULL DEFAULT 0,
  "regulatory_duty_rate_pct" DECIMAL(8,2) NOT NULL DEFAULT 0,
  "regulatory_duty_base" DECIMAL(18,4) NOT NULL DEFAULT 0,
  "vat_rate_pct" DECIMAL(8,2) NOT NULL DEFAULT 0,
  "vat_amount_base" DECIMAL(18,4) NOT NULL DEFAULT 0,
  "rate_override" BOOLEAN NOT NULL DEFAULT false,
  "override_reason" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "import_customs_clearance_lines_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "import_customs_clearance_lines_clearance_id_idx"
  ON "import_customs_clearance_lines"("clearance_id");

DO $$ BEGIN
  ALTER TABLE "import_customs_clearance_lines"
    ADD CONSTRAINT "import_customs_clearance_lines_clearance_id_fkey"
    FOREIGN KEY ("clearance_id") REFERENCES "import_customs_clearances"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Seed common HS tariffs (global / company_id null). 940542 used by observed BOE.
INSERT INTO "import_hs_tariff_rates" (
  "id", "company_id", "hs_code", "description", "country_code",
  "duty_rate_pct", "additional_duty_rate_pct", "regulatory_duty_rate_pct", "sales_tax_rate_pct", "status"
)
SELECT v.id, NULL, v.hs, v.descr, 'PK', v.duty, v.addd, v.rd, v.st, 'Active'
FROM (VALUES
  ('tariff-global-940542', '940542', 'LED lamps / luminaires', 10::numeric, 0::numeric, 0::numeric, 5::numeric),
  ('tariff-global-847130', '847130', 'Portable automatic data processing machines', 5::numeric, 0::numeric, 0::numeric, 5::numeric),
  ('tariff-global-851712', '851712', 'Telephones for cellular networks', 15::numeric, 0::numeric, 0::numeric, 5::numeric),
  ('tariff-global-870323', '870323', 'Motor cars 1500-3000cc', 20::numeric, 0::numeric, 0::numeric, 5::numeric),
  ('tariff-global-300490', '300490', 'Medicaments', 5::numeric, 0::numeric, 0::numeric, 5::numeric),
  ('tariff-global-390110', '390110', 'Polyethylene', 10::numeric, 0::numeric, 0::numeric, 5::numeric),
  ('tariff-global-720851', '720851', 'Flat-rolled iron/steel', 10::numeric, 0::numeric, 0::numeric, 5::numeric),
  ('tariff-global-854140', '854140', 'Photosensitive semiconductor devices / LEDs', 10::numeric, 0::numeric, 0::numeric, 5::numeric)
) AS v(id, hs, descr, duty, addd, rd, st)
WHERE NOT EXISTS (
  SELECT 1 FROM "import_hs_tariff_rates" t WHERE t."hs_code" = v.hs AND t."company_id" IS NULL
);

-- Flag existing clearances whose FX rate differs from linked PO (review only; no recalculation)
UPDATE "import_customs_clearances" c
SET
  "fx_review_flag" = true,
  "fx_review_note" = CONCAT(
    'Stored customs rate ',
    COALESCE(c."exchange_rate_to_usd"::text, '?'),
    ' differs from PO rate ',
    COALESCE(po."exchange_rate_to_usd"::text, '?'),
    ' or currency ',
    COALESCE(c."declaration_currency", '?'),
    '/',
    COALESCE(po."currency", '?')
  )
FROM "import_purchase_orders" po
WHERE c."import_po_id" = po."id"
  AND (
    ABS(COALESCE(c."exchange_rate_to_usd", 0) - COALESCE(po."exchange_rate_to_usd", 0)) > 0.0001
    OR UPPER(COALESCE(c."declaration_currency", '')) <> UPPER(COALESCE(po."currency", ''))
  );

-- Normalize legacy statuses toward new workflow labels where safe
UPDATE "import_customs_clearances"
SET "clearance_status" = 'Released/Cleared'
WHERE "clearance_status" IN ('Cleared', 'Released', 'Out of Charge');
