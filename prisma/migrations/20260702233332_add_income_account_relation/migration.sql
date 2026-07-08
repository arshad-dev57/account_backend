-- AlterTable
ALTER TABLE "incomes" ADD COLUMN     "income_account_id" TEXT;

-- CreateIndex
CREATE INDEX "incomes_income_account_id_idx" ON "incomes"("income_account_id");

-- AddForeignKey
ALTER TABLE "incomes" ADD CONSTRAINT "incomes_income_account_id_fkey" FOREIGN KEY ("income_account_id") REFERENCES "chart_of_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
