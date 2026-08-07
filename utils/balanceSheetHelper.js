// utils/balanceSheetHelper.js

const prisma = require('../prisma/client');

function classifyAssetBucket(parentAccount = '') {
  const parent = parentAccount.toLowerCase();
  if (
    parent.includes('current') ||
    parent.includes('cash') ||
    parent.includes('receivable') ||
    parent.includes('inventory') ||
    parent.includes('prepaid')
  ) {
    return 'current';
  }
  if (
    parent.includes('fixed') ||
    parent.includes('non-current') ||
    parent.includes('property') ||
    parent.includes('equipment') ||
    parent.includes('depreciation')
  ) {
    return 'fixed';
  }
  return 'other';
}

function classifyLiabilityBucket(parentAccount = '') {
  const parent = parentAccount.toLowerCase();
  if (
    parent.includes('current') ||
    parent.includes('short') ||
    parent.includes('payable')
  ) {
    return 'current';
  }
  if (
    parent.includes('long') ||
    parent.includes('non-current') ||
    parent.includes('deferred')
  ) {
    return 'longTerm';
  }
  return 'other';
}

function resolvePeriodAsOfDate(period, asOfDate) {
  if (asOfDate) {
    const d = new Date(asOfDate);
    d.setHours(23, 59, 59, 999);
    return d;
  }

  // Balance sheet is a point-in-time statement — default as-of is today.
  // Period only affects the earnings window (current year earnings).
  const now = new Date();
  now.setHours(23, 59, 59, 999);
  return now;
}

async function resolveEarningsWindow({
  companyId,
  fiscalYearId,
  startDate,
  endDate,
  reportDate,
  period,
}) {
  if (startDate && endDate) {
    const start = new Date(startDate);
    start.setHours(0, 0, 0, 0);
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);
    return { start, end };
  }

  if (fiscalYearId) {
    const fiscalYear = await prisma.fiscalYear.findFirst({
      where: { id: fiscalYearId, companyId },
      select: { startDate: true, endDate: true },
    });

    if (fiscalYear) {
      const start = new Date(fiscalYear.startDate);
      start.setHours(0, 0, 0, 0);
      const fyEnd = new Date(fiscalYear.endDate);
      fyEnd.setHours(23, 59, 59, 999);
      const end = reportDate < fyEnd ? reportDate : fyEnd;
      return { start, end };
    }
  }

  let start = new Date(reportDate.getFullYear(), 0, 1);
  start.setHours(0, 0, 0, 0);

  if (period === 'This Month') {
    start = new Date(reportDate.getFullYear(), reportDate.getMonth(), 1);
    start.setHours(0, 0, 0, 0);
  } else if (period === 'This Quarter') {
    const quarter = Math.floor(reportDate.getMonth() / 3);
    start = new Date(reportDate.getFullYear(), quarter * 3, 1);
    start.setHours(0, 0, 0, 0);
  }

  return { start, end: reportDate };
}

function hasOpeningBalanceJournalEntry(entries, accountId) {
  return entries.some(
    (entry) =>
      entry.description &&
      entry.description.toLowerCase().includes('opening balance') &&
      entry.lines.some((line) => line.accountId === accountId)
  );
}

function sumLinesUpTo(entries, accountId, asOfDate) {
  let debit = 0;
  let credit = 0;

  entries.forEach((entry) => {
    if (entry.date > asOfDate) return;
    entry.lines.forEach((line) => {
      if (line.accountId !== accountId) return;
      debit += line.debit || 0;
      credit += line.credit || 0;
    });
  });

  return { debit, credit };
}

function sumLinesInRange(entries, accountId, start, end) {
  let debit = 0;
  let credit = 0;

  entries.forEach((entry) => {
    if (entry.date < start || entry.date > end) return;
    entry.lines.forEach((line) => {
      if (line.accountId !== accountId) return;
      debit += line.debit || 0;
      credit += line.credit || 0;
    });
  });

  return { debit, credit };
}

function accountBalanceAsOf(account, allEntries, asOfDate) {
  const { debit, credit } = sumLinesUpTo(allEntries, account.id, asOfDate);
  let runningDebit = debit;
  let runningCredit = credit;

  const hasOB = hasOpeningBalanceJournalEntry(allEntries, account.id);
  if (!hasOB && account.openingBalance) {
    if (account.type === 'Asset' || account.type === 'Expense') {
      runningDebit += account.openingBalance;
    } else {
      runningCredit += account.openingBalance;
    }
  }

  // Normal balances:
  // Asset/Expense → Debit normal
  // Liability/Equity/Revenue → Credit normal
  if (account.type === 'Asset' || account.type === 'Expense') {
    return runningDebit - runningCredit;
  }
  return runningCredit - runningDebit;
}

function periodNetForPnL(account, allEntries, start, end) {
  const { debit, credit } = sumLinesInRange(allEntries, account.id, start, end);
  if (account.type === 'Revenue') {
    return credit - debit;
  }
  if (account.type === 'Expense') {
    return debit - credit;
  }
  return 0;
}

/**
 * Build a proper point-in-time Balance Sheet from posted journal entries.
 *
 * Signature (fixed):
 *   buildBalanceSheetFromLedger(userId, companyId, period, asOfDate, fiscalYearId, startDate, endDate)
 */
