
const prisma = require('../prisma/client');
const { get, set } = require('../utils/redisClient');


function formatAmount(amount) {
  const formatter = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  });
  return formatter.format(amount);
}

function groupByMonth(docs, amountField = 'totalAmount') {
  const map = {
  };
  docs.forEach(doc => {
    const d = new Date(doc.date);
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    map[key] = (map[key] || 0) + (doc[amountField] || 0);
  });
  return map;
}

function inRange(doc, from, to) {
  const d = new Date(doc.date);
  return d >= from && d <= to;
}

function sum(arr, field = 'totalAmount') {
  return arr.reduce((s, d) => s + (d[field] || 0), 0);
}

function pct(current, previous) {
  if (previous === 0) return current > 0 ? 100 : 0;
  return ((current - previous) / previous) * 100;
}

function getDateRangeFromTimePeriod(timePeriod) {
  const now = new Date();
  const endOfDay = new Date(now);
  endOfDay.setHours(23, 59, 59, 999);
  
  switch (timePeriod) {
    case 'Today':
      return {
        start: new Date(now.getFullYear(), now.getMonth(), now.getDate()),
        end: endOfDay
      };
    
    case 'Last Week':
      const startOfWeek = new Date(now);
      startOfWeek.setDate(now.getDate() - now.getDay() - 7);
      startOfWeek.setHours(0, 0, 0, 0);
      const endOfLastWeek = new Date(startOfWeek);
      endOfLastWeek.setDate(startOfWeek.getDate() + 6);
      endOfLastWeek.setHours(23, 59, 59, 999);
      return { start: startOfWeek, end: endOfLastWeek };
    
    case 'This Month':
      return {
        start: new Date(now.getFullYear(), now.getMonth(), 1),
        end: new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999)
      };
    
    case 'Last Month':
      return {
        start: new Date(now.getFullYear(), now.getMonth() - 1, 1),
        end: new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999)
      };
    
    case 'This Quarter':
      const quarterStartMonth = Math.floor(now.getMonth() / 3) * 3;
      return {
        start: new Date(now.getFullYear(), quarterStartMonth, 1),
        end: new Date(now.getFullYear(), quarterStartMonth + 3, 0, 23, 59, 59, 999)
      };
    
    case 'This Year':
      return {
        start: new Date(now.getFullYear(), 0, 1),
        end: new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999)
      };
    
    case 'Custom':
      // For custom, default to this month (should be handled with custom date picker in UI)
      return {
        start: new Date(now.getFullYear(), now.getMonth(), 1),
        end: new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999)
      };
    
    default:
      // Default to this month
      return {
        start: new Date(now.getFullYear(), now.getMonth(), 1),
        end: new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999)
      };
  }
}


