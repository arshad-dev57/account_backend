/**
 * ERP Inventory Import Engine
 * Upload → Parse → Validate → Preview → Confirm → Transactional execute
 * Opening qty creates OPENING_BALANCE stock ledger movements (never silent qty set).
 */

const crypto = require('crypto');
const ExcelJS = require('exceljs');
const { randomUUID } = require('crypto');
const prisma = require('../../prisma/client');
const {
  adjustLocationStock,
  resolveLocationIdRequired,
} = require('./locationService');
const { getOrCreateInventorySettings } = require('./inventorySettingsService');
const { findUomByCode, ensureUom, ensureDefaultUoms } = require('./uomService');
const {
  toNumber,
  roundTo,
  computeWeightedAverageCost,
  stockValue,
  MOVEMENT_TYPES,
} = require('./inventoryMath');

/** Official template columns (Factory_ERP_Inventory_Import.xlsx compatible) */
const TEMPLATE_COLUMNS = [
  'SKU / Item Code',
  'Item Name',
  'Description',
  'Category',
  'Sub Category',
  'Warehouse',
  'Warehouse Code',
  'Bin / Rack Location',
  'UOM',
  'Opening Quantity',
  'Current Quantity',
  'Reserved Quantity',
  'Available Quantity',
  'Reorder Level',
  'Maximum Stock Level',
  'Unit Cost',
  'Selling Price',
  'Stock Value',
  'Supplier',
  'Batch / Lot Number',
  'Manufacturing Date',
  'Expiry Date',
  'Last Purchase Date',
  'Last Purchase Price',
  'Tax Rate',
  'Status',
];

const FIELD_ALIASES = {
  sku: ['sku / item code', 'sku', 'item code', 'itemcode', 'product code', 'productcode'],
  name: ['item name', 'name', 'product name', 'productname'],
  description: ['description', 'desc'],
  category: ['category', 'category name'],
  subCategory: ['sub category', 'subcategory', 'sub-category'],
  warehouse: ['warehouse', 'warehouse name', 'location', 'location name'],
  warehouseCode: ['warehouse code', 'location code', 'wh code', 'whcode'],
  bin: ['bin / rack location', 'bin', 'rack', 'rack location', 'bin location'],
  uom: ['uom', 'unit', 'stock unit', 'unit of measure', 'base uom'],
  openingQty: ['opening quantity', 'opening qty', 'opening stock', 'opening'],
  currentQty: ['current quantity', 'current qty', 'current stock', 'qty', 'quantity'],
  reservedQty: ['reserved quantity', 'reserved qty', 'reserved'],
  availableQty: ['available quantity', 'available qty', 'available'],
  reorderLevel: ['reorder level', 'reorder point', 'min stock', 'minimum stock'],
  maxStock: ['maximum stock level', 'maximum stock', 'max stock', 'max level'],
  unitCost: ['unit cost', 'cost', 'cost price', 'inventory cost'],
  sellingPrice: ['selling price', 'sale price', 'price', 'retail price'],
  stockValue: ['stock value', 'inventory value'],
  supplier: ['supplier', 'supplier name', 'vendor'],
  batchNumber: ['batch / lot number', 'batch', 'lot', 'batch number', 'lot number'],
  mfgDate: ['manufacturing date', 'mfg date', 'mfg', 'production date'],
  expiryDate: ['expiry date', 'expiry', 'exp date'],
  lastPurchaseDate: ['last purchase date', 'last bought'],
  lastPurchasePrice: ['last purchase price', 'last cost'],
  taxRate: ['tax rate', 'tax %', 'tax'],
  status: ['status', 'item status'],
};

function normalizeHeader(h) {
  return String(h || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function buildColumnMap(headers) {
  const map = {};
  const normalized = headers.map((h, i) => ({ i, h: normalizeHeader(h), raw: h }));
  for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
    const hit = normalized.find((n) => aliases.includes(n.h));
    if (hit) map[field] = hit.i;
  }
  return map;
}

function cellStr(row, idx) {
  if (idx === undefined || idx === null) return '';
  const v = row[idx];
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).trim();
}

function cellNum(row, idx) {
  if (idx === undefined || idx === null) return null;
  const v = row[idx];
  if (v === null || v === undefined || v === '') return null;
  return toNumber(v, null);
}

function parseDate(v) {
  if (!v) return null;
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function fileHash(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

async function nextBatchNumber(companyId) {
  const year = new Date().getFullYear();
  const prefix = `IMP-${year}-`;
  const last = await prisma.inventoryImportBatch.findFirst({
    where: { companyId, batchNumber: { startsWith: prefix } },
    orderBy: { batchNumber: 'desc' },
    select: { batchNumber: true },
  });
  let seq = 1;
  if (last?.batchNumber) {
    const n = parseInt(last.batchNumber.slice(prefix.length), 10);
    if (Number.isFinite(n)) seq = n + 1;
  }
  return `${prefix}${String(seq).padStart(5, '0')}`;
}

async function parseWorkbookBuffer(buffer, originalName = '') {
  const lower = String(originalName).toLowerCase();
  const isCsv = lower.endsWith('.csv');
  const isLegacyXls = lower.endsWith('.xls') && !lower.endsWith('.xlsx');

  if (isLegacyXls) {
    throw Object.assign(
      new Error(
        'Legacy .xls is not supported. Please save as .xlsx or .csv and try again.'
      ),
      { statusCode: 400 }
    );
  }

  if (isCsv) {
    const text = buffer.toString('utf8');
    const lines = text.split(/\r?\n/).filter((l) => l.trim().length);
    if (!lines.length) return { headers: [], rows: [] };
    const headers = lines[0].split(',').map((h) => h.replace(/^"|"$/g, '').trim());
    const rows = lines.slice(1).map((line) => {
      // simple CSV split (handles quoted commas lightly)
      const cells = [];
      let cur = '';
      let inQ = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
          inQ = !inQ;
          continue;
        }
        if (ch === ',' && !inQ) {
          cells.push(cur);
          cur = '';
          continue;
        }
        cur += ch;
      }
      cells.push(cur);
      return cells;
    });
    return { headers, rows };
  }

  try {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const sheet = workbook.worksheets[0];
    if (!sheet) return { headers: [], rows: [] };

    const headers = [];
    const headerRow = sheet.getRow(1);
    headerRow.eachCell({ includeEmpty: true }, (cell, col) => {
      headers[col - 1] = cell.value == null ? '' : String(cell.text || cell.value).trim();
    });

    const rows = [];
    sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber === 1) return;
      const arr = [];
      row.eachCell({ includeEmpty: true }, (cell, col) => {
        let val = cell.value;
        if (val && typeof val === 'object' && val.result !== undefined) val = val.result;
        if (val && typeof val === 'object' && val.text) val = val.text;
        if (val instanceof Date) val = val.toISOString().slice(0, 10);
        arr[col - 1] = val;
      });
      // skip fully empty
      if (arr.every((c) => c === null || c === undefined || String(c).trim() === '')) return;
      rows.push(arr);
    });

    return { headers, rows };
  } catch (err) {
    throw Object.assign(
      new Error(
        `Failed to parse Excel file: ${err.message || 'invalid workbook'}. Use .xlsx or .csv.`
      ),
      { statusCode: 400 }
    );
  }
}

