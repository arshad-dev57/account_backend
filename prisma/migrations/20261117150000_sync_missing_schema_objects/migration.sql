-- Sync missing schema objects on databases that were maintained via migrations
-- (tables/columns/indexes that previously only existed on dev DBs via `prisma db push`).
-- Generated from: prisma migrate diff --from-url <prod> --to-schema-datamodel prisma/schema.prisma

-- Re-apply changed foreign keys (drop old definition first)
ALTER TABLE "credit_notes" DROP CONSTRAINT "credit_notes_original_invoice_id_fkey";
ALTER TABLE "crm_activities" DROP CONSTRAINT "crm_activities_created_by_fkey";
ALTER TABLE "crm_contacts" DROP CONSTRAINT "crm_contacts_created_by_fkey";
ALTER TABLE "crm_opportunities" DROP CONSTRAINT "crm_opportunities_created_by_fkey";
ALTER TABLE "crm_tasks" DROP CONSTRAINT "crm_tasks_created_by_fkey";
ALTER TABLE "kitchen_stations" DROP CONSTRAINT "kitchen_stations_company_id_fkey";
ALTER TABLE "manufacturing_quality_inspections" DROP CONSTRAINT "manufacturing_quality_inspections_inspector_id_fkey";
ALTER TABLE "manufacturing_work_orders" DROP CONSTRAINT "manufacturing_work_orders_work_center_id_fkey";
ALTER TABLE "payments_made" DROP CONSTRAINT "payments_made_bill_id_fkey";
ALTER TABLE "pos_sale_items" DROP CONSTRAINT "pos_sale_items_product_id_fkey";
ALTER TABLE "purchase_return_items" DROP CONSTRAINT "purchase_return_items_purchase_invoice_id_fkey";
ALTER TABLE "purchase_returns" DROP CONSTRAINT "purchase_returns_purchase_invoice_id_fkey";

-- AlterTable
ALTER TABLE "bank_reconciliations" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "bank_statement_imports" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "bank_statement_transactions" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "budgets" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "categories" ADD COLUMN     "main_image" TEXT;

-- AlterTable
ALTER TABLE "company_business_configs" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "company_memberships" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "crm_activities" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "crm_campaigns" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "crm_contacts" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "crm_contracts" DROP COLUMN "party_type",
ADD COLUMN     "partyType" TEXT NOT NULL DEFAULT 'Customer';

-- AlterTable
ALTER TABLE "crm_custom_fields" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "crm_leads" ALTER COLUMN "country" DROP NOT NULL,
ALTER COLUMN "currency" DROP NOT NULL,
ALTER COLUMN "custom_fields" DROP NOT NULL;

-- AlterTable
ALTER TABLE "crm_opportunities" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "crm_tags" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "crm_tasks" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "currencies" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "delivery_items" ALTER COLUMN "ordered_quantity" SET DATA TYPE DOUBLE PRECISION,
ALTER COLUMN "delivered_quantity" SET DEFAULT 0,
ALTER COLUMN "delivered_quantity" SET DATA TYPE DOUBLE PRECISION,
ALTER COLUMN "remaining_quantity" SET DATA TYPE DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "exchange_rates" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "goods_receiving_items" ALTER COLUMN "ordered_quantity" SET DATA TYPE DOUBLE PRECISION,
ALTER COLUMN "previously_received_qty" SET DEFAULT 0,
ALTER COLUMN "previously_received_qty" SET DATA TYPE DOUBLE PRECISION,
ALTER COLUMN "remaining_quantity" SET DATA TYPE DOUBLE PRECISION,
ALTER COLUMN "receiving_quantity" SET DATA TYPE DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "hr_approvals" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "hr_attendance_corrections" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "hr_bonuses" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "hr_departments" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "hr_designations" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "hr_documents" ADD COLUMN     "cloudinary_public_id" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "document_number" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "file_name" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "file_size" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "file_url" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "issue_date" DATE,
ADD COLUMN     "issuing_authority" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "mime_type" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "notes" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "previous_version_id" TEXT,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'Uploaded',
ADD COLUMN     "verified_at" TIMESTAMP(3),
ADD COLUMN     "verified_by" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "hr_feedbacks" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "hr_genders" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "hr_goals" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "hr_holiday_list_assignments" ADD COLUMN     "assigned_to_company_id" TEXT NOT NULL DEFAULT '',
ALTER COLUMN "assigned_to_id" SET DEFAULT '';

-- AlterTable
ALTER TABLE "hr_holiday_lists" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "hr_holidays" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "hr_leave_types" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "hr_loans" ADD COLUMN     "approved_at" TIMESTAMP(3),
ADD COLUMN     "approved_by" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "disbursed_at" TIMESTAMP(3),
ADD COLUMN     "repayment_status" TEXT NOT NULL DEFAULT 'Pending',
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "hr_salutations" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "hr_shift_swaps" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "hr_shifts" ALTER COLUMN "updated_at" DROP DEFAULT,
ALTER COLUMN "enable_early_exit_marking" SET DEFAULT false,
ALTER COLUMN "enable_late_entry_marking" SET DEFAULT false,
ALTER COLUMN "first_checkin_threshold_minutes" SET DEFAULT 60,
ALTER COLUMN "last_checkout_threshold_minutes" SET DEFAULT 60;

-- AlterTable
ALTER TABLE "import_carriers" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "import_customs_clearance_lines" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "import_customs_clearances" ALTER COLUMN "clearance_status" SET DEFAULT 'Draft',
ALTER COLUMN "updated_at" DROP DEFAULT,
ALTER COLUMN "import_vat_rate_pct" SET NOT NULL,
ALTER COLUMN "exchange_rate_to_usd" SET NOT NULL,
ALTER COLUMN "penalties_usd" SET NOT NULL;

