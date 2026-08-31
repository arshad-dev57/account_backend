-- Company subscription licensing (product tier, seats, branches)
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "product_tier" TEXT NOT NULL DEFAULT 'erp_pos';
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "licensed_users" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "licensed_branches" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "billing_cycle" TEXT;
