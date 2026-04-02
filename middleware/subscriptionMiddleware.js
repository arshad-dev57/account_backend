  const User = require('../models/User');

  // Middleware to check if user has active subscription
  exports.checkActiveSubscription = async (req, res, next) => {
    try {
      const user = await User.findById(req.user.id);

      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found',
        });
      }

      // Update subscription status if expired
      if (user.isTrialExpired()) {
        await user.expireSubscription();
      }
      
      if ((user.subscription.plan === 'monthly' || user.subscription.plan === 'yearly') &&
          user.subscription.endDate && 
          user.subscription.endDate < new Date()) {
        await user.expireSubscription();
      }

      // Check if user has active subscription
      if (!user.hasActiveSubscription()) {
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
        message: 'Server error',
      });
    }
  };