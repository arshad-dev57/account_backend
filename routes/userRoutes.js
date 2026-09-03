  const express = require('express');
  const router = express.Router();
  const {
    register,
    login,
    getMe,
    changePassword,
    forgotPassword,
    passwordverifyOTP,
    refreshToken,
    verifyLoginOTP,
    resendLoginOTP,
    deleteMyAccount,
    resetPassword,
    updateCurrency,
    getSessionStatus
  } = require('../controllers/userController');
  const { upload } = require('../config/cloudinary');

  // Public routes mein add karo:
  router.post('/verify-login-otp', verifyLoginOTP);
  router.post('/resend-login-otp', resendLoginOTP);
  router.post('/refresh-token', refreshToken);
  const { protect, protectOnly } = require('../middleware/authMiddleware');  // ✅ protectOnly import karo

  // ========== PUBLIC ROUTES (No authentication) ==========
  router.post('/register', upload.fields([{ name: 'logo', maxCount: 1 }, { name: 'signature', maxCount: 1 }]), register);
  router.post('/login', login);
  router.post('/forgot-password', forgotPassword);
  router.post('/verify-otp', passwordverifyOTP);
  router.post('/reset-password', resetPassword);

  // ========== PROTECTED ROUTES (Only authentication, NO subscription check) ==========
  router.get('/session-status', protectOnly, getSessionStatus);
  // ✅ Change password - sirf authentication chahiye, subscription nahi
  router.post('/change-password', protectOnly, changePassword);
  router.delete('/me', protectOnly, deleteMyAccount);

  // ========== PROTECTED ROUTES (Authentication + Subscription check) ==========
  router.get('/me', protect, getMe);
  router.put('/currency', protect, updateCurrency);

  module.exports = router;