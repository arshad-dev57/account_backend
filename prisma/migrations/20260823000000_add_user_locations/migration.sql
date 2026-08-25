-- Locations first (this DB never had the table — previous apply failed on FK)
CREATE TABLE IF NOT EXISTS "locations" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'Shop',
    "address" TEXT,
    "phone" TEXT,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "locations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "locations_company_id_code_key" ON "locations"("company_id", "code");
CREATE INDEX IF NOT EXISTS "locations_company_id_idx" ON "locations"("company_id");
CREATE INDEX IF NOT EXISTS "locations_is_active_idx" ON "locations"("is_active");
CREATE INDEX IF NOT EXISTS "locations_is_default_idx" ON "locations"("is_default");

DO $$ BEGIN
  ALTER TABLE "locations" ADD CONSTRAINT "locations_company_id_fkey"
    FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Default store per company so existing users have somewhere to attach
INSERT INTO "locations" ("id", "company_id", "name", "code", "type", "is_default", "is_active", "is_deleted", "created_at", "updated_at")
SELECT gen_random_uuid()::text, c.id, 'Main Store', 'MAIN', 'Shop', true, true, false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "companies" c
WHERE NOT EXISTS (
  SELECT 1 FROM "locations" l WHERE l.company_id = c.id AND l.is_deleted = false
);

CREATE TABLE IF NOT EXISTS "product_stocks" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "location_id" TEXT NOT NULL,
    "current_stock" INTEGER NOT NULL DEFAULT 0,
    "reserved_stock" INTEGER NOT NULL DEFAULT 0,
    "available_stock" INTEGER NOT NULL DEFAULT 0,
    "minimum_stock" INTEGER NOT NULL DEFAULT 0,
    "reorder_level" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_stocks_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "product_stocks_product_id_location_id_key" ON "product_stocks"("product_id", "location_id");
CREATE INDEX IF NOT EXISTS "product_stocks_company_id_idx" ON "product_stocks"("company_id");
CREATE INDEX IF NOT EXISTS "product_stocks_product_id_idx" ON "product_stocks"("product_id");
CREATE INDEX IF NOT EXISTS "product_stocks_location_id_idx" ON "product_stocks"("location_id");

DO $$ BEGIN
  ALTER TABLE "product_stocks" ADD CONSTRAINT "product_stocks_company_id_fkey"
    FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "product_stocks" ADD CONSTRAINT "product_stocks_product_id_fkey"
    FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "product_stocks" ADD CONSTRAINT "product_stocks_location_id_fkey"
    FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "user_locations" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "location_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_locations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "user_locations_user_id_location_id_key" ON "user_locations"("user_id", "location_id");
CREATE INDEX IF NOT EXISTS "user_locations_user_id_idx" ON "user_locations"("user_id");
CREATE INDEX IF NOT EXISTS "user_locations_location_id_idx" ON "user_locations"("location_id");

DO $$ BEGIN
  ALTER TABLE "user_locations" ADD CONSTRAINT "user_locations_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "user_locations" ADD CONSTRAINT "user_locations_location_id_fkey"
    FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

INSERT INTO "user_locations" ("id", "user_id", "location_id", "created_at")
SELECT ('ul_' || u.id || '_' || l.id), u.id, l.id, CURRENT_TIMESTAMP
FROM "users" u
INNER JOIN "locations" l ON l.company_id = u.company_id AND l.is_deleted = false
WHERE u.company_id IS NOT NULL
ON CONFLICT ("user_id", "location_id") DO NOTHING;

-- Schema already has optional location_id on these tables; add if missing
ALTER TABLE "stock_movements" ADD COLUMN IF NOT EXISTS "location_id" TEXT;
ALTER TABLE "stock_movements" ADD COLUMN IF NOT EXISTS "from_location_id" TEXT;
ALTER TABLE "stock_movements" ADD COLUMN IF NOT EXISTS "to_location_id" TEXT;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "location_id" TEXT;
ALTER TABLE "deliveries" ADD COLUMN IF NOT EXISTS "location_id" TEXT;
ALTER TABLE "quotations" ADD COLUMN IF NOT EXISTS "location_id" TEXT;
ALTER TABLE "purchase_orders" ADD COLUMN IF NOT EXISTS "location_id" TEXT;
ALTER TABLE "goods_receivings" ADD COLUMN IF NOT EXISTS "location_id" TEXT;
ALTER TABLE "purchase_invoices" ADD COLUMN IF NOT EXISTS "location_id" TEXT;
ALTER TABLE "sales_invoices" ADD COLUMN IF NOT EXISTS "location_id" TEXT;
ALTER TABLE "pos_terminals" ADD COLUMN IF NOT EXISTS "location_id" TEXT;

CREATE INDEX IF NOT EXISTS "stock_movements_location_id_idx" ON "stock_movements"("location_id");
CREATE INDEX IF NOT EXISTS "orders_location_id_idx" ON "orders"("location_id");
CREATE INDEX IF NOT EXISTS "deliveries_location_id_idx" ON "deliveries"("location_id");
CREATE INDEX IF NOT EXISTS "quotations_location_id_idx" ON "quotations"("location_id");
CREATE INDEX IF NOT EXISTS "purchase_orders_location_id_idx" ON "purchase_orders"("location_id");
CREATE INDEX IF NOT EXISTS "goods_receivings_location_id_idx" ON "goods_receivings"("location_id");
CREATE INDEX IF NOT EXISTS "purchase_invoices_location_id_idx" ON "purchase_invoices"("location_id");
CREATE INDEX IF NOT EXISTS "sales_invoices_location_id_idx" ON "sales_invoices"("location_id");
CREATE INDEX IF NOT EXISTS "pos_terminals_location_id_idx" ON "pos_terminals"("location_id");

DO $$ BEGIN
  ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_location_id_fkey"
    FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "orders" ADD CONSTRAINT "orders_location_id_fkey"
    FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_location_id_fkey"
    FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "quotations" ADD CONSTRAINT "quotations_location_id_fkey"
    FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_location_id_fkey"
    FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "goods_receivings" ADD CONSTRAINT "goods_receivings_location_id_fkey"
    FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "purchase_invoices" ADD CONSTRAINT "purchase_invoices_location_id_fkey"
    FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_location_id_fkey"
    FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "pos_terminals" ADD CONSTRAINT "pos_terminals_location_id_fkey"
    FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
