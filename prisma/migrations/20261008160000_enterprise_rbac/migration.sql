-- Enterprise Granular Roles & Permissions (RBAC) Migration

-- 1. Enhance roles table
ALTER TABLE "roles" ADD COLUMN IF NOT EXISTS "company_id" TEXT;
ALTER TABLE "roles" ADD COLUMN IF NOT EXISTS "is_system" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "roles" ADD COLUMN IF NOT EXISTS "scope" TEXT NOT NULL DEFAULT 'ALL';

ALTER TABLE "roles" DROP CONSTRAINT IF EXISTS "roles_name_key";

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'roles_company_id_fkey') THEN
    ALTER TABLE "roles" ADD CONSTRAINT "roles_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "roles_company_id_idx" ON "roles"("company_id");
DROP INDEX IF EXISTS "roles_company_id_name_key";
CREATE UNIQUE INDEX IF NOT EXISTS "roles_company_id_name_key" ON "roles"("company_id", "name");

-- 2. Enhance permissions table
ALTER TABLE "permissions" ADD COLUMN IF NOT EXISTS "resource" TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS "permissions_resource_idx" ON "permissions"("resource");

-- 3. Enhance role_permissions table
ALTER TABLE "role_permissions" ADD COLUMN IF NOT EXISTS "scope" TEXT NOT NULL DEFAULT 'ALL';

-- 4. User Permission Overrides table
CREATE TABLE IF NOT EXISTS "user_permission_overrides" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "company_id" TEXT,
    "permission_id" TEXT NOT NULL,
    "effect" TEXT NOT NULL DEFAULT 'ALLOW',
    "scope" TEXT DEFAULT 'ALL',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_permission_overrides_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_permission_overrides_user_id_fkey') THEN
    ALTER TABLE "user_permission_overrides" ADD CONSTRAINT "user_permission_overrides_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_permission_overrides_permission_id_fkey') THEN
    ALTER TABLE "user_permission_overrides" ADD CONSTRAINT "user_permission_overrides_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "user_permission_overrides_user_id_permission_id_key" ON "user_permission_overrides"("user_id", "permission_id");
CREATE INDEX IF NOT EXISTS "user_permission_overrides_user_id_idx" ON "user_permission_overrides"("user_id");
CREATE INDEX IF NOT EXISTS "user_permission_overrides_company_id_idx" ON "user_permission_overrides"("company_id");

-- 5. Security & RBAC Audit Logs table
CREATE TABLE IF NOT EXISTS "security_audit_logs" (
    "id" TEXT NOT NULL,
    "company_id" TEXT,
    "user_id" TEXT,
    "action" TEXT NOT NULL,
    "target_type" TEXT NOT NULL,
    "target_id" TEXT,
    "details" JSONB,
    "ip_address" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "security_audit_logs_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'security_audit_logs_company_id_fkey') THEN
    ALTER TABLE "security_audit_logs" ADD CONSTRAINT "security_audit_logs_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'security_audit_logs_user_id_fkey') THEN
    ALTER TABLE "security_audit_logs" ADD CONSTRAINT "security_audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "security_audit_logs_company_id_idx" ON "security_audit_logs"("company_id");
CREATE INDEX IF NOT EXISTS "security_audit_logs_user_id_idx" ON "security_audit_logs"("user_id");
CREATE INDEX IF NOT EXISTS "security_audit_logs_action_idx" ON "security_audit_logs"("action");
