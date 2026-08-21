// utils/balanceSheetHelper.js

const prisma = require('../prisma/client');
const { journalEntryLocationWhere } = require('./accountingLocationHelper');

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

/**
 * Point-in-time as-of date.
 * Period is evaluated against [anchor] (today, or FY end for a past year)
 * so "This Month" on a closed FY means the last month of that year.
 */
function resolvePeriodAsOfDate(period, asOfDate, anchor) {
  const a = endOfDay(anchor || new Date());
  const label = String(period || 'All Time').trim();
  const preferFyAnchor =
    !label || /^(this year|all time|fiscal year|year)$/i.test(label);

  // Full-year views are pinned to the FY/today anchor. Client asOfDate
  // must not override the selected fiscal year (Flutter was sending today).
  if (preferFyAnchor) return a;

  if (asOfDate) return endOfDay(new Date(asOfDate));

  if (label === 'This Month') {
    const monthEnd = endOfDay(new Date(a.getFullYear(), a.getMonth() + 1, 0));
    return monthEnd < a ? monthEnd : a;
  }
  if (label === 'This Quarter') {
    const q = Math.floor(a.getMonth() / 3);
    const quarterEnd = endOfDay(new Date(a.getFullYear(), q * 3 + 3, 0));
    return quarterEnd < a ? quarterEnd : a;
  }
  return a;
}

function earningsStartForPeriod(period, asOf) {
  const label = String(period || 'All Time').trim();
  if (label === 'This Month') {
    return startOfDay(new Date(asOf.getFullYear(), asOf.getMonth(), 1));
  }
  if (label === 'This Quarter') {
    const q = Math.floor(asOf.getMonth() / 3);
    return startOfDay(new Date(asOf.getFullYear(), q * 3, 1));
  }
  return startOfDay(new Date(asOf.getFullYear(), 0, 1));
}

