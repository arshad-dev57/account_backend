-- Quotation revisions / supersede + segregation-of-duties default ON

ALTER TABLE "import_supplier_quotations"
  ADD COLUMN IF NOT EXISTS "revision" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "supersedes_id" TEXT,
  ADD COLUMN IF NOT EXISTS "superseded_by_id" TEXT;

CREATE INDEX IF NOT EXISTS "import_supplier_quotations_supersedes_id_idx"
  ON "import_supplier_quotations"("supersedes_id");

DO $$ BEGIN
  ALTER TABLE "import_supplier_quotations"
    ADD CONSTRAINT "import_supplier_quotations_supersedes_id_fkey"
    FOREIGN KEY ("supersedes_id") REFERENCES "import_supplier_quotations"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Segregation of duties: award and approval must be different users (default ON)
ALTER TABLE "import_settings"
  ALTER COLUMN "require_separate_rfq_approver" SET DEFAULT true;

UPDATE "import_settings"
SET "require_separate_rfq_approver" = true
WHERE "require_separate_rfq_approver" IS DISTINCT FROM true;
