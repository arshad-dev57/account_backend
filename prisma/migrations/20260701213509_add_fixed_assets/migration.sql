-- CreateTable
CREATE TABLE "fixed_assets" (
    "id" TEXT NOT NULL,
    "asset_code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "purchase_date" TIMESTAMP(3) NOT NULL,
    "purchase_cost" DOUBLE PRECISION NOT NULL,
    "useful_life" INTEGER NOT NULL,
    "salvage_value" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "depreciation_method" TEXT NOT NULL DEFAULT 'Straight Line',
    "current_depreciation" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "accumulated_depreciation" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "net_book_value" DOUBLE PRECISION NOT NULL,
    "last_depreciation_date" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'Active',
    "location" TEXT NOT NULL DEFAULT '',
    "supplier_id" TEXT,
    "supplier_name" TEXT NOT NULL DEFAULT '',
    "warranty_expiry" TIMESTAMP(3),
    "notes" TEXT NOT NULL DEFAULT '',
    "disposed_date" TIMESTAMP(3),
    "disposal_amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "disposal_reason" TEXT NOT NULL DEFAULT '',
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fixed_assets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "fixed_assets_asset_code_key" ON "fixed_assets"("asset_code");

-- CreateIndex
CREATE INDEX "fixed_assets_asset_code_idx" ON "fixed_assets"("asset_code");

-- CreateIndex
CREATE INDEX "fixed_assets_category_idx" ON "fixed_assets"("category");

-- CreateIndex
CREATE INDEX "fixed_assets_status_idx" ON "fixed_assets"("status");

-- CreateIndex
CREATE INDEX "fixed_assets_created_by_idx" ON "fixed_assets"("created_by");

-- CreateIndex
CREATE INDEX "fixed_assets_purchase_date_idx" ON "fixed_assets"("purchase_date");

-- AddForeignKey
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
