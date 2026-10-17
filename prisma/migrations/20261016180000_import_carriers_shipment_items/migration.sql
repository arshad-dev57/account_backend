-- Import Carrier master + shipment logistics extensions

CREATE TABLE IF NOT EXISTS "import_carriers" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "carrier_type" TEXT NOT NULL DEFAULT 'Ocean',
    "country" TEXT,
    "contact_person" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "website" TEXT,
    "services_notes" TEXT,
    "tracking_url_template" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Active',
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "import_carriers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "import_carriers_company_id_code_key" ON "import_carriers"("company_id", "code");
CREATE INDEX IF NOT EXISTS "import_carriers_company_id_status_idx" ON "import_carriers"("company_id", "status");
CREATE INDEX IF NOT EXISTS "import_carriers_company_id_name_idx" ON "import_carriers"("company_id", "name");

DO $$ BEGIN
  ALTER TABLE "import_carriers" ADD CONSTRAINT "import_carriers_company_id_fkey"
    FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "import_carriers" ADD CONSTRAINT "import_carriers_created_by_fkey"
    FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Import PO commercial/logistics extensions
ALTER TABLE "import_purchase_orders" ADD COLUMN IF NOT EXISTS "quotation_id" TEXT;
ALTER TABLE "import_purchase_orders" ADD COLUMN IF NOT EXISTS "named_place" TEXT;
ALTER TABLE "import_purchase_orders" ADD COLUMN IF NOT EXISTS "origin_country" TEXT;
ALTER TABLE "import_purchase_orders" ADD COLUMN IF NOT EXISTS "shipping_method" TEXT;
ALTER TABLE "import_purchase_orders" ADD COLUMN IF NOT EXISTS "buyer_name" TEXT;
ALTER TABLE "import_purchase_orders" ADD COLUMN IF NOT EXISTS "internal_ref" TEXT;
ALTER TABLE "import_purchase_orders" ADD COLUMN IF NOT EXISTS "supplier_reference" TEXT;
ALTER TABLE "import_purchase_orders" ADD COLUMN IF NOT EXISTS "exchange_rate_date" TIMESTAMP(3);
ALTER TABLE "import_purchase_orders" ADD COLUMN IF NOT EXISTS "estimated_freight_usd" DECIMAL(18,4) NOT NULL DEFAULT 0;
ALTER TABLE "import_purchase_orders" ADD COLUMN IF NOT EXISTS "estimated_insurance_usd" DECIMAL(18,4) NOT NULL DEFAULT 0;
ALTER TABLE "import_purchase_orders" ADD COLUMN IF NOT EXISTS "estimated_duty_usd" DECIMAL(18,4) NOT NULL DEFAULT 0;
ALTER TABLE "import_purchase_orders" ADD COLUMN IF NOT EXISTS "advance_required_percent" DECIMAL(8,2) NOT NULL DEFAULT 0;
ALTER TABLE "import_purchase_orders" ADD COLUMN IF NOT EXISTS "lc_required" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "import_purchase_orders" ADD COLUMN IF NOT EXISTS "expected_delivery_date" TIMESTAMP(3);

-- Import shipment logistics extensions
ALTER TABLE "import_shipments" ADD COLUMN IF NOT EXISTS "carrier_id" TEXT;
ALTER TABLE "import_shipments" ADD COLUMN IF NOT EXISTS "carrier_manual_desc" TEXT;
ALTER TABLE "import_shipments" ADD COLUMN IF NOT EXISTS "shipment_mode" TEXT;
ALTER TABLE "import_shipments" ADD COLUMN IF NOT EXISTS "booking_ref" TEXT;
ALTER TABLE "import_shipments" ADD COLUMN IF NOT EXISTS "tracking_ref" TEXT;
ALTER TABLE "import_shipments" ADD COLUMN IF NOT EXISTS "final_delivery_location" TEXT;
ALTER TABLE "import_shipments" ADD COLUMN IF NOT EXISTS "shipping_instructions" TEXT;
ALTER TABLE "import_shipments" ADD COLUMN IF NOT EXISTS "actual_departure" TIMESTAMP(3);
ALTER TABLE "import_shipments" ADD COLUMN IF NOT EXISTS "actual_arrival" TIMESTAMP(3);
ALTER TABLE "import_shipments" ADD COLUMN IF NOT EXISTS "seal_number" TEXT;
ALTER TABLE "import_shipments" ADD COLUMN IF NOT EXISTS "package_count" DECIMAL(18,2) NOT NULL DEFAULT 0;
ALTER TABLE "import_shipments" ADD COLUMN IF NOT EXISTS "net_weight_kg" DECIMAL(18,2) NOT NULL DEFAULT 0;
ALTER TABLE "import_shipments" ADD COLUMN IF NOT EXISTS "estimated_freight_usd" DECIMAL(18,4) NOT NULL DEFAULT 0;
ALTER TABLE "import_shipments" ADD COLUMN IF NOT EXISTS "estimated_insurance_usd" DECIMAL(18,4) NOT NULL DEFAULT 0;
ALTER TABLE "import_shipments" ADD COLUMN IF NOT EXISTS "notes" TEXT;

DO $$ BEGIN
  ALTER TABLE "import_shipments" ADD CONSTRAINT "import_shipments_carrier_id_fkey"
    FOREIGN KEY ("carrier_id") REFERENCES "import_carriers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "import_shipments_carrier_id_idx" ON "import_shipments"("carrier_id");

CREATE TABLE IF NOT EXISTS "import_shipment_items" (
    "id" TEXT NOT NULL,
    "shipment_id" TEXT NOT NULL,
    "import_po_item_id" TEXT,
    "product_id" TEXT,
    "product_name" TEXT NOT NULL,
    "sku" TEXT,
    "quantity" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "uom" TEXT NOT NULL DEFAULT 'PCS',
    "package_count" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "net_weight_kg" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "gross_weight_kg" DECIMAL(18,4) NOT NULL DEFAULT 0,
    CONSTRAINT "import_shipment_items_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "import_shipment_items_shipment_id_idx" ON "import_shipment_items"("shipment_id");
CREATE INDEX IF NOT EXISTS "import_shipment_items_product_id_idx" ON "import_shipment_items"("product_id");
CREATE INDEX IF NOT EXISTS "import_shipment_items_import_po_item_id_idx" ON "import_shipment_items"("import_po_item_id");

DO $$ BEGIN
  ALTER TABLE "import_shipment_items" ADD CONSTRAINT "import_shipment_items_shipment_id_fkey"
    FOREIGN KEY ("shipment_id") REFERENCES "import_shipments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "import_shipment_items" ADD CONSTRAINT "import_shipment_items_product_id_fkey"
    FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
