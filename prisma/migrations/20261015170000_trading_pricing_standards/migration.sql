-- International-standard Trading pricing fields

-- Price lists
ALTER TABLE "trading_price_lists"
  ALTER COLUMN "currency_code" SET DEFAULT 'PKR';

ALTER TABLE "trading_price_lists"
  ADD COLUMN IF NOT EXISTS "pricing_method" TEXT NOT NULL DEFAULT 'Fixed',
  ADD COLUMN IF NOT EXISTS "cost_basis" TEXT NOT NULL DEFAULT 'CostPrice',
  ADD COLUMN IF NOT EXISTS "markup_percentage" DECIMAL(8,4) NOT NULL DEFAULT 0;

-- Price list items (qty breaks + UOM + validity)
ALTER TABLE "trading_price_list_items"
  ADD COLUMN IF NOT EXISTS "unit_name" TEXT NOT NULL DEFAULT 'Pcs',
  ADD COLUMN IF NOT EXISTS "list_price" DECIMAL(18,4),
  ADD COLUMN IF NOT EXISTS "max_qty" DECIMAL(18,4),
  ADD COLUMN IF NOT EXISTS "discount_percentage" DECIMAL(8,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "markup_percentage" DECIMAL(8,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "effective_from" DATE,
  ADD COLUMN IF NOT EXISTS "effective_to" DATE;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'trading_price_list_items_price_list_id_product_id_key'
  ) THEN
    ALTER TABLE "trading_price_list_items"
      DROP CONSTRAINT "trading_price_list_items_price_list_id_product_id_key";
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'trading_price_list_items_price_list_id_product_id_min_qty_key'
  ) THEN
    ALTER TABLE "trading_price_list_items"
      ADD CONSTRAINT "trading_price_list_items_price_list_id_product_id_min_qty_key"
      UNIQUE ("price_list_id", "product_id", "min_qty");
  END IF;
END $$;

-- Customer negotiated prices
ALTER TABLE "trading_customer_prices"
  ADD COLUMN IF NOT EXISTS "price_list_id" TEXT,
  ADD COLUMN IF NOT EXISTS "currency_code" TEXT NOT NULL DEFAULT 'PKR',
  ADD COLUMN IF NOT EXISTS "unit_name" TEXT NOT NULL DEFAULT 'Pcs',
  ADD COLUMN IF NOT EXISTS "discount_percentage" DECIMAL(8,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "target_margin_pct" DECIMAL(8,4) NOT NULL DEFAULT 20,
  ADD COLUMN IF NOT EXISTS "effective_from" DATE,
  ADD COLUMN IF NOT EXISTS "notes" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'trading_customer_prices_price_list_id_fkey'
  ) THEN
    ALTER TABLE "trading_customer_prices"
      ADD CONSTRAINT "trading_customer_prices_price_list_id_fkey"
      FOREIGN KEY ("price_list_id") REFERENCES "trading_price_lists"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "trading_customer_prices_price_list_id_idx"
  ON "trading_customer_prices"("price_list_id");
