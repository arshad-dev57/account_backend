// controllers/generalLedgerController.js - REFACTORED WITH UTILITIES

const prisma = require('../prisma/client');
const ApiResponse = require('../utils/apiResponse');
const asyncHandler = require('../utils/asyncHandler');
const BalanceCalculator = require('../utils/balanceCalculator');
const LedgerHelper = require('../utils/ledgerHelper');

// ============================================================
// @desc    Get account summaries
// @route   GET /api/general-ledger/accounts
// @access  Private
// ============================================================
exports.getAccountSummaries = asyncHandler(async (req, res) => {
  const { startDate, endDate, fiscalYearId } = req.query;
  const userId = req.user.id;
  const companyId = req.user.companyId;

  // Build filters using helper — prefer FY date window over FK-only filter
  let dateFilter = LedgerHelper.buildDateFilter(startDate, endDate);
  let fiscalYearFilter = {};

  if (fiscalYearId && companyId && !startDate && !endDate) {
    const { applyFiscalYearWindow } = require('../utils/fiscalYearHelper');
    const now = new Date();
    const clamped = await applyFiscalYearWindow({
      companyId,
      fiscalYearId,
      start: new Date(now.getFullYear(), 0, 1),
      end: now,
      period: 'This Year'
    });
    dateFilter = {
      date: { gte: clamped.start, lte: clamped.end }
    };
  } else if (fiscalYearId && companyId && (startDate || endDate)) {
    const { applyFiscalYearWindow } = require('../utils/fiscalYearHelper');
    const baseStart = startDate ? new Date(startDate) : new Date(0);
    const baseEnd = endDate ? new Date(endDate) : new Date();
    const clamped = await applyFiscalYearWindow({
      companyId,
      fiscalYearId,
      start: baseStart,
      end: baseEnd,
      period: 'Custom'
    });
    dateFilter = {
      date: { gte: clamped.start, lte: clamped.end }
    };
  } else if (fiscalYearId) {
    fiscalYearFilter = LedgerHelper.buildFiscalYearFilter(fiscalYearId);
  }

  // Get posted journal entries for this user
  const journalEntries = await prisma.journalEntry.findMany({
    where: {
      
      companyId: companyId,
      status: 'Posted',
      ...dateFilter,
      ...fiscalYearFilter
    },
    include: {
      lines: {
        include: {
          account: true
        }
      }
    },
    orderBy: { date: 'asc' }
  });

  // Get all active accounts for this user
  const accounts = await prisma.chartOfAccount.findMany({
    where: {
      
      companyId: companyId,
      isActive: true
    },
    orderBy: { code: 'asc' }
  });

  // Batch query for opening balance entries
  const accountIds = accounts.map(a => a.id);
  const hasOBEntries = await LedgerHelper.hasOpeningBalanceEntries(accountIds, userId);
  const openingBalancesFromJournal = await LedgerHelper.getOpeningBalancesFromJournal(accountIds, userId);

  // Calculate summary for each account
  const accountSummaries = accounts.map((account) => {
    const hasOBEntry = hasOBEntries[account.id] || false;
    const openingBalanceFromJournal = openingBalancesFromJournal[account.id] || { totalDebit: 0, totalCredit: 0 };

    let totalDebit = 0;
    let totalCredit = 0;

    journalEntries.forEach(entry => {
      entry.lines.forEach(line => {
        if (line.accountId === account.id) {
          totalDebit += line.debit || 0;
          totalCredit += line.credit || 0;
        }
      });
    });

    // Calculate closing balance using BalanceCalculator
    let closingBalance;
    let effectiveOpeningBalance;

    if (hasOBEntry) {
      effectiveOpeningBalance = BalanceCalculator.calculateEffectiveOpeningBalance({
        totalDebit: openingBalanceFromJournal.totalDebit,
        totalCredit: openingBalanceFromJournal.totalCredit,
        accountType: account.type
      });
      
      closingBalance = BalanceCalculator.calculateClosingBalance({
        openingBalance: effectiveOpeningBalance,
        totalDebit,
        totalCredit,
        accountType: account.type
      });
    } else {
      closingBalance = BalanceCalculator.calculateClosingBalance({
        openingBalance: account.openingBalance,
        totalDebit,
        totalCredit,
        accountType: account.type
      });
    }

    return {
      accountId: account.id,
      accountCode: account.code,
      accountName: account.name,
      accountType: account.type,
      openingBalance: account.openingBalance,
      effectiveOpeningBalance: hasOBEntry ? effectiveOpeningBalance : account.openingBalance,
      hasOpeningBalanceEntry: hasOBEntry,
      totalDebit,
      totalCredit,
      closingBalance,
      currentBalance: account.currentBalance
    };
  });

  // Calculate overall summary for ALL accounts
  let totalDebitAll = 0;
  let totalCreditAll = 0;
  let totalClosingBalance = 0;
  let totalOpeningBalance = 0;
  let activeAccountsCount = 0;

  accountSummaries.forEach(summary => {
    totalDebitAll += summary.totalDebit;
    totalCreditAll += summary.totalCredit;
    totalClosingBalance += summary.closingBalance;
    totalOpeningBalance += summary.openingBalance;
    if (summary.closingBalance !== 0) {
      activeAccountsCount++;
    }
  });

  // Check if books are balanced
  const netDifference = BalanceCalculator.calculateNetDifference(totalDebitAll, totalCreditAll);
  const isBalanced = BalanceCalculator.isTrialBalanceBalanced(totalDebitAll, totalCreditAll);

  // Prepare response
  const response = {
    count: accountSummaries.length,
    data: accountSummaries,
    summary: {
      totalDebit: totalDebitAll,
      totalCredit: totalCreditAll,
      netDifference: netDifference,
      isBalanced: isBalanced,
      totalAccounts: accountSummaries.length,
      activeAccounts: activeAccountsCount,
      status: isBalanced 
        ? '✅ Balanced (Assets = Liabilities + Equity)' 
        : `⚠️ Not Balanced - Difference: ${Math.abs(netDifference).toFixed(2)}`,
      closingBalance: null,
      message: isBalanced 
        ? 'Books are balanced. All accounts net to zero.' 
        : 'Books are NOT balanced. Please check your entries.'
    }
  };

  return ApiResponse.ok(res, 'Account summaries retrieved successfully', {
    ...response
  });
});

