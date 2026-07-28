-- AlterTable
ALTER TABLE "accounts_payable" ADD COLUMN     "fiscal_year_id" TEXT;

-- AlterTable
ALTER TABLE "accounts_receivable" ADD COLUMN     "fiscal_year_id" TEXT;

-- AlterTable
ALTER TABLE "credit_notes" ADD COLUMN     "fiscal_year_id" TEXT;

-- AlterTable
ALTER TABLE "expenses" ADD COLUMN     "fiscal_year_id" TEXT;

-- AlterTable
ALTER TABLE "fixed_assets" ADD COLUMN     "fiscal_year_id" TEXT;

-- AlterTable
ALTER TABLE "incomes" ADD COLUMN     "fiscal_year_id" TEXT;

-- AlterTable
ALTER TABLE "journal_entries" ADD COLUMN     "fiscal_year_id" TEXT,
ADD COLUMN     "type" TEXT NOT NULL DEFAULT 'Normal';

-- AlterTable
ALTER TABLE "loans" ADD COLUMN     "fiscal_year_id" TEXT;

-- AlterTable
ALTER TABLE "payments_made" ADD COLUMN     "fiscal_year_id" TEXT;

-- AlterTable
ALTER TABLE "payments_received" ADD COLUMN     "fiscal_year_id" TEXT;

-- AlterTable
ALTER TABLE "purchase_invoices" ADD COLUMN     "fiscal_year_id" TEXT;

-- AlterTable
ALTER TABLE "purchase_payments_make" ADD COLUMN     "fiscal_year_id" TEXT;

-- AlterTable
ALTER TABLE "purchase_returns" ADD COLUMN     "fiscal_year_id" TEXT;

-- AlterTable
ALTER TABLE "sales_invoices" ADD COLUMN     "fiscal_year_id" TEXT;

-- AlterTable
ALTER TABLE "sales_payments_received" ADD COLUMN     "fiscal_year_id" TEXT;

-- AlterTable
ALTER TABLE "transactions" ADD COLUMN     "fiscal_year_id" TEXT;

-- CreateTable
CREATE TABLE "fiscal_years" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "start_date" TIMESTAMP(3) NOT NULL,
    "end_date" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Open',
    "closed_at" TIMESTAMP(3),
    "closed_by" TEXT,
    "period_type" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fiscal_years_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fiscal_year_audit_logs" (
    "id" TEXT NOT NULL,
    "fiscal_year_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "details" JSONB,
    "ip_address" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fiscal_year_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "fiscal_years_user_id_start_date_end_date_idx" ON "fiscal_years"("user_id", "start_date", "end_date");

-- CreateIndex
CREATE UNIQUE INDEX "fiscal_years_user_id_name_key" ON "fiscal_years"("user_id", "name");

-- CreateIndex
CREATE INDEX "fiscal_year_audit_logs_fiscal_year_id_idx" ON "fiscal_year_audit_logs"("fiscal_year_id");

-- CreateIndex
CREATE INDEX "fiscal_year_audit_logs_user_id_idx" ON "fiscal_year_audit_logs"("user_id");

-- CreateIndex
CREATE INDEX "accounts_payable_fiscal_year_id_idx" ON "accounts_payable"("fiscal_year_id");

-- CreateIndex
CREATE INDEX "accounts_receivable_fiscal_year_id_idx" ON "accounts_receivable"("fiscal_year_id");

-- CreateIndex
CREATE INDEX "credit_notes_fiscal_year_id_idx" ON "credit_notes"("fiscal_year_id");

-- CreateIndex
CREATE INDEX "expenses_fiscal_year_id_idx" ON "expenses"("fiscal_year_id");

-- CreateIndex
CREATE INDEX "fixed_assets_fiscal_year_id_idx" ON "fixed_assets"("fiscal_year_id");

-- CreateIndex
CREATE INDEX "incomes_fiscal_year_id_idx" ON "incomes"("fiscal_year_id");

-- CreateIndex
CREATE INDEX "journal_entries_fiscal_year_id_idx" ON "journal_entries"("fiscal_year_id");

-- CreateIndex
CREATE INDEX "loans_fiscal_year_id_idx" ON "loans"("fiscal_year_id");

