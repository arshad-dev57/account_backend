const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function testMigration() {
  console.log('Testing multi-tenant migration...\n');

  try {
    // Count companies
    const companies = await prisma.company.count();
    console.log(`✓ Companies: ${companies}`);

    // Count users
    const users = await prisma.user.count();
    console.log(`✓ Users: ${users}`);

    // Count users with company
    const usersWithCompany = await prisma.user.count({
      where: { companyId: { not: null } }
    });
    console.log(`✓ Users with Company: ${usersWithCompany}`);

    // Count bank accounts with company
    const bankAccountsWithCompany = await prisma.bankAccount.count({
      where: { companyId: { not: null } }
    });
    console.log(`✓ Bank Accounts with Company: ${bankAccountsWithCompany}`);

    // Count products with company
    const productsWithCompany = await prisma.product.count({
      where: { companyId: { not: null } }
    });
    console.log(`✓ Products with Company: ${productsWithCompany}`);

    // Count orders with company
    const ordersWithCompany = await prisma.order.count({
      where: { companyId: { not: null } }
    });
    console.log(`✓ Orders with Company: ${ordersWithCompany}`);

    // Count accounts receivable with company
    const arWithCompany = await prisma.accountsReceivable.count({
      where: { companyId: { not: null } }
    });
    console.log(`✓ Accounts Receivable with Company: ${arWithCompany}`);

    // Count accounts payable with company
    const apWithCompany = await prisma.accountsPayable.count({
      where: { companyId: { not: null } }
    });
    console.log(`✓ Accounts Payable with Company: ${apWithCompany}`);

    // Check if all users have companies
    if (usersWithCompany === users) {
      console.log('\n✅ All users have been assigned to companies');
    } else {
      console.log(`\n⚠️  Warning: ${users - usersWithCompany} users without companies`);
    }

    console.log('\n✅ Migration test completed successfully!');

  } catch (error) {
    console.error('❌ Test failed:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

testMigration()
  .then(() => {
    console.log('Test script finished');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Test script failed:', error);
    process.exit(1);
  });
