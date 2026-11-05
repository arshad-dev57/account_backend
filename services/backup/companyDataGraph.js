'use strict';

const prisma = require('../../prisma/client');
const { BACKUP_SYSTEM_TABLES, GLOBAL_TABLES, SENSITIVE_USER_COLUMNS } = require('./backupConstants');

function quoteIdent(name) {
  return `"${String(name).replace(/"/g, '""')}"`;
}

/**
 * Discover all public BASE TABLEs that have a company_id column.
 * Excludes backup system tables and known global tables.
 */
async function listTenantedTables() {
  const rows = await prisma.$queryRawUnsafe(`
    SELECT c.table_name
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema
     AND t.table_name = c.table_name
    WHERE c.table_schema = 'public'
      AND t.table_type = 'BASE TABLE'
      AND c.column_name = 'company_id'
    ORDER BY c.table_name
  `);
  return rows
    .map((r) => r.table_name)
    .filter((name) => !BACKUP_SYSTEM_TABLES.has(name) && !GLOBAL_TABLES.has(name));
}

/**
 * Child tables without company_id that FK to a parent table which has company_id.
 * Mirrors the discovery approach in wipeEntireCompany.
 */
async function listChildTablesViaFk() {
  const rows = await prisma.$queryRawUnsafe(`
    SELECT DISTINCT
      src.relname AS child_table,
      att.attname AS child_col,
      tgt.relname AS parent_table,
      patt.attname AS parent_col
    FROM pg_constraint con
    JOIN pg_class src ON src.oid = con.conrelid
    JOIN pg_class tgt ON tgt.oid = con.confrelid
    JOIN pg_namespace nsp ON nsp.oid = src.relnamespace
    JOIN pg_attribute att
      ON att.attrelid = con.conrelid
     AND att.attnum = con.conkey[1]
    JOIN pg_attribute patt
      ON patt.attrelid = con.confrelid
     AND patt.attnum = con.confkey[1]
    JOIN information_schema.columns pc
      ON pc.table_schema = 'public'
     AND pc.table_name = tgt.relname
     AND pc.column_name = 'company_id'
    WHERE con.contype = 'f'
      AND nsp.nspname = 'public'
      AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns cc
        WHERE cc.table_schema = 'public'
          AND cc.table_name = src.relname
          AND cc.column_name = 'company_id'
      )
    ORDER BY src.relname
  `);

  return rows
    .filter((r) => !BACKUP_SYSTEM_TABLES.has(r.child_table))
    .map((r) => ({
      childTable: r.child_table,
      childCol: r.child_col,
      parentTable: r.parent_table,
      parentCol: r.parent_col,
    }));
}

async function listColumns(tableName) {
  const rows = await prisma.$queryRawUnsafe(`
    SELECT column_name, data_type, udt_name
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = $1
    ORDER BY ordinal_position
  `, tableName);
  return rows.map((r) => ({
    name: r.column_name,
    dataType: r.data_type,
    udtName: r.udt_name,
  }));
}

function sanitizeRow(tableName, row) {
  if (!row || typeof row !== 'object') return row;
  if (tableName !== 'users') return row;
  const out = { ...row };
  for (const col of SENSITIVE_USER_COLUMNS) {
    if (Object.prototype.hasOwnProperty.call(out, col)) {
      delete out[col];
    }
  }
  return out;
}

/**
 * Export all rows for companyIds from a tenanted table.
 * Uses keyset pagination on id when available.
 */
async function exportTenantedTable(tableName, companyIds, onBatch) {
  const columns = await listColumns(tableName);
  const colNames = columns.map((c) => c.name);
  const hasId = colNames.includes('id');
  const selectList = colNames.map(quoteIdent).join(', ');
  const placeholders = companyIds.map((_, i) => `$${i + 1}`).join(', ');
  const pageSize = 1000;
  let lastId = null;
  let total = 0;

  for (;;) {
    let sql;
    let params;
    if (hasId && lastId) {
      sql = `
        SELECT ${selectList}
        FROM ${quoteIdent(tableName)}
        WHERE company_id IN (${placeholders})
          AND id > $${companyIds.length + 1}
        ORDER BY id
        LIMIT ${pageSize}
      `;
      params = [...companyIds, lastId];
    } else if (hasId) {
      sql = `
        SELECT ${selectList}
        FROM ${quoteIdent(tableName)}
        WHERE company_id IN (${placeholders})
        ORDER BY id
        LIMIT ${pageSize}
      `;
      params = [...companyIds];
    } else {
      sql = `
        SELECT ${selectList}
        FROM ${quoteIdent(tableName)}
        WHERE company_id IN (${placeholders})
        LIMIT ${pageSize} OFFSET ${total}
      `;
      params = [...companyIds];
    }

    const rows = await prisma.$queryRawUnsafe(sql, ...params);
    if (!rows.length) break;

    const sanitized = rows.map((r) => sanitizeRow(tableName, serializeRow(r)));
    await onBatch(sanitized);
    total += rows.length;

    if (hasId) {
      lastId = rows[rows.length - 1].id;
    }
    if (rows.length < pageSize) break;
  }

  return total;
}

