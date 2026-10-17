-- Import enterprise lifecycle: proforma lines, bill lines, FX/trade fields, posting refs.
-- Additive only — does not alter or delete existing Import GRN / PO inventory postings.

-- ── Proforma Invoice header enhancements ────────────────────────────────────
ALTER TABLE "import_proforma_invoices"
  ADD COLUMN IF NOT EXISTS "supplier_id" TEXT,
  ADD COLUMN IF NOT EXISTS "supplier_contact" TEXT,
  ADD COLUMN IF NOT EXISTS "supplier_email" TEXT,
  ADD COLUMN IF NOT EXISTS "supplier_address" TEXT,
  ADD COLUMN IF NOT EXISTS "supplier_tax_id" TEXT,
  ADD COLUMN IF NOT EXISTS "supplier_reference" TEXT,
  ADD COLUMN IF NOT EXISTS "quotation_id" TEXT,
  ADD COLUMN IF NOT EXISTS "rfq_ref" TEXT,
  ADD COLUMN IF NOT EXISTS "expected_payment_date" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "prepared_by" TEXT,
  ADD COLUMN IF NOT EXISTS "approved_by" TEXT,
  ADD COLUMN IF NOT EXISTS "approved_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "rejected_reason" TEXT,
  ADD COLUMN IF NOT EXISTS "origin_country" TEXT,
  ADD COLUMN IF NOT EXISTS "country_of_export" TEXT,
  ADD COLUMN IF NOT EXISTS "port_of_loading" TEXT,
  ADD COLUMN IF NOT EXISTS "port_of_discharge" TEXT,
  ADD COLUMN IF NOT EXISTS "port_of_entry" TEXT,
  ADD COLUMN IF NOT EXISTS "destination" TEXT,
  ADD COLUMN IF NOT EXISTS "incoterm" TEXT DEFAULT 'CIF',
  ADD COLUMN IF NOT EXISTS "named_place" TEXT,
  ADD COLUMN IF NOT EXISTS "shipment_mode" TEXT,
  ADD COLUMN IF NOT EXISTS "expected_shipment_date" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "estimated_arrival" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "payment_terms" TEXT,
  ADD COLUMN IF NOT EXISTS "credit_days" INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "balance_payment_terms" TEXT,
  ADD COLUMN IF NOT EXISTS "exchange_rate_to_usd" DECIMAL(18,8) DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "exchange_rate_date" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "rate_source" TEXT,
  ADD COLUMN IF NOT EXISTS "base_currency_code" TEXT,
  ADD COLUMN IF NOT EXISTS "merchandise_subtotal" DECIMAL(18,4) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "discount_total" DECIMAL(18,4) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "tax_total" DECIMAL(18,4) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "freight_estimate" DECIMAL(18,4) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "insurance_estimate" DECIMAL(18,4) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "other_charges_estimate" DECIMAL(18,4) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "customs_duty_estimate" DECIMAL(18,4) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "payment_schedule" JSONB,
  ADD COLUMN IF NOT EXISTS "terms_and_conditions" TEXT,
  ADD COLUMN IF NOT EXISTS "internal_remarks" TEXT;

CREATE INDEX IF NOT EXISTS "import_proforma_invoices_supplier_id_idx"
  ON "import_proforma_invoices"("supplier_id");

