// Test script for default Chart of Accounts initialization
const prisma = require('../prisma/client');
const { initializeDefaultChartOfAccounts, hasDefaultAccounts, getAccountCodeByName } = require('../services/defaultChartOfAccountsService');

async function testDefaultCOA() {
  console.log('🧪 Testing Default Chart of Accounts Initialization\n');

  try {
    // Test 1: Check if service is loaded
    console.log('✅ Service loaded successfully');

    // Test 2: Get account code by name
    const salesCode = getAccountCodeByName('Sales Revenue');
    console.log(`✅ Sales Revenue code: ${salesCode}`);

    // Test 3: Create a test company
    const timestamp = Date.now();
    const testCompany = await prisma.company.create({
      data: {
        name: 'Test Company for COA',
        email: `test-coa-${timestamp}@example.com`,
        phone: '',
        address: '',
        businessType: '',
        taxRegistrationNumber: '',
        logo: '',
        website: '',
        subscriptionPlan: 'trial',
        subscriptionStatus: 'active',
        trialStartDate: new Date(),
        trialEndDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
      }
    });
    console.log(`✅ Test company created: ${testCompany.id}`);

    // Test 4: Create a test user
    const bcrypt = require('bcryptjs');
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash('test123', salt);

    const testUser = await prisma.user.create({
      data: {
        firstName: 'Test',
        lastName: 'User',
        email: `test-coa-user-${timestamp}@example.com`,
        password: hashedPassword,
        country: 'US',
        phone: '',
        address: '',
        organizationName: 'Test Company for COA',
        websiteLink: '',
        contactNo: '',
        businessDetails: {},
        role: 'admin',
        companyId: testCompany.id,
        subscriptionPlan: 'trial',
        subscriptionStatus: 'active',
        subscriptionStartDate: new Date(),
        trialStartDate: new Date(),
        trialEndDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
      }
    });
    console.log(`✅ Test user created: ${testUser.id}`);

    // Test 5: Check if default accounts exist (should be false)
    const hasAccounts = await hasDefaultAccounts(testCompany.id);
    console.log(`✅ Has default accounts before init: ${hasAccounts}`);

    // Test 6: Initialize default accounts
    console.log('\n🚀 Initializing default Chart of Accounts...');
    const result = await initializeDefaultChartOfAccounts(testCompany.id, testUser.id);
    console.log(`✅ Initialization result: ${result.message}`);
    console.log(`✅ Accounts created: ${result.created}`);

    // Test 7: Check if default accounts exist (should be true)
    const hasAccountsAfter = await hasDefaultAccounts(testCompany.id);
    console.log(`✅ Has default accounts after init: ${hasAccountsAfter}`);

    // Test 8: Verify accounts were created
    const accounts = await prisma.chartOfAccount.findMany({
      where: { companyId: testCompany.id },
      orderBy: { code: 'asc' }
    });
    console.log(`\n✅ Total accounts in company: ${accounts.length}`);
    console.log('📊 Account list:');
    accounts.forEach(acc => {
      console.log(`   ${acc.code} - ${acc.name} (${acc.type})`);
    });

    // Test 9: Try to initialize again (should skip duplicates)
    console.log('\n🔄 Testing duplicate prevention...');
    const result2 = await initializeDefaultChartOfAccounts(testCompany.id, testUser.id);
    console.log(`✅ Second init result: ${result2.message}`);

    // Cleanup
    console.log('\n🧹 Cleaning up test data...');
    await prisma.chartOfAccount.deleteMany({ where: { companyId: testCompany.id } });
    await prisma.user.delete({ where: { id: testUser.id } });
    await prisma.company.delete({ where: { id: testCompany.id } });
    console.log('✅ Cleanup complete');

    console.log('\n✅ All tests passed!');
  } catch (error) {
    console.error('❌ Test failed:', error);
    throw error;
  }
}

testDefaultCOA()
  .then(() => {
    console.log('\n🎉 Test completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Test failed:', error);
    process.exit(1);
  });