// ============================================================
// @desc    Get single account summary (for specific account view)
// @route   GET /api/general-ledger/account-summary/:accountId
// @access  Private
// ============================================================
exports.getSingleAccountSummary = asyncHandler(async (req, res) => {
  const { accountId } = req.params;
  const { startDate, endDate } = req.query;
  const userId = req.user.id;

    const companyId = req.user.companyId;
  // Verify account belongs to user
  const account = await prisma.chartOfAccount.findFirst({
    where: {
      id: accountId,
      companyId: companyId}
  });

  if (!account) {
    return ApiResponse.notFound(res, 'Account not found');
  }

  // Build date filter using helper
  const dateFilter = LedgerHelper.buildDateFilter(startDate, endDate);

  // Get journal entries for this account
  const journalEntries = await prisma.journalEntry.findMany({
    where: {
      companyId: companyId,
      status: 'Posted',
      ...dateFilter
    },
    include: {
      lines: {
        where: {
          accountId: accountId
        }
      }
    },
    orderBy: { date: 'asc' }
  });

  const hasOBEntry = await LedgerHelper.hasSingleOpeningBalanceEntry(accountId, userId);
  let openingBalanceFromJournal = { totalDebit: 0, totalCredit: 0 };

  if (hasOBEntry) {
    openingBalanceFromJournal = await LedgerHelper.getSingleOpeningBalanceFromJournal(accountId, userId);
  }

  let totalDebit = 0;
  let totalCredit = 0;

  journalEntries.forEach(entry => {
    entry.lines.forEach(line => {
      if (line.accountId === accountId) {
        totalDebit += line.debit || 0;
        totalCredit += line.credit || 0;
      }
    });
  });

  // Calculate closing balance using BalanceCalculator
  let closingBalance;
  let effectiveOpeningBalance;

  if (hasOBEntry) {
    effectiveOpeningBalance = BalanceCalculator.calculateEffectiveOpeningBalance({
      totalDebit: openingBalanceFromJournal.totalDebit,
      totalCredit: openingBalanceFromJournal.totalCredit,
      accountType: account.type
    });
    
    closingBalance = BalanceCalculator.calculateClosingBalance({
      openingBalance: effectiveOpeningBalance,
      totalDebit,
      totalCredit,
      accountType: account.type
    });
  } else {
    closingBalance = BalanceCalculator.calculateClosingBalance({
      openingBalance: account.openingBalance,
      totalDebit,
      totalCredit,
      accountType: account.type
    });
  }

  const response = {
    data: {
      accountId: account.id,
      accountCode: account.code,
      accountName: account.name,
      accountType: account.type,
      openingBalance: account.openingBalance,
      effectiveOpeningBalance: hasOBEntry ? effectiveOpeningBalance : account.openingBalance,
      hasOpeningBalanceEntry: hasOBEntry,
      totalDebit: totalDebit,
      totalCredit: totalCredit,
      closingBalance: closingBalance,
      currentBalance: account.currentBalance,
      transactionCount: journalEntries.length
    }
  };

  return ApiResponse.ok(res, 'Account summary retrieved successfully', {
    ...response
  });
});

