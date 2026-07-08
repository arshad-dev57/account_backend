const express = require('express');
const router = express.Router();
const { protect } = require('../../middleware/authMiddleware');
const { getSalesDashboard } = require('../controller/sales_dashboard_controller');

router.use(protect);
router.get('/dashboard', getSalesDashboard);

module.exports = router;
