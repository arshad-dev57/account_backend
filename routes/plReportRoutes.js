const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');

const {
  getProfitLossStatement,
  getSummary,
  getTrendData,
  getBalanceSheet,
  getCashFlowStatement
} = require('../controllers/plReportController');

// ─── Protected Routes ─────────────────────────────────────────────
router.use(protect);

// ─── Profit & Loss ────────────────────────────────────────────────
router.get('/profit-loss', getProfitLossStatement);
router.get('/profit-loss/summary', getSummary);

// ─── Trend Data ──────────────────────────────────────────────────
router.get('/trend', getTrendData);

// ─── Balance Sheet ────────────────────────────────────────────────
router.get('/balance-sheet', getBalanceSheet);

// ─── Cash Flow ────────────────────────────────────────────────────
router.get('/cash-flow', getCashFlowStatement);

module.exports = router;