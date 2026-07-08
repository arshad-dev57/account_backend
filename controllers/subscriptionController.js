// controllers/subscriptionController.js - Prisma Version
const User = require('../models/User');
const Subscription = require('../models/Subscription');
const prisma = require('../prisma/client');

// ─── Subscription Plans ──────────────────────────────────────────
const PLANS = [
  {
    id: 'monthly',
    name: 'Monthly Plan',
    price: 15,
    currency: 'usd',
    duration: '30 days',
    features: [
      'Full access to all features',
      'Unlimited transactions',
      'All financial reports',
      'Export to Excel/PDF',
      'Email support',
      'Data backup',
    ],
    isPopular: false,
  },
  {
    id: 'yearly',
    name: 'Yearly Plan',
    price: 150,
    currency: 'usd',
    duration: '365 days',
    features: [
      'Full access to all features',
      'Unlimited transactions',
      'All financial reports',
      'Export to Excel/PDF',
      'Priority support (24/7)',
      'Data backup',
      'Advanced analytics',
      'Save 2 months FREE!',
    ],
    isPopular: true,
    savings: 'Save 16%',
  },
];

// ============================================================
// @desc    Get subscription plans
// @route   GET /api/subscription/plans
// @access  Public
// ============================================================
const getPlans = async (req, res) => {
  try {
    res.status(200).json({
      success: true,
      data: PLANS,
    });
  } catch (error) {
    console.error('Error getting plans:', error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ============================================================
// @desc    Create subscription (after payment)
// @route   POST /api/subscription/create
// @access  Private
// ============================================================
const createSubscription = async (req, res) => {
  try {
    const { plan, amount, paymentMethod, transactionId } = req.body;
    const userId = req.user.id;

    console.log('Creating subscription for user:', userId);
    console.log('Plan:', plan);
    console.log('Amount:', amount);

    // ─── Get user ──────────────────────────────────────────────
    const userData = await prisma.user.findUnique({
      where: { id: userId }
    });

    if (!userData) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    const user = new User(userData);

    // ─── Validate plan ─────────────────────────────────────────
    if (plan !== 'monthly' && plan !== 'yearly') {
      return res.status(400).json({
        success: false,
        message: 'Invalid subscription plan',
      });
    }

    // ─── Calculate price if not provided ──────────────────────
    let finalAmount = amount;
    if (!finalAmount) {
      finalAmount = plan === 'monthly' ? 500 : 5000;
    }

    // ─── Activate subscription ─────────────────────────────────
    await user.activateSubscription(plan, finalAmount);

    // ─── Refresh user data ─────────────────────────────────────
    const updatedUserData = await prisma.user.findUnique({
      where: { id: userId }
    });
    const updatedUser = new User(updatedUserData);

    console.log('Subscription activated for user:', userId);
    console.log('Updated status:', updatedUser.subscription.status);
    console.log('Updated plan:', updatedUser.subscription.plan);
    console.log('Updated endDate:', updatedUser.subscription.endDate);

    // ─── Create subscription record ──────────────────────────
    const subscription = await Subscription.create({
      userId: user._id,
      plan,
      startDate: user.subscription.startDate,
      endDate: user.subscription.endDate,
      amount: finalAmount,
      paymentMethod: paymentMethod || 'in_app_purchase',
      transactionId: transactionId || `TXN-${Date.now()}`,
      paymentDetails: req.body.paymentDetails || {},
    });

    console.log('Subscription record created:', subscription.id);

    res.status(201).json({
      success: true,
      message: `Subscription activated for ${plan} plan`,
      data: {
        user: {
          id: updatedUser._id,
          firstName: updatedUser.firstName,
          lastName: updatedUser.lastName,
          email: updatedUser.email,
          subscription: {
            plan: updatedUser.subscription.plan,
            status: updatedUser.subscription.status,
            startDate: updatedUser.subscription.startDate,
            endDate: updatedUser.subscription.endDate,
            daysRemaining: updatedUser.getSubscriptionDaysRemaining(),
          },
        },
        subscription,
      },
    });
  } catch (error) {
    console.error('Error creating subscription:', error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ============================================================
// @desc    Check subscription status
// @route   GET /api/subscription/check
// @access  Private
// ============================================================
const checkSubscription = async (req, res) => {
  try {
    const userId = req.user.id;

    const userData = await prisma.user.findUnique({
      where: { id: userId }
    });

    if (!userData) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    const user = new User(userData);

    console.log('=== CHECK SUBSCRIPTION ===');
    console.log('Plan:', user.subscription.plan);
    console.log('Status:', user.subscription.status);
    console.log('EndDate:', user.subscription.endDate);
    console.log('Now:', new Date());

    // ─── Check if endDate is in the past ──────────────────────
    const isEndDatePassed = user.subscription.endDate ? new Date() > new Date(user.subscription.endDate) : false;
    console.log('Is endDate passed?', isEndDatePassed);

    // ─── Check if trial end date is passed ────────────────────
    const isTrialEndPassed = user.subscription.trialEndDate ? new Date() > new Date(user.subscription.trialEndDate) : false;
    console.log('Is trial end passed?', isTrialEndPassed);

    // ─── Expire if needed ──────────────────────────────────────
    let shouldExpire = false;

    if (user.subscription.plan === 'trial' && isTrialEndPassed && user.subscription.status === 'active') {
      console.log('Trial expired - should expire');
      shouldExpire = true;
    }

    if ((user.subscription.plan === 'monthly' || user.subscription.plan === 'yearly') &&
        isEndDatePassed &&
        user.subscription.status === 'active') {
      console.log('Paid subscription expired - should expire');
      shouldExpire = true;
    }

    if (shouldExpire) {
      console.log('Expiring subscription...');
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
            trialDaysRemaining: updatedUser.getTrialDaysRemaining(),
            subscriptionDaysRemaining: updatedUser.getSubscriptionDaysRemaining(),
            startDate: updatedUser.subscription.startDate,
            endDate: updatedUser.subscription.endDate,
            trialStartDate: updatedUser.subscription.trialStartDate,
            trialEndDate: updatedUser.subscription.trialEndDate,
          },
        },
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
          trialEndDate: user.subscription.trialEndDate,
        },
      },
    });
  } catch (error) {
    console.error('Error checking subscription:', error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ============================================================
// @desc    Cancel subscription
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
        message: 'User not found',
      });
    }

    const user = new User(userData);
    await user.expireSubscription();

    // ─── Update subscription record ───────────────────────────
    const activeSubscription = await prisma.subscription.findFirst({
      where: {
        userId: user._id,
        status: 'active'
      },
      orderBy: { createdAt: 'desc' }
    });

    if (activeSubscription) {
      await Subscription.cancel(activeSubscription.id);
    }

    res.status(200).json({
      success: true,
      message: 'Subscription cancelled successfully',
    });
  } catch (error) {
    console.error('Error cancelling subscription:', error);
    res.status(500).json({
      success: false,
      message: error.message,
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
    const subscriptions = await Subscription.findByUserId(userId);

    res.status(200).json({
      success: true,
      data: subscriptions,
    });
  } catch (error) {
    console.error('Error getting subscription history:', error);
    res.status(500).json({
      success: false,
      message: error.message,
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
        expiringSoon,
      },
    });
  } catch (error) {
    console.error('Error getting subscription stats:', error);
    res.status(500).json({
      success: false,
      message: error.message,
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
        message: 'Search query is required',
      });
    }

    const { subscriptions, total } = await Subscription.search(q, {
      take: parseInt(limit),
    });

    res.status(200).json({
      success: true,
      count: subscriptions.length,
      data: subscriptions,
      total,
    });
  } catch (error) {
    console.error('Error searching subscriptions:', error);
    res.status(500).json({
      success: false,
      message: error.message,
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
};