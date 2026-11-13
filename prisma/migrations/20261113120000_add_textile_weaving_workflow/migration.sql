-- Textile Weaving Workflow (TEXTILE_WEAVING): feature flag + Yadgar domain tables
-- Isolated from STANDARD Manufacturing* and P0 sandbox posting.

ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "manufacturing_workflow" TEXT NOT NULL DEFAULT 'STANDARD';
CREATE INDEX IF NOT EXISTS "companies_manufacturing_workflow_idx" ON "companies"("manufacturing_workflow");

ALTER TABLE "textile_beams" ADD COLUMN IF NOT EXISTS "weaving_status" TEXT;
ALTER TABLE "textile_beams" ADD COLUMN IF NOT EXISTS "beam_number" TEXT;
ALTER TABLE "textile_beams" ADD COLUMN IF NOT EXISTS "current_loom_id" TEXT;

CREATE INDEX IF NOT EXISTS "textile_beams_weaving_status_idx" ON "textile_beams"("weaving_status");
CREATE INDEX IF NOT EXISTS "textile_beams_beam_number_idx" ON "textile_beams"("beam_number");
CREATE INDEX IF NOT EXISTS "textile_beams_current_loom_id_idx" ON "textile_beams"("current_loom_id");

CREATE TABLE IF NOT EXISTS "textile_yarn_stocks" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "article_count" TEXT NOT NULL,
    "brand" TEXT NOT NULL DEFAULT '',
    "lot_number" TEXT NOT NULL,
    "kg_per_carton" DECIMAL(12,4) NOT NULL DEFAULT 32,
    "balance_cartons" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "balance_weight_kg" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "warehouse_id" TEXT,
    "product_id" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "created_by" TEXT NOT NULL,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "textile_yarn_stocks_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "textile_godown_ledgers" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "yarn_stock_id" TEXT,
    "entry_date" TIMESTAMP(3) NOT NULL,
    "challan_prefix" TEXT NOT NULL,
    "challan_number" TEXT NOT NULL,
    "party_name" TEXT,
    "supplier_id" TEXT,
    "article_count" TEXT NOT NULL,
    "brand" TEXT NOT NULL DEFAULT '',
    "lot_number" TEXT NOT NULL,
    "kg_per_carton" DECIMAL(12,4),
    "in_cartons" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "in_weight_kg" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "out_cartons" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "out_weight_kg" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "balance_cartons" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "balance_weight_kg" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "warehouse_id" TEXT,
    "twisting_batch_id" TEXT,
    "remarks" TEXT,
    "created_by" TEXT NOT NULL,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "textile_godown_ledgers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "textile_twisting_batches" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "batch_number" TEXT NOT NULL,
    "issue_date" TIMESTAMP(3) NOT NULL,
    "machine_code" TEXT,
    "vendor_id" TEXT,
    "vendor_name" TEXT,
    "input_article_count" TEXT NOT NULL,
    "input_brand" TEXT NOT NULL DEFAULT '',
    "input_lot_number" TEXT NOT NULL,
    "yarn_stock_id" TEXT,
    "issued_cartons" DECIMAL(14,4) NOT NULL,
    "issued_standard_kg" DECIMAL(14,4) NOT NULL,
    "kg_per_carton" DECIMAL(12,4) NOT NULL DEFAULT 32,
    "total_received_net_kg" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "wastage_kg" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "wastage_percent" DECIMAL(8,4) NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'ISSUED',
    "notes" TEXT,
    "created_by" TEXT NOT NULL,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "textile_twisting_batches_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "textile_twisting_receipts" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "batch_id" TEXT NOT NULL,
    "receipt_date" TIMESTAMP(3) NOT NULL,
    "output_article_count" TEXT NOT NULL,
    "output_brand" TEXT NOT NULL DEFAULT '',
    "output_lot_number" TEXT,
    "cartons" DECIMAL(14,4) NOT NULL,
    "cones_count" INTEGER NOT NULL,
    "actual_net_weight_kg" DECIMAL(14,4) NOT NULL,
    "twist_direction" TEXT NOT NULL,
    "bill_number" TEXT,
    "wastage_kg" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "wastage_percent" DECIMAL(8,4) NOT NULL DEFAULT 0,
    "output_yarn_stock_id" TEXT,
    "remarks" TEXT,
    "created_by" TEXT NOT NULL,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "textile_twisting_receipts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "textile_weft_issues" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "issue_date" TIMESTAMP(3) NOT NULL,
    "challan_number" TEXT NOT NULL,
    "yarn_stock_id" TEXT,
    "article_count" TEXT NOT NULL,
    "brand" TEXT NOT NULL DEFAULT '',
    "lot_number" TEXT NOT NULL,
    "twist_direction" TEXT,
    "issued_cartons" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "issued_cones" INTEGER NOT NULL DEFAULT 0,
    "issued_net_weight_kg" DECIMAL(14,4) NOT NULL,
    "loom_id" TEXT,
    "section" TEXT,
    "remarks" TEXT,
    "created_by" TEXT NOT NULL,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "textile_weft_issues_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "textile_warping_sets" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "beam_id" TEXT NOT NULL,
    "set_number" TEXT NOT NULL,
    "beam_number" TEXT NOT NULL,
    "machine_code" TEXT,
    "warping_date" TIMESTAMP(3) NOT NULL,
    "ends_count" INTEGER NOT NULL,
    "length_meters" DECIMAL(14,4) NOT NULL,
    "reed_width" DECIMAL(10,2),
    "net_beam_weight_kg" DECIMAL(14,4) NOT NULL,
    "cones_consumed_s_kg" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "cones_consumed_z_kg" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "total_yarn_consumed_kg" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "warping_wastage_kg" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "created_by" TEXT NOT NULL,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "textile_warping_sets_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "textile_looms" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "loom_number" TEXT NOT NULL,
    "section" TEXT,
    "status" TEXT NOT NULL DEFAULT 'IDLE',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "created_by" TEXT NOT NULL,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "textile_looms_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "textile_loom_beam_allocations" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "loom_id" TEXT NOT NULL,
    "beam_id" TEXT NOT NULL,
    "allocated_at" TIMESTAMP(3) NOT NULL,
    "completed_at" TIMESTAMP(3),
    "weaver_name" TEXT,
    "wage_rate" DECIMAL(12,2),
    "bonus_amount" DECIMAL(12,2),
    "total_beam_length_meters" DECIMAL(14,4) NOT NULL,
    "remaining_length_meters" DECIMAL(14,4) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "created_by" TEXT NOT NULL,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "textile_loom_beam_allocations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "textile_daily_loom_productions" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "loom_id" TEXT NOT NULL,
    "production_date" DATE NOT NULL,
    "allocation_id" TEXT,
    "shift_a_meters" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "shift_b_meters" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "daily_total_meters" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "cumulative_beam_meters" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "grade_a_meters" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "grade_b_meters" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "grade_c_meters" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "remarks" TEXT,
    "created_by" TEXT NOT NULL,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "textile_daily_loom_productions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "textile_yarn_stocks_company_id_idx" ON "textile_yarn_stocks"("company_id");
