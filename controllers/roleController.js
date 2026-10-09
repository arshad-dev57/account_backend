/**
 * Roles & Permissions Controller
 * Complete CRUD for roles, permission matrix assignment, user overrides,
 * effective permission preview, and audit trail.
 */

const prisma = require('../prisma/client');
const { MODULE_DEFINITIONS, getFlatPermissionList } = require('../config/permissionCatalog');
const {
  getEffectivePermissions,
  invalidateUserPermissions,
  invalidateAllPermissions,
  recordSecurityAudit
} = require('../services/permissionService');

/**
 * Resolve + dedupe role permission rows so the same (roleId, permissionId)
 * is never inserted twice (avoids P2002 unique constraint errors).
 */
async function buildUniqueRolePermissionRows(roleId, permissions) {
  if (!Array.isArray(permissions) || permissions.length === 0) return [];

  const dbPerms = await prisma.permission.findMany({
    select: { id: true, name: true }
  });
  const permMapByName = new Map(dbPerms.map((p) => [p.name, p.id]));
  const validIds = new Set(dbPerms.map((p) => p.id));

  const byPermId = new Map(); // permissionId -> scope
  for (const item of permissions) {
    if (!item) continue;
    let permId = item.permissionId || null;
    if (permId && !validIds.has(permId)) {
      // Frontend may accidentally send the permission name in permissionId
      permId = permMapByName.get(String(permId)) || null;
    }
    if (!permId && item.name) {
      permId = permMapByName.get(String(item.name)) || null;
    }
    if (!permId) continue;
    // Last write wins for scope if duplicates appear in the payload
    byPermId.set(permId, item.scope || 'ALL');
  }

  return Array.from(byPermId.entries()).map(([permissionId, scope]) => ({
    roleId,
    permissionId,
    scope
  }));
}

async function replaceRolePermissions(roleId, permissions) {
  const rows = await buildUniqueRolePermissionRows(roleId, permissions);

  await prisma.$transaction(async (tx) => {
    await tx.rolePermission.deleteMany({ where: { roleId } });
    if (rows.length > 0) {
      await tx.rolePermission.createMany({
        data: rows,
        skipDuplicates: true
      });
    }
  });

  return rows.length;
}

// Get canonical permission catalog (for matrix display on frontend)
exports.getCatalog = async (req, res) => {
  try {
    const flatList = getFlatPermissionList();
    let dbPermissions = await prisma.permission.findMany();
    let dbMap = new Map(dbPermissions.map((p) => [p.name, p.id]));

    // Auto-sync any catalog permissions missing from DB (e.g. new module tiles)
    const missing = flatList.filter((p) => !dbMap.has(p.name));
    if (missing.length > 0) {
      await prisma.permission.createMany({
        data: missing.map((p) => ({
          name: p.name,
          module: p.module,
          resource: p.resource,
          action: p.action,
          description: p.description
        })),
        skipDuplicates: true
      });
      dbPermissions = await prisma.permission.findMany();
      dbMap = new Map(dbPermissions.map((p) => [p.name, p.id]));
      console.log(`✅ [getCatalog] Synced ${missing.length} new permissions into DB`);
    }

    // Enrich catalog with DB IDs
    const modulesWithDbIds = MODULE_DEFINITIONS.map((mod) => ({
      ...mod,
      resources: mod.resources.map((res) => ({
        ...res,
        permissions: res.actions.map((act) => {
          const permName = `${mod.key}.${res.key}.${act}`;
          return {
            id: dbMap.get(permName) || null,
            name: permName,
            action: act,
            description: `${act.toUpperCase()} permission for ${res.name}`,
            supportedScopes: res.scopes || ['ALL']
          };
        })
      }))
    }));

    return res.status(200).json({
      success: true,
      data: {
        modules: modulesWithDbIds,
        totalPermissions: flatList.length
      }
    });
  } catch (err) {
    console.error('❌ [getCatalog] Error:', err);
    return res.status(500).json({ success: false, message: 'Server error', error: err.message });
  }
};

