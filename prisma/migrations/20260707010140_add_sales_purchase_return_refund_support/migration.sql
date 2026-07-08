-- DropForeignKey
ALTER TABLE "refunds" DROP CONSTRAINT "refunds_order_id_fkey";

-- AlterTable
ALTER TABLE "refunds" ADD COLUMN     "purchase_id" TEXT,
ADD COLUMN     "purchase_number" TEXT,
ADD COLUMN     "refund_type" TEXT NOT NULL DEFAULT 'Sales Refund',
ADD COLUMN     "return_id" TEXT,
ADD COLUMN     "return_number" TEXT,
ADD COLUMN     "supplier_email" TEXT,
ADD COLUMN     "supplier_id" TEXT,
ADD COLUMN     "supplier_name" TEXT,
ADD COLUMN     "supplier_phone" TEXT,
ALTER COLUMN "order_id" DROP NOT NULL,
ALTER COLUMN "order_number" DROP NOT NULL,
ALTER COLUMN "customer_name" DROP NOT NULL;

-- AlterTable
ALTER TABLE "return_items" ADD COLUMN     "replacement_product_id" TEXT,
ADD COLUMN     "replacement_product_name" TEXT,
ADD COLUMN     "restock_quantity" INTEGER DEFAULT 0,
ADD COLUMN     "restock_status" TEXT DEFAULT 'Pending',
ADD COLUMN     "return_reason_detail" TEXT;

-- AlterTable
ALTER TABLE "returns" ADD COLUMN     "purchase_id" TEXT,
ADD COLUMN     "purchase_number" TEXT,
ADD COLUMN     "quality_check_notes" TEXT,
ADD COLUMN     "quality_check_passed" BOOLEAN,
ADD COLUMN     "restock_status" TEXT DEFAULT 'Pending',
ADD COLUMN     "return_reason_category" TEXT,
ADD COLUMN     "supplier_email" TEXT,
ADD COLUMN     "supplier_id" TEXT,
ADD COLUMN     "supplier_name" TEXT,
ADD COLUMN     "supplier_phone" TEXT,
ALTER COLUMN "return_type" SET DEFAULT 'Sales Return';

-- CreateIndex
CREATE INDEX "refunds_purchase_id_idx" ON "refunds"("purchase_id");

-- CreateIndex
CREATE INDEX "refunds_supplier_id_idx" ON "refunds"("supplier_id");

-- CreateIndex
CREATE INDEX "refunds_refund_type_idx" ON "refunds"("refund_type");

-- CreateIndex
CREATE INDEX "returns_purchase_id_idx" ON "returns"("purchase_id");

-- CreateIndex
CREATE INDEX "returns_supplier_id_idx" ON "returns"("supplier_id");

-- AddForeignKey
ALTER TABLE "returns" ADD CONSTRAINT "returns_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "returns" ADD CONSTRAINT "returns_purchase_id_fkey" FOREIGN KEY ("purchase_id") REFERENCES "warehouse_purchases"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_purchase_id_fkey" FOREIGN KEY ("purchase_id") REFERENCES "warehouse_purchases"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_return_id_fkey" FOREIGN KEY ("return_id") REFERENCES "returns"("id") ON DELETE SET NULL ON UPDATE CASCADE;
