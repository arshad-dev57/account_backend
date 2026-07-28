/*
  Warnings:

  - You are about to drop the column `user_id` on the `bank_accounts` table. All the data in the column will be lost.
  - You are about to drop the column `user_id` on the `bills` table. All the data in the column will be lost.
  - You are about to drop the column `user_id` on the `categories` table. All the data in the column will be lost.
  - You are about to drop the column `user_id` on the `chart_of_accounts` table. All the data in the column will be lost.
  - You are about to drop the column `user_id` on the `credit_notes` table. All the data in the column will be lost.
  - You are about to drop the column `company` on the `customers` table. All the data in the column will be lost.
  - You are about to drop the column `user_id` on the `customers` table. All the data in the column will be lost.
  - You are about to drop the column `user_id` on the `deliveries` table. All the data in the column will be lost.
  - You are about to drop the column `user_id` on the `equity_accounts` table. All the data in the column will be lost.
  - You are about to drop the column `user_id` on the `expenses` table. All the data in the column will be lost.
  - You are about to drop the column `user_id` on the `fiscal_years` table. All the data in the column will be lost.
  - You are about to drop the column `user_id` on the `fixed_assets` table. All the data in the column will be lost.
  - You are about to drop the column `user_id` on the `goods_receivings` table. All the data in the column will be lost.
  - You are about to drop the column `user_id` on the `incomes` table. All the data in the column will be lost.
  - You are about to drop the column `user_id` on the `journal_entries` table. All the data in the column will be lost.
  - You are about to drop the column `user_id` on the `loans` table. All the data in the column will be lost.
  - You are about to drop the column `user_id` on the `orders` table. All the data in the column will be lost.
  - You are about to drop the column `user_id` on the `payments_made` table. All the data in the column will be lost.
  - You are about to drop the column `user_id` on the `payments_received` table. All the data in the column will be lost.
  - You are about to drop the column `user_id` on the `products` table. All the data in the column will be lost.
  - You are about to drop the column `user_id` on the `purchase_invoices` table. All the data in the column will be lost.
  - You are about to drop the column `user_id` on the `purchase_orders` table. All the data in the column will be lost.
  - You are about to drop the column `user_id` on the `purchase_payments_make` table. All the data in the column will be lost.
  - You are about to drop the column `user_id` on the `purchase_returns` table. All the data in the column will be lost.
  - You are about to drop the column `user_id` on the `quotations` table. All the data in the column will be lost.
  - You are about to drop the column `user_id` on the `refunds` table. All the data in the column will be lost.
  - You are about to drop the column `user_id` on the `returns` table. All the data in the column will be lost.
  - You are about to drop the column `user_id` on the `sales_invoices` table. All the data in the column will be lost.
  - You are about to drop the column `user_id` on the `sales_payments_received` table. All the data in the column will be lost.
  - You are about to drop the column `user_id` on the `settings` table. All the data in the column will be lost.
  - You are about to drop the column `user_id` on the `stock_movements` table. All the data in the column will be lost.
  - You are about to drop the column `user_id` on the `suppliers` table. All the data in the column will be lost.
  - You are about to drop the column `user_id` on the `trial_balance_view` table. All the data in the column will be lost.
  - You are about to drop the column `user_id` on the `warehouse_invoices` table. All the data in the column will be lost.
  - You are about to drop the column `user_id` on the `warehouse_purchases` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[account_number,company_id]` on the table `bank_accounts` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[bill_number,company_id]` on the table `bills` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[name,company_id]` on the table `categories` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[code,company_id]` on the table `categories` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[slug,company_id]` on the table `categories` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[code,company_id]` on the table `chart_of_accounts` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[account_code,company_id]` on the table `equity_accounts` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[company_id,name]` on the table `fiscal_years` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[sku,company_id]` on the table `products` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[category,name,company_id]` on the table `settings` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[code,company_id]` on the table `suppliers` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[email,company_id]` on the table `suppliers` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[phone,company_id]` on the table `suppliers` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[account_id,period_start,period_end,company_id]` on the table `trial_balance_view` will be added. If there are existing duplicate values, this will fail.

*/
-- DropForeignKey
ALTER TABLE "bank_accounts" DROP CONSTRAINT "bank_accounts_user_id_fkey";

