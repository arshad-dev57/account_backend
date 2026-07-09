// warehouse/routes/purchaseReturnRoutes.js - COMPLETE

const express = require('express');
const router = express.Router();
const { protect } = require('../../middleware/authMiddleware');
const {
  getInvoiceProducts,
  getSupplierInvoices,
  createDraftReturn,
  processReturn,
  cancelReturn,
  getReturns,
  getReturnById,
  getReturnByNumber,
  getReturnStats,
  getReturnNote,
  deleteReturn
} = require('../controller/purchaseReturnController');

// ─── All routes protected ──────────────────────────────────────
router.use(protect);

// ============================================================
// ─── RETURN STATS ROUTES ──────────────────────────────────────
// ============================================================

// Get return stats
router.get('/stats', getReturnStats);

// ============================================================
// ─── SUPPLIER INVOICE ROUTES ──────────────────────────────────
// ============================================================

// Get supplier invoices for return
router.get('/supplier/:supplierId/invoices', getSupplierInvoices);

// Get invoice products for return
router.get('/invoice/:invoiceId/products', getInvoiceProducts);

// ============================================================
// ─── RETURN ACTION ROUTES ─────────────────────────────────────
// ============================================================

// Create draft return
router.post('/draft', createDraftReturn);

// Process return
router.post('/:id/process', processReturn);

// Cancel return
router.post('/:id/cancel', cancelReturn);

// Get return note for printing
router.get('/:id/note', getReturnNote);

// ============================================================
// ─── CRUD ROUTES ──────────────────────────────────────────────
// ============================================================

// Get all returns with filters
router.get('/', getReturns);

// Get return by number
router.get('/number/:returnNumber', getReturnByNumber);

// Get return by ID
router.get('/:id', getReturnById);

// Delete return (soft delete)
router.delete('/:id', deleteReturn);

module.exports = router;