function mapRow(raw, colMap, excelRowNumber) {
  const get = (field) => cellStr(raw, colMap[field]);
  const getN = (field) => cellNum(raw, colMap[field]);
  return {
    excelRow: excelRowNumber,
    sku: get('sku'),
    name: get('name'),
    description: get('description'),
    category: get('category'),
    subCategory: get('subCategory'),
    warehouse: get('warehouse'),
    warehouseCode: get('warehouseCode'),
    bin: get('bin'),
    uom: get('uom') || 'PCS',
    openingQty: getN('openingQty'),
    currentQty: getN('currentQty'),
    reservedQty: getN('reservedQty'),
    availableQty: getN('availableQty'),
    reorderLevel: getN('reorderLevel'),
    maxStock: getN('maxStock'),
    unitCost: getN('unitCost'),
    sellingPrice: getN('sellingPrice'),
    stockValue: getN('stockValue'),
    supplier: get('supplier'),
    batchNumber: get('batchNumber'),
    mfgDate: parseDate(raw[colMap.mfgDate]),
    expiryDate: parseDate(raw[colMap.expiryDate]),
    lastPurchaseDate: parseDate(raw[colMap.lastPurchaseDate]),
    lastPurchasePrice: getN('lastPurchasePrice'),
    taxRate: getN('taxRate'),
    status: get('status') || 'Active',
  };
}

/**
 * Decide opening stock quantity for ledger:
 * Prefer Opening Quantity. If only Current Quantity provided → STOCK_TAKE / OPENING_ADJUSTMENT.
 * Never post both.
 */
function resolveOpeningMovement(row) {
  const opening = row.openingQty;
  const current = row.currentQty;
  const hasOpening = opening !== null && opening !== undefined && Number(opening) > 0;
  const hasCurrent = current !== null && current !== undefined && Number(current) > 0;

  if (hasOpening) {
    return {
      qty: roundTo(opening),
      movementType: MOVEMENT_TYPES.OPENING_BALANCE,
      reason: 'opening_stock',
      note: 'Imported opening balance',
    };
  }
  if (hasCurrent) {
    return {
      qty: roundTo(current),
      movementType: MOVEMENT_TYPES.OPENING_ADJUSTMENT,
      reason: 'physical_adjustment_in',
      note: 'Imported physical stock count (no opening qty provided)',
    };
  }
  return { qty: 0, movementType: null, reason: null, note: null };
}

async function loadMasterMaps(companyId) {
  await ensureDefaultUoms(companyId);
  const [products, locations, categories, suppliers, settings, uoms] = await Promise.all([
    prisma.product.findMany({
      where: { companyId },
      select: { id: true, sku: true, name: true, currentStock: true, costPrice: true, averageCost: true },
    }),
    prisma.location.findMany({
      where: { companyId, isDeleted: false, isActive: true },
      select: { id: true, name: true, code: true },
    }),
    prisma.category.findMany({
      where: { companyId, isDeleted: false },
      select: { id: true, name: true, parentId: true, level: true },
    }),
    prisma.supplier.findMany({
      where: { companyId },
      select: { id: true, name: true, code: true, companyName: true },
    }),
    getOrCreateInventorySettings(companyId),
    prisma.unitOfMeasure.findMany({
      where: { companyId, isActive: true },
      select: { id: true, code: true, name: true, symbol: true },
    }),
  ]);

  const productBySku = new Map(products.map((p) => [String(p.sku).toUpperCase(), p]));
  const locationByCode = new Map(locations.map((l) => [String(l.code).toUpperCase(), l]));
  const locationByName = new Map(locations.map((l) => [String(l.name).toUpperCase(), l]));
  const categoryByName = new Map(categories.map((c) => [String(c.name).toUpperCase(), c]));
  const supplierByName = new Map(
    suppliers.flatMap((s) => {
      const keys = [s.name, s.companyName, s.code].filter(Boolean);
      return keys.map((k) => [String(k).toUpperCase(), s]);
    })
  );
  const uomByCode = new Map();
  for (const u of uoms) {
    uomByCode.set(String(u.code).toUpperCase(), u);
    if (u.name) uomByCode.set(String(u.name).toUpperCase(), u);
    if (u.symbol) uomByCode.set(String(u.symbol).toUpperCase(), u);
  }

  return {
    productBySku,
    locationByCode,
    locationByName,
    categoryByName,
    categories,
    supplierByName,
    uomByCode,
    settings,
  };
}

