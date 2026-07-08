// routes/refundRoutes.js - COMPLETE SALES & PURCHASE REFUND ROUTES (FIXED ORDERING + BASE ROUTE)

const express = require('express');
const router = express.Router();
const { protect } = require('../../middleware/authMiddleware');
const {
  // Sales Refunds
  createSalesRefund,
  getSalesRefunds,

  // Purchase Refunds
  createPurchaseRefund,
  getPurchaseRefunds,

  // Shared
  getRefundById,
  getRefundByNumber,
  getOrderRefunds,
  getPurchaseRefundsByPurchase,
  updateRefund,
  processRefund,
  completeRefund,
  cancelRefund,
  deleteRefund,
  getRefundStats,
  searchRefunds
} = require('../../warehouse/controller/refundController');

// ─── All routes protected ──────────────────────────────────────
router.use(protect);

// ─── IMPORTANT: specific/static routes MUST come before '/:id' ──
// Express matches top-down; '/:id' will swallow any single-segment
// path (like '/stats' or '/search') if declared earlier.

// ============================================================
// ─── STATIC / SPECIFIC GET ROUTES (before '/:id') ────────────
// ============================================================

// Get refund stats
router.get('/stats', getRefundStats);

// Search refunds
router.get('/search', searchRefunds);

// Get refund by number
router.get('/number/:refundNumber', getRefundByNumber);

// Get refunds by order
router.get('/order/:orderId', getOrderRefunds);

// Get refunds by purchase
router.get('/purchase/:purchaseId', getPurchaseRefundsByPurchase);

// ============================================================
// ─── SALES REFUND ROUTES ──────────────────────────────────────
// ============================================================

// Create Sales Refund
router.post('/sales', createSalesRefund);

// Get all Sales Refunds
router.get('/sales', getSalesRefunds);

// ============================================================
// ─── PURCHASE REFUND ROUTES ──────────────────────────────────
// ============================================================

// Create Purchase Refund
router.post('/purchase', createPurchaseRefund);

// Get all Purchase Refunds
router.get('/purchase', getPurchaseRefunds);

// ============================================================
// ─── BASE ROUTE ───────────────────────────────────────────────
// This is what your Flutter SalesRefundController hits directly:
// fetchRefunds() -> GET  /api/sales/refunds
// createRefund()  -> POST /api/sales/refunds
// ============================================================

router.get('/', getSalesRefunds);
router.post('/', createSalesRefund);

// ============================================================
// ─── SHARED REFUND ROUTES (id-based, must stay LAST) ─────────
// ============================================================

// Update refund
router.put('/:id', updateRefund);

// Process refund
router.patch('/:id/process', processRefund);

// Complete refund
router.patch('/:id/complete', completeRefund);

// Cancel refund
router.patch('/:id/cancel', cancelRefund);

// Delete refund (soft delete)
router.delete('/:id', deleteRefund);

// Get refund by ID (must be LAST among GET '/:something' routes)
router.get('/:id', getRefundById);

module.exports = router;