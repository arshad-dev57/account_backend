const express = require('express');
const router = express.Router();
const {
  register,
  login,
  getMe,
  changePassword,
  forgotPassword,
  verifyOTP,
  resetPassword,
} = require('../controllers/userController');
const { protect, protectOnly } = require('../middleware/authMiddleware');  // ✅ protectOnly import karo

// ========== PUBLIC ROUTES (No authentication) ==========
router.post('/register', register);
router.post('/login', login);
router.post('/forgot-password', forgotPassword);
router.post('/verify-otp', verifyOTP);
router.post('/reset-password', resetPassword);

// ========== PROTECTED ROUTES (Only authentication, NO subscription check) ==========
// ✅ Change password - sirf authentication chahiye, subscription nahi
router.post('/change-password', protectOnly, changePassword);

// ========== PROTECTED ROUTES (Authentication + Subscription check) ==========
router.get('/me', protect, getMe);

module.exports = router;