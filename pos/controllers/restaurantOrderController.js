const prisma = require('../../prisma/client');
const { randomUUID } = require('crypto');
const restaurantNotify = require('../services/restaurantNotificationService');

const ACTIVE_KITCHEN = ['SENT', 'PREPARING'];
const READY_STATUSES = ['READY'];
const PRIORITY_WEIGHT = { vip: 0, urgent: 1, high: 2, normal: 3 };
const DELAY_MINUTES = { SENT: 12, PREPARING: 18, READY: 25 };

const orderInclude = {
  lines: { include: { kitchenStation: { select: { id: true, name: true, code: true } } } },
  waiter: { select: { id: true, firstName: true, lastName: true, email: true } },
};

function calcTotals(lines) {
  let subtotal = 0;
  for (const line of lines) {
    const qty = Math.max(0, Number(line.quantity) || 0);
    const price = Number(line.unitPrice) || 0;
    subtotal += qty * price;
  }
  return { subtotal, taxTotal: 0, grandTotal: subtotal };
}

function minutesBetween(from, to = new Date()) {
  if (!from) return null;
  return Math.max(0, Math.round((to.getTime() - new Date(from).getTime()) / 60000));
}

function enrichOrderTiming(order, now = new Date()) {
  const waitMinutes = minutesBetween(order.sentAt, order.preparingAt || now);
  const prepMinutes =
    order.preparingAt && order.readyAt
      ? minutesBetween(order.preparingAt, order.readyAt)
      : order.preparingAt
        ? minutesBetween(order.preparingAt, now)
        : null;
  const totalMinutes = minutesBetween(order.sentAt, order.readyAt || now);
  const delayThreshold = DELAY_MINUTES[order.status] || 20;
  const elapsedMinutes = minutesBetween(order.preparingAt || order.sentAt, now);
  return {
    ...order,
    timing: {
      orderCreatedAt: order.createdAt,
      sentAt: order.sentAt,
      preparingAt: order.preparingAt,
      readyAt: order.readyAt,
      servedAt: order.servedAt,
      paidAt: order.paidAt,
      completedAt: order.completedAt,
      waitMinutes,
      prepMinutes,
      totalMinutes,
      elapsedMinutes,
      isDelayed: elapsedMinutes != null && elapsedMinutes >= delayThreshold,
      delayThresholdMinutes: delayThreshold,
    },
  };
}

function sortOrdersForQueue(orders) {
  return [...orders].sort((a, b) => {
    const pa = PRIORITY_WEIGHT[a.priority] ?? PRIORITY_WEIGHT.normal;
    const pb = PRIORITY_WEIGHT[b.priority] ?? PRIORITY_WEIGHT.normal;
    if (pa !== pb) return pa - pb;
    return new Date(a.sentAt).getTime() - new Date(b.sentAt).getTime();
  });
}

function buildListWhere(companyId, query = {}) {
  const where = { companyId };
  if (query.locationId) where.locationId = String(query.locationId);
  if (query.tableLabel) {
    where.tableLabel = { contains: String(query.tableLabel), mode: 'insensitive' };
  }
  if (query.waiterUserId) where.waiterUserId = String(query.waiterUserId);
  if (query.orderType) where.orderType = String(query.orderType);
  if (query.since) {
    const since = new Date(query.since);
    if (!Number.isNaN(since.getTime())) {
      where.updatedAt = { gte: since };
    }
  }
  if (query.status) {
    const statuses = String(query.status)
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
    if (statuses.length) where.status = { in: statuses };
  }
  return where;
}

function filterOrderLinesForStation(order, stationId) {
  if (!stationId) return order;
  const lines = (order.lines || []).filter((l) => l.kitchenStationId === stationId);
  if (!lines.length) return null;
  return { ...order, lines };
}

async function allocateTicketNumber(tx, companyId) {
  await tx.$executeRaw`
    SELECT pg_advisory_xact_lock(hashtext(${`rest-ticket:${companyId}`}))
  `;
  const last = await tx.restaurantOrder.findFirst({
    where: { companyId },
    orderBy: { ticketNumber: 'desc' },
    select: { ticketNumber: true },
  });
  return (last?.ticketNumber || 0) + 1;
}

