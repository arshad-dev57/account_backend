// warehouse/routes/transactionRoutes.js

const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const {
  createTransaction,
  getTransactions,
  getTransactionById,
  getTransactionByNumber,
  updateTransaction,
  deleteTransaction,
  getTransactionSummary,
  getTransactionCategories,
  getTransactionStats
} = require('../controllers/transactionController'); // ✅ Correct path

// ─── All routes protected ──────────────────────────────────────
router.use(protect);

// ─── Stats & Categories Routes ──────────────────────────────
router.get('/stats', getTransactionStats);
router.get('/summary', getTransactionSummary);
router.get('/categories', getTransactionCategories);

// ─── CRUD Routes ──────────────────────────────────────────────
router.get('/', getTransactions);
router.get('/number/:transactionNumber', getTransactionByNumber);
router.post('/', createTransaction);
router.get('/:id', getTransactionById);
router.put('/:id', updateTransaction);
router.delete('/:id', deleteTransaction);

module.exports = router;