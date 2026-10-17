-- Import Management Module Migration

-- 1. Import RFQs
CREATE TABLE IF NOT EXISTS "import_rfqs" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "rfq_number" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "supplier_id" TEXT,
    "supplier_name" TEXT NOT NULL,
    "supplier_country" TEXT,
    "incoterm" TEXT NOT NULL DEFAULT 'CIF',
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "port_of_discharge" TEXT,
    "expected_delivery" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "total_estimated_usd" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "import_rfqs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "import_rfqs_company_id_rfq_number_key" ON "import_rfqs"("company_id", "rfq_number");
CREATE INDEX IF NOT EXISTS "import_rfqs_company_id_status_idx" ON "import_rfqs"("company_id", "status");
CREATE INDEX IF NOT EXISTS "import_rfqs_supplier_id_idx" ON "import_rfqs"("supplier_id");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'import_rfqs_company_id_fkey') THEN
    ALTER TABLE "import_rfqs" ADD CONSTRAINT "import_rfqs_company_id_fkey"
      FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'import_rfqs_supplier_id_fkey') THEN
    ALTER TABLE "import_rfqs" ADD CONSTRAINT "import_rfqs_supplier_id_fkey"
      FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'import_rfqs_created_by_fkey') THEN
    ALTER TABLE "import_rfqs" ADD CONSTRAINT "import_rfqs_created_by_fkey"
      FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- 2. Import RFQ Items
CREATE TABLE IF NOT EXISTS "import_rfq_items" (
    "id" TEXT NOT NULL,
    "rfq_id" TEXT NOT NULL,
    "product_id" TEXT,
    "product_name" TEXT NOT NULL,
    "sku" TEXT,
    "hs_code" TEXT,
    "quantity" DECIMAL(18,4) NOT NULL DEFAULT 1,
    "uom" TEXT NOT NULL DEFAULT 'PCS',
    "target_price_usd" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "quoted_price_usd" DECIMAL(18,4),
    CONSTRAINT "import_rfq_items_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "import_rfq_items_rfq_id_idx" ON "import_rfq_items"("rfq_id");
CREATE INDEX IF NOT EXISTS "import_rfq_items_product_id_idx" ON "import_rfq_items"("product_id");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'import_rfq_items_rfq_id_fkey') THEN
    ALTER TABLE "import_rfq_items" ADD CONSTRAINT "import_rfq_items_rfq_id_fkey"
      FOREIGN KEY ("rfq_id") REFERENCES "import_rfqs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'import_rfq_items_product_id_fkey') THEN
    ALTER TABLE "import_rfq_items" ADD CONSTRAINT "import_rfq_items_product_id_fkey"
      FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- 3. Import Purchase Orders
CREATE TABLE IF NOT EXISTS "import_purchase_orders" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "po_number" TEXT NOT NULL,
    "rfq_id" TEXT,
    "rfq_ref" TEXT,
    "pi_ref" TEXT,
    "order_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "supplier_id" TEXT,
    "supplier_name" TEXT NOT NULL,
    "supplier_country" TEXT,
    "incoterm" TEXT NOT NULL DEFAULT 'CIF',
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "exchange_rate_to_usd" DECIMAL(18,8) NOT NULL DEFAULT 1,
    "subtotal_foreign" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "total_usd" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "payment_terms" TEXT,
    "port_of_loading" TEXT,
    "port_of_entry" TEXT,
    "estimated_arrival" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "purchase_order_id" TEXT,
    "notes" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "import_purchase_orders_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "import_purchase_orders_company_id_po_number_key" ON "import_purchase_orders"("company_id", "po_number");
