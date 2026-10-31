CREATE TABLE IF NOT EXISTS "hr_timesheets" (
  "id" TEXT NOT NULL,
  "company_id" TEXT NOT NULL,
  "employee_id" TEXT,
  "employee_name" TEXT NOT NULL DEFAULT '',
  "start_date" DATE,
  "end_date" DATE,
  "title" TEXT NOT NULL DEFAULT '',
  "status" TEXT NOT NULL DEFAULT 'Draft',
  "doc_status" INTEGER NOT NULL DEFAULT 0,
  "total_hours" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "note" TEXT NOT NULL DEFAULT '',
  "time_logs" JSONB NOT NULL DEFAULT '[]',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "hr_timesheets_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "hr_timesheets_company_id_employee_id_idx"
ON "hr_timesheets"("company_id", "employee_id");
