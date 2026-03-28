const express = require('express');
const {
  createEquityAccount,
  getEquityAccounts,
  getEquityAccount,
  updateEquityAccount,
  deleteEquityAccount,
  addCapital,
  recordDrawings,
  transferToRetainedEarnings,
  getSummary,
  getAllTransactions,
} = require('../controllers/equityController');
const { protect } = require('../middleware/authMiddleware');

const router = express.Router();

// Protect all routes
router.use(protect);

// Summary route
router.get('/summary', getSummary);

// Transactions route
router.get('/transactions', getAllTransactions);

// Capital and Drawings routes
router.post('/add-capital', addCapital);
router.post('/record-drawings', recordDrawings);
router.post('/transfer-retained-earnings', transferToRetainedEarnings);

// Main CRUD routes
router.route('/')
  .get(getEquityAccounts)
  .post(createEquityAccount);

router.route('/:id')
  .get(getEquityAccount)
  .put(updateEquityAccount)
  .delete(deleteEquityAccount);

module.exports = router;