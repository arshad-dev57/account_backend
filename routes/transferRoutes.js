const express = require('express');
const {
  transferMoney,
  getTransferHistory,
  getTransferDetails,
} = require('../controllers/transferController');
const { protect } = require('../middleware/authMiddleware');

const router = express.Router();

// All routes are protected
router.use(protect);

// Transfer money
router.post('/', transferMoney);

// Get transfer history
router.get('/', getTransferHistory);

// Get transfer details
router.get('/:id', getTransferDetails);

module.exports = router;