const getDashboardSummary = async (req, res) => {
  try {
    const userId = req.user.id;
    const companyId = req.user.companyId;
    const { timePeriod = 'This Month' } = req.query;
    const now = new Date();

    const cacheKey = `dashboard:summary:${userId}:${timePeriod}`;
    
    const cached = await get(cacheKey);
    if (cached) {
      return res.status(200).json({
        success: true,
        data: cached,
        cached: true,
      });
    }

    const { start: startDate, end: endDate } = getDateRangeFromTimePeriod(timePeriod);

    // Calculate previous period for comparison
    const periodLength = endDate - startDate;
    const previousStartDate = new Date(startDate - periodLength);
    const previousEndDate = new Date(endDate - periodLength);

    // ─── FETCH ALL DATA (User-specific) ──────────────────────────
    const [
      allIncomes,
      allInvoices,
      allCreditNotes,
      allExpenses,
      allBills,
      outstandingInvoices,
      bankAccounts
    ] = await Promise.all([
      // ✅ Income
      prisma.income.findMany({
        where: {
          
          companyId: companyId,
          date: { gte: previousStartDate, lte: endDate },
          status: 'Posted'
        },
        select: { date: true, amount: true }
      }),
      // ✅ WarehouseInvoice (NOT Invoice)
      prisma.warehouseInvoice.findMany({
        where: {
          
          companyId: companyId,
          invoiceDate: { gte: previousStartDate, lte: endDate },
          invoiceStatus: { not: 'Draft' }
        },
        select: { invoiceDate: true, grandTotal: true }
      }),
      // ✅ CreditNote
      prisma.creditNote.findMany({
        where: {
          
          companyId: companyId,
          date: { gte: previousStartDate, lte: endDate }
        },
        select: { date: true, amount: true }
      }),
      // ✅ Expense
      prisma.expense.findMany({
        where: {
          
          companyId: companyId,
          date: { gte: previousStartDate, lte: endDate },
          status: 'Posted'
        },
        select: { date: true, amount: true }
      }),
      // ✅ Bill
      prisma.bill.findMany({
        where: {
          
          companyId: companyId,
          date: { gte: previousStartDate, lte: endDate }
        },
        select: { date: true, totalAmount: true }
      }),
      // ✅ Outstanding Invoices (WarehouseInvoice)
      prisma.warehouseInvoice.findMany({
        where: {
          
          companyId: companyId,
          paymentStatus: { in: ['Unpaid', 'Partial'] },
          outstanding: { gt: 0 }
        },
        select: { outstanding: true }
      }),
      // ✅ BankAccount
      prisma.bankAccount.findMany({
        where: {
          
          companyId: companyId,
          status: 'Active'
        },
        select: { currentBalance: true }
      })
    ]);

    // ─── MAP DATA ──────────────────────────────────────────────────
    // Map invoiceDate to date for consistency
    const mappedInvoices = allInvoices.map(inv => ({
      date: inv.invoiceDate,
      totalAmount: inv.grandTotal
    }));

    // ─── FILTER IN JS ─────────────────────────────────────────────
    const currentInc = allIncomes.filter(d => inRange({ date: d.date }, startDate, endDate));
    const currentInv = mappedInvoices.filter(d => inRange(d, startDate, endDate));
    const currentCN = allCreditNotes.filter(d => inRange({ date: d.date }, startDate, endDate));
    const currentExp = allExpenses.filter(d => inRange({ date: d.date }, startDate, endDate));
    const currentBill = allBills.filter(d => inRange({ date: d.date }, startDate, endDate));

    const totalRevenueCurrent = sum(currentInc, 'amount') + sum(currentInv, 'totalAmount') - sum(currentCN, 'amount');
    const totalExpensesCurrent = sum(currentExp, 'amount') + sum(currentBill, 'totalAmount');

    // ─── PREVIOUS PERIOD ──────────────────────────────────────────
    const previousInc = allIncomes.filter(d => inRange({ date: d.date }, previousStartDate, previousEndDate));
    const previousInv = mappedInvoices.filter(d => inRange(d, previousStartDate, previousEndDate));
    const previousCN = allCreditNotes.filter(d => inRange({ date: d.date }, previousStartDate, previousEndDate));
    const previousExp = allExpenses.filter(d => inRange({ date: d.date }, previousStartDate, previousEndDate));
    const previousBill = allBills.filter(d => inRange({ date: d.date }, previousStartDate, previousEndDate));

    const previousRevenue = sum(previousInc, 'amount') + sum(previousInv, 'totalAmount') - sum(previousCN, 'amount');
    const previousExpenses = sum(previousExp, 'amount') + sum(previousBill, 'totalAmount');

    // ─── KPIs ──────────────────────────────────────────────────────
    const totalOutstanding = outstandingInvoices.reduce((s, inv) => s + inv.outstanding, 0);
    const cashBalance = bankAccounts.reduce((s, acc) => s + (acc.currentBalance || 0), 0);

    const revenueChange = pct(totalRevenueCurrent, previousRevenue);
    const expenseChange = pct(totalExpensesCurrent, previousExpenses);
    const lastMonthCash = cashBalance - totalRevenueCurrent + totalExpensesCurrent;
    const cashChange = pct(cashBalance, lastMonthCash);

    const summaryData = {
      kpi: {
        totalRevenue: {
          amount: totalRevenueCurrent,
          formatted: formatAmount(totalRevenueCurrent),
          change: Math.round(revenueChange),
          isPositive: revenueChange >= 0,
          period: timePeriod
        },
        totalExpenses: {
          amount: totalExpensesCurrent,
          formatted: formatAmount(totalExpensesCurrent),
          change: Math.round(Math.abs(expenseChange)),
          isPositive: expenseChange <= 0,
          period: timePeriod
        },
        outstanding: {
          amount: totalOutstanding,
          formatted: formatAmount(totalOutstanding),
          change: 0,
          isPositive: true,
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
        revenue: totalRevenueCurrent,
        expenses: totalExpensesCurrent,
        profit: totalRevenueCurrent - totalExpensesCurrent
      },
      dailyData: {
        revenue: totalRevenueCurrent,
        expenses: totalExpensesCurrent,
        profit: totalRevenueCurrent - totalExpensesCurrent
      }
    };

    // Cache the result (1 minute TTL - dashboard data changes frequently)
    await set(cacheKey, summaryData, 60);

    res.status(200).json({
      success: true,
      data: summaryData,
      cached: false,
    });
  } catch (error) {
    console.error('Error getting dashboard summary:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ─── Get Chart Data ────────────────────────────────────────────

const getChartData = async (req, res) => {
  try {
    const { months = 12, timePeriod = 'This Month' } = req.query;
    const userId = req.user.id;
    const companyId = req.user.companyId;
    const now = new Date();

    // Build cache key with parameters
    const cacheKey = `dashboard:chart:${userId}:${months}:${timePeriod}`;
    
    // Try to get from cache
    const cached = await get(cacheKey);
    if (cached) {
      return res.status(200).json({
        success: true,
        data: cached,
        cached: true,
      });
    }

    // Get date range from time period
    const { start: startDate, end: endDate } = getDateRangeFromTimePeriod(timePeriod);

    const [incomes, invoices, creditNotes, expenses, bills] = await Promise.all([
      prisma.income.findMany({
        where: {
          companyId: companyId,
          date: { gte: startDate, lte: endDate },
          status: 'Posted'
        },
        select: { date: true, amount: true }
      }),
      prisma.warehouseInvoice.findMany({
        where: {
          companyId: companyId,
          invoiceDate: { gte: startDate, lte: endDate },
          invoiceStatus: { not: 'Draft' }
        },
        select: { invoiceDate: true, grandTotal: true }
      }),
      prisma.creditNote.findMany({
        where: {
          companyId: companyId,
          date: { gte: startDate, lte: endDate }
        },
        select: { date: true, amount: true }
      }),
      prisma.expense.findMany({
        where: {
          companyId: companyId,
          date: { gte: startDate, lte: endDate },
          status: 'Posted'
        },
        select: { date: true, amount: true }
      }),
      prisma.bill.findMany({
        where: {
          companyId: companyId,
          date: { gte: startDate, lte: endDate }
        },
        select: { date: true, totalAmount: true }
      })
    ]);

    // Map invoices
    const mappedInvoices = invoices.map(inv => ({
      date: inv.invoiceDate,
      totalAmount: inv.grandTotal
    }));

    const incMap = groupByMonth(incomes, 'amount');
    const invMap = groupByMonth(mappedInvoices, 'totalAmount');
    const cnMap = groupByMonth(creditNotes, 'amount');
    const expMap = groupByMonth(expenses, 'amount');
    const billMap = groupByMonth(bills, 'totalAmount');

    const chartData = [];
    for (let i = 0; i <= parseInt(months); i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - parseInt(months) + i, 1);
      const key = `${d.getFullYear()}-${d.getMonth()}`;
      const revenue = (incMap[key] || 0) + (invMap[key] || 0) - (cnMap[key] || 0);
      const expensesTotal = (expMap[key] || 0) + (billMap[key] || 0);
      chartData.push({
        month: d.toLocaleString('default', { month: 'short', year: 'numeric' }),
        revenue,
        expenses: expensesTotal,
        profit: revenue - expensesTotal
      });
    }

    // Cache the result (5 minutes TTL)
    await set(cacheKey, chartData, 300);

    res.status(200).json({
      success: true,
      data: chartData,
      cached: false,
    });
  } catch (error) {
    console.error('Error getting chart data:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ─── Get Expense Categories ────────────────────────────────────

const getExpenseCategories = async (req, res) => {
  try {
    const { timePeriod = 'This Month' } = req.query;
    const userId = req.user.id;

    const companyId = req.user.companyId;
    // Build cache key with parameters
    const cacheKey = `dashboard:expense-categories:${userId}:${timePeriod}`;
    
    // Try to get from cache
    const cached = await get(cacheKey);
    if (cached) {
      return res.status(200).json({
        success: true,
        data: cached,
        cached: true,
      });
    }

    // Get date range from time period
    const { start: startDate, end: endDate } = getDateRangeFromTimePeriod(timePeriod);

    const [expenses, bills] = await Promise.all([
      prisma.expense.findMany({
        where: {
          companyId: companyId,
          date: { gte: startDate, lte: endDate },
          status: 'Posted'
        },
        select: { expenseType: true, amount: true }
      }),
      prisma.bill.findMany({
        where: {
          companyId: companyId,
          date: { gte: startDate, lte: endDate }
        },
        select: { totalAmount: true }
      })
    ]);

    const categories = {};
    let totalAmount = 0;

    expenses.forEach(exp => {
      const type = exp.expenseType || 'Other';
      categories[type] = (categories[type] || 0) + exp.amount;
      totalAmount += exp.amount;
    });
    bills.forEach(bill => {
      categories['Purchases (Bills)'] = (categories['Purchases (Bills)'] || 0) + bill.totalAmount;
      totalAmount += bill.totalAmount;
    });

    const categoryData = Object.entries(categories)
      .map(([name, amount]) => ({
        name,
        amount,
        formatted: formatAmount(amount),
        percentage: totalAmount > 0 ? (amount / totalAmount) * 100 : 0
      }))
      .sort((a, b) => b.amount - a.amount);

    // Cache the result (5 minutes TTL)
    await set(cacheKey, categoryData, 300);

    res.status(200).json({
      success: true,
      data: categoryData,
      cached: false,
    });
  } catch (error) {
    console.error('Error getting expense categories:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ─── Get Recent Transactions ───────────────────────────────────

const getRecentTransactions = async (req, res) => {
  try {
    const { limit = 10 } = req.query;
    const limitNum = parseInt(limit);
    const userId = req.user.id;

    const companyId = req.user.companyId;
    // Build cache key with parameters
    const cacheKey = `dashboard:recent-transactions:${userId}:${limit}`;
    
    // Try to get from cache
    const cached = await get(cacheKey);
    if (cached) {
      return res.status(200).json({
        success: true,
        data: cached,
        cached: true,
      });
    }

    const [paymentsReceived, incomes, expenses, invoices, bills] = await Promise.all([
      prisma.paymentReceived.findMany({
        where: { companyId: companyId},
        orderBy: { paymentDate: 'desc' },
        take: limitNum,
        select: {
          id: true,
          reference: true,
          customerName: true,
          amount: true,
          paymentDate: true,
          invoiceNumber: true
        }
      }),
      prisma.income.findMany({
        where: { companyId: companyId, status: 'Posted' },
        orderBy: { date: 'desc' },
        take: limitNum,
        select: {
          id: true,
          description: true,
          incomeType: true,
          incomeNumber: true,
          amount: true,
          date: true,
          reference: true
        }
      }),
      prisma.expense.findMany({
        where: { companyId: companyId, status: 'Posted' },
        orderBy: { date: 'desc' },
        take: limitNum,
        select: {
          id: true,
          description: true,
          expenseType: true,
          expenseNumber: true,
          amount: true,
          date: true,
          reference: true
        }
      }),
      prisma.warehouseInvoice.findMany({
        where: { companyId: companyId, invoiceStatus: { not: 'Draft' } },
        orderBy: { invoiceDate: 'desc' },
        take: limitNum,
        select: {
          id: true,
          invoiceNumber: true,
          customerName: true,
          grandTotal: true,
          invoiceDate: true
        }
      }),
      prisma.bill.findMany({
        where: { companyId: companyId},
        orderBy: { date: 'desc' },
        take: limitNum,
        select: {
          id: true,
          billNumber: true,
          vendorName: true,
          totalAmount: true,
          date: true
        }
      })
    ]);

    const transactions = [];

    paymentsReceived.forEach(p => {
      transactions.push({
        id: p.id,
        title: p.reference || `Payment from ${p.customerName}`,
        amount: p.amount,
        date: p.paymentDate,
        type: 'income',
        icon: 'payment',
        reference: p.reference,
        invoiceNumber: p.invoiceNumber,
        source: 'payment_received'
      });
    });

    incomes.forEach(inc => {
      transactions.push({
        id: inc.id,
        title: inc.description || `${inc.incomeType} - ${inc.incomeNumber}`,
        amount: inc.amount,
        date: inc.date,
        type: 'income',
        icon: 'trending_up',
        reference: inc.reference,
        source: 'income'
      });
    });

    expenses.forEach(exp => {
      transactions.push({
        id: exp.id,
        title: exp.description || `${exp.expenseType} - ${exp.expenseNumber}`,
        amount: exp.amount,
        date: exp.date,
        type: 'expense',
        icon: 'trending_down',
        reference: exp.reference,
        source: 'expense'
      });
    });

    invoices.forEach(inv => {
      transactions.push({
        id: inv.id,
        title: `Invoice to ${inv.customerName}`,
        amount: inv.grandTotal,
        date: inv.invoiceDate,
        type: 'income',
        icon: 'receipt_long',
        reference: inv.invoiceNumber,
        source: 'warehouse_invoice'
      });
    });

    bills.forEach(bill => {
      transactions.push({
        id: bill.id,
        title: `Bill from ${bill.vendorName}`,
        amount: bill.totalAmount,
        date: bill.date,
        type: 'expense',
        icon: 'receipt',
        reference: bill.billNumber,
        source: 'bill'
      });
    });

    transactions.sort((a, b) => new Date(b.date) - new Date(a.date));

    const recentTransactions = transactions.slice(0, limitNum);

    // Cache the result (2 minutes TTL - transactions change frequently)
    await set(cacheKey, recentTransactions, 120);

    res.status(200).json({
      success: true,
      data: recentTransactions,
      cached: false,
    });
  } catch (error) {
    console.error('Error getting recent transactions:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ─── Get Quick Actions ────────────────────────────────────────

const getQuickActions = async (req, res) => {
  res.status(200).json({
    success: true,
    data: [
      { id: 'add_income', label: 'Income', icon: 'add_circle_outline', color: '#2ECC71', route: '/income' },
      { id: 'add_expense', label: 'Expense', icon: 'remove_circle_outline', color: '#E74C3C', route: '/expense' },
      { id: 'create_invoice', label: 'Invoice', icon: 'receipt_long', color: '#3498DB', route: '/invoices' },
      { id: 'record_payment', label: 'Payment', icon: 'payment', color: '#F39C12', route: '/payments' },
      { id: 'add_customer', label: 'Customer', icon: 'person_add', color: '#9B59B6', route: '/customers' }
    ]
  });
};

// ─── Get Yearly Summary ───────────────────────────────────────

const getYearlySummary = async (req, res) => {
  try {
    const { year = new Date().getFullYear() } = req.query;
    const userId = req.user.id;
    const companyId = req.user.companyId;
    const startDate = new Date(year, 0, 1);
    const endDate = new Date(year, 11, 31);
    endDate.setHours(23, 59, 59, 999);

    // Build cache key with parameters
    const cacheKey = `dashboard:yearly-summary:${userId}:${year}`;
    
    // Try to get from cache
    const cached = await get(cacheKey);
    if (cached) {
      return res.status(200).json({
        success: true,
        data: cached,
        cached: true,
      });
    }

    const [incomes, invoices, creditNotes, expenses, bills] = await Promise.all([
      prisma.income.findMany({
        where: {
          companyId: companyId,
          date: { gte: startDate, lte: endDate },
          status: 'Posted'
        },
        select: { date: true, amount: true }
      }),
      prisma.warehouseInvoice.findMany({
        where: {
          companyId: companyId,
          invoiceDate: { gte: startDate, lte: endDate },
          invoiceStatus: { not: 'Draft' }
        },
        select: { invoiceDate: true, grandTotal: true }
      }),
      prisma.creditNote.findMany({
        where: {
          companyId: companyId,
          date: { gte: startDate, lte: endDate }
        },
        select: { date: true, amount: true }
      }),
      prisma.expense.findMany({
        where: {
          companyId: companyId,
          date: { gte: startDate, lte: endDate },
          status: 'Posted'
        },
        select: { date: true, amount: true }
      }),
      prisma.bill.findMany({
        where: {
          companyId: companyId,
          date: { gte: startDate, lte: endDate }
        },
        select: { date: true, totalAmount: true }
      })
    ]);

    const mappedInvoices = invoices.map(inv => ({
      date: inv.invoiceDate,
      totalAmount: inv.grandTotal
    }));

    const incMap = groupByMonth(incomes, 'amount');
    const invMap = groupByMonth(mappedInvoices, 'totalAmount');
    const cnMap = groupByMonth(creditNotes, 'amount');
    const expMap = groupByMonth(expenses, 'amount');
    const billMap = groupByMonth(bills, 'totalAmount');

    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'
    ];

    const monthlyData = monthNames.map((name, m) => {
      const key = `${year}-${m}`;
      const revenue = (incMap[key] || 0) + (invMap[key] || 0) - (cnMap[key] || 0);
      const expensesTotal = (expMap[key] || 0) + (billMap[key] || 0);
      return { month: name, revenue, expenses: expensesTotal, profit: revenue - expensesTotal };
    });

    const totalRevenue = monthlyData.reduce((s, m) => s + m.revenue, 0);
    const totalExpenses = monthlyData.reduce((s, m) => s + m.expenses, 0);

    const summaryData = {
      year: parseInt(year),
      totalRevenue,
      totalExpenses,
      totalProfit: totalRevenue - totalExpenses,
      monthlyData
    };

    await set(cacheKey, summaryData, 600);

    res.status(200).json({
      success: true,
      data: summaryData,
      cached: false,
    });
  } catch (error) {
    console.error('Error getting yearly summary:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};


module.exports = {
  getDashboardSummary,
  getChartData,
  getExpenseCategories,
  getRecentTransactions,
  getQuickActions,
  getYearlySummary
};