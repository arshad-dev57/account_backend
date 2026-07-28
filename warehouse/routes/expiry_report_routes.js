const express = require('express');
const router = express.Router();
const { protect } = require('../../middleware/authMiddleware');
const { getExpiryReport } = require('../controller/expiry_report_controller');

// All routes are protected
router.use(protect);

// Get expiry report
router.get('/', getExpiryReport);

module.exports = router;
