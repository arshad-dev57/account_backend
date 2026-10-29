-- ERPNext Manufacturing masters parity

CREATE TABLE IF NOT EXISTS "manufacturing_operations" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "workstation_id" TEXT,
    "description" TEXT,
    "batch_size" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "total_operation_time" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "disabled" BOOLEAN NOT NULL DEFAULT false,
    "created_by" TEXT,
    "updated_by" TEXT,
    "company_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "manufacturing_operations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "manufacturing_workstation_types" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "hour_rate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "hour_rate_electricity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "hour_rate_consumable" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "hour_rate_rent" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "hour_rate_labour" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "description" TEXT,
    "created_by" TEXT,
    "updated_by" TEXT,
    "company_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "manufacturing_workstation_types_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "manufacturing_production_plans" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "get_items_from" TEXT,
    "posting_date" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "from_date" TIMESTAMP(3),
    "to_date" TIMESTAMP(3),
    "notes" TEXT,
    "items" JSONB NOT NULL DEFAULT '[]',
    "created_by" TEXT,
    "updated_by" TEXT,
    "company_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "manufacturing_production_plans_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "manufacturing_downtime_entries" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "workstation_id" TEXT NOT NULL,
    "operator_id" TEXT,
    "from_time" TIMESTAMP(3) NOT NULL,
    "to_time" TIMESTAMP(3) NOT NULL,
    "stop_reason" TEXT,
    "remarks" TEXT,
    "created_by" TEXT,
    "updated_by" TEXT,
    "company_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "manufacturing_downtime_entries_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "manufacturing_plant_floors" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "warehouse" TEXT,
    "disabled" BOOLEAN NOT NULL DEFAULT false,
    "created_by" TEXT,
    "updated_by" TEXT,
    "company_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "manufacturing_plant_floors_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "manufacturing_work_centers"
  ADD COLUMN IF NOT EXISTS "workstation_type_id" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "manufacturing_operations_company_id_name_key"
  ON "manufacturing_operations"("company_id", "name");
CREATE INDEX IF NOT EXISTS "manufacturing_operations_workstation_id_idx"
  ON "manufacturing_operations"("workstation_id");
CREATE INDEX IF NOT EXISTS "manufacturing_operations_company_id_idx"
  ON "manufacturing_operations"("company_id");

CREATE UNIQUE INDEX IF NOT EXISTS "manufacturing_workstation_types_company_id_name_key"
  ON "manufacturing_workstation_types"("company_id", "name");
CREATE INDEX IF NOT EXISTS "manufacturing_workstation_types_company_id_idx"
  ON "manufacturing_workstation_types"("company_id");

CREATE UNIQUE INDEX IF NOT EXISTS "manufacturing_production_plans_name_key"
  ON "manufacturing_production_plans"("name");
CREATE INDEX IF NOT EXISTS "manufacturing_production_plans_status_idx"
  ON "manufacturing_production_plans"("status");
CREATE INDEX IF NOT EXISTS "manufacturing_production_plans_company_id_idx"
  ON "manufacturing_production_plans"("company_id");

CREATE UNIQUE INDEX IF NOT EXISTS "manufacturing_downtime_entries_name_key"
  ON "manufacturing_downtime_entries"("name");
CREATE INDEX IF NOT EXISTS "manufacturing_downtime_entries_workstation_id_idx"
  ON "manufacturing_downtime_entries"("workstation_id");
CREATE INDEX IF NOT EXISTS "manufacturing_downtime_entries_company_id_idx"
  ON "manufacturing_downtime_entries"("company_id");

CREATE UNIQUE INDEX IF NOT EXISTS "manufacturing_plant_floors_company_id_name_key"
  ON "manufacturing_plant_floors"("company_id", "name");
CREATE INDEX IF NOT EXISTS "manufacturing_plant_floors_company_id_idx"
  ON "manufacturing_plant_floors"("company_id");

CREATE INDEX IF NOT EXISTS "manufacturing_work_centers_workstation_type_id_idx"
  ON "manufacturing_work_centers"("workstation_type_id");

DO $$ BEGIN
  ALTER TABLE "manufacturing_operations"
    ADD CONSTRAINT "manufacturing_operations_workstation_id_fkey"
    FOREIGN KEY ("workstation_id") REFERENCES "manufacturing_work_centers"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "manufacturing_operations"
    ADD CONSTRAINT "manufacturing_operations_company_id_fkey"
    FOREIGN KEY ("company_id") REFERENCES "companies"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "manufacturing_workstation_types"
    ADD CONSTRAINT "manufacturing_workstation_types_company_id_fkey"
    FOREIGN KEY ("company_id") REFERENCES "companies"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "manufacturing_work_centers"
    ADD CONSTRAINT "manufacturing_work_centers_workstation_type_id_fkey"
    FOREIGN KEY ("workstation_type_id") REFERENCES "manufacturing_workstation_types"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "manufacturing_production_plans"
    ADD CONSTRAINT "manufacturing_production_plans_company_id_fkey"
    FOREIGN KEY ("company_id") REFERENCES "companies"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "manufacturing_downtime_entries"
    ADD CONSTRAINT "manufacturing_downtime_entries_workstation_id_fkey"
    FOREIGN KEY ("workstation_id") REFERENCES "manufacturing_work_centers"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "manufacturing_downtime_entries"
    ADD CONSTRAINT "manufacturing_downtime_entries_company_id_fkey"
    FOREIGN KEY ("company_id") REFERENCES "companies"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "manufacturing_plant_floors"
    ADD CONSTRAINT "manufacturing_plant_floors_company_id_fkey"
    FOREIGN KEY ("company_id") REFERENCES "companies"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
