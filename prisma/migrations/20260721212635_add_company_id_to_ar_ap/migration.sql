-- AlterTable
ALTER TABLE "accounts_payable" ADD COLUMN     "company_id" TEXT;

-- AlterTable
ALTER TABLE "accounts_receivable" ADD COLUMN     "company_id" TEXT;

-- CreateIndex
CREATE INDEX "accounts_payable_company_id_idx" ON "accounts_payable"("company_id");

-- CreateIndex
CREATE INDEX "accounts_receivable_company_id_idx" ON "accounts_receivable"("company_id");
