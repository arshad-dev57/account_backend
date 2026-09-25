'use strict';

const prisma = require('../prisma/client');

const ALL_COMPANIES_VALUE = '__all__';

function isMissingMembershipTable(err) {
  const msg = String(err?.message || err || '');
  return (
    msg.includes('company_memberships') &&
    (msg.includes('does not exist') || msg.includes('P2021') || err?.code === 'P2021')
  );
}

function normalizeCompanyHeader(raw) {
  if (raw == null) return null;
  const v = String(raw).trim();
  if (!v) return null;
  if (v.toLowerCase() === 'all' || v === ALL_COMPANIES_VALUE) return ALL_COMPANIES_VALUE;
  return v;
}

async function primaryCompanyFallback(userId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { companyId: true },
  });
  return user?.companyId ? [user.companyId] : [];
}

async function listMembershipsForUser(userId) {
  try {
    return await prisma.companyMembership.findMany({
      where: { userId, isActive: true },
      include: {
        company: {
          select: {
            id: true,
            name: true,
            email: true,
            logo: true,
            isActive: true,
            businessType: true,
            subscriptionPlan: true,
            subscriptionStatus: true,
            productTier: true,
            trialEndDate: true,
            subscriptionEndDate: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
  } catch (err) {
    if (!isMissingMembershipTable(err)) throw err;
    // Migration not applied yet — synthesize from users.company_id
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        companyId: true,
        role: true,
        company: {
          select: {
            id: true,
            name: true,
            email: true,
            logo: true,
            isActive: true,
            businessType: true,
            subscriptionPlan: true,
            subscriptionStatus: true,
            productTier: true,
            trialEndDate: true,
            subscriptionEndDate: true,
          },
        },
      },
    });
    if (!user?.companyId || !user.company) return [];
    return [
      {
        id: `legacy-${user.companyId}`,
        userId,
        companyId: user.companyId,
        role: user.role || 'admin',
        isOwner: String(user.role || '').toLowerCase() === 'admin',
        isActive: true,
        company: user.company,
      },
    ];
  }
}

async function ensureMembershipForUserCompany(userId, companyId, opts = {}) {
  if (!userId || !companyId) return null;
  const role = opts.role || 'admin';
  const isOwner = opts.isOwner !== false;
  try {
    return await prisma.companyMembership.upsert({
      where: {
        userId_companyId: { userId, companyId },
      },
      create: {
        userId,
        companyId,
        role,
        isOwner,
        isActive: true,
      },
      update: {
        isActive: true,
        ...(opts.forceRole ? { role, isOwner } : {}),
      },
    });
  } catch (err) {
    if (isMissingMembershipTable(err)) {
      console.warn(
        '[companyAccess] company_memberships table missing — run: npx prisma migrate deploy'
      );
      return null;
    }
    throw err;
  }
}

async function userHasCompanyAccess(userId, companyId) {
  if (!userId || !companyId) return false;
  try {
    const membership = await prisma.companyMembership.findFirst({
      where: { userId, companyId, isActive: true },
      select: { id: true },
    });
    if (membership) return true;
  } catch (err) {
    if (!isMissingMembershipTable(err)) throw err;
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { companyId: true },
  });
  return user?.companyId === companyId;
}

async function getAccessibleCompanyIds(userId) {
  try {
    const memberships = await prisma.companyMembership.findMany({
      where: { userId, isActive: true },
      select: { companyId: true },
    });
    const ids = memberships.map((m) => m.companyId);
    if (ids.length) return ids;
  } catch (err) {
    if (!isMissingMembershipTable(err)) throw err;
  }
  return primaryCompanyFallback(userId);
}

/**
 * Resolve active company for a request.
 * Header: X-Company-Id = uuid | __all__
 * Falls back to user.companyId (primary).
 */
async function resolveActiveCompanyContext(userId, primaryCompanyId, headerRaw) {
  const requested = normalizeCompanyHeader(headerRaw);
  const accessibleIds = await getAccessibleCompanyIds(userId);

  if (requested === ALL_COMPANIES_VALUE) {
    return {
      mode: 'all',
      companyId: null,
      company: null,
      accessibleCompanyIds: accessibleIds,
      membershipRole: null,
      isOwner: false,
    };
  }

  let companyId = requested || primaryCompanyId || accessibleIds[0] || null;

  if (companyId && !accessibleIds.includes(companyId)) {
    if (companyId === primaryCompanyId) {
      await ensureMembershipForUserCompany(userId, companyId, {
        role: 'admin',
        isOwner: true,
      });
    } else {
      const err = new Error('You do not have access to this company');
      err.status = 403;
      err.code = 'COMPANY_ACCESS_DENIED';
      throw err;
    }
  }

  if (!companyId) {
    return {
      mode: 'none',
      companyId: null,
      company: null,
      accessibleCompanyIds: accessibleIds,
      membershipRole: null,
      isOwner: false,
    };
  }

  let membership = null;
  try {
    membership = await prisma.companyMembership.findFirst({
      where: { userId, companyId, isActive: true },
    });
  } catch (err) {
    if (!isMissingMembershipTable(err)) throw err;
  }

  const company = await prisma.company.findUnique({ where: { id: companyId } });

  return {
    mode: 'single',
    companyId,
    company,
    accessibleCompanyIds: accessibleIds.includes(companyId)
      ? accessibleIds
      : [...accessibleIds, companyId],
    membershipRole: membership?.role || 'admin',
    isOwner: membership?.isOwner === true || companyId === primaryCompanyId,
  };
}

function requireSingleCompany(req) {
  if (req.companyMode === 'all' || !req.user?.companyId) {
    const err = new Error('Select a specific company to perform this action');
    err.status = 400;
    err.code = 'COMPANY_REQUIRED';
    throw err;
  }
  return req.user.companyId;
}

async function assertRecordCompanyAccess(req, recordCompanyId) {
  if (!recordCompanyId) return;
  const accessible = req.accessibleCompanyIds || [];
  if (req.companyMode === 'all') {
    if (!accessible.includes(recordCompanyId)) {
      const err = new Error('Cross-company access denied');
      err.status = 403;
      err.code = 'CROSS_COMPANY_DENIED';
      throw err;
    }
    return;
  }
  if (req.user?.companyId !== recordCompanyId) {
    const err = new Error('Cross-company access denied');
    err.status = 403;
    err.code = 'CROSS_COMPANY_DENIED';
    throw err;
  }
}

async function assertLocationBelongsToActiveCompany(locationId, companyId) {
  if (!locationId || !companyId) return null;
  const loc = await prisma.location.findFirst({
    where: { id: locationId, companyId, isDeleted: false },
    select: { id: true, companyId: true },
  });
  if (!loc) {
    const err = new Error('Warehouse/location does not belong to the active company');
    err.status = 400;
    err.code = 'LOCATION_COMPANY_MISMATCH';
    throw err;
  }
  return loc;
}

module.exports = {
  ALL_COMPANIES_VALUE,
  normalizeCompanyHeader,
  listMembershipsForUser,
  ensureMembershipForUserCompany,
  userHasCompanyAccess,
  getAccessibleCompanyIds,
  resolveActiveCompanyContext,
  requireSingleCompany,
  assertRecordCompanyAccess,
  assertLocationBelongsToActiveCompany,
};
