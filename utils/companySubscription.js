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

const BILLING_SELECT = {
  id: true,
  parentCompanyId: true,
  subscriptionPlan: true,
  subscriptionStatus: true,
  productTier: true,
  licensedUsers: true,
  licensedBranches: true,
  billingCycle: true,
  trialStartDate: true,
  trialEndDate: true,
  subscriptionStartDate: true,
  subscriptionEndDate: true,
  isActive: true,
  name: true,
};

/**
 * Walk parentCompanyId to the billing root. Child companies never own their own trial/plan.
 */
async function resolveBillingCompany(companyOrId, preloaded) {
  let company =
    preloaded ||
    (companyOrId && typeof companyOrId === 'object'
      ? companyOrId
      : companyOrId
        ? await prisma.company.findUnique({
            where: { id: companyOrId },
            select: BILLING_SELECT,
          })
        : null);

  if (!company) return null;

  const seen = new Set();
  while (company.parentCompanyId) {
    if (seen.has(company.id)) break;
    seen.add(company.id);
    const parent = await prisma.company.findUnique({
      where: { id: company.parentCompanyId },
      select: BILLING_SELECT,
    });
    if (!parent) break;
    company = parent;
  }
  return company;
}

function subscriptionFieldsFromCompany(company) {
  if (!company) return null;
  return {
    subscriptionPlan: company.subscriptionPlan,
    subscriptionStatus: company.subscriptionStatus || 'active',
    productTier: company.productTier || 'erp_pos',
    licensedUsers: company.licensedUsers || 999,
    licensedBranches: company.licensedBranches || 999,
    trialStartDate: company.trialStartDate ?? null,
    trialEndDate: company.trialEndDate ?? null,
    subscriptionStartDate: company.subscriptionStartDate ?? null,
    subscriptionEndDate: company.subscriptionEndDate ?? null,
    billingCycle: company.billingCycle || null,
  };
}

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
  // Always write billing fields on the root parent — children share that plan.
  const billing = await resolveBillingCompany(companyId);
  const targetId = billing?.id || companyId;

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
    where: { id: targetId },
    data: companyUpdate,
  });

  // Mirror display fields onto direct children so list APIs stay consistent
  if (Object.keys(companyUpdate).length > 0) {
    await prisma.company.updateMany({
      where: { parentCompanyId: targetId },
      data: companyUpdate,
    });
  }

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
    const childIds = (
      await prisma.company.findMany({
        where: { parentCompanyId: targetId },
        select: { id: true },
      })
    ).map((c) => c.id);
    const orgIds = [targetId, ...childIds];
    await prisma.user.updateMany({
      where: { companyId: { in: orgIds } },
      data: userUpdate,
    });
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
  // Resolve happens async; heal targets billing root via applyCompanySubscription
  if (!companyHasActiveSubscription(company) || userRecordHasAccess(user)) return;
  if (healInflight.has(company.id)) return;
  healInflight.add(company.id);
  Promise.resolve()
    .then(async () => {
      const billing = await resolveBillingCompany(company.id, company);
      if (!billing || !companyHasActiveSubscription(billing)) return;
      if (userRecordHasAccess(user)) return;
      await applyCompanySubscription(billing.id, healPayloadFromCompany(billing));
    })
    .catch((err) => console.error('[subscription heal]', err.message))
    .finally(() => healInflight.delete(company.id));
}

/** Push account-owner subscription onto a company that has no active plan (e.g. legacy child). */
function scheduleReverseSubscriptionHeal(user, company) {
  if (!user || !company?.id) return;
  if (!userRecordHasAccess(user)) return;
  // Children with parentCompanyId never get their own plan written — parent is source of truth
  if (company.parentCompanyId) return;
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

  const billingCompany = company
    ? await resolveBillingCompany(company.id, company)
    : null;

  const evaluated = accessFromRecords(user, billingCompany || company);

  if (evaluated.needsHeal && billingCompany) {
    await applyCompanySubscription(billingCompany.id, healPayloadFromCompany(billingCompany));
    const refreshed = await prisma.user.findUnique({ where: { id: userId } });
    return { hasAccess: true, user: refreshed, company: billingCompany, healed: true };
  }

  if (evaluated.needsReverseHeal && user && billingCompany) {
    await applyCompanySubscription(billingCompany.id, healPayloadFromUser(user));
    const [refreshedUser, refreshedCompany] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId } }),
      prisma.company.findUnique({ where: { id: billingCompany.id } }),
    ]);
    return {
      hasAccess: true,
      user: refreshedUser,
      company: refreshedCompany,
      healed: true,
    };
  }

  return { ...evaluated, company: billingCompany || company };
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
  resolveBillingCompany,
  subscriptionFieldsFromCompany,
  healPayloadFromCompany,
  healPayloadFromUser,
};
