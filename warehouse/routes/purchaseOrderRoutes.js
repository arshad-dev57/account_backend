// warehouse/routes/purchaseOrderRoutes.js - COMPLETE

const express = require('express');
const router = express.Router();
const { protect } = require('../../middleware/authMiddleware');
const {
  createPurchaseOrder,
  getPurchaseOrders,
  getPurchaseOrderById,
  getPurchaseOrderByNumber,
  updatePurchaseOrder,
  updatePurchaseOrderStatus,
  sendPurchaseOrder,
  cancelPurchaseOrder,
  deletePurchaseOrder,
  getPurchaseOrderStats,
  getSupplierPurchaseOrderSummary,
  getPurchaseOrderSummary
} = require('../controller/purchaseOrderController');

// ─── All routes protected ──────────────────────────────────────
router.use(protect);

// ============================================================
// ─── STATISTICS ROUTES ──────────────────────────────────────
// ============================================================

// Get purchase order stats
router.get('/stats', getPurchaseOrderStats);

// Get purchase order summary
router.get('/summary', getPurchaseOrderSummary);

// Get supplier purchase order summary
router.get('/supplier/:supplierId/summary', getSupplierPurchaseOrderSummary);

// ============================================================
// ─── CREATE ROUTE ────────────────────────────────────────────
// ============================================================

// Create purchase order
router.post('/', createPurchaseOrder);

// ============================================================
// ─── ACTION ROUTES ──────────────────────────────────────────
// ============================================================

// Send purchase order (email)
router.post('/:id/send', sendPurchaseOrder);

// Cancel purchase order
router.post('/:id/cancel', cancelPurchaseOrder);

// Update purchase order status
router.patch('/:id/status', updatePurchaseOrderStatus);

// ============================================================
// ─── CRUD ROUTES ────────────────────────────────────────────
// ============================================================

// Get all purchase orders with filters
router.get('/', getPurchaseOrders);

// Get purchase order by number
router.get('/number/:orderNumber', getPurchaseOrderByNumber);

// Get purchase order by ID
router.get('/:id', getPurchaseOrderById);

// Update purchase order
router.put('/:id', updatePurchaseOrder);

// Delete purchase order (soft delete)
router.delete('/:id', deletePurchaseOrder);

module.exports = router;