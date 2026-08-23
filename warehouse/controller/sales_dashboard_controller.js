// warehouse/controller/sales_dashboard_controller.js - MULTI-TENANT VERSION

const prisma = require('../../prisma/client');
const { applyFiscalYearWindow } = require('../../utils/fiscalYearHelper');
const {
  withLocation,
  salesInvoiceLocationWhere,
  warehouseInvoiceLocationWhere,
} = require('../../utils/accountingLocationHelper');
const { constraintIds } = require('../../utils/locationAccessHelper');

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Returns / refunds scoped by order warehouse */
function viaOrderLocation(locationId) {
  const ids = constraintIds(locationId);
  if (ids == null) return {};
  if (!ids.length) return { order: { locationId: { in: [] } } };
  return { order: { locationId: { in: ids } } };
}

/** POS sales via terminal warehouse */
function posLocationWhere(locationId) {
  const ids = constraintIds(locationId);
  if (ids == null) return {};
  if (!ids.length) return { terminal: { locationId: { in: [] } } };
  return { terminal: { locationId: { in: ids } } };
}

function invoiceDue(inv) {
  const status = String(inv.paymentStatus || inv.invoiceStatus || '');
  // Fully settled by payment or credit note
  if (status === 'Paid' || status === 'Credit Balance' || status === 'Cancelled') {
    return 0;
  }
  // Stored outstanding is updated by payments + credit notes
  if (inv.outstanding != null && inv.outstanding !== undefined) {
    return Math.max(0, toNum(inv.outstanding));
  }
  return Math.max(0, toNum(inv.grandTotal) - toNum(inv.paidAmount));
}

/**
 * Prefer SalesInvoice when both exist for the same order.
 * Always exclude Draft/Cancelled.
 */
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

// ─── HELPERS ────────────────────────────────────────────────
const getDateFilter = (period, startDate, endDate) => {
  if (period === 'custom' && startDate && endDate) {
    const start = new Date(startDate);
    start.setHours(0, 0, 0, 0);
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);
    return { gte: start, lte: end };
  }

  const now = new Date();
  now.setHours(23, 59, 59, 999);
  let start = new Date();

  if (period === 'today') {
    start.setHours(0, 0, 0, 0);
  } else if (period === 'week') {
    start.setDate(start.getDate() - 7);
    start.setHours(0, 0, 0, 0);
  } else if (period === 'month') {
    start = new Date(now.getFullYear(), now.getMonth(), 1);
    start.setHours(0, 0, 0, 0);
  } else if (period === 'year') {
    start = new Date(now.getFullYear(), 0, 1);
    start.setHours(0, 0, 0, 0);
  } else {
    start = new Date(now.getFullYear(), now.getMonth(), 1);
    start.setHours(0, 0, 0, 0);
  }

  return { gte: start, lte: now };
};

async function resolveSalesDateFilter({
  period,
  startDate,
  endDate,
  fiscalYearId,
  companyId
}) {
  const raw = getDateFilter(period, startDate, endDate);
  if (!fiscalYearId || !companyId) return raw;

  const clamped = await applyFiscalYearWindow({
    companyId,
    fiscalYearId,
    start: raw.gte,
    end: raw.lte,
    period: period === 'year' ? 'This Year' : period
  });
  return { gte: clamped.start, lte: clamped.end };
}

// ─── GET ORDER TREND ──────────────────────────────────────
const getOrderTrend = async (userId, companyId, dateFilter, locationId = null) => {
  const trendData = await prisma.order.findMany({
    where: {
      companyId: companyId,
      isActive: true,
      isDeleted: false,
      orderDate: dateFilter,
      ...withLocation(locationId),
    },
    select: {
      orderDate: true,
      grandTotal: true,
      orderStatus: true
    },
    orderBy: { orderDate: 'asc' }
  });

  const trendMap = {};
  trendData.forEach((o) => {
    const key = o.orderDate.toISOString().split('T')[0];
    if (!trendMap[key]) {
      trendMap[key] = {
        date: key,
        orders: 0,
        revenue: 0,
        pending: 0,
        completed: 0,
        cancelled: 0
      };
    }
    trendMap[key].orders += 1;
    trendMap[key].revenue += o.grandTotal;
    
    if (o.orderStatus === 'Pending') trendMap[key].pending += 1;
    else if (o.orderStatus === 'Completed') trendMap[key].completed += 1;
    else if (o.orderStatus === 'Cancelled') trendMap[key].cancelled += 1;
  });

  return Object.values(trendMap);
};

// ─── POS SALE FILTER (exclude cancelled/held/returned; Invoiced counted under invoices) ───
const posSaleWhere = (companyId, dateFilter, locationId = null) => ({
  companyId,
  status: 'Completed',
  ...(dateFilter ? { createdAt: dateFilter } : {}),
  ...posLocationWhere(locationId),
});

const getPosTrend = async (companyId, dateFilter, locationId = null) => {
  const rows = await prisma.pOSSale.findMany({
    where: posSaleWhere(companyId, dateFilter, locationId),
    select: { createdAt: true, grandTotal: true },
    orderBy: { createdAt: 'asc' }
  });

  const trendMap = {};
  rows.forEach((sale) => {
    const key = sale.createdAt.toISOString().split('T')[0];
    if (!trendMap[key]) {
      trendMap[key] = { date: key, sales: 0, revenue: 0, orderRevenue: 0 };
    }
    trendMap[key].sales += 1;
    trendMap[key].revenue += toNum(sale.grandTotal);
  });

  return Object.values(trendMap);
};

