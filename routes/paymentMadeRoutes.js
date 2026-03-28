const express = require('express');
const {
  recordPayment,
  getPayments,
  getPayment,
  getUnpaidBills,
  getSummary,
} = require('../controllers/paymentMadeController');
const { protect } = require('../middleware/authMiddleware');

const router = express.Router();

router.use(protect);

// Summary
router.get('/summary', getSummary);

// Unpaid bills for vendor
router.get('/bills/unpaid/:vendorId', getUnpaidBills);

// Main routes
router.route('/')
  .get(getPayments)
  .post(recordPayment);

router.route('/:id')
  .get(getPayment);

module.exports = router;