-- DropForeignKey
ALTER TABLE "bills" DROP CONSTRAINT "bills_user_id_fkey";

-- DropForeignKey
ALTER TABLE "categories" DROP CONSTRAINT "categories_user_id_fkey";

-- DropForeignKey
ALTER TABLE "chart_of_accounts" DROP CONSTRAINT "chart_of_accounts_user_id_fkey";

-- DropForeignKey
ALTER TABLE "credit_notes" DROP CONSTRAINT "credit_notes_user_id_fkey";

-- DropForeignKey
ALTER TABLE "customers" DROP CONSTRAINT "customers_user_id_fkey";

-- DropForeignKey
ALTER TABLE "deliveries" DROP CONSTRAINT "deliveries_user_id_fkey";

-- DropForeignKey
ALTER TABLE "equity_accounts" DROP CONSTRAINT "equity_accounts_user_id_fkey";

-- DropForeignKey
ALTER TABLE "expenses" DROP CONSTRAINT "expenses_user_id_fkey";

-- DropForeignKey
ALTER TABLE "fiscal_years" DROP CONSTRAINT "fiscal_years_user_id_fkey";

-- DropForeignKey
ALTER TABLE "fixed_assets" DROP CONSTRAINT "fixed_assets_user_id_fkey";

-- DropForeignKey
ALTER TABLE "goods_receivings" DROP CONSTRAINT "goods_receivings_user_id_fkey";

-- DropForeignKey
ALTER TABLE "incomes" DROP CONSTRAINT "incomes_user_id_fkey";

-- DropForeignKey
ALTER TABLE "journal_entries" DROP CONSTRAINT "journal_entries_user_id_fkey";

-- DropForeignKey
ALTER TABLE "loans" DROP CONSTRAINT "loans_user_id_fkey";

-- DropForeignKey
ALTER TABLE "orders" DROP CONSTRAINT "orders_user_id_fkey";

-- DropForeignKey
ALTER TABLE "payments_made" DROP CONSTRAINT "payments_made_user_id_fkey";

-- DropForeignKey
ALTER TABLE "payments_received" DROP CONSTRAINT "payments_received_user_id_fkey";

-- DropForeignKey
ALTER TABLE "products" DROP CONSTRAINT "products_user_id_fkey";

-- DropForeignKey
ALTER TABLE "purchase_invoices" DROP CONSTRAINT "purchase_invoices_user_id_fkey";

-- DropForeignKey
ALTER TABLE "purchase_orders" DROP CONSTRAINT "purchase_orders_user_id_fkey";

-- DropForeignKey
ALTER TABLE "purchase_payments_make" DROP CONSTRAINT "purchase_payments_make_user_id_fkey";

-- DropForeignKey
ALTER TABLE "purchase_returns" DROP CONSTRAINT "purchase_returns_user_id_fkey";

-- DropForeignKey
ALTER TABLE "quotations" DROP CONSTRAINT "quotations_user_id_fkey";

-- DropForeignKey
ALTER TABLE "refunds" DROP CONSTRAINT "refunds_user_id_fkey";

-- DropForeignKey
ALTER TABLE "returns" DROP CONSTRAINT "returns_user_id_fkey";

-- DropForeignKey
ALTER TABLE "sales_invoices" DROP CONSTRAINT "sales_invoices_user_id_fkey";

-- DropForeignKey
ALTER TABLE "sales_payments_received" DROP CONSTRAINT "sales_payments_received_user_id_fkey";

-- DropForeignKey
ALTER TABLE "settings" DROP CONSTRAINT "settings_user_id_fkey";

-- DropForeignKey
ALTER TABLE "stock_movements" DROP CONSTRAINT "stock_movements_user_id_fkey";

-- DropForeignKey
ALTER TABLE "suppliers" DROP CONSTRAINT "suppliers_user_id_fkey";

