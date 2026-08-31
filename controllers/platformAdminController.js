const prisma = require('../prisma/client');
const {
  applyCompanySubscription,
  paidEndDate,
  trialEndFromNow,
  getCompanyCapacity,
  calculatePrice,
  TRIAL_DAYS,
} = require('../utils/companySubscription');

const COMPANY_SUBSCRIPTION_SELECT = {
  id: true,
  name: true,
  email: true,
  phone: true,
  businessType: true,
  isActive: true,
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
  createdAt: true,
};

async function companyWithCapacity(companyId) {
  const [company, capacity] = await Promise.all([
    prisma.company.findUnique({
      where: { id: companyId },
      select: COMPANY_SUBSCRIPTION_SELECT,
    }),
    getCompanyCapacity(prisma, companyId),
  ]);
  return { company, capacity };
}

// ─── Stats overview ───────────────────────────────────────────────────────────
exports.getStats = async (req, res) => {
  try {
    const [totalCompanies, activeCompanies, totalUsers] = await Promise.all([
      prisma.company.count(),
      prisma.company.count({ where: { isActive: true } }),
      prisma.user.count(),
    ]);
    res.json({
      success: true,
      data: {
        totalCompanies,
        activeCompanies,
        inactiveCompanies: totalCompanies - activeCompanies,
        totalUsers,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── List all companies ───────────────────────────────────────────────────────
exports.listCompanies = async (req, res) => {
  try {
    const companies = await prisma.company.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        ...COMPANY_SUBSCRIPTION_SELECT,
        _count: { select: { users: true } },
      },
    });
    res.json({ success: true, data: companies });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── Get single company with users ───────────────────────────────────────────
exports.getCompany = async (req, res) => {
  try {
    const company = await prisma.company.findUnique({
      where: { id: req.params.id },
      include: {
        users: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            role: true,
            isActive: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!company) {
      return res.status(404).json({ success: false, message: 'Company not found' });
    }
    const capacity = await getCompanyCapacity(prisma, company.id);
    res.json({
      success: true,
      data: {
        ...company,
        capacity,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── Toggle company active status ────────────────────────────────────────────
exports.updateCompanyStatus = async (req, res) => {
  try {
    const { isActive } = req.body;
    if (typeof isActive !== 'boolean') {
      return res.status(400).json({ success: false, message: 'isActive (boolean) is required' });
    }
    const company = await prisma.company.update({
      where: { id: req.params.id },
      data: { isActive },
      select: { id: true, name: true, isActive: true },
    });
    res.json({
      success: true,
      data: company,
      message: `Company "${company.name}" has been ${isActive ? 'activated' : 'deactivated'}`,
    });
  } catch (err) {
    if (err.code === 'P2025') {
      return res.status(404).json({ success: false, message: 'Company not found' });
    }
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── Manage company subscription (platform owner) ─────────────────────────────
exports.updateCompanySubscription = async (req, res) => {
  try {
    const companyId = req.params.id;
    const {
      subscriptionPlan,
      subscriptionStatus,
      productTier,
      licensedUsers,
      licensedBranches,
      billingCycle,
      trialDaysRemaining,
      extendMonths,
      extendYears,
    } = req.body;

    const existing = await prisma.company.findUnique({
      where: { id: companyId },
      select: { id: true, name: true },
    });
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Company not found' });
    }

    const plan = subscriptionPlan != null ? String(subscriptionPlan).trim() : null;
    const allowedPlans = ['trial', 'monthly', 'yearly', 'none'];
    if (plan && !allowedPlans.includes(plan)) {
      return res.status(400).json({
        success: false,
        message: 'subscriptionPlan must be trial, monthly, yearly, or none',
      });
    }

    const tier = productTier === 'pos' ? 'pos' : productTier === 'erp_pos' ? 'erp_pos' : null;
    const users = licensedUsers != null ? Math.max(1, parseInt(licensedUsers, 10) || 1) : null;
    const branches = licensedBranches != null ? Math.max(1, parseInt(licensedBranches, 10) || 1) : null;
    const cycle =
      billingCycle === 'yearly' ? 'yearly' : billingCycle === 'monthly' ? 'monthly' : null;

    const now = new Date();
    const patch = {};

    if (tier) patch.productTier = tier;
    if (users != null) patch.licensedUsers = users;
    if (branches != null) patch.licensedBranches = branches;
    if (subscriptionStatus != null) {
      patch.subscriptionStatus = String(subscriptionStatus).trim() || 'active';
    }

    if (plan === 'trial') {
      patch.subscriptionPlan = 'trial';
      patch.subscriptionStatus = patch.subscriptionStatus || 'active';
      patch.trialStartDate = now;
      if (trialDaysRemaining != null) {
        const days = Math.max(1, parseInt(trialDaysRemaining, 10) || TRIAL_DAYS);
        patch.trialEndDate = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
      } else {
        patch.trialEndDate = trialEndFromNow();
      }
      patch.subscriptionStartDate = null;
      patch.subscriptionEndDate = null;
      patch.billingCycle = null;
    } else if (plan === 'monthly' || plan === 'yearly') {
      patch.subscriptionPlan = plan;
      patch.subscriptionStatus = 'active';
      patch.billingCycle = cycle || plan;
      patch.subscriptionStartDate = now;
      patch.subscriptionEndDate = paidEndDate(plan, now);
      if (extendMonths) {
        const m = parseInt(extendMonths, 10) || 0;
        patch.subscriptionEndDate = new Date(patch.subscriptionEndDate);
        patch.subscriptionEndDate.setMonth(patch.subscriptionEndDate.getMonth() + m);
      }
      if (extendYears) {
        const y = parseInt(extendYears, 10) || 0;
        patch.subscriptionEndDate = new Date(patch.subscriptionEndDate);
        patch.subscriptionEndDate.setFullYear(patch.subscriptionEndDate.getFullYear() + y);
      }
      patch.trialStartDate = null;
      patch.trialEndDate = null;
    } else if (plan === 'none') {
      patch.subscriptionPlan = 'none';
      patch.subscriptionStatus = 'expired';
      patch.trialStartDate = null;
      patch.trialEndDate = null;
      patch.subscriptionStartDate = null;
      patch.subscriptionEndDate = null;
    } else if (plan) {
      patch.subscriptionPlan = plan;
    }

    if (Object.keys(patch).length === 0) {
      return res.status(400).json({ success: false, message: 'No subscription fields to update' });
    }

    await applyCompanySubscription(companyId, patch);

    const { company, capacity } = await companyWithCapacity(companyId);
    const quote =
      capacity.subscriptionPlan === 'monthly' || capacity.subscriptionPlan === 'yearly'
        ? calculatePrice(
            capacity.productTier,
            capacity.billingCycle,
            capacity.licensedUsers,
            capacity.licensedBranches
          )
        : null;

    res.json({
      success: true,
      message: `Subscription updated for "${existing.name}"`,
      data: {
        company,
        capacity,
        quote,
      },
    });
  } catch (err) {
    console.error('updateCompanySubscription error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};
