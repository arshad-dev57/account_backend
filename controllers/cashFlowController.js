// controllers/cashFlowController.js

const prisma = require('../prisma/client');
const { get, set } = require('../utils/redisClient');

function amountOf(record) {
  return Number(record.totalAmount ?? record.amount ?? 0) || 0;
}

function matchesExpenseType(expenseType = '', keywords = []) {
  const value = expenseType.toLowerCase();
  return keywords.some((k) => value.includes(k.toLowerCase()));
}

function matchesIncomeType(incomeType = '', keywords = []) {
  const value = incomeType.toLowerCase();
  return keywords.some((k) => value.includes(k.toLowerCase()));
}

async function resolveCashFlowPeriod({
  period,
  startDate,
  endDate,
  fiscalYearId,
  companyId,
}) {
  const now = new Date();
  now.setHours(23, 59, 59, 999);

  let start;
  let end = now;
  let labelPeriod = period || 'Custom Range';

  if (startDate && endDate) {
    start = new Date(startDate);
    start.setHours(0, 0, 0, 0);
    end = new Date(endDate);
    end.setHours(23, 59, 59, 999);
    labelPeriod = period || 'Custom Range';
  } else {
    switch (period) {
      case 'Today':
        start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        break;
      case 'This Week':
        start = new Date(now);
        start.setDate(now.getDate() - now.getDay());
        start.setHours(0, 0, 0, 0);
        break;
      case 'This Quarter': {
        const quarter = Math.floor(now.getMonth() / 3);
        start = new Date(now.getFullYear(), quarter * 3, 1);
        break;
      }
      case 'This Month':
        start = new Date(now.getFullYear(), now.getMonth(), 1);
        break;
      case 'This Year':
      case 'All Time':
      default:
        start = new Date(now.getFullYear(), 0, 1);
        labelPeriod = period || 'This Year';
        break;
    }
    start.setHours(0, 0, 0, 0);
  }

  if (fiscalYearId && companyId) {
    const { applyFiscalYearWindow } = require('../utils/fiscalYearHelper');
    const clamped = await applyFiscalYearWindow({
      companyId,
      fiscalYearId,
      start,
      end,
      period: labelPeriod,
    });
    return {
      start: clamped.start,
      end: clamped.end,
      labelPeriod: clamped.fiscalYear?.name || labelPeriod,
    };
  }

  return { start, end, labelPeriod };
}

async function getCashBalanceAsOf(companyId, asOfDate) {
  const bankAccounts = await prisma.bankAccount.findMany({
    where: { companyId, status: 'Active' },
    select: {
      chartOfAccountId: true,
      openingBalance: true,
      currentBalance: true,
    },
  });

  const linkedIds = bankAccounts
    .map((b) => b.chartOfAccountId)
    .filter(Boolean);

  const cashAccounts = await prisma.chartOfAccount.findMany({
    where: {
      companyId,
      isActive: true,
      type: 'Asset',
      OR: [
        ...(linkedIds.length ? [{ id: { in: linkedIds } }] : []),
        { name: { contains: 'Cash', mode: 'insensitive' } },
        { name: { contains: 'Bank', mode: 'insensitive' } },
      ],
    },
  });

  // Deduplicate by id
  const accountMap = new Map();
  cashAccounts.forEach((a) => accountMap.set(a.id, a));

  if (accountMap.size === 0) {
    // Fallback to bank current balances only when no COA link
    return bankAccounts.reduce((sum, b) => sum + (b.currentBalance || 0), 0);
  }

  const entries = await prisma.journalEntry.findMany({
    where: {
      companyId,
      status: 'Posted',
      date: { lte: asOfDate },
    },
    include: { lines: true },
  });

  let total = 0;

  for (const account of accountMap.values()) {
    let debit = 0;
    let credit = 0;

    entries.forEach((entry) => {
      entry.lines.forEach((line) => {
        if (line.accountId !== account.id) return;
        debit += line.debit || 0;
        credit += line.credit || 0;
      });
    });

    const hasOB = entries.some(
      (entry) =>
        entry.description &&
        entry.description.toLowerCase().includes('opening balance') &&
        entry.lines.some((line) => line.accountId === account.id)
    );

    if (!hasOB && account.openingBalance) {
      debit += account.openingBalance;
    }

    total += debit - credit;
  }

  return total;
}

