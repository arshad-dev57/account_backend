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

// ─── All routes protected ──────────────────────────────────────
router.use(protect);

// ============================================================
// ─── STATISTICS ROUTES ──────────────────────────────────────
// ============================================================

// Get invoice stats / KPI
router.get('/stats', getInvoiceStats);

// Get available orders for invoicing
router.get('/available-orders', getAvailableOrdersForInvoicing);

// Get available deliveries for invoicing
router.get('/available-deliveries', getAvailableDeliveriesForInvoicing);

// ============================================================
// ─── CUSTOMER SUMMARY ROUTES ──────────────────────────────
// ============================================================

// Get customer invoice summary
router.get('/customer/:customerId/summary', getCustomerInvoiceSummary);

// ============================================================
// ─── CREATE ROUTES ──────────────────────────────────────────
// ============================================================

// Create invoice from order
router.post('/from-order', createInvoiceFromOrder);

// Create invoice from delivery
router.post('/from-delivery', createInvoiceFromDelivery);

// Create manual invoice
router.post('/manual', createManualInvoice);

// Create multi-source invoice (orders and/or deliveries)
router.post('/create-multi', createMultiSourceInvoice);

// ============================================================
// ─── INVOICE ACTION ROUTES ────────────────────────────────
// ============================================================

// Post invoice (create accounting entries)
router.post('/:id/post', postInvoice);

// Cancel invoice
router.post('/:id/cancel', cancelSalesInvoice);

// Send invoice via email
router.post('/:id/send', sendInvoice);

// Print invoice
router.get('/:id/print', printInvoice);

// ============================================================
// ─── CRUD ROUTES ────────────────────────────────────────────
// ============================================================

// Get all invoices with filters
router.get('/', getSalesInvoices);

// Get invoice by number
router.get('/number/:invoiceNumber', getSalesInvoiceByNumber);

// Get invoice by ID
router.get('/:id', getSalesInvoiceById);

// Update invoice (draft only)
router.put('/:id', updateSalesInvoice);

// Delete invoice (soft delete)
router.delete('/:id', deleteSalesInvoice);

module.exports = router;