const Income = require('../models/Income');
const Expense = require('../models/Expense');
const Invoice = require('../models/Invoice');
const BankAccount = require('../models/BankAccount');
const PaymentReceived = require('../models/PaymentReceived');
const PaymentMade = require('../models/PaymentMade');
const ChartOfAccount = require('../models/ChartOfAccount');

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
    
    // Get all incomes for current month
    const monthIncomes = await Income.find({
      date: { $gte: startOfMonth, $lte: endOfMonth },
      status: 'Posted'
    });
    
    const monthExpenses = await Expense.find({
      date: { $gte: startOfMonth, $lte: endOfMonth },
      status: 'Posted'
    });
    
    // Get all incomes for current week
    const weekIncomes = await Income.find({
      date: { $gte: startOfWeek, $lte: endOfMonth },
      status: 'Posted'
    });
    
    const weekExpenses = await Expense.find({
      date: { $gte: startOfWeek, $lte: endOfMonth },
      status: 'Posted'
    });
    
    // Get all incomes for today
    const dayIncomes = await Income.find({
      date: { $gte: startOfDay, $lte: endOfMonth },
      status: 'Posted'
    });
    
    const dayExpenses = await Expense.find({
      date: { $gte: startOfDay, $lte: endOfMonth },
      status: 'Posted'
    });
    
    // Calculate totals
    const totalRevenueMonth = monthIncomes.reduce((sum, inc) => sum + inc.totalAmount, 0);
    const totalExpensesMonth = monthExpenses.reduce((sum, exp) => sum + exp.totalAmount, 0);
    
    const totalRevenueWeek = weekIncomes.reduce((sum, inc) => sum + inc.totalAmount, 0);
    const totalExpensesWeek = weekExpenses.reduce((sum, exp) => sum + exp.totalAmount, 0);
    
    const totalRevenueDay = dayIncomes.reduce((sum, inc) => sum + inc.totalAmount, 0);
    const totalExpensesDay = dayExpenses.reduce((sum, exp) => sum + exp.totalAmount, 0);
    
    // Get outstanding invoices
    const outstandingInvoices = await Invoice.find({
      status: { $in: ['Unpaid', 'Partial', 'Overdue'] },
      outstanding: { $gt: 0 }
    });
    
    const totalOutstanding = outstandingInvoices.reduce((sum, inv) => sum + inv.outstanding, 0);
    
    // Get cash balance from bank accounts
    const bankAccounts = await BankAccount.find({ status: 'Active' });
    const cashBalance = bankAccounts.reduce((sum, acc) => sum + (acc.currentBalance || 0), 0);
    
    // Calculate percentage changes
    const lastMonthIncomes = await Income.find({
      date: {
        $gte: new Date(now.getFullYear(), now.getMonth() - 1, 1),
        $lte: new Date(now.getFullYear(), now.getMonth(), 0)
      },
      status: 'Posted'
    });
    const lastMonthRevenue = lastMonthIncomes.reduce((sum, inc) => sum + inc.totalAmount, 0);
    const revenueChange = lastMonthRevenue > 0 
      ? ((totalRevenueMonth - lastMonthRevenue) / lastMonthRevenue) * 100 
      : 0;
    
    const lastMonthExpenses = await Expense.find({
      date: {
        $gte: new Date(now.getFullYear(), now.getMonth() - 1, 1),
        $lte: new Date(now.getFullYear(), now.getMonth(), 0)
      },
      status: 'Posted'
    });
    const lastMonthExpenseTotal = lastMonthExpenses.reduce((sum, exp) => sum + exp.totalAmount, 0);
    const expenseChange = lastMonthExpenseTotal > 0 
      ? ((totalExpensesMonth - lastMonthExpenseTotal) / lastMonthExpenseTotal) * 100 
      : 0;
    
    const lastMonthOutstanding = 0; // TODO: Get last month outstanding
    const outstandingChange = lastMonthOutstanding > 0 
      ? ((totalOutstanding - lastMonthOutstanding) / lastMonthOutstanding) * 100 
      : 0;
    
    const lastMonthCash = cashBalance - totalRevenueMonth + totalExpensesMonth;
    const cashChange = lastMonthCash > 0 
      ? ((cashBalance - lastMonthCash) / lastMonthCash) * 100 
      : 0;
    
    res.status(200).json({
      success: true,
      data: {
        kpi: {
          totalRevenue: {
            amount: totalRevenueMonth,
            formatted: formatAmount(totalRevenueMonth),
            change: revenueChange,
            isPositive: revenueChange >= 0,
            period: 'This Month'
          },
          totalExpenses: {
            amount: totalExpensesMonth,
            formatted: formatAmount(totalExpensesMonth),
            change: expenseChange,
            isPositive: expenseChange <= 0,
            period: 'This Month'
          },
          outstanding: {
            amount: totalOutstanding,
            formatted: formatAmount(totalOutstanding),
            change: outstandingChange,
            isPositive: outstandingChange <= 0,
            count: outstandingInvoices.length,
            period: 'Current'
          },
          cashBalance: {
            amount: cashBalance,
            formatted: formatAmount(cashBalance),
            change: cashChange,
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
      
      const monthIncomes = await Income.find({
        date: { $gte: monthStart, $lte: monthEnd },
        status: 'Posted'
      });
      
      const monthExpenses = await Expense.find({
        date: { $gte: monthStart, $lte: monthEnd },
        status: 'Posted'
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
    let dateFilter = {};
    
    if (startDate && endDate) {
      dateFilter = {
        date: {
          $gte: new Date(startDate),
          $lte: new Date(endDate)
        },
        status: 'Posted'
      };
    } else {
      const now = new Date();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      dateFilter = {
        date: { $gte: startOfMonth },
        status: 'Posted'
      };
    }
    
    const expenses = await Expense.find(dateFilter);
    
    const categories = {};
    expenses.forEach(exp => {
      if (!categories[exp.expenseType]) {
        categories[exp.expenseType] = 0;
      }
      categories[exp.expenseType] += exp.totalAmount;
    });
    
    const categoryData = Object.entries(categories).map(([name, amount]) => ({
      name,
      amount,
      formatted: formatAmount(amount),
      percentage: 0 // Will calculate on frontend
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
    
    // Get recent payments received (income)
    const paymentsReceived = await PaymentReceived.find({ status: 'Posted' })
      .sort({ date: -1 })
      .limit(parseInt(limit))
      .populate('invoiceId', 'invoiceNumber');
    
    // Get recent payments made (expense)
    const paymentsMade = await PaymentMade.find({ status: 'Cleared' })
      .sort({ paymentDate: -1 })
      .limit(parseInt(limit))
      .populate('billId', 'billNumber');
    
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
        invoiceNumber: payment.invoiceId?.invoiceNumber
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
        billNumber: payment.billId?.billNumber
      });
    });
    
    // Sort by date descending
    transactions.sort((a, b) => b.date - a.date);
    
    res.status(200).json({
      success: true,
      data: transactions.slice(0, parseInt(limit))
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

// Helper function to format amount
function formatAmount(amount) {
  const formatter = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'PKR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  });
  return formatter.format(amount);
}