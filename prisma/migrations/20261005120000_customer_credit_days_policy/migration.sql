-- Add customer credit policy fields (schema already had these; DB was behind)
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "credit_days" INTEGER NOT NULL DEFAULT 30;
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "credit_policy" TEXT NOT NULL DEFAULT 'WARN';
