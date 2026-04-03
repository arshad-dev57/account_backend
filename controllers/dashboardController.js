const Income = require('../models/Income');
const Expense = require('../models/Expense');
const Invoice = require('../models/Invoice');
const BankAccount = require('../models/BankAccount');
const PaymentReceived = require('../models/PaymentReceived');
const PaymentMade = require('../models/PaymentMade');
const ChartOfAccount = require('../models/ChartOfAccount');

// ==================== HELPER FUNCTION ====================
function formatAmount(amount) {
  const formatter = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'PKR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  });
  return formatter.format(amount);
}

// ==================== GET DASHBOARD SUMMARY ====================
exports.getDashboardSummary = async (req, res) => {
  try {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(now);
    endOfMonth.setHours(23, 59, 59, 999);
    
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay());
    startOfWeek.setHours(0, 0, 0, 0);
    
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(now);
    endOfDay.setHours(23, 59, 59, 999);
    
    // ✅ Get all incomes for current month (only current user)
    const monthIncomes = await Income.find({
      date: { $gte: startOfMonth, $lte: endOfMonth },
      status: 'Posted',
      createdBy: req.user.id
    });
    
    const monthExpenses = await Expense.find({
      date: { $gte: startOfMonth, $lte: endOfMonth },
      status: 'Posted',
      createdBy: req.user.id
    });
    
    // ✅ Get all incomes for current week (only current user)
    const weekIncomes = await Income.find({
      date: { $gte: startOfWeek, $lte: endOfMonth },
      status: 'Posted',
      createdBy: req.user.id
    });
    
    const weekExpenses = await Expense.find({
      date: { $gte: startOfWeek, $lte: endOfMonth },
      status: 'Posted',
      createdBy: req.user.id
    });
    
    // ✅ Get all incomes for today (only current user)
    const dayIncomes = await Income.find({
      date: { $gte: startOfDay, $lte: endOfDay },
      status: 'Posted',
      createdBy: req.user.id
    });
    
    const dayExpenses = await Expense.find({
      date: { $gte: startOfDay, $lte: endOfDay },
      status: 'Posted',
      createdBy: req.user.id
    });
    
    // Calculate totals
    const totalRevenueMonth = monthIncomes.reduce((sum, inc) => sum + inc.totalAmount, 0);
    const totalExpensesMonth = monthExpenses.reduce((sum, exp) => sum + exp.totalAmount, 0);
    
    const totalRevenueWeek = weekIncomes.reduce((sum, inc) => sum + inc.totalAmount, 0);
    const totalExpensesWeek = weekExpenses.reduce((sum, exp) => sum + exp.totalAmount, 0);
    
    const totalRevenueDay = dayIncomes.reduce((sum, inc) => sum + inc.totalAmount, 0);
    const totalExpensesDay = dayExpenses.reduce((sum, exp) => sum + exp.totalAmount, 0);
    
    // ✅ Get outstanding invoices (only current user)
    const outstandingInvoices = await Invoice.find({
      status: { $in: ['Unpaid', 'Partial', 'Overdue'] },
      outstanding: { $gt: 0 },
      createdBy: req.user.id
    });
    
    const totalOutstanding = outstandingInvoices.reduce((sum, inv) => sum + inv.outstanding, 0);
    
    // ✅ Get cash balance from bank accounts (only current user)
    const bankAccounts = await BankAccount.find({ 
      status: 'Active',
      createdBy: req.user.id
    });
    const cashBalance = bankAccounts.reduce((sum, acc) => sum + (acc.currentBalance || 0), 0);
    
    // ✅ Calculate percentage changes with last month data (only current user)
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);
    lastMonthEnd.setHours(23, 59, 59, 999);
    
    const lastMonthIncomes = await Income.find({
      date: { $gte: lastMonthStart, $lte: lastMonthEnd },
      status: 'Posted',
      createdBy: req.user.id
    });
    const lastMonthRevenue = lastMonthIncomes.reduce((sum, inc) => sum + inc.totalAmount, 0);
    const revenueChange = lastMonthRevenue > 0 
      ? ((totalRevenueMonth - lastMonthRevenue) / lastMonthRevenue) * 100 
      : totalRevenueMonth > 0 ? 100 : 0;
    
    const lastMonthExpenses = await Expense.find({
      date: { $gte: lastMonthStart, $lte: lastMonthEnd },
      status: 'Posted',
      createdBy: req.user.id
    });
    const lastMonthExpenseTotal = lastMonthExpenses.reduce((sum, exp) => sum + exp.totalAmount, 0);
    const expenseChange = lastMonthExpenseTotal > 0 
      ? ((totalExpensesMonth - lastMonthExpenseTotal) / lastMonthExpenseTotal) * 100 
      : totalExpensesMonth > 0 ? 100 : 0;
    
    const lastMonthOutstanding = 0;
    const outstandingChange = lastMonthOutstanding > 0 
      ? ((totalOutstanding - lastMonthOutstanding) / lastMonthOutstanding) * 100 
      : totalOutstanding > 0 ? 100 : 0;
    
    const lastMonthCash = cashBalance - totalRevenueMonth + totalExpensesMonth;
    const cashChange = lastMonthCash > 0 
      ? ((cashBalance - lastMonthCash) / lastMonthCash) * 100 
      : cashBalance > 0 ? 100 : 0;
    
    res.status(200).json({
      success: true,
      data: {
        kpi: {
          totalRevenue: {
            amount: totalRevenueMonth,
            formatted: formatAmount(totalRevenueMonth),
            change: Math.round(revenueChange),
            isPositive: revenueChange >= 0,
            period: 'This Month'
          },
          totalExpenses: {
            amount: totalExpensesMonth,
            formatted: formatAmount(totalExpensesMonth),
            change: Math.round(Math.abs(expenseChange)),
            isPositive: expenseChange <= 0,
            period: 'This Month'
          },
          outstanding: {
            amount: totalOutstanding,
            formatted: formatAmount(totalOutstanding),
            change: Math.round(outstandingChange),
            isPositive: outstandingChange <= 0,
            count: outstandingInvoices.length,
            period: 'Current'
          },
          cashBalance: {
            amount: cashBalance,
            formatted: formatAmount(cashBalance),
            change: Math.round(cashChange),
            isPositive: cashChange >= 0,
            period: 'Current'
          }
        },
        weeklyData: {
          revenue: totalRevenueWeek,
          expenses: totalExpensesWeek,
          profit: totalRevenueWeek - totalExpensesWeek
        },
        dailyData: {
          revenue: totalRevenueDay,
          expenses: totalExpensesDay,
          profit: totalRevenueDay - totalExpensesDay
        }
      }
    });
  } catch (error) {
    console.error('Error getting dashboard summary:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// ==================== GET CHART DATA ====================
exports.getChartData = async (req, res) => {
  try {
    const { months = 12 } = req.query;
    const now = new Date();
    const startDate = new Date(now);
    startDate.setMonth(now.getMonth() - parseInt(months));
    
    const chartData = [];
    
    for (let i = 0; i <= parseInt(months); i++) {
      const date = new Date(startDate);
      date.setMonth(startDate.getMonth() + i);
      const monthStart = new Date(date.getFullYear(), date.getMonth(), 1);
      const monthEnd = new Date(date.getFullYear(), date.getMonth() + 1, 0);
      monthEnd.setHours(23, 59, 59, 999);
      
      // ✅ Only get current user's data
      const monthIncomes = await Income.find({
        date: { $gte: monthStart, $lte: monthEnd },
        status: 'Posted',
        createdBy: req.user.id
      });
      
      const monthExpenses = await Expense.find({
        date: { $gte: monthStart, $lte: monthEnd },
        status: 'Posted',
        createdBy: req.user.id
      });
      
      const revenue = monthIncomes.reduce((sum, inc) => sum + inc.totalAmount, 0);
      const expenses = monthExpenses.reduce((sum, exp) => sum + exp.totalAmount, 0);
      
      chartData.push({
        month: date.toLocaleString('default', { month: 'short', year: 'numeric' }),
        revenue: revenue,
        expenses: expenses,
        profit: revenue - expenses
      });
    }
    
    res.status(200).json({
      success: true,
      data: chartData
    });
  } catch (error) {
    console.error('Error getting chart data:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// ==================== GET EXPENSE CATEGORIES ====================
exports.getExpenseCategories = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    let dateFilter = {
      status: 'Posted',
      createdBy: req.user.id  // ✅ Only current user
    };
    
    if (startDate && endDate) {
      dateFilter.date = {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      };
    } else {
      const now = new Date();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      dateFilter.date = { $gte: startOfMonth };
    }
    
    const expenses = await Expense.find(dateFilter);
    
    const categories = {};
    let totalAmount = 0;
    
    expenses.forEach(exp => {
      if (!categories[exp.expenseType]) {
        categories[exp.expenseType] = 0;
      }
      categories[exp.expenseType] += exp.totalAmount;
      totalAmount += exp.totalAmount;
    });
    
    const categoryData = Object.entries(categories).map(([name, amount]) => ({
      name,
      amount,
      formatted: formatAmount(amount),
      percentage: totalAmount > 0 ? (amount / totalAmount) * 100 : 0
    }));
    
    // Sort by amount descending
    categoryData.sort((a, b) => b.amount - a.amount);
    
    res.status(200).json({
      success: true,
      data: categoryData
    });
  } catch (error) {
    console.error('Error getting expense categories:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// ==================== GET RECENT TRANSACTIONS ====================
exports.getRecentTransactions = async (req, res) => {
  try {
    const { limit = 10 } = req.query;
    const limitNum = parseInt(limit);
    
    // ✅ Get recent payments received (only current user)
    const paymentsReceived = await PaymentReceived.find({ 
      createdBy: req.user.id,
      status: 'Posted'
    })
      .sort({ paymentDate: -1 })
      .limit(limitNum)
      .populate('invoiceId', 'invoiceNumber');
    
    // ✅ Get recent payments made (only current user)
    const paymentsMade = await PaymentMade.find({ 
      createdBy: req.user.id,
      status: 'Cleared'
    })
      .sort({ paymentDate: -1 })
      .limit(limitNum)
      .populate('billId', 'billNumber');
    
    // ✅ Get recent incomes (only current user)
    const recentIncomes = await Income.find({ 
      createdBy: req.user.id,
      status: 'Posted'
    })
      .sort({ date: -1 })
      .limit(limitNum);
    
    // ✅ Get recent expenses (only current user)
    const recentExpenses = await Expense.find({ 
      createdBy: req.user.id,
      status: 'Posted'
    })
      .sort({ date: -1 })
      .limit(limitNum);
    
    // Combine and sort
    const transactions = [];
    
    paymentsReceived.forEach(payment => {
      transactions.push({
        id: payment._id,
        title: payment.reference || `Payment from ${payment.customerName}`,
        amount: payment.amount,
        date: payment.paymentDate,
        type: 'income',
        icon: 'payment',
        reference: payment.reference,
        invoiceNumber: payment.invoiceId?.invoiceNumber,
        source: 'payment_received'
      });
    });
    
    paymentsMade.forEach(payment => {
      transactions.push({
        id: payment._id,
        title: payment.reference || `Payment to ${payment.vendorName}`,
        amount: payment.amount,
        date: payment.paymentDate,
        type: 'expense',
        icon: 'shopping_bag',
        reference: payment.reference,
        billNumber: payment.billId?.billNumber,
        source: 'payment_made'
      });
    });
    
    recentIncomes.forEach(income => {
      transactions.push({
        id: income._id,
        title: income.description || `${income.incomeType} - ${income.incomeNumber}`,
        amount: income.totalAmount,
        date: income.date,
        type: 'income',
        icon: 'trending_up',
        reference: income.reference,
        source: 'income'
      });
    });
    
    recentExpenses.forEach(expense => {
      transactions.push({
        id: expense._id,
        title: expense.description || `${expense.expenseType} - ${expense.expenseNumber}`,
        amount: expense.totalAmount,
        date: expense.date,
        type: 'expense',
        icon: 'trending_down',
        reference: expense.reference,
        source: 'expense'
      });
    });
    
    // Sort by date descending
    transactions.sort((a, b) => new Date(b.date) - new Date(a.date));
    
    res.status(200).json({
      success: true,
      data: transactions.slice(0, limitNum)
    });
  } catch (error) {
    console.error('Error getting recent transactions:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// ==================== GET QUICK ACTIONS ====================
exports.getQuickActions = async (req, res) => {
  try {
    const quickActions = [
      {
        id: 'add_income',
        label: 'Income',
        icon: 'add_circle_outline',
        color: '#2ECC71',
        route: '/income'
      },
      {
        id: 'add_expense',
        label: 'Expense',
        icon: 'remove_circle_outline',
        color: '#E74C3C',
        route: '/expense'
      },
      {
        id: 'create_invoice',
        label: 'Invoice',
        icon: 'receipt_long',
        color: '#3498DB',
        route: '/invoices'
      },
      {
        id: 'record_payment',
        label: 'Payment',
        icon: 'payment',
        color: '#F39C12',
        route: '/payments'
      },
      {
        id: 'add_customer',
        label: 'Customer',
        icon: 'person_add',
        color: '#9B59B6',
        route: '/customers'
      }
    ];
    
    res.status(200).json({
      success: true,
      data: quickActions
    });
  } catch (error) {
    console.error('Error getting quick actions:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// ==================== GET YEARLY SUMMARY ====================
exports.getYearlySummary = async (req, res) => {
  try {
    const { year = new Date().getFullYear() } = req.query;
    const startDate = new Date(year, 0, 1);
    const endDate = new Date(year, 11, 31);
    endDate.setHours(23, 59, 59, 999);
    
    const monthlyData = [];
    
    for (let month = 0; month < 12; month++) {
      const monthStart = new Date(year, month, 1);
      const monthEnd = new Date(year, month + 1, 0);
      monthEnd.setHours(23, 59, 59, 999);
      
      const monthIncomes = await Income.find({
        date: { $gte: monthStart, $lte: monthEnd },
        status: 'Posted',
        createdBy: req.user.id
      });
      
      const monthExpenses = await Expense.find({
        date: { $gte: monthStart, $lte: monthEnd },
        status: 'Posted',
        createdBy: req.user.id
      });
      
      const revenue = monthIncomes.reduce((sum, inc) => sum + inc.totalAmount, 0);
      const expenses = monthExpenses.reduce((sum, exp) => sum + exp.totalAmount, 0);
      
      monthlyData.push({
        month: monthStart.toLocaleString('default', { month: 'long' }),
        revenue,
        expenses,
        profit: revenue - expenses
      });
    }
    
    const totalRevenue = monthlyData.reduce((sum, m) => sum + m.revenue, 0);
    const totalExpenses = monthlyData.reduce((sum, m) => sum + m.expenses, 0);
    const totalProfit = totalRevenue - totalExpenses;
    
    res.status(200).json({
      success: true,
      data: {
        year: parseInt(year),
        totalRevenue,
        totalExpenses,
        totalProfit,
        monthlyData
      }
    });
  } catch (error) {
    console.error('Error getting yearly summary:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};