// routes/dashboardRoutes.js

const express = require('express');
const router = express.Router();
const { protect } = require('../../middleware/authMiddleware');
const {
  getDashboardMetrics,
  getRecentActivities,
  getAlerts,
  getStockMovementChart,
  getCategoryDistribution,
  getTopProducts,
    getOrderStatusDistribution // ✅ NEW

} = require('../controller/warehouse_dashboard_controller');

router.use(protect);

router.get('/metrics', getDashboardMetrics);
router.get('/activities', getRecentActivities);
router.get('/alerts', getAlerts);
router.get('/charts/stock-movement', getStockMovementChart);
router.get('/charts/categories', getCategoryDistribution);
router.get('/charts/top-products', getTopProducts);
router.get('/charts/order-status', getOrderStatusDistribution);


module.exports = router;