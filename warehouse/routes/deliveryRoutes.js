// warehouse/routes/deliveryRoutes.js - COMPLETE DELIVERY ROUTES

const express = require('express');
const router = express.Router();
const { protect } = require('../../middleware/authMiddleware');
const {
  createDelivery,
  confirmDelivery,
  getDeliveryById,
  getDeliveryByNumber,
  getDeliveriesByOrder,
  getDeliveries,
  updateDelivery,
  deleteDelivery,
  getDeliveryStats,
  getDeliveryKPI,
  getProductDeliverySummary,
  getAvailableOrdersForDelivery
} = require('../controller/deliveryController');

// ─── All routes protected ──────────────────────────────────────
router.use(protect);

// ============================================================
// ─── DELIVERY ROUTES ──────────────────────────────────────────
// ============================================================

// Get available orders for delivery
router.get('/available-orders', getAvailableOrdersForDelivery);

// Get delivery statistics
router.get('/stats', getDeliveryStats);

// Get delivery KPI
router.get('/kpi', getDeliveryKPI);

// Get product delivery summary
router.get('/product-summary', getProductDeliverySummary);

// Create delivery
router.post('/', createDelivery);

// Get all deliveries with filters
router.get('/', getDeliveries);

// Get delivery by delivery number
router.get('/number/:deliveryNumber', getDeliveryByNumber);

// Confirm delivery
router.post('/:id/confirm', confirmDelivery);

// Get delivery by ID
router.get('/:id', getDeliveryById);

// Update delivery
router.put('/:id', updateDelivery);

// Delete delivery (soft delete)
router.delete('/:id', deleteDelivery);

// Get deliveries by sales order
router.get('/order/:orderId', getDeliveriesByOrder);

module.exports = router;