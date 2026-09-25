// warehouse/models/InternalTransfer.js

const prisma = require('../../prisma/client');
const { adjustLocationStock } = require('../services/locationService');

function generateTransferNumber() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const rand = Math.floor(Math.random() * 100000).toString().padStart(5, '0');
  return `TRF-${y}${m}${d}-${rand}`;
}

// ─── VALID STATUS TRANSITIONS ────────────────────────────────
const TRANSITIONS = {
  Draft:     ['Confirmed', 'Cancelled'],
  Confirmed: ['InTransit', 'Cancelled'],
  InTransit: ['Received'],
  Received:  ['Done'],
  Done:      [],
  Cancelled: [],
};

function canTransition(fromStatus, toStatus) {
  return (TRANSITIONS[fromStatus] || []).includes(toStatus);
}

// ─── LIST ─────────────────────────────────────────────────────
async function list({ companyId, page = 1, limit = 20, search, status, fromLocationId, toLocationId, dateFrom, dateTo }) {
  const where = {
    companyId,
    isDeleted: false,
  };

  if (status) where.status = status;
  if (fromLocationId) where.fromLocationId = fromLocationId;
  if (toLocationId) where.toLocationId = toLocationId;
  if (dateFrom || dateTo) {
    where.transferDate = {};
    if (dateFrom) where.transferDate.gte = new Date(dateFrom);
    if (dateTo) {
      const end = new Date(dateTo);
      end.setHours(23, 59, 59, 999);
      where.transferDate.lte = end;
    }
  }
  if (search) {
    where.OR = [
      { transferNumber: { contains: search, mode: 'insensitive' } },
      { reference: { contains: search, mode: 'insensitive' } },
      { reason: { contains: search, mode: 'insensitive' } },
    ];
  }

  const skip = (page - 1) * limit;
  const [total, data] = await Promise.all([
    prisma.internalTransfer.count({ where }),
    prisma.internalTransfer.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        fromLocation: { select: { id: true, name: true, code: true } },
        toLocation:   { select: { id: true, name: true, code: true } },
        creator:      { select: { id: true, firstName: true, lastName: true, email: true } },
        items:        { select: { id: true, requestedQty: true, dispatchedQty: true, receivedQty: true } },
      },
    }),
  ]);

  const pages = Math.ceil(total / limit);
  return {
    data: data.map(t => {
      const creatorName = t.creator ? ([t.creator.firstName, t.creator.lastName].filter(Boolean).join(' ') || t.creator.email) : 'System';
      return {
        ...t,
        creator: t.creator ? { id: t.creator.id, name: creatorName } : null,
        totalItems: t.items.length,
        totalRequestedQty: t.items.reduce((s, i) => s + (i.requestedQty || 0), 0),
        totalDispatchedQty: t.items.reduce((s, i) => s + (i.dispatchedQty || 0), 0),
        totalReceivedQty: t.items.reduce((s, i) => s + (i.receivedQty || 0), 0),
      };
    }),
    pagination: { page, limit, total, pages, hasNext: page < pages, hasPrev: page > 1 },
  };
}

// ─── GET BY ID ────────────────────────────────────────────────
async function getById(id, companyId) {
  const t = await prisma.internalTransfer.findFirst({
    where: { id, companyId, isDeleted: false },
    include: {
      fromLocation: true,
      toLocation:   true,
      creator:      { select: { id: true, firstName: true, lastName: true, email: true } },
      items: {
        include: {
          product: { select: { id: true, name: true, sku: true, unit: true } },
        },
      },
      history: {
        orderBy: { createdAt: 'asc' },
      },
    },
  });

  if (!t) return null;
  const creatorName = t.creator ? ([t.creator.firstName, t.creator.lastName].filter(Boolean).join(' ') || t.creator.email) : 'System';
  return {
    ...t,
    creator: t.creator ? { id: t.creator.id, name: creatorName } : null,
  };
}

