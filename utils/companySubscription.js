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

function userRecordHasAccess(user) {
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
async function resolveAndSyncSubscriptionAccess(userId, companyId) {
  const [user, company] = await Promise.all([
    userId ? prisma.user.findUnique({ where: { id: userId } }) : null,
    companyId ? prisma.company.findUnique({ where: { id: companyId } }) : null,
  ]);

  const companyAccess = companyHasActiveSubscription(company);
  const userAccess = userRecordHasAccess(user);

  if (company && companyAccess && !userAccess) {
    await applyCompanySubscription(companyId, {
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
    });
    const refreshed = await prisma.user.findUnique({ where: { id: userId } });
    return { hasAccess: true, user: refreshed, company, healed: true };
  }

  if (company) {
    return { hasAccess: companyAccess, user, company, healed: false };
  }

  return { hasAccess: userAccess, user, company: null, healed: false };
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
  resolveAndSyncSubscriptionAccess,
};
