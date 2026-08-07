const express = require('express');
const router = express.Router();
const { protect } = require('../../middleware/authMiddleware');
const { getSalesDashboard, getCombinedRevenue } = require('../controller/sales_dashboard_controller');

router.use(protect);
router.get('/dashboard', getSalesDashboard);
router.get('/combined-revenue', getCombinedRevenue);

module.exports = router;
