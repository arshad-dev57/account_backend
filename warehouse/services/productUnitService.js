/**
 * Product-specific multi-unit packaging service.
 * Stock balances always live in the product base unit.
 * Every configured unit stores an explicit conversionFactor > 0:
 *   baseQty = enteredQty * conversionFactor
 */
const { randomUUID } = require('crypto');
const prisma = require('../../prisma/client');
const { toNumber, roundTo } = require('./inventoryMath');
const {
  resolveProductUom,
  isFractionalUnit,
  normalizeUnitCode,
} = require('./productUomService');

function assertPositiveFactor(factor, label = 'conversionFactor') {
  const n = toNumber(factor, NaN);
  if (!Number.isFinite(n) || n <= 0) {
    const err = new Error(`${label} must be a positive number`);
    err.statusCode = 400;
    throw err;
  }
  return n;
}

function normalizeUnitInput(raw = {}, index = 0) {
  const unitName = String(raw.unitName || raw.name || '').trim();
  if (!unitName) {
    const err = new Error(`Unit name is required (row ${index + 1})`);
    err.statusCode = 400;
    throw err;
  }
  const conversionFactor = assertPositiveFactor(
    raw.conversionFactor ?? raw.factor ?? 1,
    `Conversion factor for ${unitName}`
  );
  const barcode = raw.barcode != null && String(raw.barcode).trim()
    ? String(raw.barcode).trim()
    : null;
  return {
    id: raw.id || null,
    unitName,
    unitCode: raw.unitCode
      ? String(raw.unitCode).trim().toUpperCase()
      : normalizeUnitCode(unitName),
    uomId: raw.uomId || null,
    conversionFactor,
    isBase: Boolean(raw.isBase),
    allowPurchase: raw.allowPurchase !== false,
    allowSale: raw.allowSale !== false,
    isDefaultSale: Boolean(raw.isDefaultSale),
    isDefaultPurchase: Boolean(raw.isDefaultPurchase),
    barcode,
    purchasePrice:
      raw.purchasePrice != null && raw.purchasePrice !== ''
        ? toNumber(raw.purchasePrice)
        : null,
    sellingPrice:
      raw.sellingPrice != null && raw.sellingPrice !== ''
        ? toNumber(raw.sellingPrice)
        : null,
    sortOrder: Number.isFinite(Number(raw.sortOrder)) ? Number(raw.sortOrder) : index,
    isActive: raw.isActive !== false,
  };
}

/**
 * Validate a full units array for one product.
 * Ensures exactly one base unit with factor 1, unique names/barcodes, ≥1 sale unit.
 */
function validateUnitsConfig(unitsInput, { requireSaleUnit = true } = {}) {
  if (!Array.isArray(unitsInput) || unitsInput.length === 0) {
    const err = new Error('At least one unit configuration is required');
    err.statusCode = 400;
    throw err;
  }
  const units = unitsInput.map((u, i) => normalizeUnitInput(u, i));
  const names = new Set();
  const barcodes = new Set();
  let baseCount = 0;
  let saleCount = 0;
  let purchaseCount = 0;

  for (const u of units) {
    const key = u.unitName.toLowerCase();
    if (names.has(key)) {
      const err = new Error(`Duplicate unit name: ${u.unitName}`);
      err.statusCode = 400;
      throw err;
    }
    names.add(key);
    if (u.barcode) {
      const b = u.barcode.toLowerCase();
      if (barcodes.has(b)) {
        const err = new Error(`Duplicate packaging barcode within product: ${u.barcode}`);
        err.statusCode = 400;
        throw err;
      }
      barcodes.add(b);
    }
    if (u.isBase) {
      baseCount += 1;
      if (Math.abs(u.conversionFactor - 1) > 1e-9) {
        const err = new Error(`Base unit "${u.unitName}" must have conversion factor 1`);
        err.statusCode = 400;
        throw err;
      }
    }
    if (u.allowSale && u.isActive) saleCount += 1;
    if (u.allowPurchase && u.isActive) purchaseCount += 1;
  }

  if (baseCount !== 1) {
    const err = new Error('Exactly one base unit is required');
    err.statusCode = 400;
    throw err;
  }
  if (requireSaleUnit && saleCount < 1) {
    const err = new Error('At least one active selling unit is required');
    err.statusCode = 400;
    throw err;
  }
  if (purchaseCount < 1) {
    // Allow purchase on base by default
    const base = units.find((u) => u.isBase);
    if (base) base.allowPurchase = true;
  }

  // Ensure defaults exist
  if (!units.some((u) => u.isDefaultSale && u.allowSale)) {
    const firstSale = units.find((u) => u.allowSale) || units.find((u) => u.isBase);
    if (firstSale) firstSale.isDefaultSale = true;
  }
  if (!units.some((u) => u.isDefaultPurchase && u.allowPurchase)) {
    const firstPurch = units.find((u) => u.allowPurchase) || units.find((u) => u.isBase);
    if (firstPurch) firstPurch.isDefaultPurchase = true;
  }

  // Only one default each
  let sawSale = false;
  let sawPurch = false;
  for (const u of units) {
    if (u.isDefaultSale) {
      if (sawSale) u.isDefaultSale = false;
      else sawSale = true;
    }
    if (u.isDefaultPurchase) {
      if (sawPurch) u.isDefaultPurchase = false;
      else sawPurch = true;
    }
  }

  return units;
}

