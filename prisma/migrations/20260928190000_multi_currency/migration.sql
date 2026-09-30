-- Multi-currency: Currency master, exchange rates, company base currency,
-- and FX fields on purchase / AP documents. Safe backfill for existing data.

-- ── Currency master ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "currencies" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "decimal_places" INTEGER NOT NULL DEFAULT 2,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "currencies_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "currencies_code_key" ON "currencies"("code");
CREATE INDEX IF NOT EXISTS "currencies_code_idx" ON "currencies"("code");
CREATE INDEX IF NOT EXISTS "currencies_is_active_idx" ON "currencies"("is_active");

-- ── Exchange rates ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "exchange_rates" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "from_currency_id" TEXT NOT NULL,
    "to_currency_id" TEXT NOT NULL,
    "rate" DECIMAL(18,8) NOT NULL,
    "effective_date" DATE NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "exchange_rates_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "exchange_rates_company_id_from_currency_id_to_currency_id_effective_date_key"
  ON "exchange_rates"("company_id", "from_currency_id", "to_currency_id", "effective_date");
CREATE INDEX IF NOT EXISTS "exchange_rates_company_id_idx" ON "exchange_rates"("company_id");
CREATE INDEX IF NOT EXISTS "exchange_rates_from_currency_id_to_currency_id_idx" ON "exchange_rates"("from_currency_id", "to_currency_id");
CREATE INDEX IF NOT EXISTS "exchange_rates_effective_date_idx" ON "exchange_rates"("effective_date");
CREATE INDEX IF NOT EXISTS "exchange_rates_is_active_idx" ON "exchange_rates"("is_active");

