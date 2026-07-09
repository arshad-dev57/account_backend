// warehouse/routes/purchasePaymentRoutes.js - COMPLETE

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
  deletePayment
} = require('../controller/purchasePaymentController');

// ─── All routes protected ──────────────────────────────────────
router.use(protect);

// ============================================================
// ─── PAYMENT STATS ROUTES ──────────────────────────────────
// ============================================================

// Get payment stats
router.get('/stats', getPaymentStats);

// ============================================================
// ─── SUPPLIER INVOICE ROUTES ──────────────────────────────
// ============================================================

// Get supplier invoices for payment
router.get('/supplier/:supplierId/invoices', getSupplierInvoices);

// ============================================================
// ─── PAYMENT ACTION ROUTES ────────────────────────────────
// ============================================================

// Make payment to supplier
router.post('/make', makePayment);

// Cancel payment
router.post('/:id/cancel', cancelPayment);

// Get payment voucher
router.get('/:id/voucher', getPaymentVoucher);

// ============================================================
// ─── CRUD ROUTES ────────────────────────────────────────────
// ============================================================

// Get all payments with filters
router.get('/', getPayments);

// Get payment by number
router.get('/number/:paymentNumber', getPaymentByNumber);

// Get payment by ID
router.get('/:id', getPaymentById);

// Delete payment (soft delete)
router.delete('/:id', deletePayment);

module.exports = router;