-- Enterprise purchases flow: requisitions, multi-PO GRN, multi-source invoices

-- Purchase requisitions
CREATE TABLE IF NOT EXISTS "purchase_requisitions" (
    "id" TEXT NOT NULL,
    "requisition_number" TEXT NOT NULL,
    "title" TEXT,
    "department" TEXT,
    "priority" TEXT NOT NULL DEFAULT 'Normal',
    "required_date" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "suggested_supplier_id" TEXT,
    "suggested_supplier_name" TEXT,
    "notes" TEXT,
    "rejection_reason" TEXT,
    "submitted_at" TIMESTAMP(3),
    "approved_at" TIMESTAMP(3),
    "rejected_at" TIMESTAMP(3),
    "converted_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "approved_by" TEXT,
    "created_by" TEXT NOT NULL,
    "updated_by" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "company_id" TEXT,
    "location_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "purchase_requisitions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "purchase_requisition_items" (
    "id" TEXT NOT NULL,
    "purchase_requisition_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "product_name" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "estimated_unit_price" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "notes" TEXT,
    "purpose" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "purchase_requisition_items_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "purchase_requisitions_requisition_number_key" ON "purchase_requisitions"("requisition_number");
CREATE INDEX IF NOT EXISTS "purchase_requisitions_requisition_number_idx" ON "purchase_requisitions"("requisition_number");
CREATE INDEX IF NOT EXISTS "purchase_requisitions_status_idx" ON "purchase_requisitions"("status");
CREATE INDEX IF NOT EXISTS "purchase_requisitions_required_date_idx" ON "purchase_requisitions"("required_date");
CREATE INDEX IF NOT EXISTS "purchase_requisitions_is_active_idx" ON "purchase_requisitions"("is_active");
CREATE INDEX IF NOT EXISTS "purchase_requisitions_company_id_idx" ON "purchase_requisitions"("company_id");
CREATE INDEX IF NOT EXISTS "purchase_requisitions_location_id_idx" ON "purchase_requisitions"("location_id");
CREATE INDEX IF NOT EXISTS "purchase_requisitions_suggested_supplier_id_idx" ON "purchase_requisitions"("suggested_supplier_id");
CREATE INDEX IF NOT EXISTS "purchase_requisition_items_purchase_requisition_id_idx" ON "purchase_requisition_items"("purchase_requisition_id");
CREATE INDEX IF NOT EXISTS "purchase_requisition_items_product_id_idx" ON "purchase_requisition_items"("product_id");

-- Link POs to requisitions
ALTER TABLE "purchase_orders" ADD COLUMN IF NOT EXISTS "purchase_requisition_id" TEXT;
ALTER TABLE "purchase_orders" ADD COLUMN IF NOT EXISTS "purchase_requisition_number" TEXT;
CREATE INDEX IF NOT EXISTS "purchase_orders_purchase_requisition_id_idx" ON "purchase_orders"("purchase_requisition_id");

-- Multi-PO GRN support
ALTER TABLE "goods_receivings" ADD COLUMN IF NOT EXISTS "purchase_order_numbers" TEXT;
ALTER TABLE "goods_receiving_items" ADD COLUMN IF NOT EXISTS "purchase_order_id" TEXT;
ALTER TABLE "goods_receiving_items" ADD COLUMN IF NOT EXISTS "purchase_order_number" TEXT;
ALTER TABLE "goods_receiving_items" ADD COLUMN IF NOT EXISTS "unit_price" DOUBLE PRECISION NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS "goods_receiving_items_purchase_order_id_idx" ON "goods_receiving_items"("purchase_order_id");

CREATE TABLE IF NOT EXISTS "goods_receiving_purchase_orders" (
    "id" TEXT NOT NULL,
    "goods_receiving_id" TEXT NOT NULL,
    "purchase_order_id" TEXT NOT NULL,
    "purchase_order_number" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "goods_receiving_purchase_orders_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "goods_receiving_purchase_orders_goods_receiving_id_purchase_order_id_key"
  ON "goods_receiving_purchase_orders"("goods_receiving_id", "purchase_order_id");
CREATE INDEX IF NOT EXISTS "goods_receiving_purchase_orders_goods_receiving_id_idx" ON "goods_receiving_purchase_orders"("goods_receiving_id");
CREATE INDEX IF NOT EXISTS "goods_receiving_purchase_orders_purchase_order_id_idx" ON "goods_receiving_purchase_orders"("purchase_order_id");

-- Multi-source invoices
ALTER TABLE "purchase_invoices" ADD COLUMN IF NOT EXISTS "source_summary" TEXT;

CREATE TABLE IF NOT EXISTS "purchase_invoice_sources" (
    "id" TEXT NOT NULL,
    "invoice_id" TEXT NOT NULL,
    "source_type" TEXT NOT NULL,
    "goods_receiving_id" TEXT,
    "purchase_order_id" TEXT,
    "source_number" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "purchase_invoice_sources_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "purchase_invoice_sources_invoice_id_idx" ON "purchase_invoice_sources"("invoice_id");
CREATE INDEX IF NOT EXISTS "purchase_invoice_sources_goods_receiving_id_idx" ON "purchase_invoice_sources"("goods_receiving_id");
CREATE INDEX IF NOT EXISTS "purchase_invoice_sources_purchase_order_id_idx" ON "purchase_invoice_sources"("purchase_order_id");

-- FKs
ALTER TABLE "purchase_requisitions" DROP CONSTRAINT IF EXISTS "purchase_requisitions_suggested_supplier_id_fkey";
ALTER TABLE "purchase_requisitions" ADD CONSTRAINT "purchase_requisitions_suggested_supplier_id_fkey"
  FOREIGN KEY ("suggested_supplier_id") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "purchase_requisitions" DROP CONSTRAINT IF EXISTS "purchase_requisitions_created_by_fkey";
ALTER TABLE "purchase_requisitions" ADD CONSTRAINT "purchase_requisitions_created_by_fkey"
  FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "purchase_requisitions" DROP CONSTRAINT IF EXISTS "purchase_requisitions_updated_by_fkey";
ALTER TABLE "purchase_requisitions" ADD CONSTRAINT "purchase_requisitions_updated_by_fkey"
  FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "purchase_requisitions" DROP CONSTRAINT IF EXISTS "purchase_requisitions_approved_by_fkey";
ALTER TABLE "purchase_requisitions" ADD CONSTRAINT "purchase_requisitions_approved_by_fkey"
  FOREIGN KEY ("approved_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "purchase_requisitions" DROP CONSTRAINT IF EXISTS "purchase_requisitions_company_id_fkey";
ALTER TABLE "purchase_requisitions" ADD CONSTRAINT "purchase_requisitions_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "purchase_requisitions" DROP CONSTRAINT IF EXISTS "purchase_requisitions_location_id_fkey";
ALTER TABLE "purchase_requisitions" ADD CONSTRAINT "purchase_requisitions_location_id_fkey"
  FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "purchase_requisition_items" DROP CONSTRAINT IF EXISTS "purchase_requisition_items_purchase_requisition_id_fkey";
ALTER TABLE "purchase_requisition_items" ADD CONSTRAINT "purchase_requisition_items_purchase_requisition_id_fkey"
  FOREIGN KEY ("purchase_requisition_id") REFERENCES "purchase_requisitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "purchase_requisition_items" DROP CONSTRAINT IF EXISTS "purchase_requisition_items_product_id_fkey";
ALTER TABLE "purchase_requisition_items" ADD CONSTRAINT "purchase_requisition_items_product_id_fkey"
  FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "purchase_orders" DROP CONSTRAINT IF EXISTS "purchase_orders_purchase_requisition_id_fkey";
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_purchase_requisition_id_fkey"
  FOREIGN KEY ("purchase_requisition_id") REFERENCES "purchase_requisitions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "goods_receiving_purchase_orders" DROP CONSTRAINT IF EXISTS "goods_receiving_purchase_orders_goods_receiving_id_fkey";
ALTER TABLE "goods_receiving_purchase_orders" ADD CONSTRAINT "goods_receiving_purchase_orders_goods_receiving_id_fkey"
  FOREIGN KEY ("goods_receiving_id") REFERENCES "goods_receivings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "goods_receiving_purchase_orders" DROP CONSTRAINT IF EXISTS "goods_receiving_purchase_orders_purchase_order_id_fkey";
ALTER TABLE "goods_receiving_purchase_orders" ADD CONSTRAINT "goods_receiving_purchase_orders_purchase_order_id_fkey"
  FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "purchase_invoice_sources" DROP CONSTRAINT IF EXISTS "purchase_invoice_sources_invoice_id_fkey";
ALTER TABLE "purchase_invoice_sources" ADD CONSTRAINT "purchase_invoice_sources_invoice_id_fkey"
  FOREIGN KEY ("invoice_id") REFERENCES "purchase_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "purchase_invoice_sources" DROP CONSTRAINT IF EXISTS "purchase_invoice_sources_goods_receiving_id_fkey";
ALTER TABLE "purchase_invoice_sources" ADD CONSTRAINT "purchase_invoice_sources_goods_receiving_id_fkey"
  FOREIGN KEY ("goods_receiving_id") REFERENCES "goods_receivings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "purchase_invoice_sources" DROP CONSTRAINT IF EXISTS "purchase_invoice_sources_purchase_order_id_fkey";
ALTER TABLE "purchase_invoice_sources" ADD CONSTRAINT "purchase_invoice_sources_purchase_order_id_fkey"
  FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill GRN-PO links for existing single-PO GRNs
INSERT INTO "goods_receiving_purchase_orders" ("id", "goods_receiving_id", "purchase_order_id", "purchase_order_number", "created_at")
SELECT gen_random_uuid()::text, g."id", g."purchase_order_id", g."purchase_order_number", CURRENT_TIMESTAMP
FROM "goods_receivings" g
WHERE g."is_deleted" = false
  AND NOT EXISTS (
    SELECT 1 FROM "goods_receiving_purchase_orders" l
    WHERE l."goods_receiving_id" = g."id" AND l."purchase_order_id" = g."purchase_order_id"
  );

UPDATE "goods_receivings"
SET "purchase_order_numbers" = "purchase_order_number"
WHERE "purchase_order_numbers" IS NULL;

UPDATE "goods_receiving_items" gi
SET
  "purchase_order_id" = poi."purchase_order_id",
  "purchase_order_number" = po."order_number",
  "unit_price" = COALESCE(poi."unit_price", 0)
FROM "purchase_order_items" poi
JOIN "purchase_orders" po ON po."id" = poi."purchase_order_id"
WHERE gi."purchase_order_item_id" = poi."id"
  AND gi."purchase_order_id" IS NULL;
