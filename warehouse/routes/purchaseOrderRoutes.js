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
  sendPurchaseOrderWithInvoice,
  cancelPurchaseOrder,
  deletePurchaseOrder,
  getPurchaseOrderStats,
  getSupplierPurchaseOrderSummary,
  getPurchaseOrderSummary
}
 = require('../controller/purchaseOrderController');
router.use(protect);
router.get('/stats', getPurchaseOrderStats);
router.get('/summary', getPurchaseOrderSummary);
router.get('/supplier/:supplierId/summary', getSupplierPurchaseOrderSummary);
router.post('/', createPurchaseOrder);
router.post('/:id/send', sendPurchaseOrder);
router.post('/:id/send-with-invoice', sendPurchaseOrderWithInvoice);
router.post('/:id/cancel', cancelPurchaseOrder);
router.patch('/:id/status', updatePurchaseOrderStatus);
router.get('/', getPurchaseOrders);
router.get('/number/:orderNumber', getPurchaseOrderByNumber);
router.get('/:id', getPurchaseOrderById);
router.put('/:id', updatePurchaseOrder);
router.delete('/:id', deletePurchaseOrder);
module.exports = router;