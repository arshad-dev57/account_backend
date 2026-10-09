const express = require('express');
const {
  createEquityAccount,
  getEquityAccounts,
  getEquityAccount,
  updateEquityAccount,
  deleteEquityAccount,
  addCapital,
  recordDrawings,
  transferReserve,
  recordDividend,
  transferToRetainedEarnings,
  getSummary,
  getAllTransactions,
} = require('../controllers/equityController');
const { protect } = require('../middleware/authMiddleware');

const router = express.Router();

router.use(protect);

router.get('/summary', getSummary);
router.get('/transactions', getAllTransactions);

router.post('/add-capital', addCapital);
router.post('/record-drawings', recordDrawings);
router.post('/transfer-reserve', transferReserve);
router.post('/record-dividend', recordDividend);
router.post('/transfer-retained-earnings', transferToRetainedEarnings);

router.route('/')
  .get(getEquityAccounts)
  .post(createEquityAccount);

router.route('/:id')
  .get(getEquityAccount)
  .put(updateEquityAccount)
  .delete(deleteEquityAccount);

module.exports = router;
