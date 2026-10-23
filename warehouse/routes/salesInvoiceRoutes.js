// warehouse/routes/salesInvoiceRoutes.js - COMPLETE SALES INVOICE ROUTES

const express = require('express');
const router = express.Router();
const { protect } = require('../../middleware/authMiddleware');
const {
  createInvoiceFromOrder,
  createInvoiceFromDelivery,
  createManualInvoice,
  createMultiSourceInvoice,
  postInvoice,
  getSalesInvoices,
  getSalesInvoiceById,
  getSalesInvoiceByNumber,
  updateSalesInvoice,
  cancelSalesInvoice,
  deleteSalesInvoice,
  getInvoiceStats,
  getCustomerInvoiceSummary,
  getAvailableOrdersForInvoicing,
  getAvailableDeliveriesForInvoicing,
  printInvoice,
  sendInvoice
} = require('../controller/salesInvoiceController');

router.use(protect);
router.get('/stats', getInvoiceStats);

router.get('/available-orders', getAvailableOrdersForInvoicing);

router.get('/available-deliveries', getAvailableDeliveriesForInvoicing);

router.get('/customer/:customerId/summary', getCustomerInvoiceSummary);

router.post('/from-order', createInvoiceFromOrder);

router.post('/from-delivery', createInvoiceFromDelivery);

router.post('/manual', createManualInvoice);

router.post('/create-multi', createMultiSourceInvoice);

router.post('/:id/post', postInvoice);

router.post('/:id/cancel', cancelSalesInvoice);

router.post('/:id/send', sendInvoice);

router.get('/:id/print', printInvoice);

router.get('/', getSalesInvoices);

router.get('/number/:invoiceNumber', getSalesInvoiceByNumber);

router.get('/:id', getSalesInvoiceById);

router.put('/:id', updateSalesInvoice);

router.delete('/:id', deleteSalesInvoice);

module.exports = router;