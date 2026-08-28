/**
 * Bidirectional master-data sync — Local -> Cloud ingestion.
 *
 * Receives records created/edited on a client device while it was offline,
 * and upserts them into the cloud (Postgres) keyed by a STABLE `syncId`
 * (client-generated UUID) so the same logical record is never duplicated —
 * regardless of whether local and cloud primary keys differ.
 *
 * Order of ingestion is dependency-aware:
 *   1. Categories (parent / `parentSyncId` unset)
 *   2. Subcategories (parent linked via `parentSyncId`)
 *   3. Products (linked to categories/subcategories via syncId mapping)
 *
 * Every upserted cloud record is marked `syncStatus = SYNCED` and
 * `lastSyncedAt = now`, and also written to the existing changelog so the
 * existing cursor-based Cloud -> Local pull keeps working for other devices.
 */

const prisma = require('../../prisma/client');
const crypto = require('crypto');
const { ENTITY, recordChange, categoryPayload, productPayload } = require('./masterDataChangeLog');

const SYNC_STATUS = {
  PENDING: 'PENDING',
  SYNCED: 'SYNCED',
  FAILED: 'FAILED',
};

const nowIso = () => new Date().toISOString();

function normStatus(value) {
  const s = String(value || 'PENDING').toUpperCase();
  if (s === 'FAILED') return 'FAILED';
  if (s === 'SYNCED') return 'SYNCED';
  return 'PENDING';
}

const str = (v, d = '') => (v === undefined || v === null ? d : String(v));
const toBool = (v, d) => (v === undefined || v === null ? d : Boolean(v));
const toNum = (v, d) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

function makeSlug(name, taken) {
  let slug = str(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!slug) slug = crypto.randomUUID().slice(0, 8);
  if (!taken.has(slug)) {
    taken.add(slug);
    return slug;
  }
  slug = `${slug}-${crypto.randomBytes(3).toString('hex')}`;
  while (taken.has(slug)) slug = `${slug.slice(0, -6)}-${crypto.randomBytes(3).toString('hex')}`;
  taken.add(slug);
  return slug;
}

function makeCode(name, taken) {
  const clean = str(name).replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  const prefix = (clean ? clean.slice(0, 3) : 'CAT') || 'CAT';
  let code = `CAT-${prefix}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
  let guard = 0;
  while (taken.has(code) && guard < 6) {
    code = `CAT-${prefix}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
    guard += 1;
  }
  taken.add(code);
  return code;
}