function buildOperatingBreakdown(incomes, expenses, customerPayments, billPayments) {
  const interestReceived = incomes
    .filter((inc) =>
      matchesIncomeType(inc.incomeType, ['Interest', 'Interest Income'])
    )
    .reduce((sum, inc) => sum + amountOf(inc), 0);

  const otherOperatingIncome = incomes
    .filter(
      (inc) =>
        !matchesIncomeType(inc.incomeType, ['Interest', 'Interest Income'])
    )
    .reduce((sum, inc) => sum + amountOf(inc), 0);

  const customerReceipts =
    otherOperatingIncome +
    customerPayments.reduce((sum, p) => sum + (p.amount || 0), 0);

  const salaryPaid = expenses
    .filter((exp) =>
      matchesExpenseType(exp.expenseType, ['Salary', 'Salaries', 'Payroll', 'Wages'])
    )
    .reduce((sum, exp) => sum + amountOf(exp), 0);

  const rentPaid = expenses
    .filter((exp) => matchesExpenseType(exp.expenseType, ['Rent']))
    .reduce((sum, exp) => sum + amountOf(exp), 0);

  const utilitiesPaid = expenses
    .filter((exp) =>
      matchesExpenseType(exp.expenseType, ['Utility', 'Utilities', 'Electric', 'Internet'])
    )
    .reduce((sum, exp) => sum + amountOf(exp), 0);

  const interestPaid = expenses
    .filter((exp) =>
      matchesExpenseType(exp.expenseType, ['Interest'])
    )
    .reduce((sum, exp) => sum + amountOf(exp), 0);

  const taxesPaid = expenses
    .filter((exp) =>
      matchesExpenseType(exp.expenseType, ['Tax', 'Taxes', 'GST', 'VAT'])
    )
    .reduce((sum, exp) => sum + amountOf(exp), 0);

  const categorizedExpenseTotal =
    salaryPaid + rentPaid + utilitiesPaid + interestPaid + taxesPaid;

  const otherSupplierExpenses = expenses
    .filter((exp) => {
      const t = exp.expenseType || '';
      return !(
        matchesExpenseType(t, ['Salary', 'Salaries', 'Payroll', 'Wages']) ||
        matchesExpenseType(t, ['Rent']) ||
        matchesExpenseType(t, ['Utility', 'Utilities', 'Electric', 'Internet']) ||
        matchesExpenseType(t, ['Interest']) ||
        matchesExpenseType(t, ['Tax', 'Taxes', 'GST', 'VAT'])
      );
    })
    .reduce((sum, exp) => sum + amountOf(exp), 0);

  const billPaid = billPayments.reduce((sum, p) => sum + (p.amount || 0), 0);
  const cashPaidToSuppliers = otherSupplierExpenses + billPaid;

  const items = [
    {
      name: 'Cash Receipts from Customers',
      amount: customerReceipts,
      type: 'Inflow',
    },
    {
      name: 'Interest Received',
      amount: interestReceived,
      type: 'Inflow',
    },
    {
      name: 'Cash Paid to Suppliers',
      amount: -cashPaidToSuppliers,
      type: 'Outflow',
    },
    {
      name: 'Cash Paid for Salaries',
      amount: -salaryPaid,
      type: 'Outflow',
    },
    {
      name: 'Cash Paid for Rent',
      amount: -rentPaid,
      type: 'Outflow',
    },
    {
      name: 'Cash Paid for Utilities',
      amount: -utilitiesPaid,
      type: 'Outflow',
    },
    {
      name: 'Interest Paid',
      amount: -interestPaid,
      type: 'Outflow',
    },
    {
      name: 'Taxes Paid',
      amount: -taxesPaid,
      type: 'Outflow',
    },
  ].filter((item) => Math.abs(item.amount) >= 0.01);

  const total = items.reduce((sum, item) => sum + item.amount, 0);

  return {
    items,
    total,
    // keep for debugging / internal use
    _meta: { categorizedExpenseTotal },
  };
}

