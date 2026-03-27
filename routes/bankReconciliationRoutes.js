    const express = require('express');
const {
  getReconciliationData,
  completeReconciliation,
  getReconciliationHistory,
} = require('../controllers/bankReconciliationController');
const { protect } = require('../middleware/authMiddleware');

const router = express.Router();

// All routes are protected
router.use(protect);

// Get reconciliation data for an account
router.get('/:accountId', getReconciliationData);

// Complete reconciliation
router.post('/:accountId/complete', completeReconciliation);

// Get reconciliation history
router.get('/:accountId/history', getReconciliationHistory);

module.exports = router;