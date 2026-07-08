-- CreateTable
CREATE TABLE "goods_receiving_items" (
    "id" TEXT NOT NULL,
    "goods_receiving_id" TEXT NOT NULL,
    "purchase_order_item_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "product_name" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "ordered_quantity" INTEGER NOT NULL,
    "previously_received_qty" INTEGER NOT NULL DEFAULT 0,
    "remaining_quantity" INTEGER NOT NULL,
    "receiving_quantity" INTEGER NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'Pcs',
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "goods_receiving_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goods_receivings" (
    "id" TEXT NOT NULL,
    "grn_number" TEXT NOT NULL,
    "purchase_order_id" TEXT NOT NULL,
    "purchase_order_number" TEXT NOT NULL,
    "supplier_id" TEXT NOT NULL,
    "supplier_name" TEXT NOT NULL,
    "receiving_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "received_by" TEXT,
    "notes" TEXT,
    "confirmed_by" TEXT,
    "confirmed_at" TIMESTAMP(3),
    "created_by" TEXT NOT NULL,
    "updated_by" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "goods_receivings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "goods_receiving_items_goods_receiving_id_idx" ON "goods_receiving_items"("goods_receiving_id");

-- CreateIndex
CREATE INDEX "goods_receiving_items_purchase_order_item_id_idx" ON "goods_receiving_items"("purchase_order_item_id");

-- CreateIndex
CREATE INDEX "goods_receiving_items_product_id_idx" ON "goods_receiving_items"("product_id");

-- CreateIndex
CREATE UNIQUE INDEX "goods_receivings_grn_number_key" ON "goods_receivings"("grn_number");

-- CreateIndex
CREATE INDEX "goods_receivings_grn_number_idx" ON "goods_receivings"("grn_number");

-- CreateIndex
CREATE INDEX "goods_receivings_purchase_order_id_idx" ON "goods_receivings"("purchase_order_id");

-- CreateIndex
CREATE INDEX "goods_receivings_supplier_id_idx" ON "goods_receivings"("supplier_id");

-- CreateIndex
CREATE INDEX "goods_receivings_status_idx" ON "goods_receivings"("status");

-- CreateIndex
CREATE INDEX "goods_receivings_receiving_date_idx" ON "goods_receivings"("receiving_date");

-- CreateIndex
CREATE INDEX "goods_receivings_is_active_idx" ON "goods_receivings"("is_active");

-- CreateIndex
CREATE INDEX "goods_receivings_user_id_idx" ON "goods_receivings"("user_id");

-- AddForeignKey
ALTER TABLE "goods_receiving_items" ADD CONSTRAINT "goods_receiving_items_goods_receiving_id_fkey" FOREIGN KEY ("goods_receiving_id") REFERENCES "goods_receivings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receiving_items" ADD CONSTRAINT "goods_receiving_items_purchase_order_item_id_fkey" FOREIGN KEY ("purchase_order_item_id") REFERENCES "purchase_order_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receiving_items" ADD CONSTRAINT "goods_receiving_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receivings" ADD CONSTRAINT "goods_receivings_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receivings" ADD CONSTRAINT "goods_receivings_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receivings" ADD CONSTRAINT "goods_receivings_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receivings" ADD CONSTRAINT "goods_receivings_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receivings" ADD CONSTRAINT "goods_receivings_confirmed_by_fkey" FOREIGN KEY ("confirmed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receivings" ADD CONSTRAINT "goods_receivings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
