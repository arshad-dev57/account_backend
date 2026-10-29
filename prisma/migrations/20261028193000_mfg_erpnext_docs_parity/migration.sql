CREATE TABLE IF NOT EXISTS "manufacturing_stock_entries" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "purpose" TEXT NOT NULL DEFAULT 'Material Transfer for Manufacture',
    "work_order_id" TEXT,
    "bom_id" TEXT,
    "from_warehouse" TEXT,
    "to_warehouse" TEXT,
    "posting_date" TIMESTAMP(3) NOT NULL,
    "fg_completed_qty" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "items" JSONB NOT NULL DEFAULT '[]',
    "remarks" TEXT,
    "created_by" TEXT,
    "updated_by" TEXT,
    "company_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "manufacturing_stock_entries_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "manufacturing_item_lead_times" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,
    "item_name" TEXT NOT NULL DEFAULT '',
    "lead_time_days" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "safety_stock_days" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "notes" TEXT,
    "created_by" TEXT,
    "updated_by" TEXT,
    "company_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "manufacturing_item_lead_times_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "manufacturing_sales_forecasts" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "from_date" TIMESTAMP(3),
    "to_date" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "items" JSONB NOT NULL DEFAULT '[]',
    "notes" TEXT,
    "created_by" TEXT,
    "updated_by" TEXT,
    "company_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "manufacturing_sales_forecasts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "manufacturing_bom_creators" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "design_name" TEXT,
    "item_id" TEXT,
    "item_name" TEXT NOT NULL DEFAULT '',
    "qty" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "routing_id" TEXT,
    "items" JSONB NOT NULL DEFAULT '[]',
    "operations" JSONB NOT NULL DEFAULT '[]',
    "remarks" TEXT,
    "created_by" TEXT,
    "updated_by" TEXT,
    "company_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "manufacturing_bom_creators_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "manufacturing_bom_update_tools" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "current_bom_id" TEXT,
    "new_bom_id" TEXT,
    "replace_bom" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "notes" TEXT,
    "created_by" TEXT,
    "updated_by" TEXT,
    "company_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "manufacturing_bom_update_tools_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "manufacturing_stock_entries_name_key" ON "manufacturing_stock_entries"("name");
CREATE INDEX IF NOT EXISTS "manufacturing_stock_entries_company_id_idx" ON "manufacturing_stock_entries"("company_id");
CREATE INDEX IF NOT EXISTS "manufacturing_stock_entries_status_idx" ON "manufacturing_stock_entries"("status");

CREATE UNIQUE INDEX IF NOT EXISTS "manufacturing_item_lead_times_name_key" ON "manufacturing_item_lead_times"("name");
CREATE INDEX IF NOT EXISTS "manufacturing_item_lead_times_company_id_idx" ON "manufacturing_item_lead_times"("company_id");
CREATE INDEX IF NOT EXISTS "manufacturing_item_lead_times_item_id_idx" ON "manufacturing_item_lead_times"("item_id");

CREATE UNIQUE INDEX IF NOT EXISTS "manufacturing_sales_forecasts_name_key" ON "manufacturing_sales_forecasts"("name");
CREATE INDEX IF NOT EXISTS "manufacturing_sales_forecasts_company_id_idx" ON "manufacturing_sales_forecasts"("company_id");

CREATE UNIQUE INDEX IF NOT EXISTS "manufacturing_bom_creators_name_key" ON "manufacturing_bom_creators"("name");
CREATE INDEX IF NOT EXISTS "manufacturing_bom_creators_company_id_idx" ON "manufacturing_bom_creators"("company_id");

CREATE UNIQUE INDEX IF NOT EXISTS "manufacturing_bom_update_tools_name_key" ON "manufacturing_bom_update_tools"("name");
CREATE INDEX IF NOT EXISTS "manufacturing_bom_update_tools_company_id_idx" ON "manufacturing_bom_update_tools"("company_id");

DO $$ BEGIN
  ALTER TABLE "manufacturing_stock_entries" ADD CONSTRAINT "manufacturing_stock_entries_company_id_fkey"
    FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "manufacturing_item_lead_times" ADD CONSTRAINT "manufacturing_item_lead_times_company_id_fkey"
    FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "manufacturing_sales_forecasts" ADD CONSTRAINT "manufacturing_sales_forecasts_company_id_fkey"
    FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "manufacturing_bom_creators" ADD CONSTRAINT "manufacturing_bom_creators_company_id_fkey"
    FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "manufacturing_bom_update_tools" ADD CONSTRAINT "manufacturing_bom_update_tools_company_id_fkey"
    FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
