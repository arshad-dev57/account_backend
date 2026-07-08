// controllers/dashboardController.js - FIXED (Prisma Version)

const prisma = require('../prisma/client');

// ─── Helper Functions ──────────────────────────────────────────

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
  const map = {};
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

// ─── Get Dashboard Summary ─────────────────────────────────────

const getDashboardSummary = async (req, res) => {
  try {
    const userId = req.user.id;
    const now = new Date();

    // Date boundaries
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay());
    startOfWeek.setHours(0, 0, 0, 0);
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endOfDay = new Date(now);
    endOfDay.setHours(23, 59, 59, 999);
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);
    lastMonthEnd.setHours(23, 59, 59, 999);

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
          userId: userId,
          date: { gte: lastMonthStart, lte: endOfDay },
          status: 'Posted'
        },
        select: { date: true, amount: true }
      }),
      // ✅ WarehouseInvoice (NOT Invoice)
      prisma.warehouseInvoice.findMany({
        where: {
          userId: userId,
          invoiceDate: { gte: lastMonthStart, lte: endOfDay },
          invoiceStatus: { not: 'Draft' }
        },
        select: { invoiceDate: true, grandTotal: true }
      }),
      // ✅ CreditNote
      prisma.creditNote.findMany({
        where: {
          userId: userId,
          date: { gte: lastMonthStart, lte: endOfDay }
        },
        select: { date: true, amount: true }
      }),
      // ✅ Expense
      prisma.expense.findMany({
        where: {
          userId: userId,
          date: { gte: lastMonthStart, lte: endOfDay },
          status: 'Posted'
        },
        select: { date: true, amount: true }
      }),
      // ✅ Bill
      prisma.bill.findMany({
        where: {
          userId: userId,
          date: { gte: lastMonthStart, lte: endOfDay }
        },
        select: { date: true, totalAmount: true }
      }),
      // ✅ Outstanding Invoices (WarehouseInvoice)
      prisma.warehouseInvoice.findMany({
        where: {
          userId: userId,
          paymentStatus: { in: ['Unpaid', 'Partial'] },
          outstanding: { gt: 0 }
        },
        select: { outstanding: true }
      }),
      // ✅ BankAccount
      prisma.bankAccount.findMany({
        where: {
          userId: userId,
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
    const mInc = allIncomes.filter(d => inRange({ date: d.date }, startOfMonth, endOfDay));
    const mInv = mappedInvoices.filter(d => inRange(d, startOfMonth, endOfDay));
    const mCN = allCreditNotes.filter(d => inRange({ date: d.date }, startOfMonth, endOfDay));
    const mExp = allExpenses.filter(d => inRange({ date: d.date }, startOfMonth, endOfDay));
    const mBill = allBills.filter(d => inRange({ date: d.date }, startOfMonth, endOfDay));

    const totalRevenueMonth = sum(mInc, 'amount') + sum(mInv, 'totalAmount') - sum(mCN, 'amount');
    const totalExpensesMonth = sum(mExp, 'amount') + sum(mBill, 'totalAmount');

    // ─── WEEK ──────────────────────────────────────────────────────
    const wInc = allIncomes.filter(d => inRange({ date: d.date }, startOfWeek, endOfDay));
    const wInv = mappedInvoices.filter(d => inRange(d, startOfWeek, endOfDay));
    const wCN = allCreditNotes.filter(d => inRange({ date: d.date }, startOfWeek, endOfDay));
    const wExp = allExpenses.filter(d => inRange({ date: d.date }, startOfWeek, endOfDay));
    const wBill = allBills.filter(d => inRange({ date: d.date }, startOfWeek, endOfDay));

    const totalRevenueWeek = sum(wInc, 'amount') + sum(wInv, 'totalAmount') - sum(wCN, 'amount');
    const totalExpensesWeek = sum(wExp, 'amount') + sum(wBill, 'totalAmount');

    // ─── DAY ──────────────────────────────────────────────────────
    const dInc = allIncomes.filter(d => inRange({ date: d.date }, startOfDay, endOfDay));
    const dInv = mappedInvoices.filter(d => inRange(d, startOfDay, endOfDay));
    const dCN = allCreditNotes.filter(d => inRange({ date: d.date }, startOfDay, endOfDay));
    const dExp = allExpenses.filter(d => inRange({ date: d.date }, startOfDay, endOfDay));
    const dBill = allBills.filter(d => inRange({ date: d.date }, startOfDay, endOfDay));

    const totalRevenueDay = sum(dInc, 'amount') + sum(dInv, 'totalAmount') - sum(dCN, 'amount');
    const totalExpensesDay = sum(dExp, 'amount') + sum(dBill, 'totalAmount');

    // ─── LAST MONTH ──────────────────────────────────────────────
    const lInc = allIncomes.filter(d => inRange({ date: d.date }, lastMonthStart, lastMonthEnd));
    const lInv = mappedInvoices.filter(d => inRange(d, lastMonthStart, lastMonthEnd));
    const lCN = allCreditNotes.filter(d => inRange({ date: d.date }, lastMonthStart, lastMonthEnd));
    const lExp = allExpenses.filter(d => inRange({ date: d.date }, lastMonthStart, lastMonthEnd));
    const lBill = allBills.filter(d => inRange({ date: d.date }, lastMonthStart, lastMonthEnd));

    const lastMonthRevenue = sum(lInc, 'amount') + sum(lInv, 'totalAmount') - sum(lCN, 'amount');
    const lastMonthExpenses = sum(lExp, 'amount') + sum(lBill, 'totalAmount');

    // ─── KPIs ──────────────────────────────────────────────────────
    const totalOutstanding = outstandingInvoices.reduce((s, inv) => s + inv.outstanding, 0);
    const cashBalance = bankAccounts.reduce((s, acc) => s + (acc.currentBalance || 0), 0);

    const revenueChange = pct(totalRevenueMonth, lastMonthRevenue);
    const expenseChange = pct(totalExpensesMonth, lastMonthExpenses);
    const lastMonthCash = cashBalance - totalRevenueMonth + totalExpensesMonth;
    const cashChange = pct(cashBalance, lastMonthCash);

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
    res.status(500).json({ success: false, message: error.message });
  }
};

// ─── Get Chart Data ────────────────────────────────────────────

const getChartData = async (req, res) => {
  try {
    const { months = 12 } = req.query;
    const userId = req.user.id;
    const now = new Date();
    const startDate = new Date(now.getFullYear(), now.getMonth() - parseInt(months), 1);
    const endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    endDate.setHours(23, 59, 59, 999);

    const [incomes, invoices, creditNotes, expenses, bills] = await Promise.all([
      prisma.income.findMany({
        where: {
          userId: userId,
          date: { gte: startDate, lte: endDate },
          status: 'Posted'
        },
        select: { date: true, amount: true }
      }),
      prisma.warehouseInvoice.findMany({
        where: {
          userId: userId,
          invoiceDate: { gte: startDate, lte: endDate },
          invoiceStatus: { not: 'Draft' }
        },
        select: { invoiceDate: true, grandTotal: true }
      }),
      prisma.creditNote.findMany({
        where: {
          userId: userId,
          date: { gte: startDate, lte: endDate }
        },
        select: { date: true, amount: true }
      }),
      prisma.expense.findMany({
        where: {
          userId: userId,
          date: { gte: startDate, lte: endDate },
          status: 'Posted'
        },
        select: { date: true, amount: true }
      }),
      prisma.bill.findMany({
        where: {
          userId: userId,
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

    res.status(200).json({ success: true, data: chartData });
  } catch (error) {
    console.error('Error getting chart data:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ─── Get Expense Categories ────────────────────────────────────

const getExpenseCategories = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const userId = req.user.id;

    let dateFilter = {};
    if (startDate && endDate) {
      dateFilter = { gte: new Date(startDate), lte: new Date(endDate) };
    } else {
      dateFilter = { gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) };
    }

    const [expenses, bills] = await Promise.all([
      prisma.expense.findMany({
        where: {
          userId: userId,
          date: dateFilter,
          status: 'Posted'
        },
        select: { expenseType: true, amount: true }
      }),
      prisma.bill.findMany({
        where: {
          userId: userId,
          date: dateFilter
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

    res.status(200).json({ success: true, data: categoryData });
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

    const [paymentsReceived, incomes, expenses, invoices, bills] = await Promise.all([
      prisma.paymentReceived.findMany({
        where: { userId: userId },
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
        where: { userId: userId, status: 'Posted' },
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
        where: { userId: userId, status: 'Posted' },
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
        where: { userId: userId, invoiceStatus: { not: 'Draft' } },
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
        where: { userId: userId },
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

    res.status(200).json({
      success: true,
      data: transactions.slice(0, limitNum)
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
    const startDate = new Date(year, 0, 1);
    const endDate = new Date(year, 11, 31);
    endDate.setHours(23, 59, 59, 999);

    const [incomes, invoices, creditNotes, expenses, bills] = await Promise.all([
      prisma.income.findMany({
        where: {
          userId: userId,
          date: { gte: startDate, lte: endDate },
          status: 'Posted'
        },
        select: { date: true, amount: true }
      }),
      prisma.warehouseInvoice.findMany({
        where: {
          userId: userId,
          invoiceDate: { gte: startDate, lte: endDate },
          invoiceStatus: { not: 'Draft' }
        },
        select: { invoiceDate: true, grandTotal: true }
      }),
      prisma.creditNote.findMany({
        where: {
          userId: userId,
          date: { gte: startDate, lte: endDate }
        },
        select: { date: true, amount: true }
      }),
      prisma.expense.findMany({
        where: {
          userId: userId,
          date: { gte: startDate, lte: endDate },
          status: 'Posted'
        },
        select: { date: true, amount: true }
      }),
      prisma.bill.findMany({
        where: {
          userId: userId,
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

    res.status(200).json({
      success: true,
      data: {
        year: parseInt(year),
        totalRevenue,
        totalExpenses,
        totalProfit: totalRevenue - totalExpenses,
        monthlyData
      }
    });
  } catch (error) {
    console.error('Error getting yearly summary:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ─── Export ─────────────────────────────────────────────────────

module.exports = {
  getDashboardSummary,
  getChartData,
  getExpenseCategories,
  getRecentTransactions,
  getQuickActions,
  getYearlySummary
};