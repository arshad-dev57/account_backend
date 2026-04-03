const Income = require('../models/Income');
const Expense = require('../models/Expense');
const ChartOfAccount = require('../models/ChartOfAccount');

// ==================== HELPER FUNCTION ====================
function _getPeriodDisplayText(period, start, end) {
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

// ==================== GET PROFIT & LOSS STATEMENT ====================
exports.getProfitLossStatement = async (req, res) => {
  try {
    console.log('\n========== PROFIT & LOSS STATEMENT DEBUG ==========');
    console.log('🔍 User ID from token:', req.user?._id || req.user?.id);
    console.log('🔍 User Email:', req.user?.email);
    
    const { startDate, endDate, period } = req.query;
    console.log('📅 Request params:', { startDate, endDate, period });
    
    let start, end;
    
    // Handle period presets
    const now = new Date();
    switch (period) {
      case 'Today':
        start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
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
    
    console.log('📆 Date range:', { start: start.toISOString(), end: end.toISOString() });
    
    const dateFilter = {
      date: { $gte: start, $lte: end },
      status: 'Posted',
      createdBy: req.user._id || req.user.id
    };
    
    console.log('📊 Date Filter:', JSON.stringify(dateFilter, null, 2));
    
    // Get all incomes and expenses for this user
    const incomes = await Income.find(dateFilter);
    const expenses = await Expense.find(dateFilter);
    
    console.log('💰 Incomes found:', incomes.length);
    console.log('💸 Expenses found:', expenses.length);
    
    // Debug: Check if any incomes without createdBy
    if (incomes.length === 0) {
      const allIncomes = await Income.find({ status: 'Posted' }).limit(5);
      console.log('⚠️ Sample of all incomes in DB (first 5):');
      allIncomes.forEach((inc, idx) => {
        console.log(`  ${idx + 1}. ID: ${inc._id}, Type: ${inc.incomeType}, Amount: ${inc.totalAmount}, CreatedBy: ${inc.createdBy}`);
      });
    }
    
    // Group incomes by type
    const revenueByType = {};
    let totalRevenue = 0;
    
    incomes.forEach(inc => {
      const type = inc.incomeType;
      const amount = inc.totalAmount;
      
      if (!revenueByType[type]) {
        revenueByType[type] = 0;
      }
      revenueByType[type] += amount;
      totalRevenue += amount;
    });
    
    console.log('📈 Revenue by type:', revenueByType);
    console.log('💰 Total Revenue:', totalRevenue);
    
    // Group expenses by type
    const expensesByType = {};
    let totalExpenses = 0;
    let costOfGoodsSold = 0;
    let operatingExpenses = 0;
    
    expenses.forEach(exp => {
      const type = exp.expenseType;
      const amount = exp.totalAmount;
      
      if (!expensesByType[type]) {
        expensesByType[type] = 0;
      }
      expensesByType[type] += amount;
      totalExpenses += amount;
      
      if (type === 'Cost of Goods Sold' || type === 'Inventory Purchase') {
        costOfGoodsSold += amount;
      } else {
        operatingExpenses += amount;
      }
    });
    
    console.log('📉 Expenses by type:', expensesByType);
    console.log('💸 Total Expenses:', totalExpenses);
    
    // Separate operating vs other
    const operatingIncomeTypes = ['Sales', 'Services'];
    const otherIncomeTypes = ['Interest Income', 'Rental Income', 'Dividend Income', 'Other Income'];
    const operatingExpenseTypes = ['Rent', 'Salaries', 'Utilities', 'Office Supplies', 'Marketing', 'Insurance', 'Maintenance', 'Software'];
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
    
    // Prepare revenue items
    const revenueItems = [];
    for (const [type, amount] of Object.entries(revenueByType)) {
      revenueItems.push({
        name: type,
        amount: amount
      });
    }
    
    // Prepare expense items
    const expenseItems = [];
    for (const [type, amount] of Object.entries(expensesByType)) {
      expenseItems.push({
        name: type,
        amount: amount
      });
    }
    
    // Prepare other income items
    const otherIncomeItems = [];
    for (const [type, amount] of Object.entries(revenueByType)) {
      if (otherIncomeTypes.includes(type)) {
        otherIncomeItems.push({
          name: type,
          amount: amount
        });
      }
    }
    
    // Prepare other expense items
    const otherExpenseItems = [];
    for (const [type, amount] of Object.entries(expensesByType)) {
      if (otherExpenseTypes.includes(type)) {
        otherExpenseItems.push({
          name: type,
          amount: amount
        });
      }
    }
    
    // Calculate final figures
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
          displayText: _getPeriodDisplayText(period, start, end)
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
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// ==================== GET SUMMARY (Quick Stats) ====================
exports.getSummary = async (req, res) => {
  try {
    console.log('\n========== PROFIT & LOSS SUMMARY DEBUG ==========');
    console.log('🔍 User ID:', req.user?._id || req.user?.id);
    
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(now);
    endOfMonth.setHours(23, 59, 59, 999);
    
    const startOfYear = new Date(now.getFullYear(), 0, 1);
    const endOfYear = new Date(now);
    endOfYear.setHours(23, 59, 59, 999);
    
    const userId = req.user._id || req.user.id;
    
    // Current month - only posted entries created by this user
    const monthIncomes = await Income.aggregate([
      { $match: { 
        date: { $gte: startOfMonth, $lte: endOfMonth }, 
        status: 'Posted',
        createdBy: userId
      } },
      { $group: { _id: null, total: { $sum: '$totalAmount' } } }
    ]);
    
    const monthExpenses = await Expense.aggregate([
      { $match: { 
        date: { $gte: startOfMonth, $lte: endOfMonth }, 
        status: 'Posted',
        createdBy: userId
      } },
      { $group: { _id: null, total: { $sum: '$totalAmount' } } }
    ]);
    
    // Current year - only posted entries created by this user
    const yearIncomes = await Income.aggregate([
      { $match: { 
        date: { $gte: startOfYear, $lte: endOfYear }, 
        status: 'Posted',
        createdBy: userId
      } },
      { $group: { _id: null, total: { $sum: '$totalAmount' } } }
    ]);
    
    const yearExpenses = await Expense.aggregate([
      { $match: { 
        date: { $gte: startOfYear, $lte: endOfYear }, 
        status: 'Posted',
        createdBy: userId
      } },
      { $group: { _id: null, total: { $sum: '$totalAmount' } } }
    ]);
    
    const monthRevenue = monthIncomes[0]?.total || 0;
    const monthExpense = monthExpenses[0]?.total || 0;
    const yearRevenue = yearIncomes[0]?.total || 0;
    const yearExpense = yearExpenses[0]?.total || 0;
    
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
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// ==================== GET TREND DATA (Chart) ====================
exports.getTrendData = async (req, res) => {
  try {
    console.log('\n========== TREND DATA DEBUG ==========');
    console.log('🔍 User ID:', req.user?._id || req.user?.id);
    
    const { months = 12 } = req.query;
    const endDate = new Date();
    const startDate = new Date();
    startDate.setMonth(endDate.getMonth() - parseInt(months));
    
    const userId = req.user._id || req.user.id;
    const monthlyData = [];
    
    for (let i = 0; i <= parseInt(months); i++) {
      const date = new Date(startDate);
      date.setMonth(startDate.getMonth() + i);
      const monthStart = new Date(date.getFullYear(), date.getMonth(), 1);
      const monthEnd = new Date(date.getFullYear(), date.getMonth() + 1, 0);
      monthEnd.setHours(23, 59, 59, 999);
      
      const monthIncomes = await Income.aggregate([
        { $match: { 
          date: { $gte: monthStart, $lte: monthEnd }, 
          status: 'Posted',
          createdBy: userId
        } },
        { $group: { _id: null, total: { $sum: '$totalAmount' } } }
      ]);
      
      const monthExpenses = await Expense.aggregate([
        { $match: { 
          date: { $gte: monthStart, $lte: monthEnd }, 
          status: 'Posted',
          createdBy: userId
        } },
        { $group: { _id: null, total: { $sum: '$totalAmount' } } }
      ]);
      
      const revenue = monthIncomes[0]?.total || 0;
      const expenses = monthExpenses[0]?.total || 0;
      
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
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// ==================== GET BALANCE SHEET ====================
exports.getBalanceSheet = async (req, res) => {
  try {
    console.log('\n========== BALANCE SHEET DEBUG ==========');
    console.log('🔍 User ID:', req.user?._id || req.user?.id);
    
    const { asOfDate } = req.query;
    const date = asOfDate ? new Date(asOfDate) : new Date();
    date.setHours(23, 59, 59, 999);
    
    const userId = req.user._id || req.user.id;
    
    // Get all chart of accounts created by this user
    const accounts = await ChartOfAccount.find({ 
      createdBy: userId
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
        assets.push({
          code: account.code,
          name: account.name,
          balance: balance
        });
      } else if (account.type === 'Liabilities') {
        totalLiabilities += balance;
        liabilities.push({
          code: account.code,
          name: account.name,
          balance: balance
        });
      } else if (account.type === 'Equity') {
        totalEquity += balance;
        equity.push({
          code: account.code,
          name: account.name,
          balance: balance
        });
      }
    });
    
    // Get current period profit/loss
    const startOfPeriod = new Date(date.getFullYear(), 0, 1);
    const incomes = await Income.aggregate([
      { $match: { 
        date: { $gte: startOfPeriod, $lte: date }, 
        status: 'Posted',
        createdBy: userId
      } },
      { $group: { _id: null, total: { $sum: '$totalAmount' } } }
    ]);
    
    const expenses = await Expense.aggregate([
      { $match: { 
        date: { $gte: startOfPeriod, $lte: date }, 
        status: 'Posted',
        createdBy: userId
      } },
      { $group: { _id: null, total: { $sum: '$totalAmount' } } }
    ]);
    
    const currentProfit = (incomes[0]?.total || 0) - (expenses[0]?.total || 0);
    
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
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// ==================== GET CASH FLOW STATEMENT ====================
exports.getCashFlowStatement = async (req, res) => {
  try {
    console.log('\n========== CASH FLOW STATEMENT DEBUG ==========');
    console.log('🔍 User ID:', req.user?._id || req.user?.id);
    
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
    
    const userId = req.user._id || req.user.id;
    const dateFilter = {
      date: { $gte: start, $lte: end },
      status: 'Posted',
      createdBy: userId
    };
    
    // Get all incomes (cash inflows)
    const incomes = await Income.find(dateFilter);
    const totalInflows = incomes.reduce((sum, inc) => sum + inc.totalAmount, 0);
    
    // Get all expenses (cash outflows)
    const expenses = await Expense.find(dateFilter);
    const totalOutflows = expenses.reduce((sum, exp) => sum + exp.totalAmount, 0);
    
    console.log('💰 Total Inflows:', totalInflows);
    console.log('💸 Total Outflows:', totalOutflows);
    
    // Categorize cash flows
    let operatingInflows = 0;
    let operatingOutflows = 0;
    let investingInflows = 0;
    let investingOutflows = 0;
    let financingInflows = 0;
    let financingOutflows = 0;
    
    const operatingIncomeTypes = ['Sales', 'Services'];
    const operatingExpenseTypes = ['Rent', 'Salaries', 'Utilities', 'Office Supplies', 'Marketing', 'Insurance', 'Maintenance', 'Software'];
    
    incomes.forEach(inc => {
      if (operatingIncomeTypes.includes(inc.incomeType)) {
        operatingInflows += inc.totalAmount;
      } else if (inc.incomeType === 'Interest Income') {
        investingInflows += inc.totalAmount;
      } else if (inc.incomeType === 'Loan Received') {
        financingInflows += inc.totalAmount;
      } else {
        operatingInflows += inc.totalAmount;
      }
    });
    
    expenses.forEach(exp => {
      if (operatingExpenseTypes.includes(exp.expenseType)) {
        operatingOutflows += exp.totalAmount;
      } else if (exp.expenseType === 'Equipment Purchase' || exp.expenseType === 'Asset Purchase') {
        investingOutflows += exp.totalAmount;
      } else if (exp.expenseType === 'Loan Payment' || exp.expenseType === 'Dividend Payment') {
        financingOutflows += exp.totalAmount;
      } else {
        operatingOutflows += exp.totalAmount;
      }
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
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};