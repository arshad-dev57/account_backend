-- AlterTable
ALTER TABLE "payments_received" ADD COLUMN     "cleared_date" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "warehouse_invoices" ADD COLUMN     "tax_liability_account_id" TEXT;

-- AddForeignKey
ALTER TABLE "warehouse_invoices" ADD CONSTRAINT "warehouse_invoices_tax_liability_account_id_fkey" FOREIGN KEY ("tax_liability_account_id") REFERENCES "chart_of_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