// ─── CREATE ───────────────────────────────────────────────────
async function create({ companyId, transferDate, fromLocationId, toLocationId, priority, reference, reason, notes, items, createdBy, userName }) {
  if (fromLocationId === toLocationId) {
    const err = new Error('Source and destination warehouse cannot be the same.');
    err.statusCode = 400;
    throw err;
  }

  // Validate both locations belong to company
  const [from, to] = await Promise.all([
    prisma.location.findFirst({ where: { id: fromLocationId, companyId, isDeleted: false } }),
    prisma.location.findFirst({ where: { id: toLocationId, companyId, isDeleted: false } }),
  ]);
  if (!from) { const e = new Error('Source location not found or unauthorized.'); e.statusCode = 400; throw e; }
  if (!to)   { const e = new Error('Destination location not found or unauthorized.'); e.statusCode = 400; throw e; }

  if (!items || items.length === 0) {
    const e = new Error('Transfer must have at least one product line.'); e.statusCode = 400; throw e;
  }

  const transferNumber = generateTransferNumber();

  return prisma.$transaction(async (tx) => {
    const transfer = await tx.internalTransfer.create({
      data: {
        transferNumber,
        companyId,
        transferDate: new Date(transferDate),
        fromLocationId,
        toLocationId,
        status: 'Draft',
        priority: priority || 'Normal',
        reference: reference || null,
        reason: reason || null,
        notes: notes || null,
        createdBy,
        items: {
          create: items.map(item => ({
            productId: item.productId,
            productName: item.productName || '',
            sku: item.sku || '',
            requestedQty: Number(item.requestedQty) || 0,
            unit: item.unit || 'pcs',
            batchNumber: item.batchNumber || null,
            serialNumber: item.serialNumber || null,
            notes: item.notes || null,
          })),
        },
        history: {
          create: {
            action: 'Created',
            toStatus: 'Draft',
            note: 'Transfer created',
            userId: createdBy,
            userName: userName || 'System',
          },
        },
      },
      include: { items: true, history: true, fromLocation: true, toLocation: true },
    });
    return transfer;
  });
}

// ─── UPDATE DRAFT ─────────────────────────────────────────────
async function update(id, companyId, { transferDate, fromLocationId, toLocationId, priority, reference, reason, notes, items, updatedBy, userName }) {
  const existing = await prisma.internalTransfer.findFirst({ where: { id, companyId, isDeleted: false } });
  if (!existing) { const e = new Error('Transfer not found.'); e.statusCode = 404; throw e; }
  if (existing.status !== 'Draft') { const e = new Error('Only Draft transfers can be edited.'); e.statusCode = 400; throw e; }

  if (fromLocationId && toLocationId && fromLocationId === toLocationId) {
    const e = new Error('Source and destination cannot be the same.'); e.statusCode = 400; throw e;
  }

  return prisma.$transaction(async (tx) => {
    // Delete old items and recreate
    if (items) {
      await tx.internalTransferItem.deleteMany({ where: { transferId: id } });
    }

    const transfer = await tx.internalTransfer.update({
      where: { id },
      data: {
        ...(transferDate && { transferDate: new Date(transferDate) }),
        ...(fromLocationId && { fromLocationId }),
        ...(toLocationId && { toLocationId }),
        ...(priority !== undefined && { priority }),
        ...(reference !== undefined && { reference: reference || null }),
        ...(reason !== undefined && { reason: reason || null }),
        ...(notes !== undefined && { notes: notes || null }),
        updatedBy,
        ...(items && {
          items: {
            create: items.map(item => ({
              productId: item.productId,
              productName: item.productName || '',
              sku: item.sku || '',
              requestedQty: Number(item.requestedQty) || 0,
              unit: item.unit || 'pcs',
              batchNumber: item.batchNumber || null,
              serialNumber: item.serialNumber || null,
              notes: item.notes || null,
            })),
          },
        }),
        history: {
          create: {
            action: 'Updated',
            fromStatus: 'Draft',
            toStatus: 'Draft',
            note: 'Transfer details updated',
            userId: updatedBy,
            userName: userName || 'System',
          },
        },
      },
      include: { items: true, history: true, fromLocation: true, toLocation: true },
    });
    return transfer;
  });
}

// ─── CONFIRM ─────────────────────────────────────────────────
async function confirm(arg1, arg2, arg3) {
  const { id, companyId, userId, userName } = (typeof arg1 === 'object')
    ? arg1
    : { id: arg1, companyId: arg2, userId: arg3?.userId, userName: arg3?.userName };
  const existing = await prisma.internalTransfer.findFirst({
    where: { id, companyId, isDeleted: false },
    include: { items: true },
  });
  if (!existing) { const e = new Error('Transfer not found.'); e.statusCode = 404; throw e; }
  if (!canTransition(existing.status, 'Confirmed')) {
    const e = new Error(`Cannot confirm a transfer in ${existing.status} status.`); e.statusCode = 400; throw e;
  }
  if (existing.items.length === 0) {
    const e = new Error('Transfer must have at least one item.'); e.statusCode = 400; throw e;
  }

  return prisma.$transaction(async (tx) => {
    const transfer = await tx.internalTransfer.update({
      where: { id },
      data: {
        status: 'Confirmed',
        confirmedBy: userId,
        confirmedAt: new Date(),
        history: {
          create: { action: 'Confirmed', fromStatus: 'Draft', toStatus: 'Confirmed', userId, userName: userName || 'System' },
        },
      },
      include: { items: true, fromLocation: true, toLocation: true },
    });
    return transfer;
  });
}

