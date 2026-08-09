-- Ensure no leftover GLOBAL unique on bill_number (Prisma reported P2002 on bill_number alone).
-- Keep only the composite unique (bill_number, company_id).

DROP INDEX IF EXISTS "bills_bill_number_key";

DO $$
BEGIN
  ALTER TABLE "bills" DROP CONSTRAINT IF EXISTS "bills_bill_number_key";
EXCEPTION
  WHEN undefined_object THEN NULL;
END $$;
