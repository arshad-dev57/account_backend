const express = require('express');
const router = express.Router();
const { protect } = require('../../middleware/authMiddleware');
const {
  createInvoice,
  getInvoices,
  getInvoiceById,
  getInvoiceByNumber,
  getInvoicesByOrder,
  updateInvoice,
  applyPayment,
  markOverdueInvoices,
  deleteInvoice,
  getInvoiceStats,
} = require('../../warehouse/controller/invoiceController');

router.use(protect);

// Stats & special routes — pehle aane chahiye
router.get('/stats', getInvoiceStats);
router.get('/number/:invoiceNumber', getInvoiceByNumber);
router.get('/order/:orderId', getInvoicesByOrder);
router.patch('/mark-overdue', markOverdueInvoices);

// CRUD
router.get('/', getInvoices);
router.post('/', createInvoice);
router.get('/:id', getInvoiceById);
router.put('/:id', updateInvoice);
router.patch('/:id/payment', applyPayment);
router.delete('/:id', deleteInvoice);

module.exports = router;