async function resolveLineStationId(companyId, line) {
  if (line.kitchenStationId) return line.kitchenStationId;
  if (!line.productId) return null;
  const product = await prisma.product.findFirst({
    where: { id: String(line.productId), companyId },
    select: { categoryId: true, categoryName: true },
  });
  if (!product?.categoryName) return null;
  const station = await prisma.kitchenStation.findFirst({
    where: {
      companyId,
      isActive: true,
      code: { equals: String(product.categoryName).trim(), mode: 'insensitive' },
    },
    select: { id: true },
  });
  return station?.id || null;
}

function mapLineCreate(line, stationId) {
  const qty = Math.max(0.001, Number(line.quantity) || 1);
  const unitPrice = Number(line.unitPrice) || 0;
  return {
    id: randomUUID(),
    productId: line.productId || null,
    productName: String(line.productName || line.name || 'Item'),
    sku: String(line.sku || ''),
    quantity: qty,
    unitPrice,
    lineTotal: qty * unitPrice,
    notes: line.notes ? String(line.notes).trim() : null,
    kitchenStationId: stationId,
    lineStatus: 'PENDING',
  };
}

/** POST /api/pos/restaurant/orders */
exports.createOrder = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    if (!companyId) {
      return res.status(400).json({ success: false, message: 'Company not found' });
    }

    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: { posMode: true },
    });
    if (company?.posMode !== 'restaurant') {
      return res.status(403).json({
        success: false,
        message: 'Restaurant mode is not enabled for this company',
      });
    }

    const {
      tableLabel,
      orderType = 'dine_in',
      notes,
      locationId,
      shiftId,
      terminalId,
      priority = 'normal',
      clientRequestId,
      lines = [],
    } = req.body;

    if (!Array.isArray(lines) || lines.length === 0) {
      return res.status(400).json({ success: false, message: 'Add at least one item' });
    }

    const requestKey = clientRequestId ? String(clientRequestId).trim() : '';
    if (requestKey) {
      const existing = await prisma.restaurantOrder.findFirst({
        where: { companyId, clientRequestId: requestKey },
        include: orderInclude,
      });
      if (existing) {
        return res.status(200).json({
          success: true,
          idempotent: true,
          data: enrichOrderTiming(existing),
        });
      }
    }

    const totals = calcTotals(lines);
    const now = new Date();
    const normalizedPriority = ['vip', 'urgent', 'high', 'normal'].includes(String(priority))
      ? String(priority)
      : 'normal';
    const normalizedType = ['takeaway', 'delivery'].includes(String(orderType))
      ? String(orderType)
      : 'dine_in';

    const lineCreates = [];
    for (const line of lines) {
      const stationId = await resolveLineStationId(companyId, line);
      lineCreates.push(mapLineCreate(line, stationId));
    }

    const order = await prisma.$transaction(async (tx) => {
      const ticketNumber = await allocateTicketNumber(tx, companyId);
      return tx.restaurantOrder.create({
        data: {
          id: randomUUID(),
          companyId,
          locationId: locationId || null,
          shiftId: shiftId || null,
          terminalId: terminalId || null,
          tableLabel: tableLabel ? String(tableLabel).trim() : null,
          orderType: normalizedType,
          status: 'SENT',
          priority: normalizedPriority,
          waiterUserId: req.user.id,
          notes: notes ? String(notes).trim() : null,
          subtotal: totals.subtotal,
          taxTotal: totals.taxTotal,
          grandTotal: totals.grandTotal,
          ticketNumber,
          clientRequestId: requestKey || null,
          sentAt: now,
          lines: { create: lineCreates },
        },
        include: orderInclude,
      });
    });

    restaurantNotify.notifyOrderCreated(order).catch(() => {});

    res.status(201).json({ success: true, data: enrichOrderTiming(order) });
  } catch (error) {
    if (error.code === 'P2002') {
      return res.status(409).json({
        success: false,
        message:
          'Duplicate order request. Retry with the same clientRequestId to fetch the existing order.',
      });
    }
    console.error('createOrder error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

/** GET /api/pos/restaurant/orders/mine — current waiter's orders (order picker app) */
exports.listMyOrders = async (req, res) => {
  req.query.waiterUserId = req.user.id;
  if (!req.query.status) {
    req.query.status = 'SENT,PREPARING,READY,PAID';
  }
  return exports.listOrders(req, res);
};

/** GET /api/pos/restaurant/orders */
exports.listOrders = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    if (!companyId) {
      return res.status(400).json({ success: false, message: 'Company not found' });
    }

    const where = buildListWhere(companyId, req.query);
    if (!where.status) {
      where.status = { in: ['SENT', 'PREPARING', 'READY', 'PAID'] };
    }

    const orders = await prisma.restaurantOrder.findMany({
      where,
      include: orderInclude,
      orderBy: [{ sentAt: 'asc' }],
      take: Math.min(parseInt(req.query.limit, 10) || 100, 200),
    });

    res.json({
      success: true,
      data: sortOrdersForQueue(orders).map((o) => enrichOrderTiming(o)),
      serverTime: new Date().toISOString(),
    });
  } catch (error) {
    console.error('listOrders error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getOrder = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const order = await prisma.restaurantOrder.findFirst({
      where: { id: req.params.id, companyId },
      include: orderInclude,
    });
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }
    res.json({ success: true, data: enrichOrderTiming(order) });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

