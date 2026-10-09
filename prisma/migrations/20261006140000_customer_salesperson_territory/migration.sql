-- Customer territory (CRM / sales assignment)
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "territory" TEXT;

-- Salesperson territory if table exists and column missing
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'salespersons'
  ) THEN
    ALTER TABLE "salespersons" ADD COLUMN IF NOT EXISTS "territory" TEXT;
  END IF;
END $$;
