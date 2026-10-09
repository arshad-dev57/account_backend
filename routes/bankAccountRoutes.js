const express = require('express');
const {
  createBankAccount,
  getBankAccounts,
  getBankAccount,
  updateBankAccount,
  deleteBankAccount,
  updateBalance,
  depositToBankAccount,
  getBankAccountsStats,
  getBankAccountTransactions,
} = require('../controllers/bankAccountController');
const { protect } = require('../middleware/authMiddleware');
const { requirePermission } = require('../middleware/rbacMiddleware');

const router = express.Router();

router.use(protect);

router.route('/')
  .get(requirePermission('accounting.bank_accounts.view'), getBankAccounts)
  .post(requirePermission('accounting.bank_accounts.create'), createBankAccount);

// Static paths before :id
router.get('/stats', requirePermission('accounting.bank_accounts.view'), getBankAccountsStats);
router.get('/summary', requirePermission('accounting.bank_accounts.view'), getBankAccountsStats);

router.get('/:id/transactions', requirePermission('accounting.bank_accounts.view'), getBankAccountTransactions);

router.route('/:id')
  .get(requirePermission('accounting.bank_accounts.view'), getBankAccount)
  .put(requirePermission('accounting.bank_accounts.edit'), updateBankAccount)
  .delete(requirePermission('accounting.bank_accounts.delete'), deleteBankAccount);

router.route('/:id/balance')
  .put(requirePermission('accounting.bank_accounts.edit'), updateBalance);

router.post('/:id/deposit', requirePermission('accounting.bank_accounts.edit'), depositToBankAccount);

module.exports = router;
