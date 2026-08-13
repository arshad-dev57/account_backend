const express = require('express');
const {
  createBankAccount,
  getBankAccounts,
  getBankAccount,
  updateBankAccount,
  deleteBankAccount,
  updateBalance,
  depositToBankAccount,
  repairOpeningBalances
} = require('../controllers/bankAccountController');
const { protect } = require('../middleware/authMiddleware');

const router = express.Router();

router.use(protect);

router.route('/')
  .get(getBankAccounts)
  .post(createBankAccount);

// Static paths before :id
router.post('/repair-opening-balances', repairOpeningBalances);

router.route('/:id')
  .get(getBankAccount)
  .put(updateBankAccount)
  .delete(deleteBankAccount);

router.route('/:id/balance')
  .put(updateBalance);

router.post('/:id/deposit', depositToBankAccount);

module.exports = router;
