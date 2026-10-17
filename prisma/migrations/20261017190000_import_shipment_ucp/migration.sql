-- Import shipments: load type, B/L type, cargo fields, ETA history, carrier SCAC/IATA

ALTER TABLE "import_shipments" ADD COLUMN IF NOT EXISTS "load_type" TEXT;
ALTER TABLE "import_shipments" ADD COLUMN IF NOT EXISTS "bl_type" TEXT;
ALTER TABLE "import_shipments" ADD COLUMN IF NOT EXISTS "voyage_number" TEXT;
ALTER TABLE "import_shipments" ADD COLUMN IF NOT EXISTS "vessel_name" TEXT;
ALTER TABLE "import_shipments" ADD COLUMN IF NOT EXISTS "consignee" TEXT;
ALTER TABLE "import_shipments" ADD COLUMN IF NOT EXISTS "notify_party" TEXT;
ALTER TABLE "import_shipments" ADD COLUMN IF NOT EXISTS "proforma_id" TEXT;
ALTER TABLE "import_shipments" ADD COLUMN IF NOT EXISTS "pi_ref" TEXT;
ALTER TABLE "import_shipments" ADD COLUMN IF NOT EXISTS "finance_lc_id" TEXT;
ALTER TABLE "import_shipments" ADD COLUMN IF NOT EXISTS "lc_ref" TEXT;
ALTER TABLE "import_shipments" ADD COLUMN IF NOT EXISTS "origin_un_locode" TEXT;
ALTER TABLE "import_shipments" ADD COLUMN IF NOT EXISTS "destination_un_locode" TEXT;
ALTER TABLE "import_shipments" ADD COLUMN IF NOT EXISTS "incoterm" TEXT;
ALTER TABLE "import_shipments" ADD COLUMN IF NOT EXISTS "currency" TEXT;
ALTER TABLE "import_shipments" ADD COLUMN IF NOT EXISTS "eta_history" JSONB;
ALTER TABLE "import_shipments" ADD COLUMN IF NOT EXISTS "customs_office" TEXT;
ALTER TABLE "import_shipments" ADD COLUMN IF NOT EXISTS "warehouse_name" TEXT;

-- Drop misleading default on container_type (was auto '40ft HC')
ALTER TABLE "import_shipments" ALTER COLUMN "container_type" DROP DEFAULT;

-- Cleanup: clear fake LCL container numbers
UPDATE "import_shipments"
SET "container_no" = NULL
WHERE "container_no" IS NOT NULL
  AND lower(trim("container_no")) IN ('lcl', 'n/a', 'na', 'none', '-');

-- Cleanup: swap ETA/ETD when ETA is before ETD
UPDATE "import_shipments"
SET "eta" = "etd", "etd" = "eta"
WHERE "etd" IS NOT NULL AND "eta" IS NOT NULL AND "eta" < "etd";

-- Normalize legacy statuses
UPDATE "import_shipments" SET "shipment_status" = 'Arrived' WHERE "shipment_status" IN ('Arrived at Port', 'Arrived at Destination');
UPDATE "import_shipments" SET "shipment_status" = 'Cleared' WHERE "shipment_status" IN ('Customs Cleared', 'Customs Released');
UPDATE "import_shipments" SET "shipment_status" = 'Delivered/Received' WHERE "shipment_status" IN ('Delivered', 'Received');
UPDATE "import_shipments" SET "shipment_status" = 'Departed' WHERE "shipment_status" IN ('Departed (Loaded)', 'Loaded', 'Sailed');
UPDATE "import_shipments" SET "shipment_status" = 'Customs Clearance' WHERE "shipment_status" IN ('Under Customs', 'Customs');

CREATE INDEX IF NOT EXISTS "import_shipments_proforma_id_idx" ON "import_shipments"("proforma_id");
CREATE INDEX IF NOT EXISTS "import_shipments_finance_lc_id_idx" ON "import_shipments"("finance_lc_id");
CREATE INDEX IF NOT EXISTS "import_shipments_bl_number_idx" ON "import_shipments"("bl_number");
CREATE INDEX IF NOT EXISTS "import_shipments_container_no_idx" ON "import_shipments"("container_no");

-- Carrier SCAC / IATA
ALTER TABLE "import_carriers" ADD COLUMN IF NOT EXISTS "scac_code" TEXT;
ALTER TABLE "import_carriers" ADD COLUMN IF NOT EXISTS "iata_code" TEXT;

-- Import settings: require physical original B/L
ALTER TABLE "import_settings"
  ADD COLUMN IF NOT EXISTS "require_physical_original_bl" BOOLEAN NOT NULL DEFAULT true;
