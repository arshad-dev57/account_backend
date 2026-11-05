'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const AdmZip = require('adm-zip');
const prisma = require('../../prisma/client');
const storage = require('./backupObjectStorage');
const { BACKUP_FORMAT_VERSION } = require('./backupConstants');
const { quoteIdent, listColumns } = require('./companyDataGraph');
const { tmpDir, sha256File } = require('./companyBackupService');
function assertSafeTableName(name) {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
    throw new Error(`Unsafe table name in backup: ${name}`);
  }
  return name;
}

function assertSafeZipPath(entryName) {
  const normalized = path.posix.normalize(entryName).replace(/^(\.\.(\/|\\|$))+/, '');
  if (normalized.includes('..') || path.isAbsolute(normalized) || normalized.startsWith('/')) {
    throw new Error(`Unsafe ZIP entry path: ${entryName}`);
  }
  return normalized;
}

async function extractBackupZip(localZipPath, destDir) {
  const zip = new AdmZip(localZipPath);
  const entries = zip.getEntries();
  await fsp.mkdir(destDir, { recursive: true });

  for (const entry of entries) {
    const safeName = assertSafeZipPath(entry.entryName);
    const target = path.join(destDir, safeName);
    if (entry.isDirectory) {
      await fsp.mkdir(target, { recursive: true });
      continue;
    }
    await fsp.mkdir(path.dirname(target), { recursive: true });
    // Prevent zip-slip
    const resolved = path.resolve(target);
    if (!resolved.startsWith(path.resolve(destDir) + path.sep) && resolved !== path.resolve(destDir)) {
      throw new Error(`ZIP path traversal blocked: ${entry.entryName}`);
    }
    await fsp.writeFile(resolved, entry.getData());
  }
}

async function validateExtractedBackup(extractDir) {
  const manifestPath = path.join(extractDir, 'manifest.json');
  const metaPath = path.join(extractDir, 'backup-metadata.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error('Invalid backup: missing manifest.json');
  }
  const manifest = JSON.parse(await fsp.readFile(manifestPath, 'utf8'));
  if (manifest.format !== 'bisonstechs-company-backup') {
    throw new Error(`Unsupported backup format: ${manifest.format || 'unknown'}`);
  }
  if (!manifest.formatVersion) {
    throw new Error('Invalid backup: missing formatVersion');
  }
  // Forward-compatible: accept 1.x
  if (!String(manifest.formatVersion).startsWith('1.')) {
    throw new Error(`Backup format version ${manifest.formatVersion} is not supported by this ERP (expects ${BACKUP_FORMAT_VERSION})`);
  }
  let metadata = null;
  if (fs.existsSync(metaPath)) {
    metadata = JSON.parse(await fsp.readFile(metaPath, 'utf8'));
  }
  return { manifest, metadata };
}

/**
 * Soft-wipe company operational data while preserving the company row.
 * Uses the same FK-aware loops as wipeEntireCompany, but skips final company delete.
 */
