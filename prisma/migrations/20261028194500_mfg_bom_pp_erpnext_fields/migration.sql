-- BOM ERPNext Production Item / BOM Configuration / More Info fields
ALTER TABLE "manufacturing_boms" ADD COLUMN IF NOT EXISTS "quantity" DOUBLE PRECISION NOT NULL DEFAULT 1;
ALTER TABLE "manufacturing_boms" ADD COLUMN IF NOT EXISTS "uom" TEXT DEFAULT 'Nos';
ALTER TABLE "manufacturing_boms" ADD COLUMN IF NOT EXISTS "with_operations" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "manufacturing_boms" ADD COLUMN IF NOT EXISTS "track_semi_finished_goods" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "manufacturing_boms" ADD COLUMN IF NOT EXISTS "transfer_material_against" TEXT;
ALTER TABLE "manufacturing_boms" ADD COLUMN IF NOT EXISTS "routing_id" TEXT;
ALTER TABLE "manufacturing_boms" ADD COLUMN IF NOT EXISTS "operations" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "manufacturing_boms" ADD COLUMN IF NOT EXISTS "process_loss_percentage" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "manufacturing_boms" ADD COLUMN IF NOT EXISTS "process_loss_qty" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "manufacturing_boms" ADD COLUMN IF NOT EXISTS "set_qty_based_on_percentage" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "manufacturing_boms" ADD COLUMN IF NOT EXISTS "is_default" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "manufacturing_boms" ADD COLUMN IF NOT EXISTS "allow_alternative_item" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "manufacturing_boms" ADD COLUMN IF NOT EXISTS "is_phantom_bom" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "manufacturing_boms" ADD COLUMN IF NOT EXISTS "inspection_required" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "manufacturing_boms" ADD COLUMN IF NOT EXISTS "quality_inspection_template" TEXT;
ALTER TABLE "manufacturing_boms" ADD COLUMN IF NOT EXISTS "default_source_warehouse" TEXT;
ALTER TABLE "manufacturing_boms" ADD COLUMN IF NOT EXISTS "default_target_warehouse" TEXT;
ALTER TABLE "manufacturing_boms" ADD COLUMN IF NOT EXISTS "backflush_based_on" TEXT DEFAULT 'BOM';
ALTER TABLE "manufacturing_boms" ADD COLUMN IF NOT EXISTS "operating_cost" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "manufacturing_boms" ADD COLUMN IF NOT EXISTS "raw_material_cost" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "manufacturing_boms" ADD COLUMN IF NOT EXISTS "fg_based_operating_cost" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "manufacturing_boms" ADD COLUMN IF NOT EXISTS "operating_cost_per_bom_quantity" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "manufacturing_boms" ADD COLUMN IF NOT EXISTS "rm_cost_as_per" TEXT DEFAULT 'Valuation Rate';
ALTER TABLE "manufacturing_boms" ADD COLUMN IF NOT EXISTS "buying_price_list" TEXT;
ALTER TABLE "manufacturing_boms" ADD COLUMN IF NOT EXISTS "currency" TEXT;
ALTER TABLE "manufacturing_boms" ADD COLUMN IF NOT EXISTS "conversion_rate" DOUBLE PRECISION NOT NULL DEFAULT 1;
ALTER TABLE "manufacturing_boms" ADD COLUMN IF NOT EXISTS "project" TEXT;
ALTER TABLE "manufacturing_boms" ADD COLUMN IF NOT EXISTS "exploded_items" JSONB NOT NULL DEFAULT '[]';

CREATE INDEX IF NOT EXISTS "manufacturing_boms_routing_id_idx" ON "manufacturing_boms"("routing_id");

DO $$ BEGIN
  ALTER TABLE "manufacturing_boms"
    ADD CONSTRAINT "manufacturing_boms_routing_id_fkey"
    FOREIGN KEY ("routing_id") REFERENCES "manufacturing_routings"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Production Plan ERPNext fields
ALTER TABLE "manufacturing_production_plans" ADD COLUMN IF NOT EXISTS "naming_series" TEXT NOT NULL DEFAULT 'MFG-PP-.YYYY.-';
ALTER TABLE "manufacturing_production_plans" ADD COLUMN IF NOT EXISTS "reserve_stock" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "manufacturing_production_plans" ADD COLUMN IF NOT EXISTS "from_delivery_date" TIMESTAMP(3);
ALTER TABLE "manufacturing_production_plans" ADD COLUMN IF NOT EXISTS "to_delivery_date" TIMESTAMP(3);
ALTER TABLE "manufacturing_production_plans" ADD COLUMN IF NOT EXISTS "item_code" TEXT;
ALTER TABLE "manufacturing_production_plans" ADD COLUMN IF NOT EXISTS "customer" TEXT;
ALTER TABLE "manufacturing_production_plans" ADD COLUMN IF NOT EXISTS "warehouse" TEXT;
ALTER TABLE "manufacturing_production_plans" ADD COLUMN IF NOT EXISTS "project" TEXT;
ALTER TABLE "manufacturing_production_plans" ADD COLUMN IF NOT EXISTS "sales_order_status" TEXT;
ALTER TABLE "manufacturing_production_plans" ADD COLUMN IF NOT EXISTS "combine_items" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "manufacturing_production_plans" ADD COLUMN IF NOT EXISTS "sales_orders" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "manufacturing_production_plans" ADD COLUMN IF NOT EXISTS "material_requests" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "manufacturing_production_plans" ADD COLUMN IF NOT EXISTS "po_items" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "manufacturing_production_plans" ADD COLUMN IF NOT EXISTS "sub_assembly_warehouse" TEXT;
ALTER TABLE "manufacturing_production_plans" ADD COLUMN IF NOT EXISTS "skip_available_sub_assembly_item" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "manufacturing_production_plans" ADD COLUMN IF NOT EXISTS "combine_sub_items" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "manufacturing_production_plans" ADD COLUMN IF NOT EXISTS "no_of_shifts" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "manufacturing_production_plans" ADD COLUMN IF NOT EXISTS "sub_assembly_items" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "manufacturing_production_plans" ADD COLUMN IF NOT EXISTS "include_non_stock_items" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "manufacturing_production_plans" ADD COLUMN IF NOT EXISTS "include_subcontracted_items" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "manufacturing_production_plans" ADD COLUMN IF NOT EXISTS "consider_minimum_order_qty" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "manufacturing_production_plans" ADD COLUMN IF NOT EXISTS "include_safety_stock" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "manufacturing_production_plans" ADD COLUMN IF NOT EXISTS "ignore_existing_ordered_qty" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "manufacturing_production_plans" ADD COLUMN IF NOT EXISTS "raw_material_group_warehouse" TEXT;
ALTER TABLE "manufacturing_production_plans" ADD COLUMN IF NOT EXISTS "for_warehouse" TEXT;
ALTER TABLE "manufacturing_production_plans" ADD COLUMN IF NOT EXISTS "mr_items" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "manufacturing_production_plans" ADD COLUMN IF NOT EXISTS "total_planned_qty" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "manufacturing_production_plans" ADD COLUMN IF NOT EXISTS "total_produced_qty" DOUBLE PRECISION NOT NULL DEFAULT 0;
