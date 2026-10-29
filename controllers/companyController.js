'use strict';

const prisma = require('../prisma/client');
const { TRIAL_DAYS } = require('../utils/subscriptionPricing');
const { initializeDefaultChartOfAccounts } = require('../services/defaultChartOfAccountsService');
const {
  ALL_COMPANIES_VALUE,
  listMembershipsForUser,
  ensureMembershipForUserCompany,
  requireSingleCompany,
} = require('../utils/companyAccess');
const { invalidateAuthUser } = require('../middleware/authMiddleware');
const { initializeCompanyCurrencyConfiguration } = require('../services/companyCurrencyService');
const { ensureFxAccounts } = require('../utils/fxAccountHelper');

/**
 * Build opening fiscal-year dates from the company period label
 * (e.g. "April - March", "July - June", "January - December").
 */
function fiscalYearDatesFromPeriod(periodType) {
  const period = String(periodType || 'January - December').trim();
  const now = new Date();
  const y = now.getFullYear();
  const month = now.getMonth(); // 0-based

  const pad = (n) => String(n).padStart(2, '0');
  const toDate = (year, m, d) => new Date(`${year}-${pad(m)}-${pad(d)}`);

  if (/april\s*-\s*march/i.test(period)) {
    // Apr 1 → Mar 31 next year
    const startYear = month >= 3 ? y : y - 1;
    return {
      name: `FY ${startYear}-${String(startYear + 1).slice(-2)}`,
      startDate: toDate(startYear, 4, 1),
      endDate: toDate(startYear + 1, 3, 31),
      periodType: period,
    };
  }
  if (/july\s*-\s*june/i.test(period)) {
    const startYear = month >= 6 ? y : y - 1;
    return {
      name: `FY ${startYear}-${String(startYear + 1).slice(-2)}`,
      startDate: toDate(startYear, 7, 1),
      endDate: toDate(startYear + 1, 6, 30),
      periodType: period,
    };
  }
  if (/october\s*-\s*september/i.test(period)) {
    const startYear = month >= 9 ? y : y - 1;
    return {
      name: `FY ${startYear}-${String(startYear + 1).slice(-2)}`,
      startDate: toDate(startYear, 10, 1),
      endDate: toDate(startYear + 1, 9, 30),
      periodType: period,
    };
  }
  // Default: calendar year
  return {
    name: `FY ${y}`,
    startDate: toDate(y, 1, 1),
    endDate: toDate(y, 12, 31),
    periodType: period || 'January - December',
  };
}

function companyPublic(c) {
  if (!c) return null;
  return {
    id: c.id,
    name: c.name,
    email: c.email,
    phone: c.phone,
    address: c.address,
    businessType: c.businessType,
    taxRegistrationNumber: c.taxRegistrationNumber,
    logo: c.logo,
    website: c.website,
    isActive: c.isActive,
    parentCompanyId: c.parentCompanyId || null,
    subscriptionPlan: c.subscriptionPlan,
    subscriptionStatus: c.subscriptionStatus,
    productTier: c.productTier,
    trialEndDate: c.trialEndDate,
    subscriptionEndDate: c.subscriptionEndDate,
    createdAt: c.createdAt,
  };
}

