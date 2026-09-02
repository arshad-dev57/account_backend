-- Add location_id to expenses, incomes, and journal_entries for location-scoped P&L

ALTER TABLE "expenses" ADD COLUMN IF NOT EXISTS "location_id" TEXT;
ALTER TABLE "incomes" ADD COLUMN IF NOT EXISTS "location_id" TEXT;
ALTER TABLE "journal_entries" ADD COLUMN IF NOT EXISTS "location_id" TEXT;

CREATE INDEX IF NOT EXISTS "expenses_location_id_idx" ON "expenses"("location_id");
CREATE INDEX IF NOT EXISTS "incomes_location_id_idx" ON "incomes"("location_id");
CREATE INDEX IF NOT EXISTS "journal_entries_location_id_idx" ON "journal_entries"("location_id");

ALTER TABLE "expenses"
  ADD CONSTRAINT "expenses_location_id_fkey"
  FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "incomes"
  ADD CONSTRAINT "incomes_location_id_fkey"
  FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "journal_entries"
  ADD CONSTRAINT "journal_entries_location_id_fkey"
  FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill existing records with company default location
UPDATE "expenses" e
SET "location_id" = l.id
FROM "locations" l
WHERE e."location_id" IS NULL
  AND e."company_id" = l."company_id"
  AND l."is_default" = true
  AND l."is_deleted" = false;

UPDATE "incomes" i
SET "location_id" = l.id
FROM "locations" l
WHERE i."location_id" IS NULL
  AND i."company_id" = l."company_id"
  AND l."is_default" = true
  AND l."is_deleted" = false;

UPDATE "journal_entries" je
SET "location_id" = e."location_id"
FROM "expenses" e
WHERE je."location_id" IS NULL
  AND je."reference" = e."expense_number"
  AND e."location_id" IS NOT NULL;

UPDATE "journal_entries" je
SET "location_id" = i."location_id"
FROM "incomes" i
WHERE je."location_id" IS NULL
  AND je."reference" = i."income_number"
  AND i."location_id" IS NOT NULL;
