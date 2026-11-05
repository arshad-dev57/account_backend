-- CreateEnum
CREATE TYPE "BackupType" AS ENUM ('FULL_DATABASE', 'COMPANY');

-- CreateEnum
CREATE TYPE "BackupJobStatus" AS ENUM ('QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED', 'RESTORING');

-- CreateEnum
CREATE TYPE "BackupAuditAction" AS ENUM ('CREATE', 'DOWNLOAD', 'RESTORE', 'DELETE', 'SCHEDULE_UPDATE', 'EXPIRE', 'VALIDATE');

-- CreateTable
CREATE TABLE "backup_jobs" (
    "id" TEXT NOT NULL,
    "backup_type" "BackupType" NOT NULL,
    "status" "BackupJobStatus" NOT NULL DEFAULT 'QUEUED',
    "name" TEXT NOT NULL,
    "owner_user_id" TEXT,
    "owner_email" TEXT,
    "owner_company_id" TEXT,
    "storage_key" TEXT,
    "storage_provider" TEXT,
    "file_name" TEXT,
    "file_size_bytes" BIGINT,
    "checksum_sha256" TEXT,
    "format_version" TEXT NOT NULL DEFAULT '1.0.0',
    "erp_version" TEXT,
    "progress_percent" INTEGER NOT NULL DEFAULT 0,
    "progress_message" TEXT,
    "error_message" TEXT,
    "manifest_json" JSONB,
    "metadata_json" JSONB,
    "expires_at" TIMESTAMP(3),
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "restore_locked_at" TIMESTAMP(3),
    "restore_locked_by" TEXT,
    "is_pre_restore_snapshot" BOOLEAN NOT NULL DEFAULT false,
    "parent_backup_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "backup_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "backup_companies" (
    "id" TEXT NOT NULL,
    "backup_job_id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "company_name" TEXT NOT NULL,
    "record_counts" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "backup_companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "backup_audit_logs" (
    "id" TEXT NOT NULL,
    "backup_job_id" TEXT,
    "action" "BackupAuditAction" NOT NULL,
    "actor_user_id" TEXT,
    "actor_email" TEXT,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "details" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "backup_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "backup_schedule_configs" (
    "id" TEXT NOT NULL,
    "schedule_key" TEXT NOT NULL DEFAULT 'full_database',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "frequency" TEXT NOT NULL DEFAULT 'daily',
    "run_at_utc" TEXT NOT NULL DEFAULT '02:00',
    "day_of_week" INTEGER,
    "retention_days" INTEGER NOT NULL DEFAULT 30,
    "last_run_at" TIMESTAMP(3),
    "last_run_backup_id" TEXT,
    "next_run_at" TIMESTAMP(3),
    "updated_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "backup_schedule_configs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "backup_jobs_backup_type_status_idx" ON "backup_jobs"("backup_type", "status");

-- CreateIndex
CREATE INDEX "backup_jobs_owner_user_id_idx" ON "backup_jobs"("owner_user_id");

-- CreateIndex
CREATE INDEX "backup_jobs_owner_company_id_idx" ON "backup_jobs"("owner_company_id");

-- CreateIndex
CREATE INDEX "backup_jobs_status_created_at_idx" ON "backup_jobs"("status", "created_at");

-- CreateIndex
CREATE INDEX "backup_jobs_expires_at_idx" ON "backup_jobs"("expires_at");

-- CreateIndex
CREATE INDEX "backup_companies_company_id_idx" ON "backup_companies"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "backup_companies_backup_job_id_company_id_key" ON "backup_companies"("backup_job_id", "company_id");

-- CreateIndex
CREATE INDEX "backup_audit_logs_backup_job_id_idx" ON "backup_audit_logs"("backup_job_id");

-- CreateIndex
CREATE INDEX "backup_audit_logs_actor_user_id_idx" ON "backup_audit_logs"("actor_user_id");

-- CreateIndex
CREATE INDEX "backup_audit_logs_action_created_at_idx" ON "backup_audit_logs"("action", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "backup_schedule_configs_schedule_key_key" ON "backup_schedule_configs"("schedule_key");

-- AddForeignKey
ALTER TABLE "backup_jobs" ADD CONSTRAINT "backup_jobs_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "backup_jobs" ADD CONSTRAINT "backup_jobs_parent_backup_id_fkey" FOREIGN KEY ("parent_backup_id") REFERENCES "backup_jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "backup_companies" ADD CONSTRAINT "backup_companies_backup_job_id_fkey" FOREIGN KEY ("backup_job_id") REFERENCES "backup_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "backup_audit_logs" ADD CONSTRAINT "backup_audit_logs_backup_job_id_fkey" FOREIGN KEY ("backup_job_id") REFERENCES "backup_jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
