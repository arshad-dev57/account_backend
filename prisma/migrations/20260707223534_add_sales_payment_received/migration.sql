-- CreateTable
CREATE TABLE "sales_payments_received" (
    "id" TEXT NOT NULL,
    "payment_number" TEXT NOT NULL,
    "payment_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "customer_id" TEXT NOT NULL,
    "customer_name" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "payment_method" TEXT NOT NULL,
    "reference" TEXT DEFAULT '',
    "bank_account_id" TEXT,
    "bank_account_name" TEXT DEFAULT '',
    "notes" TEXT DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'Completed',
    "created_by" TEXT NOT NULL,
    "updated_by" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "journal_entry_id" TEXT,
    "ar_record_id" TEXT,

    CONSTRAINT "sales_payments_received_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_invoice_payments" (
    "id" TEXT NOT NULL,
    "payment_id" TEXT NOT NULL,
    "invoice_id" TEXT NOT NULL,
    "invoice_number" TEXT NOT NULL,
    "amount_paid" DOUBLE PRECISION NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_invoice_payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sales_payments_received_payment_number_key" ON "sales_payments_received"("payment_number");

-- CreateIndex
CREATE UNIQUE INDEX "sales_payments_received_journal_entry_id_key" ON "sales_payments_received"("journal_entry_id");

-- CreateIndex
CREATE INDEX "sales_payments_received_payment_number_idx" ON "sales_payments_received"("payment_number");

-- CreateIndex
CREATE INDEX "sales_payments_received_customer_id_idx" ON "sales_payments_received"("customer_id");

-- CreateIndex
CREATE INDEX "sales_payments_received_payment_date_idx" ON "sales_payments_received"("payment_date");

-- CreateIndex
CREATE INDEX "sales_payments_received_status_idx" ON "sales_payments_received"("status");

-- CreateIndex
CREATE INDEX "sales_payments_received_is_active_idx" ON "sales_payments_received"("is_active");

-- CreateIndex
CREATE INDEX "sales_payments_received_user_id_idx" ON "sales_payments_received"("user_id");

-- CreateIndex
CREATE INDEX "sales_invoice_payments_payment_id_idx" ON "sales_invoice_payments"("payment_id");

-- CreateIndex
CREATE INDEX "sales_invoice_payments_invoice_id_idx" ON "sales_invoice_payments"("invoice_id");

-- AddForeignKey
ALTER TABLE "sales_payments_received" ADD CONSTRAINT "sales_payments_received_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_payments_received" ADD CONSTRAINT "sales_payments_received_bank_account_id_fkey" FOREIGN KEY ("bank_account_id") REFERENCES "bank_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_payments_received" ADD CONSTRAINT "sales_payments_received_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_payments_received" ADD CONSTRAINT "sales_payments_received_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_payments_received" ADD CONSTRAINT "sales_payments_received_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_payments_received" ADD CONSTRAINT "sales_payments_received_journal_entry_id_fkey" FOREIGN KEY ("journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_payments_received" ADD CONSTRAINT "sales_payments_received_ar_record_id_fkey" FOREIGN KEY ("ar_record_id") REFERENCES "accounts_receivable"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_invoice_payments" ADD CONSTRAINT "sales_invoice_payments_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "sales_payments_received"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_invoice_payments" ADD CONSTRAINT "sales_invoice_payments_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "sales_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments_received" ADD CONSTRAINT "payments_received_bank_account_id_fkey" FOREIGN KEY ("bank_account_id") REFERENCES "bank_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
