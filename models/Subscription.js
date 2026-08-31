// models/Subscription.js - Prisma Version (Fixed)
const prisma = require('../prisma/client');

// ─── Calculate end date based on plan ──────────────────────
function calculateEndDate(startDate, plan) {
  const endDate = new Date(startDate);

  if (plan === 'trial') {
    endDate.setDate(endDate.getDate() + 14);
  } else if (plan === 'monthly') {
    endDate.setMonth(endDate.getMonth() + 1);
  } else if (plan === 'yearly') {
    endDate.setFullYear(endDate.getFullYear() + 1);
  }

  return endDate;
}

class SubscriptionModel {
  // ============================================================
  // CREATE SUBSCRIPTION
  // ============================================================
  static async create(data) {
    const startDate = data.startDate || new Date();
    const endDate = data.endDate || calculateEndDate(startDate, data.plan);

    return await prisma.subscription.create({
      data: {
        userId: data.userId,
        plan: data.plan,
        status: data.status || 'active',
        startDate,
        endDate,
        amount: data.amount,
        currency: data.currency || 'SAR',
        paymentMethod: data.paymentMethod || 'free_trial',
        transactionId: data.transactionId || '',
        paymentDetails: data.paymentDetails || {}
      },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            subscriptionPlan: true,
            subscriptionStatus: true,
            subscriptionStartDate: true,
            subscriptionEndDate: true,
            trialStartDate: true,
            trialEndDate: true
          }
        }
      }
    });
  }

  // ============================================================
  // GET SUBSCRIPTION BY ID
  // ============================================================
  static async findById(id) {
    return await prisma.subscription.findUnique({
      where: { id },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true
          }
        }
      }
    });
  }

  // ============================================================
  // GET ACTIVE SUBSCRIPTION BY USER ID
  // Fixed: trial subscriptions have endDate set from trialEndDate,
  // so we query by status = 'active' only and rely on application-level
  // expiry checks to keep data consistent.
  // ============================================================
  static async findActiveByUserId(userId) {
    const now = new Date();
    return await prisma.subscription.findFirst({
      where: {
        userId,
        status: 'active',
        // ✅ Fixed: Include subscriptions where endDate hasn't passed yet
        // OR where endDate is null (shouldn't happen in practice but safe guard)
        OR: [
          { endDate: { gt: now } },
          { endDate: null },
        ]
      },
      orderBy: {
        createdAt: 'desc'
      }
    });
  }

  // ============================================================
  // GET ALL SUBSCRIPTIONS BY USER ID
  // ============================================================
  static async findByUserId(userId) {
    return await prisma.subscription.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' }
    });
  }

  static async findByCompanyId(companyId) {
    return await prisma.subscription.findMany({
      where: {
        user: { companyId },
      },
      orderBy: { createdAt: 'desc' },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
      },
    });
  }

  // ============================================================
  // UPDATE SUBSCRIPTION STATUS
  // ============================================================
  static async updateStatus(id, status) {
    return await prisma.subscription.update({
      where: { id },
      data: { status }
    });
  }

  // ============================================================
  // CANCEL SUBSCRIPTION
  // ============================================================
  static async cancel(id) {
    return await prisma.subscription.update({
      where: { id },
      data: { status: 'cancelled' }
    });
  }

  // ============================================================
  // GET SUBSCRIPTION STATS
  // ============================================================
  static async getStats() {
    const [total, active, expired, cancelled, byPlan] = await Promise.all([
      prisma.subscription.count(),
      prisma.subscription.count({ where: { status: 'active' } }),
      prisma.subscription.count({ where: { status: 'expired' } }),
      prisma.subscription.count({ where: { status: 'cancelled' } }),
      prisma.subscription.groupBy({
        by: ['plan'],
        _count: true
      })
    ]);

    const revenue = await prisma.subscription.aggregate({
      where: { status: 'active' },
      _sum: { amount: true }
    });

    return {
      total,
      active,
      expired,
      cancelled,
      byPlan: byPlan.map(item => ({ plan: item.plan, count: item._count })),
      totalRevenue: revenue._sum.amount || 0
    };
  }

  // ============================================================
  // GET EXPIRING SUBSCRIPTIONS (next 7 days)
  // ============================================================
  static async getExpiringSoon() {
    const now = new Date();
    const sevenDaysLater = new Date(now);
    sevenDaysLater.setDate(sevenDaysLater.getDate() + 7);

    return await prisma.subscription.findMany({
      where: {
        status: 'active',
        endDate: {
          gte: now,
          lte: sevenDaysLater
        }
      },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true
          }
        }
      },
      orderBy: { endDate: 'asc' }
    });
  }

  // ============================================================
  // SEARCH SUBSCRIPTIONS
  // ============================================================
  static async search(query, options = {}) {
    const { skip, take } = options;

    const filter = {
      OR: [
        { user: { firstName: { contains: query, mode: 'insensitive' } } },
        { user: { lastName: { contains: query, mode: 'insensitive' } } },
        { user: { email: { contains: query, mode: 'insensitive' } } },
        { plan: { contains: query, mode: 'insensitive' } },
        { status: { contains: query, mode: 'insensitive' } }
      ]
    };

    const subscriptions = await prisma.subscription.findMany({
      where: filter,
      skip,
      take,
      orderBy: { createdAt: 'desc' },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true
          }
        }
      }
    });

    const total = await prisma.subscription.count({ where: filter });

    return { subscriptions, total };
  }
}

module.exports = SubscriptionModel;