/**
 * Build legacy Product UOM fields from multi-unit config (backward compatibility).
 */
function deriveLegacyUomFields(units, productFallback = {}) {
  const base = units.find((u) => u.isBase) || units[0];
  const defaultSale =
    units.find((u) => u.isDefaultSale && u.allowSale) ||
    units.find((u) => u.allowSale) ||
    base;
  const defaultPurch =
    units.find((u) => u.isDefaultPurchase && u.allowPurchase) ||
    units.find((u) => u.allowPurchase) ||
    base;
  const allowFractional = Boolean(
    productFallback.allowFractionalQty ||
    isFractionalUnit(base?.unitName) ||
    units.some((u) => isFractionalUnit(u.unitName) || u.conversionFactor % 1 !== 0)
  );
  return {
    stockUnitName: base.unitName,
    salesUnitName: defaultSale.unitName,
    salesConversionFactor: defaultSale.conversionFactor,
    purchaseUnitName: defaultPurch.unitName,
    purchaseConversionFactor: defaultPurch.conversionFactor,
    allowFractionalQty: allowFractional,
    sellingPrice:
      defaultSale.sellingPrice != null
        ? defaultSale.sellingPrice
        : productFallback.sellingPrice,
    costPrice:
      defaultPurch.purchasePrice != null
        ? roundTo(toNumber(defaultPurch.purchasePrice) / defaultPurch.conversionFactor, 4)
        : productFallback.costPrice,
  };
}

/**
 * Seed units from legacy single sales/purchase fields when product has none.
 */
function buildUnitsFromLegacyProduct(product = {}) {
  const uom = resolveProductUom(product);
  const units = [
    {
      unitName: uom.stockUnit,
      unitCode: normalizeUnitCode(uom.stockUnit),
      conversionFactor: 1,
      isBase: true,
      allowPurchase: uom.purchaseUnit.toLowerCase() === uom.stockUnit.toLowerCase(),
      allowSale: uom.salesUnit.toLowerCase() === uom.stockUnit.toLowerCase(),
      isDefaultSale: uom.salesUnit.toLowerCase() === uom.stockUnit.toLowerCase(),
      isDefaultPurchase: uom.purchaseUnit.toLowerCase() === uom.stockUnit.toLowerCase(),
      barcode: product.barcodeNumber || null,
      purchasePrice: product.costPrice != null ? toNumber(product.costPrice) : null,
      sellingPrice: product.sellingPrice != null ? toNumber(product.sellingPrice) : null,
      sortOrder: 0,
      isActive: true,
    },
  ];

  if (uom.salesUnit.toLowerCase() !== uom.stockUnit.toLowerCase()) {
    units.push({
      unitName: uom.salesUnit,
      unitCode: normalizeUnitCode(uom.salesUnit),
      conversionFactor: uom.salesFactor,
      isBase: false,
      allowPurchase: false,
      allowSale: true,
      isDefaultSale: true,
      isDefaultPurchase: false,
      barcode: null,
      purchasePrice: null,
      sellingPrice: product.sellingPrice != null ? toNumber(product.sellingPrice) : null,
      sortOrder: 1,
      isActive: true,
    });
  } else {
    units[0].allowSale = true;
    units[0].isDefaultSale = true;
  }

  if (
    uom.purchaseUnit.toLowerCase() !== uom.stockUnit.toLowerCase() &&
    uom.purchaseUnit.toLowerCase() !== uom.salesUnit.toLowerCase()
  ) {
    units.push({
      unitName: uom.purchaseUnit,
      unitCode: normalizeUnitCode(uom.purchaseUnit),
      conversionFactor: uom.purchaseFactor,
      isBase: false,
      allowPurchase: true,
      allowSale: false,
      isDefaultSale: false,
      isDefaultPurchase: true,
      barcode: null,
      purchasePrice: product.costPrice != null ? toNumber(product.costPrice) : null,
      sellingPrice: null,
      sortOrder: 2,
      isActive: true,
    });
  } else if (uom.purchaseUnit.toLowerCase() === uom.stockUnit.toLowerCase()) {
    units[0].allowPurchase = true;
    units[0].isDefaultPurchase = true;
  } else {
    const sale = units.find((u) => u.unitName.toLowerCase() === uom.purchaseUnit.toLowerCase());
    if (sale) {
      sale.allowPurchase = true;
      sale.isDefaultPurchase = true;
      sale.conversionFactor = uom.purchaseFactor;
      sale.purchasePrice = product.costPrice != null ? toNumber(product.costPrice) : null;
    }
  }

  return validateUnitsConfig(units, { requireSaleUnit: true });
}