CREATE INDEX IF NOT EXISTS "import_purchase_orders_company_id_status_idx" ON "import_purchase_orders"("company_id", "status");
CREATE INDEX IF NOT EXISTS "import_purchase_orders_supplier_id_idx" ON "import_purchase_orders"("supplier_id");
CREATE INDEX IF NOT EXISTS "import_purchase_orders_purchase_order_id_idx" ON "import_purchase_orders"("purchase_order_id");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'import_purchase_orders_company_id_fkey') THEN
    ALTER TABLE "import_purchase_orders" ADD CONSTRAINT "import_purchase_orders_company_id_fkey"
      FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'import_purchase_orders_supplier_id_fkey') THEN
    ALTER TABLE "import_purchase_orders" ADD CONSTRAINT "import_purchase_orders_supplier_id_fkey"
      FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'import_purchase_orders_rfq_id_fkey') THEN
    ALTER TABLE "import_purchase_orders" ADD CONSTRAINT "import_purchase_orders_rfq_id_fkey"
      FOREIGN KEY ("rfq_id") REFERENCES "import_rfqs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'import_purchase_orders_purchase_order_id_fkey') THEN
    ALTER TABLE "import_purchase_orders" ADD CONSTRAINT "import_purchase_orders_purchase_order_id_fkey"
      FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'import_purchase_orders_created_by_fkey') THEN
    ALTER TABLE "import_purchase_orders" ADD CONSTRAINT "import_purchase_orders_created_by_fkey"
      FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- 4. Import Purchase Order Items
CREATE TABLE IF NOT EXISTS "import_purchase_order_items" (
    "id" TEXT NOT NULL,
    "import_po_id" TEXT NOT NULL,
    "product_id" TEXT,
    "product_name" TEXT NOT NULL,
    "sku" TEXT,
    "quantity" DECIMAL(18,4) NOT NULL DEFAULT 1,
    "uom" TEXT NOT NULL DEFAULT 'PCS',
    "unit_price" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "total_amount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "received_qty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    CONSTRAINT "import_purchase_order_items_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "import_purchase_order_items_import_po_id_idx" ON "import_purchase_order_items"("import_po_id");
CREATE INDEX IF NOT EXISTS "import_purchase_order_items_product_id_idx" ON "import_purchase_order_items"("product_id");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'import_purchase_order_items_import_po_id_fkey') THEN
    ALTER TABLE "import_purchase_order_items" ADD CONSTRAINT "import_purchase_order_items_import_po_id_fkey"
      FOREIGN KEY ("import_po_id") REFERENCES "import_purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'import_purchase_order_items_product_id_fkey') THEN
    ALTER TABLE "import_purchase_order_items" ADD CONSTRAINT "import_purchase_order_items_product_id_fkey"
      FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- 5. Import Proforma Invoices
CREATE TABLE IF NOT EXISTS "import_proforma_invoices" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "pi_number" TEXT NOT NULL,
    "import_po_id" TEXT,
    "po_ref" TEXT,
    "supplier_name" TEXT NOT NULL,
    "issue_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "valid_until" TIMESTAMP(3),
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "amount_foreign" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "amount_usd" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "advance_required_percent" DECIMAL(8,2) NOT NULL DEFAULT 0,
    "advance_amount_usd" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "lc_required" BOOLEAN NOT NULL DEFAULT false,
    "lc_number" TEXT,
    "bank_swift" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Received',
    "payment_made_id" TEXT,
    "notes" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "import_proforma_invoices_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "import_proforma_invoices_company_id_pi_number_key" ON "import_proforma_invoices"("company_id", "pi_number");
CREATE INDEX IF NOT EXISTS "import_proforma_invoices_company_id_status_idx" ON "import_proforma_invoices"("company_id", "status");
CREATE INDEX IF NOT EXISTS "import_proforma_invoices_import_po_id_idx" ON "import_proforma_invoices"("import_po_id");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'import_proforma_invoices_company_id_fkey') THEN
    ALTER TABLE "import_proforma_invoices" ADD CONSTRAINT "import_proforma_invoices_company_id_fkey"
      FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'import_proforma_invoices_import_po_id_fkey') THEN
    ALTER TABLE "import_proforma_invoices" ADD CONSTRAINT "import_proforma_invoices_import_po_id_fkey"
      FOREIGN KEY ("import_po_id") REFERENCES "import_purchase_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'import_proforma_invoices_created_by_fkey') THEN
    ALTER TABLE "import_proforma_invoices" ADD CONSTRAINT "import_proforma_invoices_created_by_fkey"
      FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- 6. Import Shipments