async function wipeCompanyDataKeepShell(companyId) {
  const id = String(companyId);
  await prisma.$executeRawUnsafe(`
    DO $wipe$
    DECLARE
      cid text := '${id.replace(/'/g, "''")}';
      rec RECORD;
      pass int := 0;
      deleted bigint;
      total_deleted bigint;
    BEGIN
      BEGIN
        PERFORM set_config('statement_timeout', '0', true);
      EXCEPTION WHEN OTHERS THEN NULL;
      END;

      LOOP
        pass := pass + 1;
        total_deleted := 0;

        FOR rec IN
          SELECT src.relname AS child_table, att.attname AS child_col, tgt.relname AS parent_table
          FROM pg_constraint con
          JOIN pg_class src ON src.oid = con.conrelid
          JOIN pg_class tgt ON tgt.oid = con.confrelid
          JOIN pg_namespace nsp ON nsp.oid = src.relnamespace
          JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = ANY (con.conkey)
          JOIN information_schema.columns pc
            ON pc.table_schema = 'public' AND pc.table_name = tgt.relname AND pc.column_name = 'company_id'
          WHERE con.contype = 'f' AND nsp.nspname = 'public'
            AND src.relname NOT IN ('users', 'companies', 'backup_jobs', 'backup_companies', 'backup_audit_logs', 'backup_schedule_configs')
        LOOP
          BEGIN
            EXECUTE format(
              'DELETE FROM %I WHERE %I IN (SELECT id FROM %I WHERE company_id = %L)',
              rec.child_table, rec.child_col, rec.parent_table, cid::text
            );
            GET DIAGNOSTICS deleted = ROW_COUNT;
            total_deleted := total_deleted + deleted;
          EXCEPTION WHEN OTHERS THEN NULL;
          END;
        END LOOP;

        FOR rec IN
          SELECT c.table_name
          FROM information_schema.columns c
          JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
          WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE'
            AND c.column_name = 'company_id'
            AND c.table_name NOT IN ('users', 'companies', 'backup_jobs', 'backup_companies', 'company_memberships', 'backup_audit_logs', 'backup_schedule_configs')
        LOOP
          BEGIN
            EXECUTE format('DELETE FROM %I WHERE company_id = %L', rec.table_name, cid::text);
            GET DIAGNOSTICS deleted = ROW_COUNT;
            total_deleted := total_deleted + deleted;
          EXCEPTION WHEN OTHERS THEN NULL;
          END;
        END LOOP;

        EXIT WHEN pass >= 60 OR total_deleted = 0;
      END LOOP;

      BEGIN
        DELETE FROM company_memberships WHERE company_id = cid;
      EXCEPTION WHEN OTHERS THEN NULL;
      END;
    END
    $wipe$;
  `);
}

function deserializeValue(v, colMeta) {
  if (v === null || v === undefined) return null;
  if (v && typeof v === 'object' && v.__type === 'Buffer' && typeof v.data === 'string') {
    return Buffer.from(v.data, 'base64');
  }

  const dt = String(colMeta?.dataType || '').toLowerCase();
  const udt = String(colMeta?.udtName || '').toLowerCase();

  if (dt.includes('timestamp') || dt === 'date' || udt.startsWith('timestamp') || udt === 'date') {
    if (v instanceof Date) return v;
    if (typeof v === 'string' || typeof v === 'number') {
      const d = new Date(v);
      if (!Number.isNaN(d.getTime())) return d;
    }
  }

  if (dt === 'boolean' || udt === 'bool') {
    if (typeof v === 'boolean') return v;
    if (v === 'true' || v === 't' || v === 1 || v === '1') return true;
    if (v === 'false' || v === 'f' || v === 0 || v === '0') return false;
  }

  if ((dt === 'integer' || dt === 'bigint' || dt === 'numeric' || dt === 'double precision' || dt === 'real'
    || udt === 'int4' || udt === 'int8' || udt === 'numeric' || udt === 'float8' || udt === 'float4')
    && typeof v === 'string' && v !== '' && !Number.isNaN(Number(v))) {
    return dt === 'bigint' || udt === 'int8' ? BigInt(v) : Number(v);
  }

  if ((dt === 'json' || dt === 'jsonb' || udt === 'json' || udt === 'jsonb') && typeof v === 'string') {
    try { return JSON.parse(v); } catch { return v; }
  }

  return v;
}

function sqlCastSuffix(colMeta) {
  const dt = String(colMeta?.dataType || '').toLowerCase();
  const udt = String(colMeta?.udtName || '').toLowerCase();
  if (dt.includes('timestamp') || udt.startsWith('timestamp')) return '::timestamptz';
  if (dt === 'date' || udt === 'date') return '::date';
  if (dt === 'jsonb' || udt === 'jsonb') return '::jsonb';
  if (dt === 'json' || udt === 'json') return '::json';
  if (dt === 'boolean' || udt === 'bool') return '::boolean';
  if (udt === 'uuid') return '::uuid';
  return '';
}

