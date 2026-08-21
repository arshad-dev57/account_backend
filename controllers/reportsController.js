// controllers/reportController.js - MULTI-TENANT VERSION (FULLY FIXED)

const prisma = require('../prisma/client');
const {
  normalizeLocationId,
  warehouseInvoiceLocationWhere,
  journalEntryLocationWhere
} = require('../utils/accountingLocationHelper');

// ============================================================
// HELPER FUNCTIONS
// ============================================================

function getPeriodDisplayText(period, start, end) {
  if (period && period !== 'Custom Range') {
    switch (period) {
      case 'Today': return new Date(start).toLocaleDateString();
      case 'This Week': return `${start.toLocaleDateString()} - ${end.toLocaleDateString()}`;
      case 'This Month': return start.toLocaleString('default', { month: 'long', year: 'numeric' });
      case 'This Quarter': return `Q${Math.floor(start.getMonth() / 3) + 1} ${start.getFullYear()}`;
      case 'This Year': return `Year ${start.getFullYear()}`;
      default: return `${start.toLocaleDateString()} - ${end.toLocaleDateString()}`;
    }
  }
  return `${start.toLocaleDateString()} - ${end.toLocaleDateString()}`;
}

function getDateRange(period, startDate, endDate) {
  const now = new Date();
  let start, end;

  switch (period) {
    case 'Today':
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
      break;
    case 'This Week':
      start = new Date(now);
      start.setDate(now.getDate() - now.getDay());
      start.setHours(0, 0, 0, 0);
      end = new Date(now);
      end.setHours(23, 59, 59, 999);
      break;
    case 'This Month':
      start = new Date(now.getFullYear(), now.getMonth(), 1);
      end = new Date(now);
      end.setHours(23, 59, 59, 999);
      break;
    case 'This Quarter':
      const quarter = Math.floor(now.getMonth() / 3);
      start = new Date(now.getFullYear(), quarter * 3, 1);
      end = new Date(now);
      end.setHours(23, 59, 59, 999);
      break;
    case 'This Year':
      start = new Date(now.getFullYear(), 0, 1);
      end = new Date(now);
      end.setHours(23, 59, 59, 999);
      break;
    default:
      if (startDate && endDate) {
        start = new Date(startDate);
        end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
      } else {
        start = new Date(now.getFullYear(), now.getMonth(), 1);
        end = new Date(now);
        end.setHours(23, 59, 59, 999);
      }
  }

  return { start, end };
}

