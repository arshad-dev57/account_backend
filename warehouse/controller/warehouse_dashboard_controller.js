// controllers/dashboardController.js

const Product = require('../models/Product');
const Category = require('../models/Category');
const Order = require('../models/Order');
const StockMovement = require('../models/StockMovement');
const Activity = require('../models/Activity');
const Alert = require('../models/Alert');
const mongoose = require('mongoose');

// @desc    Get dashboard metrics
// @route   GET /api/admin/dashboard/metrics
// @access  Private
const getDashboardMetrics = async (req, res) => {
  try {
    console.log("\n========== DASHBOARD METRICS API ==========");
    console.log("Method:", req.method);
    console.log("URL:", req.originalUrl);
    console.log("User:", req.user?.id, req.user?.email);
    console.log("Timestamp:", new Date().toISOString());
    
    // Get total products
    const totalProducts = await Product.countDocuments();
    console.log("📊 Total Products:", totalProducts);
    
    // Calculate total stock value (sellingPrice * currentStock)
    const products = await Product.find({}, 'sellingPrice currentStock name');
    console.log("📦 Products found:", products.length);
    
    const totalStockValue = products.reduce((sum, product) => {
      return sum + (product.sellingPrice * product.currentStock);
    }, 0);
    console.log("💰 Total Stock Value:", totalStockValue);
    
    // Get low stock count (currentStock <= minimumStock)
    const lowStockCount = await Product.countDocuments({
      $expr: { $lte: ['$currentStock', '$minimumStock'] }
    });
    console.log("⚠️ Low Stock Count:", lowStockCount);
    
    // 🔥 NEW: Get out of stock count
    const outOfStockCount = await Product.countDocuments({ currentStock: 0 });
    console.log("❌ Out of Stock Count:", outOfStockCount);
    
    // 🔥 NEW: Get overstock count (currentStock >= maximumStock * 1.2)
    const productsWithMax = await Product.find({}, 'currentStock maximumStock');
    const overstockCount = productsWithMax.filter(p => 
      p.maximumStock > 0 && p.currentStock >= p.maximumStock * 1.2
    ).length;
    console.log("📦 Overstock Count:", overstockCount);
    
    // Get expiring soon count (expiryDate within 30 days)
    const thirtyDaysFromNow = new Date();
    thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);
    
    const expiringCount = await Product.countDocuments({
      expiryDate: { 
        $gte: new Date(), 
        $lte: thirtyDaysFromNow 
      }
    });
    console.log("📅 Expiring Soon Count:", expiringCount);
    
    // Get today's stock in/out
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    console.log("📆 Today Range:", today.toISOString(), "to", tomorrow.toISOString());
    
    const todayStockIn = await StockMovement.countDocuments({
      type: 'stock_in',
      createdAt: { $gte: today, $lt: tomorrow }
    });
    console.log("📥 Today Stock In:", todayStockIn);
    
    const todayStockOut = await StockMovement.countDocuments({
      type: 'stock_out',
      createdAt: { $gte: today, $lt: tomorrow }
    });
    console.log("📤 Today Stock Out:", todayStockOut);
    
    // Get pending orders
    const pendingOrders = await Order.countDocuments({ status: 'pending' });
    console.log("⏳ Pending Orders:", pendingOrders);
    
    // 🔥 NEW: Calculate today's revenue
    const todayOrders = await Order.find({
      status: 'completed',
      createdAt: { $gte: today, $lt: tomorrow }
    }, 'total');
    
    const todayRevenue = todayOrders.reduce((sum, order) => sum + order.total, 0);
    console.log("💰 Today Revenue:", todayRevenue);
    
    const responseData = {
      totalProducts,
      totalStockValue,
      lowStockCount,
      expiringCount,
      todayStockIn,
      todayStockOut,
      pendingOrders,
      outOfStockCount,    // 🔥 NEW
      overstockCount,     // 🔥 NEW
      todayRevenue        // 🔥 NEW
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
      message: 'Server error'
    });
  }
};

// @desc    Get recent activities
// @route   GET /api/admin/dashboard/activities
// @access  Private
const getRecentActivities = async (req, res) => {
  try {
    console.log("\n========== RECENT ACTIVITIES API ==========");
    console.log("Method:", req.method);
    console.log("URL:", req.originalUrl);
    console.log("User:", req.user?.id, req.user?.email);
    console.log("Timestamp:", new Date().toISOString());
    
    const activities = await Activity.find()
      .sort({ createdAt: -1 })
      .limit(10)
      .populate('user', 'name email');
    
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
      message: 'Server error'
    });
  }
};

// @desc    Get active alerts
// @route   GET /api/admin/dashboard/alerts
// @access  Private
const getAlerts = async (req, res) => {
  try {
    console.log("\n========== ALERTS API ==========");
    console.log("Method:", req.method);
    console.log("URL:", req.originalUrl);
    console.log("User:", req.user?.id, req.user?.email);
    console.log("Timestamp:", new Date().toISOString());
    
    const alerts = await Alert.find({ isRead: false })
      .sort({ createdAt: -1 })
      .limit(10);
    
    console.log("🔔 Alerts found:", alerts.length);
    console.log("✅ Alerts Data:", JSON.stringify(alerts, null, 2));
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
      message: 'Server error'
    });
  }
};

