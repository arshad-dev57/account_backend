// controllers/subscriptionController.js - Complete Fixed Version
const User = require('../models/User');
const Subscription = require('../models/Subscription');
const prisma = require('../prisma/client');
const {
  TRIAL_DAYS,
  PRICING,
  calculatePrice,
  getCompanyCapacity,
  buildUpgradeQuote,
  applyCompanySubscription,
  paidEndDate,
  normalizeToUsd,
  resolveAndSyncSubscriptionAccess,
  companyHasActiveSubscription,
} = require('../utils/companySubscription');
const { getTrialEligibility, trialIneligibleMessage } = require('../utils/trialEligibility');
const { invalidateAuthUser } = require('../middleware/authMiddleware');

// ─── Subscription Plans (USD) ────────────────────────────────────
const PLANS = [
  {
    id: 'pos_monthly',
    productTier: 'pos',
    billingCycle: 'monthly',
    name: 'POS — Monthly',
    pricePerUser: PRICING.pos.monthlyPerUser,
    currency: 'USD',
    duration: 'month',
    features: PRICING.pos.features,
    isPopular: false,
  },
  {
    id: 'pos_yearly',
    productTier: 'pos',
    billingCycle: 'yearly',
    name: 'POS — Yearly',
    pricePerUser: PRICING.pos.yearlyPerUser,
    currency: 'USD',
    duration: 'year',
    features: PRICING.pos.features,
    savings: 'Save vs monthly',
    isPopular: false,
  },
  {
    id: 'erp_pos_monthly',
    productTier: 'erp_pos',
    billingCycle: 'monthly',
    name: 'ERP + POS — Monthly',
    basePrice: PRICING.erp_pos.monthlyBase,
    currency: 'USD',
    duration: 'month',
    features: PRICING.erp_pos.features,
    includesUsers: 1,
    includesBranches: 1,
    isPopular: true,
  },
  {
    id: 'erp_pos_yearly',
    productTier: 'erp_pos',
    billingCycle: 'yearly',
    name: 'ERP + POS — Yearly',
    basePrice: PRICING.erp_pos.yearlyBase,
    currency: 'USD',
    duration: 'year',
    features: PRICING.erp_pos.features,
    includesUsers: 1,
    includesBranches: 1,
    savings: 'Save vs monthly',
    isPopular: true,
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
      data: {
        plans: PLANS,
        trialDays: TRIAL_DAYS,
        pricing: PRICING,
      },
    });
  } catch (error) {
    console.error('Error getting plans:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

const getCapacity = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    if (!companyId) {
      return res.status(400).json({ success: false, message: 'Company not found' });
    }
    const capacity = await getCompanyCapacity(prisma, companyId);
    res.status(200).json({ success: true, data: capacity });
  } catch (error) {
    console.error('getCapacity error:', error);
    res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
};

const getQuote = async (req, res) => {
  try {
    const {
      productTier = 'erp_pos',
      billingCycle = 'monthly',
      licensedUsers = 1,
      licensedBranches = 1,
    } = req.query;
    const quote = calculatePrice(
      productTier,
      billingCycle,
      licensedUsers,
      licensedBranches
    );
    res.status(200).json({ success: true, data: quote });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const upgradeSubscription = async (req, res) => {
  try {
    const userId = req.user.id;
    const companyId = req.user.companyId;
    if (!companyId) {
      return res.status(400).json({ success: false, message: 'Company not found' });
    }

    const capacity = await getCompanyCapacity(prisma, companyId);
    const addUsers = parseInt(req.body.addUsers, 10) || 0;
    const addBranches = parseInt(req.body.addBranches, 10) || 0;
    const licensedUsers = req.body.licensedUsers != null
      ? parseInt(req.body.licensedUsers, 10)
      : capacity.licensedUsers + addUsers;
    const licensedBranches = req.body.licensedBranches != null
      ? parseInt(req.body.licensedBranches, 10)
      : capacity.licensedBranches + addBranches;

    const nextTier = req.body.productTier === 'pos' || req.body.productTier === 'erp_pos'
      ? req.body.productTier
      : capacity.productTier;
    const requestedCycle = req.body.billingCycle || req.body.plan;
    const billingCycle = requestedCycle === 'yearly' || requestedCycle === 'monthly'
      ? requestedCycle
      : (capacity.billingCycle || 'monthly');

    if (!capacity.isTrial && !capacity.isPaid) {
      return res.status(402).json({
        success: false,
        code: 'SUBSCRIPTION_REQUIRED',
        message: 'Active subscription required before upgrading seats or branches.',
      });
    }

    const upgrade = buildUpgradeQuote(capacity, {
      addUsers: licensedUsers - capacity.licensedUsers,
      addBranches: licensedBranches - capacity.licensedBranches,
    });

    const now = new Date();
    const cycleChanged = billingCycle !== (capacity.billingCycle || 'monthly');
    const endDate = capacity.isPaid && capacity.subscriptionEndDate && !cycleChanged
      ? new Date(capacity.subscriptionEndDate)
      : paidEndDate(billingCycle, now);

    await applyCompanySubscription(companyId, {
      subscriptionPlan: billingCycle,
      subscriptionStatus: 'active',
      productTier: nextTier,
      licensedUsers: upgrade.licensedUsers,
      licensedBranches: upgrade.licensedBranches,
      billingCycle,
      subscriptionStartDate: capacity.isPaid ? undefined : now,
      subscriptionEndDate: endDate,
    });
    invalidateAuthUser(userId);

    await Subscription.create({
      userId,
      plan: billingCycle,
      startDate: now,
      endDate,
      amount: upgrade.next.amount,
      currency: 'USD',
      paymentMethod: req.body.paymentMethod || 'direct',
      transactionId: req.body.transactionId || `UPG-${Date.now()}`,
      paymentDetails: {
        type: 'upgrade',
        productTier: nextTier,
        licensedUsers: upgrade.licensedUsers,
        licensedBranches: upgrade.licensedBranches,
        previousAmount: upgrade.current.amount,
        delta: upgrade.delta,
        timestamp: new Date().toISOString(),
      },
    });

    const updatedCapacity = await getCompanyCapacity(prisma, companyId);
    res.status(200).json({
      success: true,
      message: 'Subscription upgraded successfully',
      data: { quote: upgrade, capacity: updatedCapacity },
    });
  } catch (error) {
    console.error('upgradeSubscription error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ============================================================
// @desc    Direct subscription (No Stripe)
// @route   POST /api/subscription/subscribe
// @access  Private
// ============================================================
const subscribeDirect = async (req, res) => {
  try {
    const {
      plan,
      productTier = 'erp_pos',
      licensedUsers = 1,
      licensedBranches = 1,
      amount,
      paymentMethod,
      transactionId,
    } = req.body;
    const userId = req.user.id;
    const companyId = req.user.companyId;
    if (!companyId) {
      return res.status(400).json({ success: false, message: 'Company not found' });
    }

    if (!plan || (plan !== 'monthly' && plan !== 'yearly')) {
      return res.status(400).json({
        success: false,
        message: 'Invalid billing cycle. Must be "monthly" or "yearly"',
      });
    }

    const tier = productTier === 'pos' ? 'pos' : 'erp_pos';
    const pricing = calculatePrice(tier, plan, licensedUsers, licensedBranches);
    const finalAmount = amount != null ? Number(amount) : pricing.amount;

    const userData = await prisma.user.findUnique({ where: { id: userId } });
    if (!userData) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const company = companyId
      ? await prisma.company.findUnique({ where: { id: companyId } })
      : null;

    const user = new User(userData);
    const isPaidRecord = (planName, status, endDate) =>
      (planName === 'monthly' || planName === 'yearly') &&
      status === 'active' &&
      endDate &&
      new Date() <= new Date(endDate);

    const isAlreadyPaid = isPaidRecord(
      company?.subscriptionPlan,
      company?.subscriptionStatus,
      company?.subscriptionEndDate
    ) || isPaidRecord(
      user.subscription.plan,
      user.subscription.status,
      user.subscription.endDate
    );

    const now = new Date();
    const currentCycle = company?.billingCycle || user.subscription.plan;
    const cycleChanged = isAlreadyPaid && currentCycle !== plan;
    const currentEnd = company?.subscriptionEndDate
      ? new Date(company.subscriptionEndDate)
      : (user.subscription.endDate ? new Date(user.subscription.endDate) : null);
    const endDate = (!isAlreadyPaid || cycleChanged || !currentEnd)
      ? paidEndDate(plan, now)
      : currentEnd;
    const startDate = isAlreadyPaid && !cycleChanged && (company?.subscriptionStartDate || user.subscription.startDate)
      ? (company?.subscriptionStartDate || user.subscription.startDate)
      : now;

    await applyCompanySubscription(companyId, {
      subscriptionPlan: plan,
      subscriptionStatus: 'active',
      productTier: tier,
      licensedUsers: pricing.licensedUsers,
      licensedBranches: pricing.licensedBranches,
      billingCycle: plan,
      trialStartDate: null,
      trialEndDate: null,
      subscriptionStartDate: startDate,
      subscriptionEndDate: endDate,
    });
    invalidateAuthUser(userId);

    const updatedUserData = await prisma.user.findUnique({ where: { id: userId } });
    const updatedUser = new User(updatedUserData);

    const subscription = await Subscription.create({
      userId,
      plan,
      startDate: now,
      endDate,
      amount: finalAmount,
      currency: 'USD',
      paymentMethod: paymentMethod || 'direct',
      transactionId: transactionId || `TXN-${Date.now()}`,
      paymentDetails: {
        method: 'direct',
        type: isAlreadyPaid ? 'plan_change' : 'subscribe',
        productTier: tier,
        licensedUsers: pricing.licensedUsers,
        licensedBranches: pricing.licensedBranches,
        timestamp: new Date().toISOString(),
        ...(req.body.paymentDetails || {}),
      },
    });

    res.status(isAlreadyPaid ? 200 : 201).json({
      success: true,
      message: isAlreadyPaid
        ? `Subscription updated — ${tier === 'pos' ? 'POS' : 'ERP + POS'} (${plan})`
        : `Subscription activated — ${tier === 'pos' ? 'POS' : 'ERP + POS'} (${plan})`,
      data: {
        subscriptionDaysRemaining: updatedUser.getSubscriptionDaysRemaining(),
        endDate: updatedUser.subscription.endDate,
        startDate: updatedUser.subscription.startDate,
        plan: updatedUser.subscription.plan,
        status: updatedUser.subscription.status,
        productTier: tier,
        licensedUsers: pricing.licensedUsers,
        licensedBranches: pricing.licensedBranches,
        amount: finalAmount,
        currency: 'USD',
      },
      subscription,
    });
  } catch (error) {
    console.error('🔥 [subscribeDirect] Error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to activate subscription',
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
// @desc    Start free trial (14 days)
// @route   POST /api/subscription/trial/start
// @access  Private
// ============================================================
const startTrial = async (req, res) => {
  try {
    const userId = req.user.id;
    const companyId = req.user.companyId;

    const eligibility = await getTrialEligibility(userId, companyId);
    if (!eligibility.eligible) {
      return res.status(400).json({
        success: false,
        message: trialIneligibleMessage(eligibility.reason),
      });
    }

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

    await user.startTrial();

    const updatedUserData = await prisma.user.findUnique({
      where: { id: userId }
    });

    if (companyId) {
      await applyCompanySubscription(companyId, {
        subscriptionPlan: 'trial',
        subscriptionStatus: 'active',
        productTier: 'erp_pos',
        licensedUsers: 999,
        licensedBranches: 999,
        trialStartDate: updatedUserData?.trialStartDate || new Date(),
        trialEndDate: updatedUserData?.trialEndDate || new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000),
        subscriptionStartDate: null,
        subscriptionEndDate: null,
      });
    }

    const updatedUser = new User(updatedUserData);

    // ─── Create trial subscription record ─────────────────────
    const subscription = await Subscription.create({
      userId: userId,          // ✅ Fixed: use userId directly
      plan: 'trial',
      startDate: updatedUser.subscription.trialStartDate,
      endDate: updatedUser.subscription.trialEndDate,   // trial uses trialEndDate as endDate in record
      amount: 0,
      currency: 'USD',
      paymentMethod: 'free_trial',
      transactionId: `TRIAL-${Date.now()}`,
      paymentDetails: {
        method: 'free_trial',
        timestamp: new Date().toISOString()
      }
    });

    res.status(201).json({
      success: true,
      message: `🎉 ${TRIAL_DAYS}-day free trial started — full ERP + POS access!`,
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

    const resolved = await resolveAndSyncSubscriptionAccess(userId, companyId);
    const liveUserData = resolved.user || userData;
    const liveUser = new User(liveUserData);
    const company = resolved.company;

    // Auto-expire only when the COMPANY plan has actually ended
    let shouldExpire = false;
    if (company && !companyHasActiveSubscription(company) && company.subscriptionStatus === 'active') {
      shouldExpire = true;
    } else if (!company) {
      if (
        liveUser.subscription.plan === 'trial' &&
        liveUser.subscription.trialEndDate &&
        new Date() > new Date(liveUser.subscription.trialEndDate) &&
        liveUser.subscription.status === 'active'
      ) {
        shouldExpire = true;
      }
      if (
        (liveUser.subscription.plan === 'monthly' || liveUser.subscription.plan === 'yearly') &&
        liveUser.subscription.endDate &&
        new Date() > new Date(liveUser.subscription.endDate) &&
        liveUser.subscription.status === 'active'
      ) {
        shouldExpire = true;
      }
    }

    if (shouldExpire) {
      await liveUser.expireSubscription();
      if (companyId) {
        await applyCompanySubscription(companyId, {
          subscriptionPlan: company?.subscriptionPlan || liveUser.subscription.plan,
          subscriptionStatus: 'expired',
        });
      }

      const updatedUserData = await prisma.user.findUnique({
        where: { id: userId }
      });
      const updatedUser = new User(updatedUserData);
      const trialEligibility = await getTrialEligibility(userId, companyId);

      return res.status(200).json({
        success: true,
        data: {
          hasAccess: false,
          trialEligible: trialEligibility.eligible,
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

    const hasAccess = resolved.hasAccess;
    let capacity = null;
    if (companyId) {
      try {
        capacity = await getCompanyCapacity(prisma, companyId);
      } catch {
        /* ignore */
      }
    }

    console.log('Final hasAccess:', hasAccess);
    console.log('Final status:', liveUser.subscription.status);

    const trialEligibility = await getTrialEligibility(userId, companyId);

    res.status(200).json({
      success: true,
      data: {
        hasAccess,
        trialEligible: trialEligibility.eligible,
        productTier: capacity?.productTier || liveUserData.productTier || 'erp_pos',
        subscription: {
          plan: capacity?.subscriptionPlan || liveUser.subscription.plan,
          status: capacity?.subscriptionStatus || liveUser.subscription.status,
          trialDaysRemaining: liveUser.getTrialDaysRemaining(),
          subscriptionDaysRemaining: liveUser.getSubscriptionDaysRemaining(),
          startDate: liveUser.subscription.startDate,
          endDate: liveUser.subscription.endDate || capacity?.subscriptionEndDate,
          trialStartDate: liveUser.subscription.trialStartDate,
          trialEndDate: liveUser.subscription.trialEndDate || capacity?.trialEndDate,
          productTier: capacity?.productTier || 'erp_pos',
          licensedUsers: capacity?.licensedUsers,
          licensedBranches: capacity?.licensedBranches,
          usedUsers: capacity?.usedUsers,
          usedBranches: capacity?.usedBranches,
          isTrial: capacity?.isTrial,
        },
        capacity,
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

    const resolved = await resolveAndSyncSubscriptionAccess(userId, companyId);
    const liveUser = new User(resolved.user || userData);
    const hasAccess = resolved.hasAccess;

    res.status(200).json({
      success: true,
      hasAccess,
      data: {
        plan: liveUser.subscription.plan,
        status: liveUser.subscription.status,
        daysRemaining: liveUser.subscription.plan === 'trial'
          ? liveUser.getTrialDaysRemaining()
          : liveUser.getSubscriptionDaysRemaining()
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

    if (!user.hasActiveSubscription()) {
      return res.status(400).json({
        success: false,
        message: 'No active subscription to cancel.'
      });
    }

    // ─── Expire user + company (company is source of truth for access) ───
    await user.expireSubscription();

    if (companyId) {
      await applyCompanySubscription(companyId, {
        subscriptionStatus: 'expired',
      });
    }

    // ─── Mark subscription record as cancelled ────────────────
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
        status: 'expired',
        hasAccess: false,
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
// @desc    Company billing overview (admin)
// @route   GET /api/subscription/billing
// @access  Private — company admin
// ============================================================
const ADMIN_ROLES = new Set(['admin', 'owner', 'superadmin', 'company_admin']);

const getCompanyBilling = async (req, res) => {
  try {
    const role = (req.user.role || '').toLowerCase();
    if (!ADMIN_ROLES.has(role)) {
      return res.status(403).json({
        success: false,
        message: 'Only company administrators can view billing',
      });
    }

    const companyId = req.user.companyId;
    if (!companyId) {
      return res.status(400).json({ success: false, message: 'Company not found' });
    }

    const [company, capacity, subscriptions] = await Promise.all([
      prisma.company.findUnique({
        where: { id: companyId },
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          address: true,
          subscriptionPlan: true,
          subscriptionStatus: true,
          subscriptionStartDate: true,
          subscriptionEndDate: true,
          trialStartDate: true,
          trialEndDate: true,
        },
      }),
      getCompanyCapacity(prisma, companyId),
      Subscription.findByCompanyId(companyId),
    ]);

    if (!company) {
      return res.status(404).json({ success: false, message: 'Company not found' });
    }

    const adminUser = await prisma.user.findUnique({ where: { id: req.user.id } });
    const user = adminUser ? new User(adminUser) : null;

    const paidRecords = subscriptions.filter(
      (s) => Number(s.amount || 0) > 0 && s.plan !== 'trial'
    );

    const totalPaid = paidRecords.reduce(
      (sum, s) => sum + normalizeToUsd(s.amount, s.currency),
      0
    );

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const paidThisMonth = paidRecords
      .filter((s) => new Date(s.createdAt) >= monthStart)
      .reduce((sum, s) => sum + normalizeToUsd(s.amount, s.currency), 0);

    const monthlyMap = {};
    for (const record of paidRecords) {
      const d = new Date(record.createdAt);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      if (!monthlyMap[key]) {
        monthlyMap[key] = {
          month: key,
          label: d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
          total: 0,
          count: 0,
        };
      }
      monthlyMap[key].total += normalizeToUsd(record.amount, record.currency);
      monthlyMap[key].count += 1;
    }

    const monthlyStats = Object.values(monthlyMap).sort((a, b) =>
      b.month.localeCompare(a.month)
    );

    const currentQuote = calculatePrice(
      capacity.productTier,
      capacity.billingCycle,
      capacity.licensedUsers,
      capacity.licensedBranches
    );

    const invoices = subscriptions.map((record, index) => {
      const details = record.paymentDetails || {};
      const paidBy = record.user
        ? {
            name: `${record.user.firstName || ''} ${record.user.lastName || ''}`.trim(),
            email: record.user.email,
          }
        : null;

      return {
        id: record.id,
        invoiceNumber:
          record.transactionId ||
          `INV-${new Date(record.createdAt).getFullYear()}-${String(index + 1).padStart(4, '0')}`,
        plan: record.plan,
        status: record.status,
        amount: Math.round(normalizeToUsd(record.amount, record.currency)),
        currency: 'USD',
        originalAmount: Number(record.amount || 0),
        originalCurrency: record.currency || 'USD',
        paymentMethod: record.paymentMethod || 'direct',
        transactionId: record.transactionId || '',
        startDate: record.startDate,
        endDate: record.endDate,
        createdAt: record.createdAt,
        productTier: details.productTier || capacity.productTier,
        licensedUsers: details.licensedUsers ?? capacity.licensedUsers,
        licensedBranches: details.licensedBranches ?? capacity.licensedBranches,
        type: details.type || (record.plan === 'trial' ? 'trial' : 'subscription'),
        delta: details.delta != null ? Math.round(normalizeToUsd(details.delta, record.currency)) : undefined,
        previousAmount: details.previousAmount != null
          ? Math.round(normalizeToUsd(details.previousAmount, record.currency))
          : undefined,
        paidBy,
      };
    });

    res.status(200).json({
      success: true,
      data: {
        company: {
          id: company.id,
          name: company.name,
          email: company.email,
          phone: company.phone,
          address: company.address,
        },
        capacity,
        subscription: user
          ? {
              plan: user.subscription.plan,
              status: user.subscription.status,
              startDate: user.subscription.startDate,
              endDate: user.subscription.endDate,
              trialStartDate: user.subscription.trialStartDate,
              trialEndDate: user.subscription.trialEndDate,
              trialDaysRemaining: user.getTrialDaysRemaining(),
              subscriptionDaysRemaining: user.getSubscriptionDaysRemaining(),
              hasAccess: user.hasActiveSubscription(),
            }
          : {
              plan: company.subscriptionPlan,
              status: company.subscriptionStatus,
              startDate: company.subscriptionStartDate,
              endDate: company.subscriptionEndDate,
              trialStartDate: company.trialStartDate,
              trialEndDate: company.trialEndDate,
              trialDaysRemaining: 0,
              subscriptionDaysRemaining: 0,
              hasAccess: capacity.hasAccess,
            },
        stats: {
          currentAmount: capacity.isPaid ? currentQuote.amount : 0,
          totalPaid,
          paidThisMonth,
          invoiceCount: invoices.length,
        },
        monthlyStats,
        invoices,
      },
    });
  } catch (error) {
    console.error('getCompanyBilling error:', error);
    res.status(500).json({ success: false, message: error.message });
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
  getCapacity,
  getQuote,
  upgradeSubscription,
  createSubscription,
  checkSubscription,
  cancelSubscription,
  getSubscriptionHistory,
  getSubscriptionStats,
  searchSubscriptions,
  subscribeDirect,
  startTrial,
  validateAccess,
  getSubscriptionDetails,
  getCompanyBilling,
};