-- Textile P0: sandbox flag, machine ownership, Cone/Beam/FabricRoll + winding + genealogy

ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "is_sandbox" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "textile_item_class" TEXT;

ALTER TABLE "manufacturing_machines" ADD COLUMN IF NOT EXISTS "owning_company_id" TEXT;
ALTER TABLE "manufacturing_machines" ADD COLUMN IF NOT EXISTS "operating_company_id" TEXT;

CREATE INDEX IF NOT EXISTS "manufacturing_machines_owning_company_id_idx" ON "manufacturing_machines"("owning_company_id");
CREATE INDEX IF NOT EXISTS "manufacturing_machines_operating_company_id_idx" ON "manufacturing_machines"("operating_company_id");

DO $$ BEGIN
  ALTER TABLE "manufacturing_machines"
    ADD CONSTRAINT "manufacturing_machines_owning_company_id_fkey"
    FOREIGN KEY ("owning_company_id") REFERENCES "companies"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "manufacturing_machines"
    ADD CONSTRAINT "manufacturing_machines_operating_company_id_fkey"
    FOREIGN KEY ("operating_company_id") REFERENCES "companies"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "textile_cone_winding_entries" (
  "id" TEXT NOT NULL,
  "entry_number" TEXT NOT NULL,
  "company_id" TEXT NOT NULL,
  "production_order_id" TEXT,
  "yarn_product_id" TEXT NOT NULL,
  "yarn_product_name" TEXT NOT NULL,
  "yarn_lot_number" TEXT NOT NULL,
  "cone_product_id" TEXT NOT NULL,
  "cone_product_name" TEXT NOT NULL,
  "source_warehouse_id" TEXT NOT NULL,
  "output_warehouse_id" TEXT NOT NULL,
  "machine_id" TEXT,
  "machine_owning_company_id" TEXT,
  "machine_operating_company_id" TEXT,
  "operator_id" TEXT,
  "operator_name" TEXT,
  "shift" TEXT,
  "production_date" TIMESTAMP(3) NOT NULL,
  "target_output_kg" DOUBLE PRECISION,
  "input_weight_kg" DOUBLE PRECISION NOT NULL,
  "output_weight_kg" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "wastage_kg" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "rejected_weight_kg" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "remaining_yarn_kg" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "rejected_cone_count" INTEGER NOT NULL DEFAULT 0,
  "cone_count" INTEGER NOT NULL DEFAULT 0,
  "running_hours" DOUBLE PRECISION,
  "downtime_hours" DOUBLE PRECISION,
  "status" TEXT NOT NULL DEFAULT 'Draft',
  "stock_posted" BOOLEAN NOT NULL DEFAULT false,
  "yarn_stock_movement_id" TEXT,
  "cone_stock_movement_id" TEXT,
  "notes" TEXT,
  "created_by" TEXT NOT NULL,
  "updated_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "textile_cone_winding_entries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "textile_cone_winding_entries_company_id_entry_number_key"
  ON "textile_cone_winding_entries"("company_id", "entry_number");
CREATE INDEX IF NOT EXISTS "textile_cone_winding_entries_company_id_idx" ON "textile_cone_winding_entries"("company_id");
CREATE INDEX IF NOT EXISTS "textile_cone_winding_entries_status_idx" ON "textile_cone_winding_entries"("status");
CREATE INDEX IF NOT EXISTS "textile_cone_winding_entries_yarn_lot_number_idx" ON "textile_cone_winding_entries"("yarn_lot_number");
CREATE INDEX IF NOT EXISTS "textile_cone_winding_entries_production_date_idx" ON "textile_cone_winding_entries"("production_date");
CREATE INDEX IF NOT EXISTS "textile_cone_winding_entries_machine_id_idx" ON "textile_cone_winding_entries"("machine_id");

CREATE TABLE IF NOT EXISTS "textile_cones" (
  "id" TEXT NOT NULL,
  "cone_code" TEXT NOT NULL,
  "company_id" TEXT NOT NULL,
  "winding_entry_id" TEXT,
  "product_id" TEXT NOT NULL,
  "yarn_product_id" TEXT NOT NULL,
  "yarn_lot_number" TEXT NOT NULL,
  "yarn_supplier_id" TEXT,
  "yarn_supplier_name" TEXT,
  "weight_kg" DOUBLE PRECISION NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'Available',
  "warehouse_id" TEXT,
  "machine_id" TEXT,
  "owning_company_id" TEXT,
  "operating_company_id" TEXT,
  "operator_id" TEXT,
  "operator_name" TEXT,
  "production_date" TIMESTAMP(3),
  "barcode" TEXT,
  "qr_code" TEXT,
  "notes" TEXT,
  "created_by" TEXT NOT NULL,
  "updated_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "textile_cones_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "textile_cones_company_id_cone_code_key" ON "textile_cones"("company_id", "cone_code");
CREATE INDEX IF NOT EXISTS "textile_cones_company_id_idx" ON "textile_cones"("company_id");
CREATE INDEX IF NOT EXISTS "textile_cones_yarn_lot_number_idx" ON "textile_cones"("yarn_lot_number");
CREATE INDEX IF NOT EXISTS "textile_cones_status_idx" ON "textile_cones"("status");
CREATE INDEX IF NOT EXISTS "textile_cones_winding_entry_id_idx" ON "textile_cones"("winding_entry_id");
CREATE INDEX IF NOT EXISTS "textile_cones_warehouse_id_idx" ON "textile_cones"("warehouse_id");

CREATE TABLE IF NOT EXISTS "textile_beams" (
  "id" TEXT NOT NULL,
  "beam_code" TEXT NOT NULL,
  "company_id" TEXT NOT NULL,
  "product_id" TEXT,
  "beam_type" TEXT NOT NULL DEFAULT 'Warping',
  "status" TEXT NOT NULL DEFAULT 'Draft',
  "total_ends" INTEGER,
  "yarn_length_m" DOUBLE PRECISION,
  "weight_kg" DOUBLE PRECISION,
  "warehouse_id" TEXT,
  "source_yarn_lot" TEXT,
  "notes" TEXT,
  "created_by" TEXT NOT NULL,
  "updated_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "textile_beams_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "textile_beams_company_id_beam_code_key" ON "textile_beams"("company_id", "beam_code");
CREATE INDEX IF NOT EXISTS "textile_beams_company_id_idx" ON "textile_beams"("company_id");
CREATE INDEX IF NOT EXISTS "textile_beams_status_idx" ON "textile_beams"("status");
CREATE INDEX IF NOT EXISTS "textile_beams_beam_type_idx" ON "textile_beams"("beam_type");

CREATE TABLE IF NOT EXISTS "textile_fabric_rolls" (
  "id" TEXT NOT NULL,
  "roll_code" TEXT NOT NULL,
  "company_id" TEXT NOT NULL,
  "product_id" TEXT,
  "stage" TEXT NOT NULL DEFAULT 'Greige',
  "status" TEXT NOT NULL DEFAULT 'Draft',
  "weight_kg" DOUBLE PRECISION,
  "meters" DOUBLE PRECISION,
  "width_mm" DOUBLE PRECISION,
  "gsm" DOUBLE PRECISION,
  "quality_grade" TEXT,
  "warehouse_id" TEXT,
  "yarn_lot_number" TEXT,
  "production_batch" TEXT,
  "barcode" TEXT,
  "qr_code" TEXT,
  "notes" TEXT,
  "created_by" TEXT NOT NULL,
  "updated_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "textile_fabric_rolls_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "textile_fabric_rolls_company_id_roll_code_key" ON "textile_fabric_rolls"("company_id", "roll_code");
CREATE INDEX IF NOT EXISTS "textile_fabric_rolls_company_id_idx" ON "textile_fabric_rolls"("company_id");
CREATE INDEX IF NOT EXISTS "textile_fabric_rolls_status_idx" ON "textile_fabric_rolls"("status");
CREATE INDEX IF NOT EXISTS "textile_fabric_rolls_stage_idx" ON "textile_fabric_rolls"("stage");
CREATE INDEX IF NOT EXISTS "textile_fabric_rolls_yarn_lot_number_idx" ON "textile_fabric_rolls"("yarn_lot_number");

CREATE TABLE IF NOT EXISTS "textile_genealogy_links" (
  "id" TEXT NOT NULL,
  "company_id" TEXT NOT NULL,
  "parent_type" TEXT NOT NULL,
  "parent_id" TEXT NOT NULL,
  "parent_code" TEXT,
  "child_type" TEXT NOT NULL,
  "child_id" TEXT NOT NULL,
  "child_code" TEXT,
  "relation" TEXT NOT NULL DEFAULT 'ProducedFrom',
  "quantity" DOUBLE PRECISION,
  "unit" TEXT DEFAULT 'KG',
  "metadata" JSONB,
  "created_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "textile_genealogy_links_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "textile_genealogy_links_company_id_idx" ON "textile_genealogy_links"("company_id");
CREATE INDEX IF NOT EXISTS "textile_genealogy_links_parent_type_parent_id_idx" ON "textile_genealogy_links"("parent_type", "parent_id");
CREATE INDEX IF NOT EXISTS "textile_genealogy_links_child_type_child_id_idx" ON "textile_genealogy_links"("child_type", "child_id");
CREATE INDEX IF NOT EXISTS "textile_genealogy_links_company_id_child_type_child_id_idx"
  ON "textile_genealogy_links"("company_id", "child_type", "child_id");

DO $$ BEGIN
  ALTER TABLE "textile_cone_winding_entries"
    ADD CONSTRAINT "textile_cone_winding_entries_company_id_fkey"
    FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "textile_cone_winding_entries"
    ADD CONSTRAINT "textile_cone_winding_entries_production_order_id_fkey"
    FOREIGN KEY ("production_order_id") REFERENCES "manufacturing_production_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "textile_cone_winding_entries"
    ADD CONSTRAINT "textile_cone_winding_entries_yarn_product_id_fkey"
    FOREIGN KEY ("yarn_product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "textile_cone_winding_entries"
    ADD CONSTRAINT "textile_cone_winding_entries_cone_product_id_fkey"
    FOREIGN KEY ("cone_product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "textile_cone_winding_entries"
    ADD CONSTRAINT "textile_cone_winding_entries_source_warehouse_id_fkey"
    FOREIGN KEY ("source_warehouse_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "textile_cone_winding_entries"
    ADD CONSTRAINT "textile_cone_winding_entries_output_warehouse_id_fkey"
    FOREIGN KEY ("output_warehouse_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "textile_cone_winding_entries"
    ADD CONSTRAINT "textile_cone_winding_entries_machine_id_fkey"
    FOREIGN KEY ("machine_id") REFERENCES "manufacturing_machines"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "textile_cone_winding_entries"
    ADD CONSTRAINT "textile_cone_winding_entries_machine_owning_company_id_fkey"
    FOREIGN KEY ("machine_owning_company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "textile_cone_winding_entries"
    ADD CONSTRAINT "textile_cone_winding_entries_machine_operating_company_id_fkey"
    FOREIGN KEY ("machine_operating_company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "textile_cones"
    ADD CONSTRAINT "textile_cones_company_id_fkey"
    FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "textile_cones"
    ADD CONSTRAINT "textile_cones_winding_entry_id_fkey"
    FOREIGN KEY ("winding_entry_id") REFERENCES "textile_cone_winding_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "textile_cones"
    ADD CONSTRAINT "textile_cones_product_id_fkey"
    FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "textile_cones"
    ADD CONSTRAINT "textile_cones_yarn_product_id_fkey"
    FOREIGN KEY ("yarn_product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "textile_cones"
    ADD CONSTRAINT "textile_cones_warehouse_id_fkey"
    FOREIGN KEY ("warehouse_id") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "textile_cones"
    ADD CONSTRAINT "textile_cones_machine_id_fkey"
    FOREIGN KEY ("machine_id") REFERENCES "manufacturing_machines"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "textile_cones"
    ADD CONSTRAINT "textile_cones_owning_company_id_fkey"
    FOREIGN KEY ("owning_company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "textile_cones"
    ADD CONSTRAINT "textile_cones_operating_company_id_fkey"
    FOREIGN KEY ("operating_company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "textile_beams"
    ADD CONSTRAINT "textile_beams_company_id_fkey"
    FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "textile_beams"
    ADD CONSTRAINT "textile_beams_product_id_fkey"
    FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "textile_beams"
    ADD CONSTRAINT "textile_beams_warehouse_id_fkey"
    FOREIGN KEY ("warehouse_id") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "textile_fabric_rolls"
    ADD CONSTRAINT "textile_fabric_rolls_company_id_fkey"
    FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "textile_fabric_rolls"
    ADD CONSTRAINT "textile_fabric_rolls_product_id_fkey"
    FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "textile_fabric_rolls"
    ADD CONSTRAINT "textile_fabric_rolls_warehouse_id_fkey"
    FOREIGN KEY ("warehouse_id") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "textile_genealogy_links"
    ADD CONSTRAINT "textile_genealogy_links_company_id_fkey"
    FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
