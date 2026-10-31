/**
 * Batch / lot balances for expiry-managed products.
 * All quantities are stored in the product base unit.
 * POS FEFO: earliest expiry first; expired batches blocked from normal sales.
 */
const { randomUUID } = require('crypto');
const { toNumber, roundTo } = require('./inventoryMath');

async function getOrCreateBatch(tx, {
  companyId,
  productId,
  locationId,
  batchNumber,
  expiryDate = null,
  manufacturingDate = null,
  unitCost = null,
}) {
  const batch = String(batchNumber || '').trim();
  if (!batch) {
    const err = new Error('Batch number is required for batch-managed products');
    err.statusCode = 400;
    throw err;
  }
  if (!locationId) {
    const err = new Error('Warehouse/location is required for batch stock');
    err.statusCode = 400;
    throw err;
  }

  const existing = await tx.productBatch.findUnique({
    where: {
      productId_locationId_batchNumber: {
        productId,
        locationId,
        batchNumber: batch,
      },
    },
  });
  if (existing) {
    const data = {};
    if (expiryDate) data.expiryDate = new Date(expiryDate);
    if (manufacturingDate) data.manufacturingDate = new Date(manufacturingDate);
    if (unitCost != null) data.unitCost = toNumber(unitCost);
    if (Object.keys(data).length) {
      return tx.productBatch.update({ where: { id: existing.id }, data });
    }
    return existing;
  }

  return tx.productBatch.create({
    data: {
      id: randomUUID(),
      companyId,
      productId,
      locationId,
      batchNumber: batch,
      expiryDate: expiryDate ? new Date(expiryDate) : null,
      manufacturingDate: manufacturingDate ? new Date(manufacturingDate) : null,
      currentStock: 0,
      reservedStock: 0,
      availableStock: 0,
      unitCost: unitCost != null ? toNumber(unitCost) : null,
      isActive: true,
      updatedAt: new Date(),
    },
  });
}

function isExpired(batch, asOf = new Date()) {
  if (!batch?.expiryDate) return false;
  const exp = new Date(batch.expiryDate);
  // Treat end-of-day expiry: expired when calendar day has passed
  const today = new Date(asOf);
  today.setHours(0, 0, 0, 0);
  const expDay = new Date(exp);
  expDay.setHours(0, 0, 0, 0);
  return expDay < today;
}

async function adjustBatchStock(tx, {
  companyId,
  productId,
  locationId,
  batchNumber,
  delta,
  expiryDate = null,
  manufacturingDate = null,
  unitCost = null,
  checkAvailable = false,
  allowExpired = false,
  productName,
}) {
  const qtyDelta = toNumber(delta);
  if (!qtyDelta) {
    return getOrCreateBatch(tx, {
      companyId, productId, locationId, batchNumber, expiryDate, manufacturingDate, unitCost,
    });
  }

  const row = await getOrCreateBatch(tx, {
    companyId, productId, locationId, batchNumber, expiryDate, manufacturingDate, unitCost,
  });

  if (!allowExpired && qtyDelta < 0 && isExpired(row)) {
    const err = new Error(
      `Cannot sell from expired batch ${batchNumber}${productName ? ` (${productName})` : ''}`
    );
    err.statusCode = 400;
    err.code = 'BATCH_EXPIRED';
    throw err;
  }

  const previous = toNumber(row.currentStock);
  const available = Math.max(0, previous - toNumber(row.reservedStock));
  if (checkAvailable && qtyDelta < 0 && Math.abs(qtyDelta) > available) {
    const err = new Error(
      `Insufficient batch stock for ${batchNumber}${productName ? ` (${productName})` : ''}. Available: ${available}, Required: ${Math.abs(qtyDelta)}`
    );
    err.statusCode = 400;
    throw err;
  }

  let next = roundTo(previous + qtyDelta, 6);
  if (next < 0) {
    const err = new Error(
      `Insufficient batch stock for ${batchNumber}. On hand: ${previous}`
    );
    err.statusCode = 400;
    throw err;
  }

  return tx.productBatch.update({
    where: { id: row.id },
    data: {
      currentStock: next,
      availableStock: Math.max(0, next - toNumber(row.reservedStock)),
      ...(unitCost != null ? { unitCost: toNumber(unitCost) } : {}),
    },
  });
}

/**
 * FEFO allocation: deduct baseQty across non-expired batches, earliest expiry first.
 * Returns allocation list [{ batchNumber, qty, expiryDate }].
 */
async function allocateFefo(tx, {
  companyId,
  productId,
  locationId,
  baseQty,
  checkAvailable = true,
  productName,
}) {
  const need = toNumber(baseQty);
  if (need <= 0) return [];

  const batches = await tx.productBatch.findMany({
    where: {
      companyId,
      productId,
      locationId,
      isActive: true,
      currentStock: { gt: 0 },
    },
    orderBy: [
      { expiryDate: 'asc' },
      { createdAt: 'asc' },
    ],
  });

  const usable = batches.filter((b) => !isExpired(b));
  const allocations = [];
  let remaining = need;

  for (const b of usable) {
    if (remaining <= 0) break;
    const avail = Math.max(0, toNumber(b.currentStock) - toNumber(b.reservedStock));
    if (avail <= 0) continue;
    const take = Math.min(avail, remaining);
    await adjustBatchStock(tx, {
      companyId,
      productId,
      locationId,
      batchNumber: b.batchNumber,
      delta: -take,
      checkAvailable: true,
      productName,
    });
    allocations.push({
      batchNumber: b.batchNumber,
      qty: take,
      expiryDate: b.expiryDate,
      productBatchId: b.id,
    });
    remaining = roundTo(remaining - take, 6);
  }

  if (remaining > 1e-9 && checkAvailable) {
    const err = new Error(
      `Insufficient non-expired batch stock${productName ? ` for ${productName}` : ''}. Required: ${need}, shortfall: ${remaining}`
    );
    err.statusCode = 400;
    err.code = 'INSUFFICIENT_BATCH_STOCK';
    throw err;
  }

  return allocations;
}

async function listNearExpiry(txOrPrisma, {
  companyId,
  days = 30,
  locationId = null,
  productId = null,
}) {
  const db = txOrPrisma;
  const until = new Date();
  until.setDate(until.getDate() + Number(days || 30));
  const where = {
    companyId,
    isActive: true,
    currentStock: { gt: 0 },
    expiryDate: { not: null, lte: until },
  };
  if (locationId) where.locationId = locationId;
  if (productId) where.productId = productId;
  return db.productBatch.findMany({
    where,
    include: {
      product: { select: { id: true, name: true, sku: true, stockUnitName: true } },
      location: { select: { id: true, name: true, code: true } },
    },
    orderBy: { expiryDate: 'asc' },
  });
}

module.exports = {
  getOrCreateBatch,
  isExpired,
  adjustBatchStock,
  allocateFefo,
  listNearExpiry,
};
