-- AlterTable
ALTER TABLE "credit_notes" ALTER COLUMN "original_invoice_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "credit_notes" ADD COLUMN IF NOT EXISTS "sales_invoice_id" TEXT;
ALTER TABLE "credit_notes" ADD COLUMN IF NOT EXISTS "invoice_source" TEXT NOT NULL DEFAULT 'warehouse';

-- CreateIndex
CREATE INDEX IF NOT EXISTS "credit_notes_sales_invoice_id_idx" ON "credit_notes"("sales_invoice_id");

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "credit_notes"
    ADD CONSTRAINT "credit_notes_sales_invoice_id_fkey"
    FOREIGN KEY ("sales_invoice_id") REFERENCES "sales_invoices"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
