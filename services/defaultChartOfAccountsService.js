// services/defaultChartOfAccountsService.js
// Automatic Chart of Accounts initialization for new companies

const prisma = require('../prisma/client');

const DEFAULT_ACCOUNTS = [
  { code: '1001', name: 'Cash in Hand', type: 'Asset', parentAccount: 'Current Assets', balanceType: 'Debit' },
  { code: '1002', name: 'Bank Account', type: 'Asset', parentAccount: 'Current Assets', balanceType: 'Debit' },
  { code: '1100', name: 'Accounts Receivable', type: 'Asset', parentAccount: 'Current Assets', balanceType: 'Debit' },
  { code: '1200', name: 'Inventory', type: 'Asset', parentAccount: 'Current Assets', balanceType: 'Debit' },
  { code: '1300', name: 'Prepaid Expenses', type: 'Asset', parentAccount: 'Current Assets', balanceType: 'Debit' },
  { code: '1500', name: 'Fixed Assets', type: 'Asset', parentAccount: 'Non-Current Assets', balanceType: 'Debit' },
  { code: '1510', name: 'Accumulated Depreciation', type: 'Asset', parentAccount: 'Non-Current Assets', balanceType: 'Credit' },

  // LIABILITIES
  { code: '2010', name: 'Accounts Payable', type: 'Liability', parentAccount: 'Current Liabilities', balanceType: 'Credit' },
  { code: '2100', name: 'Taxes Payable', type: 'Liability', parentAccount: 'Current Liabilities', balanceType: 'Credit' },
  { code: '2200', name: 'Salaries Payable', type: 'Liability', parentAccount: 'Current Liabilities', balanceType: 'Credit' },
  { code: '2300', name: 'Loan Payable', type: 'Liability', parentAccount: 'Non-Current Liabilities', balanceType: 'Credit' },
  { code: '2400', name: 'Other Current Liabilities', type: 'Liability', parentAccount: 'Current Liabilities', balanceType: 'Credit' },

  // EQUITY
  { code: '3001', name: "Owner's Capital", type: 'Equity', parentAccount: 'Equity', balanceType: 'Credit' },
  { code: '3100', name: 'Retained Earnings', type: 'Equity', parentAccount: 'Equity', balanceType: 'Credit' },
  { code: '3200', name: 'Current Year Earnings', type: 'Equity', parentAccount: 'Equity', balanceType: 'Credit' },

  // INCOME
  { code: '4001', name: 'Sales Revenue', type: 'Revenue', parentAccount: 'Revenue', balanceType: 'Credit' },
  { code: '4100', name: 'Service Revenue', type: 'Revenue', parentAccount: 'Revenue', balanceType: 'Credit' },
  { code: '4200', name: 'Other Income', type: 'Revenue', parentAccount: 'Revenue', balanceType: 'Credit' },
  { code: '4300', name: 'Sales Returns & Allowances', type: 'Revenue', parentAccount: 'Revenue', balanceType: 'Debit' },
  { code: '4400', name: 'Sales Discounts', type: 'Revenue', parentAccount: 'Revenue', balanceType: 'Debit' },

  // COST OF SALES
  { code: '5001', name: 'Cost of Goods Sold', type: 'Expense', parentAccount: 'Cost of Sales', balanceType: 'Debit' },

  // EXPENSES
  { code: '6001', name: 'Rent Expense', type: 'Expense', parentAccount: 'Operating Expenses', balanceType: 'Debit' },
  { code: '6100', name: 'Salary Expense', type: 'Expense', parentAccount: 'Operating Expenses', balanceType: 'Debit' },
  { code: '6200', name: 'Utilities Expense', type: 'Expense', parentAccount: 'Operating Expenses', balanceType: 'Debit' },
  { code: '6300', name: 'Office Expense', type: 'Expense', parentAccount: 'Operating Expenses', balanceType: 'Debit' },
  { code: '6400', name: 'Internet Expense', type: 'Expense', parentAccount: 'Operating Expenses', balanceType: 'Debit' },
  { code: '6500', name: 'Marketing Expense', type: 'Expense', parentAccount: 'Operating Expenses', balanceType: 'Debit' },
  { code: '6600', name: 'Transportation Expense', type: 'Expense', parentAccount: 'Operating Expenses', balanceType: 'Debit' },
  { code: '6700', name: 'Depreciation Expense', type: 'Expense', parentAccount: 'Operating Expenses', balanceType: 'Debit' },
  { code: '6800', name: 'Bank Charges', type: 'Expense', parentAccount: 'Operating Expenses', balanceType: 'Debit' },
  { code: '6900', name: 'Miscellaneous Expense', type: 'Expense', parentAccount: 'Operating Expenses', balanceType: 'Debit' },
];

