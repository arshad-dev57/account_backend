const prisma = require('../prisma/client');

const ACTIVE_THROTTLE_MS = 15 * 60 * 1000; // 1 active event per user / 15 min
const PAGE_VIEW_THROTTLE_MS = 5 * 60 * 1000;

function normalizeAction(action) {
  const a = String(action || '').toLowerCase().trim();
  if (a === 'login' || a === 'active' || a === 'page_view') return a;
  return 'active';
}

function normalizeSource(source) {
  const s = String(source || '').toLowerCase().trim();
  if (s === 'web' || s === 'desktop' || s === 'mobile') return s;
  return 'web';
}

function getRequestMeta(req = {}) {
  const forwarded = req.headers?.['x-forwarded-for'];
  const ipFromForwarded = typeof forwarded === 'string' ? forwarded.split(',')[0].trim() : null;
  return {
    ipAddress: ipFromForwarded || req.ip || req.connection?.remoteAddress || null,
    userAgent: req.headers?.['user-agent'] || null,
  };
}

/**
 * Record app usage. Always bumps lastActiveAt.
 * login → always insert event
 * active / page_view → throttled inserts to avoid noise
 */
async function recordAppUsage({
  userId,
  companyId = null,
  action = 'active',
  source = 'web',
  path = null,
  ipAddress = null,
  userAgent = null,
}) {
  if (!userId) return { recorded: false, reason: 'missing_user' };

  const normalizedAction = normalizeAction(action);
  const normalizedSource = normalizeSource(source);
  const now = new Date();
  const uid = String(userId);
  let cid = companyId ? String(companyId) : null;

  if (!cid) {
    try {
      const user = await prisma.user.findUnique({
        where: { id: uid },
        select: { companyId: true },
      });
      cid = user?.companyId || null;
    } catch {
      cid = null;
    }
  }

  // Always refresh last-active marker (cheap, useful for "using app or not")
  try {
    await prisma.user.update({
      where: { id: uid },
      data: { lastActiveAt: now },
    });
  } catch (err) {
    console.error('[appUsage] lastActiveAt update failed:', err.message);
  }

  let shouldInsert = normalizedAction === 'login';
  if (!shouldInsert) {
    const throttleMs =
      normalizedAction === 'page_view' ? PAGE_VIEW_THROTTLE_MS : ACTIVE_THROTTLE_MS;
    const since = new Date(now.getTime() - throttleMs);
    const recent = await prisma.appUsageEvent.findFirst({
      where: {
        userId: uid,
        action: normalizedAction,
        createdAt: { gte: since },
      },
      select: { id: true },
      orderBy: { createdAt: 'desc' },
    });
    shouldInsert = !recent;
  }

  if (!shouldInsert) {
    return { recorded: false, reason: 'throttled', lastActiveAt: now };
  }

  const event = await prisma.appUsageEvent.create({
    data: {
      userId: uid,
      companyId: cid,
      action: normalizedAction,
      source: normalizedSource,
      path: path ? String(path).slice(0, 500) : null,
      ipAddress: ipAddress ? String(ipAddress).slice(0, 120) : null,
      userAgent: userAgent ? String(userAgent).slice(0, 500) : null,
      createdAt: now,
    },
  });

  return { recorded: true, event, lastActiveAt: now };
}

async function getCompanyUsageActivity(companyId, { limit = 80 } = {}) {
  const cid = String(companyId);
  const take = Math.min(Math.max(Number(limit) || 80, 1), 200);
  const now = new Date();
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const [events, users, eventsToday, eventsWeek, activeUsersToday, activeUsersWeek] =
    await Promise.all([
      prisma.appUsageEvent.findMany({
        where: { companyId: cid },
        orderBy: { createdAt: 'desc' },
        take,
        include: {
          user: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
              role: true,
            },
          },
        },
      }),
      prisma.user.findMany({
        where: { companyId: cid },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          role: true,
          isActive: true,
          lastActiveAt: true,
          createdAt: true,
        },
        orderBy: [{ lastActiveAt: 'desc' }, { createdAt: 'asc' }],
      }),
      prisma.appUsageEvent.count({
        where: { companyId: cid, createdAt: { gte: dayAgo } },
      }),
      prisma.appUsageEvent.count({
        where: { companyId: cid, createdAt: { gte: weekAgo } },
      }),
      prisma.user.count({
        where: { companyId: cid, lastActiveAt: { gte: dayAgo } },
      }),
      prisma.user.count({
        where: { companyId: cid, lastActiveAt: { gte: weekAgo } },
      }),
    ]);

  const lastActiveAt = users.reduce((max, u) => {
    if (!u.lastActiveAt) return max;
    const t = new Date(u.lastActiveAt).getTime();
    return max == null || t > max ? t : max;
  }, null);

  return {
    summary: {
      lastActiveAt: lastActiveAt != null ? new Date(lastActiveAt).toISOString() : null,
      eventsToday,
      eventsWeek,
      activeUsersToday,
      activeUsersWeek,
      totalUsers: users.length,
    },
    users,
    events: events.map((e) => ({
      id: e.id,
      action: e.action,
      source: e.source,
      path: e.path,
      ipAddress: e.ipAddress,
      createdAt: e.createdAt,
      user: e.user
        ? {
            id: e.user.id,
            name: `${e.user.firstName || ''} ${e.user.lastName || ''}`.trim(),
            email: e.user.email,
            role: e.user.role,
          }
        : null,
    })),
  };
}

module.exports = {
  recordAppUsage,
  getCompanyUsageActivity,
  getRequestMeta,
  ACTIVE_THROTTLE_MS,
};
