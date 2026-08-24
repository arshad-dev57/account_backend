// warehouse/controller/purchase_dashboard_controller.js
// Purchase Dashboard API — company-scoped, case-tolerant statuses

const prisma = require('../../prisma/client');
const { applyFiscalYearWindow } = require('../../utils/fiscalYearHelper');

// ─── HELPERS ─────────────────────────────────────────────────────────────────

const parsePeriod = async (period, startDate, endDate, opts = {}) => {
  const now = new Date();
  let start;
  let end;
  let groupBy;

  switch (String(period || 'month').toLowerCase()) {
    case 'today':
    case 'today':
      start = new Date(now);
      start.setHours(0, 0, 0, 0);
      end = new Date(now);
      end.setHours(23, 59, 59, 999);
      groupBy = 'hour';
      break;
    case 'week':
    case 'last_week':
      start = new Date(now);
      start.setDate(start.getDate() - 6);
      start.setHours(0, 0, 0, 0);
      end = new Date(now);
      end.setHours(23, 59, 59, 999);
      groupBy = 'day';
      break;
    case 'last_month': {
      start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      end = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
      groupBy = 'week';
      break;
    }
    case 'quarter':
    case 'this_quarter': {
      const q = Math.floor(now.getMonth() / 3);
      start = new Date(now.getFullYear(), q * 3, 1);
      end = new Date(now.getFullYear(), q * 3 + 3, 0, 23, 59, 59, 999);
      groupBy = 'month';
      break;
    }
    case 'year':
      start = new Date(now.getFullYear(), 0, 1);
      end = new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999);
      groupBy = 'month';
      break;
    case 'custom':
      start = startDate
        ? new Date(startDate)
        : new Date(now.getFullYear(), now.getMonth(), now.getDate() - 30);
      end = endDate ? new Date(endDate) : new Date();
      end.setHours(23, 59, 59, 999);
      groupBy = 'day';
      break;
    default: // month
      start = new Date(now.getFullYear(), now.getMonth(), 1);
      end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
      groupBy = 'week';
  }

  if (opts.fiscalYearId && opts.companyId) {
    const clamped = await applyFiscalYearWindow({
      companyId: opts.companyId,
      fiscalYearId: opts.fiscalYearId,
      start,
      end,
      period: String(period || '').toLowerCase() === 'year' ? 'This Year' : period
    });
    return { start: clamped.start, end: clamped.end, groupBy };
  }

  return { start, end, groupBy };
};

const companyScope = (companyId, userId) => {
  if (companyId) {
    return {
      OR: [{ companyId }, { companyId: null, createdBy: userId }]
    };
  }
  return { createdBy: userId };
};

const baseWhere = (companyId, userId, extra = {}) => ({
  AND: [
    companyScope(companyId, userId),
    { isActive: true },
    { isDeleted: false },
    extra,
  ]
});

/** POs: selected store, or company-wide (no location set) */
function purchaseOrderLocationWhere(locationId) {
  if (!locationId) return {};
  const loc = String(locationId);
  return {
    OR: [{ locationId: loc }, { locationId: null }],
  };
}

/** Invoices: own location, unscoped, or via PO / GRN */
function purchaseInvoiceLocationWhere(locationId) {
  if (!locationId) return {};
  const loc = String(locationId);
  return {
    OR: [
      { locationId: loc },
      { locationId: null },
      { purchaseOrder: { locationId: loc } },
      { goodsReceiving: { locationId: loc } },
    ],
  };
}

/** Purchase returns via linked invoice / PO / GRN */
function purchaseReturnLocationWhere(locationId) {
  if (!locationId) return {};
  const loc = String(locationId);
  return {
    purchaseInvoice: {
      OR: [
        { locationId: loc },
        { locationId: null },
        { purchaseOrder: { locationId: loc } },
        { goodsReceiving: { locationId: loc } },
      ],
    },
  };
}

