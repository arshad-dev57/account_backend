// controllers/warehouse_dashboard_controller.js
const prisma = require('../../prisma/client');

// ============================================================
// HELPER: Get Date Range from period query param
// ============================================================
const getDateRange = (days) => {
  const start = new Date();
  start.setDate(start.getDate() - days);
  start.setHours(0, 0, 0, 0);
  return start;
};

const getTodayRange = () => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  return { today, tomorrow };
};

/**
 * Parse period filter from query params.
 * Returns { startDate, endDate, periodLabel, periodPoints }
 * periodPoints: number of data points for the movement chart
 */
const parsePeriodFilter = (query) => {
  const { period = 'week', startDate, endDate } = query;
  const now = new Date();
  let start, end, label, points, groupBy;

  switch (period) {
    case 'today': {
      start = new Date(now); start.setHours(0, 0, 0, 0);
      end   = new Date(now); end.setHours(23, 59, 59, 999);
      label = 'Today'; points = 'hours'; groupBy = 'hour';
      break;
    }
    case 'month': {
      start = new Date(now.getFullYear(), now.getMonth(), 1);
      end   = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
      label = 'This Month'; points = 'weeks'; groupBy = 'week';
      break;
    }
    case 'year': {
      start = new Date(now.getFullYear(), 0, 1);
      end   = new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999);
      label = 'This Year'; points = 'months'; groupBy = 'month';
      break;
    }
    case 'custom': {
      start = startDate ? new Date(startDate) : getDateRange(30);
      end   = endDate   ? new Date(endDate)   : now;
      end.setHours(23, 59, 59, 999);
      label = 'Custom'; points = 'days'; groupBy = 'day';
      break;
    }
    default: { // 'week'
      start = getDateRange(6); // last 7 days
      end   = now;
      label = 'This Week'; points = 'days'; groupBy = 'day';
    }
  }

  return { start, end, label, groupBy };
};

// ============================================================
// HELPER: Colors for Charts
// ============================================================
const getColorForIndex = (index) => {
  const colors = ['#2196F3', '#4CAF50', '#FF9800', '#9C27B0', '#F44336', '#00BCD4', '#8BC34A', '#FF5722'];
  return colors[index % colors.length];
};