// ==================== GET CASH FLOW STATEMENT ====================
exports.getCashFlowStatement = async (req, res) => {
  try {
    const { period, startDate, endDate, fiscalYearId } = req.query;
    const companyId = req.user.companyId;

    if (!companyId) {
      return res.status(400).json({
        success: false,
        message: 'Company context is required',
      });
    }

    const cacheKey = `cf:statement:${companyId}:${period || ''}:${startDate || ''}:${endDate || ''}:${fiscalYearId || ''}`;

    const cached = await get(cacheKey);
    if (cached) {
      return res.status(200).json({
        success: true,
        data: cached,
        cached: true,
      });
    }

    const { start, end, labelPeriod } = await resolveCashFlowPeriod({
      period,
      startDate,
      endDate,
      fiscalYearId,
      companyId,
    });

    // Filter by date range only — FY is applied via resolveCashFlowPeriod dates
    const withCompany = (extra = {}) => ({ companyId, ...extra });

    // ==================== OPERATING ====================
    const [incomes, expenses, customerPayments, billPayments] =
      await Promise.all([
        prisma.income.findMany({
          where: {
            ...withCompany({
              date: { gte: start, lte: end },
              status: 'Posted',
            }),
          },
        }),
        prisma.expense.findMany({
          where: {
            ...withCompany({
              date: { gte: start, lte: end },
              status: 'Posted',
            }),
          },
        }),
        prisma.paymentReceived.findMany({
          where: {
            ...withCompany({
              paymentDate: { gte: start, lte: end },
              status: { notIn: ['Pending', 'Cancelled', 'Draft', 'Failed'] },
            }),
          },
        }),
        prisma.paymentMade.findMany({
          where: {
            ...withCompany({
              paymentDate: { gte: start, lte: end },
              billId: { not: null },
              status: { notIn: ['Pending', 'Cancelled', 'Draft', 'Failed'] },
            }),
          },
        }),
      ]);

    const operating = buildOperatingBreakdown(
      incomes,
      expenses,
      customerPayments,
      billPayments
    );

    // ==================== INVESTING ====================
    const [fixedAssets, disposedAssets] = await Promise.all([
      prisma.fixedAsset.findMany({
        where: withCompany({
          purchaseDate: { gte: start, lte: end },
        }),
      }),
      prisma.fixedAsset.findMany({
        where: withCompany({
          disposedDate: { gte: start, lte: end },
          status: 'Disposed',
        }),
      }),
    ]);

    const purchaseOfEquipment = fixedAssets.reduce(
      (sum, asset) => sum + (asset.purchaseCost || 0),
      0
    );
    const saleOfFixedAssets = disposedAssets.reduce(
      (sum, asset) => sum + (asset.disposalAmount || 0),
      0
    );

    const investingItems = [
      {
        name: 'Purchase of Equipment',
        amount: -purchaseOfEquipment,
        type: 'Outflow',
      },
      {
        name: 'Sale of Fixed Assets',
        amount: saleOfFixedAssets,
        type: 'Inflow',
      },
    ].filter((item) => Math.abs(item.amount) >= 0.01);

    const cashFlowFromInvesting = investingItems.reduce(
      (sum, item) => sum + item.amount,
      0
    );

    // ==================== FINANCING ====================
    const newLoans = await prisma.loan.findMany({
      where: withCompany({
        disbursementDate: { gte: start, lte: end },
      }),
    });
    const loanProceeds = newLoans.reduce(
      (sum, loan) => sum + (loan.loanAmount || 0),
      0
    );

    const loanPayments = await prisma.loanPayment.findMany({
      where: {
        date: { gte: start, lte: end },
        status: 'Paid',
        loan: { companyId },
      },
    });
    const loanRepayments = loanPayments.reduce(
      (sum, p) => sum + (p.amount || 0),
      0
    );

    const equityTx = await prisma.equityTransaction.findMany({
      where: {
        companyId,
        date: { gte: start, lte: end },
        status: 'Posted',
      },
    });

    let capitalInvestments = 0;
    let ownerDrawings = 0;
    equityTx.forEach((tx) => {
      const type = (tx.type || '').toLowerCase();
      if (
        type.includes('additional capital') ||
        type.includes('share issue') ||
        type.includes('capital contribution') ||
        type.includes('owner investment')
      ) {
        capitalInvestments += tx.amount || 0;
      } else if (type.includes('drawing') || type.includes('withdrawal')) {
        ownerDrawings += tx.amount || 0;
      }
    });

    const financingItems = [
      { name: 'Loan Proceeds', amount: loanProceeds, type: 'Inflow' },
      { name: 'Loan Repayment', amount: -loanRepayments, type: 'Outflow' },
      {
        name: 'Capital Investment',
        amount: capitalInvestments,
        type: 'Inflow',
      },
      { name: 'Owner Drawings', amount: -ownerDrawings, type: 'Outflow' },
    ].filter((item) => Math.abs(item.amount) >= 0.01);

    const cashFlowFromFinancing = financingItems.reduce(
      (sum, item) => sum + item.amount,
      0
    );

    // ==================== NET / OPENING / CLOSING ====================
    const cashFlowFromOperations = operating.total;
    const netCashFlow =
      cashFlowFromOperations + cashFlowFromInvesting + cashFlowFromFinancing;

    const dayBeforeStart = new Date(start);
    dayBeforeStart.setMilliseconds(dayBeforeStart.getMilliseconds() - 1);

    const openingCashBalance = await getCashBalanceAsOf(
      companyId,
      dayBeforeStart
    );
    const closingCashBalanceFromLedger = await getCashBalanceAsOf(
      companyId,
      end
    );

    // Prefer ledger closing; fall back to opening + net if ledger empty
    const closingCashBalance =
      Math.abs(closingCashBalanceFromLedger) > 0.0001 ||
      Math.abs(openingCashBalance) > 0.0001
        ? closingCashBalanceFromLedger
        : openingCashBalance + netCashFlow;

    const responseData = {
      period: {
        start,
        end,
        displayText: _getPeriodDisplayText(labelPeriod, start, end),
      },
      operatingActivities: {
        items: operating.items,
        total: cashFlowFromOperations,
      },
      investingActivities: {
        items: investingItems,
        total: cashFlowFromInvesting,
      },
      financingActivities: {
        items: financingItems,
        total: cashFlowFromFinancing,
      },
      netCashFlow,
      openingCashBalance,
      closingCashBalance,
      netCashFlowPercentage:
        openingCashBalance !== 0
          ? (netCashFlow / Math.abs(openingCashBalance)) * 100
          : 0,
      isReconciled:
        Math.abs(openingCashBalance + netCashFlow - closingCashBalance) < 0.5,
    };

    await set(cacheKey, responseData, 300);

    res.status(200).json({
      success: true,
      data: responseData,
      cached: false,
    });
  } catch (error) {
    console.error('Error generating cash flow statement:', error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ==================== GET CASH FLOW SUMMARY ====================
exports.getSummary = async (req, res) => {
  try {
    const { fiscalYearId } = req.query;
    const companyId = req.user.companyId;

    if (!companyId) {
      return res.status(400).json({
        success: false,
        message: 'Company context is required',
      });
    }

    const cacheKey = `cf:summary:${companyId}:${fiscalYearId || ''}`;

    const cached = await get(cacheKey);
    if (cached) {
      return res.status(200).json({
        success: true,
        data: cached,
        cached: true,
      });
    }

    // Reuse current-month window for dashboard summary
    const now = new Date();
    now.setHours(23, 59, 59, 999);
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    startOfMonth.setHours(0, 0, 0, 0);

    const [incomes, expenses, customerPayments, billPayments, loanPayments, equityTx] =
      await Promise.all([
        prisma.income.findMany({
          where: {
            companyId,
            date: { gte: startOfMonth, lte: now },
            status: 'Posted',
          },
        }),
        prisma.expense.findMany({
          where: {
            companyId,
            date: { gte: startOfMonth, lte: now },
            status: 'Posted',
          },
        }),
        prisma.paymentReceived.findMany({
          where: {
            companyId,
            paymentDate: { gte: startOfMonth, lte: now },
            status: { notIn: ['Pending', 'Cancelled', 'Draft', 'Failed'] },
          },
        }),
        prisma.paymentMade.findMany({
          where: {
            companyId,
            paymentDate: { gte: startOfMonth, lte: now },
            billId: { not: null },
            status: { notIn: ['Pending', 'Cancelled', 'Draft', 'Failed'] },
          },
        }),
        prisma.loanPayment.findMany({
          where: {
            date: { gte: startOfMonth, lte: now },
            status: 'Paid',
            loan: { companyId },
          },
        }),
        prisma.equityTransaction.findMany({
          where: {
            companyId,
            date: { gte: startOfMonth, lte: now },
            status: 'Posted',
          },
        }),
      ]);

    const operating = buildOperatingBreakdown(
      incomes,
      expenses,
      customerPayments,
      billPayments
    );

    const monthLoanPayments = loanPayments.reduce(
      (sum, p) => sum + (p.amount || 0),
      0
    );
    let monthCapital = 0;
    let monthDrawings = 0;
    equityTx.forEach((tx) => {
      const type = (tx.type || '').toLowerCase();
      if (type.includes('capital') || type.includes('share issue')) {
        monthCapital += tx.amount || 0;
      } else if (type.includes('drawing') || type.includes('withdrawal')) {
        monthDrawings += tx.amount || 0;
      }
    });

    const monthCashInflow =
      operating.items
        .filter((i) => i.amount > 0)
        .reduce((s, i) => s + i.amount, 0) + monthCapital;
    const monthCashOutflow =
      Math.abs(
        operating.items
          .filter((i) => i.amount < 0)
          .reduce((s, i) => s + i.amount, 0)
      ) +
      monthLoanPayments +
      monthDrawings;

    const monthNetCashFlow = monthCashInflow - monthCashOutflow;
    const currentCashBalance = await getCashBalanceAsOf(companyId, now);

    const summaryData = {
      currentCashBalance,
      monthCashInflow,
      monthCashOutflow,
      monthNetCashFlow,
      monthNetCashFlowPercentage:
        currentCashBalance !== 0
          ? (monthNetCashFlow / Math.abs(currentCashBalance)) * 100
          : 0,
    };

    await set(cacheKey, summaryData, 120);

    res.status(200).json({
      success: true,
      data: summaryData,
      cached: false,
    });
  } catch (error) {
    console.error('Error generating cash flow summary:', error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ==================== GET CASH FLOW TREND ====================
exports.getTrend = async (req, res) => {
  try {
    const { months = 12 } = req.query;
    const companyId = req.user.companyId;

    if (!companyId) {
      return res.status(400).json({
        success: false,
        message: 'Company context is required',
      });
    }

    const cacheKey = `cf:trend:${companyId}:${months}`;
    const cached = await get(cacheKey);
    if (cached) {
      return res.status(200).json({
        success: true,
        data: cached,
        cached: true,
      });
    }

    const endDate = new Date();
    const startDate = new Date();
    startDate.setMonth(endDate.getMonth() - parseInt(months, 10));

    const monthlyData = [];
    const monthCount = parseInt(months, 10);

    for (let i = 0; i <= monthCount; i++) {
      const date = new Date(startDate);
      date.setMonth(startDate.getMonth() + i);
      const monthStart = new Date(date.getFullYear(), date.getMonth(), 1);
      const monthEnd = new Date(date.getFullYear(), date.getMonth() + 1, 0);
      monthEnd.setHours(23, 59, 59, 999);

      const [incomes, expenses, customerPayments, billPayments, loanPayments, equityTx] =
        await Promise.all([
          prisma.income.findMany({
            where: {
              companyId,
              date: { gte: monthStart, lte: monthEnd },
              status: 'Posted',
            },
          }),
          prisma.expense.findMany({
            where: {
              companyId,
              date: { gte: monthStart, lte: monthEnd },
              status: 'Posted',
            },
          }),
          prisma.paymentReceived.findMany({
            where: {
              companyId,
              paymentDate: { gte: monthStart, lte: monthEnd },
              status: { in: ['Posted', 'Completed', 'Cleared', 'Paid'] },
            },
          }),
          prisma.paymentMade.findMany({
            where: {
              companyId,
              paymentDate: { gte: monthStart, lte: monthEnd },
              billId: { not: null },
              status: { in: ['Posted', 'Completed', 'Paid', 'Cleared'] },
            },
          }),
          prisma.loanPayment.findMany({
            where: {
              date: { gte: monthStart, lte: monthEnd },
              status: 'Paid',
              loan: { companyId },
            },
          }),
          prisma.equityTransaction.findMany({
            where: {
              companyId,
              date: { gte: monthStart, lte: monthEnd },
              status: 'Posted',
            },
          }),
        ]);

      const operating = buildOperatingBreakdown(
        incomes,
        expenses,
        customerPayments,
        billPayments
      );

      let capital = 0;
      let drawings = 0;
      equityTx.forEach((tx) => {
        const type = (tx.type || '').toLowerCase();
        if (type.includes('capital') || type.includes('share')) {
          capital += tx.amount || 0;
        } else if (type.includes('drawing') || type.includes('withdrawal')) {
          drawings += tx.amount || 0;
        }
      });

      const loanOut = loanPayments.reduce((s, p) => s + (p.amount || 0), 0);
      const inflow =
        operating.items.filter((i) => i.amount > 0).reduce((s, i) => s + i.amount, 0) +
        capital;
      const outflow =
        Math.abs(
          operating.items
            .filter((i) => i.amount < 0)
            .reduce((s, i) => s + i.amount, 0)
        ) +
        loanOut +
        drawings;

      monthlyData.push({
        month: date.toLocaleString('default', { month: 'short', year: 'numeric' }),
        inflow,
        outflow,
        netCashFlow: inflow - outflow,
      });
    }

    await set(cacheKey, monthlyData, 300);

    res.status(200).json({
      success: true,
      data: monthlyData,
      cached: false,
    });
  } catch (error) {
    console.error('Error generating cash flow trend:', error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ==================== HELPER FUNCTIONS ====================
function _getPeriodDisplayText(period, start, end) {
  if (period && period !== 'Custom Range') {
    switch (period) {
      case 'Today':
        return new Date(start).toLocaleDateString();
      case 'This Week':
        return `${start.toLocaleDateString()} - ${end.toLocaleDateString()}`;
      case 'This Month':
        return start.toLocaleString('default', {
          month: 'long',
          year: 'numeric',
        });
      case 'This Quarter':
        return `Q${Math.floor(start.getMonth() / 3) + 1} ${start.getFullYear()}`;
      case 'This Year':
        return `Year ${start.getFullYear()}`;
      default:
        return `${start.toLocaleDateString()} - ${end.toLocaleDateString()}`;
    }
  }
  return `${start.toLocaleDateString()} - ${end.toLocaleDateString()}`;
}
