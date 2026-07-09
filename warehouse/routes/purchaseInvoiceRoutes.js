// warehouse/routes/purchaseInvoiceRoutes.js - COMPLETE

const express = require('express');
const router = express.Router();
const { protect } = require('../../middleware/authMiddleware');
const {
  createInvoiceFromGRN,
  createInvoiceFromPurchaseOrder,
  postPurchaseInvoice,
  getPurchaseInvoices,
  getPurchaseInvoiceById,
  getPurchaseInvoiceByNumber,
  updatePurchaseInvoice,
  cancelPurchaseInvoice,
  deletePurchaseInvoice,
  getPurchaseInvoiceStats,
  getSupplierPurchaseInvoiceSummary,
  getAvailableGRNsForInvoicing,
  getAvailablePOsForInvoicing,
  printPurchaseInvoice
} = require('../controller/purchaseInvoiceController');

// ─── All routes protected ──────────────────────────────────────
router.use(protect);

// ============================================================
// ─── STATISTICS ROUTES ──────────────────────────────────────
// ============================================================

// Get purchase invoice stats
router.get('/stats', getPurchaseInvoiceStats);

// Get supplier purchase invoice summary
router.get('/supplier/:supplierId/summary', getSupplierPurchaseInvoiceSummary);

// ============================================================
// ─── AVAILABLE SOURCES ROUTES ──────────────────────────────
// ============================================================

// Get available GRNs for invoicing
router.get('/available-grns', getAvailableGRNsForInvoicing);

// Get available purchase orders for invoicing
router.get('/available-pos', getAvailablePOsForInvoicing);

// ============================================================
// ─── CREATE ROUTES ──────────────────────────────────────────
// ============================================================

// Create invoice from Goods Receiving
router.post('/from-grn', createInvoiceFromGRN);

// Create invoice from Purchase Order
router.post('/from-po', createInvoiceFromPurchaseOrder);

// ============================================================
// ─── ACTION ROUTES ──────────────────────────────────────────
// ============================================================

// Post purchase invoice (create accounting entries)
router.post('/:id/post', postPurchaseInvoice);

// Cancel purchase invoice
router.post('/:id/cancel', cancelPurchaseInvoice);

// Print purchase invoice
router.get('/:id/print', printPurchaseInvoice);

// ============================================================
// ─── CRUD ROUTES ────────────────────────────────────────────
// ============================================================

// Get all purchase invoices with filters
router.get('/', getPurchaseInvoices);

// Get purchase invoice by number
router.get('/number/:invoiceNumber', getPurchaseInvoiceByNumber);

// Get purchase invoice by ID
router.get('/:id', getPurchaseInvoiceById);

// Update purchase invoice (draft only)
router.put('/:id', updatePurchaseInvoice);

// Delete purchase invoice (soft delete)
router.delete('/:id', deletePurchaseInvoice);

module.exports = router;