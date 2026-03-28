const Income = require('../models/Income');
const Expense = require('../models/Expense');
const ChartOfAccount = require('../models/ChartOfAccount');

// ==================== GET PROFIT & LOSS STATEMENT ====================
exports.getProfitLossStatement = async (req, res) => {
  try {
    const { startDate, endDate, period } = req.query;
    
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
          // Default to this month
          start = new Date(now.getFullYear(), now.getMonth(), 1);
          end = new Date(now);
          end.setHours(23, 59, 59, 999);
        }
    }
    
    const dateFilter = {
      date: { $gte: start, $lte: end },
      status: 'Posted'
    };
    
    // Get all incomes
    const incomes = await Income.find(dateFilter);
    const expenses = await Expense.find(dateFilter);
    
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
      
      // Identify COGS (Cost of Goods Sold)
      if (type === 'Cost of Goods Sold' || type === 'Inventory Purchase') {
        costOfGoodsSold += amount;
      } else {
        operatingExpenses += amount;
      }
    });
    
    // Calculate other income and expenses
    let otherIncome = 0;
    let otherExpenses = 0;
    
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
    console.error('Error generating P&L statement:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// ==================== GET SUMMARY (Quick Stats) ====================
exports.getSummary = async (req, res) => {
  try {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(now);
    endOfMonth.setHours(23, 59, 59, 999);
    
    const startOfYear = new Date(now.getFullYear(), 0, 1);
    const endOfYear = new Date(now);
    endOfYear.setHours(23, 59, 59, 999);
    
    // Current month
    const monthIncomes = await Income.aggregate([
      { $match: { date: { $gte: startOfMonth, $lte: endOfMonth }, status: 'Posted' } },
      { $group: { _id: null, total: { $sum: '$totalAmount' } } }
    ]);
    
    const monthExpenses = await Expense.aggregate([
      { $match: { date: { $gte: startOfMonth, $lte: endOfMonth }, status: 'Posted' } },
      { $group: { _id: null, total: { $sum: '$totalAmount' } } }
    ]);
    
    // Current year
    const yearIncomes = await Income.aggregate([
      { $match: { date: { $gte: startOfYear, $lte: endOfYear }, status: 'Posted' } },
      { $group: { _id: null, total: { $sum: '$totalAmount' } } }
    ]);
    
    const yearExpenses = await Expense.aggregate([
      { $match: { date: { $gte: startOfYear, $lte: endOfYear }, status: 'Posted' } },
      { $group: { _id: null, total: { $sum: '$totalAmount' } } }
    ]);
    
    const monthRevenue = monthIncomes[0]?.total || 0;
    const monthExpense = monthExpenses[0]?.total || 0;
    const yearRevenue = yearIncomes[0]?.total || 0;
    const yearExpense = yearExpenses[0]?.total || 0;
    
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
    console.error(error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// ==================== GET TREND DATA (Chart) ====================
exports.getTrendData = async (req, res) => {
  try {
    const { months = 12 } = req.query;
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
      
      const monthIncomes = await Income.aggregate([
        { $match: { date: { $gte: monthStart, $lte: monthEnd }, status: 'Posted' } },
        { $group: { _id: null, total: { $sum: '$totalAmount' } } }
      ]);
      
      const monthExpenses = await Expense.aggregate([
        { $match: { date: { $gte: monthStart, $lte: monthEnd }, status: 'Posted' } },
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
    
    res.status(200).json({
      success: true,
      data: monthlyData
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// Helper function
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