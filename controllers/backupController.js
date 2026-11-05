'use strict';

const prisma = require('../prisma/client');
const storage = require('../services/backup/backupObjectStorage');
const { enqueueJobProcessing, serializeJob, expireOldBackups } = require('../services/backup/backupJobProcessor');
const { restoreCompanyBackup, validateBackupJobFile } = require('../services/backup/companyRestoreService');
const {
  getAccessibleCompaniesForBackup,
  assertCompaniesAuthorized,
  assertCanAccessBackupJob,
  checkCreateRateLimit,
  writeAudit,
  isPlatformOwnerEmail,
} = require('../services/backup/backupAccess');
const { MAX_COMPANIES_PER_BACKUP, DEFAULT_COMPANY_RETENTION_DAYS } = require('../services/backup/backupConstants');

function clientError(res, err) {
  const status = err.status || 500;
  return res.status(status).json({
    success: false,
    message: err.message || 'Backup error',
    code: err.code,
    unauthorized: err.unauthorized,
  });
}

function formatJob(job) {
  const s = serializeJob(job);
  return {
    id: s.id,
    backupType: s.backupType,
    status: s.status,
    name: s.name,
    fileName: s.fileName,
    fileSizeBytes: s.fileSizeBytes,
    checksumSha256: s.checksumSha256,
    progressPercent: s.progressPercent,
    progressMessage: s.progressMessage,
    errorMessage: s.errorMessage,
    createdAt: s.createdAt,
    completedAt: s.completedAt,
    expiresAt: s.expiresAt,
    companies: (s.companies || []).map((c) => ({
      companyId: c.companyId,
      companyName: c.companyName,
    })),
    isPreRestoreSnapshot: s.isPreRestoreSnapshot,
  };
}

/** GET /api/backups/companies */
async function listBackupCompanies(req, res) {
  try {
    const companies = await getAccessibleCompaniesForBackup(req.user);
    return res.json({ success: true, data: { companies } });
  } catch (err) {
    return clientError(res, err);
  }
}

/** POST /api/backups */
async function createCompanyBackup(req, res) {
  try {
    const companyIds = Array.isArray(req.body?.companyIds)
      ? [...new Set(req.body.companyIds.map(String))]
      : [];
    if (!companyIds.length) {
      return res.status(400).json({ success: false, message: 'Select at least one company' });
    }
    if (companyIds.length > MAX_COMPANIES_PER_BACKUP) {
      return res.status(400).json({
        success: false,
        message: `Maximum ${MAX_COMPANIES_PER_BACKUP} companies per backup`,
      });
    }

    await checkCreateRateLimit(req.user.id);
    const selected = await assertCompaniesAuthorized(req.user, companyIds);

    // Prevent concurrent PROCESSING company backups for same owner overlapping same companies
    const active = await prisma.backupJob.findFirst({
      where: {
        ownerUserId: req.user.id,
        backupType: 'COMPANY',
        status: { in: ['QUEUED', 'PROCESSING', 'RESTORING'] },
        companies: { some: { companyId: { in: companyIds } } },
      },
      select: { id: true, status: true },
    });
    if (active) {
      return res.status(409).json({
        success: false,
        message: `A backup/restore is already ${active.status.toLowerCase()} for one of the selected companies`,
        data: { jobId: active.id },
      });
    }

    const stamp = new Date().toISOString().slice(0, 10);
    const name = req.body?.name
      || `Company Backup ${stamp} (${selected.map((c) => c.name).join(', ')})`;
    const fileName = `Bisonstechs_Backup_${stamp}.zip`;

    const job = await prisma.backupJob.create({
      data: {
        backupType: 'COMPANY',
        status: 'QUEUED',
        name,
        fileName,
        ownerUserId: req.user.id,
        ownerEmail: req.user.email,
        ownerCompanyId: selected[0]?.id || null,
        erpVersion: process.env.ERP_VERSION || '1.0.0',
        progressMessage: 'Queued',
        companies: {
          create: selected.map((c) => ({
            companyId: c.id,
            companyName: c.name,
          })),
        },
      },
      include: { companies: true },
    });

    await writeAudit({
      backupJobId: job.id,
      action: 'CREATE',
      actorUserId: req.user.id,
      actorEmail: req.user.email,
      req,
      details: { companyIds, retentionDays: DEFAULT_COMPANY_RETENTION_DAYS },
    });

    enqueueJobProcessing(job.id);

    return res.status(202).json({
      success: true,
      message: 'Backup queued',
      data: { job: formatJob(job) },
    });
  } catch (err) {
    return clientError(res, err);
  }
}

