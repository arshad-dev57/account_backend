const express = require('express');
const {
  createAccount,
  getAccounts,
  getAccount,
  updateAccount,
  deleteAccount,
  createDefaultAccounts,
} = require('../controllers/chartOfAccountController');
const { protect } = require('../middleware/authMiddleware');

const router = express.Router();

// All routes are protected
router.use(protect);

// Default accounts route
router.post('/default', createDefaultAccounts);

// Main routes
router.route('/')
  .get(getAccounts)
  .post(createAccount);

router.route('/:id')
  .get(getAccount)
  .put(updateAccount)
  .delete(deleteAccount);

module.exports = router;