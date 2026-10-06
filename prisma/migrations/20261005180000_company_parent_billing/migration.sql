-- Child companies share parent trial/subscription (no separate billing)
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "parent_company_id" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'companies_parent_company_id_fkey'
  ) THEN
    ALTER TABLE "companies"
      ADD CONSTRAINT "companies_parent_company_id_fkey"
      FOREIGN KEY ("parent_company_id") REFERENCES "companies"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "companies_parent_company_id_idx" ON "companies"("parent_company_id");
