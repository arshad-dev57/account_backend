// warehouse/routes/purchase_report_routes.js
const express = require('express');
const router = express.Router();
const { protect } = require('../../middleware/authMiddleware');
const { getPurchaseReport } = require('../controller/purchase_report_controller');

router.use(protect);
router.get('/', getPurchaseReport);

module.exports = router;
