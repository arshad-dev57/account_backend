// warehouse/controller/sales_dashboard_controller.js - MULTI-TENANT VERSION

const prisma = require('../../prisma/client');

// ─── HELPERS ────────────────────────────────────────────────
const getDateFilter = (period) => {
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
const getOrderTrend = async (userId, dateFilter, days = 30) => {
  const trendData = await prisma.order.findMany({
    where: {
      userId: userId, // 👈 User-specific
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
const getInvoiceStats = async (userId, period) => {
  const dateFilter = getDateFilter(period);
  
  const [total, paid, unpaid, partial] = await Promise.all([
    prisma.warehouseInvoice.count({
      where: {
        userId: userId, // 👈 User-specific
        isActive: true,
        isDeleted: false,
        invoiceDate: dateFilter
      }
    }),
    prisma.warehouseInvoice.count({
      where: {
        userId: userId,
        isActive: true,
        isDeleted: false,
        invoiceDate: dateFilter,
        paymentStatus: 'Paid'
      }
    }),
    prisma.warehouseInvoice.count({
      where: {
        userId: userId,
        isActive: true,
        isDeleted: false,
        invoiceDate: dateFilter,
        paymentStatus: 'Unpaid'
      }
    }),
    prisma.warehouseInvoice.count({
      where: {
        userId: userId,
        isActive: true,
        isDeleted: false,
        invoiceDate: dateFilter,
        paymentStatus: 'Partial'
      }
    })
  ]);

  const revenue = await prisma.warehouseInvoice.aggregate({
    where: {
      userId: userId,
      isActive: true,
      isDeleted: false,
      invoiceDate: dateFilter,
      paymentStatus: { in: ['Paid', 'Partial'] }
    },
    _sum: { grandTotal: true }
  });

  const outstanding = await prisma.warehouseInvoice.aggregate({
    where: {
      userId: userId,
      isActive: true,
      isDeleted: false,
      invoiceDate: dateFilter,
      paymentStatus: { in: ['Unpaid', 'Partial'] }
    },
    _sum: { outstanding: true }
  });

  return {
    total,
    paid,
    unpaid,
    partial,
    revenue: revenue._sum.grandTotal || 0,
    outstanding: outstanding._sum.outstanding || 0
  };
};

// ─── GET INVOICE TREND ────────────────────────────────────
const getInvoiceTrend = async (userId, days = 30) => {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  startDate.setHours(0, 0, 0, 0);

  const invoices = await prisma.warehouseInvoice.findMany({
    where: {
      userId: userId, // 👈 User-specific
      isActive: true,
      isDeleted: false,
      invoiceDate: { gte: startDate }
    },
    select: {
      invoiceDate: true,
      grandTotal: true,
      paymentStatus: true
    },
    orderBy: { invoiceDate: 'asc' }
  });

  const trendMap = {};
  invoices.forEach((inv) => {
    const key = inv.invoiceDate.toISOString().split('T')[0];
    if (!trendMap[key]) {
      trendMap[key] = {
        date: key,
        total: 0,
        paid: 0,
        unpaid: 0
      };
    }
    trendMap[key].total += inv.grandTotal;
    if (inv.paymentStatus === 'Paid') {
      trendMap[key].paid += inv.grandTotal;
    } else {
      trendMap[key].unpaid += inv.grandTotal;
    }
  });

  return Object.values(trendMap);
};

// ─── GET RETURN STATS ─────────────────────────────────────
const getReturnStats = async (userId, period) => {
  const dateFilter = getDateFilter(period);

  const [total, pending, approved, rejected, completed] = await Promise.all([
    prisma.return.count({
      where: {
        userId: userId, // 👈 User-specific
        isActive: true,
        isDeleted: false,
        returnDate: dateFilter
      }
    }),
    prisma.return.count({
      where: {
        userId: userId,
        isActive: true,
        isDeleted: false,
        returnDate: dateFilter,
        returnStatus: 'Pending'
      }
    }),
    prisma.return.count({
      where: {
        userId: userId,
        isActive: true,
        isDeleted: false,
        returnDate: dateFilter,
        returnStatus: 'Approved'
      }
    }),
    prisma.return.count({
      where: {
        userId: userId,
        isActive: true,
        isDeleted: false,
        returnDate: dateFilter,
        returnStatus: 'Rejected'
      }
    }),
    prisma.return.count({
      where: {
        userId: userId,
        isActive: true,
        isDeleted: false,
        returnDate: dateFilter,
        returnStatus: 'Completed'
      }
    })
  ]);

  const refundAmount = await prisma.return.aggregate({
    where: {
      userId: userId,
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

// ─── GET REFUND STATS ─────────────────────────────────────
const getRefundStats = async (userId, period) => {
  const dateFilter = getDateFilter(period);

  const [total, pending, completed, failed] = await Promise.all([
    prisma.refund.count({
      where: {
        userId: userId, // 👈 User-specific
        isActive: true,
        isDeleted: false,
        refundDate: dateFilter
      }
    }),
    prisma.refund.count({
      where: {
        userId: userId,
        isActive: true,
        isDeleted: false,
        refundDate: dateFilter,
        refundStatus: 'Pending'
      }
    }),
    prisma.refund.count({
      where: {
        userId: userId,
        isActive: true,
        isDeleted: false,
        refundDate: dateFilter,
        refundStatus: 'Completed'
      }
    }),
    prisma.refund.count({
      where: {
        userId: userId,
        isActive: true,
        isDeleted: false,
        refundDate: dateFilter,
        refundStatus: 'Failed'
      }
    })
  ]);

  const refundAmount = await prisma.refund.aggregate({
    where: {
      userId: userId,
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
const getTopProducts = async (userId, period, limit = 10) => {
  const dateFilter = getDateFilter(period);

  const topProducts = await prisma.orderItem.groupBy({
    by: ['productId', 'productName', 'sku'],
    where: {
      order: {
        userId: userId, // 👈 User-specific
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
const getCustomerStats = async (userId, period) => {
  const dateFilter = getDateFilter(period);

  const [totalCustomers, newCustomers, topCustomers] = await Promise.all([
    prisma.customer.count({
      where: {
        userId: userId, // 👈 User-specific
        isActive: true,
        isDeleted: false
      }
    }),
    prisma.customer.count({
      where: {
        userId: userId,
        isActive: true,
        isDeleted: false,
        createdAt: dateFilter
      }
    }),
    prisma.customer.findMany({
      where: {
        userId: userId,
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
    const userId = req.user.id; // 👈 Current user
    const period = req.query.period || 'month';
    const dateFilter = getDateFilter(period);

    // ─── ORDERS ──────────────────────────────────────────────
    const orderFilter = {
      userId: userId, // 👈 User-specific
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
      getOrderTrend(userId, dateFilter)
    ]);

    // ─── INVOICES ─────────────────────────────────────────────
    const [invoiceStats, invoiceTrend] = await Promise.all([
      getInvoiceStats(userId, period),
      getInvoiceTrend(userId)
    ]);

    // ─── RETURNS ──────────────────────────────────────────────
    const returnStats = await getReturnStats(userId, period);

    // ─── REFUNDS ──────────────────────────────────────────────
    const refundStats = await getRefundStats(userId, period);

    // ─── TOP PRODUCTS ─────────────────────────────────────────
    const topProducts = await getTopProducts(userId, period);

    // ─── CUSTOMER STATS ──────────────────────────────────────
    const customerStats = await getCustomerStats(userId, period);

    // ─── SUMMARY STATS ───────────────────────────────────────
    const summary = {
      totalOrders: orderCount,
      totalRevenue: orderRevenue._sum.grandTotal || 0,
      totalInvoices: invoiceStats.total,
      totalInvoiceRevenue: invoiceStats.revenue,
      totalReturns: returnStats.total,
      totalRefunds: refundStats.total,
      refundAmount: refundStats.refundAmount,
      outstandingInvoices: invoiceStats.outstanding,
      totalCustomers: customerStats.totalCustomers
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
          trend: orderTrend
        },
        invoices: {
          stats: invoiceStats,
          trend: invoiceTrend
        },
        returns: returnStats,
        refunds: refundStats,
        topProducts,
        customers: customerStats
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
          userId: userId,
          isActive: true,
          isDeleted: false,
          orderDate: dateFilter
        }
      }),
      prisma.order.aggregate({
        where: {
          userId: userId,
          isActive: true,
          isDeleted: false,
          orderDate: dateFilter
        },
        _sum: { grandTotal: true }
      }),
      prisma.warehouseInvoice.count({
        where: {
          userId: userId,
          isActive: true,
          isDeleted: false,
          invoiceDate: dateFilter
        }
      }),
      prisma.warehouseInvoice.aggregate({
        where: {
          userId: userId,
          isActive: true,
          isDeleted: false,
          invoiceDate: dateFilter,
          paymentStatus: { in: ['Paid', 'Partial'] }
        },
        _sum: { grandTotal: true }
      }),
      prisma.return.count({
        where: {
          userId: userId,
          isActive: true,
          isDeleted: false,
          returnDate: dateFilter
        }
      }),
      prisma.refund.aggregate({
        where: {
          userId: userId,
          isActive: true,
          isDeleted: false,
          refundDate: dateFilter,
          refundStatus: 'Completed'
        },
        _sum: { amount: true }
      }),
      prisma.customer.count({
        where: {
          userId: userId,
          isActive: true,
          isDeleted: false
        }
      }),
      prisma.order.aggregate({
        where: {
          userId: userId,
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
    const { days = 30, period = 'day' } = req.query;
    const daysInt = parseInt(days);

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - daysInt);
    startDate.setHours(0, 0, 0, 0);

    // ✅ User-specific orders
    const orders = await prisma.order.findMany({
      where: {
        userId: userId,
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
          userId: userId,
          isActive: true,
          isDeleted: false,
          orderDate: dateFilter
        }
      }),
      prisma.order.count({
        where: {
          userId: userId,
          isActive: true,
          isDeleted: false,
          orderDate: dateFilter,
          orderStatus: 'Completed'
        }
      }),
      prisma.order.count({
        where: {
          userId: userId,
          isActive: true,
          isDeleted: false,
          orderDate: dateFilter,
          orderStatus: 'Cancelled'
        }
      }),
      prisma.order.aggregate({
        where: {
          userId: userId,
          isActive: true,
          isDeleted: false,
          orderDate: dateFilter
        },
        _sum: { grandTotal: true }
      }),
      prisma.order.aggregate({
        where: {
          userId: userId,
          isActive: true,
          isDeleted: false,
          orderDate: dateFilter
        },
        _avg: { grandTotal: true }
      }),
      prisma.order.groupBy({
        by: ['orderStatus'],
        where: {
          userId: userId,
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

module.exports = {
  getSalesDashboard,
  getSalesSummary,
  getSalesTrends,
  getSalesPerformance
};