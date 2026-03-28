const express = require('express');
const {
  getProfitLossStatement,
  getSummary,
  getTrendData,
} = require('../controllers/plReportController');
const { protect } = require('../middleware/authMiddleware');

const router = express.Router();

// Protect all routes
router.use(protect);

// Main report route
router.get('/', getProfitLossStatement);

// Summary stats
router.get('/summary', getSummary);

// Trend data for charts
router.get('/trend', getTrendData);

module.exports = router;