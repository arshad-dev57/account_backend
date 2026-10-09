-- AlterTable
ALTER TABLE "bank_accounts" ADD COLUMN IF NOT EXISTS "statement_column_mapping" JSONB;

-- CreateTable
CREATE TABLE IF NOT EXISTS "bank_statement_imports" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "bank_account_id" TEXT NOT NULL,
    "file_name" TEXT,
    "file_type" TEXT,
    "status" TEXT NOT NULL DEFAULT 'preview',
    "statement_start_date" TIMESTAMP(3),
    "statement_end_date" TIMESTAMP(3),
    "opening_balance" DOUBLE PRECISION,
    "closing_balance" DOUBLE PRECISION,
    "row_count" INTEGER NOT NULL DEFAULT 0,
    "duplicate_count" INTEGER NOT NULL DEFAULT 0,
    "column_mapping" JSONB,
    "imported_by" TEXT NOT NULL,
    "imported_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bank_statement_imports_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "bank_reconciliations" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "bank_account_id" TEXT NOT NULL,
    "import_id" TEXT,
    "statement_start_date" TIMESTAMP(3) NOT NULL,
    "statement_end_date" TIMESTAMP(3) NOT NULL,
    "statement_opening_balance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "statement_closing_balance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "book_opening_balance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "book_closing_balance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "difference" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "reconciled_amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "unreconciled_amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "outstanding_deposits" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "outstanding_payments" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "bank_charges_total" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "bank_interest_total" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "other_adjustments" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "matched_count" INTEGER NOT NULL DEFAULT 0,
    "unmatched_bank_count" INTEGER NOT NULL DEFAULT 0,
    "unmatched_book_count" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "exception_allowed" BOOLEAN NOT NULL DEFAULT false,
    "exception_note" TEXT,
    "completed_by" TEXT,
    "completed_at" TIMESTAMP(3),
    "reopened_by" TEXT,
    "reopened_at" TIMESTAMP(3),
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bank_reconciliations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "bank_statement_transactions" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "bank_account_id" TEXT NOT NULL,
    "import_id" TEXT NOT NULL,
    "reconciliation_id" TEXT,
    "transaction_date" TIMESTAMP(3) NOT NULL,
    "value_date" TIMESTAMP(3),
    "description" TEXT NOT NULL DEFAULT '',
    "reference" TEXT NOT NULL DEFAULT '',
    "debit" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "credit" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "running_balance" DOUBLE PRECISION,
    "fingerprint" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'unmatched',
    "matched_journal_line_id" TEXT,
    "notes" TEXT,
    "imported_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bank_statement_transactions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "bank_reconciliation_matches" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "reconciliation_id" TEXT NOT NULL,
    "statement_transaction_id" TEXT NOT NULL,
    "journal_line_id" TEXT NOT NULL,
    "journal_entry_id" TEXT NOT NULL,
    "match_type" TEXT NOT NULL DEFAULT 'manual',
    "match_score" DOUBLE PRECISION,
    "match_reason" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "matched_by" TEXT,
    "matched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "unmatched_at" TIMESTAMP(3),

    CONSTRAINT "bank_reconciliation_matches_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE INDEX IF NOT EXISTS "bank_statement_imports_company_id_idx" ON "bank_statement_imports"("company_id");
CREATE INDEX IF NOT EXISTS "bank_statement_imports_bank_account_id_idx" ON "bank_statement_imports"("bank_account_id");
CREATE INDEX IF NOT EXISTS "bank_statement_imports_status_idx" ON "bank_statement_imports"("status");
CREATE INDEX IF NOT EXISTS "bank_statement_imports_imported_by_idx" ON "bank_statement_imports"("imported_by");

CREATE INDEX IF NOT EXISTS "bank_reconciliations_company_id_idx" ON "bank_reconciliations"("company_id");
CREATE INDEX IF NOT EXISTS "bank_reconciliations_bank_account_id_idx" ON "bank_reconciliations"("bank_account_id");
CREATE INDEX IF NOT EXISTS "bank_reconciliations_status_idx" ON "bank_reconciliations"("status");
CREATE INDEX IF NOT EXISTS "bank_reconciliations_statement_start_date_statement_end_date_idx" ON "bank_reconciliations"("statement_start_date", "statement_end_date");
CREATE INDEX IF NOT EXISTS "bank_reconciliations_created_by_idx" ON "bank_reconciliations"("created_by");
CREATE INDEX IF NOT EXISTS "bank_reconciliations_completed_by_idx" ON "bank_reconciliations"("completed_by");