async function transitionOrder(req, res, { fromStatuses, toStatus, timestampField, extra = {} }) {
  try {
    const companyId = req.user.companyId;
    const orderId = req.params.id;
    const expectedVersion = req.body?.expectedVersion;

    const current = await prisma.restaurantOrder.findFirst({
      where: { id: orderId, companyId },
      include: orderInclude,
    });
    if (!current) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    if (current.status === toStatus) {
      return res.json({ success: true, idempotent: true, data: enrichOrderTiming(current) });
    }

    if (!fromStatuses.includes(current.status)) {
      return res.status(409).json({
        success: false,
        message: `Order is ${current.status} and cannot move to ${toStatus}`,
        data: enrichOrderTiming(current),
      });
    }

    if (expectedVersion != null && Number(expectedVersion) !== current.version) {
      return res.status(409).json({
        success: false,
        message: 'Order was updated by another user. Refresh and try again.',
        data: enrichOrderTiming(current),
      });
    }

    const now = new Date();
    const data = {
      status: toStatus,
      version: { increment: 1 },
      ...extra,
    };
    if (timestampField && !current[timestampField]) data[timestampField] = now;

    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.restaurantOrder.updateMany({
        where: { id: orderId, companyId, status: { in: fromStatuses } },
        data,
      });
      if (result.count !== 1) {
        throw new Error('CONFLICT');
      }

      if (toStatus === 'PREPARING') {
        await tx.restaurantOrderLine.updateMany({
          where: { orderId, lineStatus: 'PENDING' },
          data: { lineStatus: 'PREPARING', preparingAt: now },
        });
      }
      if (toStatus === 'READY') {
        await tx.restaurantOrderLine.updateMany({
          where: { orderId, lineStatus: { in: ['PENDING', 'PREPARING'] } },
          data: { lineStatus: 'READY', readyAt: now },
        });
      }

      return tx.restaurantOrder.findFirst({
        where: { id: orderId, companyId },
        include: orderInclude,
      });
    });

    if (toStatus === 'PREPARING' && current.status !== 'PREPARING') {
      restaurantNotify.notifyOrderPreparing(updated).catch(() => {});
    }
    if (toStatus === 'READY') {
      restaurantNotify.notifyOrderReady(updated).catch(() => {});
    }

    res.json({ success: true, data: enrichOrderTiming(updated) });
  } catch (error) {
    if (error.message === 'CONFLICT') {
      return res.status(409).json({
        success: false,
        message: 'Order status changed concurrently. Refresh and retry.',
      });
    }
    res.status(500).json({ success: false, message: error.message });
  }
}