/** GET /api/backups */
async function listCompanyBackups(req, res) {
  try {
    const accessible = await getAccessibleCompaniesForBackup(req.user);
    const accessibleIds = accessible.map((c) => c.id);

    const jobs = await prisma.backupJob.findMany({
      where: {
        backupType: 'COMPANY',
        OR: [
          { ownerUserId: req.user.id },
          ...(accessibleIds.length
            ? [{ companies: { every: { companyId: { in: accessibleIds } }, some: {} } }]
            : []),
        ],
      },
      include: { companies: true },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Number(req.query.limit) || 50, 100),
    });

    // Extra filter: only jobs where ALL companies are accessible
    const allowed = new Set(accessibleIds);
    const filtered = jobs.filter((j) =>
      j.ownerUserId === req.user.id
      || (j.companies.length && j.companies.every((c) => allowed.has(c.companyId)))
    );

    const completed = filtered.filter((j) => j.status === 'COMPLETED' && j.completedAt);
    const lastBackup = completed[0] || null;
    const totalSize = filtered.reduce((sum, j) => sum + Number(j.fileSizeBytes || 0), 0);

    return res.json({
      success: true,
      data: {
        jobs: filtered.map(formatJob),
        summary: {
          totalBackups: filtered.length,
          totalSizeBytes: totalSize,
          lastBackupAt: lastBackup?.completedAt || null,
          lastBackupId: lastBackup?.id || null,
        },
      },
    });
  } catch (err) {
    return clientError(res, err);
  }
}

/** GET /api/backups/:id */
async function getCompanyBackup(req, res) {
  try {
    const job = await prisma.backupJob.findUnique({
      where: { id: req.params.id },
      include: { companies: true },
    });
    if (!job || job.backupType !== 'COMPANY') {
      return res.status(404).json({ success: false, message: 'Backup not found' });
    }
    await assertCanAccessBackupJob(req.user, job);
    return res.json({ success: true, data: { job: formatJob(job) } });
  } catch (err) {
    return clientError(res, err);
  }
}

