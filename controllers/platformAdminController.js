const prisma = require('../prisma/client');

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
        id: true,
        name: true,
        email: true,
        phone: true,
        businessType: true,
        isActive: true,
        subscriptionPlan: true,
        subscriptionStatus: true,
        trialEndDate: true,
        subscriptionEndDate: true,
        createdAt: true,
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
    res.json({ success: true, data: company });
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