-- AlterTable
ALTER TABLE "import_documents" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "import_finance_lcs" ALTER COLUMN "status" SET DEFAULT 'Draft',
ALTER COLUMN "updated_at" DROP DEFAULT,
ALTER COLUMN "usance_days" SET NOT NULL,
ALTER COLUMN "exchange_rate_to_usd" SET NOT NULL,
ALTER COLUMN "lc_amount_base" SET NOT NULL;

-- AlterTable
ALTER TABLE "import_grns" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "import_hs_tariff_rates" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "import_landed_costs" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "import_ports" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "import_proforma_invoices" ALTER COLUMN "status" SET DEFAULT 'Draft',
ALTER COLUMN "updated_at" DROP DEFAULT,
ALTER COLUMN "credit_days" SET NOT NULL,
ALTER COLUMN "exchange_rate_to_usd" SET NOT NULL,
ALTER COLUMN "merchandise_subtotal" SET NOT NULL,
ALTER COLUMN "discount_total" SET NOT NULL,
ALTER COLUMN "tax_total" SET NOT NULL,
ALTER COLUMN "freight_estimate" SET NOT NULL,
ALTER COLUMN "insurance_estimate" SET NOT NULL,
ALTER COLUMN "other_charges_estimate" SET NOT NULL,
ALTER COLUMN "customs_duty_estimate" SET NOT NULL;

-- AlterTable
ALTER TABLE "import_purchase_orders" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "import_rfqs" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "import_settings" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "import_shipments" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "import_supplier_bills" ALTER COLUMN "status" SET DEFAULT 'Draft',
ALTER COLUMN "updated_at" DROP DEFAULT,
ALTER COLUMN "exchange_rate_to_usd" SET NOT NULL,
ALTER COLUMN "freight_amount" SET NOT NULL,
ALTER COLUMN "insurance_amount" SET NOT NULL,
ALTER COLUMN "duty_amount" SET NOT NULL,
ALTER COLUMN "other_charges" SET NOT NULL,
ALTER COLUMN "tax_total" SET NOT NULL,
ALTER COLUMN "discount_total" SET NOT NULL,
ALTER COLUMN "variance_amount" SET NOT NULL,
ALTER COLUMN "variance_percent" SET NOT NULL,
ALTER COLUMN "match_status" SET NOT NULL,
ALTER COLUMN "match_tolerance_pct" SET NOT NULL;

-- AlterTable
ALTER TABLE "import_supplier_claims" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "locations" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "manufacturing_bom_components" ADD COLUMN     "bom_no" TEXT,
ADD COLUMN     "do_not_explode" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "percentage" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "rate" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "source_warehouse" TEXT;

-- AlterTable
ALTER TABLE "manufacturing_bom_creators" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "manufacturing_bom_update_tools" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "manufacturing_boms" ADD COLUMN     "cost_allocation" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "cost_allocation_per" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "secondary_items" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "secondary_items_cost" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "set_rate_of_sub_assembly_item_based_on_bom" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "manufacturing_downtime_entries" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "manufacturing_item_lead_times" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "manufacturing_operations" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "manufacturing_plant_floors" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "manufacturing_production_plans" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "manufacturing_sales_forecasts" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "manufacturing_stock_entries" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "manufacturing_work_orders" ADD COLUMN     "backflush_from_wip_warehouse" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "bom_no" TEXT,
ADD COLUMN     "expected_end_date" TIMESTAMP(3),
ADD COLUMN     "expected_start_date" TIMESTAMP(3),
ADD COLUMN     "finished_good" TEXT,
ADD COLUMN     "for_job_card" TEXT,
ADD COLUMN     "for_operation" TEXT,
ADD COLUMN     "hour_rate" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "is_corrective_job_card" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "is_paused" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "is_subcontracted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "item_name" TEXT,
ADD COLUMN     "items" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "manufactured_qty" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "naming_series" TEXT NOT NULL DEFAULT 'PO-JOB.#####',
ADD COLUMN     "operation_row_id" INTEGER,
ADD COLUMN     "pending_qty" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "posting_date" TIMESTAMP(3),
ADD COLUMN     "production_item" TEXT,
ADD COLUMN     "project" TEXT,
ADD COLUMN     "quality_inspection" TEXT,
ADD COLUMN     "quality_inspection_template" TEXT,
ADD COLUMN     "requested_qty" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "scheduled_time_logs" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "secondary_items" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "semi_fg_bom" TEXT,
ADD COLUMN     "skip_material_transfer" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "source_warehouse" TEXT,
ADD COLUMN     "stock_uom" TEXT,
ADD COLUMN     "sub_operations" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "target_warehouse" TEXT,
ADD COLUMN     "time_logs" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "time_required" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "total_time_in_mins" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "track_semi_finished_goods" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "transferred_qty" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "wip_warehouse" TEXT,
ADD COLUMN     "workstation_type" TEXT,
ALTER COLUMN "sequence" SET DEFAULT 0,
ALTER COLUMN "work_center_id" DROP NOT NULL,
ALTER COLUMN "planned_quantity" SET DEFAULT 0,
ALTER COLUMN "status" SET DEFAULT 'Open';

-- AlterTable
ALTER TABLE "manufacturing_workstation_types" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "order_items" ALTER COLUMN "quantity" SET DATA TYPE DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "payments_made" ALTER COLUMN "bill_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "product_batches" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "product_stocks" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "product_units" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "item_type" TEXT NOT NULL DEFAULT 'READY_ITEM',
ADD COLUMN     "show_in_pos" BOOLEAN NOT NULL DEFAULT true,
ALTER COLUMN "current_stock" SET DEFAULT 0,
ALTER COLUMN "current_stock" SET DATA TYPE DOUBLE PRECISION,
ALTER COLUMN "minimum_stock" SET DEFAULT 5,
ALTER COLUMN "minimum_stock" SET DATA TYPE DOUBLE PRECISION,
ALTER COLUMN "maximum_stock" SET DEFAULT 100,
ALTER COLUMN "maximum_stock" SET DATA TYPE DOUBLE PRECISION,
ALTER COLUMN "opening_stock" SET DEFAULT 0,
ALTER COLUMN "opening_stock" SET DATA TYPE DOUBLE PRECISION,
ALTER COLUMN "reserved_stock" SET DEFAULT 0,
ALTER COLUMN "reserved_stock" SET DATA TYPE DOUBLE PRECISION,
ALTER COLUMN "available_stock" SET DEFAULT 0,
ALTER COLUMN "available_stock" SET DATA TYPE DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "purchase_installment_schedules" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "purchase_invoice_items" ALTER COLUMN "quantity" SET DATA TYPE DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "purchase_return_items" ADD COLUMN     "goods_receiving_id" TEXT,
ADD COLUMN     "goods_receiving_item_id" TEXT,
ADD COLUMN     "received_quantity" DOUBLE PRECISION DEFAULT 0,
ALTER COLUMN "purchase_invoice_id" DROP NOT NULL,
ALTER COLUMN "purchased_quantity" SET DEFAULT 0;

