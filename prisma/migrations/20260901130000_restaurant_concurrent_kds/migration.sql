-- Restaurant concurrent KDS: timestamps, priority, idempotency, kitchen stations

ALTER TABLE "restaurant_orders"
  ADD COLUMN IF NOT EXISTS "preparing_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "served_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "completed_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "priority" TEXT NOT NULL DEFAULT 'normal',
  ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "client_request_id" TEXT;

ALTER TABLE "restaurant_order_lines"
  ADD COLUMN IF NOT EXISTS "kitchen_station_id" TEXT,
  ADD COLUMN IF NOT EXISTS "line_status" TEXT NOT NULL DEFAULT 'PENDING',
  ADD COLUMN IF NOT EXISTS "preparing_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "ready_at" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "kitchen_stations" (
  "id" TEXT NOT NULL,
  "company_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "kitchen_stations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "kitchen_stations_company_id_code_key"
  ON "kitchen_stations"("company_id", "code");

CREATE INDEX IF NOT EXISTS "kitchen_stations_company_id_idx"
  ON "kitchen_stations"("company_id");

CREATE UNIQUE INDEX IF NOT EXISTS "restaurant_orders_company_ticket_unique"
  ON "restaurant_orders"("company_id", "ticket_number")
  WHERE "ticket_number" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "restaurant_orders_company_client_request_unique"
  ON "restaurant_orders"("company_id", "client_request_id")
  WHERE "client_request_id" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "restaurant_orders_company_updated_idx"
  ON "restaurant_orders"("company_id", "updated_at");

CREATE INDEX IF NOT EXISTS "restaurant_order_lines_station_idx"
  ON "restaurant_order_lines"("kitchen_station_id");

ALTER TABLE "kitchen_stations"
  ADD CONSTRAINT "kitchen_stations_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "restaurant_order_lines"
  ADD CONSTRAINT "restaurant_order_lines_kitchen_station_id_fkey"
  FOREIGN KEY ("kitchen_station_id") REFERENCES "kitchen_stations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
