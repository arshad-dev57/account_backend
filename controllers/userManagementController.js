const prisma = require('../prisma/client');
const bcrypt = require('bcryptjs');
const emailService = require('../services/emailService');

function formatRoleLabel(role, customName) {
  if (customName && String(customName).trim()) return String(customName).trim();
  const map = {
    user: 'User',
    admin: 'Admin',
    manager: 'Manager',
    staff: 'Staff',
    viewer: 'Viewer'
  };
  const key = String(role || 'user').toLowerCase();
  return map[key] || (role ? String(role) : 'User');
}

/**
 * Canonical permission catalog (module + pages).
 * Frontend access screens should mirror these page keys.
 */
const AVAILABLE_PERMISSION_MODULES = [
  {
    module: 'accounting',
    displayName: 'Accounting',
    pages: [
      { page: 'accounting-dashboard', displayName: 'Dashboard' },
      { page: 'accounting-credit-notes', displayName: 'Credit Notes' },
      { page: 'accounting-accounts-receivable', displayName: 'Accounts Receivable' },
    ]
  },
  {
    module: 'sales',
    displayName: 'Sales',
    pages: [
      { page: 'sales-dashboard', displayName: 'Dashboard' },
      { page: 'sales-products', displayName: 'Products' },
      { page: 'sales-orders', displayName: 'Orders' },
      { page: 'sales-quotations', displayName: 'Quotations' },
      { page: 'sales-customers', displayName: 'Customers' },
      { page: 'sales-deliveries', displayName: 'Deliveries' },
      { page: 'sales-invoices', displayName: 'Invoices' },
      { page: 'sales-sales-payments', displayName: 'Sales Payments' },
      { page: 'sales-sales-returns', displayName: 'Sales Returns' },
      { page: 'sales-refunds', displayName: 'Refunds' },
      { page: 'sales-credits', displayName: 'Sales Credits' },
    ]
  },
  {
    module: 'purchases',
    displayName: 'Purchases',
    pages: [
      { page: 'purchases-dashboard', displayName: 'Dashboard' },
      { page: 'purchases-purchase-orders', displayName: 'Purchase Orders' },
      { page: 'purchases-suppliers', displayName: 'Suppliers' },
      { page: 'purchases-goods-receiving', displayName: 'Goods Receiving' },
      { page: 'purchases-purchase-invoices', displayName: 'Purchase Invoices' },
      { page: 'purchases-purchase-payments', displayName: 'Purchase Payments' },
      { page: 'purchases-purchase-returns', displayName: 'Purchase Returns' },
    ]
  },
  {
    module: 'warehouse',
    displayName: 'Warehouse',
    pages: [
      { page: 'warehouse-products', displayName: 'Products' },
      { page: 'warehouse-categories', displayName: 'Categories' },
      { page: 'warehouse-suppliers', displayName: 'Suppliers' },
      { page: 'warehouse-customers', displayName: 'Customers' },
      { page: 'warehouse-stock-movement', displayName: 'Stock Movement' },
      { page: 'warehouse-orders', displayName: 'Orders' },
    ]
  },
  {
    module: 'users',
    displayName: 'Users',
    pages: [
      { page: 'users-user-management', displayName: 'User Management' },
      { page: 'users-roles', displayName: 'Roles' },
      { page: 'users-permissions', displayName: 'Permissions' },
    ]
  },
];

/** Normalize legacy double-prefix keys written by older clients */
function normalizePermissionPage(page) {
  if (!page || typeof page !== 'string') return page;
  const map = {
    'sales-sales-credits': 'sales-credits',
    'sales-credits': 'sales-credits'
  };
  return map[page] || page;
}

