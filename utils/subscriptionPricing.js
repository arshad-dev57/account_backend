/** Subscription pricing & capacity helpers (USD) */

const TRIAL_DAYS = 14;

/** PKR list prices → USD (4000 PKR ≈ $14/user/mo) */
const PKR_TO_USD = 4000 / 14;

function normalizeToUsd(amount, currency) {
  const c = (currency || 'USD').toUpperCase();
  if (c === 'PKR') return Number(amount || 0) / PKR_TO_USD;
  return Number(amount || 0);
}

const PRICING = {
  pos: {
    label: 'POS (Desktop)',
    monthlyPerUser: 14,
    yearlyPerUser: 86,
    currency: 'USD',
    features: [
      'Desktop POS app (Windows / Mac)',
      'Offline sales & sync when online',
      'Shifts, terminals & receipts',
      'Barcode / QR scanning',
      'Cash drawer & thermal printer',
      'Held sales & returns',
    ],
  },
  erp_pos: {
    label: 'ERP + POS',
    monthlyBase: 36,
    yearlyBase: 257,
    currency: 'USD',
    features: [
      'Full web ERP (accounting, sales, purchases, warehouse)',
      'Desktop POS with offline mode',
      '1 user + 1 branch included in base price',
      'Reports, tax compliance & multi-location',
      'User permissions & audit trail',
      'Priority support',
    ],
  },
};

function clampInt(n, min = 1) {
  const v = parseInt(n, 10);
  if (!Number.isFinite(v) || v < min) return min;
  return v;
}

/**
 * POS: per-user linear pricing.
 * ERP+POS: base × users × branches (each additional user or branch doubles total).
 */
function calculatePrice(productTier, billingCycle, users = 1, branches = 1) {
  const tier = productTier === 'pos' ? 'pos' : 'erp_pos';
  const cycle = billingCycle === 'yearly' ? 'yearly' : 'monthly';
  const u = clampInt(users);
  const b = clampInt(branches);

  if (tier === 'pos') {
    const rate = cycle === 'yearly' ? PRICING.pos.yearlyPerUser : PRICING.pos.monthlyPerUser;
    return {
      productTier: tier,
      billingCycle: cycle,
      licensedUsers: u,
      licensedBranches: b,
      amount: rate * u,
      currency: PRICING.pos.currency,
      breakdown: `$${rate.toLocaleString()} × ${u} user(s)`,
    };
  }

  const rate = cycle === 'yearly' ? PRICING.erp_pos.yearlyBase : PRICING.erp_pos.monthlyBase;
  return {
    productTier: tier,
    billingCycle: cycle,
    licensedUsers: u,
    licensedBranches: b,
    amount: rate * u * b,
    currency: PRICING.erp_pos.currency,
    breakdown: `$${rate.toLocaleString()} × ${u} user(s) × ${b} branch(es)`,
  };
}

function trialEndFromNow() {
  return new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000);
}

function isCompanyTrialActive(company) {
  if (!company) return false;
  if (company.subscriptionPlan !== 'trial') return false;
  if (company.subscriptionStatus === 'expired') return false;
  if (!company.trialEndDate) return true;
  return new Date() <= new Date(company.trialEndDate);
}

function isCompanyPaidActive(company) {
  if (!company) return false;
  const plan = company.subscriptionPlan;
  if (plan !== 'monthly' && plan !== 'yearly') return false;
  if (company.subscriptionStatus !== 'active') return false;
  if (!company.subscriptionEndDate) return true;
  return new Date() <= new Date(company.subscriptionEndDate);
}

function companyHasActiveSubscription(company) {
  return isCompanyTrialActive(company) || isCompanyPaidActive(company);
}

async function getCompanyUsage(prisma, companyId) {
  const [usedUsers, usedBranches] = await Promise.all([
    prisma.user.count({ where: { companyId, isActive: true } }),
    prisma.location.count({ where: { companyId, isDeleted: false } }),
  ]);
  return { usedUsers, usedBranches };
}

async function getCompanyCapacity(prisma, companyId) {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: {
      id: true,
      subscriptionPlan: true,
      subscriptionStatus: true,
      trialStartDate: true,
      trialEndDate: true,
      subscriptionStartDate: true,
      subscriptionEndDate: true,
      productTier: true,
      licensedUsers: true,
      licensedBranches: true,
      billingCycle: true,
    },
  });

  if (!company) {
    const err = new Error('Company not found');
    err.statusCode = 404;
    throw err;
  }

  const { usedUsers, usedBranches } = await getCompanyUsage(prisma, companyId);
  const isTrial = isCompanyTrialActive(company);
  const isPaid = isCompanyPaidActive(company);
  const productTier = company.productTier === 'pos' ? 'pos' : 'erp_pos';
  const licensedUsers = company.licensedUsers || 1;
  const licensedBranches = company.licensedBranches || 1;
  const billingCycle = company.billingCycle || company.subscriptionPlan;

  const quote = calculatePrice(
    productTier,
    billingCycle === 'yearly' ? 'yearly' : 'monthly',
    licensedUsers,
    licensedBranches
  );

  const hasAccess = companyHasActiveSubscription(company);

  return {
    companyId: company.id,
    productTier,
    billingCycle: billingCycle === 'yearly' ? 'yearly' : 'monthly',
    subscriptionPlan: company.subscriptionPlan,
    subscriptionStatus: company.subscriptionStatus,
    isTrial,
    isPaid,
    hasAccess,
    licensedUsers,
    licensedBranches,
    usedUsers,
    usedBranches,
    trialEndDate: company.trialEndDate,
    subscriptionEndDate: company.subscriptionEndDate,
    currentAmount: isPaid ? quote.amount : 0,
    canAddUser: hasAccess && (licensedUsers >= 999 || usedUsers < licensedUsers),
    canAddBranch:
      hasAccess &&
      (productTier === 'pos' || licensedBranches >= 999 || usedBranches < licensedBranches),
    needsUpgradeForUser: hasAccess && licensedUsers < 999 && usedUsers >= licensedUsers,
    needsUpgradeForBranch:
      hasAccess &&
      productTier === 'erp_pos' &&
      licensedBranches < 999 &&
      usedBranches >= licensedBranches,
  };
}

function buildUpgradeQuote(capacity, { addUsers = 0, addBranches = 0 } = {}) {
  const nextUsers = clampInt((capacity.licensedUsers || 1) + addUsers);
  const nextBranches = clampInt((capacity.licensedBranches || 1) + addBranches);
  const current = calculatePrice(
    capacity.productTier,
    capacity.billingCycle,
    capacity.licensedUsers,
    capacity.licensedBranches
  );
  const next = calculatePrice(
    capacity.productTier,
    capacity.billingCycle,
    nextUsers,
    nextBranches
  );
  return {
    current,
    next,
    delta: next.amount - current.amount,
    licensedUsers: nextUsers,
    licensedBranches: nextBranches,
  };
}

module.exports = {
  TRIAL_DAYS,
  PKR_TO_USD,
  normalizeToUsd,
  PRICING,
  calculatePrice,
  trialEndFromNow,
  isCompanyTrialActive,
  isCompanyPaidActive,
  companyHasActiveSubscription,
  getCompanyUsage,
  getCompanyCapacity,
  buildUpgradeQuote,
};