/** Quick cloud connectivity check. Returns true if the database (cloud) is reachable. */
async function checkCloudOnline() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch (err) {
    console.error('[pos-master-sync] connectivity check failed:', err.message);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Category / Subcategory upsert
// ---------------------------------------------------------------------------

function normalizeCategory(rec) {
  const parentSyncId = str(rec.parentSyncId || rec.parentId, '').trim();
  return {
    syncId: str(rec.syncId, '').trim(),
    name: str(rec.name).trim(),
    description: str(rec.description, ''),
    code: str(rec.code, ''),
    slug: str(rec.slug, ''),
    parentSyncId,
    isActive: toBool(rec.isActive, true),
    isDeleted: toBool(rec.isDeleted, false),
  };
}

async function upsertCategories({ companyId, userId, records, takenSlugs, takenCodes, bySync }) {
  const syncIds = records.map((r) => r.syncId);
  const existing = await prisma.category.findMany({
    where: { syncId: { in: syncIds } },
    select: { id: true, syncId: true, parentId: true, level: true, path: true, slug: true, code: true },
  });
  const existingBySync = new Map(existing.map((e) => [e.syncId, e]));

  const pushed = [];
  const failed = [];

  for (const raw of records) {
    const rec = normalizeCategory(raw);
    const syncId = rec.syncId;
    if (!syncId || !rec.name) {
      failed.push({ syncId, action: 'failed', error: 'syncId and name are required' });
      continue;
    }
    const prev = existingBySync.get(syncId);
    const parent = bySync.get(rec.parentSyncId);
    const parentId = parent ? parent.id : null;
    const parentName = parent ? parent.name : '';
    const level = parent ? (parent.level || 1) + 1 : 1;
    const path = parent ? (parent.path ? `${parent.path}/${parent.id}` : parent.id) : '';

    try {
      if (prev) {
        const data = {
          isActive: rec.isActive,
          isDeleted: rec.isDeleted,
          syncStatus: SYNC_STATUS.SYNCED,
          lastSyncedAt: new Date(),
        };
        if (rec.name) data.name = rec.name;
        if (rec.description) data.description = rec.description;
        if (rec.slug) data.slug = rec.slug;
        if (rec.code) data.code = rec.code;
        // Resolve hierarchy against the mapping when a parent is referenced.
        if (rec.parentSyncId) {
          if (parentId) {
            data.parentId = parentId;
            data.parentName = parentName;
            data.level = level;
            data.path = path;
          } else {
            // Parent not available yet -> keep current linkage for a retry later.
            data.parentId = prev.parentId || null;
          }
        }
        const updated = await prisma.category.update({ where: { id: prev.id }, data });
        bySync.set(syncId, {
          id: updated.id,
          name: updated.name,
          level: updated.level,
          path: updated.path,
          parentId: updated.parentId,
          parentName: updated.parentName || '',
        });
        existingBySync.set(syncId, { id: updated.id, syncId });
        await record({
          companyId,
          type: updated.parentId ? ENTITY.SUBCATEGORY : ENTITY.CATEGORY,
          entityId: updated.id,
          isDeleted: rec.isDeleted,
          payload: categoryPayload(updated, rec.isDeleted),
        });
        pushed.push({ syncId, cloudId: updated.id, action: 'updated' });
      } else {
        let slug = rec.slug;
        if (!slug) slug = makeSlug(rec.name, takenSlugs);
        else takenSlugs.add(slug);
        let code = rec.code;
        if (!code) code = makeCode(rec.name, takenCodes);
        else takenCodes.add(code);

        let created = null;
        let merged = false;
        try {
          created = await prisma.category.create({
            data: {
              name: rec.name,
              slug,
              code,
              description: rec.description,
              parentId,
              parentName,
              level,
              path,
              isActive: rec.isDeleted ? false : rec.isActive,
              isDeleted: rec.isDeleted,
              createdBy: userId,
              updatedBy: userId,
              companyId,
              syncId,
              syncStatus: SYNC_STATUS.SYNCED,
              lastSyncedAt: new Date(),
            },
          });
        } catch (err) {
          if (err && err.code !== 'P2002') throw err;
          // Unique constraint (name+company, slug or code) — the record already
          // exists in the cloud (created from another device/session). MERGE the
          // offline copy with the existing cloud row instead of failing, so the
          // push succeeds and the client links to the same cloud record.
          const dup =
            (await prisma.category.findFirst({
              where: { companyId, name: rec.name },
              orderBy: { updatedAt: 'desc' },
            })) ||
            (await prisma.category.findFirst({ where: { companyId, slug } })) ||
            (await prisma.category.findFirst({ where: { companyId, code } }));
          if (!dup) throw err;
          created = await prisma.category.update({
            where: { id: dup.id },
            data: {
              syncId,
              parentId,
              parentName,
              level,
              path,
              isActive: rec.isDeleted ? false : rec.isActive,
              isDeleted: rec.isDeleted,
              updatedBy: userId,
              syncStatus: SYNC_STATUS.SYNCED,
              lastSyncedAt: new Date(),
            },
          });
          merged = true;
          console.log(`[ingest] category merged by unique constraint sync=${syncId} -> cloud=${created.id}`);
        }

        if (parentId && !merged) {
          await prisma.category.update({
            where: { id: parentId },
            data: { subCategoryCount: { increment: 1 } },
          });
        }

        bySync.set(syncId, {
          id: created.id,
          name: created.name,
          level: created.level,
          path: created.path,
          parentId: created.parentId,
          parentName: created.parentName || '',
        });
        existingBySync.set(syncId, { id: created.id, syncId });
        await record({
          companyId,
          type: created.parentId ? ENTITY.SUBCATEGORY : ENTITY.CATEGORY,
          entityId: created.id,
          isDeleted: rec.isDeleted,
          payload: categoryPayload(created, rec.isDeleted),
        });
        pushed.push({ syncId, cloudId: created.id, action: 'created' });
      }
    } catch (err) {
      console.error(`[ingest] category upsert failed sync=${syncId}:`, err.message);
      failed.push({ syncId, name: rec.name, error: err.message });
    }
  }

  return { pushed, failed };
}

// ---------------------------------------------------------------------------
// Product upsert
// ---------------------------------------------------------------------------

function normalizeProduct(rec) {
  const categorySyncId = str(rec.categorySyncId || rec.categoryId, '').trim();
  const subcategorySyncId = str(rec.subcategorySyncId || rec.subCategoryId, '').trim();
  return {
    syncId: str(rec.syncId, '').trim(),
    name: str(rec.name).trim(),
    sku: str(rec.sku, ''),
    barcodeNumber: str(rec.barcode || rec.barcodeNumber, ''),
    description: str(rec.description, ''),
    categorySyncId,
    subcategorySyncId,
    // Names are a fallback for parents that predate the sync system and have
    // no syncId in the cloud (legacy categories/subcategories).
    categoryName: str(rec.categoryName || rec.category, '').trim(),
    subcategoryName: str(rec.subcategoryName || rec.subCategoryName || rec.subCategory, '').trim(),
    sellingPrice: toNum(rec.sellingPrice ?? rec.price, 0),
    costPrice: toNum(rec.costPrice, 0),
    taxRate: toNum(rec.taxRate, 0),
    taxType: str(rec.taxType, 'Exclusive'),
    currentStock: toNum(rec.currentStock ?? rec.availableStock, 0),
    mainImage: str(rec.mainImage || (Array.isArray(rec.images) && rec.images[0]) || '', ''),
    isActive: toBool(rec.isActive, true),
  };
}

/**
 * Resolve a category/subcategory row by its syncId. Checks the in-flight map
 * first (records pushed in this same request), then falls back to the cloud
 * database — this covers products whose parent was synced during an EARLIER
 * sync run and therefore is not part of the current push payload.
 * Results are cached into `bySync` so later records reuse them.
 */
async function resolveCategoryBySyncId(syncId, bySync) {
  if (!syncId) return null;
  const inFlight = bySync.get(syncId);
  if (inFlight) return inFlight;
  const row = await prisma.category.findFirst({
    where: { syncId, isDeleted: false },
    select: { id: true, name: true, parentId: true, parentName: true, level: true, path: true },
  });
  if (!row) return null;
  const entry = {
    id: row.id,
    name: row.name,
    level: row.level,
    path: row.path,
    parentId: row.parentId,
    parentName: row.parentName || '',
  };
  bySync.set(syncId, entry);
  return entry;
}

/** Resolve product category/subcategory links + display names from syncIds. */
async function resolveCategoryByName(name, level, companyId) {
  if (!name) return null;
  return prisma.category.findFirst({
    where: { name: { equals: name.trim() }, level, companyId, isDeleted: false },
    select: { id: true, name: true, parentId: true, parentName: true, syncId: true },
  });
}

async function resolveProductCategory({ rec, bySync, companyId }) {
  const result = { categoryId: null, subCategoryId: null, categoryName: null, subcategoryName: null };
  let sub = rec.subcategorySyncId ? await resolveCategoryBySyncId(rec.subcategorySyncId, bySync) : null;
  let cat = rec.categorySyncId ? await resolveCategoryBySyncId(rec.categorySyncId, bySync) : null;

  // Fallback: resolve parents by NAME when the desktop could not supply a
  // syncId (parents created before the bidirectional sync system exist in the
  // cloud without one). Level 1 = category, level 2 = subcategory.
  if (!sub && rec.subcategoryName) {
    sub = await resolveCategoryByName(rec.subcategoryName, 2, companyId);
  }
  if (!cat && rec.categoryName) {
    cat = await resolveCategoryByName(rec.categoryName, 1, companyId);
  }

  if (sub) {
    result.categoryId = sub.parentId || (cat ? cat.id : null);
    result.subCategoryId = sub.id;
    result.categoryName = sub.parentName || (cat ? cat.name : null);
    result.subcategoryName = sub.name || null;
  } else if (cat) {
    result.categoryId = cat.id;
    result.categoryName = cat.name || null;
  }
  return result;
}

/**
 * Guard against the cloud `barcodeNumber` unique constraint: keep the barcode
 * only when no OTHER product (different syncId) already owns it. Desktop
 * clients commonly default barcode = sku, so collisions are realistic and
 * must not hard-fail the sync.
 */
async function safeBarcodeNumber(barcodeNumber, syncId) {
  if (!barcodeNumber) return null;
  const clash = await prisma.product.findFirst({
    where: { barcodeNumber },
    select: { syncId: true },
  });
  return clash && clash.syncId !== syncId ? null : barcodeNumber;
}

async function resolveSku({ companyId, name, rec }) {
  if (rec.sku) {
    const clash = await prisma.product.findFirst({ where: { sku: rec.sku, companyId }, select: { syncId: true } });
    if (!clash || clash.syncId === rec.syncId) return rec.sku;
    return `${rec.sku}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
  }
  const base = String(name || 'PRD').replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 6) || 'PRD';
  const gen = () =>
    `${base}-${Date.now().toString(36).toUpperCase().slice(-4)}${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
  let sku = gen();
  let guard = 0;
  while (guard < 6 && (await prisma.product.findFirst({ where: { sku, companyId }, select: { id: true } }))) {
    sku = gen();
    guard += 1;
  }
  return sku;
}

/**
 * Ensures every active company location has a ProductStock row for the given
 * product. The backend POS/warehouse product listing (`getProducts`) joins
 * through ProductStock, so a product without stock rows is invisible to the
 * live catalog APIs — and the desktop client would then treat it as deleted.
 * Mirrors the web flow's `getOrCreateProductStock` + `absorbUnallocatedStock`:
 * missing rows are created with 0, and the product-level stock is allocated to
 * the default (first) location's row when that row is newly created.
 * Existing rows are never overwritten. Safe to run repeatedly.
 */
async function ensureProductStockRows({ companyId, productId, currentStock }) {
  const locations = await prisma.location.findMany({
    where: { companyId, isDeleted: false, isActive: true },
    select: { id: true, isDefault: true },
    orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
  });
  if (!locations.length) return;
  let remaining = Math.max(0, Math.round(Number(currentStock) || 0));
  for (const loc of locations) {
    const allocate = remaining; // first (default) location absorbs product-level stock
    if (allocate > 0) remaining = 0;
    await prisma.productStock.upsert({
      where: { productId_locationId: { productId, locationId: loc.id } },
      update: {}, // never clobber live stock rows
      create: {
        companyId,
        productId,
        locationId: loc.id,
        currentStock: allocate,
        reservedStock: 0,
        availableStock: allocate,
      },
    });
  }
}

async function upsertProducts({ companyId, userId, records, bySync }) {
  const syncIds = records.map((r) => r.syncId);
  const existing = await prisma.product.findMany({
    where: { syncId: { in: syncIds } },
    select: { id: true, syncId: true, categoryId: true, subCategoryId: true },
  });
  const existingBySync = new Map(existing.map((e) => [e.syncId, e]));

  const pushed = [];
  const failed = [];

  for (const raw of records) {
    const rec = normalizeProduct(raw);
    const syncId = rec.syncId;
    if (!syncId || !rec.name) {
      failed.push({ syncId, name: rec.name, error: 'syncId and name are required' });
      continue;
    }

    const refs = await resolveProductCategory({ rec, bySync, companyId });
    if (rec.categorySyncId && !refs.categoryId && !refs.subCategoryId) {
      failed.push({ syncId, name: rec.name, error: 'Referenced category/subcategory does not exist in the cloud yet (parent may have failed to upload) — will retry on next sync' });
      continue;
    }

    const categoryRow =
      refs.subCategoryId && refs.categoryId ? { id: refs.subCategoryId, parentId: refs.categoryId } : null;

    try {
      const prev = existingBySync.get(syncId);
      if (prev) {
        const data = {
          isActive: rec.isActive,
          sellingPrice: rec.sellingPrice,
          costPrice: rec.costPrice,
          taxRate: rec.taxRate,
          taxType: rec.taxType,
          currentStock: rec.currentStock,
          syncStatus: SYNC_STATUS.SYNCED,
          lastSyncedAt: new Date(),
        };
        if (rec.name) data.name = rec.name;
        if (rec.sku) data.sku = rec.sku;
        if (rec.barcodeNumber) {
          const bc = await safeBarcodeNumber(rec.barcodeNumber, syncId);
          if (bc) data.barcodeNumber = bc;
        }
        if (rec.description) data.description = rec.description;
        if (rec.mainImage) data.mainImage = rec.mainImage;
        if (refs.categoryId) data.categoryId = refs.categoryId;
        if (refs.subCategoryId) data.subCategoryId = refs.subCategoryId;
        if (refs.categoryName) data.categoryName = refs.categoryName;
        if (refs.subcategoryName) data.subCategoryName = refs.subcategoryName;

        const updated = await prisma.product.update({ where: { id: prev.id }, data });
        // Ensure stock rows exist (no-op when already present) so the product
        // stays visible in every location's live catalog (getProducts joins
        // through ProductStock).
        await ensureProductStockRows({ companyId, productId: updated.id, currentStock: 0 });
        await record({
          companyId,
          type: ENTITY.PRODUCT,
          entityId: updated.id,
          isDeleted: false,
          payload: productPayload(updated, categoryRow, false),
        });
        pushed.push({ syncId, cloudId: updated.id, action: 'updated' });
      } else {
        const sku = await resolveSku({ companyId, name: rec.name, rec });
        const barcodeNumber = await safeBarcodeNumber(rec.barcodeNumber, syncId);
        const created = await prisma.product.create({
          data: {
            name: rec.name,
            sku,
            barcodeNumber,
            description: rec.description,
            categoryId: refs.categoryId,
            categoryName: refs.categoryName,
            subCategoryId: refs.subCategoryId,
            subCategoryName: refs.subcategoryName,
            sellingPrice: rec.sellingPrice,
            costPrice: rec.costPrice,
            taxRate: rec.taxRate,
            taxType: rec.taxType,
            currentStock: rec.currentStock,
            mainImage: rec.mainImage || null,
            isActive: rec.isActive,
            createdBy: userId,
            updatedBy: userId,
            companyId,
            syncId,
            syncStatus: SYNC_STATUS.SYNCED,
            lastSyncedAt: new Date(),
          },
        });
        // Give the product ProductStock rows for every company location so it
        // appears in the location-scoped live catalog APIs. Without this the
        // desktop client's keepOnlyProductIds treats it as deleted locally.
        await ensureProductStockRows({ companyId, productId: created.id, currentStock: rec.currentStock });
        bySync.set(syncId, { id: created.id, name: created.name, categoryId: created.categoryId });
        existingBySync.set(syncId, { id: created.id, syncId });
        await record({
          companyId,
          type: ENTITY.PRODUCT,
          entityId: created.id,
          isDeleted: false,
          payload: productPayload(created, categoryRow, false),
        });
        pushed.push({ syncId, cloudId: created.id, action: 'created' });
      }
    } catch (err) {
      console.error(`[ingest] product upsert failed sync=${syncId}:`, err.message);
      failed.push({ syncId, name: rec.name, error: err.message });
    }
  }

  return { pushed, failed };
}

async function record({ companyId, type, entityId, isDeleted, payload }) {
  try {
    await recordChange({ companyId, entityType: type, entityId, isDeleted, payload });
  } catch (err) {
    console.error('[ingest] change-log write failed:', err.message);
  }
}

/**
 * Ingest local records into the cloud, dependency-ordered: categories ->
 * subcategories -> products. Keyed by stable `syncId` to prevent duplicates.
 *
 * @returns {{pushed:{categories:[],subcategories:[],products:[],failed:[]},
 *            mapping:Record<string,string>, summary:object}}
 */
async function ingestMasterData({ companyId, userId, records = {} }) {
  if (!companyId || !userId) {
    const err = new Error('Company and user context are required');
    err.code = 'VALIDATION';
    throw err;
  }

  const online = await checkCloudOnline();
  if (!online) {
    const err = new Error('No internet / cloud database is unreachable. Sync aborted.');
    err.code = 'OFFLINE';
    throw err;
  }

  const takenSlugs = new Set();
  const takenCodes = new Set();
  const existingSlugsCodes = await prisma.category.findMany({
    where: { companyId },
    select: { slug: true, code: true },
  });
  for (const row of existingSlugsCodes) {
    if (row.slug) takenSlugs.add(row.slug);
    if (row.code) takenCodes.add(row.code);
  }

  // syncId -> { id, name, level, path, parentId, categoryId }
  const bySync = new Map();
  const pushed = { categories: [], subcategories: [], products: [], failed: [] };

  const topLevel = (records.categories || []).filter((c) => !str(c.parentSyncId || c.parentId, ''));
  const cats = await upsertCategories({ companyId, userId, records: topLevel, takenSlugs, takenCodes, bySync });
  pushed.categories = cats.pushed;
  pushed.failed.push(...cats.failed);

  const subs = await upsertCategories({ companyId, userId, records: records.subcategories || [], takenSlugs, takenCodes, bySync });
  pushed.subcategories = subs.pushed;
  pushed.failed.push(...subs.failed);

  const prods = await upsertProducts({ companyId, userId, records: records.products || [], bySync });
  pushed.products = prods.pushed;
  pushed.failed.push(...prods.failed);

  const mapping = {};
  for (const [key, value] of bySync.entries()) mapping[key] = value.id;

  return {
    pushed,
    mapping,
    summary: {
      categoriesCreated: pushed.categories.filter((p) => p.action === 'created').length,
      categoriesUpdated: pushed.categories.filter((p) => p.action === 'updated').length,
      subcategoriesCreated: pushed.subcategories.filter((p) => p.action === 'created').length,
      subcategoriesUpdated: pushed.subcategories.filter((p) => p.action === 'updated').length,
      productsCreated: pushed.products.filter((p) => p.action === 'created').length,
      productsUpdated: pushed.products.filter((p) => p.action === 'updated').length,
      failed: pushed.failed.length,
    },
  };
}

module.exports = {
  SYNC_STATUS,
  checkCloudOnline,
  ingestMasterData,
};