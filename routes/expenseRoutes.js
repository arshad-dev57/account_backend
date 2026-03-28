const express = require('express');
const {
  createExpense,
  getExpenses,
  getExpense,
  updateExpense,
  deleteExpense,
  getSummary,
  postExpense,
} = require('../controllers/expenseController');
const { protect } = require('../middleware/authMiddleware');

const router = express.Router();

// Protect all routes
router.use(protect);

// Summary route
router.get('/summary', getSummary);

// Post expense (draft to posted)
router.post('/:id/post', postExpense);

// Main CRUD routes with pagination
router.route('/')
  .get(getExpenses)  // Supports pagination via query params: ?page=1&limit=20
  .post(createExpense);

router.route('/:id')
  .get(getExpense)
  .put(updateExpense)
  .delete(deleteExpense);

module.exports = router;