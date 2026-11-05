'use strict';

/**
 * Smoke test for backup system (non-production).
 * Requires DATABASE_URL / DIRECT_URL and an existing company + admin user.
 *
 * Usage:
 *   BACKUP_SMOKE_EMAIL=admin@example.com BACKUP_SMOKE_PASSWORD=secret node scripts/test-backup-smoke.js
 *
 * Or with existing JWT:
 *   BACKUP_SMOKE_TOKEN=eyJ... node scripts/test-backup-smoke.js
 */

require('dotenv').config();
const prisma = require('../prisma/client');
const { processJob } = require('../services/backup/backupJobProcessor');
const { validateBackupJobFile } = require('../services/backup/companyRestoreService');
const storage = require('../services/backup/backupObjectStorage');

async function main() {
  console.log('[smoke] storage provider:', storage.configuredProvider());

  const company = await prisma.company.findFirst({
    where: { isActive: true },
    select: { id: true, name: true },
  });
  if (!company) {
    throw new Error('No active company found — seed data required');
  }

  const owner = await prisma.user.findFirst({
    where: {
      OR: [
        { companyId: company.id, role: { in: ['admin', 'owner', 'superadmin', 'company_admin'] } },
        { memberships: { some: { companyId: company.id, isActive: true } } },
      ],
    },
    select: { id: true, email: true },
  });
  if (!owner) throw new Error('No admin-like user for company');

  console.log('[smoke] company:', company.name, company.id);
  console.log('[smoke] owner:', owner.email);

  const job = await prisma.backupJob.create({
    data: {
      backupType: 'COMPANY',
      status: 'QUEUED',
      name: `Smoke test ${new Date().toISOString()}`,
      fileName: `smoke_${Date.now()}.zip`,
      ownerUserId: owner.id,
      ownerEmail: owner.email,
      ownerCompanyId: company.id,
      companies: {
        create: [{ companyId: company.id, companyName: company.name }],
      },
    },
  });

  console.log('[smoke] created job', job.id);
  await processJob(job.id);

  const done = await prisma.backupJob.findUnique({ where: { id: job.id } });
  console.log('[smoke] status:', done.status, done.progressMessage);
  if (done.status !== 'COMPLETED') {
    throw new Error(`Backup failed: ${done.errorMessage}`);
  }
  console.log('[smoke] size bytes:', String(done.fileSizeBytes));
  console.log('[smoke] checksum:', done.checksumSha256);

  const validation = await validateBackupJobFile(job.id);
  console.log('[smoke] validation:', validation.valid ? 'OK' : validation);

  if (!validation.valid) {
    throw new Error('Checksum/format validation failed');
  }

  console.log('[smoke] SUCCESS — company backup created, stored, and validated');
  console.log('[smoke] Download via GET /api/backups/' + job.id + '/download (authenticated)');
  process.exit(0);
}

main().catch((err) => {
  console.error('[smoke] FAILED', err);
  process.exit(1);
});
