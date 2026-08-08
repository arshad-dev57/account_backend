-- CreateTable
CREATE TABLE "pdf_report_settings" (
    "id" TEXT NOT NULL,
    "scope_key" TEXT NOT NULL,
    "company_id" TEXT,
    "user_id" TEXT NOT NULL,
    "company_name" TEXT NOT NULL DEFAULT '',
    "company_address" TEXT NOT NULL DEFAULT '',
    "logo" TEXT NOT NULL DEFAULT '',
    "signature" TEXT NOT NULL DEFAULT '',
    "show_logo" BOOLEAN NOT NULL DEFAULT true,
    "show_signature" BOOLEAN NOT NULL DEFAULT true,
    "show_company_name" BOOLEAN NOT NULL DEFAULT true,
    "show_address" BOOLEAN NOT NULL DEFAULT true,
    "show_page_numbers" BOOLEAN NOT NULL DEFAULT true,
    "layout" TEXT NOT NULL DEFAULT 'classic',
    "logo_position" TEXT NOT NULL DEFAULT 'left',
    "header_subtitle" TEXT NOT NULL DEFAULT '',
    "footer_text" TEXT NOT NULL DEFAULT 'Confidential - For Internal Use Only',
    "accent_color" TEXT NOT NULL DEFAULT '#014582',
    "signature_label" TEXT NOT NULL DEFAULT 'Authorized Signature',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pdf_report_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "pdf_report_settings_scope_key_key" ON "pdf_report_settings"("scope_key");

-- CreateIndex
CREATE INDEX "pdf_report_settings_company_id_idx" ON "pdf_report_settings"("company_id");

-- CreateIndex
CREATE INDEX "pdf_report_settings_user_id_idx" ON "pdf_report_settings"("user_id");

-- AddForeignKey
ALTER TABLE "pdf_report_settings" ADD CONSTRAINT "pdf_report_settings_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pdf_report_settings" ADD CONSTRAINT "pdf_report_settings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