/** Payments via linked purchase invoices */
function purchasePaymentLocationWhere(locationId) {
  if (!locationId) return {};
  const loc = String(locationId);
  return {
    OR: [
      { invoicePayments: { none: {} } },
      {
        invoicePayments: {
          some: {
            invoice: {
              OR: [
                { locationId: loc },
                { locationId: null },
                { purchaseOrder: { locationId: loc } },
                { goodsReceiving: { locationId: loc } },
              ],
            },
          },
        },
      },
    ],
  };
}

const getLabelFromDate = (dateStr, groupBy) => {
  const d = new Date(dateStr);
  if (groupBy === 'hour') return `${d.getHours()}:00`;
  if (groupBy === 'month') return d.toLocaleString('default', { month: 'short' });
  return d.toISOString().split('T')[0];
};

const getColorForIndex = (i) => {
  const colors = ['#014582', '#F4A228', '#9B59B6', '#2DC653', '#EF4444', '#00B4D8'];
  return colors[i % colors.length];
};

const toNum = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const isPaidStatus = (s) => String(s || '').toLowerCase() === 'paid';
const isPartialStatus = (s) => {
  const v = String(s || '').toLowerCase();
  return v === 'partial' || v === 'partially paid';
};
const isUnpaidStatus = (s) => {
  const v = String(s || '').toLowerCase();
  return v === 'unpaid' || v === 'draft' || v === '';
};

const normalizeOrderStatus = (s) => {
  const v = String(s || '').toLowerCase();
  if (v === 'approved' || v === 'confirm' || v === 'confirmed') return 'approved';
  if (v === 'sent' || v === 'submitted') return 'sent';
  if (
    v === 'received' ||
    v === 'partially received' ||
    v === 'fully received' ||
    v === 'completed' ||
    v === 'closed'
  ) {
    return 'received';
  }
  if (v === 'cancelled' || v === 'canceled' || v === 'rejected') return 'cancelled';
  if (v === 'draft') return 'draft';
  return v || 'draft';
};

