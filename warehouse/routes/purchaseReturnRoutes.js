// warehouse/routes/purchaseReturnRoutes.js - COMPLETE

const express = require('express');
const router = express.Router();
const { protect } = require('../../middleware/authMiddleware');
const {
  getGRNProducts,
  getSupplierGRNs,
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

router.get('/stats', getReturnStats);

router.get('/supplier/:supplierId/grns', getSupplierGRNs);

router.get('/grn/:grnId/products', getGRNProducts);
router.get('/supplier/:supplierId/invoices', getSupplierInvoices);

router.get('/invoice/:invoiceId/products', getInvoiceProducts);

router.post('/draft', createDraftReturn);
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