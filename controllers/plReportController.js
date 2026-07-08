// ✅ SAB SE IMPORTANT - PRISMA IMPORT
const prisma = require('../prisma/client');

// ✅ Debug: Check if prisma is loaded
console.log('========================================');
console.log('🔍 DEBUG: Checking prisma import');
console.log('🔍 prisma object:', typeof prisma);
console.log('🔍 prisma.income:', typeof prisma?.income);
console.log('🔍 prisma.expense:', typeof prisma?.expense);
console.log('🔍 prisma.invoice:', typeof prisma?.invoice);
console.log('🔍 prisma.creditNote:', typeof prisma?.creditNote);
console.log('🔍 prisma.bill:', typeof prisma?.bill);
console.log('========================================');
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
// @desc    Get Profit & Loss Statement
// @route   GET /api/pl-reports/profit-loss
// @access  Private
// ============================================================
exports.getProfitLossStatement = async (req, res) => {
  try {
    console.log('\n========== PROFIT & LOSS STATEMENT DEBUG ==========');
    console.log('🔍 User ID from token:', req.user.id);

    const { startDate, endDate, period } = req.query;
    console.log('📅 Request params:', { startDate, endDate, period });

    const userId = req.user.id;
    const { start, end } = getDateRange(period, startDate, endDate);

    console.log('📆 Date range:', { start: start.toISOString(), end: end.toISOString() });

    // ─── GET INCOMES ──────────────────────────────────────────────
    const incomes = await prisma.income.findMany({
      where: {
        createdBy: userId,
        date: {
          gte: start,
          lte: end
        },
        status: 'Posted'
      }
    });

    // ─── GET EXPENSES ──────────────────────────────────────────────
    const expenses = await prisma.expense.findMany({
      where: {
        createdBy: userId,
        date: {
          gte: start,
          lte: end
        },
        status: 'Posted'
      }
    });

    // ─── GET INVOICES ──────────────────────────────────────────────
    const invoices = await prisma.invoice.findMany({
      where: {
        createdBy: userId,
        date: {
          gte: start,
          lte: end
        },
        status: {
          not: 'Draft'
        }
      }
    });

    // ─── GET CREDIT NOTES ──────────────────────────────────────────
    const creditNotes = await prisma.creditNote.findMany({
      where: {
        createdBy: userId,
        date: {
          gte: start,
          lte: end
        }
      }
    });

    // ─── GET BILLS ──────────────────────────────────────────────────
    const bills = await prisma.bill.findMany({
      where: {
        createdBy: userId,
        date: {
          gte: start,
          lte: end
        }
      }
    });

    console.log('💰 Incomes found:', incomes.length);
    console.log('📄 Invoices found:', invoices.length);
    console.log('📉 Credit Notes found:', creditNotes.length);
    console.log('💸 Expenses found:', expenses.length);
    console.log('🧾 Bills found:', bills.length);

    // ─── GROUP INCOMES BY TYPE ──────────────────────────────────
    const revenueByType = {};
    let totalRevenue = 0;

    incomes.forEach(inc => {
      const type = inc.incomeType || 'Other Income';
      const amount = inc.totalAmount || inc.amount || 0;
      revenueByType[type] = (revenueByType[type] || 0) + amount;
      totalRevenue += amount;
    });

    // ─── ADD INVOICES TO REVENUE ────────────────────────────────
    let invoicesTotal = 0;
    invoices.forEach(inv => {
      invoicesTotal += inv.totalAmount || inv.grandTotal || 0;
    });
    if (invoicesTotal > 0) {
      revenueByType['Sales from Invoices'] = invoicesTotal;
      totalRevenue += invoicesTotal;
    }

    // ─── SUBTRACT CREDIT NOTES FROM REVENUE ────────────────────
    let creditNotesTotal = 0;
    creditNotes.forEach(cn => {
      creditNotesTotal += cn.amount || 0;
    });
    if (creditNotesTotal > 0) {
      revenueByType['Credit Notes / Refunds'] = -creditNotesTotal;
      totalRevenue -= creditNotesTotal;
    }

    console.log('📈 Revenue by type:', revenueByType);
    console.log('💰 Total Revenue:', totalRevenue);

    // ─── GROUP EXPENSES BY TYPE ──────────────────────────────────
    const expensesByType = {};
    let totalExpenses = 0;
    let costOfGoodsSold = 0;
    let operatingExpenses = 0;

    expenses.forEach(exp => {
      const type = exp.expenseType || 'Other Expense';
      const amount = exp.totalAmount || exp.amount || 0;
      expensesByType[type] = (expensesByType[type] || 0) + amount;
      totalExpenses += amount;

      if (type === 'Cost of Goods Sold' || type === 'Inventory Purchase') {
        costOfGoodsSold += amount;
      } else {
        operatingExpenses += amount;
      }
    });

    // ─── ADD BILLS TO EXPENSES ──────────────────────────────────
    let billsTotal = 0;
    bills.forEach(bill => {
      billsTotal += bill.totalAmount || 0;
    });
    if (billsTotal > 0) {
      expensesByType['Purchases / Bills'] = billsTotal;
      totalExpenses += billsTotal;
      operatingExpenses += billsTotal;
    }

    console.log('📉 Expenses by type:', expensesByType);
    console.log('💸 Total Expenses:', totalExpenses);

    // ─── SEPARATE OPERATING VS OTHER ────────────────────────────
    const operatingIncomeTypes = ['Sales', 'Services', 'Sales from Invoices', 'Credit Notes / Refunds'];
    const otherIncomeTypes = ['Interest Income', 'Rental Income', 'Dividend Income', 'Other Income'];
    const operatingExpenseTypes = ['Rent', 'Salaries', 'Utilities', 'Office Supplies', 'Marketing', 'Insurance', 'Maintenance', 'Software', 'Purchases / Bills'];
    const otherExpenseTypes = ['Taxes', 'Travel', 'Meals', 'Other'];

    let operatingRevenue = 0;
    let otherRevenue = 0;

    Object.entries(revenueByType).forEach(([type, amount]) => {
      if (operatingIncomeTypes.includes(type)) {
        operatingRevenue += amount;
      } else if (otherIncomeTypes.includes(type)) {
        otherRevenue += amount;
      } else {
        operatingRevenue += amount;
      }
    });

    let operatingExpenseTotal = 0;
    let otherExpenseTotal = 0;

    Object.entries(expensesByType).forEach(([type, amount]) => {
      if (operatingExpenseTypes.includes(type)) {
        operatingExpenseTotal += amount;
      } else if (otherExpenseTypes.includes(type)) {
        otherExpenseTotal += amount;
      } else {
        operatingExpenseTotal += amount;
      }
    });

    // ─── PREPARE REVENUE ITEMS ──────────────────────────────────
    const revenueItems = [];
    for (const [type, amount] of Object.entries(revenueByType)) {
      revenueItems.push({ name: type, amount: amount });
    }

    // ─── PREPARE EXPENSE ITEMS ──────────────────────────────────
    const expenseItems = [];
    for (const [type, amount] of Object.entries(expensesByType)) {
      expenseItems.push({ name: type, amount: amount });
    }

    // ─── PREPARE OTHER INCOME/EXPENSE ITEMS ────────────────────
    const otherIncomeItems = [];
    const otherExpenseItems = [];

    for (const [type, amount] of Object.entries(revenueByType)) {
      if (otherIncomeTypes.includes(type)) {
        otherIncomeItems.push({ name: type, amount: amount });
      }
    }

    for (const [type, amount] of Object.entries(expensesByType)) {
      if (otherExpenseTypes.includes(type)) {
        otherExpenseItems.push({ name: type, amount: amount });
      }
    }

    // ─── CALCULATE FINAL FIGURES ──────────────────────────────────
    const grossProfit = operatingRevenue - costOfGoodsSold;
    const netOperatingIncome = grossProfit - operatingExpenseTotal;
    const netProfit = netOperatingIncome + otherRevenue - otherExpenseTotal;

    console.log('📊 Final Calculations:');
    console.log('   Operating Revenue:', operatingRevenue);
    console.log('   Cost of Goods Sold:', costOfGoodsSold);
    console.log('   Gross Profit:', grossProfit);
    console.log('   Operating Expenses:', operatingExpenseTotal);
    console.log('   Net Operating Income:', netOperatingIncome);
    console.log('   Other Revenue:', otherRevenue);
    console.log('   Other Expenses:', otherExpenseTotal);
    console.log('   Net Profit:', netProfit);
    console.log('========== END DEBUG ==========\n');

    res.status(200).json({
      success: true,
      data: {
        period: {
          start: start,
          end: end,
          displayText: getPeriodDisplayText(period, start, end)
        },
        revenue: {
          total: totalRevenue,
          operating: operatingRevenue,
          other: otherRevenue,
          items: revenueItems
        },
        costOfGoodsSold: costOfGoodsSold,
        grossProfit: grossProfit,
        operatingExpenses: {
          total: operatingExpenseTotal,
          items: expenseItems.filter(item => operatingExpenseTypes.includes(item.name))
        },
        otherIncome: {
          total: otherRevenue,
          items: otherIncomeItems
        },
        otherExpenses: {
          total: otherExpenseTotal,
          items: otherExpenseItems
        },
        netProfit: netProfit,
        netProfitMargin: totalRevenue > 0 ? (netProfit / totalRevenue) * 100 : 0
      }
    });
  } catch (error) {
    console.error('❌ Error generating P&L statement:', error);
    console.error('📚 Stack:', error.stack);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// ============================================================
// @desc    Get Profit & Loss Summary (Quick Stats)
// @route   GET /api/pl-reports/profit-loss/summary
// @access  Private
// ============================================================
exports.getSummary = async (req, res) => {
  try {
    console.log('\n========== PROFIT & LOSS SUMMARY DEBUG ==========');
    console.log('🔍 User ID:', req.user.id);

    const now = new Date();
    const userId = req.user.id;

    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(now);
    endOfMonth.setHours(23, 59, 59, 999);

    const startOfYear = new Date(now.getFullYear(), 0, 1);
    const endOfYear = new Date(now);
    endOfYear.setHours(23, 59, 59, 999);

    // ─── MONTH INCOMES ──────────────────────────────────────────
    const monthIncomes = await prisma.income.aggregate({
      where: {
        createdBy: userId,
        date: { gte: startOfMonth, lte: endOfMonth },
        status: 'Posted'
      },
      _sum: { totalAmount: true }
    });

    const monthInvoices = await prisma.invoice.aggregate({
      where: {
        createdBy: userId,
        date: { gte: startOfMonth, lte: endOfMonth },
        status: { not: 'Draft' }
      },
      _sum: { totalAmount: true }
    });

    const monthCreditNotes = await prisma.creditNote.aggregate({
      where: {
        createdBy: userId,
        date: { gte: startOfMonth, lte: endOfMonth }
      },
      _sum: { amount: true }
    });

    const monthExpenses = await prisma.expense.aggregate({
      where: {
        createdBy: userId,
        date: { gte: startOfMonth, lte: endOfMonth },
        status: 'Posted'
      },
      _sum: { totalAmount: true }
    });

    const monthBills = await prisma.bill.aggregate({
      where: {
        createdBy: userId,
        date: { gte: startOfMonth, lte: endOfMonth }
      },
      _sum: { totalAmount: true }
    });

    // ─── YEAR INCOMES ────────────────────────────────────────────
    const yearIncomes = await prisma.income.aggregate({
      where: {
        createdBy: userId,
        date: { gte: startOfYear, lte: endOfYear },
        status: 'Posted'
      },
      _sum: { totalAmount: true }
    });

    const yearInvoices = await prisma.invoice.aggregate({
      where: {
        createdBy: userId,
        date: { gte: startOfYear, lte: endOfYear },
        status: { not: 'Draft' }
      },
      _sum: { totalAmount: true }
    });

    const yearCreditNotes = await prisma.creditNote.aggregate({
      where: {
        createdBy: userId,
        date: { gte: startOfYear, lte: endOfYear }
      },
      _sum: { amount: true }
    });

    const yearExpenses = await prisma.expense.aggregate({
      where: {
        createdBy: userId,
        date: { gte: startOfYear, lte: endOfYear },
        status: 'Posted'
      },
      _sum: { totalAmount: true }
    });

    const yearBills = await prisma.bill.aggregate({
      where: {
        createdBy: userId,
        date: { gte: startOfYear, lte: endOfYear }
      },
      _sum: { totalAmount: true }
    });

    const monthRevenue = (monthIncomes._sum.totalAmount || 0) + (monthInvoices._sum.totalAmount || 0) - (monthCreditNotes._sum.amount || 0);
    const monthExpense = (monthExpenses._sum.totalAmount || 0) + (monthBills._sum.totalAmount || 0);
    const yearRevenue = (yearIncomes._sum.totalAmount || 0) + (yearInvoices._sum.totalAmount || 0) - (yearCreditNotes._sum.amount || 0);
    const yearExpense = (yearExpenses._sum.totalAmount || 0) + (yearBills._sum.totalAmount || 0);

    console.log('📊 Month Revenue:', monthRevenue);
    console.log('📊 Month Expense:', monthExpense);
    console.log('📊 Year Revenue:', yearRevenue);
    console.log('📊 Year Expense:', yearExpense);
    console.log('========== END SUMMARY DEBUG ==========\n');

    res.status(200).json({
      success: true,
      data: {
        currentMonth: {
          revenue: monthRevenue,
          expenses: monthExpense,
          profit: monthRevenue - monthExpense,
          profitMargin: monthRevenue > 0 ? ((monthRevenue - monthExpense) / monthRevenue) * 100 : 0
        },
        currentYear: {
          revenue: yearRevenue,
          expenses: yearExpense,
          profit: yearRevenue - yearExpense,
          profitMargin: yearRevenue > 0 ? ((yearRevenue - yearExpense) / yearRevenue) * 100 : 0
        }
      }
    });
  } catch (error) {
    console.error('❌ Error in getSummary:', error);
    console.error('📚 Stack:', error.stack);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// ============================================================
// @desc    Get Trend Data (Chart)
// @route   GET /api/pl-reports/trend
// @access  Private
// ============================================================
exports.getTrendData = async (req, res) => {
  try {
    console.log('\n========== TREND DATA DEBUG ==========');
    console.log('🔍 User ID:', req.user.id);

    const { months = 12 } = req.query;
    const userId = req.user.id;
    const endDate = new Date();
    const startDate = new Date();
    startDate.setMonth(endDate.getMonth() - parseInt(months));

    const monthlyData = [];

    for (let i = 0; i <= parseInt(months); i++) {
      const date = new Date(startDate);
      date.setMonth(startDate.getMonth() + i);
      const monthStart = new Date(date.getFullYear(), date.getMonth(), 1);
      const monthEnd = new Date(date.getFullYear(), date.getMonth() + 1, 0);
      monthEnd.setHours(23, 59, 59, 999);

      const monthIncomes = await prisma.income.aggregate({
        where: {
          createdBy: userId,
          date: { gte: monthStart, lte: monthEnd },
          status: 'Posted'
        },
        _sum: { totalAmount: true }
      });

      const monthInvoices = await prisma.invoice.aggregate({
        where: {
          createdBy: userId,
          date: { gte: monthStart, lte: monthEnd },
          status: { not: 'Draft' }
        },
        _sum: { totalAmount: true }
      });

      const monthCreditNotes = await prisma.creditNote.aggregate({
        where: {
          createdBy: userId,
          date: { gte: monthStart, lte: monthEnd }
        },
        _sum: { amount: true }
      });

      const monthExpenses = await prisma.expense.aggregate({
        where: {
          createdBy: userId,
          date: { gte: monthStart, lte: monthEnd },
          status: 'Posted'
        },
        _sum: { totalAmount: true }
      });

      const monthBills = await prisma.bill.aggregate({
        where: {
          createdBy: userId,
          date: { gte: monthStart, lte: monthEnd }
        },
        _sum: { totalAmount: true }
      });

      const revenue = (monthIncomes._sum.totalAmount || 0) + (monthInvoices._sum.totalAmount || 0) - (monthCreditNotes._sum.amount || 0);
      const expenses = (monthExpenses._sum.totalAmount || 0) + (monthBills._sum.totalAmount || 0);

      monthlyData.push({
        month: date.toLocaleString('default', { month: 'short', year: 'numeric' }),
        revenue: revenue,
        expenses: expenses,
        profit: revenue - expenses
      });
    }

    console.log('📊 Monthly Data Points:', monthlyData.length);
    console.log('========== END TREND DEBUG ==========\n');

    res.status(200).json({
      success: true,
      data: monthlyData
    });
  } catch (error) {
    console.error('❌ Error in getTrendData:', error);
    console.error('📚 Stack:', error.stack);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// ============================================================
// @desc    Get Balance Sheet
// @route   GET /api/pl-reports/balance-sheet
// @access  Private
// ============================================================
exports.getBalanceSheet = async (req, res) => {
  try {
    console.log('\n========== BALANCE SHEET DEBUG ==========');
    console.log('🔍 User ID:', req.user.id);

    const { asOfDate } = req.query;
    const date = asOfDate ? new Date(asOfDate) : new Date();
    date.setHours(23, 59, 59, 999);

    const userId = req.user.id;

    // ─── GET CHART OF ACCOUNTS ──────────────────────────────────
    const accounts = await prisma.chartOfAccount.findMany({
      where: { createdBy: userId }
    });

    console.log('📊 Chart of Accounts found:', accounts.length);

    let totalAssets = 0;
    let totalLiabilities = 0;
    let totalEquity = 0;

    const assets = [];
    const liabilities = [];
    const equity = [];

    accounts.forEach(account => {
      const balance = account.currentBalance || account.openingBalance || 0;

      if (account.type === 'Assets') {
        totalAssets += balance;
        assets.push({ code: account.code, name: account.name, balance: balance });
      } else if (account.type === 'Liabilities') {
        totalLiabilities += balance;
        liabilities.push({ code: account.code, name: account.name, balance: balance });
      } else if (account.type === 'Equity') {
        totalEquity += balance;
        equity.push({ code: account.code, name: account.name, balance: balance });
      }
    });

    // ─── GET CURRENT PERIOD PROFIT/LOSS ──────────────────────────
    const startOfPeriod = new Date(date.getFullYear(), 0, 1);
    
    const incomes = await prisma.income.aggregate({
      where: {
        createdBy: userId,
        date: { gte: startOfPeriod, lte: date },
        status: 'Posted'
      },
      _sum: { totalAmount: true }
    });

    const expenses = await prisma.expense.aggregate({
      where: {
        createdBy: userId,
        date: { gte: startOfPeriod, lte: date },
        status: 'Posted'
      },
      _sum: { totalAmount: true }
    });

    const currentProfit = (incomes._sum.totalAmount || 0) - (expenses._sum.totalAmount || 0);

    console.log('📊 Total Assets:', totalAssets);
    console.log('📊 Total Liabilities:', totalLiabilities);
    console.log('📊 Total Equity:', totalEquity);
    console.log('📊 Current Profit:', currentProfit);
    console.log('========== END BALANCE SHEET DEBUG ==========\n');

    res.status(200).json({
      success: true,
      data: {
        asOfDate: date,
        assets: {
          total: totalAssets,
          items: assets
        },
        liabilities: {
          total: totalLiabilities,
          items: liabilities
        },
        equity: {
          total: totalEquity + currentProfit,
          currentProfit: currentProfit,
          items: equity
        },
        totalEquityAndLiabilities: totalLiabilities + totalEquity + currentProfit
      }
    });
  } catch (error) {
    console.error('❌ Error generating balance sheet:', error);
    console.error('📚 Stack:', error.stack);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// ============================================================
// @desc    Get Cash Flow Statement
// @route   GET /api/pl-reports/cash-flow
// @access  Private
// ============================================================
exports.getCashFlowStatement = async (req, res) => {
  try {
    console.log('\n========== CASH FLOW STATEMENT DEBUG ==========');
    console.log('🔍 User ID:', req.user.id);

    const { startDate, endDate } = req.query;
    let start, end;

    if (startDate && endDate) {
      start = new Date(startDate);
      end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
    } else {
      const now = new Date();
      start = new Date(now.getFullYear(), now.getMonth(), 1);
      end = new Date(now);
      end.setHours(23, 59, 59, 999);
    }

    console.log('📆 Date range:', { start: start.toISOString(), end: end.toISOString() });

    const userId = req.user.id;

    // ─── GET INCOMES ──────────────────────────────────────────────
    const incomes = await prisma.income.findMany({
      where: {
        createdBy: userId,
        date: { gte: start, lte: end },
        status: 'Posted'
      }
    });

    // ─── GET EXPENSES ──────────────────────────────────────────────
    const expenses = await prisma.expense.findMany({
      where: {
        createdBy: userId,
        date: { gte: start, lte: end },
        status: 'Posted'
      }
    });

    // ─── GET INVOICES ──────────────────────────────────────────────
    const invoices = await prisma.invoice.findMany({
      where: {
        createdBy: userId,
        date: { gte: start, lte: end },
        status: { not: 'Draft' }
      }
    });

    // ─── GET BILLS ──────────────────────────────────────────────────
    const bills = await prisma.bill.findMany({
      where: {
        createdBy: userId,
        date: { gte: start, lte: end }
      }
    });

    // ─── CALCULATE TOTALS ──────────────────────────────────────────
    const totalInflows = incomes.reduce((sum, inc) => sum + (inc.totalAmount || inc.amount || 0), 0) +
      invoices.reduce((sum, inv) => sum + (inv.totalAmount || 0), 0);

    const totalOutflows = expenses.reduce((sum, exp) => sum + (exp.totalAmount || exp.amount || 0), 0) +
      bills.reduce((sum, bill) => sum + (bill.totalAmount || 0), 0);

    console.log('💰 Total Inflows:', totalInflows);
    console.log('💸 Total Outflows:', totalOutflows);

    // ─── CATEGORIZE CASH FLOWS ──────────────────────────────────
    let operatingInflows = 0;
    let operatingOutflows = 0;
    let investingInflows = 0;
    let investingOutflows = 0;
    let financingInflows = 0;
    let financingOutflows = 0;

    const operatingIncomeTypes = ['Sales', 'Services'];
    const operatingExpenseTypes = ['Rent', 'Salaries', 'Utilities', 'Office Supplies', 'Marketing', 'Insurance', 'Maintenance', 'Software'];
    const investingIncomeTypes = ['Interest Income'];
    const investingExpenseTypes = ['Equipment Purchase', 'Asset Purchase'];
    const financingIncomeTypes = ['Loan Received'];
    const financingExpenseTypes = ['Loan Payment', 'Dividend Payment'];

    incomes.forEach(inc => {
      const amount = inc.totalAmount || inc.amount || 0;
      if (operatingIncomeTypes.includes(inc.incomeType)) {
        operatingInflows += amount;
      } else if (investingIncomeTypes.includes(inc.incomeType)) {
        investingInflows += amount;
      } else if (financingIncomeTypes.includes(inc.incomeType)) {
        financingInflows += amount;
      } else {
        operatingInflows += amount;
      }
    });

    invoices.forEach(inv => {
      operatingInflows += inv.totalAmount || 0;
    });

    expenses.forEach(exp => {
      const amount = exp.totalAmount || exp.amount || 0;
      if (operatingExpenseTypes.includes(exp.expenseType)) {
        operatingOutflows += amount;
      } else if (investingExpenseTypes.includes(exp.expenseType)) {
        investingOutflows += amount;
      } else if (financingExpenseTypes.includes(exp.expenseType)) {
        financingOutflows += amount;
      } else {
        operatingOutflows += amount;
      }
    });

    bills.forEach(bill => {
      operatingOutflows += bill.totalAmount || 0;
    });

    const netCashFlow = totalInflows - totalOutflows;
    const openingCashBalance = 0;
    const closingCashBalance = openingCashBalance + netCashFlow;

    console.log('📊 Operating Net:', operatingInflows - operatingOutflows);
    console.log('📊 Investing Net:', investingInflows - investingOutflows);
    console.log('📊 Financing Net:', financingInflows - financingOutflows);
    console.log('📊 Net Cash Flow:', netCashFlow);
    console.log('========== END CASH FLOW DEBUG ==========\n');

    res.status(200).json({
      success: true,
      data: {
        period: {
          start: start,
          end: end
        },
        operatingActivities: {
          inflows: operatingInflows,
          outflows: operatingOutflows,
          net: operatingInflows - operatingOutflows
        },
        investingActivities: {
          inflows: investingInflows,
          outflows: investingOutflows,
          net: investingInflows - investingOutflows
        },
        financingActivities: {
          inflows: financingInflows,
          outflows: financingOutflows,
          net: financingInflows - financingOutflows
        },
        totalInflows: totalInflows,
        totalOutflows: totalOutflows,
        netCashFlow: netCashFlow,
        openingCashBalance: openingCashBalance,
        closingCashBalance: closingCashBalance
      }
    });
  } catch (error) {
    console.error('❌ Error generating cash flow statement:', error);
    console.error('📚 Stack:', error.stack);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};