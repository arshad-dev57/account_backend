-- Multi-unit inventory: product packaging units, batch balances, ledger enrichment.
-- Existing stock quantities are preserved as-is in the product's current base UOM.
-- No silent unit conversion of historical balances.

-- ── Product flags ────────────────────────────────────────────
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "track_inventory" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "opening_stock_posted" BOOLEAN NOT NULL DEFAULT false;

UPDATE "products"
SET "opening_stock_posted" = true
WHERE COALESCE("opening_stock", 0) > 0
   OR COALESCE("current_stock", 0) > 0;

-- ── Product units (product-specific packaging) ───────────────
CREATE TABLE IF NOT EXISTS "product_units" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "unit_name" TEXT NOT NULL,
    "unit_code" TEXT,
    "uom_id" TEXT,
    "conversion_factor" DOUBLE PRECISION NOT NULL,
    "is_base" BOOLEAN NOT NULL DEFAULT false,
    "allow_purchase" BOOLEAN NOT NULL DEFAULT true,
    "allow_sale" BOOLEAN NOT NULL DEFAULT true,
    "is_default_sale" BOOLEAN NOT NULL DEFAULT false,
    "is_default_purchase" BOOLEAN NOT NULL DEFAULT false,
    "barcode" TEXT,
    "purchase_price" DOUBLE PRECISION,
    "selling_price" DOUBLE PRECISION,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "product_units_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "product_units_product_id_unit_name_key"
  ON "product_units"("product_id", "unit_name");
CREATE INDEX IF NOT EXISTS "product_units_company_id_idx" ON "product_units"("company_id");
CREATE INDEX IF NOT EXISTS "product_units_product_id_idx" ON "product_units"("product_id");
CREATE INDEX IF NOT EXISTS "product_units_company_id_barcode_idx" ON "product_units"("company_id", "barcode");
CREATE INDEX IF NOT EXISTS "product_units_product_id_allow_sale_idx" ON "product_units"("product_id", "allow_sale");
CREATE INDEX IF NOT EXISTS "product_units_product_id_allow_purchase_idx" ON "product_units"("product_id", "allow_purchase");

DO $$ BEGIN
  ALTER TABLE "product_units"
    ADD CONSTRAINT "product_units_company_id_fkey"
    FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "product_units"
    ADD CONSTRAINT "product_units_product_id_fkey"
    FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Product batches (expiry / lot balances in base units) ────
CREATE TABLE IF NOT EXISTS "product_batches" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "location_id" TEXT NOT NULL,
    "batch_number" TEXT NOT NULL,
    "expiry_date" TIMESTAMP(3),
    "manufacturing_date" TIMESTAMP(3),
    "current_stock" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "reserved_stock" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "available_stock" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "unit_cost" DOUBLE PRECISION,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "product_batches_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "product_batches_product_id_location_id_batch_number_key"
  ON "product_batches"("product_id", "location_id", "batch_number");
CREATE INDEX IF NOT EXISTS "product_batches_company_id_idx" ON "product_batches"("company_id");
CREATE INDEX IF NOT EXISTS "product_batches_product_id_idx" ON "product_batches"("product_id");
CREATE INDEX IF NOT EXISTS "product_batches_location_id_idx" ON "product_batches"("location_id");
CREATE INDEX IF NOT EXISTS "product_batches_expiry_date_idx" ON "product_batches"("expiry_date");

DO $$ BEGIN
  ALTER TABLE "product_batches"
    ADD CONSTRAINT "product_batches_company_id_fkey"
    FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "product_batches"
    ADD CONSTRAINT "product_batches_product_id_fkey"
    FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "product_batches"
    ADD CONSTRAINT "product_batches_location_id_fkey"
    FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Stock movement ledger enrichment ─────────────────────────
ALTER TABLE "stock_movements" ADD COLUMN IF NOT EXISTS "entered_quantity" DOUBLE PRECISION;
ALTER TABLE "stock_movements" ADD COLUMN IF NOT EXISTS "conversion_factor" DOUBLE PRECISION;
ALTER TABLE "stock_movements" ADD COLUMN IF NOT EXISTS "product_unit_id" TEXT;
ALTER TABLE "stock_movements" ADD COLUMN IF NOT EXISTS "idempotency_key" TEXT;
ALTER TABLE "stock_movements" ADD COLUMN IF NOT EXISTS "reversal_of_id" TEXT;

CREATE INDEX IF NOT EXISTS "stock_movements_idempotency_key_idx" ON "stock_movements"("idempotency_key");
CREATE UNIQUE INDEX IF NOT EXISTS "stock_movements_company_id_idempotency_key_key"
  ON "stock_movements"("company_id", "idempotency_key");

-- Backfill entered/base from historical rows (1:1 when unknown)
UPDATE "stock_movements"
SET "entered_quantity" = "quantity"
WHERE "entered_quantity" IS NULL;

UPDATE "stock_movements"
SET "base_quantity" = COALESCE("base_quantity", "quantity")
WHERE "base_quantity" IS NULL;

UPDATE "stock_movements"
SET "conversion_factor" = 1
WHERE "conversion_factor" IS NULL;

-- ── POS line packaging snapshot ──────────────────────────────
ALTER TABLE "pos_sale_items" ADD COLUMN IF NOT EXISTS "product_unit_id" TEXT;
ALTER TABLE "pos_sale_items" ADD COLUMN IF NOT EXISTS "batch_number" TEXT;
CREATE INDEX IF NOT EXISTS "pos_sale_items_product_unit_id_idx" ON "pos_sale_items"("product_unit_id");

