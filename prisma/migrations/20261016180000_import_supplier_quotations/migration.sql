-- Multi-supplier quotations for Import RFQs
ALTER TABLE "import_rfqs"
  ADD COLUMN IF NOT EXISTS "quotation_deadline" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "selected_quotation_id" TEXT;

CREATE TABLE IF NOT EXISTS "import_supplier_quotations" (
  "id" TEXT NOT NULL,
  "company_id" TEXT NOT NULL,
  "rfq_id" TEXT NOT NULL,
  "quotation_number" TEXT NOT NULL,
  "supplier_id" TEXT,
  "supplier_name" TEXT NOT NULL,
  "supplier_country" TEXT,
  "quotation_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "valid_until" TIMESTAMP(3),
  "currency" TEXT NOT NULL DEFAULT 'USD',
  "exchange_rate_to_usd" DECIMAL(18,8) NOT NULL DEFAULT 1,
  "incoterm" TEXT NOT NULL DEFAULT 'CIF',
  "payment_terms" TEXT,
  "lead_time_days" INTEGER NOT NULL DEFAULT 0,
  "freight_estimate_usd" DECIMAL(18,4) NOT NULL DEFAULT 0,
  "total_foreign" DECIMAL(18,4) NOT NULL DEFAULT 0,
  "total_usd" DECIMAL(18,4) NOT NULL DEFAULT 0,
  "estimated_landed_usd" DECIMAL(18,4) NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'Received',
  "notes" TEXT,
  "negotiation_history" JSONB,
  "created_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "import_supplier_quotations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "import_supplier_quotation_items" (
  "id" TEXT NOT NULL,
  "quotation_id" TEXT NOT NULL,
  "product_id" TEXT,
  "product_name" TEXT NOT NULL,
  "sku" TEXT,
  "quantity" DECIMAL(18,4) NOT NULL DEFAULT 1,
  "uom" TEXT NOT NULL DEFAULT 'PCS',
  "unit_price" DECIMAL(18,4) NOT NULL DEFAULT 0,
  "line_total" DECIMAL(18,4) NOT NULL DEFAULT 0,
  "moq" DECIMAL(18,4) NOT NULL DEFAULT 0,
  "lead_time_days" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "import_supplier_quotation_items_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "import_supplier_quotations_company_id_quotation_number_key"
  ON "import_supplier_quotations"("company_id", "quotation_number");
CREATE INDEX IF NOT EXISTS "import_supplier_quotations_company_id_status_idx"
  ON "import_supplier_quotations"("company_id", "status");
CREATE INDEX IF NOT EXISTS "import_supplier_quotations_rfq_id_idx"
  ON "import_supplier_quotations"("rfq_id");
CREATE INDEX IF NOT EXISTS "import_supplier_quotations_supplier_id_idx"
  ON "import_supplier_quotations"("supplier_id");
CREATE INDEX IF NOT EXISTS "import_supplier_quotation_items_quotation_id_idx"
  ON "import_supplier_quotation_items"("quotation_id");
CREATE INDEX IF NOT EXISTS "import_supplier_quotation_items_product_id_idx"
  ON "import_supplier_quotation_items"("product_id");

DO $$ BEGIN
  ALTER TABLE "import_supplier_quotations"
    ADD CONSTRAINT "import_supplier_quotations_company_id_fkey"
    FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "import_supplier_quotations"
    ADD CONSTRAINT "import_supplier_quotations_rfq_id_fkey"
    FOREIGN KEY ("rfq_id") REFERENCES "import_rfqs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "import_supplier_quotations"
    ADD CONSTRAINT "import_supplier_quotations_supplier_id_fkey"
    FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "import_supplier_quotation_items"
    ADD CONSTRAINT "import_supplier_quotation_items_quotation_id_fkey"
    FOREIGN KEY ("quotation_id") REFERENCES "import_supplier_quotations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "import_supplier_quotation_items"
    ADD CONSTRAINT "import_supplier_quotation_items_product_id_fkey"
    FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
