// controllers/dashboardController.js - COMPLETE PRISMA VERSION (MULTI-TENANT)

const prisma = require('../../prisma/client');

// ============================================================
// HELPER: Get Date Range
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
    console.log("\n========== DASHBOARD METRICS API ==========");
    console.log("Method:", req.method);
    console.log("URL:", req.originalUrl);
    console.log("User:", req.user?.id, req.user?.email);
    console.log("Timestamp:", new Date().toISOString());

    const userId = req.user.id;

    // ─── GET METRICS ──────────────────────────────────────────
    const [
      totalProducts,
      products,
      lowStockCount,
      outOfStockCount,
      expiringCount,
      todayStockIn,
      todayStockOut,
      pendingOrders,
      todayOrders,
      totalCustomers,
      totalSuppliers
    ] = await Promise.all([
      // Total products
      prisma.product.count({
        where: { userId: userId, isActive: true }
      }),
      // Products for stock value calculation
      prisma.product.findMany({
        where: { userId: userId, isActive: true },
        select: {
          sellingPrice: true,
          currentStock: true,
          name: true,
          maximumStock: true
        }
      }),
      // Low stock count
      prisma.product.count({
        where: {
          userId: userId,
          isActive: true,
          currentStock: { lte: prisma.product.fields.minimumStock }
        }
      }),
      // Out of stock count
      prisma.product.count({
        where: {
          userId: userId,
          isActive: true,
          currentStock: 0
        }
      }),
      // Expiring soon (within 30 days)
      prisma.product.count({
        where: {
          userId: userId,
          isActive: true,
          expiryDate: {
            gte: new Date(),
            lte: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
          }
        }
      }),
      // Today stock in
      prisma.stockMovement.count({
        where: {
          userId: userId,
          type: 'stock_in',
          createdAt: {
            gte: getTodayRange().today,
            lt: getTodayRange().tomorrow
          }
        }
      }),
      // Today stock out
      prisma.stockMovement.count({
        where: {
          userId: userId,
          type: 'stock_out',
          createdAt: {
            gte: getTodayRange().today,
            lt: getTodayRange().tomorrow
          }
        }
      }),
      // Pending orders
      prisma.order.count({
        where: {
          userId: userId,
          isActive: true,
          isDeleted: false,
          orderStatus: 'Pending'
        }
      }),
      // Today's orders for revenue
      prisma.order.findMany({
        where: {
          userId: userId,
          isActive: true,
          isDeleted: false,
          orderStatus: 'Delivered',
          orderDate: {
            gte: getTodayRange().today,
            lt: getTodayRange().tomorrow
          }
        },
        select: { grandTotal: true }
      }),
      // Total customers
      prisma.customer.count({
        where: { userId: userId, isActive: true, isDeleted: false }
      }),
      // Total suppliers
      prisma.supplier.count({
        where: { userId: userId, status: 'active' }
      })
    ]);

    // Calculate total stock value
    const totalStockValue = products.reduce((sum, product) => {
      return sum + (product.sellingPrice * product.currentStock);
    }, 0);

    // Calculate overstock count
    const overstockCount = products.filter(p => 
      p.maximumStock > 0 && p.currentStock >= p.maximumStock * 1.2
    ).length;

    // Calculate today's revenue
    const todayRevenue = todayOrders.reduce((sum, order) => sum + order.grandTotal, 0);

    console.log("📊 Total Products:", totalProducts);
    console.log("💰 Total Stock Value:", totalStockValue);
    console.log("⚠️ Low Stock Count:", lowStockCount);
    console.log("❌ Out of Stock Count:", outOfStockCount);
    console.log("📦 Overstock Count:", overstockCount);
    console.log("📅 Expiring Soon Count:", expiringCount);
    console.log("📥 Today Stock In:", todayStockIn);
    console.log("📤 Today Stock Out:", todayStockOut);
    console.log("⏳ Pending Orders:", pendingOrders);
    console.log("💰 Today Revenue:", todayRevenue);
    console.log("👥 Total Customers:", totalCustomers);
    console.log("🏢 Total Suppliers:", totalSuppliers);

    const responseData = {
      totalProducts,
      totalStockValue,
      lowStockCount,
      expiringCount,
      todayStockIn,
      todayStockOut,
      pendingOrders,
      outOfStockCount,
      overstockCount,
      todayRevenue,
      totalCustomers,
      totalSuppliers
    };

    console.log("✅ Response Data:", JSON.stringify(responseData, null, 2));
    console.log("========== END METRICS ==========\n");

    res.status(200).json({
      success: true,
      data: responseData
    });

  } catch (error) {
    console.error('❌ Dashboard metrics error:', error);
    console.error('Stack:', error.stack);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// ============================================================
// @desc    Get recent activities (User-specific)
// @route   GET /api/admin/dashboard/activities
// @access  Private
// ============================================================
const getRecentActivities = async (req, res) => {
  try {
    console.log("\n========== RECENT ACTIVITIES API ==========");
    console.log("Method:", req.method);
    console.log("URL:", req.originalUrl);
    console.log("User:", req.user?.id, req.user?.email);
    console.log("Timestamp:", new Date().toISOString());

    const userId = req.user.id;
    const { limit = 10 } = req.query;

    // Get recent stock movements as activities
    const movements = await prisma.stockMovement.findMany({
      where: {
        userId: userId
      },
      orderBy: {
        createdAt: 'desc'
      },
      take: parseInt(limit),
      include: {
        product: {
          select: {
            id: true,
            name: true,
            sku: true
          }
        }
      }
    });

    // Format activities
    const activities = movements.map(m => ({
      id: m.id,
      type: m.type === 'stock_in' ? 'Stock Added' : 'Stock Removed',
      description: `${m.type === 'stock_in' ? 'Added' : 'Removed'} ${m.quantity} units of ${m.productName}`,
      quantity: m.quantity,
      productName: m.productName,
      createdAt: m.createdAt,
      status: m.status || 'Completed',
      reference: m.reference || '',
      notes: m.notes || '',
      user: {
        id: req.user.id,
        name: req.user.firstName + ' ' + req.user.lastName,
        email: req.user.email
      }
    }));

    console.log("📋 Activities found:", activities.length);
    console.log("✅ Activities Data:", JSON.stringify(activities, null, 2));
    console.log("========== END ACTIVITIES ==========\n");

    res.status(200).json({
      success: true,
      data: {
        activities
      }
    });

  } catch (error) {
    console.error('❌ Recent activities error:', error);
    console.error('Stack:', error.stack);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
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
    console.log("\n========== STOCK MOVEMENT CHART API ==========");
    console.log("Method:", req.method);
    console.log("URL:", req.originalUrl);
    console.log("User:", req.user?.id, req.user?.email);
    console.log("Timestamp:", new Date().toISOString());

    const userId = req.user.id;
    const chartData = [];
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    for (let i = 6; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      date.setHours(0, 0, 0, 0);

      const nextDate = new Date(date);
      nextDate.setDate(nextDate.getDate() + 1);

      const dayName = days[date.getDay()];

      // Get stock movements for this day (user-specific)
      const movements = await prisma.stockMovement.findMany({
        where: {
          userId: userId,
          createdAt: { gte: date, lt: nextDate }
        }
      });

      const stockIn = movements
        .filter(m => m.type === 'stock_in')
        .reduce((sum, m) => sum + m.quantity, 0);

      const stockOut = movements
        .filter(m => m.type === 'stock_out')
        .reduce((sum, m) => sum + m.quantity, 0);

      chartData.push({
        label: dayName,
        stockIn,
        stockOut,
        date: date.toISOString()
      });

      console.log(`📅 ${dayName}: Stock In=${stockIn}, Stock Out=${stockOut}`);
    }

    console.log("✅ Chart Data:", JSON.stringify(chartData, null, 2));
    console.log("========== END CHART ==========\n");

    res.status(200).json({
      success: true,
      data: chartData
    });

  } catch (error) {
    console.error('❌ Stock movement chart error:', error);
    console.error('Stack:', error.stack);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
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