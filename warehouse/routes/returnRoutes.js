// warehouse/routes/returnRoutes.js - COMPLETE ROUTES (FIXED ORDERING + BASE ROUTE)

const express = require('express');
const router = express.Router();
const { protect } = require('../../middleware/authMiddleware');
const {
  // Sales Returns
  createSalesReturn,
  getSalesReturns,

  // Purchase Returns
  createPurchaseReturn,
  getPurchaseReturns,

  // Shared
  getReturnById,
  approveReturn,
  rejectReturn,
  completeReturn,
  cancelReturn,
  deleteReturn,
  getReturnStats,
  getReturnsByOrder
} = require('../controller/returnController');

// ─── All routes protected ──────────────────────────────────────
router.use(protect);

// ─── IMPORTANT: specific/static routes MUST come before '/:id' ──
// Express matches top-down, and '/:id' will swallow any single-segment
// path (like '/stats') if it's declared earlier.

// Get return stats
router.get('/stats', getReturnStats);

// Get returns by order
router.get('/order/:orderId', getReturnsByOrder);

// Create Sales Return
router.post('/sales', createSalesReturn);

// Get all Sales Returns
router.get('/sales', getSalesReturns);

// Create Purchase Return
router.post('/purchase', createPurchaseReturn);

// Get all Purchase Returns
router.get('/purchase', getPurchaseReturns);

// ─── Base route: this is what your Flutter SalesReturnController hits ──
// fetchReturns() -> GET  /api/warehouse/returns
// createReturn()  -> POST /api/warehouse/returns
// Point these at your sales-return handlers (or a combined handler if you
// want '/' to return both sales + purchase returns together).
router.get('/', getSalesReturns);
router.post('/', createSalesReturn);

// Approve return
router.patch('/:id/approve', approveReturn);

// Reject return
router.patch('/:id/reject', rejectReturn);

// Complete return
router.patch('/:id/complete', completeReturn);

// Cancel return (Flutter's ApiClient.patch() hits this, so method must be PATCH, not POST)
router.patch('/:id/cancel', cancelReturn);

// Delete return (soft delete)
router.delete('/:id', deleteReturn);

// Get return by id (must be LAST among GET '/:something' routes)
router.get('/:id', getReturnById);

module.exports = router;