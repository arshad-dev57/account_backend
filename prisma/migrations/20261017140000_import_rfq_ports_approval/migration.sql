-- Import ports master + RFQ approval / single-source justification fields

CREATE TABLE IF NOT EXISTS "import_ports" (
  "id" TEXT NOT NULL,
  "un_locode" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "country" TEXT NOT NULL,
  "country_code" TEXT,
  "port_type" TEXT NOT NULL DEFAULT 'Sea',
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "aliases" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "import_ports_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "import_ports_un_locode_key" ON "import_ports"("un_locode");
CREATE INDEX IF NOT EXISTS "import_ports_name_idx" ON "import_ports"("name");
CREATE INDEX IF NOT EXISTS "import_ports_country_idx" ON "import_ports"("country");

-- Seed common import ports (idempotent)
INSERT INTO "import_ports" ("id", "un_locode", "name", "country", "country_code", "port_type", "aliases", "updated_at")
VALUES
  ('port-aejea', 'AEJEA', 'Jebel Ali Port', 'United Arab Emirates', 'AE', 'Sea', '["jabel ali port","jebel ali","jebel ali port (aejea)","jebel ali (uae)","aejea"]'::jsonb, CURRENT_TIMESTAMP),
  ('port-aedxb', 'AEDXB', 'Dubai (DXB) Airport', 'United Arab Emirates', 'AE', 'Air', '["dubai airport","dxb"]'::jsonb, CURRENT_TIMESTAMP),
  ('port-aekhl', 'AEKHL', 'Khalifa Port', 'United Arab Emirates', 'AE', 'Sea', '["khalifa port","abu dhabi port"]'::jsonb, CURRENT_TIMESTAMP),
  ('port-pkbqm', 'PKBQM', 'Port Qasim', 'Pakistan', 'PK', 'Sea', '["port qasim","bin qasim"]'::jsonb, CURRENT_TIMESTAMP),
  ('port-pkKhi', 'PKKHI', 'Karachi Port', 'Pakistan', 'PK', 'Sea', '["karachi","karachi port","kpt"]'::jsonb, CURRENT_TIMESTAMP),
  ('port-cnnbo', 'CNNGB', 'Ningbo Port', 'China', 'CN', 'Sea', '["ningbo"]'::jsonb, CURRENT_TIMESTAMP),
  ('port-cnsha', 'CNSHA', 'Shanghai Port', 'China', 'CN', 'Sea', '["shanghai","shanghai port"]'::jsonb, CURRENT_TIMESTAMP),
  ('port-cnszx', 'CNSZX', 'Shenzhen Port', 'China', 'CN', 'Sea', '["shenzhen","yantian"]'::jsonb, CURRENT_TIMESTAMP),
  ('port-inbom', 'INBOM', 'Mumbai (Bombay) Port', 'India', 'IN', 'Sea', '["mumbai","bombay","nhava sheva","in nsa"]'::jsonb, CURRENT_TIMESTAMP),
  ('port-inmaa', 'INMAA', 'Chennai Port', 'India', 'IN', 'Sea', '["chennai","madras"]'::jsonb, CURRENT_TIMESTAMP),
  ('port-sgSIN', 'SGSIN', 'Singapore Port', 'Singapore', 'SG', 'Sea', '["singapore"]'::jsonb, CURRENT_TIMESTAMP),
  ('port-nlrtm', 'NLRTM', 'Rotterdam Port', 'Netherlands', 'NL', 'Sea', '["rotterdam"]'::jsonb, CURRENT_TIMESTAMP),
  ('port-deham', 'DEHAM', 'Hamburg Port', 'Germany', 'DE', 'Sea', '["hamburg"]'::jsonb, CURRENT_TIMESTAMP),
  ('port-uslax', 'USLAX', 'Los Angeles Port', 'United States', 'US', 'Sea', '["los angeles","la port"]'::jsonb, CURRENT_TIMESTAMP),
  ('port-usnyC', 'USNYC', 'New York / New Jersey Port', 'United States', 'US', 'Sea', '["new york","newark"]'::jsonb, CURRENT_TIMESTAMP)
ON CONFLICT ("un_locode") DO NOTHING;

ALTER TABLE "import_rfqs"
  ADD COLUMN IF NOT EXISTS "port_id" TEXT,
  ADD COLUMN IF NOT EXISTS "country_of_dispatch" TEXT,
  ADD COLUMN IF NOT EXISTS "single_source_justification" TEXT,
  ADD COLUMN IF NOT EXISTS "awarded_by" TEXT,
  ADD COLUMN IF NOT EXISTS "awarded_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "approved_by" TEXT,
  ADD COLUMN IF NOT EXISTS "approved_at" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "import_rfqs_port_id_idx" ON "import_rfqs"("port_id");

DO $$ BEGIN
  ALTER TABLE "import_rfqs"
    ADD CONSTRAINT "import_rfqs_port_id_fkey"
    FOREIGN KEY ("port_id") REFERENCES "import_ports"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "import_settings"
  ADD COLUMN IF NOT EXISTS "require_separate_rfq_approver" BOOLEAN NOT NULL DEFAULT false;

-- Map free-text port_of_discharge to master ports where alias/name matches
UPDATE "import_rfqs" r
SET
  "port_id" = p.id,
  "port_of_discharge" = p.name
FROM "import_ports" p
WHERE r."port_id" IS NULL
  AND r."port_of_discharge" IS NOT NULL
  AND (
    lower(trim(r."port_of_discharge")) = lower(p.name)
    OR lower(trim(r."port_of_discharge")) = lower(p.un_locode)
    OR (
      p.aliases IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM jsonb_array_elements_text(p.aliases) AS a(val)
        WHERE lower(trim(r."port_of_discharge")) = lower(trim(a.val))
           OR lower(trim(r."port_of_discharge")) LIKE '%' || lower(trim(a.val)) || '%'
      )
    )
  );

-- Normalize legacy PO free-text port_of_entry to master port names
UPDATE "import_purchase_orders" po
SET "port_of_entry" = p.name
FROM "import_ports" p
WHERE po."port_of_entry" IS NOT NULL
  AND (
    lower(trim(po."port_of_entry")) = lower(p.name)
    OR lower(trim(po."port_of_entry")) = lower(p.un_locode)
    OR (
      p.aliases IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM jsonb_array_elements_text(p.aliases) AS a(val)
        WHERE lower(trim(po."port_of_entry")) = lower(trim(a.val))
           OR lower(trim(po."port_of_entry")) LIKE '%' || lower(trim(a.val)) || '%'
      )
    )
  );
