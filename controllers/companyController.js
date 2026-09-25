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
        activeCompanyId: req.companyMode === 'all' ? ALL_COMPANIES_VALUE : req.user.companyId,
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
    const trialEnd = new Date(now);
    trialEnd.setDate(trialEnd.getDate() + TRIAL_DAYS);

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
        subscriptionPlan: 'trial',
        subscriptionStatus: 'active',
        productTier: 'erp_pos',
        licensedUsers: 999,
        licensedBranches: 999,
        trialStartDate: now,
        trialEndDate: trialEnd,
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

    // Fiscal year
    try {
      const currentYear = new Date().getFullYear();
      await prisma.fiscalYear.create({
        data: {
          companyId: company.id,
          name: `FY ${currentYear}`,
          startDate: new Date(`${currentYear}-01-01`),
          endDate: new Date(`${currentYear}-12-31`),
          status: 'Open',
          periodType: body.fiscalYear || 'January - December',
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

    // Do NOT create a warehouse automatically.

    invalidateAuthUser(userId);

    res.status(201).json({
      success: true,
      message: `Company "${company.name}" created successfully`,
      data: companyPublic(company),
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
