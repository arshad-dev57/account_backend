ALTER TABLE "hr_departments" ADD COLUMN IF NOT EXISTS "leave_block_list_id" TEXT;
ALTER TABLE "hr_departments" ADD COLUMN IF NOT EXISTS "shift_request_approvers" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "hr_departments" ADD COLUMN IF NOT EXISTS "leave_approvers" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "hr_departments" ADD COLUMN IF NOT EXISTS "expense_approvers" JSONB NOT NULL DEFAULT '[]';
