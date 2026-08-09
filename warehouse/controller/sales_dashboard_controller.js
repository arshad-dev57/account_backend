// warehouse/controller/sales_dashboard_controller.js - MULTI-TENANT VERSION

const prisma = require('../../prisma/client');

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
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
  // Handle custom date range
  if (period === 'custom' && startDate && endDate) {
    const start = new Date(startDate);
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999); // Include end date fully
    return { gte: start, lte: end };
  }

  const now = new Date();
  let start = new Date(now);
  
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
};

// ─── GET ORDER TREND ──────────────────────────────────────
const getOrderTrend = async (userId, companyId, dateFilter, days = 30) => {
  const trendData = await prisma.order.findMany({
    where: {
      companyId: companyId, // 👈 User-specific
      isActive: true,
      isDeleted: false,
      orderDate: dateFilter
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

// ─── GET INVOICE STATS ────────────────────────────────────
const getInvoiceStats = async (userId, companyId, dateFilter) => {
  const baseWhere = {
    companyId,
    isActive: true,
    isDeleted: false,
    ...(dateFilter ? { invoiceDate: dateFilter } : {}),
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
        grandTotal: true,
        paidAmount: true,
        outstanding: true,
        paymentStatus: true,
        invoiceStatus: true,
      },
    }),
    prisma.salesInvoice.findMany({
      where: {
        ...baseWhere,
        invoiceStatus: { notIn: ['Draft', 'Cancelled'] },
      },
      select: {
        id: true,
        orderId: true,
        grandTotal: true,
        paidAmount: true,
        outstanding: true,
        paymentStatus: true,
        invoiceStatus: true,
      },
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
    outstanding,
  };
};

// ─── GET INVOICE TREND ────────────────────────────────────
const getInvoiceTrend = async (userId, companyId, days = 30) => {
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
      },
      select: {
        orderId: true,
        invoiceDate: true,
        grandTotal: true,
        paidAmount: true,
        outstanding: true,
        paymentStatus: true,
        invoiceStatus: true,
      },
      orderBy: { invoiceDate: 'asc' },
    }),
    prisma.salesInvoice.findMany({
      where: {
        companyId,
        isActive: true,
        isDeleted: false,
        invoiceDate: dateFilter,
        invoiceStatus: { notIn: ['Draft', 'Cancelled'] },
      },
      select: {
        orderId: true,
        invoiceDate: true,
        grandTotal: true,
        paidAmount: true,
        outstanding: true,
        paymentStatus: true,
        invoiceStatus: true,
      },
      orderBy: { invoiceDate: 'asc' },
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
        count: 0,
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
const getReturnStats = async (userId, companyId, period) => {
  const dateFilter = getDateFilter(period);

  const [total, pending, approved, rejected, completed] = await Promise.all([
    prisma.return.count({
      where: {
        companyId: companyId, // 👈 User-specific
        isActive: true,
        isDeleted: false,
        returnDate: dateFilter
      }
    }),
    prisma.return.count({
      where: {
        companyId: companyId,
        isActive: true,
        isDeleted: false,
        returnDate: dateFilter,
        returnStatus: 'Pending'
      }
    }),
    prisma.return.count({
      where: {
        companyId: companyId,
        isActive: true,
        isDeleted: false,
        returnDate: dateFilter,
        returnStatus: 'Approved'
      }
    }),
    prisma.return.count({
      where: {
        companyId: companyId,
        isActive: true,
        isDeleted: false,
        returnDate: dateFilter,
        returnStatus: 'Rejected'
      }
    }),
    prisma.return.count({
      where: {
        companyId: companyId,
        isActive: true,
        isDeleted: false,
        returnDate: dateFilter,
        returnStatus: 'Completed'
      }
    })
  ]);

  const refundAmount = await prisma.return.aggregate({
    where: {
      companyId: companyId,
      isActive: true,
      isDeleted: false,
      returnDate: dateFilter
    },
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
const getCreditNoteStats = async (userId, companyId, period) => {
  const dateFilter = getDateFilter(period);
  const baseWhere = {
    companyId,
    date: dateFilter,
    status: { notIn: ['Voided', 'Cancelled', 'Expired'] },
  };

  const [total, issued, partiallyApplied, fullyApplied, amounts] =
    await Promise.all([
      prisma.creditNote.count({ where: baseWhere }),
      prisma.creditNote.count({
        where: { ...baseWhere, status: 'Issued' },
      }),
      prisma.creditNote.count({
        where: { ...baseWhere, status: 'PartiallyApplied' },
      }),
      prisma.creditNote.count({
        where: { ...baseWhere, status: 'Applied' },
      }),
      prisma.creditNote.aggregate({
        where: baseWhere,
        _sum: {
          amount: true,
          appliedAmount: true,
          remainingAmount: true,
        },
      }),
    ]);

  return {
    total,
    issued,
    partiallyApplied,
    fullyApplied,
    creditAmount: amounts._sum.amount || 0,
    appliedAmount: amounts._sum.appliedAmount || 0,
    remainingAmount: amounts._sum.remainingAmount || 0,
  };
};

// ─── GET REFUND STATS ─────────────────────────────────────
const getRefundStats = async (userId, companyId, period) => {
  const dateFilter = getDateFilter(period);

  const [total, pending, completed, failed] = await Promise.all([
    prisma.refund.count({
      where: {
        companyId: companyId, // 👈 User-specific
        isActive: true,
        isDeleted: false,
        refundDate: dateFilter
      }
    }),
    prisma.refund.count({
      where: {
        companyId: companyId,
        isActive: true,
        isDeleted: false,
        refundDate: dateFilter,
        refundStatus: 'Pending'
      }
    }),
    prisma.refund.count({
      where: {
        companyId: companyId,
        isActive: true,
        isDeleted: false,
        refundDate: dateFilter,
        refundStatus: 'Completed'
      }
    }),
    prisma.refund.count({
      where: {
        companyId: companyId,
        isActive: true,
        isDeleted: false,
        refundDate: dateFilter,
        refundStatus: 'Failed'
      }
    })
  ]);

  const refundAmount = await prisma.refund.aggregate({
    where: {
      companyId: companyId,
      isActive: true,
      isDeleted: false,
      refundDate: dateFilter,
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

// ─── GET TOP PRODUCTS ─────────────────────────────────────
const getTopProducts = async (userId, companyId, period, limit = 10) => {
  const dateFilter = getDateFilter(period);

  const topProducts = await prisma.orderItem.groupBy({
    by: ['productId', 'productName', 'sku'],
    where: {
      order: {
        companyId: companyId, // 👈 User-specific
        isActive: true,
        isDeleted: false,
        orderDate: dateFilter
      }
    },
    _count: {
      id: true
    },
    _sum: {
      quantity: true,
      totalPrice: true
    },
    orderBy: {
      _sum: {
        totalPrice: 'desc'
      }
    },
    take: limit
  });

  return topProducts.map(item => ({
    productId: item.productId,
    productName: item.productName,
    sku: item.sku,
    quantity: item._sum.quantity || 0,
    revenue: item._sum.totalPrice || 0,
    orderCount: item._count.id
  }));
};

// ─── GET CUSTOMER STATS ──────────────────────────────────
const getCustomerStats = async (userId, companyId, period) => {
  const dateFilter = getDateFilter(period);

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
    const dateFilter = getDateFilter(period, startDate, endDate);

    // ─── ORDERS ──────────────────────────────────────────────
    const orderFilter = {
      companyId: companyId,
      isActive: true,
      isDeleted: false,
      orderDate: dateFilter
    };

    const [orderCount, orderRevenue, orderStatusCounts, orderTrend] = await Promise.all([
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
      getOrderTrend(userId, companyId, dateFilter)
    ]);

    // ─── INVOICES ─────────────────────────────────────────────
    const [invoiceStats, invoiceTrend] = await Promise.all([
      getInvoiceStats(userId, companyId, dateFilter),
      getInvoiceTrend(userId, companyId),
    ]);

    // ─── RETURNS ──────────────────────────────────────────────
    const returnStats = await getReturnStats(userId, companyId, period);

    // ─── REFUNDS ──────────────────────────────────────────────
    const refundStats = await getRefundStats(userId, companyId, period);

    // ─── SALES CREDITS (CREDIT NOTES) ─────────────────────────
    const creditNoteStats = await getCreditNoteStats(userId, companyId, period);

    // ─── TOP PRODUCTS ─────────────────────────────────────────
    const topProducts = await getTopProducts(userId, companyId, period);

    // ─── CUSTOMER STATS ──────────────────────────────────────
    const customerStats = await getCustomerStats(userId, companyId, period);

    // ─── SUMMARY STATS ───────────────────────────────────────
    const summary = {
      totalOrders: orderCount,
      totalRevenue: orderRevenue._sum.grandTotal || 0,
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
    
    const [todaySalesAgg, yesterdaySalesAgg] = await Promise.all([
      prisma.order.aggregate({
        where: {
          companyId: companyId,
          isActive: true,
          isDeleted: false,
          orderDate: { gte: todayStart }
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
          }
        },
        _sum: { grandTotal: true }
      })
    ]);
    
    const todaySales = todaySalesAgg._sum.grandTotal || 0;
    const yesterdaySales = yesterdaySalesAgg._sum.grandTotal || 0;
    const todaySalesChange = yesterdaySales > 0 
      ? ((todaySales - yesterdaySales) / yesterdaySales) * 100 
      : 0;
    
    // This Week's data
    const weekStart = new Date(now);
    weekStart.setDate(weekStart.getDate() - 7);
    weekStart.setHours(0, 0, 0, 0);
    const lastWeekStart = new Date(weekStart);
    lastWeekStart.setDate(lastWeekStart.getDate() - 7);
    
    const [weekSalesAgg, lastWeekSalesAgg] = await Promise.all([
      prisma.order.aggregate({
        where: {
          companyId: companyId,
          isActive: true,
          isDeleted: false,
          orderDate: { gte: weekStart }
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
          }
        },
        _sum: { grandTotal: true }
      })
    ]);
    
    const weekSales = weekSalesAgg._sum.grandTotal || 0;
    const lastWeekSales = lastWeekSalesAgg._sum.grandTotal || 0;
    const weekSalesChange = lastWeekSales > 0 
      ? ((weekSales - lastWeekSales) / lastWeekSales) * 100 
      : 0;
    
    // This Month's data
    const monthStart = new Date(now);
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const lastMonthStart = new Date(monthStart);
    lastMonthStart.setMonth(lastMonthStart.getMonth() - 1);
    
    const [monthSalesAgg, lastMonthSalesAgg] = await Promise.all([
      prisma.order.aggregate({
        where: {
          companyId: companyId,
          isActive: true,
          isDeleted: false,
          orderDate: { gte: monthStart }
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
          }
        },
        _sum: { grandTotal: true }
      })
    ]);
    
    const monthSales = monthSalesAgg._sum.grandTotal || 0;
    const lastMonthSales = lastMonthSalesAgg._sum.grandTotal || 0;
    const monthSalesChange = lastMonthSales > 0 
      ? ((monthSales - lastMonthSales) / lastMonthSales) * 100 
      : 0;
    
    // This Year's data
    const yearStart = new Date(now);
    yearStart.setMonth(0, 1);
    yearStart.setHours(0, 0, 0, 0);
    const lastYearStart = new Date(yearStart);
    lastYearStart.setFullYear(lastYearStart.getFullYear() - 1);
    
    const [yearSalesAgg, lastYearSalesAgg] = await Promise.all([
      prisma.order.aggregate({
        where: {
          companyId: companyId,
          isActive: true,
          isDeleted: false,
          orderDate: { gte: yearStart }
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
          }
        },
        _sum: { grandTotal: true }
      })
    ]);
    
    const yearSales = yearSalesAgg._sum.grandTotal || 0;
    const lastYearSales = lastYearSalesAgg._sum.grandTotal || 0;
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
          returnDate: { gte: todayStart }
        },
        _sum: { refundAmount: true }
      }),
      prisma.return.aggregate({
        where: {
          companyId: companyId,
          isActive: true,
          isDeleted: false,
          returnDate: { gte: weekStart }
        },
        _sum: { refundAmount: true }
      }),
      prisma.return.aggregate({
        where: {
          companyId: companyId,
          isActive: true,
          isDeleted: false,
          returnDate: { gte: monthStart }
        },
        _sum: { refundAmount: true }
      }),
      prisma.return.aggregate({
        where: {
          companyId: companyId,
          isActive: true,
          isDeleted: false,
          returnDate: { gte: yearStart }
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

    // ─── RECENT ACTIVITY (MOCK) ───────────────────────────────
    const recentActivity = [];

    // ─── REVENUE BREAKDOWN (MOCK) ─────────────────────────────
    const revenueBreakdown = {
      grossRevenue: summary.totalRevenue,
      lineItemDiscounts: summary.totalRevenue * 0.05,
      orderLevelDiscounts: summary.totalRevenue * 0.03,
      netRevenue: summary.totalRevenue * 0.92,
      taxAmount: summary.totalRevenue * 0.1,
      shippingAmount: summary.totalRevenue * 0.02,
      items: []
    };

    res.status(200).json({
      success: true,
      data: {
        summary,
        orders: {
          count: orderCount,
          revenue: orderRevenue._sum.grandTotal || 0,
          byStatus: orderStatusCounts.map((s) => ({
            status: s.orderStatus,
            count: s._count._all,
            revenue: s._sum.grandTotal || 0
          })),
          trend: orderTrend,
          todayCount: todayOrders,
          todayRevenue: todayRevenue,
          pendingCount: pendingOrders,
          revenueGrowth: '+15%'
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
    const { period = 'month' } = req.query;
    const dateFilter = getDateFilter(period);

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
    const { period = 'month' } = req.query;
    const dateFilter = getDateFilter(period);

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
    const { period = 'month', startDate, endDate } = req.query;
    const dateFilter = getDateFilter(period, startDate, endDate);

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