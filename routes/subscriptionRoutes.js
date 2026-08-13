// routes/subscriptionRoutes.js - Complete Routes
const express = require('express');
const {
  getPlans,
  createSubscription,
  checkSubscription,
  cancelSubscription,
  getSubscriptionHistory,
  subscribeDirect,
  startTrial,
  validateAccess,
  getSubscriptionDetails,
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

// ─── Status & Validation ───────────────────────────────────
router.get('/status', protectOnly, checkSubscription);
router.get('/validate', protectOnly, validateAccess);
router.get('/details', protectOnly, getSubscriptionDetails);

// ─── Trial ────────────────────────────────────────────────
// Start a 30-day free trial (new users only)
router.post('/trial/start', protectOnly, startTrial);

// ─── Subscribe (Direct — No Stripe) ──────────────────────
// Press button → subscription is immediately activated
router.post('/subscribe', protectOnly, subscribeDirect);   // ✅ Primary
router.post('/create', protectOnly, createSubscription);   // Alias/fallback

// ─── Cancel ───────────────────────────────────────────────
// Immediately revokes access
router.post('/cancel', protectOnly, cancelSubscription);

// ─── History ──────────────────────────────────────────────
router.get('/history', protectOnly, getSubscriptionHistory);

// ═══════════════════════════════════════════════════════════
// ADMIN ROUTES (subscription required + auth)
// ═══════════════════════════════════════════════════════════
router.get('/stats', protect, getSubscriptionStats);
router.get('/search', protect, searchSubscriptions);

module.exports = router;