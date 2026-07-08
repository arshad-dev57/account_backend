// warehouse/routes/goodsReceivingRoutes.js - COMPLETE

const express = require('express');
const router = express.Router();
const { protect } = require('../../middleware/authMiddleware');
const {
  createGoodsReceiving,
  confirmGoodsReceiving,
  getGoodsReceivings,
  getGoodsReceivingById,
  getGoodsReceivingByNumber,
  getGoodsReceivingsByOrder,
  updateGoodsReceiving,
  deleteGoodsReceiving,
  getGoodsReceivingStats,
  getSupplierGoodsReceivingSummary,
  getAvailablePurchaseOrders,
  printGoodsReceiving
} = require('../controller/goodsReceivingController');

// ─── All routes protected ──────────────────────────────────────
router.use(protect);

// ============================================================
// ─── STATISTICS ROUTES ──────────────────────────────────────
// ============================================================

// Get goods receiving stats
router.get('/stats', getGoodsReceivingStats);

// Get supplier goods receiving summary
router.get('/supplier/:supplierId/summary', getSupplierGoodsReceivingSummary);

// Get available purchase orders for receiving
router.get('/available-orders', getAvailablePurchaseOrders);

// ============================================================
// ─── CREATE ROUTE ────────────────────────────────────────────
// ============================================================

// Create goods receiving
router.post('/', createGoodsReceiving);

// ============================================================
// ─── ACTION ROUTES ──────────────────────────────────────────
// ============================================================

// Confirm goods receiving (update inventory)
router.post('/:id/confirm', confirmGoodsReceiving);

// Print goods receiving
router.get('/:id/print', printGoodsReceiving);

// ============================================================
// ─── CRUD ROUTES ────────────────────────────────────────────
// ============================================================

// Get all goods receivings with filters
router.get('/', getGoodsReceivings);

// Get goods receiving by GRN number
router.get('/number/:grnNumber', getGoodsReceivingByNumber);

// Get goods receivings by purchase order
router.get('/order/:purchaseOrderId', getGoodsReceivingsByOrder);

// Get goods receiving by ID
router.get('/:id', getGoodsReceivingById);

// Update goods receiving (draft only)
router.put('/:id', updateGoodsReceiving);

// Delete goods receiving (soft delete)
router.delete('/:id', deleteGoodsReceiving);

module.exports = router;