// List all roles (system default roles + active company custom roles)
exports.getRoles = async (req, res) => {
  try {
    const companyId = req.user.companyId || req.authUserRow?.companyId;

    const roles = await prisma.role.findMany({
      where: {
        isActive: true,
        OR: [
          { companyId: null },
          ...(companyId ? [{ companyId }] : [])
        ]
      },
      include: {
        _count: {
          select: {
            users: true,
            permissions: true
          }
        }
      },
      orderBy: [{ isSystem: 'desc' }, { name: 'asc' }]
    });

    const formatted = roles.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description || '',
      isSystem: r.isSystem,
      companyId: r.companyId,
      scope: r.scope || 'ALL',
      isActive: r.isActive,
      usersCount: r._count.users,
      permissionsCount: r._count.permissions,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt
    }));

    return res.status(200).json({
      success: true,
      data: formatted
    });
  } catch (err) {
    console.error('❌ [getRoles] Error:', err);
    return res.status(500).json({ success: false, message: 'Server error', error: err.message });
  }
};

// Get single role with its complete permission list
exports.getRoleById = async (req, res) => {
  try {
    const { id } = req.params;
    const companyId = req.user.companyId || req.authUserRow?.companyId;

    const role = await prisma.role.findFirst({
      where: {
        id,
        OR: [
          { companyId: null },
          ...(companyId ? [{ companyId }] : [])
        ]
      },
      include: {
        permissions: {
          include: {
            permission: true
          }
        },
        _count: {
          select: { users: true }
        }
      }
    });

    if (!role) {
      return res.status(404).json({ success: false, message: 'Role not found' });
    }

    const permissions = role.permissions.map((rp) => ({
      permissionId: rp.permissionId,
      name: rp.permission.name,
      module: rp.permission.module,
      resource: rp.permission.resource,
      action: rp.permission.action,
      scope: rp.scope || 'ALL'
    }));

    return res.status(200).json({
      success: true,
      data: {
        id: role.id,
        name: role.name,
        description: role.description || '',
        isSystem: role.isSystem,
        companyId: role.companyId,
        scope: role.scope,
        isActive: role.isActive,
        usersCount: role._count.users,
        permissions,
        createdAt: role.createdAt,
        updatedAt: role.updatedAt
      }
    });
  } catch (err) {
    console.error('❌ [getRoleById] Error:', err);
    return res.status(500).json({ success: false, message: 'Server error', error: err.message });
  }
};

// Create custom role
exports.createRole = async (req, res) => {
  try {
    const companyId = req.user.companyId || req.authUserRow?.companyId;
    const { name, description, scope = 'ALL', permissions = [] } = req.body;

    if (!name || !String(name).trim()) {
      return res.status(400).json({ success: false, message: 'Role name is required' });
    }

    const trimmedName = String(name).trim();

    // Check duplicate name within company
    const existing = await prisma.role.findFirst({
      where: {
        companyId: companyId || null,
        name: { equals: trimmedName, mode: 'insensitive' }
      }
    });

    if (existing) {
      return res.status(400).json({
        success: false,
        message: `A role named "${trimmedName}" already exists for this company`
      });
    }

    // Create role
    const newRole = await prisma.role.create({
      data: {
        name: trimmedName,
        description: description ? String(description).trim() : null,
        companyId: companyId || null,
        isSystem: false,
        scope: scope || 'ALL',
        isActive: true
      }
    });

    // Assign permissions (deduped)
    let assignedCount = 0;
    if (Array.isArray(permissions) && permissions.length > 0) {
      assignedCount = await replaceRolePermissions(newRole.id, permissions);
    }

    invalidateAllPermissions();

    await recordSecurityAudit({
      companyId,
      userId: req.user.id,
      action: 'ROLE_CREATED',
      targetType: 'Role',
      targetId: newRole.id,
      details: { name: newRole.name, permissionsCount: assignedCount },
      ipAddress: req.ip
    });

    return res.status(201).json({
      success: true,
      message: 'Role created successfully',
      data: newRole
    });
  } catch (err) {
    console.error('❌ [createRole] Error:', err);
    return res.status(500).json({ success: false, message: 'Server error', error: err.message });
  }
};

