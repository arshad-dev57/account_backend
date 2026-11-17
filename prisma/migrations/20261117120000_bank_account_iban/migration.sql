-- AlterTable: BankAccount IBAN (required for live Prisma client)
ALTER TABLE "bank_accounts" ADD COLUMN IF NOT EXISTS "iban" TEXT NOT NULL DEFAULT '';
