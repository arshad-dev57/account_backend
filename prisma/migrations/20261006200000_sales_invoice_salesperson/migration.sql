-- Sales invoice salesperson fields (schema had them; Neon table lagged)
ALTER TABLE "sales_invoices" ADD COLUMN IF NOT EXISTS "sales_person" TEXT;
ALTER TABLE "sales_invoices" ADD COLUMN IF NOT EXISTS "sales_person_id" TEXT;

CREATE INDEX IF NOT EXISTS "sales_invoices_sales_person_id_idx" ON "sales_invoices"("sales_person_id");

DO $$ BEGIN
  ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_sales_person_id_fkey"
    FOREIGN KEY ("sales_person_id") REFERENCES "salespersons"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
