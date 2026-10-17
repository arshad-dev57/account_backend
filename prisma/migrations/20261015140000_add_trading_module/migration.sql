-- Trading module: classification layer over Sales/Purchases (no duplicate posting engines)

CREATE TABLE IF NOT EXISTS "trading_documents" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "document_type" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "document_number" TEXT,
    "trade_channel" TEXT NOT NULL DEFAULT 'domestic',
    "trade_ref" TEXT,
    "counterparty_name" TEXT,
    "status" TEXT,
    "amount_base" DECIMAL(18,4),
    "currency_code" TEXT,
    "document_date" TIMESTAMP(3),
    "metadata" JSONB,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "trading_documents_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "trading_documents_company_id_document_type_document_id_key"
  ON "trading_documents"("company_id", "document_type", "document_id");
CREATE INDEX IF NOT EXISTS "trading_documents_company_id_idx" ON "trading_documents"("company_id");
CREATE INDEX IF NOT EXISTS "trading_documents_company_id_document_type_idx" ON "trading_documents"("company_id", "document_type");
CREATE INDEX IF NOT EXISTS "trading_documents_company_id_trade_channel_idx" ON "trading_documents"("company_id", "trade_channel");
CREATE INDEX IF NOT EXISTS "trading_documents_company_id_document_date_idx" ON "trading_documents"("company_id", "document_date");
CREATE INDEX IF NOT EXISTS "trading_documents_document_id_idx" ON "trading_documents"("document_id");

ALTER TABLE "trading_documents"
  ADD CONSTRAINT "trading_documents_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "trading_documents"
  ADD CONSTRAINT "trading_documents_created_by_fkey"
  FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "trading_price_lists" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tier" TEXT NOT NULL DEFAULT 'Wholesale',
    "currency_code" TEXT NOT NULL DEFAULT 'USD',
    "discount_percentage" DECIMAL(8,4) NOT NULL DEFAULT 0,
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "trading_price_lists_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "trading_price_lists_company_id_code_key"
  ON "trading_price_lists"("company_id", "code");
CREATE INDEX IF NOT EXISTS "trading_price_lists_company_id_is_active_idx"
  ON "trading_price_lists"("company_id", "is_active");

ALTER TABLE "trading_price_lists"
  ADD CONSTRAINT "trading_price_lists_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "trading_price_lists"
  ADD CONSTRAINT "trading_price_lists_created_by_fkey"
  FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "trading_price_list_items" (
    "id" TEXT NOT NULL,
    "price_list_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "unit_price" DECIMAL(18,4) NOT NULL,
    "min_qty" DECIMAL(18,4) NOT NULL DEFAULT 1,
    CONSTRAINT "trading_price_list_items_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "trading_price_list_items_price_list_id_product_id_key"
  ON "trading_price_list_items"("price_list_id", "product_id");
CREATE INDEX IF NOT EXISTS "trading_price_list_items_product_id_idx"
  ON "trading_price_list_items"("product_id");

ALTER TABLE "trading_price_list_items"
  ADD CONSTRAINT "trading_price_list_items_price_list_id_fkey"
  FOREIGN KEY ("price_list_id") REFERENCES "trading_price_lists"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "trading_price_list_items"
  ADD CONSTRAINT "trading_price_list_items_product_id_fkey"
  FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "trading_customer_prices" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "list_price" DECIMAL(18,4) NOT NULL,
    "negotiated_price" DECIMAL(18,4) NOT NULL,
    "min_order_qty" DECIMAL(18,4) NOT NULL DEFAULT 1,
    "effective_until" DATE,
    "status" TEXT NOT NULL DEFAULT 'Active',
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "trading_customer_prices_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "trading_customer_prices_company_id_customer_id_product_id_key"
  ON "trading_customer_prices"("company_id", "customer_id", "product_id");
CREATE INDEX IF NOT EXISTS "trading_customer_prices_company_id_status_idx"
  ON "trading_customer_prices"("company_id", "status");
CREATE INDEX IF NOT EXISTS "trading_customer_prices_customer_id_idx"
  ON "trading_customer_prices"("customer_id");
CREATE INDEX IF NOT EXISTS "trading_customer_prices_product_id_idx"
  ON "trading_customer_prices"("product_id");

ALTER TABLE "trading_customer_prices"
  ADD CONSTRAINT "trading_customer_prices_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "trading_customer_prices"
  ADD CONSTRAINT "trading_customer_prices_customer_id_fkey"
  FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "trading_customer_prices"
  ADD CONSTRAINT "trading_customer_prices_product_id_fkey"
  FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "trading_customer_prices"
  ADD CONSTRAINT "trading_customer_prices_created_by_fkey"
  FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "trading_audit_logs" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "details" JSONB,
    "user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "trading_audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "trading_audit_logs_company_id_created_at_idx"
  ON "trading_audit_logs"("company_id", "created_at");
CREATE INDEX IF NOT EXISTS "trading_audit_logs_entity_type_entity_id_idx"
  ON "trading_audit_logs"("entity_type", "entity_id");

ALTER TABLE "trading_audit_logs"
  ADD CONSTRAINT "trading_audit_logs_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "trading_audit_logs"
  ADD CONSTRAINT "trading_audit_logs_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
