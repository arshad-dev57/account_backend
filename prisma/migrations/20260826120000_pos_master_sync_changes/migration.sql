-- POS master-data changelog for Electron incremental sync.
-- Cloud PostgreSQL remains the source of truth.

CREATE TABLE IF NOT EXISTS "pos_master_sync_changes" (
    "id" BIGSERIAL NOT NULL,
    "company_id" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pos_master_sync_changes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "pos_master_sync_changes_company_id_id_idx"
  ON "pos_master_sync_changes"("company_id", "id");

CREATE INDEX IF NOT EXISTS "pos_master_sync_changes_company_entity_idx"
  ON "pos_master_sync_changes"("company_id", "entity_type", "entity_id");

CREATE INDEX IF NOT EXISTS "categories_company_id_updated_at_id_idx"
  ON "categories"("company_id", "updated_at", "id");

CREATE INDEX IF NOT EXISTS "products_company_id_updated_at_id_idx"
  ON "products"("company_id", "updated_at", "id");
