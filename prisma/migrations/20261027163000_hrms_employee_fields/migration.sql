-- ERPNext Employee document: the 109-field Setup master reproduced field-for-field.
-- Additive only — no column is dropped or recreated, so existing employee rows
-- keep their values and every legacy reader keeps working.

-- AlterTable: Department carries ERPNext's tree flags
ALTER TABLE "hr_departments" ADD COLUMN IF NOT EXISTS "is_group" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "hr_departments" ADD COLUMN IF NOT EXISTS "disabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable: the Link targets ERPNext Employee uses (module Contacts/Setup masters)
CREATE TABLE IF NOT EXISTS "hr_holiday_lists" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "holiday_list_name" TEXT NOT NULL,
    "from_date" DATE NOT NULL,
    "to_date" DATE NOT NULL,
    "total_holidays" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "weekly_off" TEXT NOT NULL DEFAULT '',
    "is_half_day" BOOLEAN NOT NULL DEFAULT false,
    "country" TEXT NOT NULL DEFAULT '',
    "subdivision" TEXT NOT NULL DEFAULT '',
    "color" TEXT NOT NULL DEFAULT '',
    "holidays" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hr_holiday_lists_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "hr_genders" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "gender" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hr_genders_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "hr_salutations" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "salutation" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hr_salutations_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "hr_holiday_lists_company_id_idx" ON "hr_holiday_lists"("company_id");
CREATE UNIQUE INDEX IF NOT EXISTS "hr_holiday_lists_company_id_holiday_list_name_key" ON "hr_holiday_lists"("company_id", "holiday_list_name");
CREATE INDEX IF NOT EXISTS "hr_genders_company_id_idx" ON "hr_genders"("company_id");
CREATE UNIQUE INDEX IF NOT EXISTS "hr_genders_company_id_gender_key" ON "hr_genders"("company_id", "gender");
CREATE INDEX IF NOT EXISTS "hr_salutations_company_id_idx" ON "hr_salutations"("company_id");
CREATE UNIQUE INDEX IF NOT EXISTS "hr_salutations_company_id_salutation_key" ON "hr_salutations"("company_id", "salutation");

-- AlterTable: the Employee fields themselves
ALTER TABLE "hr_employees" ADD COLUMN IF NOT EXISTS "naming_series" TEXT NOT NULL DEFAULT 'HR-EMP-';
ALTER TABLE "hr_employees" ADD COLUMN IF NOT EXISTS "first_name" TEXT NOT NULL DEFAULT '';
ALTER TABLE "hr_employees" ADD COLUMN IF NOT EXISTS "middle_name" TEXT NOT NULL DEFAULT '';
ALTER TABLE "hr_employees" ADD COLUMN IF NOT EXISTS "last_name" TEXT NOT NULL DEFAULT '';
ALTER TABLE "hr_employees" ADD COLUMN IF NOT EXISTS "employee_name" TEXT NOT NULL DEFAULT '';
ALTER TABLE "hr_employees" ADD COLUMN IF NOT EXISTS "salutation_id" TEXT;
ALTER TABLE "hr_employees" ADD COLUMN IF NOT EXISTS "gender_id" TEXT;
ALTER TABLE "hr_employees" ADD COLUMN IF NOT EXISTS "date_of_birth" DATE;
ALTER TABLE "hr_employees" ADD COLUMN IF NOT EXISTS "employee_number" TEXT NOT NULL DEFAULT '';
ALTER TABLE "hr_employees" ADD COLUMN IF NOT EXISTS "create_user_permission" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "hr_employees" ADD COLUMN IF NOT EXISTS "create_user_automatically" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "hr_employees" ADD COLUMN IF NOT EXISTS "company_email" TEXT NOT NULL DEFAULT '';
ALTER TABLE "hr_employees" ADD COLUMN IF NOT EXISTS "personal_email" TEXT NOT NULL DEFAULT '';
ALTER TABLE "hr_employees" ADD COLUMN IF NOT EXISTS "prefered_contact_email" TEXT NOT NULL DEFAULT '';
ALTER TABLE "hr_employees" ADD COLUMN IF NOT EXISTS "prefered_email" TEXT NOT NULL DEFAULT '';
ALTER TABLE "hr_employees" ADD COLUMN IF NOT EXISTS "unsubscribed" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "hr_employees" ADD COLUMN IF NOT EXISTS "current_address" TEXT NOT NULL DEFAULT '';
ALTER TABLE "hr_employees" ADD COLUMN IF NOT EXISTS "current_accommodation_type" TEXT NOT NULL DEFAULT '';
ALTER TABLE "hr_employees" ADD COLUMN IF NOT EXISTS "permanent_address" TEXT NOT NULL DEFAULT '';
ALTER TABLE "hr_employees" ADD COLUMN IF NOT EXISTS "permanent_accommodation_type" TEXT NOT NULL DEFAULT '';
ALTER TABLE "hr_employees" ADD COLUMN IF NOT EXISTS "person_to_be_contacted" TEXT NOT NULL DEFAULT '';
ALTER TABLE "hr_employees" ADD COLUMN IF NOT EXISTS "emergency_phone_number" TEXT NOT NULL DEFAULT '';
ALTER TABLE "hr_employees" ADD COLUMN IF NOT EXISTS "relation" TEXT NOT NULL DEFAULT '';
ALTER TABLE "hr_employees" ADD COLUMN IF NOT EXISTS "attendance_device_id" TEXT;
ALTER TABLE "hr_employees" ADD COLUMN IF NOT EXISTS "holiday_list_id" TEXT;
ALTER TABLE "hr_employees" ADD COLUMN IF NOT EXISTS "iban" TEXT NOT NULL DEFAULT '';
ALTER TABLE "hr_employees" ADD COLUMN IF NOT EXISTS "marital_status" TEXT NOT NULL DEFAULT '';
ALTER TABLE "hr_employees" ADD COLUMN IF NOT EXISTS "family_background" TEXT NOT NULL DEFAULT '';
ALTER TABLE "hr_employees" ADD COLUMN IF NOT EXISTS "blood_group" TEXT NOT NULL DEFAULT '';
ALTER TABLE "hr_employees" ADD COLUMN IF NOT EXISTS "health_details" TEXT NOT NULL DEFAULT '';
ALTER TABLE "hr_employees" ADD COLUMN IF NOT EXISTS "passport_number" TEXT NOT NULL DEFAULT '';
ALTER TABLE "hr_employees" ADD COLUMN IF NOT EXISTS "valid_upto" DATE;
ALTER TABLE "hr_employees" ADD COLUMN IF NOT EXISTS "date_of_issue" DATE;
ALTER TABLE "hr_employees" ADD COLUMN IF NOT EXISTS "place_of_issue" TEXT NOT NULL DEFAULT '';
ALTER TABLE "hr_employees" ADD COLUMN IF NOT EXISTS "bio" TEXT NOT NULL DEFAULT '';
ALTER TABLE "hr_employees" ADD COLUMN IF NOT EXISTS "education" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "hr_employees" ADD COLUMN IF NOT EXISTS "external_work_history" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "hr_employees" ADD COLUMN IF NOT EXISTS "internal_work_history" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "hr_employees" ADD COLUMN IF NOT EXISTS "scheduled_confirmation_date" DATE;
ALTER TABLE "hr_employees" ADD COLUMN IF NOT EXISTS "final_confirmation_date" DATE;
ALTER TABLE "hr_employees" ADD COLUMN IF NOT EXISTS "contract_end_date" DATE;
ALTER TABLE "hr_employees" ADD COLUMN IF NOT EXISTS "notice_number_of_days" INTEGER;
ALTER TABLE "hr_employees" ADD COLUMN IF NOT EXISTS "date_of_retirement" DATE;
ALTER TABLE "hr_employees" ADD COLUMN IF NOT EXISTS "resignation_letter_date" DATE;
ALTER TABLE "hr_employees" ADD COLUMN IF NOT EXISTS "relieving_date" DATE;
ALTER TABLE "hr_employees" ADD COLUMN IF NOT EXISTS "held_on" DATE;
ALTER TABLE "hr_employees" ADD COLUMN IF NOT EXISTS "new_workplace" TEXT NOT NULL DEFAULT '';
ALTER TABLE "hr_employees" ADD COLUMN IF NOT EXISTS "leave_encashed" TEXT NOT NULL DEFAULT '';
ALTER TABLE "hr_employees" ADD COLUMN IF NOT EXISTS "encashment_date" DATE;
ALTER TABLE "hr_employees" ADD COLUMN IF NOT EXISTS "reason_for_leaving" TEXT NOT NULL DEFAULT '';
ALTER TABLE "hr_employees" ADD COLUMN IF NOT EXISTS "feedback" TEXT NOT NULL DEFAULT '';
ALTER TABLE "hr_employees" ADD COLUMN IF NOT EXISTS "image" TEXT;

