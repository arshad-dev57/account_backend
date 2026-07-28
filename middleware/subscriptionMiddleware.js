// middleware/subscriptionMiddleware.js - Prisma Version (Fixed)
const prisma = require('../prisma/client');

// ============================================================
// Middleware: Check if user has an active subscription
// Use this on routes that require a paid or trial subscription
// ============================================================
exports.checkActiveSubscription = async (req, res, next) => {
  try {
    // Fetch latest user subscription data from DB
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        subscriptionPlan: true,
        subscriptionStatus: true,
        subscriptionStartDate: true,
        subscriptionEndDate: true,
        trialStartDate: true,
        trialEndDate: true,
      }
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    // ─── Auto-expire if dates have passed ─────────────────────
    let isTrialExpired = false;
    if (user.subscriptionPlan === 'trial' && user.trialEndDate) {
      isTrialExpired = new Date() > new Date(user.trialEndDate);
    }

    let isPaidExpired = false;
    if (
      (user.subscriptionPlan === 'monthly' || user.subscriptionPlan === 'yearly') &&
      user.subscriptionEndDate
    ) {
      isPaidExpired = new Date() > new Date(user.subscriptionEndDate);
    }

    // Update DB status if expired
    if ((isTrialExpired || isPaidExpired) && user.subscriptionStatus === 'active') {
      await prisma.user.update({
        where: { id: user.id },
        data: { subscriptionStatus: 'expired' }
      });
      user.subscriptionStatus = 'expired';
    }

    // ─── Check access ──────────────────────────────────────────
    const hasAccess = _hasActiveSubscription(user);

    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        message: 'Subscription required. Please subscribe to access this feature.',
        code: 'SUBSCRIPTION_REQUIRED',
      });
    }

    next();
  } catch (error) {
    console.error('Subscription middleware error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error checking subscription',
    });
  }
};

// ============================================================
// Internal helper — renamed to avoid collision with exported name
// ============================================================
function _hasActiveSubscription(user) {
  // Trial plan — check trialEndDate
  if (
    user.subscriptionPlan === 'trial' &&
    user.subscriptionStatus === 'active' &&
    user.trialEndDate &&
    new Date() <= new Date(user.trialEndDate)
  ) {
    return true;
  }

  // Monthly / Yearly paid plan — check subscriptionEndDate
  if (
    (user.subscriptionPlan === 'monthly' || user.subscriptionPlan === 'yearly') &&
    user.subscriptionStatus === 'active' &&
    user.subscriptionEndDate &&
    new Date() <= new Date(user.subscriptionEndDate)
  ) {
    return true;
  }

  return false;
}