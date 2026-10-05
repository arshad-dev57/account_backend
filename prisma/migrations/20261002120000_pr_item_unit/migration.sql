-- AlterTable
ALTER TABLE "purchase_requisition_items" ADD COLUMN IF NOT EXISTS "unit" TEXT NOT NULL DEFAULT 'Pcs';