async function validateRows(companyId, mappedRows, options = {}) {
  const {
    duplicateSkuMode = 'skip', // skip | update | error
    createMissingMasters = false,
  } = options;

  const masters = await loadMasterMaps(companyId);
  const seenSkuInFile = new Map();
  const results = [];
  const mastersToCreate = {
    warehouses: [],
    categories: [],
    subCategories: [],
    suppliers: [],
    uoms: [],
  };
  const seenCreate = {
    warehouses: new Set(),
    categories: new Set(),
    subCategories: new Set(),
    suppliers: new Set(),
    uoms: new Set(),
  };

  const trackCreate = (bucket, key, label) => {
    const k = String(key).toUpperCase();
    if (seenCreate[bucket].has(k)) return;
    seenCreate[bucket].add(k);
    mastersToCreate[bucket].push(label);
  };

  for (const row of mappedRows) {
    const errors = [];
    const warnings = [];
    let severity = 'valid'; // valid | warning | error | duplicate
    let existingProduct = null;
    let location = null;
    let category = null;
    let subCategory = null;
    let supplier = null;
    let uom = null;
    let action = 'create'; // create | update | skip

    if (!row.sku) errors.push('SKU / Item Code is required.');
    if (!row.name) errors.push('Item Name is required.');
    if (!row.category) errors.push('Category is required.');
    if (!row.uom) errors.push('UOM is required.');
    if (!row.warehouse && !row.warehouseCode) {
      errors.push('Warehouse or Warehouse Code is required.');
    }
    if (row.openingQty === null && row.currentQty === null) {
      errors.push('Opening Quantity or Current Quantity is required.');
    }
    if (row.unitCost === null || row.unitCost < 0) {
      errors.push('Unit Cost is required and must be >= 0.');
    }

    // File-level duplicate SKU
    if (row.sku) {
      const key = row.sku.toUpperCase();
      if (seenSkuInFile.has(key)) {
        errors.push(
          `Duplicate SKU in file (also on row ${seenSkuInFile.get(key)}).`
        );
        severity = 'duplicate';
      } else {
        seenSkuInFile.set(key, row.excelRow);
      }
    }

    // Existing product
    if (row.sku) {
      existingProduct = masters.productBySku.get(row.sku.toUpperCase()) || null;
      if (existingProduct) {
        if (duplicateSkuMode === 'skip') {
          action = 'skip';
          warnings.push(`SKU ${row.sku} already exists — will be skipped.`);
        } else if (duplicateSkuMode === 'update') {
          action = 'update';
          warnings.push(`SKU ${row.sku} already exists — master data / stock will be updated.`);
        } else {
          errors.push(`SKU ${row.sku} already exists. Choose Skip or Update mode.`);
          action = 'skip';
        }
        if (severity !== 'duplicate') severity = 'duplicate';
      }
    }

    // Warehouse — create when createMissingMasters is enabled
    let pendingWarehouse = null;
    if (row.warehouseCode) {
      location = masters.locationByCode.get(row.warehouseCode.toUpperCase()) || null;
    }
    if (!location && row.warehouse) {
      location = masters.locationByName.get(row.warehouse.toUpperCase()) || null;
    }
    // Placeholder from an earlier row's "will be created" — not a real Location yet
    if (location && (location._pending || !location.id)) {
      pendingWarehouse = {
        code: location.code || row.warehouseCode || row.warehouse,
        name: location.name || row.warehouse || row.warehouseCode,
      };
      location = null;
    }
    if (!location && !pendingWarehouse && (row.warehouseCode || row.warehouse)) {
      const code = (row.warehouseCode || row.warehouse || 'WH')
        .toUpperCase()
        .replace(/[^A-Z0-9_-]/g, '')
        .slice(0, 32) || 'WH';
      const name = row.warehouse || row.warehouseCode || code;
      if (createMissingMasters) {
        pendingWarehouse = { code, name };
        trackCreate('warehouses', code, `${name} (${code})`);
        const placeholder = { id: null, code, name, _pending: true };
        masters.locationByCode.set(code.toUpperCase(), placeholder);
        masters.locationByName.set(name.toUpperCase(), placeholder);
      } else {
        if (row.warehouseCode) {
          errors.push(`Warehouse Code "${row.warehouseCode}" does not exist.`);
        }
        if (row.warehouse && !row.warehouseCode) {
          errors.push(`Warehouse "${row.warehouse}" does not exist.`);
        } else if (row.warehouse && row.warehouseCode) {
          errors.push(`Warehouse "${row.warehouse}" does not exist.`);
        }
        errors.push(
          'Enable "Create missing master data" to auto-create warehouses, or add them under Inventory → Locations first.'
        );
      }
    }

    // Category
    if (row.category) {
      category = masters.categoryByName.get(row.category.toUpperCase()) || null;
      if (!category) {
        if (createMissingMasters) {
          trackCreate('categories', row.category, row.category);
          masters.categoryByName.set(row.category.toUpperCase(), {
            id: null,
            name: row.category,
            _pending: true,
          });
        } else {
          errors.push(`Category "${row.category}" does not exist.`);
        }
      } else if (category._pending || !category.id) {
        category = null;
      }
    }
    if (row.subCategory) {
      subCategory = masters.categoryByName.get(row.subCategory.toUpperCase()) || null;
      if (!subCategory) {
        if (createMissingMasters) {
          trackCreate('subCategories', row.subCategory, row.subCategory);
          masters.categoryByName.set(row.subCategory.toUpperCase(), {
            id: null,
            name: row.subCategory,
            _pending: true,
          });
        } else {
          errors.push(`Sub Category "${row.subCategory}" does not exist.`);
        }
      } else if (subCategory._pending || !subCategory.id) {
        subCategory = null;
      }
    }

    // Supplier (optional)
    if (row.supplier) {
      supplier = masters.supplierByName.get(row.supplier.toUpperCase()) || null;
      if (!supplier) {
        if (createMissingMasters) {
          trackCreate('suppliers', row.supplier, row.supplier);
          masters.supplierByName.set(row.supplier.toUpperCase(), {
            id: null,
            name: row.supplier,
            _pending: true,
          });
        } else {
          errors.push(`"${row.supplier}" does not exist in Suppliers.`);
        }
      } else if (supplier._pending || !supplier.id) {
        supplier = null;
      }
    }

    // UOM — in-memory lookup (no per-row DB hit)
    if (row.uom) {
      uom = masters.uomByCode.get(String(row.uom).toUpperCase()) || null;
      if (!uom) {
        if (createMissingMasters) {
          trackCreate('uoms', row.uom, String(row.uom).toUpperCase());
          masters.uomByCode.set(String(row.uom).toUpperCase(), {
            code: String(row.uom).toUpperCase(),
            _pending: true,
          });
        } else {
          errors.push(`UOM "${row.uom}" does not exist.`);
        }
      } else if (uom._pending) {
        uom = { code: String(row.uom).toUpperCase() };
      }
    }

    // Bin
    if (masters.settings.enableBinManagement && !row.bin) {
      warnings.push('Bin / Rack Location is empty.');
    }

    const movement = resolveOpeningMovement(row);
    if (movement.qty > 0 && row.reorderLevel != null && movement.qty <= row.reorderLevel) {
      warnings.push('Current/opening stock is at or below reorder level.');
    }

    // Dual Opening+Current qty is expected template noise — Opening wins; do not warn every row.

    if (errors.length) severity = severity === 'duplicate' ? 'duplicate' : 'error';
    else if (warnings.length || severity === 'duplicate') {
      if (severity !== 'duplicate') severity = 'warning';
    } else severity = 'valid';

    results.push({
      ...row,
      // JSON-safe dates for Prisma Json columns
      mfgDate: row.mfgDate ? new Date(row.mfgDate).toISOString() : null,
      expiryDate: row.expiryDate ? new Date(row.expiryDate).toISOString() : null,
      lastPurchaseDate: row.lastPurchaseDate
        ? new Date(row.lastPurchaseDate).toISOString()
        : null,
      severity,
      action: errors.length ? 'skip' : action,
      errors,
      warnings,
      resolved: {
        productId: existingProduct?.id || null,
        locationId: location?.id || null,
        pendingWarehouse,
        categoryId: category?.id || null,
        subCategoryId: subCategory?.id || null,
        supplierId: supplier?.id || null,
        uomCode: uom?.code || row.uom,
        movement,
      },
    });
  }

  const summary = {
    totalRows: results.length,
    validRows: results.filter((r) => r.severity === 'valid').length,
    warningRows: results.filter((r) => r.severity === 'warning').length,
    errorRows: results.filter((r) => r.severity === 'error').length,
    duplicateRows: results.filter((r) => r.severity === 'duplicate').length,
    importableRows: results.filter(
      (r) => r.errors.length === 0 && r.action !== 'skip'
    ).length,
    mastersToCreate,
  };

  return { results, summary, settings: masters.settings };
}

