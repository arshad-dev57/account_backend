// warehouse/routes/quotationRoutes.js - COMPLETE QUOTATION ROUTES

const express = require('express');
const router = express.Router();
const { protect } = require('../../middleware/authMiddleware');
const {
  createQuotation,
  getQuotations,
  getQuotationById,
  getQuotationByNumber,
  updateQuotation,
  updateQuotationStatus,
  convertQuotationToOrder,
  deleteQuotation,
  getQuotationStats,
  getCustomerQuotationSummary,
  getProductQuotationSummary,
  sendQuotation,
  printQuotation
} = require('../controller/quotationController');

// ─── All routes protected ──────────────────────────────────────
router.use(protect);

// ============================================================
// ─── QUOTATION ROUTES ──────────────────────────────────────────
// ============================================================

// Get quotation statistics
router.get('/stats', getQuotationStats);

// Get customer quotation summary
router.get('/customer-summary', getCustomerQuotationSummary);

// Get product quotation summary
router.get('/product-summary', getProductQuotationSummary);

// Create quotation
router.post('/', createQuotation);

// Get all quotations with filters
router.get('/', getQuotations);

// Get quotation by number
router.get('/number/:quotationNumber', getQuotationByNumber);

// Get quotation by ID
router.get('/:id', getQuotationById);

// Update quotation
router.put('/:id', updateQuotation);

// Update quotation status
router.patch('/:id/status', updateQuotationStatus);

// Convert quotation to sales order
router.post('/:id/convert', convertQuotationToOrder);

// Send quotation
router.post('/:id/send', sendQuotation);

// Print quotation
router.get('/:id/print', printQuotation);

// Delete quotation (soft delete)
router.delete('/:id', deleteQuotation);

module.exports = router;