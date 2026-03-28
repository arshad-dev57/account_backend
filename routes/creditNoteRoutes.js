const express = require('express');
const {
  createCreditNote,
  getCreditNotes,
  getCreditNote,
  getSummary,
  getUnpaidInvoices,
  applyCreditNote,
  expireCreditNotes,
  deleteCreditNote,
} = require('../controllers/creditNoteController');
const { protect } = require('../middleware/authMiddleware');

const router = express.Router();

// Protect all routes
router.use(protect);

// Summary route
router.get('/summary', getSummary);

// Unpaid invoices for credit note creation
router.get('/unpaid-invoices/:customerId', getUnpaidInvoices);

// Apply credit note to invoice
router.post('/apply', applyCreditNote);

// Expire credit notes (admin only)
router.post('/expire', protect, expireCreditNotes);

// Main CRUD routes
router.route('/')
  .get(getCreditNotes)
  .post(createCreditNote);

router.route('/:id')
  .get(getCreditNote)
  .delete(deleteCreditNote);

module.exports = router;