const express = require('express');
const {
  getProfitLossStatement,
  getBalanceSheet,
  getCashFlowStatement,
  getJournalEntries,
  getJournalEntry,
} = require('../controllers/reportsController');
const { protect } = require('../middleware/authMiddleware');

const router = express.Router();

// Protect all routes
router.use(protect);

// Report routes
router.get('/', getProfitLossStatement);
router.get('/balance-sheet', getBalanceSheet);
router.get('/cash-flow', getCashFlowStatement);

// Journal entries routes (with pagination)
router.get('/journal-entries', getJournalEntries);
router.get('/journal-entries/:id', getJournalEntry);

module.exports = router;