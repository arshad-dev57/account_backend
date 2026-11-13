-- Quotation CRM links
ALTER TABLE "quotations" ADD COLUMN IF NOT EXISTS "lead_id" TEXT;
ALTER TABLE "quotations" ADD COLUMN IF NOT EXISTS "opportunity_id" TEXT;
CREATE INDEX IF NOT EXISTS "quotations_lead_id_idx" ON "quotations"("lead_id");
CREATE INDEX IF NOT EXISTS "quotations_opportunity_id_idx" ON "quotations"("opportunity_id");

CREATE TABLE IF NOT EXISTS "crm_territories" (
  "id" TEXT NOT NULL, "company_id" TEXT NOT NULL, "name" TEXT NOT NULL, "parent_id" TEXT,
  "is_active" BOOLEAN NOT NULL DEFAULT true, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "crm_territories_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "crm_territories_company_id_name_key" ON "crm_territories"("company_id","name");
CREATE INDEX IF NOT EXISTS "crm_territories_company_id_idx" ON "crm_territories"("company_id");

CREATE TABLE IF NOT EXISTS "crm_customer_groups" (
  "id" TEXT NOT NULL, "company_id" TEXT NOT NULL, "name" TEXT NOT NULL, "parent_id" TEXT,
  "is_active" BOOLEAN NOT NULL DEFAULT true, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "crm_customer_groups_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "crm_customer_groups_company_id_name_key" ON "crm_customer_groups"("company_id","name");
CREATE INDEX IF NOT EXISTS "crm_customer_groups_company_id_idx" ON "crm_customer_groups"("company_id");

CREATE TABLE IF NOT EXISTS "crm_prospects" (
  "id" TEXT NOT NULL, "company_id" TEXT NOT NULL, "company_name" TEXT NOT NULL,
  "customer_group" TEXT, "no_of_employees" TEXT, "annual_revenue" DOUBLE PRECISION,
  "market_segment" TEXT, "industry" TEXT, "territory" TEXT, "website" TEXT, "fax" TEXT,
  "prospect_owner_id" TEXT, "notes" TEXT, "is_deleted" BOOLEAN NOT NULL DEFAULT false,
  "created_by" TEXT NOT NULL, "updated_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "crm_prospects_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "crm_prospects_company_id_company_name_key" ON "crm_prospects"("company_id","company_name");
CREATE INDEX IF NOT EXISTS "crm_prospects_company_id_idx" ON "crm_prospects"("company_id");

CREATE TABLE IF NOT EXISTS "crm_prospect_leads" (
  "id" TEXT NOT NULL, "prospect_id" TEXT NOT NULL, "lead_id" TEXT NOT NULL,
  CONSTRAINT "crm_prospect_leads_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "crm_prospect_leads_prospect_id_lead_id_key" ON "crm_prospect_leads"("prospect_id","lead_id");
CREATE INDEX IF NOT EXISTS "crm_prospect_leads_lead_id_idx" ON "crm_prospect_leads"("lead_id");

CREATE TABLE IF NOT EXISTS "crm_prospect_opportunities" (
  "id" TEXT NOT NULL, "prospect_id" TEXT NOT NULL, "opportunity_id" TEXT NOT NULL,
  CONSTRAINT "crm_prospect_opportunities_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "crm_prospect_opportunities_prospect_id_opportunity_id_key" ON "crm_prospect_opportunities"("prospect_id","opportunity_id");
CREATE INDEX IF NOT EXISTS "crm_prospect_opportunities_opportunity_id_idx" ON "crm_prospect_opportunities"("opportunity_id");

CREATE TABLE IF NOT EXISTS "crm_appointments" (
  "id" TEXT NOT NULL, "company_id" TEXT NOT NULL, "scheduled_time" TIMESTAMP(3) NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'Open', "customer_name" TEXT NOT NULL,
  "customer_email" TEXT, "customer_phone" TEXT, "skype" TEXT, "details" TEXT,
  "appointment_with" TEXT, "party_id" TEXT, "lead_id" TEXT, "customer_id" TEXT, "opportunity_id" TEXT,
  "assigned_to_id" TEXT, "is_deleted" BOOLEAN NOT NULL DEFAULT false,
  "created_by" TEXT NOT NULL, "updated_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "crm_appointments_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "crm_appointments_company_id_idx" ON "crm_appointments"("company_id");
CREATE INDEX IF NOT EXISTS "crm_appointments_scheduled_time_idx" ON "crm_appointments"("scheduled_time");

CREATE TABLE IF NOT EXISTS "crm_contracts" (
  "id" TEXT NOT NULL, "company_id" TEXT NOT NULL, "contract_number" TEXT NOT NULL,
  "party_type" TEXT NOT NULL DEFAULT 'Customer', "party_name" TEXT NOT NULL, "party_id" TEXT,
  "status" TEXT NOT NULL DEFAULT 'Unsigned', "fulfilment_status" TEXT NOT NULL DEFAULT 'N/A',
  "start_date" TIMESTAMP(3), "end_date" TIMESTAMP(3), "signed_on" TIMESTAMP(3), "signee" TEXT,
  "is_signed" BOOLEAN NOT NULL DEFAULT false, "contract_template" TEXT, "contract_terms" TEXT,
  "fulfilment_terms" TEXT, "fulfilment_deadline" TIMESTAMP(3),
  "document_type" TEXT, "document_name" TEXT, "notes" TEXT,
  "is_deleted" BOOLEAN NOT NULL DEFAULT false, "created_by" TEXT NOT NULL, "updated_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "crm_contracts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "crm_contracts_company_id_contract_number_key" ON "crm_contracts"("company_id","contract_number");
CREATE INDEX IF NOT EXISTS "crm_contracts_company_id_idx" ON "crm_contracts"("company_id");

CREATE TABLE IF NOT EXISTS "crm_settings" (
  "id" TEXT NOT NULL, "company_id" TEXT NOT NULL,
  "campaign_naming_by" TEXT NOT NULL DEFAULT 'Campaign Name',
  "allow_lead_duplication_based_on_email" BOOLEAN NOT NULL DEFAULT false,
  "auto_creation_of_contact" BOOLEAN NOT NULL DEFAULT true,
  "close_opportunity_after_days" INTEGER NOT NULL DEFAULT 15,
  "enable_opportunity_from_contact_us" BOOLEAN NOT NULL DEFAULT false,
  "default_quotation_valid_till_days" INTEGER NOT NULL DEFAULT 30,
  "carry_forward_communication" BOOLEAN NOT NULL DEFAULT true,
  "update_timestamp_on_new_communication" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "crm_settings_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "crm_settings_company_id_key" ON "crm_settings"("company_id");

CREATE TABLE IF NOT EXISTS "crm_email_campaigns" (
  "id" TEXT NOT NULL, "company_id" TEXT NOT NULL, "name" TEXT NOT NULL, "campaign_id" TEXT,
  "email_campaign_for" TEXT NOT NULL DEFAULT 'Lead', "recipient_id" TEXT, "sender_id" TEXT,
  "start_date" TIMESTAMP(3) NOT NULL, "end_date" TIMESTAMP(3),
  "status" TEXT NOT NULL DEFAULT 'Scheduled', "notes" TEXT,
  "is_deleted" BOOLEAN NOT NULL DEFAULT false, "created_by" TEXT NOT NULL, "updated_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "crm_email_campaigns_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "crm_email_campaigns_company_id_idx" ON "crm_email_campaigns"("company_id");

CREATE TABLE IF NOT EXISTS "crm_lost_reasons" (
  "id" TEXT NOT NULL, "company_id" TEXT NOT NULL, "name" TEXT NOT NULL,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "crm_lost_reasons_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "crm_lost_reasons_company_id_name_key" ON "crm_lost_reasons"("company_id","name");

CREATE TABLE IF NOT EXISTS "crm_competitors" (
  "id" TEXT NOT NULL, "company_id" TEXT NOT NULL, "name" TEXT NOT NULL, "website" TEXT,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "crm_competitors_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "crm_competitors_company_id_name_key" ON "crm_competitors"("company_id","name");

DO $$ BEGIN ALTER TABLE "quotations" ADD CONSTRAINT "quotations_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "crm_leads"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "quotations" ADD CONSTRAINT "quotations_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "crm_opportunities"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "crm_territories" ADD CONSTRAINT "crm_territories_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "crm_territories" ADD CONSTRAINT "crm_territories_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "crm_territories"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "crm_customer_groups" ADD CONSTRAINT "crm_customer_groups_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "crm_customer_groups" ADD CONSTRAINT "crm_customer_groups_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "crm_customer_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "crm_prospects" ADD CONSTRAINT "crm_prospects_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "crm_prospects" ADD CONSTRAINT "crm_prospects_prospect_owner_id_fkey" FOREIGN KEY ("prospect_owner_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "crm_prospects" ADD CONSTRAINT "crm_prospects_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "crm_prospect_leads" ADD CONSTRAINT "crm_prospect_leads_prospect_id_fkey" FOREIGN KEY ("prospect_id") REFERENCES "crm_prospects"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "crm_prospect_leads" ADD CONSTRAINT "crm_prospect_leads_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "crm_leads"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "crm_prospect_opportunities" ADD CONSTRAINT "crm_prospect_opportunities_prospect_id_fkey" FOREIGN KEY ("prospect_id") REFERENCES "crm_prospects"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "crm_prospect_opportunities" ADD CONSTRAINT "crm_prospect_opportunities_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "crm_opportunities"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "crm_appointments" ADD CONSTRAINT "crm_appointments_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "crm_appointments" ADD CONSTRAINT "crm_appointments_assigned_to_id_fkey" FOREIGN KEY ("assigned_to_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "crm_appointments" ADD CONSTRAINT "crm_appointments_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "crm_contracts" ADD CONSTRAINT "crm_contracts_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "crm_contracts" ADD CONSTRAINT "crm_contracts_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "crm_settings" ADD CONSTRAINT "crm_settings_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "crm_email_campaigns" ADD CONSTRAINT "crm_email_campaigns_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "crm_email_campaigns" ADD CONSTRAINT "crm_email_campaigns_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "crm_lost_reasons" ADD CONSTRAINT "crm_lost_reasons_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "crm_competitors" ADD CONSTRAINT "crm_competitors_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