-- DropForeignKey
ALTER TABLE "warehouse_invoices" DROP CONSTRAINT "warehouse_invoices_user_id_fkey";

-- DropForeignKey
ALTER TABLE "warehouse_purchases" DROP CONSTRAINT "warehouse_purchases_user_id_fkey";

-- DropIndex
DROP INDEX "bank_accounts_account_number_user_id_key";

-- DropIndex
DROP INDEX "bank_accounts_user_id_idx";

-- DropIndex
DROP INDEX "bills_bill_number_user_id_key";

-- DropIndex
DROP INDEX "bills_user_id_idx";

-- DropIndex
DROP INDEX "categories_code_user_id_key";

-- DropIndex
DROP INDEX "categories_name_user_id_key";

-- DropIndex
DROP INDEX "categories_slug_user_id_key";

-- DropIndex
DROP INDEX "categories_user_id_idx";

-- DropIndex
DROP INDEX "chart_of_accounts_code_user_id_key";

-- DropIndex
DROP INDEX "chart_of_accounts_user_id_idx";

-- DropIndex
DROP INDEX "credit_notes_user_id_idx";

-- DropIndex
DROP INDEX "customers_user_id_idx";

-- DropIndex
DROP INDEX "deliveries_user_id_idx";

-- DropIndex
DROP INDEX "equity_accounts_account_code_created_by_key";

-- DropIndex
DROP INDEX "equity_accounts_user_id_idx";

-- DropIndex
DROP INDEX "expenses_user_id_idx";

-- DropIndex
DROP INDEX "fiscal_years_user_id_name_key";

-- DropIndex
DROP INDEX "fiscal_years_user_id_start_date_end_date_idx";

-- DropIndex
DROP INDEX "fixed_assets_user_id_idx";

-- DropIndex
DROP INDEX "goods_receivings_user_id_idx";

-- DropIndex
DROP INDEX "incomes_user_id_idx";

-- DropIndex
DROP INDEX "journal_entries_user_id_idx";

-- DropIndex
DROP INDEX "loans_user_id_idx";

-- DropIndex
DROP INDEX "orders_user_id_idx";

-- DropIndex
DROP INDEX "payments_made_user_id_idx";

-- DropIndex
DROP INDEX "payments_received_user_id_idx";

-- DropIndex
DROP INDEX "products_sku_user_id_key";

-- DropIndex
DROP INDEX "products_user_id_idx";

-- DropIndex
DROP INDEX "purchase_invoices_user_id_idx";

-- DropIndex
DROP INDEX "purchase_orders_user_id_idx";

-- DropIndex
DROP INDEX "purchase_payments_make_user_id_idx";

-- DropIndex
DROP INDEX "purchase_returns_user_id_idx";

-- DropIndex
DROP INDEX "quotations_user_id_idx";

-- DropIndex
DROP INDEX "refunds_user_id_idx";

-- DropIndex
DROP INDEX "returns_user_id_idx";

-- DropIndex
DROP INDEX "sales_invoices_user_id_idx";

-- DropIndex
DROP INDEX "sales_payments_received_user_id_idx";

-- DropIndex
DROP INDEX "settings_category_name_user_id_key";

-- DropIndex
DROP INDEX "settings_user_id_idx";

-- DropIndex
DROP INDEX "stock_movements_user_id_idx";

-- DropIndex
DROP INDEX "suppliers_code_user_id_key";

-- DropIndex
DROP INDEX "suppliers_email_user_id_key";

-- DropIndex
DROP INDEX "suppliers_phone_user_id_key";

-- DropIndex
DROP INDEX "suppliers_user_id_idx";

-- DropIndex
DROP INDEX "trial_balance_view_account_id_period_start_period_end_user__key";

-- DropIndex
DROP INDEX "trial_balance_view_user_id_idx";

-- DropIndex
DROP INDEX "warehouse_invoices_user_id_idx";

-- DropIndex
DROP INDEX "warehouse_purchases_user_id_idx";

