const express = require('express');
const router = express.Router();
const { protect } = require('../../middleware/authMiddleware');
const {
  addStock,
  removeStock,
  getStockHistory,
  getAllStockHistory,
  getTodayMovements,
  updateStockMovement,
  deleteStockMovement,
  getStockReasons,
} = require('../controller/stock_controller');
router.use(protect);

router.get('/reasons', getStockReasons);
router.post('/in', addStock);
router.post('/out', removeStock);
router.get('/movements', getAllStockHistory);
router.get('/movements/today', getTodayMovements);
router.get('/history/:productId', getStockHistory);
router.put('/:id', updateStockMovement);
router.delete('/:id', deleteStockMovement);

module.exports = router;