-- AddForeignKey
ALTER TABLE "hr_employees" DROP CONSTRAINT IF EXISTS "hr_employees_salutation_id_fkey";
ALTER TABLE "hr_employees" ADD CONSTRAINT "hr_employees_salutation_id_fkey" FOREIGN KEY ("salutation_id") REFERENCES "hr_salutations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "hr_employees" DROP CONSTRAINT IF EXISTS "hr_employees_gender_id_fkey";
ALTER TABLE "hr_employees" ADD CONSTRAINT "hr_employees_gender_id_fkey" FOREIGN KEY ("gender_id") REFERENCES "hr_genders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "hr_employees" DROP CONSTRAINT IF EXISTS "hr_employees_holiday_list_id_fkey";
ALTER TABLE "hr_employees" ADD CONSTRAINT "hr_employees_holiday_list_id_fkey" FOREIGN KEY ("holiday_list_id") REFERENCES "hr_holiday_lists"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "hr_holiday_lists" DROP CONSTRAINT IF EXISTS "hr_holiday_lists_company_id_fkey";
ALTER TABLE "hr_holiday_lists" ADD CONSTRAINT "hr_holiday_lists_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "hr_genders" DROP CONSTRAINT IF EXISTS "hr_genders_company_id_fkey";
ALTER TABLE "hr_genders" ADD CONSTRAINT "hr_genders_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "hr_salutations" DROP CONSTRAINT IF EXISTS "hr_salutations_company_id_fkey";
ALTER TABLE "hr_salutations" ADD CONSTRAINT "hr_salutations_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Data alignment: existing rows get the ERPNext name columns filled in from the
-- login user or the profile JSON, so the new Full Name field is never blank.
UPDATE "hr_employees" e
SET
  first_name = COALESCE(NULLIF(u."first_name", ''), NULLIF(e."profile" ->> 'firstName', ''), e."first_name", ''),
  last_name  = COALESCE(NULLIF(u."last_name", ''),  NULLIF(e."profile" ->> 'lastName', ''),  e."last_name", '')
FROM "users" u
WHERE u."id" = e."user_id"
  AND (e."first_name" = '' OR e."last_name" = '');

UPDATE "hr_employees"
SET employee_name = TRIM(CONCAT_WS(' ', NULLIF(first_name, ''), NULLIF(middle_name, ''), NULLIF(last_name, '')))
WHERE employee_name = '' OR employee_name IS NULL;

UPDATE "hr_employees"
SET employee_name = employee_code
WHERE employee_name = '';