-- AlterTable
ALTER TABLE "bank_accounts" DROP COLUMN "user_id",
ADD COLUMN     "company_id" TEXT;

-- AlterTable
ALTER TABLE "bills" DROP COLUMN "user_id",
ADD COLUMN     "company_id" TEXT;

-- AlterTable
ALTER TABLE "categories" DROP COLUMN "user_id",
ADD COLUMN     "company_id" TEXT;

-- AlterTable
ALTER TABLE "chart_of_accounts" DROP COLUMN "user_id",
ADD COLUMN     "company_id" TEXT;

-- AlterTable
ALTER TABLE "credit_notes" DROP COLUMN "user_id",
ADD COLUMN     "company_id" TEXT;

-- AlterTable
ALTER TABLE "customers" DROP COLUMN "company",
DROP COLUMN "user_id",
ADD COLUMN     "company_id" TEXT,
ADD COLUMN     "company_name" TEXT;

-- AlterTable
ALTER TABLE "deliveries" DROP COLUMN "user_id",
ADD COLUMN     "company_id" TEXT;

-- AlterTable
ALTER TABLE "equity_accounts" DROP COLUMN "user_id",
ADD COLUMN     "company_id" TEXT;

-- AlterTable
ALTER TABLE "expenses" DROP COLUMN "user_id",
ADD COLUMN     "company_id" TEXT;

-- AlterTable
ALTER TABLE "fiscal_years" DROP COLUMN "user_id",
ADD COLUMN     "company_id" TEXT;

-- AlterTable
ALTER TABLE "fixed_assets" DROP COLUMN "user_id",
ADD COLUMN     "company_id" TEXT;

-- AlterTable
ALTER TABLE "goods_receivings" DROP COLUMN "user_id",
ADD COLUMN     "company_id" TEXT;

-- AlterTable
ALTER TABLE "incomes" DROP COLUMN "user_id",
ADD COLUMN     "company_id" TEXT;

-- AlterTable
ALTER TABLE "journal_entries" DROP COLUMN "user_id",
ADD COLUMN     "company_id" TEXT;

-- AlterTable
ALTER TABLE "loans" DROP COLUMN "user_id",
ADD COLUMN     "company_id" TEXT;

-- AlterTable
ALTER TABLE "orders" DROP COLUMN "user_id",
ADD COLUMN     "company_id" TEXT;

-- AlterTable
ALTER TABLE "payments_made" DROP COLUMN "user_id",
ADD COLUMN     "company_id" TEXT;

-- AlterTable
ALTER TABLE "payments_received" DROP COLUMN "user_id",
ADD COLUMN     "company_id" TEXT;

-- AlterTable
ALTER TABLE "products" DROP COLUMN "user_id",
ADD COLUMN     "company_id" TEXT;

-- AlterTable
ALTER TABLE "purchase_invoices" DROP COLUMN "user_id",
ADD COLUMN     "company_id" TEXT;

-- AlterTable
ALTER TABLE "purchase_orders" DROP COLUMN "user_id",
ADD COLUMN     "company_id" TEXT;

-- AlterTable
ALTER TABLE "purchase_payments_make" DROP COLUMN "user_id",
ADD COLUMN     "company_id" TEXT;

-- AlterTable
ALTER TABLE "purchase_returns" DROP COLUMN "user_id",
ADD COLUMN     "company_id" TEXT;

-- AlterTable
ALTER TABLE "quotations" DROP COLUMN "user_id",
ADD COLUMN     "company_id" TEXT;

-- AlterTable
ALTER TABLE "refunds" DROP COLUMN "user_id",
ADD COLUMN     "company_id" TEXT;

-- AlterTable
ALTER TABLE "returns" DROP COLUMN "user_id",
ADD COLUMN     "company_id" TEXT;

-- AlterTable
ALTER TABLE "sales_invoices" DROP COLUMN "user_id",
ADD COLUMN     "company_id" TEXT;

-- AlterTable
ALTER TABLE "sales_payments_received" DROP COLUMN "user_id",
ADD COLUMN     "company_id" TEXT;