CREATE TABLE IF NOT EXISTS "import_shipments" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "shipment_number" TEXT NOT NULL,
    "import_po_id" TEXT,
    "po_ref" TEXT,
    "supplier_name" TEXT,
    "carrier" TEXT,
    "bl_number" TEXT,
    "origin_port" TEXT,
    "port_of_entry" TEXT,
    "vessel_flight" TEXT,
    "etd" TIMESTAMP(3),
    "eta" TIMESTAMP(3),
    "container_no" TEXT,
    "container_type" TEXT DEFAULT '40ft HC',
    "gross_weight_kg" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "cbm" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "shipment_status" TEXT NOT NULL DEFAULT 'Booking Confirmed',
    "current_milestone" TEXT,
    "milestones" JSONB,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "import_shipments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "import_shipments_company_id_shipment_number_key" ON "import_shipments"("company_id", "shipment_number");
CREATE INDEX IF NOT EXISTS "import_shipments_company_id_shipment_status_idx" ON "import_shipments"("company_id", "shipment_status");
CREATE INDEX IF NOT EXISTS "import_shipments_import_po_id_idx" ON "import_shipments"("import_po_id");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'import_shipments_company_id_fkey') THEN
    ALTER TABLE "import_shipments" ADD CONSTRAINT "import_shipments_company_id_fkey"
      FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'import_shipments_import_po_id_fkey') THEN
    ALTER TABLE "import_shipments" ADD CONSTRAINT "import_shipments_import_po_id_fkey"
      FOREIGN KEY ("import_po_id") REFERENCES "import_purchase_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'import_shipments_created_by_fkey') THEN
    ALTER TABLE "import_shipments" ADD CONSTRAINT "import_shipments_created_by_fkey"
      FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- 7. Import Customs Clearances
CREATE TABLE IF NOT EXISTS "import_customs_clearances" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "entry_number" TEXT NOT NULL,
    "bill_of_entry_no" TEXT NOT NULL,
    "import_po_id" TEXT,
    "po_ref" TEXT,
    "shipment_id" TEXT,
    "shipment_ref" TEXT,
    "port_of_entry" TEXT,
    "declaration_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "customs_broker" TEXT,
    "cif_value_usd" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "customs_duty_rate_pct" DECIMAL(8,2) NOT NULL DEFAULT 0,
    "customs_duty_usd" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "import_vat_usd" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "port_handling_charges_usd" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "inspection_fee_usd" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "total_customs_payable_usd" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "clearance_status" TEXT NOT NULL DEFAULT 'Under Assessment',
    "duty_payment_ref" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "import_customs_clearances_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "import_customs_clearances_company_id_entry_number_key" ON "import_customs_clearances"("company_id", "entry_number");
CREATE INDEX IF NOT EXISTS "import_customs_clearances_company_id_clearance_status_idx" ON "import_customs_clearances"("company_id", "clearance_status");
CREATE INDEX IF NOT EXISTS "import_customs_clearances_import_po_id_idx" ON "import_customs_clearances"("import_po_id");
CREATE INDEX IF NOT EXISTS "import_customs_clearances_shipment_id_idx" ON "import_customs_clearances"("shipment_id");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'import_customs_clearances_company_id_fkey') THEN
    ALTER TABLE "import_customs_clearances" ADD CONSTRAINT "import_customs_clearances_company_id_fkey"
      FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'import_customs_clearances_import_po_id_fkey') THEN
    ALTER TABLE "import_customs_clearances" ADD CONSTRAINT "import_customs_clearances_import_po_id_fkey"
      FOREIGN KEY ("import_po_id") REFERENCES "import_purchase_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'import_customs_clearances_shipment_id_fkey') THEN
    ALTER TABLE "import_customs_clearances" ADD CONSTRAINT "import_customs_clearances_shipment_id_fkey"
      FOREIGN KEY ("shipment_id") REFERENCES "import_shipments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'import_customs_clearances_created_by_fkey') THEN
    ALTER TABLE "import_customs_clearances" ADD CONSTRAINT "import_customs_clearances_created_by_fkey"
      FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- 8. Import Documents