-- Seed ISO currencies (fixed UUIDs for idempotency)
INSERT INTO "currencies" ("id", "code", "name", "symbol", "decimal_places", "is_active", "created_at", "updated_at")
VALUES
  ('00000000-0000-4000-8000-000000000001', 'PKR', 'Pakistani Rupee', '₨', 2, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('00000000-0000-4000-8000-000000000002', 'USD', 'US Dollar', '$', 2, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('00000000-0000-4000-8000-000000000003', 'EUR', 'Euro', '€', 2, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('00000000-0000-4000-8000-000000000004', 'GBP', 'British Pound', '£', 2, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('00000000-0000-4000-8000-000000000005', 'AED', 'UAE Dirham', 'د.إ', 2, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('00000000-0000-4000-8000-000000000006', 'SAR', 'Saudi Riyal', '﷼', 2, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

-- ── Company base currency ────────────────────────────────────
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "base_currency_id" TEXT;

UPDATE "companies" c
SET "base_currency_id" = (SELECT "id" FROM "currencies" WHERE "code" = 'PKR' LIMIT 1)
WHERE c."base_currency_id" IS NULL;

DO $$ BEGIN
  ALTER TABLE "companies" ADD CONSTRAINT "companies_base_currency_id_fkey"
    FOREIGN KEY ("base_currency_id") REFERENCES "currencies"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "companies_base_currency_id_idx" ON "companies"("base_currency_id");

-- ── Exchange rate FKs ────────────────────────────────────────
DO $$ BEGIN
  ALTER TABLE "exchange_rates" ADD CONSTRAINT "exchange_rates_company_id_fkey"
    FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "exchange_rates" ADD CONSTRAINT "exchange_rates_from_currency_id_fkey"
    FOREIGN KEY ("from_currency_id") REFERENCES "currencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "exchange_rates" ADD CONSTRAINT "exchange_rates_to_currency_id_fkey"
    FOREIGN KEY ("to_currency_id") REFERENCES "currencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "exchange_rates" ADD CONSTRAINT "exchange_rates_created_by_fkey"
    FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Supplier default currency ────────────────────────────────
ALTER TABLE "suppliers" ADD COLUMN IF NOT EXISTS "currency_id" TEXT;

UPDATE "suppliers" s
SET "currency_id" = c."base_currency_id"
FROM "companies" c
WHERE s."company_id" = c."id" AND s."currency_id" IS NULL AND c."base_currency_id" IS NOT NULL;

DO $$ BEGIN
  ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_currency_id_fkey"
    FOREIGN KEY ("currency_id") REFERENCES "currencies"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "suppliers_currency_id_idx" ON "suppliers"("currency_id");

-- Helper macro-style: add FX columns to a table
-- Purchase Orders
ALTER TABLE "purchase_orders" ADD COLUMN IF NOT EXISTS "currency_id" TEXT;
ALTER TABLE "purchase_orders" ADD COLUMN IF NOT EXISTS "base_currency_id" TEXT;
ALTER TABLE "purchase_orders" ADD COLUMN IF NOT EXISTS "exchange_rate" DECIMAL(18,8) NOT NULL DEFAULT 1;
ALTER TABLE "purchase_orders" ADD COLUMN IF NOT EXISTS "exchange_rate_date" TIMESTAMP(3);
ALTER TABLE "purchase_orders" ADD COLUMN IF NOT EXISTS "foreign_amount" DECIMAL(18,4);
ALTER TABLE "purchase_orders" ADD COLUMN IF NOT EXISTS "base_amount" DECIMAL(18,4);

-- Goods Receivings
ALTER TABLE "goods_receivings" ADD COLUMN IF NOT EXISTS "currency_id" TEXT;
ALTER TABLE "goods_receivings" ADD COLUMN IF NOT EXISTS "base_currency_id" TEXT;
ALTER TABLE "goods_receivings" ADD COLUMN IF NOT EXISTS "exchange_rate" DECIMAL(18,8) NOT NULL DEFAULT 1;
ALTER TABLE "goods_receivings" ADD COLUMN IF NOT EXISTS "exchange_rate_date" TIMESTAMP(3);
ALTER TABLE "goods_receivings" ADD COLUMN IF NOT EXISTS "foreign_amount" DECIMAL(18,4);
ALTER TABLE "goods_receivings" ADD COLUMN IF NOT EXISTS "base_amount" DECIMAL(18,4);

-- Purchase Invoices
ALTER TABLE "purchase_invoices" ADD COLUMN IF NOT EXISTS "currency_id" TEXT;
ALTER TABLE "purchase_invoices" ADD COLUMN IF NOT EXISTS "base_currency_id" TEXT;
ALTER TABLE "purchase_invoices" ADD COLUMN IF NOT EXISTS "exchange_rate" DECIMAL(18,8) NOT NULL DEFAULT 1;
ALTER TABLE "purchase_invoices" ADD COLUMN IF NOT EXISTS "exchange_rate_date" TIMESTAMP(3);
ALTER TABLE "purchase_invoices" ADD COLUMN IF NOT EXISTS "foreign_amount" DECIMAL(18,4);
ALTER TABLE "purchase_invoices" ADD COLUMN IF NOT EXISTS "base_amount" DECIMAL(18,4);

-- Purchase Payment Make
ALTER TABLE "purchase_payments_make" ADD COLUMN IF NOT EXISTS "currency_id" TEXT;
ALTER TABLE "purchase_payments_make" ADD COLUMN IF NOT EXISTS "base_currency_id" TEXT;
ALTER TABLE "purchase_payments_make" ADD COLUMN IF NOT EXISTS "exchange_rate" DECIMAL(18,8) NOT NULL DEFAULT 1;
ALTER TABLE "purchase_payments_make" ADD COLUMN IF NOT EXISTS "exchange_rate_date" TIMESTAMP(3);
ALTER TABLE "purchase_payments_make" ADD COLUMN IF NOT EXISTS "foreign_amount" DECIMAL(18,4);
ALTER TABLE "purchase_payments_make" ADD COLUMN IF NOT EXISTS "base_amount" DECIMAL(18,4);

-- Purchase Returns
ALTER TABLE "purchase_returns" ADD COLUMN IF NOT EXISTS "currency_id" TEXT;
ALTER TABLE "purchase_returns" ADD COLUMN IF NOT EXISTS "base_currency_id" TEXT;
ALTER TABLE "purchase_returns" ADD COLUMN IF NOT EXISTS "exchange_rate" DECIMAL(18,8) NOT NULL DEFAULT 1;
ALTER TABLE "purchase_returns" ADD COLUMN IF NOT EXISTS "exchange_rate_date" TIMESTAMP(3);
ALTER TABLE "purchase_returns" ADD COLUMN IF NOT EXISTS "foreign_amount" DECIMAL(18,4);
ALTER TABLE "purchase_returns" ADD COLUMN IF NOT EXISTS "base_amount" DECIMAL(18,4);

-- Accounts Payable
ALTER TABLE "accounts_payable" ADD COLUMN IF NOT EXISTS "currency_id" TEXT;
ALTER TABLE "accounts_payable" ADD COLUMN IF NOT EXISTS "base_currency_id" TEXT;
ALTER TABLE "accounts_payable" ADD COLUMN IF NOT EXISTS "exchange_rate" DECIMAL(18,8) NOT NULL DEFAULT 1;
ALTER TABLE "accounts_payable" ADD COLUMN IF NOT EXISTS "exchange_rate_date" TIMESTAMP(3);
ALTER TABLE "accounts_payable" ADD COLUMN IF NOT EXISTS "foreign_amount" DECIMAL(18,4);
ALTER TABLE "accounts_payable" ADD COLUMN IF NOT EXISTS "base_amount" DECIMAL(18,4);
ALTER TABLE "accounts_payable" ADD COLUMN IF NOT EXISTS "foreign_paid_amount" DECIMAL(18,4) NOT NULL DEFAULT 0;
ALTER TABLE "accounts_payable" ADD COLUMN IF NOT EXISTS "foreign_outstanding" DECIMAL(18,4);

-- Backfill existing docs as company-base / rate 1
UPDATE "purchase_orders" po
SET
  "currency_id" = COALESCE(po."currency_id", c."base_currency_id"),
  "base_currency_id" = COALESCE(po."base_currency_id", c."base_currency_id"),
  "exchange_rate" = COALESCE(NULLIF(po."exchange_rate", 0), 1),
  "foreign_amount" = COALESCE(po."foreign_amount", po."grand_total"),
  "base_amount" = COALESCE(po."base_amount", po."grand_total"),
  "exchange_rate_date" = COALESCE(po."exchange_rate_date", po."order_date", po."created_at")
FROM "companies" c
WHERE po."company_id" = c."id" AND po."foreign_amount" IS NULL;

UPDATE "goods_receivings" g
SET
  "currency_id" = COALESCE(g."currency_id", c."base_currency_id"),
  "base_currency_id" = COALESCE(g."base_currency_id", c."base_currency_id"),
  "exchange_rate" = COALESCE(NULLIF(g."exchange_rate", 0), 1),
  "exchange_rate_date" = COALESCE(g."exchange_rate_date", g."receiving_date", g."created_at")
FROM "companies" c
WHERE g."company_id" = c."id" AND g."currency_id" IS NULL;

UPDATE "purchase_invoices" pi
SET
  "currency_id" = COALESCE(pi."currency_id", c."base_currency_id"),
  "base_currency_id" = COALESCE(pi."base_currency_id", c."base_currency_id"),
  "exchange_rate" = COALESCE(NULLIF(pi."exchange_rate", 0), 1),
  "foreign_amount" = COALESCE(pi."foreign_amount", pi."grand_total"),
  "base_amount" = COALESCE(pi."base_amount", pi."grand_total"),
  "exchange_rate_date" = COALESCE(pi."exchange_rate_date", pi."invoice_date", pi."created_at")
FROM "companies" c
WHERE pi."company_id" = c."id" AND pi."foreign_amount" IS NULL;

UPDATE "purchase_payments_make" ppm
SET
  "currency_id" = COALESCE(ppm."currency_id", c."base_currency_id"),
  "base_currency_id" = COALESCE(ppm."base_currency_id", c."base_currency_id"),
  "exchange_rate" = COALESCE(NULLIF(ppm."exchange_rate", 0), 1),
  "foreign_amount" = COALESCE(ppm."foreign_amount", ppm."amount"),
  "base_amount" = COALESCE(ppm."base_amount", ppm."amount"),
  "exchange_rate_date" = COALESCE(ppm."exchange_rate_date", ppm."payment_date", ppm."created_at")
FROM "companies" c
WHERE ppm."company_id" = c."id" AND ppm."foreign_amount" IS NULL;

UPDATE "purchase_returns" pr
SET
  "currency_id" = COALESCE(pr."currency_id", c."base_currency_id"),
  "base_currency_id" = COALESCE(pr."base_currency_id", c."base_currency_id"),
  "exchange_rate" = COALESCE(NULLIF(pr."exchange_rate", 0), 1),
  "foreign_amount" = COALESCE(pr."foreign_amount", pr."grand_total"),
  "base_amount" = COALESCE(pr."base_amount", pr."grand_total"),
  "exchange_rate_date" = COALESCE(pr."exchange_rate_date", pr."return_date", pr."created_at")
FROM "companies" c
WHERE pr."company_id" = c."id" AND pr."foreign_amount" IS NULL;

UPDATE "accounts_payable" ap
SET
  "currency_id" = COALESCE(ap."currency_id", c."base_currency_id"),
  "base_currency_id" = COALESCE(ap."base_currency_id", c."base_currency_id"),
  "exchange_rate" = COALESCE(NULLIF(ap."exchange_rate", 0), 1),
  "foreign_amount" = COALESCE(ap."foreign_amount", ap."amount"),
  "base_amount" = COALESCE(ap."base_amount", ap."amount"),
  "foreign_paid_amount" = COALESCE(ap."foreign_paid_amount", ap."paid_amount", 0),
  "foreign_outstanding" = COALESCE(ap."foreign_outstanding", ap."outstanding", ap."amount"),
  "exchange_rate_date" = COALESCE(ap."exchange_rate_date", ap."due_date", ap."created_at")
FROM "companies" c
WHERE ap."company_id" = c."id" AND ap."foreign_amount" IS NULL;

-- FKs for document currency columns (idempotent)
DO $$ BEGIN
  ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_currency_id_fkey"
    FOREIGN KEY ("currency_id") REFERENCES "currencies"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_base_currency_id_fkey"
    FOREIGN KEY ("base_currency_id") REFERENCES "currencies"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "goods_receivings" ADD CONSTRAINT "goods_receivings_currency_id_fkey"
    FOREIGN KEY ("currency_id") REFERENCES "currencies"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "goods_receivings" ADD CONSTRAINT "goods_receivings_base_currency_id_fkey"
    FOREIGN KEY ("base_currency_id") REFERENCES "currencies"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "purchase_invoices" ADD CONSTRAINT "purchase_invoices_currency_id_fkey"
    FOREIGN KEY ("currency_id") REFERENCES "currencies"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "purchase_invoices" ADD CONSTRAINT "purchase_invoices_base_currency_id_fkey"
    FOREIGN KEY ("base_currency_id") REFERENCES "currencies"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "purchase_payments_make" ADD CONSTRAINT "purchase_payments_make_currency_id_fkey"
    FOREIGN KEY ("currency_id") REFERENCES "currencies"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "purchase_payments_make" ADD CONSTRAINT "purchase_payments_make_base_currency_id_fkey"
    FOREIGN KEY ("base_currency_id") REFERENCES "currencies"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "purchase_returns" ADD CONSTRAINT "purchase_returns_currency_id_fkey"
    FOREIGN KEY ("currency_id") REFERENCES "currencies"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "purchase_returns" ADD CONSTRAINT "purchase_returns_base_currency_id_fkey"
    FOREIGN KEY ("base_currency_id") REFERENCES "currencies"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "accounts_payable" ADD CONSTRAINT "accounts_payable_currency_id_fkey"
    FOREIGN KEY ("currency_id") REFERENCES "currencies"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "accounts_payable" ADD CONSTRAINT "accounts_payable_base_currency_id_fkey"
    FOREIGN KEY ("base_currency_id") REFERENCES "currencies"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "purchase_orders_currency_id_idx" ON "purchase_orders"("currency_id");
CREATE INDEX IF NOT EXISTS "purchase_orders_base_currency_id_idx" ON "purchase_orders"("base_currency_id");
CREATE INDEX IF NOT EXISTS "goods_receivings_currency_id_idx" ON "goods_receivings"("currency_id");
CREATE INDEX IF NOT EXISTS "goods_receivings_base_currency_id_idx" ON "goods_receivings"("base_currency_id");
CREATE INDEX IF NOT EXISTS "purchase_invoices_currency_id_idx" ON "purchase_invoices"("currency_id");
CREATE INDEX IF NOT EXISTS "purchase_invoices_base_currency_id_idx" ON "purchase_invoices"("base_currency_id");
CREATE INDEX IF NOT EXISTS "purchase_payments_make_currency_id_idx" ON "purchase_payments_make"("currency_id");
CREATE INDEX IF NOT EXISTS "purchase_payments_make_base_currency_id_idx" ON "purchase_payments_make"("base_currency_id");
CREATE INDEX IF NOT EXISTS "purchase_returns_currency_id_idx" ON "purchase_returns"("currency_id");
CREATE INDEX IF NOT EXISTS "purchase_returns_base_currency_id_idx" ON "purchase_returns"("base_currency_id");
CREATE INDEX IF NOT EXISTS "accounts_payable_currency_id_idx" ON "accounts_payable"("currency_id");
CREATE INDEX IF NOT EXISTS "accounts_payable_base_currency_id_idx" ON "accounts_payable"("base_currency_id");

-- Ensure FX COA accounts exist for every company (gain 4201 / loss 7100)
-- created_by must reference a real user (FK) — use any existing user, else skip insert
INSERT INTO "chart_of_accounts" (
  "id", "code", "name", "type", "parent_account", "opening_balance", "current_balance",
  "description", "tax_code", "balance_type", "is_active", "created_by", "company_id",
  "created_at", "updated_at"
)
SELECT
  gen_random_uuid()::text,
  '4201',
  'Foreign Exchange Gain',
  'Revenue',
  'Revenue',
  0, 0,
  'Realized foreign exchange gains on settlement',
  'N/A',
  'Credit',
  true,
  u."id",
  c."id",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "companies" c
CROSS JOIN LATERAL (
  SELECT "id" FROM "users" WHERE "company_id" = c."id" LIMIT 1
) u
WHERE NOT EXISTS (
  SELECT 1 FROM "chart_of_accounts" coa
  WHERE coa."company_id" = c."id" AND coa."code" = '4201'
);

INSERT INTO "chart_of_accounts" (
  "id", "code", "name", "type", "parent_account", "opening_balance", "current_balance",
  "description", "tax_code", "balance_type", "is_active", "created_by", "company_id",
  "created_at", "updated_at"
)
SELECT
  gen_random_uuid()::text,
  '7100',
  'Foreign Exchange Loss',
  'Expense',
  'Operating Expenses',
  0, 0,
  'Realized foreign exchange losses on settlement',
  'N/A',
  'Debit',
  true,
  u."id",
  c."id",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "companies" c
CROSS JOIN LATERAL (
  SELECT "id" FROM "users" WHERE "company_id" = c."id" LIMIT 1
) u
WHERE NOT EXISTS (
  SELECT 1 FROM "chart_of_accounts" coa
  WHERE coa."company_id" = c."id" AND coa."code" = '7100'
);

-- Companies with no users: fall back to any user in the system
INSERT INTO "chart_of_accounts" (
  "id", "code", "name", "type", "parent_account", "opening_balance", "current_balance",
  "description", "tax_code", "balance_type", "is_active", "created_by", "company_id",
  "created_at", "updated_at"
)
SELECT
  gen_random_uuid()::text,
  '4201',
  'Foreign Exchange Gain',
  'Revenue',
  'Revenue',
  0, 0,
  'Realized foreign exchange gains on settlement',
  'N/A',
  'Credit',
  true,
  (SELECT "id" FROM "users" LIMIT 1),
  c."id",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "companies" c
WHERE EXISTS (SELECT 1 FROM "users" LIMIT 1)
  AND NOT EXISTS (
    SELECT 1 FROM "users" u WHERE u."company_id" = c."id"
  )
  AND NOT EXISTS (
    SELECT 1 FROM "chart_of_accounts" coa
    WHERE coa."company_id" = c."id" AND coa."code" = '4201'
  );

INSERT INTO "chart_of_accounts" (
  "id", "code", "name", "type", "parent_account", "opening_balance", "current_balance",
  "description", "tax_code", "balance_type", "is_active", "created_by", "company_id",
  "created_at", "updated_at"
)
SELECT
  gen_random_uuid()::text,
  '7100',
  'Foreign Exchange Loss',
  'Expense',
  'Operating Expenses',
  0, 0,
  'Realized foreign exchange losses on settlement',
  'N/A',
  'Debit',
  true,
  (SELECT "id" FROM "users" LIMIT 1),
  c."id",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "companies" c
WHERE EXISTS (SELECT 1 FROM "users" LIMIT 1)
  AND NOT EXISTS (
    SELECT 1 FROM "users" u WHERE u."company_id" = c."id"
  )
  AND NOT EXISTS (
    SELECT 1 FROM "chart_of_accounts" coa
    WHERE coa."company_id" = c."id" AND coa."code" = '7100'
  );
