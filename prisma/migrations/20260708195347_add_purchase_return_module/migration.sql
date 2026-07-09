/*
  Warnings:

  - A unique constraint covering the columns `[purchase_return_id]` on the table `journal_entries` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "journal_entries" ADD COLUMN     "purchase_return_id" TEXT;

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "box_quantity" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "box_unit_name" TEXT NOT NULL DEFAULT 'Box',
ADD COLUMN     "is_box_based" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "purchase_return_items" (
    "id" TEXT NOT NULL,
    "return_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "product_name" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "purchase_invoice_id" TEXT NOT NULL,
    "purchase_invoice_item_id" TEXT,
    "purchased_quantity" INTEGER NOT NULL,
    "previously_returned" INTEGER NOT NULL DEFAULT 0,
    "available_quantity" INTEGER NOT NULL,
    "return_quantity" INTEGER NOT NULL,
    "is_box_based" BOOLEAN NOT NULL DEFAULT false,
    "boxes" INTEGER,
    "quantity_per_box" INTEGER DEFAULT 0,
    "unit_price" DOUBLE PRECISION NOT NULL,
    "line_total" DOUBLE PRECISION NOT NULL,
    "return_reason" TEXT NOT NULL,
    "condition" TEXT NOT NULL DEFAULT 'Good',
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchase_return_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_returns" (
    "id" TEXT NOT NULL,
    "return_number" TEXT NOT NULL,
    "return_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "supplier_id" TEXT NOT NULL,
    "supplier_name" TEXT NOT NULL,
    "purchase_invoice_id" TEXT NOT NULL,
    "purchase_invoice_number" TEXT NOT NULL,
    "return_reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "notes" TEXT,
    "total_return_qty" INTEGER NOT NULL DEFAULT 0,
    "return_amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "grand_total" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "journal_entry_id" TEXT,
    "ap_record_id" TEXT,
    "created_by" TEXT NOT NULL,
    "updated_by" TEXT,
    "processed_by" TEXT,
    "processed_at" TIMESTAMP(3),
    "cancelled_by" TEXT,
    "cancelled_at" TIMESTAMP(3),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchase_returns_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "purchase_return_items_return_id_idx" ON "purchase_return_items"("return_id");

-- CreateIndex
CREATE INDEX "purchase_return_items_product_id_idx" ON "purchase_return_items"("product_id");

-- CreateIndex
CREATE INDEX "purchase_return_items_purchase_invoice_id_idx" ON "purchase_return_items"("purchase_invoice_id");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_returns_return_number_key" ON "purchase_returns"("return_number");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_returns_journal_entry_id_key" ON "purchase_returns"("journal_entry_id");

-- CreateIndex
CREATE INDEX "purchase_returns_return_number_idx" ON "purchase_returns"("return_number");

-- CreateIndex
CREATE INDEX "purchase_returns_supplier_id_idx" ON "purchase_returns"("supplier_id");

-- CreateIndex
CREATE INDEX "purchase_returns_purchase_invoice_id_idx" ON "purchase_returns"("purchase_invoice_id");

-- CreateIndex
CREATE INDEX "purchase_returns_status_idx" ON "purchase_returns"("status");

-- CreateIndex
CREATE INDEX "purchase_returns_return_date_idx" ON "purchase_returns"("return_date");

-- CreateIndex
CREATE INDEX "purchase_returns_is_active_idx" ON "purchase_returns"("is_active");

-- CreateIndex
CREATE INDEX "purchase_returns_user_id_idx" ON "purchase_returns"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "journal_entries_purchase_return_id_key" ON "journal_entries"("purchase_return_id");

-- AddForeignKey
ALTER TABLE "purchase_return_items" ADD CONSTRAINT "purchase_return_items_return_id_fkey" FOREIGN KEY ("return_id") REFERENCES "purchase_returns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_return_items" ADD CONSTRAINT "purchase_return_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_return_items" ADD CONSTRAINT "purchase_return_items_purchase_invoice_id_fkey" FOREIGN KEY ("purchase_invoice_id") REFERENCES "purchase_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_return_items" ADD CONSTRAINT "purchase_return_items_purchase_invoice_item_id_fkey" FOREIGN KEY ("purchase_invoice_item_id") REFERENCES "purchase_invoice_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_returns" ADD CONSTRAINT "purchase_returns_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_returns" ADD CONSTRAINT "purchase_returns_purchase_invoice_id_fkey" FOREIGN KEY ("purchase_invoice_id") REFERENCES "purchase_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_returns" ADD CONSTRAINT "purchase_returns_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_returns" ADD CONSTRAINT "purchase_returns_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_returns" ADD CONSTRAINT "purchase_returns_processed_by_fkey" FOREIGN KEY ("processed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_returns" ADD CONSTRAINT "purchase_returns_cancelled_by_fkey" FOREIGN KEY ("cancelled_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_returns" ADD CONSTRAINT "purchase_returns_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_returns" ADD CONSTRAINT "purchase_returns_journal_entry_id_fkey" FOREIGN KEY ("journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_returns" ADD CONSTRAINT "purchase_returns_ap_record_id_fkey" FOREIGN KEY ("ap_record_id") REFERENCES "accounts_payable"("id") ON DELETE SET NULL ON UPDATE CASCADE;
