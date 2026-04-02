const jwt = require('jsonwebtoken');
const User = require('../models/User');

// ✅ Shared helper - fresh DB fetch karta hai
const checkAndExpireIfNeeded = async (userId) => {
  const user = await User.findById(userId);
  if (!user || user.subscription.status !== 'active') return user;

  const now = new Date();

  const isTrialExpired = user.subscription.plan === 'trial' &&
    user.subscription.trialEndDate &&
    now > new Date(user.subscription.trialEndDate);

  const isPaidExpired = (user.subscription.plan === 'monthly' || user.subscription.plan === 'yearly') &&
    user.subscription.endDate &&
    now > new Date(user.subscription.endDate);

  if (isTrialExpired || isPaidExpired) {
    await user.expireSubscription();
    // Fresh fetch after expire
    return await User.findById(userId);
  }

  return user;
};

// ========== MIDDLEWARE 1: Authentication ONLY (No subscription check) ==========
exports.protectOnly = async (req, res, next) => {
  let token;

  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  }

  if (!token) {
    return res.status(401).json({
      success: false,
      message: 'Not authorized to access this route',
    });
  }

  try {
    token = token.trim().replace(/^"|"$/g, '');
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id);

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    if (!user.isActive) {
      return res.status(401).json({ success: false, message: 'Your account has been deactivated' });
    }

    req.user = user;
    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ success: false, message: 'Invalid token. Please login again.' });
    }
    return res.status(401).json({ success: false, message: 'Not authorized to access this route' });
  }
};

// ========== MIDDLEWARE 2: Authentication + Subscription Check ==========
exports.protect = async (req, res, next) => {
  let token;

  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  }

  if (!token) {
    return res.status(401).json({
      success: false,
      message: 'Not authorized to access this route. No token provided.',
    });
  }

  try {
    token = token.trim().replace(/^"|"$/g, '');
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // ✅ Fresh fetch + sahi expire check
    const user = await checkAndExpireIfNeeded(decoded.id);

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    if (!user.isActive) {
      return res.status(401).json({ success: false, message: 'Your account has been deactivated' });
    }

    if (!user.hasActiveSubscription()) {
      return res.status(403).json({
        success: false,
        message: 'Subscription required. Please subscribe to access this feature.',
        code: 'SUBSCRIPTION_REQUIRED',
      });
    }

    req.user = user;
    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ success: false, message: 'Invalid token. Please login again.' });
    }
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ success: false, message: 'Token expired. Please login again.' });
    }
    return res.status(401).json({ success: false, message: 'Not authorized to access this route' });
  }
};