async function ensureCategory(tx, companyId, userId, name, parentId = null) {
  const existing = await tx.category.findFirst({
    where: { companyId, name: { equals: name, mode: 'insensitive' }, isDeleted: false },
  });
  if (existing) return existing;
  return tx.category.create({
    data: {
      name,
      slug: name.toLowerCase().replace(/\s+/g, '-').slice(0, 80),
      companyId,
      parentId,
      level: parentId ? 2 : 1,
      createdBy: userId,
      isActive: true,
    },
  });
}

async function ensureLocation(tx, companyId, userId, { code, name }) {
  const codeKey =
    String(code || name || 'WH')
      .toUpperCase()
      .replace(/[^A-Z0-9_-]/g, '')
      .slice(0, 32) || 'WH';
  const nameKey = String(name || codeKey).trim() || codeKey;

  let loc = await tx.location.findFirst({
    where: {
      companyId,
      isDeleted: false,
      OR: [
        { code: { equals: codeKey, mode: 'insensitive' } },
        { name: { equals: nameKey, mode: 'insensitive' } },
      ],
    },
  });
  if (loc) return loc;

  let uniqueCode = codeKey;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const clash = await tx.location.findFirst({
      where: { companyId, code: uniqueCode },
      select: { id: true },
    });
    if (!clash) break;
    uniqueCode = `${codeKey}-${attempt + 1}`.slice(0, 32);
  }

  return tx.location.create({
    data: {
      companyId,
      name: nameKey,
      code: uniqueCode,
      type: 'Warehouse',
      isDefault: false,
      isActive: true,
      isDeleted: false,
      createdBy: userId,
    },
  });
}

async function ensureSupplier(tx, companyId, userId, name) {
  const existing = await tx.supplier.findFirst({
    where: {
      companyId,
      OR: [
        { name: { equals: name, mode: 'insensitive' } },
        { companyName: { equals: name, mode: 'insensitive' } },
      ],
    },
  });
  if (existing) return existing;
  return tx.supplier.create({
    data: {
      name,
      companyName: name,
      companyId,
      createdBy: userId,
      status: 'active',
    },
  });
}

async function applyWac(tx, productId, recvQty, recvCost, costPrecision) {
  const product = await tx.product.findUnique({
    where: { id: productId },
    select: { currentStock: true, averageCost: true, costPrice: true },
  });
  // currentStock is pre-adjust in some flows — use previous on-hand = current - recv for WAC before receipt
  const existingQty = Math.max(0, toNumber(product.currentStock) - toNumber(recvQty));
  const existingAvg = toNumber(product.averageCost ?? product.costPrice);
  const newAvg = computeWeightedAverageCost({
    existingQty,
    existingAvgCost: existingAvg,
    receivedQty: recvQty,
    receivedUnitCost: recvCost,
    costPrecision,
  });
  await tx.product.update({
    where: { id: productId },
    data: {
      averageCost: newAvg,
      costPrice: newAvg,
    },
  });
  return newAvg;
}

/**
 * Upload + validate → create Preview batch
 */