async function resolveEarningsWindow({
  companyId,
  fiscalYearId,
  startDate,
  endDate,
  reportDate,
  period,
  fyStart,
  fyEnd
}) {
  if (startDate && endDate) {
    let start = startOfDay(startDate);
    let end = endOfDay(endDate);
    if (fyStart && start < fyStart) start = fyStart;
    if (fyEnd && end > fyEnd) end = fyEnd;
    if (reportDate && end > reportDate) end = reportDate;
    if (start > end) start = startOfDay(end);
    return { start, end };
  }

  const label = String(period || 'All Time').trim();
  const preferFullFy =
    !label || /^(this year|all time|fiscal year|year)$/i.test(label);

  let start;
  if (preferFullFy && fyStart) {
    start = fyStart;
  } else {
    start = earningsStartForPeriod(period, reportDate);
    if (fyStart && start < fyStart) start = fyStart;
  }
  if (start > reportDate) start = startOfDay(reportDate);
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

function emptyBalanceSheetPayload(asOf, period, earnings) {
  return {
    asOfDate: asOf,
    period: period || 'All Time',
    empty: true,
    earningsPeriod: {
      startDate: earnings?.start || asOf,
      endDate: earnings?.end || asOf
    },
    assets: { current: [], fixed: [], other: [] },
    liabilities: { current: [], longTerm: [], other: [] },
    equity: { owners: [], retainedEarnings: 0 },
    totals: {
      totalAssets: 0,
      totalLiabilities: 0,
      totalEquity: 0,
      totalLiabilitiesAndEquity: 0
    },
    isBalanced: true,
    difference: 0
  };
}

function accountBalanceAsOf(account, allEntries, asOfDate, { includeOpening = true } = {}) {
  const { debit, credit } = sumLinesUpTo(allEntries, account.id, asOfDate);
  let runningDebit = debit;
  let runningCredit = credit;

  const hasOB = hasOpeningBalanceJournalEntry(allEntries, account.id);
  if (includeOpening && !hasOB && account.openingBalance) {
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
 *   buildBalanceSheetFromLedger(userId, companyId, period, asOfDate, fiscalYearId, startDate, endDate, locationId)
 */
async function buildBalanceSheetFromLedger(
  userId,
  companyId,
  period = 'All Time',
  asOfDate = null,
  fiscalYearId = null,
  startDate = null,
  endDate = null,
  locationId = null
) {
  if (!companyId) {
    throw new Error('companyId is required to build balance sheet');
  }

  try {
    const SalesInvoice = require('../warehouse/models/SalesInvoice');
    await SalesInvoice.backfillMissingJournals(companyId, userId);
  } catch (err) {
    console.error('Sales invoice journal backfill skipped:', err.message);
  }

  let fyStart = null;
  let fyEnd = null;
  if (fiscalYearId) {
    const { getCompanyFiscalYear } = require('./fiscalYearHelper');
    const fy = await getCompanyFiscalYear(companyId, fiscalYearId);
    if (fy) {
      fyStart = startOfDay(fy.startDate);
      fyEnd = endOfDay(fy.endDate);
    }
  }

  const now = endOfDay(new Date());

  // Future FY has not started — do not carry current-year history into it.
  if (fyStart && fyStart > now) {
    return emptyBalanceSheetPayload(fyStart, period, {
      start: fyStart,
      end: fyStart
    });
  }

  let anchor = now;
  if (fyStart && fyEnd) {
    anchor = now < fyEnd ? now : fyEnd;
  }

  let effectiveAsOf = resolvePeriodAsOfDate(period, asOfDate, anchor);
  if (fyStart && effectiveAsOf < fyStart) effectiveAsOf = fyStart;
  if (fyEnd && effectiveAsOf > fyEnd) effectiveAsOf = fyEnd;
  if (effectiveAsOf > now) {
    effectiveAsOf = fyEnd && now > fyEnd ? fyEnd : now;
  }

  const earningsWindow = await resolveEarningsWindow({
    companyId,
    fiscalYearId,
    startDate,
    endDate,
    reportDate: effectiveAsOf,
    period,
    fyStart,
    fyEnd
  });

  if (fyStart && earningsWindow.start > earningsWindow.end) {
    return emptyBalanceSheetPayload(effectiveAsOf, period, earningsWindow);
  }

  const accounts = await prisma.chartOfAccount.findMany({
    where: {
      companyId,
      isActive: true
    },
    orderBy: { code: 'asc' }
  });

  const dateFilter = { lte: effectiveAsOf };
  if (fyStart) dateFilter.gte = fyStart;

  const allPostedEntries = await prisma.journalEntry.findMany({
    where: {
      companyId,
      status: 'Posted',
      date: dateFilter,
      ...journalEntryLocationWhere(locationId)
    },
    include: { lines: true },
    orderBy: { date: 'asc' }
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

    const balance = accountBalanceAsOf(account, allPostedEntries, effectiveAsOf, {
      includeOpening: !fyStart
    });
    if (Math.abs(balance) < 0.0001) continue;

    const item = {
      code: account.code,
      name: account.name,
      balance,
      parent: account.parentAccount || ''
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
      parent: 'Owners Equity'
    });
    addedCurrentEarnings = retainedEarnings;
  }

  // Merge duplicate Accounts Payable COA lines (legacy 2001 + canonical 2010)
  const apPattern = /accounts\s*payable|trade\s*payables|creditors/i;
  const apCodes = new Set(['2010', '2001', '2000']);
  for (const bucket of ['current', 'longTerm', 'other']) {
    const items = liabilitiesData[bucket];
    const apItems = items.filter(
      (i) => apCodes.has(String(i.code)) || apPattern.test(String(i.name))
    );
    if (apItems.length <= 1) continue;
    const nonAp = items.filter(
      (i) => !(apCodes.has(String(i.code)) || apPattern.test(String(i.name)))
    );
    const mergedBalance = apItems.reduce((s, i) => s + i.balance, 0);
    liabilitiesData[bucket] = [
      ...nonAp,
      {
        code: '2010',
        name: 'Accounts Payable',
        balance: mergedBalance,
        parent: 'Current Liabilities'
      }
    ];
  }

  const finalTotalAssets = totalAssets;
  const finalTotalLiabilities = totalLiabilities;
  const finalTotalEquity = totalEquityFromAccounts + addedCurrentEarnings;
  const finalTotalLiabilitiesAndEquity =
    finalTotalLiabilities + finalTotalEquity;
  const difference = finalTotalAssets - finalTotalLiabilitiesAndEquity;
  const isBalanced = Math.abs(difference) < 0.01;

  return {
    asOfDate: effectiveAsOf,
    period: period || 'All Time',
    empty: false,
    earningsPeriod: {
      startDate: earningsWindow.start,
      endDate: earningsWindow.end
    },
    assets: assetsData,
    liabilities: liabilitiesData,
    equity: {
      owners: equityItems,
      retainedEarnings: addedCurrentEarnings
    },
    totals: {
      totalAssets: finalTotalAssets,
      totalLiabilities: finalTotalLiabilities,
      totalEquity: finalTotalEquity,
      totalLiabilitiesAndEquity: finalTotalLiabilitiesAndEquity
    },
    isBalanced,
    difference
  };
}

async function getBalanceSheetSummary(
  userId,
  companyId,
  asOfDate,
  fiscalYearId,
  startDate,
  endDate,
  locationId = null
) {
  const balanceSheet = await buildBalanceSheetFromLedger(
    userId,
    companyId,
    'All Time',
    asOfDate,
    fiscalYearId,
    startDate,
    endDate,
    locationId
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
      equityToAssets: totalAssets > 0 ? totalEquity / totalAssets : 0
    }
  };
}

module.exports = {
  buildBalanceSheetFromLedger,
  getBalanceSheetSummary
};
