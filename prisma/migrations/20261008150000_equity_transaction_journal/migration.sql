-- Link equity transactions to journal entries for GL audit trail
ALTER TABLE "equity_transactions" ADD COLUMN IF NOT EXISTS "journal_entry_id" TEXT;
ALTER TABLE "equity_transactions" ADD COLUMN IF NOT EXISTS "updated_by" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "equity_transactions_journal_entry_id_key"
  ON "equity_transactions"("journal_entry_id");

CREATE INDEX IF NOT EXISTS "equity_transactions_journal_entry_id_idx"
  ON "equity_transactions"("journal_entry_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'equity_transactions_journal_entry_id_fkey'
  ) THEN
    ALTER TABLE "equity_transactions"
      ADD CONSTRAINT "equity_transactions_journal_entry_id_fkey"
      FOREIGN KEY ("journal_entry_id") REFERENCES "journal_entries"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