// ─── DISPATCH (→ InTransit) ───────────────────────────────────
async function dispatch(arg1, arg2, arg3) {
  const { id, companyId, userId, userName, dispatchedItems, items: itemsAlt } = (typeof arg1 === 'object')
    ? arg1
    : { id: arg1, companyId: arg2, userId: arg3?.userId, userName: arg3?.userName, dispatchedItems: arg3?.dispatchedItems || arg3?.items };
  const itemsToDispatch = dispatchedItems || itemsAlt || [];
  const existing = await prisma.internalTransfer.findFirst({
    where: { id, companyId, isDeleted: false },
    include: { items: { include: { product: true } }, fromLocation: true, toLocation: true },
  });
  if (!existing) { const e = new Error('Transfer not found.'); e.statusCode = 404; throw e; }
  if (!canTransition(existing.status, 'InTransit')) {
    const e = new Error(`Cannot dispatch a transfer in ${existing.status} status.`); e.statusCode = 400; throw e;
  }

  // Build dispatch map { itemId -> qty }
  const dispatchMap = {};
  itemsToDispatch.forEach(d => { dispatchMap[d.itemId || d.id] = Number(d.quantity || d.dispatchedQty) || 0; });

  return prisma.$transaction(async (tx) => {
    for (const item of existing.items) {
      const qty = dispatchMap[item.id] !== undefined ? dispatchMap[item.id] : item.requestedQty;
      if (qty <= 0) continue;

      // Deduct from source warehouse
      await adjustLocationStock(tx, {
        companyId,
        productId: item.productId,
        locationId: existing.fromLocationId,
        delta: -qty,
        checkAvailable: true,
        productName: item.productName,
      });

      // Record stock movement (stock_out from source)
      await tx.stockMovement.create({
        data: {
          productId: item.productId,
          productName: item.productName,
          type: 'transfer_out',
          quantity: -qty,
          previousStock: 0,
          newStock: 0,
          reason: `Internal Transfer ${existing.transferNumber} - Dispatched to ${existing.toLocation?.name}`,
          reference: existing.transferNumber,
          notes: `Transfer to ${existing.toLocation?.name || existing.toLocationId}`,
          companyId,
          locationId: existing.fromLocationId,
          fromLocationId: existing.fromLocationId,
          toLocationId: existing.toLocationId,
          createdBy: userId,
          status: 'Completed',
        },
      });

      // Update dispatched qty on item
      await tx.internalTransferItem.update({
        where: { id: item.id },
        data: { dispatchedQty: qty },
      });
    }

    const transfer = await tx.internalTransfer.update({
      where: { id },
      data: {
        status: 'InTransit',
        dispatchedBy: userId,
        dispatchedAt: new Date(),
        history: {
          create: { action: 'Dispatched', fromStatus: 'Confirmed', toStatus: 'InTransit', userId, userName: userName || 'System', note: 'Stock deducted from source warehouse' },
        },
      },
      include: { items: true, fromLocation: true, toLocation: true },
    });
    return transfer;
  });
}

// ─── RECEIVE (→ Received) ─────────────────────────────────────
async function receive(arg1, arg2, arg3) {
  const { id, companyId, userId, userName, receivedItems, items: itemsAlt } = (typeof arg1 === 'object')
    ? arg1
    : { id: arg1, companyId: arg2, userId: arg3?.userId, userName: arg3?.userName, receivedItems: arg3?.receivedItems || arg3?.items };
  const itemsToReceive = receivedItems || itemsAlt || [];
  const existing = await prisma.internalTransfer.findFirst({
    where: { id, companyId, isDeleted: false },
    include: { items: { include: { product: true } }, fromLocation: true, toLocation: true },
  });
  if (!existing) { const e = new Error('Transfer not found.'); e.statusCode = 404; throw e; }
  if (!canTransition(existing.status, 'Received')) {
    const e = new Error(`Cannot receive a transfer in ${existing.status} status.`); e.statusCode = 400; throw e;
  }

  const receiveMap = {};
  itemsToReceive.forEach(r => { receiveMap[r.itemId || r.id] = Number(r.quantity || r.receivedQty) || 0; });

  return prisma.$transaction(async (tx) => {
    // Check duplicate receiving
    const alreadyReceived = await tx.stockMovement.count({
      where: { companyId, reference: existing.transferNumber, type: 'transfer_in' },
    });
    if (alreadyReceived > 0) {
      const e = new Error('This transfer has already been received.'); e.statusCode = 400; throw e;
    }

    for (const item of existing.items) {
      const qty = receiveMap[item.id] !== undefined ? receiveMap[item.id] : item.dispatchedQty;
      if (qty <= 0) continue;

      // Add to destination warehouse
      await adjustLocationStock(tx, {
        companyId,
        productId: item.productId,
        locationId: existing.toLocationId,
        delta: qty,
        productName: item.productName,
      });

      // Record stock movement (stock_in at destination)
      await tx.stockMovement.create({
        data: {
          productId: item.productId,
          productName: item.productName,
          type: 'transfer_in',
          quantity: qty,
          previousStock: 0,
          newStock: 0,
          reason: `Internal Transfer ${existing.transferNumber} - Received from ${existing.fromLocation?.name}`,
          reference: existing.transferNumber,
          notes: `Transfer from ${existing.fromLocation?.name || existing.fromLocationId}`,
          companyId,
          locationId: existing.toLocationId,
          fromLocationId: existing.fromLocationId,
          toLocationId: existing.toLocationId,
          createdBy: userId,
          status: 'Completed',
        },
      });

      await tx.internalTransferItem.update({
        where: { id: item.id },
        data: { receivedQty: qty },
      });
    }

    const transfer = await tx.internalTransfer.update({
      where: { id },
      data: {
        status: 'Received',
        receivedBy: userId,
        receivedAt: new Date(),
        history: {
          create: { action: 'Received', fromStatus: 'InTransit', toStatus: 'Received', userId, userName: userName || 'System', note: 'Stock added to destination warehouse' },
        },
      },
      include: { items: true, fromLocation: true, toLocation: true },
    });
    return transfer;
  });
}