-- AlterTable
ALTER TABLE "settings" DROP COLUMN "user_id",
ADD COLUMN     "company_id" TEXT;

-- AlterTable
ALTER TABLE "stock_movements" DROP COLUMN "user_id",
ADD COLUMN     "company_id" TEXT;

-- AlterTable
ALTER TABLE "suppliers" DROP COLUMN "user_id",
ADD COLUMN     "company_id" TEXT;

-- AlterTable
ALTER TABLE "transactions" ADD COLUMN     "company_id" TEXT;

-- AlterTable
ALTER TABLE "trial_balance_view" DROP COLUMN "user_id",
ADD COLUMN     "company_id" TEXT;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "company_id" TEXT;

-- AlterTable
ALTER TABLE "warehouse_invoices" DROP COLUMN "user_id",
ADD COLUMN     "company_id" TEXT;

-- AlterTable
ALTER TABLE "warehouse_purchases" DROP COLUMN "user_id",
ADD COLUMN     "company_id" TEXT;

-- CreateTable
CREATE TABLE "companies" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "business_type" TEXT,
    "tax_registration_number" TEXT,
    "logo" TEXT,
    "website" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "subscription_plan" TEXT NOT NULL DEFAULT 'trial',
    "subscription_status" TEXT NOT NULL DEFAULT 'active',
    "trial_start_date" TIMESTAMP(3),
    "trial_end_date" TIMESTAMP(3),
    "subscription_start_date" TIMESTAMP(3),
    "subscription_end_date" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "companies_email_key" ON "companies"("email");

-- CreateIndex
CREATE INDEX "companies_email_idx" ON "companies"("email");

-- CreateIndex
CREATE INDEX "companies_is_active_idx" ON "companies"("is_active");

-- CreateIndex
CREATE INDEX "bank_accounts_company_id_idx" ON "bank_accounts"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "bank_accounts_account_number_company_id_key" ON "bank_accounts"("account_number", "company_id");

-- CreateIndex
CREATE INDEX "bills_company_id_idx" ON "bills"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "bills_bill_number_company_id_key" ON "bills"("bill_number", "company_id");

