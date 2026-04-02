const User = require('../models/User');
const Subscription = require('../models/Subscription');

// ==================== GET SUBSCRIPTION PLANS ====================
exports.getPlans = async (req, res) => {
  try {
    const plans = [
      {
        id: 'monthly',
        name: 'Monthly Plan',
        price: 500,
        currency: 'PKR',
        duration: '30 days',
        features: [
          'Full access to all features',
          'Unlimited transactions',
          'All financial reports',
          'Export to Excel/PDF',
          'Email support',
          'Data backup',
        ],
      },
      {
        id: 'yearly',
        name: 'Yearly Plan',
        price: 5000,
        currency: 'PKR',
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

    res.status(200).json({
      success: true,
      data: plans,
    });
  } catch (error) {
    console.error('Error getting plans:', error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ==================== CREATE SUBSCRIPTION (AFTER PAYMENT) ====================
exports.createSubscription = async (req, res) => {
  try {
    const { plan, amount, paymentMethod, transactionId } = req.body;
    const userId = req.user.id;

    console.log('Creating subscription for user:', userId);
    console.log('Plan:', plan);
    console.log('Amount:', amount);

    let user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    // Validate plan
    if (plan !== 'monthly' && plan !== 'yearly') {
      return res.status(400).json({
        success: false,
        message: 'Invalid subscription plan',
      });
    }

    // Calculate price if not provided
    let finalAmount = amount;
    if (!finalAmount) {
      finalAmount = plan === 'monthly' ? 500 : 5000;
    }

    // ✅ Activate subscription
    await user.activateSubscription(plan, finalAmount);
    
    // ✅ IMPORTANT: Refresh user data from database
    user = await User.findById(userId);
    
    console.log('Subscription activated for user:', userId);
    console.log('Updated status:', user.subscription.status);
    console.log('Updated plan:', user.subscription.plan);
    console.log('Updated endDate:', user.subscription.endDate);

    // Create subscription record
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

    console.log('Subscription record created:', subscription._id);

    res.status(201).json({
      success: true,
      message: `Subscription activated for ${plan} plan`,
      data: {
        user: {
          id: user._id,
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email,
          subscription: {
            plan: user.subscription.plan,
            status: user.subscription.status,
            startDate: user.subscription.startDate,
            endDate: user.subscription.endDate,
            daysRemaining: user.getSubscriptionDaysRemaining(),
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
// ==================== CHECK SUBSCRIPTION STATUS ====================
exports.checkSubscription = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    console.log('=== CHECK SUBSCRIPTION ===');
    console.log('Plan:', user.subscription.plan);
    console.log('Status:', user.subscription.status);
    console.log('EndDate:', user.subscription.endDate);
    console.log('Now:', new Date());
    
    // ✅ IMPORTANT: Check if endDate is in the past
    const isEndDatePassed = user.subscription.endDate ? new Date() > user.subscription.endDate : false;
    console.log('Is endDate passed?', isEndDatePassed);
    
    // ✅ Check if trial end date is passed
    const isTrialEndPassed = user.subscription.trialEndDate ? new Date() > user.subscription.trialEndDate : false;
    console.log('Is trial end passed?', isTrialEndPassed);
    
    // ✅ Only expire if endDate is actually passed
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
      const updatedUser = await User.findById(req.user.id);
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
};// ==================== CANCEL SUBSCRIPTION ====================
exports.cancelSubscription = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    await user.expireSubscription();

    // Update subscription record
    await Subscription.findOneAndUpdate(
      { userId: user._id, status: 'active' },
      { status: 'cancelled' }
    );

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

// ==================== GET USER SUBSCRIPTION HISTORY ====================
exports.getSubscriptionHistory = async (req, res) => {
  try {
    const subscriptions = await Subscription.find({ userId: req.user.id })
      .sort({ createdAt: -1 });

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