// warehouse/controller/sales_report_controller.js
const prisma = require('../../prisma/client');
const { resolveQueryDateFilter } = require('../../utils/fiscalYearHelper');

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
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

function mergeSalesInvoiceRows(warehouseRows = [], moduleRows = []) {
  const moduleOrderIds = new Set(
    moduleRows.filter((r) => r.orderId).map((r) => r.orderId)
  );
  const filteredWarehouse = warehouseRows.filter((inv) => {
    const status = String(inv.invoiceStatus || '');
    if (status === 'Draft' || status === 'Cancelled') return false;
    if (inv.orderId && moduleOrderIds.has(inv.orderId)) return false;
    return true;
  });
  const filteredModule = moduleRows.filter((inv) => {
    const status = String(inv.invoiceStatus || '');
    return status !== 'Draft' && status !== 'Cancelled';
  });
  return [...filteredModule, ...filteredWarehouse];
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
      pos: { count: 0, grandTotal: 0 },
      invoices: { count: 0, grandTotal: 0 },
    },
  };
}

async function fetchOrderRows(companyId, dateFilter, { status, search }) {
  const where = {
    companyId,
    isActive: true,
    isDeleted: false,
    orderDate: dateFilter,
  };
  if (status && status !== 'all') {
    where.orderStatus = status;
  }
  if (search) {
    where.OR = [
      { orderNumber: { contains: search, mode: 'insensitive' } },
      { customerName: { contains: search, mode: 'insensitive' } },
    ];
  }

  const rows = await prisma.order.findMany({
    where,
    select: {
      id: true,
      orderNumber: true,
      orderDate: true,
      customerName: true,
      orderStatus: true,
      paymentStatus: true,
      subtotal: true,
      taxTotal: true,
      discountTotal: true,
      grandTotal: true,
    },
    orderBy: { orderDate: 'desc' },
    take: 2000,
  });

  return rows.map((o) => ({
    id: o.id,
    channel: 'orders',
    reference: o.orderNumber || o.id,
    date: o.orderDate,
    customerName: o.customerName || 'Walk-in',
    status: o.orderStatus || '',
    paymentStatus: o.paymentStatus || '',
    subtotal: toNum(o.subtotal),
    tax: toNum(o.taxTotal),
    discount: toNum(o.discountTotal),
    grandTotal: toNum(o.grandTotal),
  }));
}

async function fetchPosRows(companyId, dateFilter, { status, search }) {
  const where = {
    companyId,
    createdAt: dateFilter,
    status: status && status !== 'all' ? status : { in: ['Completed', 'Invoiced'] },
  };
  if (search) {
    where.OR = [
      { invoiceNumber: { contains: search, mode: 'insensitive' } },
      { customerName: { contains: search, mode: 'insensitive' } },
    ];
  }

  const rows = await prisma.pOSSale.findMany({
    where,
    select: {
      id: true,
      invoiceNumber: true,
      createdAt: true,
      customerName: true,
      status: true,
      subtotal: true,
      taxTotal: true,
      discountTotal: true,
      grandTotal: true,
      paidAmount: true,
    },
    orderBy: { createdAt: 'desc' },
    take: 2000,
  });

  return rows.map((s) => ({
    id: s.id,
    channel: 'pos',
    reference: s.invoiceNumber || s.id,
    date: s.createdAt,
    customerName: s.customerName || 'Walk-in',
    status: s.status || '',
    paymentStatus: toNum(s.paidAmount) >= toNum(s.grandTotal) - 0.01 ? 'Paid' : 'Partial',
    subtotal: toNum(s.subtotal),
    tax: toNum(s.taxTotal),
    discount: toNum(s.discountTotal),
    grandTotal: toNum(s.grandTotal),
  }));
}

