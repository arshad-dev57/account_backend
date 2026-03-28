const express = require('express');
const {
  recordPayment,
  getPayments,
  getPayment,
  getUnpaidInvoices,
  getSummary,
} = require('../controllers/paymentReceivedController');
const { protect } = require('../middleware/authMiddleware');

const router = express.Router();

router.use(protect);

// Summary
router.get('/summary', getSummary);

// Unpaid invoices for customer
router.get('/invoices/unpaid/:customerId', getUnpaidInvoices);

// Main routes
router.route('/')
  .get(getPayments)
  .post(recordPayment);

router.route('/:id')
  .get(getPayment);

module.exports = router;