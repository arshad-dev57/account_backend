// warehouse/controller/purchase_dashboard_controller.js
// Purchase Dashboard API - Multi-tenant, period-aware

const prisma = require('../../prisma/client');

// ─── HELPERS ─────────────────────────────────────────────────────────────────

const parsePeriod = (period, startDate, endDate) => {
  const now = new Date();
  let start, end, groupBy;

  switch (period) {
    case 'today':
      start = new Date(now); start.setHours(0, 0, 0, 0);
      end   = new Date(now); end.setHours(23, 59, 59, 999);
      groupBy = 'hour';
      break;
    case 'week':
      start = new Date(now); start.setDate(start.getDate() - 6); start.setHours(0, 0, 0, 0);
      end   = new Date(now); end.setHours(23, 59, 59, 999);
      groupBy = 'day';
      break;
    case 'year':
      start = new Date(now.getFullYear(), 0, 1);
      end   = new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999);
      groupBy = 'month';
      break;
    case 'custom':
      start = startDate ? new Date(startDate) : new Date(now.setDate(now.getDate() - 30));
      end   = endDate   ? new Date(endDate)   : new Date();
      end.setHours(23, 59, 59, 999);
      groupBy = 'day';
      break;
    default: // month
      start = new Date(now.getFullYear(), now.getMonth(), 1);
      end   = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
      groupBy = 'week';
  }

  return { start, end, groupBy };
};

const getLabelFromDate = (dateStr, groupBy) => {
  const d = new Date(dateStr);
  if (groupBy === 'hour')  return `${d.getHours()}:00`;
  if (groupBy === 'month') return d.toLocaleString('default', { month: 'short' });
  // day / week
  return d.toISOString().split('T')[0];
};

const getColorForIndex = (i) => {
  const colors = ['#4361EE', '#F4A228', '#9B59B6', '#2DC653', '#EF4444', '#00B4D8'];
  return colors[i % colors.length];
};

