// warehouse/routes/order_routes.js - COMPLETE ROUTES

const express = require('express');
const router = express.Router();
const { protect } = require('../../middleware/authMiddleware');
const {
  // Sales Orders
  createSalesOrder,
  getSalesOrders,
  
  // Purchase Orders
  createPurchaseOrder,
  getPurchaseOrders,
  
  // Shared
  getOrderById,
  updateOrderStatus,
  updateOrderPayment,
  cancelOrder,
  deleteOrder,
  getOrderStats,
  getOrderKPI
} = require('../controller/order_controller');

// ─── All routes protected ──────────────────────────────────────
router.use(protect);

// ─── IMPORTANT: static routes MUST come before '/:id' ──────────

// Get order stats
router.get('/stats', getOrderStats);

// Get order KPI
router.get('/kpi', getOrderKPI);

// ✅ Base GET route - Flutter SalesReturnController hits this
// GET /api/warehouse/order?search=...&limit=10
router.get('/', getSalesOrders);

// ============================================================
// ─── SALES ORDER ROUTES ──────────────────────────────────────
// ============================================================

// Create Sales Order
router.post('/sales', createSalesOrder);

// Get all Sales Orders
router.get('/sales', getSalesOrders);

// ============================================================
// ─── PURCHASE ORDER ROUTES ──────────────────────────────────
// ============================================================

// Create Purchase Order
router.post('/purchase', createPurchaseOrder);

// Get all Purchase Orders
router.get('/purchase', getPurchaseOrders);

// ============================================================
// ─── SHARED ORDER ROUTES ────────────────────────────────────
// ============================================================

// Update order status
router.patch('/:id/status', updateOrderStatus);

// Update order payment status
router.patch('/:id/payment', updateOrderPayment);

// Cancel order
router.post('/:id/cancel', cancelOrder);

// Delete order (soft delete)
router.delete('/:id', deleteOrder);

// Get single order by ID (must be LAST)
router.get('/:id', getOrderById);

module.exports = router;