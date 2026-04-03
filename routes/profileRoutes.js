const express = require('express');
const {
  getProfile,
  updateProfile,
} = require('../controllers/profileController');
const { protect } = require('../middleware/authMiddleware');

const router = express.Router();

// All profile routes require authentication
router.use(protect);

// Get profile
router.get('/', getProfile);

// Update profile
router.put('/', updateProfile);

module.exports = router;