// Update role
exports.updateRole = async (req, res) => {
  try {
    const { id } = req.params;
    const companyId = req.user.companyId || req.authUserRow?.companyId;
    const { name, description, scope, isActive, permissions } = req.body;

    const existingRole = await prisma.role.findFirst({
      where: {
        id,
        OR: [
          { companyId: null },
          ...(companyId ? [{ companyId }] : [])
        ]
      }
    });

    if (!existingRole) {
      return res.status(404).json({ success: false, message: 'Role not found' });
    }

    if (existingRole.isSystem && name && String(name).trim() !== existingRole.name) {
      return res.status(400).json({
        success: false,
        message: 'System role names cannot be renamed'
      });
    }

    const updateData = {};
    if (description !== undefined) updateData.description = String(description).trim();
    if (scope !== undefined) updateData.scope = scope;
    if (isActive !== undefined) updateData.isActive = Boolean(isActive);
    if (!existingRole.isSystem && name) {
      updateData.name = String(name).trim();
    }

    await prisma.role.update({
      where: { id },
      data: updateData
    });

    // Replace permissions if provided (deduped, transactional)
    let assignedCount;
    if (Array.isArray(permissions)) {
      assignedCount = await replaceRolePermissions(id, permissions);
    }

    invalidateAllPermissions();

    await recordSecurityAudit({
      companyId,
      userId: req.user.id,
      action: 'ROLE_UPDATED',
      targetType: 'Role',
      targetId: id,
      details: {
        roleName: existingRole.name,
        changes: updateData,
        ...(assignedCount !== undefined ? { permissionsCount: assignedCount } : {})
      },
      ipAddress: req.ip
    });

    return res.status(200).json({
      success: true,
      message: 'Role updated successfully'
    });
  } catch (err) {
    console.error('❌ [updateRole] Error:', err);
    return res.status(500).json({ success: false, message: 'Server error', error: err.message });
  }
};

// Duplicate role
exports.duplicateRole = async (req, res) => {
  try {
    const { id } = req.params;
    const companyId = req.user.companyId || req.authUserRow?.companyId;
    const { newName } = req.body;

    const sourceRole = await prisma.role.findFirst({
      where: {
        id,
        OR: [
          { companyId: null },
          ...(companyId ? [{ companyId }] : [])
        ]
      },
      include: {
        permissions: true
      }
    });

    if (!sourceRole) {
      return res.status(404).json({ success: false, message: 'Source role not found' });
    }

    const targetName = (newName && String(newName).trim()) || `Copy of ${sourceRole.name}`;

    const newRole = await prisma.role.create({
      data: {
        name: targetName,
        description: `Cloned from ${sourceRole.name}`,
        companyId: companyId || null,
        isSystem: false,
        scope: sourceRole.scope,
        isActive: true
      }
    });

    // Copy permissions (deduped)
    const copied = [];
    const seen = new Set();
    for (const rp of sourceRole.permissions) {
      if (!rp.permissionId || seen.has(rp.permissionId)) continue;
      seen.add(rp.permissionId);
      copied.push({
        roleId: newRole.id,
        permissionId: rp.permissionId,
        scope: rp.scope || 'ALL'
      });
    }
    if (copied.length > 0) {
      await prisma.rolePermission.createMany({
        data: copied,
        skipDuplicates: true
      });
    }

    invalidateAllPermissions();

    await recordSecurityAudit({
      companyId,
      userId: req.user.id,
      action: 'ROLE_DUPLICATED',
      targetType: 'Role',
      targetId: newRole.id,
      details: { originalRole: sourceRole.name, duplicatedRole: newRole.name },
      ipAddress: req.ip
    });

    return res.status(201).json({
      success: true,
      message: `Role duplicated successfully as "${newRole.name}"`,
      data: newRole
    });
  } catch (err) {
    console.error('❌ [duplicateRole] Error:', err);
    return res.status(500).json({ success: false, message: 'Server error', error: err.message });
  }
};

// Delete role (custom non-system roles with 0 users only)
exports.deleteRole = async (req, res) => {
  try {
    const { id } = req.params;
    const companyId = req.user.companyId || req.authUserRow?.companyId;

    const role = await prisma.role.findFirst({
      where: {
        id,
        companyId: companyId || null
      },
      include: {
        _count: {
          select: { users: true }
        }
      }
    });

    if (!role) {
      return res.status(404).json({
        success: false,
        message: 'Role not found or cannot be deleted (system default roles cannot be deleted)'
      });
    }

    if (role.isSystem) {
      return res.status(403).json({
        success: false,
        message: 'System default roles cannot be deleted'
      });
    }

    if (role._count.users > 0) {
      return res.status(400).json({
        success: false,
        message: `Cannot delete role "${role.name}" because it is currently assigned to ${role._count.users} user(s). Reassign them first.`
      });
    }

    await prisma.role.delete({
      where: { id }
    });

    invalidateAllPermissions();

    await recordSecurityAudit({
      companyId,
      userId: req.user.id,
      action: 'ROLE_DELETED',
      targetType: 'Role',
      targetId: id,
      details: { roleName: role.name },
      ipAddress: req.ip
    });

    return res.status(200).json({
      success: true,
      message: `Role "${role.name}" deleted successfully`
    });
  } catch (err) {
    console.error('❌ [deleteRole] Error:', err);
    return res.status(500).json({ success: false, message: 'Server error', error: err.message });
  }
};

