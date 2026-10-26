-- Track when clients use the web / desktop apps (for platform admin)

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "last_active_at" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "app_usage_events" (
  "id" TEXT NOT NULL,
  "company_id" TEXT,
  "user_id" TEXT,
  "action" TEXT NOT NULL,
  "source" TEXT NOT NULL DEFAULT 'web',
  "path" TEXT,
  "ip_address" TEXT,
  "user_agent" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "app_usage_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "app_usage_events_company_id_created_at_idx"
  ON "app_usage_events"("company_id", "created_at");

CREATE INDEX IF NOT EXISTS "app_usage_events_user_id_created_at_idx"
  ON "app_usage_events"("user_id", "created_at");

CREATE INDEX IF NOT EXISTS "app_usage_events_action_created_at_idx"
  ON "app_usage_events"("action", "created_at");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'app_usage_events_company_id_fkey'
  ) THEN
    ALTER TABLE "app_usage_events"
      ADD CONSTRAINT "app_usage_events_company_id_fkey"
      FOREIGN KEY ("company_id") REFERENCES "companies"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'app_usage_events_user_id_fkey'
  ) THEN
    ALTER TABLE "app_usage_events"
      ADD CONSTRAINT "app_usage_events_user_id_fkey"
      FOREIGN KEY ("user_id") REFERENCES "users"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
