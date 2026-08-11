const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const { getAccountingReports } = require('../controllers/accountingReportController');

router.use(protect);
router.get('/', getAccountingReports);

module.exports = router;