const getAllUsers = async (req, res) => {
  try {
    const currentUserId = req.user.id;
        const currentUser = await prisma.user.findUnique({
      where: { id: currentUserId },
      select: { 
        id: true,
        role: true, 
        managerId: true,
        companyId: true
      }
    });

    const hasRoleAccess = currentUser.role === 'admin' || currentUser.role === 'manager';
    
    let hasPermissionAccess = false;
    if (!hasRoleAccess) {
      const userPermission = await prisma.userPermission.findFirst({
        where: {
          companyId: currentUser.companyId,
          page: '/admin/users',
          canView: true
        }
      });
      hasPermissionAccess = !!userPermission;
    }

    if (!hasRoleAccess && !hasPermissionAccess) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to view users. You need admin/manager role or view permission.'
      });
    }

    let userFilter = {};
    userFilter = { companyId: currentUser.companyId };

    if (currentUser.role === 'admin') {
      userFilter = { companyId: currentUser.companyId };
    } else if (currentUser.role === 'manager') {
      userFilter = { companyId: currentUser.companyId, managerId: currentUserId };
    }

    const users = await prisma.user.findMany({
      where: userFilter,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        role: true,
        roleId: true,
        isActive: true,
        createdAt: true,
        managerId: true,
        manager: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true
          }
        },
        userRole: {
          select: {
            id: true,
            name: true,
            description: true
          }
        },
        permissions: {
          select: {
            id: true,
            page: true,
            canView: true,
            canCreate: true,
            canEdit: true,
            canDelete: true
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    res.status(200).json({
      success: true,
      data: users
    });
  } catch (error) {
    console.error('Get all users error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

const getUserById = async (req, res) => {
  try {
    const { id } = req.params;
    const currentUserId = req.user.id;

    const currentUser = await prisma.user.findUnique({
      where: { id: currentUserId },
      select: { role: true, managerId: true }
    });

    if (currentUser.role !== 'admin' && currentUser.role !== 'manager') {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to view user details'
      });
    }

    const user = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        country: true,
        role: true,
        roleId: true,
        isActive: true,
        managerId: true,
        createdAt: true,
        manager: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true
          }
        },
        userRole: {
          select: {
            id: true,
            name: true,
            description: true
          }
        },
        permissions: {
          select: {
            id: true,
            page: true,
            canView: true,
            canCreate: true,
            canEdit: true,
            canDelete: true
          }
        }
      }
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.status(200).json({
      success: true,
      data: user
    });
  } catch (error) {
    console.error('Get user by ID error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

const createUser = async (req, res) => {
  try {
    console.log('═══════════════════════════════════════════════════');
    console.log('🔵 [createUser] Called');
    console.log('👤 [createUser] Current User ID:', req.user?.id);
    console.log('📦 [createUser] Request Body:', JSON.stringify(req.body, null, 2));
    console.log('═══════════════════════════════════════════════════');

    const currentUserId = req.user.id;
    const {
      firstName,
      lastName,
      email,
      password,
      phone,
      country,
      role,
      roleId,
      managerId,
      permissions
    } = req.body;

    // ─── Validation ──────────────────────────────────────────────
    console.log('🔍 [createUser] Validating required fields...');
    
    if (!firstName || !lastName || !email || !password) {
      console.log('❌ [createUser] Missing required fields');
      console.log('   - firstName:', firstName ? '✅' : '❌');
      console.log('   - lastName:', lastName ? '✅' : '❌');
      console.log('   - email:', email ? '✅' : '❌');
      console.log('   - password:', password ? '✅' : '❌');
      return res.status(400).json({
        success: false,
        message: 'Please provide all required fields: firstName, lastName, email, password'
      });
    }

    if (password.length < 6) {
      console.log('❌ [createUser] Password too short:', password.length, 'characters');
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters'
      });
    }

    // ─── Check Current User Authorization ────────────────────────
    console.log('🔍 [createUser] Checking authorization for user:', currentUserId);
    
    const currentUser = await prisma.user.findUnique({
      where: { id: currentUserId },
      select: { 
        id: true,
        role: true,
        email: true,
        firstName: true,
        lastName: true,
        companyId: true
      }
    });

    if (!currentUser) {
      console.log('❌ [createUser] Current user not found:', currentUserId);
      return res.status(404).json({
        success: false,
        message: 'Current user not found'
      });
    }

    console.log('✅ [createUser] Current user found:');
    console.log('   - ID:', currentUser.id);
    console.log('   - Name:', currentUser.firstName, currentUser.lastName);
    console.log('   - Email:', currentUser.email);
    console.log('   - Role:', currentUser.role);

    console.log('🔍 [createUser] Checking authorization...');
    
    const hasRoleAccess = currentUser.role === 'admin' || currentUser.role === 'manager';
    
    let hasPermissionAccess = false;
    if (!hasRoleAccess) {
      console.log('🔍 [createUser] User does not have admin/manager role, checking permissions...');
      const userPermission = await prisma.userPermission.findFirst({
        where: {
          companyId: currentUser.companyId,
          page: '/admin/users',
          canCreate: true
        }
      });
      hasPermissionAccess = !!userPermission;
      if (hasPermissionAccess) {
        console.log('✅ [createUser] User has canCreate permission for /admin/users');
      }
    }

    if (!hasRoleAccess && !hasPermissionAccess) {
      console.log('❌ [createUser] Unauthorized');
      console.log('   - Role:', currentUser.role);
      console.log('   - Required: admin, manager, or canCreate permission for /admin/users');
      return res.status(403).json({
        success: false,
        message: 'Not authorized to create users. You need admin/manager role or create permission.'
      });
    }

    console.log('✅ [createUser] Authorization passed');

    const normalizedEmail = String(email).trim().toLowerCase();
    const normalizedPhone = phone != null ? String(phone).trim() : '';

    console.log('🔍 [createUser] Checking if email exists:', normalizedEmail);
    
    const existingUser = await prisma.user.findFirst({
      where: {
        email: { equals: normalizedEmail, mode: 'insensitive' }
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true
      }
    });

    if (existingUser) {
      console.log('❌ [createUser] Email already exists:');
      console.log('   - User ID:', existingUser.id);
      console.log('   - Name:', existingUser.firstName, existingUser.lastName);
      console.log('   - Email:', existingUser.email);
      return res.status(400).json({
        success: false,
        code: 'EMAIL_EXISTS',
        message: `A user already exists with this email (${normalizedEmail}).`
      });
    }

    if (normalizedPhone && currentUser.companyId) {
      const existingPhone = await prisma.user.findFirst({
        where: {
          companyId: currentUser.companyId,
          phone: normalizedPhone
        },
        select: { id: true, email: true, phone: true }
      });
      if (existingPhone) {
        return res.status(400).json({
          success: false,
          code: 'PHONE_EXISTS',
          message: `A user already exists with this phone number (${normalizedPhone}).`
        });
      }
    }

    console.log('✅ [createUser] Email is available:', email);

    console.log('🔐 [createUser] Hashing password...');
    const hashedPassword = await bcrypt.hash(password, 10);
    console.log('✅ [createUser] Password hashed successfully');

    let finalManagerId = managerId || null;
    
    if (currentUser.role === 'manager' && !managerId) {
      finalManagerId = currentUserId;
      console.log('📌 [createUser] Manager creating user, setting managerId to:', finalManagerId);
    } else if (currentUser.role === 'admin' && managerId) {
      console.log('📌 [createUser] Admin creating user with specified managerId:', managerId);
    } else if (currentUser.role === 'admin' && !managerId) {
      console.log('📌 [createUser] Admin creating user without managerId');
    }

    console.log('🔄 [createUser] Creating user in database...');
    console.log('   - First Name:', firstName);
    console.log('   - Last Name:', lastName);
    console.log('   - Email:', email);
    console.log('   - Phone:', phone || 'Not provided');
    console.log('   - Country:', country || 'Pakistan');
    console.log('   - Role:', role || 'user');
    console.log('   - Role ID:', roleId || 'Not provided');
    console.log('   - Manager ID:', finalManagerId || 'Not provided');

    const newUser = await prisma.user.create({
      data: {
        firstName,
        lastName,
        email: normalizedEmail,
        password: hashedPassword,
        phone: normalizedPhone,
        country: country || 'Pakistan',
        role: role || 'user',
        roleId: roleId || null,
        managerId: finalManagerId,
        createdBy: currentUserId,
        companyId: currentUser.companyId,
        // Set default subscription for new user
        subscriptionPlan: 'trial',
        subscriptionStatus: 'active',
        subscriptionStartDate: new Date(),
        trialStartDate: new Date(),
        trialEndDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days trial
        isActive: true
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        role: true,
        roleId: true,
        managerId: true,
        isActive: true,
        createdAt: true,
        subscriptionPlan: true,
        subscriptionStatus: true
      }
    });

    console.log('✅ [createUser] User created successfully:');
    console.log('   - User ID:', newUser.id);
    console.log('   - Name:', newUser.firstName, newUser.lastName);
    console.log('   - Email:', newUser.email);
    console.log('   - Role:', newUser.role);

    // ─── Create Permissions ────────────────────────────────────
    if (permissions && Array.isArray(permissions) && permissions.length > 0) {
      console.log('🔄 [createUser] Creating permissions for user...');
      console.log(`   - ${permissions.length} permissions to create`);
      console.log('   - Permissions:', JSON.stringify(permissions, null, 2));

      try {
        const seen = new Set();
        const permissionData = [];
        for (const p of permissions) {
          const page = normalizePermissionPage(p.page);
          if (!page || seen.has(page)) continue;
          seen.add(page);
          permissionData.push({
            userId: newUser.id,
            page,
            canView: p.canView ?? true,
            canCreate: p.canCreate ?? false,
            canEdit: p.canEdit ?? false,
            canDelete: p.canDelete ?? false
          });
        }

        await prisma.userPermission.createMany({
          data: permissionData,
          skipDuplicates: true
        });

        console.log('✅ [createUser] Permissions created successfully');
      } catch (permError) {
        console.error('⚠️ [createUser] Failed to create permissions:', permError.message);
        console.log('⚠️ [createUser] User was created but permissions failed');
        // Don't throw, user is already created
      }
    } else {
      console.log('📌 [createUser] No permissions provided, skipping');
    }

    let emailSent = false;
    try {
      let companyName = 'BisonsTechs';
      if (currentUser.companyId) {
        const company = await prisma.company.findUnique({
          where: { id: currentUser.companyId },
          select: { name: true }
        });
        if (company?.name) companyName = company.name;
      }

      let customRoleName = '';
      if (roleId) {
        const namedRole = await prisma.role.findUnique({
          where: { id: roleId },
          select: { name: true }
        });
        if (namedRole?.name) customRoleName = namedRole.name;
      }

      const invitedBy = [currentUser.firstName, currentUser.lastName]
        .filter(Boolean)
        .join(' ')
        .trim() || currentUser.email;

      console.log('📧 [createUser] Sending invite email to:', email);
      await emailService.sendTeamInviteEmail({
        to: email,
        firstName,
        lastName,
        loginEmail: email,
        password,
        roleLabel: formatRoleLabel(role || newUser.role, customRoleName),
        companyName,
        invitedBy
      });
      emailSent = true;
      console.log('✅ [createUser] Invite email sent successfully');
    } catch (emailError) {
      console.error('⚠️ [createUser] Failed to send invite email:', emailError.message);
    }

    console.log('✅ [createUser] Operation completed successfully');
    console.log('📤 [createUser] Sending response...');
    console.log('═══════════════════════════════════════════════════');

    res.status(201).json({
      success: true,
      emailSent,
      message: emailSent
        ? 'User created. Login details sent to their email.'
        : 'User created, but the invite email could not be sent.',
      data: newUser
    });

  } catch (error) {
    console.error('❌ [createUser] Error:', error);
    console.error('❌ [createUser] Error Stack:', error.stack);
    console.error('❌ [createUser] Error Name:', error.name);
    console.log('═══════════════════════════════════════════════════');

    if (error.code === 'P2002') {
      const fields = Array.isArray(error.meta?.target) ? error.meta.target : [];
      const field = fields.includes('email')
        ? 'email'
        : fields.includes('phone')
          ? 'phone number'
          : (fields[0] || 'value');
      return res.status(400).json({
        success: false,
        code: 'DUPLICATE',
        message: `A user already exists with this ${field}.`
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};
const updateUser = async (req, res) => {
  try {
    const { id } = req.params;
    const currentUserId = req.user.id;
    const {
      firstName,
      lastName,
      email,
      phone,
      country,
      role,
      roleId,
      managerId,
      isActive,
      permissions
    } = req.body;

    const currentUser = await prisma.user.findUnique({
      where: { id: currentUserId },
      select: { 
        id: true,
        role: true,
        email: true,
        firstName: true,
        lastName: true,
        companyId: true
      }
    });

    // ─── Check Authorization (Role or Permission) ───────────────
    const hasRoleAccess = currentUser.role === 'admin' || currentUser.role === 'manager';
    
    let hasPermissionAccess = false;
    if (!hasRoleAccess) {
      const userPermission = await prisma.userPermission.findFirst({
        where: {
          companyId: currentUser.companyId,
          page: '/admin/users',
          canEdit: true
        }
      });
      hasPermissionAccess = !!userPermission;
    }

    if (!hasRoleAccess && !hasPermissionAccess) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to update users. You need admin/manager role or edit permission.'
      });
    }

    // Check if user exists
    const existingUser = await prisma.user.findUnique({
      where: { id }
    });

    if (!existingUser) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Check if email is being changed and if it already exists
    if (email && email.trim().toLowerCase() !== String(existingUser.email || '').toLowerCase()) {
      const normalizedEmail = email.trim().toLowerCase();
      const emailExists = await prisma.user.findFirst({
        where: {
          email: { equals: normalizedEmail, mode: 'insensitive' },
          NOT: { id }
        }
      });

      if (emailExists) {
        return res.status(400).json({
          success: false,
          code: 'EMAIL_EXISTS',
          message: `A user already exists with this email (${normalizedEmail}).`
        });
      }
    }

    // Update user
    const updatedUser = await prisma.user.update({
      where: { id },
      data: {
        ...(firstName && { firstName }),
        ...(lastName && { lastName }),
        ...(email && { email }),
        ...(phone !== undefined && { phone }),
        ...(country && { country }),
        ...(role && { role }),
        ...(roleId !== undefined && { roleId }),
        ...(managerId !== undefined && { managerId }),
        ...(isActive !== undefined && { isActive })
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        role: true,
        roleId: true,
        isActive: true,
        createdAt: true
      }
    });

    // Update permissions if provided
    if (permissions && Array.isArray(permissions)) {
      // Delete existing permissions
      await prisma.userPermission.deleteMany({
        where: { userId: id }
      });

      // Create new permissions
      await prisma.userPermission.createMany({
        data: permissions.map(p => ({
          userId: id,
          page: p.page,
          canView: p.canView ?? true,
          canCreate: p.canCreate ?? false,
          canEdit: p.canEdit ?? false,
          canDelete: p.canDelete ?? false
        })),
        skipDuplicates: true
      });
    }

    res.status(200).json({
      success: true,
      message: 'User updated successfully',
      data: updatedUser
    });
  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

const deleteUser = async (req, res) => {
  try {
    const { id } = req.params;
    const currentUserId = req.user.id;

    const currentUser = await prisma.user.findUnique({
      where: { id: currentUserId },
      select: { 
        id: true,
        role: true,
        email: true,
        firstName: true,
        lastName: true,
        companyId: true
      }
    });

    // ─── Check Authorization (Role or Permission) ───────────────
    const hasRoleAccess = currentUser.role === 'admin';
    
    let hasPermissionAccess = false;
    if (!hasRoleAccess) {
      const userPermission = await prisma.userPermission.findFirst({
        where: {
          companyId: currentUser.companyId,
          page: '/admin/users',
          canDelete: true
        }
      });
      hasPermissionAccess = !!userPermission;
    }

    if (!hasRoleAccess && !hasPermissionAccess) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to delete users. You need admin role or delete permission.'
      });
    }

    // Prevent deleting yourself
    if (id === currentUserId) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete your own account'
      });
    }

    await prisma.user.delete({
      where: { id }
    });

    res.status(200).json({
      success: true,
      message: 'User deleted successfully'
    });
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

