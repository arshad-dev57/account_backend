-- CRM Enterprise Module Migration
-- Migration: 20261109120000_crm_enterprise_module
-- Safe, additive only. No DROP or TRUNCATE.

-- ─── Extend crm_leads with new optional columns ──────────────────────────────
ALTER TABLE "crm_leads" ADD COLUMN IF NOT EXISTS "mobile"                  TEXT;
ALTER TABLE "crm_leads" ADD COLUMN IF NOT EXISTS "website"                 TEXT;
ALTER TABLE "crm_leads" ADD COLUMN IF NOT EXISTS "industry"                TEXT;
ALTER TABLE "crm_leads" ADD COLUMN IF NOT EXISTS "lead_type"               TEXT;
ALTER TABLE "crm_leads" ADD COLUMN IF NOT EXISTS "rating"                  TEXT;
ALTER TABLE "crm_leads" ADD COLUMN IF NOT EXISTS "territory"               TEXT;
ALTER TABLE "crm_leads" ADD COLUMN IF NOT EXISTS "address"                 TEXT;
ALTER TABLE "crm_leads" ADD COLUMN IF NOT EXISTS "expected_revenue"        DOUBLE PRECISION;
ALTER TABLE "crm_leads" ADD COLUMN IF NOT EXISTS "expected_closing_date"   TIMESTAMP(3);
ALTER TABLE "crm_leads" ADD COLUMN IF NOT EXISTS "sales_team"              TEXT;
ALTER TABLE "crm_leads" ADD COLUMN IF NOT EXISTS "contact_person"          TEXT;
ALTER TABLE "crm_leads" ADD COLUMN IF NOT EXISTS "branch_id"               TEXT;

