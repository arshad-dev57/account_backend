const jwt = require('jsonwebtoken');
const User = require('../models/User');
const prisma = require('../prisma/client');
const { attachLocationScope } = require('../utils/locationAccessHelper');

const cleanToken = (token) => {
  if (!token) return null;
  return token.trim().replace(/^"|"$/g, '').replace(/\s/g, '');
};

const checkAndExpireIfNeeded = async (userId) => {
  const userData = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      password: true,
      phone: true,
      country: true,
      role: true,
      roleId: true,
      managerId: true,
      createdBy: true,
      companyId: true,
      isActive: true,
      resetOtp: true,
      resetOtpExpiry: true,
      failedLoginAttempts: true,
      lockUntil: true,
      requiresLoginOtp: true,
      loginOtp: true,
      loginOtpExpiry: true,
      organizationName: true,
      address: true,
      contactNo: true,
      websiteLink: true,
      businessDetails: true,
      subscriptionPlan: true,
      subscriptionStatus: true,
      subscriptionStartDate: true,
      subscriptionEndDate: true,
      trialStartDate: true,
      trialEndDate: true,
      createdAt: true,
      updatedAt: true,
      company: true
    }
  });

  if (!userData) return null;

  const user = new User(userData);
  user.companyId = userData.companyId;

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
      where: { id: userId },
      select: {
        companyId: true,
        company: true
      }
    });
    user.companyId = updatedUserData?.companyId;
    return user;
  }

  return user;
};

exports.protectOnly = async (req, res, next) => {
  let token;

  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  }

  if (!token) {
    return res.status(401).json({
      success: false,
      message: 'Not authorized to access this route'
    });
  }

  try {
    // ✅ Clean token before verification
    token = cleanToken(token);
    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Invalid token format'
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const userData = await prisma.user.findUnique({
      where: { id: decoded.id },
      include: {
        company: true
      }
    });

    if (!userData) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    if (!userData.isActive) {
      return res.status(401).json({ success: false, message: 'Your account has been deactivated' });
    }

    const user = new User(userData);
    user.companyId = userData.companyId;
    req.user = user;
    return attachLocationScope(req, res, next);

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

exports.protect = async (req, res, next) => {
  let token;

  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  }

  if (!token) {
    return res.status(401).json({
      success: false,
      message: 'Not authorized to access this route. No token provided.'
    });
  }

  try {
    token = cleanToken(token);
    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Invalid token format'
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

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
        code: 'SUBSCRIPTION_REQUIRED'
      });
    }

    req.user = user;
    return attachLocationScope(req, res, next);

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