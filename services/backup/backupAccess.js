'use strict';

const prisma = require('../../prisma/client');
const { listMembershipsForUser } = require('../../utils/companyAccess');
const { RATE_LIMIT_WINDOW_MS, RATE_LIMIT_MAX_CREATE } = require('./backupConstants');

function isPlatformOwnerEmail(email) {
  const emails = (process.env.PLATFORM_OWNER_EMAILS || 'mfaisalakhan@gmail.com,kashif@gmail.com,admin@bisonstechs.dev')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return emails.includes(String(email || '').toLowerCase());
}

function isCompanyAdminRole(role) {
  const r = String(role || '').toLowerCase();
  return ['admin', 'owner', 'superadmin', 'company_admin', 'platform_admin'].includes(r);
}

async function getAccessibleCompaniesForBackup(user) {
  const memberships = await listMembershipsForUser(user.id);
  const companies = [];
  for (const m of memberships) {
    if (!m.isActive) continue;
    if (!m.company?.isActive && m.company?.isActive !== undefined) continue;
    const canManage = m.isOwner || isCompanyAdminRole(m.role) || isCompanyAdminRole(user.role);
    if (!canManage && !isPlatformOwnerEmail(user.email)) continue;
    companies.push({
      id: m.company.id,
      name: m.company.name,
      role: m.role,
      isOwner: m.isOwner,
    });
  }

  // Fallback: primary company if user is admin-like
  if (!companies.length && user.companyId && isCompanyAdminRole(user.role)) {
    const company = await prisma.company.findUnique({
      where: { id: user.companyId },
      select: { id: true, name: true, isActive: true },
    });
    if (company) {
      companies.push({ id: company.id, name: company.name, role: user.role, isOwner: true });
    }
  }

  return companies;
}

async function assertCompaniesAuthorized(user, companyIds) {
  const accessible = await getAccessibleCompaniesForBackup(user);
  const allowed = new Set(accessible.map((c) => c.id));
  const unauthorized = companyIds.filter((id) => !allowed.has(id));
  if (unauthorized.length) {
    const err = new Error('Not authorized for one or more selected companies');
    err.status = 403;
    err.code = 'COMPANY_BACKUP_FORBIDDEN';
    err.unauthorized = unauthorized;
    throw err;
  }
  return accessible.filter((c) => companyIds.includes(c.id));
}

async function assertCanAccessBackupJob(user, job, { requireOwner = false } = {}) {
  if (isPlatformOwnerEmail(user.email)) return true;
  if (job.backupType === 'FULL_DATABASE') {
    const err = new Error('Full database backups are restricted to platform owners');
    err.status = 403;
    throw err;
  }
  if (job.ownerUserId && job.ownerUserId === user.id) return true;
  if (requireOwner) {
    const err = new Error('Not authorized to access this backup');
    err.status = 403;
    throw err;
  }
  // Allow company admins who share all companies in the backup
  const accessible = await getAccessibleCompaniesForBackup(user);
  const allowed = new Set(accessible.map((c) => c.id));
  const companies = job.companies || await prisma.backupCompany.findMany({
    where: { backupJobId: job.id },
  });
  if (!companies.length || companies.some((c) => !allowed.has(c.companyId))) {
    const err = new Error('Not authorized to access this backup');
    err.status = 403;
    throw err;
  }
  return true;
}

async function checkCreateRateLimit(userId) {
  const since = new Date(Date.now() - RATE_LIMIT_WINDOW_MS);
  const count = await prisma.backupJob.count({
    where: {
      ownerUserId: userId,
      createdAt: { gte: since },
      backupType: 'COMPANY',
    },
  });
  if (count >= RATE_LIMIT_MAX_CREATE) {
    const err = new Error(`Backup creation rate limit exceeded (${RATE_LIMIT_MAX_CREATE} per hour)`);
    err.status = 429;
    err.code = 'BACKUP_RATE_LIMIT';
    throw err;
  }
}

async function writeAudit({ backupJobId, action, actorUserId, actorEmail, req, details }) {
  try {
    await prisma.backupAuditLog.create({
      data: {
        backupJobId: backupJobId || null,
        action,
        actorUserId: actorUserId || null,
        actorEmail: actorEmail || null,
        ipAddress: req?.ip || req?.headers?.['x-forwarded-for'] || null,
        userAgent: req?.headers?.['user-agent'] || null,
        details: details || undefined,
      },
    });
  } catch (err) {
    console.error('[backupAccess] audit log failed', err.message);
  }
}

module.exports = {
  isPlatformOwnerEmail,
  isCompanyAdminRole,
  getAccessibleCompaniesForBackup,
  assertCompaniesAuthorized,
  assertCanAccessBackupJob,
  checkCreateRateLimit,
  writeAudit,
};