// ============================================================
// @desc    Get dashboard metrics (User-specific)
// @route   GET /api/admin/dashboard/metrics
// @access  Private
// ============================================================
const getDashboardMetrics = async (req, res) => {
  try {
    const userId = req.user.id;
    const { start, end } = parsePeriodFilter(req.query);

    const [
      totalProducts,
      products,
      outOfStockCount,
      expiringCount,
      todayStockIn,
      todayStockOut,
      periodStockIn,
      periodStockOut,
    ] = await Promise.all([
      prisma.product.count({ where: { userId, isActive: true } }),
      prisma.product.findMany({
        where: { userId, isActive: true },
        select: { sellingPrice: true, currentStock: true, minimumStock: true, maximumStock: true }
      }),
      prisma.product.count({ where: { userId, isActive: true, currentStock: 0 } }),
      prisma.product.count({
        where: { userId, isActive: true, expiryDate: { gte: new Date(), lte: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) } }
      }),
      // Always today's counts (not period-filtered — header stats)
      prisma.stockMovement.count({ where: { userId, type: 'stock_in',  createdAt: { gte: getTodayRange().today, lt: getTodayRange().tomorrow } } }),
      prisma.stockMovement.count({ where: { userId, type: 'stock_out', createdAt: { gte: getTodayRange().today, lt: getTodayRange().tomorrow } } }),
      // Period-filtered movement counts
      prisma.stockMovement.count({ where: { userId, type: 'stock_in',  createdAt: { gte: start, lte: end } } }),
      prisma.stockMovement.count({ where: { userId, type: 'stock_out', createdAt: { gte: start, lte: end } } }),
    ]);

    const totalStockValue = products.reduce((s, p) => s + (p.sellingPrice * p.currentStock), 0);
    const lowStockCount   = products.filter(p => p.minimumStock > 0 && p.currentStock > 0 && p.currentStock <= p.minimumStock).length;
    const overstockCount  = products.filter(p => p.maximumStock > 0 && p.currentStock >= p.maximumStock * 1.2).length;

    res.status(200).json({
      success: true,
      data: {
        totalProducts,
        totalStockValue,
        lowStockCount,
        outOfStockCount,
        overstockCount,
        expiringCount,
        todayStockIn,
        todayStockOut,
        periodStockIn,
        periodStockOut,
        pendingOrders: 0,
        todayRevenue: 0,
      }
    });
  } catch (error) {
    console.error('❌ Dashboard metrics error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// ============================================================
// @desc    Get recent activities (User-specific)
// @route   GET /api/admin/dashboard/activities
// @access  Private
// ============================================================
const getRecentActivities = async (req, res) => {
  try {
    const userId = req.user.id;
    const { limit = 10 } = req.query;

    const movements = await prisma.stockMovement.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: parseInt(limit),
    });

    const activities = movements.map(m => ({
      id: m.id,
      action: m.type === 'stock_in' ? 'Stock In' : 'Stock Out',
      details: `${m.type === 'stock_in' ? 'Added' : 'Removed'} ${m.quantity} units of ${m.productName}`,
      quantity: m.quantity,
      productName: m.productName,
      createdAt: m.createdAt,
      status: m.status || 'Completed',
      user: {
        id: req.user.id,
        name: (req.user.firstName || '') + ' ' + (req.user.lastName || ''),
      }
    }));

    res.status(200).json({ success: true, data: { activities } });
  } catch (error) {
    console.error('❌ Recent activities error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};


// ============================================================
// @desc    Get active alerts (User-specific)
// @route   GET /api/admin/dashboard/alerts
// @access  Private
// ============================================================
const getAlerts = async (req, res) => {
  try {
    console.log("\n========== ALERTS API ==========");
    console.log("Method:", req.method);
    console.log("URL:", req.originalUrl);
    console.log("User:", req.user?.id, req.user?.email);
    console.log("Timestamp:", new Date().toISOString());

    const userId = req.user.id;

    // Get low stock products as alerts
    const lowStockProducts = await prisma.product.findMany({
      where: {
        userId: userId,
        isActive: true,
        currentStock: { lte: prisma.product.fields.minimumStock }
      },
      select: {
        id: true,
        name: true,
        sku: true,
        currentStock: true,
        minimumStock: true
      },
      take: 10
    });

    // Format alerts
    const alerts = lowStockProducts.map(p => ({
      id: p.id,
      type: 'low_stock',
      title: 'Low Stock Alert',
      message: `${p.name} (${p.sku}) is running low. Current stock: ${p.currentStock}, Minimum: ${p.minimumStock}`,
      isRead: false,
      createdAt: new Date(),
      priority: p.currentStock === 0 ? 'high' : 'medium',
      productId: p.id,
      productName: p.name
    }));

    console.log("🔔 Alerts found:", alerts.length);
    console.log("========== END ALERTS ==========\n");

    res.status(200).json({
      success: true,
      data: {
        alerts
      }
    });

  } catch (error) {
    console.error('❌ Alerts error:', error);
    console.error('Stack:', error.stack);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// ============================================================
// @desc    Get stock movement chart data (last 7 days) (User-specific)
// @route   GET /api/admin/dashboard/charts/stock-movement
// @access  Private
// ============================================================
const getStockMovementChart = async (req, res) => {
  try {
    const userId = req.user.id;
    const { start, end, groupBy } = parsePeriodFilter(req.query);

    const movements = await prisma.stockMovement.findMany({
      where: { userId, createdAt: { gte: start, lte: end } },
      select: { type: true, quantity: true, createdAt: true }
    });

    const chartData = [];
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const days   = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

    if (groupBy === 'month') {
      // Year view: group by month (Jan-Dec)
      for (let m = 0; m <= 11; m++) {
        const label = months[m];
        const inMonth  = movements.filter(mv => new Date(mv.createdAt).getMonth() === m);
        chartData.push({
          label,
          stockIn:  inMonth.filter(mv => mv.type === 'stock_in').reduce((s,mv) => s + mv.quantity, 0),
          stockOut: inMonth.filter(mv => mv.type === 'stock_out').reduce((s,mv) => s + mv.quantity, 0),
        });
      }
    } else if (groupBy === 'week') {
      // Month view: group by week
      const daysInMonth = Math.ceil((end - start) / (1000 * 60 * 60 * 24));
      const numWeeks = Math.ceil(daysInMonth / 7);
      for (let w = 0; w < numWeeks; w++) {
        const wStart = new Date(start); wStart.setDate(wStart.getDate() + w * 7);
        const wEnd   = new Date(wStart); wEnd.setDate(wEnd.getDate() + 7);
        const inWeek = movements.filter(mv => new Date(mv.createdAt) >= wStart && new Date(mv.createdAt) < wEnd);
        chartData.push({
          label: `W${w+1}`,
          stockIn:  inWeek.filter(mv => mv.type === 'stock_in').reduce((s,mv) => s + mv.quantity, 0),
          stockOut: inWeek.filter(mv => mv.type === 'stock_out').reduce((s,mv) => s + mv.quantity, 0),
        });
      }
    } else if (groupBy === 'hour') {
      // Today view: group by hour
      for (let h = 0; h < 24; h += 3) {
        const inHour = movements.filter(mv => new Date(mv.createdAt).getHours() >= h && new Date(mv.createdAt).getHours() < h + 3);
        chartData.push({
          label: `${h}:00`,
          stockIn:  inHour.filter(mv => mv.type === 'stock_in').reduce((s,mv) => s + mv.quantity, 0),
          stockOut: inHour.filter(mv => mv.type === 'stock_out').reduce((s,mv) => s + mv.quantity, 0),
        });
      }
    } else {
      // Week/Custom view: group by day
      const diffDays = Math.max(1, Math.round((end - start) / (1000 * 60 * 60 * 24)));
      for (let i = 0; i < Math.min(diffDays + 1, 31); i++) {
        const date = new Date(start);
        date.setDate(date.getDate() + i);
        if (date > end) break;
        const nextDate = new Date(date); nextDate.setDate(nextDate.getDate() + 1);
        const inDay = movements.filter(mv => new Date(mv.createdAt) >= date && new Date(mv.createdAt) < nextDate);
        const label = groupBy === 'day' && diffDays <= 7
          ? days[date.getDay()]
          : `${date.getDate()}/${date.getMonth()+1}`;
        chartData.push({
          label,
          stockIn:  inDay.filter(mv => mv.type === 'stock_in').reduce((s,mv) => s + mv.quantity, 0),
          stockOut: inDay.filter(mv => mv.type === 'stock_out').reduce((s,mv) => s + mv.quantity, 0),
          date: date.toISOString(),
        });
      }
    }

    res.status(200).json({ success: true, data: chartData });
  } catch (error) {
    console.error('❌ Stock movement chart error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// ============================================================
// @desc    Get category distribution chart (User-specific)
// @route   GET /api/admin/dashboard/charts/categories
// @access  Private
// ============================================================
const getCategoryDistribution = async (req, res) => {
  try {
    console.log("\n========== CATEGORY DISTRIBUTION API ==========");
    console.log("Method:", req.method);
    console.log("URL:", req.originalUrl);
    console.log("User:", req.user?.id, req.user?.email);
    console.log("Timestamp:", new Date().toISOString());

    const userId = req.user.id;

    // Get categories with product counts (user-specific)
    const categories = await prisma.category.findMany({
      where: {
        userId: userId,
        isActive: true
      },
      select: {
        id: true,
        name: true,
        products: {
          where: {
            userId: userId,
            isActive: true
          },
          select: { id: true }
        }
      }
    });

    console.log("📊 Categories found:", categories.length);

    // Calculate product counts
    const totalProducts = categories.reduce((sum, cat) => sum + cat.products.length, 0);
    console.log("📦 Total Products:", totalProducts);

    const categoryData = categories.map((cat, index) => {
      const productCount = cat.products.length;
      const percentage = totalProducts > 0 ? (productCount / totalProducts * 100) : 0;
      
      console.log(`📌 ${cat.name}: ${productCount} products (${percentage.toFixed(1)}%)`);

      return {
        categoryId: cat.id,
        categoryName: cat.name,
        productCount: productCount,
        percentage: percentage,
        color: getColorForIndex(index),
        icon: 'inventory'
      };
    });

    const responseData = {
      categories: categoryData,
      totalProducts
    };

    console.log("✅ Response Data:", JSON.stringify(responseData, null, 2));
    console.log("========== END CATEGORIES ==========\n");

    res.status(200).json({
      success: true,
      data: responseData
    });

  } catch (error) {
    console.error('❌ Category distribution error:', error);
    console.error('Stack:', error.stack);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// ============================================================
// @desc    Get top products chart (User-specific)
// @route   GET /api/admin/dashboard/charts/top-products
// @access  Private
// ============================================================
const getTopProducts = async (req, res) => {
  try {
    console.log("\n========== TOP PRODUCTS API ==========");
    console.log("Method:", req.method);
    console.log("URL:", req.originalUrl);
    console.log("User:", req.user?.id, req.user?.email);
    console.log("Timestamp:", new Date().toISOString());

    const userId = req.user.id;

    // Get top products by stock movement quantity (user-specific)
    const topProducts = await prisma.stockMovement.groupBy({
      by: ['productId', 'productName'],
      where: {
        userId: userId
      },
      _sum: {
        quantity: true
      },
      orderBy: {
        _sum: {
          quantity: 'desc'
        }
      },
      take: 5
    });

    console.log("🏆 Top Products found:", topProducts.length);

    const chartData = topProducts.map((p, index) => {
      console.log(`🥇 #${index + 1}: ${p.productName} - ${p._sum.quantity} units`);
      return {
        label: p.productName || `Product ${index + 1}`,
        value: p._sum.quantity || 0,
        color: getColorForIndex(index)
      };
    });

    console.log("✅ Chart Data:", JSON.stringify(chartData, null, 2));
    console.log("========== END TOP PRODUCTS ==========\n");

    res.status(200).json({
      success: true,
      data: chartData
    });

  } catch (error) {
    console.error('❌ Top products error:', error);
    console.error('Stack:', error.stack);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// ============================================================
// @desc    Get order status distribution (User-specific)
// @route   GET /api/admin/dashboard/charts/order-status
// @access  Private
// ============================================================
const getOrderStatusDistribution = async (req, res) => {
  try {
    console.log("\n========== ORDER STATUS DISTRIBUTION API ==========");
    console.log("Method:", req.method);
    console.log("URL:", req.originalUrl);
    console.log("User:", req.user?.id, req.user?.email);
    console.log("Timestamp:", new Date().toISOString());

    const userId = req.user.id;

    // Get order status counts (user-specific)
    const statusCounts = await prisma.order.groupBy({
      by: ['orderStatus'],
      where: {
        userId: userId,
        isActive: true,
        isDeleted: false
      },
      _count: {
        _all: true
      }
    });

    console.log("📊 Status Counts:", JSON.stringify(statusCounts, null, 2));

    // Define all possible statuses with default 0
    const allStatuses = ['Pending', 'Processing', 'Shipped', 'Delivered', 'Cancelled', 'Returned', 'On Hold'];
    const statusMap = {};

    // Initialize with 0
    allStatuses.forEach(status => {
      statusMap[status] = 0;
    });

    // Fill with actual counts
    statusCounts.forEach(item => {
      statusMap[item.orderStatus] = item._count._all;
    });

    const responseData = {
      pending: statusMap['Pending'],
      processing: statusMap['Processing'],
      shipped: statusMap['Shipped'],
      completed: statusMap['Delivered'],
      cancelled: statusMap['Cancelled'],
      returned: statusMap['Returned'],
      onHold: statusMap['On Hold']
    };

    console.log("✅ Order Status Data:", JSON.stringify(responseData, null, 2));
    console.log("========== END ORDER STATUS ==========\n");

    res.status(200).json({
      success: true,
      data: responseData
    });

  } catch (error) {
    console.error('❌ Order status error:', error);
    console.error('Stack:', error.stack);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// ============================================================
// @desc    Get dashboard summary (User-specific)
// @route   GET /api/admin/dashboard/summary
// @access  Private
// ============================================================
const getDashboardSummary = async (req, res) => {
  try {
    console.log("\n========== DASHBOARD SUMMARY API ==========");
    console.log("Method:", req.method);
    console.log("URL:", req.originalUrl);
    console.log("User:", req.user?.id, req.user?.email);
    console.log("Timestamp:", new Date().toISOString());

    const userId = req.user.id;

    const [
      totalProducts,
      totalOrders,
      totalCustomers,
      totalSuppliers,
      lowStockCount,
      pendingOrders,
      totalRevenue,
      totalPurchases
    ] = await Promise.all([
      prisma.product.count({
        where: { userId: userId, isActive: true }
      }),
      prisma.order.count({
        where: { userId: userId, isActive: true, isDeleted: false }
      }),
      prisma.customer.count({
        where: { userId: userId, isActive: true, isDeleted: false }
      }),
      prisma.supplier.count({
        where: { userId: userId, status: 'active' }
      }),
      prisma.product.count({
        where: {
          userId: userId,
          isActive: true,
          currentStock: { lte: prisma.product.fields.minimumStock }
        }
      }),
      prisma.order.count({
        where: {
          userId: userId,
          isActive: true,
          isDeleted: false,
          orderStatus: 'Pending'
        }
      }),
      prisma.order.aggregate({
        where: {
          userId: userId,
          isActive: true,
          isDeleted: false,
          orderStatus: 'Delivered'
        },
        _sum: { grandTotal: true }
      }),
      prisma.warehousePurchase.aggregate({
        where: {
          userId: userId,
          isActive: true,
          isDeleted: false,
          purchaseStatus: 'Received'
        },
        _sum: { grandTotal: true }
      })
    ]);

    const summary = {
      totalProducts,
      totalOrders,
      totalCustomers,
      totalSuppliers,
      lowStock: lowStockCount,
      pendingOrders,
      revenue: totalRevenue._sum.grandTotal || 0,
      totalPurchases: totalPurchases._sum.grandTotal || 0,
      profit: (totalRevenue._sum.grandTotal || 0) - (totalPurchases._sum.grandTotal || 0)
    };

    console.log("📊 Summary:", JSON.stringify(summary, null, 2));
    console.log("========== END SUMMARY ==========\n");

    res.status(200).json({
      success: true,
      data: summary
    });

  } catch (error) {
    console.error('❌ Dashboard summary error:', error);
    console.error('Stack:', error.stack);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// ============================================================
// EXPORT
// ============================================================
module.exports = {
  getDashboardMetrics,
  getRecentActivities,
  getAlerts,
  getStockMovementChart,
  getCategoryDistribution,
  getTopProducts,
  getOrderStatusDistribution,
  getDashboardSummary
};