CREATE TABLE IF NOT EXISTS "import_documents" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "doc_number" TEXT NOT NULL,
    "doc_type" TEXT NOT NULL,
    "import_po_id" TEXT,
    "po_ref" TEXT,
    "shipment_id" TEXT,
    "shipment_ref" TEXT,
    "issuer" TEXT,
    "issue_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiry_date" TIMESTAMP(3),
    "original_received" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'Pending Review',
    "file_url" TEXT,
    "file_placeholder" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "import_documents_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "import_documents_company_id_doc_number_key" ON "import_documents"("company_id", "doc_number");
CREATE INDEX IF NOT EXISTS "import_documents_company_id_status_idx" ON "import_documents"("company_id", "status");
CREATE INDEX IF NOT EXISTS "import_documents_import_po_id_idx" ON "import_documents"("import_po_id");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'import_documents_company_id_fkey') THEN
    ALTER TABLE "import_documents" ADD CONSTRAINT "import_documents_company_id_fkey"
      FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'import_documents_import_po_id_fkey') THEN
    ALTER TABLE "import_documents" ADD CONSTRAINT "import_documents_import_po_id_fkey"
      FOREIGN KEY ("import_po_id") REFERENCES "import_purchase_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'import_documents_shipment_id_fkey') THEN
    ALTER TABLE "import_documents" ADD CONSTRAINT "import_documents_shipment_id_fkey"
      FOREIGN KEY ("shipment_id") REFERENCES "import_shipments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'import_documents_created_by_fkey') THEN
    ALTER TABLE "import_documents" ADD CONSTRAINT "import_documents_created_by_fkey"
      FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- 9. Import GRNs
CREATE TABLE IF NOT EXISTS "import_grns" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "grn_number" TEXT NOT NULL,
    "import_po_id" TEXT,
    "po_ref" TEXT,
    "shipment_id" TEXT,
    "shipment_ref" TEXT,
    "location_id" TEXT,
    "warehouse_name" TEXT,
    "receipt_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "container_no" TEXT,
    "seal_intact" BOOLEAN NOT NULL DEFAULT true,
    "received_by" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "goods_receiving_id" TEXT,
    "notes" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "import_grns_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "import_grns_company_id_grn_number_key" ON "import_grns"("company_id", "grn_number");
CREATE INDEX IF NOT EXISTS "import_grns_company_id_status_idx" ON "import_grns"("company_id", "status");
CREATE INDEX IF NOT EXISTS "import_grns_import_po_id_idx" ON "import_grns"("import_po_id");
CREATE INDEX IF NOT EXISTS "import_grns_goods_receiving_id_idx" ON "import_grns"("goods_receiving_id");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'import_grns_company_id_fkey') THEN
    ALTER TABLE "import_grns" ADD CONSTRAINT "import_grns_company_id_fkey"
      FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'import_grns_import_po_id_fkey') THEN
    ALTER TABLE "import_grns" ADD CONSTRAINT "import_grns_import_po_id_fkey"
      FOREIGN KEY ("import_po_id") REFERENCES "import_purchase_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'import_grns_shipment_id_fkey') THEN
    ALTER TABLE "import_grns" ADD CONSTRAINT "import_grns_shipment_id_fkey"
      FOREIGN KEY ("shipment_id") REFERENCES "import_shipments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'import_grns_location_id_fkey') THEN
    ALTER TABLE "import_grns" ADD CONSTRAINT "import_grns_location_id_fkey"
      FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'import_grns_goods_receiving_id_fkey') THEN
    ALTER TABLE "import_grns" ADD CONSTRAINT "import_grns_goods_receiving_id_fkey"
      FOREIGN KEY ("goods_receiving_id") REFERENCES "goods_receivings"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'import_grns_created_by_fkey') THEN
    ALTER TABLE "import_grns" ADD CONSTRAINT "import_grns_created_by_fkey"
      FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- 10. Import GRN Items