-- AlterTable
ALTER TABLE "purchase_returns" ADD COLUMN     "goods_receiving_id" TEXT,
ADD COLUMN     "grn_number" TEXT,
ALTER COLUMN "purchase_invoice_id" DROP NOT NULL,
ALTER COLUMN "purchase_invoice_number" DROP NOT NULL;

-- AlterTable
ALTER TABLE "restaurant_orders" ADD COLUMN     "stock_deducted_at" TIMESTAMP(3),
ADD COLUMN     "stock_deduction_key" TEXT,
ADD COLUMN     "wastage_posted_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "sales_installment_schedules" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "sales_invoice_items" ALTER COLUMN "quantity" SET DATA TYPE DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "salespersons" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "stock_movements" ALTER COLUMN "quantity" SET DATA TYPE DOUBLE PRECISION,
ALTER COLUMN "previous_stock" SET DATA TYPE DOUBLE PRECISION,
ALTER COLUMN "new_stock" SET DATA TYPE DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "tax_jurisdictions" ADD COLUMN     "is_default" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "textile_beams" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "textile_cone_winding_entries" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "textile_cones" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "textile_fabric_rolls" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "trading_customer_prices" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "trading_documents" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "trading_price_lists" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "user_permission_overrides" ALTER COLUMN "updated_at" DROP DEFAULT;