// View Effective Permissions for a specific user (Permission Preview & Inspection)
exports.getUserEffectivePermissions = async (req, res) => {
  try {
    const { userId } = req.params;
    const companyId = req.user.companyId || req.authUserRow?.companyId;

    const targetUser = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        role: true,
        roleId: true,
        userRole: { select: { id: true, name: true } }
      }
    });

    if (!targetUser) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const effective = await getEffectivePermissions(userId, companyId);
    const overrides = await prisma.userPermissionOverride.findMany({
      where: { userId },
      include: { permission: true }
    });

    return res.status(200).json({
      success: true,
      data: {
        user: targetUser,
        effective,
        overrides: overrides.map((o) => ({
          id: o.id,
          permissionId: o.permissionId,
          permissionName: o.permission.name,
          effect: o.effect,
          scope: o.scope
        }))
      }
    });
  } catch (err) {
    console.error('❌ [getUserEffectivePermissions] Error:', err);
    return res.status(500).json({ success: false, message: 'Server error', error: err.message });
  }
};

// Set User Permission Direct Overrides (ALLOW / DENY / RESET)
exports.setUserPermissionOverride = async (req, res) => {
  try {
    const { userId } = req.params;
    const companyId = req.user.companyId || req.authUserRow?.companyId;
    const { permissionId, permissionName, effect, scope = 'ALL' } = req.body;

    // effect can be 'ALLOW', 'DENY', or 'RESET' (which removes the override)
    let permId = permissionId;
    if (!permId && permissionName) {
      const p = await prisma.permission.findUnique({ where: { name: permissionName } });
      if (p) permId = p.id;
    }

    if (!permId) {
      return res.status(400).json({ success: false, message: 'Valid permissionId or permissionName is required' });
    }

    const effectUpper = String(effect || '').toUpperCase().trim();

    if (effectUpper === 'RESET') {
      await prisma.userPermissionOverride.deleteMany({
        where: { userId, permissionId: permId }
      });
    } else if (effectUpper === 'ALLOW' || effectUpper === 'DENY') {
      await prisma.userPermissionOverride.upsert({
        where: {
          userId_permissionId: {
            userId,
            permissionId: permId
          }
        },
        create: {
          userId,
          companyId: companyId || null,
          permissionId: permId,
          effect: effectUpper,
          scope: scope || 'ALL'
        },
        update: {
          effect: effectUpper,
          scope: scope || 'ALL',
          companyId: companyId || null
        }
      });
    } else {
      return res.status(400).json({ success: false, message: 'Effect must be ALLOW, DENY, or RESET' });
    }

    invalidateUserPermissions(userId, companyId);

    await recordSecurityAudit({
      companyId,
      userId: req.user.id,
      action: 'PERMISSION_OVERRIDE_CHANGED',
      targetType: 'UserPermissionOverride',
      targetId: userId,
      details: { targetUserId: userId, permissionId: permId, effect: effectUpper, scope },
      ipAddress: req.ip
    });

    return res.status(200).json({
      success: true,
      message: `User override ${effectUpper === 'RESET' ? 'removed' : 'set to ' + effectUpper}`
    });
  } catch (err) {
    console.error('❌ [setUserPermissionOverride] Error:', err);
    return res.status(500).json({ success: false, message: 'Server error', error: err.message });
  }
};

// Security Audit Logs list
exports.getAuditLogs = async (req, res) => {
  try {
    const companyId = req.user.companyId || req.authUserRow?.companyId;
    const { page = 1, limit = 50 } = req.query;

    const skip = (Math.max(1, parseInt(page, 10)) - 1) * parseInt(limit, 10);
    const take = parseInt(limit, 10);

    const [logs, total] = await Promise.all([
      prisma.securityAuditLog.findMany({
        where: companyId ? { companyId } : {},
        include: {
          user: {
            select: { id: true, firstName: true, lastName: true, email: true }
          }
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take
      }),
      prisma.securityAuditLog.count({
        where: companyId ? { companyId } : {}
      })
    ]);

    return res.status(200).json({
      success: true,
      data: {
        logs,
        total,
        page: parseInt(page, 10),
        totalPages: Math.ceil(total / take)
      }
    });
  } catch (err) {
    console.error('❌ [getAuditLogs] Error:', err);
    return res.status(500).json({ success: false, message: 'Server error', error: err.message });
  }
};
