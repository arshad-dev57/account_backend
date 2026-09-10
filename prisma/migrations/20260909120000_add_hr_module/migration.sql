-- HR module: offices, employees (linked users), attendance, last-known location

CREATE TABLE IF NOT EXISTS "hr_offices" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT NOT NULL DEFAULT '',
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "radius_meters" INTEGER NOT NULL DEFAULT 150,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "hr_offices_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "hr_employees" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "employee_code" TEXT NOT NULL,
    "department" TEXT NOT NULL DEFAULT '',
    "designation" TEXT NOT NULL DEFAULT '',
    "office_id" TEXT,
    "employment_type" TEXT NOT NULL DEFAULT 'Full Time',
    "employee_type" TEXT NOT NULL DEFAULT 'Office Employee',
    "shift_label" TEXT NOT NULL DEFAULT '',
    "salary" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "joining_date" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'active',
    "phone" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "hr_employees_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "hr_attendances" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "work_date" DATE NOT NULL,
    "check_in" TIMESTAMP(3),
    "check_out" TIMESTAMP(3),
    "check_in_lat" DOUBLE PRECISION,
    "check_in_lng" DOUBLE PRECISION,
    "check_out_lat" DOUBLE PRECISION,
    "check_out_lng" DOUBLE PRECISION,
    "status" TEXT NOT NULL DEFAULT 'present',
    "source" TEXT NOT NULL DEFAULT 'geofence',
    "working_minutes" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "hr_attendances_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "hr_employee_locations" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "office_id" TEXT,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "accuracy" DOUBLE PRECISION,
    "inside_geofence" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'offline',
    "last_seen_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "hr_employee_locations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "hr_employees_user_id_key" ON "hr_employees"("user_id");
CREATE UNIQUE INDEX IF NOT EXISTS "hr_employees_company_id_employee_code_key" ON "hr_employees"("company_id", "employee_code");
CREATE INDEX IF NOT EXISTS "hr_offices_company_id_idx" ON "hr_offices"("company_id");
CREATE INDEX IF NOT EXISTS "hr_employees_company_id_idx" ON "hr_employees"("company_id");
CREATE INDEX IF NOT EXISTS "hr_employees_office_id_idx" ON "hr_employees"("office_id");
CREATE INDEX IF NOT EXISTS "hr_employees_status_idx" ON "hr_employees"("status");
CREATE UNIQUE INDEX IF NOT EXISTS "hr_attendances_employee_id_work_date_key" ON "hr_attendances"("employee_id", "work_date");
CREATE INDEX IF NOT EXISTS "hr_attendances_company_id_work_date_idx" ON "hr_attendances"("company_id", "work_date");
CREATE UNIQUE INDEX IF NOT EXISTS "hr_employee_locations_employee_id_key" ON "hr_employee_locations"("employee_id");
CREATE INDEX IF NOT EXISTS "hr_employee_locations_company_id_idx" ON "hr_employee_locations"("company_id");

ALTER TABLE "hr_offices" ADD CONSTRAINT "hr_offices_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "hr_employees" ADD CONSTRAINT "hr_employees_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "hr_employees" ADD CONSTRAINT "hr_employees_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "hr_employees" ADD CONSTRAINT "hr_employees_office_id_fkey" FOREIGN KEY ("office_id") REFERENCES "hr_offices"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "hr_attendances" ADD CONSTRAINT "hr_attendances_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "hr_attendances" ADD CONSTRAINT "hr_attendances_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "hr_employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "hr_employee_locations" ADD CONSTRAINT "hr_employee_locations_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "hr_employee_locations" ADD CONSTRAINT "hr_employee_locations_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "hr_employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "hr_employee_locations" ADD CONSTRAINT "hr_employee_locations_office_id_fkey" FOREIGN KEY ("office_id") REFERENCES "hr_offices"("id") ON DELETE SET NULL ON UPDATE CASCADE;