-- CreateTable
CREATE TABLE "recipes" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "menu_product_id" TEXT NOT NULL,
    "name" TEXT,
    "notes" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recipes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recipe_items" (
    "id" TEXT NOT NULL,
    "recipe_id" TEXT NOT NULL,
    "ingredient_product_id" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "uom" TEXT NOT NULL DEFAULT 'Pcs',
    "notes" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recipe_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_tax_profiles" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "country_code" TEXT NOT NULL DEFAULT 'US',
    "regime" TEXT NOT NULL DEFAULT 'SALES_TAX',
    "pricing_model" TEXT NOT NULL DEFAULT 'exclusive',
    "tax_registration_number" TEXT,
    "filing_frequency" TEXT NOT NULL DEFAULT 'quarterly',
    "default_jurisdiction_id" TEXT,
    "recover_input_tax" BOOLEAN NOT NULL DEFAULT true,
    "tax_enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "company_tax_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_print_settings" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "company_name" TEXT NOT NULL DEFAULT '',
    "company_address" TEXT NOT NULL DEFAULT '',
    "company_phone" TEXT NOT NULL DEFAULT '',
    "company_email" TEXT NOT NULL DEFAULT '',
    "company_website" TEXT NOT NULL DEFAULT '',
    "registration_no" TEXT NOT NULL DEFAULT '',
    "primary_logo" TEXT NOT NULL DEFAULT '',
    "secondary_logo" TEXT NOT NULL DEFAULT '',
    "official_stamp" TEXT NOT NULL DEFAULT '',
    "paper_size" TEXT NOT NULL DEFAULT 'A4',
    "orientation" TEXT NOT NULL DEFAULT 'portrait',
    "margin_top" INTEGER NOT NULL DEFAULT 15,
    "margin_bottom" INTEGER NOT NULL DEFAULT 15,
    "margin_left" INTEGER NOT NULL DEFAULT 15,
    "margin_right" INTEGER NOT NULL DEFAULT 15,
    "font_family" TEXT NOT NULL DEFAULT 'Inter',
    "primary_color" TEXT NOT NULL DEFAULT '#014582',
    "header_subtitle" TEXT NOT NULL DEFAULT '',
    "footer_text" TEXT NOT NULL DEFAULT 'Confidential HR Document - For Internal Use Only',
    "show_logo" BOOLEAN NOT NULL DEFAULT true,
    "show_stamp" BOOLEAN NOT NULL DEFAULT true,
    "show_page_numbers" BOOLEAN NOT NULL DEFAULT true,
    "show_footer" BOOLEAN NOT NULL DEFAULT true,
    "payslip_title" TEXT NOT NULL DEFAULT 'PAYSLIP STATEMENT',
    "show_earnings_breakdown" BOOLEAN NOT NULL DEFAULT true,
    "show_deductions_breakdown" BOOLEAN NOT NULL DEFAULT true,
    "show_attendance_summary" BOOLEAN NOT NULL DEFAULT true,
    "show_ytd_totals" BOOLEAN NOT NULL DEFAULT false,
    "payslip_notes" TEXT NOT NULL DEFAULT 'This is a computer-generated payslip. No physical signature required unless stamped.',
    "offer_prefix" TEXT NOT NULL DEFAULT 'OFR-',
    "offer_seq" INTEGER NOT NULL DEFAULT 1001,
    "appointment_prefix" TEXT NOT NULL DEFAULT 'APT-',
    "appointment_seq" INTEGER NOT NULL DEFAULT 1001,
    "salary_cert_prefix" TEXT NOT NULL DEFAULT 'SAL-',
    "salary_cert_seq" INTEGER NOT NULL DEFAULT 1001,
    "experience_prefix" TEXT NOT NULL DEFAULT 'EXP-',
    "experience_seq" INTEGER NOT NULL DEFAULT 1001,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hr_print_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_signatories" (
    "id" TEXT NOT NULL,
    "setting_id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "label" TEXT NOT NULL DEFAULT 'Authorized Signatory',
    "name" TEXT NOT NULL DEFAULT '',
    "designation" TEXT NOT NULL DEFAULT '',
    "signature_url" TEXT NOT NULL DEFAULT '',
    "stamp_url" TEXT NOT NULL DEFAULT '',
    "alignment" TEXT NOT NULL DEFAULT 'left',
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hr_signatories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_document_templates" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "template_type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "content_body" TEXT NOT NULL,
    "header_html" TEXT NOT NULL DEFAULT '',
    "footer_html" TEXT NOT NULL DEFAULT '',
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'Published',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hr_document_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_document_template_versions" (
    "id" TEXT NOT NULL,
    "template_id" TEXT NOT NULL,
    "version_number" INTEGER NOT NULL,
    "content_body" TEXT NOT NULL,
    "header_html" TEXT NOT NULL DEFAULT '',
    "footer_html" TEXT NOT NULL DEFAULT '',
    "created_by" TEXT NOT NULL DEFAULT '',
    "change_summary" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hr_document_template_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_generated_documents" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "employee_id" TEXT,
    "template_id" TEXT,
    "template_version_number" INTEGER NOT NULL DEFAULT 1,
    "document_type" TEXT NOT NULL,
    "document_number" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "snapshot_data_json" JSONB NOT NULL,
    "rendered_pdf_url" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'Generated',
    "generated_by" TEXT NOT NULL DEFAULT '',
    "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hr_generated_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "internal_transfers" (
    "id" TEXT NOT NULL,
    "transfer_number" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "transfer_date" TIMESTAMP(3) NOT NULL,
    "from_location_id" TEXT NOT NULL,
    "to_location_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "priority" TEXT NOT NULL DEFAULT 'Normal',
    "reference" TEXT,
    "reason" TEXT,
    "notes" TEXT,
    "created_by" TEXT NOT NULL,
    "updated_by" TEXT,
    "confirmed_by" TEXT,
    "confirmed_at" TIMESTAMP(3),
    "dispatched_by" TEXT,
    "dispatched_at" TIMESTAMP(3),
    "received_by" TEXT,
    "received_at" TIMESTAMP(3),
    "completed_by" TEXT,
    "completed_at" TIMESTAMP(3),
    "cancelled_by" TEXT,
    "cancelled_at" TIMESTAMP(3),
    "cancel_reason" TEXT,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "internal_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "internal_transfer_items" (
    "id" TEXT NOT NULL,
    "transfer_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "product_name" TEXT NOT NULL,
    "sku" TEXT NOT NULL DEFAULT '',
    "requested_qty" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "dispatched_qty" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "received_qty" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "unit" TEXT NOT NULL DEFAULT 'pcs',
    "batch_number" TEXT,
    "serial_number" TEXT,
    "notes" TEXT,

    CONSTRAINT "internal_transfer_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "internal_transfer_history" (
    "id" TEXT NOT NULL,
    "transfer_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "from_status" TEXT,
    "to_status" TEXT,
    "note" TEXT,
    "user_id" TEXT NOT NULL,
    "user_name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "internal_transfer_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_write_offs" (
    "id" TEXT NOT NULL,
    "write_off_number" TEXT NOT NULL,
    "write_off_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "reason" TEXT NOT NULL,
    "notes" TEXT,
    "total_cost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "company_id" TEXT NOT NULL,
    "location_id" TEXT NOT NULL,
    "fiscal_year_id" TEXT,
    "expense_account_id" TEXT,
    "journal_entry_id" TEXT,
    "created_by" TEXT NOT NULL,
    "submitted_by" TEXT,
    "approved_by" TEXT,
    "posted_by" TEXT,
    "posted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_write_offs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_write_off_items" (
    "id" TEXT NOT NULL,
    "write_off_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "product_name" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "batch_number" TEXT,
    "expiry_date" TIMESTAMP(3),
    "unit_of_measure" TEXT,
    "available_stock" DOUBLE PRECISION NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "unit_cost" DOUBLE PRECISION NOT NULL,
    "total_cost" DOUBLE PRECISION NOT NULL,
    "reason" TEXT,

    CONSTRAINT "stock_write_off_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_lead_custom_fields" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "field_key" TEXT NOT NULL,
    "field_name" TEXT NOT NULL,
    "field_type" TEXT NOT NULL,
    "description" TEXT,
    "default_value" TEXT,
    "placeholder" TEXT,
    "is_required" BOOLEAN NOT NULL DEFAULT false,
    "is_visible" BOOLEAN NOT NULL DEFAULT true,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "options" JSONB DEFAULT '[]',
    "width" INTEGER DEFAULT 160,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_lead_custom_fields_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_lead_boards" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "color" TEXT DEFAULT '#014582',
    "columns_config" JSONB DEFAULT '[]',
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_lead_boards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_lead_board_columns" (
    "id" TEXT NOT NULL,
    "board_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status_key" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#3b82f6',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_lead_board_columns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_lead_sources" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT DEFAULT '#10b981',
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_lead_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_lead_follow_ups" (
    "id" TEXT NOT NULL,
    "lead_id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "follow_up_date" TIMESTAMP(3) NOT NULL,
    "follow_up_time" TEXT,
    "type" TEXT NOT NULL DEFAULT 'Phone Call',
    "status" TEXT NOT NULL DEFAULT 'Pending',
    "notes" TEXT,
    "assigned_to_id" TEXT,
    "completed_at" TIMESTAMP(3),
    "completed_by_id" TEXT,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_lead_follow_ups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_lead_activities" (
    "id" TEXT NOT NULL,
    "lead_id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "metadata" JSONB,
    "user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_lead_activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_lead_import_jobs" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "file_type" TEXT NOT NULL,
    "file_size" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "total_rows" INTEGER NOT NULL DEFAULT 0,
    "imported_rows" INTEGER NOT NULL DEFAULT 0,
    "updated_rows" INTEGER NOT NULL DEFAULT 0,
    "skipped_duplicates" INTEGER NOT NULL DEFAULT 0,
    "failed_rows" INTEGER NOT NULL DEFAULT 0,
    "duplicateAction" TEXT NOT NULL DEFAULT 'SKIP',
    "mapping" JSONB,
    "errors" JSONB,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_lead_import_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_lead_import_mappings" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "template_name" TEXT NOT NULL,
    "file_type" TEXT,
    "mapping" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_lead_import_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_google_sheet_connections" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "google_account_email" TEXT NOT NULL,
    "access_token" TEXT NOT NULL,
    "refresh_token" TEXT,
    "token_expiry" TIMESTAMP(3),
    "spreadsheet_id" TEXT,
    "spreadsheet_name" TEXT,
    "sheet_name" TEXT,
    "sync_mode" TEXT NOT NULL DEFAULT 'ONE_TIME_IMPORT',
    "column_mapping" JSONB,
    "sync_interval_minutes" INTEGER NOT NULL DEFAULT 60,
    "last_sync_at" TIMESTAMP(3),
    "last_sync_status" TEXT,
    "last_sync_error" TEXT,
    "next_sync_at" TIMESTAMP(3),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_google_sheet_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_google_sheet_sync_jobs" (
    "id" TEXT NOT NULL,
    "connection_id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "sync_mode" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "imported_count" INTEGER NOT NULL DEFAULT 0,
    "updated_count" INTEGER NOT NULL DEFAULT 0,
    "failed_count" INTEGER NOT NULL DEFAULT 0,
    "error_message" TEXT,
    "sync_log" JSONB,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "crm_google_sheet_sync_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_lead_audit_logs" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "lead_id" TEXT,
    "action" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "details" JSONB,
    "ip_address" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_lead_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "recipes_menu_product_id_key" ON "recipes"("menu_product_id");

-- CreateIndex
CREATE INDEX "recipes_company_id_idx" ON "recipes"("company_id");

-- CreateIndex
CREATE INDEX "recipe_items_ingredient_product_id_idx" ON "recipe_items"("ingredient_product_id");

-- CreateIndex
CREATE UNIQUE INDEX "recipe_items_recipe_id_ingredient_product_id_key" ON "recipe_items"("recipe_id", "ingredient_product_id");

-- CreateIndex
CREATE UNIQUE INDEX "company_tax_profiles_company_id_key" ON "company_tax_profiles"("company_id");

-- CreateIndex
CREATE INDEX "company_tax_profiles_country_code_idx" ON "company_tax_profiles"("country_code");

-- CreateIndex
CREATE UNIQUE INDEX "hr_print_settings_company_id_key" ON "hr_print_settings"("company_id");

-- CreateIndex
CREATE INDEX "hr_signatories_company_id_idx" ON "hr_signatories"("company_id");

-- CreateIndex
CREATE INDEX "hr_signatories_setting_id_idx" ON "hr_signatories"("setting_id");

-- CreateIndex
CREATE INDEX "hr_document_templates_company_id_template_type_idx" ON "hr_document_templates"("company_id", "template_type");

-- CreateIndex
CREATE INDEX "hr_document_template_versions_template_id_idx" ON "hr_document_template_versions"("template_id");

-- CreateIndex
CREATE INDEX "hr_generated_documents_company_id_idx" ON "hr_generated_documents"("company_id");

-- CreateIndex
CREATE INDEX "hr_generated_documents_employee_id_idx" ON "hr_generated_documents"("employee_id");

-- CreateIndex
CREATE UNIQUE INDEX "internal_transfers_transfer_number_key" ON "internal_transfers"("transfer_number");

-- CreateIndex
CREATE INDEX "internal_transfers_company_id_idx" ON "internal_transfers"("company_id");

-- CreateIndex
CREATE INDEX "internal_transfers_from_location_id_idx" ON "internal_transfers"("from_location_id");

-- CreateIndex
CREATE INDEX "internal_transfers_to_location_id_idx" ON "internal_transfers"("to_location_id");

-- CreateIndex
CREATE INDEX "internal_transfers_status_idx" ON "internal_transfers"("status");

-- CreateIndex
CREATE INDEX "internal_transfers_created_at_idx" ON "internal_transfers"("created_at");

-- CreateIndex
CREATE INDEX "internal_transfer_items_transfer_id_idx" ON "internal_transfer_items"("transfer_id");

-- CreateIndex
CREATE INDEX "internal_transfer_items_product_id_idx" ON "internal_transfer_items"("product_id");

-- CreateIndex
CREATE INDEX "internal_transfer_history_transfer_id_idx" ON "internal_transfer_history"("transfer_id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_write_offs_write_off_number_key" ON "stock_write_offs"("write_off_number");

-- CreateIndex
CREATE UNIQUE INDEX "stock_write_offs_journal_entry_id_key" ON "stock_write_offs"("journal_entry_id");

-- CreateIndex
CREATE INDEX "stock_write_offs_company_id_idx" ON "stock_write_offs"("company_id");

-- CreateIndex
CREATE INDEX "stock_write_offs_location_id_idx" ON "stock_write_offs"("location_id");

-- CreateIndex
CREATE INDEX "stock_write_offs_status_idx" ON "stock_write_offs"("status");

-- CreateIndex
CREATE INDEX "stock_write_offs_write_off_date_idx" ON "stock_write_offs"("write_off_date");

-- CreateIndex
CREATE INDEX "stock_write_off_items_write_off_id_idx" ON "stock_write_off_items"("write_off_id");

-- CreateIndex
CREATE INDEX "stock_write_off_items_product_id_idx" ON "stock_write_off_items"("product_id");

-- CreateIndex
CREATE INDEX "crm_lead_custom_fields_company_id_sort_order_idx" ON "crm_lead_custom_fields"("company_id", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "crm_lead_custom_fields_company_id_field_key_key" ON "crm_lead_custom_fields"("company_id", "field_key");

-- CreateIndex
CREATE INDEX "crm_lead_boards_company_id_idx" ON "crm_lead_boards"("company_id");

-- CreateIndex
CREATE INDEX "crm_lead_board_columns_board_id_sort_order_idx" ON "crm_lead_board_columns"("board_id", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "crm_lead_board_columns_board_id_status_key_key" ON "crm_lead_board_columns"("board_id", "status_key");

-- CreateIndex
CREATE INDEX "crm_lead_sources_company_id_idx" ON "crm_lead_sources"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "crm_lead_sources_company_id_name_key" ON "crm_lead_sources"("company_id", "name");

-- CreateIndex
CREATE INDEX "crm_lead_follow_ups_company_id_idx" ON "crm_lead_follow_ups"("company_id");

-- CreateIndex
CREATE INDEX "crm_lead_follow_ups_lead_id_idx" ON "crm_lead_follow_ups"("lead_id");

-- CreateIndex
CREATE INDEX "crm_lead_follow_ups_status_idx" ON "crm_lead_follow_ups"("status");

-- CreateIndex
CREATE INDEX "crm_lead_follow_ups_follow_up_date_idx" ON "crm_lead_follow_ups"("follow_up_date");

-- CreateIndex
CREATE INDEX "crm_lead_activities_company_id_idx" ON "crm_lead_activities"("company_id");

-- CreateIndex
CREATE INDEX "crm_lead_activities_lead_id_idx" ON "crm_lead_activities"("lead_id");

-- CreateIndex
CREATE INDEX "crm_lead_activities_type_idx" ON "crm_lead_activities"("type");

-- CreateIndex
CREATE INDEX "crm_lead_activities_created_at_idx" ON "crm_lead_activities"("created_at");

-- CreateIndex
CREATE INDEX "crm_lead_import_jobs_company_id_idx" ON "crm_lead_import_jobs"("company_id");

-- CreateIndex
CREATE INDEX "crm_lead_import_jobs_status_idx" ON "crm_lead_import_jobs"("status");

-- CreateIndex
CREATE INDEX "crm_lead_import_mappings_company_id_idx" ON "crm_lead_import_mappings"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "crm_lead_import_mappings_company_id_template_name_key" ON "crm_lead_import_mappings"("company_id", "template_name");

-- CreateIndex
CREATE INDEX "crm_google_sheet_connections_company_id_idx" ON "crm_google_sheet_connections"("company_id");

-- CreateIndex
CREATE INDEX "crm_google_sheet_connections_is_active_idx" ON "crm_google_sheet_connections"("is_active");

-- CreateIndex
CREATE INDEX "crm_google_sheet_sync_jobs_connection_id_idx" ON "crm_google_sheet_sync_jobs"("connection_id");

-- CreateIndex
CREATE INDEX "crm_google_sheet_sync_jobs_company_id_idx" ON "crm_google_sheet_sync_jobs"("company_id");

-- CreateIndex
CREATE INDEX "crm_lead_audit_logs_company_id_idx" ON "crm_lead_audit_logs"("company_id");

-- CreateIndex
CREATE INDEX "crm_lead_audit_logs_lead_id_idx" ON "crm_lead_audit_logs"("lead_id");

-- CreateIndex
CREATE INDEX "crm_lead_audit_logs_user_id_idx" ON "crm_lead_audit_logs"("user_id");

-- CreateIndex
CREATE INDEX "crm_lead_audit_logs_action_created_at_idx" ON "crm_lead_audit_logs"("action", "created_at");

-- CreateIndex
CREATE INDEX "crm_appointments_status_idx" ON "crm_appointments"("status");

-- CreateIndex
CREATE INDEX "crm_appointments_is_deleted_idx" ON "crm_appointments"("is_deleted");

-- CreateIndex
CREATE INDEX "crm_competitors_company_id_idx" ON "crm_competitors"("company_id");

-- CreateIndex
CREATE INDEX "crm_contracts_status_idx" ON "crm_contracts"("status");

-- CreateIndex
CREATE INDEX "crm_contracts_is_deleted_idx" ON "crm_contracts"("is_deleted");

-- CreateIndex
CREATE INDEX "crm_email_campaigns_status_idx" ON "crm_email_campaigns"("status");

-- CreateIndex
CREATE INDEX "crm_email_campaigns_is_deleted_idx" ON "crm_email_campaigns"("is_deleted");

-- CreateIndex
CREATE INDEX "crm_leads_lead_number_idx" ON "crm_leads"("lead_number");

-- CreateIndex
CREATE INDEX "crm_lost_reasons_company_id_idx" ON "crm_lost_reasons"("company_id");

-- CreateIndex
CREATE INDEX "crm_prospects_is_deleted_idx" ON "crm_prospects"("is_deleted");

-- CreateIndex
CREATE INDEX "hr_attendance_corrections_company_id_status_idx" ON "hr_attendance_corrections"("company_id", "status");

-- CreateIndex
CREATE INDEX "hr_bonuses_company_id_status_idx" ON "hr_bonuses"("company_id", "status");

-- CreateIndex
CREATE INDEX "hr_documents_company_id_idx" ON "hr_documents"("company_id");

-- CreateIndex
CREATE INDEX "hr_documents_employee_id_idx" ON "hr_documents"("employee_id");

-- CreateIndex
CREATE INDEX "hr_feedbacks_company_id_employee_id_idx" ON "hr_feedbacks"("company_id", "employee_id");

-- CreateIndex
CREATE INDEX "hr_goals_company_id_employee_id_idx" ON "hr_goals"("company_id", "employee_id");

-- CreateIndex
CREATE INDEX "hr_leave_balances_company_id_idx" ON "hr_leave_balances"("company_id");

-- CreateIndex
CREATE INDEX "hr_lifecycle_events_company_id_employee_id_idx" ON "hr_lifecycle_events"("company_id", "employee_id");

-- CreateIndex
CREATE INDEX "hr_loans_company_id_status_idx" ON "hr_loans"("company_id", "status");

-- CreateIndex
CREATE INDEX "hr_shift_swaps_company_id_status_idx" ON "hr_shift_swaps"("company_id", "status");

-- CreateIndex
CREATE INDEX "products_item_type_idx" ON "products"("item_type");

-- CreateIndex
CREATE INDEX "products_show_in_pos_idx" ON "products"("show_in_pos");

-- CreateIndex
CREATE INDEX "purchase_return_items_goods_receiving_id_idx" ON "purchase_return_items"("goods_receiving_id");

-- CreateIndex
CREATE INDEX "purchase_return_items_goods_receiving_item_id_idx" ON "purchase_return_items"("goods_receiving_item_id");

-- CreateIndex
CREATE INDEX "purchase_returns_goods_receiving_id_idx" ON "purchase_returns"("goods_receiving_id");

-- CreateIndex
CREATE UNIQUE INDEX "restaurant_orders_company_id_ticket_number_key" ON "restaurant_orders"("company_id", "ticket_number");

-- CreateIndex
CREATE UNIQUE INDEX "restaurant_orders_company_id_client_request_id_key" ON "restaurant_orders"("company_id", "client_request_id");

-- CreateIndex
CREATE UNIQUE INDEX "tax_exemption_types_company_id_code_key" ON "tax_exemption_types"("company_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "tax_jurisdictions_company_id_code_key" ON "tax_jurisdictions"("company_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "tax_types_company_id_code_key" ON "tax_types"("company_id", "code");

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_sales_person_id_fkey" FOREIGN KEY ("sales_person_id") REFERENCES "salespersons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments_made" ADD CONSTRAINT "payments_made_bill_id_fkey" FOREIGN KEY ("bill_id") REFERENCES "bills"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_return_items" ADD CONSTRAINT "purchase_return_items_goods_receiving_id_fkey" FOREIGN KEY ("goods_receiving_id") REFERENCES "goods_receivings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_return_items" ADD CONSTRAINT "purchase_return_items_goods_receiving_item_id_fkey" FOREIGN KEY ("goods_receiving_item_id") REFERENCES "goods_receiving_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_return_items" ADD CONSTRAINT "purchase_return_items_purchase_invoice_id_fkey" FOREIGN KEY ("purchase_invoice_id") REFERENCES "purchase_invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_returns" ADD CONSTRAINT "purchase_returns_goods_receiving_id_fkey" FOREIGN KEY ("goods_receiving_id") REFERENCES "goods_receivings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_returns" ADD CONSTRAINT "purchase_returns_purchase_invoice_id_fkey" FOREIGN KEY ("purchase_invoice_id") REFERENCES "purchase_invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_original_invoice_id_fkey" FOREIGN KEY ("original_invoice_id") REFERENCES "warehouse_invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_sale_items" ADD CONSTRAINT "pos_sale_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipes" ADD CONSTRAINT "recipes_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipes" ADD CONSTRAINT "recipes_menu_product_id_fkey" FOREIGN KEY ("menu_product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipe_items" ADD CONSTRAINT "recipe_items_recipe_id_fkey" FOREIGN KEY ("recipe_id") REFERENCES "recipes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipe_items" ADD CONSTRAINT "recipe_items_ingredient_product_id_fkey" FOREIGN KEY ("ingredient_product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kitchen_stations" ADD CONSTRAINT "kitchen_stations_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_tax_profiles" ADD CONSTRAINT "company_tax_profiles_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_tax_profiles" ADD CONSTRAINT "company_tax_profiles_default_jurisdiction_id_fkey" FOREIGN KEY ("default_jurisdiction_id") REFERENCES "tax_jurisdictions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manufacturing_work_orders" ADD CONSTRAINT "manufacturing_work_orders_work_center_id_fkey" FOREIGN KEY ("work_center_id") REFERENCES "manufacturing_work_centers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manufacturing_quality_inspections" ADD CONSTRAINT "manufacturing_quality_inspections_inspector_id_fkey" FOREIGN KEY ("inspector_id") REFERENCES "hr_employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_print_settings" ADD CONSTRAINT "hr_print_settings_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_signatories" ADD CONSTRAINT "hr_signatories_setting_id_fkey" FOREIGN KEY ("setting_id") REFERENCES "hr_print_settings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_signatories" ADD CONSTRAINT "hr_signatories_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_document_templates" ADD CONSTRAINT "hr_document_templates_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_document_template_versions" ADD CONSTRAINT "hr_document_template_versions_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "hr_document_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_generated_documents" ADD CONSTRAINT "hr_generated_documents_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_generated_documents" ADD CONSTRAINT "hr_generated_documents_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "hr_employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "internal_transfers" ADD CONSTRAINT "internal_transfers_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "internal_transfers" ADD CONSTRAINT "internal_transfers_from_location_id_fkey" FOREIGN KEY ("from_location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "internal_transfers" ADD CONSTRAINT "internal_transfers_to_location_id_fkey" FOREIGN KEY ("to_location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "internal_transfers" ADD CONSTRAINT "internal_transfers_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "internal_transfer_items" ADD CONSTRAINT "internal_transfer_items_transfer_id_fkey" FOREIGN KEY ("transfer_id") REFERENCES "internal_transfers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "internal_transfer_items" ADD CONSTRAINT "internal_transfer_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "internal_transfer_history" ADD CONSTRAINT "internal_transfer_history_transfer_id_fkey" FOREIGN KEY ("transfer_id") REFERENCES "internal_transfers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_write_offs" ADD CONSTRAINT "stock_write_offs_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_write_offs" ADD CONSTRAINT "stock_write_offs_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_write_offs" ADD CONSTRAINT "stock_write_offs_fiscal_year_id_fkey" FOREIGN KEY ("fiscal_year_id") REFERENCES "fiscal_years"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_write_offs" ADD CONSTRAINT "stock_write_offs_expense_account_id_fkey" FOREIGN KEY ("expense_account_id") REFERENCES "chart_of_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_write_offs" ADD CONSTRAINT "stock_write_offs_journal_entry_id_fkey" FOREIGN KEY ("journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_write_offs" ADD CONSTRAINT "stock_write_offs_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_write_offs" ADD CONSTRAINT "stock_write_offs_submitted_by_fkey" FOREIGN KEY ("submitted_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_write_offs" ADD CONSTRAINT "stock_write_offs_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_write_offs" ADD CONSTRAINT "stock_write_offs_posted_by_fkey" FOREIGN KEY ("posted_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_write_off_items" ADD CONSTRAINT "stock_write_off_items_write_off_id_fkey" FOREIGN KEY ("write_off_id") REFERENCES "stock_write_offs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_write_off_items" ADD CONSTRAINT "stock_write_off_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_shipments" ADD CONSTRAINT "import_shipments_original_bl_received_by_fkey" FOREIGN KEY ("original_bl_received_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_grns" ADD CONSTRAINT "import_grns_posted_by_fkey" FOREIGN KEY ("posted_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_supplier_claims" ADD CONSTRAINT "import_supplier_claims_import_grn_item_id_fkey" FOREIGN KEY ("import_grn_item_id") REFERENCES "import_grn_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_supplier_claims" ADD CONSTRAINT "import_supplier_claims_shipment_id_fkey" FOREIGN KEY ("shipment_id") REFERENCES "import_shipments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_supplier_claims" ADD CONSTRAINT "import_supplier_claims_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_leads" ADD CONSTRAINT "crm_leads_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "crm_lead_sources"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_leads" ADD CONSTRAINT "crm_leads_board_id_fkey" FOREIGN KEY ("board_id") REFERENCES "crm_lead_boards"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_lead_custom_fields" ADD CONSTRAINT "crm_lead_custom_fields_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_lead_boards" ADD CONSTRAINT "crm_lead_boards_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_lead_board_columns" ADD CONSTRAINT "crm_lead_board_columns_board_id_fkey" FOREIGN KEY ("board_id") REFERENCES "crm_lead_boards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_lead_sources" ADD CONSTRAINT "crm_lead_sources_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_lead_follow_ups" ADD CONSTRAINT "crm_lead_follow_ups_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "crm_leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_lead_follow_ups" ADD CONSTRAINT "crm_lead_follow_ups_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_lead_follow_ups" ADD CONSTRAINT "crm_lead_follow_ups_assigned_to_id_fkey" FOREIGN KEY ("assigned_to_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_lead_activities" ADD CONSTRAINT "crm_lead_activities_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "crm_leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_lead_activities" ADD CONSTRAINT "crm_lead_activities_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_lead_activities" ADD CONSTRAINT "crm_lead_activities_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_lead_import_jobs" ADD CONSTRAINT "crm_lead_import_jobs_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_lead_import_mappings" ADD CONSTRAINT "crm_lead_import_mappings_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_google_sheet_connections" ADD CONSTRAINT "crm_google_sheet_connections_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_google_sheet_sync_jobs" ADD CONSTRAINT "crm_google_sheet_sync_jobs_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "crm_google_sheet_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_lead_audit_logs" ADD CONSTRAINT "crm_lead_audit_logs_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_contacts" ADD CONSTRAINT "crm_contacts_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_opportunities" ADD CONSTRAINT "crm_opportunities_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_activities" ADD CONSTRAINT "crm_activities_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_tasks" ADD CONSTRAINT "crm_tasks_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "bank_reconciliations_statement_start_date_statement_end_date_id" RENAME TO "bank_reconciliations_statement_start_date_statement_end_dat_idx";

-- RenameIndex
ALTER INDEX "bank_statement_transactions_company_id_bank_account_id_fingerpr" RENAME TO "bank_statement_transactions_company_id_bank_account_id_fing_key";

-- RenameIndex
ALTER INDEX "crm_custom_fields_company_entity_idx" RENAME TO "crm_custom_fields_company_id_entity_type_idx";

-- RenameIndex
ALTER INDEX "crm_custom_fields_company_entity_key_key" RENAME TO "crm_custom_fields_company_id_entity_type_field_key_key";

-- RenameIndex
ALTER INDEX "crm_opportunities_closing_date_idx" RENAME TO "crm_opportunities_expected_closing_date_idx";

-- RenameIndex
ALTER INDEX "exchange_rate_history_company_id_from_currency_id_to__idx" RENAME TO "exchange_rate_history_company_id_from_currency_id_to_curren_idx";

-- RenameIndex
ALTER INDEX "exchange_rates_company_id_from_currency_id_to_currency_id_effec" RENAME TO "exchange_rates_company_id_from_currency_id_to_currency_id_e_key";

-- RenameIndex
ALTER INDEX "goods_receiving_purchase_orders_goods_receiving_id_purchase_ord" RENAME TO "goods_receiving_purchase_orders_goods_receiving_id_purchase_key";

-- RenameIndex
ALTER INDEX "import_customs_duty_payments_company_bank_ref_key" RENAME TO "import_customs_duty_payments_company_id_bank_account_id_ref_key";

-- RenameIndex
ALTER INDEX "import_customs_duty_payments_company_date_idx" RENAME TO "import_customs_duty_payments_company_id_payment_date_idx";

-- RenameIndex
ALTER INDEX "pos_master_sync_changes_company_entity_idx" RENAME TO "pos_master_sync_changes_company_id_entity_type_entity_id_idx";

-- RenameIndex
ALTER INDEX "purchase_installment_schedules_invoice_id_installment_number_ke" RENAME TO "purchase_installment_schedules_invoice_id_installment_numbe_key";

-- RenameIndex
ALTER INDEX "restaurant_order_lines_station_idx" RENAME TO "restaurant_order_lines_kitchen_station_id_idx";

-- RenameIndex
ALTER INDEX "restaurant_orders_company_updated_idx" RENAME TO "restaurant_orders_company_id_updated_at_idx";