CREATE TABLE IF NOT EXISTS "import_grn_items" (
    "id" TEXT NOT NULL,
    "import_grn_id" TEXT NOT NULL,
    "product_id" TEXT,
    "product_name" TEXT NOT NULL,
    "ordered_qty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "received_qty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "accepted_qty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "rejected_qty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "uom" TEXT NOT NULL DEFAULT 'PCS',
    "lot_number" TEXT,
    CONSTRAINT "import_grn_items_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "import_grn_items_import_grn_id_idx" ON "import_grn_items"("import_grn_id");
CREATE INDEX IF NOT EXISTS "import_grn_items_product_id_idx" ON "import_grn_items"("product_id");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'import_grn_items_import_grn_id_fkey') THEN
    ALTER TABLE "import_grn_items" ADD CONSTRAINT "import_grn_items_import_grn_id_fkey"
      FOREIGN KEY ("import_grn_id") REFERENCES "import_grns"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'import_grn_items_product_id_fkey') THEN
    ALTER TABLE "import_grn_items" ADD CONSTRAINT "import_grn_items_product_id_fkey"
      FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- 11. Import Landed Costs
CREATE TABLE IF NOT EXISTS "import_landed_costs" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "allocation_number" TEXT NOT NULL,
    "import_po_id" TEXT,
    "po_ref" TEXT,
    "shipment_id" TEXT,
    "shipment_ref" TEXT,
    "grn_id" TEXT,
    "grn_ref" TEXT,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "purchase_fob_total_usd" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "ocean_freight_usd" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "customs_duty_usd" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "marine_insurance_usd" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "port_demurrage_and_handling_usd" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "clearing_agency_charges_usd" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "inland_transportation_usd" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "total_landed_expenses_usd" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "total_final_landed_cost_usd" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "allocation_method" TEXT NOT NULL DEFAULT 'By Item Value',
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "journal_entry_id" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "import_landed_costs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "import_landed_costs_company_id_allocation_number_key" ON "import_landed_costs"("company_id", "allocation_number");
CREATE INDEX IF NOT EXISTS "import_landed_costs_company_id_status_idx" ON "import_landed_costs"("company_id", "status");
CREATE INDEX IF NOT EXISTS "import_landed_costs_import_po_id_idx" ON "import_landed_costs"("import_po_id");
CREATE INDEX IF NOT EXISTS "import_landed_costs_grn_id_idx" ON "import_landed_costs"("grn_id");
CREATE INDEX IF NOT EXISTS "import_landed_costs_journal_entry_id_idx" ON "import_landed_costs"("journal_entry_id");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'import_landed_costs_company_id_fkey') THEN
    ALTER TABLE "import_landed_costs" ADD CONSTRAINT "import_landed_costs_company_id_fkey"
      FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'import_landed_costs_import_po_id_fkey') THEN
    ALTER TABLE "import_landed_costs" ADD CONSTRAINT "import_landed_costs_import_po_id_fkey"
      FOREIGN KEY ("import_po_id") REFERENCES "import_purchase_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'import_landed_costs_shipment_id_fkey') THEN
    ALTER TABLE "import_landed_costs" ADD CONSTRAINT "import_landed_costs_shipment_id_fkey"
      FOREIGN KEY ("shipment_id") REFERENCES "import_shipments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'import_landed_costs_grn_id_fkey') THEN
    ALTER TABLE "import_landed_costs" ADD CONSTRAINT "import_landed_costs_grn_id_fkey"
      FOREIGN KEY ("grn_id") REFERENCES "import_grns"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'import_landed_costs_journal_entry_id_fkey') THEN
    ALTER TABLE "import_landed_costs" ADD CONSTRAINT "import_landed_costs_journal_entry_id_fkey"
      FOREIGN KEY ("journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'import_landed_costs_created_by_fkey') THEN
    ALTER TABLE "import_landed_costs" ADD CONSTRAINT "import_landed_costs_created_by_fkey"
      FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- 12. Import Landed Cost Items
CREATE TABLE IF NOT EXISTS "import_landed_cost_items" (
    "id" TEXT NOT NULL,
    "landed_cost_id" TEXT NOT NULL,
    "product_id" TEXT,
    "product_name" TEXT NOT NULL,
    "qty" DECIMAL(18,4) NOT NULL DEFAULT 1,
    "unit_fob_usd" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "allocated_expense_per_unit_usd" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "final_landed_cost_per_unit_usd" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "original_cost_variance_pct" DECIMAL(8,2) NOT NULL DEFAULT 0,
    CONSTRAINT "import_landed_cost_items_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "import_landed_cost_items_landed_cost_id_idx" ON "import_landed_cost_items"("landed_cost_id");
CREATE INDEX IF NOT EXISTS "import_landed_cost_items_product_id_idx" ON "import_landed_cost_items"("product_id");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'import_landed_cost_items_landed_cost_id_fkey') THEN
    ALTER TABLE "import_landed_cost_items" ADD CONSTRAINT "import_landed_cost_items_landed_cost_id_fkey"
      FOREIGN KEY ("landed_cost_id") REFERENCES "import_landed_costs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'import_landed_cost_items_product_id_fkey') THEN
    ALTER TABLE "import_landed_cost_items" ADD CONSTRAINT "import_landed_cost_items_product_id_fkey"
      FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- 13. Import Finance LCs
CREATE TABLE IF NOT EXISTS "import_finance_lcs" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "lc_number" TEXT NOT NULL,
    "import_po_id" TEXT,
    "po_ref" TEXT,
    "pi_ref" TEXT,
    "lc_type" TEXT NOT NULL DEFAULT 'Irrevocable Confirmed Sight LC',
    "issuing_bank" TEXT,
    "advising_bank" TEXT,
    "beneficiary" TEXT,
    "lc_amount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "issuance_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiry_date" TIMESTAMP(3),
    "latest_shipment_date" TIMESTAMP(3),
    "margin_percent" DECIMAL(8,2) NOT NULL DEFAULT 0,
    "cash_margin_blocked_usd" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "bank_charges_usd" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'Application Submitted',
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "import_finance_lcs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "import_finance_lcs_company_id_lc_number_key" ON "import_finance_lcs"("company_id", "lc_number");
CREATE INDEX IF NOT EXISTS "import_finance_lcs_company_id_status_idx" ON "import_finance_lcs"("company_id", "status");
CREATE INDEX IF NOT EXISTS "import_finance_lcs_import_po_id_idx" ON "import_finance_lcs"("import_po_id");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'import_finance_lcs_company_id_fkey') THEN
    ALTER TABLE "import_finance_lcs" ADD CONSTRAINT "import_finance_lcs_company_id_fkey"
      FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'import_finance_lcs_import_po_id_fkey') THEN
    ALTER TABLE "import_finance_lcs" ADD CONSTRAINT "import_finance_lcs_import_po_id_fkey"
      FOREIGN KEY ("import_po_id") REFERENCES "import_purchase_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'import_finance_lcs_created_by_fkey') THEN
    ALTER TABLE "import_finance_lcs" ADD CONSTRAINT "import_finance_lcs_created_by_fkey"
      FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- 14. Import Supplier Bills
