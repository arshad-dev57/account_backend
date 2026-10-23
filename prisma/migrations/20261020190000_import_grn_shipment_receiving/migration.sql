-- Import GRN: shipment-centric receiving, customs gate, qty variances, claims, settings

-- Shipment: Original B/L verification
ALTER TABLE "import_shipments"
  ADD COLUMN IF NOT EXISTS "original_bl_received" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "original_bl_received_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "original_bl_received_by" TEXT;

-- GRN header extensions
ALTER TABLE "import_grns"
  ADD COLUMN IF NOT EXISTS "customs_clearance_id" TEXT,
  ADD COLUMN IF NOT EXISTS "customs_ref" TEXT,
  ADD COLUMN IF NOT EXISTS "boe_number" TEXT,
  ADD COLUMN IF NOT EXISTS "is_legacy" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "is_bonded" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "early_receive_reason" TEXT,
  ADD COLUMN IF NOT EXISTS "cost_status" TEXT NOT NULL DEFAULT 'Provisional',
  ADD COLUMN IF NOT EXISTS "posted_by" TEXT,
  ADD COLUMN IF NOT EXISTS "posted_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "cancelled_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "cancel_reason" TEXT;

CREATE INDEX IF NOT EXISTS "import_grns_customs_clearance_id_idx" ON "import_grns"("customs_clearance_id");
CREATE INDEX IF NOT EXISTS "import_grns_shipment_id_idx" ON "import_grns"("shipment_id");

-- GRN line extensions
ALTER TABLE "import_grn_items"
  ADD COLUMN IF NOT EXISTS "shipment_item_id" TEXT,
  ADD COLUMN IF NOT EXISTS "shipped_qty" DECIMAL(18,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "short_qty" DECIMAL(18,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "damaged_qty" DECIMAL(18,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "short_reason" TEXT,
  ADD COLUMN IF NOT EXISTS "damaged_reason" TEXT,
  ADD COLUMN IF NOT EXISTS "rejected_reason" TEXT,
  ADD COLUMN IF NOT EXISTS "unit_cost_provisional" DECIMAL(18,4),
  ADD COLUMN IF NOT EXISTS "unit_cost_final" DECIMAL(18,4),
  ADD COLUMN IF NOT EXISTS "cost_status" TEXT NOT NULL DEFAULT 'Provisional',
  ADD COLUMN IF NOT EXISTS "stock_disposition" TEXT NOT NULL DEFAULT 'Sellable';

CREATE INDEX IF NOT EXISTS "import_grn_items_shipment_item_id_idx" ON "import_grn_items"("shipment_item_id");

-- Settings
ALTER TABLE "import_settings"
  ADD COLUMN IF NOT EXISTS "allow_grn_before_customs_release" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "require_separate_grn_poster" BOOLEAN NOT NULL DEFAULT true;

-- Supplier claims from short/damaged/rejected
CREATE TABLE IF NOT EXISTS "import_supplier_claims" (
  "id" TEXT NOT NULL,
  "company_id" TEXT NOT NULL,
  "claim_number" TEXT NOT NULL,
  "import_grn_id" TEXT,
  "import_grn_item_id" TEXT,
  "shipment_id" TEXT,
  "import_po_id" TEXT,
  "product_id" TEXT,
  "product_name" TEXT NOT NULL,
  "claim_type" TEXT NOT NULL,
  "quantity" DECIMAL(18,4) NOT NULL DEFAULT 0,
  "uom" TEXT NOT NULL DEFAULT 'PCS',
  "reason" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'Open',
  "notes" TEXT,
  "created_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "import_supplier_claims_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "import_supplier_claims_company_id_claim_number_key"
  ON "import_supplier_claims"("company_id", "claim_number");
CREATE INDEX IF NOT EXISTS "import_supplier_claims_company_id_status_idx"
  ON "import_supplier_claims"("company_id", "status");
CREATE INDEX IF NOT EXISTS "import_supplier_claims_import_grn_id_idx"
  ON "import_supplier_claims"("import_grn_id");
CREATE INDEX IF NOT EXISTS "import_supplier_claims_shipment_id_idx"
  ON "import_supplier_claims"("shipment_id");

DO $$ BEGIN
  ALTER TABLE "import_supplier_claims"
    ADD CONSTRAINT "import_supplier_claims_company_id_fkey"
    FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "import_supplier_claims"
    ADD CONSTRAINT "import_supplier_claims_import_grn_id_fkey"
    FOREIGN KEY ("import_grn_id") REFERENCES "import_grns"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "import_grns"
    ADD CONSTRAINT "import_grns_customs_clearance_id_fkey"
    FOREIGN KEY ("customs_clearance_id") REFERENCES "import_customs_clearances"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Mark legacy GRNs created without shipment or without released customs (idempotent, no deletes)
UPDATE "import_grns" g
SET "is_legacy" = true
WHERE g."is_legacy" = false
  AND (
    g."shipment_id" IS NULL
    OR NOT EXISTS (
      SELECT 1 FROM "import_customs_clearances" c
      WHERE c."shipment_id" = g."shipment_id"
        AND c."clearance_status" IN ('Released/Cleared', 'Cleared', 'Out of Charge', 'Released')
    )
  );
