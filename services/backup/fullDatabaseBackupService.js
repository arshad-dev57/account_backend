'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const archiver = require('archiver');
const prisma = require('../../prisma/client');
const { resolveDatabaseUrl } = require('../../utils/databaseUrl');
const {
  BACKUP_FORMAT_VERSION,
  ERP_VERSION,
  DEFAULT_FULL_RETENTION_DAYS,
  BACKUP_SYSTEM_TABLES,
} = require('./backupConstants');
const storage = require('./backupObjectStorage');
const { sha256File, tmpDir } = require('./companyBackupService');
const { quoteIdent, serializeRow } = require('./companyDataGraph');

async function updateProgress(jobId, percent, message) {
  await prisma.backupJob.update({
    where: { id: jobId },
    data: {
      progressPercent: Math.max(0, Math.min(100, percent)),
      progressMessage: message || null,
    },
  });
}

function parsePgConnection(urlString) {
  const u = new URL(urlString);
  const host = u.hostname;
  const isLocal = host === 'localhost' || host === '127.0.0.1' || host === '::1';
  const sslmode = u.searchParams.get('sslmode')
    || (isLocal ? 'disable' : 'require');
  return {
    host,
    port: u.port || '5432',
    user: decodeURIComponent(u.username || ''),
    password: decodeURIComponent(u.password || ''),
    database: u.pathname.replace(/^\//, '').split('?')[0],
    sslmode,
  };
}

function findPgDump() {
  const candidates = [
    process.env.PG_DUMP_PATH,
    'pg_dump',
    '/opt/homebrew/opt/libpq/bin/pg_dump',
    '/usr/local/bin/pg_dump',
    '/usr/bin/pg_dump',
  ].filter(Boolean);

  for (const bin of candidates) {
    try {
      // eslint-disable-next-line global-require
      const { execFileSync } = require('child_process');
      execFileSync(bin, ['--version'], { stdio: 'pipe' });
      return bin;
    } catch {
      // try next
    }
  }
  return null;
}

function runPgDump(pgDumpBin, conn, outFile) {
  return new Promise((resolve, reject) => {
    const args = [
      '--format=custom',
      '--compress=6',
      '--no-owner',
      '--no-acl',
      '--dbname', conn.database,
      '--host', conn.host,
      '--port', String(conn.port),
      '--username', conn.user,
      '--file', outFile,
    ];
    const child = spawn(pgDumpBin, args, {
      env: {
        ...process.env,
        PGPASSWORD: conn.password,
        PGSSLMODE: conn.sslmode || 'require',
      },
    });
    let stderr = '';
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`pg_dump exited ${code}: ${stderr.slice(0, 2000)}`));
    });
  });
}

/**
 * Fallback logical dump when pg_dump is unavailable (e.g. slim Railway image).
 * Streams all public tables into JSONL files inside a ZIP.
 */