// GET /api/companies/mine
exports.listMyCompanies = async (req, res) => {
  try {
    const userId = req.user.id;
    const memberships = await listMembershipsForUser(userId);

    // Heal primary company membership if missing
    if (req.user.primaryCompanyId) {
      await ensureMembershipForUserCompany(userId, req.user.primaryCompanyId, {
        role: 'admin',
        isOwner: true,
      });
    }

    const fresh = memberships.length
      ? memberships
      : await listMembershipsForUser(userId);

    const companies = fresh
      .filter((m) => m.company)
      .map((m) => ({
        ...companyPublic(m.company),
        membershipRole: m.role,
        isOwner: m.isOwner,
        isPrimary: m.companyId === req.user.primaryCompanyId,
      }));

    res.json({
      success: true,
      data: {
        companies,
        // Header-resolved company for this request
        activeCompanyId: req.companyMode === 'all' ? ALL_COMPANIES_VALUE : req.user.companyId,
        // DB preferred / primary — what POS and other clients should follow after ERP switch
        preferredCompanyId: req.user.primaryCompanyId || req.user.companyId || null,
        companyMode: req.companyMode || 'single',
        allCompaniesValue: ALL_COMPANIES_VALUE,
      },
    });
  } catch (err) {
    console.error('listMyCompanies error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/companies
exports.createCompany = async (req, res) => {
  try {
    const userId = req.user.id;
    const body = req.body || {};
    const name = String(body.name || body.organizationName || '').trim();
    if (!name) {
      return res.status(400).json({ success: false, message: 'Company name is required' });
    }

    const now = new Date();
    const {
      resolveBillingCompany,
      subscriptionFieldsFromCompany,
      userRecordHasAccess,
    } = require('../utils/companySubscription');

    // Existing active/primary company → this create is a child under that org's billing root.
    const sourceCompanyId = req.user.companyId || req.user.primaryCompanyId || null;
    let parentCompanyId = null;
    let billingRoot = null;
    if (sourceCompanyId) {
      billingRoot = await resolveBillingCompany(sourceCompanyId);
      if (billingRoot) parentCompanyId = billingRoot.id;
    }

    let subFields;
    if (billingRoot) {
      // Child never gets its own trial — mirror parent's plan exactly (even if expired).
      subFields = subscriptionFieldsFromCompany(billingRoot);
    } else {
      // First company for this account → start a fresh trial on this root company.
      const trialEnd = new Date(now);
      trialEnd.setDate(trialEnd.getDate() + TRIAL_DAYS);
      subFields = {
        subscriptionPlan: 'trial',
        subscriptionStatus: 'active',
        productTier: 'erp_pos',
        licensedUsers: 999,
        licensedBranches: 999,
        trialStartDate: now,
        trialEndDate: trialEnd,
        subscriptionStartDate: null,
        subscriptionEndDate: null,
        billingCycle: null,
      };
      try {
        const userRow = await prisma.user.findUnique({ where: { id: userId } });
        if (userRow && userRecordHasAccess(userRow)) {
          const plan = userRow.subscriptionPlan;
          subFields = {
            subscriptionPlan: plan,
            subscriptionStatus: userRow.subscriptionStatus || 'active',
            productTier: 'erp_pos',
            licensedUsers: plan === 'trial' ? 999 : 999,
            licensedBranches: plan === 'trial' ? 999 : 999,
            trialStartDate: userRow.trialStartDate,
            trialEndDate: userRow.trialEndDate,
            subscriptionStartDate: userRow.subscriptionStartDate,
            subscriptionEndDate: userRow.subscriptionEndDate,
            billingCycle: plan === 'monthly' || plan === 'yearly' ? plan : null,
          };
        }
      } catch (subErr) {
        console.warn('[createCompany] user subscription copy skipped:', subErr.message);
      }
    }

    const company = await prisma.company.create({
      data: {
        name,
        email: body.email ? String(body.email).trim() : null,
        phone: body.phone ? String(body.phone).trim() : '',
        address: body.address ? String(body.address).trim() : '',
        businessType: body.businessType ? String(body.businessType).trim() : '',
        taxRegistrationNumber: body.taxRegistrationNumber
          ? String(body.taxRegistrationNumber).trim()
          : '',
        logo: body.logo || '',
        website: body.website || body.websiteLink || '',
        parentCompanyId,
        ...subFields,
        posMode: 'retail',
        posModeConfigured: false,
      },
    });

    await ensureMembershipForUserCompany(userId, company.id, {
      role: 'admin',
      isOwner: true,
      forceRole: true,
    });

    // Keep primary companyId if user had none
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { companyId: true },
    });
    if (!user?.companyId) {
      await prisma.user.update({
        where: { id: userId },
        data: { companyId: company.id },
      });
    }

    // Fiscal year — dates follow the company's selected period
    try {
      const fy = fiscalYearDatesFromPeriod(body.fiscalYear || body.periodType);
      await prisma.fiscalYear.create({
        data: {
          companyId: company.id,
          name: fy.name,
          startDate: fy.startDate,
          endDate: fy.endDate,
          status: 'Open',
          periodType: fy.periodType,
        },
      });
    } catch (fyErr) {
      console.error('createCompany FY warning:', fyErr.message);
    }

    try {
      await initializeDefaultChartOfAccounts(company.id, userId);
    } catch (coaErr) {
      console.error('createCompany COA warning:', coaErr.message);
    }

    // Multi-currency: honor the requested base currency (or inherit the parent
    // company's base), seed the master, and initialize company rates. Provider
    // outages never block company creation — missing rates are reported instead.
    try {
      const currencyInit = await initializeCompanyCurrencyConfiguration({
        companyId: company.id,
        userId,
        baseCurrencyCode: body.baseCurrencyCode || body.currencyCode || null,
        baseCurrencyId: body.baseCurrencyId || null,
        fetchRates: true,
      });
      company.baseCurrencyId = currencyInit.baseCurrency.id;
      console.log(
        `createCompany currency initialized: base=${currencyInit.baseCurrency.code} created=${currencyInit.created.length} missing=${currencyInit.missing.length}`
      );
    } catch (currencyErr) {
      console.error('createCompany currency warning:', currencyErr.message);
    }

    try {
      await ensureFxAccounts(userId, company.id);
    } catch (fxErr) {
      console.error('createCompany FX account warning:', fxErr.message);
    }

    // ERPNext seeds default Departments / Designations (and related HR masters)
    // when a company is created — same fixtures, company-scoped.
    try {
      const { ensureHrMasterFixtures } = require('../services/hrMasterFixtures');
      await ensureHrMasterFixtures(company.id);
    } catch (hrFixtureErr) {
      console.error('createCompany HR master fixtures warning:', hrFixtureErr.message);
    }

    // Business model config: children inherit parent; root uses request or defaults
    let businessConfig = null;
    try {
      const {
        parseBusinessConfigFromRequestBody,
        inheritBusinessConfigFromParent,
        seedCompanyBusinessConfig,
        updateCompanyBusinessConfig,
      } = require('../utils/companyBusinessConfig');
      const requested = parseBusinessConfigFromRequestBody(body);
      if (parentCompanyId) {
        businessConfig = await inheritBusinessConfigFromParent(company.id, parentCompanyId);
        if (Object.keys(requested).length > 0 && businessConfig.allowChildConfigOverride) {
          businessConfig = await updateCompanyBusinessConfig(company.id, requested);
        }
      } else {
        businessConfig = await seedCompanyBusinessConfig(company.id, requested);
      }
    } catch (cfgErr) {
      console.error('createCompany business config warning:', cfgErr.message);
    }

    // Do NOT create a warehouse automatically.

    invalidateAuthUser(userId);

    const billingNote = parentCompanyId
      ? ' (shares parent company trial/subscription)'
      : '';

    res.status(201).json({
      success: true,
      message: `Company "${company.name}" created successfully${billingNote}`,
      data: {
        ...companyPublic(company),
        businessConfig: businessConfig || undefined,
      },
    });
  } catch (err) {
    console.error('createCompany error:', err);
    if (err.code === 'P2002') {
      return res.status(400).json({
        success: false,
        message: 'A company with this email already exists',
      });
    }
    res.status(500).json({ success: false, message: err.message });
  }
};

// PUT /api/companies/active — persist preferred primary company (optional)
exports.setPrimaryCompany = async (req, res) => {
  try {
    const userId = req.user.id;
    const companyId = String(req.body.companyId || '').trim();
    if (!companyId || companyId === ALL_COMPANIES_VALUE) {
      return res.status(400).json({
        success: false,
        message: 'A specific company id is required',
      });
    }

    const { userHasCompanyAccess } = require('../utils/companyAccess');
    const ok = await userHasCompanyAccess(userId, companyId);
    if (!ok) {
      return res.status(403).json({
        success: false,
        code: 'COMPANY_ACCESS_DENIED',
        message: 'You do not have access to this company',
      });
    }

    await prisma.user.update({
      where: { id: userId },
      data: { companyId },
    });
    invalidateAuthUser(userId);

    // If this company has no active plan, evaluate against billing parent / inherit
    try {
      const {
        accessFromRecords,
        scheduleReverseSubscriptionHeal,
        resolveBillingCompany,
      } = require('../utils/companySubscription');
      const [userRow, company] = await Promise.all([
        prisma.user.findUnique({ where: { id: userId } }),
        prisma.company.findUnique({ where: { id: companyId } }),
      ]);
      const billing = company
        ? (await resolveBillingCompany(company.id, company)) || company
        : null;
      const evaluated = accessFromRecords(userRow, billing);
      if (evaluated.needsReverseHeal && billing && !billing.parentCompanyId) {
        scheduleReverseSubscriptionHeal(userRow, billing);
      }
    } catch (healErr) {
      console.warn('[setPrimaryCompany] subscription inherit skipped:', healErr.message);
    }

    res.json({
      success: true,
      message: 'Primary company updated',
      data: { companyId },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/companies/consolidated-dashboard
exports.consolidatedDashboard = async (req, res) => {
  try {
    const ids = req.accessibleCompanyIds || [];
    if (!ids.length) {
      return res.json({
        success: true,
        data: {
          mode: 'all',
          companyCount: 0,
          totals: emptyTotals(),
          companies: [],
        },
      });
    }

    const companies = await prisma.company.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true, logo: true, businessType: true, isActive: true },
      orderBy: { name: 'asc' },
    });

    const breakdown = [];
    const totals = emptyTotals();

    for (const c of companies) {
      const stats = await companyDashboardStats(c.id);
      breakdown.push({
        companyId: c.id,
        companyName: c.name,
        logo: c.logo,
        businessType: c.businessType,
        isActive: c.isActive,
        ...stats,
      });
      totals.revenue += stats.revenue;
      totals.expenses += stats.expenses;
      totals.profit += stats.profit;
      totals.receivables += stats.receivables;
      totals.payables += stats.payables;
      totals.sales += stats.sales;
      totals.purchases += stats.purchases;
      totals.cashBank += stats.cashBank;
    }

    res.json({
      success: true,
      data: {
        mode: 'all',
        companyCount: companies.length,
        totals,
        companies: breakdown,
      },
    });
  } catch (err) {
    console.error('consolidatedDashboard error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

function emptyTotals() {
  return {
    revenue: 0,
    expenses: 0,
    profit: 0,
    receivables: 0,
    payables: 0,
    sales: 0,
    purchases: 0,
    cashBank: 0,
  };
}

async function sumField(model, where, field) {
  try {
    const agg = await prisma[model].aggregate({
      where,
      _sum: { [field]: true },
    });
    return Number(agg._sum?.[field] || 0);
  } catch {
    return 0;
  }
}

async function companyDashboardStats(companyId) {
  const safe = async (fn) => {
    try {
      return await fn();
    } catch {
      return 0;
    }
  };

  const [incomeTotal, expenseTotal, salesTotal, purchaseTotal, bankBalance, arOutstanding, apOutstanding] =
    await Promise.all([
      safe(() => sumField('income', { companyId }, 'amount')),
      safe(() => sumField('expense', { companyId }, 'amount')),
      safe(() => sumField('salesInvoice', { companyId, isDeleted: false }, 'grandTotal')),
      safe(() => sumField('purchaseInvoice', { companyId }, 'grandTotal')),
      safe(() => sumField('bankAccount', { companyId }, 'currentBalance')),
      safe(() => sumField('salesInvoice', { companyId, isDeleted: false }, 'outstanding')),
      safe(() => sumField('purchaseInvoice', { companyId }, 'outstanding')),
    ]);

  const revenue = salesTotal || incomeTotal || 0;
  const expenses = expenseTotal || 0;
  return {
    revenue,
    expenses,
    profit: revenue - expenses,
    receivables: arOutstanding || 0,
    payables: apOutstanding || 0,
    sales: salesTotal || 0,
    purchases: purchaseTotal || 0,
    cashBank: bankBalance || 0,
  };
}

exports.requireSingleCompanyGuard = (req, res, next) => {
  try {
    requireSingleCompany(req);
    next();
  } catch (err) {
    return res.status(err.status || 400).json({
      success: false,
      code: err.code || 'COMPANY_REQUIRED',
      message: err.message,
    });
  }
};

// GET /api/companies/business-config — effective config for active company
exports.getBusinessConfig = async (req, res) => {
  try {
    const companyId = requireSingleCompany(req);
    const {
      resolveEffectiveCompanyConfig,
      getParentOverridePolicy,
      OPERATIONAL_BUSINESS_TYPES,
      SALES_MODELS,
      PURCHASE_MODELS,
      INSTALLMENT_REVENUE_POLICIES,
    } = require('../utils/companyBusinessConfig');

    const config = await resolveEffectiveCompanyConfig(companyId);
    const parentPolicy = await getParentOverridePolicy(companyId);

    res.json({
      success: true,
      data: {
        ...config,
        canEdit: !parentPolicy.isChild || parentPolicy.allowOverride,
        parentPolicy: parentPolicy.isChild
          ? {
              parentCompanyId: parentPolicy.parentCompanyId,
              allowChildConfigOverride: parentPolicy.allowOverride,
            }
          : null,
        options: {
          operationalBusinessTypes: OPERATIONAL_BUSINESS_TYPES,
          salesModels: SALES_MODELS,
          purchaseModels: PURCHASE_MODELS,
          installmentRevenuePolicies: INSTALLMENT_REVENUE_POLICIES,
        },
      },
    });
  } catch (err) {
    console.error('getBusinessConfig error:', err);
    res.status(err.statusCode || err.status || 500).json({
      success: false,
      code: err.code,
      message: err.message,
    });
  }
};

// PATCH /api/companies/business-config — update active company business model
exports.updateBusinessConfig = async (req, res) => {
  try {
    const companyId = requireSingleCompany(req);
    const role = String(req.user.role || '').toLowerCase();
    if (!['admin', 'owner', 'superadmin', 'platform_admin'].includes(role)) {
      return res.status(403).json({
        success: false,
        message: 'Only company admins can update business configuration',
      });
    }

    const {
      parseBusinessConfigFromRequestBody,
      updateCompanyBusinessConfig,
    } = require('../utils/companyBusinessConfig');

    const patch = parseBusinessConfigFromRequestBody(req.body || {});
    if (Object.keys(patch).length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No business configuration fields provided',
      });
    }

    const result = await updateCompanyBusinessConfig(companyId, patch);
    res.json({
      success: true,
      message:
        'Business configuration updated. Historical transactions and accounting records were not modified.',
      data: result,
      warnings: result.warnings || [],
    });
  } catch (err) {
    console.error('updateBusinessConfig error:', err);
    res.status(err.statusCode || err.status || 500).json({
      success: false,
      code: err.code,
      message: err.message,
      errors: err.errors,
    });
  }
};