// ============================================================
// 1. PROFIT & LOSS STATEMENT (User-specific)
// ============================================================
exports.getProfitLossStatement = async (req, res) => {
  try {
    console.log('\n========== PROFIT & LOSS STATEMENT ==========');
    console.log('🔍 User ID:', req.user.id);

    const { startDate, endDate, period, fiscalYearId, locationId } = req.query;
    const userId = req.user.id;
    const companyId = req.user.companyId;
    let { start, end } = getDateRange(period, startDate, endDate);

    if (fiscalYearId && companyId) {
      const { applyFiscalYearWindow } = require('../utils/fiscalYearHelper');
      const clamped = await applyFiscalYearWindow({
        companyId,
        fiscalYearId,
        start,
        end,
        period: period || (startDate && endDate ? 'Custom' : 'This Year')
      });
      start = clamped.start;
      end = clamped.end;
    }

    console.log('📆 Date range:', { start: start.toISOString(), end: end.toISOString() });

    const { buildProfitLossFromLedger } = require('../utils/profitLossHelper');
    const pl = await buildProfitLossFromLedger(companyId, start, end, locationId || null);

    res.status(200).json({
      success: true,
      data: {
        period: {
          start: start,
          end: end,
          displayText: getPeriodDisplayText(period, start, end)
        },
        revenue: pl.revenue,
        costOfGoodsSold: pl.costOfGoodsSold,
        grossProfit: pl.grossProfit,
        operatingExpenses: pl.operatingExpenses,
        otherIncome: pl.otherIncome,
        otherExpenses: pl.otherExpenses,
        netProfit: pl.netProfit,
        netProfitMargin: pl.netProfitMargin
      }
    });
  } catch (error) {
    console.error('❌ Error generating P&L statement:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
};

// ============================================================
// 2. BALANCE SHEET (User-specific)
// ============================================================
exports.getBalanceSheet = async (req, res) => {
  try {
    console.log('\n========== BALANCE SHEET ==========');
    console.log('🔍 User ID:', req.user.id);

    const { period, asOfDate, fiscalYearId, locationId } = req.query;
    const userId = req.user.id;

    const companyId = req.user.companyId;
    const scopedLocation = Boolean(normalizeLocationId(locationId));
    let reportDate;
    let startDate, endDate;
    const now = new Date();

    if (asOfDate) {
      reportDate = new Date(asOfDate);
      reportDate.setHours(23, 59, 59, 999);
    } else {
      reportDate = new Date(now);
      reportDate.setHours(23, 59, 59, 999);
    }

    // ─── SET DATE RANGE FOR RETAINED EARNINGS ──────────────────
    switch (period) {
      case 'This Month':
        startDate = new Date(reportDate.getFullYear(), reportDate.getMonth(), 1);
        endDate = reportDate;
        break;
      case 'This Quarter':
        const quarter = Math.floor(reportDate.getMonth() / 3);
        startDate = new Date(reportDate.getFullYear(), quarter * 3, 1);
        endDate = reportDate;
        break;
      case 'This Year':
        startDate = new Date(reportDate.getFullYear(), 0, 1);
        endDate = reportDate;
        break;
      case 'All Time':
      default:
        startDate = new Date(2000, 0, 1);
        endDate = reportDate;
    }

    // ─── Build fiscal year filter ────────────────────────────────
    let fiscalYearFilter = {};
    if (fiscalYearId) {
      fiscalYearFilter = {
        fiscalYearId: fiscalYearId
      };
    }

    const accounts = await prisma.chartOfAccount.findMany({
      where: { companyId: companyId, isActive: true }
    });

    console.log('📊 Chart of Accounts found:', accounts.length);

    // ─── INITIALIZE BALANCE SHEET ──────────────────────────────
    const balanceSheet = {
      liabilities: {},
      assets: {},
      totalLiabilities: 0,
      totalAssets: 0
    };

    // ─── ORGANIZE ACCOUNTS BY CATEGORY ──────────────────────────
    for (const account of accounts) {
      const balance = account.currentBalance || account.openingBalance || 0;

      if (account.type === 'Liabilities') {
        const parent = account.parentAccount || 'Other Liabilities';
        if (!balanceSheet.liabilities[parent]) {
          balanceSheet.liabilities[parent] = {};
        }
        balanceSheet.liabilities[parent][account.name] = (balanceSheet.liabilities[parent][account.name] || 0) + balance;
        balanceSheet.totalLiabilities += balance;
      } else if (account.type === 'Assets') {
        const parent = account.parentAccount || 'Other Assets';
        if (!balanceSheet.assets[parent]) {
          balanceSheet.assets[parent] = {};
        }
        balanceSheet.assets[parent][account.name] = (balanceSheet.assets[parent][account.name] || 0) + balance;
        balanceSheet.totalAssets += balance;
      } else if (account.type === 'Equity') {
        const parent = account.parentAccount || 'Owners Equity';
        if (!balanceSheet.liabilities[parent]) {
          balanceSheet.liabilities[parent] = {};
        }
        balanceSheet.liabilities[parent][account.name] = (balanceSheet.liabilities[parent][account.name] || 0) + balance;
        balanceSheet.totalLiabilities += balance;
      }
    }

    // ─── GET BANK ACCOUNT BALANCES (User-specific) ──────────────
    const bankAccounts = await prisma.bankAccount.findMany({
      where: { companyId: companyId, status: 'Active' }
    });

    let totalBankBalance = 0;
    for (const account of bankAccounts) {
      totalBankBalance += account.currentBalance || 0;
    }

    if (totalBankBalance > 0) {
      if (!balanceSheet.assets['Current Assets']) {
        balanceSheet.assets['Current Assets'] = {};
      }
      balanceSheet.assets['Current Assets']['Cash & Bank'] = (balanceSheet.assets['Current Assets']['Cash & Bank'] || 0) + totalBankBalance;
      balanceSheet.totalAssets += totalBankBalance;
    }

    // ─── GET ACCOUNTS RECEIVABLE (User-specific) ──────────────
    const unpaidInvoices = await prisma.warehouseInvoice.findMany({
      where: {
        companyId: companyId,
        paymentStatus: { in: ['Unpaid', 'Partial'] },
        outstanding: { gt: 0 },
        ...warehouseInvoiceLocationWhere(locationId)
      }
    });

    let totalReceivables = 0;
    for (const invoice of unpaidInvoices) {
      totalReceivables += invoice.outstanding || 0;
    }

    if (totalReceivables > 0) {
      if (!balanceSheet.assets['Current Assets']) {
        balanceSheet.assets['Current Assets'] = {};
      }
      balanceSheet.assets['Current Assets']['Accounts Receivable'] = (balanceSheet.assets['Current Assets']['Accounts Receivable'] || 0) + totalReceivables;
      balanceSheet.totalAssets += totalReceivables;
    }

    // ─── GET ACCOUNTS PAYABLE (User-specific) ──────────────────
    // Manual bills have no locationId — exclude when location scoped
    const unpaidBills = scopedLocation
      ? []
      : await prisma.bill.findMany({
          where: {
            companyId: companyId,
            status: { in: ['Unpaid', 'Partial'] },
            outstanding: { gt: 0 }
          }
        });

    let totalPayables = 0;
    for (const bill of unpaidBills) {
      totalPayables += bill.outstanding || 0;
    }

    if (totalPayables > 0) {
      if (!balanceSheet.liabilities['Current Liabilities']) {
        balanceSheet.liabilities['Current Liabilities'] = {};
      }
      balanceSheet.liabilities['Current Liabilities']['Accounts Payable'] = (balanceSheet.liabilities['Current Liabilities']['Accounts Payable'] || 0) + totalPayables;
      balanceSheet.totalLiabilities += totalPayables;
    }

    // ─── GET LOAN BALANCES (User-specific) ──────────────────────
    const loans = await prisma.loan.findMany({
      where: { companyId: companyId, status: { not: 'Fully Paid' } }
    });

    for (const loan of loans) {
      const outstanding = loan.outstandingBalance || 0;
      if (loan.tenureMonths <= 12) {
        if (!balanceSheet.liabilities['Current Liabilities']) {
          balanceSheet.liabilities['Current Liabilities'] = {};
        }
        balanceSheet.liabilities['Current Liabilities']['Short-term Loans'] = (balanceSheet.liabilities['Current Liabilities']['Short-term Loans'] || 0) + outstanding;
      } else {
        if (!balanceSheet.liabilities['Other Liabilities']) {
          balanceSheet.liabilities['Other Liabilities'] = {};
        }
        balanceSheet.liabilities['Other Liabilities']['Long-term Debt'] = (balanceSheet.liabilities['Other Liabilities']['Long-term Debt'] || 0) + outstanding;
      }
      balanceSheet.totalLiabilities += outstanding;
    }

    // ─── GET RETAINED EARNINGS (User-specific) ──────────────────
    // Manual income/expense have no locationId — skip when location scoped
    const incomes = scopedLocation
      ? []
      : await prisma.income.findMany({
          where: {
            companyId: companyId,
            date: { gte: startDate, lte: endDate },
            status: 'Posted'
          }
        });

    const expenses = scopedLocation
      ? []
      : await prisma.expense.findMany({
          where: {
            companyId: companyId,
            date: { gte: startDate, lte: endDate },
            status: 'Posted'
          }
        });

    const totalIncome = incomes.reduce((sum, inc) => sum + (inc.totalAmount || inc.amount || 0), 0);
    const totalExpense = expenses.reduce((sum, exp) => sum + (exp.totalAmount || exp.amount || 0), 0);
    const retainedEarnings = totalIncome - totalExpense;

    if (retainedEarnings !== 0) {
      if (!balanceSheet.liabilities['Profit and Loss']) {
        balanceSheet.liabilities['Profit and Loss'] = {};
      }
      balanceSheet.liabilities['Profit and Loss']['Retained Earnings'] = (balanceSheet.liabilities['Profit and Loss']['Retained Earnings'] || 0) + retainedEarnings;
      balanceSheet.totalLiabilities += retainedEarnings;
    }

    // ─── SORT CATEGORIES ──────────────────────────────────────────
    const sortedLiabilities = {};
    const liabilityOrder = ['Current Liabilities', 'Other Liabilities', 'Owners Equity', 'Profit and Loss'];
    for (const key of liabilityOrder) {
      if (balanceSheet.liabilities[key]) {
        sortedLiabilities[key] = balanceSheet.liabilities[key];
      }
    }
    for (const key in balanceSheet.liabilities) {
      if (!sortedLiabilities[key]) {
        sortedLiabilities[key] = balanceSheet.liabilities[key];
      }
    }

    const sortedAssets = {};
    const assetOrder = ['Current Assets', 'Fixed Assets', 'Intangible Assets', 'Other Assets'];
    for (const key of assetOrder) {
      if (balanceSheet.assets[key]) {
        sortedAssets[key] = balanceSheet.assets[key];
      }
    }
    for (const key in balanceSheet.assets) {
      if (!sortedAssets[key]) {
        sortedAssets[key] = balanceSheet.assets[key];
      }
    }

    res.status(200).json({
      success: true,
      data: {
        asOfDate: reportDate,
        period: period || 'All Time',
        liabilities: sortedLiabilities,
        assets: sortedAssets,
        totalLiabilities: balanceSheet.totalLiabilities,
        totalAssets: balanceSheet.totalAssets,
        equity: balanceSheet.totalAssets - balanceSheet.totalLiabilities
      }
    });
  } catch (error) {
    console.error('❌ Error generating balance sheet:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
};

// ============================================================
// 3. CASH FLOW STATEMENT (User-specific)
// ============================================================
exports.getCashFlowStatement = async (req, res) => {
  try {
    console.log('\n========== CASH FLOW STATEMENT ==========');
    console.log('🔍 User ID:', req.user.id);

    const { startDate, endDate, period, fiscalYearId, locationId } = req.query;
    const userId = req.user.id;
    const companyId = req.user.companyId;
    const { start, end } = getDateRange(period, startDate, endDate);
    const scopedLocation = Boolean(normalizeLocationId(locationId));

    console.log('📆 Date range:', { start: start.toISOString(), end: end.toISOString() });

    // ─── Build fiscal year filter ────────────────────────────────
    let fiscalYearFilter = {};
    if (fiscalYearId) {
      fiscalYearFilter = {
        fiscalYearId: fiscalYearId
      };
    }

    // ─── OPERATING ACTIVITIES (User-specific) ──────────────────
    // Manual income/expense have no locationId — skip when location scoped
    const incomes = scopedLocation
      ? []
      : await prisma.income.findMany({
          where: {
            companyId: companyId,
            date: { gte: start, lte: end },
            status: 'Posted',
            ...fiscalYearFilter
          }
        });

    const expenses = scopedLocation
      ? []
      : await prisma.expense.findMany({
          where: {
            companyId: companyId,
            date: { gte: start, lte: end },
            status: 'Posted',
            ...fiscalYearFilter
          }
        });

    const cashReceiptsFromCustomers = incomes.reduce((sum, inc) => sum + (inc.totalAmount || inc.amount || 0), 0);
    const cashPaidToSuppliers = expenses.reduce((sum, exp) => sum + (exp.totalAmount || exp.amount || 0), 0);

    // ─── SEPARATE EXPENSE CATEGORIES ──────────────────────────
    const salaryExpenses = expenses.filter(exp => exp.expenseType === 'Salaries');
    const rentExpenses = expenses.filter(exp => exp.expenseType === 'Rent');
    const utilityExpenses = expenses.filter(exp => exp.expenseType === 'Utilities');
    const interestIncome = incomes.filter(inc => inc.incomeType === 'Interest Income');
    const taxExpenses = expenses.filter(exp => exp.expenseType === 'Taxes');

    const cashPaidForSalaries = salaryExpenses.reduce((sum, exp) => sum + (exp.totalAmount || exp.amount || 0), 0);
    const cashPaidForRent = rentExpenses.reduce((sum, exp) => sum + (exp.totalAmount || exp.amount || 0), 0);
    const cashPaidForUtilities = utilityExpenses.reduce((sum, exp) => sum + (exp.totalAmount || exp.amount || 0), 0);
    const interestReceived = interestIncome.reduce((sum, inc) => sum + (inc.totalAmount || inc.amount || 0), 0);
    const taxesPaid = taxExpenses.reduce((sum, exp) => sum + (exp.totalAmount || exp.amount || 0), 0);

    const cashFlowFromOperations = cashReceiptsFromCustomers - cashPaidToSuppliers;

    // ─── INVESTING ACTIVITIES (User-specific) ──────────────────
    const assetPayments = await prisma.paymentMade.findMany({
      where: {
        companyId: companyId,
        paymentDate: { gte: start, lte: end },
        reference: { contains: 'asset', mode: 'insensitive' }
      }
    });

    const assetSales = await prisma.paymentReceived.findMany({
      where: {
        companyId: companyId,
        paymentDate: { gte: start, lte: end },
        reference: { contains: 'asset sale', mode: 'insensitive' }
      }
    });

    const purchaseOfEquipment = assetPayments.reduce((sum, payment) => sum + payment.amount, 0);
    const saleOfFixedAssets = assetSales.reduce((sum, payment) => sum + payment.amount, 0);
    const cashFlowFromInvesting = saleOfFixedAssets - purchaseOfEquipment;

    // ─── FINANCING ACTIVITIES (User-specific) ──────────────────
    const loans = await prisma.loan.findMany({
      where: {
        companyId: companyId,
        disbursementDate: { gte: start, lte: end }
      }
    });

    const loanPayments = await prisma.paymentMade.findMany({
      where: {
        companyId: companyId,
        paymentDate: { gte: start, lte: end },
        reference: { contains: 'loan', mode: 'insensitive' }
      }
    });

    const loanProceeds = loans.reduce((sum, loan) => sum + loan.loanAmount, 0);
    const loanRepayments = loanPayments.reduce((sum, payment) => sum + payment.amount, 0);
    const cashFlowFromFinancing = loanProceeds - loanRepayments;

    // ─── NET CASH FLOW ──────────────────────────────────────────
    const netCashFlow = cashFlowFromOperations + cashFlowFromInvesting + cashFlowFromFinancing;

    // ─── GET CLOSING BALANCE (User-specific) ──────────────────
    const bankAccounts = await prisma.bankAccount.findMany({
      where: { companyId: companyId, status: 'Active' }
    });

    let closingCashBalance = 0;
    for (const account of bankAccounts) {
      closingCashBalance += account.currentBalance || 0;
    }

    const openingCashBalance = closingCashBalance - netCashFlow;

    // ─── BUILD RESPONSE ITEMS ──────────────────────────────────
    const operatingItems = [
      { name: 'Cash Receipts from Customers', amount: cashReceiptsFromCustomers, type: 'Inflow' },
      { name: 'Cash Paid to Suppliers', amount: -cashPaidToSuppliers, type: 'Outflow' },
    ];

    if (cashPaidForSalaries > 0) operatingItems.push({ name: 'Cash Paid for Salaries', amount: -cashPaidForSalaries, type: 'Outflow' });
    if (cashPaidForRent > 0) operatingItems.push({ name: 'Cash Paid for Rent', amount: -cashPaidForRent, type: 'Outflow' });
    if (cashPaidForUtilities > 0) operatingItems.push({ name: 'Cash Paid for Utilities', amount: -cashPaidForUtilities, type: 'Outflow' });
    if (interestReceived > 0) operatingItems.push({ name: 'Interest Received', amount: interestReceived, type: 'Inflow' });
    if (taxesPaid > 0) operatingItems.push({ name: 'Taxes Paid', amount: -taxesPaid, type: 'Outflow' });

    const investingItems = [];
    if (purchaseOfEquipment > 0) investingItems.push({ name: 'Purchase of Equipment', amount: -purchaseOfEquipment, type: 'Outflow' });
    if (saleOfFixedAssets > 0) investingItems.push({ name: 'Sale of Fixed Assets', amount: saleOfFixedAssets, type: 'Inflow' });

    const financingItems = [];
    if (loanProceeds > 0) financingItems.push({ name: 'Loan Proceeds', amount: loanProceeds, type: 'Inflow' });
    if (loanRepayments > 0) financingItems.push({ name: 'Loan Repayment', amount: -loanRepayments, type: 'Outflow' });

    res.status(200).json({
      success: true,
      data: {
        period: {
          start: start,
          end: end,
          displayText: getPeriodDisplayText(period, start, end)
        },
        operatingActivities: {
          items: operatingItems,
          total: cashFlowFromOperations
        },
        investingActivities: {
          items: investingItems,
          total: cashFlowFromInvesting
        },
        financingActivities: {
          items: financingItems,
          total: cashFlowFromFinancing
        },
        netCashFlow: netCashFlow,
        openingCashBalance: openingCashBalance,
        closingCashBalance: closingCashBalance,
        netCashFlowPercentage: openingCashBalance !== 0 ? (netCashFlow / openingCashBalance) * 100 : 0
      }
    });
  } catch (error) {
    console.error('❌ Error generating cash flow statement:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
};

// ============================================================
// 4. JOURNAL ENTRIES (with Pagination) (User-specific)
// ============================================================
exports.getJournalEntries = async (req, res) => {
  try {
    console.log('\n========== JOURNAL ENTRIES ==========');
    console.log('🔍 User ID:', req.user.id);

    const {
      status,
      search,
      startDate,
      endDate,
      page = 1,
      limit = 10,
      locationId
    } = req.query;

    const userId = req.user.id;
    const companyId = req.user.companyId;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // ─── BUILD WHERE CLAUSE (User-specific) ──────────────────────
    const where = { companyId: companyId };

    if (status && status !== 'All') {
      where.status = status;
    }

    if (startDate && endDate) {
      where.date = {
        gte: new Date(startDate),
        lte: new Date(endDate)
      };
    }

    const andClauses = [];
    if (search) {
      andClauses.push({
        OR: [
          { entryNumber: { contains: search, mode: 'insensitive' } },
          { description: { contains: search, mode: 'insensitive' } },
          { reference: { contains: search, mode: 'insensitive' } }
        ]
      });
    }
    const locWhere = journalEntryLocationWhere(locationId);
    if (Object.keys(locWhere).length > 0) {
      andClauses.push(locWhere);
    }
    if (andClauses.length === 1) {
      Object.assign(where, andClauses[0]);
    } else if (andClauses.length > 1) {
      where.AND = andClauses;
    }

    // ─── GET JOURNAL ENTRIES ──────────────────────────────────
    const journalEntries = await prisma.journalEntry.findMany({
      where,
      orderBy: { date: 'desc' },
      skip,
      take: parseInt(limit),
      include: {
        creator: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true
          }
        },
        poster: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true
          }
        },
        lines: {
          include: {
            account: {
              select: {
                id: true,
                code: true,
                name: true,
                type: true
              }
            }
          }
        }
      }
    });

    // ─── GET TOTAL COUNT ──────────────────────────────────────────
    const total = await prisma.journalEntry.count({ where });
    const totalPages = Math.ceil(total / parseInt(limit));

    // ─── CALCULATE SUMMARY ──────────────────────────────────────
    const allEntries = await prisma.journalEntry.findMany({
      where,
      include: { lines: true }
    });

    let totalDebit = 0;
    let totalCredit = 0;
    let postedCount = 0;
    let draftCount = 0;

    for (const entry of allEntries) {
      const entryDebit = entry.lines.reduce((sum, line) => sum + line.debit, 0);
      const entryCredit = entry.lines.reduce((sum, line) => sum + line.credit, 0);
      totalDebit += entryDebit;
      totalCredit += entryCredit;

      if (entry.status === 'Posted') postedCount++;
      else draftCount++;
    }

    res.status(200).json({
      success: true,
      count: journalEntries.length,
      total: total,
      page: parseInt(page),
      pages: totalPages,
      data: journalEntries,
      summary: {
        totalDebit,
        totalCredit,
        difference: Math.abs(totalDebit - totalCredit),
        postedCount,
        draftCount
      }
    });
  } catch (error) {
    console.error('❌ Error getting journal entries:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
};

// ============================================================
// 5. GET SINGLE JOURNAL ENTRY (User-specific)
// ============================================================
exports.getJournalEntry = async (req, res) => {
  try {
    console.log('\n========== GET SINGLE JOURNAL ENTRY ==========');
    console.log('🔍 Journal Entry ID:', req.params.id);
    console.log('🔍 User ID:', req.user.id);

    const { id } = req.params;
    const userId = req.user.id;

    const companyId = req.user.companyId;
    const journalEntry = await prisma.journalEntry.findFirst({
      where: {
        id,
        companyId: companyId},
      include: {
        creator: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true
          }
        },
        poster: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true
          }
        },
        lines: {
          include: {
            account: {
              select: {
                id: true,
                code: true,
                name: true,
                type: true
              }
            }
          }
        }
      }
    });

    if (!journalEntry) {
      return res.status(404).json({
        success: false,
        message: 'Journal entry not found'
      });
    }

    res.status(200).json({
      success: true,
      data: journalEntry
    });
  } catch (error) {
    console.error('❌ Error getting journal entry:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};