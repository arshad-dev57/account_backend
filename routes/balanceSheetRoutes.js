const express = require('express');
const {
  getBalanceSheet,
  getSummary,
} = require('../controllers/balanceSheetController');
const { protect } = require('../middleware/authMiddleware');

const router = express.Router();

// Protect all routes
router.use(protect);

// Main balance sheet route
router.get('/', getBalanceSheet);

// Summary stats
router.get('/summary', getSummary);

module.exports = router;