async function fetchInvoiceRows(companyId, dateFilter, { status, search }) {
  const baseWhere = {
    companyId,
    isActive: true,
    isDeleted: false,
    invoiceDate: dateFilter,
  };

  const [warehouseRows, salesRows] = await Promise.all([
    prisma.warehouseInvoice.findMany({
      where: {
        ...baseWhere,
        invoiceStatus: { notIn: ['Draft', 'Cancelled'] },
      },
      select: {
        id: true,
        orderId: true,
        invoiceNumber: true,
        invoiceDate: true,
        customerName: true,
        invoiceStatus: true,
        paymentStatus: true,
        subtotal: true,
        taxTotal: true,
        discountTotal: true,
        grandTotal: true,
      },
      orderBy: { invoiceDate: 'desc' },
      take: 2000,
    }),
    prisma.salesInvoice.findMany({
      where: {
        ...baseWhere,
        invoiceStatus: { notIn: ['Draft', 'Cancelled'] },
      },
      select: {
        id: true,
        orderId: true,
        invoiceNumber: true,
        invoiceDate: true,
        customerName: true,
        invoiceStatus: true,
        paymentStatus: true,
        subtotal: true,
        taxTotal: true,
        discountTotal: true,
        grandTotal: true,
      },
      orderBy: { invoiceDate: 'desc' },
      take: 2000,
    }),
  ]);

  let merged = mergeSalesInvoiceRows(warehouseRows, salesRows);

  if (status && status !== 'all') {
    const s = status.toLowerCase();
    merged = merged.filter((inv) => {
      const pay = String(inv.paymentStatus || '').toLowerCase();
      const st = String(inv.invoiceStatus || '').toLowerCase();
      return pay === s || st === s;
    });
  }

  if (search) {
    const q = search.toLowerCase();
    merged = merged.filter(
      (inv) =>
        String(inv.invoiceNumber || '').toLowerCase().includes(q) ||
        String(inv.customerName || '').toLowerCase().includes(q)
    );
  }

  return merged.map((inv) => ({
    id: inv.id,
    channel: 'invoices',
    reference: inv.invoiceNumber || inv.id,
    date: inv.invoiceDate,
    customerName: inv.customerName || 'Walk-in',
    status: inv.invoiceStatus || '',
    paymentStatus: inv.paymentStatus || '',
    subtotal: toNum(inv.subtotal),
    tax: toNum(inv.taxTotal),
    discount: toNum(inv.discountTotal),
    grandTotal: toNum(inv.grandTotal),
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
 * GET /api/warehouse/sales/reports
 * Query: channel, period, startDate, endDate, status, search, page, limit
 */
const getSalesReport = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const {
      channel = 'all',
      period = 'month',
      startDate,
      endDate,
      fiscalYearId,
      status = 'all',
      search = '',
      page = '1',
      limit = '50',
    } = req.query;

    const dateFilter = await resolveQueryDateFilter({
      period,
      startDate,
      endDate,
      fiscalYearId,
      companyId,
    });
    const filters = {
      status: status || 'all',
      search: String(search || '').trim(),
    };

    const channelKey = String(channel || 'all').toLowerCase();
    const tasks = [];
    if (channelKey === 'all' || channelKey === 'orders') {
      tasks.push(fetchOrderRows(companyId, dateFilter, filters));
    } else {
      tasks.push(Promise.resolve([]));
    }
    if (channelKey === 'all' || channelKey === 'pos') {
      tasks.push(fetchPosRows(companyId, dateFilter, filters));
    } else {
      tasks.push(Promise.resolve([]));
    }
    if (channelKey === 'all' || channelKey === 'invoices') {
      tasks.push(fetchInvoiceRows(companyId, dateFilter, filters));
    } else {
      tasks.push(Promise.resolve([]));
    }

    const [orderRows, posRows, invoiceRows] = await Promise.all(tasks);
    let rows = [...orderRows, ...posRows, ...invoiceRows];

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
    console.error('❌ Sales report error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message,
    });
  }
};

module.exports = {
  getSalesReport,
};