CREATE INDEX IF NOT EXISTS "textile_yarn_stocks_company_id_lot_number_idx" ON "textile_yarn_stocks"("company_id", "lot_number");
CREATE INDEX IF NOT EXISTS "textile_yarn_stocks_company_id_article_count_idx" ON "textile_yarn_stocks"("company_id", "article_count");
CREATE INDEX IF NOT EXISTS "textile_yarn_stocks_warehouse_id_idx" ON "textile_yarn_stocks"("warehouse_id");
CREATE INDEX IF NOT EXISTS "textile_yarn_stocks_product_id_idx" ON "textile_yarn_stocks"("product_id");
CREATE UNIQUE INDEX IF NOT EXISTS "textile_yarn_stocks_company_id_article_count_brand_lot_numb_key" ON "textile_yarn_stocks"("company_id", "article_count", "brand", "lot_number", "warehouse_id");

CREATE INDEX IF NOT EXISTS "textile_godown_ledgers_company_id_entry_date_idx" ON "textile_godown_ledgers"("company_id", "entry_date");
CREATE INDEX IF NOT EXISTS "textile_godown_ledgers_company_id_lot_number_idx" ON "textile_godown_ledgers"("company_id", "lot_number");
CREATE INDEX IF NOT EXISTS "textile_godown_ledgers_yarn_stock_id_idx" ON "textile_godown_ledgers"("yarn_stock_id");
CREATE INDEX IF NOT EXISTS "textile_godown_ledgers_twisting_batch_id_idx" ON "textile_godown_ledgers"("twisting_batch_id");
CREATE INDEX IF NOT EXISTS "textile_godown_ledgers_supplier_id_idx" ON "textile_godown_ledgers"("supplier_id");
CREATE INDEX IF NOT EXISTS "textile_godown_ledgers_warehouse_id_idx" ON "textile_godown_ledgers"("warehouse_id");
CREATE UNIQUE INDEX IF NOT EXISTS "textile_godown_ledgers_company_id_challan_prefix_challan_nu_key" ON "textile_godown_ledgers"("company_id", "challan_prefix", "challan_number");

