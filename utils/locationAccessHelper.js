const { AsyncLocalStorage } = require('async_hooks');
const prisma = require('../prisma/client');

const locationAls = new AsyncLocalStorage();

const LOCATION_ADMIN_ROLES = new Set(['admin', 'owner', 'superadmin']);

const LOCATION_INCLUDE = {
  userLocations: {
    include: {
      location: {
        select: {
          id: true,
          name: true,
          code: true,
          type: true,
          isDefault: true,
          isActive: true,
          isDeleted: true,
        },
      },
    },
  },
};

function isLocationAdminRole(role) {
  return LOCATION_ADMIN_ROLES.has(String(role || '').toLowerCase().trim());
}

function userIdOf(user) {
  return user?.id || user?._id || null;
}

function normalizeLocationId(locationId) {
  if (locationId == null) return null;
  const s = String(locationId).trim();
  if (!s || s === 'all' || s === '__all__') return null;
  return s;
}

function pickRequestedLocationId(req) {
  if (!req) return null;
  return (
    normalizeLocationId(req.query?.locationId) ||
    normalizeLocationId(req.body?.locationId) ||
    normalizeLocationId(req.params?.locationId) ||
    normalizeLocationId(req.params?.id && req.baseUrl?.includes('locations') ? req.params.id : null)
  );
}

function getLocationScope() {
  return locationAls.getStore() || null;
}

function getLocationConstraint(locationId) {
  const requested = normalizeLocationId(locationId);
  const scope = getLocationScope();
  if (!scope || scope.isAdmin) {
    if (requested) return { kind: 'eq', id: requested };
    return { kind: 'all' };
  }
  const ids = Array.isArray(scope.ids) ? scope.ids : [];
  if (!ids.length) return { kind: 'none' };
  if (requested) {
    if (!ids.includes(requested)) return { kind: 'none' };
    return { kind: 'eq', id: requested };
  }
  if (ids.length === 1) return { kind: 'eq', id: ids[0] };
  return { kind: 'in', ids };
}

function withLocation(locationId) {
  const c = getLocationConstraint(locationId);
  if (c.kind === 'all') return {};
  if (c.kind === 'none') return { locationId: { in: [] } };
  if (c.kind === 'eq') return { locationId: c.id };
  return { locationId: { in: c.ids } };
}

function constraintIds(locationId) {
  const c = getLocationConstraint(locationId);
  if (c.kind === 'all') return null;
  if (c.kind === 'none') return [];
  if (c.kind === 'eq') return [c.id];
  return c.ids;
}

function assertCanUseLocationId(locationId) {
  const id = normalizeLocationId(locationId);
  if (!id) return;
  const scope = getLocationScope();
  if (!scope || scope.isAdmin) return;
  if (!Array.isArray(scope.ids) || !scope.ids.includes(id)) {
    const err = new Error('You do not have access to this location');
    err.statusCode = 403;
    throw err;
  }
}

function filterLocationsForUser(user, locations) {
  const list = Array.isArray(locations) ? locations : [];
  if (!user || isLocationAdminRole(user.role)) return list;
  const scope = getLocationScope();
  const ids = new Set(scope?.ids || []);
  return list.filter((l) => ids.has(l.id));
}

async function buildLocationScope(user) {
  if (!user) return { isAdmin: false, ids: [], userId: null, companyId: null };
  const userId = userIdOf(user);
  const companyId = user.companyId || null;
  if (isLocationAdminRole(user.role)) {
    return { isAdmin: true, ids: null, userId, companyId };
  }
  if (!userId) return { isAdmin: false, ids: [], userId, companyId };
  const rows = await prisma.userLocation.findMany({
    where: {
      userId,
      location: {
        isDeleted: false,
        ...(companyId ? { companyId } : {}),
      },
    },
    select: { locationId: true },
  });
  return {
    isAdmin: false,
    ids: rows.map((r) => r.locationId),
    userId,
    companyId,
  };
}

async function attachLocationScope(req, res, next) {
  try {
    const scope = await buildLocationScope(req.user);
    req.locationScope = scope;

    const requested =
      normalizeLocationId(req.query?.locationId) ||
      normalizeLocationId(req.body?.locationId);
    if (requested && !scope.isAdmin && !(scope.ids || []).includes(requested)) {
      return res.status(403).json({
        success: false,
        message: 'You do not have access to this location',
      });
    }

    locationAls.run(scope, () => next());
  } catch (error) {
    console.error('attachLocationScope error:', error);
    next();
  }
}

function requireLocationAdmin(req, res, next) {
  if (isLocationAdminRole(req.user?.role)) return next();
  return res.status(403).json({
    success: false,
    message: 'Only admin can manage locations',
  });
}

function formatUserLocations(user) {
  const rows = user?.userLocations || [];
  const locations = rows
    .map((row) => row.location)
    .filter((loc) => loc && loc.isDeleted !== true)
    .map((loc) => ({
      id: loc.id,
      name: loc.name,
      code: loc.code,
      type: loc.type,
      isDefault: loc.isDefault,
      isActive: loc.isActive,
    }));
  return {
    locations,
    locationIds: locations.map((l) => l.id),
  };
}

async function validateCompanyLocationIds(companyId, locationIds) {
  const ids = [...new Set((locationIds || []).map((id) => String(id || '').trim()).filter(Boolean))];
  if (!ids.length) return [];
  const found = await prisma.location.findMany({
    where: { id: { in: ids }, companyId, isDeleted: false },
    select: { id: true },
  });
  if (found.length !== ids.length) {
    const err = new Error('One or more locations are invalid for this company');
    err.statusCode = 400;
    throw err;
  }
  return ids;
}

async function replaceUserLocations(userId, companyId, locationIds) {
  const ids = await validateCompanyLocationIds(companyId, locationIds);
  await prisma.$transaction([
    prisma.userLocation.deleteMany({ where: { userId } }),
    ...(ids.length
      ? [
          prisma.userLocation.createMany({
            data: ids.map((locationId) => ({ userId, locationId })),
            skipDuplicates: true,
          }),
        ]
      : []),
  ]);
  return ids;
}

module.exports = {
  LOCATION_INCLUDE,
  isLocationAdminRole,
  normalizeLocationId,
  pickRequestedLocationId,
  getLocationScope,
  getLocationConstraint,
  withLocation,
  constraintIds,
  assertCanUseLocationId,
  filterLocationsForUser,
  buildLocationScope,
  attachLocationScope,
  requireLocationAdmin,
  formatUserLocations,
  validateCompanyLocationIds,
  replaceUserLocations,
};
