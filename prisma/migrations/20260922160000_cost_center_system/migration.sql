-- Cost Center master + HR/Accounting integration

CREATE TABLE IF NOT EXISTS "cost_centers" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "office_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "cost_centers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "cost_centers_company_id_code_key" ON "cost_centers"("company_id", "code");
CREATE INDEX IF NOT EXISTS "cost_centers_company_id_status_idx" ON "cost_centers"("company_id", "status");

ALTER TABLE "cost_centers" ADD CONSTRAINT "cost_centers_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "cost_centers" ADD CONSTRAINT "cost_centers_office_id_fkey"
  FOREIGN KEY ("office_id") REFERENCES "hr_offices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "hr_departments" ADD COLUMN IF NOT EXISTS "cost_center_id" TEXT;
ALTER TABLE "hr_employees" ADD COLUMN IF NOT EXISTS "cost_center_id" TEXT;
ALTER TABLE "hr_payroll_items" ADD COLUMN IF NOT EXISTS "cost_center_id" TEXT;
ALTER TABLE "hr_payroll_items" ADD COLUMN IF NOT EXISTS "cost_center_code" TEXT NOT NULL DEFAULT '';
ALTER TABLE "hr_payroll_items" ADD COLUMN IF NOT EXISTS "cost_center_name" TEXT NOT NULL DEFAULT '';
ALTER TABLE "journal_lines" ADD COLUMN IF NOT EXISTS "cost_center_id" TEXT;

CREATE INDEX IF NOT EXISTS "hr_departments_cost_center_id_idx" ON "hr_departments"("cost_center_id");
CREATE INDEX IF NOT EXISTS "hr_employees_cost_center_id_idx" ON "hr_employees"("cost_center_id");
CREATE INDEX IF NOT EXISTS "hr_payroll_items_cost_center_id_idx" ON "hr_payroll_items"("cost_center_id");
CREATE INDEX IF NOT EXISTS "journal_lines_cost_center_id_idx" ON "journal_lines"("cost_center_id");

ALTER TABLE "hr_departments" ADD CONSTRAINT "hr_departments_cost_center_id_fkey"
  FOREIGN KEY ("cost_center_id") REFERENCES "cost_centers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "hr_employees" ADD CONSTRAINT "hr_employees_cost_center_id_fkey"
  FOREIGN KEY ("cost_center_id") REFERENCES "cost_centers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "hr_payroll_items" ADD CONSTRAINT "hr_payroll_items_cost_center_id_fkey"
  FOREIGN KEY ("cost_center_id") REFERENCES "cost_centers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_cost_center_id_fkey"
  FOREIGN KEY ("cost_center_id") REFERENCES "cost_centers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Migrate legacy text cost centers from departments
INSERT INTO "cost_centers" ("id", "company_id", "code", "name", "description", "status", "created_at", "updated_at")
SELECT
  gen_random_uuid()::text,
  d.company_id,
  UPPER(REGEXP_REPLACE(TRIM(d.cost_center), '[^a-zA-Z0-9]+', '-', 'g')),
  TRIM(d.cost_center),
  'Migrated from department catalog',
  'active',
  NOW(),
  NOW()
FROM "hr_departments" d
WHERE TRIM(COALESCE(d.cost_center, '')) <> ''
  AND NOT EXISTS (
    SELECT 1 FROM "cost_centers" c
    WHERE c.company_id = d.company_id
      AND LOWER(c.code) = LOWER(REGEXP_REPLACE(TRIM(d.cost_center), '[^a-zA-Z0-9]+', '-', 'g'))
  )
GROUP BY d.company_id, TRIM(d.cost_center);

UPDATE "hr_departments" d
SET "cost_center_id" = c.id
FROM "cost_centers" c
WHERE TRIM(COALESCE(d.cost_center, '')) <> ''
  AND c.company_id = d.company_id
  AND (
    LOWER(c.code) = LOWER(REGEXP_REPLACE(TRIM(d.cost_center), '[^a-zA-Z0-9]+', '-', 'g'))
    OR LOWER(c.name) = LOWER(TRIM(d.cost_center))
  );

-- Migrate legacy text cost centers from employees
INSERT INTO "cost_centers" ("id", "company_id", "code", "name", "description", "status", "created_at", "updated_at")
SELECT
  gen_random_uuid()::text,
  e.company_id,
  UPPER(REGEXP_REPLACE(TRIM(e.cost_center), '[^a-zA-Z0-9]+', '-', 'g')),
  TRIM(e.cost_center),
  'Migrated from employee profile',
  'active',
  NOW(),
  NOW()
FROM "hr_employees" e
WHERE TRIM(COALESCE(e.cost_center, '')) <> ''
  AND NOT EXISTS (
    SELECT 1 FROM "cost_centers" c
    WHERE c.company_id = e.company_id
      AND LOWER(c.code) = LOWER(REGEXP_REPLACE(TRIM(e.cost_center), '[^a-zA-Z0-9]+', '-', 'g'))
  )
GROUP BY e.company_id, TRIM(e.cost_center);

UPDATE "hr_employees" e
SET "cost_center_id" = c.id
FROM "cost_centers" c
WHERE TRIM(COALESCE(e.cost_center, '')) <> ''
  AND e.cost_center_id IS NULL
  AND c.company_id = e.company_id
  AND (
    LOWER(c.code) = LOWER(REGEXP_REPLACE(TRIM(e.cost_center), '[^a-zA-Z0-9]+', '-', 'g'))
    OR LOWER(c.name) = LOWER(TRIM(e.cost_center))
  );

-- Inherit department cost center for employees without explicit assignment
UPDATE "hr_employees" e
SET "cost_center_id" = d.cost_center_id
FROM "hr_departments" d
WHERE e.cost_center_id IS NULL
  AND d.cost_center_id IS NOT NULL
  AND e.company_id = d.company_id
  AND LOWER(TRIM(e.department)) = LOWER(TRIM(d.name));