/**
 * Export child rows whose parent rows belong to the given companies.
 */
async function exportChildTable(link, companyIds, onBatch) {
  const columns = await listColumns(link.childTable);
  const colNames = columns.map((c) => c.name);
  const hasId = colNames.includes('id');
  const selectList = colNames.map((c) => `c.${quoteIdent(c)}`).join(', ');
  const placeholders = companyIds.map((_, i) => `$${i + 1}`).join(', ');
  const pageSize = 1000;
  let lastId = null;
  let total = 0;

  for (;;) {
    let sql;
    let params;
    if (hasId && lastId) {
      sql = `
        SELECT ${selectList}
        FROM ${quoteIdent(link.childTable)} c
        WHERE c.${quoteIdent(link.childCol)} IN (
          SELECT p.${quoteIdent(link.parentCol)}
          FROM ${quoteIdent(link.parentTable)} p
          WHERE p.company_id IN (${placeholders})
        )
          AND c.id > $${companyIds.length + 1}
        ORDER BY c.id
        LIMIT ${pageSize}
      `;
      params = [...companyIds, lastId];
    } else if (hasId) {
      sql = `
        SELECT ${selectList}
        FROM ${quoteIdent(link.childTable)} c
        WHERE c.${quoteIdent(link.childCol)} IN (
          SELECT p.${quoteIdent(link.parentCol)}
          FROM ${quoteIdent(link.parentTable)} p
          WHERE p.company_id IN (${placeholders})
        )
        ORDER BY c.id
        LIMIT ${pageSize}
      `;
      params = [...companyIds];
    } else {
      sql = `
        SELECT ${selectList}
        FROM ${quoteIdent(link.childTable)} c
        WHERE c.${quoteIdent(link.childCol)} IN (
          SELECT p.${quoteIdent(link.parentCol)}
          FROM ${quoteIdent(link.parentTable)} p
          WHERE p.company_id IN (${placeholders})
        )
        LIMIT ${pageSize} OFFSET ${total}
      `;
      params = [...companyIds];
    }

    const rows = await prisma.$queryRawUnsafe(sql, ...params);
    if (!rows.length) break;
    const sanitized = rows.map((r) => sanitizeRow(link.childTable, serializeRow(r)));
    await onBatch(sanitized);
    total += rows.length;
    if (hasId) lastId = rows[rows.length - 1].id;
    if (rows.length < pageSize) break;
  }

  return total;
}

function serializeRow(row) {
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    if (typeof v === 'bigint') {
      out[k] = v.toString();
    } else if (v instanceof Date) {
      out[k] = v.toISOString();
    } else if (Buffer.isBuffer(v)) {
      out[k] = { __type: 'Buffer', data: v.toString('base64') };
    } else {
      out[k] = v;
    }
  }
  return out;
}

async function exportCompanyRows(companyIds) {
  const placeholders = companyIds.map((_, i) => `$${i + 1}`).join(', ');
  const rows = await prisma.$queryRawUnsafe(
    `SELECT * FROM companies WHERE id IN (${placeholders})`,
    ...companyIds
  );
  return rows.map((r) => serializeRow(r));
}

async function exportMemberships(companyIds) {
  const placeholders = companyIds.map((_, i) => `$${i + 1}`).join(', ');
  const rows = await prisma.$queryRawUnsafe(
    `SELECT * FROM company_memberships WHERE company_id IN (${placeholders})`,
    ...companyIds
  );
  return rows.map((r) => serializeRow(r));
}

module.exports = {
  quoteIdent,
  listTenantedTables,
  listChildTablesViaFk,
  listColumns,
  exportTenantedTable,
  exportChildTable,
  exportCompanyRows,
  exportMemberships,
  sanitizeRow,
  serializeRow,
};