exports.markPreparing = (req, res) =>
  transitionOrder(req, res, {
    fromStatuses: ['SENT', 'PREPARING'],
    toStatus: 'PREPARING',
    timestampField: 'preparingAt',
  });

exports.markReady = (req, res) =>
  transitionOrder(req, res, {
    fromStatuses: ACTIVE_KITCHEN,
    toStatus: 'READY',
    timestampField: 'readyAt',
  });

exports.markServed = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const orderId = req.params.id;
    const expectedVersion = req.body?.expectedVersion;

    const current = await prisma.restaurantOrder.findFirst({
      where: { id: orderId, companyId },
      include: orderInclude,
    });
    if (!current) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }
    if (current.status !== 'READY') {
      return res.status(409).json({
        success: false,
        message: 'Only ready orders can be marked served',
        data: enrichOrderTiming(current),
      });
    }
    if (current.servedAt) {
      return res.json({ success: true, idempotent: true, data: enrichOrderTiming(current) });
    }
    if (expectedVersion != null && Number(expectedVersion) !== current.version) {
      return res.status(409).json({
        success: false,
        message: 'Order was updated by another user. Refresh and try again.',
        data: enrichOrderTiming(current),
      });
    }

    const updated = await prisma.restaurantOrder.update({
      where: { id: orderId },
      data: { servedAt: new Date(), version: { increment: 1 } },
      include: orderInclude,
    });
    res.json({ success: true, data: enrichOrderTiming(updated) });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.markPaid = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { posSaleId, paymentIdempotencyKey, expectedVersion } = req.body || {};
    const order = await prisma.restaurantOrder.findFirst({
      where: { id: req.params.id, companyId },
      include: orderInclude,
    });
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    if (order.status === 'PAID') {
      if (posSaleId && order.posSaleId === posSaleId) {
        return res.json({ success: true, idempotent: true, data: enrichOrderTiming(order) });
      }
      return res.status(409).json({
        success: false,
        message: 'Order already paid',
        data: enrichOrderTiming(order),
      });
    }

    if (order.status !== 'READY') {
      return res.status(409).json({
        success: false,
        message: 'Order not ready for payment',
        data: enrichOrderTiming(order),
      });
    }

    if (expectedVersion != null && Number(expectedVersion) !== order.version) {
      return res.status(409).json({
        success: false,
        message: 'Order was updated by another user. Refresh and try again.',
        data: enrichOrderTiming(order),
      });
    }

    const now = new Date();
    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.restaurantOrder.updateMany({
        where: { id: order.id, companyId, status: 'READY' },
        data: {
          status: 'PAID',
          paidAt: now,
          completedAt: now,
          posSaleId: posSaleId || null,
          version: { increment: 1 },
        },
      });
      if (result.count !== 1) throw new Error('CONFLICT');
      return tx.restaurantOrder.findFirst({ where: { id: order.id }, include: orderInclude });
    });

    restaurantNotify.notifyOrderPaid(updated).catch(() => {});

    res.json({
      success: true,
      data: enrichOrderTiming(updated),
      paymentIdempotencyKey: paymentIdempotencyKey || null,
    });
  } catch (error) {
    if (error.message === 'CONFLICT') {
      return res.status(409).json({
        success: false,
        message: 'Payment already processed by another cashier.',
      });
    }
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.cancelOrder = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const result = await prisma.restaurantOrder.updateMany({
      where: { id: req.params.id, companyId, status: { in: ['SENT', 'PREPARING'] } },
      data: { status: 'CANCELLED', version: { increment: 1 } },
    });
    if (result.count !== 1) {
      return res.status(404).json({ success: false, message: 'Cannot cancel this order' });
    }
    const updated = await prisma.restaurantOrder.findFirst({
      where: { id: req.params.id, companyId },
      include: orderInclude,
    });
    restaurantNotify.notifyOrderCancelled(updated).catch(() => {});
    res.json({ success: true, data: enrichOrderTiming(updated) });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

function groupKitchenQueue(orders, stationId) {
  const filtered = orders
    .map((o) => filterOrderLinesForStation(o, stationId))
    .filter(Boolean)
    .map((o) => enrichOrderTiming(o));

  const sorted = sortOrdersForQueue(filtered);
  return {
    newOrders: sorted.filter((o) => o.status === 'SENT'),
    preparing: sorted.filter((o) => o.status === 'PREPARING'),
    ready: sorted.filter((o) => o.status === 'READY'),
  };
}

/** GET /api/pos/restaurant/orders/kitchen — grouped KDS queue */
exports.getKitchenQueue = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const stationId = req.query.stationId ? String(req.query.stationId) : null;
    const where = buildListWhere(companyId, req.query);
    where.status = { in: [...ACTIVE_KITCHEN, ...READY_STATUSES] };

    const orders = await prisma.restaurantOrder.findMany({
      where,
      include: orderInclude,
      orderBy: { sentAt: 'asc' },
      take: Math.min(parseInt(req.query.limit, 10) || 200, 300),
    });

    const grouped = groupKitchenQueue(orders, stationId);
    res.json({
      success: true,
      data: grouped,
      flat: [...grouped.newOrders, ...grouped.preparing, ...grouped.ready],
      serverTime: new Date().toISOString(),
    });
  } catch (error) {
    console.error('getKitchenQueue error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

/** GET /api/pos/restaurant/orders/ready — cashier queue */
exports.getReadyQueue = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const where = buildListWhere(companyId, req.query);
    where.status = { in: READY_STATUSES };

    const orders = await prisma.restaurantOrder.findMany({
      where,
      include: orderInclude,
      orderBy: [{ readyAt: 'asc' }, { sentAt: 'asc' }],
      take: Math.min(parseInt(req.query.limit, 10) || 100, 200),
    });

    res.json({
      success: true,
      data: sortOrdersForQueue(orders).map((o) => enrichOrderTiming(o)),
      serverTime: new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/** GET /api/pos/restaurant/kitchen-stations */
exports.listKitchenStations = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const stations = await prisma.kitchenStation.findMany({
      where: { companyId, isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    res.json({ success: true, data: stations });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/** POST /api/pos/restaurant/kitchen-stations */
exports.createKitchenStation = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { name, code, sortOrder = 0 } = req.body || {};
    if (!name || !code) {
      return res.status(400).json({ success: false, message: 'name and code are required' });
    }
    const station = await prisma.kitchenStation.create({
      data: {
        id: randomUUID(),
        companyId,
        name: String(name).trim(),
        code: String(code).trim().toLowerCase(),
        sortOrder: Number(sortOrder) || 0,
      },
    });
    res.status(201).json({ success: true, data: station });
  } catch (error) {
    if (error.code === 'P2002') {
      return res.status(409).json({ success: false, message: 'Station code already exists' });
    }
    res.status(500).json({ success: false, message: error.message });
  }
};

/** POST /api/pos/restaurant/orders/:id/lines/:lineId/ready — station-level line bump */
exports.markLineReady = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { id: orderId, lineId } = req.params;
    const line = await prisma.restaurantOrderLine.findFirst({
      where: { id: lineId, orderId, order: { companyId } },
    });
    if (!line) {
      return res.status(404).json({ success: false, message: 'Line not found' });
    }
    const now = new Date();
    await prisma.restaurantOrderLine.update({
      where: { id: lineId },
      data: { lineStatus: 'READY', readyAt: now },
    });

    const remaining = await prisma.restaurantOrderLine.count({
      where: { orderId, lineStatus: { in: ['PENDING', 'PREPARING'] } },
    });
    let becameReady = false;
    if (remaining === 0) {
      const bumped = await prisma.restaurantOrder.updateMany({
        where: { id: orderId, companyId, status: { in: ACTIVE_KITCHEN } },
        data: { status: 'READY', readyAt: now, version: { increment: 1 } },
      });
      becameReady = bumped.count === 1;
    }

    const order = await prisma.restaurantOrder.findFirst({
      where: { id: orderId, companyId },
      include: orderInclude,
    });
    if (becameReady && order) {
      restaurantNotify.notifyOrderReady(order).catch(() => {});
    }
    res.json({ success: true, data: enrichOrderTiming(order) });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
