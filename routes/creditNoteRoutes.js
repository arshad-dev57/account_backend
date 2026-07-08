// routes/creditNoteRoutes.js

const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const {
  createCreditNote,
  getCreditNotes,
  getCreditNote,
  getSummary,
  getUnpaidInvoices,
  applyCreditNote,
  expireCreditNotes,
  deleteCreditNote,
  voidCreditNote,
  getCreditNoteByNumber
} = require('../controllers/creditNoteController');

// ─── Protected Routes ─────────────────────────────────────────────
router.use(protect);

// ─── CRUD Operations ──────────────────────────────────────────────
router.post('/', createCreditNote);
router.get('/', getCreditNotes);
router.get('/summary', getSummary);
router.get('/:id', getCreditNote);
router.delete('/:id', deleteCreditNote);

// ─── Special Operations ───────────────────────────────────────────
router.get('/unpaid-invoices/:customerId', getUnpaidInvoices);
router.post('/apply', applyCreditNote);
router.post('/expire', expireCreditNotes);
router.post('/:id/void', voidCreditNote);
router.get('/number/:creditNumber', getCreditNoteByNumber);

module.exports = router;