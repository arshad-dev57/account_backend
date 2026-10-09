/**
 * Seeder script for Bisonstechs ERP Enterprise RBAC
 * Seeds all canonical permissions and default system roles into the database.
 */

require('dotenv').config({ path: '/Users/glplanet/Documents/account_backend/.env' });
const prisma = require('../prisma/client');
const { getFlatPermissionList, DEFAULT_SYSTEM_ROLES } = require('../config/permissionCatalog');

function patternToRegex(pattern) {
  // Convert wildcard pattern e.g. "sales.*" or "sales.*.view" into RegExp
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`);
}

async function seedPermissions() {
  const permissions = getFlatPermissionList();
  console.log(`🌱 Seeding ${permissions.length} canonical permissions...`);

  let created = 0;
  let updated = 0;

  for (const perm of permissions) {
    const existing = await prisma.permission.findUnique({
      where: { name: perm.name }
    });

    if (existing) {
      await prisma.permission.update({
        where: { id: existing.id },
        data: {
          module: perm.module,
          resource: perm.resource,
          action: perm.action,
          description: perm.description
        }
      });
      updated++;
    } else {
      await prisma.permission.create({
        data: {
          name: perm.name,
          module: perm.module,
          resource: perm.resource,
          action: perm.action,
          description: perm.description
        }
      });
      created++;
    }
  }

  console.log(`✅ Permissions seeded: ${created} created, ${updated} updated.`);
}

async function seedRoles() {
  console.log(`🌱 Seeding ${DEFAULT_SYSTEM_ROLES.length} default system roles...`);

  // Fetch all permissions from DB
  const allDbPerms = await prisma.permission.findMany();
  const permMapByName = new Map(allDbPerms.map((p) => [p.name, p]));

  for (const roleDef of DEFAULT_SYSTEM_ROLES) {
    let role = await prisma.role.findFirst({
      where: {
        name: roleDef.name,
        companyId: null
      }
    });

    if (!role) {
      role = await prisma.role.create({
        data: {
          name: roleDef.name,
          description: roleDef.description,
          isSystem: true,
          isActive: true,
          companyId: null,
          scope: 'ALL'
        }
      });
      console.log(`  ➕ Created role: "${role.name}"`);
    } else {
      await prisma.role.update({
        where: { id: role.id },
        data: {
          description: roleDef.description,
          isSystem: true,
          isActive: true
        }
      });
      console.log(`  🔄 Updated role: "${role.name}"`);
    }

    // Determine target permissions
    const targetPerms = []; // Array of { permId, scope }

    if (roleDef.allPermissions) {
      for (const p of allDbPerms) {
        targetPerms.push({ permId: p.id, scope: 'ALL' });
      }
    } else if (roleDef.scopedPermissions) {
      for (const sp of roleDef.scopedPermissions) {
        const p = permMapByName.get(sp.name);
        if (p) {
          targetPerms.push({ permId: p.id, scope: sp.scope || 'ALL' });
        }
      }
    } else if (roleDef.patterns) {
      const regexes = roleDef.patterns.map(patternToRegex);
      for (const p of allDbPerms) {
        const matches = regexes.some((re) => re.test(p.name));
        if (matches) {
          targetPerms.push({ permId: p.id, scope: 'ALL' });
        }
      }
    }

    // Upsert role_permissions
    for (const item of targetPerms) {
      await prisma.rolePermission.upsert({
        where: {
          roleId_permissionId: {
            roleId: role.id,
            permissionId: item.permId
          }
        },
        create: {
          roleId: role.id,
          permissionId: item.permId,
          scope: item.scope
        },
        update: {
          scope: item.scope
        }
      });
    }

    console.log(`    ↳ Assigned ${targetPerms.length} permissions to "${role.name}"`);
  }

  console.log('✅ System roles seeded successfully.');
}

async function main() {
  try {
    await seedPermissions();
    await seedRoles();
    console.log('🎉 Enterprise RBAC seeding complete!');
    process.exit(0);
  } catch (err) {
    console.error('❌ Error during RBAC seeding:', err);
    process.exit(1);
  }
}

main();
