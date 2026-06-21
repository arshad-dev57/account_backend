// routes/inventoryRoutes.js

const express = require('express');
const router = express.Router();
const { protect } = require('../../middleware/authMiddleware');
const {
  getInventoryValuation,
  getValuationSummary,
  getCategoryBreakdown
} = require('../controller/inventory_controller');

// All routes are protected
router.use(protect);

// Inventory valuation routes
router.get('/valuation', getInventoryValuation);
router.get('/valuation/summary', getValuationSummary);
router.get('/valuation/categories', getCategoryBreakdown);

module.exports = router;