CREATE TABLE IF NOT EXISTS "import_supplier_bills" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "bill_number" TEXT NOT NULL,
    "import_po_id" TEXT,
    "po_ref" TEXT,
    "supplier_name" TEXT NOT NULL,
    "bill_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "due_date" TIMESTAMP(3),
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "total_amount_foreign" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "total_amount_usd" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "paid_amount_usd" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "balance_usd" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "payment_terms" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Pending Approval',
    "purchase_invoice_id" TEXT,
    "linked_purchase_bill_url" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "import_supplier_bills_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "import_supplier_bills_company_id_bill_number_key" ON "import_supplier_bills"("company_id", "bill_number");
CREATE INDEX IF NOT EXISTS "import_supplier_bills_company_id_status_idx" ON "import_supplier_bills"("company_id", "status");
CREATE INDEX IF NOT EXISTS "import_supplier_bills_import_po_id_idx" ON "import_supplier_bills"("import_po_id");
CREATE INDEX IF NOT EXISTS "import_supplier_bills_purchase_invoice_id_idx" ON "import_supplier_bills"("purchase_invoice_id");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'import_supplier_bills_company_id_fkey') THEN
    ALTER TABLE "import_supplier_bills" ADD CONSTRAINT "import_supplier_bills_company_id_fkey"
      FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'import_supplier_bills_import_po_id_fkey') THEN
    ALTER TABLE "import_supplier_bills" ADD CONSTRAINT "import_supplier_bills_import_po_id_fkey"
      FOREIGN KEY ("import_po_id") REFERENCES "import_purchase_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'import_supplier_bills_purchase_invoice_id_fkey') THEN
    ALTER TABLE "import_supplier_bills" ADD CONSTRAINT "import_supplier_bills_purchase_invoice_id_fkey"
      FOREIGN KEY ("purchase_invoice_id") REFERENCES "purchase_invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'import_supplier_bills_created_by_fkey') THEN
    ALTER TABLE "import_supplier_bills" ADD CONSTRAINT "import_supplier_bills_created_by_fkey"
      FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- 15. Import Settings