/** GET /api/backups/:id/download */
async function downloadCompanyBackup(req, res) {
  try {
    const job = await prisma.backupJob.findUnique({
      where: { id: req.params.id },
      include: { companies: true },
    });
    if (!job || job.backupType !== 'COMPANY') {
      return res.status(404).json({ success: false, message: 'Backup not found' });
    }
    await assertCanAccessBackupJob(req.user, job);
    if (job.status !== 'COMPLETED' || !job.storageKey) {
      return res.status(409).json({ success: false, message: 'Backup file is not ready' });
    }

    await writeAudit({
      backupJobId: job.id,
      action: 'DOWNLOAD',
      actorUserId: req.user.id,
      actorEmail: req.user.email,
      req,
    });

    const fileName = job.fileName || `Bisonstechs_Backup_${job.id}.zip`;
    const signed = await storage.getSignedDownloadUrl(job.storageKey, 300, fileName);
    if (signed && req.query.redirect === '1') {
      return res.redirect(signed);
    }
    if (signed && req.query.mode === 'url') {
      return res.json({ success: true, data: { url: signed, expiresIn: 300, fileName } });
    }

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName.replace(/"/g, '')}"`);
    if (job.fileSizeBytes != null) {
      res.setHeader('Content-Length', String(job.fileSizeBytes));
    }
    const stream = await storage.openReadStream(job.storageKey);
    stream.pipe(res);
  } catch (err) {
    return clientError(res, err);
  }
}

/** POST /api/backups/:id/restore */
async function restoreCompanyBackupHandler(req, res) {
  try {
    const job = await prisma.backupJob.findUnique({
      where: { id: req.params.id },
      include: { companies: true },
    });
    if (!job || job.backupType !== 'COMPANY') {
      return res.status(404).json({ success: false, message: 'Backup not found' });
    }
    await assertCanAccessBackupJob(req.user, job);

    const confirm = req.body?.confirm === true || req.body?.confirm === 'RESTORE';
    if (!confirm) {
      return res.status(400).json({
        success: false,
        message: 'Restore requires confirm: true. This can overwrite existing company data.',
      });
    }

    const accessible = await getAccessibleCompaniesForBackup(req.user);
    const authorizedIds = accessible.map((c) => c.id);
    const selectedCompanyIds = Array.isArray(req.body?.companyIds)
      ? req.body.companyIds.map(String)
      : undefined;

    // Create pre-restore snapshot of companies about to be restored
    const targetIds = (selectedCompanyIds || job.companies.map((c) => c.companyId))
      .filter((id) => authorizedIds.includes(id));
    if (!targetIds.length) {
      return res.status(403).json({ success: false, message: 'No authorized companies to restore' });
    }

    const selected = accessible.filter((c) => targetIds.includes(c.id));
    const stamp = new Date().toISOString().slice(0, 10);
    const preJob = await prisma.backupJob.create({
      data: {
        backupType: 'COMPANY',
        status: 'QUEUED',
        name: `Pre-restore snapshot ${stamp}`,
        fileName: `Bisonstechs_PreRestore_${stamp}.zip`,
        ownerUserId: req.user.id,
        ownerEmail: req.user.email,
        ownerCompanyId: selected[0]?.id || null,
        isPreRestoreSnapshot: true,
        parentBackupId: job.id,
        progressMessage: 'Queued pre-restore snapshot',
        companies: {
          create: selected.map((c) => ({ companyId: c.id, companyName: c.name })),
        },
      },
    });

    // Process pre-restore snapshot synchronously before restore
    const { processJob } = require('../services/backup/backupJobProcessor');
    await processJob(preJob.id);

    await writeAudit({
      backupJobId: job.id,
      action: 'RESTORE',
      actorUserId: req.user.id,
      actorEmail: req.user.email,
      req,
      details: { companyIds: targetIds, preRestoreBackupId: preJob.id },
    });

    // Respond accepted then restore async — for safety do sync for correctness in MVP
    const result = await restoreCompanyBackup({
      backupJobId: job.id,
      authorizedCompanyIds: authorizedIds,
      selectedCompanyIds: targetIds,
      actorUserId: req.user.id,
    });

    return res.json({
      success: true,
      message: 'Restore completed',
      data: {
        ...result,
        preRestoreBackupId: preJob.id,
      },
    });
  } catch (err) {
    return clientError(res, err);
  }
}

/** DELETE /api/backups/:id */
async function deleteCompanyBackup(req, res) {
  try {
    const job = await prisma.backupJob.findUnique({
      where: { id: req.params.id },
      include: { companies: true },
    });
    if (!job || job.backupType !== 'COMPANY') {
      return res.status(404).json({ success: false, message: 'Backup not found' });
    }
    await assertCanAccessBackupJob(req.user, job, { requireOwner: !isPlatformOwnerEmail(req.user.email) });
    if (['PROCESSING', 'RESTORING', 'QUEUED'].includes(job.status)) {
      return res.status(409).json({ success: false, message: 'Cannot delete a backup while it is active' });
    }

    if (job.storageKey) {
      await storage.deleteObject(job.storageKey).catch(() => {});
    }
    await writeAudit({
      backupJobId: job.id,
      action: 'DELETE',
      actorUserId: req.user.id,
      actorEmail: req.user.email,
      req,
    });
    await prisma.backupJob.delete({ where: { id: job.id } });
    return res.json({ success: true, message: 'Backup deleted' });
  } catch (err) {
    return clientError(res, err);
  }
}

/** POST /api/backups/:id/validate */
async function validateCompanyBackup(req, res) {
  try {
    const job = await prisma.backupJob.findUnique({
      where: { id: req.params.id },
      include: { companies: true },
    });
    if (!job || job.backupType !== 'COMPANY') {
      return res.status(404).json({ success: false, message: 'Backup not found' });
    }
    await assertCanAccessBackupJob(req.user, job);
    const result = await validateBackupJobFile(job.id);
    await writeAudit({
      backupJobId: job.id,
      action: 'VALIDATE',
      actorUserId: req.user.id,
      actorEmail: req.user.email,
      req,
      details: result,
    });
    return res.json({ success: true, data: result });
  } catch (err) {
    return clientError(res, err);
  }
}

module.exports = {
  listBackupCompanies,
  createCompanyBackup,
  listCompanyBackups,
  getCompanyBackup,
  downloadCompanyBackup,
  restoreCompanyBackupHandler,
  deleteCompanyBackup,
  validateCompanyBackup,
  formatJob,
  expireOldBackups,
};
