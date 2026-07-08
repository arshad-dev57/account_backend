/*
  Warnings:

  - A unique constraint covering the columns `[account_number,user_id]` on the table `bank_accounts` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[bill_number,user_id]` on the table `bills` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[name,user_id]` on the table `categories` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[code,user_id]` on the table `categories` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[slug,user_id]` on the table `categories` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[code,user_id]` on the table `chart_of_accounts` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[sku,user_id]` on the table `products` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[category,name,user_id]` on the table `settings` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[code,user_id]` on the table `suppliers` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[email,user_id]` on the table `suppliers` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[phone,user_id]` on the table `suppliers` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[account_id,period_start,period_end,user_id]` on the table `trial_balance_view` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "bank_accounts_account_number_created_by_key";

-- DropIndex
DROP INDEX "categories_code_key";

-- DropIndex
DROP INDEX "categories_slug_key";

-- DropIndex
DROP INDEX "chart_of_accounts_code_created_by_key";

-- DropIndex
DROP INDEX "products_sku_key";

-- DropIndex
DROP INDEX "settings_category_name_key";

-- DropIndex
DROP INDEX "suppliers_code_key";

-- DropIndex
DROP INDEX "trial_balance_view_account_id_period_start_period_end_creat_key";

-- AlterTable
ALTER TABLE "bank_accounts" ADD COLUMN     "user_id" TEXT;

-- AlterTable
ALTER TABLE "bills" ADD COLUMN     "user_id" TEXT;

-- AlterTable
ALTER TABLE "categories" ADD COLUMN     "user_id" TEXT;

-- AlterTable
ALTER TABLE "chart_of_accounts" ADD COLUMN     "user_id" TEXT;

-- AlterTable
ALTER TABLE "credit_notes" ADD COLUMN     "user_id" TEXT;

-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "user_id" TEXT;

-- AlterTable
ALTER TABLE "expenses" ADD COLUMN     "user_id" TEXT;

-- AlterTable
ALTER TABLE "fixed_assets" ADD COLUMN     "user_id" TEXT;

-- AlterTable
ALTER TABLE "incomes" ADD COLUMN     "user_id" TEXT;

-- AlterTable
ALTER TABLE "journal_entries" ADD COLUMN     "user_id" TEXT;

-- AlterTable
ALTER TABLE "loans" ADD COLUMN     "user_id" TEXT;

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "user_id" TEXT;

-- AlterTable
ALTER TABLE "payments_made" ADD COLUMN     "user_id" TEXT;

-- AlterTable
ALTER TABLE "payments_received" ADD COLUMN     "user_id" TEXT;

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "user_id" TEXT;

-- AlterTable
ALTER TABLE "refunds" ADD COLUMN     "user_id" TEXT;

-- AlterTable
ALTER TABLE "returns" ADD COLUMN     "user_id" TEXT;

-- AlterTable
ALTER TABLE "settings" ADD COLUMN     "user_id" TEXT;

-- AlterTable
ALTER TABLE "stock_movements" ADD COLUMN     "user_id" TEXT;

-- AlterTable
ALTER TABLE "suppliers" ADD COLUMN     "user_id" TEXT;

-- AlterTable
ALTER TABLE "trial_balance_view" ADD COLUMN     "user_id" TEXT;

-- AlterTable
ALTER TABLE "warehouse_invoices" ADD COLUMN     "user_id" TEXT;

-- AlterTable
ALTER TABLE "warehouse_purchases" ADD COLUMN     "user_id" TEXT;

-- CreateIndex
CREATE INDEX "bank_accounts_user_id_idx" ON "bank_accounts"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "bank_accounts_account_number_user_id_key" ON "bank_accounts"("account_number", "user_id");

-- CreateIndex
CREATE INDEX "bills_user_id_idx" ON "bills"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "bills_bill_number_user_id_key" ON "bills"("bill_number", "user_id");

-- CreateIndex
CREATE INDEX "categories_user_id_idx" ON "categories"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "categories_name_user_id_key" ON "categories"("name", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "categories_code_user_id_key" ON "categories"("code", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "categories_slug_user_id_key" ON "categories"("slug", "user_id");

-- CreateIndex
CREATE INDEX "chart_of_accounts_user_id_idx" ON "chart_of_accounts"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "chart_of_accounts_code_user_id_key" ON "chart_of_accounts"("code", "user_id");

-- CreateIndex
CREATE INDEX "credit_notes_user_id_idx" ON "credit_notes"("user_id");

-- CreateIndex
CREATE INDEX "customers_user_id_idx" ON "customers"("user_id");

-- CreateIndex
CREATE INDEX "expenses_user_id_idx" ON "expenses"("user_id");

-- CreateIndex
CREATE INDEX "fixed_assets_user_id_idx" ON "fixed_assets"("user_id");

-- CreateIndex
CREATE INDEX "incomes_user_id_idx" ON "incomes"("user_id");

-- CreateIndex
CREATE INDEX "journal_entries_user_id_idx" ON "journal_entries"("user_id");

-- CreateIndex
CREATE INDEX "loans_user_id_idx" ON "loans"("user_id");

-- CreateIndex
CREATE INDEX "orders_user_id_idx" ON "orders"("user_id");

-- CreateIndex
CREATE INDEX "payments_made_user_id_idx" ON "payments_made"("user_id");

-- CreateIndex
CREATE INDEX "payments_received_user_id_idx" ON "payments_received"("user_id");

-- CreateIndex
CREATE INDEX "products_user_id_idx" ON "products"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "products_sku_user_id_key" ON "products"("sku", "user_id");

-- CreateIndex
CREATE INDEX "refunds_user_id_idx" ON "refunds"("user_id");

-- CreateIndex
CREATE INDEX "returns_user_id_idx" ON "returns"("user_id");

-- CreateIndex
CREATE INDEX "settings_user_id_idx" ON "settings"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "settings_category_name_user_id_key" ON "settings"("category", "name", "user_id");

-- CreateIndex
CREATE INDEX "stock_movements_user_id_idx" ON "stock_movements"("user_id");

-- CreateIndex
CREATE INDEX "suppliers_user_id_idx" ON "suppliers"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "suppliers_code_user_id_key" ON "suppliers"("code", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "suppliers_email_user_id_key" ON "suppliers"("email", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "suppliers_phone_user_id_key" ON "suppliers"("phone", "user_id");

-- CreateIndex
CREATE INDEX "trial_balance_view_user_id_idx" ON "trial_balance_view"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "trial_balance_view_account_id_period_start_period_end_user__key" ON "trial_balance_view"("account_id", "period_start", "period_end", "user_id");

-- CreateIndex
CREATE INDEX "warehouse_invoices_user_id_idx" ON "warehouse_invoices"("user_id");

-- CreateIndex
CREATE INDEX "warehouse_purchases_user_id_idx" ON "warehouse_purchases"("user_id");

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settings" ADD CONSTRAINT "settings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "returns" ADD CONSTRAINT "returns_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouse_purchases" ADD CONSTRAINT "warehouse_purchases_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouse_invoices" ADD CONSTRAINT "warehouse_invoices_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chart_of_accounts" ADD CONSTRAINT "chart_of_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments_received" ADD CONSTRAINT "payments_received_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bills" ADD CONSTRAINT "bills_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incomes" ADD CONSTRAINT "incomes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments_made" ADD CONSTRAINT "payments_made_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loans" ADD CONSTRAINT "loans_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
