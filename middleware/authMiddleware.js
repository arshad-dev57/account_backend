// middleware/authMiddleware.js - Prisma Version
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const prisma = require('../prisma/client');

const cleanToken = (token) => {
  if (!token) return null;
  return token.trim().replace(/^"|"$/g, '').replace(/\s/g, '');
};

// ✅ Shared helper - fresh DB fetch karta hai
const checkAndExpireIfNeeded = async (userId) => {
  const userData = await prisma.user.findUnique({
    where: { id: userId }
  });
  
  if (!userData) return null;
  
  const user = new User(userData);
  
  if (user.subscription.status !== 'active') return user;

  const now = new Date();

  const isTrialExpired = user.subscription.plan === 'trial' &&
    user.subscription.trialEndDate &&
    now > new Date(user.subscription.trialEndDate);

  const isPaidExpired = (user.subscription.plan === 'monthly' || user.subscription.plan === 'yearly') &&
    user.subscription.endDate &&
    now > new Date(user.subscription.endDate);

  if (isTrialExpired || isPaidExpired) {
    await user.expireSubscription();
    const updatedUserData = await prisma.user.findUnique({
      where: { id: userId }
    });
    return new User(updatedUserData);
  }

  return user;
};

// ========== MIDDLEWARE 1: Authentication ONLY ==========
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
    // ✅ Clean token before verification
    token = cleanToken(token);
    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Invalid token format',
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    const userData = await prisma.user.findUnique({
      where: { id: decoded.id }
    });

    if (!userData) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    if (!userData.isActive) {
      return res.status(401).json({ success: false, message: 'Your account has been deactivated' });
    }

    const user = new User(userData);
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
    // ✅ Clean token before verification
    token = cleanToken(token);
    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Invalid token format',
      });
    }

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