async function createPreviewFromFile({
  companyId,
  userId,
  buffer,
  fileName,
  fileSize,
  duplicateSkuMode = 'skip',
  createMissingMasters = false,
  openingDate = null,
  forceReimport = false,
}) {
  const settings = await getOrCreateInventorySettings(companyId);
  const maxMb = settings.maxImportFileMb || 15;
  if (fileSize && fileSize > maxMb * 1024 * 1024) {
    throw Object.assign(
      new Error(`File exceeds maximum size of ${maxMb} MB`),
      { statusCode: 400 }
    );
  }

  const hash = fileHash(buffer);
  const prior = await prisma.inventoryImportBatch.findFirst({
    where: {
      companyId,
      fileHash: hash,
      status: { in: ['Completed', 'CompletedWithWarnings'] },
      importType: 'ITEM_MASTER',
    },
    orderBy: { createdAt: 'desc' },
  });
  if (prior && !forceReimport) {
    return {
      duplicateFile: true,
      priorBatch: {
        id: prior.id,
        batchNumber: prior.batchNumber,
        completedAt: prior.completedAt,
        importedCount: prior.importedCount,
      },
      message:
        'This file was already imported successfully. Re-importing may create duplicate opening balances. Confirm to continue.',
    };
  }

  const { headers, rows } = await parseWorkbookBuffer(buffer, fileName);
  if (!headers.length || !rows.length) {
    throw Object.assign(new Error('No data rows found in file'), { statusCode: 400 });
  }

  const colMap = buildColumnMap(headers);
  if (colMap.sku === undefined || colMap.name === undefined) {
    throw Object.assign(
      new Error(
        'Could not map required columns. Ensure the file matches the official template (SKU / Item Code, Item Name, …).'
      ),
      { statusCode: 400 }
    );
  }

  const mapped = rows.map((raw, i) => mapRow(raw, colMap, i + 2));
  const { results, summary } = await validateRows(companyId, mapped, {
    duplicateSkuMode,
    createMissingMasters,
  });

  const batchNumber = await nextBatchNumber(companyId);
  const batch = await prisma.inventoryImportBatch.create({
    data: {
      id: randomUUID(),
      companyId,
      batchNumber,
      importType: 'ITEM_MASTER',
      fileName,
      fileHash: hash,
      fileSize: fileSize || buffer.length,
      status: 'Preview',
      duplicateSkuMode,
      createMissingMasters: !!createMissingMasters,
      openingDate: openingDate
        ? new Date(openingDate)
        : settings.inventoryOpeningDate || new Date(),
      totalRows: summary.totalRows,
      validRows: summary.validRows,
      warningRows: summary.warningRows,
      errorRows: summary.errorRows,
      duplicateRows: summary.duplicateRows,
      previewData: results,
      columnMapping: colMap,
      errorReport: results.filter((r) => r.errors.length),
      warningReport: results.filter((r) => r.warnings.length),
      createdBy: userId,
      updatedAt: new Date(),
    },
  });

  return {
    duplicateFile: false,
    batch: {
      id: batch.id,
      batchNumber: batch.batchNumber,
      status: batch.status,
      companyId: batch.companyId,
      ...summary,
      duplicateSkuMode,
      createMissingMasters: !!createMissingMasters,
      openingDate: batch.openingDate,
    },
    rows: results,
    columnMapping: colMap,
    headers,
    mastersToCreate: summary.mastersToCreate || null,
  };
}

/**
 * Execute confirmed import in small transactions (avoids P2028 timeout on large files).
 */
