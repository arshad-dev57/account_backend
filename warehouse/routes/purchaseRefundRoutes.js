// Purchase refund routes — mounted at /api/purchase/refunds
const express = require('express');
const router = express.Router();
const { protect } = require('../../middleware/authMiddleware');
const {
  createPurchaseRefund,
  getPurchaseRefunds,
  getRefundById,
  getRefundByNumber,
  getPurchaseRefundsByPurchase,
  updateRefund,
  processRefund,
  completeRefund,
  cancelRefund,
  deleteRefund,
  getRefundStats,
  searchRefunds,
} = require('../controller/refundController');

router.use(protect);

// Static routes before /:id
router.get('/stats', getRefundStats);
router.get('/search', searchRefunds);
router.get('/number/:refundNumber', getRefundByNumber);
router.get('/by-purchase/:purchaseId', getPurchaseRefundsByPurchase);

router.get('/', getPurchaseRefunds);
router.post('/', createPurchaseRefund);

router.put('/:id', updateRefund);
router.patch('/:id/process', processRefund);
router.patch('/:id/complete', completeRefund);
router.patch('/:id/cancel', cancelRefund);
router.delete('/:id', deleteRefund);
router.get('/:id', getRefundById);

module.exports = router;
