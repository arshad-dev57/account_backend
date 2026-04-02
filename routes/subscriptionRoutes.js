const express = require('express');
const {
  getPlans,
  createSubscription,
  checkSubscription,
  cancelSubscription,
  getSubscriptionHistory,
} = require('../controllers/subscriptionController');
const { protect, protectOnly } = require('../middleware/authMiddleware');

const router = express.Router();

// ========== ROUTES WITH ONLY AUTHENTICATION (NO SUBSCRIPTION CHECK) ==========
// These routes should work even if user has no active subscription

// Get subscription plans
router.get('/plans', protectOnly, getPlans);

// Check current subscription status
router.get('/status', protectOnly, checkSubscription);

// Create subscription (after payment) - IMPORTANT: No subscription check here!
router.post('/create', protectOnly, createSubscription);

// Cancel subscription
router.post('/cancel', protectOnly, cancelSubscription);

// Get subscription history
router.get('/history', protectOnly, getSubscriptionHistory);

module.exports = router;