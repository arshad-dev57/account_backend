const prisma = require('../prisma/client');
const {
  TRIAL_DAYS,
  PRICING,
  calculatePrice,
  trialEndFromNow,
  getCompanyCapacity,
  buildUpgradeQuote,
  companyHasActiveSubscription,
  normalizeToUsd,
} = require('../utils/subscriptionPricing');

async function syncCompanySubscriptionToUsers(companyId, data) {
  if (!companyId) return;
  await prisma.user.updateMany({
    where: { companyId },
    data,
  });
}

async function applyCompanySubscription(companyId, {
  subscriptionPlan,
  subscriptionStatus = 'active',
  productTier,
  licensedUsers,
  licensedBranches,
  billingCycle,
  trialStartDate,
  trialEndDate,
  subscriptionStartDate,
  subscriptionEndDate,
} = {}) {
  const companyUpdate = {};
  if (subscriptionPlan) companyUpdate.subscriptionPlan = subscriptionPlan;
  if (subscriptionStatus) companyUpdate.subscriptionStatus = subscriptionStatus;
  if (productTier) companyUpdate.productTier = productTier;
  if (licensedUsers != null) companyUpdate.licensedUsers = licensedUsers;
  if (licensedBranches != null) companyUpdate.licensedBranches = licensedBranches;
  if (billingCycle) companyUpdate.billingCycle = billingCycle;
  if (trialStartDate !== undefined) companyUpdate.trialStartDate = trialStartDate;
  if (trialEndDate !== undefined) companyUpdate.trialEndDate = trialEndDate;
  if (subscriptionStartDate !== undefined) companyUpdate.subscriptionStartDate = subscriptionStartDate;
  if (subscriptionEndDate !== undefined) companyUpdate.subscriptionEndDate = subscriptionEndDate;

  await prisma.company.update({
    where: { id: companyId },
    data: companyUpdate,
  });

  const userUpdate = {};
  if (subscriptionPlan) userUpdate.subscriptionPlan = subscriptionPlan;
  if (subscriptionStatus) userUpdate.subscriptionStatus = subscriptionStatus;
  if (trialStartDate !== undefined) userUpdate.trialStartDate = trialStartDate;
  if (trialEndDate !== undefined) userUpdate.trialEndDate = trialEndDate;
  if (subscriptionStartDate !== undefined) userUpdate.subscriptionStartDate = subscriptionStartDate;
  if (subscriptionEndDate !== undefined) userUpdate.subscriptionEndDate = subscriptionEndDate;

  if (subscriptionPlan === 'monthly' || subscriptionPlan === 'yearly') {
    userUpdate.trialStartDate = null;
    userUpdate.trialEndDate = null;
  }

  if (Object.keys(userUpdate).length > 0) {
    await syncCompanySubscriptionToUsers(companyId, userUpdate);
  }
}

function asUserRecord(user) {
  if (!user) return user;
  if (user.subscriptionPlan != null || user.subscriptionStatus != null) return user;
  if (user.subscription) {
    return {
      subscriptionPlan: user.subscription.plan,
      subscriptionStatus: user.subscription.status,
      trialEndDate: user.subscription.trialEndDate,
      subscriptionEndDate: user.subscription.endDate,
    };
  }
  return user;
}

function userRecordHasAccess(user) {
  return userRecordHasAccessInner(asUserRecord(user));
}

function userRecordHasAccessInner(user) {
  if (!user) return false;
  const now = new Date();
  const plan = user.subscriptionPlan;
  const status = user.subscriptionStatus;

  if (plan === 'trial' && status !== 'expired') {
    if (!user.trialEndDate) return true;
    return now <= new Date(user.trialEndDate);
  }

  if (
    (plan === 'monthly' || plan === 'yearly') &&
    status === 'active' &&
    (!user.subscriptionEndDate || now <= new Date(user.subscriptionEndDate))
  ) {
    return true;
  }

  return false;
}

/**
 * Company subscription is the source of truth (platform admin assigns here).
 * If company is active but the user row is stale, re-sync all company users.
 */
function healPayloadFromCompany(company) {
  return {
    subscriptionPlan: company.subscriptionPlan,
    subscriptionStatus: company.subscriptionStatus || 'active',
    productTier: company.productTier,
    licensedUsers: company.licensedUsers,
    licensedBranches: company.licensedBranches,
    billingCycle: company.billingCycle,
    trialStartDate: company.trialStartDate,
    trialEndDate: company.trialEndDate,
    subscriptionStartDate: company.subscriptionStartDate,
    subscriptionEndDate: company.subscriptionEndDate,
  };
}

function accessFromRecords(user, company) {
  if (company) {
    const companyAccess = companyHasActiveSubscription(company);
    return {
      hasAccess: companyAccess,
      needsHeal: companyAccess && !userRecordHasAccess(user),
      user,
      company,
      healed: false,
    };
  }
  return {
    hasAccess: userRecordHasAccess(user),
    needsHeal: false,
    user,
    company: null,
    healed: false,
  };
}

const healInflight = new Set();

/** Stale user rows: sync in the background so request auth is not blocked. */
function scheduleSubscriptionHeal(user, company) {
  if (!user || !company?.id) return;
  if (!companyHasActiveSubscription(company) || userRecordHasAccess(user)) return;
  if (healInflight.has(company.id)) return;
  healInflight.add(company.id);
  applyCompanySubscription(company.id, healPayloadFromCompany(company))
    .catch((err) => console.error('[subscription heal]', err.message))
    .finally(() => healInflight.delete(company.id));
}

async function resolveAndSyncSubscriptionAccess(userId, companyId, preloaded = {}) {
  const [user, company] = await Promise.all([
    preloaded.user !== undefined
      ? preloaded.user
      : userId
        ? prisma.user.findUnique({ where: { id: userId } })
        : null,
    preloaded.company !== undefined
      ? preloaded.company
      : companyId
        ? prisma.company.findUnique({ where: { id: companyId } })
        : null,
  ]);

  const evaluated = accessFromRecords(user, company);

  if (evaluated.needsHeal) {
    await applyCompanySubscription(companyId, healPayloadFromCompany(company));
    const refreshed = await prisma.user.findUnique({ where: { id: userId } });
    return { hasAccess: true, user: refreshed, company, healed: true };
  }

  return evaluated;
}

function paidEndDate(plan, from = new Date()) {
  const end = new Date(from);
  if (plan === 'yearly') end.setFullYear(end.getFullYear() + 1);
  else end.setMonth(end.getMonth() + 1);
  return end;
}

module.exports = {
  TRIAL_DAYS,
  PRICING,
  calculatePrice,
  trialEndFromNow,
  getCompanyCapacity,
  buildUpgradeQuote,
  companyHasActiveSubscription,
  syncCompanySubscriptionToUsers,
  applyCompanySubscription,
  paidEndDate,
  normalizeToUsd,
  userRecordHasAccess,
  accessFromRecords,
  scheduleSubscriptionHeal,
  resolveAndSyncSubscriptionAccess,
};
