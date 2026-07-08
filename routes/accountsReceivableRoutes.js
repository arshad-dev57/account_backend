// routes/accountsReceivableRoutes.js

const express = require('express');
const {
  createCustomer,
  getCustomers,
  getCustomer,
  updateCustomer,
  deleteCustomer,
  createInvoice,
  getInvoices,
  getInvoice,
  recordPayment,
  getSummary,
  getAgedReceivables,
  getUnpaidInvoices,
} = require('../controllers/accountsReceivableController');
const { protect } = require('../middleware/authMiddleware');

const router = express.Router();

// ─── All routes require authentication ──────────────────────────
router.use(protect);

// ─── Summary Routes ──────────────────────────────────────────────
router.get('/summary', getSummary);
router.get('/aged', getAgedReceivables);

// ─── Customer Routes ─────────────────────────────────────────────
router.route('/customers')
  .get(getCustomers)
  .post(createCustomer);

router.route('/customers/:id')
  .get(getCustomer)
  .put(updateCustomer)
  .delete(deleteCustomer);

// ✅ Get unpaid invoices for a customer
router.get('/customers/:customerId/invoices/unpaid', getUnpaidInvoices);

// ─── Invoice Routes ──────────────────────────────────────────────
router.route('/invoices')
  .get(getInvoices)
  .post(createInvoice);

router.route('/invoices/:id')
  .get(getInvoice);

// ─── Payment Routes ──────────────────────────────────────────────
router.post('/payments', recordPayment);

module.exports = router;