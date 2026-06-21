// routes/orderRoutes.js

const express = require('express');
const router = express.Router();
const { protect } = require('../../middleware/authMiddleware');
const {
  getOrders,
  getOrderById,
  createOrder,
  updateOrderStatus,
  getOrdersCount
} = require('../controller/order_controller');

// All routes are protected
router.use(protect);

// Order routes
router.get('/', getOrders);
router.get('/counts', getOrdersCount);
router.get('/:id', getOrderById);
router.post('/', createOrder);
router.put('/:id/status',protect, updateOrderStatus);

module.exports = router;