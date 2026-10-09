/**
 * Enterprise RBAC & Granular Permission Service
 * Resolves effective user permissions, handles ALLOW/DENY overrides,
 * caches session evaluation, enforces record scopes, and guarantees tenant isolation.
 */

const prisma = require('../prisma/client');
const { getFlatPermissionList, MODULE_DEFINITIONS } = require('../config/permissionCatalog');

const PERM_CACHE_TTL_MS = 15000; // 15 seconds
const effectiveCache = new Map();

function getCacheKey(userId, companyId) {
  return `${userId}:${companyId || 'none'}`;
}

function invalidateUserPermissions(userId, companyId) {
  if (!userId) return;
  if (companyId) {
    effectiveCache.delete(getCacheKey(userId, companyId));
  } else {
    for (const key of effectiveCache.keys()) {
      if (key.startsWith(`${userId}:`)) {
        effectiveCache.delete(key);
      }
    }
  }
}

function invalidateAllPermissions() {
  effectiveCache.clear();
}

function isPlatformAdmin(email) {
  const owners = (process.env.PLATFORM_OWNER_EMAILS || 'mfaisalakhan@gmail.com,kashif@gmail.com')
    .split(',')
    .map((e) => e.trim().toLowerCase());
  return owners.includes(String(email || '').toLowerCase().trim());
}

function isAdminRole(role) {
  const r = String(role || '').toLowerCase().trim();
  return (
    r === 'admin' ||
    r === 'owner' ||
    r === 'superadmin' ||
    r === 'company_admin' ||
    r === 'super admin' ||
    r === 'company admin'
  );
}

/**
 * Maps legacy page keys (e.g. 'accounting-journal-entries') to canonical permissions
 */
function mapLegacyPageToPermissions(page, canView, canCreate, canEdit, canDelete) {
  const perms = [];
  const p = String(page || '').toLowerCase().trim();

  // If page is format "module-resource" e.g. "sales-orders"
  const parts = p.split('-');
  const mod = parts[0];
  const res = parts.slice(1).join('_');

  if (canView) perms.push(`${mod}.${res}.view`);
  if (canCreate) perms.push(`${mod}.${res}.create`);
  if (canEdit) perms.push(`${mod}.${res}.edit`);
  if (canDelete) perms.push(`${mod}.${res}.delete`);

  return perms;
}

/**
 * Computes full effective permissions for a user within an active company.
 */
async function getEffectivePermissions(userId, companyId) {
  if (!userId) {
    return {
      isAdmin: false,
      permissions: [],
      permissionMap: {},
      scopes: {}
    };
  }

  const cacheKey = getCacheKey(userId, companyId);
  const now = Date.now();
  const cached = effectiveCache.get(cacheKey);
  if (cached && cached.exp > now) {
    return cached.data;
  }

  // 1. Fetch user data including role & company membership
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      role: true,
      roleId: true,
      companyId: true,
      isActive: true,
      userRole: {
        include: {
          permissions: {
            include: {
              permission: true
            }
          }
        }
      },
      memberships: {
        where: companyId ? { companyId, isActive: true } : { isActive: true },
        select: {
          companyId: true,
          role: true,
          isOwner: true
        }
      }
    }
  });

  if (!user || !user.isActive) {
    const emptyResult = {
      isAdmin: false,
      permissions: [],
      permissionMap: {},
      scopes: {}
    };
    effectiveCache.set(cacheKey, { data: emptyResult, exp: now + PERM_CACHE_TTL_MS });
    return emptyResult;
  }

  // 2. Determine admin status
  const membership = user.memberships && user.memberships[0];
  const isOwner = membership?.isOwner || false;
  const isMemberAdmin = isAdminRole(membership?.role);
  const isGlobalAdmin = isPlatformAdmin(user.email) || isAdminRole(user.role);
  const isAdmin = isOwner || isMemberAdmin || isGlobalAdmin;

  const allDefinitions = getFlatPermissionList();

  if (isAdmin) {
    // Admin has full unconstrained access with ALL scope
    const permissionMap = {};
    const scopes = {};
    for (const p of allDefinitions) {
      permissionMap[p.name] = {
        granted: true,
        scope: 'ALL',
        source: isOwner ? 'COMPANY_OWNER' : 'ADMIN_ROLE',
        module: p.module,
        resource: p.resource,
        action: p.action
      };
      scopes[p.name] = 'ALL';
    }

    const result = {
      isAdmin: true,
      permissions: Object.keys(permissionMap),
      permissionMap,
      scopes
    };

    effectiveCache.set(cacheKey, { data: result, exp: now + PERM_CACHE_TTL_MS });
    return result;
  }

  // 3. Resolve user's effective Role(s)
  let activeRole = user.userRole;
  if (!activeRole && user.role) {
    // Attempt fallback lookup by role name (e.g. system role "Salesperson")
    activeRole = await prisma.role.findFirst({
      where: {
        isActive: true,
        OR: [
          { companyId: companyId || null, name: { equals: user.role, mode: 'insensitive' } },
          { companyId: null, name: { equals: user.role, mode: 'insensitive' } }
        ]
      },
      include: {
        permissions: {
          include: { permission: true }
        }
      }
    });
  }

  const permissionMap = {};
  const scopes = {};

  // Seed default DENY for all known permissions
  for (const def of allDefinitions) {
    permissionMap[def.name] = {
      granted: false,
      scope: null,
      source: 'DEFAULT_DENY',
      module: def.module,
      resource: def.resource,
      action: def.action
    };
  }

  // 4. Apply Role Permissions
  if (activeRole && Array.isArray(activeRole.permissions)) {
    for (const rp of activeRole.permissions) {
      const p = rp.permission;
      if (!p) continue;
      permissionMap[p.name] = {
        granted: true,
        scope: rp.scope || 'ALL',
        source: `ROLE:${activeRole.name}`,
        module: p.module,
        resource: p.resource,
        action: p.action
      };
      scopes[p.name] = rp.scope || 'ALL';
    }
  }

  // 5. Apply User-Specific Direct Overrides (ALLOW / DENY)
  const overrides = await prisma.userPermissionOverride.findMany({
    where: {
      userId,
      OR: [
        { companyId: null },
        ...(companyId ? [{ companyId }] : [])
      ]
    },
    include: {
      permission: true
    }
  });

  for (const ov of overrides) {
    const p = ov.permission;
    if (!p) continue;
    const isAllow = String(ov.effect).toUpperCase() === 'ALLOW';
    permissionMap[p.name] = {
      granted: isAllow,
      scope: isAllow ? (ov.scope || 'ALL') : null,
      source: isAllow ? 'USER_OVERRIDE_ALLOW' : 'USER_OVERRIDE_DENY',
      module: p.module,
      resource: p.resource,
      action: p.action
    };
    if (isAllow) {
      scopes[p.name] = ov.scope || 'ALL';
    } else {
      delete scopes[p.name];
    }
  }

  // 6. Integrate legacy UserPermission table for backward compatibility
  const legacyUserPerms = await prisma.userPermission.findMany({
    where: { userId }
  });

  for (const lp of legacyUserPerms) {
    const mappedPerms = mapLegacyPageToPermissions(
      lp.page,
      lp.canView,
      lp.canCreate,
      lp.canEdit,
      lp.canDelete
    );

    for (const permKey of mappedPerms) {
      // Only grant if not explicitly DENIED by a modern user override
      if (
        permissionMap[permKey] &&
        permissionMap[permKey].source !== 'USER_OVERRIDE_DENY' &&
        !permissionMap[permKey].granted
      ) {
        permissionMap[permKey] = {
          granted: true,
          scope: 'ALL',
          source: 'LEGACY_USER_PERMISSION',
          module: permissionMap[permKey].module,
          resource: permissionMap[permKey].resource,
          action: permissionMap[permKey].action
        };
        scopes[permKey] = 'ALL';
      }
    }
  }

  const grantedPermissions = Object.keys(permissionMap).filter(
    (key) => permissionMap[key].granted
  );

  const finalResult = {
    isAdmin: false,
    roleName: activeRole?.name || user.role,
    roleId: activeRole?.id || null,
    permissions: grantedPermissions,
    permissionMap,
    scopes
  };

  effectiveCache.set(cacheKey, { data: finalResult, exp: now + PERM_CACHE_TTL_MS });
  return finalResult;
}

