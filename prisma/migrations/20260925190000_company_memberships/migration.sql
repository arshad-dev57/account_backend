-- Multi-company memberships (one user → many companies)
-- Backward-compatible: backfills from existing users.company_id

CREATE TABLE IF NOT EXISTS "company_memberships" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'admin',
    "is_owner" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "company_memberships_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "company_memberships_user_id_company_id_key"
  ON "company_memberships"("user_id", "company_id");

CREATE INDEX IF NOT EXISTS "company_memberships_user_id_idx" ON "company_memberships"("user_id");
CREATE INDEX IF NOT EXISTS "company_memberships_company_id_idx" ON "company_memberships"("company_id");
CREATE INDEX IF NOT EXISTS "company_memberships_is_active_idx" ON "company_memberships"("is_active");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'company_memberships_user_id_fkey'
  ) THEN
    ALTER TABLE "company_memberships"
      ADD CONSTRAINT "company_memberships_user_id_fkey"
      FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'company_memberships_company_id_fkey'
  ) THEN
    ALTER TABLE "company_memberships"
      ADD CONSTRAINT "company_memberships_company_id_fkey"
      FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- Backfill: every user with a companyId becomes an owner/admin member of that company
INSERT INTO "company_memberships" ("id", "user_id", "company_id", "role", "is_owner", "is_active", "created_at", "updated_at")
SELECT
  gen_random_uuid()::text,
  u."id",
  u."company_id",
  CASE WHEN lower(coalesce(u."role", 'user')) = 'admin' THEN 'admin' ELSE coalesce(u."role", 'user') END,
  CASE WHEN lower(coalesce(u."role", 'user')) = 'admin' THEN true ELSE false END,
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "users" u
WHERE u."company_id" IS NOT NULL
ON CONFLICT ("user_id", "company_id") DO NOTHING;
