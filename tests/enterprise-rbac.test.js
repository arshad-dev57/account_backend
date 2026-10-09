

require('dotenv').config({ path: '/Users/glplanet/Documents/account_backend/.env' });
const prisma = require('../prisma/client');
const permissionService = require('../services/permissionService');
const { PERMISSION_CATALOG } = require('../config/permissionCatalog');

async function runTests() {
  console.log('====================================================');
  console.log('🧪 Starting Enterprise RBAC Automated Verification');
  console.log('====\n');

  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`  ✅ PASS: ${message}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: ${message}`);
      failed++;
    }
  }

  try {
    // 1. Verify Catalog Seeding
    console.log('1. Checking Database Seeding...');
    const permCount = await prisma.permission.count();
    assert(permCount >= 300, `Permissions seeded in database (found: ${permCount})`);

    const rolesCount = await prisma.role.count({ where: { isSystem: true } });
    assert(rolesCount >= 13, `System default roles seeded (found: ${rolesCount})`);

    // 2. Fetch or create test companies
    console.log('\n2. Testing Company & Role Isolation...');
    let companies = await prisma.company.findMany({ take: 2 });
    let companyA = companies[0];
    let companyB = companies[1];
    if (!companyA) {
      companyA = await prisma.company.create({
        data: { name: 'Test Tenant A' }
      });
    }
    if (!companyB) {
      companyB = await prisma.company.create({
        data: { name: 'Test Tenant B' }
      });
    }

    // Find Salesperson system role
    const salespersonRole = await prisma.role.findFirst({
      where: { name: 'Salesperson', isSystem: true }
    });
    assert(!!salespersonRole, 'Found Salesperson system role');

    // Create test user in Company A assigned Salesperson role
    let testSalesUser = await prisma.user.findFirst({
      where: { email: 'test_salesperson_rbac@bisonstechs.test' }
    });
    if (testSalesUser) {
      await prisma.userPermissionOverride.deleteMany({ where: { userId: testSalesUser.id } });
      await prisma.user.delete({ where: { id: testSalesUser.id } });
    }

    testSalesUser = await prisma.user.create({
      data: {
        firstName: 'Test',
        lastName: 'Salesperson',
        email: 'test_salesperson_rbac@bisonstechs.test',
        password: 'hashed_test_password',
        role: 'Salesperson',
        roleId: salespersonRole.id,
        companyId: companyA.id,
        isActive: true
      }
    });

    // 3. Test Effective Permissions for Salesperson
    console.log('\n3. Testing Role Permission Resolution...');
    permissionService.invalidateUserPermissions(testSalesUser.id);
    const effSales = await permissionService.getEffectivePermissions(testSalesUser.id, companyA.id);

    assert(effSales.isAdmin === false, 'Salesperson is not admin');
    assert(
      effSales.permissionMap['sales.orders.view']?.granted === true,
      'Salesperson can VIEW sales orders'
    );
    assert(
      effSales.permissionMap['sales.orders.create']?.granted === true,
      'Salesperson can CREATE sales orders'
    );
    assert(
      effSales.permissionMap['accounting.journal_entries.post']?.granted === false,
      'Salesperson CANNOT POST journal entries (default DENY)'
    );
    assert(
      effSales.permissionMap['sales.orders.view']?.scope === 'OWN',
      'Salesperson sales order VIEW scope is OWN'
    );

    // 4. Test User Direct Permission Overrides (ALLOW & DENY)
    console.log('\n4. Testing User Direct Overrides...');
    // A: Override ALLOW for Journal Entry View
    const journalViewPerm = await prisma.permission.findFirst({
      where: { name: 'accounting.journal_entries.view' }
    });
    assert(!!journalViewPerm, 'Found accounting.journal_entries.view permission in DB');

    await prisma.userPermissionOverride.create({
      data: {
        userId: testSalesUser.id,
        companyId: companyA.id,
        permissionId: journalViewPerm.id,
        effect: 'ALLOW',
        scope: 'ALL'
      }
    });

    // B: Override DENY for Sales Orders Create (which role previously allowed)
    const salesCreatePerm = await prisma.permission.findFirst({
      where: { name: 'sales.orders.create' }
    });
    assert(!!salesCreatePerm, 'Found sales.orders.create permission in DB');

    await prisma.userPermissionOverride.create({
      data: {
        userId: testSalesUser.id,
        companyId: companyA.id,
        permissionId: salesCreatePerm.id,
        effect: 'DENY'
      }
    });

    permissionService.invalidateUserPermissions(testSalesUser.id);
    const effWithOverrides = await permissionService.getEffectivePermissions(
      testSalesUser.id,
      companyA.id
    );

    assert(
      effWithOverrides.permissionMap['accounting.journal_entries.view']?.granted === true &&
        effWithOverrides.permissionMap['accounting.journal_entries.view']?.source ===
          'USER_OVERRIDE_ALLOW',
      'User override ALLOW explicitly grants journal entry view'
    );

    assert(
      effWithOverrides.permissionMap['sales.orders.create']?.granted === false &&
        effWithOverrides.permissionMap['sales.orders.create']?.source ===
          'USER_OVERRIDE_DENY',
      'User override DENY explicitly revokes sales order create'
    );

    // 5. Test Data Scope & Tenant Isolation Verification
    console.log('\n5. Testing Data Scope & Tenant Isolation Verification...');
    const ownRecord = {
      companyId: companyA.id,
      userId: testSalesUser.id
    };
    const someoneElseRecord = {
      companyId: companyA.id,
      userId: 'some-other-user-uuid'
    };
    const crossCompanyRecord = {
      companyId: companyB.id,
      userId: testSalesUser.id
    };

    const scopeCheckOwn = permissionService.verifyDataScope({
      user: { id: testSalesUser.id, companyId: companyA.id },
      scope: 'OWN',
      record: ownRecord
    });
    assert(scopeCheckOwn === true, 'OWN scope passes for user own record');

    const scopeCheckSomeoneElse = permissionService.verifyDataScope({
      user: { id: testSalesUser.id, companyId: companyA.id },
      scope: 'OWN',
      record: someoneElseRecord
    });
    assert(scopeCheckSomeoneElse === false, 'OWN scope rejects other users records');

    const scopeCheckCrossCompany = permissionService.verifyDataScope({
      user: { id: testSalesUser.id, companyId: companyA.id },
      scope: 'ALL',
      record: crossCompanyRecord
    });
    assert(
      scopeCheckCrossCompany === false,
      'Tenant isolation strictly blocks record from Company B even if scope is ALL'
    );

    // 6. Test Security Audit Logging
    console.log('\n6. Testing Security Audit Logging...');
    const auditRecord = await permissionService.recordSecurityAudit({
      companyId: companyA.id,
      userId: testSalesUser.id,
      action: 'TEST_PERMISSION_VERIFICATION',
      targetType: 'ROLE',
      targetId: salespersonRole.id,
      details: { verified: true }
    });
    assert(!!auditRecord?.id, 'Security audit log recorded successfully');

    // Clean up test overrides and test user
    await prisma.userPermissionOverride.deleteMany({ where: { userId: testSalesUser.id } });
    await prisma.securityAuditLog.deleteMany({ where: { userId: testSalesUser.id } });
    await prisma.user.delete({ where: { id: testSalesUser.id } });
    console.log('🧹 Cleaned up temporary test user and overrides.');

  } catch (err) {
    console.error('💥 Test execution error:', err);
    failed++;
  } finally {
    await prisma.$disconnect();
  }

  console.log('\n====================================================');
  console.log(`📊 Test Results: ${passed} PASSED | ${failed} FAILED`);
  console.log('====================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests();
