const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function migrateToCompany() {
  console.log('Starting data migration to multi-tenant architecture...');

  try {
    console.log('Step 1: Creating companies for existing users...');
    const usersWithoutCompany = await prisma.user.findMany({
      where: { companyId: null },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        address: true,
        organizationName: true,
        isActive: true,
        subscriptionPlan: true,
        subscriptionStatus: true,
        createdAt: true,
        updatedAt: true
      }
    });

    console.log(`Found ${usersWithoutCompany.length} users without a company`);

    for (const user of usersWithoutCompany) {
      const companyName = user.organizationName || `${user.firstName} ${user.lastName}`.trim() || 'Default Company';
      
      const company = await prisma.company.create({
        data: {
          name: companyName,
          email: user.email,
          phone: user.phone,
          address: user.address,
          businessType: 'Sole Proprietorship',
          isActive: user.isActive,
          subscriptionPlan: user.subscriptionPlan,
          subscriptionStatus: user.subscriptionStatus,
          createdAt: user.createdAt,
          updatedAt: user.updatedAt
        }
      });

      await prisma.user.update({
        where: { id: user.id },
        data: { companyId: company.id }
      });

      console.log(`Created company "${companyName}" for user ${user.email}`);
    }

    // Step 2: Update all tables to use company_id from their associated users
    console.log('\nStep 2: Migrating company_id to all tables...');

    // Helper function to update a table's company_id based on created_by user
    const migrateTable = async (modelName, userField = 'createdBy') => {
      try {
        const records = await prisma[modelName].findMany({
          where: { companyId: null },
          select: { id: true, [userField]: true }
        });

        // Filter records where the user field is not null
        const recordsWithUser = records.filter(r => r[userField] !== null && r[userField] !== undefined);

        if (recordsWithUser.length > 0) {
          console.log(`Migrating ${recordsWithUser.length} records in ${modelName}...`);
          
          for (const record of recordsWithUser) {
            const user = await prisma.user.findUnique({
              where: { id: record[userField] },
              select: { companyId: true }
            });

            if (user && user.companyId) {
              await prisma[modelName].update({
                where: { id: record.id },
                data: { companyId: user.companyId }
              });
            }
          }
        }
      } catch (error) {
        console.error(`Error migrating ${modelName}:`, error.message);
      }
    };

    // Migrate tables that have created_by field
    await migrateTable('bankAccount');
    await migrateTable('bill');
    await migrateTable('category');
    await migrateTable('chartOfAccount');
    await migrateTable('creditNote');
    await migrateTable('customer');
    await migrateTable('delivery');
    await migrateTable('equityAccount');
    await migrateTable('expense');
    await migrateTable('fiscalYear', 'closedBy');
    await migrateTable('fixedAsset');
    await migrateTable('goodsReceiving');
    await migrateTable('income');
    await migrateTable('journalEntry');
    await migrateTable('loan');
    await migrateTable('order');
    await migrateTable('paymentMade');
    await migrateTable('paymentReceived');
    await migrateTable('product');
    await migrateTable('purchaseInvoice');
    await migrateTable('purchaseOrder');
    await migrateTable('purchasePaymentMake');
    await migrateTable('purchaseReturn');
    await migrateTable('quotation');
    await migrateTable('refund');
    await migrateTable('return');
    await migrateTable('salesInvoice');
    await migrateTable('salesPaymentReceived');
    await migrateTable('setting');
    await migrateTable('stockMovement');
    await migrateTable('supplier');
    await migrateTable('warehouseInvoice');
    await migrateTable('warehousePurchase');

    // Step 3: Migrate tables that reference other tables
    console.log('\nStep 3: Migrating related tables...');

    // Transactions from bank_accounts
    const transactions = await prisma.transaction.findMany({
      where: { companyId: null },
      select: { id: true, bankAccountId: true }
    });

    const transactionsWithBank = transactions.filter(t => t.bankAccountId !== null && t.bankAccountId !== undefined);

    if (transactionsWithBank.length > 0) {
      console.log(`Migrating ${transactionsWithBank.length} transactions from bank_accounts...`);
      for (const tx of transactionsWithBank) {
        const bankAccount = await prisma.bankAccount.findUnique({
          where: { id: tx.bankAccountId },
          select: { companyId: true }
        });
        if (bankAccount && bankAccount.companyId) {
          await prisma.transaction.update({
            where: { id: tx.id },
            data: { companyId: bankAccount.companyId }
          });
        }
      }
    }

    // Accounts receivable from customers
    const arRecords = await prisma.accountsReceivable.findMany({
      where: { companyId: null },
      select: { id: true, customerId: true }
    });

    const arWithCustomer = arRecords.filter(ar => ar.customerId !== null && ar.customerId !== undefined);

    if (arWithCustomer.length > 0) {
      console.log(`Migrating ${arWithCustomer.length} accounts receivable records from customers...`);
      for (const ar of arWithCustomer) {
        const customer = await prisma.customer.findUnique({
          where: { id: ar.customerId },
          select: { companyId: true }
        });
        if (customer && customer.companyId) {
          await prisma.accountsReceivable.update({
            where: { id: ar.id },
            data: { companyId: customer.companyId }
          });
        }
      }
    }

    // Accounts payable from suppliers
    const apRecords = await prisma.accountsPayable.findMany({
      where: { companyId: null },
      select: { id: true, supplierId: true }
    });

    const apWithSupplier = apRecords.filter(ap => ap.supplierId !== null && ap.supplierId !== undefined);

    if (apWithSupplier.length > 0) {
      console.log(`Migrating ${apWithSupplier.length} accounts payable records from suppliers...`);
      for (const ap of apWithSupplier) {
        const supplier = await prisma.supplier.findUnique({
          where: { id: ap.supplierId },
          select: { companyId: true }
        });
        if (supplier && supplier.companyId) {
          await prisma.accountsPayable.update({
            where: { id: ap.id },
            data: { companyId: supplier.companyId }
          });
        }
      }
    }

    console.log('\n✅ Data migration completed successfully!');
    console.log('All existing data has been migrated to the multi-tenant architecture.');

  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run the migration
migrateToCompany()
  .then(() => {
    console.log('Migration script finished');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Migration script failed:', error);
    process.exit(1);
  });