// ─── COMPLETE (→ Done) ───────────────────────────────────────
async function complete(arg1, arg2, arg3) {
  const { id, companyId, userId, userName } = (typeof arg1 === 'object')
    ? arg1
    : { id: arg1, companyId: arg2, userId: arg3?.userId, userName: arg3?.userName };
  const existing = await prisma.internalTransfer.findFirst({ where: { id, companyId, isDeleted: false } });
  if (!existing) { const e = new Error('Transfer not found.'); e.statusCode = 404; throw e; }
  if (!canTransition(existing.status, 'Done')) {
    const e = new Error(`Cannot complete a transfer in ${existing.status} status.`); e.statusCode = 400; throw e;
  }

  return prisma.internalTransfer.update({
    where: { id },
    data: {
      status: 'Done',
      completedBy: userId,
      completedAt: new Date(),
      history: {
        create: { action: 'Completed', fromStatus: 'Received', toStatus: 'Done', userId, userName: userName || 'System' },
      },
    },
    include: { items: true, fromLocation: true, toLocation: true },
  });
}

// ─── CANCEL ──────────────────────────────────────────────────
async function cancel(arg1, arg2, arg3) {
  const { id, companyId, userId, userName, cancelReason } = (typeof arg1 === 'object')
    ? arg1
    : { id: arg1, companyId: arg2, userId: arg3?.userId, userName: arg3?.userName, cancelReason: arg3?.cancelReason };
  const existing = await prisma.internalTransfer.findFirst({
    where: { id, companyId, isDeleted: false },
    include: { items: true },
  });
  if (!existing) { const e = new Error('Transfer not found.'); e.statusCode = 404; throw e; }
  if (!canTransition(existing.status, 'Cancelled')) {
    const e = new Error(`Cannot cancel a transfer in ${existing.status} status.`); e.statusCode = 400; throw e;
  }

  return prisma.$transaction(async (tx) => {
    // If InTransit: reverse stock deduction from source
    if (existing.status === 'InTransit') {
      const alreadyReversed = await tx.stockMovement.count({
        where: { companyId, reference: existing.transferNumber, type: 'transfer_cancel' },
      });
      if (alreadyReversed === 0) {
        for (const item of existing.items) {
          if ((item.dispatchedQty || 0) <= 0) continue;
          await adjustLocationStock(tx, {
            companyId,
            productId: item.productId,
            locationId: existing.fromLocationId,
            delta: item.dispatchedQty,
            productName: item.productName,
          });
          await tx.stockMovement.create({
            data: {
              productId: item.productId,
              productName: item.productName,
              type: 'transfer_cancel',
              quantity: item.dispatchedQty,
              previousStock: 0,
              newStock: 0,
              reason: `Cancelled Transfer ${existing.transferNumber} - Stock returned to source`,
              reference: existing.transferNumber,
              companyId,
              locationId: existing.fromLocationId,
              createdBy: userId,
              status: 'Completed',
            },
          });
        }
      }
    }

    return tx.internalTransfer.update({
      where: { id },
      data: {
        status: 'Cancelled',
        cancelledBy: userId,
        cancelledAt: new Date(),
        cancelReason: cancelReason || null,
        history: {
          create: {
            action: 'Cancelled',
            fromStatus: existing.status,
            toStatus: 'Cancelled',
            note: cancelReason || 'Cancelled by user',
            userId,
            userName: userName || 'System',
          },
        },
      },
      include: { items: true, fromLocation: true, toLocation: true },
    });
  });
}

module.exports = { list, getById, create, update, confirm, dispatch, receive, complete, cancel };