// ============================================================
// @desc    Get ledger entries for a specific account
// @route   GET /api/general-ledger/entries/:accountId
// @access  Private
// ============================================================
exports.getLedgerEntries = asyncHandler(async (req, res) => {
  const { accountId } = req.params;
  const {
    startDate,
    endDate,
    search,
    page = 1,
    limit = 10,
    showDebitOnly,
    showCreditOnly
  } = req.query;
  const userId = req.user.id;

    const companyId = req.user.companyId;
  const account = await prisma.chartOfAccount.findFirst({
    where: {
      id: accountId,
      companyId: companyId}
  });

  if (!account) {
    return ApiResponse.notFound(res, 'Account not found');
  }

  let query = {
    companyId: companyId,
    status: 'Posted'
  };

  const dateFilter = LedgerHelper.buildDateFilter(startDate, endDate);
  if (Object.keys(dateFilter).length > 0) {
    query = { ...query, ...dateFilter };
  }

  const journalEntries = await prisma.journalEntry.findMany({
    where: query,
    include: {
      lines: {
        where: {
          accountId: accountId
        }
      }
    },
    orderBy: { date: 'asc' }
  });

  const hasOBEntry = await LedgerHelper.hasSingleOpeningBalanceEntry(accountId, userId);
  let startingBalance = account.openingBalance;

  if (hasOBEntry) {
    startingBalance = 0;
  }

  let runningBalance = startingBalance;
  const ledgerEntries = [];

  journalEntries.forEach(entry => {
    const accountLine = entry.lines.find(line => 
      line.accountId === accountId
    );

    if (accountLine) {
      const { debit, credit } = accountLine;

      runningBalance = BalanceCalculator.calculateRunningBalance({
        currentBalance: runningBalance,
        debit,
        credit,
        accountType: account.type
      });

      ledgerEntries.push({
        id: accountLine.id || `${entry.id}-${account.id}`,
        journalId: entry.id,
        entryNumber: entry.entryNumber,
        date: entry.date,
        accountId: account.id,
        accountName: account.name,
        accountCode: account.code,
        description: entry.description,
        debit: debit,
        credit: credit,
        balance: runningBalance,
        reference: entry.reference,
        isOpeningBalance: entry.description.includes('Opening Balance')
      });
    }
  });

  let filteredLedger = LedgerHelper.filterBySearch(ledgerEntries, search);
  if (showDebitOnly === 'true' || showDebitOnly === true) {
    filteredLedger = filteredLedger.filter((entry) => Number(entry.debit) > 0);
  }
  if (showCreditOnly === 'true' || showCreditOnly === true) {
    filteredLedger = filteredLedger.filter((entry) => Number(entry.credit) > 0);
  }

  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 10));
  const summary = LedgerHelper.calculateSummary(filteredLedger);
  const paginatedResult = LedgerHelper.paginate(filteredLedger, pageNum, limitNum);

  const response = {
    account: {
      id: account.id,
      code: account.code,
      name: account.name,
      type: account.type,
      openingBalance: account.openingBalance,
      currentBalance: account.currentBalance,
      hasOpeningBalanceEntry: hasOBEntry
    },
    count: paginatedResult.data.length,
    totalCount: filteredLedger.length,
    data: paginatedResult.data,
    summary,
    pagination: paginatedResult.pagination
  };

  return ApiResponse.ok(res, 'Ledger entries retrieved successfully', {
    ...response
  });
});

