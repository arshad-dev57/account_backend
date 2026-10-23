
const express = require('express');
const router = express.Router();
const { protect } = require('../../middleware/authMiddleware');

const {

  getSupplierInvoices,
  makePayment,
  getPayments,
  getPaymentById,
  getPaymentByNumber,
  cancelPayment,
  getPaymentStats,
  getPaymentVoucher,
  deletePayment,
  updatePayment,
} = require('../controller/purchasePaymentController');
router.use(protect);

router.get('/stats', getPaymentStats);
router.get('/supplier/:supplierId/invoices', getSupplierInvoices);
router.post('/make', makePayment);
router.post('/:id/cancel', cancelPayment);
router.get('/:id/voucher', getPaymentVoucher);
router.get('/', getPayments);
router.get('/number/:paymentNumber', getPaymentByNumber);
router.get('/:id', getPaymentById);
router.put('/:id', updatePayment);
router.delete('/:id', deletePayment);
module.exports = router;