/**
 * Insert one row. Returns 'ok' | 'skip' | 'retry'
 * - skip: permanent (e.g. missing columns)
 * - retry: FK / transient — try again in a later pass
 */
async function insertOneRow(tableName, raw, colMetaByName, colSet, hasId, { quiet } = {}) {
  const row = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!colSet.has(k)) continue;
    row[k] = deserializeValue(v, colMetaByName.get(k));
  }

  if (tableName === 'users') {
    if (!row.password) {
      row.password = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 10);
    }
    delete row.reset_otp;
    delete row.reset_otp_expiry;
    delete row.login_otp;
    delete row.login_otp_expiry;
  }

  const keys = Object.keys(row);
  if (!keys.length) return 'skip';

  const colSql = keys.map(quoteIdent).join(', ');
  const placeholders = keys.map((k, i) => `$${i + 1}${sqlCastSuffix(colMetaByName.get(k))}`).join(', ');
  const values = keys.map((k) => row[k]);

  try {
    if (hasId && row.id) {
      const updateKeys = keys.filter((k) => k !== 'id');
      const updates = updateKeys
        .map((k) => `${quoteIdent(k)} = EXCLUDED.${quoteIdent(k)}`)
        .join(', ');
      if (updates) {
        await prisma.$executeRawUnsafe(
          `INSERT INTO ${quoteIdent(tableName)} (${colSql}) VALUES (${placeholders})
           ON CONFLICT (id) DO UPDATE SET ${updates}`,
          ...values
        );
      } else {
        await prisma.$executeRawUnsafe(
          `INSERT INTO ${quoteIdent(tableName)} (${colSql}) VALUES (${placeholders})
           ON CONFLICT (id) DO NOTHING`,
          ...values
        );
      }
    } else {
      await prisma.$executeRawUnsafe(
        `INSERT INTO ${quoteIdent(tableName)} (${colSql}) VALUES (${placeholders})
         ON CONFLICT DO NOTHING`,
        ...values
      );
    }
    return 'ok';
  } catch (err) {
    const msg = String(err?.message || err);
    const isFk = msg.includes('23503') || /foreign key/i.test(msg);
    const isNotNull = msg.includes('23502');
    if (isFk || isNotNull) return 'retry';
    try {
      await prisma.$executeRawUnsafe(
        `INSERT INTO ${quoteIdent(tableName)} (${colSql}) VALUES (${placeholders})`,
        ...values
      );
      return 'ok';
    } catch (err2) {
      const msg2 = String(err2?.message || err2);
      if (msg2.includes('23503') || /foreign key/i.test(msg2) || msg2.includes('23502')) {
        return 'retry';
      }
      if (!quiet) {
        console.warn(`[companyRestore] skip row in ${tableName}:`, msg2.slice(0, 200));
      }
      return 'skip';
    }
  }
}

async function upsertRows(tableName, rows, opts = {}) {
  if (!rows.length) return { inserted: 0, pending: [] };
  assertSafeTableName(tableName);
  const columns = await listColumns(tableName);
  const colMetaByName = new Map(columns.map((c) => [c.name, c]));
  const colSet = new Set(columns.map((c) => c.name));
  const hasId = colSet.has('id');

  let inserted = 0;
  const pending = [];
  for (const raw of rows) {
    const result = await insertOneRow(tableName, raw, colMetaByName, colSet, hasId, opts);
    if (result === 'ok') inserted += 1;
    else if (result === 'retry') pending.push(raw);
  }
  return { inserted, pending };
}

