-- AlterTable
ALTER TABLE "payments_made" ADD COLUMN     "ap_record_id" TEXT;

-- CreateTable
CREATE TABLE "accounts_payable" (
    "id" TEXT NOT NULL,
    "invoice_id" TEXT NOT NULL,
    "invoice_number" TEXT NOT NULL,
    "supplier_id" TEXT NOT NULL,
    "supplier_name" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "paid_amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "outstanding" DOUBLE PRECISION NOT NULL,
    "due_date" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Current',
    "notes" TEXT,
    "account_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accounts_payable_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_invoice_items" (
    "id" TEXT NOT NULL,
    "invoice_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "product_name" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_price" DOUBLE PRECISION NOT NULL,
    "discount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "tax_rate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "tax_amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "line_total" DOUBLE PRECISION NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "purchaseOrderItemId" TEXT,

    CONSTRAINT "purchase_invoice_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_invoices" (
    "id" TEXT NOT NULL,
    "invoice_number" TEXT NOT NULL,
    "supplier_id" TEXT NOT NULL,
    "supplier_name" TEXT NOT NULL,
    "supplier_email" TEXT,
    "supplier_phone" TEXT,
    "supplier_invoice_no" TEXT,
    "purchase_order_id" TEXT,
    "purchase_order_number" TEXT,
    "goods_receiving_id" TEXT,
    "grn_number" TEXT,
    "invoice_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "due_date" TIMESTAMP(3) NOT NULL,
    "payment_terms" TEXT NOT NULL DEFAULT 'Net 30',
    "subtotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "discount_total" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "tax_total" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "grand_total" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "paid_amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "outstanding" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "invoice_status" TEXT NOT NULL DEFAULT 'Draft',
    "payment_status" TEXT NOT NULL DEFAULT 'Unpaid',
    "notes" TEXT,
    "posted_at" TIMESTAMP(3),
    "paid_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "accounts_payable_id" TEXT,
    "journal_entry_id" TEXT,
    "inventory_account_id" TEXT,
    "ap_account_id" TEXT,
    "created_by" TEXT NOT NULL,
    "updated_by" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchase_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "accounts_payable_invoice_id_key" ON "accounts_payable"("invoice_id");

-- CreateIndex
CREATE INDEX "accounts_payable_supplier_id_idx" ON "accounts_payable"("supplier_id");

-- CreateIndex
CREATE INDEX "accounts_payable_status_idx" ON "accounts_payable"("status");

-- CreateIndex
CREATE INDEX "accounts_payable_due_date_idx" ON "accounts_payable"("due_date");

-- CreateIndex
CREATE INDEX "purchase_invoice_items_invoice_id_idx" ON "purchase_invoice_items"("invoice_id");

-- CreateIndex
CREATE INDEX "purchase_invoice_items_product_id_idx" ON "purchase_invoice_items"("product_id");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_invoices_invoice_number_key" ON "purchase_invoices"("invoice_number");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_invoices_journal_entry_id_key" ON "purchase_invoices"("journal_entry_id");

-- CreateIndex
CREATE INDEX "purchase_invoices_invoice_number_idx" ON "purchase_invoices"("invoice_number");

-- CreateIndex
CREATE INDEX "purchase_invoices_supplier_id_idx" ON "purchase_invoices"("supplier_id");

-- CreateIndex
CREATE INDEX "purchase_invoices_purchase_order_id_idx" ON "purchase_invoices"("purchase_order_id");

-- CreateIndex
CREATE INDEX "purchase_invoices_goods_receiving_id_idx" ON "purchase_invoices"("goods_receiving_id");

-- CreateIndex
CREATE INDEX "purchase_invoices_invoice_status_idx" ON "purchase_invoices"("invoice_status");

-- CreateIndex
CREATE INDEX "purchase_invoices_payment_status_idx" ON "purchase_invoices"("payment_status");

-- CreateIndex
CREATE INDEX "purchase_invoices_invoice_date_idx" ON "purchase_invoices"("invoice_date");

-- CreateIndex
CREATE INDEX "purchase_invoices_due_date_idx" ON "purchase_invoices"("due_date");

-- CreateIndex
CREATE INDEX "purchase_invoices_is_active_idx" ON "purchase_invoices"("is_active");

-- CreateIndex
CREATE INDEX "purchase_invoices_user_id_idx" ON "purchase_invoices"("user_id");

-- AddForeignKey
ALTER TABLE "accounts_payable" ADD CONSTRAINT "accounts_payable_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "purchase_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts_payable" ADD CONSTRAINT "accounts_payable_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts_payable" ADD CONSTRAINT "accounts_payable_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "chart_of_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments_made" ADD CONSTRAINT "payments_made_ap_record_id_fkey" FOREIGN KEY ("ap_record_id") REFERENCES "accounts_payable"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_invoice_items" ADD CONSTRAINT "purchase_invoice_items_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "purchase_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_invoice_items" ADD CONSTRAINT "purchase_invoice_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_invoice_items" ADD CONSTRAINT "purchase_invoice_items_purchaseOrderItemId_fkey" FOREIGN KEY ("purchaseOrderItemId") REFERENCES "purchase_order_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_invoices" ADD CONSTRAINT "purchase_invoices_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_invoices" ADD CONSTRAINT "purchase_invoices_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_invoices" ADD CONSTRAINT "purchase_invoices_goods_receiving_id_fkey" FOREIGN KEY ("goods_receiving_id") REFERENCES "goods_receivings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_invoices" ADD CONSTRAINT "purchase_invoices_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_invoices" ADD CONSTRAINT "purchase_invoices_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_invoices" ADD CONSTRAINT "purchase_invoices_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_invoices" ADD CONSTRAINT "purchase_invoices_journal_entry_id_fkey" FOREIGN KEY ("journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_invoices" ADD CONSTRAINT "purchase_invoices_inventory_account_id_fkey" FOREIGN KEY ("inventory_account_id") REFERENCES "chart_of_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_invoices" ADD CONSTRAINT "purchase_invoices_ap_account_id_fkey" FOREIGN KEY ("ap_account_id") REFERENCES "chart_of_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