-- CreateIndex
CREATE INDEX "payments_made_fiscal_year_id_idx" ON "payments_made"("fiscal_year_id");

-- CreateIndex
CREATE INDEX "payments_received_fiscal_year_id_idx" ON "payments_received"("fiscal_year_id");

-- CreateIndex
CREATE INDEX "purchase_invoices_fiscal_year_id_idx" ON "purchase_invoices"("fiscal_year_id");

-- CreateIndex
CREATE INDEX "purchase_payments_make_fiscal_year_id_idx" ON "purchase_payments_make"("fiscal_year_id");

-- CreateIndex
CREATE INDEX "purchase_returns_fiscal_year_id_idx" ON "purchase_returns"("fiscal_year_id");

-- CreateIndex
CREATE INDEX "sales_invoices_fiscal_year_id_idx" ON "sales_invoices"("fiscal_year_id");

-- CreateIndex
CREATE INDEX "sales_payments_received_fiscal_year_id_idx" ON "sales_payments_received"("fiscal_year_id");

-- CreateIndex
CREATE INDEX "transactions_fiscal_year_id_idx" ON "transactions"("fiscal_year_id");

-- AddForeignKey
ALTER TABLE "fiscal_years" ADD CONSTRAINT "fiscal_years_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fiscal_year_audit_logs" ADD CONSTRAINT "fiscal_year_audit_logs_fiscal_year_id_fkey" FOREIGN KEY ("fiscal_year_id") REFERENCES "fiscal_years"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fiscal_year_audit_logs" ADD CONSTRAINT "fiscal_year_audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts_receivable" ADD CONSTRAINT "accounts_receivable_fiscal_year_id_fkey" FOREIGN KEY ("fiscal_year_id") REFERENCES "fiscal_years"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts_payable" ADD CONSTRAINT "accounts_payable_fiscal_year_id_fkey" FOREIGN KEY ("fiscal_year_id") REFERENCES "fiscal_years"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_payments_received" ADD CONSTRAINT "sales_payments_received_fiscal_year_id_fkey" FOREIGN KEY ("fiscal_year_id") REFERENCES "fiscal_years"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments_received" ADD CONSTRAINT "payments_received_fiscal_year_id_fkey" FOREIGN KEY ("fiscal_year_id") REFERENCES "fiscal_years"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_fiscal_year_id_fkey" FOREIGN KEY ("fiscal_year_id") REFERENCES "fiscal_years"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incomes" ADD CONSTRAINT "incomes_fiscal_year_id_fkey" FOREIGN KEY ("fiscal_year_id") REFERENCES "fiscal_years"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_fiscal_year_id_fkey" FOREIGN KEY ("fiscal_year_id") REFERENCES "fiscal_years"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments_made" ADD CONSTRAINT "payments_made_fiscal_year_id_fkey" FOREIGN KEY ("fiscal_year_id") REFERENCES "fiscal_years"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_payments_make" ADD CONSTRAINT "purchase_payments_make_fiscal_year_id_fkey" FOREIGN KEY ("fiscal_year_id") REFERENCES "fiscal_years"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_returns" ADD CONSTRAINT "purchase_returns_fiscal_year_id_fkey" FOREIGN KEY ("fiscal_year_id") REFERENCES "fiscal_years"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_fiscal_year_id_fkey" FOREIGN KEY ("fiscal_year_id") REFERENCES "fiscal_years"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_fiscal_year_id_fkey" FOREIGN KEY ("fiscal_year_id") REFERENCES "fiscal_years"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loans" ADD CONSTRAINT "loans_fiscal_year_id_fkey" FOREIGN KEY ("fiscal_year_id") REFERENCES "fiscal_years"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_invoices" ADD CONSTRAINT "purchase_invoices_fiscal_year_id_fkey" FOREIGN KEY ("fiscal_year_id") REFERENCES "fiscal_years"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_fiscal_year_id_fkey" FOREIGN KEY ("fiscal_year_id") REFERENCES "fiscal_years"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_fiscal_year_id_fkey" FOREIGN KEY ("fiscal_year_id") REFERENCES "fiscal_years"("id") ON DELETE SET NULL ON UPDATE CASCADE;
