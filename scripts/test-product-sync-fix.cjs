
const path = require('path');
const client = require(path.join(__dirname, '..', 'prisma', 'client'));

const cats = new Map(); 
const prods = new Map(); 
let prodSeq = 1;
let catSeq = 1;

cats.set('CAT-1', {
  id: 'cloud-cat-1', syncId: 'CAT-1', name: 'Snacks', parentId: null, parentName: '',
  level: 1, path: '', slug: 'snacks', code: 'SNK', isDeleted: false, companyId: 'co-1',
});

client.$queryRaw = async () => [1];
client.posMasterSyncChange = { create: async ({ data }) => ({ id: `log-${Date.now()}`, ...data }) };

client.category = {
  findMany: async ({ where = {} } = {}) => {
    let rows = [...cats.values()];
    if (where.companyId) rows = rows.filter((r) => r.companyId === where.companyId);
    if (where.syncId && where.syncId.in) rows = rows.filter((r) => where.syncId.in.includes(r.syncId));
    return rows;
  },
  findFirst: async ({ where = {} } = {}) => {
    for (const r of cats.values()) {
      if (where.syncId !== undefined && r.syncId !== where.syncId) continue;
      if (where.isDeleted === false && r.isDeleted) continue;
      if (where.companyId && r.companyId !== where.companyId) continue;
      if (where.slug && r.slug !== where.slug) continue;
      if (where.code && r.code !== where.code) continue;
      return r;
    }
    return null;
  },
  findUnique: async ({ where = {} } = {}) =>
    (where.syncId && cats.get(where.syncId)) ||
    [...cats.values()].find((r) => r.id === where.id) || null,
  create: async ({ data }) => {
    const row = { id: `cloud-cat-${catSeq++}`, ...data };
    cats.set(row.syncId, row);
    return row;
  },
  update: async ({ where, data }) => {
    const row = [...cats.values()].find((r) => r.id === where.id);
    if (!row) throw new Error('category not found');
    return Object.assign(row, data);
  },
};

client.product = {
  findMany: async ({ where = {} } = {}) => {
    let rows = [...prods.values()];
    if (where.syncId && where.syncId.in) rows = rows.filter((r) => where.syncId.in.includes(r.syncId));
    return rows;
  },
  findFirst: async ({ where = {} } = {}) => {
    for (const r of prods.values()) {
      if (where.sku !== undefined && r.sku !== where.sku) continue;
      if (where.barcodeNumber !== undefined && (r.barcodeNumber || null) !== where.barcodeNumber) continue;
      if (where.companyId && r.companyId !== where.companyId) continue;
      return r;
    }
    return null;
  },
  create: async ({ data }) => {
    const id = `cloud-prod-${prodSeq++}`;
    const row = { id, ...data };
    prods.set(id, row);
    return row;
  },
  update: async ({ where, data }) => {
    const row = prods.get(where.id);
    if (!row) throw new Error('product not found');
    return Object.assign(row, data);
  },
};


let failures = 0;
const OUT = [];
const assert = (cond, msg) => {
  OUT.push(`${cond ? 'PASS' : 'FAIL'}  ${msg}`);
  if (!cond) failures += 1;
};

const svc = require(path.join(__dirname, '..', 'pos', 'sync', 'masterDataIngestService'));

(async () => {
  const res1 = await svc.ingestMasterData({
    companyId: 'co-1',
    userId: 'u-1',
    records: {
      products: [{
        syncId: 'PROD-1', name: 'Doritos', sku: 'DOR-123', barcode: 'BAR-1',
        sellingPrice: 100, costPrice: 80, currentStock: 5, categorySyncId: 'CAT-1',
      }],
    },
  });
  const p1 = res1.pushed.products[0];
  assert(p1 && p1.action === 'created', `CASE 1 product uploaded (action=${p1 && p1.action})`);
  const created1 = [...prods.values()].find((r) => r.syncId === 'PROD-1');
  assert(created1 && created1.categoryId === 'cloud-cat-1', `CASE 1 linked to cloud category (categoryId=${created1 && created1.categoryId})`);
  assert(created1 && created1.categoryName === 'Snacks', `CASE 1 categoryName resolved (${created1 && created1.categoryName})`);
  assert(created1 && created1.barcodeNumber === 'BAR-1', `CASE 1 barcode kept (${created1 && created1.barcodeNumber})`);
  assert(res1.mapping['CAT-1'] === 'cloud-cat-1', 'CASE 1 mapping includes DB-resolved category');
  assert(res1.summary.failed === 0, `CASE 1 no failures (failed=${res1.summary.failed})`);

  const res2 = await svc.ingestMasterData({
    companyId: 'co-1', userId: 'u-1',
    records: { products: [{ syncId: 'PROD-1', name: 'Doritos', sku: 'DOR-123', sellingPrice: 120, categorySyncId: 'CAT-1' }] },
  });
  const p2 = res2.pushed.products[0];
  assert(p2 && p2.action === 'updated', `CASE 2 re-push updates instead of duplicating (action=${p2 && p2.action})`);
  assert(prods.size === 1, `CASE 2 still exactly 1 product (count=${prods.size})`);

  const res3 = await svc.ingestMasterData({
    companyId: 'co-1', userId: 'u-1',
    records: { products: [{ syncId: 'PROD-2', name: 'Kurleez', barcode: 'BAR-1', sellingPrice: 50, categorySyncId: 'CAT-1' }] },
  });
  const p3 = res3.pushed.products[0];
  assert(p3 && p3.action === 'created', `CASE 3 barcode-collision product still uploaded (action=${p3 && p3.action}, err=${res3.pushed.failed[0] && res3.pushed.failed[0].error})`);
  const created3 = [...prods.values()].find((r) => r.syncId === 'PROD-2');
  assert(created3 && created3.barcodeNumber === null, `CASE 3 colliding barcode dropped, not blocked (${created3 && created3.barcodeNumber})`);

  const res4 = await svc.ingestMasterData({
    companyId: 'co-1', userId: 'u-1',
    records: { products: [{ syncId: 'PROD-3', name: 'Ghost product', categorySyncId: 'CAT-404' }] },
  });
  assert(res4.summary.failed === 1, `CASE 4 unknown category -> retryable failure (failed=${res4.summary.failed})`);

  OUT.push(failures === 0 ? 'ALL CASES PASSED' : `${failures} CASE(S) FAILED`);
  require('fs').writeFileSync('/tmp/syncresults.txt', OUT.join('\n') + '\n');
  process.exit(failures === 0 ? 0 : 1);
})().catch((err) => {
  require('fs').writeFileSync('/tmp/syncresults.txt', 'FATAL: ' + (err && err.stack || err) + '\n');
  process.exit(1);
});