-- CreateIndex
CREATE INDEX "categories_company_id_idx" ON "categories"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "categories_name_company_id_key" ON "categories"("name", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "categories_code_company_id_key" ON "categories"("code", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "categories_slug_company_id_key" ON "categories"("slug", "company_id");

-- CreateIndex
CREATE INDEX "chart_of_accounts_company_id_idx" ON "chart_of_accounts"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "chart_of_accounts_code_company_id_key" ON "chart_of_accounts"("code", "company_id");

-- CreateIndex
CREATE INDEX "credit_notes_company_id_idx" ON "credit_notes"("company_id");

-- CreateIndex
CREATE INDEX "customers_company_id_idx" ON "customers"("company_id");

-- CreateIndex
CREATE INDEX "deliveries_company_id_idx" ON "deliveries"("company_id");

-- CreateIndex
CREATE INDEX "equity_accounts_company_id_idx" ON "equity_accounts"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "equity_accounts_account_code_company_id_key" ON "equity_accounts"("account_code", "company_id");

-- CreateIndex
CREATE INDEX "expenses_company_id_idx" ON "expenses"("company_id");

-- CreateIndex
CREATE INDEX "fiscal_years_company_id_start_date_end_date_idx" ON "fiscal_years"("company_id", "start_date", "end_date");

-- CreateIndex
CREATE UNIQUE INDEX "fiscal_years_company_id_name_key" ON "fiscal_years"("company_id", "name");

-- CreateIndex
CREATE INDEX "fixed_assets_company_id_idx" ON "fixed_assets"("company_id");

-- CreateIndex
CREATE INDEX "goods_receivings_company_id_idx" ON "goods_receivings"("company_id");

-- CreateIndex
CREATE INDEX "incomes_company_id_idx" ON "incomes"("company_id");

-- CreateIndex
CREATE INDEX "journal_entries_company_id_idx" ON "journal_entries"("company_id");

-- CreateIndex
CREATE INDEX "loans_company_id_idx" ON "loans"("company_id");

-- CreateIndex
CREATE INDEX "orders_company_id_idx" ON "orders"("company_id");

-- CreateIndex
CREATE INDEX "payments_made_company_id_idx" ON "payments_made"("company_id");

-- CreateIndex
CREATE INDEX "payments_received_company_id_idx" ON "payments_received"("company_id");

-- CreateIndex
CREATE INDEX "products_company_id_idx" ON "products"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "products_sku_company_id_key" ON "products"("sku", "company_id");

-- CreateIndex
CREATE INDEX "purchase_invoices_company_id_idx" ON "purchase_invoices"("company_id");

-- CreateIndex
CREATE INDEX "purchase_orders_company_id_idx" ON "purchase_orders"("company_id");

-- CreateIndex
CREATE INDEX "purchase_payments_make_company_id_idx" ON "purchase_payments_make"("company_id");

-- CreateIndex
CREATE INDEX "purchase_returns_company_id_idx" ON "purchase_returns"("company_id");

-- CreateIndex
CREATE INDEX "quotations_company_id_idx" ON "quotations"("company_id");

-- CreateIndex
CREATE INDEX "refunds_company_id_idx" ON "refunds"("company_id");

-- CreateIndex
CREATE INDEX "returns_company_id_idx" ON "returns"("company_id");

-- CreateIndex
CREATE INDEX "sales_invoices_company_id_idx" ON "sales_invoices"("company_id");

-- CreateIndex
CREATE INDEX "sales_payments_received_company_id_idx" ON "sales_payments_received"("company_id");

-- CreateIndex
CREATE INDEX "settings_company_id_idx" ON "settings"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "settings_category_name_company_id_key" ON "settings"("category", "name", "company_id");

-- CreateIndex
CREATE INDEX "stock_movements_company_id_idx" ON "stock_movements"("company_id");

-- CreateIndex
CREATE INDEX "suppliers_company_id_idx" ON "suppliers"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "suppliers_code_company_id_key" ON "suppliers"("code", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "suppliers_email_company_id_key" ON "suppliers"("email", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "suppliers_phone_company_id_key" ON "suppliers"("phone", "company_id");

-- CreateIndex
CREATE INDEX "transactions_company_id_idx" ON "transactions"("company_id");

-- CreateIndex
CREATE INDEX "trial_balance_view_company_id_idx" ON "trial_balance_view"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "trial_balance_view_account_id_period_start_period_end_compa_key" ON "trial_balance_view"("account_id", "period_start", "period_end", "company_id");

-- CreateIndex
CREATE INDEX "users_company_id_idx" ON "users"("company_id");

-- CreateIndex
CREATE INDEX "warehouse_invoices_company_id_idx" ON "warehouse_invoices"("company_id");

-- CreateIndex
CREATE INDEX "warehouse_purchases_company_id_idx" ON "warehouse_purchases"("company_id");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fiscal_years" ADD CONSTRAINT "fiscal_years_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settings" ADD CONSTRAINT "settings_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "returns" ADD CONSTRAINT "returns_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouse_purchases" ADD CONSTRAINT "warehouse_purchases_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouse_invoices" ADD CONSTRAINT "warehouse_invoices_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chart_of_accounts" ADD CONSTRAINT "chart_of_accounts_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_payments_received" ADD CONSTRAINT "sales_payments_received_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments_received" ADD CONSTRAINT "payments_received_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bills" ADD CONSTRAINT "bills_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incomes" ADD CONSTRAINT "incomes_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trial_balance_view" ADD CONSTRAINT "trial_balance_view_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments_made" ADD CONSTRAINT "payments_made_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_payments_make" ADD CONSTRAINT "purchase_payments_make_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_returns" ADD CONSTRAINT "purchase_returns_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loans" ADD CONSTRAINT "loans_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equity_accounts" ADD CONSTRAINT "equity_accounts_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receivings" ADD CONSTRAINT "goods_receivings_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_invoices" ADD CONSTRAINT "purchase_invoices_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;
