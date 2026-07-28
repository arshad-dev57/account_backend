const express = require('express');
const router = express.Router();
const { protect } = require('../../middleware/authMiddleware');
const { getLowStockReport } = require('../controller/low_stock_report_controller');

// All routes are protected
router.use(protect);

// Get low stock report
router.get('/', getLowStockReport);

module.exports = router;
