const {
  accessFromRecords,
  scheduleSubscriptionHeal,
  resolveBillingCompany,
} = require('../utils/companySubscription');

exports.checkActiveSubscription = async (req, res, next) => {
  try {
    const row = req.authUserRow;
    const activeCompany = row?.company || req.user?.company || null;
    let billingCompany = activeCompany;
    if (activeCompany?.id) {
      try {
        billingCompany =
          (await resolveBillingCompany(activeCompany.id, activeCompany)) || activeCompany;
      } catch {
        billingCompany = activeCompany;
      }
    }

    const resolved = accessFromRecords(row || req.user, billingCompany);

    if (!resolved.user && !req.user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    scheduleSubscriptionHeal(row || req.user, billingCompany);

    if (!resolved.hasAccess) {
      return res.status(403).json({
        success: false,
        message: 'Subscription required. Please subscribe to access this feature.',
        code: 'SUBSCRIPTION_REQUIRED'
      });
    }

    next();
  } catch (error) {
    console.error('Subscription middleware error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error checking subscription'
    });
  }
};
