'use strict';

const prisma = require('../prisma/client');
const storage = require('../services/backup/backupObjectStorage');
const { enqueueJobProcessing, serializeJob, expireOldBackups } = require('../services/backup/backupJobProcessor');
const { writeAudit, isPlatformOwnerEmail } = require('../services/backup/backupAccess');
const { DEFAULT_FULL_RETENTION_DAYS } = require('../services/backup/backupConstants');
const { formatJob } = require('./backupController');
const { findPgDump } = require('../services/backup/fullDatabaseBackupService');

function clientError(res, err) {
  const status = err.status || 500;
  return res.status(status).json({
    success: false,
    message: err.message || 'Admin backup error',
    code: err.code,
  });
}

function requirePlatformOwner(req, res) {
  if (!isPlatformOwnerEmail(req.user?.email)) {
    res.status(403).json({ success: false, message: 'Platform owner access required' });
    return false;
  }
  return true;
}

/** POST /api/admin/backups/full */
async function createFullBackup(req, res) {
  try {
    if (!requirePlatformOwner(req, res)) return;

    const active = await prisma.backupJob.findFirst({
      where: {
        backupType: 'FULL_DATABASE',
        status: { in: ['QUEUED', 'PROCESSING', 'RESTORING'] },
      },
      select: { id: true, status: true },
    });
    if (active) {
      return res.status(409).json({
        success: false,
        message: `A full backup is already ${active.status.toLowerCase()}`,
        data: { jobId: active.id },
      });
    }

    const stamp = new Date().toISOString().slice(0, 10);
    const name = req.body?.name || `Full Database Backup ${stamp}`;
    const fileName = `Bisonstechs_FullDB_${stamp}.zip`;

    const job = await prisma.backupJob.create({
      data: {
        backupType: 'FULL_DATABASE',
        status: 'QUEUED',
        name,
        fileName,
        ownerUserId: req.user.id,
        ownerEmail: req.user.email,
        erpVersion: process.env.ERP_VERSION || '1.0.0',
        progressMessage: 'Queued',
        expiresAt: new Date(Date.now() + DEFAULT_FULL_RETENTION_DAYS * 86400000),
      },
    });

    await writeAudit({
      backupJobId: job.id,
      action: 'CREATE',
      actorUserId: req.user.id,
      actorEmail: req.user.email,
      req,
      details: { backupType: 'FULL_DATABASE', pgDumpAvailable: Boolean(findPgDump()) },
    });

    enqueueJobProcessing(job.id);

    return res.status(202).json({
      success: true,
      message: 'Full database backup queued',
      data: { job: formatJob(job) },
    });
  } catch (err) {
    return clientError(res, err);
  }
}

/** GET /api/admin/backups */
async function listAdminBackups(req, res) {
  try {
    if (!requirePlatformOwner(req, res)) return;

    const type = req.query.type; // FULL_DATABASE | COMPANY | undefined
    const where = {};
    if (type === 'FULL_DATABASE' || type === 'COMPANY') {
      where.backupType = type;
    }

    const jobs = await prisma.backupJob.findMany({
      where,
      include: { companies: true },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Number(req.query.limit) || 100, 200),
    });

    const full = jobs.filter((j) => j.backupType === 'FULL_DATABASE');
    const completedFull = full.filter((j) => j.status === 'COMPLETED');
    const lastFull = completedFull[0] || null;
    const totalStorage = jobs.reduce((s, j) => s + Number(j.fileSizeBytes || 0), 0);

    return res.json({
      success: true,
      data: {
        jobs: jobs.map(formatJob),
        summary: {
          totalBackups: jobs.length,
          totalFullBackups: full.length,
          totalStorageBytes: totalStorage,
          lastSuccessfulBackupAt: lastFull?.completedAt || null,
          lastSuccessfulBackupId: lastFull?.id || null,
          activeStatus: full.find((j) => ['QUEUED', 'PROCESSING', 'RESTORING'].includes(j.status))?.status || 'IDLE',
          storageProvider: storage.configuredProvider(),
          pgDumpAvailable: Boolean(findPgDump()),
        },
      },
    });
  } catch (err) {
    return clientError(res, err);
  }
}

/** GET /api/admin/backups/:id */
async function getAdminBackup(req, res) {
  try {
    if (!requirePlatformOwner(req, res)) return;
    const job = await prisma.backupJob.findUnique({
      where: { id: req.params.id },
      include: { companies: true, auditLogs: { orderBy: { createdAt: 'desc' }, take: 20 } },
    });
    if (!job) return res.status(404).json({ success: false, message: 'Backup not found' });
    return res.json({
      success: true,
      data: {
        job: {
          ...formatJob(job),
          manifestJson: job.manifestJson,
          metadataJson: job.metadataJson,
          storageKey: job.storageKey ? '[redacted]' : null,
          storageProvider: job.storageProvider,
          auditLogs: job.auditLogs,
        },
      },
    });
  } catch (err) {
    return clientError(res, err);
  }
}

