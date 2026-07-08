const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const {
  createLoan,
  getLoans,
  getLoan,
  updateLoan,
  recordPayment,
  calculateEMI,
  calculatePrepayment,
  prepayLoan,
  getSummary,
  getPaymentSchedule,
  deleteLoan
} = require('../controllers/loanController');

// ─── Protected Routes ─────────────────────────────────────────────
router.use(protect);

// ─── CRUD Operations ──────────────────────────────────────────────
router.post('/', createLoan);
router.get('/', getLoans);
router.get('/summary', getSummary);
router.get('/:id', getLoan);
router.put('/:id', updateLoan);
router.delete('/:id', deleteLoan);

// ─── Payment Operations ───────────────────────────────────────────
router.post('/payment', recordPayment);
router.post('/calculate-emi', calculateEMI);
router.post('/calculate-prepayment', calculatePrepayment);
router.post('/prepay', prepayLoan);
router.get('/:id/schedule', getPaymentSchedule);

module.exports = router;