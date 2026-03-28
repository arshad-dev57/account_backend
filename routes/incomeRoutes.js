const express = require('express');
const {
  createIncome,
  getIncomes,
  getIncome,
  updateIncome,
  deleteIncome,
  getSummary,
  postIncome,
} = require('../controllers/incomeController');
const { protect } = require('../middleware/authMiddleware');

const router = express.Router();

// Protect all routes
router.use(protect);

// Summary route
router.get('/summary', getSummary);

// Post income (draft to posted)
router.post('/:id/post', postIncome);

// Main CRUD routes
router.route('/')
  .get(getIncomes)
  .post(createIncome);

router.route('/:id')
  .get(getIncome)
  .put(updateIncome)
  .delete(deleteIncome);

module.exports = router;