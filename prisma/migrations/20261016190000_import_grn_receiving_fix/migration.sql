-- Import GRN receiving integrity: line refs, remaining snapshot, idempotency, stock post marker

ALTER TABLE "import_grns" ADD COLUMN IF NOT EXISTS "idempotency_key" TEXT;
ALTER TABLE "import_grns" ADD COLUMN IF NOT EXISTS "stock_posted_at" TIMESTAMP(3);

CREATE UNIQUE INDEX IF NOT EXISTS "import_grns_company_id_idempotency_key_key"
  ON "import_grns"("company_id", "idempotency_key");

ALTER TABLE "import_grn_items" ADD COLUMN IF NOT EXISTS "import_po_item_id" TEXT;
ALTER TABLE "import_grn_items" ADD COLUMN IF NOT EXISTS "sku" TEXT;
ALTER TABLE "import_grn_items" ADD COLUMN IF NOT EXISTS "previously_received_qty" DECIMAL(18,4) NOT NULL DEFAULT 0;
ALTER TABLE "import_grn_items" ADD COLUMN IF NOT EXISTS "remaining_qty" DECIMAL(18,4) NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS "import_grn_items_import_po_item_id_idx" ON "import_grn_items"("import_po_item_id");
