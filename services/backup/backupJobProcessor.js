'use strict';

const prisma = require('../../prisma/client');
const { processCompanyBackup } = require('./companyBackupService');
const { processFullDatabaseBackup } = require('./fullDatabaseBackupService');
const storage = require('./backupObjectStorage');

let processing = false;
const inflight = new Set();

async function markFailed(jobId, err) {
  const message = err?.message || String(err);
  console.error(`[backupJobProcessor] job ${jobId} failed:`, message);
  await prisma.backupJob.update({
    where: { id: jobId },
    data: {
      status: 'FAILED',
      errorMessage: message.slice(0, 4000),
      progressMessage: 'Backup failed',
      completedAt: new Date(),
    },
  }).catch(() => {});
}

async function processJob(jobId) {
  if (inflight.has(jobId)) return;
  inflight.add(jobId);
  try {
    const claimed = await prisma.backupJob.updateMany({
      where: { id: jobId, status: 'QUEUED' },
      data: {
        status: 'PROCESSING',
        startedAt: new Date(),
        progressPercent: 1,
        progressMessage: 'Starting backup',
        errorMessage: null,
      },
    });
    if (!claimed.count) return;

    const job = await prisma.backupJob.findUnique({ where: { id: jobId } });
    if (!job) return;

    if (job.backupType === 'FULL_DATABASE') {
      await processFullDatabaseBackup(jobId);
    } else if (job.backupType === 'COMPANY') {
      await processCompanyBackup(jobId);
    } else {
      throw new Error(`Unknown backup type: ${job.backupType}`);
    }
  } catch (err) {
    await markFailed(jobId, err);
  } finally {
    inflight.delete(jobId);
  }
}

/**
 * Fire-and-forget kick from HTTP handlers (does not block the response).
 */
function enqueueJobProcessing(jobId) {
  setImmediate(() => {
    processJob(jobId).catch((err) => {
      console.error('[backupJobProcessor] unexpected error', err);
    });
  });
}

/**
 * Poll queued jobs — used by dedicated worker process.
 */
async function pollOnce(limit = 2) {
  if (processing) return { skipped: true };
  processing = true;
  try {
    const jobs = await prisma.backupJob.findMany({
      where: { status: 'QUEUED' },
      orderBy: { createdAt: 'asc' },
      take: limit,
      select: { id: true },
    });
    for (const job of jobs) {
      await processJob(job.id);
    }
    return { processed: jobs.length };
  } finally {
    processing = false;
  }
}

async function expireOldBackups() {
  const now = new Date();
  const expired = await prisma.backupJob.findMany({
    where: {
      status: 'COMPLETED',
      expiresAt: { lte: now },
      storageKey: { not: null },
    },
    take: 50,
    select: { id: true, storageKey: true },
  });

  let deleted = 0;
  for (const job of expired) {
    try {
      if (job.storageKey) await storage.deleteObject(job.storageKey);
      await prisma.backupJob.update({
        where: { id: job.id },
        data: {
          storageKey: null,
          status: 'FAILED',
          errorMessage: 'Expired and removed by retention policy',
          progressMessage: 'Expired',
        },
      });
      await prisma.backupAuditLog.create({
        data: {
          backupJobId: job.id,
          action: 'EXPIRE',
          details: { reason: 'retention_policy' },
        },
      }).catch(() => {});
      deleted += 1;
    } catch (err) {
      console.error('[backupJobProcessor] expire failed', job.id, err.message);
    }
  }
  return { deleted };
}

function serializeJob(job) {
  if (!job) return null;
  return {
    ...job,
    fileSizeBytes: job.fileSizeBytes != null ? Number(job.fileSizeBytes) : null,
    companies: job.companies || undefined,
  };
}

module.exports = {
  processJob,
  enqueueJobProcessing,
  pollOnce,
  expireOldBackups,
  serializeJob,
};
