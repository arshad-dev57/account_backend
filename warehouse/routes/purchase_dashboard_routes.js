// warehouse/routes/purchase_dashboard_routes.js

const express = require('express');
const router = express.Router();
const { protect } = require('../../middleware/authMiddleware');
const {
  getMetrics,
  getSpendTrend,
  getOrderStatusDistribution,
  getTopSuppliers,
  getRecentActivities,
} = require('../controller/purchase_dashboard_controller');

// All routes protected
router.use(protect);

router.get('/metrics',               getMetrics);
router.get('/activities',            getRecentActivities);
router.get('/charts/spend-trend',    getSpendTrend);
router.get('/charts/order-status',   getOrderStatusDistribution);
router.get('/charts/top-suppliers',  getTopSuppliers);

module.exports = router;
