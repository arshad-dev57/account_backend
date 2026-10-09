const prisma = require('../prisma/client');

const DEMO_OTP_TTL_MS = 365 * 24 * 60 * 60 * 1000;
const DEMO_SUBSCRIPTION_YEARS = 2;

/** Built-in App Store / Play review accounts (merged with DEMO_LOGIN_EMAILS). */
const BUILTIN_DEMO_EMAILS = [
  'demo@bisonstechs.com',
  'appstore@bisonstechs.com',
];

function parseEmailList(value) {
  return String(value || '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

function isDemoLoginEmail(email) {
  const configured = parseEmailList(process.env.DEMO_LOGIN_EMAILS);
  const all = new Set([...BUILTIN_DEMO_EMAILS, ...configured]);
  return all.has(String(email || '').trim().toLowerCase());
}

function getDemoLoginOtp() {
  const otp = String(process.env.DEMO_LOGIN_OTP || '123456').trim();
  return /^\d{6}$/.test(otp) ? otp : '123456';
}

function getDemoOtpExpiry() {
  return new Date(Date.now() + DEMO_OTP_TTL_MS);
}

/** Full module + sub-page keys (matches Flutter user_management_controller). */
const DEMO_PERMISSION_PAGES = [
  'accounting',
  'accounting-dashboard',
  'accounting-chart-of-accounts',
  'accounting-bank-accounts',
  'accounting-bank-reconciliation',
  'accounting-invoices',
  'accounting-payments',
  'accounting-payments-received',
  'accounting-payments-made',
  'accounting-accounts-receivable',
  'accounting-accounts-payable',
  'accounting-credit-notes',
  'accounting-bills',
  'accounting-expenses',
  'accounting-revenue',
  'accounting-income',
  'accounting-journal-entries',
  'accounting-general-ledger',
  'accounting-trial-balance',
  'accounting-fixed-assets',
  'accounting-loans-borrowings',
  'accounting-capital-equity',
  'accounting-balance-sheet',
  'accounting-profit-loss',
  'accounting-cash-flow',
  'accounting-aged-receivables',
  'warehouse',
  'warehouse-products',
  'warehouse-categories',
  'warehouse-suppliers',
  'warehouse-stock-movement',
  'warehouse-customers',
  'warehouse-orders',
  'warehouse-returns',
  'warehouse-refunds',
  'sales',
  'sales-dashboard',
  'sales-products',
  'sales-orders',
  'sales-quotations',
  'sales-customers',
  'sales-deliveries',
  'sales-invoices',
  'sales-sales-payments',
  'sales-sales-returns',
  'sales-refunds',
  'sales-credits',
  'purchases',
  'purchases-dashboard',
  'purchases-products',
  'purchases-purchase-orders',
  'purchases-suppliers',
  'purchases-goods-receiving',
  'purchases-purchase-invoices',
  'purchases-purchase-payments',
  'purchases-purchase-returns',
  'pos',
  'pos-register',
  'pos-management',
  'users',
  'users-user-management',
  'users-roles',
  'users-permissions',
  'manufacturing',
  'hr',
];

async function ensureDemoPermissions(userId) {
  if (!prisma.userPermission?.deleteMany) return;

  await prisma.userPermission.deleteMany({ where: { userId } });
  await prisma.userPermission.createMany({
    data: DEMO_PERMISSION_PAGES.map((page) => ({
      userId,
      page,
      canView: true,
      canCreate: true,
      canEdit: true,
      canDelete: true,
    })),
    skipDuplicates: true,
  });
}

/**
 * Keep store-review demo accounts on full ERP access:
 * admin role, erp_pos tier, all page permissions, long subscription.
 */
async function ensureDemoSubscription(userId, companyId) {
  const now = new Date();
  const end = new Date(now);
  end.setFullYear(end.getFullYear() + DEMO_SUBSCRIPTION_YEARS);

  await prisma.user.update({
    where: { id: userId },
    data: {
      role: 'admin',
      isActive: true,
      subscriptionPlan: 'yearly',
      subscriptionStatus: 'active',
      subscriptionStartDate: now,
      subscriptionEndDate: end,
      trialStartDate: now,
      trialEndDate: end,
      failedLoginAttempts: 0,
      lockUntil: null,
    },
  });

  await ensureDemoPermissions(userId);

  if (companyId) {
    await prisma.company.update({
      where: { id: companyId },
      data: {
        isActive: true,
        productTier: 'erp_pos',
        subscriptionPlan: 'yearly',
        subscriptionStatus: 'active',
        subscriptionStartDate: now,
        subscriptionEndDate: end,
        trialStartDate: now,
        trialEndDate: end,
        licensedUsers: 999,
        licensedBranches: 999,
      },
    });
  }

  return end;
}

module.exports = {
  isDemoLoginEmail,
  getDemoLoginOtp,
  getDemoOtpExpiry,
  ensureDemoSubscription,
  ensureDemoPermissions,
  DEMO_PERMISSION_PAGES,
};