CREATE INDEX IF NOT EXISTS "textile_twisting_batches_company_id_status_idx" ON "textile_twisting_batches"("company_id", "status");
CREATE INDEX IF NOT EXISTS "textile_twisting_batches_yarn_stock_id_idx" ON "textile_twisting_batches"("yarn_stock_id");
CREATE INDEX IF NOT EXISTS "textile_twisting_batches_vendor_id_idx" ON "textile_twisting_batches"("vendor_id");
CREATE INDEX IF NOT EXISTS "textile_twisting_batches_issue_date_idx" ON "textile_twisting_batches"("issue_date");
CREATE UNIQUE INDEX IF NOT EXISTS "textile_twisting_batches_company_id_batch_number_key" ON "textile_twisting_batches"("company_id", "batch_number");

CREATE INDEX IF NOT EXISTS "textile_twisting_receipts_company_id_idx" ON "textile_twisting_receipts"("company_id");
CREATE INDEX IF NOT EXISTS "textile_twisting_receipts_batch_id_idx" ON "textile_twisting_receipts"("batch_id");
CREATE INDEX IF NOT EXISTS "textile_twisting_receipts_twist_direction_idx" ON "textile_twisting_receipts"("twist_direction");
CREATE INDEX IF NOT EXISTS "textile_twisting_receipts_output_yarn_stock_id_idx" ON "textile_twisting_receipts"("output_yarn_stock_id");
CREATE INDEX IF NOT EXISTS "textile_twisting_receipts_receipt_date_idx" ON "textile_twisting_receipts"("receipt_date");

CREATE INDEX IF NOT EXISTS "textile_weft_issues_company_id_issue_date_idx" ON "textile_weft_issues"("company_id", "issue_date");
CREATE INDEX IF NOT EXISTS "textile_weft_issues_yarn_stock_id_idx" ON "textile_weft_issues"("yarn_stock_id");
CREATE INDEX IF NOT EXISTS "textile_weft_issues_loom_id_idx" ON "textile_weft_issues"("loom_id");
CREATE INDEX IF NOT EXISTS "textile_weft_issues_lot_number_idx" ON "textile_weft_issues"("lot_number");
CREATE UNIQUE INDEX IF NOT EXISTS "textile_weft_issues_company_id_challan_number_key" ON "textile_weft_issues"("company_id", "challan_number");

CREATE INDEX IF NOT EXISTS "textile_warping_sets_company_id_beam_id_idx" ON "textile_warping_sets"("company_id", "beam_id");
CREATE INDEX IF NOT EXISTS "textile_warping_sets_warping_date_idx" ON "textile_warping_sets"("warping_date");
CREATE UNIQUE INDEX IF NOT EXISTS "textile_warping_sets_company_id_set_number_key" ON "textile_warping_sets"("company_id", "set_number");

