-- AlterTable
ALTER TABLE "categories" ADD COLUMN "sync_id" TEXT,
ADD COLUMN "sync_status" TEXT NOT NULL DEFAULT 'SYNCED',
ADD COLUMN "last_synced_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "products" ADD COLUMN "sync_id" TEXT,
ADD COLUMN "sync_status" TEXT NOT NULL DEFAULT 'SYNCED',
ADD COLUMN "last_synced_at" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "categories_sync_id_key" ON "categories"("sync_id");

-- CreateIndex
CREATE UNIQUE INDEX "products_sync_id_key" ON "products"("sync_id");