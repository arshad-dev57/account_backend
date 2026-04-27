// routes/subscriptionRoutes.js
const express = require('express');
const {
  getPlans,
  createSubscription,
  checkSubscription,
  cancelSubscription,
  getSubscriptionHistory,
} = require('../controllers/subscriptionController');

const {
  createCheckoutSession,
  handleWebhook,
  verifySession,
} = require('../controllers/stripeController');

const { protect, protectOnly } = require('../middleware/authMiddleware');

const router = express.Router();

// ========== EXISTING ROUTES ==========
router.get('/plans', protectOnly, getPlans);
router.get('/status', protectOnly, checkSubscription);
router.post('/create', protectOnly, createSubscription); // Manual/fallback ke liye rakho
router.post('/cancel', protectOnly, cancelSubscription);
router.get('/history', protectOnly, getSubscriptionHistory);


// ========== STRIPE ROUTES ==========

// 1. Checkout session banao → Flutter ko URL milega
router.post('/stripe/checkout', protectOnly, createCheckoutSession);

// 2. Payment success ke baad verify karo
router.get('/stripe/verify/:sessionId', protectOnly, verifySession);

module.exports = router;