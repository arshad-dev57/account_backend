/**
 * POS master-data sync (categories, subcategories, products).
 *
 * Snapshot cursor (k=s): paginate live tables up to a frozen boundAt/boundSeq.
 * Changelog cursor (k=c): paginate pos_master_sync_changes by monotonic id.
 *
 * Client must persist nextCursor only after the page is committed locally.
 */
const crypto = require('crypto');
const prisma = require('../../prisma/client');
const { ENTITY, categoryPayload, productPayload } = require('./masterDataChangeLog');

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 500;

function clampLimit(raw) {
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(n, MAX_LIMIT);
}

function encodeCursor(obj) {
  return Buffer.from(JSON.stringify(obj), 'utf8').toString('base64url');
}

function decodeCursor(raw) {
  if (raw == null || raw === '' || raw === '0') return null;
  try {
    const parsed = JSON.parse(Buffer.from(String(raw), 'base64url').toString('utf8'));
    if (!parsed || parsed.v !== 1 || (parsed.k !== 's' && parsed.k !== 'c')) {
      const err = new Error('Invalid sync cursor');
      err.code = 'CURSOR_INVALID';
      throw err;
    }
    return parsed;
  } catch (err) {
    if (err.code === 'CURSOR_INVALID') throw err;
    const invalid = new Error('Invalid or expired sync cursor');
    invalid.code = 'CURSOR_INVALID';
    throw invalid;
  }
}

function emptyBuckets() {
  return { categories: [], subcategories: [], products: [] };
}

function afterKey(updatedAt, id) {
  return {
    lastAt: updatedAt ? new Date(updatedAt).toISOString() : new Date(0).toISOString(),
    lastId: id || '',
  };
}

function snapshotWhere(lastAt, lastId, boundAt) {
  const last = lastAt ? new Date(lastAt) : new Date(0);
  const bound = new Date(boundAt);
  return {
    AND: [
      {
        OR: [
          { updatedAt: { gt: last } },
          { AND: [{ updatedAt: last }, { id: { gt: lastId || '' } }] },
        ],
      },
      { updatedAt: { lte: bound } },
    ],
  };
}

async function snapshotHead(companyId) {
  let boundSeq = '0';
  try {
    const maxChange = await prisma.posMasterSyncChange.aggregate({
      where: { companyId },
      _max: { id: true },
    });
    boundSeq = String(maxChange?._max?.id || 0);
  } catch {
    boundSeq = '0';
  }
  return { boundSeq, boundAt: new Date().toISOString() };
}

async function pullSnapshotPage(companyId, cursor, limit) {
  const phase = cursor.phase || 'category';
  const lastAt = cursor.lastAt || new Date(0).toISOString();
  const lastId = cursor.lastId || '';
  const boundAt = cursor.boundAt;
  const boundSeq = cursor.boundSeq || '0';
  const buckets = emptyBuckets();

  if (phase === 'category') {
    const rows = await prisma.category.findMany({
      where: {
        companyId,
        parentId: null,
        ...snapshotWhere(lastAt, lastId, boundAt),
      },
      orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
      take: limit,
    });
    buckets.categories = rows.map((row) => categoryPayload(row, Boolean(row.isDeleted || row.isActive === false)));
    if (rows.length === limit) {
      const last = rows[rows.length - 1];
      return {
        mode: 'snapshot',
        hasMore: true,
        buckets,
        nextCursor: {
          v: 1,
          k: 's',
          phase: 'category',
          boundAt,
          boundSeq,
          ...afterKey(last.updatedAt, last.id),
        },
      };
    }
    return {
      mode: 'snapshot',
      hasMore: true,
      buckets,
      nextCursor: {
        v: 1,
        k: 's',
        phase: 'subcategory',
        boundAt,
        boundSeq,
        lastAt: new Date(0).toISOString(),
        lastId: '',
      },
    };
  }

  if (phase === 'subcategory') {
    const rows = await prisma.category.findMany({
      where: {
        companyId,
        parentId: { not: null },
        ...snapshotWhere(lastAt, lastId, boundAt),
      },
      orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
      take: limit,
    });
    buckets.subcategories = rows.map((row) => categoryPayload(row, Boolean(row.isDeleted || row.isActive === false)));
    if (rows.length === limit) {
      const last = rows[rows.length - 1];
      return {
        mode: 'snapshot',
        hasMore: true,
        buckets,
        nextCursor: {
          v: 1,
          k: 's',
          phase: 'subcategory',
          boundAt,
          boundSeq,
          ...afterKey(last.updatedAt, last.id),
        },
      };
    }
    return {
      mode: 'snapshot',
      hasMore: true,
      buckets,
      nextCursor: {
        v: 1,
        k: 's',
        phase: 'product',
        boundAt,
        boundSeq,
        lastAt: new Date(0).toISOString(),
        lastId: '',
      },
    };
  }

  const products = await prisma.product.findMany({
    where: {
      companyId,
      ...snapshotWhere(lastAt, lastId, boundAt),
    },
    orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
    take: limit,
    include: {
      category: { select: { id: true, parentId: true } },
    },
  });
  buckets.products = products.map((row) =>
    productPayload(row, row.category, row.isActive === false)
  );

  if (products.length === limit) {
    const last = products[products.length - 1];
    return {
      mode: 'snapshot',
      hasMore: true,
      buckets,
      nextCursor: {
        v: 1,
        k: 's',
        phase: 'product',
        boundAt,
        boundSeq,
        ...afterKey(last.updatedAt, last.id),
      },
    };
  }

  return {
    mode: 'snapshot',
    hasMore: false,
    buckets,
    nextCursor: {
      v: 1,
      k: 'c',
      seq: boundSeq,
      toSeq: boundSeq,
    },
  };
}

