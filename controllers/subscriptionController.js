// controllers/subscriptionController.js - Complete Fixed Version
const User = require('../models/User');
const Subscription = require('../models/Subscription');
const prisma = require('../prisma/client');

// ─── Subscription Plans ──────────────────────────────────────────
const PLANS = [
  {
    id: 'monthly',
    name: 'Monthly Plan',
    price: 15,
    currency: 'SAR',
    duration: 'month',
    features: [
      'Full access to all features',
      'Unlimited transactions',
      'All financial reports',
      'Export to Excel/PDF',
      'Email support',
      'Data backup & security',
    ],
    isPopular: false
  },
  {
    id: 'yearly',
    name: 'Yearly Plan',
    price: 150,
    currency: 'SAR',
    duration: 'year',
    features: [
      'Full access to all features',
      'Unlimited transactions',
      'All financial reports',
      'Export to Excel/PDF',
      'Priority support (24/7)',
      'Data backup & security',
      'Advanced analytics',
      'Save 2 months FREE!',
    ],
    isPopular: true,
    savings: 'Save 16%'
  },
];

// ============================================================
// @desc    Get subscription plans
// @route   GET /api/subscription/plans
// @access  Private
// ============================================================
const getPlans = async (req, res) => {
  try {
    res.status(200).json({
      success: true,
      data: PLANS
    });
  } catch (error) {
    console.error('Error getting plans:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// ============================================================
// @desc    Direct subscription (No Stripe)
// @route   POST /api/subscription/subscribe
// @access  Private
// ============================================================
const subscribeDirect = async (req, res) => {
  try {
    const { plan, amount, paymentMethod, transactionId } = req.body;
    const userId = req.user.id;

    const companyId = req.user.companyId;
    console.log('📡 [subscribeDirect] User:', userId);
    console.log('📡 [subscribeDirect] Plan:', plan);
    console.log('💰 [subscribeDirect] Amount:', amount);

    // ─── Validate plan ─────────────────────────────────────────
    if (!plan || (plan !== 'monthly' && plan !== 'yearly')) {
      return res.status(400).json({
        success: false,
        message: 'Invalid subscription plan. Must be "monthly" or "yearly"'
      });
    }

    // ─── Get user ──────────────────────────────────────────────
    const userData = await prisma.user.findUnique({
      where: { id: userId }
    });

    if (!userData) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const user = new User(userData);

    // ─── Block only if already on a paid active subscription ──
    // Trial users CAN upgrade to a paid plan
    const isAlreadyPaid = (
      (user.subscription.plan === 'monthly' || user.subscription.plan === 'yearly') &&
      user.subscription.status === 'active' &&
      user.subscription.endDate &&
      new Date() <= new Date(user.subscription.endDate)
    );

    if (isAlreadyPaid) {
      return res.status(400).json({
        success: false,
        message: 'You already have an active paid subscription. Please cancel it first to change plans.'
      });
    }

    // ─── Calculate amount if not provided ─────────────────────
    let finalAmount = amount;
    if (!finalAmount) {
      finalAmount = plan === 'monthly' ? 15 : 150;
    }

    // ─── Activate subscription ─────────────────────────────────
    await user.activateSubscription(plan, finalAmount);

    // ─── Refresh user data ─────────────────────────────────────
    const updatedUserData = await prisma.user.findUnique({
      where: { id: userId }
    });
    const updatedUser = new User(updatedUserData);

    console.log('✅ Subscription activated for user:', userId);
    console.log('📋 Plan:', updatedUser.subscription.plan);
    console.log('📋 Status:', updatedUser.subscription.status);
    console.log('📅 EndDate:', updatedUser.subscription.endDate);

    // ─── Create subscription record ────────────────────────────
    const subscription = await Subscription.create({
      userId: userId,        // ✅ Fixed: use userId directly
      plan,
      startDate: updatedUser.subscription.startDate,
      endDate: updatedUser.subscription.endDate,
      amount: finalAmount,
      currency: 'SAR',
      paymentMethod: paymentMethod || 'direct',
      transactionId: transactionId || `TXN-${Date.now()}`,
      paymentDetails: {
        method: 'direct',
        timestamp: new Date().toISOString(),
        ...(req.body.paymentDetails || {})
      }
    });

    res.status(201).json({
      success: true,
      message: `Subscription activated for ${plan} plan`,
      data: {
        subscriptionDaysRemaining: updatedUser.getSubscriptionDaysRemaining(),
        endDate: updatedUser.subscription.endDate,
        startDate: updatedUser.subscription.startDate,
        plan: updatedUser.subscription.plan,
        status: updatedUser.subscription.status
      },
      subscription
    });
  } catch (error) {
    console.error('🔥 [subscribeDirect] Error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to activate subscription'
    });
  }
};

// ============================================================
// @desc    Create subscription (fallback / alias)
// @route   POST /api/subscription/create
// @access  Private
// ============================================================
const createSubscription = async (req, res) => {
  return subscribeDirect(req, res);
};

// ============================================================
// @desc    Start free trial (30 days)
// @route   POST /api/subscription/trial/start
// @access  Private
// ============================================================
const startTrial = async (req, res) => {
  try {
    const userId = req.user.id;

    const companyId = req.user.companyId;
    const userData = await prisma.user.findUnique({
      where: { id: userId }
    });

    if (!userData) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const user = new User(userData);

    // ─── Check if user already has an active trial ────────────
    if (user.subscription.plan === 'trial' && user.subscription.status === 'active') {
      const daysLeft = user.getTrialDaysRemaining();
      return res.status(400).json({
        success: false,
        message: `You already have an active trial with ${daysLeft} day(s) remaining.`
      });
    }

    // ─── Block if trial already expired ───────────────────────
    if (user.subscription.plan === 'trial' && user.subscription.status === 'expired') {
      return res.status(400).json({
        success: false,
        message: 'Your trial has already expired. Please subscribe to a paid plan to continue.'
      });
    }

    // ─── Block if on an active paid plan ──────────────────────
    if (
      (user.subscription.plan === 'monthly' || user.subscription.plan === 'yearly') &&
      user.subscription.status === 'active'
    ) {
      return res.status(400).json({
        success: false,
        message: 'You already have an active subscription. Trial is only for new users.'
      });
    }

    // ─── Start 30-day trial ────────────────────────────────────
    await user.startTrial();

    // ─── Refresh user data ─────────────────────────────────────
    const updatedUserData = await prisma.user.findUnique({
      where: { id: userId }
    });
    const updatedUser = new User(updatedUserData);

    // ─── Create trial subscription record ─────────────────────
    const subscription = await Subscription.create({
      userId: userId,          // ✅ Fixed: use userId directly
      plan: 'trial',
      startDate: updatedUser.subscription.trialStartDate,
      endDate: updatedUser.subscription.trialEndDate,   // trial uses trialEndDate as endDate in record
      amount: 0,
      currency: 'SAR',
      paymentMethod: 'free_trial',
      transactionId: `TRIAL-${Date.now()}`,
      paymentDetails: {
        method: 'free_trial',
        timestamp: new Date().toISOString()
      }
    });

    res.status(201).json({
      success: true,
      message: '🎉 30-day free trial started successfully!',
      data: {
        trialDaysRemaining: updatedUser.getTrialDaysRemaining(),
        trialEndDate: updatedUser.subscription.trialEndDate,
        trialStartDate: updatedUser.subscription.trialStartDate,
        plan: updatedUser.subscription.plan,
        status: updatedUser.subscription.status
      },
      subscription
    });
  } catch (error) {
    console.error('Error starting trial:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// ============================================================
// @desc    Check subscription status
// @route   GET /api/subscription/status
// @access  Private
// ============================================================
const checkSubscription = async (req, res) => {
  try {
    const userId = req.user.id;

    const companyId = req.user.companyId;
    const userData = await prisma.user.findUnique({
      where: { id: userId }
    });

    if (!userData) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const user = new User(userData);

    console.log('=== CHECK SUBSCRIPTION ===');
    console.log('Plan:', user.subscription.plan);
    console.log('Status:', user.subscription.status);
    console.log('EndDate:', user.subscription.endDate);
    console.log('TrialEndDate:', user.subscription.trialEndDate);

    // ─── Auto-expire if dates have passed ─────────────────────
    let shouldExpire = false;

    // Check trial expiry
    if (
      user.subscription.plan === 'trial' &&
      user.subscription.trialEndDate &&
      new Date() > new Date(user.subscription.trialEndDate) &&
      user.subscription.status === 'active'
    ) {
      console.log('Trial expired — marking as expired');
      shouldExpire = true;
    }

    // Check paid subscription expiry
    if (
      (user.subscription.plan === 'monthly' || user.subscription.plan === 'yearly') &&
      user.subscription.endDate &&
      new Date() > new Date(user.subscription.endDate) &&
      user.subscription.status === 'active'
    ) {
      console.log('Paid subscription expired — marking as expired');
      shouldExpire = true;
    }

    // ─── Apply expiry ──────────────────────────────────────────
    if (shouldExpire) {
      await user.expireSubscription();

      const updatedUserData = await prisma.user.findUnique({
        where: { id: userId }
      });
      const updatedUser = new User(updatedUserData);

      return res.status(200).json({
        success: true,
        data: {
          hasAccess: false,
          subscription: {
            plan: updatedUser.subscription.plan,
            status: updatedUser.subscription.status,
            trialDaysRemaining: 0,
            subscriptionDaysRemaining: 0,
            startDate: updatedUser.subscription.startDate,
            endDate: updatedUser.subscription.endDate,
            trialStartDate: updatedUser.subscription.trialStartDate,
            trialEndDate: updatedUser.subscription.trialEndDate
          }
        }
      });
    }

    const hasAccess = user.hasActiveSubscription();

    console.log('Final hasAccess:', hasAccess);
    console.log('Final status:', user.subscription.status);

    res.status(200).json({
      success: true,
      data: {
        hasAccess,
        subscription: {
          plan: user.subscription.plan,
          status: user.subscription.status,
          trialDaysRemaining: user.getTrialDaysRemaining(),
          subscriptionDaysRemaining: user.getSubscriptionDaysRemaining(),
          startDate: user.subscription.startDate,
          endDate: user.subscription.endDate,
          trialStartDate: user.subscription.trialStartDate,
          trialEndDate: user.subscription.trialEndDate
        }
      }
    });
  } catch (error) {
    console.error('Error checking subscription:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// ============================================================
// @desc    Validate subscription access (lightweight check)
// @route   GET /api/subscription/validate
// @access  Private
// ============================================================
const validateAccess = async (req, res) => {
  try {
    const userId = req.user.id;

    const companyId = req.user.companyId;
    const userData = await prisma.user.findUnique({
      where: { id: userId }
    });

    if (!userData) {
      return res.status(404).json({
        success: false,
        hasAccess: false,
        message: 'User not found'
      });
    }

    const user = new User(userData);
    const hasAccess = user.hasActiveSubscription();

    res.status(200).json({
      success: true,
      hasAccess,
      data: {
        plan: user.subscription.plan,
        status: user.subscription.status,
        daysRemaining: user.subscription.plan === 'trial'
          ? user.getTrialDaysRemaining()
          : user.getSubscriptionDaysRemaining()
      }
    });
  } catch (error) {
    console.error('Error validating access:', error);
    res.status(500).json({
      success: false,
      hasAccess: false,
      message: error.message
    });
  }
};

// ============================================================
// @desc    Get detailed subscription info
// @route   GET /api/subscription/details
// @access  Private
// ============================================================
const getSubscriptionDetails = async (req, res) => {
  try {
    const userId = req.user.id;

    const companyId = req.user.companyId;
    const userData = await prisma.user.findUnique({
      where: { id: userId }
    });

    if (!userData) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const user = new User(userData);

    // Get subscription history and active record
    const history = await Subscription.findByUserId(userId);
    const active = await Subscription.findActiveByUserId(userId);

    res.status(200).json({
      success: true,
      data: {
        current: {
          plan: user.subscription.plan,
          status: user.subscription.status,
          startDate: user.subscription.startDate,
          endDate: user.subscription.endDate,
          trialStartDate: user.subscription.trialStartDate,
          trialEndDate: user.subscription.trialEndDate,
          trialDaysRemaining: user.getTrialDaysRemaining(),
          subscriptionDaysRemaining: user.getSubscriptionDaysRemaining(),
          hasAccess: user.hasActiveSubscription()
        },
        activeSubscription: active,
        history
      }
    });
  } catch (error) {
    console.error('Error getting subscription details:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// ============================================================
// @desc    Cancel subscription (immediate deactivation)
// @route   POST /api/subscription/cancel
// @access  Private
// ============================================================
const cancelSubscription = async (req, res) => {
  try {
    const userId = req.user.id;

    const userData = await prisma.user.findUnique({
      where: { id: userId }
    });

    if (!userData) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const user = new User(userData);

    if (!user.hasActiveSubscription()) {
      return res.status(400).json({
        success: false,
        message: 'No active subscription to cancel.'
      });
    }

    // ─── Expire the user subscription ──────────────────────────
    await user.expireSubscription();

    // ─── Mark subscription record as cancelled ────────────────
    // Subscription model is keyed by userId (no companyId column)
    const activeSubscription = await prisma.subscription.findFirst({
      where: {
        userId,
        status: 'active'
      },
      orderBy: { createdAt: 'desc' }
    });

    if (activeSubscription) {
      await Subscription.cancel(activeSubscription.id);
    }

    res.status(200).json({
      success: true,
      message: 'Subscription cancelled successfully. Your access has been revoked.',
      data: {
        plan: user.subscription.plan,
        status: 'expired'
      }
    });
  } catch (error) {
    console.error('Error cancelling subscription:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// ============================================================
// @desc    Get user subscription history
// @route   GET /api/subscription/history
// @access  Private
// ============================================================
const getSubscriptionHistory = async (req, res) => {
  try {
    const userId = req.user.id;
    const companyId = req.user.companyId;
    const subscriptions = await Subscription.findByUserId(userId);

    res.status(200).json({
      success: true,
      data: subscriptions
    });
  } catch (error) {
    console.error('Error getting subscription history:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// ============================================================
// @desc    Get subscription stats (Admin)
// @route   GET /api/subscription/stats
// @access  Private/Admin
// ============================================================
const getSubscriptionStats = async (req, res) => {
  try {
    const stats = await Subscription.getStats();
    const expiringSoon = await Subscription.getExpiringSoon();

    res.status(200).json({
      success: true,
      data: {
        ...stats,
        expiringSoon
      }
    });
  } catch (error) {
    console.error('Error getting subscription stats:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// ============================================================
// @desc    Search subscriptions (Admin)
// @route   GET /api/subscription/search
// @access  Private/Admin
// ============================================================
const searchSubscriptions = async (req, res) => {
  try {
    const { q, limit = 20 } = req.query;

    if (!q || q.length < 1) {
      return res.status(400).json({
        success: false,
        message: 'Search query is required'
      });
    }

    const { subscriptions, total } = await Subscription.search(q, {
      take: parseInt(limit)
    });

    res.status(200).json({
      success: true,
      count: subscriptions.length,
      data: subscriptions,
      total
    });
  } catch (error) {
    console.error('Error searching subscriptions:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

module.exports = {
  getPlans,
  createSubscription,
  checkSubscription,
  cancelSubscription,
  getSubscriptionHistory,
  getSubscriptionStats,
  searchSubscriptions,
  subscribeDirect,
  startTrial,
  validateAccess,
  getSubscriptionDetails
};