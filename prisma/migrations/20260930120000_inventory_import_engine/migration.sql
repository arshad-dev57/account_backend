-- Inventory import / UOM / valuation settings + stock ledger enhancements

-- ProductStock: allow fractional quantities (base UOM)
ALTER TABLE "product_stocks"
  ALTER COLUMN "current_stock" TYPE DOUBLE PRECISION USING "current_stock"::double precision,
  ALTER COLUMN "reserved_stock" TYPE DOUBLE PRECISION USING "reserved_stock"::double precision,
  ALTER COLUMN "available_stock" TYPE DOUBLE PRECISION USING "available_stock"::double precision,
  ALTER COLUMN "minimum_stock" TYPE DOUBLE PRECISION USING "minimum_stock"::double precision,
  ALTER COLUMN "reorder_level" TYPE DOUBLE PRECISION USING "reorder_level"::double precision;

-- Product costing fields
ALTER TABLE "products"
  ADD COLUMN IF NOT EXISTS "average_cost" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "last_purchase_price" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "last_purchase_date" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "standard_cost" DOUBLE PRECISION;

-- Backfill average_cost from cost_price
UPDATE "products" SET "average_cost" = "cost_price" WHERE "average_cost" IS NULL;

-- Stock movement ledger enhancements
ALTER TABLE "stock_movements"
  ADD COLUMN IF NOT EXISTS "movement_type" TEXT,
  ADD COLUMN IF NOT EXISTS "base_quantity" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "uom" TEXT,
  ADD COLUMN IF NOT EXISTS "unit_cost" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "total_value" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "batch_number" TEXT,
  ADD COLUMN IF NOT EXISTS "bin_location" TEXT,
  ADD COLUMN IF NOT EXISTS "movement_date" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "import_batch_id" TEXT;

CREATE INDEX IF NOT EXISTS "stock_movements_movement_type_idx" ON "stock_movements"("movement_type");
CREATE INDEX IF NOT EXISTS "stock_movements_import_batch_id_idx" ON "stock_movements"("import_batch_id");

