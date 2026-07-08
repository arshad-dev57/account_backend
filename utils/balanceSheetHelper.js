// utils/balanceSheetHelper.js

const prisma = require('../prisma/client');

// ============================================================
// BUILD BALANCE SHEET FROM LEDGER
// ============================================================
async function buildBalanceSheetFromLedger(userId, asOfDate) {
  console.log('\n========== BUILD BALANCE SHEET ==========');
  console.log('🔍 User ID:', userId);
  console.log('📅 As Of Date:', asOfDate);

  // ✅ FIX: If asOfDate is undefined, use current date
  if (!asOfDate) {
    asOfDate = new Date();
    console.log('⚠️ asOfDate was undefined, using current date:', asOfDate);
  }

  // Ensure asOfDate is a Date object
  const reportDate = new Date(asOfDate);
  reportDate.setHours(23, 59, 59, 999);

  console.log('📅 Report Date:', reportDate);

  // ─── GET ALL CHART OF ACCOUNTS ──────────────────────────────
  const accounts = await prisma.chartOfAccount.findMany({
    where: {
      createdBy: userId,
      isActive: true
    }
  });

  console.log('📊 Chart of Accounts found:', accounts.length);

  // ─── SEPARATE EQUITY ACCOUNTS ──────────────────────────────
  const equityAccounts = [];
  const otherAccounts = [];

  for (const account of accounts) {
    if (account.type === 'Equity') {
      equityAccounts.push(account);
    } else {
      otherAccounts.push(account);
    }
  }

  console.log('📊 Equity Accounts found:', equityAccounts.length);
  console.log('📊 Other Accounts found:', otherAccounts.length);

  // ─── INITIALIZE BALANCE SHEET STRUCTURE ──────────────────────
  const assetsData = { current: [], fixed: [], other: [] };
  const liabilitiesData = { current: [], longTerm: [], other: [] };
  const equityItems = [];

  let totalAssets = 0;
  let totalLiabilities = 0;
  let totalEquityFromAccounts = 0;

  // ─── PROCESS EQUITY ACCOUNTS ──────────────────────────────
  for (const account of equityAccounts) {
    const balance = account.currentBalance || account.openingBalance || 0;
    totalEquityFromAccounts += balance;
    
    equityItems.push({
      code: account.code,
      name: account.name,
      balance: balance,
      parent: account.parentAccount || 'Owners Equity'
    });
  }

  console.log('📊 Total Equity from Accounts:', totalEquityFromAccounts);

  // ─── PROCESS OTHER ACCOUNTS (Assets & Liabilities) ────────
  for (const account of otherAccounts) {
    const balance = account.currentBalance || account.openingBalance || 0;
    
    // Skip zero balance accounts (optional)
    // if (balance === 0) continue;

    const accountData = {
      code: account.code,
      name: account.name,
      balance: balance,
      parent: account.parentAccount || ''
    };

    if (account.type === 'Assets') {
      totalAssets += balance;
      
      const parent = account.parentAccount || '';
      if (parent.includes('Current') || parent.includes('Cash') || parent.includes('Receivable')) {
        assetsData.current.push(accountData);
      } else if (parent.includes('Fixed') || parent.includes('Property') || parent.includes('Equipment')) {
        assetsData.fixed.push(accountData);
      } else {
        assetsData.other.push(accountData);
      }
    } 
    else if (account.type === 'Liabilities') {
      totalLiabilities += balance;
      
      const parent = account.parentAccount || '';
      if (parent.includes('Current') || parent.includes('Short') || parent.includes('Payable')) {
        liabilitiesData.current.push(accountData);
      } else if (parent.includes('Long') || parent.includes('Deferred')) {
        liabilitiesData.longTerm.push(accountData);
      } else {
        liabilitiesData.other.push(accountData);
      }
    }
  }

  console.log('📊 Total Assets from Accounts:', totalAssets);
  console.log('📊 Total Liabilities from Accounts:', totalLiabilities);

  // ─── GET RETAINED EARNINGS ──────────────────────────────────
  const startOfPeriod = new Date(reportDate.getFullYear(), 0, 1);
  
  console.log('📅 Start of Period:', startOfPeriod);
  console.log('📅 End of Period:', reportDate);

  const incomes = await prisma.income.aggregate({
    where: {
      createdBy: userId,
      date: { 
        gte: startOfPeriod, 
        lte: reportDate 
      },
      status: 'Posted'
    },
    _sum: { totalAmount: true }
  });

  const expenses = await prisma.expense.aggregate({
    where: {
      createdBy: userId,
      date: { 
        gte: startOfPeriod, 
        lte: reportDate 
      },
      status: 'Posted'
    },
    _sum: { totalAmount: true }
  });

  const totalIncome = incomes._sum.totalAmount || 0;
  const totalExpense = expenses._sum.totalAmount || 0;
  const retainedEarnings = totalIncome - totalExpense;

  console.log('💰 Total Income:', totalIncome);
  console.log('💸 Total Expense:', totalExpense);
  console.log('📊 Retained Earnings:', retainedEarnings);

  // ─── ADD RETAINED EARNINGS TO EQUITY ITEMS ────────────────
  if (retainedEarnings !== 0) {
    equityItems.push({
      code: 'RE-001',
      name: 'Retained Earnings',
      balance: retainedEarnings,
      parent: 'Owners Equity'
    });
  }

  // ─── CALCULATE TOTAL EQUITY ──────────────────────────────────
  // Total Equity = Equity Accounts + Retained Earnings
  const totalEquity = totalEquityFromAccounts + retainedEarnings;

  console.log('📊 Total Equity:', totalEquity);

  // ─── GET BANK ACCOUNT BALANCES ──────────────────────────────
  const bankAccounts = await prisma.bankAccount.findMany({
    where: {
      createdBy: userId,
      status: 'Active'
    }
  });

  let totalBankBalance = 0;
  for (const account of bankAccounts) {
    totalBankBalance += account.currentBalance || 0;
  }

  if (totalBankBalance > 0) {
    assetsData.current.push({
      code: 'BANK-001',
      name: 'Cash & Bank Accounts',
      balance: totalBankBalance,
      parent: 'Current Assets'
    });
    totalAssets += totalBankBalance;
  }

  console.log('🏦 Total Bank Balance:', totalBankBalance);

  // ─── GET ACCOUNTS RECEIVABLE FROM WAREHOUSE INVOICES ──────
  let unpaidInvoices = [];
  try {
    unpaidInvoices = await prisma.warehouseInvoice.findMany({
      where: {
        createdBy: userId,
        paymentStatus: { in: ['Unpaid', 'Partial', 'Overdue'] },
        outstanding: { gt: 0 }
      }
    });
    console.log('✅ Warehouse Invoices found:', unpaidInvoices.length);
  } catch (error) {
    console.log('⚠️ Could not find warehouseInvoice model, skipping accounts receivable');
    unpaidInvoices = [];
  }

  let totalReceivables = 0;
  for (const invoice of unpaidInvoices) {
    totalReceivables += invoice.outstanding || 0;
  }

  if (totalReceivables > 0) {
    assetsData.current.push({
      code: 'AR-001',
      name: 'Accounts Receivable',
      balance: totalReceivables,
      parent: 'Current Assets'
    });
    totalAssets += totalReceivables;
  }

  console.log('📊 Total Receivables:', totalReceivables);

  // ─── GET ACCOUNTS PAYABLE ──────────────────────────────────
  let unpaidBills = [];
  try {
    unpaidBills = await prisma.bill.findMany({
      where: {
        createdBy: userId,
        status: { in: ['Unpaid', 'Partial', 'Overdue'] },
        outstanding: { gt: 0 }
      }
    });
    console.log('✅ Bills found:', unpaidBills.length);
  } catch (error) {
    console.log('⚠️ Could not find bill model, skipping accounts payable');
    unpaidBills = [];
  }

  let totalPayables = 0;
  for (const bill of unpaidBills) {
    totalPayables += bill.outstanding || 0;
  }

  if (totalPayables > 0) {
    liabilitiesData.current.push({
      code: 'AP-001',
      name: 'Accounts Payable',
      balance: totalPayables,
      parent: 'Current Liabilities'
    });
    totalLiabilities += totalPayables;
  }

  console.log('📊 Total Payables:', totalPayables);

  // ─── GET LOAN BALANCES ──────────────────────────────────────
  const loans = await prisma.loan.findMany({
    where: {
      createdBy: userId,
      status: { not: 'Fully Paid' }
    }
  });

  let totalShortTermLoans = 0;
  let totalLongTermLoans = 0;

  for (const loan of loans) {
    const outstanding = loan.outstandingBalance || 0;
    if (loan.tenureMonths <= 12) {
      totalShortTermLoans += outstanding;
    } else {
      totalLongTermLoans += outstanding;
    }
    totalLiabilities += outstanding;
  }

  if (totalShortTermLoans > 0) {
    liabilitiesData.current.push({
      code: 'STL-001',
      name: 'Short-term Loans',
      balance: totalShortTermLoans,
      parent: 'Current Liabilities'
    });
  }

  if (totalLongTermLoans > 0) {
    liabilitiesData.longTerm.push({
      code: 'LTL-001',
      name: 'Long-term Debt',
      balance: totalLongTermLoans,
      parent: 'Long Term Liabilities'
    });
  }

  console.log('📊 Short-term Loans:', totalShortTermLoans);
  console.log('📊 Long-term Loans:', totalLongTermLoans);

  // ─── GET CREDIT NOTES ──────────────────────────────────────
  const creditNotes = await prisma.creditNote.findMany({
    where: {
      createdBy: userId,
      date: { lte: reportDate }
    }
  });

  let totalCreditNotes = 0;
  for (const cn of creditNotes) {
    totalCreditNotes += cn.remainingAmount || cn.amount || 0;
  }

  if (totalCreditNotes > 0) {
    assetsData.current.push({
      code: 'CN-001',
      name: 'Credit Notes Issued',
      balance: totalCreditNotes,
      parent: 'Current Assets'
    });
    totalAssets += totalCreditNotes;
  }

  console.log('📊 Total Credit Notes:', totalCreditNotes);

  // ─── RECALCULATE TOTALS ──────────────────────────────────
  // Total Assets = Assets from accounts + Bank + Receivables + Credit Notes
  // Total Liabilities = Liabilities from accounts + Payables + Loans
  // Total Equity = Equity Accounts + Retained Earnings
  
  const finalTotalAssets = totalAssets;
  const finalTotalLiabilities = totalLiabilities;
  const finalTotalEquity = totalEquity;
  const finalTotalLiabilitiesAndEquity = finalTotalLiabilities + finalTotalEquity;

  console.log('📊 Final Total Assets:', finalTotalAssets);
  console.log('📊 Final Total Liabilities:', finalTotalLiabilities);
  console.log('📊 Final Total Equity:', finalTotalEquity);
  console.log('📊 Final Total L + E:', finalTotalLiabilitiesAndEquity);

  // ─── CHECK IF BALANCED ──────────────────────────────────────
  const difference = finalTotalAssets - finalTotalLiabilitiesAndEquity;
  const isBalanced = Math.abs(difference) < 0.01;

  console.log('📊 Difference:', difference);
  console.log('📊 Is Balanced:', isBalanced);

  // ─── FILTER OUT ZERO BALANCE ITEMS ────────────────────────
  // Filter assets
  const filteredAssets = {
    current: assetsData.current.filter(item => item.balance !== 0),
    fixed: assetsData.fixed.filter(item => item.balance !== 0),
    other: assetsData.other.filter(item => item.balance !== 0)
  };

  // Filter liabilities
  const filteredLiabilities = {
    current: liabilitiesData.current.filter(item => item.balance !== 0),
    longTerm: liabilitiesData.longTerm.filter(item => item.balance !== 0),
    other: liabilitiesData.other.filter(item => item.balance !== 0)
  };

  // Filter equity
  const filteredEquityItems = equityItems.filter(item => item.balance !== 0);

  console.log('📊 Filtered Assets - Current:', filteredAssets.current.length);
  console.log('📊 Filtered Assets - Fixed:', filteredAssets.fixed.length);
  console.log('📊 Filtered Liabilities - LongTerm:', filteredLiabilities.longTerm.length);
  console.log('📊 Filtered Equity Items:', filteredEquityItems.length);

  // ─── RETURN BALANCE SHEET ──────────────────────────────────
  return {
    asOfDate: reportDate,
    assets: filteredAssets,
    liabilities: filteredLiabilities,
    equity: {
      owners: filteredEquityItems,
      retainedEarnings: retainedEarnings
    },
    totals: {
      totalAssets: finalTotalAssets,
      totalLiabilities: finalTotalLiabilities,
      totalEquity: finalTotalEquity,
      totalLiabilitiesAndEquity: finalTotalLiabilitiesAndEquity
    },
    isBalanced: isBalanced,
    difference: difference
  };
}

// ============================================================
// GET BALANCE SHEET SUMMARY
// ============================================================
async function getBalanceSheetSummary(userId, asOfDate) {
  const balanceSheet = await buildBalanceSheetFromLedger(userId, asOfDate);
  
  // Calculate key ratios
  const currentAssets = balanceSheet.assets.current.reduce((sum, a) => sum + a.balance, 0);
  const currentLiabilities = balanceSheet.liabilities.current.reduce((sum, l) => sum + l.balance, 0);
  const totalAssets = balanceSheet.totals.totalAssets;
  const totalLiabilities = balanceSheet.totals.totalLiabilities;
  const totalEquity = balanceSheet.totals.totalEquity;

  return {
    asOfDate: balanceSheet.asOfDate,
    totals: balanceSheet.totals,
    isBalanced: balanceSheet.isBalanced,
    difference: balanceSheet.difference,
    ratios: {
      currentRatio: currentLiabilities > 0 ? currentAssets / currentLiabilities : 0,
      debtToEquity: totalEquity > 0 ? totalLiabilities / totalEquity : 0,
      equityToAssets: totalAssets > 0 ? totalEquity / totalAssets : 0
    }
  };
}

module.exports = {
  buildBalanceSheetFromLedger,
  getBalanceSheetSummary
};