-- CreateTable
CREATE TABLE "support_tickets" (
    "id" TEXT NOT NULL,
    "ticket_number" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'General',
    "priority" TEXT NOT NULL DEFAULT 'Medium',
    "status" TEXT NOT NULL DEFAULT 'Open',
    "steps_to_reproduce" TEXT,
    "attachment_url" TEXT,
    "admin_response" TEXT,
    "module" TEXT,
    "user_id" TEXT NOT NULL,
    "company_id" TEXT,
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "support_tickets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "support_tickets_ticket_number_key" ON "support_tickets"("ticket_number");

-- CreateIndex
CREATE INDEX "support_tickets_user_id_idx" ON "support_tickets"("user_id");

-- CreateIndex
CREATE INDEX "support_tickets_company_id_idx" ON "support_tickets"("company_id");

-- CreateIndex
CREATE INDEX "support_tickets_status_idx" ON "support_tickets"("status");

-- CreateIndex
CREATE INDEX "support_tickets_priority_idx" ON "support_tickets"("priority");

-- CreateIndex
CREATE INDEX "support_tickets_created_at_idx" ON "support_tickets"("created_at");

-- AddForeignKey
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable: FixedAsset acquisition / payment fields
ALTER TABLE "fixed_assets" ADD COLUMN IF NOT EXISTS "acquisition_type" TEXT NOT NULL DEFAULT 'purchase';
ALTER TABLE "fixed_assets" ADD COLUMN IF NOT EXISTS "payment_method" TEXT NOT NULL DEFAULT 'Cash';
ALTER TABLE "fixed_assets" ADD COLUMN IF NOT EXISTS "bank_account_id" TEXT;
ALTER TABLE "fixed_assets" ADD COLUMN IF NOT EXISTS "opening_accumulated_depreciation" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "fixed_assets_bank_account_id_idx" ON "fixed_assets"("bank_account_id");
CREATE INDEX IF NOT EXISTS "fixed_assets_acquisition_type_idx" ON "fixed_assets"("acquisition_type");
CREATE INDEX IF NOT EXISTS "fixed_assets_payment_method_idx" ON "fixed_assets"("payment_method");

-- AddForeignKey (safe if already present)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fixed_assets_bank_account_id_fkey'
  ) THEN
    ALTER TABLE "fixed_assets"
      ADD CONSTRAINT "fixed_assets_bank_account_id_fkey"
      FOREIGN KEY ("bank_account_id") REFERENCES "bank_accounts"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
