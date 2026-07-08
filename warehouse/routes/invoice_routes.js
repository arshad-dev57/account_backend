const express = require('express');
const router = express.Router();
const { protect } = require('../../middleware/authMiddleware');
const {
  getInvoices,
  getInvoiceById,
  getInvoiceStats,
  createInvoice,
  createInvoiceFromOrder,
  updateInvoiceStatus,
  recordPayment,
  deleteInvoice,
} = require('../controller/warehouse_invoice_controller');

router.use(protect);

router.get('/stats', getInvoiceStats);
router.get('/', getInvoices);
router.get('/:id', getInvoiceById);
router.post('/', createInvoice);
router.post('/from-order/:id', createInvoiceFromOrder);
router.patch('/:id/status', updateInvoiceStatus);
router.patch('/:id/payment', recordPayment);
router.delete('/:id', deleteInvoice);

module.exports = router;
