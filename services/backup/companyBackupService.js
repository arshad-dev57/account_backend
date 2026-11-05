'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const archiver = require('archiver');
const prisma = require('../../prisma/client');
const {
  BACKUP_FORMAT_VERSION,
  ERP_VERSION,
  DEFAULT_COMPANY_RETENTION_DAYS,
} = require('./backupConstants');
const {
  listTenantedTables,
  listChildTablesViaFk,
  exportTenantedTable,
  exportChildTable,
  exportCompanyRows,
  exportMemberships,
} = require('./companyDataGraph');
const storage = require('./backupObjectStorage');

function tmpDir() {
  return process.env.BACKUP_TMP_DIR || path.join(__dirname, '..', '..', 'tmp', 'backups');
}

async function updateProgress(jobId, percent, message) {
  await prisma.backupJob.update({
    where: { id: jobId },
    data: {
      progressPercent: Math.max(0, Math.min(100, percent)),
      progressMessage: message || null,
    },
  });
}

function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

/**
 * Build a company-wise ZIP backup for the given BackupJob.
 */
async function processCompanyBackup(jobId) {
  const job = await prisma.backupJob.findUnique({
    where: { id: jobId },
    include: { companies: true },
  });
  if (!job) throw new Error(`Backup job ${jobId} not found`);

  const companyIds = job.companies.map((c) => c.companyId);
  if (!companyIds.length) throw new Error('No companies selected for backup');

  const workDir = path.join(tmpDir(), jobId);
  await fsp.mkdir(workDir, { recursive: true });
  const zipPath = path.join(workDir, job.fileName || `Bisonstechs_Backup_${jobId}.zip`);

  try {
    await updateProgress(jobId, 5, 'Discovering company data graph');
    const tenantedTables = await listTenantedTables();
    const childLinks = await listChildTablesViaFk();

    // Deduplicate child tables (same child may link to multiple parents)
    const childByTable = new Map();
    for (const link of childLinks) {
      if (!childByTable.has(link.childTable)) {
        childByTable.set(link.childTable, link);
      }
    }

    const companiesData = await exportCompanyRows(companyIds);
    const memberships = await exportMemberships(companyIds);

    const recordCounts = {};
    const tableFiles = []; // { relativePath, absolutePath, count }

    // Per-company folders for company rows; shared data tables under /database
    const companiesDir = path.join(workDir, 'companies');
    await fsp.mkdir(companiesDir, { recursive: true });
    const databaseDir = path.join(workDir, 'database');
    await fsp.mkdir(databaseDir, { recursive: true });

    for (const company of companiesData) {
      const folder = path.join(companiesDir, company.id);
      await fsp.mkdir(folder, { recursive: true });
      const metaPath = path.join(folder, 'company.json');
      await fsp.writeFile(metaPath, JSON.stringify(company, null, 2));
    }

    await fsp.writeFile(
      path.join(databaseDir, 'company_memberships.jsonl'),
      memberships.map((r) => JSON.stringify(r)).join('\n') + (memberships.length ? '\n' : '')
    );
    recordCounts.company_memberships = memberships.length;

    await updateProgress(jobId, 15, `Exporting ${tenantedTables.length} tenanted tables`);

    let done = 0;
    const totalSteps = tenantedTables.length + childByTable.size + 2;

    for (const table of tenantedTables) {
      // Skip companies (already written per-folder) — still export as consolidated
      const outFile = path.join(databaseDir, `${table}.jsonl`);
      const writeStream = fs.createWriteStream(outFile, { flags: 'w' });
      let count = 0;
      await exportTenantedTable(table, companyIds, async (batch) => {
        for (const row of batch) {
          writeStream.write(`${JSON.stringify(row)}\n`);
        }
        count += batch.length;
      });
      await new Promise((resolve, reject) => {
        writeStream.end(() => resolve());
        writeStream.on('error', reject);
      });
      if (count === 0) {
        await fsp.unlink(outFile).catch(() => {});
      } else {
        tableFiles.push({ table, path: outFile, count });
        recordCounts[table] = count;
      }
      done += 1;
      const pct = 15 + Math.floor((done / totalSteps) * 70);
      await updateProgress(jobId, pct, `Exported ${table} (${count} rows)`);
    }

    await updateProgress(jobId, 80, 'Exporting related child tables');
    for (const [childTable, link] of childByTable.entries()) {
      if (recordCounts[childTable] != null) continue; // already exported as tenanted
      const outFile = path.join(databaseDir, `${childTable}.jsonl`);
      const writeStream = fs.createWriteStream(outFile, { flags: 'w' });
      let count = 0;
      await exportChildTable(link, companyIds, async (batch) => {
        for (const row of batch) {
          writeStream.write(`${JSON.stringify(row)}\n`);
        }
        count += batch.length;
      });
      await new Promise((resolve, reject) => {
        writeStream.end(() => resolve());
        writeStream.on('error', reject);
      });
      if (count === 0) {
        await fsp.unlink(outFile).catch(() => {});
      } else {
        tableFiles.push({ table: childTable, path: outFile, count });
        recordCounts[childTable] = count;
      }
      done += 1;
      const pct = 15 + Math.floor((done / totalSteps) * 70);
      await updateProgress(jobId, pct, `Exported ${childTable} (${count} rows)`);
    }

    const createdAt = new Date().toISOString();
    const companyMeta = job.companies.map((c) => ({
      id: c.companyId,
      name: c.companyName,
    }));

    const manifest = {
      format: 'bisonstechs-company-backup',
      formatVersion: BACKUP_FORMAT_VERSION,
      erpVersion: ERP_VERSION,
      backupType: 'COMPANY',
      backupId: jobId,
      createdAt,
      companies: companyMeta,
      tables: Object.keys(recordCounts).sort(),
      recordCounts,
      integrity: {
        algorithm: 'sha256',
        checksum: null, // filled after zip
      },
    };

    const metadata = {
      name: job.name,
      ownerUserId: job.ownerUserId,
      ownerEmail: job.ownerEmail,
      selectedCompanyIds: companyIds,
      selectedCompanyNames: companyMeta.map((c) => c.name),
      isPreRestoreSnapshot: job.isPreRestoreSnapshot,
      parentBackupId: job.parentBackupId,
      notes: [
        'Passwords and OTP secrets are excluded from user records.',
        'Original IDs and foreign keys are preserved.',
        'Restore requires authorization for each company in this archive.',
      ],
    };

    await fsp.writeFile(path.join(workDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
    await fsp.writeFile(path.join(workDir, 'backup-metadata.json'), JSON.stringify(metadata, null, 2));

    await updateProgress(jobId, 90, 'Compressing ZIP archive');

    await new Promise((resolve, reject) => {
      const output = fs.createWriteStream(zipPath);
      const archive = archiver('zip', { zlib: { level: 6 } });
      output.on('close', resolve);
      archive.on('error', reject);
      archive.pipe(output);
      archive.file(path.join(workDir, 'manifest.json'), { name: 'manifest.json' });
      archive.file(path.join(workDir, 'backup-metadata.json'), { name: 'backup-metadata.json' });
      archive.directory(companiesDir, 'companies');
      archive.directory(databaseDir, 'database');
      archive.finalize();
    });

    const checksum = await sha256File(zipPath);
    manifest.integrity.checksum = checksum;
    await fsp.writeFile(path.join(workDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

    // Rebuild zip with final checksum in manifest (small overhead, ensures integrity field is present)
    await new Promise((resolve, reject) => {
      const output = fs.createWriteStream(zipPath);
      const archive = archiver('zip', { zlib: { level: 6 } });
      output.on('close', resolve);
      archive.on('error', reject);
      archive.pipe(output);
      archive.file(path.join(workDir, 'manifest.json'), { name: 'manifest.json' });
      archive.file(path.join(workDir, 'backup-metadata.json'), { name: 'backup-metadata.json' });
      archive.directory(companiesDir, 'companies');
      archive.directory(databaseDir, 'database');
      archive.finalize();
    });

    const finalChecksum = await sha256File(zipPath);
    const fileName = job.fileName
      || `Bisonstechs_Backup_${createdAt.slice(0, 10)}_${jobId.slice(0, 8)}.zip`;
    const storageKey = `company/${job.ownerUserId || 'system'}/${jobId}/${fileName}`;

    await updateProgress(jobId, 95, 'Uploading to secure storage');
    const uploaded = await storage.uploadFile(zipPath, storageKey, 'application/zip');

    const retentionDays = DEFAULT_COMPANY_RETENTION_DAYS;
    const expiresAt = new Date(Date.now() + retentionDays * 24 * 60 * 60 * 1000);

    // Update per-company record counts on BackupCompany rows
    for (const bc of job.companies) {
      await prisma.backupCompany.update({
        where: { id: bc.id },
        data: { recordCounts },
      });
    }

    await prisma.backupJob.update({
      where: { id: jobId },
      data: {
        status: 'COMPLETED',
        progressPercent: 100,
        progressMessage: 'Backup completed',
        storageKey: uploaded.key,
        storageProvider: uploaded.provider,
        fileName,
        fileSizeBytes: BigInt(uploaded.sizeBytes),
        checksumSha256: finalChecksum,
        manifestJson: { ...manifest, integrity: { algorithm: 'sha256', checksum: finalChecksum } },
        metadataJson: metadata,
        completedAt: new Date(),
        expiresAt,
        errorMessage: null,
      },
    });

    return { jobId, storageKey: uploaded.key, sizeBytes: uploaded.sizeBytes, checksum: finalChecksum };
  } finally {
    // Cleanup temp files (keep zip briefly until uploaded — remove workDir)
    try {
      await fsp.rm(workDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  }
}

module.exports = {
  processCompanyBackup,
  sha256File,
  tmpDir,
};