const updateUserPermissions = async (req, res) => {
  try {
    const { id } = req.params;
    const currentUserId = req.user.id;
    const { permissions } = req.body;

    const currentUser = await prisma.user.findUnique({
      where: { id: currentUserId },
      select: { 
        id: true,
        role: true,
        email: true,
        firstName: true,
        lastName: true,
        companyId: true
      }
    });

    // ─── Check Authorization (Role or Permission) ───────────────
    const hasRoleAccess = currentUser.role === 'admin' || currentUser.role === 'manager';
    
    let hasPermissionAccess = false;
    if (!hasRoleAccess) {
      const userPermission = await prisma.userPermission.findFirst({
        where: {
          companyId: currentUser.companyId,
          page: '/admin/users',
          canEdit: true
        }
      });
      hasPermissionAccess = !!userPermission;
    }

    if (!hasRoleAccess && !hasPermissionAccess) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to update permissions. You need admin/manager role or edit permission.'
      });
    }

    // Delete existing permissions
    await prisma.userPermission.deleteMany({
      where: { userId: id }
    });

    // Create new permissions (normalize Sales Credits key)
    if (permissions && Array.isArray(permissions)) {
      const seen = new Set();
      const rows = [];
      for (const p of permissions) {
        const page = normalizePermissionPage(p.page);
        if (!page || seen.has(page)) continue;
        seen.add(page);
        rows.push({
          userId: id,
          page,
          canView: p.canView ?? true,
          canCreate: p.canCreate ?? false,
          canEdit: p.canEdit ?? false,
          canDelete: p.canDelete ?? false
        });
      }
      if (rows.length > 0) {
        await prisma.userPermission.createMany({
          data: rows,
          skipDuplicates: true
        });
      }
    }

    // Return updated permissions
    const updatedPermissions = await prisma.userPermission.findMany({
      where: { userId: id }
    });

    res.status(200).json({
      success: true,
      message: 'Permissions updated successfully',
      data: updatedPermissions
    });
  } catch (error) {
    console.error('Update permissions error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// ============================================================
// @desc    Get available permission modules/pages (incl. Sales Credits)
// @route   GET /api/admin/users/permissions/catalog
// @access  Private
// ============================================================
const getPermissionCatalog = async (req, res) => {
  try {
    res.status(200).json({
      success: true,
      data: AVAILABLE_PERMISSION_MODULES
    });
  } catch (error) {
    console.error('Get permission catalog error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// ============================================================
// @desc    Get available roles
// @route   GET /api/users/roles
// @access  Private
// ============================================================
const getRoles = async (req, res) => {
  try {
    const roles = await prisma.role.findMany({
      where: { isActive: true },
      select: {
        id: true,
        name: true,
        description: true
      }
    });

    res.status(200).json({
      success: true,
      data: roles
    });
  } catch (error) {
    console.error('Get roles error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

module.exports = {
  getAllUsers,
  getUserById,
  createUser,
  updateUser,
  deleteUser,
  updateUserPermissions,
  getPermissionCatalog,
  getRoles,
  AVAILABLE_PERMISSION_MODULES
};