CREATE UNIQUE INDEX IF NOT EXISTS "bank_statement_transactions_company_id_bank_account_id_fingerprint_key" ON "bank_statement_transactions"("company_id", "bank_account_id", "fingerprint");
CREATE INDEX IF NOT EXISTS "bank_statement_transactions_company_id_idx" ON "bank_statement_transactions"("company_id");
CREATE INDEX IF NOT EXISTS "bank_statement_transactions_bank_account_id_idx" ON "bank_statement_transactions"("bank_account_id");
CREATE INDEX IF NOT EXISTS "bank_statement_transactions_import_id_idx" ON "bank_statement_transactions"("import_id");
CREATE INDEX IF NOT EXISTS "bank_statement_transactions_reconciliation_id_idx" ON "bank_statement_transactions"("reconciliation_id");
CREATE INDEX IF NOT EXISTS "bank_statement_transactions_status_idx" ON "bank_statement_transactions"("status");
CREATE INDEX IF NOT EXISTS "bank_statement_transactions_transaction_date_idx" ON "bank_statement_transactions"("transaction_date");
CREATE INDEX IF NOT EXISTS "bank_statement_transactions_matched_journal_line_id_idx" ON "bank_statement_transactions"("matched_journal_line_id");

CREATE INDEX IF NOT EXISTS "bank_reconciliation_matches_company_id_idx" ON "bank_reconciliation_matches"("company_id");
CREATE INDEX IF NOT EXISTS "bank_reconciliation_matches_reconciliation_id_idx" ON "bank_reconciliation_matches"("reconciliation_id");
CREATE INDEX IF NOT EXISTS "bank_reconciliation_matches_statement_transaction_id_idx" ON "bank_reconciliation_matches"("statement_transaction_id");
CREATE INDEX IF NOT EXISTS "bank_reconciliation_matches_journal_line_id_idx" ON "bank_reconciliation_matches"("journal_line_id");
CREATE INDEX IF NOT EXISTS "bank_reconciliation_matches_is_active_idx" ON "bank_reconciliation_matches"("is_active");

CREATE INDEX IF NOT EXISTS "journal_lines_is_reconciled_idx" ON "journal_lines"("is_reconciled");

