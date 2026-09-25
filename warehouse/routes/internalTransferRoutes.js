// warehouse/routes/internalTransferRoutes.js
const express = require('express');
const router = express.Router();
const { protectOnly } = require('../../middleware/authMiddleware');
const ctrl = require('../controller/internalTransferController');

// All routes protected by protectOnly middleware
router.use(protectOnly);

router.get('/', ctrl.listTransfers);
router.post('/', ctrl.createTransfer);
router.get('/product-stock', ctrl.getProductStock);
router.get('/:id', ctrl.getTransfer);
router.put('/:id', ctrl.updateTransfer);
router.post('/:id/confirm', ctrl.confirmTransfer);
router.post('/:id/dispatch', ctrl.dispatchTransfer);
router.post('/:id/receive', ctrl.receiveTransfer);
router.post('/:id/complete', ctrl.completeTransfer);
router.post('/:id/cancel', ctrl.cancelTransfer);

module.exports = router;