async function executeImport(batchId, companyId, userId, opts = {}) {
  const alreadyClaimed = opts.alreadyClaimed === true;
  if (!batchId) {
    throw Object.assign(new Error('Import batch id is required'), { statusCode: 400 });
  }
  if (!companyId) {
    throw Object.assign(new Error('Company context required'), { statusCode: 400 });
  }

  let batch = await prisma.inventoryImportBatch.findFirst({
    where: { id: String(batchId) },
  });
  if (!batch) {
    throw Object.assign(new Error('Import batch not found'), { statusCode: 404 });
  }

  // Preview may have been created under a different active company than confirm.
  // Prefer the batch's company (masters/stock are scoped there) when the user still has access.
  if (batch.companyId !== companyId) {
    console.warn('[executeImport] company mismatch', {
      batchId: batch.id,
      batchCompanyId: batch.companyId,
      activeCompanyId: companyId,
      userId,
    });
    const { userHasCompanyAccess } = require('../../utils/companyAccess');
    const allowed = await userHasCompanyAccess(userId, batch.companyId);
    if (!allowed) {
      throw Object.assign(
        new Error(
          'This import batch belongs to another company. Switch to that company in the header switcher, then Confirm again.'
        ),
        { statusCode: 409 }
      );
    }
  }
  const effectiveCompanyId = batch.companyId;
  // Shadow request company with batch company for all subsequent writes
  companyId = effectiveCompanyId;

  // Recover stale "Processing" locks (client retry / crashed request)
  if (batch.status === 'Processing' && !alreadyClaimed) {
    const started = new Date(batch.startedAt || batch.updatedAt || 0).getTime();
    const ageMs = Date.now() - started;
    if (ageMs > 45 * 60 * 1000) {
      batch = await prisma.inventoryImportBatch.update({
        where: { id: batch.id },
        data: {
          status: 'Failed',
          resultSummary: { error: 'Previous import attempt timed out — ready to retry' },
        },
      });
    } else {
      throw Object.assign(
        new Error('Import is already in progress. Wait a moment and try again.'),
        { statusCode: 409 }
      );
    }
  }

  const startable = alreadyClaimed
    ? ['Preview', 'Failed', 'Processing']
    : ['Preview', 'Failed'];
  if (!startable.includes(batch.status)) {
    throw Object.assign(
      new Error(`Batch status is ${batch.status}; only Preview / Failed batches can be confirmed`),
      { statusCode: 400 }
    );
  }

  const rows = Array.isArray(batch.previewData) ? batch.previewData : [];
  const importable = rows.filter((r) => !r.errors?.length && r.action !== 'skip');
  const settings = await getOrCreateInventorySettings(effectiveCompanyId);

  if (!alreadyClaimed || batch.status !== 'Processing') {
    await prisma.inventoryImportBatch.update({
      where: { id: batch.id },
      data: { status: 'Processing', startedAt: new Date(), resultSummary: null },
    });
  }

  let importedCount = 0;
  let updatedCount = 0;
  let failedCount = 0;
  const skippedCount = rows.filter((r) => r.action === 'skip' || r.errors?.length).length;
  const resultRows = [];
  const failedRows = [];
  let openingValueTotal = 0;

  const locationCache = new Map();
  const categoryCache = new Map();
  const supplierCache = new Map();
  const validatedLocations = new Set();

  // Larger chunks without per-row GL — much faster for 700+ rows
  const CHUNK = 10;
  const TX_OPTS = { timeout: 60_000, maxWait: 20_000 };

  async function resolveMasters(tx, row) {
    let categoryId = row.resolved?.categoryId || null;
    let subCategoryId = row.resolved?.subCategoryId || null;
    let supplierId = row.resolved?.supplierId || null;
    let locationId = row.resolved?.locationId || null;

    if (batch.createMissingMasters) {
      if (!locationId) {
        const pending =
          row.resolved?.pendingWarehouse ||
          (row.warehouseCode || row.warehouse
            ? {
                code: row.warehouseCode || row.warehouse,
                name: row.warehouse || row.warehouseCode,
              }
            : null);
        if (pending) {
          const cacheKey = String(pending.code || pending.name).toUpperCase().trim();
          if (locationCache.has(cacheKey)) {
            locationId = locationCache.get(cacheKey);
          } else {
            const loc = await ensureLocation(tx, effectiveCompanyId, userId, pending);
            locationId = loc.id;
            locationCache.set(cacheKey, locationId);
            if (loc.code) locationCache.set(String(loc.code).toUpperCase(), locationId);
            if (loc.name) locationCache.set(String(loc.name).toUpperCase(), locationId);
          }
        }
      }

      if (row.category && !categoryId) {
        const key = String(row.category).toUpperCase();
        if (categoryCache.has(key)) {
          categoryId = categoryCache.get(key);
        } else {
          const cat = await ensureCategory(tx, effectiveCompanyId, userId, row.category);
          categoryId = cat.id;
          categoryCache.set(key, categoryId);
        }
      }
      if (row.subCategory && !subCategoryId) {
        const key = `SUB:${String(row.subCategory).toUpperCase()}:${categoryId || ''}`;
        if (categoryCache.has(key)) {
          subCategoryId = categoryCache.get(key);
        } else {
          const sub = await ensureCategory(
            tx,
            effectiveCompanyId,
            userId,
            row.subCategory,
            categoryId
          );
          subCategoryId = sub.id;
          categoryCache.set(key, subCategoryId);
          categoryCache.set(String(row.subCategory).toUpperCase(), subCategoryId);
        }
      }
      if (row.supplier && !supplierId) {
        const key = String(row.supplier).toUpperCase();
        if (supplierCache.has(key)) {
          supplierId = supplierCache.get(key);
        } else {
          const sup = await ensureSupplier(tx, effectiveCompanyId, userId, row.supplier);
          supplierId = sup.id;
          supplierCache.set(key, supplierId);
        }
      }
      if (row.uom) {
        await ensureUom(effectiveCompanyId, row.uom, row.uom);
      }
    }

    // Prefer caches filled during master warm-up
    if (!locationId && (row.warehouseCode || row.warehouse)) {
      const codeKey = String(row.warehouseCode || '').toUpperCase();
      const nameKey = String(row.warehouse || '').toUpperCase();
      locationId =
        (codeKey && locationCache.get(codeKey)) ||
        (nameKey && locationCache.get(nameKey)) ||
        null;
    }

    if (!locationId) {
      throw Object.assign(
        new Error(`Row ${row.excelRow}: warehouse missing`),
        { statusCode: 400 }
      );
    }
    if (!validatedLocations.has(locationId)) {
      await resolveLocationIdRequired(tx, effectiveCompanyId, locationId, userId);
      validatedLocations.add(locationId);
    }
    return { categoryId, subCategoryId, supplierId, locationId };
  }

  async function importOneRow(tx, row) {
    const { categoryId, subCategoryId, supplierId, locationId } = await resolveMasters(tx, row);

    const unitCost = toNumber(row.unitCost);
    const sellingPrice = toNumber(row.sellingPrice, unitCost);
    const uomCode = row.resolved?.uomCode || row.uom || 'PCS';
    const movement = row.resolved?.movement || resolveOpeningMovement(row);
    const qty = roundTo(movement.qty, settings.quantityPrecision);

    let productId = row.resolved?.productId || null;
    let productName = row.name;
    let actionDone = row.action;
    let created = 0;
    let updated = 0;

    if (row.action === 'update' && productId) {
      await tx.product.update({
        where: { id: productId },
        data: {
          name: row.name,
          description: row.description || undefined,
          categoryId: categoryId || undefined,
          categoryName: row.category || undefined,
          subCategoryId: subCategoryId || undefined,
          subCategoryName: row.subCategory || undefined,
          supplierId: supplierId || undefined,
          supplierName: row.supplier || undefined,
          stockUnitName: uomCode,
          costPrice: unitCost,
          averageCost: unitCost,
          sellingPrice,
          lastPurchasePrice:
            row.lastPurchasePrice != null ? toNumber(row.lastPurchasePrice) : undefined,
          lastPurchaseDate: row.lastPurchaseDate || undefined,
          taxRate: row.taxRate != null ? toNumber(row.taxRate) : undefined,
          reorderLevel: row.reorderLevel != null ? Math.round(toNumber(row.reorderLevel)) : undefined,
          maximumStock: row.maxStock != null ? toNumber(row.maxStock) : undefined,
          rackLocationName: row.bin || undefined,
          batchNumber: row.batchNumber || undefined,
          manufacturingDate: row.mfgDate || undefined,
          expiryDate: row.expiryDate || undefined,
          isBatchManaged: !!row.batchNumber,
          hasExpiry: !!row.expiryDate,
          isExpiryManaged: !!row.expiryDate,
          status: row.status || 'Active',
          updatedBy: userId,
        },
      });
      updated = 1;
    } else {
      // Resume-safe: skip create if SKU already landed from a prior chunk/attempt
      const existingBySku = await tx.product.findFirst({
        where: {
          companyId,
          sku: { equals: row.sku, mode: 'insensitive' },
        },
        select: { id: true, name: true },
      });
      if (existingBySku) {
        productId = existingBySku.id;
        productName = existingBySku.name || row.name;
        actionDone = 'update';
        updated = 1;
      } else {
        const product = await tx.product.create({
          data: {
            name: row.name,
            sku: row.sku,
            description: row.description || null,
            categoryId,
            categoryName: row.category || null,
            subCategoryId,
            subCategoryName: row.subCategory || null,
            supplierId,
            supplierName: row.supplier || null,
            stockUnitName: uomCode,
            costPrice: unitCost,
            averageCost: unitCost,
            sellingPrice,
            lastPurchasePrice:
              row.lastPurchasePrice != null ? toNumber(row.lastPurchasePrice) : null,
            lastPurchaseDate: row.lastPurchaseDate || null,
            taxRate: toNumber(row.taxRate),
            reorderLevel: Math.round(toNumber(row.reorderLevel)),
            maximumStock: toNumber(row.maxStock, 100),
            minimumStock: toNumber(row.reorderLevel, 5),
            openingStock: 0,
            currentStock: 0,
            availableStock: 0,
            reservedStock: 0,
            totalValue: 0,
            rackLocationName: row.bin || 'A-1-B1',
            batchNumber: row.batchNumber || null,
            manufacturingDate: row.mfgDate || null,
            expiryDate: row.expiryDate || null,
            isBatchManaged: !!row.batchNumber,
            hasExpiry: !!row.expiryDate,
            isExpiryManaged: !!row.expiryDate,
            status: row.status || 'Active',
            companyId,
            createdBy: userId,
          },
        });
        productId = product.id;
        created = 1;
        actionDone = 'create';
      }
    }

    if (qty > 0 && productId) {
      // Avoid double opening stock if this product already has an import opening at this location
      const alreadyPosted = await tx.stockMovement.findFirst({
        where: {
          companyId,
          productId,
          locationId,
          OR: [
            { importBatchId: batch.id },
            {
              movementType: { in: ['OPENING_BALANCE', 'OPENING_ADJUSTMENT'] },
              reason: { in: ['opening_stock', 'physical_adjustment_in'] },
            },
          ],
        },
        select: { id: true },
      });
      if (alreadyPosted) {
        return {
          excelRow: row.excelRow,
          sku: row.sku,
          status: 'imported',
          action: actionDone,
          productId,
          created,
          updated,
          accounting: null,
          openingValue: 0,
        };
      }

      const stockResult = await adjustLocationStock(tx, {
        companyId,
        productId,
        locationId,
        delta: qty,
        productName,
        allowNegative: settings.allowNegativeStock,
      });

      await applyWac(tx, productId, qty, unitCost, settings.costPrecision);

      const movementDate = batch.openingDate || new Date();
      const lineValue = stockValue(qty, unitCost, settings.costPrecision);
      await tx.stockMovement.create({
        data: {
          productId,
          productName,
          type: 'stock_in',
          movementType: movement.movementType,
          quantity: qty,
          baseQuantity: qty,
          uom: uomCode,
          previousStock: stockResult.previousLocationStock,
          newStock: stockResult.newLocationStock,
          unitCost,
          totalValue: lineValue,
          batchNumber: row.batchNumber || null,
          binLocation: row.bin || null,
          movementDate,
          stockType: 'bulk',
          stockDetails: {
            importBatchId: batch.id,
            batchNumber: batch.batchNumber,
            excelRow: row.excelRow,
            source: 'inventory_import',
          },
          reason: movement.reason || 'opening_stock',
          supplierId: supplierId || null,
          supplierName: row.supplier || null,
          reference: batch.batchNumber,
          importBatchId: batch.id,
          notes: movement.note,
          status: 'Completed',
          createdBy: userId,
          companyId,
          locationId,
        },
      });

      return {
        excelRow: row.excelRow,
        sku: row.sku,
        status: 'imported',
        action: actionDone,
        productId,
        created,
        updated,
        accounting: null,
        openingValue: lineValue,
      };
    }

    return {
      excelRow: row.excelRow,
      sku: row.sku,
      status: 'imported',
      action: actionDone,
      productId,
      created,
      updated,
      accounting: null,
      openingValue: 0,
    };
  }

  try {
    // Pre-create unique missing masters once (short tx) so row chunks stay fast
    if (batch.createMissingMasters && importable.length) {
      const uniqueWarehouses = new Map();
      const uniqueCategories = new Set();
      const uniqueSubCategories = new Map(); // sub -> parent category name
      const uniqueSuppliers = new Set();
      const uniqueUoms = new Set();

      for (const row of importable) {
        if (!row.resolved?.locationId && (row.resolved?.pendingWarehouse || row.warehouseCode || row.warehouse)) {
          const pending =
            row.resolved?.pendingWarehouse || {
              code: row.warehouseCode || row.warehouse,
              name: row.warehouse || row.warehouseCode,
            };
          const key = String(pending.code || pending.name).toUpperCase().trim();
          if (key) uniqueWarehouses.set(key, pending);
        }
        if (row.category && !row.resolved?.categoryId) uniqueCategories.add(row.category);
        if (row.subCategory && !row.resolved?.subCategoryId) {
          uniqueSubCategories.set(row.subCategory, row.category || null);
        }
        if (row.supplier && !row.resolved?.supplierId) uniqueSuppliers.add(row.supplier);
        if (row.uom) uniqueUoms.add(row.uom);
      }

      await prisma.$transaction(async (tx) => {
        for (const pending of uniqueWarehouses.values()) {
          const cacheKey = String(pending.code || pending.name).toUpperCase().trim();
          if (locationCache.has(cacheKey)) continue;
          const loc = await ensureLocation(tx, companyId, userId, pending);
          locationCache.set(cacheKey, loc.id);
          if (loc.code) locationCache.set(String(loc.code).toUpperCase(), loc.id);
          if (loc.name) locationCache.set(String(loc.name).toUpperCase(), loc.id);
          validatedLocations.add(loc.id);
        }
        for (const name of uniqueCategories) {
          const key = String(name).toUpperCase();
          if (categoryCache.has(key)) continue;
          const cat = await ensureCategory(tx, companyId, userId, name);
          categoryCache.set(key, cat.id);
        }
        for (const [subName, parentName] of uniqueSubCategories.entries()) {
          const parentId = parentName
            ? categoryCache.get(String(parentName).toUpperCase()) || null
            : null;
          const key = `SUB:${String(subName).toUpperCase()}:${parentId || ''}`;
          if (categoryCache.has(key)) continue;
          const sub = await ensureCategory(tx, companyId, userId, subName, parentId);
          categoryCache.set(key, sub.id);
          categoryCache.set(String(subName).toUpperCase(), sub.id);
        }
        for (const name of uniqueSuppliers) {
          const key = String(name).toUpperCase();
          if (supplierCache.has(key)) continue;
          const sup = await ensureSupplier(tx, companyId, userId, name);
          supplierCache.set(key, sup.id);
        }
      }, TX_OPTS);

      for (const uom of uniqueUoms) {
        await ensureUom(companyId, uom, uom);
      }
    }

    // Warm GL accounts once — we post a single summary JE after all rows
    try {
      const {
        findOrCreateInventoryAccount,
        findOrCreateEquityAccount,
      } = require('./stockAccountingService');
      await findOrCreateInventoryAccount(prisma, companyId, userId);
      await findOrCreateEquityAccount(prisma, companyId, userId, '3010');
    } catch (warmErr) {
      console.warn('[executeImport] GL account warm-up skipped:', warmErr.message);
    }

    const processRowResult = (r) => {
      importedCount += r.created || 0;
      updatedCount += r.updated || 0;
      openingValueTotal += Number(r.openingValue) || 0;
      resultRows.push({
        excelRow: r.excelRow,
        sku: r.sku,
        status: r.status,
        action: r.action,
        productId: r.productId,
      });
    };

    const failRow = (row, err) => {
      failedCount += 1;
      const message = err?.message || String(err);
      console.error(`[executeImport] row ${row.excelRow} (${row.sku}) failed:`, message);
      failedRows.push({ excelRow: row.excelRow, sku: row.sku, error: message });
      resultRows.push({
        excelRow: row.excelRow,
        sku: row.sku,
        status: 'failed',
        action: row.action,
        error: message,
      });
    };

    for (let i = 0; i < importable.length; i += CHUNK) {
      const slice = importable.slice(i, i + CHUNK);
      try {
        const chunkResults = await prisma.$transaction(async (tx) => {
          const out = [];
          for (const row of slice) {
            out.push(await importOneRow(tx, row));
          }
          return out;
        }, TX_OPTS);
        for (const r of chunkResults) processRowResult(r);
      } catch (chunkErr) {
        // One bad row must not abort the rest — fall back to per-row txs
        console.warn(
          `[executeImport] chunk ${i}-${i + slice.length} failed (${chunkErr.message}); retrying row-by-row`
        );
        for (const row of slice) {
          try {
            const r = await prisma.$transaction((tx) => importOneRow(tx, row), TX_OPTS);
            processRowResult(r);
          } catch (rowErr) {
            failRow(row, rowErr);
          }
        }
      }

      if (i === 0 || (i + CHUNK) % 50 === 0 || i + CHUNK >= importable.length) {
        await prisma.inventoryImportBatch.update({
          where: { id: batch.id },
          data: {
            startedAt: new Date(),
            resultSummary: {
              progress: Math.min(importable.length, i + CHUNK),
              total: importable.length,
              importedCount,
              updatedCount,
              failedCount,
            },
          },
        });
      }
    }

    // One summary opening JE for the whole batch (avoids 700 slow per-row posts)
    if (openingValueTotal > 0) {
      try {
        const {
          findOrCreateInventoryAccount,
          findOrCreateEquityAccount,
          createStockJournalEntry,
        } = require('./stockAccountingService');
        const inventoryAccount = await findOrCreateInventoryAccount(prisma, companyId, userId);
        const equityAccount = await findOrCreateEquityAccount(prisma, companyId, userId, '3010');
        if (inventoryAccount && equityAccount) {
          await createStockJournalEntry(prisma, {
            companyId,
            userId,
            description: `Inventory Import Opening Stock — ${batch.batchNumber} (${importedCount + updatedCount} items)`,
            reference: `${batch.batchNumber} | IMPORT-OPENING`,
            debitAccount: inventoryAccount,
            creditAccount: equityAccount,
            amount: openingValueTotal,
          });
        }
      } catch (acctErr) {
        console.error('[executeImport] summary opening GL warning:', acctErr.message);
      }
    }

    const hasWarnings = batch.warningRows > 0 || failedCount > 0;
    const finalStatus = hasWarnings ? 'CompletedWithWarnings' : 'Completed';

    const updated = await prisma.inventoryImportBatch.update({
      where: { id: batch.id },
      data: {
        status: finalStatus,
        importedCount,
        updatedCount,
        skippedCount: skippedCount + failedCount,
        completedAt: new Date(),
        resultSummary: {
          importedCount,
          updatedCount,
          skippedCount,
          failedCount,
          failedRows: failedRows.slice(0, 100),
          openingValueTotal,
          totalRows: batch.totalRows,
          warningRows: batch.warningRows,
          errorRows: batch.errorRows,
        },
        previewData: rows,
      },
    });

    return {
      batch: updated,
      importedCount,
      updatedCount,
      skippedCount,
      failedCount,
      rows: resultRows,
    };
  } catch (err) {
    try {
      await prisma.inventoryImportBatch.update({
        where: { id: batch.id },
        data: {
          status: 'Failed',
          resultSummary: {
            error: err.message,
            importedCount,
            updatedCount,
            failedCount,
            processedRows: resultRows.length,
            failedRows: failedRows.slice(0, 50),
          },
          completedAt: new Date(),
        },
      });
    } catch (updateErr) {
      console.error('Failed to mark import batch Failed:', updateErr.message);
    }
    throw err;
  }
}

