-- Additive ERPNext CRM parity (no drops)

-- Lead ERPNext fields
ALTER TABLE "crm_leads" ALTER COLUMN "status" SET DEFAULT 'Lead';
ALTER TABLE "crm_leads" ADD COLUMN IF NOT EXISTS "salutation" TEXT;
ALTER TABLE "crm_leads" ADD COLUMN IF NOT EXISTS "middle_name" TEXT;
ALTER TABLE "crm_leads" ADD COLUMN IF NOT EXISTS "gender" TEXT;
ALTER TABLE "crm_leads" ADD COLUMN IF NOT EXISTS "job_title" TEXT;
ALTER TABLE "crm_leads" ADD COLUMN IF NOT EXISTS "phone_ext" TEXT;
ALTER TABLE "crm_leads" ADD COLUMN IF NOT EXISTS "request_type" TEXT;
ALTER TABLE "crm_leads" ADD COLUMN IF NOT EXISTS "no_of_employees" TEXT;
ALTER TABLE "crm_leads" ADD COLUMN IF NOT EXISTS "annual_revenue" DOUBLE PRECISION;
ALTER TABLE "crm_leads" ADD COLUMN IF NOT EXISTS "market_segment" TEXT;
ALTER TABLE "crm_leads" ADD COLUMN IF NOT EXISTS "fax" TEXT;
ALTER TABLE "crm_leads" ADD COLUMN IF NOT EXISTS "qualification_status" TEXT;
ALTER TABLE "crm_leads" ADD COLUMN IF NOT EXISTS "qualified_by" TEXT;
ALTER TABLE "crm_leads" ADD COLUMN IF NOT EXISTS "qualified_on" TIMESTAMP(3);
ALTER TABLE "crm_leads" ADD COLUMN IF NOT EXISTS "campaign_name" TEXT;
ALTER TABLE "crm_leads" ADD COLUMN IF NOT EXISTS "language" TEXT;
ALTER TABLE "crm_leads" ADD COLUMN IF NOT EXISTS "disabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "crm_leads" ADD COLUMN IF NOT EXISTS "unsubscribed" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "crm_leads" ADD COLUMN IF NOT EXISTS "blog_subscriber" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "crm_leads" ADD COLUMN IF NOT EXISTS "from_customer_id" TEXT;

-- Opportunity ERPNext fields
ALTER TABLE "crm_opportunities" ALTER COLUMN "probability" SET DEFAULT 100;
ALTER TABLE "crm_opportunities" ALTER COLUMN "stage" SET DEFAULT 'Prospecting';
ALTER TABLE "crm_opportunities" ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'Open';
ALTER TABLE "crm_opportunities" ADD COLUMN IF NOT EXISTS "opportunity_from" TEXT;
ALTER TABLE "crm_opportunities" ADD COLUMN IF NOT EXISTS "currency" TEXT DEFAULT 'PKR';
ALTER TABLE "crm_opportunities" ADD COLUMN IF NOT EXISTS "transaction_date" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "crm_opportunities" ADD COLUMN IF NOT EXISTS "no_of_employees" TEXT;
ALTER TABLE "crm_opportunities" ADD COLUMN IF NOT EXISTS "annual_revenue" DOUBLE PRECISION;
ALTER TABLE "crm_opportunities" ADD COLUMN IF NOT EXISTS "customer_group" TEXT;
ALTER TABLE "crm_opportunities" ADD COLUMN IF NOT EXISTS "industry" TEXT;
ALTER TABLE "crm_opportunities" ADD COLUMN IF NOT EXISTS "market_segment" TEXT;
ALTER TABLE "crm_opportunities" ADD COLUMN IF NOT EXISTS "website" TEXT;
ALTER TABLE "crm_opportunities" ADD COLUMN IF NOT EXISTS "city" TEXT;
ALTER TABLE "crm_opportunities" ADD COLUMN IF NOT EXISTS "state" TEXT;
ALTER TABLE "crm_opportunities" ADD COLUMN IF NOT EXISTS "country" TEXT;
ALTER TABLE "crm_opportunities" ADD COLUMN IF NOT EXISTS "territory" TEXT;
ALTER TABLE "crm_opportunities" ADD COLUMN IF NOT EXISTS "campaign" TEXT;
ALTER TABLE "crm_opportunities" ADD COLUMN IF NOT EXISTS "customer_name" TEXT;
ALTER TABLE "crm_opportunities" ADD COLUMN IF NOT EXISTS "contact_person" TEXT;
ALTER TABLE "crm_opportunities" ADD COLUMN IF NOT EXISTS "contact_email" TEXT;
ALTER TABLE "crm_opportunities" ADD COLUMN IF NOT EXISTS "contact_mobile" TEXT;
ALTER TABLE "crm_opportunities" ADD COLUMN IF NOT EXISTS "whatsapp" TEXT;
ALTER TABLE "crm_opportunities" ADD COLUMN IF NOT EXISTS "phone" TEXT;
ALTER TABLE "crm_opportunities" ADD COLUMN IF NOT EXISTS "phone_ext" TEXT;
ALTER TABLE "crm_opportunities" ADD COLUMN IF NOT EXISTS "job_title" TEXT;

-- Masters
CREATE TABLE IF NOT EXISTS "crm_sales_stages" (
  "id" TEXT NOT NULL,
  "company_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "crm_sales_stages_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "crm_sales_stages_company_id_name_key" ON "crm_sales_stages"("company_id", "name");
CREATE INDEX IF NOT EXISTS "crm_sales_stages_company_id_sort_order_idx" ON "crm_sales_stages"("company_id", "sort_order");

CREATE TABLE IF NOT EXISTS "crm_opportunity_types" (
  "id" TEXT NOT NULL,
  "company_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "crm_opportunity_types_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "crm_opportunity_types_company_id_name_key" ON "crm_opportunity_types"("company_id", "name");
CREATE INDEX IF NOT EXISTS "crm_opportunity_types_company_id_idx" ON "crm_opportunity_types"("company_id");

CREATE TABLE IF NOT EXISTS "crm_market_segments" (
  "id" TEXT NOT NULL,
  "company_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "crm_market_segments_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "crm_market_segments_company_id_name_key" ON "crm_market_segments"("company_id", "name");
CREATE INDEX IF NOT EXISTS "crm_market_segments_company_id_idx" ON "crm_market_segments"("company_id");

DO $$ BEGIN
  ALTER TABLE "crm_sales_stages" ADD CONSTRAINT "crm_sales_stages_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "crm_opportunity_types" ADD CONSTRAINT "crm_opportunity_types_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "crm_market_segments" ADD CONSTRAINT "crm_market_segments_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
