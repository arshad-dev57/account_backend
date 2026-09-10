const express = require('express');
const router = express.Router();
const { protect } = require('../../middleware/authMiddleware');
const {
  createPurchaseRequisition,
  getPurchaseRequisitions,
  getPurchaseRequisitionById,
  updatePurchaseRequisition,
  submitPurchaseRequisition,
  approvePurchaseRequisition,
  rejectPurchaseRequisition,
  cancelPurchaseRequisition,
  deletePurchaseRequisition,
  getPurchaseRequisitionStats,
  convertToPurchaseOrder,
} = require('../controller/purchaseRequisitionController');

router.use(protect);

router.get('/stats', getPurchaseRequisitionStats);
router.post('/', createPurchaseRequisition);
router.post('/:id/submit', submitPurchaseRequisition);
router.post('/:id/approve', approvePurchaseRequisition);
router.post('/:id/reject', rejectPurchaseRequisition);
router.post('/:id/cancel', cancelPurchaseRequisition);
router.post('/:id/convert-to-po', convertToPurchaseOrder);
router.get('/', getPurchaseRequisitions);
router.get('/:id', getPurchaseRequisitionById);
router.put('/:id', updatePurchaseRequisition);
router.delete('/:id', deletePurchaseRequisition);

module.exports = router;