-- Company inventory settings
CREATE TABLE IF NOT EXISTS "company_inventory_settings" (
  "id" TEXT NOT NULL,
  "company_id" TEXT NOT NULL,
  "valuation_method" TEXT NOT NULL DEFAULT 'WEIGHTED_AVERAGE',
  "allow_negative_stock" BOOLEAN NOT NULL DEFAULT false,
  "enable_batch_tracking" BOOLEAN NOT NULL DEFAULT true,
  "enable_serial_tracking" BOOLEAN NOT NULL DEFAULT false,
  "enable_multi_warehouse" BOOLEAN NOT NULL DEFAULT true,
  "enable_bin_management" BOOLEAN NOT NULL DEFAULT true,
  "enable_uom_conversion" BOOLEAN NOT NULL DEFAULT true,
  "quantity_precision" INTEGER NOT NULL DEFAULT 6,
  "cost_precision" INTEGER NOT NULL DEFAULT 4,
  "max_import_file_mb" INTEGER NOT NULL DEFAULT 15,
  "inventory_opening_date" TIMESTAMP(3),
  "create_missing_masters_default" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "company_inventory_settings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "company_inventory_settings_company_id_key" ON "company_inventory_settings"("company_id");

ALTER TABLE "company_inventory_settings"
  DROP CONSTRAINT IF EXISTS "company_inventory_settings_company_id_fkey";
ALTER TABLE "company_inventory_settings"
  ADD CONSTRAINT "company_inventory_settings_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Units of measure
CREATE TABLE IF NOT EXISTS "units_of_measure" (
  "id" TEXT NOT NULL,
  "company_id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "symbol" TEXT,
  "is_base" BOOLEAN NOT NULL DEFAULT false,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "decimal_places" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "units_of_measure_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "units_of_measure_company_id_code_key" ON "units_of_measure"("company_id", "code");
CREATE INDEX IF NOT EXISTS "units_of_measure_company_id_idx" ON "units_of_measure"("company_id");

ALTER TABLE "units_of_measure"
  DROP CONSTRAINT IF EXISTS "units_of_measure_company_id_fkey";
ALTER TABLE "units_of_measure"
  ADD CONSTRAINT "units_of_measure_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- UOM conversions
CREATE TABLE IF NOT EXISTS "uom_conversions" (
  "id" TEXT NOT NULL,
  "company_id" TEXT NOT NULL,
  "from_uom_id" TEXT NOT NULL,
  "to_uom_id" TEXT NOT NULL,
  "conversion_factor" DOUBLE PRECISION NOT NULL,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "uom_conversions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "uom_conversions_company_id_from_uom_id_to_uom_id_key"
  ON "uom_conversions"("company_id", "from_uom_id", "to_uom_id");
CREATE INDEX IF NOT EXISTS "uom_conversions_company_id_idx" ON "uom_conversions"("company_id");

ALTER TABLE "uom_conversions"
  DROP CONSTRAINT IF EXISTS "uom_conversions_company_id_fkey",
  DROP CONSTRAINT IF EXISTS "uom_conversions_from_uom_id_fkey",
  DROP CONSTRAINT IF EXISTS "uom_conversions_to_uom_id_fkey";

ALTER TABLE "uom_conversions"
  ADD CONSTRAINT "uom_conversions_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "uom_conversions_from_uom_id_fkey"
  FOREIGN KEY ("from_uom_id") REFERENCES "units_of_measure"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "uom_conversions_to_uom_id_fkey"
  FOREIGN KEY ("to_uom_id") REFERENCES "units_of_measure"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Import batches
CREATE TABLE IF NOT EXISTS "inventory_import_batches" (
  "id" TEXT NOT NULL,
  "company_id" TEXT NOT NULL,
  "batch_number" TEXT NOT NULL,
  "import_type" TEXT NOT NULL DEFAULT 'ITEM_MASTER',
  "file_name" TEXT,
  "file_hash" TEXT,
  "file_size" INTEGER,
  "status" TEXT NOT NULL DEFAULT 'Pending',
  "duplicate_sku_mode" TEXT NOT NULL DEFAULT 'skip',
  "create_missing_masters" BOOLEAN NOT NULL DEFAULT false,
  "opening_date" TIMESTAMP(3),
  "total_rows" INTEGER NOT NULL DEFAULT 0,
  "valid_rows" INTEGER NOT NULL DEFAULT 0,
  "warning_rows" INTEGER NOT NULL DEFAULT 0,
  "error_rows" INTEGER NOT NULL DEFAULT 0,
  "duplicate_rows" INTEGER NOT NULL DEFAULT 0,
  "imported_count" INTEGER NOT NULL DEFAULT 0,
  "updated_count" INTEGER NOT NULL DEFAULT 0,
  "skipped_count" INTEGER NOT NULL DEFAULT 0,
  "preview_data" JSONB,
  "result_summary" JSONB,
  "column_mapping" JSONB,
  "error_report" JSONB,
  "warning_report" JSONB,
  "created_by" TEXT NOT NULL,
  "started_at" TIMESTAMP(3),
  "completed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "inventory_import_batches_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "inventory_import_batches_company_id_batch_number_key"
  ON "inventory_import_batches"("company_id", "batch_number");
CREATE INDEX IF NOT EXISTS "inventory_import_batches_company_id_idx" ON "inventory_import_batches"("company_id");
CREATE INDEX IF NOT EXISTS "inventory_import_batches_file_hash_idx" ON "inventory_import_batches"("file_hash");
CREATE INDEX IF NOT EXISTS "inventory_import_batches_status_idx" ON "inventory_import_batches"("status");

ALTER TABLE "inventory_import_batches"
  DROP CONSTRAINT IF EXISTS "inventory_import_batches_company_id_fkey";
ALTER TABLE "inventory_import_batches"
  ADD CONSTRAINT "inventory_import_batches_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "stock_movements"
  DROP CONSTRAINT IF EXISTS "stock_movements_import_batch_id_fkey";
ALTER TABLE "stock_movements"
  ADD CONSTRAINT "stock_movements_import_batch_id_fkey"
  FOREIGN KEY ("import_batch_id") REFERENCES "inventory_import_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
