/*
  Warnings:

  - A unique constraint covering the columns `[purchase_payment_id]` on the table `journal_entries` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "journal_entries" ADD COLUMN     "purchase_payment_id" TEXT;

-- CreateTable
CREATE TABLE "purchase_payment_invoices" (
    "id" TEXT NOT NULL,
    "payment_id" TEXT NOT NULL,
    "invoice_id" TEXT NOT NULL,
    "invoice_number" TEXT NOT NULL,
    "amount_paid" DOUBLE PRECISION NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchase_payment_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_payments_make" (
    "id" TEXT NOT NULL,
    "payment_number" TEXT NOT NULL,
    "payment_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "supplier_id" TEXT NOT NULL,
    "supplier_name" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "payment_method" TEXT NOT NULL,
    "reference_no" TEXT NOT NULL DEFAULT '',
    "notes" TEXT NOT NULL DEFAULT '',
    "bank_account_id" TEXT,
    "bank_account_name" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'Completed',
    "journal_entry_id" TEXT,
    "created_by" TEXT NOT NULL,
    "updated_by" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchase_payments_make_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_PaymentMakeAPRecords" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL
);

-- CreateIndex
CREATE INDEX "purchase_payment_invoices_payment_id_idx" ON "purchase_payment_invoices"("payment_id");

-- CreateIndex
CREATE INDEX "purchase_payment_invoices_invoice_id_idx" ON "purchase_payment_invoices"("invoice_id");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_payments_make_payment_number_key" ON "purchase_payments_make"("payment_number");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_payments_make_journal_entry_id_key" ON "purchase_payments_make"("journal_entry_id");

-- CreateIndex
CREATE INDEX "purchase_payments_make_payment_number_idx" ON "purchase_payments_make"("payment_number");

-- CreateIndex
CREATE INDEX "purchase_payments_make_supplier_id_idx" ON "purchase_payments_make"("supplier_id");

-- CreateIndex
CREATE INDEX "purchase_payments_make_payment_date_idx" ON "purchase_payments_make"("payment_date");

-- CreateIndex
CREATE INDEX "purchase_payments_make_status_idx" ON "purchase_payments_make"("status");

-- CreateIndex
CREATE INDEX "purchase_payments_make_created_by_idx" ON "purchase_payments_make"("created_by");

-- CreateIndex
CREATE INDEX "purchase_payments_make_payment_method_idx" ON "purchase_payments_make"("payment_method");

-- CreateIndex
CREATE INDEX "purchase_payments_make_user_id_idx" ON "purchase_payments_make"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "_PaymentMakeAPRecords_AB_unique" ON "_PaymentMakeAPRecords"("A", "B");

-- CreateIndex
CREATE INDEX "_PaymentMakeAPRecords_B_index" ON "_PaymentMakeAPRecords"("B");

-- CreateIndex
CREATE UNIQUE INDEX "journal_entries_purchase_payment_id_key" ON "journal_entries"("purchase_payment_id");

-- AddForeignKey
ALTER TABLE "purchase_payment_invoices" ADD CONSTRAINT "purchase_payment_invoices_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "purchase_payments_make"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_payment_invoices" ADD CONSTRAINT "purchase_payment_invoices_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "purchase_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_payments_make" ADD CONSTRAINT "purchase_payments_make_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_payments_make" ADD CONSTRAINT "purchase_payments_make_bank_account_id_fkey" FOREIGN KEY ("bank_account_id") REFERENCES "bank_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_payments_make" ADD CONSTRAINT "purchase_payments_make_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_payments_make" ADD CONSTRAINT "purchase_payments_make_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_payments_make" ADD CONSTRAINT "purchase_payments_make_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_payments_make" ADD CONSTRAINT "purchase_payments_make_journal_entry_id_fkey" FOREIGN KEY ("journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_PaymentMakeAPRecords" ADD CONSTRAINT "_PaymentMakeAPRecords_A_fkey" FOREIGN KEY ("A") REFERENCES "accounts_payable"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_PaymentMakeAPRecords" ADD CONSTRAINT "_PaymentMakeAPRecords_B_fkey" FOREIGN KEY ("B") REFERENCES "purchase_payments_make"("id") ON DELETE CASCADE ON UPDATE CASCADE;