// ============================================================
// @desc    Get all ledger entries (all accounts combined)
// @route   GET /api/general-ledger/all-entries
// @access  Private
// ============================================================
exports.getAllLedgerEntries = asyncHandler(async (req, res) => {
  const {
    startDate,
    endDate,
    accountId,
    search,
    page = 1,
    limit = 10,
    sortBy = 'date',
    sortOrder = 'desc',
    showDebitOnly,
    showCreditOnly
  } = req.query;

  const userId = req.user.id;

    const companyId = req.user.companyId;
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 10));
  // Only cache first page to avoid large cache entries
  if (pageNum === 1) {
  }

  let query = {
    companyId: companyId,
    status: 'Posted'
  };

  const dateFilter = LedgerHelper.buildDateFilter(startDate, endDate);
  if (Object.keys(dateFilter).length > 0) {
    query = { ...query, ...dateFilter };
  }

  let filterAccountId = null;
  if (accountId) {
    const account = await prisma.chartOfAccount.findFirst({
      where: {
        id: accountId,
        companyId: companyId}
    });

    if (!account) {
      return ApiResponse.notFound(res, 'Account not found');
    }
    filterAccountId = accountId;
  }

  const journalEntries = await prisma.journalEntry.findMany({
    where: query,
    include: {
      lines: {
        include: {
          account: true
        }
      }
    },
    orderBy: { date: 'asc' }
  });

  const accounts = await prisma.chartOfAccount.findMany({
    where: {
      companyId: companyId,
      isActive: true
    }
  });

  // Batch query for opening balance entries
  const accountIds = accounts.map(a => a.id);
  const hasOBEntries = await LedgerHelper.hasOpeningBalanceEntries(accountIds, userId);
  
  const accountBalances = new Map();
  
  for (const account of accounts) {
    const hasOBEntry = hasOBEntries[account.id] || false;
    let startingBalance = account.openingBalance;

    if (hasOBEntry) {
      startingBalance = 0;
    }

    accountBalances.set(account.id, {
      balance: startingBalance,
      type: account.type,
      code: account.code,
      name: account.name,
      id: account.id,
      hasOBEntry: hasOBEntry,
      openingBalance: account.openingBalance
    });
  }

  const allEntries = [];

  journalEntries.forEach(entry => {
    entry.lines.forEach(line => {
      const accountIdStr = line.accountId;
      const accountData = accountBalances.get(accountIdStr);

      if (accountData) {
        const { debit, credit } = line;

        accountData.balance = BalanceCalculator.calculateRunningBalance({
          currentBalance: accountData.balance,
          debit,
          credit,
          accountType: accountData.type
        });

        if (filterAccountId && accountIdStr !== filterAccountId) {
          return;
        }

        allEntries.push({
          id: line.id || `${entry.id}-${accountIdStr}`,
          journalId: entry.id,
          entryNumber: entry.entryNumber,
          date: entry.date,
          accountId: accountIdStr,
          accountName: accountData.name,
          accountCode: accountData.code,
          description: entry.description,
          debit: debit,
          credit: credit,
          balance: accountData.balance,
          reference: entry.reference || '',
          accountType: accountData.type,
          isOpeningBalance: entry.description.includes('Opening Balance')
        });
      }
    });
  });

  let filteredResult = LedgerHelper.filterBySearch(allEntries, search);
  if (showDebitOnly === 'true' || showDebitOnly === true) {
    filteredResult = filteredResult.filter((entry) => Number(entry.debit) > 0);
  }
  if (showCreditOnly === 'true' || showCreditOnly === true) {
    filteredResult = filteredResult.filter((entry) => Number(entry.credit) > 0);
  }
  filteredResult = LedgerHelper.sortEntries(filteredResult, sortBy, sortOrder);

  const totalCount = filteredResult.length;
  const summary = LedgerHelper.calculateSummary(filteredResult);

  if (req.query.page === 'all' || req.query.limit === 'all') {
    return ApiResponse.ok(res, 'All ledger entries retrieved successfully', {
      count: filteredResult.length,
      totalCount,
      data: filteredResult,
      summary: {
        ...summary,
        closingBalance: null
      },
      pagination: {
        total: filteredResult.length,
        page: 1,
        limit: filteredResult.length,
        pages: 1,
        hasNext: false,
        hasPrev: false,
        isAllRecords: true
      }
    });
  }

  const paginatedResult = LedgerHelper.paginate(filteredResult, pageNum, limitNum);

  const response = {
    count: paginatedResult.data.length,
    totalCount: totalCount,
    data: paginatedResult.data,
    summary: {
      ...summary,
      closingBalance: null
    },
    pagination: paginatedResult.pagination
  };

  // Cache only first page (2 minutes TTL)
  if (pageNum === 1) {
  }

  return ApiResponse.ok(res, 'All ledger entries retrieved successfully', {
    ...response
  });
});

