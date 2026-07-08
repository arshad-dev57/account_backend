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
  deletePayment
} = require('../controller/salesPaymentController');

// ─── All routes protected ──────────────────────────────────────
router.use(protect);

// ============================================================
// ─── PAYMENT STATS ROUTES ──────────────────────────────────
// ============================================================

// Get payment stats
router.get('/stats', getPaymentStats);

// ============================================================
// ─── CUSTOMER INVOICE ROUTES ──────────────────────────────
// ============================================================

// Get customer invoices for payment
router.get('/customer/:customerId/invoices', getCustomerInvoices);

// ============================================================
// ─── PAYMENT ACTION ROUTES ────────────────────────────────
// ============================================================

// Receive payment
router.post('/receive', receivePayment);

// Cancel payment
router.post('/:id/cancel', cancelPayment);

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