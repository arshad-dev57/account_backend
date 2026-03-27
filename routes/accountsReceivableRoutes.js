const express = require('express');
const {
  // Customer CRUD
  createCustomer,
  getCustomers,
  getCustomer,
  updateCustomer,
  deleteCustomer,
  // Invoice CRUD
  createInvoice,
  getInvoices,
  getInvoice,
  // Payment
  recordPayment,
  // Summary
  getSummary,
} = require('../controllers/accountsReceivableController');
const { protect } = require('../middleware/authMiddleware');

const router = express.Router();

router.use(protect);

// Summary
router.get('/summary', getSummary);

// Customer routes
router.route('/customers')
  .get(getCustomers)
  .post(createCustomer);

router.route('/customers/:id')
  .get(getCustomer)
  .put(updateCustomer)
  .delete(deleteCustomer);

// Invoice routes
router.route('/invoices')
  .get(getInvoices)
  .post(createInvoice);

router.route('/invoices/:id')
  .get(getInvoice);

// Payment
router.post('/payments', recordPayment);

module.exports = router;