/**
 * Check if user has permission for a specific module/resource/action
 * e.g. hasPermission(user, 'sales.orders', 'create')
 */
async function hasPermission(userId, companyId, permissionKey) {
  const effective = await getEffectivePermissions(userId, companyId);
  if (effective.isAdmin) return true;
  return effective.permissionMap[permissionKey]?.granted === true;
}

/**
 * Verifies data scope on a record
 */
function verifyDataScope({ user, scope, record, recordType }) {
  if (!user || !record) return false;

  // Strict Company / Tenant Isolation: a record belonging to another company is NEVER accessible
  if (record.companyId && user.companyId && String(record.companyId) !== String(user.companyId)) {
    return false;
  }

  if (!scope || scope === 'ALL') return true;

  const currentUserId = String(user.id || user._id || '');

  if (scope === 'OWN') {
    // Record creator, assigned salesperson, user ID, or employee link
    const candidateIds = [
      record.userId,
      record.createdBy,
      record.salespersonId,
      record.salesperson?.userId,
      record.employeeId,
      record.managerId
    ].filter(Boolean).map(String);

    if (candidateIds.includes(currentUserId)) return true;
    return false;
  }

  if (scope === 'WAREHOUSE') {
    const assignedLocationIds = (user.locationIds || []).map(String);
    const assignedLocId = user.assignedTerminal?.locationId;
    if (assignedLocId) assignedLocationIds.push(String(assignedLocId));

    const recordLocationId = String(record.warehouseId || record.locationId || record.fromWarehouseId || '');
    if (!recordLocationId) return true; // not warehouse-restricted record

    return assignedLocationIds.includes(recordLocationId);
  }

  return true;
}

/**
 * Security Audit Log writer
 */
async function recordSecurityAudit({ companyId, userId, action, targetType, targetId, details, ipAddress }) {
  try {
    return await prisma.securityAuditLog.create({
      data: {
        companyId: companyId || null,
        userId: userId || null,
        action,
        targetType,
        targetId: targetId ? String(targetId) : null,
        details: details || {},
        ipAddress: ipAddress || null
      }
    });
  } catch (err) {
    console.error('⚠️ [recordSecurityAudit] Failed to record audit log:', err.message);
  }
}

module.exports = {
  getEffectivePermissions,
  hasPermission,
  verifyDataScope,
  invalidateUserPermissions,
  invalidateAllPermissions,
  recordSecurityAudit,
  isAdminRole,
  isPlatformAdmin
};
