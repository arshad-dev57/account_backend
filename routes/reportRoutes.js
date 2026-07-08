const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/AuthMiddleware');
const {
  getProfitLossStatement,
  getBalanceSheet,
  getCashFlowStatement,
  getJournalEntries,
  getJournalEntry
} = require('../controllers/reportsController');

// ─── Protected Routes ─────────────────────────────────────────────
router.use(protect);

// ─── Profit & Loss ────────────────────────────────────────────────
router.get('/profit-loss', getProfitLossStatement);

// ─── Balance Sheet ────────────────────────────────────────────────
router.get('/balance-sheet', getBalanceSheet);

// ─── Cash Flow ────────────────────────────────────────────────────
router.get('/cash-flow', getCashFlowStatement);

// ─── Journal Entries ──────────────────────────────────────────────
router.get('/journal-entries', getJournalEntries);
router.get('/journal-entries/:id', getJournalEntry);

module.exports = router;