/**
 * Check if default accounts have already been initialized for a company
 */
async function hasDefaultAccounts(companyId) {
  const count = await prisma.chartOfAccount.count({
    where: {
      companyId,
      code: { in: DEFAULT_ACCOUNTS.map(a => a.code) }
    }
  });
  return count > 0;
}

/**
 * Initialize default Chart of Accounts for a new company
 * This should be called only once during company registration
 */
async function initializeDefaultChartOfAccounts(companyId, userId) {
  console.log('📊 [DefaultCOA] Starting initialization for company:', companyId);

  // Check if already initialized
  const alreadyInitialized = await hasDefaultAccounts(companyId);
  if (alreadyInitialized) {
    console.log('⚠️ [DefaultCOA] Default accounts already exist for company:', companyId);
    return { success: true, message: 'Default accounts already initialized', created: 0 };
  }

  try {
    // Create all default accounts using batch createMany for better performance
    const createdAccounts = [];
    
    // First, get existing account codes to avoid duplicates
    const existingAccounts = await prisma.chartOfAccount.findMany({
      where: {
        companyId,
        code: { in: DEFAULT_ACCOUNTS.map(a => a.code) }
      },
      select: { code: true }
    });
    
    const existingCodes = new Set(existingAccounts.map(a => a.code));
    
    // Filter out accounts that already exist
    const accountsToCreate = DEFAULT_ACCOUNTS.filter(account => !existingCodes.has(account.code));
    
    if (accountsToCreate.length === 0) {
      console.log('⏭️ [DefaultCOA] All default accounts already exist');
      return { success: true, message: 'All default accounts already initialized', created: 0 };
    }
    
    // Create accounts in batches to avoid transaction timeout
    const batchSize = 10;
    for (let i = 0; i < accountsToCreate.length; i += batchSize) {
      const batch = accountsToCreate.slice(i, i + batchSize);
      
      const batchCreated = await prisma.$transaction(async (tx) => {
        const batchAccounts = [];
        for (const account of batch) {
          const newAccount = await tx.chartOfAccount.create({
            data: {
              code: account.code,
              name: account.name,
              type: account.type,
              parentAccount: account.parentAccount,
              openingBalance: 0,
              currentBalance: 0,
              balanceType: account.balanceType,
              description: `Default ${account.type} account - auto-generated`,
              taxCode: 'N/A',
              isActive: true,
              createdBy: userId,
              companyId
            }
          });
          batchAccounts.push(newAccount);
          console.log(`✅ [DefaultCOA] Created account: ${account.code} - ${account.name}`);
        }
        return batchAccounts;
      });
      
      createdAccounts.push(...batchCreated);
    }

    try {
      const { syncCompanyEquityAccounts } = require('../utils/equityAccountHelper');
      await syncCompanyEquityAccounts(companyId, userId);
    } catch (syncErr) {
      console.log('⚠️ [DefaultCOA] Equity sync skipped:', syncErr.message);
    }

    console.log(`✅ [DefaultCOA] Initialization complete. Created ${createdAccounts.length} accounts for company: ${companyId}`);
    return { 
      success: true, 
      message: `Successfully initialized ${createdAccounts.length} default accounts`,
      created: createdAccounts.length,
      accounts: createdAccounts
    };
  } catch (error) {
    console.error('❌ [DefaultCOA] Initialization failed:', error);
    throw new Error(`Failed to initialize default Chart of Accounts: ${error.message}`);
  }
}

/**
 * Get account code by name for transaction mapping
 */
function getAccountCodeByName(accountName) {
  const account = DEFAULT_ACCOUNTS.find(a => a.name === accountName);
  return account ? account.code : null;
}

/**
 * Get all default account codes for a category
 */
function getAccountCodesByType(type) {
  return DEFAULT_ACCOUNTS
    .filter(a => a.type === type)
    .map(a => a.code);
}

module.exports = {
  initializeDefaultChartOfAccounts,
  hasDefaultAccounts,
  getAccountCodeByName,
  getAccountCodesByType,
  DEFAULT_ACCOUNTS
};
