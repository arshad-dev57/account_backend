const JournalEntry = require('../models/JournalEntry');
const ChartOfAccount = require('../models/ChartOfAccount');

function getReportDates(period, asOfDateInput) {
  const now = new Date();
  let reportDate;

  if (asOfDateInput) {
    reportDate = new Date(asOfDateInput);
  } else {
    reportDate = new Date(now);
  }
  reportDate.setHours(23, 59, 59, 999);

  let periodStart = new Date(2000, 0, 1);
  const periodEnd = reportDate;

  switch (period) {
    case 'This Month':
      periodStart = new Date(reportDate.getFullYear(), reportDate.getMonth(), 1);
      break;
    case 'This Quarter': {
      const quarter = Math.floor(reportDate.getMonth() / 3);
      periodStart = new Date(reportDate.getFullYear(), quarter * 3, 1);
      break;
    }
    case 'This Year':
      periodStart = new Date(reportDate.getFullYear(), 0, 1);
      break;
    default:
      periodStart = new Date(2000, 0, 1);
  }

  periodStart.setHours(0, 0, 0, 0);
  return { reportDate, periodStart, periodEnd };
}

function calculateAccountNetBalances(accounts, journalEntries) {
  const result = new Map();

  for (const account of accounts) {
    let debit = 0;
    let credit = 0;

    // Opening balances are already recorded as journal entries
    // by the equity/loan/fixed-asset controllers, so do NOT add them here.
    // Adding them here caused double-counting and an unbalanced sheet.

    for (const entry of journalEntries) {
      for (const line of entry.lines) {
        if (line.accountId.toString() === account._id.toString()) {
          debit += line.debit || 0;
          credit += line.credit || 0;
        }
      }
    }

    result.set(account._id.toString(), {
      account,
      debit,
      credit,
      net: debit - credit,
    });
  }

  return result;
}

function defaultParent(type) {
  switch (type) {
    case 'Assets':
      return 'Other Assets';
    case 'Liabilities':
      return 'Other Liabilities';
    case 'Equity':
      return 'Owners Equity';
    default:
      return 'Other';
  }
}

// Valid parent categories per account type
const ASSET_PARENTS = ['Current Assets', 'Non-Current Assets', 'Fixed Assets', 'Other Assets'];
const LIABILITY_PARENTS = ['Current Liabilities', 'Long Term Liabilities', 'Other Liabilities'];
const EQUITY_PARENTS = ['Owners Equity', 'Shareholders Equity', 'Retained Earnings', 'Reserves'];

/**
 * Validates that the parentAccount matches the account type.
 * If the stored parentAccount belongs to a different type (e.g., an Equity
 * account with parentAccount 'Current Assets'), falls back to the default.
 */
function resolveParent(account) {
  const parent = (account.parentAccount || '').trim();
  const type = account.type;

  if (!parent) return defaultParent(type);

  if (type === 'Assets' && ASSET_PARENTS.includes(parent)) return parent;
  if (type === 'Liabilities' && LIABILITY_PARENTS.includes(parent)) return parent;
  if (type === 'Equity' && EQUITY_PARENTS.includes(parent)) return parent;

  // Parent doesn't match the account type — use default
  return defaultParent(type);
}

function addToGroup(group, parent, name, amount) {
  if (!group[parent]) group[parent] = {};
  group[parent][name] = Math.round(amount * 100) / 100;
}

function sumGroupedValues(grouped) {
  let total = 0;
  for (const category of Object.values(grouped)) {
    for (const value of Object.values(category)) {
      total += value;
    }
  }
  return Math.round(total * 100) / 100;
}

/**
 * Credit-normal accounts (Liabilities, Equity, Income): balance = -net
 * Debit-normal accounts (Assets, Expenses): balance = net
 *
 * Accounting equation:
 *   Assets = Liabilities + Equity + (Income - Expenses)
 */
async function buildBalanceSheetFromLedger(userId, period, asOfDateInput) {
  const { reportDate, periodStart, periodEnd } = getReportDates(period, asOfDateInput);
  const usePeriodIncome = period && period !== 'All Time';

  const accounts = await ChartOfAccount.find({
    isActive: true,
    createdBy: userId,
  });

  const journalEntries = await JournalEntry.find({
    status: 'Posted',
    createdBy: userId,
    date: { $lte: periodEnd },
  });

  const periodJournalEntries = journalEntries.filter(
    (entry) => entry.date >= periodStart && entry.date <= periodEnd
  );

  const balances = calculateAccountNetBalances(accounts, journalEntries);
  const incomeExpenseEntries = usePeriodIncome ? periodJournalEntries : journalEntries;
  const ieBalances = calculateAccountNetBalances(accounts, incomeExpenseEntries);

  const assets = {};
  const liabilities = {};
  const equityDetails = {};
  let totalEquityAccounts = 0;

  for (const { account, net } of balances.values()) {
    const parent = resolveParent(account);

    if (account.type === 'Assets') {
      if (Math.abs(net) >= 0.01) {
        addToGroup(assets, parent, account.name, net);
      }
    } else if (account.type === 'Liabilities') {
      const balance = -net;
      if (Math.abs(balance) >= 0.01) {
        addToGroup(liabilities, parent, account.name, balance);
      }
    } else if (account.type === 'Equity') {
      const balance = -net;
      if (Math.abs(balance) >= 0.01) {
        addToGroup(equityDetails, parent, account.name, balance);
        totalEquityAccounts += balance;
      }
    }
  }

  let totalIncome = 0;
  let totalExpenses = 0;

  for (const { account, net } of ieBalances.values()) {
    if (account.type === 'Income') {
      totalIncome += -net;
    } else if (account.type === 'Expenses') {
      totalExpenses += net;
    }
  }

  const netIncome = Math.round((totalIncome - totalExpenses) * 100) / 100;

  if (Math.abs(netIncome) >= 0.01) {
    const label = usePeriodIncome ? 'Net Income (Period)' : 'Current Year Earnings';
    addToGroup(equityDetails, 'Profit and Loss', label, netIncome);
  }

  const totalAssets = sumGroupedValues(assets);
  const totalLiabilities = sumGroupedValues(liabilities);
  const totalEquity = Math.round((totalEquityAccounts + netIncome) * 100) / 100;
  const difference = Math.round((totalAssets - (totalLiabilities + totalEquity)) * 100) / 100;

  return {
    asOfDate: reportDate,
    period: period || 'All Time',
    assets,
    liabilities,
    equityDetails,
    totalAssets,
    totalLiabilities,
    totalEquity,
    equity: totalEquity,
    netIncome,
    totalIncome: Math.round(totalIncome * 100) / 100,
    totalExpenses: Math.round(totalExpenses * 100) / 100,
    isBalanced: Math.abs(difference) < 0.01,
    difference: Math.abs(difference),
  };
}

module.exports = {
  getReportDates,
  calculateAccountNetBalances,
  buildBalanceSheetFromLedger,
};
