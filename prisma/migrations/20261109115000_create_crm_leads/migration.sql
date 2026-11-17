-- Base crm_leads table.
-- The crm_enterprise_module migration (20261109120000) ALTERs crm_leads but no
-- earlier migration ever created it (local dev used `prisma db push`), which
-- broke `prisma migrate deploy` on fresh databases with:
--   ERROR: relation "crm_leads" does not exist
-- Columns match the final Lead model so the later additive ALTERs are no-ops.

CREATE TABLE IF NOT EXISTS "crm_leads" (
    "id"                     TEXT NOT NULL,
    "lead_number"            TEXT NOT NULL,
    "company_id"             TEXT NOT NULL,
    "title"                  TEXT,
    "first_name"             TEXT,
    "last_name"              TEXT,
    "full_name"              TEXT NOT NULL,
    "email"                  TEXT,
    "phone"                  TEXT,
    "whatsapp"               TEXT,
    "company_name"           TEXT,
    "city"                   TEXT,
    "state"                  TEXT,
    "country"                TEXT NOT NULL DEFAULT 'Pakistan',
    "source"                 TEXT NOT NULL DEFAULT 'Manual Entry',
    "source_id"              TEXT,
    "status"                 TEXT NOT NULL DEFAULT 'Lead',
    "stage"                  TEXT,
    "priority"               TEXT NOT NULL DEFAULT 'Medium',
    "budget"                 DOUBLE PRECISION,
    "currency"               TEXT NOT NULL DEFAULT 'PKR',
    "interest"               TEXT,
    "score"                  INTEGER NOT NULL DEFAULT 0,
    "assigned_to_id"         TEXT,
    "notes"                  TEXT,
    "tags"                   TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "custom_fields"          JSONB NOT NULL DEFAULT '{}',
    "board_id"               TEXT,
    "board_order"            INTEGER NOT NULL DEFAULT 0,
    "is_deleted"             BOOLEAN NOT NULL DEFAULT false,
    "converted_at"           TIMESTAMP(3),
    "converted_by_id"        TEXT,
    "converted_customer_id"  TEXT,
    "created_by"             TEXT NOT NULL,
    "updated_by"             TEXT,
    "created_at"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"             TIMESTAMP(3) NOT NULL,
    "mobile"                 TEXT,
    "website"                TEXT,
    "industry"               TEXT,
    "lead_type"              TEXT,
    "rating"                 TEXT,
    "territory"              TEXT,
    "address"                TEXT,
    "expected_revenue"       DOUBLE PRECISION,
    "expected_closing_date"  TIMESTAMP(3),
    "sales_team"             TEXT,
    "contact_person"         TEXT,
    "branch_id"              TEXT,
    "salutation"             TEXT,
    "middle_name"            TEXT,
    "gender"                 TEXT,
    "job_title"              TEXT,
    "phone_ext"              TEXT,
    "request_type"           TEXT,
    "no_of_employees"        TEXT,
    "annual_revenue"         DOUBLE PRECISION,
    "market_segment"         TEXT,
    "fax"                    TEXT,
    "qualification_status"   TEXT,
    "qualified_by"           TEXT,
    "qualified_on"           TIMESTAMP(3),
    "campaign_name"          TEXT,
    "language"               TEXT,
    "disabled"               BOOLEAN NOT NULL DEFAULT false,
    "unsubscribed"           BOOLEAN NOT NULL DEFAULT false,
    "blog_subscriber"        BOOLEAN NOT NULL DEFAULT false,
    "from_customer_id"       TEXT,

    CONSTRAINT "crm_leads_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "crm_leads_lead_number_key" ON "crm_leads"("lead_number");
CREATE INDEX IF NOT EXISTS "crm_leads_company_id_idx" ON "crm_leads"("company_id");
CREATE INDEX IF NOT EXISTS "crm_leads_status_idx" ON "crm_leads"("status");
CREATE INDEX IF NOT EXISTS "crm_leads_email_idx" ON "crm_leads"("email");
CREATE INDEX IF NOT EXISTS "crm_leads_phone_idx" ON "crm_leads"("phone");
CREATE INDEX IF NOT EXISTS "crm_leads_whatsapp_idx" ON "crm_leads"("whatsapp");
CREATE INDEX IF NOT EXISTS "crm_leads_assigned_to_id_idx" ON "crm_leads"("assigned_to_id");
CREATE INDEX IF NOT EXISTS "crm_leads_board_id_idx" ON "crm_leads"("board_id");
CREATE INDEX IF NOT EXISTS "crm_leads_is_deleted_idx" ON "crm_leads"("is_deleted");
CREATE INDEX IF NOT EXISTS "crm_leads_company_id_status_idx" ON "crm_leads"("company_id", "status");
CREATE INDEX IF NOT EXISTS "crm_leads_company_id_is_deleted_idx" ON "crm_leads"("company_id", "is_deleted");

DO $$ BEGIN
    ALTER TABLE "crm_leads" ADD CONSTRAINT "crm_leads_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "crm_leads" ADD CONSTRAINT "crm_leads_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "crm_leads" ADD CONSTRAINT "crm_leads_assigned_to_id_fkey" FOREIGN KEY ("assigned_to_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "crm_leads" ADD CONSTRAINT "crm_leads_converted_customer_id_fkey" FOREIGN KEY ("converted_customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object OR undefined_table THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "crm_leads" ADD CONSTRAINT "crm_leads_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "crm_lead_sources"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object OR undefined_table THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "crm_leads" ADD CONSTRAINT "crm_leads_board_id_fkey" FOREIGN KEY ("board_id") REFERENCES "crm_lead_boards"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object OR undefined_table THEN NULL; END $$;