CREATE INDEX IF NOT EXISTS "textile_looms_company_id_section_idx" ON "textile_looms"("company_id", "section");
CREATE INDEX IF NOT EXISTS "textile_looms_status_idx" ON "textile_looms"("status");
CREATE UNIQUE INDEX IF NOT EXISTS "textile_looms_company_id_loom_number_key" ON "textile_looms"("company_id", "loom_number");

CREATE INDEX IF NOT EXISTS "textile_loom_beam_allocations_company_id_loom_id_status_idx" ON "textile_loom_beam_allocations"("company_id", "loom_id", "status");
CREATE INDEX IF NOT EXISTS "textile_loom_beam_allocations_beam_id_idx" ON "textile_loom_beam_allocations"("beam_id");
CREATE INDEX IF NOT EXISTS "textile_loom_beam_allocations_allocated_at_idx" ON "textile_loom_beam_allocations"("allocated_at");

CREATE INDEX IF NOT EXISTS "textile_daily_loom_productions_company_id_production_date_idx" ON "textile_daily_loom_productions"("company_id", "production_date");
CREATE INDEX IF NOT EXISTS "textile_daily_loom_productions_allocation_id_idx" ON "textile_daily_loom_productions"("allocation_id");
CREATE UNIQUE INDEX IF NOT EXISTS "textile_daily_loom_productions_company_id_loom_id_productio_key" ON "textile_daily_loom_productions"("company_id", "loom_id", "production_date");