function bucketChange(change) {
  const payload =
    typeof change.payload === 'object' && change.payload
      ? { ...change.payload, isDeleted: Boolean(change.isDeleted || change.payload.isDeleted) }
      : { id: change.entityId, isDeleted: true };
  if (change.entityType === ENTITY.PRODUCT) return { bucket: 'products', payload };
  if (change.entityType === ENTITY.SUBCATEGORY) return { bucket: 'subcategories', payload };
  return { bucket: 'categories', payload };
}

async function pullChangelogPage(companyId, cursor, limit) {
  const seq = BigInt(cursor.seq || '0');
  let toSeq = cursor.toSeq != null ? BigInt(cursor.toSeq) : null;
  if (toSeq == null) {
    try {
      const max = await prisma.posMasterSyncChange.aggregate({
        where: { companyId },
        _max: { id: true },
      });
      toSeq = max?._max?.id || 0n;
    } catch {
      toSeq = 0n;
    }
  }

  if (seq >= toSeq) {
    return {
      mode: 'incremental',
      hasMore: false,
      buckets: emptyBuckets(),
      nextCursor: { v: 1, k: 'c', seq: String(toSeq), toSeq: String(toSeq) },
    };
  }

  const rows = await prisma.posMasterSyncChange.findMany({
    where: {
      companyId,
      id: { gt: seq, lte: toSeq },
    },
    orderBy: { id: 'asc' },
    take: limit,
  });

  const buckets = emptyBuckets();
  for (const row of rows) {
    const { bucket, payload } = bucketChange(row);
    buckets[bucket].push(payload);
  }

  if (rows.length === 0) {
    return {
      mode: 'incremental',
      hasMore: false,
      buckets,
      nextCursor: { v: 1, k: 'c', seq: String(toSeq), toSeq: String(toSeq) },
    };
  }

  const lastId = rows[rows.length - 1].id;
  const hasMore = lastId < toSeq && rows.length === limit;
  return {
    mode: 'incremental',
    hasMore,
    buckets,
    nextCursor: {
      v: 1,
      k: 'c',
      seq: String(lastId),
      toSeq: String(toSeq),
    },
  };
}

async function pullMasterData({ companyId, cursor: rawCursor, limit: rawLimit }) {
  if (!companyId) {
    const err = new Error('Company context is required');
    err.code = 'VALIDATION';
    throw err;
  }

  const limit = clampLimit(rawLimit);
  const cursor = decodeCursor(rawCursor);

  let page;
  if (!cursor) {
    const head = await snapshotHead(companyId);
    page = await pullSnapshotPage(
      companyId,
      {
        phase: 'category',
        boundAt: head.boundAt,
        boundSeq: head.boundSeq,
        lastAt: new Date(0).toISOString(),
        lastId: '',
      },
      limit
    );
  } else if (cursor.k === 's') {
    page = await pullSnapshotPage(companyId, cursor, limit);
  } else {
    page = await pullChangelogPage(companyId, cursor, limit);
  }

  return {
    syncId: crypto.randomUUID(),
    mode: page.mode,
    hasMore: page.hasMore,
    nextCursor: encodeCursor(page.nextCursor),
    categories: page.buckets.categories,
    subcategories: page.buckets.subcategories,
    products: page.buckets.products,
  };
}

module.exports = {
  DEFAULT_LIMIT,
  MAX_LIMIT,
  encodeCursor,
  decodeCursor,
  pullMasterData,
};
