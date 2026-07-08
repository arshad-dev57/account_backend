const express = require('express');
const router = express.Router();
const { protect } = require('../../middleware/authMiddleware');
const {
  getPurchases,
  getPurchaseById,
  getPurchaseStats,
  createPurchase,
  updatePurchaseStatus,
  receivePurchase,
  deletePurchase,
} = require('../controller/warehouse_purchase_controller');

router.use(protect);

router.get('/stats', getPurchaseStats);
router.get('/', getPurchases);
router.get('/:id', getPurchaseById);
router.post('/', createPurchase);
router.patch('/:id/status', updatePurchaseStatus);
router.post('/:id/receive', receivePurchase);
router.delete('/:id', deletePurchase);

module.exports = router;