ALTER TABLE "pos_return_items" ADD COLUMN IF NOT EXISTS "product_unit_id" TEXT;
ALTER TABLE "pos_return_items" ADD COLUMN IF NOT EXISTS "batch_number" TEXT;

-- ── Safe backfill: one base unit + optional sales/purchase rows ─
-- Does NOT invent conversion factors beyond existing product fields.
INSERT INTO "product_units" (
  "id", "company_id", "product_id", "unit_name", "unit_code",
  "conversion_factor", "is_base", "allow_purchase", "allow_sale",
  "is_default_sale", "is_default_purchase", "barcode",
  "purchase_price", "selling_price", "sort_order", "is_active",
  "created_at", "updated_at"
)
SELECT
  gen_random_uuid()::text,
  p."company_id",
  p."id",
  COALESCE(NULLIF(TRIM(p."stock_unit_name"), ''), 'Pcs'),
  UPPER(COALESCE(NULLIF(TRIM(p."stock_unit_name"), ''), 'Pcs')),
  1,
  true,
  true,
  true,
  CASE
    WHEN LOWER(COALESCE(NULLIF(TRIM(p."sales_unit_name"), ''), COALESCE(NULLIF(TRIM(p."stock_unit_name"), ''), 'Pcs')))
       = LOWER(COALESCE(NULLIF(TRIM(p."stock_unit_name"), ''), 'Pcs'))
    THEN true ELSE false
  END,
  CASE
    WHEN LOWER(COALESCE(NULLIF(TRIM(p."purchase_unit_name"), ''), COALESCE(NULLIF(TRIM(p."stock_unit_name"), ''), 'Pcs')))
       = LOWER(COALESCE(NULLIF(TRIM(p."stock_unit_name"), ''), 'Pcs'))
    THEN true ELSE false
  END,
  p."barcode_number",
  p."cost_price",
  p."selling_price",
  0,
  true,
  NOW(),
  NOW()
FROM "products" p
WHERE p."company_id" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "product_units" pu
    WHERE pu."product_id" = p."id" AND pu."is_base" = true
  );

-- Sales unit when different from base (uses existing sales_conversion_factor)
INSERT INTO "product_units" (
  "id", "company_id", "product_id", "unit_name", "unit_code",
  "conversion_factor", "is_base", "allow_purchase", "allow_sale",
  "is_default_sale", "is_default_purchase", "barcode",
  "purchase_price", "selling_price", "sort_order", "is_active",
  "created_at", "updated_at"
)
SELECT
  gen_random_uuid()::text,
  p."company_id",
  p."id",
  NULLIF(TRIM(p."sales_unit_name"), ''),
  UPPER(NULLIF(TRIM(p."sales_unit_name"), '')),
  CASE WHEN COALESCE(p."sales_conversion_factor", 1) > 0 THEN p."sales_conversion_factor" ELSE 1 END,
  false,
  false,
  true,
  true,
  false,
  NULL,
  NULL,
  p."selling_price",
  1,
  true,
  NOW(),
  NOW()
FROM "products" p
WHERE p."company_id" IS NOT NULL
  AND NULLIF(TRIM(p."sales_unit_name"), '') IS NOT NULL
  AND LOWER(TRIM(p."sales_unit_name"))
      <> LOWER(COALESCE(NULLIF(TRIM(p."stock_unit_name"), ''), 'Pcs'))
  AND NOT EXISTS (
    SELECT 1 FROM "product_units" pu
    WHERE pu."product_id" = p."id"
      AND LOWER(pu."unit_name") = LOWER(TRIM(p."sales_unit_name"))
  );

-- Purchase unit when different from base and sales
INSERT INTO "product_units" (
  "id", "company_id", "product_id", "unit_name", "unit_code",
  "conversion_factor", "is_base", "allow_purchase", "allow_sale",
  "is_default_sale", "is_default_purchase", "barcode",
  "purchase_price", "selling_price", "sort_order", "is_active",
  "created_at", "updated_at"
)
SELECT
  gen_random_uuid()::text,
  p."company_id",
  p."id",
  NULLIF(TRIM(p."purchase_unit_name"), ''),
  UPPER(NULLIF(TRIM(p."purchase_unit_name"), '')),
  CASE WHEN COALESCE(p."purchase_conversion_factor", 1) > 0 THEN p."purchase_conversion_factor" ELSE 1 END,
  false,
  true,
  false,
  false,
  true,
  NULL,
  p."cost_price",
  NULL,
  2,
  true,
  NOW(),
  NOW()
FROM "products" p
WHERE p."company_id" IS NOT NULL
  AND NULLIF(TRIM(p."purchase_unit_name"), '') IS NOT NULL
  AND LOWER(TRIM(p."purchase_unit_name"))
      <> LOWER(COALESCE(NULLIF(TRIM(p."stock_unit_name"), ''), 'Pcs'))
  AND (
    NULLIF(TRIM(p."sales_unit_name"), '') IS NULL
    OR LOWER(TRIM(p."purchase_unit_name")) <> LOWER(TRIM(p."sales_unit_name"))
  )
  AND NOT EXISTS (
    SELECT 1 FROM "product_units" pu
    WHERE pu."product_id" = p."id"
      AND LOWER(pu."unit_name") = LOWER(TRIM(p."purchase_unit_name"))
  );