-- ─── CRM Contacts ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "crm_contacts" (
    "id"            TEXT NOT NULL,
    "company_id"    TEXT NOT NULL,
    "first_name"    TEXT NOT NULL,
    "last_name"     TEXT,
    "full_name"     TEXT NOT NULL,
    "designation"   TEXT,
    "department"    TEXT,
    "email"         TEXT,
    "phone"         TEXT,
    "mobile"        TEXT,
    "whatsapp"      TEXT,
    "linkedin_url"  TEXT,
    "address"       TEXT,
    "city"          TEXT,
    "country"       TEXT,
    "contact_type"  TEXT NOT NULL DEFAULT 'Contact',
    "assigned_to_id" TEXT,
    "is_primary"    BOOLEAN NOT NULL DEFAULT false,
    "notes"         TEXT,
    "tags"          TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status"        TEXT NOT NULL DEFAULT 'Active',
    "custom_fields" JSONB DEFAULT '{}',
    "customer_id"   TEXT,
    "lead_id"       TEXT,
    "is_deleted"    BOOLEAN NOT NULL DEFAULT false,
    "created_by"    TEXT NOT NULL,
    "updated_by"    TEXT,
    "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "crm_contacts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "crm_contacts_company_id_idx"     ON "crm_contacts"("company_id");
CREATE INDEX IF NOT EXISTS "crm_contacts_email_idx"          ON "crm_contacts"("email");
CREATE INDEX IF NOT EXISTS "crm_contacts_customer_id_idx"    ON "crm_contacts"("customer_id");
CREATE INDEX IF NOT EXISTS "crm_contacts_lead_id_idx"        ON "crm_contacts"("lead_id");
CREATE INDEX IF NOT EXISTS "crm_contacts_assigned_to_id_idx" ON "crm_contacts"("assigned_to_id");
CREATE INDEX IF NOT EXISTS "crm_contacts_is_deleted_idx"     ON "crm_contacts"("is_deleted");

ALTER TABLE "crm_contacts" ADD CONSTRAINT "crm_contacts_company_id_fkey"
    FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "crm_contacts" ADD CONSTRAINT "crm_contacts_assigned_to_id_fkey"
    FOREIGN KEY ("assigned_to_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "crm_contacts" ADD CONSTRAINT "crm_contacts_created_by_fkey"
    FOREIGN KEY ("created_by") REFERENCES "users"("id") ON UPDATE CASCADE;
ALTER TABLE "crm_contacts" ADD CONSTRAINT "crm_contacts_customer_id_fkey"
    FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "crm_contacts" ADD CONSTRAINT "crm_contacts_lead_id_fkey"
    FOREIGN KEY ("lead_id") REFERENCES "crm_leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── CRM Opportunities ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "crm_opportunities" (
    "id"                    TEXT NOT NULL,
    "company_id"            TEXT NOT NULL,
    "opportunity_number"    TEXT NOT NULL,
    "name"                  TEXT NOT NULL,
    "customer_id"           TEXT,
    "contact_id"            TEXT,
    "lead_id"               TEXT,
    "source"                TEXT,
    "type"                  TEXT,
    "assigned_to_id"        TEXT,
    "sales_team"            TEXT,
    "expected_revenue"      DOUBLE PRECISION NOT NULL DEFAULT 0,
    "probability"           INTEGER NOT NULL DEFAULT 10,
    "weighted_revenue"      DOUBLE PRECISION,
    "expected_closing_date" TIMESTAMP(3),
    "stage"                 TEXT NOT NULL DEFAULT 'Qualification',
    "description"           TEXT,
    "competitors"           TEXT,
    "notes"                 TEXT,
    "tags"                  TEXT[] DEFAULT ARRAY[]::TEXT[],
    "custom_fields"         JSONB DEFAULT '{}',
    "lost_reason"           TEXT,
    "won_reason"            TEXT,
    "quotation_id"          TEXT,
    "sales_order_id"        TEXT,
    "is_deleted"            BOOLEAN NOT NULL DEFAULT false,
    "created_by"            TEXT NOT NULL,
    "updated_by"            TEXT,
    "created_at"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "crm_opportunities_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "crm_opportunities_opportunity_number_key" ON "crm_opportunities"("opportunity_number");
CREATE INDEX IF NOT EXISTS "crm_opportunities_company_id_idx"      ON "crm_opportunities"("company_id");
CREATE INDEX IF NOT EXISTS "crm_opportunities_stage_idx"           ON "crm_opportunities"("stage");
CREATE INDEX IF NOT EXISTS "crm_opportunities_customer_id_idx"     ON "crm_opportunities"("customer_id");
CREATE INDEX IF NOT EXISTS "crm_opportunities_assigned_to_id_idx"  ON "crm_opportunities"("assigned_to_id");
CREATE INDEX IF NOT EXISTS "crm_opportunities_is_deleted_idx"      ON "crm_opportunities"("is_deleted");
CREATE INDEX IF NOT EXISTS "crm_opportunities_closing_date_idx"    ON "crm_opportunities"("expected_closing_date");

ALTER TABLE "crm_opportunities" ADD CONSTRAINT "crm_opportunities_company_id_fkey"
    FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "crm_opportunities" ADD CONSTRAINT "crm_opportunities_assigned_to_id_fkey"
    FOREIGN KEY ("assigned_to_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "crm_opportunities" ADD CONSTRAINT "crm_opportunities_created_by_fkey"
    FOREIGN KEY ("created_by") REFERENCES "users"("id") ON UPDATE CASCADE;
ALTER TABLE "crm_opportunities" ADD CONSTRAINT "crm_opportunities_customer_id_fkey"
    FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "crm_opportunities" ADD CONSTRAINT "crm_opportunities_contact_id_fkey"
    FOREIGN KEY ("contact_id") REFERENCES "crm_contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "crm_opportunities" ADD CONSTRAINT "crm_opportunities_lead_id_fkey"
    FOREIGN KEY ("lead_id") REFERENCES "crm_leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── CRM Activities ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "crm_activities" (
    "id"              TEXT NOT NULL,
    "company_id"      TEXT NOT NULL,
    "type"            TEXT NOT NULL,
    "subject"         TEXT NOT NULL,
    "description"     TEXT,
    "lead_id"         TEXT,
    "customer_id"     TEXT,
    "contact_id"      TEXT,
    "opportunity_id"  TEXT,
    "assigned_to_id"  TEXT,
    "start_at"        TIMESTAMP(3),
    "due_at"          TIMESTAMP(3),
    "duration_mins"   INTEGER,
    "priority"        TEXT NOT NULL DEFAULT 'Medium',
    "status"          TEXT NOT NULL DEFAULT 'Open',
    "outcome"         TEXT,
    "reminder_at"     TIMESTAMP(3),
    "created_by"      TEXT NOT NULL,
    "updated_by"      TEXT,
    "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "crm_activities_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "crm_activities_company_id_idx"     ON "crm_activities"("company_id");
CREATE INDEX IF NOT EXISTS "crm_activities_lead_id_idx"        ON "crm_activities"("lead_id");
CREATE INDEX IF NOT EXISTS "crm_activities_customer_id_idx"    ON "crm_activities"("customer_id");
CREATE INDEX IF NOT EXISTS "crm_activities_contact_id_idx"     ON "crm_activities"("contact_id");
CREATE INDEX IF NOT EXISTS "crm_activities_opportunity_id_idx" ON "crm_activities"("opportunity_id");
CREATE INDEX IF NOT EXISTS "crm_activities_assigned_to_id_idx" ON "crm_activities"("assigned_to_id");
CREATE INDEX IF NOT EXISTS "crm_activities_status_idx"         ON "crm_activities"("status");
CREATE INDEX IF NOT EXISTS "crm_activities_due_at_idx"         ON "crm_activities"("due_at");

ALTER TABLE "crm_activities" ADD CONSTRAINT "crm_activities_company_id_fkey"
    FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "crm_activities" ADD CONSTRAINT "crm_activities_assigned_to_id_fkey"
    FOREIGN KEY ("assigned_to_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "crm_activities" ADD CONSTRAINT "crm_activities_created_by_fkey"
    FOREIGN KEY ("created_by") REFERENCES "users"("id") ON UPDATE CASCADE;
ALTER TABLE "crm_activities" ADD CONSTRAINT "crm_activities_lead_id_fkey"
    FOREIGN KEY ("lead_id") REFERENCES "crm_leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "crm_activities" ADD CONSTRAINT "crm_activities_customer_id_fkey"
    FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "crm_activities" ADD CONSTRAINT "crm_activities_contact_id_fkey"
    FOREIGN KEY ("contact_id") REFERENCES "crm_contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "crm_activities" ADD CONSTRAINT "crm_activities_opportunity_id_fkey"
    FOREIGN KEY ("opportunity_id") REFERENCES "crm_opportunities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── CRM Tasks ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "crm_tasks" (
    "id"              TEXT NOT NULL,
    "company_id"      TEXT NOT NULL,
    "title"           TEXT NOT NULL,
    "description"     TEXT,
    "lead_id"         TEXT,
    "customer_id"     TEXT,
    "contact_id"      TEXT,
    "opportunity_id"  TEXT,
    "assigned_to_id"  TEXT,
    "due_at"          TIMESTAMP(3),
    "priority"        TEXT NOT NULL DEFAULT 'Medium',
    "status"          TEXT NOT NULL DEFAULT 'Open',
    "checklist"       JSONB DEFAULT '[]',
    "reminder_at"     TIMESTAMP(3),
    "is_deleted"      BOOLEAN NOT NULL DEFAULT false,
    "created_by"      TEXT NOT NULL,
    "updated_by"      TEXT,
    "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "crm_tasks_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "crm_tasks_company_id_idx"     ON "crm_tasks"("company_id");
CREATE INDEX IF NOT EXISTS "crm_tasks_lead_id_idx"        ON "crm_tasks"("lead_id");
CREATE INDEX IF NOT EXISTS "crm_tasks_customer_id_idx"    ON "crm_tasks"("customer_id");
CREATE INDEX IF NOT EXISTS "crm_tasks_assigned_to_id_idx" ON "crm_tasks"("assigned_to_id");
CREATE INDEX IF NOT EXISTS "crm_tasks_status_idx"         ON "crm_tasks"("status");
CREATE INDEX IF NOT EXISTS "crm_tasks_due_at_idx"         ON "crm_tasks"("due_at");
CREATE INDEX IF NOT EXISTS "crm_tasks_is_deleted_idx"     ON "crm_tasks"("is_deleted");

ALTER TABLE "crm_tasks" ADD CONSTRAINT "crm_tasks_company_id_fkey"
    FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "crm_tasks" ADD CONSTRAINT "crm_tasks_assigned_to_id_fkey"
    FOREIGN KEY ("assigned_to_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "crm_tasks" ADD CONSTRAINT "crm_tasks_created_by_fkey"
    FOREIGN KEY ("created_by") REFERENCES "users"("id") ON UPDATE CASCADE;
ALTER TABLE "crm_tasks" ADD CONSTRAINT "crm_tasks_lead_id_fkey"
    FOREIGN KEY ("lead_id") REFERENCES "crm_leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "crm_tasks" ADD CONSTRAINT "crm_tasks_customer_id_fkey"
    FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "crm_tasks" ADD CONSTRAINT "crm_tasks_contact_id_fkey"
    FOREIGN KEY ("contact_id") REFERENCES "crm_contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "crm_tasks" ADD CONSTRAINT "crm_tasks_opportunity_id_fkey"
    FOREIGN KEY ("opportunity_id") REFERENCES "crm_opportunities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── CRM Campaigns ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "crm_campaigns" (
    "id"                TEXT NOT NULL,
    "company_id"        TEXT NOT NULL,
    "name"              TEXT NOT NULL,
    "type"              TEXT NOT NULL DEFAULT 'Email',
    "status"            TEXT NOT NULL DEFAULT 'Draft',
    "start_date"        TIMESTAMP(3),
    "end_date"          TIMESTAMP(3),
    "budget"            DOUBLE PRECISION,
    "expected_revenue"  DOUBLE PRECISION,
    "actual_revenue"    DOUBLE PRECISION,
    "target_audience"   TEXT,
    "source_id"         TEXT,
    "description"       TEXT,
    "assigned_user_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "is_deleted"        BOOLEAN NOT NULL DEFAULT false,
    "created_by"        TEXT NOT NULL,
    "updated_by"        TEXT,
    "created_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "crm_campaigns_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "crm_campaigns_company_id_idx" ON "crm_campaigns"("company_id");
CREATE INDEX IF NOT EXISTS "crm_campaigns_status_idx"     ON "crm_campaigns"("status");
CREATE INDEX IF NOT EXISTS "crm_campaigns_is_deleted_idx" ON "crm_campaigns"("is_deleted");

ALTER TABLE "crm_campaigns" ADD CONSTRAINT "crm_campaigns_company_id_fkey"
    FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── CRM Tags ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "crm_tags" (
    "id"         TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "name"       TEXT NOT NULL,
    "color"      TEXT NOT NULL DEFAULT '#6b7280',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "crm_tags_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "crm_tags_company_id_name_key" ON "crm_tags"("company_id", "name");
CREATE INDEX IF NOT EXISTS "crm_tags_company_id_idx"            ON "crm_tags"("company_id");

ALTER TABLE "crm_tags" ADD CONSTRAINT "crm_tags_company_id_fkey"
    FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── CRM Custom Fields ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "crm_custom_fields" (
    "id"            TEXT NOT NULL,
    "company_id"    TEXT NOT NULL,
    "entity_type"   TEXT NOT NULL,
    "field_key"     TEXT NOT NULL,
    "field_name"    TEXT NOT NULL,
    "field_type"    TEXT NOT NULL,
    "options"       JSONB DEFAULT '[]',
    "is_required"   BOOLEAN NOT NULL DEFAULT false,
    "is_visible"    BOOLEAN NOT NULL DEFAULT true,
    "sort_order"    INTEGER NOT NULL DEFAULT 0,
    "default_value" TEXT,
    "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "crm_custom_fields_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "crm_custom_fields_company_entity_key_key"
    ON "crm_custom_fields"("company_id", "entity_type", "field_key");
CREATE INDEX IF NOT EXISTS "crm_custom_fields_company_entity_idx"
    ON "crm_custom_fields"("company_id", "entity_type");

ALTER TABLE "crm_custom_fields" ADD CONSTRAINT "crm_custom_fields_company_id_fkey"
    FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
