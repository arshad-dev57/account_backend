// warehouse/routes/salesPaymentRoutes.js - COMPLETE

const express = require('express');
const router = express.Router();
const { protect } = require('../../middleware/authMiddleware');
const {
  getCustomerInvoices,
  receivePayment,
  getPayments,
  getPaymentById,
  getPaymentByNumber,
  cancelPayment,
  getPaymentStats,
  deletePayment,
  updatePayment
} = require('../controller/salesPaymentController');

router.use(protect);

router.get('/stats', getPaymentStats);
router.get('/customer/:customerId/invoices', getCustomerInvoices);

router.post('/receive', receivePayment);
router.post('/:id/cancel', cancelPayment);

router.get('/', getPayments);
router.get('/number/:paymentNumber', getPaymentByNumber);
router.get('/:id', getPaymentById);
router.put('/:id', updatePayment);
router.delete('/:id', deletePayment);

module.exports = router;