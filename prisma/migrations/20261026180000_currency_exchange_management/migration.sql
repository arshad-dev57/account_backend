-- Currency & exchange-rate management
-- Adds rate provenance/timestamps and an append-only audit trail.
-- Purely additive: no existing rows are rewritten or deleted.

ALTER TABLE "exchange_rates"
  ADD COLUMN "source" TEXT NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN "fetched_at" TIMESTAMP(3);

CREATE INDEX "exchange_rates_company_id_to_currency_id_effective_date_idx"
  ON "exchange_rates"("company_id", "to_currency_id", "effective_date");

-- CreateTable
CREATE TABLE "exchange_rate_history" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "exchange_rate_id" TEXT,
    "from_currency_id" TEXT NOT NULL,
    "to_currency_id" TEXT NOT NULL,
    "old_rate" DECIMAL(18,8),
    "new_rate" DECIMAL(18,8),
    "effective_date" DATE NOT NULL,
    "action" TEXT NOT NULL DEFAULT 'UPDATE',
    "source" TEXT,
    "reason" TEXT,
    "changed_by" TEXT,
    "changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "exchange_rate_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "exchange_rate_history_company_id_from_currency_id_to__idx"
  ON "exchange_rate_history"("company_id", "from_currency_id", "to_currency_id", "changed_at");

-- CreateIndex
CREATE INDEX "exchange_rate_history_exchange_rate_id_idx"
  ON "exchange_rate_history"("exchange_rate_id");

-- AddForeignKey
ALTER TABLE "exchange_rate_history"
  ADD CONSTRAINT "exchange_rate_history_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exchange_rate_history"
  ADD CONSTRAINT "exchange_rate_history_from_currency_id_fkey"
  FOREIGN KEY ("from_currency_id") REFERENCES "currencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exchange_rate_history"
  ADD CONSTRAINT "exchange_rate_history_to_currency_id_fkey"
  FOREIGN KEY ("to_currency_id") REFERENCES "currencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exchange_rate_history"
  ADD CONSTRAINT "exchange_rate_history_changed_by_fkey"
  FOREIGN KEY ("changed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