async function listProductUnits(productId, { companyId, activeOnly = true } = {}) {
  const where = { productId };
  if (companyId) where.companyId = companyId;
  if (activeOnly) where.isActive = true;
  return prisma.productUnit.findMany({
    where,
    orderBy: [{ isBase: 'desc' }, { sortOrder: 'asc' }, { unitName: 'asc' }],
  });
}

async function ensureProductUnits(txOrPrisma, product) {
  const db = txOrPrisma || prisma;
  const existing = await db.productUnit.findMany({
    where: { productId: product.id, isActive: true },
    orderBy: [{ isBase: 'desc' }, { sortOrder: 'asc' }],
  });
  if (existing.length) return existing;

  const seeded = buildUnitsFromLegacyProduct(product);
  const now = new Date();
  const created = [];
  for (const u of seeded) {
    const row = await db.productUnit.create({
      data: {
        id: randomUUID(),
        companyId: product.companyId,
        productId: product.id,
        unitName: u.unitName,
        unitCode: u.unitCode,
        conversionFactor: u.conversionFactor,
        isBase: u.isBase,
        allowPurchase: u.allowPurchase,
        allowSale: u.allowSale,
        isDefaultSale: u.isDefaultSale,
        isDefaultPurchase: u.isDefaultPurchase,
        barcode: u.barcode,
        purchasePrice: u.purchasePrice,
        sellingPrice: u.sellingPrice,
        sortOrder: u.sortOrder,
        isActive: true,
        updatedAt: now,
      },
    });
    created.push(row);
  }
  return created;
}

/**
 * Replace product unit configuration inside a transaction.
 * Checks company-scoped packaging barcode uniqueness.
 */