// ─── METRICS ─────────────────────────────────────────────────────────────────
// GET /api/purchase/dashboard/metrics
const getMetrics = async (req, res) => {
  try {
    const userId = req.user.id;
    const companyId = req.user.companyId;
    const { period = 'month', startDate, endDate, fiscalYearId, locationId } = req.query;
    const { start, end } = await parsePeriod(period, startDate, endDate, {
      companyId,
      fiscalYearId
    });

    const orderWhere = baseWhere(companyId, userId, {
      createdAt: { gte: start, lte: end },
      ...purchaseOrderLocationWhere(locationId),
    });
    const invoiceWhere = baseWhere(companyId, userId, {
      invoiceDate: { gte: start, lte: end },
      invoiceStatus: { notIn: ['Cancelled'] },
      ...purchaseInvoiceLocationWhere(locationId),
    });
    const returnWhere = baseWhere(companyId, userId, {
      createdAt: { gte: start, lte: end },
      ...purchaseReturnLocationWhere(locationId),
    });
    const paymentWhere = baseWhere(companyId, userId, {
      paymentDate: { gte: start, lte: end },
      status: { not: 'Cancelled' },
      ...purchasePaymentLocationWhere(locationId),
    });

    const [orders, invoices, returnsRows, paymentsAgg] = await Promise.all([
      prisma.purchaseOrder.findMany({
        where: orderWhere,
        select: { status: true, grandTotal: true }
      }),
      prisma.purchaseInvoice.findMany({
        where: invoiceWhere,
        select: {
          paymentStatus: true,
          invoiceStatus: true,
          grandTotal: true,
          paidAmount: true,
          outstanding: true
        }
      }),
      prisma.purchaseReturn.findMany({
        where: {
          ...returnWhere,
          status: 'Processed'
        },
        select: { grandTotal: true }
      }),
      prisma.purchasePaymentMake.aggregate({
        where: paymentWhere,
        _sum: { amount: true }
      }),
    ]);

    const returnsCount = returnsRows.length;
    const returnsAmount = returnsRows.reduce(
      (s, r) => s + toNum(r.grandTotal),
      0
    );

    const orderStats = {
      total: orders.length,
      approved: 0,
      approvedValue: 0,
      draft: 0,
      sent: 0,
      received: 0,
      cancelled: 0
    };

    orders.forEach((o) => {
      const status = normalizeOrderStatus(o.status);
      const value = toNum(o.grandTotal);
      if (status === 'approved') {
        orderStats.approved += 1;
        orderStats.approvedValue += value;
      } else if (status === 'draft') orderStats.draft += 1;
      else if (status === 'sent') orderStats.sent += 1;
      else if (status === 'received') orderStats.received += 1;
      else if (status === 'cancelled') orderStats.cancelled += 1;
    });

    let paidCount = 0;
    let paidAmount = 0;
    let outstanding = 0;
    let totalSpend = 0;

    invoices.forEach((inv) => {
      const total = toNum(inv.grandTotal);
      totalSpend += total;
      const pay = String(inv.paymentStatus || '');
      if (isPaidStatus(pay) || isPaidStatus(inv.invoiceStatus)) {
        paidCount += 1;
        paidAmount += toNum(inv.paidAmount) || total;
      } else {
        const due =
          toNum(inv.outstanding) > 0
            ? toNum(inv.outstanding)
            : Math.max(0, total - toNum(inv.paidAmount));
        outstanding += due;
        if (isPartialStatus(pay)) {
          paidAmount += toNum(inv.paidAmount);
        }
      }
    });

    const netSpend = Math.max(0, totalSpend - returnsAmount);

    res.json({
      success: true,
      data: {
        orders: orderStats,
        invoices: {
          total: invoices.length,
          paid: paidCount,
          paidAmount,
          outstanding,
          totalSpend: netSpend,
          grossSpend: totalSpend
        },
        returns: { total: returnsCount, amount: returnsAmount },
        payments: { totalPaid: toNum(paymentsAgg._sum.amount) },
        period: { start, end, key: period }
      }
    });
  } catch (err) {
    console.error('Purchase dashboard metrics error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── SPEND TREND CHART ───────────────────────────────────────────────────────
// GET /api/purchase/dashboard/charts/spend-trend
const getSpendTrend = async (req, res) => {
  try {
    const userId = req.user.id;
    const companyId = req.user.companyId;
    const { period = 'month', startDate, endDate, fiscalYearId, locationId } = req.query;
    const { start, end, groupBy } = await parsePeriod(period, startDate, endDate, {
      companyId,
      fiscalYearId
    });

    const [invoices, orders] = await Promise.all([
      prisma.purchaseInvoice.findMany({
        where: baseWhere(companyId, userId, {
          invoiceDate: { gte: start, lte: end },
          ...purchaseInvoiceLocationWhere(locationId),
        }),
        select: {
          invoiceDate: true,
          grandTotal: true,
          paidAmount: true,
          paymentStatus: true
        },
        orderBy: { invoiceDate: 'asc' }
      }),
      prisma.purchaseOrder.findMany({
        where: baseWhere(companyId, userId, {
          createdAt: { gte: start, lte: end },
          ...purchaseOrderLocationWhere(locationId),
        }),
        select: { createdAt: true, grandTotal: true },
        orderBy: { createdAt: 'asc' }
      }),
    ]);

    const invoiceMap = {};
    invoices.forEach((inv) => {
      const key = inv.invoiceDate.toISOString().split('T')[0];
      if (!invoiceMap[key]) {
        invoiceMap[key] = { date: key, invoiceAmount: 0, paidAmount: 0 };
      }
      invoiceMap[key].invoiceAmount += toNum(inv.grandTotal);
      if (isPaidStatus(inv.paymentStatus)) {
        invoiceMap[key].paidAmount += toNum(inv.paidAmount) || toNum(inv.grandTotal);
      } else {
        invoiceMap[key].paidAmount += toNum(inv.paidAmount);
      }
    });

    const orderMap = {};
    orders.forEach((ord) => {
      const key = ord.createdAt.toISOString().split('T')[0];
      if (!orderMap[key]) orderMap[key] = { date: key, orderValue: 0 };
      orderMap[key].orderValue += toNum(ord.grandTotal);
    });

    const allDates = [
      ...new Set([...Object.keys(invoiceMap), ...Object.keys(orderMap)]),
    ].sort();

    const trend = allDates.map((date) => ({
      date,
      label: getLabelFromDate(date, groupBy),
      invoiceAmount: invoiceMap[date]?.invoiceAmount || 0,
      paidAmount: invoiceMap[date]?.paidAmount || 0,
      orderValue: orderMap[date]?.orderValue || 0
    }));

    res.json({ success: true, data: trend });
  } catch (err) {
    console.error('Purchase spend trend error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── ORDER STATUS DISTRIBUTION ────────────────────────────────────────────────
// GET /api/purchase/dashboard/charts/order-status
const getOrderStatusDistribution = async (req, res) => {
  try {
    const userId = req.user.id;
    const companyId = req.user.companyId;
    const { period = 'month', startDate, endDate, fiscalYearId, locationId } = req.query;
    const { start, end } = await parsePeriod(period, startDate, endDate, {
      companyId,
      fiscalYearId
    });

    const orders = await prisma.purchaseOrder.findMany({
      where: baseWhere(companyId, userId, {
        createdAt: { gte: start, lte: end },
        ...purchaseOrderLocationWhere(locationId),
      }),
      select: { status: true, grandTotal: true }
    });

    const bucket = {
      draft: { status: 'draft', count: 0, value: 0, color: getColorForIndex(0) },
      sent: { status: 'sent', count: 0, value: 0, color: getColorForIndex(1) },
      approved: {
        status: 'approved',
        count: 0,
        value: 0,
        color: getColorForIndex(2)
      },
      received: {
        status: 'received',
        count: 0,
        value: 0,
        color: getColorForIndex(3)
      },
      cancelled: {
        status: 'cancelled',
        count: 0,
        value: 0,
        color: getColorForIndex(4)
      }
    };

    orders.forEach((o) => {
      const key = normalizeOrderStatus(o.status);
      const target = bucket[key] || bucket.draft;
      target.count += 1;
      target.value += toNum(o.grandTotal);
    });

    res.json({
      success: true,
      data: Object.values(bucket).filter((r) => r.count > 0)
    });
  } catch (err) {
    console.error('Purchase order status error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── TOP SUPPLIERS ────────────────────────────────────────────────────────────
// GET /api/purchase/dashboard/charts/top-suppliers
const getTopSuppliers = async (req, res) => {
  try {
    const userId = req.user.id;
    const companyId = req.user.companyId;
    const { period = 'month', startDate, endDate, fiscalYearId, locationId } = req.query;
    const { start, end } = await parsePeriod(period, startDate, endDate, {
      companyId,
      fiscalYearId
    });

    // Prefer invoices (actual spend); fall back to orders if none
    const invoices = await prisma.purchaseInvoice.findMany({
      where: baseWhere(companyId, userId, {
        invoiceDate: { gte: start, lte: end },
        ...purchaseInvoiceLocationWhere(locationId),
      }),
      select: { supplierId: true, supplierName: true, grandTotal: true }
    });

    const map = {};
    invoices.forEach((inv) => {
      const id = inv.supplierId || inv.supplierName || 'unknown';
      if (!map[id]) {
        map[id] = {
          supplierId: inv.supplierId,
          supplierName: inv.supplierName || 'Unknown',
          totalOrders: 0,
          totalValue: 0
        };
      }
      map[id].totalOrders += 1;
      map[id].totalValue += toNum(inv.grandTotal);
    });

    if (Object.keys(map).length === 0) {
      const orders = await prisma.purchaseOrder.findMany({
        where: baseWhere(companyId, userId, {
          createdAt: { gte: start, lte: end },
          ...purchaseOrderLocationWhere(locationId),
        }),
        select: { supplierId: true, supplierName: true, grandTotal: true }
      });
      orders.forEach((o) => {
        const id = o.supplierId || o.supplierName || 'unknown';
        if (!map[id]) {
          map[id] = {
            supplierId: o.supplierId,
            supplierName: o.supplierName || 'Unknown',
            totalOrders: 0,
            totalValue: 0
          };
        }
        map[id].totalOrders += 1;
        map[id].totalValue += toNum(o.grandTotal);
      });
    }

    const suppliers = Object.values(map)
      .sort((a, b) => b.totalValue - a.totalValue)
      .slice(0, 5)
      .map((s, i) => ({ ...s, color: getColorForIndex(i) }));

    res.json({ success: true, data: suppliers });
  } catch (err) {
    console.error('Top suppliers error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── RECENT PURCHASE ACTIVITIES ───────────────────────────────────────────────
// GET /api/purchase/dashboard/activities
const getRecentActivities = async (req, res) => {
  try {
    const userId = req.user.id;
    const companyId = req.user.companyId;
    const { locationId } = req.query;
    const scope = baseWhere(companyId, userId, purchaseOrderLocationWhere(locationId));
    const invoiceScope = baseWhere(
      companyId,
      userId,
      purchaseInvoiceLocationWhere(locationId)
    );
    const returnScope = baseWhere(
      companyId,
      userId,
      purchaseReturnLocationWhere(locationId)
    );
    const paymentScope = {
      AND: [
        companyScope(companyId, userId),
        { isActive: true },
        { isDeleted: false },
        purchasePaymentLocationWhere(locationId),
      ],
    };

    const [recentOrders, recentInvoices, recentReturns, recentPayments] =
      await Promise.all([
        prisma.purchaseOrder.findMany({
          where: scope,
          select: {
            id: true,
            orderNumber: true,
            supplierName: true,
            grandTotal: true,
            status: true,
            createdAt: true
          },
          orderBy: { createdAt: 'desc' },
          take: 5
        }),
        prisma.purchaseInvoice.findMany({
          where: invoiceScope,
          select: {
            id: true,
            invoiceNumber: true,
            supplierName: true,
            grandTotal: true,
            paymentStatus: true,
            invoiceDate: true,
            createdAt: true
          },
          orderBy: { createdAt: 'desc' },
          take: 5
        }),
        prisma.purchaseReturn.findMany({
          where: returnScope,
          select: {
            id: true,
            returnNumber: true,
            supplierName: true,
            grandTotal: true,
            returnAmount: true,
            status: true,
            createdAt: true
          },
          orderBy: { createdAt: 'desc' },
          take: 3
        }),
        prisma.purchasePaymentMake.findMany({
          where: paymentScope,
          select: {
            id: true,
            paymentNumber: true,
            supplierName: true,
            amount: true,
            status: true,
            paymentDate: true,
            createdAt: true
          },
          orderBy: { createdAt: 'desc' },
          take: 5
        }),
      ]);

    const activities = [
      ...recentOrders.map((o) => ({
        id: o.id,
        type: 'order',
        action: `Purchase Order ${o.orderNumber}`,
        details: `${o.supplierName} • ${o.status}`,
        amount: toNum(o.grandTotal),
        createdAt: o.createdAt.toISOString()
      })),
      ...recentInvoices.map((inv) => ({
        id: inv.id,
        type: 'invoice',
        action: `Invoice ${inv.invoiceNumber}`,
        details: `${inv.supplierName} • ${inv.paymentStatus}`,
        amount: toNum(inv.grandTotal),
        createdAt: (inv.createdAt || inv.invoiceDate).toISOString()
      })),
      ...recentReturns.map((r) => ({
        id: r.id,
        type: 'return',
        action: `Return ${r.returnNumber}`,
        details: `${r.supplierName} • ${r.status}`,
        amount: toNum(r.grandTotal) || toNum(r.returnAmount),
        createdAt: r.createdAt.toISOString()
      })),
      ...recentPayments.map((p) => ({
        id: p.id,
        type: 'payment',
        action: `Payment ${p.paymentNumber}`,
        details: `${p.supplierName} • ${p.status}`,
        amount: toNum(p.amount),
        createdAt: (p.createdAt || p.paymentDate).toISOString()
      })),
    ]
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, 10);

    res.json({ success: true, data: { activities } });
  } catch (err) {
    console.error('Purchase activities error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = {
  getMetrics,
  getSpendTrend,
  getOrderStatusDistribution,
  getTopSuppliers,
  getRecentActivities
};
