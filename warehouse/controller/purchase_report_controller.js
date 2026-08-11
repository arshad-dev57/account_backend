// warehouse/controller/purchase_report_controller.js
const prisma = require('../../prisma/client');

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function companyScope(companyId, userId) {
  if (companyId) {
    return {
      OR: [{ companyId }, { companyId: null, createdBy: userId }],
    };
  }
  return { createdBy: userId };
}

function baseWhere(companyId, userId, extra = {}) {
  return {
    AND: [
      companyScope(companyId, userId),
      { isActive: true },
      { isDeleted: false },
      extra,
    ],
  };
}

function getDateFilter(period, startDate, endDate) {
  if (period === 'custom' && startDate && endDate) {
    const start = new Date(startDate);
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);
    return { gte: start, lte: end };
  }

  const now = new Date();
  const start = new Date(now);

  if (period === 'today') {
    start.setHours(0, 0, 0, 0);
  } else if (period === 'week') {
    start.setDate(start.getDate() - 7);
    start.setHours(0, 0, 0, 0);
  } else if (period === 'month') {
    start.setMonth(start.getMonth() - 1);
    start.setHours(0, 0, 0, 0);
  } else if (period === 'year') {
    start.setFullYear(start.getFullYear() - 1);
    start.setHours(0, 0, 0, 0);
  } else {
    start.setMonth(start.getMonth() - 1);
    start.setHours(0, 0, 0, 0);
  }

  return { gte: start };
}

function emptySummary() {
  return {
    count: 0,
    subtotal: 0,
    taxTotal: 0,
    discountTotal: 0,
    grandTotal: 0,
    byChannel: {
      orders: { count: 0, grandTotal: 0 },
      invoices: { count: 0, grandTotal: 0 },
      payments: { count: 0, grandTotal: 0 },
      returns: { count: 0, grandTotal: 0 },
    },
  };
}

async function fetchOrderRows(companyId, userId, dateFilter, { status, search }) {
  const extra = { orderDate: dateFilter };
  if (status && status !== 'all') {
    extra.status = status;
  }

  const where = baseWhere(companyId, userId, extra);
  if (search) {
    where.AND.push({
      OR: [
        { orderNumber: { contains: search, mode: 'insensitive' } },
        { supplierName: { contains: search, mode: 'insensitive' } },
      ],
    });
  }

  const rows = await prisma.purchaseOrder.findMany({
    where,
    select: {
      id: true,
      orderNumber: true,
      orderDate: true,
      supplierName: true,
      status: true,
      subtotal: true,
      totalTax: true,
      totalDiscount: true,
      grandTotal: true,
    },
    orderBy: { orderDate: 'desc' },
    take: 2000,
  });

  return rows
    .filter((o) => {
      const st = String(o.status || '');
      return st !== 'Draft' && st !== 'Cancelled';
    })
    .map((o) => ({
      id: o.id,
      channel: 'orders',
      reference: o.orderNumber || o.id,
      date: o.orderDate,
      supplierName: o.supplierName || 'Supplier',
      status: o.status || '',
      paymentStatus: '',
      subtotal: toNum(o.subtotal),
      tax: toNum(o.totalTax),
      discount: toNum(o.totalDiscount),
      grandTotal: toNum(o.grandTotal),
    }));
}

async function fetchInvoiceRows(companyId, userId, dateFilter, { status, search }) {
  const extra = {
    invoiceDate: dateFilter,
    invoiceStatus: { notIn: ['Draft', 'Cancelled'] },
  };

  const where = baseWhere(companyId, userId, extra);
  if (search) {
    where.AND.push({
      OR: [
        { invoiceNumber: { contains: search, mode: 'insensitive' } },
        { supplierName: { contains: search, mode: 'insensitive' } },
      ],
    });
  }

  let rows = await prisma.purchaseInvoice.findMany({
    where,
    select: {
      id: true,
      invoiceNumber: true,
      invoiceDate: true,
      supplierName: true,
      invoiceStatus: true,
      paymentStatus: true,
      subtotal: true,
      taxTotal: true,
      discountTotal: true,
      grandTotal: true,
    },
    orderBy: { invoiceDate: 'desc' },
    take: 2000,
  });

  if (status && status !== 'all') {
    const s = status.toLowerCase();
    rows = rows.filter((inv) => {
      const pay = String(inv.paymentStatus || '').toLowerCase();
      const st = String(inv.invoiceStatus || '').toLowerCase();
      return pay === s || st === s;
    });
  }

  return rows.map((inv) => ({
    id: inv.id,
    channel: 'invoices',
    reference: inv.invoiceNumber || inv.id,
    date: inv.invoiceDate,
    supplierName: inv.supplierName || 'Supplier',
    status: inv.invoiceStatus || '',
    paymentStatus: inv.paymentStatus || '',
    subtotal: toNum(inv.subtotal),
    tax: toNum(inv.taxTotal),
    discount: toNum(inv.discountTotal),
    grandTotal: toNum(inv.grandTotal),
  }));
}

