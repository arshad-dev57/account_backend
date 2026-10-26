-- CreateTable
CREATE TABLE "export_inquiries" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "inquiry_number" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "customer_id" TEXT,
    "customer_name" TEXT NOT NULL,
    "customer_country" TEXT,
    "destination_port" TEXT,
    "destination_port_code" TEXT,
    "incoterm" TEXT NOT NULL DEFAULT 'FOB',
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "exchange_rate" DECIMAL(18,8) NOT NULL DEFAULT 1,
    "exchange_rate_date" TIMESTAMP(3),
    "rate_source" TEXT,
    "base_currency_code" TEXT,
    "estimated_revenue_foreign" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "estimated_revenue_base" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "target_dispatch_date" TIMESTAMP(3),
    "lead_stage" TEXT NOT NULL DEFAULT 'New Inquiry',
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "converted_quotation_id" TEXT,
    "notes" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "export_inquiries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "export_inquiry_items" (
    "id" TEXT NOT NULL,
    "inquiry_id" TEXT NOT NULL,
    "product_id" TEXT,
    "product_name" TEXT NOT NULL,
    "sku" TEXT,
    "requested_qty" DECIMAL(18,4) NOT NULL DEFAULT 1,
    "uom" TEXT NOT NULL DEFAULT 'PCS',
    "target_price_foreign" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "target_price_base" DECIMAL(18,4) NOT NULL DEFAULT 0,

    CONSTRAINT "export_inquiry_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "export_quotations" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "quote_number" TEXT NOT NULL,
    "inquiry_id" TEXT,
    "quote_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "valid_until" TIMESTAMP(3),
    "customer_id" TEXT,
    "customer_name" TEXT NOT NULL,
    "customer_country" TEXT,
    "incoterm" TEXT NOT NULL DEFAULT 'FOB',
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "exchange_rate" DECIMAL(18,8) NOT NULL DEFAULT 1,
    "exchange_rate_date" TIMESTAMP(3),
    "rate_source" TEXT,
    "base_currency_code" TEXT,
    "port_of_loading" TEXT,
    "port_of_discharge" TEXT,
    "subtotal_foreign" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "subtotal_base" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "freight_foreign" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "freight_base" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "insurance_foreign" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "insurance_base" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "total_foreign" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "total_base" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "payment_terms" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "approved_by" TEXT,
    "approved_at" TIMESTAMP(3),
    "converted_order_id" TEXT,
    "notes" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "export_quotations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "export_quotation_items" (
    "id" TEXT NOT NULL,
    "quotation_id" TEXT NOT NULL,
    "product_id" TEXT,
    "product_name" TEXT NOT NULL,
    "sku" TEXT,
    "quantity" DECIMAL(18,4) NOT NULL DEFAULT 1,
    "uom" TEXT NOT NULL DEFAULT 'PCS',
    "unit_price_foreign" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "unit_price_base" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "discount_foreign" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "line_total_foreign" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "line_total_base" DECIMAL(18,4) NOT NULL DEFAULT 0,

    CONSTRAINT "export_quotation_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "export_sales_orders" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "order_number" TEXT NOT NULL,
    "quotation_id" TEXT,
    "inquiry_id" TEXT,
    "customer_id" TEXT NOT NULL,
    "customer_name" TEXT NOT NULL,
    "customer_country" TEXT,
    "destination_port" TEXT,
    "destination_port_code" TEXT,
    "incoterm" TEXT NOT NULL DEFAULT 'FOB',
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "exchange_rate" DECIMAL(18,8) NOT NULL DEFAULT 1,
    "exchange_rate_date" TIMESTAMP(3),
    "rate_source" TEXT,
    "base_currency_code" TEXT,
    "order_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "delivery_deadline" TIMESTAMP(3),
    "subtotal_foreign" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "subtotal_base" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "freight_foreign" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "freight_base" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "discount_foreign" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "discount_base" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "total_foreign" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "total_base" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "advance_received_base" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "advance_applied_base" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "invoiced_base" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "paid_base" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "outstanding_base" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "payment_terms" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "approved_by" TEXT,
    "approved_at" TIMESTAMP(3),
    "location_id" TEXT,
    "notes" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "export_sales_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "export_sales_order_items" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "product_name" TEXT NOT NULL,
    "sku" TEXT,
    "quantity" DECIMAL(18,4) NOT NULL DEFAULT 1,
    "uom" TEXT NOT NULL DEFAULT 'PCS',
    "unit_price_foreign" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "unit_price_base" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "discount_foreign" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "line_total_foreign" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "line_total_base" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "shipped_qty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "invoiced_qty" DECIMAL(18,4) NOT NULL DEFAULT 0,

    CONSTRAINT "export_sales_order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "export_proforma_invoices" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "pi_number" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "customer_name" TEXT NOT NULL,
    "customer_country" TEXT,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "exchange_rate" DECIMAL(18,8) NOT NULL DEFAULT 1,
    "exchange_rate_date" TIMESTAMP(3),
    "rate_source" TEXT,
    "base_currency_code" TEXT,
    "amount_foreign" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "amount_base" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "bank_swift_code" TEXT,
    "beneficiary_account" TEXT,
    "lc_number" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Issued',
    "advance_received_base" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "export_proforma_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "export_packings" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "packing_list_no" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "shipment_id" TEXT,
    "packing_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "container_no" TEXT,
    "seal_no" TEXT,
    "container_type" TEXT,
    "total_gross_weight_kg" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "total_net_weight_kg" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "total_cbm" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "packages_count" INTEGER NOT NULL DEFAULT 0,
    "inspection_agency" TEXT,
    "inspection_certificate_no" TEXT,
    "inspection_status" TEXT NOT NULL DEFAULT 'Inspection Scheduled',
    "notes" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "export_packings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "export_packing_items" (
    "id" TEXT NOT NULL,
    "packing_id" TEXT NOT NULL,
    "product_id" TEXT,
    "product_name" TEXT NOT NULL,
    "sku" TEXT,
    "quantity" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "uom" TEXT NOT NULL DEFAULT 'PCS',
    "packages" INTEGER NOT NULL DEFAULT 0,
    "gross_weight_kg" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "net_weight_kg" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "cbm" DECIMAL(18,4) NOT NULL DEFAULT 0,

    CONSTRAINT "export_packing_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "export_shipments" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "shipment_number" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "customer_name" TEXT NOT NULL,
    "customer_country" TEXT,
    "shipping_line" TEXT,
    "booking_ref" TEXT,
    "bl_number" TEXT,
    "port_of_loading" TEXT,
    "port_of_discharge" TEXT,
    "vessel_name" TEXT,
    "etd" TIMESTAMP(3),
    "eta" TIMESTAMP(3),
    "shipment_status" TEXT NOT NULL DEFAULT 'Booking Confirmed',
    "current_position" TEXT,
    "location_id" TEXT,
    "notes" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "export_shipments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "export_shipment_items" (
    "id" TEXT NOT NULL,
    "shipment_id" TEXT NOT NULL,
    "order_item_id" TEXT,
    "product_id" TEXT NOT NULL,
    "product_name" TEXT NOT NULL,
    "sku" TEXT,
    "quantity" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "uom" TEXT NOT NULL DEFAULT 'PCS',
    "unit_price_foreign" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "unit_price_base" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "line_total_foreign" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "line_total_base" DECIMAL(18,4) NOT NULL DEFAULT 0,

    CONSTRAINT "export_shipment_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "export_customs_declarations" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "shipping_bill_no" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "shipment_id" TEXT,
    "export_port" TEXT,
    "declaration_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fob_value_foreign" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "fob_value_base" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "customs_agent" TEXT,
    "duty_drawback_eligible" BOOLEAN NOT NULL DEFAULT false,
    "duty_drawback_estimated_foreign" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "duty_drawback_estimated_base" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "leo_date" TIMESTAMP(3),
    "notes" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "export_customs_declarations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "export_documents" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "doc_number" TEXT NOT NULL,
    "doc_type" TEXT NOT NULL,
    "order_id" TEXT,
    "shipment_id" TEXT,
    "invoice_id" TEXT,
    "customer_name" TEXT,
    "issue_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "courier_tracking_no" TEXT,
    "file_placeholder" TEXT,
    "notes" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "export_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "export_dispatches" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "dispatch_number" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "shipment_id" TEXT NOT NULL,
    "dispatch_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "transporter_name" TEXT,
    "truck_no" TEXT,
    "driver_name" TEXT,
    "driver_phone" TEXT,
    "destination_port" TEXT,
    "seal_no" TEXT,
    "gate_pass_no" TEXT,
    "location_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Staged at Warehouse',
    "sales_invoice_id" TEXT,
    "stock_posted_at" TIMESTAMP(3),
    "notes" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "export_dispatches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "export_finance_lcs" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "lc_advice_number" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "issuing_bank" TEXT NOT NULL,
    "advising_bank" TEXT,
    "applicant" TEXT NOT NULL,
    "lc_value_foreign" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "lc_value_base" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "exchange_rate" DECIMAL(18,8) NOT NULL DEFAULT 1,
    "exchange_rate_date" TIMESTAMP(3),
    "rate_source" TEXT,
    "base_currency_code" TEXT,
    "expiry_date" TIMESTAMP(3),
    "latest_shipment_date" TIMESTAMP(3),
    "presentation_days" INTEGER NOT NULL DEFAULT 21,
    "discrepancy_status" TEXT NOT NULL DEFAULT 'Pending Review',
    "status" TEXT NOT NULL DEFAULT 'LC Advised',
    "notes" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "export_finance_lcs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "export_expenses" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "expense_number" TEXT NOT NULL,
    "order_id" TEXT,
    "shipment_id" TEXT,
    "expense_type" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "description" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "exchange_rate" DECIMAL(18,8) NOT NULL DEFAULT 1,
    "exchange_rate_date" TIMESTAMP(3),
    "rate_source" TEXT,
    "base_currency_code" TEXT,
    "amount_foreign" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "amount_base" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "account_id" TEXT,
    "bank_account_id" TEXT,
    "journal_entry_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "notes" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "export_expenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "export_receipts" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "receipt_number" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "proforma_id" TEXT,
    "invoice_id" TEXT,
    "customer_id" TEXT NOT NULL,
    "customer_name" TEXT NOT NULL,
    "receipt_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "receipt_type" TEXT NOT NULL DEFAULT 'Settlement',
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "exchange_rate" DECIMAL(18,8) NOT NULL DEFAULT 1,
    "exchange_rate_date" TIMESTAMP(3),
    "rate_source" TEXT,
    "base_currency_code" TEXT,
    "foreign_amount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "gross_base" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "bank_charges_base" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "net_base" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "fx_gain_loss_base" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "applied_base" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "bank_account_id" TEXT,
    "nostro_account_ref" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Funds In Transit',
    "sales_payment_id" TEXT,
    "journal_entry_id" TEXT,
    "notes" TEXT,
    "created_by" TEXT,
    "idempotency_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "export_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "export_settings" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "default_incoterm" TEXT NOT NULL DEFAULT 'FOB',
    "default_port_of_loading" TEXT,
    "default_port_of_discharge" TEXT,
    "default_payment_terms" TEXT,
    "default_currency" TEXT,
    "default_location_id" TEXT,
    "auto_post_invoice" BOOLEAN NOT NULL DEFAULT true,
    "require_customs_before_dispatch" BOOLEAN NOT NULL DEFAULT true,
    "require_inspection_before_dispatch" BOOLEAN NOT NULL DEFAULT true,
    "allow_negative_stock" BOOLEAN NOT NULL DEFAULT false,
    "default_freight_account_id" TEXT,
    "default_duty_account_id" TEXT,
    "default_bank_charges_account_id" TEXT,
    "default_fx_gain_account_id" TEXT,
    "default_fx_loss_account_id" TEXT,
    "default_advance_account_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "export_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "export_audit_logs" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "details" JSONB,
    "user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "export_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "export_inquiries_company_id_status_idx" ON "export_inquiries"("company_id", "status");

