const jwt = require('jsonwebtoken');
const User = require('../models/User');
const prisma = require('../prisma/client');
const { attachLocationScope } = require('../utils/locationAccessHelper');
const {
  accessFromRecords,
  scheduleSubscriptionHeal,
  companyHasActiveSubscription,
} = require('../utils/companySubscription');
const { resolveActiveCompanyContext } = require('../utils/companyAccess');

const AUTH_TTL_MS = 8000;
const authCache = new Map();
const authInflight = new Map();

const cleanToken = (token) => {
  if (!token) return null;
  return token.trim().replace(/^"|"$/g, '').replace(/\s/g, '');
};

function isPlatformOwner(email) {
  const emails = (process.env.PLATFORM_OWNER_EMAILS || 'mfaisalakhan@gmail.com,kashif@gmail.com')
    .split(',').map((e) => e.trim().toLowerCase());
  return emails.includes((email || '').toLowerCase());
}

function invalidateAuthUser(userId) {
  if (userId) authCache.delete(userId);
}

async function loadUserWithCompany(userId) {
  const now = Date.now();
  const cached = authCache.get(userId);
  if (cached && cached.exp > now) return cached.row;

  if (authInflight.has(userId)) return authInflight.get(userId);

  const promise = prisma.user
    .findUnique({
      where: { id: userId },
      include: { company: true },
    })
    .then((row) => {
      if (row) authCache.set(userId, { row, exp: Date.now() + AUTH_TTL_MS });
      authInflight.delete(userId);
      return row;
    })
    .catch((err) => {
      authInflight.delete(userId);
      throw err;
    });

  authInflight.set(userId, promise);
  return promise;
}

function toReqUser(row, activeCompanyId, activeCompany) {
  const user = new User(row);
  user.companyId = activeCompanyId || null;
  user.company = activeCompany || null;
  user.primaryCompanyId = row.companyId || null;
  return user;
}

function readBearerToken(req) {
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    return req.headers.authorization.split(' ')[1];
  }
  return null;
}

function jwtErrorResponse(res, error) {
  if (error.name === 'JsonWebTokenError') {
    return res.status(401).json({ success: false, message: 'Invalid token. Please login again.' });
  }
  if (error.name === 'TokenExpiredError') {
    return res.status(401).json({ success: false, message: 'Token expired. Please login again.' });
  }
  return res.status(401).json({ success: false, message: 'Not authorized to access this route' });
}

async function runProtect(req, res, next, { requireSubscription }) {
  let token = readBearerToken(req);

  if (!token) {
    return res.status(401).json({
      success: false,
      message: requireSubscription
        ? 'Not authorized to access this route. No token provided.'
        : 'Not authorized to access this route'
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
    const row = await loadUserWithCompany(decoded.id);

    if (!row) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    if (!row.isActive) {
      return res.status(401).json({
        success: false,
        code: 'USER_INACTIVE',
        message: 'Your account has been deactivated. Please contact support.'
      });
    }

    const companyHeader =
      req.headers['x-company-id'] ||
      req.headers['x-active-company-id'] ||
      req.query?.companyId;

    let companyCtx;
    try {
      companyCtx = await resolveActiveCompanyContext(
        row.id,
        row.companyId,
        companyHeader
      );
    } catch (accessErr) {
      return res.status(accessErr.status || 403).json({
        success: false,
        code: accessErr.code || 'COMPANY_ACCESS_DENIED',
        message: accessErr.message || 'Company access denied',
      });
    }

    const activeCompany = companyCtx.company || null;

    if (
      companyCtx.mode === 'single' &&
      activeCompany &&
      !activeCompany.isActive &&
      !isPlatformOwner(row.email)
    ) {
      return res.status(403).json({
        success: false,
        code: 'COMPANY_INACTIVE',
        message: 'Your company account has been deactivated. Please contact support.'
      });
    }

    const subCompany =
      companyCtx.mode === 'single'
        ? activeCompany
        : row.company;
    const evaluated = accessFromRecords(row, subCompany);
    scheduleSubscriptionHeal(row, subCompany);

    if (requireSubscription && companyCtx.mode !== 'all' && !evaluated.hasAccess) {
      const now = new Date();
      const plan = row.subscriptionPlan;
      const status = row.subscriptionStatus;
      const trialGone = plan === 'trial' && row.trialEndDate && now > new Date(row.trialEndDate);
      const paidGone =
        (plan === 'monthly' || plan === 'yearly') &&
        status === 'active' &&
        row.subscriptionEndDate &&
        now > new Date(row.subscriptionEndDate);
      if (status === 'active' && (trialGone || paidGone) && !companyHasActiveSubscription(subCompany)) {
        prisma.user
          .update({
            where: { id: row.id },
            data: { subscriptionStatus: 'expired' },
          })
          .then(() => invalidateAuthUser(row.id))
          .catch(() => {});
      }
      return res.status(403).json({
        success: false,
        message: 'Subscription required. Please subscribe to access this feature.',
        code: 'SUBSCRIPTION_REQUIRED'
      });
    }

    req.user = toReqUser(row, companyCtx.companyId, activeCompany);
    req.authUserRow = row;
    req.companyMode = companyCtx.mode;
    req.accessibleCompanyIds = companyCtx.accessibleCompanyIds || [];
    req.companyMembership = {
      role: companyCtx.membershipRole,
      isOwner: companyCtx.isOwner,
    };
    return attachLocationScope(req, res, next);
  } catch (error) {
    console.error('Auth middleware error:', error);
    return jwtErrorResponse(res, error);
  }
}

exports.protectOnly = async (req, res, next) => {
  return runProtect(req, res, next, { requireSubscription: false });
};

exports.protect = async (req, res, next) => {
  return runProtect(req, res, next, { requireSubscription: true });
};

exports.invalidateAuthUser = invalidateAuthUser;
