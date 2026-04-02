const express = require('express');
const {
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

// Dashboard summary
router.get('/summary', getDashboardSummary);

// Chart data
router.get('/chart-data', getChartData);

// Expense categories
router.get('/expense-categories', getExpenseCategories);

// Recent transactions
router.get('/recent-transactions', getRecentTransactions);

// Quick actions
router.get('/quick-actions', getQuickActions);

module.exports = router;