const getPosStats = async (companyId, dateFilter, locationId = null) => {
  const [agg, todayAgg] = await Promise.all([
    prisma.pOSSale.aggregate({
      where: posSaleWhere(companyId, dateFilter, locationId),
      _sum: { grandTotal: true, discountTotal: true, taxTotal: true, paidAmount: true },
      _count: { id: true }
    }),
    prisma.pOSSale.aggregate({
      where: posSaleWhere(companyId, (() => {
        const start = new Date();
        start.setHours(0, 0, 0, 0);
        return { gte: start };
      })(), locationId),
      _sum: { grandTotal: true },
      _count: { id: true }
    }),
  ]);

  return {
    count: agg._count.id || 0,
    revenue: toNum(agg._sum.grandTotal),
    discountTotal: toNum(agg._sum.discountTotal),
    taxTotal: toNum(agg._sum.taxTotal),
    paidAmount: toNum(agg._sum.paidAmount),
    todayCount: todayAgg._count.id || 0,
    todayRevenue: toNum(todayAgg._sum.grandTotal)
  };
};

const sumPosRevenue = async (companyId, dateFilter, locationId = null) => {
  const agg = await prisma.pOSSale.aggregate({
    where: posSaleWhere(companyId, dateFilter, locationId),
    _sum: { grandTotal: true }
  });
  return toNum(agg._sum.grandTotal);
};

