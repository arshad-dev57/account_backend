const prisma = require('../../prisma/client');
const { randomUUID } = require('crypto');

const ACTIVE_KITCHEN = ['SENT', 'PREPARING'];
const READY_STATUSES = ['READY'];

function calcTotals(lines) {
  let subtotal = 0;
  for (const line of lines) {
    const qty = Math.max(0, Number(line.quantity) || 0);
    const price = Number(line.unitPrice) || 0;
    subtotal += qty * price;
  }
  return {
    subtotal,
    taxTotal: 0,
    grandTotal: subtotal,
  };
}

async function nextTicketNumber(companyId) {
  const last = await prisma.restaurantOrder.findFirst({
    where: { companyId },
    orderBy: { ticketNumber: 'desc' },
    select: { ticketNumber: true },
  });
  return (last?.ticketNumber || 0) + 1;
}

/** POST /api/pos/restaurant/orders — pick app creates order (status SENT, no draft) */
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
      lines = [],
    } = req.body;

    if (!Array.isArray(lines) || lines.length === 0) {
      return res.status(400).json({ success: false, message: 'Add at least one item' });
    }

    const totals = calcTotals(lines);
    const ticketNumber = await nextTicketNumber(companyId);
    const now = new Date();

    const order = await prisma.restaurantOrder.create({
      data: {
        id: randomUUID(),
        companyId,
        locationId: locationId || null,
        shiftId: shiftId || null,
        terminalId: terminalId || null,
        tableLabel: tableLabel ? String(tableLabel).trim() : null,
        orderType: orderType === 'takeaway' ? 'takeaway' : 'dine_in',
        status: 'SENT',
        waiterUserId: req.user.id,
        notes: notes ? String(notes).trim() : null,
        subtotal: totals.subtotal,
        taxTotal: totals.taxTotal,
        grandTotal: totals.grandTotal,
        ticketNumber,
        sentAt: now,
        lines: {
          create: lines.map((line) => {
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
            };
          }),
        },
      },
      include: { lines: true },
    });

    res.status(201).json({ success: true, data: order });
  } catch (error) {
    console.error('createOrder error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

/** GET /api/pos/restaurant/orders?status=SENT,PREPARING,READY */
exports.listOrders = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    if (!companyId) {
      return res.status(400).json({ success: false, message: 'Company not found' });
    }

    const statusParam = String(req.query.status || 'SENT,PREPARING,READY');
    const statuses = statusParam.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);

    const orders = await prisma.restaurantOrder.findMany({
      where: {
        companyId,
        status: { in: statuses.length ? statuses : ['SENT', 'PREPARING', 'READY'] },
      },
      include: {
        lines: true,
        waiter: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
      orderBy: [{ status: 'asc' }, { sentAt: 'asc' }],
      take: Math.min(parseInt(req.query.limit, 10) || 100, 200),
    });

    res.json({ success: true, data: orders });
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
      include: {
        lines: true,
        waiter: { select: { id: true, firstName: true, lastName: true } },
      },
    });
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }
    res.json({ success: true, data: order });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.markPreparing = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const order = await prisma.restaurantOrder.findFirst({
      where: { id: req.params.id, companyId, status: { in: ['SENT', 'PREPARING'] } },
    });
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found or already completed' });
    }
    const updated = await prisma.restaurantOrder.update({
      where: { id: order.id },
      data: { status: 'PREPARING' },
      include: { lines: true },
    });
    res.json({ success: true, data: updated });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.markReady = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const order = await prisma.restaurantOrder.findFirst({
      where: { id: req.params.id, companyId, status: { in: ACTIVE_KITCHEN } },
    });
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found or not in kitchen queue' });
    }
    const updated = await prisma.restaurantOrder.update({
      where: { id: order.id },
      data: { status: 'READY', readyAt: new Date() },
      include: { lines: true },
    });
    res.json({ success: true, data: updated });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/** Counter marks paid after local sale — links posSaleId if provided */
exports.markPaid = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { posSaleId } = req.body;
    const order = await prisma.restaurantOrder.findFirst({
      where: { id: req.params.id, companyId, status: 'READY' },
    });
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not ready for payment' });
    }
    const updated = await prisma.restaurantOrder.update({
      where: { id: order.id },
      data: {
        status: 'PAID',
        paidAt: new Date(),
        posSaleId: posSaleId || null,
      },
      include: { lines: true },
    });
    res.json({ success: true, data: updated });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.cancelOrder = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const order = await prisma.restaurantOrder.findFirst({
      where: { id: req.params.id, companyId, status: { in: ['SENT', 'PREPARING'] } },
    });
    if (!order) {
      return res.status(404).json({ success: false, message: 'Cannot cancel this order' });
    }
    const updated = await prisma.restaurantOrder.update({
      where: { id: order.id },
      data: { status: 'CANCELLED' },
    });
    res.json({ success: true, data: updated });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getKitchenQueue = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const orders = await prisma.restaurantOrder.findMany({
      where: { companyId, status: { in: ACTIVE_KITCHEN } },
      include: { lines: true, waiter: { select: { firstName: true, lastName: true } } },
      orderBy: { sentAt: 'asc' },
    });
    res.json({ success: true, data: orders });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getReadyQueue = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const orders = await prisma.restaurantOrder.findMany({
      where: { companyId, status: { in: READY_STATUSES } },
      include: { lines: true },
      orderBy: { readyAt: 'asc' },
    });
    res.json({ success: true, data: orders });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
