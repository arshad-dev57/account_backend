-- Multi-currency fields for Accounts Receivable (schema had them; Neon lagged)
ALTER TABLE "accounts_receivable" ADD COLUMN IF NOT EXISTS "currency_id" TEXT;
ALTER TABLE "accounts_receivable" ADD COLUMN IF NOT EXISTS "base_currency_id" TEXT;
ALTER TABLE "accounts_receivable" ADD COLUMN IF NOT EXISTS "exchange_rate" DECIMAL(18,8) NOT NULL DEFAULT 1;
ALTER TABLE "accounts_receivable" ADD COLUMN IF NOT EXISTS "exchange_rate_date" TIMESTAMP(3);
ALTER TABLE "accounts_receivable" ADD COLUMN IF NOT EXISTS "foreign_amount" DECIMAL(18,4);
ALTER TABLE "accounts_receivable" ADD COLUMN IF NOT EXISTS "base_amount" DECIMAL(18,4);
ALTER TABLE "accounts_receivable" ADD COLUMN IF NOT EXISTS "foreign_paid_amount" DECIMAL(18,4) NOT NULL DEFAULT 0;
ALTER TABLE "accounts_receivable" ADD COLUMN IF NOT EXISTS "foreign_outstanding" DECIMAL(18,4);

CREATE INDEX IF NOT EXISTS "accounts_receivable_currency_id_idx" ON "accounts_receivable"("currency_id");
CREATE INDEX IF NOT EXISTS "accounts_receivable_base_currency_id_idx" ON "accounts_receivable"("base_currency_id");

DO $$ BEGIN
  ALTER TABLE "accounts_receivable" ADD CONSTRAINT "accounts_receivable_currency_id_fkey"
    FOREIGN KEY ("currency_id") REFERENCES "currencies"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "accounts_receivable" ADD CONSTRAINT "accounts_receivable_base_currency_id_fkey"
    FOREIGN KEY ("base_currency_id") REFERENCES "currencies"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
