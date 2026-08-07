-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "credit_limit" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "credit_terms" TEXT NOT NULL DEFAULT 'Net 30';

-- AlterTable
ALTER TABLE "equity_accounts" ADD COLUMN     "last_updated" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "sales_invoices" ADD COLUMN     "pos_sale_id" TEXT;

-- CreateTable
CREATE TABLE "equity_transactions" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "type" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "description" TEXT NOT NULL,
    "reference" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'Posted',
    "created_by" TEXT NOT NULL,
    "company_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "equity_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pos_terminals" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Active',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "device_info" JSONB,
    "last_sync_at" TIMESTAMP(3),
    "company_id" TEXT NOT NULL,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pos_terminals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pos_shifts" (
    "id" TEXT NOT NULL,
    "terminal_id" TEXT NOT NULL,
    "cashier_id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Open',
    "opening_cash" DOUBLE PRECISION NOT NULL,
    "closing_cash" DOUBLE PRECISION,
    "expected_cash" DOUBLE PRECISION,
    "actual_cash" DOUBLE PRECISION,
    "difference" DOUBLE PRECISION,
    "opened_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_at" TIMESTAMP(3),
    "suspended_at" TIMESTAMP(3),
    "resumed_at" TIMESTAMP(3),
    "notes" TEXT,
    "approved_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pos_shifts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pos_cash_transactions" (
    "id" TEXT NOT NULL,
    "shift_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "reason" TEXT NOT NULL,
    "approved_by" TEXT,
    "company_id" TEXT NOT NULL,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pos_cash_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pos_sales" (
    "id" TEXT NOT NULL,
    "invoice_number" TEXT NOT NULL,
    "shift_id" TEXT NOT NULL,
    "terminal_id" TEXT NOT NULL,
    "customer_id" TEXT,
    "customer_name" TEXT NOT NULL,
    "customer_email" TEXT,
    "customer_phone" TEXT,
    "subtotal" DOUBLE PRECISION NOT NULL,
    "discount_total" DOUBLE PRECISION NOT NULL,
    "tax_total" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "grand_total" DOUBLE PRECISION NOT NULL,
    "paid_amount" DOUBLE PRECISION NOT NULL,
    "change_amount" DOUBLE PRECISION NOT NULL,
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Completed',
    "fiscal_year_id" TEXT,
    "journal_entry_id" TEXT,
    "invoice_id" TEXT,
    "order_id" TEXT,
    "device_info" JSONB,
    "syncStatus" TEXT NOT NULL DEFAULT 'Completed',
    "sync_failed_reason" TEXT,
    "is_offline" BOOLEAN NOT NULL DEFAULT false,
    "offline_created_at" TIMESTAMP(3),
    "company_id" TEXT NOT NULL,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pos_sales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pos_sale_items" (
    "id" TEXT NOT NULL,
    "pos_sale_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "product_name" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "unit_price" DOUBLE PRECISION NOT NULL,
    "discount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "tax_rate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "tax_amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "line_total" DOUBLE PRECISION NOT NULL,
    "notes" TEXT,

    CONSTRAINT "pos_sale_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pos_sale_payments" (
    "id" TEXT NOT NULL,
    "pos_sale_id" TEXT NOT NULL,
    "payment_method" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "reference" TEXT DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pos_sale_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pos_returns" (
    "id" TEXT NOT NULL,
    "original_sale_id" TEXT NOT NULL,
    "return_number" TEXT NOT NULL,
    "shift_id" TEXT NOT NULL,
    "subtotal" DOUBLE PRECISION NOT NULL,
    "discount_total" DOUBLE PRECISION NOT NULL,
    "tax_total" DOUBLE PRECISION NOT NULL,
    "grand_total" DOUBLE PRECISION NOT NULL,
    "refunded_amount" DOUBLE PRECISION NOT NULL,
    "refund_method" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "approved_by" TEXT NOT NULL,
    "fiscal_year_id" TEXT,
    "journal_entry_id" TEXT,
    "company_id" TEXT NOT NULL,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pos_returns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pos_return_items" (
    "id" TEXT NOT NULL,
    "pos_return_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "unit_price" DOUBLE PRECISION NOT NULL,
    "line_total" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "pos_return_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pos_audit_logs" (
    "id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "details" TEXT NOT NULL DEFAULT '',
    "company_id" TEXT NOT NULL,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pos_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_jurisdictions" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "parent_id" TEXT,
    "country_code" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "company_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tax_jurisdictions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_types" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "calculationType" TEXT NOT NULL DEFAULT 'percentage',
    "is_compound" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "company_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tax_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_rates" (
    "id" TEXT NOT NULL,
    "jurisdiction_id" TEXT NOT NULL,
    "tax_type_id" TEXT NOT NULL,
    "rate" DOUBLE PRECISION NOT NULL,
    "effective_from" TIMESTAMP(3) NOT NULL,
    "effective_to" TIMESTAMP(3),
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "company_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tax_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_rules" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tax_rate_id" TEXT NOT NULL,
    "product_category_id" TEXT,
    "product_id" TEXT,
    "customer_group_id" TEXT,
    "pricingModel" TEXT NOT NULL DEFAULT 'exclusive',
    "exemption_allowed" BOOLEAN NOT NULL DEFAULT true,
    "compound_on" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "company_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tax_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_exemption_types" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "percentage" DOUBLE PRECISION NOT NULL DEFAULT 100,
    "requires_certificate" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "company_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tax_exemption_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_exemptions" (
    "id" TEXT NOT NULL,
    "exemption_type_id" TEXT NOT NULL,
    "customer_id" TEXT,
    "product_id" TEXT,
    "product_category_id" TEXT,
    "certificate_number" TEXT,
    "certificate_issued_at" TIMESTAMP(3),
    "certificate_expires_at" TIMESTAMP(3),
    "approved_by" TEXT,
    "approved_at" TIMESTAMP(3),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "company_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tax_exemptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_transactions" (
    "id" TEXT NOT NULL,
    "transaction_id" TEXT NOT NULL,
    "transaction_type" TEXT NOT NULL,
    "jurisdiction_id" TEXT NOT NULL,
    "tax_type_id" TEXT NOT NULL,
    "tax_rate_id" TEXT NOT NULL,
    "taxable_amount" DOUBLE PRECISION NOT NULL,
    "tax_rate" DOUBLE PRECISION NOT NULL,
    "tax_amount" DOUBLE PRECISION NOT NULL,
    "exemption_amount" DOUBLE PRECISION NOT NULL,
    "is_compound" BOOLEAN NOT NULL DEFAULT false,
    "compound_on_id" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "exchange_rate" DOUBLE PRECISION,
    "company_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tax_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "equity_transactions_account_id_idx" ON "equity_transactions"("account_id");

-- CreateIndex
CREATE INDEX "equity_transactions_type_idx" ON "equity_transactions"("type");

-- CreateIndex
CREATE INDEX "equity_transactions_company_id_idx" ON "equity_transactions"("company_id");

-- CreateIndex
CREATE INDEX "pos_terminals_company_id_idx" ON "pos_terminals"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "pos_terminals_code_company_id_key" ON "pos_terminals"("code", "company_id");

-- CreateIndex
CREATE INDEX "pos_shifts_terminal_id_idx" ON "pos_shifts"("terminal_id");

-- CreateIndex
CREATE INDEX "pos_shifts_cashier_id_idx" ON "pos_shifts"("cashier_id");

-- CreateIndex
CREATE INDEX "pos_shifts_company_id_idx" ON "pos_shifts"("company_id");

-- CreateIndex
CREATE INDEX "pos_cash_transactions_shift_id_idx" ON "pos_cash_transactions"("shift_id");

-- CreateIndex
CREATE INDEX "pos_cash_transactions_company_id_idx" ON "pos_cash_transactions"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "pos_sales_journal_entry_id_key" ON "pos_sales"("journal_entry_id");

-- CreateIndex
CREATE INDEX "pos_sales_shift_id_idx" ON "pos_sales"("shift_id");

-- CreateIndex
CREATE INDEX "pos_sales_terminal_id_idx" ON "pos_sales"("terminal_id");

-- CreateIndex
CREATE INDEX "pos_sales_company_id_idx" ON "pos_sales"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "pos_sales_invoice_number_company_id_key" ON "pos_sales"("invoice_number", "company_id");

-- CreateIndex
CREATE INDEX "pos_sale_items_pos_sale_id_idx" ON "pos_sale_items"("pos_sale_id");

-- CreateIndex
CREATE INDEX "pos_sale_items_product_id_idx" ON "pos_sale_items"("product_id");

-- CreateIndex
CREATE INDEX "pos_sale_payments_pos_sale_id_idx" ON "pos_sale_payments"("pos_sale_id");

-- CreateIndex
CREATE UNIQUE INDEX "pos_returns_journal_entry_id_key" ON "pos_returns"("journal_entry_id");

-- CreateIndex
CREATE INDEX "pos_returns_original_sale_id_idx" ON "pos_returns"("original_sale_id");

-- CreateIndex
CREATE INDEX "pos_returns_shift_id_idx" ON "pos_returns"("shift_id");

-- CreateIndex
CREATE INDEX "pos_returns_company_id_idx" ON "pos_returns"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "pos_returns_return_number_company_id_key" ON "pos_returns"("return_number", "company_id");

-- CreateIndex
CREATE INDEX "pos_return_items_pos_return_id_idx" ON "pos_return_items"("pos_return_id");

-- CreateIndex
CREATE INDEX "pos_return_items_product_id_idx" ON "pos_return_items"("product_id");

-- CreateIndex
CREATE INDEX "pos_audit_logs_company_id_idx" ON "pos_audit_logs"("company_id");

-- CreateIndex
CREATE INDEX "pos_audit_logs_created_by_idx" ON "pos_audit_logs"("created_by");

-- CreateIndex
CREATE UNIQUE INDEX "tax_jurisdictions_code_key" ON "tax_jurisdictions"("code");

-- CreateIndex
CREATE INDEX "tax_jurisdictions_parent_id_idx" ON "tax_jurisdictions"("parent_id");

-- CreateIndex
CREATE INDEX "tax_jurisdictions_country_code_idx" ON "tax_jurisdictions"("country_code");

-- CreateIndex
CREATE INDEX "tax_jurisdictions_company_id_idx" ON "tax_jurisdictions"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "tax_types_code_key" ON "tax_types"("code");

-- CreateIndex
CREATE INDEX "tax_types_company_id_idx" ON "tax_types"("company_id");

-- CreateIndex
CREATE INDEX "tax_rates_jurisdiction_id_idx" ON "tax_rates"("jurisdiction_id");

-- CreateIndex
CREATE INDEX "tax_rates_tax_type_id_idx" ON "tax_rates"("tax_type_id");

-- CreateIndex
CREATE INDEX "tax_rates_company_id_idx" ON "tax_rates"("company_id");

-- CreateIndex
CREATE INDEX "tax_rules_tax_rate_id_idx" ON "tax_rules"("tax_rate_id");

-- CreateIndex
CREATE INDEX "tax_rules_product_category_id_idx" ON "tax_rules"("product_category_id");

-- CreateIndex
CREATE INDEX "tax_rules_product_id_idx" ON "tax_rules"("product_id");

-- CreateIndex
CREATE INDEX "tax_rules_company_id_idx" ON "tax_rules"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "tax_exemption_types_code_key" ON "tax_exemption_types"("code");

-- CreateIndex
CREATE INDEX "tax_exemption_types_company_id_idx" ON "tax_exemption_types"("company_id");

-- CreateIndex
CREATE INDEX "tax_exemptions_exemption_type_id_idx" ON "tax_exemptions"("exemption_type_id");

-- CreateIndex
CREATE INDEX "tax_exemptions_customer_id_idx" ON "tax_exemptions"("customer_id");

-- CreateIndex
CREATE INDEX "tax_exemptions_product_id_idx" ON "tax_exemptions"("product_id");

-- CreateIndex
CREATE INDEX "tax_exemptions_company_id_idx" ON "tax_exemptions"("company_id");

-- CreateIndex
CREATE INDEX "tax_transactions_transaction_id_idx" ON "tax_transactions"("transaction_id");

-- CreateIndex
CREATE INDEX "tax_transactions_transaction_type_idx" ON "tax_transactions"("transaction_type");

-- CreateIndex
CREATE INDEX "tax_transactions_jurisdiction_id_idx" ON "tax_transactions"("jurisdiction_id");

-- CreateIndex
CREATE INDEX "tax_transactions_tax_type_id_idx" ON "tax_transactions"("tax_type_id");

-- CreateIndex
CREATE INDEX "tax_transactions_company_id_idx" ON "tax_transactions"("company_id");

-- AddForeignKey
ALTER TABLE "equity_transactions" ADD CONSTRAINT "equity_transactions_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "equity_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equity_transactions" ADD CONSTRAINT "equity_transactions_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_terminals" ADD CONSTRAINT "pos_terminals_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_terminals" ADD CONSTRAINT "pos_terminals_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_shifts" ADD CONSTRAINT "pos_shifts_terminal_id_fkey" FOREIGN KEY ("terminal_id") REFERENCES "pos_terminals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_shifts" ADD CONSTRAINT "pos_shifts_cashier_id_fkey" FOREIGN KEY ("cashier_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_shifts" ADD CONSTRAINT "pos_shifts_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_cash_transactions" ADD CONSTRAINT "pos_cash_transactions_shift_id_fkey" FOREIGN KEY ("shift_id") REFERENCES "pos_shifts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_sales" ADD CONSTRAINT "pos_sales_shift_id_fkey" FOREIGN KEY ("shift_id") REFERENCES "pos_shifts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_sales" ADD CONSTRAINT "pos_sales_terminal_id_fkey" FOREIGN KEY ("terminal_id") REFERENCES "pos_terminals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_sales" ADD CONSTRAINT "pos_sales_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_sales" ADD CONSTRAINT "pos_sales_fiscal_year_id_fkey" FOREIGN KEY ("fiscal_year_id") REFERENCES "fiscal_years"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_sales" ADD CONSTRAINT "pos_sales_journal_entry_id_fkey" FOREIGN KEY ("journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_sales" ADD CONSTRAINT "pos_sales_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_sales" ADD CONSTRAINT "pos_sales_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_sale_items" ADD CONSTRAINT "pos_sale_items_pos_sale_id_fkey" FOREIGN KEY ("pos_sale_id") REFERENCES "pos_sales"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_sale_items" ADD CONSTRAINT "pos_sale_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_sale_payments" ADD CONSTRAINT "pos_sale_payments_pos_sale_id_fkey" FOREIGN KEY ("pos_sale_id") REFERENCES "pos_sales"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_returns" ADD CONSTRAINT "pos_returns_original_sale_id_fkey" FOREIGN KEY ("original_sale_id") REFERENCES "pos_sales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_returns" ADD CONSTRAINT "pos_returns_shift_id_fkey" FOREIGN KEY ("shift_id") REFERENCES "pos_shifts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_returns" ADD CONSTRAINT "pos_returns_journal_entry_id_fkey" FOREIGN KEY ("journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_returns" ADD CONSTRAINT "pos_returns_fiscal_year_id_fkey" FOREIGN KEY ("fiscal_year_id") REFERENCES "fiscal_years"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_returns" ADD CONSTRAINT "pos_returns_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_returns" ADD CONSTRAINT "pos_returns_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_return_items" ADD CONSTRAINT "pos_return_items_pos_return_id_fkey" FOREIGN KEY ("pos_return_id") REFERENCES "pos_returns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_return_items" ADD CONSTRAINT "pos_return_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_audit_logs" ADD CONSTRAINT "pos_audit_logs_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_audit_logs" ADD CONSTRAINT "pos_audit_logs_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_jurisdictions" ADD CONSTRAINT "tax_jurisdictions_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "tax_jurisdictions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_jurisdictions" ADD CONSTRAINT "tax_jurisdictions_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_types" ADD CONSTRAINT "tax_types_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_rates" ADD CONSTRAINT "tax_rates_jurisdiction_id_fkey" FOREIGN KEY ("jurisdiction_id") REFERENCES "tax_jurisdictions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_rates" ADD CONSTRAINT "tax_rates_tax_type_id_fkey" FOREIGN KEY ("tax_type_id") REFERENCES "tax_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_rates" ADD CONSTRAINT "tax_rates_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_rules" ADD CONSTRAINT "tax_rules_tax_rate_id_fkey" FOREIGN KEY ("tax_rate_id") REFERENCES "tax_rates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_rules" ADD CONSTRAINT "tax_rules_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_exemption_types" ADD CONSTRAINT "tax_exemption_types_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_exemptions" ADD CONSTRAINT "tax_exemptions_exemption_type_id_fkey" FOREIGN KEY ("exemption_type_id") REFERENCES "tax_exemption_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_exemptions" ADD CONSTRAINT "tax_exemptions_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_exemptions" ADD CONSTRAINT "tax_exemptions_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_exemptions" ADD CONSTRAINT "tax_exemptions_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_exemptions" ADD CONSTRAINT "tax_exemptions_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_transactions" ADD CONSTRAINT "tax_transactions_jurisdiction_id_fkey" FOREIGN KEY ("jurisdiction_id") REFERENCES "tax_jurisdictions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_transactions" ADD CONSTRAINT "tax_transactions_tax_type_id_fkey" FOREIGN KEY ("tax_type_id") REFERENCES "tax_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_transactions" ADD CONSTRAINT "tax_transactions_tax_rate_id_fkey" FOREIGN KEY ("tax_rate_id") REFERENCES "tax_rates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_transactions" ADD CONSTRAINT "tax_transactions_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
