// Profit & Loss from posted journal lines (same source as Balance Sheet CYE).

const prisma = require('../prisma/client');

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfDay(d) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

function periodNet(account, entries, start, end) {
  let debit = 0;
  let credit = 0;
  entries.forEach((entry) => {
    if (entry.date < start || entry.date > end) return;
    (entry.lines || []).forEach((line) => {
      if (line.accountId !== account.id) return;
      debit += line.debit || 0;
      credit += line.credit || 0;
    });
  });
  const type = account.type === 'Income' ? 'Revenue' : account.type;
  if (type === 'Revenue') return credit - debit;
  if (type === 'Expense') return debit - credit;
  return 0;
}

function isCogsAccount(account) {
  const blob = `${account.parentAccount || ''} ${account.name || ''} ${account.code || ''}`.toLowerCase();
  return (
    blob.includes('cost of sales') ||
    blob.includes('cost of goods') ||
    blob.includes('cogs') ||
    String(account.code || '').startsWith('5')
  );
}

function isOtherIncomeAccount(account) {
  const blob = `${account.parentAccount || ''} ${account.name || ''}`.toLowerCase();
  return (
    blob.includes('other income') ||
    blob.includes('interest income') ||
    blob.includes('rental income') ||
    blob.includes('dividend')
  );
}

function isOtherExpenseAccount(account) {
  const blob = `${account.parentAccount || ''} ${account.name || ''}`.toLowerCase();
  return blob.includes('other expense') || blob.includes('miscellaneous');
}

/**
 * Build P&L from posted JEs on Revenue / Expense accounts.
 */
async function buildProfitLossFromLedger(companyId, start, end) {
  const windowStart = startOfDay(start);
  const windowEnd = endOfDay(end);

  const accounts = await prisma.chartOfAccount.findMany({
    where: {
      companyId,
      isActive: true,
      type: { in: ['Revenue', 'Income', 'Expense'] },
    },
    orderBy: { code: 'asc' },
  });

  const entries = await prisma.journalEntry.findMany({
    where: {
      companyId,
      status: 'Posted',
      date: { gte: windowStart, lte: windowEnd },
    },
    include: { lines: true },
    orderBy: { date: 'asc' },
  });

  const revenueItems = [];
  const expenseItems = [];
  const otherExpenseItems = [];

  let operatingRevenue = 0;
  let otherRevenue = 0;
  let costOfGoodsSold = 0;
  let operatingExpenseTotal = 0;
  let otherExpenseTotal = 0;

  for (const account of accounts) {
    const net = periodNet(account, entries, windowStart, windowEnd);
    if (Math.abs(net) < 0.005) continue;

    const type = account.type === 'Income' ? 'Revenue' : account.type;
    const item = { name: account.name, amount: net, code: account.code };

    if (type === 'Revenue') {
      if (isOtherIncomeAccount(account)) {
        otherRevenue += net;
      } else {
        operatingRevenue += net;
      }
      revenueItems.push(item);
    } else if (type === 'Expense') {
      if (isCogsAccount(account)) {
        costOfGoodsSold += net;
      } else if (isOtherExpenseAccount(account)) {
        otherExpenseTotal += net;
        otherExpenseItems.push(item);
      } else {
        operatingExpenseTotal += net;
        expenseItems.push(item);
      }
    }
  }

  const totalRevenue = operatingRevenue + otherRevenue;
  const grossProfit = totalRevenue - costOfGoodsSold;
  const netProfit =
    grossProfit - operatingExpenseTotal - otherExpenseTotal;
  const netProfitMargin =
    totalRevenue > 0 ? (netProfit / totalRevenue) * 100 : 0;

  return {
    revenue: {
      total: totalRevenue,
      operating: operatingRevenue,
      other: otherRevenue,
      items: revenueItems,
    },
    costOfGoodsSold,
    grossProfit,
    operatingExpenses: {
      total: operatingExpenseTotal,
      items: expenseItems,
    },
    otherIncome: {
      total: otherRevenue,
      items: [],
    },
    otherExpenses: {
      total: otherExpenseTotal,
      items: otherExpenseItems,
    },
    netProfit,
    netProfitMargin,
  };
}

function isCurrentYearEarningsAccount(account = {}) {
  const code = String(account.code || account.accountCode || '');
  const name = String(account.name || account.accountName || '');
  return code === '3200' || /current year earnings/i.test(name);
}

async function liveCurrentYearEarnings(companyId, start, end) {
  if (!companyId) return 0;
  const now = new Date();
  const windowStart = start ? new Date(start) : new Date(now.getFullYear(), 0, 1);
  const windowEnd = end ? new Date(end) : now;
  const pl = await buildProfitLossFromLedger(companyId, windowStart, windowEnd);
  return Number(pl.netProfit) || 0;
}

async function earningsWindowForCompany(companyId, fiscalYearId) {
  const now = new Date();
  if (fiscalYearId) {
    const { getCompanyFiscalYear } = require('./fiscalYearHelper');
    const fy = await getCompanyFiscalYear(companyId, fiscalYearId);
    if (fy) {
      const start = new Date(fy.startDate);
      const fyEnd = new Date(fy.endDate);
      const end = now < fyEnd ? now : fyEnd;
      return { start, end };
    }
  }
  return { start: new Date(now.getFullYear(), 0, 1), end: now };
}

module.exports = {
  buildProfitLossFromLedger,
  isCurrentYearEarningsAccount,
  liveCurrentYearEarnings,
  earningsWindowForCompany,
};
