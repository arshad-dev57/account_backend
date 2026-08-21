/**
 * Multi-location inventory helpers.
 * Product.currentStock = sum of ProductStock across all locations (kept in sync).
 */

const prisma = require('../../prisma/client');

async function ensureDefaultLocation(txOrPrisma, companyId, userId) {
  const db = txOrPrisma || prisma;
  const existing = await db.location.findFirst({
    where: { companyId, isDeleted: false, isDefault: true },
  });
  if (existing) return existing;

  const any = await db.location.findFirst({
    where: { companyId, isDeleted: false },
    orderBy: { createdAt: 'asc' },
  });
  if (any) {
    return db.location.update({
      where: { id: any.id },
      data: { isDefault: true },
    });
  }

  return db.location.create({
    data: {
      companyId,
      name: 'Main Warehouse',
      code: 'MAIN',
      type: 'Warehouse',
      isDefault: true,
      isActive: true,
      createdBy: userId || null,
    },
  });
}

async function resolveLocationId(txOrPrisma, companyId, locationId, userId) {
  const db = txOrPrisma || prisma;
  if (locationId) {
    const loc = await db.location.findFirst({
      where: { id: locationId, companyId, isDeleted: false, isActive: true },
    });
    if (!loc) {
      const err = new Error('Location not found or inactive');
      err.statusCode = 400;
      throw err;
    }
    return loc.id;
  }
  const def = await ensureDefaultLocation(db, companyId, userId);
  return def.id;
}

async function getOrCreateProductStock(tx, { companyId, productId, locationId }) {
  let row = await tx.productStock.findUnique({
    where: {
      productId_locationId: { productId, locationId },
    },
  });
  if (row) return row;

  return tx.productStock.create({
    data: {
      companyId,
      productId,
      locationId,
      currentStock: 0,
      reservedStock: 0,
      availableStock: 0,
    },
  });
}

async function syncProductTotalStock(tx, productId) {
  const agg = await tx.productStock.aggregate({
    where: { productId },
    _sum: { currentStock: true, reservedStock: true },
  });
  const current = agg._sum.currentStock || 0;
  const reserved = agg._sum.reservedStock || 0;
  const available = Math.max(0, current - reserved);

  const product = await tx.product.findUnique({
    where: { id: productId },
    select: { costPrice: true },
  });

  return tx.product.update({
    where: { id: productId },
    data: {
      currentStock: current,
      reservedStock: reserved,
      availableStock: available,
      totalValue: current * (product?.costPrice || 0),
    },
  });
}

/**
 * Adjust physical stock at a location.
 * @returns {{ previousLocationStock, newLocationStock, product }}
 */
async function adjustLocationStock(
  tx,
  { companyId, productId, locationId, delta, reservedDelta = 0 }
) {
  const stock = await getOrCreateProductStock(tx, {
    companyId,
    productId,
    locationId,
  });

  const previousLocationStock = stock.currentStock;
  const newLocationStock = previousLocationStock + delta;
  if (newLocationStock < 0) {
    const err = new Error('Insufficient stock at this location');
    err.statusCode = 400;
    throw err;
  }

  const newReserved = Math.max(0, (stock.reservedStock || 0) + reservedDelta);
  const newAvailable = Math.max(0, newLocationStock - newReserved);

  await tx.productStock.update({
    where: { id: stock.id },
    data: {
      currentStock: newLocationStock,
      reservedStock: newReserved,
      availableStock: newAvailable,
    },
  });

  const product = await syncProductTotalStock(tx, productId);

  return {
    previousLocationStock,
    newLocationStock,
    previousReserved: stock.reservedStock || 0,
    newReserved,
    product,
  };
}

/**
 * Reserve stock at location (sales order) without changing physical stock.
 */
async function reserveLocationStock(tx, { companyId, productId, locationId, qty }) {
  const stock = await getOrCreateProductStock(tx, {
    companyId,
    productId,
    locationId,
  });
  const available = (stock.currentStock || 0) - (stock.reservedStock || 0);
  if (qty > available) {
    const err = new Error('Insufficient available stock at this location');
    err.statusCode = 400;
    throw err;
  }
  const newReserved = (stock.reservedStock || 0) + qty;
  await tx.productStock.update({
    where: { id: stock.id },
    data: {
      reservedStock: newReserved,
      availableStock: Math.max(0, stock.currentStock - newReserved),
    },
  });
  return syncProductTotalStock(tx, productId);
}

async function releaseLocationReservation(
  tx,
  { companyId, productId, locationId, qty }
) {
  const stock = await getOrCreateProductStock(tx, {
    companyId,
    productId,
    locationId,
  });
  const newReserved = Math.max(0, (stock.reservedStock || 0) - qty);
  await tx.productStock.update({
    where: { id: stock.id },
    data: {
      reservedStock: newReserved,
      availableStock: Math.max(0, stock.currentStock - newReserved),
    },
  });
  return syncProductTotalStock(tx, productId);
}

/**
 * Migrate legacy Product.currentStock into default location ProductStock rows.
 */
async function backfillCompanyLocationStock(companyId, userId) {
  const location = await ensureDefaultLocation(prisma, companyId, userId);
  const products = await prisma.product.findMany({
    where: { companyId, isActive: true },
    select: {
      id: true,
      currentStock: true,
      reservedStock: true,
      availableStock: true,
      minimumStock: true,
      reorderLevel: true,
    },
  });

  for (const p of products) {
    const existing = await prisma.productStock.findUnique({
      where: {
        productId_locationId: { productId: p.id, locationId: location.id },
      },
    });
    if (existing) continue;

    await prisma.productStock.create({
      data: {
        companyId,
        productId: p.id,
        locationId: location.id,
        currentStock: p.currentStock || 0,
        reservedStock: p.reservedStock || 0,
        availableStock:
          p.availableStock ??
          Math.max(0, (p.currentStock || 0) - (p.reservedStock || 0)),
        minimumStock: p.minimumStock || 0,
        reorderLevel: p.reorderLevel || 0,
      },
    });
  }

  return location;
}

module.exports = {
  ensureDefaultLocation,
  resolveLocationId,
  getOrCreateProductStock,
  syncProductTotalStock,
  adjustLocationStock,
  reserveLocationStock,
  releaseLocationReservation,
  backfillCompanyLocationStock,
};