async function buildTemplateBuffer() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Inventory Import');
  ws.addRow(TEMPLATE_COLUMNS);
  ws.getRow(1).font = { bold: true };
  ws.addRow([
    'FAC-1001',
    'Steel Rod 12mm',
    'Mild steel construction rod',
    'Raw Materials',
    'Steel',
    'Main Warehouse',
    'MAIN',
    'A-01-R1',
    'KG',
    500,
    500,
    0,
    500,
    50,
    2000,
    120.5,
    150,
    '',
    'Steel Supplies Co',
    'LOT-2026-01',
    '2026-01-15',
    '2028-01-15',
    '2026-02-01',
    118,
    18,
    'Active',
  ]);
  ws.columns.forEach((c) => {
    c.width = 18;
  });
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

async function getBatch(companyId, batchId) {
  return prisma.inventoryImportBatch.findFirst({
    where: { id: batchId, companyId },
  });
}

async function listBatches(companyId, { take = 20 } = {}) {
  return prisma.inventoryImportBatch.findMany({
    where: { companyId },
    orderBy: { createdAt: 'desc' },
    take,
  });
}

module.exports = {
  TEMPLATE_COLUMNS,
  FIELD_ALIASES,
  createPreviewFromFile,
  executeImport,
  buildTemplateBuffer,
  getBatch,
  listBatches,
  validateRows,
  parseWorkbookBuffer,
  resolveOpeningMovement,
  MOVEMENT_TYPES,
};
