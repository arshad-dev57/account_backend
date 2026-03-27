const express = require('express');
const {
  getTrialBalance,
  getTrialBalanceSummary,
} = require('../controllers/trialBalanceController');
const { protect } = require('../middleware/authMiddleware');

const router = express.Router();

router.use(protect);

router.get('/', getTrialBalance);
router.get('/summary', getTrialBalanceSummary);

module.exports = router;