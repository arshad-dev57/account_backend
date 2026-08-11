const express = require('express');
const router = express.Router();
const { protect } = require('../../middleware/authMiddleware');
const { getSalesDashboard, getCombinedRevenue } = require('../controller/sales_dashboard_controller');
const { getSalesReport } = require('../controller/sales_report_controller');

router.use(protect);
router.get('/dashboard', getSalesDashboard);
router.get('/combined-revenue', getCombinedRevenue);
router.get('/reports', getSalesReport);

module.exports = router;
