// routes/expenseRoutes.js - UPDATED

const express = require('express');
const router = express.Router();
const {
  createExpense,
  getExpenses,
  getExpense,
  updateExpense,
  deleteExpense,
  getSummary,
  postExpense,
  getExpenseAccounts  // ✅ NEW
} = require('../controllers/expenseController');
const { protect } = require('../middleware/authMiddleware');

// ─── All routes are protected ──────────────────────────────────────
router.use(protect);

// ─── EXPENSE ACCOUNTS (NEW) ────────────────────────────────────────
router.get('/accounts', getExpenseAccounts);

// ─── CRUD OPERATIONS ───────────────────────────────────────────────
router.post('/', createExpense);
router.get('/', getExpenses);
router.get('/summary', getSummary);
router.get('/:id', getExpense);
router.put('/:id', updateExpense);
router.delete('/:id', deleteExpense);
router.post('/:id/post', postExpense);

module.exports = router;