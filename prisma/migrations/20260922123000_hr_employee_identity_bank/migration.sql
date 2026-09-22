-- Employee identity and bank details for payroll

ALTER TABLE "hr_employees" ADD COLUMN IF NOT EXISTS "cnic" TEXT NOT NULL DEFAULT '';
ALTER TABLE "hr_employees" ADD COLUMN IF NOT EXISTS "bank_name" TEXT NOT NULL DEFAULT '';
ALTER TABLE "hr_employees" ADD COLUMN IF NOT EXISTS "account_title" TEXT NOT NULL DEFAULT '';
ALTER TABLE "hr_employees" ADD COLUMN IF NOT EXISTS "account_number" TEXT NOT NULL DEFAULT '';
ALTER TABLE "hr_employees" ADD COLUMN IF NOT EXISTS "bank_swift_code" TEXT NOT NULL DEFAULT '';