/** GET /api/admin/backups/:id/download */
async function downloadAdminBackup(req, res) {
  try {
    if (!requirePlatformOwner(req, res)) return;
    const job = await prisma.backupJob.findUnique({ where: { id: req.params.id } });
    if (!job) return res.status(404).json({ success: false, message: 'Backup not found' });
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

/**
 * POST /api/admin/backups/:id/restore
 * Full DB restore is intentionally gated and does NOT auto-run pg_restore against production.
 * It validates the archive and returns instructions / dry-run result unless confirmRestoreProduction=true
 * AND BACKUP_ALLOW_FULL_RESTORE=1.
 */
async function restoreAdminBackup(req, res) {
  try {
    if (!requirePlatformOwner(req, res)) return;
    const job = await prisma.backupJob.findUnique({ where: { id: req.params.id } });
    if (!job) return res.status(404).json({ success: false, message: 'Backup not found' });
    if (job.backupType !== 'FULL_DATABASE') {
      return res.status(400).json({
        success: false,
        message: 'Use customer restore endpoints for company backups',
      });
    }

    const confirmPhrase = req.body?.confirmPhrase;
    if (confirmPhrase !== 'RESTORE FULL DATABASE') {
      return res.status(400).json({
        success: false,
        message: 'Type confirmPhrase: "RESTORE FULL DATABASE" to proceed',
      });
    }

    await writeAudit({
      backupJobId: job.id,
      action: 'RESTORE',
      actorUserId: req.user.id,
      actorEmail: req.user.email,
      req,
      details: {
        requested: true,
        allowEnv: process.env.BACKUP_ALLOW_FULL_RESTORE === '1',
        confirmRestoreProduction: req.body?.confirmRestoreProduction === true,
      },
    });

    if (process.env.BACKUP_ALLOW_FULL_RESTORE !== '1' || req.body?.confirmRestoreProduction !== true) {
      return res.json({
        success: true,
        message: 'Full restore acknowledged but not executed. Set BACKUP_ALLOW_FULL_RESTORE=1 and confirmRestoreProduction=true, or restore manually via Neon PITR / pg_restore from the downloaded archive.',
        data: {
          executed: false,
          recommendation: [
            '1. Create a fresh full backup before any restore.',
            '2. Prefer Neon Point-in-Time Recovery or branching for disaster recovery.',
            '3. Download this archive and run pg_restore against a staging database first.',
            '4. Only enable BACKUP_ALLOW_FULL_RESTORE on an isolated staging environment.',
          ],
          downloadHint: `/api/admin/backups/${job.id}/download`,
          manifest: job.manifestJson,
        },
      });
    }

    // Extremely dangerous path — only for staging with env flag
    return res.status(501).json({
      success: false,
      message: 'Automated production pg_restore is disabled. Download the dump and restore on staging with pg_restore, or use Neon PITR.',
    });
  } catch (err) {
    return clientError(res, err);
  }
}

/** DELETE /api/admin/backups/:id */
async function deleteAdminBackup(req, res) {
  try {
    if (!requirePlatformOwner(req, res)) return;
    const job = await prisma.backupJob.findUnique({ where: { id: req.params.id } });
    if (!job) return res.status(404).json({ success: false, message: 'Backup not found' });
    if (['PROCESSING', 'RESTORING', 'QUEUED'].includes(job.status)) {
      return res.status(409).json({ success: false, message: 'Cannot delete an active backup job' });
    }
    if (job.storageKey) await storage.deleteObject(job.storageKey).catch(() => {});
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

/** GET/PUT schedule */
async function getSchedule(req, res) {
  try {
    if (!requirePlatformOwner(req, res)) return;
    let config = await prisma.backupScheduleConfig.findUnique({ where: { scheduleKey: 'full_database' } });
    if (!config) {
      config = await prisma.backupScheduleConfig.create({
        data: { scheduleKey: 'full_database', enabled: false, frequency: 'daily', runAtUtc: '02:00', retentionDays: DEFAULT_FULL_RETENTION_DAYS },
      });
    }
    return res.json({ success: true, data: { schedule: config } });
  } catch (err) {
    return clientError(res, err);
  }
}

async function updateSchedule(req, res) {
  try {
    if (!requirePlatformOwner(req, res)) return;
    const {
      enabled, frequency, runAtUtc, dayOfWeek, retentionDays,
    } = req.body || {};

    const data = {
      updatedByUserId: req.user.id,
    };
    if (typeof enabled === 'boolean') data.enabled = enabled;
    if (frequency === 'daily' || frequency === 'weekly') data.frequency = frequency;
    if (typeof runAtUtc === 'string' && /^\d{2}:\d{2}$/.test(runAtUtc)) data.runAtUtc = runAtUtc;
    if (dayOfWeek === null || (Number.isInteger(dayOfWeek) && dayOfWeek >= 0 && dayOfWeek <= 6)) {
      data.dayOfWeek = dayOfWeek;
    }
    if (Number.isInteger(retentionDays) && retentionDays >= 1 && retentionDays <= 365) {
      data.retentionDays = retentionDays;
    }

    const schedule = await prisma.backupScheduleConfig.upsert({
      where: { scheduleKey: 'full_database' },
      create: {
        scheduleKey: 'full_database',
        enabled: data.enabled ?? false,
        frequency: data.frequency || 'daily',
        runAtUtc: data.runAtUtc || '02:00',
        dayOfWeek: data.dayOfWeek ?? null,
        retentionDays: data.retentionDays || DEFAULT_FULL_RETENTION_DAYS,
        updatedByUserId: req.user.id,
      },
      update: data,
    });

    await writeAudit({
      action: 'SCHEDULE_UPDATE',
      actorUserId: req.user.id,
      actorEmail: req.user.email,
      req,
      details: schedule,
    });

    return res.json({ success: true, data: { schedule } });
  } catch (err) {
    return clientError(res, err);
  }
}

/**
 * POST /api/admin/backups/run-scheduled
 * Invoked by Railway Cron / external scheduler with CRON_SECRET header.
 */
async function runScheduled(req, res) {
  try {
    const cronSecret = process.env.BACKUP_CRON_SECRET || process.env.CRON_SECRET;
    const provided = req.headers['x-cron-secret'] || req.headers['authorization']?.replace(/^Bearer\s+/i, '');
    const isCron = cronSecret && provided && provided === cronSecret;
    const isOwner = req.user && isPlatformOwnerEmail(req.user.email);

    if (!isCron && !isOwner) {
      return res.status(403).json({ success: false, message: 'Unauthorized scheduler call' });
    }

    const expired = await expireOldBackups();

    let config = await prisma.backupScheduleConfig.findUnique({ where: { scheduleKey: 'full_database' } });
    if (!config || !config.enabled) {
      return res.json({
        success: true,
        message: 'Schedule disabled or missing',
        data: { triggered: false, expired },
      });
    }

    // Time window check (UTC HH:mm, ±30 minutes) unless force=true
    const force = req.body?.force === true || req.query.force === '1';
    if (!force) {
      const now = new Date();
      const [hh, mm] = String(config.runAtUtc || '02:00').split(':').map(Number);
      const scheduledMinutes = hh * 60 + mm;
      const nowMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
      const delta = Math.abs(nowMinutes - scheduledMinutes);
      const inWindow = delta <= 30 || delta >= (24 * 60 - 30);
      if (config.frequency === 'weekly') {
        if (config.dayOfWeek != null && now.getUTCDay() !== config.dayOfWeek) {
          return res.json({ success: true, message: 'Not scheduled day', data: { triggered: false, expired } });
        }
      }
      if (!inWindow) {
        return res.json({ success: true, message: 'Outside schedule window', data: { triggered: false, expired } });
      }
      // Avoid double-run within 20 hours
      if (config.lastRunAt && Date.now() - new Date(config.lastRunAt).getTime() < 20 * 3600 * 1000) {
        return res.json({ success: true, message: 'Already ran recently', data: { triggered: false, expired } });
      }
    }

    const stamp = new Date().toISOString().slice(0, 10);
    const job = await prisma.backupJob.create({
      data: {
        backupType: 'FULL_DATABASE',
        status: 'QUEUED',
        name: `Scheduled Full Backup ${stamp}`,
        fileName: `Bisonstechs_FullDB_${stamp}.zip`,
        ownerEmail: 'scheduler@bisonstechs.system',
        progressMessage: 'Queued by scheduler',
        expiresAt: new Date(Date.now() + (config.retentionDays || DEFAULT_FULL_RETENTION_DAYS) * 86400000),
      },
    });

    await prisma.backupScheduleConfig.update({
      where: { id: config.id },
      data: { lastRunAt: new Date(), lastRunBackupId: job.id },
    });

    enqueueJobProcessing(job.id);

    return res.status(202).json({
      success: true,
      message: 'Scheduled full backup queued',
      data: { triggered: true, jobId: job.id, expired },
    });
  } catch (err) {
    return clientError(res, err);
  }
}

module.exports = {
  createFullBackup,
  listAdminBackups,
  getAdminBackup,
  downloadAdminBackup,
  restoreAdminBackup,
  deleteAdminBackup,
  getSchedule,
  updateSchedule,
  runScheduled,
};
