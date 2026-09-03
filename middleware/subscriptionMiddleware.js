const { resolveAndSyncSubscriptionAccess } = require('../utils/companySubscription');

exports.checkActiveSubscription = async (req, res, next) => {
  try {
    const resolved = await resolveAndSyncSubscriptionAccess(
      req.user.id,
      req.user.companyId
    );

    if (!resolved.user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

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