// @desc    Get stock movement chart data (last 7 days)
// @route   GET /api/admin/dashboard/charts/stock-movement
// @access  Private
const getStockMovementChart = async (req, res) => {
  try {
    console.log("\n========== STOCK MOVEMENT CHART API ==========");
    console.log("Method:", req.method);
    console.log("URL:", req.originalUrl);
    console.log("User:", req.user?.id, req.user?.email);
    console.log("Timestamp:", new Date().toISOString());
    
    const chartData = [];
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    
    for (let i = 6; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      date.setHours(0, 0, 0, 0);
      
      const nextDate = new Date(date);
      nextDate.setDate(nextDate.getDate() + 1);
      
      const dayName = days[date.getDay()];
      
      // Get stock movements for this day
      const movements = await StockMovement.find({
        createdAt: { $gte: date, $lt: nextDate }
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
      message: 'Server error'
    });
  }
};

// @desc    Get category distribution chart
// @route   GET /api/admin/dashboard/charts/categories
// @access  Private
const getCategoryDistribution = async (req, res) => {
  try {
    console.log("\n========== CATEGORY DISTRIBUTION API ==========");
    console.log("Method:", req.method);
    console.log("URL:", req.originalUrl);
    console.log("User:", req.user?.id, req.user?.email);
    console.log("Timestamp:", new Date().toISOString());
    
    const categories = await Category.aggregate([
      {
        $lookup: {
          from: 'products',
          localField: '_id',
          foreignField: 'categoryId',
          as: 'products'
        }
      },
      {
        $addFields: {
          productCount: { $size: '$products' }
        }
      },
      {
        $project: {
          name: 1,
          productCount: 1,
          color: 1,
          icon: 1
        }
      }
    ]);
    
    console.log("📊 Categories found:", categories.length);
    
    // Calculate percentages
    const totalProducts = categories.reduce((sum, cat) => sum + cat.productCount, 0);
    console.log("📦 Total Products:", totalProducts);
    
    const categoryData = categories.map(cat => {
      const percentage = totalProducts > 0 ? (cat.productCount / totalProducts * 100) : 0;
      console.log(`📌 ${cat.name}: ${cat.productCount} products (${percentage.toFixed(1)}%)`);
      
      return {
        categoryId: cat._id,
        categoryName: cat.name,
        productCount: cat.productCount,
        percentage: percentage,
        color: cat.color || '#2196F3',
        icon: cat.icon || 'inventory'
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
      message: 'Server error'
    });
  }
};

// @desc    Get top products chart
// @route   GET /api/admin/dashboard/charts/top-products
// @access  Private
const getTopProducts = async (req, res) => {
  try {
    console.log("\n========== TOP PRODUCTS API ==========");
    console.log("Method:", req.method);
    console.log("URL:", req.originalUrl);
    console.log("User:", req.user?.id, req.user?.email);
    console.log("Timestamp:", new Date().toISOString());
    
    const topProducts = await StockMovement.aggregate([
      {
        $group: {
          _id: '$productId',
          totalQuantity: { $sum: '$quantity' },
          productName: { $first: '$productName' }
        }
      },
      {
        $sort: { totalQuantity: -1 }
      },
      {
        $limit: 5
      }
    ]);
    
    console.log("🏆 Top Products found:", topProducts.length);
    
    const chartData = topProducts.map((p, index) => {
      console.log(`🥇 #${index + 1}: ${p.productName} - ${p.totalQuantity} units`);
      return {
        label: p.productName || `Product ${index + 1}`,
        value: p.totalQuantity,
        color: _getColorForIndex(index)
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
      message: 'Server error'
    });
  }
};

// Helper function for colors
function _getColorForIndex(index) {
  const colors = ['#2196F3', '#4CAF50', '#FF9800', '#9C27B0', '#F44336'];
  return colors[index % colors.length];
}
// controllers/dashboardController.js

// @desc    Get order status distribution
// @route   GET /api/admin/dashboard/charts/order-status
// @access  Private
const getOrderStatusDistribution = async (req, res) => {
  try {
    console.log("\n========== ORDER STATUS DISTRIBUTION API ==========");
    console.log("Method:", req.method);
    console.log("URL:", req.originalUrl);
    console.log("User:", req.user?.id, req.user?.email);
    console.log("Timestamp:", new Date().toISOString());
    
    // ✅ Aggregation pipeline to count orders by status
    const statusCounts = await Order.aggregate([
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      },
      {
        $sort: { count: -1 }
      }
    ]);
    
    console.log("📊 Status Counts:", JSON.stringify(statusCounts, null, 2));
    
    // ✅ Define all possible statuses with default 0
    const allStatuses = ['pending', 'processing', 'shipped', 'completed', 'cancelled'];
    const statusMap = {};
    
    // Initialize with 0
    allStatuses.forEach(status => {
      statusMap[status] = 0;
    });
    
    // Fill with actual counts
    statusCounts.forEach(item => {
      statusMap[item._id] = item.count;
    });
    
    const responseData = {
      pending: statusMap['pending'],
      processing: statusMap['processing'],
      shipped: statusMap['shipped'],
      completed: statusMap['completed'],
      cancelled: statusMap['cancelled'],
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
      message: 'Server error'
    });
  }
};

// ✅ Add to module exports
module.exports = {
  getDashboardMetrics,
  getRecentActivities,
  getAlerts,
  getStockMovementChart,
  getCategoryDistribution,
  getTopProducts,
  getOrderStatusDistribution // ✅ NEW
};
