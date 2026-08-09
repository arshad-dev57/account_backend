-- Credit numbers are tenant-scoped: same CN-2026-0001 allowed in different companies.
-- Drop global unique on credit_number; enforce uniqueness per company.

ALTER TABLE "credit_notes" DROP CONSTRAINT IF EXISTS "credit_notes_credit_number_key";

DROP INDEX IF EXISTS "credit_notes_credit_number_key";

CREATE UNIQUE INDEX IF NOT EXISTS "credit_notes_company_id_credit_number_key"
  ON "credit_notes"("company_id", "credit_number");