// ─── METRICS ─────────────────────────────────────────────────────────────────
// GET /api/purchase/dashboard/metrics
const getMetrics = async (req, res) => {
  try {
    const userId = req.user.id;
    const { period = 'month', startDate, endDate } = req.query;
    const { start, end } = parsePeriod(period, startDate, endDate);

    const dateFilter = { gte: start, lte: end };

    const [
      totalOrders,
      approvedOrders,
      draftOrders,
      sentOrders,
      cancelledOrders,
      receivedOrders,
      totalInvoices,
      paidInvoices,
      unpaidInvoices,
      totalReturns,
      totalPayments,
    ] = await Promise.all([
      // Purchase Orders
      prisma.purchaseOrder.count({ where: { userId, createdAt: dateFilter } }),
      prisma.purchaseOrder.aggregate({ where: { userId, status: 'approved', createdAt: dateFilter }, _sum: { grandTotal: true }, _count: true }),
      prisma.purchaseOrder.count({ where: { userId, status: 'draft', createdAt: dateFilter } }),
      prisma.purchaseOrder.count({ where: { userId, status: 'sent', createdAt: dateFilter } }),
      prisma.purchaseOrder.count({ where: { userId, status: { in: ['cancelled', 'rejected'] }, createdAt: dateFilter } }),
      prisma.purchaseOrder.count({ where: { userId, status: 'received', createdAt: dateFilter } }),
      // Purchase Invoices
      prisma.purchaseInvoice.count({ where: { userId, invoiceDate: dateFilter } }),
      prisma.purchaseInvoice.aggregate({ where: { userId, paymentStatus: 'paid', invoiceDate: dateFilter }, _sum: { grandTotal: true } }),
      prisma.purchaseInvoice.aggregate({ where: { userId, paymentStatus: { in: ['unpaid', 'partial'] }, invoiceDate: dateFilter }, _sum: { grandTotal: true } }),
      // Returns & Payments
      prisma.purchaseReturn.count({ where: { userId, createdAt: dateFilter } }),
      prisma.purchasePaymentMake.aggregate({ where: { userId, paymentDate: dateFilter }, _sum: { amount: true } }),
    ]);

    // Total spend = sum of grandTotal from all purchase invoices
    const totalSpend = await prisma.purchaseInvoice.aggregate({
      where: { userId, invoiceDate: dateFilter },
      _sum: { grandTotal: true },
    });

    res.json({
      success: true,
      data: {
        orders: {
          total: totalOrders,
          approved: approvedOrders._count,
          approvedValue: approvedOrders._sum.grandTotal || 0,
          draft: draftOrders,
          sent: sentOrders,
          received: receivedOrders,
          cancelled: cancelledOrders,
        },
        invoices: {
          total: totalInvoices,
          paid: paidInvoices._count || 0,
          paidAmount: paidInvoices._sum.grandTotal || 0,
          outstanding: unpaidInvoices._sum.grandTotal || 0,
          totalSpend: totalSpend._sum.grandTotal || 0,
        },
        returns: { total: totalReturns },
        payments: { totalPaid: totalPayments._sum.amount || 0 },
      },
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
    const { period = 'month', startDate, endDate } = req.query;
    const { start, end, groupBy } = parsePeriod(period, startDate, endDate);

    const invoices = await prisma.purchaseInvoice.findMany({
      where: { userId, invoiceDate: { gte: start, lte: end } },
      select: { invoiceDate: true, grandTotal: true, paymentStatus: true },
      orderBy: { invoiceDate: 'asc' },
    });

    const orders = await prisma.purchaseOrder.findMany({
      where: { userId, createdAt: { gte: start, lte: end } },
      select: { createdAt: true, grandTotal: true },
      orderBy: { createdAt: 'asc' },
    });

    // Group by day/week/month
    const invoiceMap = {};
    invoices.forEach((inv) => {
      const key = inv.invoiceDate.toISOString().split('T')[0];
      if (!invoiceMap[key]) invoiceMap[key] = { date: key, invoiceAmount: 0, paidAmount: 0 };
      invoiceMap[key].invoiceAmount += inv.grandTotal || 0;
      if (inv.paymentStatus === 'paid') invoiceMap[key].paidAmount += inv.grandTotal || 0;
    });

    const orderMap = {};
    orders.forEach((ord) => {
      const key = ord.createdAt.toISOString().split('T')[0];
      if (!orderMap[key]) orderMap[key] = { date: key, orderValue: 0 };
      orderMap[key].orderValue += ord.grandTotal || 0;
    });

    const allDates = [...new Set([...Object.keys(invoiceMap), ...Object.keys(orderMap)])].sort();

    const trend = allDates.map((date) => ({
      date,
      label: getLabelFromDate(date, groupBy),
      invoiceAmount: invoiceMap[date]?.invoiceAmount || 0,
      paidAmount: invoiceMap[date]?.paidAmount || 0,
      orderValue: orderMap[date]?.orderValue || 0,
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
    const { period = 'month', startDate, endDate } = req.query;
    const { start, end } = parsePeriod(period, startDate, endDate);

    const statuses = ['draft', 'sent', 'approved', 'received', 'cancelled', 'rejected'];
    const results = await Promise.all(
      statuses.map(async (status, i) => {
        const agg = await prisma.purchaseOrder.aggregate({
          where: { userId, status, createdAt: { gte: start, lte: end } },
          _count: true,
          _sum: { grandTotal: true },
        });
        return {
          status,
          count: agg._count || 0,
          value: agg._sum.grandTotal || 0,
          color: getColorForIndex(i),
        };
      })
    );

    res.json({ success: true, data: results.filter((r) => r.count > 0) });
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
    const { period = 'month', startDate, endDate } = req.query;
    const { start, end } = parsePeriod(period, startDate, endDate);

    const orders = await prisma.purchaseOrder.groupBy({
      by: ['supplierId', 'supplierName'],
      where: { userId, createdAt: { gte: start, lte: end } },
      _sum: { grandTotal: true },
      _count: true,
      orderBy: { _sum: { grandTotal: 'desc' } },
      take: 5,
    });

    const suppliers = orders.map((o, i) => ({
      supplierId: o.supplierId,
      supplierName: o.supplierName || 'Unknown',
      totalOrders: o._count,
      totalValue: o._sum.grandTotal || 0,
      color: getColorForIndex(i),
    }));

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

    const [recentOrders, recentInvoices, recentReturns] = await Promise.all([
      prisma.purchaseOrder.findMany({
        where: { userId },
        select: { id: true, orderNumber: true, supplierName: true, grandTotal: true, status: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: 4,
      }),
      prisma.purchaseInvoice.findMany({
        where: { userId },
        select: { id: true, invoiceNumber: true, supplierName: true, grandTotal: true, paymentStatus: true, invoiceDate: true },
        orderBy: { invoiceDate: 'desc' },
        take: 3,
      }),
      prisma.purchaseReturn.findMany({
        where: { userId },
        select: { id: true, returnNumber: true, supplierName: true, totalAmount: true, status: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: 2,
      }),
    ]);

    const activities = [
      ...recentOrders.map((o) => ({
        id: o.id,
        type: 'order',
        action: `Purchase Order ${o.orderNumber}`,
        details: `${o.supplierName} • ${o.status}`,
        amount: o.grandTotal,
        createdAt: o.createdAt.toISOString(),
      })),
      ...recentInvoices.map((inv) => ({
        id: inv.id,
        type: 'invoice',
        action: `Invoice ${inv.invoiceNumber}`,
        details: `${inv.supplierName} • ${inv.paymentStatus}`,
        amount: inv.grandTotal,
        createdAt: inv.invoiceDate.toISOString(),
      })),
      ...recentReturns.map((r) => ({
        id: r.id,
        type: 'return',
        action: `Return ${r.returnNumber}`,
        details: `${r.supplierName} • ${r.status}`,
        amount: r.totalAmount,
        createdAt: r.createdAt.toISOString(),
      })),
    ]
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, 8);

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
  getRecentActivities,
};