/** Nullable FK columns for a table (used to relax optional refs on late restore passes). */
async function listNullableFkColumns(tableName) {
  const rows = await prisma.$queryRawUnsafe(`
    SELECT att.attname AS col
    FROM pg_constraint c
    JOIN pg_attribute att
      ON att.attrelid = c.conrelid
     AND att.attnum = ANY (c.conkey)
    JOIN pg_class cls ON cls.oid = c.conrelid
    JOIN pg_namespace nsp ON nsp.oid = cls.relnamespace
    WHERE c.contype = 'f'
      AND nsp.nspname = 'public'
      AND cls.relname = $1
      AND NOT att.attnotnull
  `, tableName);
  return rows.map((r) => r.col);
}

/**
 * Multi-pass insert to resolve FK dependencies without disabling constraints.
 * Late passes null optional FK columns so rows still restore when optional parents are missing.
 */
async function upsertRowsMultiPass(tableLoads, { maxPasses = 12, onProgress } = {}) {
  // tableLoads: [{ table, rows }]
  const metaCache = new Map();
  const nullableFkCache = new Map();

  async function meta(table) {
    if (!metaCache.has(table)) {
      const columns = await listColumns(table);
      metaCache.set(table, {
        columns,
        colMetaByName: new Map(columns.map((c) => [c.name, c])),
        colSet: new Set(columns.map((c) => c.name)),
        hasId: columns.some((c) => c.name === 'id'),
      });
    }
    return metaCache.get(table);
  }

  async function nullableFks(table) {
    if (!nullableFkCache.has(table)) {
      nullableFkCache.set(table, await listNullableFkColumns(table));
    }
    return nullableFkCache.get(table);
  }

  let queues = tableLoads.map((t) => ({ table: t.table, rows: [...t.rows] }));
  let totalInserted = 0;

  for (let pass = 1; pass <= maxPasses; pass += 1) {
    let passInserted = 0;
    const next = [];
    const relaxOptionalFks = pass >= Math.ceil(maxPasses / 2);
    for (const q of queues) {
      if (!q.rows.length) continue;
      const m = await meta(q.table);
      const optionalFkCols = relaxOptionalFks ? await nullableFks(q.table) : [];
      const pending = [];
      for (const raw of q.rows) {
        let row = raw;
        if (optionalFkCols.length) {
          row = { ...raw };
          for (const col of optionalFkCols) {
            if (row[col] != null) row[col] = null;
          }
        }
        const result = await insertOneRow(
          q.table, row, m.colMetaByName, m.colSet, m.hasId,
          { quiet: pass < maxPasses }
        );
        if (result === 'ok') {
          passInserted += 1;
          totalInserted += 1;
        } else if (result === 'retry') {
          pending.push(raw);
        }
      }
      if (pending.length) next.push({ table: q.table, rows: pending });
    }
    queues = next;
    if (onProgress) {
      await onProgress(pass, passInserted, queues.reduce((s, q) => s + q.rows.length, 0));
    }
    if (!queues.length) break;
    // Continue even if a pass inserts 0 while we still have pending and haven't relaxed FKs yet
    if (!passInserted && relaxOptionalFks) break;
  }

  const remaining = queues.reduce((s, q) => s + q.rows.length, 0);
  if (remaining > 0) {
    console.warn(`[companyRestore] ${remaining} rows could not be inserted after multi-pass (FK/data issues)`);
    for (const q of queues) {
      if (q.rows.length) {
        console.warn(`  - ${q.table}: ${q.rows.length} pending`);
      }
    }
  }
  return { totalInserted, remaining };
}

