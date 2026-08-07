const express = require('express');
const {
  getDashboardOverview,
  getDashboardSummary,
  getChartData,
  getExpenseCategories,
  getRecentTransactions,
  getQuickActions
} = require('../controllers/dashboardController');
const { protect } = require('../middleware/authMiddleware');

const router = express.Router();

// Protect all routes
router.use(protect);

// Unified period-scoped dashboard (KPIs + charts + categories + recent txns)
router.get('/overview', getDashboardOverview);

// Legacy endpoints (same calculation engine as /overview)
router.get('/summary', getDashboardSummary);
router.get('/chart-data', getChartData);
router.get('/expense-categories', getExpenseCategories);
router.get('/recent-transactions', getRecentTransactions);
router.get('/quick-actions', getQuickActions);

module.exports = router;
