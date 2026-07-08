-- AlterTable
ALTER TABLE "expenses" ADD COLUMN     "expense_account_id" TEXT;

-- CreateIndex
CREATE INDEX "expenses_expense_account_id_idx" ON "expenses"("expense_account_id");

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_expense_account_id_fkey" FOREIGN KEY ("expense_account_id") REFERENCES "chart_of_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