async function fetchPaymentRows(companyId, userId, dateFilter, { status, search }) {
  const extra = { paymentDate: dateFilter };
  if (status && status !== 'all') {
    extra.status = status;
  } else {
    extra.status = { not: 'Cancelled' };
  }

  const where = baseWhere(companyId, userId, extra);
  if (search) {
    where.AND.push({
      OR: [
        { paymentNumber: { contains: search, mode: 'insensitive' } },
        { supplierName: { contains: search, mode: 'insensitive' } },
        { reference: { contains: search, mode: 'insensitive' } },
      ],
    });
  }

  const rows = await prisma.purchasePaymentMake.findMany({
    where,
    select: {
      id: true,
      paymentNumber: true,
      paymentDate: true,
      supplierName: true,
      status: true,
      amount: true,
      paymentMethod: true,
    },
    orderBy: { paymentDate: 'desc' },
    take: 2000,
  });

  return rows.map((p) => ({
    id: p.id,
    channel: 'payments',
    reference: p.paymentNumber || p.id,
    date: p.paymentDate,
    supplierName: p.supplierName || 'Supplier',
    status: p.status || '',
    paymentStatus: p.paymentMethod || 'Paid',
    subtotal: toNum(p.amount),
    tax: 0,
    discount: 0,
    grandTotal: toNum(p.amount),
  }));
}

async function fetchReturnRows(companyId, userId, dateFilter, { status, search }) {
  const extra = { returnDate: dateFilter };
  if (status && status !== 'all') {
    extra.status = status;
  }

  const where = baseWhere(companyId, userId, extra);
  if (search) {
    where.AND.push({
      OR: [
        { returnNumber: { contains: search, mode: 'insensitive' } },
        { supplierName: { contains: search, mode: 'insensitive' } },
        { purchaseInvoiceNumber: { contains: search, mode: 'insensitive' } },
      ],
    });
  }

  const rows = await prisma.purchaseReturn.findMany({
    where,
    select: {
      id: true,
      returnNumber: true,
      returnDate: true,
      supplierName: true,
      status: true,
      returnAmount: true,
      grandTotal: true,
    },
    orderBy: { returnDate: 'desc' },
    take: 2000,
  });

  return rows
    .filter((r) => {
      const st = String(r.status || '');
      return st !== 'Draft' && st !== 'Cancelled';
    })
    .map((r) => ({
      id: r.id,
      channel: 'returns',
      reference: r.returnNumber || r.id,
      date: r.returnDate,
      supplierName: r.supplierName || 'Supplier',
      status: r.status || '',
      paymentStatus: '',
      subtotal: toNum(r.returnAmount || r.grandTotal),
      tax: 0,
      discount: 0,
      grandTotal: toNum(r.grandTotal || r.returnAmount),
    }));
}

function buildSummary(rows) {
  const summary = emptySummary();
  summary.count = rows.length;
  for (const row of rows) {
    summary.subtotal += toNum(row.subtotal);
    summary.taxTotal += toNum(row.tax);
    summary.discountTotal += toNum(row.discount);
    summary.grandTotal += toNum(row.grandTotal);
    const ch = summary.byChannel[row.channel];
    if (ch) {
      ch.count += 1;
      ch.grandTotal += toNum(row.grandTotal);
    }
  }
  return summary;
}

/**
 * GET /api/purchase/reports
 * Query: channel, period, startDate, endDate, status, search, page, limit
 */
const getPurchaseReport = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const userId = req.user.id || req.user.userId;
    const {
      channel = 'all',
      period = 'month',
      startDate,
      endDate,
      status = 'all',
      search = '',
      page = '1',
      limit = '50',
    } = req.query;

    const dateFilter = getDateFilter(period, startDate, endDate);
    const filters = {
      status: status || 'all',
      search: String(search || '').trim(),
    };

    const channelKey = String(channel || 'all').toLowerCase();
    const tasks = [];
    if (channelKey === 'all' || channelKey === 'orders') {
      tasks.push(fetchOrderRows(companyId, userId, dateFilter, filters));
    } else {
      tasks.push(Promise.resolve([]));
    }
    if (channelKey === 'all' || channelKey === 'invoices') {
      tasks.push(fetchInvoiceRows(companyId, userId, dateFilter, filters));
    } else {
      tasks.push(Promise.resolve([]));
    }
    if (channelKey === 'all' || channelKey === 'payments') {
      tasks.push(fetchPaymentRows(companyId, userId, dateFilter, filters));
    } else {
      tasks.push(Promise.resolve([]));
    }
    if (channelKey === 'all' || channelKey === 'returns') {
      tasks.push(fetchReturnRows(companyId, userId, dateFilter, filters));
    } else {
      tasks.push(Promise.resolve([]));
    }

    const [orderRows, invoiceRows, paymentRows, returnRows] = await Promise.all(tasks);
    let rows = [...orderRows, ...invoiceRows, ...paymentRows, ...returnRows];

    rows.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    const summary = buildSummary(rows);

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(2000, Math.max(1, parseInt(limit, 10) || 50));
    const total = rows.length;
    const startIdx = (pageNum - 1) * limitNum;
    const pagedRows = rows.slice(startIdx, startIdx + limitNum);

    res.status(200).json({
      success: true,
      data: {
        filters: {
          channel: channelKey,
          period,
          startDate: startDate || null,
          endDate: endDate || null,
          status: filters.status,
          search: filters.search,
        },
        summary,
        rows: pagedRows,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          totalPages: Math.ceil(total / limitNum) || 1,
        },
      },
    });
  } catch (error) {
    console.error('❌ Purchase report error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message,
    });
  }
};

module.exports = {
  getPurchaseReport,
};
