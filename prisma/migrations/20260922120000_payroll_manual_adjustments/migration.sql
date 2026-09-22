-- Payroll manual adjustments and payslip delivery fields

ALTER TABLE "hr_payroll_items" ADD COLUMN IF NOT EXISTS "manual_bonus" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "hr_payroll_items" ADD COLUMN IF NOT EXISTS "manual_deduction" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "hr_payroll_items" ADD COLUMN IF NOT EXISTS "custom_tax" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "hr_payroll_items" ADD COLUMN IF NOT EXISTS "adjusted_by_hr" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "hr_payroll_items" ADD COLUMN IF NOT EXISTS "adjustment_notes" TEXT NOT NULL DEFAULT '';
ALTER TABLE "hr_payroll_items" ADD COLUMN IF NOT EXISTS "email_sent" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "hr_payroll_items" ADD COLUMN IF NOT EXISTS "email_sent_at" TIMESTAMP(3);
ALTER TABLE "hr_payroll_items" ADD COLUMN IF NOT EXISTS "whatsapp_sent" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "hr_payroll_items" ADD COLUMN IF NOT EXISTS "whatsapp_sent_at" TIMESTAMP(3);
ALTER TABLE "hr_payroll_items" ADD COLUMN IF NOT EXISTS "payslip_pdf_url" TEXT;
