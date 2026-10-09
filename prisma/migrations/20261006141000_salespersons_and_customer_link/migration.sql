-- Create salespersons table (if missing)
CREATE TABLE IF NOT EXISTS "salespersons" (
    "id" TEXT NOT NULL,
    "salesperson_number" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "employee_code" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Active',
    "territory" TEXT,
    "commission_rate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "monthly_target" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "notes" TEXT,
    "user_id" TEXT,
    "hr_employee_id" TEXT,
    "company_id" TEXT NOT NULL,
    "location_id" TEXT,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "salespersons_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "salespersons_user_id_key" ON "salespersons"("user_id");
CREATE UNIQUE INDEX IF NOT EXISTS "salespersons_hr_employee_id_key" ON "salespersons"("hr_employee_id");
CREATE UNIQUE INDEX IF NOT EXISTS "salespersons_company_id_salesperson_number_key" ON "salespersons"("company_id", "salesperson_number");
CREATE INDEX IF NOT EXISTS "salespersons_company_id_idx" ON "salespersons"("company_id");
CREATE INDEX IF NOT EXISTS "salespersons_user_id_idx" ON "salespersons"("user_id");
CREATE INDEX IF NOT EXISTS "salespersons_hr_employee_id_idx" ON "salespersons"("hr_employee_id");
CREATE INDEX IF NOT EXISTS "salespersons_location_id_idx" ON "salespersons"("location_id");
CREATE INDEX IF NOT EXISTS "salespersons_status_idx" ON "salespersons"("status");

DO $$ BEGIN
  ALTER TABLE "salespersons" ADD CONSTRAINT "salespersons_company_id_fkey"
    FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "salespersons" ADD CONSTRAINT "salespersons_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "salespersons" ADD CONSTRAINT "salespersons_hr_employee_id_fkey"
    FOREIGN KEY ("hr_employee_id") REFERENCES "hr_employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "salespersons" ADD CONSTRAINT "salespersons_location_id_fkey"
    FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Customer -> salesperson link
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "salesperson_id" TEXT;

CREATE INDEX IF NOT EXISTS "customers_salesperson_id_idx" ON "customers"("salesperson_id");

DO $$ BEGIN
  ALTER TABLE "customers" ADD CONSTRAINT "customers_salesperson_id_fkey"
    FOREIGN KEY ("salesperson_id") REFERENCES "salespersons"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