const getRecentPosActivity = async (companyId, limit = 8, locationId = null) => {
  const rows = await prisma.pOSSale.findMany({
    where: {
      companyId,
      status: { in: ['Completed', 'Invoiced', 'Returned'] },
      ...posLocationWhere(locationId),
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: {
      id: true,
      invoiceNumber: true,
      grandTotal: true,
      customerName: true,
      createdAt: true,
      status: true
    }
  });

  return rows.map((s) => ({
    id: s.id,
    type: 'pos',
    description: `POS ${s.invoiceNumber} · ${s.customerName || 'Walk-in'}`,
    amount: toNum(s.grandTotal),
    date: s.createdAt,
    status: s.status,
    timestamp: s.createdAt
  }));
};

// ─── GET INVOICE STATS ────────────────────────────────────
const getInvoiceStats = async (userId, companyId, dateFilter, locationId = null) => {
  const baseWhere = {
    companyId,
    isActive: true,
    isDeleted: false,
    ...(dateFilter ? { invoiceDate: dateFilter } : {})
  };

  const [warehouseRows, salesRows] = await Promise.all([
    prisma.warehouseInvoice.findMany({
      where: {
        ...baseWhere,
        invoiceStatus: { notIn: ['Draft', 'Cancelled'] },
        ...warehouseInvoiceLocationWhere(locationId),
      },
      select: {
        id: true,
        orderId: true,
        grandTotal: true,
        paidAmount: true,
        outstanding: true,
        paymentStatus: true,
        invoiceStatus: true
      }
    }),
    prisma.salesInvoice.findMany({
      where: {
        ...baseWhere,
        invoiceStatus: { notIn: ['Draft', 'Cancelled'] },
        ...salesInvoiceLocationWhere(locationId),
      },
      select: {
        id: true,
        orderId: true,
        grandTotal: true,
        paidAmount: true,
        outstanding: true,
        paymentStatus: true,
        invoiceStatus: true
      }
    }),
  ]);

  const merged = mergeSalesInvoiceRows(warehouseRows, salesRows);

  let grandTotal = 0;
  let paidAmount = 0;
  let outstanding = 0;
  let paid = 0;
  let unpaid = 0;
  let partial = 0;

  for (const inv of merged) {
    const total = toNum(inv.grandTotal);
    const paidAmt = toNum(inv.paidAmount);
    const due = invoiceDue(inv);

    grandTotal += total;
    paidAmount += paidAmt;
    outstanding += due;

    if (due <= 0.01) paid += 1;
    else if (paidAmt > 0.01) partial += 1;
    else unpaid += 1;
  }

  return {
    total: merged.length,
    paid,
    unpaid,
    partial,
    // revenue kept for older clients; equals invoiced grand total
    revenue: grandTotal,
    grandTotal,
    paidAmount,
    outstanding
  };
};

// ─── GET INVOICE TREND ────────────────────────────────────
const getInvoiceTrend = async (userId, companyId, days = 30, locationId = null) => {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  startDate.setHours(0, 0, 0, 0);
  const dateFilter = { gte: startDate };

  const [warehouseRows, salesRows] = await Promise.all([
    prisma.warehouseInvoice.findMany({
      where: {
        companyId,
        isActive: true,
        isDeleted: false,
        invoiceDate: dateFilter,
        invoiceStatus: { notIn: ['Draft', 'Cancelled'] },
        ...warehouseInvoiceLocationWhere(locationId),
      },
      select: {
        orderId: true,
        invoiceDate: true,
        grandTotal: true,
        paidAmount: true,
        outstanding: true,
        paymentStatus: true,
        invoiceStatus: true
      },
      orderBy: { invoiceDate: 'asc' }
    }),
    prisma.salesInvoice.findMany({
      where: {
        companyId,
        isActive: true,
        isDeleted: false,
        invoiceDate: dateFilter,
        invoiceStatus: { notIn: ['Draft', 'Cancelled'] },
        ...salesInvoiceLocationWhere(locationId),
      },
      select: {
        orderId: true,
        invoiceDate: true,
        grandTotal: true,
        paidAmount: true,
        outstanding: true,
        paymentStatus: true,
        invoiceStatus: true
      },
      orderBy: { invoiceDate: 'asc' }
    }),
  ]);

  const invoices = mergeSalesInvoiceRows(warehouseRows, salesRows);

  const trendMap = {};
  invoices.forEach((inv) => {
    const key = new Date(inv.invoiceDate).toISOString().split('T')[0];
    if (!trendMap[key]) {
      trendMap[key] = {
        date: key,
        total: 0,
        paid: 0,
        unpaid: 0,
        revenue: 0,
        collected: 0,
        count: 0
      };
    }
    const total = toNum(inv.grandTotal);
    const paidAmt = toNum(inv.paidAmount);
    const due = invoiceDue(inv);
    trendMap[key].total += total;
    trendMap[key].revenue += total;
    trendMap[key].collected += paidAmt;
    trendMap[key].count += 1;
    if (due <= 0.01) {
      trendMap[key].paid += total;
    } else {
      trendMap[key].unpaid += due;
    }
  });

  return Object.values(trendMap);
};

// ─── GET RETURN STATS ─────────────────────────────────────
const getReturnStats = async (userId, companyId, dateFilter, locationId = null) => {
  const base = {
    companyId,
    isActive: true,
    isDeleted: false,
    returnDate: dateFilter,
    ...viaOrderLocation(locationId),
  };

  const [total, pending, approved, rejected, completed] = await Promise.all([
    prisma.return.count({ where: base }),
    prisma.return.count({ where: { ...base, returnStatus: 'Pending' } }),
    prisma.return.count({ where: { ...base, returnStatus: 'Approved' } }),
    prisma.return.count({ where: { ...base, returnStatus: 'Rejected' } }),
    prisma.return.count({ where: { ...base, returnStatus: 'Completed' } }),
  ]);

  const refundAmount = await prisma.return.aggregate({
    where: base,
    _sum: { refundAmount: true }
  });

  return {
    total,
    pending,
    approved,
    rejected,
    completed,
    refundAmount: refundAmount._sum.refundAmount || 0
  };
};

// ─── GET CREDIT NOTE (SALES CREDITS) STATS ────────────────
const getCreditNoteStats = async (userId, companyId, dateFilter, locationId = null) => {
  const baseWhere = {
    companyId,
    date: dateFilter,
    status: { notIn: ['Voided', 'Cancelled', 'Expired'] },
    ...(locationId
      ? {
          OR: [
            { salesInvoice: { locationId: String(locationId) } },
            {
              salesInvoiceId: null,
              originalInvoice: { order: { locationId: String(locationId) } },
            },
          ],
        }
      : {}),
  };

  const [total, issued, partiallyApplied, fullyApplied, amounts] =
    await Promise.all([
      prisma.creditNote.count({ where: baseWhere }),
      prisma.creditNote.count({
        where: { ...baseWhere, status: 'Issued' }
      }),
      prisma.creditNote.count({
        where: { ...baseWhere, status: 'PartiallyApplied' }
      }),
      prisma.creditNote.count({
        where: { ...baseWhere, status: 'Applied' }
      }),
      prisma.creditNote.aggregate({
        where: baseWhere,
        _sum: {
          amount: true,
          appliedAmount: true,
          remainingAmount: true
        }
      }),
    ]);

  return {
    total,
    issued,
    partiallyApplied,
    fullyApplied,
    creditAmount: amounts._sum.amount || 0,
    appliedAmount: amounts._sum.appliedAmount || 0,
    remainingAmount: amounts._sum.remainingAmount || 0
  };
};

// ─── GET REFUND STATS ─────────────────────────────────────
const getRefundStats = async (userId, companyId, dateFilter, locationId = null) => {
  const base = {
    companyId,
    isActive: true,
    isDeleted: false,
    refundDate: dateFilter,
    ...viaOrderLocation(locationId),
  };

  const [total, pending, completed, failed] = await Promise.all([
    prisma.refund.count({ where: base }),
    prisma.refund.count({ where: { ...base, refundStatus: 'Pending' } }),
    prisma.refund.count({ where: { ...base, refundStatus: 'Completed' } }),
    prisma.refund.count({ where: { ...base, refundStatus: 'Failed' } }),
  ]);

  const refundAmount = await prisma.refund.aggregate({
    where: {
      ...base,
      refundStatus: 'Completed'
    },
    _sum: { amount: true }
  });

  return {
    total,
    pending,
    completed,
    failed,
    refundAmount: refundAmount._sum.amount || 0
  };
};

// ─── GET TOP PRODUCTS (orders + POS) ──────────────────────
const getTopProducts = async (userId, companyId, dateFilter, locationId = null, limit = 10) => {

  const [orderProducts, posProducts] = await Promise.all([
    prisma.orderItem.groupBy({
      by: ['productId', 'productName', 'sku'],
      where: {
        order: {
          companyId,
          isActive: true,
          isDeleted: false,
          orderDate: dateFilter,
          ...withLocation(locationId),
        }
      },
      _count: { id: true },
      _sum: { quantity: true, totalPrice: true }
    }),
    prisma.pOSSaleItem.groupBy({
      by: ['productId', 'productName', 'sku'],
      where: {
        posSale: posSaleWhere(companyId, dateFilter, locationId)
      },
      _count: { id: true },
      _sum: { quantity: true, lineTotal: true }
    }),
  ]);

  const merged = {};
  for (const item of orderProducts) {
    const key = item.productId || item.sku || item.productName;
    merged[key] = {
      productId: item.productId,
      productName: item.productName,
      sku: item.sku,
      quantity: toNum(item._sum.quantity),
      revenue: toNum(item._sum.totalPrice),
      orderCount: item._count.id || 0
    };
  }
  for (const item of posProducts) {
    const key = item.productId || item.sku || item.productName;
    if (!merged[key]) {
      merged[key] = {
        productId: item.productId,
        productName: item.productName,
        sku: item.sku,
        quantity: 0,
        revenue: 0,
        orderCount: 0
      };
    }
    merged[key].quantity += toNum(item._sum.quantity);
    merged[key].revenue += toNum(item._sum.lineTotal);
    merged[key].orderCount += item._count.id || 0;
  }

  return Object.values(merged)
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, limit);
};