async function readJsonl(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const text = await fsp.readFile(filePath, 'utf8');
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

/**
 * Restore companies from a completed COMPANY backup job.
 * @param {object} opts
 * @param {string} opts.backupJobId
 * @param {string[]} opts.authorizedCompanyIds - companies the actor may restore
 * @param {string[]} [opts.selectedCompanyIds] - subset to restore (defaults to intersection)
 * @param {string} opts.actorUserId
 * @param {function} [opts.createPreRestoreBackup] - async () => backupJobId
 */
async function restoreCompanyBackup({
  backupJobId,
  authorizedCompanyIds,
  selectedCompanyIds,
  actorUserId,
  onProgress,
}) {
  const job = await prisma.backupJob.findUnique({
    where: { id: backupJobId },
    include: { companies: true },
  });
  if (!job || job.backupType !== 'COMPANY') {
    throw new Error('Company backup not found');
  }
  if (job.status !== 'COMPLETED' && job.status !== 'RESTORING') {
    throw new Error(`Backup is not restorable (status=${job.status})`);
  }
  if (!job.storageKey) throw new Error('Backup file missing');

  const authSet = new Set(authorizedCompanyIds);
  const backupCompanyIds = job.companies.map((c) => c.companyId);
  const requested = (selectedCompanyIds && selectedCompanyIds.length)
    ? selectedCompanyIds
    : backupCompanyIds;
  const toRestore = requested.filter((id) => authSet.has(id) && backupCompanyIds.includes(id));
  if (!toRestore.length) {
    throw new Error('No authorized companies to restore from this backup');
  }

  // Prevent concurrent restores
  const locked = await prisma.backupJob.updateMany({
    where: {
      id: backupJobId,
      OR: [
        { restoreLockedAt: null },
        { restoreLockedAt: { lt: new Date(Date.now() - 2 * 60 * 60 * 1000) } },
      ],
    },
    data: {
      status: 'RESTORING',
      restoreLockedAt: new Date(),
      restoreLockedBy: actorUserId,
      progressMessage: 'Restore in progress',
    },
  });
  if (!locked.count) {
    throw new Error('Another restore operation is already in progress for this backup');
  }

  const workDir = path.join(tmpDir(), `restore-${backupJobId}-${Date.now()}`);
  await fsp.mkdir(workDir, { recursive: true });
  const zipPath = path.join(workDir, 'backup.zip');

  try {
    if (onProgress) await onProgress(5, 'Downloading backup archive');
    await storage.downloadToFile(job.storageKey, zipPath);

    if (job.checksumSha256) {
      const checksum = await sha256File(zipPath);
      if (checksum !== job.checksumSha256) {
        throw new Error('Backup integrity check failed: checksum mismatch');
      }
    }

    const extractDir = path.join(workDir, 'extracted');
    if (onProgress) await onProgress(15, 'Validating backup archive');
    await extractBackupZip(zipPath, extractDir);
    const { manifest } = await validateExtractedBackup(extractDir);

    const databaseDir = path.join(extractDir, 'database');
    const companiesDir = path.join(extractDir, 'companies');

    // Restore each company
    let idx = 0;
    for (const companyId of toRestore) {
      idx += 1;
      const basePct = 20 + Math.floor((idx / toRestore.length) * 70);
      if (onProgress) await onProgress(basePct, `Restoring company ${companyId}`);

      // Load company.json if present
      const companyJsonPath = path.join(companiesDir, companyId, 'company.json');
      let companyRow = null;
      if (fs.existsSync(companyJsonPath)) {
        companyRow = JSON.parse(await fsp.readFile(companyJsonPath, 'utf8'));
      }

      const existing = await prisma.company.findUnique({ where: { id: companyId }, select: { id: true } });
      if (existing) {
        await wipeCompanyDataKeepShell(companyId);
        if (companyRow) {
          // Update shell fields from backup (avoid wiping subscription accidentally if missing)
          const { id, created_at, updated_at, ...rest } = companyRow;
          const data = {};
          // Map snake_case backup keys carefully via raw update of known columns
          await upsertRows('companies', [companyRow]);
        }
      } else if (companyRow) {
        await upsertRows('companies', [companyRow]);
      } else {
        throw new Error(`Cannot restore company ${companyId}: company record missing from backup and database`);
      }

    }

    // Load all table payloads once, then multi-pass insert (FK-safe)
    if (onProgress) await onProgress(40, 'Loading backup tables for restore');
    const files = fs.existsSync(databaseDir)
      ? (await fsp.readdir(databaseDir)).filter((f) => f.endsWith('.jsonl'))
      : [];

    const priority = [
      'users', 'roles', 'company_memberships', 'locations', 'categories',
      'suppliers', 'customers', 'products', 'chart_of_accounts', 'fiscal_years',
      'bank_accounts',
    ];
    files.sort((a, b) => {
      const ta = a.replace(/\.jsonl$/, '');
      const tb = b.replace(/\.jsonl$/, '');
      const pa = priority.indexOf(ta);
      const pb = priority.indexOf(tb);
      if (pa === -1 && pb === -1) return ta.localeCompare(tb);
      if (pa === -1) return 1;
      if (pb === -1) return -1;
      return pa - pb;
    });

    const restoreSet = new Set(toRestore);
    const tableLoads = [];
    for (const file of files) {
      const table = assertSafeTableName(file.replace(/\.jsonl$/, ''));
      if (table === 'companies') continue;
      const rows = await readJsonl(path.join(databaseDir, file));
      const cols = await listColumns(table);
      const hasCompanyId = cols.some((c) => c.name === 'company_id');
      const filtered = hasCompanyId
        ? rows.filter((r) => restoreSet.has(r.company_id))
        : rows;
      if (filtered.length) tableLoads.push({ table, rows: filtered });
    }

    if (onProgress) await onProgress(50, `Inserting ${tableLoads.length} tables (multi-pass)`);
    const insertResult = await upsertRowsMultiPass(tableLoads, {
      maxPasses: 15,
      onProgress: async (pass, inserted, remaining) => {
        if (onProgress) {
          await onProgress(
            Math.min(90, 50 + pass * 2),
            `Restore pass ${pass}: +${inserted} rows, ${remaining} pending`
          );
        }
      },
    });
    if (insertResult.remaining > 0) {
      console.warn(`[companyRestore] completed with ${insertResult.remaining} unresolved rows`);
    }

    await prisma.backupJob.update({
      where: { id: backupJobId },
      data: {
        status: 'COMPLETED',
        restoreLockedAt: null,
        restoreLockedBy: null,
        progressPercent: 100,
        progressMessage: `Restored ${toRestore.length} company(ies)`,
      },
    });

    return {
      restoredCompanyIds: toRestore,
      formatVersion: manifest.formatVersion,
    };
  } catch (err) {
    await prisma.backupJob.update({
      where: { id: backupJobId },
      data: {
        status: 'COMPLETED',
        restoreLockedAt: null,
        restoreLockedBy: null,
        errorMessage: `Restore failed: ${err.message}`,
        progressMessage: 'Restore failed',
      },
    }).catch(() => {});
    throw err;
  } finally {
    try {
      await fsp.rm(workDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
}

async function validateBackupJobFile(backupJobId) {
  const job = await prisma.backupJob.findUnique({ where: { id: backupJobId } });
  if (!job?.storageKey) throw new Error('Backup not found or file missing');
  const workDir = path.join(tmpDir(), `validate-${backupJobId}`);
  await fsp.mkdir(workDir, { recursive: true });
  const zipPath = path.join(workDir, 'backup.zip');
  try {
    await storage.downloadToFile(job.storageKey, zipPath);
    if (job.checksumSha256) {
      const checksum = await sha256File(zipPath);
      if (checksum !== job.checksumSha256) {
        return { valid: false, reason: 'checksum_mismatch' };
      }
    }
    const extractDir = path.join(workDir, 'extracted');
    await extractBackupZip(zipPath, extractDir);
    const { manifest, metadata } = await validateExtractedBackup(extractDir);
    return { valid: true, manifest, metadata };
  } finally {
    await fsp.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

module.exports = {
  restoreCompanyBackup,
  validateBackupJobFile,
  extractBackupZip,
  validateExtractedBackup,
  wipeCompanyDataKeepShell,
  assertSafeZipPath,
};
