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
      trialStartDate: user.subscription.trialStartDate,
      trialEndDate: user.subscription.trialEndDate,
      subscriptionStartDate: user.subscription.startDate,
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
 * If company plan is unset/none but the user still has a valid sub, push user → company.
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

function healPayloadFromUser(user) {
  const row = asUserRecord(user);
  const plan = row.subscriptionPlan;
  return {
    subscriptionPlan: plan,
    subscriptionStatus: row.subscriptionStatus || 'active',
    trialStartDate: row.trialStartDate ?? null,
    trialEndDate: row.trialEndDate ?? null,
    subscriptionStartDate: row.subscriptionStartDate ?? null,
    subscriptionEndDate: row.subscriptionEndDate ?? null,
    billingCycle: plan === 'monthly' || plan === 'yearly' ? plan : null,
    productTier: 'erp_pos',
    licensedUsers: plan === 'trial' ? 999 : undefined,
    licensedBranches: plan === 'trial' ? 999 : undefined,
  };
}

function companyPlanUnset(company) {
  if (!company) return true;
  const plan = company.subscriptionPlan;
  return !plan || plan === 'none';
}

/** Child / secondary companies may inherit the account owner's active subscription. */
function companyCanInheritFromUser(company) {
  if (!company) return true;
  if (companyPlanUnset(company)) return true;
  // Never upgraded past trial (including expired trial) — sync from owner's paid/trial row
  if (company.subscriptionPlan === 'trial') return true;
  // Paid plan that ended — do not silently re-open
  return false;
}

function accessFromRecords(user, company) {
  if (company) {
    const companyAccess = companyHasActiveSubscription(company);
    const userAccess = userRecordHasAccess(user);

    if (companyAccess) {
      return {
        hasAccess: true,
        needsHeal: !userAccess,
        needsReverseHeal: false,
        user,
        company,
        healed: false,
      };
    }

    // Company missing/expired trial but account user still has a valid subscription —
    // allow ERP access and push user plan onto this company (multi-company switch).
    if (userAccess && companyCanInheritFromUser(company)) {
      return {
        hasAccess: true,
        needsHeal: false,
        needsReverseHeal: true,
        user,
        company,
        healed: false,
      };
    }

    return {
      hasAccess: false,
      needsHeal: false,
      needsReverseHeal: false,
      user,
      company,
      healed: false,
    };
  }
  return {
    hasAccess: userRecordHasAccess(user),
    needsHeal: false,
    needsReverseHeal: false,
    user,
    company: null,
    healed: false,
  };
}

const healInflight = new Set();
const reverseHealInflight = new Set();

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

/** Push account-owner subscription onto a company that has no active plan (e.g. child company). */
function scheduleReverseSubscriptionHeal(user, company) {
  if (!user || !company?.id) return;
  if (!userRecordHasAccess(user)) return;
  if (companyHasActiveSubscription(company)) return;
  if (!companyCanInheritFromUser(company)) return;
  if (reverseHealInflight.has(company.id)) return;
  reverseHealInflight.add(company.id);
  applyCompanySubscription(company.id, healPayloadFromUser(user))
    .catch((err) => console.error('[subscription reverse-heal]', err.message))
    .finally(() => reverseHealInflight.delete(company.id));
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

  if (evaluated.needsReverseHeal && user) {
    await applyCompanySubscription(companyId, healPayloadFromUser(user));
    const [refreshedUser, refreshedCompany] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId } }),
      prisma.company.findUnique({ where: { id: companyId } }),
    ]);
    return {
      hasAccess: true,
      user: refreshedUser,
      company: refreshedCompany,
      healed: true,
    };
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
  scheduleReverseSubscriptionHeal,
  resolveAndSyncSubscriptionAccess,
  healPayloadFromCompany,
  healPayloadFromUser,
};
