const express = require('express');
const {
  createBankAccount,
  getBankAccounts,
  getBankAccount,
  updateBankAccount,
  deleteBankAccount,
  updateBalance,
  depositToBankAccount,
  getBankAccountsStats
} = require('../controllers/bankAccountController');
const { protect } = require('../middleware/authMiddleware');

const router = express.Router();

router.use(protect);

router.route('/')
  .get(getBankAccounts)
  .post(createBankAccount);

// Static paths before :id
router.get('/stats', getBankAccountsStats);
router.get('/summary', getBankAccountsStats);

router.route('/:id')
  .get(getBankAccount)
  .put(updateBankAccount)
  .delete(deleteBankAccount);

router.route('/:id/balance')
  .put(updateBalance);

router.post('/:id/deposit', depositToBankAccount);

module.exports = router;
