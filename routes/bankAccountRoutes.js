const express = require('express');
const {
  createBankAccount,
  getBankAccounts,
  getBankAccount,
  updateBankAccount,
  deleteBankAccount,
  updateBalance,
} = require('../controllers/bankAccountController');
const { protect } = require('../middleware/authMiddleware');

const router = express.Router();

// All routes are protected
router.use(protect);

router.route('/')
  .get(getBankAccounts)
  .post(createBankAccount);

router.route('/:id')
  .get(getBankAccount)
  .put(updateBankAccount)
  .delete(deleteBankAccount);

router.route('/:id/balance')
  .put(updateBalance);

module.exports = router;