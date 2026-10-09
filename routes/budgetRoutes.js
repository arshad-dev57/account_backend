'use strict';

const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const {
  listDimensions,
  listBudgets,
  getBudget,
  createBudget,
  updateBudget,
  deleteBudget,
  setBudgetStatus,
  budgetVsActual,
} = require('../controllers/budgetController');

router.use(protect);

router.get('/dimensions', listDimensions);
router.get('/vs-actual', budgetVsActual);
router.get('/', listBudgets);
router.post('/', createBudget);
router.get('/:id', getBudget);
router.put('/:id', updateBudget);
router.patch('/:id/status', setBudgetStatus);
router.delete('/:id', deleteBudget);

module.exports = router;
