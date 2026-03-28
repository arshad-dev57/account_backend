const express = require('express');
const {
  createLoan,
  getLoans,
  getLoan,
  updateLoan,
  deleteLoan,
  recordPayment,
  calculateEMI,
  calculatePrepayment,
  prepayLoan,
  getSummary,
  getPaymentSchedule,
} = require('../controllers/loanController');
const { protect } = require('../middleware/authMiddleware');

const router = express.Router();

// Protect all routes
router.use(protect);

// Summary route
router.get('/summary', getSummary);

// EMI calculator
router.post('/calculate-emi', calculateEMI);

// Payment routes
router.post('/payment', recordPayment);
router.post('/prepayment/calculate', calculatePrepayment);
router.post('/prepayment', prepayLoan);

// Payment schedule
router.get('/:id/schedule', getPaymentSchedule);

// Main CRUD routes
router.route('/')
  .get(getLoans)
  .post(createLoan);

router.route('/:id')
  .get(getLoan)
  .put(updateLoan)
  .delete(deleteLoan);

module.exports = router;