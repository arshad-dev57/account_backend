-- AlterTable
ALTER TABLE "hr_bonuses" ADD COLUMN     "additional_type" TEXT NOT NULL DEFAULT 'Salary',
ADD COLUMN     "doc_status" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "from_date" DATE,
ADD COLUMN     "payroll_item_id" TEXT,
ADD COLUMN     "salary_component_id" TEXT,
ADD COLUMN     "to_date" DATE
;
-- AlterTable
ALTER TABLE "hr_loans" ADD COLUMN     "advance_account_id" TEXT,
ADD COLUMN     "claimed_amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "doc_status" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "expense_account" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "offset_against_salary" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "paid_amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "repayment_method" TEXT NOT NULL DEFAULT 'Salary Deduction',
ADD COLUMN     "returned_amount" DOUBLE PRECISION NOT NULL DEFAULT 0
;
-- CreateTable
CREATE TABLE "hr_interview_types" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "disabled" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hr_interview_types_pkey" PRIMARY KEY ("id")
)
;
-- CreateIndex
CREATE INDEX "hr_interview_types_company_id_idx" ON "hr_interview_types"("company_id")
;
-- CreateIndex
CREATE UNIQUE INDEX "hr_interview_types_company_id_name_key" ON "hr_interview_types"("company_id", "name")
;
