-- Product purchase/sales UOM + POS line transaction snapshots
-- Safe for existing PCS products (defaults preserve current behaviour).

-- ── Product UOM fields ───────────────────────────────────────
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "purchase_unit_name" TEXT;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "purchase_conversion_factor" DOUBLE PRECISION NOT NULL DEFAULT 1;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "sales_unit_name" TEXT;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "sales_conversion_factor" DOUBLE PRECISION NOT NULL DEFAULT 1;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "allow_fractional_qty" BOOLEAN NOT NULL DEFAULT false;

-- Backfill sales unit from stock unit where empty
UPDATE "products"
SET "sales_unit_name" = COALESCE(NULLIF(TRIM("sales_unit_name"), ''), "stock_unit_name", 'Pcs')
WHERE "sales_unit_name" IS NULL OR TRIM("sales_unit_name") = '';

UPDATE "products"
SET "purchase_unit_name" = COALESCE(NULLIF(TRIM("purchase_unit_name"), ''), "stock_unit_name", 'Pcs')
WHERE "purchase_unit_name" IS NULL OR TRIM("purchase_unit_name") = '';

-- Mark weight/volume units as fractional by default
UPDATE "products"
SET "allow_fractional_qty" = true
WHERE "allow_fractional_qty" = false
  AND (
    UPPER(COALESCE("stock_unit_name", '')) IN ('KG', 'G', 'GRAM', 'GRAMS', 'KILOGRAM', 'KILOGRAMS', 'LTR', 'L', 'LITRE', 'LITER', 'ML', 'MILLILITRE', 'MILLILITER', 'M', 'MTR', 'METER', 'METRE')
    OR UPPER(COALESCE("sales_unit_name", '')) IN ('KG', 'G', 'GRAM', 'GRAMS', 'KILOGRAM', 'KILOGRAMS', 'LTR', 'L', 'LITRE', 'LITER', 'ML', 'MILLILITRE', 'MILLILITER', 'M', 'MTR', 'METER', 'METRE')
  );

-- ── POS sale item transaction-time UOM snapshot ──────────────
ALTER TABLE "pos_sale_items" ADD COLUMN IF NOT EXISTS "unit_name" TEXT;
ALTER TABLE "pos_sale_items" ADD COLUMN IF NOT EXISTS "base_quantity" DOUBLE PRECISION;
ALTER TABLE "pos_sale_items" ADD COLUMN IF NOT EXISTS "conversion_factor" DOUBLE PRECISION DEFAULT 1;

-- Legacy rows: treat sold qty as base qty (1:1)
UPDATE "pos_sale_items"
SET "base_quantity" = "quantity"
WHERE "base_quantity" IS NULL;

UPDATE "pos_sale_items"
SET "conversion_factor" = 1
WHERE "conversion_factor" IS NULL;

UPDATE "pos_sale_items"
SET "unit_name" = COALESCE(NULLIF(TRIM("unit_name"), ''), 'Pcs')
WHERE "unit_name" IS NULL OR TRIM("unit_name") = '';

-- ── POS return item snapshot ─────────────────────────────────
ALTER TABLE "pos_return_items" ADD COLUMN IF NOT EXISTS "unit_name" TEXT;
ALTER TABLE "pos_return_items" ADD COLUMN IF NOT EXISTS "base_quantity" DOUBLE PRECISION;
ALTER TABLE "pos_return_items" ADD COLUMN IF NOT EXISTS "conversion_factor" DOUBLE PRECISION DEFAULT 1;

UPDATE "pos_return_items"
SET "base_quantity" = "quantity"
WHERE "base_quantity" IS NULL;

UPDATE "pos_return_items"
SET "conversion_factor" = 1
WHERE "conversion_factor" IS NULL;
