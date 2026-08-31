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

  await syncCompanySubscriptionToUsers(companyId, userUpdate);
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
};
