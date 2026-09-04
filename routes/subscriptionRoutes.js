// routes/subscriptionRoutes.js - Complete Routes
const express = require('express');
const {
  getPlans,
  getCapacity,
  getQuote,
  upgradeSubscription,
  createSubscription,
  checkSubscription,
  cancelSubscription,
  getSubscriptionHistory,
  subscribeDirect,
  verifyGooglePlayPurchase,
  startTrial,
  validateAccess,
  getSubscriptionDetails,
  getCompanyBilling,
  getSubscriptionStats,
  searchSubscriptions
} = require('../controllers/subscriptionController');

const { protect, protectOnly } = require('../middleware/authMiddleware');

const router = express.Router();

// ═══════════════════════════════════════════════════════════
// PUBLIC / AUTH-ONLY ROUTES (no subscription check)
// ═══════════════════════════════════════════════════════════

// ─── Plans (publicly accessible once logged in) ────────────
router.get('/plans', protectOnly, getPlans);
router.get('/capacity', protectOnly, getCapacity);
router.get('/quote', protectOnly, getQuote);

// ─── Status & Validation ───────────────────────────────────
router.get('/status', protectOnly, checkSubscription);
router.get('/validate', protectOnly, validateAccess);
router.get('/details', protectOnly, getSubscriptionDetails);

// ─── Trial ────────────────────────────────────────────────
// Start a 14-day free trial (new users only)
router.post('/trial/start', protectOnly, startTrial);

// ─── Subscribe (Direct — No Stripe) ──────────────────────
router.post('/subscribe', protectOnly, subscribeDirect);
router.post('/create', protectOnly, createSubscription);
router.post('/google-play/verify', protectOnly, verifyGooglePlayPurchase);
router.post('/upgrade', protectOnly, upgradeSubscription);

// ─── Cancel ───────────────────────────────────────────────
// Immediately revokes access
router.post('/cancel', protectOnly, cancelSubscription);

// ─── History ──────────────────────────────────────────────
router.get('/history', protectOnly, getSubscriptionHistory);
router.get('/billing', protectOnly, getCompanyBilling);

// ═══════════════════════════════════════════════════════════
// ADMIN ROUTES (subscription required + auth)
// ═══════════════════════════════════════════════════════════
router.get('/stats', protect, getSubscriptionStats);
router.get('/search', protect, searchSubscriptions);

module.exports = router;