async function replaceProductUnits(tx, { companyId, productId, unitsInput, productBarcode }) {
  const units = validateUnitsConfig(unitsInput);

  // Company-wide barcode conflict (other products / other packaging)
  for (const u of units) {
    if (!u.barcode) continue;
    const conflictUnit = await tx.productUnit.findFirst({
      where: {
        companyId,
        barcode: { equals: u.barcode, mode: 'insensitive' },
        productId: { not: productId },
        isActive: true,
      },
      select: { id: true, productId: true, unitName: true },
    });
    if (conflictUnit) {
      const err = new Error(
        `Barcode "${u.barcode}" is already used by another product packaging (${conflictUnit.unitName})`
      );
      err.statusCode = 400;
      throw err;
    }
    const conflictProduct = await tx.product.findFirst({
      where: {
        companyId,
        id: { not: productId },
        barcodeNumber: { equals: u.barcode, mode: 'insensitive' },
      },
      select: { id: true, name: true },
    });
    if (conflictProduct) {
      const err = new Error(
        `Barcode "${u.barcode}" is already assigned to product "${conflictProduct.name}"`
      );
      err.statusCode = 400;
      throw err;
    }
  }

  // Soft-deactivate removed units (preserve history); upsert active set by name
  const existing = await tx.productUnit.findMany({ where: { productId, companyId } });
  const keepNames = new Set(units.map((u) => u.unitName.toLowerCase()));
  for (const row of existing) {
    if (!keepNames.has(row.unitName.toLowerCase())) {
      await tx.productUnit.update({
        where: { id: row.id },
        data: { isActive: false, isDefaultSale: false, isDefaultPurchase: false },
      });
    }
  }

  const now = new Date();
  const saved = [];
  for (const u of units) {
    const prior = existing.find(
      (e) => e.unitName.toLowerCase() === u.unitName.toLowerCase()
    );
    const data = {
      companyId,
      productId,
      unitName: u.unitName,
      unitCode: u.unitCode,
      uomId: u.uomId,
      conversionFactor: u.conversionFactor,
      isBase: u.isBase,
      allowPurchase: u.allowPurchase,
      allowSale: u.allowSale,
      isDefaultSale: u.isDefaultSale,
      isDefaultPurchase: u.isDefaultPurchase,
      barcode: u.barcode,
      purchasePrice: u.purchasePrice,
      sellingPrice: u.sellingPrice,
      sortOrder: u.sortOrder,
      isActive: true,
      updatedAt: now,
    };
    let row;
    if (prior) {
      row = await tx.productUnit.update({ where: { id: prior.id }, data });
    } else {
      row = await tx.productUnit.create({
        data: { id: randomUUID(), ...data },
      });
    }
    saved.push(row);
  }

  // Keep product.barcodeNumber aligned with base unit barcode when provided
  const base = saved.find((u) => u.isBase);
  if (base?.barcode && productBarcode == null) {
    await tx.product.update({
      where: { id: productId },
      data: { barcodeNumber: base.barcode },
    });
  }

  return saved;
}

function findUnitInList(units, { productUnitId, unitName, forSale, forPurchase } = {}) {
  let list = Array.isArray(units) ? units.filter((u) => u.isActive !== false) : [];
  if (forSale) list = list.filter((u) => u.allowSale);
  if (forPurchase) list = list.filter((u) => u.allowPurchase);

  if (productUnitId) {
    const byId = list.find((u) => u.id === productUnitId) || units.find((u) => u.id === productUnitId);
    if (byId) return byId;
  }
  if (unitName) {
    const name = String(unitName).trim().toLowerCase();
    const byName = list.find((u) => String(u.unitName).toLowerCase() === name);
    if (byName) return byName;
  }
  if (forSale) {
    return list.find((u) => u.isDefaultSale) || list[0] || null;
  }
  if (forPurchase) {
    return list.find((u) => u.isDefaultPurchase) || list[0] || null;
  }
  return list.find((u) => u.isBase) || list[0] || null;
}

function toBaseQuantity(enteredQty, unitOrFactor) {
  const qty = toNumber(enteredQty);
  const factor =
    typeof unitOrFactor === 'number'
      ? unitOrFactor
      : toNumber(unitOrFactor?.conversionFactor, 1);
  const f = assertPositiveFactor(factor);
  return roundTo(qty * f, 6);
}

function fromBaseQuantity(baseQty, unitOrFactor) {
  const qty = toNumber(baseQty);
  const factor =
    typeof unitOrFactor === 'number'
      ? unitOrFactor
      : toNumber(unitOrFactor?.conversionFactor, 1);
  const f = assertPositiveFactor(factor);
  return roundTo(qty / f, 6);
}

/**
 * Break base stock into full packages + remainder for shopkeeper display.
 * units should be sorted largest-factor-first for packaging view.
 * IMPORTANT: equivalents are representations of the SAME stock — do not sum them.
 */