async function logicalFullDump(workDir, onProgress) {
  const databaseDir = path.join(workDir, 'database');
  await fsp.mkdir(databaseDir, { recursive: true });

  const tables = await prisma.$queryRawUnsafe(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `);

  const recordCounts = {};
  const tableNames = tables
    .map((t) => t.table_name)
    .filter((n) => !BACKUP_SYSTEM_TABLES.has(n));

  let i = 0;
  for (const table of tableNames) {
    i += 1;
    if (onProgress) {
      await onProgress(Math.floor((i / tableNames.length) * 80), `Dumping ${table}`);
    }
    const outFile = path.join(databaseDir, `${table}.jsonl`);
    const writeStream = fs.createWriteStream(outFile);
    let count = 0;
    let lastId = null;
    const pageSize = 1000;

    // Detect id column
    const cols = await prisma.$queryRawUnsafe(`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema='public' AND table_name=$1
    `, table);
    const colNames = cols.map((c) => c.column_name);
    const hasId = colNames.includes('id');
    const selectList = colNames.map(quoteIdent).join(', ');

    for (;;) {
      let rows;
      if (hasId) {
        rows = lastId
          ? await prisma.$queryRawUnsafe(
            `SELECT ${selectList} FROM ${quoteIdent(table)} WHERE id > $1 ORDER BY id LIMIT ${pageSize}`,
            lastId
          )
          : await prisma.$queryRawUnsafe(
            `SELECT ${selectList} FROM ${quoteIdent(table)} ORDER BY id LIMIT ${pageSize}`
          );
      } else {
        rows = await prisma.$queryRawUnsafe(
          `SELECT ${selectList} FROM ${quoteIdent(table)} LIMIT ${pageSize} OFFSET ${count}`
        );
      }
      if (!rows.length) break;
      for (const row of rows) {
        // Strip secrets from users
        const serialized = serializeRow(row);
        if (table === 'users') {
          delete serialized.password;
          delete serialized.reset_otp;
          delete serialized.reset_otp_expiry;
          delete serialized.login_otp;
          delete serialized.login_otp_expiry;
        }
        writeStream.write(`${JSON.stringify(serialized)}\n`);
      }
      count += rows.length;
      if (hasId) lastId = rows[rows.length - 1].id;
      if (rows.length < pageSize) break;
    }

    await new Promise((resolve, reject) => {
      writeStream.end(() => resolve());
      writeStream.on('error', reject);
    });

    if (count === 0) {
      await fsp.unlink(outFile).catch(() => {});
    } else {
      recordCounts[table] = count;
    }
  }

  return { recordCounts, mode: 'logical-jsonl' };
}

async function processFullDatabaseBackup(jobId) {
  const job = await prisma.backupJob.findUnique({ where: { id: jobId } });
  if (!job) throw new Error(`Backup job ${jobId} not found`);

  const workDir = path.join(tmpDir(), jobId);
  await fsp.mkdir(workDir, { recursive: true });

  try {
    await updateProgress(jobId, 5, 'Preparing full database backup');

    const dbUrl = process.env.DIRECT_URL || resolveDatabaseUrl();
    const pgDumpBin = findPgDump();
    let dumpMode = 'pg_dump-custom';
    let dumpArtifact = null;
    let recordCounts = null;

    if (pgDumpBin) {
      await updateProgress(jobId, 10, `Running pg_dump (${pgDumpBin})`);
      const dumpFile = path.join(workDir, 'database.dump');
      const conn = parsePgConnection(dbUrl);
      await runPgDump(pgDumpBin, conn, dumpFile);
      dumpArtifact = { type: 'pg_dump', path: dumpFile, name: 'database/database.dump' };
      dumpMode = 'pg_dump-custom';
      await updateProgress(jobId, 75, 'pg_dump completed');
    } else {
      await updateProgress(jobId, 10, 'pg_dump unavailable — using logical JSONL dump');
      const logical = await logicalFullDump(workDir, (pct, msg) => updateProgress(jobId, 10 + Math.floor(pct * 0.65), msg));
      recordCounts = logical.recordCounts;
      dumpMode = logical.mode;
      dumpArtifact = { type: 'directory', path: path.join(workDir, 'database'), name: 'database' };
    }

    const createdAt = new Date().toISOString();
    const fileName = job.fileName
      || `Bisonstechs_FullDB_${createdAt.slice(0, 10)}_${jobId.slice(0, 8)}.zip`;
    const zipPath = path.join(workDir, fileName);

    const companyCount = await prisma.company.count();
    const manifest = {
      format: 'bisonstechs-full-database-backup',
      formatVersion: BACKUP_FORMAT_VERSION,
      erpVersion: ERP_VERSION,
      backupType: 'FULL_DATABASE',
      backupId: jobId,
      createdAt,
      dumpMode,
      companyCount,
      recordCounts,
      integrity: { algorithm: 'sha256', checksum: null },
      neonNote:
        'Application-level full backups complement Neon PITR / branching. Prefer Neon provider recovery for disaster scenarios.',
    };
    const metadata = {
      name: job.name,
      ownerEmail: job.ownerEmail,
      dumpMode,
      pgDumpAvailable: Boolean(pgDumpBin),
    };

    await fsp.writeFile(path.join(workDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
    await fsp.writeFile(path.join(workDir, 'backup-metadata.json'), JSON.stringify(metadata, null, 2));

    await updateProgress(jobId, 85, 'Compressing archive');
    await new Promise((resolve, reject) => {
      const output = fs.createWriteStream(zipPath);
      const archive = archiver('zip', { zlib: { level: 6 } });
      output.on('close', resolve);
      archive.on('error', reject);
      archive.pipe(output);
      archive.file(path.join(workDir, 'manifest.json'), { name: 'manifest.json' });
      archive.file(path.join(workDir, 'backup-metadata.json'), { name: 'backup-metadata.json' });
      if (dumpArtifact.type === 'pg_dump') {
        archive.file(dumpArtifact.path, { name: dumpArtifact.name });
      } else {
        archive.directory(dumpArtifact.path, dumpArtifact.name);
      }
      archive.finalize();
    });

    const checksum = await sha256File(zipPath);
    manifest.integrity.checksum = checksum;
    await fsp.writeFile(path.join(workDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

    // Re-zip with checksum in manifest
    await new Promise((resolve, reject) => {
      const output = fs.createWriteStream(zipPath);
      const archive = archiver('zip', { zlib: { level: 6 } });
      output.on('close', resolve);
      archive.on('error', reject);
      archive.pipe(output);
      archive.file(path.join(workDir, 'manifest.json'), { name: 'manifest.json' });
      archive.file(path.join(workDir, 'backup-metadata.json'), { name: 'backup-metadata.json' });
      if (dumpArtifact.type === 'pg_dump') {
        archive.file(dumpArtifact.path, { name: dumpArtifact.name });
      } else {
        archive.directory(dumpArtifact.path, dumpArtifact.name);
      }
      archive.finalize();
    });

    const finalChecksum = await sha256File(zipPath);
    const storageKey = `full/${jobId}/${fileName}`;
    await updateProgress(jobId, 95, 'Uploading to secure storage');
    const uploaded = await storage.uploadFile(zipPath, storageKey, 'application/zip');

    const retentionDays = DEFAULT_FULL_RETENTION_DAYS;
    const expiresAt = new Date(Date.now() + retentionDays * 24 * 60 * 60 * 1000);

    await prisma.backupJob.update({
      where: { id: jobId },
      data: {
        status: 'COMPLETED',
        progressPercent: 100,
        progressMessage: 'Full database backup completed',
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
    try {
      await fsp.rm(workDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
}

module.exports = {
  processFullDatabaseBackup,
  findPgDump,
  parsePgConnection,
};