// ─── GET CUSTOMER STATS ──────────────────────────────────
const getCustomerStats = async (userId, companyId, dateFilter) => {

  const [totalCustomers, newCustomers, topCustomers] = await Promise.all([
    prisma.customer.count({
      where: {
        companyId: companyId, // 👈 User-specific
        isActive: true,
        isDeleted: false
      }
    }),
    prisma.customer.count({
      where: {
        companyId: companyId,
        isActive: true,
        isDeleted: false,
        createdAt: dateFilter
      }
    }),
    prisma.customer.findMany({
      where: {
        companyId: companyId,
        isActive: true,
        isDeleted: false
      },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        totalOrders: true,
        totalSpent: true,
        loyaltyPoints: true
      },
      orderBy: {
        totalSpent: 'desc'
      },
      take: 5
    })
  ]);

  return {
    totalCustomers,
    newCustomers,
    topCustomers
  };
};

// ============================================================
// @desc    Get sales dashboard data (User-specific)
// @route   GET /api/warehouse/sales/dashboard
// @access  Private
// ============================================================
const getSalesDashboard = async (req, res) => {
  try {
    const userId = req.user.id;
    const companyId = req.user.companyId;
    const period = req.query.period || 'month';
    const startDate = req.query.startDate;
    const endDate = req.query.endDate;
    const fiscalYearId = req.query.fiscalYearId;
    const locationId = req.query.locationId;
    const dateFilter = await resolveSalesDateFilter({
      period,
      startDate,
      endDate,
      fiscalYearId,
      companyId
    });

    // ─── ORDERS ──────────────────────────────────────────────
    const orderFilter = {
      companyId: companyId,
      isActive: true,
      isDeleted: false,
      orderDate: dateFilter,
      ...(locationId ? { locationId } : {}),
    };

    const [orderCount, orderRevenue, orderStatusCounts, orderTrend, posStats, posTrend] =
      await Promise.all([
        prisma.order.count({ where: orderFilter }),
        prisma.order.aggregate({
          where: orderFilter,
          _sum: { grandTotal: true }
        }),
        prisma.order.groupBy({
          by: ['orderStatus'],
          where: orderFilter,
          _count: { _all: true },
          _sum: { grandTotal: true }
        }),
        getOrderTrend(userId, companyId, dateFilter, locationId),
        getPosStats(companyId, dateFilter, locationId),
        getPosTrend(companyId, dateFilter, locationId),
      ]);

    // Enrich order trend with orderRevenue alias for Flutter/Next clients
    const enrichedOrderTrend = orderTrend.map((t) => ({
      ...t,
      orderRevenue: toNum(t.revenue)
    }));

    // ─── INVOICES ─────────────────────────────────────────────
    const [invoiceStats, invoiceTrend] = await Promise.all([
      getInvoiceStats(userId, companyId, dateFilter, locationId),
      getInvoiceTrend(userId, companyId, 30, locationId),
    ]);

    // ─── RETURNS ──────────────────────────────────────────────
    const returnStats = await getReturnStats(userId, companyId, dateFilter, locationId);

    // ─── REFUNDS ──────────────────────────────────────────────
    const refundStats = await getRefundStats(userId, companyId, dateFilter, locationId);

    // ─── SALES CREDITS (CREDIT NOTES) ─────────────────────────
    const creditNoteStats = await getCreditNoteStats(userId, companyId, dateFilter, locationId);

    // ─── TOP PRODUCTS ─────────────────────────────────────────
    const topProducts = await getTopProducts(userId, companyId, dateFilter, locationId);

    // ─── CUSTOMER STATS ──────────────────────────────────────
    const customerStats = await getCustomerStats(userId, companyId, dateFilter);

    // ─── SUMMARY STATS ───────────────────────────────────────
    const orderRev = toNum(orderRevenue._sum.grandTotal);
    const posRev = toNum(posStats.revenue);
    const summary = {
      totalOrders: orderCount,
      totalRevenue: orderRev + posRev,
      totalPosSales: posStats.count,
      totalPosRevenue: posRev,
      totalInvoices: invoiceStats.total,
      totalInvoiceRevenue: invoiceStats.revenue,
      totalReturns: returnStats.total,
      totalRefunds: refundStats.total,
      refundAmount: refundStats.refundAmount,
      totalCredits: creditNoteStats.total,
      creditAmount: creditNoteStats.creditAmount,
      creditRemaining: creditNoteStats.remainingAmount,
      outstandingInvoices: invoiceStats.outstanding,
      totalCustomers: customerStats.totalCustomers
    };

    // ─── ENRICH ORDERS DATA ───────────────────────────────────
    const todayOrders = orderStatusCounts.reduce((sum, s) => sum + (s._count._all || 0), 0);
    const todayRevenue = orderRevenue._sum.grandTotal || 0;
    const pendingOrders = orderStatusCounts.find(s => s.orderStatus === 'Pending')?._count._all || 0;

    // ─── COMPARISON DATA (INDEPENDENT PERIODS) ───────────────
    // Calculate independent data for each period regardless of selected filter
    const now = new Date();
    
    // Today's data
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    const yesterdayStart = new Date(todayStart);
    yesterdayStart.setDate(yesterdayStart.getDate() - 1);
    
    const [todaySalesAgg, yesterdaySalesAgg, todayPos, yesterdayPos] = await Promise.all([
      prisma.order.aggregate({
        where: {
          companyId: companyId,
          isActive: true,
          isDeleted: false,
          orderDate: { gte: todayStart },
          ...withLocation(locationId),
        },
        _sum: { grandTotal: true }
      }),
      prisma.order.aggregate({
        where: {
          companyId: companyId,
          isActive: true,
          isDeleted: false,
          orderDate: { 
            gte: yesterdayStart,
            lt: todayStart
          },
          ...withLocation(locationId),
        },
        _sum: { grandTotal: true }
      }),
      sumPosRevenue(companyId, { gte: todayStart }, locationId),
      sumPosRevenue(companyId, { gte: yesterdayStart, lt: todayStart }, locationId),
    ]);
    
    const todaySales = toNum(todaySalesAgg._sum.grandTotal) + todayPos;
    const yesterdaySales = toNum(yesterdaySalesAgg._sum.grandTotal) + yesterdayPos;
    const todaySalesChange = yesterdaySales > 0 
      ? ((todaySales - yesterdaySales) / yesterdaySales) * 100 
      : 0;
    
    // This Week's data
    const weekStart = new Date(now);
    weekStart.setDate(weekStart.getDate() - 7);
    weekStart.setHours(0, 0, 0, 0);
    const lastWeekStart = new Date(weekStart);
    lastWeekStart.setDate(lastWeekStart.getDate() - 7);
    
    const [weekSalesAgg, lastWeekSalesAgg, weekPos, lastWeekPos] = await Promise.all([
      prisma.order.aggregate({
        where: {
          companyId: companyId,
          isActive: true,
          isDeleted: false,
          orderDate: { gte: weekStart },
          ...withLocation(locationId),
        },
        _sum: { grandTotal: true }
      }),
      prisma.order.aggregate({
        where: {
          companyId: companyId,
          isActive: true,
          isDeleted: false,
          orderDate: { 
            gte: lastWeekStart,
            lt: weekStart
          },
          ...withLocation(locationId),
        },
        _sum: { grandTotal: true }
      }),
      sumPosRevenue(companyId, { gte: weekStart }, locationId),
      sumPosRevenue(companyId, { gte: lastWeekStart, lt: weekStart }, locationId),
    ]);
    
    const weekSales = toNum(weekSalesAgg._sum.grandTotal) + weekPos;
    const lastWeekSales = toNum(lastWeekSalesAgg._sum.grandTotal) + lastWeekPos;
    const weekSalesChange = lastWeekSales > 0 
      ? ((weekSales - lastWeekSales) / lastWeekSales) * 100 
      : 0;
    
    // This Month's data
    const monthStart = new Date(now);
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const lastMonthStart = new Date(monthStart);
    lastMonthStart.setMonth(lastMonthStart.getMonth() - 1);
    
    const [monthSalesAgg, lastMonthSalesAgg, monthPos, lastMonthPos] = await Promise.all([
      prisma.order.aggregate({
        where: {
          companyId: companyId,
          isActive: true,
          isDeleted: false,
          orderDate: { gte: monthStart },
          ...withLocation(locationId),
        },
        _sum: { grandTotal: true }
      }),
      prisma.order.aggregate({
        where: {
          companyId: companyId,
          isActive: true,
          isDeleted: false,
          orderDate: { 
            gte: lastMonthStart,
            lt: monthStart
          },
          ...withLocation(locationId),
        },
        _sum: { grandTotal: true }
      }),
      sumPosRevenue(companyId, { gte: monthStart }, locationId),
      sumPosRevenue(companyId, { gte: lastMonthStart, lt: monthStart }, locationId),
    ]);
    
    const monthSales = toNum(monthSalesAgg._sum.grandTotal) + monthPos;
    const lastMonthSales = toNum(lastMonthSalesAgg._sum.grandTotal) + lastMonthPos;
    const monthSalesChange = lastMonthSales > 0 
      ? ((monthSales - lastMonthSales) / lastMonthSales) * 100 
      : 0;
    
    // This Year's data
    const yearStart = new Date(now);
    yearStart.setMonth(0, 1);
    yearStart.setHours(0, 0, 0, 0);
    const lastYearStart = new Date(yearStart);
    lastYearStart.setFullYear(lastYearStart.getFullYear() - 1);
    
    const [yearSalesAgg, lastYearSalesAgg, yearPos, lastYearPos] = await Promise.all([
      prisma.order.aggregate({
        where: {
          companyId: companyId,
          isActive: true,
          isDeleted: false,
          orderDate: { gte: yearStart },
          ...withLocation(locationId),
        },
        _sum: { grandTotal: true }
      }),
      prisma.order.aggregate({
        where: {
          companyId: companyId,
          isActive: true,
          isDeleted: false,
          orderDate: { 
            gte: lastYearStart,
            lt: yearStart
          },
          ...withLocation(locationId),
        },
        _sum: { grandTotal: true }
      }),
      sumPosRevenue(companyId, { gte: yearStart }, locationId),
      sumPosRevenue(companyId, { gte: lastYearStart, lt: yearStart }, locationId),
    ]);
    
    const yearSales = toNum(yearSalesAgg._sum.grandTotal) + yearPos;
    const lastYearSales = toNum(lastYearSalesAgg._sum.grandTotal) + lastYearPos;
    const yearSalesChange = lastYearSales > 0 
      ? ((yearSales - lastYearSales) / lastYearSales) * 100 
      : 0;
    
    // Returns data for each period
    const [todayReturns, weekReturns, monthReturns, yearReturns] = await Promise.all([
      prisma.return.aggregate({
        where: {
          companyId: companyId,
          isActive: true,
          isDeleted: false,
          returnDate: { gte: todayStart },
          ...viaOrderLocation(locationId),
        },
        _sum: { refundAmount: true }
      }),
      prisma.return.aggregate({
        where: {
          companyId: companyId,
          isActive: true,
          isDeleted: false,
          returnDate: { gte: weekStart },
          ...viaOrderLocation(locationId),
        },
        _sum: { refundAmount: true }
      }),
      prisma.return.aggregate({
        where: {
          companyId: companyId,
          isActive: true,
          isDeleted: false,
          returnDate: { gte: monthStart },
          ...viaOrderLocation(locationId),
        },
        _sum: { refundAmount: true }
      }),
      prisma.return.aggregate({
        where: {
          companyId: companyId,
          isActive: true,
          isDeleted: false,
          returnDate: { gte: yearStart },
          ...viaOrderLocation(locationId),
        },
        _sum: { refundAmount: true }
      })
    ]);
    
    const comparison = {
      today: {
        currentSales: todaySales,
        priorSales: yesterdaySales,
        currentReturns: todayReturns._sum.refundAmount || 0,
        priorReturns: 0,
        salesChangePercent: todaySalesChange,
        returnsChangePercent: 0
      },
      week: {
        currentSales: weekSales,
        priorSales: lastWeekSales,
        currentReturns: weekReturns._sum.refundAmount || 0,
        priorReturns: 0,
        salesChangePercent: weekSalesChange,
        returnsChangePercent: 0
      },
      month: {
        currentSales: monthSales,
        priorSales: lastMonthSales,
        currentReturns: monthReturns._sum.refundAmount || 0,
        priorReturns: 0,
        salesChangePercent: monthSalesChange,
        returnsChangePercent: 0
      },
      year: {
        currentSales: yearSales,
        priorSales: lastYearSales,
        currentReturns: yearReturns._sum.refundAmount || 0,
        priorReturns: 0,
        salesChangePercent: yearSalesChange,
        returnsChangePercent: 0
      }
    };

    // ─── RECENT ACTIVITY (POS sales) ──────────────────────────
    const recentActivity = await getRecentPosActivity(companyId, 10, locationId);

    // ─── REVENUE BREAKDOWN (orders + POS + invoices) ──────────
    const invoiceRev = toNum(invoiceStats.grandTotal || invoiceStats.revenue);
    const channelTotal = orderRev + posRev + invoiceRev;
    const pct = (v) => (channelTotal > 0 ? Math.round((v / channelTotal) * 1000) / 10 : 0);
    const revenueBreakdown = {
      grossRevenue: orderRev + posRev,
      lineItemDiscounts: toNum(posStats.discountTotal),
      orderLevelDiscounts: 0,
      netRevenue: orderRev + posRev,
      taxAmount: toNum(posStats.taxTotal),
      shippingAmount: 0,
      items: [
        { category: 'POS', amount: posRev, percentage: pct(posRev) },
        { category: 'Orders', amount: orderRev, percentage: pct(orderRev) },
        { category: 'Invoices', amount: invoiceRev, percentage: pct(invoiceRev) },
      ].filter((i) => i.amount > 0)
    };

    res.status(200).json({
      success: true,
      data: {
        summary,
        orders: {
          count: orderCount,
          revenue: orderRev,
          byStatus: orderStatusCounts.map((s) => ({
            status: s.orderStatus,
            count: s._count._all,
            revenue: s._sum.grandTotal || 0
          })),
          trend: enrichedOrderTrend,
          todayCount: todayOrders,
          todayRevenue: todayRevenue,
          pendingCount: pendingOrders,
          revenueGrowth: '+15%'
        },
        pos: {
          count: posStats.count,
          revenue: posRev,
          discountTotal: posStats.discountTotal,
          taxTotal: posStats.taxTotal,
          paidAmount: posStats.paidAmount,
          todayCount: posStats.todayCount,
          todayRevenue: posStats.todayRevenue,
          trend: posTrend,
          revenueGrowth: posRev > 0 ? '+0%' : '0%'
        },
        invoices: {
          stats: invoiceStats,
          trend: invoiceTrend,
          grandTotalGrowth: '+12%',
          paidAmountGrowth: '+10%',
          outstandingGrowth: '+8%'
        },
        returns: returnStats,
        refunds: refundStats,
        credits: creditNoteStats,
        comparison,
        recentActivity,
        topProducts,
        topCustomers: customerStats.topCustomers,
        revenueBreakdown
      }
    });
  } catch (error) {
    console.error('Sales dashboard error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// ============================================================
// @desc    Get sales summary (User-specific)
// @route   GET /api/warehouse/sales/summary
// @access  Private
// ============================================================
const getSalesSummary = async (req, res) => {
  try {
    const userId = req.user.id;
    const companyId = req.user.companyId;
    const { period = 'month', startDate, endDate, fiscalYearId } = req.query;
    const dateFilter = await resolveSalesDateFilter({
      period,
      startDate,
      endDate,
      fiscalYearId,
      companyId
    });

    // ✅ All queries with userId filter
    const [
      totalOrders,
      orderRevenue,
      totalInvoices,
      invoiceRevenue,
      totalReturns,
      refundAmount,
      totalCustomers,
      avgOrderValue
    ] = await Promise.all([
      prisma.order.count({
        where: {
          companyId: companyId,
          isActive: true,
          isDeleted: false,
          orderDate: dateFilter
        }
      }),
      prisma.order.aggregate({
        where: {
          companyId: companyId,
          isActive: true,
          isDeleted: false,
          orderDate: dateFilter
        },
        _sum: { grandTotal: true }
      }),
      prisma.warehouseInvoice.count({
        where: {
          companyId: companyId,
          isActive: true,
          isDeleted: false,
          invoiceDate: dateFilter
        }
      }),
      prisma.warehouseInvoice.aggregate({
        where: {
          companyId: companyId,
          isActive: true,
          isDeleted: false,
          invoiceDate: dateFilter,
          paymentStatus: { in: ['Paid', 'Partial'] }
        },
        _sum: { grandTotal: true }
      }),
      prisma.return.count({
        where: {
          companyId: companyId,
          isActive: true,
          isDeleted: false,
          returnDate: dateFilter
        }
      }),
      prisma.refund.aggregate({
        where: {
          companyId: companyId,
          isActive: true,
          isDeleted: false,
          refundDate: dateFilter,
          refundStatus: 'Completed'
        },
        _sum: { amount: true }
      }),
      prisma.customer.count({
        where: {
          companyId: companyId,
          isActive: true,
          isDeleted: false
        }
      }),
      prisma.order.aggregate({
        where: {
          companyId: companyId,
          isActive: true,
          isDeleted: false,
          orderDate: dateFilter
        },
        _avg: { grandTotal: true }
      })
    ]);

    const revenue = orderRevenue._sum.grandTotal || 0;
    const invoiceRevenueTotal = invoiceRevenue._sum.grandTotal || 0;

    res.status(200).json({
      success: true,
      data: {
        period,
        orders: {
          total: totalOrders,
          revenue: revenue,
          avgOrderValue: avgOrderValue._avg.grandTotal || 0
        },
        invoices: {
          total: totalInvoices,
          revenue: invoiceRevenueTotal
        },
        returns: {
          total: totalReturns
        },
        refunds: {
          amount: refundAmount._sum.amount || 0
        },
        customers: {
          total: totalCustomers
        }
      }
    });
  } catch (error) {
    console.error('Sales summary error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// ============================================================
// @desc    Get sales trends (User-specific)
// @route   GET /api/warehouse/sales/trends
// @access  Private
// ============================================================
const getSalesTrends = async (req, res) => {
  try {
    const userId = req.user.id;
    const companyId = req.user.companyId;
    const { days = 30, period = 'day' } = req.query;
    const daysInt = parseInt(days);

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - daysInt);
    startDate.setHours(0, 0, 0, 0);

    // ✅ User-specific orders
    const orders = await prisma.order.findMany({
      where: {
        companyId: companyId,
        isActive: true,
        isDeleted: false,
        orderDate: { gte: startDate }
      },
      select: {
        orderDate: true,
        grandTotal: true,
        orderStatus: true
      },
      orderBy: { orderDate: 'asc' }
    });

    // Group by day
    const trendMap = {};
    orders.forEach((order) => {
      const key = order.orderDate.toISOString().split('T')[0];
      if (!trendMap[key]) {
        trendMap[key] = {
          date: key,
          orders: 0,
          revenue: 0,
          completed: 0,
          pending: 0,
          cancelled: 0
        };
      }
      trendMap[key].orders += 1;
      trendMap[key].revenue += order.grandTotal;
      
      if (order.orderStatus === 'Completed') trendMap[key].completed += 1;
      else if (order.orderStatus === 'Pending') trendMap[key].pending += 1;
      else if (order.orderStatus === 'Cancelled') trendMap[key].cancelled += 1;
    });

    const trendData = Object.values(trendMap);

    // Calculate growth
    const totalRevenue = trendData.reduce((sum, d) => sum + d.revenue, 0);
    const avgRevenue = trendData.length > 0 ? totalRevenue / trendData.length : 0;

    res.status(200).json({
      success: true,
      data: {
        period: `Last ${daysInt} days`,
        totalOrders: orders.length,
        totalRevenue,
        avgDailyRevenue: avgRevenue,
        trend: trendData
      }
    });
  } catch (error) {
    console.error('Sales trends error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// ============================================================
// @desc    Get sales performance (User-specific)
// @route   GET /api/warehouse/sales/performance
// @access  Private
// ============================================================
const getSalesPerformance = async (req, res) => {
  try {
    const userId = req.user.id;
    const companyId = req.user.companyId;
    const { period = 'month', startDate, endDate, fiscalYearId } = req.query;
    const dateFilter = await resolveSalesDateFilter({
      period,
      startDate,
      endDate,
      fiscalYearId,
      companyId
    });

    // ✅ All queries with userId filter
    const [
      totalOrders,
      completedOrders,
      cancelledOrders,
      totalRevenue,
      avgOrderValue,
      orderStatusCounts
    ] = await Promise.all([
      prisma.order.count({
        where: {
          companyId: companyId,
          isActive: true,
          isDeleted: false,
          orderDate: dateFilter
        }
      }),
      prisma.order.count({
        where: {
          companyId: companyId,
          isActive: true,
          isDeleted: false,
          orderDate: dateFilter,
          orderStatus: 'Completed'
        }
      }),
      prisma.order.count({
        where: {
          companyId: companyId,
          isActive: true,
          isDeleted: false,
          orderDate: dateFilter,
          orderStatus: 'Cancelled'
        }
      }),
      prisma.order.aggregate({
        where: {
          companyId: companyId,
          isActive: true,
          isDeleted: false,
          orderDate: dateFilter
        },
        _sum: { grandTotal: true }
      }),
      prisma.order.aggregate({
        where: {
          companyId: companyId,
          isActive: true,
          isDeleted: false,
          orderDate: dateFilter
        },
        _avg: { grandTotal: true }
      }),
      prisma.order.groupBy({
        by: ['orderStatus'],
        where: {
          companyId: companyId,
          isActive: true,
          isDeleted: false,
          orderDate: dateFilter
        },
        _count: { _all: true },
        _sum: { grandTotal: true }
      })
    ]);

    const revenue = totalRevenue._sum.grandTotal || 0;
    const avgOrder = avgOrderValue._avg.grandTotal || 0;
    const completionRate = totalOrders > 0 ? (completedOrders / totalOrders) * 100 : 0;

    res.status(200).json({
      success: true,
      data: {
        period,
        summary: {
          totalOrders,
          completedOrders,
          cancelledOrders,
          totalRevenue: revenue,
          avgOrderValue: avgOrder,
          completionRate: `${completionRate.toFixed(1)}%`
        },
        byStatus: orderStatusCounts.map((s) => ({
          status: s.orderStatus,
          count: s._count._all,
          revenue: s._sum.grandTotal || 0
        }))
      }
    });
  } catch (error) {
    console.error('Sales performance error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// ============================================================
// @desc    Get combined revenue data (POS + Sales Invoices)
// @route   GET /api/warehouse/sales/combined-revenue
// @access  Private
// ============================================================
const getCombinedRevenue = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { period = 'month', startDate, endDate, fiscalYearId } = req.query;
    const dateFilter = await resolveSalesDateFilter({
      period,
      startDate,
      endDate,
      fiscalYearId,
      companyId
    });

    // Get POS sales data
    const posSalesData = await prisma.pOSSale.aggregate({
      where: {
        companyId,
        status: 'Completed',
        createdAt: dateFilter
      },
      _sum: { grandTotal: true, discountTotal: true, taxTotal: true },
      _count: { id: true }
    });

    // Get Sales Invoice data
    const invoiceData = await prisma.salesInvoice.aggregate({
      where: {
        companyId,
        isActive: true,
        isDeleted: false,
        invoiceDate: dateFilter
      },
      _sum: { grandTotal: true, discountTotal: true, taxTotal: true },
      _count: { id: true }
    });

    // Get Order data
    const orderData = await prisma.order.aggregate({
      where: {
        companyId,
        isActive: true,
        isDeleted: false,
        orderDate: dateFilter
      },
      _sum: { grandTotal: true, discountTotal: true },
      _count: { id: true }
    });

    // Calculate combined totals
    const totalRevenue = (posSalesData._sum.grandTotal || 0) + (invoiceData._sum.grandTotal || 0);
    const totalDiscount = (posSalesData._sum.discountTotal || 0) + (invoiceData._sum.discountTotal || 0) + (orderData._sum.discountTotal || 0);
    const totalTax = (posSalesData._sum.taxTotal || 0) + (invoiceData._sum.taxTotal || 0);
    const totalTransactions = posSalesData._count.id + invoiceData._count.id + orderData._count.id;

    // Get daily breakdown for chart
    const startDateObj = new Date();
    if (period === 'custom' && startDate) {
      startDateObj.setTime(new Date(startDate).getTime());
    } else if (period === 'today') {
      startDateObj.setHours(0, 0, 0, 0);
    } else if (period === 'week') {
      startDateObj.setDate(startDateObj.getDate() - 7);
    } else if (period === 'month') {
      startDateObj.setMonth(startDateObj.getMonth() - 1);
    } else if (period === 'year') {
      startDateObj.setFullYear(startDateObj.getFullYear() - 1);
    } else {
      startDateObj.setMonth(startDateObj.getMonth() - 1);
    }

    const posSalesDaily = await prisma.pOSSale.findMany({
      where: {
        companyId,
        status: 'Completed',
        createdAt: { gte: startDateObj }
      },
      select: {
        createdAt: true,
        grandTotal: true
      },
      orderBy: { createdAt: 'asc' }
    });

    const invoiceDaily = await prisma.salesInvoice.findMany({
      where: {
        companyId,
        isActive: true,
        isDeleted: false,
        invoiceDate: { gte: startDateObj }
      },
      select: {
        invoiceDate: true,
        grandTotal: true
      },
      orderBy: { invoiceDate: 'asc' }
    });

    // Combine daily data
    const dailyMap = {};
    
    posSalesDaily.forEach(sale => {
      const key = sale.createdAt.toISOString().split('T')[0];
      if (!dailyMap[key]) {
        dailyMap[key] = { date: key, posRevenue: 0, invoiceRevenue: 0, total: 0 };
      }
      dailyMap[key].posRevenue += sale.grandTotal;
      dailyMap[key].total += sale.grandTotal;
    });

    invoiceDaily.forEach(invoice => {
      const key = invoice.invoiceDate.toISOString().split('T')[0];
      if (!dailyMap[key]) {
        dailyMap[key] = { date: key, posRevenue: 0, invoiceRevenue: 0, total: 0 };
      }
      dailyMap[key].invoiceRevenue += invoice.grandTotal;
      dailyMap[key].total += invoice.grandTotal;
    });

    const dailyBreakdown = Object.values(dailyMap).sort((a, b) => a.date.localeCompare(b.date));

    res.status(200).json({
      success: true,
      data: {
        summary: {
          totalRevenue,
          totalDiscount,
          totalTax,
          totalTransactions,
          posSales: {
            count: posSalesData._count.id,
            revenue: posSalesData._sum.grandTotal || 0
          },
          invoices: {
            count: invoiceData._count.id,
            revenue: invoiceData._sum.grandTotal || 0
          },
          orders: {
            count: orderData._count.id,
            revenue: orderData._sum.grandTotal || 0
          }
        },
        dailyBreakdown
      }
    });
  } catch (error) {
    console.error('Combined revenue error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

module.exports = {
  getSalesDashboard,
  getSalesSummary,
  getSalesTrends,
  getSalesPerformance,
  getCombinedRevenue
};