-- FKs
ALTER TABLE "bank_statement_imports" DROP CONSTRAINT IF EXISTS "bank_statement_imports_company_id_fkey";
ALTER TABLE "bank_statement_imports" ADD CONSTRAINT "bank_statement_imports_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "bank_statement_imports" DROP CONSTRAINT IF EXISTS "bank_statement_imports_bank_account_id_fkey";
ALTER TABLE "bank_statement_imports" ADD CONSTRAINT "bank_statement_imports_bank_account_id_fkey" FOREIGN KEY ("bank_account_id") REFERENCES "bank_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "bank_statement_imports" DROP CONSTRAINT IF EXISTS "bank_statement_imports_imported_by_fkey";
ALTER TABLE "bank_statement_imports" ADD CONSTRAINT "bank_statement_imports_imported_by_fkey" FOREIGN KEY ("imported_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "bank_reconciliations" DROP CONSTRAINT IF EXISTS "bank_reconciliations_company_id_fkey";
ALTER TABLE "bank_reconciliations" ADD CONSTRAINT "bank_reconciliations_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "bank_reconciliations" DROP CONSTRAINT IF EXISTS "bank_reconciliations_bank_account_id_fkey";
ALTER TABLE "bank_reconciliations" ADD CONSTRAINT "bank_reconciliations_bank_account_id_fkey" FOREIGN KEY ("bank_account_id") REFERENCES "bank_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "bank_reconciliations" DROP CONSTRAINT IF EXISTS "bank_reconciliations_import_id_fkey";
ALTER TABLE "bank_reconciliations" ADD CONSTRAINT "bank_reconciliations_import_id_fkey" FOREIGN KEY ("import_id") REFERENCES "bank_statement_imports"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "bank_reconciliations" DROP CONSTRAINT IF EXISTS "bank_reconciliations_created_by_fkey";
ALTER TABLE "bank_reconciliations" ADD CONSTRAINT "bank_reconciliations_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "bank_reconciliations" DROP CONSTRAINT IF EXISTS "bank_reconciliations_completed_by_fkey";
ALTER TABLE "bank_reconciliations" ADD CONSTRAINT "bank_reconciliations_completed_by_fkey" FOREIGN KEY ("completed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "bank_reconciliations" DROP CONSTRAINT IF EXISTS "bank_reconciliations_reopened_by_fkey";
ALTER TABLE "bank_reconciliations" ADD CONSTRAINT "bank_reconciliations_reopened_by_fkey" FOREIGN KEY ("reopened_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "bank_statement_transactions" DROP CONSTRAINT IF EXISTS "bank_statement_transactions_company_id_fkey";
ALTER TABLE "bank_statement_transactions" ADD CONSTRAINT "bank_statement_transactions_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "bank_statement_transactions" DROP CONSTRAINT IF EXISTS "bank_statement_transactions_bank_account_id_fkey";
ALTER TABLE "bank_statement_transactions" ADD CONSTRAINT "bank_statement_transactions_bank_account_id_fkey" FOREIGN KEY ("bank_account_id") REFERENCES "bank_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "bank_statement_transactions" DROP CONSTRAINT IF EXISTS "bank_statement_transactions_import_id_fkey";
ALTER TABLE "bank_statement_transactions" ADD CONSTRAINT "bank_statement_transactions_import_id_fkey" FOREIGN KEY ("import_id") REFERENCES "bank_statement_imports"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "bank_statement_transactions" DROP CONSTRAINT IF EXISTS "bank_statement_transactions_reconciliation_id_fkey";
ALTER TABLE "bank_statement_transactions" ADD CONSTRAINT "bank_statement_transactions_reconciliation_id_fkey" FOREIGN KEY ("reconciliation_id") REFERENCES "bank_reconciliations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "bank_statement_transactions" DROP CONSTRAINT IF EXISTS "bank_statement_transactions_matched_journal_line_id_fkey";
ALTER TABLE "bank_statement_transactions" ADD CONSTRAINT "bank_statement_transactions_matched_journal_line_id_fkey" FOREIGN KEY ("matched_journal_line_id") REFERENCES "journal_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "bank_reconciliation_matches" DROP CONSTRAINT IF EXISTS "bank_reconciliation_matches_company_id_fkey";
ALTER TABLE "bank_reconciliation_matches" ADD CONSTRAINT "bank_reconciliation_matches_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "bank_reconciliation_matches" DROP CONSTRAINT IF EXISTS "bank_reconciliation_matches_reconciliation_id_fkey";
ALTER TABLE "bank_reconciliation_matches" ADD CONSTRAINT "bank_reconciliation_matches_reconciliation_id_fkey" FOREIGN KEY ("reconciliation_id") REFERENCES "bank_reconciliations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "bank_reconciliation_matches" DROP CONSTRAINT IF EXISTS "bank_reconciliation_matches_statement_transaction_id_fkey";
ALTER TABLE "bank_reconciliation_matches" ADD CONSTRAINT "bank_reconciliation_matches_statement_transaction_id_fkey" FOREIGN KEY ("statement_transaction_id") REFERENCES "bank_statement_transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "bank_reconciliation_matches" DROP CONSTRAINT IF EXISTS "bank_reconciliation_matches_journal_line_id_fkey";
ALTER TABLE "bank_reconciliation_matches" ADD CONSTRAINT "bank_reconciliation_matches_journal_line_id_fkey" FOREIGN KEY ("journal_line_id") REFERENCES "journal_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "bank_reconciliation_matches" DROP CONSTRAINT IF EXISTS "bank_reconciliation_matches_matched_by_fkey";
ALTER TABLE "bank_reconciliation_matches" ADD CONSTRAINT "bank_reconciliation_matches_matched_by_fkey" FOREIGN KEY ("matched_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