-- CreateIndex
CREATE INDEX "export_inquiries_company_id_date_idx" ON "export_inquiries"("company_id", "date");

-- CreateIndex
CREATE INDEX "export_inquiries_customer_id_idx" ON "export_inquiries"("customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "export_inquiries_company_id_inquiry_number_key" ON "export_inquiries"("company_id", "inquiry_number");

-- CreateIndex
CREATE INDEX "export_inquiry_items_inquiry_id_idx" ON "export_inquiry_items"("inquiry_id");

-- CreateIndex
CREATE INDEX "export_inquiry_items_product_id_idx" ON "export_inquiry_items"("product_id");

-- CreateIndex
CREATE INDEX "export_quotations_company_id_status_idx" ON "export_quotations"("company_id", "status");

-- CreateIndex
CREATE INDEX "export_quotations_company_id_quote_date_idx" ON "export_quotations"("company_id", "quote_date");

-- CreateIndex
CREATE INDEX "export_quotations_customer_id_idx" ON "export_quotations"("customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "export_quotations_company_id_quote_number_key" ON "export_quotations"("company_id", "quote_number");

-- CreateIndex
CREATE INDEX "export_quotation_items_quotation_id_idx" ON "export_quotation_items"("quotation_id");

-- CreateIndex
CREATE INDEX "export_quotation_items_product_id_idx" ON "export_quotation_items"("product_id");

-- CreateIndex
CREATE INDEX "export_sales_orders_company_id_status_idx" ON "export_sales_orders"("company_id", "status");

-- CreateIndex
CREATE INDEX "export_sales_orders_company_id_order_date_idx" ON "export_sales_orders"("company_id", "order_date");

-- CreateIndex
CREATE INDEX "export_sales_orders_customer_id_idx" ON "export_sales_orders"("customer_id");

-- CreateIndex
CREATE INDEX "export_sales_orders_quotation_id_idx" ON "export_sales_orders"("quotation_id");

-- CreateIndex
CREATE UNIQUE INDEX "export_sales_orders_company_id_order_number_key" ON "export_sales_orders"("company_id", "order_number");

-- CreateIndex
CREATE INDEX "export_sales_order_items_order_id_idx" ON "export_sales_order_items"("order_id");

-- CreateIndex
CREATE INDEX "export_sales_order_items_product_id_idx" ON "export_sales_order_items"("product_id");

-- CreateIndex
CREATE INDEX "export_proforma_invoices_company_id_status_idx" ON "export_proforma_invoices"("company_id", "status");

-- CreateIndex
CREATE INDEX "export_proforma_invoices_order_id_idx" ON "export_proforma_invoices"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "export_proforma_invoices_company_id_pi_number_key" ON "export_proforma_invoices"("company_id", "pi_number");

-- CreateIndex
CREATE INDEX "export_packings_company_id_inspection_status_idx" ON "export_packings"("company_id", "inspection_status");

-- CreateIndex
CREATE INDEX "export_packings_order_id_idx" ON "export_packings"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "export_packings_company_id_packing_list_no_key" ON "export_packings"("company_id", "packing_list_no");

-- CreateIndex
CREATE INDEX "export_packing_items_packing_id_idx" ON "export_packing_items"("packing_id");

-- CreateIndex
CREATE INDEX "export_packing_items_product_id_idx" ON "export_packing_items"("product_id");

-- CreateIndex
CREATE INDEX "export_shipments_company_id_shipment_status_idx" ON "export_shipments"("company_id", "shipment_status");

-- CreateIndex
CREATE INDEX "export_shipments_order_id_idx" ON "export_shipments"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "export_shipments_company_id_shipment_number_key" ON "export_shipments"("company_id", "shipment_number");

-- CreateIndex
CREATE INDEX "export_shipment_items_shipment_id_idx" ON "export_shipment_items"("shipment_id");

-- CreateIndex
CREATE INDEX "export_shipment_items_product_id_idx" ON "export_shipment_items"("product_id");

-- CreateIndex
CREATE INDEX "export_customs_declarations_company_id_status_idx" ON "export_customs_declarations"("company_id", "status");

-- CreateIndex
CREATE INDEX "export_customs_declarations_order_id_idx" ON "export_customs_declarations"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "export_customs_declarations_company_id_shipping_bill_no_key" ON "export_customs_declarations"("company_id", "shipping_bill_no");

-- CreateIndex
CREATE INDEX "export_documents_company_id_doc_type_idx" ON "export_documents"("company_id", "doc_type");

-- CreateIndex
CREATE INDEX "export_documents_company_id_status_idx" ON "export_documents"("company_id", "status");

-- CreateIndex
CREATE INDEX "export_documents_order_id_idx" ON "export_documents"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "export_documents_company_id_doc_number_key" ON "export_documents"("company_id", "doc_number");

-- CreateIndex
CREATE INDEX "export_dispatches_company_id_status_idx" ON "export_dispatches"("company_id", "status");

-- CreateIndex
CREATE INDEX "export_dispatches_order_id_idx" ON "export_dispatches"("order_id");

-- CreateIndex
CREATE INDEX "export_dispatches_shipment_id_idx" ON "export_dispatches"("shipment_id");

-- CreateIndex
CREATE UNIQUE INDEX "export_dispatches_company_id_dispatch_number_key" ON "export_dispatches"("company_id", "dispatch_number");

-- CreateIndex
CREATE INDEX "export_finance_lcs_company_id_status_idx" ON "export_finance_lcs"("company_id", "status");

-- CreateIndex
CREATE INDEX "export_finance_lcs_order_id_idx" ON "export_finance_lcs"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "export_finance_lcs_company_id_lc_advice_number_key" ON "export_finance_lcs"("company_id", "lc_advice_number");

-- CreateIndex
CREATE INDEX "export_expenses_company_id_status_idx" ON "export_expenses"("company_id", "status");

-- CreateIndex
CREATE INDEX "export_expenses_order_id_idx" ON "export_expenses"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "export_expenses_company_id_expense_number_key" ON "export_expenses"("company_id", "expense_number");

-- CreateIndex
CREATE INDEX "export_receipts_company_id_status_idx" ON "export_receipts"("company_id", "status");

-- CreateIndex
CREATE INDEX "export_receipts_order_id_idx" ON "export_receipts"("order_id");

-- CreateIndex
CREATE INDEX "export_receipts_invoice_id_idx" ON "export_receipts"("invoice_id");

-- CreateIndex
CREATE UNIQUE INDEX "export_receipts_company_id_receipt_number_key" ON "export_receipts"("company_id", "receipt_number");

-- CreateIndex
CREATE UNIQUE INDEX "export_receipts_company_id_idempotency_key_key" ON "export_receipts"("company_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "export_settings_company_id_key" ON "export_settings"("company_id");

-- CreateIndex
CREATE INDEX "export_audit_logs_company_id_created_at_idx" ON "export_audit_logs"("company_id", "created_at");

-- CreateIndex
CREATE INDEX "export_audit_logs_entity_type_entity_id_idx" ON "export_audit_logs"("entity_type", "entity_id");

ALTER TABLE "export_inquiries" ADD CONSTRAINT "export_inquiries_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "export_inquiry_items" ADD CONSTRAINT "export_inquiry_items_inquiry_id_fkey" FOREIGN KEY ("inquiry_id") REFERENCES "export_inquiries"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "export_quotations" ADD CONSTRAINT "export_quotations_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "export_quotation_items" ADD CONSTRAINT "export_quotation_items_quotation_id_fkey" FOREIGN KEY ("quotation_id") REFERENCES "export_quotations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "export_sales_orders" ADD CONSTRAINT "export_sales_orders_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "export_sales_order_items" ADD CONSTRAINT "export_sales_order_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "export_sales_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "export_proforma_invoices" ADD CONSTRAINT "export_proforma_invoices_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "export_packings" ADD CONSTRAINT "export_packings_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "export_packing_items" ADD CONSTRAINT "export_packing_items_packing_id_fkey" FOREIGN KEY ("packing_id") REFERENCES "export_packings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "export_shipments" ADD CONSTRAINT "export_shipments_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "export_shipment_items" ADD CONSTRAINT "export_shipment_items_shipment_id_fkey" FOREIGN KEY ("shipment_id") REFERENCES "export_shipments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "export_customs_declarations" ADD CONSTRAINT "export_customs_declarations_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "export_documents" ADD CONSTRAINT "export_documents_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "export_dispatches" ADD CONSTRAINT "export_dispatches_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "export_finance_lcs" ADD CONSTRAINT "export_finance_lcs_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "export_expenses" ADD CONSTRAINT "export_expenses_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "export_receipts" ADD CONSTRAINT "export_receipts_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "export_settings" ADD CONSTRAINT "export_settings_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "export_audit_logs" ADD CONSTRAINT "export_audit_logs_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "export_idempotencies" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "export_idempotencies_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "export_idempotencies_company_id_key_key" ON "export_idempotencies"("company_id", "key");

-- CreateIndex
CREATE INDEX "export_idempotencies_company_id_created_at_idx" ON "export_idempotencies"("company_id", "created_at");

-- AddForeignKey
ALTER TABLE "export_idempotencies" ADD CONSTRAINT "export_idempotencies_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
