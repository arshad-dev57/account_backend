const prisma = require('../prisma/client');
const { sendToUsers } = require('../services/notificationService');
const emailSenderService = require('../services/emailSenderService');
const emailTemplateService = require('../services/emailTemplateService');
const { isEmailConfigured } = require('../utils/mailTransport');
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

// ─── List platform users (for admin notifications) ────────────────────────────
exports.listUsers = async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    const take = Math.min(500, Math.max(1, parseInt(req.query.limit, 10) || 200));
    const where = {};
    if (q) {
      where.OR = [
        { email: { contains: q, mode: 'insensitive' } },
        { firstName: { contains: q, mode: 'insensitive' } },
        { lastName: { contains: q, mode: 'insensitive' } },
        { company: { name: { contains: q, mode: 'insensitive' } } },
      ];
    }

    const [users, total, activeTotal] = await Promise.all([
      prisma.user.findMany({
        where,
        take,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          role: true,
          isActive: true,
          company: { select: { id: true, name: true } },
        },
      }),
      prisma.user.count({ where }),
      prisma.user.count({ where: { isActive: true } }),
    ]);

    res.json({
      success: true,
      data: users.map((u) => ({
        id: u.id,
        firstName: u.firstName,
        lastName: u.lastName,
        email: u.email,
        role: u.role,
        isActive: u.isActive,
        companyId: u.company?.id || null,
        companyName: u.company?.name || '—',
      })),
      meta: { total, activeTotal, returned: users.length },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── Broadcast notification to selected or all users ──────────────────────────
exports.sendNotification = async (req, res) => {
  try {
    const { title, message, audience, userIds, type } = req.body || {};
    const heading = String(title || '').trim();
    const body = String(message || '').trim();
    if (!heading || !body) {
      return res.status(400).json({ success: false, message: 'Title and message are required' });
    }

    const mode = String(audience || 'selected').toLowerCase();
    let ids = [];
    if (mode === 'all') {
      const users = await prisma.user.findMany({
        where: { isActive: true },
        select: { id: true },
      });
      ids = users.map((u) => u.id);
    } else {
      ids = [...new Set((Array.isArray(userIds) ? userIds : []).map((id) => String(id || '').trim()).filter(Boolean))];
      if (!ids.length) {
        return res.status(400).json({ success: false, message: 'Select at least one user' });
      }
    }

    if (!ids.length) {
      return res.status(400).json({ success: false, message: 'No users to notify' });
    }

    const results = await sendToUsers(ids, {
      title: heading,
      message: body,
      type: ['info', 'success', 'warning', 'error'].includes(String(type)) ? type : 'info',
      category: 'Announcement',
      data: { source: 'platform_admin' },
    });

    const failed = results.filter((r) => r && r.error).length;
    const sent = results.length - failed;
    const liveDelivered = results.reduce(
      (sum, r) => sum + (Number(r?.liveClients) || 0),
      0
    );

    res.json({
      success: true,
      data: {
        sent,
        failed,
        total: results.length,
        audience: mode,
        liveDelivered,
      },
      message:
        liveDelivered > 0
          ? `Saved for ${sent} user${sent === 1 ? '' : 's'} · ${liveDelivered} live device${liveDelivered === 1 ? '' : 's'} notified`
          : `Saved for ${sent} user${sent === 1 ? '' : 's'} · no app online for live alert (they will see it in Notifications inbox)`,
    });
  } catch (err) {
    console.error('sendPlatformNotification error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
}

async function resolveAudienceUsers(audience, userIds) {
  const mode = String(audience || 'selected').toLowerCase();
  if (mode === 'all') {
    return prisma.user.findMany({
      where: { isActive: true },
      select: { id: true, firstName: true, lastName: true, email: true },
    });
  }
  const ids = [...new Set((Array.isArray(userIds) ? userIds : []).map((id) => String(id || '').trim()).filter(Boolean))];
  if (!ids.length) return [];
  return prisma.user.findMany({
    where: { id: { in: ids } },
    select: { id: true, firstName: true, lastName: true, email: true },
  });
}

// ─── Broadcast email to selected or all users ─────────────────────────────────
exports.sendEmail = async (req, res) => {
  try {
    if (!isEmailConfigured()) {
      return res.status(503).json({
        success: false,
        message: 'Email service is not configured on the server',
      });
    }

    const { subject, title, message, audience, userIds, actionUrl, actionText } = req.body || {};
    const heading = String(subject || title || '').trim();
    const body = String(message || '').trim();
    if (!heading || !body) {
      return res.status(400).json({ success: false, message: 'Subject and message are required' });
    }

    const users = await resolveAudienceUsers(audience, userIds);
    const recipients = users.filter((u) => isValidEmail(u.email));
    if (!recipients.length) {
      return res.status(400).json({
        success: false,
        message: String(audience).toLowerCase() === 'all'
          ? 'No active users with a valid email address'
          : 'Select at least one user with a valid email',
      });
    }

    const safeTitle = escapeHtml(heading);
    const safeBody = escapeHtml(body).replace(/\n/g, '<br/>');
    const rawLink = String(actionUrl || '').trim();
    const link = /^https?:\/\//i.test(rawLink) ? rawLink : '';
    const button = escapeHtml(String(actionText || 'Open Bisonstechs').trim());
    const BATCH = 8;
    let sent = 0;
    let failed = 0;

    for (let i = 0; i < recipients.length; i += BATCH) {
      const chunk = recipients.slice(i, i + BATCH);
      const chunkResults = await Promise.all(
        chunk.map(async (u) => {
          const name = [u.firstName, u.lastName].filter(Boolean).join(' ').trim() || 'there';
          try {
            const html = emailTemplateService.getNotificationEmailTemplate({
              title: safeTitle,
              message: safeBody,
              recipientName: escapeHtml(name),
              actionUrl: link || null,
              actionText: button,
            });
            await emailSenderService.sendRawEmail(u.email, heading, html);
            return { ok: true };
          } catch (err) {
            console.error('Platform email failed:', u.email, err.message);
            return { ok: false };
          }
        })
      );
      sent += chunkResults.filter((r) => r.ok).length;
      failed += chunkResults.filter((r) => !r.ok).length;
    }

    res.json({
      success: true,
      data: {
        sent,
        failed,
        skipped: users.length - recipients.length,
        total: recipients.length,
        audience: String(audience || 'selected').toLowerCase(),
      },
      message: `Email sent to ${sent} user${sent === 1 ? '' : 's'}`,
    });
  } catch (err) {
    console.error('sendPlatformEmail error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};