async function buildBalanceSheetFromLedger(
  userId,
  companyId,
  period = 'All Time',
  asOfDate = null,
  fiscalYearId = null,
  startDate = null,
  endDate = null
) {
  if (!companyId) {
    throw new Error('companyId is required to build balance sheet');
  }

  const reportDate = resolvePeriodAsOfDate(period, asOfDate);
  const earningsWindow = await resolveEarningsWindow({
    companyId,
    fiscalYearId,
    startDate,
    endDate,
    reportDate,
    period,
  });

  const accounts = await prisma.chartOfAccount.findMany({
    where: {
      companyId,
      isActive: true,
    },
    orderBy: { code: 'asc' },
  });

  const allPostedEntries = await prisma.journalEntry.findMany({
    where: {
      companyId,
      status: 'Posted',
      date: { lte: reportDate },
    },
    include: { lines: true },
    orderBy: { date: 'asc' },
  });

  const assetsData = { current: [], fixed: [], other: [] };
  const liabilitiesData = { current: [], longTerm: [], other: [] };
  const equityItems = [];

  let totalAssets = 0;
  let totalLiabilities = 0;
  let totalEquityFromAccounts = 0;
  let totalRevenue = 0;
  let totalExpense = 0;

  for (const account of accounts) {
    if (account.type === 'Revenue' || account.type === 'Expense') {
      const net = periodNetForPnL(
        account,
        allPostedEntries,
        earningsWindow.start,
        earningsWindow.end
      );
      if (account.type === 'Revenue') totalRevenue += net;
      else totalExpense += net;
      continue;
    }

    const balance = accountBalanceAsOf(account, allPostedEntries, reportDate);
    if (Math.abs(balance) < 0.0001) continue;

    const item = {
      code: account.code,
      name: account.name,
      balance,
      parent: account.parentAccount || '',
    };

    if (account.type === 'Asset') {
      totalAssets += balance;
      assetsData[classifyAssetBucket(account.parentAccount)].push(item);
    } else if (account.type === 'Liability') {
      totalLiabilities += balance;
      liabilitiesData[classifyLiabilityBucket(account.parentAccount)].push(item);
    } else if (account.type === 'Equity') {
      totalEquityFromAccounts += balance;
      equityItems.push(item);
    }
  }

  // Current period net income (Revenue - Expense) added under equity.
  // Permanent equity accounts (capital, prior RE, etc.) already include historical closings.
  const retainedEarnings = totalRevenue - totalExpense;
  let addedCurrentEarnings = 0;

  if (Math.abs(retainedEarnings) >= 0.01) {
    equityItems.push({
      code: 'RE-CY',
      name: 'Current Year Earnings',
      balance: retainedEarnings,
      parent: 'Owners Equity',
    });
    addedCurrentEarnings = retainedEarnings;
  }

  const finalTotalAssets = totalAssets;
  const finalTotalLiabilities = totalLiabilities;
  const finalTotalEquity = totalEquityFromAccounts + addedCurrentEarnings;
  const finalTotalLiabilitiesAndEquity =
    finalTotalLiabilities + finalTotalEquity;
  const difference = finalTotalAssets - finalTotalLiabilitiesAndEquity;
  const isBalanced = Math.abs(difference) < 0.01;

  return {
    asOfDate: reportDate,
    period: period || 'All Time',
    earningsPeriod: {
      startDate: earningsWindow.start,
      endDate: earningsWindow.end,
    },
    assets: assetsData,
    liabilities: liabilitiesData,
    equity: {
      owners: equityItems,
      retainedEarnings: addedCurrentEarnings,
    },
    totals: {
      totalAssets: finalTotalAssets,
      totalLiabilities: finalTotalLiabilities,
      totalEquity: finalTotalEquity,
      totalLiabilitiesAndEquity: finalTotalLiabilitiesAndEquity,
    },
    isBalanced,
    difference,
  };
}

async function getBalanceSheetSummary(
  userId,
  companyId,
  asOfDate,
  fiscalYearId,
  startDate,
  endDate
) {
  const balanceSheet = await buildBalanceSheetFromLedger(
    userId,
    companyId,
    'All Time',
    asOfDate,
    fiscalYearId,
    startDate,
    endDate
  );

  const currentAssets = balanceSheet.assets.current.reduce(
    (sum, a) => sum + a.balance,
    0
  );
  const currentLiabilities = balanceSheet.liabilities.current.reduce(
    (sum, l) => sum + l.balance,
    0
  );
  const totalAssets = balanceSheet.totals.totalAssets;
  const totalLiabilities = balanceSheet.totals.totalLiabilities;
  const totalEquity = balanceSheet.totals.totalEquity;

  return {
    asOfDate: balanceSheet.asOfDate,
    totals: balanceSheet.totals,
    isBalanced: balanceSheet.isBalanced,
    difference: balanceSheet.difference,
    ratios: {
      currentRatio:
        currentLiabilities > 0 ? currentAssets / currentLiabilities : 0,
      debtToEquity: totalEquity > 0 ? totalLiabilities / totalEquity : 0,
      equityToAssets: totalAssets > 0 ? totalEquity / totalAssets : 0,
    },
  };
}

module.exports = {
  buildBalanceSheetFromLedger,
  getBalanceSheetSummary,
};
