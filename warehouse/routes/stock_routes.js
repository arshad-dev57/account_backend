// routes/stockRoutes.js

const express = require('express');
const router = express.Router();
const { protect } = require('../../middleware/authMiddleware');
const {
  addStock,
  removeStock,
  getStockHistory,
  getAllStockHistory,
  getTodayMovements
} = require('../controller/stock_controller');

// All routes are protected
router.use(protect);

// Stock routes
router.post('/in', addStock);
router.post('/out', removeStock);

// 🔥 IMPORTANT: Specific routes FIRST, then parameterized routes
router.get('/history/all', getAllStockHistory);        // 👈 Add this
router.get('/movements/today', getTodayMovements);     // 👈 Add this (optional)
router.get('/history/:productId', getStockHistory);    // 👈 This comes AFTER

module.exports = router;