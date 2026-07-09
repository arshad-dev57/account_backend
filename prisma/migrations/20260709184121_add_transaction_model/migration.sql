/*
  Warnings:

  - A unique constraint covering the columns `[transaction_id]` on the table `journal_entries` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "journal_entries" ADD COLUMN     "transaction_id" TEXT;

-- CreateTable
CREATE TABLE "transactions" (
    "id" TEXT NOT NULL,
    "transaction_number" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "amount" DOUBLE PRECISION NOT NULL,
    "category" TEXT NOT NULL,
    "paymentMethod" TEXT NOT NULL DEFAULT 'Cash',
    "reference" TEXT NOT NULL DEFAULT '',
    "customer_id" TEXT,
    "customerName" TEXT NOT NULL DEFAULT '',
    "vendor_id" TEXT,
    "vendorName" TEXT NOT NULL DEFAULT '',
    "bank_account_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Posted',
    "created_by" TEXT NOT NULL,
    "posted_by" TEXT,
    "posted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "journal_entry_id" TEXT,

    CONSTRAINT "transactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "transactions_transaction_number_key" ON "transactions"("transaction_number");

-- CreateIndex
CREATE UNIQUE INDEX "transactions_journal_entry_id_key" ON "transactions"("journal_entry_id");

-- CreateIndex
CREATE INDEX "transactions_transaction_number_idx" ON "transactions"("transaction_number");

-- CreateIndex
CREATE INDEX "transactions_type_idx" ON "transactions"("type");

-- CreateIndex
CREATE INDEX "transactions_category_idx" ON "transactions"("category");

-- CreateIndex
CREATE INDEX "transactions_date_idx" ON "transactions"("date");

-- CreateIndex
CREATE INDEX "transactions_status_idx" ON "transactions"("status");

-- CreateIndex
CREATE INDEX "transactions_customer_id_idx" ON "transactions"("customer_id");

-- CreateIndex
CREATE INDEX "transactions_vendor_id_idx" ON "transactions"("vendor_id");

-- CreateIndex
CREATE INDEX "transactions_bank_account_id_idx" ON "transactions"("bank_account_id");

-- CreateIndex
CREATE INDEX "transactions_created_by_idx" ON "transactions"("created_by");

-- CreateIndex
CREATE UNIQUE INDEX "journal_entries_transaction_id_key" ON "journal_entries"("transaction_id");

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_bank_account_id_fkey" FOREIGN KEY ("bank_account_id") REFERENCES "bank_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_posted_by_fkey" FOREIGN KEY ("posted_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_journal_entry_id_fkey" FOREIGN KEY ("journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;
