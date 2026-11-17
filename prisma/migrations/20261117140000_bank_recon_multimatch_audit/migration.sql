-- Multi-match allocations + audit trail for bank reconciliation
ALTER TABLE "bank_reconciliation_matches"
  ADD COLUMN IF NOT EXISTS "allocated_amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "match_group_id" TEXT;

CREATE INDEX IF NOT EXISTS "bank_reconciliation_matches_match_group_id_idx"
  ON "bank_reconciliation_matches"("match_group_id");

-- Backfill allocated_amount from linked statement magnitude for existing active matches
UPDATE "bank_reconciliation_matches" m
SET "allocated_amount" = GREATEST(
  ABS(COALESCE(s.amount, 0)),
  COALESCE(s.debit, 0),
  COALESCE(s.credit, 0)
)
FROM "bank_statement_transactions" s
WHERE m."statement_transaction_id" = s.id
  AND (m."allocated_amount" IS NULL OR m."allocated_amount" = 0);

CREATE TABLE IF NOT EXISTS "bank_reconciliation_audits" (
  "id" TEXT NOT NULL,
  "company_id" TEXT NOT NULL,
  "reconciliation_id" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "details" JSONB,
  "actor_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "bank_reconciliation_audits_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "bank_reconciliation_audits_company_id_idx"
  ON "bank_reconciliation_audits"("company_id");
CREATE INDEX IF NOT EXISTS "bank_reconciliation_audits_reconciliation_id_idx"
  ON "bank_reconciliation_audits"("reconciliation_id");
CREATE INDEX IF NOT EXISTS "bank_reconciliation_audits_action_idx"
  ON "bank_reconciliation_audits"("action");
CREATE INDEX IF NOT EXISTS "bank_reconciliation_audits_created_at_idx"
  ON "bank_reconciliation_audits"("created_at");

ALTER TABLE "bank_reconciliation_audits"
  DROP CONSTRAINT IF EXISTS "bank_reconciliation_audits_company_id_fkey";
ALTER TABLE "bank_reconciliation_audits"
  ADD CONSTRAINT "bank_reconciliation_audits_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "bank_reconciliation_audits"
  DROP CONSTRAINT IF EXISTS "bank_reconciliation_audits_reconciliation_id_fkey";
ALTER TABLE "bank_reconciliation_audits"
  ADD CONSTRAINT "bank_reconciliation_audits_reconciliation_id_fkey"
  FOREIGN KEY ("reconciliation_id") REFERENCES "bank_reconciliations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "bank_reconciliation_audits"
  DROP CONSTRAINT IF EXISTS "bank_reconciliation_audits_actor_id_fkey";
ALTER TABLE "bank_reconciliation_audits"
  ADD CONSTRAINT "bank_reconciliation_audits_actor_id_fkey"
  FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
