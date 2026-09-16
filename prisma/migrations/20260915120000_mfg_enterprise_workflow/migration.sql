-- Enterprise manufacturing workflow fields: traceability, inventory posting flags, status history.

ALTER TABLE "manufacturing_production_orders"
  ADD COLUMN IF NOT EXISTS "rejected_quantity" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "demand_type" TEXT,
  ADD COLUMN IF NOT EXISTS "sales_order_reference" TEXT,
  ADD COLUMN IF NOT EXISTS "batch_number" TEXT,
  ADD COLUMN IF NOT EXISTS "inventory_posted" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "manufacturing_material_issues"
  ADD COLUMN IF NOT EXISTS "batch_number" TEXT,
  ADD COLUMN IF NOT EXISTS "inventory_posted" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "manufacturing_scraps"
  ADD COLUMN IF NOT EXISTS "recoverable" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "inventory_posted" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "manufacturing_by_products"
  ADD COLUMN IF NOT EXISTS "batch_number" TEXT,
  ADD COLUMN IF NOT EXISTS "inventory_posted" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "manufacturing_quality_parameters"
  ALTER COLUMN "expected_value" TYPE TEXT USING "expected_value"::text,
  ALTER COLUMN "actual_value" TYPE TEXT USING "actual_value"::text,
  ALTER COLUMN "expected_value" SET DEFAULT '',
  ALTER COLUMN "actual_value" SET DEFAULT '',
  ALTER COLUMN "unit_of_measure" SET DEFAULT '';

ALTER TABLE "manufacturing_quality_parameters"
  ALTER COLUMN "tolerance" TYPE TEXT USING CASE WHEN "tolerance" IS NULL THEN NULL ELSE "tolerance"::text END;

CREATE TABLE IF NOT EXISTS "manufacturing_status_history" (
  "id" TEXT NOT NULL,
  "entity_type" TEXT NOT NULL,
  "entity_id" TEXT NOT NULL,
  "from_status" TEXT,
  "to_status" TEXT NOT NULL,
  "reason" TEXT,
  "created_by" TEXT,
  "company_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "manufacturing_status_history_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "manufacturing_status_history_entity_type_entity_id_idx"
  ON "manufacturing_status_history"("entity_type", "entity_id");
CREATE INDEX IF NOT EXISTS "manufacturing_status_history_company_id_idx"
  ON "manufacturing_status_history"("company_id");
CREATE INDEX IF NOT EXISTS "manufacturing_status_history_created_at_idx"
  ON "manufacturing_status_history"("created_at");