// ============================================================
// @desc    Get trial balance status
// @route   GET /api/general-ledger/trial-balance
// @access  Private
// ============================================================
exports.getTrialBalanceStatus = asyncHandler(async (req, res) => {
  const { startDate, endDate } = req.query;
  const userId = req.user.id;

    const companyId = req.user.companyId;
  const dateFilter = LedgerHelper.buildDateFilter(startDate, endDate);

  // Get all journal entries
  const journalEntries = await prisma.journalEntry.findMany({
    where: {
      companyId: companyId,
      status: 'Posted',
      ...dateFilter
    },
    include: {
      lines: {
        include: {
          account: true
        }
      }
    }
  });

  // Calculate totals
  const accountBalances = {};

  journalEntries.forEach(entry => {
    entry.lines.forEach(line => {
      const accountId = line.accountId;
      if (!accountBalances[accountId]) {
        accountBalances[accountId] = {
          debit: 0,
          credit: 0,
          name: line.account.name,
          code: line.account.code,
          type: line.account.type
        };
      }
      accountBalances[accountId].debit += line.debit || 0;
      accountBalances[accountId].credit += line.credit || 0;
    });
  });

  const totalDebit = Object.values(accountBalances).reduce((sum, acc) => sum + acc.debit, 0);
  const totalCredit = Object.values(accountBalances).reduce((sum, acc) => sum + acc.credit, 0);
  const netDifference = BalanceCalculator.calculateNetDifference(totalDebit, totalCredit);
  const isBalanced = BalanceCalculator.isTrialBalanceBalanced(totalDebit, totalCredit);

  // Prepare trial balance data
  const trialBalanceData = Object.keys(accountBalances).map(accountId => {
    const account = accountBalances[accountId];
    const balance = BalanceCalculator.calculateAccountBalance({
      debit: account.debit,
      credit: account.credit,
      accountType: account.type
    });
    
    return {
      accountId: accountId,
      accountCode: account.code,
      accountName: account.name,
      accountType: account.type,
      debit: account.debit,
      credit: account.credit,
      balance: balance,
      balanceType: BalanceCalculator.getBalanceType(balance)
    };
  });

  const response = {
    data: {
      totalDebit: totalDebit,
      totalCredit: totalCredit,
      netDifference: netDifference,
      isBalanced: isBalanced,
      status: isBalanced 
        ? '✅ TRIAL BALANCE IS BALANCED' 
        : `⚠️ TRIAL BALANCE IS NOT BALANCED - Difference: ${Math.abs(netDifference).toFixed(2)}`,
      message: isBalanced 
        ? 'Assets = Liabilities + Equity ✓' 
        : 'Please check your journal entries for errors.',
      period: {
        startDate: startDate || null,
        endDate: endDate || null
      },
      accounts: trialBalanceData,
      totalAccounts: trialBalanceData.length,
      activeAccounts: trialBalanceData.filter(a => a.balance !== 0).length
    }
  };

  return ApiResponse.ok(res, 'Trial balance retrieved successfully', {
    ...response
  });
});

