const express = require('express');
const {
  getCashFlowStatement,
  getSummary,
} = require('../controllers/cashFlowController');
const { protect } = require('../middleware/authMiddleware');

const router = express.Router();

// Protect all routes
router.use(protect);

// Main cash flow route
router.get('/', getCashFlowStatement);

// Summary stats
router.get('/summary', getSummary);

module.exports = router;