-- ── Proforma line items ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "import_proforma_invoice_items" (
  "id" TEXT NOT NULL,
  "proforma_id" TEXT NOT NULL,
  "import_po_item_id" TEXT,
  "product_id" TEXT,
  "product_name" TEXT NOT NULL,
  "sku" TEXT,
  "supplier_item_code" TEXT,
  "description" TEXT,
  "quantity" DECIMAL(18,4) NOT NULL DEFAULT 1,
  "uom" TEXT NOT NULL DEFAULT 'PCS',
  "unit_price" DECIMAL(18,4) NOT NULL DEFAULT 0,
  "discount_percent" DECIMAL(8,2) NOT NULL DEFAULT 0,
  "discount_amount" DECIMAL(18,4) NOT NULL DEFAULT 0,
  "tax_amount" DECIMAL(18,4) NOT NULL DEFAULT 0,
  "line_total" DECIMAL(18,4) NOT NULL DEFAULT 0,
  "hs_code" TEXT,
  "country_of_origin" TEXT,
  "net_weight_kg" DECIMAL(18,4) NOT NULL DEFAULT 0,
  "gross_weight_kg" DECIMAL(18,4) NOT NULL DEFAULT 0,
  "notes" TEXT,
  CONSTRAINT "import_proforma_invoice_items_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "import_proforma_invoice_items_proforma_id_idx"
  ON "import_proforma_invoice_items"("proforma_id");
CREATE INDEX IF NOT EXISTS "import_proforma_invoice_items_product_id_idx"
  ON "import_proforma_invoice_items"("product_id");

DO $$ BEGIN
  ALTER TABLE "import_proforma_invoice_items"
    ADD CONSTRAINT "import_proforma_invoice_items_proforma_id_fkey"
    FOREIGN KEY ("proforma_id") REFERENCES "import_proforma_invoices"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "import_proforma_invoice_items"
    ADD CONSTRAINT "import_proforma_invoice_items_product_id_fkey"
    FOREIGN KEY ("product_id") REFERENCES "products"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── Supplier bill enhancements ──────────────────────────────────────────────
ALTER TABLE "import_supplier_bills"
  ADD COLUMN IF NOT EXISTS "supplier_id" TEXT,
  ADD COLUMN IF NOT EXISTS "supplier_invoice_number" TEXT,
  ADD COLUMN IF NOT EXISTS "exchange_rate_to_usd" DECIMAL(18,8) DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "exchange_rate_date" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "rate_source" TEXT,
  ADD COLUMN IF NOT EXISTS "base_currency_code" TEXT,
  ADD COLUMN IF NOT EXISTS "import_grn_id" TEXT,
  ADD COLUMN IF NOT EXISTS "shipment_id" TEXT,
  ADD COLUMN IF NOT EXISTS "proforma_id" TEXT,
  ADD COLUMN IF NOT EXISTS "freight_amount" DECIMAL(18,4) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "insurance_amount" DECIMAL(18,4) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "duty_amount" DECIMAL(18,4) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "other_charges" DECIMAL(18,4) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "tax_total" DECIMAL(18,4) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "discount_total" DECIMAL(18,4) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "variance_amount" DECIMAL(18,4) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "variance_percent" DECIMAL(8,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "match_status" TEXT DEFAULT 'UNMATCHED',
  ADD COLUMN IF NOT EXISTS "match_tolerance_pct" DECIMAL(8,2) DEFAULT 2,
  ADD COLUMN IF NOT EXISTS "idempotency_key" TEXT,
  ADD COLUMN IF NOT EXISTS "journal_entry_id" TEXT,
  ADD COLUMN IF NOT EXISTS "posted_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "notes" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "import_supplier_bills_company_idempotency_key_key"
  ON "import_supplier_bills"("company_id", "idempotency_key")
  WHERE "idempotency_key" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "import_supplier_bills_company_supplier_invoice_key"
  ON "import_supplier_bills"("company_id", "supplier_id", "supplier_invoice_number")
  WHERE "supplier_invoice_number" IS NOT NULL AND "supplier_id" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "import_supplier_bills_import_grn_id_idx"
  ON "import_supplier_bills"("import_grn_id");

CREATE TABLE IF NOT EXISTS "import_supplier_bill_items" (
  "id" TEXT NOT NULL,
  "bill_id" TEXT NOT NULL,
  "import_po_item_id" TEXT,
  "import_grn_item_id" TEXT,
  "product_id" TEXT,
  "product_name" TEXT NOT NULL,
  "sku" TEXT,
  "ordered_qty" DECIMAL(18,4) NOT NULL DEFAULT 0,
  "received_qty" DECIMAL(18,4) NOT NULL DEFAULT 0,
  "accepted_qty" DECIMAL(18,4) NOT NULL DEFAULT 0,
  "rejected_qty" DECIMAL(18,4) NOT NULL DEFAULT 0,
  "invoiced_qty" DECIMAL(18,4) NOT NULL DEFAULT 0,
  "uom" TEXT NOT NULL DEFAULT 'PCS',
  "unit_price" DECIMAL(18,4) NOT NULL DEFAULT 0,
  "discount_percent" DECIMAL(8,2) NOT NULL DEFAULT 0,
  "tax_rate" DECIMAL(8,2) NOT NULL DEFAULT 0,
  "tax_amount" DECIMAL(18,4) NOT NULL DEFAULT 0,
  "line_total" DECIMAL(18,4) NOT NULL DEFAULT 0,
  "hs_code" TEXT,
  "notes" TEXT,
  CONSTRAINT "import_supplier_bill_items_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "import_supplier_bill_items_bill_id_idx"
  ON "import_supplier_bill_items"("bill_id");
CREATE INDEX IF NOT EXISTS "import_supplier_bill_items_product_id_idx"
  ON "import_supplier_bill_items"("product_id");

DO $$ BEGIN
  ALTER TABLE "import_supplier_bill_items"
    ADD CONSTRAINT "import_supplier_bill_items_bill_id_fkey"
    FOREIGN KEY ("bill_id") REFERENCES "import_supplier_bills"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "import_supplier_bill_items"
    ADD CONSTRAINT "import_supplier_bill_items_product_id_fkey"
    FOREIGN KEY ("product_id") REFERENCES "products"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── Customs enhancements ────────────────────────────────────────────────────
ALTER TABLE "import_customs_clearances"
  ADD COLUMN IF NOT EXISTS "import_vat_rate_pct" DECIMAL(8,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "declaration_currency" TEXT DEFAULT 'USD',
  ADD COLUMN IF NOT EXISTS "exchange_rate_to_usd" DECIMAL(18,8) DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "exchange_rate_date" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "hs_codes" JSONB,
  ADD COLUMN IF NOT EXISTS "release_date" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "hold_reason" TEXT,
  ADD COLUMN IF NOT EXISTS "discrepancy_notes" TEXT,
  ADD COLUMN IF NOT EXISTS "broker_contact" TEXT,
  ADD COLUMN IF NOT EXISTS "penalties_usd" DECIMAL(18,4) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "exemptions_notes" TEXT,
  ADD COLUMN IF NOT EXISTS "landed_cost_id" TEXT,
  ADD COLUMN IF NOT EXISTS "idempotency_key" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "import_customs_clearances_company_shipment_unique"
  ON "import_customs_clearances"("company_id", "shipment_id")
  WHERE "shipment_id" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "import_customs_clearances_company_idempotency_key_key"
  ON "import_customs_clearances"("company_id", "idempotency_key")
  WHERE "idempotency_key" IS NOT NULL;

-- ── LC enhancements ─────────────────────────────────────────────────────────
ALTER TABLE "import_finance_lcs"
  ADD COLUMN IF NOT EXISTS "proforma_id" TEXT,
  ADD COLUMN IF NOT EXISTS "shipment_id" TEXT,
  ADD COLUMN IF NOT EXISTS "payment_tenor" TEXT,
  ADD COLUMN IF NOT EXISTS "usance_days" INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "document_presentation_date" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "discrepancy_notes" TEXT,
  ADD COLUMN IF NOT EXISTS "settlement_date" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "settlement_payment_id" TEXT,
  ADD COLUMN IF NOT EXISTS "margin_journal_entry_id" TEXT,
  ADD COLUMN IF NOT EXISTS "amendments" JSONB,
  ADD COLUMN IF NOT EXISTS "exchange_rate_to_usd" DECIMAL(18,8) DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "exchange_rate_date" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "base_currency_code" TEXT,
  ADD COLUMN IF NOT EXISTS "lc_amount_base" DECIMAL(18,4) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "notes" TEXT;

-- ── Landed cost reverse + source ───────────────────────────────────────────
ALTER TABLE "import_landed_costs"
  ADD COLUMN IF NOT EXISTS "customs_clearance_id" TEXT,
  ADD COLUMN IF NOT EXISTS "reversed_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "reversal_journal_entry_id" TEXT,
  ADD COLUMN IF NOT EXISTS "idempotency_key" TEXT,
  ADD COLUMN IF NOT EXISTS "notes" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "import_landed_costs_company_idempotency_key_key"
  ON "import_landed_costs"("company_id", "idempotency_key")
  WHERE "idempotency_key" IS NOT NULL;

-- ── Document verification ───────────────────────────────────────────────────
ALTER TABLE "import_documents"
  ADD COLUMN IF NOT EXISTS "verified_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "verified_by" TEXT,
  ADD COLUMN IF NOT EXISTS "notes" TEXT;