-- Foreign keys (idempotent)
DO $$ BEGIN
  ALTER TABLE "textile_beams"
    ADD CONSTRAINT "textile_beams_current_loom_id_fkey"
    FOREIGN KEY ("current_loom_id") REFERENCES "textile_looms"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "textile_yarn_stocks"
    ADD CONSTRAINT "textile_yarn_stocks_company_id_fkey"
    FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "textile_yarn_stocks"
    ADD CONSTRAINT "textile_yarn_stocks_warehouse_id_fkey"
    FOREIGN KEY ("warehouse_id") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "textile_yarn_stocks"
    ADD CONSTRAINT "textile_yarn_stocks_product_id_fkey"
    FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "textile_yarn_stocks"
    ADD CONSTRAINT "textile_yarn_stocks_created_by_fkey"
    FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "textile_yarn_stocks"
    ADD CONSTRAINT "textile_yarn_stocks_updated_by_fkey"
    FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "textile_godown_ledgers"
    ADD CONSTRAINT "textile_godown_ledgers_company_id_fkey"
    FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "textile_godown_ledgers"
    ADD CONSTRAINT "textile_godown_ledgers_yarn_stock_id_fkey"
    FOREIGN KEY ("yarn_stock_id") REFERENCES "textile_yarn_stocks"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "textile_godown_ledgers"
    ADD CONSTRAINT "textile_godown_ledgers_supplier_id_fkey"
    FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "textile_godown_ledgers"
    ADD CONSTRAINT "textile_godown_ledgers_warehouse_id_fkey"
    FOREIGN KEY ("warehouse_id") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "textile_godown_ledgers"
    ADD CONSTRAINT "textile_godown_ledgers_twisting_batch_id_fkey"
    FOREIGN KEY ("twisting_batch_id") REFERENCES "textile_twisting_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "textile_godown_ledgers"
    ADD CONSTRAINT "textile_godown_ledgers_created_by_fkey"
    FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "textile_godown_ledgers"
    ADD CONSTRAINT "textile_godown_ledgers_updated_by_fkey"
    FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "textile_twisting_batches"
    ADD CONSTRAINT "textile_twisting_batches_company_id_fkey"
    FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "textile_twisting_batches"
    ADD CONSTRAINT "textile_twisting_batches_vendor_id_fkey"
    FOREIGN KEY ("vendor_id") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "textile_twisting_batches"
    ADD CONSTRAINT "textile_twisting_batches_yarn_stock_id_fkey"
    FOREIGN KEY ("yarn_stock_id") REFERENCES "textile_yarn_stocks"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "textile_twisting_batches"
    ADD CONSTRAINT "textile_twisting_batches_created_by_fkey"
    FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "textile_twisting_batches"
    ADD CONSTRAINT "textile_twisting_batches_updated_by_fkey"
    FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "textile_twisting_receipts"
    ADD CONSTRAINT "textile_twisting_receipts_company_id_fkey"
    FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "textile_twisting_receipts"
    ADD CONSTRAINT "textile_twisting_receipts_batch_id_fkey"
    FOREIGN KEY ("batch_id") REFERENCES "textile_twisting_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "textile_twisting_receipts"
    ADD CONSTRAINT "textile_twisting_receipts_output_yarn_stock_id_fkey"
    FOREIGN KEY ("output_yarn_stock_id") REFERENCES "textile_yarn_stocks"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "textile_twisting_receipts"
    ADD CONSTRAINT "textile_twisting_receipts_created_by_fkey"
    FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "textile_twisting_receipts"
    ADD CONSTRAINT "textile_twisting_receipts_updated_by_fkey"
    FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "textile_weft_issues"
    ADD CONSTRAINT "textile_weft_issues_company_id_fkey"
    FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "textile_weft_issues"
    ADD CONSTRAINT "textile_weft_issues_yarn_stock_id_fkey"
    FOREIGN KEY ("yarn_stock_id") REFERENCES "textile_yarn_stocks"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "textile_weft_issues"
    ADD CONSTRAINT "textile_weft_issues_loom_id_fkey"
    FOREIGN KEY ("loom_id") REFERENCES "textile_looms"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "textile_weft_issues"
    ADD CONSTRAINT "textile_weft_issues_created_by_fkey"
    FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "textile_weft_issues"
    ADD CONSTRAINT "textile_weft_issues_updated_by_fkey"
    FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "textile_warping_sets"
    ADD CONSTRAINT "textile_warping_sets_company_id_fkey"
    FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "textile_warping_sets"
    ADD CONSTRAINT "textile_warping_sets_beam_id_fkey"
    FOREIGN KEY ("beam_id") REFERENCES "textile_beams"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "textile_warping_sets"
    ADD CONSTRAINT "textile_warping_sets_created_by_fkey"
    FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "textile_warping_sets"
    ADD CONSTRAINT "textile_warping_sets_updated_by_fkey"
    FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "textile_looms"
    ADD CONSTRAINT "textile_looms_company_id_fkey"
    FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "textile_looms"
    ADD CONSTRAINT "textile_looms_created_by_fkey"
    FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "textile_looms"
    ADD CONSTRAINT "textile_looms_updated_by_fkey"
    FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "textile_loom_beam_allocations"
    ADD CONSTRAINT "textile_loom_beam_allocations_company_id_fkey"
    FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "textile_loom_beam_allocations"
    ADD CONSTRAINT "textile_loom_beam_allocations_loom_id_fkey"
    FOREIGN KEY ("loom_id") REFERENCES "textile_looms"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "textile_loom_beam_allocations"
    ADD CONSTRAINT "textile_loom_beam_allocations_beam_id_fkey"
    FOREIGN KEY ("beam_id") REFERENCES "textile_beams"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "textile_loom_beam_allocations"
    ADD CONSTRAINT "textile_loom_beam_allocations_created_by_fkey"
    FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "textile_loom_beam_allocations"
    ADD CONSTRAINT "textile_loom_beam_allocations_updated_by_fkey"
    FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "textile_daily_loom_productions"
    ADD CONSTRAINT "textile_daily_loom_productions_company_id_fkey"
    FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "textile_daily_loom_productions"
    ADD CONSTRAINT "textile_daily_loom_productions_loom_id_fkey"
    FOREIGN KEY ("loom_id") REFERENCES "textile_looms"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "textile_daily_loom_productions"
    ADD CONSTRAINT "textile_daily_loom_productions_allocation_id_fkey"
    FOREIGN KEY ("allocation_id") REFERENCES "textile_loom_beam_allocations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "textile_daily_loom_productions"
    ADD CONSTRAINT "textile_daily_loom_productions_created_by_fkey"
    FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "textile_daily_loom_productions"
    ADD CONSTRAINT "textile_daily_loom_productions_updated_by_fkey"
    FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
