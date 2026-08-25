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
  const { assertCanUseLocationId, getLocationScope } = require('../../utils/locationAccessHelper');
  if (locationId) {
    const loc = await db.location.findFirst({
      where: { id: locationId, companyId, isDeleted: false, isActive: true },
    });
    if (!loc) {
      const err = new Error('Location not found or inactive');
      err.statusCode = 400;
      throw err;
    }
    assertCanUseLocationId(loc.id);
    return loc.id;
  }
  const def = await ensureDefaultLocation(db, companyId, userId);
  const scope = getLocationScope();
  if (scope && !scope.isAdmin && Array.isArray(scope.ids) && scope.ids.length) {
    if (scope.ids.includes(def.id)) return def.id;
    return scope.ids[0];
  }
  if (scope && !scope.isAdmin) {
    const err = new Error('No location assigned to this user');
    err.statusCode = 403;
    throw err;
  }
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

/**
 * If Product.currentStock is higher than the sum of location rows
 * (legacy data / poisoned 0-row), move the leftover onto this location.
 */
async function absorbUnallocatedStock(tx, { productId, locationId }) {
  const product = await tx.product.findUnique({
    where: { id: productId },
    select: { currentStock: true, reservedStock: true },
  });
  if (!product) return 0;

  const agg = await tx.productStock.aggregate({
    where: { productId },
    _sum: { currentStock: true, reservedStock: true },
  });
  const allocated = agg._sum.currentStock || 0;
  const unallocated = (product.currentStock || 0) - allocated;
  if (unallocated <= 0) return 0;

  const row = await tx.productStock.findUnique({
    where: { productId_locationId: { productId, locationId } },
  });
  if (!row) return 0;

  const reservedUnallocated = Math.max(
    0,
    (product.reservedStock || 0) - (agg._sum.reservedStock || 0)
  );
  const newCurrent = row.currentStock + unallocated;
  const newReserved = (row.reservedStock || 0) + reservedUnallocated;
  await tx.productStock.update({
    where: { id: row.id },
    data: {
      currentStock: newCurrent,
      reservedStock: newReserved,
      availableStock: Math.max(0, newCurrent - newReserved),
    },
  });
  return unallocated;
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

async function getLocationAvailability(tx, { productId, locationId }) {
  const stock = await tx.productStock.findUnique({
    where: { productId_locationId: { productId, locationId } },
  });
  const current = stock?.currentStock || 0;
  const reserved = stock?.reservedStock || 0;
  return {
    current,
    reserved,
    available: Math.max(0, current - reserved),
  };
}

async function adjustLocationStock(
  tx,
  {
    companyId,
    productId,
    locationId,
    delta,
    reservedDelta = 0,
    checkAvailable = false,
    productName,
  }
) {
  await getOrCreateProductStock(tx, {
    companyId,
    productId,
    locationId,
  });
  await absorbUnallocatedStock(tx, { productId, locationId });
  const stock = await tx.productStock.findUnique({
    where: { productId_locationId: { productId, locationId } },
  });

  const qtyDelta = Math.round(Number(delta) || 0);
  const qtyReserved = Math.round(Number(reservedDelta) || 0);
  const previousLocationStock = stock.currentStock;
  const label = productName ? ` for ${productName}` : '';

  if (checkAvailable && qtyDelta < 0 && qtyReserved >= 0) {
    const available = previousLocationStock - (stock.reservedStock || 0);
    if (Math.abs(qtyDelta) > available) {
      const err = new Error(
        `Insufficient available stock${label}. Available: ${available}, Reserved: ${stock.reservedStock || 0}, Required: ${Math.abs(qtyDelta)}`
      );
      err.statusCode = 400;
      throw err;
    }
  }

  const newLocationStock = previousLocationStock + qtyDelta;
  if (newLocationStock < 0) {
    const others = await tx.productStock.findMany({
      where: { productId, currentStock: { gt: 0 }, locationId: { not: locationId } },
      include: { location: { select: { name: true } } },
    });
    const hint = others.length
      ? ` Stock is at: ${others.map((o) => `${o.location?.name || 'location'} (${o.currentStock})`).join(', ')}.`
      : '';
    const err = new Error(
      `Insufficient stock${label} at this location. On hand: ${previousLocationStock}, Required: ${Math.abs(qtyDelta)}.${hint}`
    );
    err.statusCode = 400;
    throw err;
  }

  const newReserved = Math.max(0, (stock.reservedStock || 0) + qtyReserved);
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
    const agg = await prisma.productStock.aggregate({
      where: { productId: p.id },
      _sum: { currentStock: true, reservedStock: true },
    });
    const allocated = agg._sum.currentStock || 0;
    const unallocated = (p.currentStock || 0) - allocated;
    if (unallocated <= 0) continue;

    const existing = await prisma.productStock.findUnique({
      where: {
        productId_locationId: { productId: p.id, locationId: location.id },
      },
    });
    if (existing) {
      const newCurrent = existing.currentStock + unallocated;
      const newReserved =
        (existing.reservedStock || 0) +
        Math.max(0, (p.reservedStock || 0) - (agg._sum.reservedStock || 0));
      await prisma.productStock.update({
        where: { id: existing.id },
        data: {
          currentStock: newCurrent,
          reservedStock: newReserved,
          availableStock: Math.max(0, newCurrent - newReserved),
        },
      });
      continue;
    }

    await prisma.productStock.create({
      data: {
        companyId,
        productId: p.id,
        locationId: location.id,
        currentStock: unallocated,
        reservedStock: Math.max(0, (p.reservedStock || 0) - (agg._sum.reservedStock || 0)),
        availableStock: Math.max(
          0,
          unallocated - Math.max(0, (p.reservedStock || 0) - (agg._sum.reservedStock || 0))
        ),
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
  getLocationAvailability,
  syncProductTotalStock,
  adjustLocationStock,
  reserveLocationStock,
  releaseLocationReservation,
  backfillCompanyLocationStock,
};
