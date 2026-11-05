'use strict';

const BACKUP_FORMAT_VERSION = '1.0.0';
const ERP_VERSION = process.env.ERP_VERSION || '1.0.0';

const SENSITIVE_USER_COLUMNS = new Set([
  'password',
  'reset_otp',
  'reset_otp_expiry',
  'login_otp',
  'login_otp_expiry',
  'failed_login_attempts',
  'lock_until',
]);

const BACKUP_SYSTEM_TABLES = new Set([
  'backup_jobs',
  'backup_companies',
  'backup_audit_logs',
  'backup_schedule_configs',
  '_prisma_migrations',
]);

/** Tables never included in company-scoped customer backups (global / platform). */
const GLOBAL_TABLES = new Set([
  'currencies',
  'permissions',
  'import_ports',
]);

const DEFAULT_COMPANY_RETENTION_DAYS = Number(process.env.BACKUP_COMPANY_RETENTION_DAYS || 90);
const DEFAULT_FULL_RETENTION_DAYS = Number(process.env.BACKUP_FULL_RETENTION_DAYS || 30);

const MAX_COMPANIES_PER_BACKUP = Number(process.env.BACKUP_MAX_COMPANIES || 50);
const RATE_LIMIT_WINDOW_MS = Number(process.env.BACKUP_RATE_LIMIT_WINDOW_MS || 60 * 60 * 1000);
const RATE_LIMIT_MAX_CREATE = Number(process.env.BACKUP_RATE_LIMIT_MAX || 5);

module.exports = {
  BACKUP_FORMAT_VERSION,
  ERP_VERSION,
  SENSITIVE_USER_COLUMNS,
  BACKUP_SYSTEM_TABLES,
  GLOBAL_TABLES,
  DEFAULT_COMPANY_RETENTION_DAYS,
  DEFAULT_FULL_RETENTION_DAYS,
  MAX_COMPANIES_PER_BACKUP,
  RATE_LIMIT_WINDOW_MS,
  RATE_LIMIT_MAX_CREATE,
};
