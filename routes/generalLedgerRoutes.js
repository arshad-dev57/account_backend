const express = require('express');
const {
  getAccountSummaries,
  getLedgerEntries,
  getAllLedgerEntries,
} = require('../controllers/generalLedgerController');
const { protect } = require('../middleware/authMiddleware');

const router = express.Router();

// All routes are protected
router.use(protect);

// Get account summaries (for dropdown and cards)
router.get('/accounts', getAccountSummaries);

// Get all ledger entries (combined)
router.get('/all-entries', getAllLedgerEntries);

// Get entries for specific account
router.get('/entries/:accountId', getLedgerEntries);

module.exports = router;