function packageBreakdown(baseStock, units = []) {
  const base = toNumber(baseStock);
  const active = (units || [])
    .filter((u) => u.isActive !== false && toNumber(u.conversionFactor, 0) > 0)
    .slice()
    .sort((a, b) => toNumber(b.conversionFactor) - toNumber(a.conversionFactor));

  const baseUnit = active.find((u) => u.isBase) || active.find((u) => toNumber(u.conversionFactor) === 1);
  let remaining = base;
  const packages = [];

  for (const u of active) {
    if (u.isBase || toNumber(u.conversionFactor) <= 1) continue;
    const factor = toNumber(u.conversionFactor);
    const full = Math.floor((remaining + 1e-9) / factor);
    const used = roundTo(full * factor, 6);
    packages.push({
      unitId: u.id,
      unitName: u.unitName,
      conversionFactor: factor,
      fullPackages: full,
      baseEquivalent: used,
    });
    remaining = roundTo(remaining - used, 6);
  }

  return {
    baseQuantity: base,
    baseUnitName: baseUnit?.unitName || 'Pcs',
    packages,
    looseQuantity: Math.max(0, remaining),
    // Human-readable: "8 boxes + 6 tablets"
    displayParts: [
      ...packages.filter((p) => p.fullPackages > 0).map((p) => `${p.fullPackages} ${p.unitName}`),
      ...(remaining > 1e-9
        ? [`${roundTo(remaining, 6)} ${baseUnit?.unitName || 'Pcs'}`]
        : packages.length === 0
          ? [`${roundTo(base, 6)} ${baseUnit?.unitName || 'Pcs'}`]
          : []),
    ],
  };
}

function priceForUnit(unit, product = {}) {
  if (!unit) return toNumber(product.sellingPrice);
  if (unit.sellingPrice != null) return toNumber(unit.sellingPrice);
  // Fallback: scale product selling price if product price is for default sales unit
  return toNumber(product.sellingPrice);
}

function purchasePriceForUnit(unit, product = {}) {
  if (!unit) return toNumber(product.costPrice);
  if (unit.purchasePrice != null) return toNumber(unit.purchasePrice);
  // costPrice is typically per base unit
  return roundTo(toNumber(product.costPrice) * toNumber(unit.conversionFactor, 1), 4);
}

/**
 * Resolve barcode to product + packaging unit (company scoped).
 */
async function resolveBarcodeToProductUnit(companyId, code) {
  const trimmed = String(code || '').trim();
  if (!trimmed) return null;

  const unitHit = await prisma.productUnit.findFirst({
    where: {
      companyId,
      isActive: true,
      barcode: { equals: trimmed, mode: 'insensitive' },
    },
    include: {
      product: true,
    },
  });
  if (unitHit?.product?.isActive !== false) {
    return {
      product: unitHit.product,
      unit: unitHit,
      matchedBy: 'unit_barcode',
    };
  }

  const product = await prisma.product.findFirst({
    where: {
      companyId,
      isActive: true,
      OR: [
        { barcodeNumber: { equals: trimmed, mode: 'insensitive' } },
        { sku: { equals: trimmed, mode: 'insensitive' } },
        { qrCode: { equals: trimmed, mode: 'insensitive' } },
      ],
    },
  });
  if (!product) return null;

  const units = await ensureProductUnits(prisma, product);
  const unit =
    units.find((u) => u.barcode && u.barcode.toLowerCase() === trimmed.toLowerCase()) ||
    units.find((u) => u.isDefaultSale && u.allowSale) ||
    units.find((u) => u.allowSale) ||
    units.find((u) => u.isBase);

  return { product, unit, matchedBy: 'product_barcode', units };
}

function serializeUnitsForApi(units = [], product = {}) {
  const breakdown = packageBreakdown(product.currentStock || product.availableStock || 0, units);
  return {
    units: units.map((u) => ({
      id: u.id,
      unitName: u.unitName,
      unitCode: u.unitCode,
      conversionFactor: u.conversionFactor,
      isBase: u.isBase,
      allowPurchase: u.allowPurchase,
      allowSale: u.allowSale,
      isDefaultSale: u.isDefaultSale,
      isDefaultPurchase: u.isDefaultPurchase,
      barcode: u.barcode,
      purchasePrice: u.purchasePrice,
      sellingPrice: u.sellingPrice != null ? u.sellingPrice : priceForUnit(u, product),
      sortOrder: u.sortOrder,
      isActive: u.isActive,
    })),
    stockBreakdown: breakdown,
    baseUnitName: breakdown.baseUnitName,
    baseStock: breakdown.baseQuantity,
  };
}

module.exports = {
  assertPositiveFactor,
  normalizeUnitInput,
  validateUnitsConfig,
  deriveLegacyUomFields,
  buildUnitsFromLegacyProduct,
  listProductUnits,
  ensureProductUnits,
  replaceProductUnits,
  findUnitInList,
  toBaseQuantity,
  fromBaseQuantity,
  packageBreakdown,
  priceForUnit,
  purchasePriceForUnit,
  resolveBarcodeToProductUnit,
  serializeUnitsForApi,
};