// ============================================================
// @desc    Export all ledger entries
// @route   GET /api/general-ledger/export
// @access  Private
// ============================================================
exports.exportLedgerEntries = asyncHandler(async (req, res) => {
  const { startDate, endDate, accountId } = req.query;
  const userId = req.user.id;

    const companyId = req.user.companyId;
  let query = {
    companyId: companyId,
    status: 'Posted'
  };

  const dateFilter = LedgerHelper.buildDateFilter(startDate, endDate);
  if (Object.keys(dateFilter).length > 0) {
    query = { ...query, ...dateFilter };
  }

  const journalEntries = await prisma.journalEntry.findMany({
    where: query,
    include: {
      lines: {
        include: {
          account: true
        }
      }
    },
    orderBy: { date: 'asc' }
  });

  const accounts = await prisma.chartOfAccount.findMany({
    where: {
      companyId: companyId,
      isActive: true
    }
  });

  // Batch query for opening balance entries
  const accountIds = accounts.map(a => a.id);
  const hasOBEntries = await LedgerHelper.hasOpeningBalanceEntries(accountIds, userId);

  const accountBalances = new Map();
  
  for (const account of accounts) {
    const hasOBEntry = hasOBEntries[account.id] || false;
    let startingBalance = account.openingBalance;

    if (hasOBEntry) {
      startingBalance = 0;
    }

    accountBalances.set(account.id, {
      balance: startingBalance,
      type: account.type,
      code: account.code,
      name: account.name,
      id: account.id
    });
  }

  const exportData = [];

  journalEntries.forEach(entry => {
    entry.lines.forEach(line => {
      const accountIdStr = line.accountId;
      const accountData = accountBalances.get(accountIdStr);

      if (accountData) {
        const { debit, credit } = line;

        accountData.balance = BalanceCalculator.calculateRunningBalance({
          currentBalance: accountData.balance,
          debit,
          credit,
          accountType: accountData.type
        });

        if (accountId && accountIdStr !== accountId) {
          return;
        }

        exportData.push({
          entryNumber: entry.entryNumber,
          date: entry.date.toISOString().split('T')[0],
          accountCode: accountData.code,
          accountName: accountData.name,
          accountType: accountData.type,
          description: entry.description,
          reference: entry.reference || '',
          debit: debit,
          credit: credit,
          balance: accountData.balance,
          isOpeningBalance: entry.description.includes('Opening Balance')
        });
      }
    });
  });

  const summary = LedgerHelper.calculateSummary(exportData);

  const response = {
    count: exportData.length,
    data: exportData,
    summary: {
      ...summary,
      closingBalance: null
    },
    exportDate: new Date().toISOString()
  };

  return ApiResponse.ok(res, 'Export data retrieved successfully', {
    ...response
  });
});

// ============================================================
// @desc    Get account transaction history
// @route   GET /api/general-ledger/account-transactions/:accountId
// @access  Private
// ============================================================
exports.getAccountTransactions = asyncHandler(async (req, res) => {
  const { accountId } = req.params;
  const { limit = 10, offset = 0 } = req.query;
  const userId = req.user.id;

    const companyId = req.user.companyId;
  const account = await prisma.chartOfAccount.findFirst({
    where: {
      id: accountId,
      companyId: companyId}
  });

  if (!account) {
    return ApiResponse.notFound(res, 'Account not found');
  }

  const transactions = await prisma.journalLine.findMany({
    where: {
      accountId: accountId,
      journal: {
        companyId: companyId,
        status: 'Posted'
      }
    },
    include: {
      journal: {
        select: {
          entryNumber: true,
          date: true,
          description: true,
          reference: true
        }
      }
    },
    orderBy: {
      journal: {
        date: 'desc'
      }
    },
    take: parseInt(limit),
    skip: parseInt(offset)
  });

  const formattedTransactions = transactions.map(t => ({
    id: t.id,
    entryNumber: t.journal.entryNumber,
    date: t.journal.date,
    description: t.journal.description,
    reference: t.journal.reference,
    debit: t.debit,
    credit: t.credit,
    accountName: t.accountName,
    accountCode: t.accountCode,
    isOpeningBalance: t.journal.description.includes('Opening Balance')
  }));

  const response = {
    account: {
      id: account.id,
      code: account.code,
      name: account.name,
      type: account.type,
      currentBalance: account.currentBalance
    },
    count: formattedTransactions.length,
    data: formattedTransactions
  };

  return ApiResponse.ok(res, 'Account transactions retrieved successfully', {
    ...response
  });
});