CREATE TABLE IF NOT EXISTS "import_settings" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "default_incoterm" TEXT NOT NULL DEFAULT 'CIF',
    "default_currency" TEXT NOT NULL DEFAULT 'USD',
    "default_customs_broker" TEXT,
    "default_port_of_entry" TEXT,
    "auto_create_purchase_order" BOOLEAN NOT NULL DEFAULT true,
    "default_receiving_location_id" TEXT,
    "clearing_account_id" TEXT,
    "customs_duty_account_id" TEXT,
    "freight_account_id" TEXT,
    "insurance_account_id" TEXT,
    "handling_account_id" TEXT,
    "inventory_asset_account_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "import_settings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "import_settings_company_id_key" ON "import_settings"("company_id");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'import_settings_company_id_fkey') THEN
    ALTER TABLE "import_settings" ADD CONSTRAINT "import_settings_company_id_fkey"
      FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- 16. Import Audit Logs
CREATE TABLE IF NOT EXISTS "import_audit_logs" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "details" JSONB,
    "user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "import_audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "import_audit_logs_company_id_created_at_idx" ON "import_audit_logs"("company_id", "created_at");
CREATE INDEX IF NOT EXISTS "import_audit_logs_entity_type_entity_id_idx" ON "import_audit_logs"("entity_type", "entity_id");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'import_audit_logs_company_id_fkey') THEN
    ALTER TABLE "import_audit_logs" ADD CONSTRAINT "import_audit_logs_company_id_fkey"
      FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'import_audit_logs_user_id_fkey') THEN
    ALTER TABLE "import_audit_logs" ADD CONSTRAINT "import_audit_logs_user_id_fkey"
      FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
