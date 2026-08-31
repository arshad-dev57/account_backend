-- Restaurant POS mode + orders (Flow #2)

ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "pos_mode" TEXT NOT NULL DEFAULT 'retail';

CREATE TABLE IF NOT EXISTS "restaurant_orders" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "location_id" TEXT,
    "shift_id" TEXT,
    "terminal_id" TEXT,
    "table_label" TEXT,
    "order_type" TEXT NOT NULL DEFAULT 'dine_in',
    "status" TEXT NOT NULL DEFAULT 'SENT',
    "waiter_user_id" TEXT,
    "notes" TEXT,
    "subtotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "tax_total" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "grand_total" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "pos_sale_id" TEXT,
    "ticket_number" INTEGER,
    "sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ready_at" TIMESTAMP(3),
    "paid_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "restaurant_orders_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "restaurant_order_lines" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "product_id" TEXT,
    "product_name" TEXT NOT NULL,
    "sku" TEXT NOT NULL DEFAULT '',
    "quantity" DOUBLE PRECISION NOT NULL,
    "unit_price" DOUBLE PRECISION NOT NULL,
    "line_total" DOUBLE PRECISION NOT NULL,
    "notes" TEXT,

    CONSTRAINT "restaurant_order_lines_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "restaurant_orders_company_id_status_idx" ON "restaurant_orders"("company_id", "status");
CREATE INDEX IF NOT EXISTS "restaurant_orders_company_id_created_at_idx" ON "restaurant_orders"("company_id", "created_at");
CREATE INDEX IF NOT EXISTS "restaurant_order_lines_order_id_idx" ON "restaurant_order_lines"("order_id");

ALTER TABLE "restaurant_orders" DROP CONSTRAINT IF EXISTS "restaurant_orders_company_id_fkey";
ALTER TABLE "restaurant_orders" ADD CONSTRAINT "restaurant_orders_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "restaurant_orders" DROP CONSTRAINT IF EXISTS "restaurant_orders_waiter_user_id_fkey";
ALTER TABLE "restaurant_orders" ADD CONSTRAINT "restaurant_orders_waiter_user_id_fkey" FOREIGN KEY ("waiter_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "restaurant_order_lines" DROP CONSTRAINT IF EXISTS "restaurant_order_lines_order_id_fkey";
ALTER TABLE "restaurant_order_lines" ADD CONSTRAINT "restaurant_order_lines_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "restaurant_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
