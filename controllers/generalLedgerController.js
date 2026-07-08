// controllers/accountSummaryController.js - COMPLETE REDESIGNED VERSION

const prisma = require('../prisma/client');

// ─── HELPER: Check if account has opening balance entry ──────────
async function hasOpeningBalanceEntry(accountId, userId) {
  const entry = await prisma.journalLine.findFirst({
    where: {
      accountId: accountId,
      journal: {
        createdBy: userId,
        description: {
          contains: 'Opening Balance'
        },
        status: 'Posted'
      }
    }
  });
  return entry !== null;
}

// ─── HELPER: Get opening balance from journal entries ─────────────
async function getOpeningBalanceFromJournal(accountId, userId) {
  const lines = await prisma.journalLine.findMany({
    where: {
      accountId: accountId,
      journal: {
        createdBy: userId,
        description: {
          contains: 'Opening Balance'
        },
        status: 'Posted'
      }
    }
  });

  let totalDebit = 0;
  let totalCredit = 0;
  lines.forEach(line => {
    totalDebit += line.debit || 0;
    totalCredit += line.credit || 0;
  });

  return { totalDebit, totalCredit };
}

// ============================================================
// @desc    Get account summaries
// @route   GET /api/general-ledger/accounts
// @access  Private
// ============================================================
exports.getAccountSummaries = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const userId = req.user.id;

    // ─── Build date filter ──────────────────────────────────────
    let dateFilter = {};
    if (startDate && endDate) {
      dateFilter = {
        date: {
          gte: new Date(startDate),
          lte: new Date(endDate),
        }
      };
    }

    // ─── Get posted journal entries for this user ──────────────
    const journalEntries = await prisma.journalEntry.findMany({
      where: {
        createdBy: userId,
        status: 'Posted',
        ...dateFilter
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

    // ─── Get all active accounts for this user ──────────────────
    const accounts = await prisma.chartOfAccount.findMany({
      where: {
        createdBy: userId,
        isActive: true
      },
      orderBy: { code: 'asc' }
    });

    // ─── Calculate summary for each account ─────────────────────
    const accountSummaries = await Promise.all(accounts.map(async (account) => {
      const hasOBEntry = await hasOpeningBalanceEntry(account.id, userId);
      let openingBalanceFromJournal = { totalDebit: 0, totalCredit: 0 };

      if (hasOBEntry) {
        openingBalanceFromJournal = await getOpeningBalanceFromJournal(account.id, userId);
      }

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

      // ─── Calculate closing balance ─────────────────────────────
      let closingBalance;
      let effectiveOpeningBalance;

      if (hasOBEntry) {
        if (account.type === 'Asset' || account.type === 'Expense') {
          effectiveOpeningBalance = openingBalanceFromJournal.totalDebit - openingBalanceFromJournal.totalCredit;
        } else {
          effectiveOpeningBalance = openingBalanceFromJournal.totalCredit - openingBalanceFromJournal.totalDebit;
        }
        
        if (account.type === 'Asset' || account.type === 'Expense') {
          closingBalance = effectiveOpeningBalance + (totalDebit - totalCredit);
        } else {
          closingBalance = effectiveOpeningBalance + (totalCredit - totalDebit);
        }
      } else {
        if (account.type === 'Asset' || account.type === 'Expense') {
          closingBalance = account.openingBalance + totalDebit - totalCredit;
        } else {
          closingBalance = account.openingBalance + totalCredit - totalDebit;
        }
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
        currentBalance: account.currentBalance,
      };
    }));

    // ─── Calculate overall summary for ALL accounts ─────────────
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

    // ─── In double-entry accounting, total closing balance should be ZERO ───
    const netDifference = totalDebitAll - totalCreditAll;
    const isBalanced = Math.abs(netDifference) < 0.01;

    // ─── Prepare response ──────────────────────────────────────────
    const response = {
      success: true,
      count: accountSummaries.length,
      data: accountSummaries,
      summary: {
        // For ALL ACCOUNTS view - NO CLOSING BALANCE
        totalDebit: totalDebitAll,
        totalCredit: totalCreditAll,
        netDifference: netDifference,
        isBalanced: isBalanced,
        totalAccounts: accountSummaries.length,
        activeAccounts: activeAccountsCount,
        // Status message based on balance
        status: isBalanced 
          ? '✅ Balanced (Assets = Liabilities + Equity)' 
          : `⚠️ Not Balanced - Difference: ${Math.abs(netDifference).toFixed(2)}`,
        // This is NULL for All Accounts view - meaning no Closing Balance
        closingBalance: null,
        message: isBalanced 
          ? 'Books are balanced. All accounts net to zero.' 
          : 'Books are NOT balanced. Please check your entries.',
      }
    };

    res.status(200).json(response);
  } catch (error) {
    console.error('❌ Get account summaries error:', error);
    res.status(500).json({
      success: false,
      message: 'Server Error',
      error: error.message,
    });
  }
};

// ============================================================
// @desc    Get single account summary (for specific account view)
// @route   GET /api/general-ledger/account-summary/:accountId
// @access  Private
// ============================================================
exports.getSingleAccountSummary = async (req, res) => {
  try {
    const { accountId } = req.params;
    const { startDate, endDate } = req.query;
    const userId = req.user.id;

    // ─── Verify account belongs to user ──────────────────────────
    const account = await prisma.chartOfAccount.findFirst({
      where: {
        id: accountId,
        createdBy: userId
      }
    });

    if (!account) {
      return res.status(404).json({
        success: false,
        message: 'Account not found',
      });
    }

    // ─── Build date filter ──────────────────────────────────────
    let dateFilter = {};
    if (startDate && endDate) {
      dateFilter = {
        date: {
          gte: new Date(startDate),
          lte: new Date(endDate),
        }
      };
    }

    // ─── Get journal entries for this account ──────────────────
    const journalEntries = await prisma.journalEntry.findMany({
      where: {
        createdBy: userId,
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

    const hasOBEntry = await hasOpeningBalanceEntry(accountId, userId);
    let openingBalanceFromJournal = { totalDebit: 0, totalCredit: 0 };

    if (hasOBEntry) {
      openingBalanceFromJournal = await getOpeningBalanceFromJournal(accountId, userId);
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

    // ─── Calculate closing balance for SINGLE account ──────────
    let closingBalance;
    let effectiveOpeningBalance;

    if (hasOBEntry) {
      if (account.type === 'Asset' || account.type === 'Expense') {
        effectiveOpeningBalance = openingBalanceFromJournal.totalDebit - openingBalanceFromJournal.totalCredit;
      } else {
        effectiveOpeningBalance = openingBalanceFromJournal.totalCredit - openingBalanceFromJournal.totalDebit;
      }
      
      if (account.type === 'Asset' || account.type === 'Expense') {
        closingBalance = effectiveOpeningBalance + (totalDebit - totalCredit);
      } else {
        closingBalance = effectiveOpeningBalance + (totalCredit - totalDebit);
      }
    } else {
      if (account.type === 'Asset' || account.type === 'Expense') {
        closingBalance = account.openingBalance + totalDebit - totalCredit;
      } else {
        closingBalance = account.openingBalance + totalCredit - totalDebit;
      }
    }

    // ─── Prepare response for SINGLE ACCOUNT ──────────────────
    res.status(200).json({
      success: true,
      data: {
        accountId: account.id,
        accountCode: account.code,
        accountName: account.name,
        accountType: account.type,
        // For SINGLE account - show Opening Balance
        openingBalance: account.openingBalance,
        effectiveOpeningBalance: hasOBEntry ? effectiveOpeningBalance : account.openingBalance,
        hasOpeningBalanceEntry: hasOBEntry,
        // For SINGLE account - show Total Debits and Credits
        totalDebit: totalDebit,
        totalCredit: totalCredit,
        // For SINGLE account - show Closing Balance
        closingBalance: closingBalance,
        currentBalance: account.currentBalance,
        // Transaction count
        transactionCount: journalEntries.length,
      }
    });
  } catch (error) {
    console.error('❌ Get single account summary error:', error);
    res.status(500).json({
      success: false,
      message: 'Server Error',
      error: error.message,
    });
  }
};

// ============================================================
// @desc    Get ledger entries for a specific account
// @route   GET /api/general-ledger/entries/:accountId
// @access  Private
// ============================================================
exports.getLedgerEntries = async (req, res) => {
  try {
    const { accountId } = req.params;
    const { startDate, endDate, search } = req.query;
    const userId = req.user.id;

    const account = await prisma.chartOfAccount.findFirst({
      where: {
        id: accountId,
        createdBy: userId
      }
    });

    if (!account) {
      return res.status(404).json({
        success: false,
        message: 'Account not found',
      });
    }

    let query = {
      createdBy: userId,
      status: 'Posted'
    };

    if (startDate && endDate) {
      query.date = {
        gte: new Date(startDate),
        lte: new Date(endDate),
      };
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

    const hasOBEntry = await hasOpeningBalanceEntry(accountId, userId);
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

        if (account.type === 'Asset' || account.type === 'Expense') {
          runningBalance = runningBalance + debit - credit;
        } else {
          runningBalance = runningBalance + credit - debit;
        }

        ledgerEntries.push({
          id: entry.entryNumber,
          date: entry.date,
          accountId: account.id,
          accountName: account.name,
          accountCode: account.code,
          description: entry.description,
          debit: debit,
          credit: credit,
          balance: runningBalance,
          reference: entry.reference,
          isOpeningBalance: entry.description.includes('Opening Balance'),
        });
      }
    });

    let filteredLedger = ledgerEntries;
    if (search) {
      const searchTerm = search.toLowerCase();
      filteredLedger = ledgerEntries.filter(entry =>
        entry.description.toLowerCase().includes(searchTerm) ||
        (entry.reference && entry.reference.toLowerCase().includes(searchTerm)) ||
        entry.id.toLowerCase().includes(searchTerm)
      );
    }

    res.status(200).json({
      success: true,
      account: {
        id: account.id,
        code: account.code,
        name: account.name,
        type: account.type,
        openingBalance: account.openingBalance,
        currentBalance: account.currentBalance,
        hasOpeningBalanceEntry: hasOBEntry,
      },
      count: filteredLedger.length,
      data: filteredLedger,
    });
  } catch (error) {
    console.error('❌ Get ledger entries error:', error);
    res.status(500).json({
      success: false,
      message: 'Server Error',
      error: error.message,
    });
  }
};

// ============================================================
// @desc    Get all ledger entries (all accounts combined)
// @route   GET /api/general-ledger/all-entries
// @access  Private
// ============================================================
exports.getAllLedgerEntries = async (req, res) => {
  try {
    const {
      startDate,
      endDate,
      accountId,
      search,
      page = 1,
      limit = 20,
      sortBy = 'date',
      sortOrder = 'desc'
    } = req.query;

    const userId = req.user.id;

    let query = {
      createdBy: userId,
      status: 'Posted'
    };

    if (startDate && endDate) {
      query.date = {
        gte: new Date(startDate),
        lte: new Date(endDate),
      };
    }

    let filterAccountId = null;
    if (accountId) {
      const account = await prisma.chartOfAccount.findFirst({
        where: {
          id: accountId,
          createdBy: userId
        }
      });

      if (!account) {
        return res.status(404).json({
          success: false,
          message: 'Account not found',
        });
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
        createdBy: userId,
        isActive: true
      }
    });

    const accountBalances = new Map();
    
    for (const account of accounts) {
      const hasOBEntry = await hasOpeningBalanceEntry(account.id, userId);
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
        openingBalance: account.openingBalance,
      });
    }

    const allEntries = [];

    journalEntries.forEach(entry => {
      entry.lines.forEach(line => {
        const accountIdStr = line.accountId;
        const accountData = accountBalances.get(accountIdStr);

        if (accountData) {
          const { debit, credit } = line;

          if (accountData.type === 'Asset' || accountData.type === 'Expense') {
            accountData.balance = accountData.balance + debit - credit;
          } else {
            accountData.balance = accountData.balance + credit - debit;
          }

          if (filterAccountId && accountIdStr !== filterAccountId) {
            return;
          }

          allEntries.push({
            id: entry.entryNumber,
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
            isOpeningBalance: entry.description.includes('Opening Balance'),
          });
        }
      });
    });

    let filteredResult = allEntries;
    if (search) {
      const searchTerm = search.toLowerCase();
      filteredResult = allEntries.filter(entry =>
        entry.description.toLowerCase().includes(searchTerm) ||
        (entry.reference && entry.reference.toLowerCase().includes(searchTerm)) ||
        entry.id.toLowerCase().includes(searchTerm) ||
        entry.accountName.toLowerCase().includes(searchTerm) ||
        entry.accountCode.toLowerCase().includes(searchTerm)
      );
    }

    const sortDirection = sortOrder === 'desc' ? -1 : 1;
    filteredResult.sort((a, b) => {
      switch (sortBy) {
        case 'date':
          return sortDirection * (new Date(a.date) - new Date(b.date));
        case 'debit':
          return sortDirection * (a.debit - b.debit);
        case 'credit':
          return sortDirection * (a.credit - b.credit);
        case 'balance':
          return sortDirection * (a.balance - b.balance);
        case 'accountName':
          return sortDirection * a.accountName.localeCompare(b.accountName);
        default:
          return sortDirection * (new Date(a.date) - new Date(b.date));
      }
    });

    const totalCount = filteredResult.length;

    if (req.query.page === 'all' || req.query.limit === 'all') {
      const totalDebitAll = filteredResult.reduce((sum, entry) => sum + entry.debit, 0);
      const totalCreditAll = filteredResult.reduce((sum, entry) => sum + entry.credit, 0);
      const netDifference = totalDebitAll - totalCreditAll;
      
      return res.status(200).json({
        success: true,
        count: filteredResult.length,
        data: filteredResult,
        summary: {
          totalDebit: totalDebitAll,
          totalCredit: totalCreditAll,
          netDifference: netDifference,
          isBalanced: Math.abs(netDifference) < 0.01,
          // NO closingBalance for All Accounts
          closingBalance: null,
        },
        pagination: {
          total: filteredResult.length,
          page: 1,
          pages: 1,
          hasNext: false,
          hasPrev: false,
          isAllRecords: true
        }
      });
    }

    const pageNum = parseInt(page) || 1;
    const limitNum = parseInt(limit) || 20;
    const skip = (pageNum - 1) * limitNum;

    const paginatedData = filteredResult.slice(skip, skip + limitNum);

    const totalPages = Math.ceil(totalCount / limitNum);
    const hasNext = pageNum < totalPages;
    const hasPrev = pageNum > 1;

    const totalDebit = paginatedData.reduce((sum, entry) => sum + entry.debit, 0);
    const totalCredit = paginatedData.reduce((sum, entry) => sum + entry.credit, 0);
    const netDifference = totalDebit - totalCredit;

    res.status(200).json({
      success: true,
      count: paginatedData.length,
      totalCount: totalCount,
      data: paginatedData,
      summary: {
        totalDebit: totalDebit,
        totalCredit: totalCredit,
        netDifference: netDifference,
        isBalanced: Math.abs(netDifference) < 0.01,
        // NO closingBalance for All Accounts
        closingBalance: null,
      },
      pagination: {
        total: totalCount,
        page: pageNum,
        limit: limitNum,
        pages: totalPages,
        hasNext: hasNext,
        hasPrev: hasPrev,
        nextPage: hasNext ? pageNum + 1 : null,
        prevPage: hasPrev ? pageNum - 1 : null,
        startIndex: skip + 1,
        endIndex: Math.min(skip + limitNum, totalCount),
        isAllRecords: false
      }
    });
  } catch (error) {
    console.error('❌ Get all ledger entries error:', error);
    res.status(500).json({
      success: false,
      message: 'Server Error',
      error: error.message,
    });
  }
};

// ============================================================
// @desc    Get trial balance status
// @route   GET /api/general-ledger/trial-balance
// @access  Private
// ============================================================
exports.getTrialBalanceStatus = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const userId = req.user.id;

    let dateFilter = {};
    if (startDate && endDate) {
      dateFilter = {
        date: {
          gte: new Date(startDate),
          lte: new Date(endDate),
        }
      };
    }

    // ─── Get all journal entries ──────────────────────────────────
    const journalEntries = await prisma.journalEntry.findMany({
      where: {
        createdBy: userId,
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

    // ─── Calculate totals ──────────────────────────────────────────
    let totalDebit = 0;
    let totalCredit = 0;
    const accountBalances = {};

    journalEntries.forEach(entry => {
      entry.lines.forEach(line => {
        totalDebit += line.debit || 0;
        totalCredit += line.credit || 0;

        const accountId = line.accountId;
        if (!accountBalances[accountId]) {
          accountBalances[accountId] = {
            debit: 0,
            credit: 0,
            name: line.account.name,
            code: line.account.code,
            type: line.account.type,
          };
        }
        accountBalances[accountId].debit += line.debit || 0;
        accountBalances[accountId].credit += line.credit || 0;
      });
    });

    const netDifference = totalDebit - totalCredit;
    const isBalanced = Math.abs(netDifference) < 0.01;

    // ─── Prepare trial balance data ──────────────────────────────
    const trialBalanceData = Object.keys(accountBalances).map(accountId => {
      const account = accountBalances[accountId];
      const balance = account.type === 'Asset' || account.type === 'Expense' 
        ? account.debit - account.credit 
        : account.credit - account.debit;
      
      return {
        accountId: accountId,
        accountCode: account.code,
        accountName: account.name,
        accountType: account.type,
        debit: account.debit,
        credit: account.credit,
        balance: balance,
        balanceType: balance >= 0 ? 'Debit' : 'Credit',
      };
    });

    res.status(200).json({
      success: true,
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
        activeAccounts: trialBalanceData.filter(a => a.balance !== 0).length,
      }
    });
  } catch (error) {
    console.error('❌ Get trial balance status error:', error);
    res.status(500).json({
      success: false,
      message: 'Server Error',
      error: error.message,
    });
  }
};

// ============================================================
// @desc    Export all ledger entries
// @route   GET /api/general-ledger/export
// @access  Private
// ============================================================
exports.exportLedgerEntries = async (req, res) => {
  try {
    const { startDate, endDate, accountId } = req.query;
    const userId = req.user.id;

    let query = {
      createdBy: userId,
      status: 'Posted'
    };

    if (startDate && endDate) {
      query.date = {
        gte: new Date(startDate),
        lte: new Date(endDate),
      };
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
        createdBy: userId,
        isActive: true
      }
    });

    const accountBalances = new Map();
    
    for (const account of accounts) {
      const hasOBEntry = await hasOpeningBalanceEntry(account.id, userId);
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
      });
    }

    const exportData = [];

    journalEntries.forEach(entry => {
      entry.lines.forEach(line => {
        const accountIdStr = line.accountId;
        const accountData = accountBalances.get(accountIdStr);

        if (accountData) {
          const { debit, credit } = line;

          if (accountData.type === 'Asset' || accountData.type === 'Expense') {
            accountData.balance = accountData.balance + debit - credit;
          } else {
            accountData.balance = accountData.balance + credit - debit;
          }

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
            isOpeningBalance: entry.description.includes('Opening Balance'),
          });
        }
      });
    });

    const totalDebit = exportData.reduce((sum, e) => sum + e.debit, 0);
    const totalCredit = exportData.reduce((sum, e) => sum + e.credit, 0);
    const netDifference = totalDebit - totalCredit;

    res.status(200).json({
      success: true,
      count: exportData.length,
      data: exportData,
      summary: {
        totalDebit: totalDebit,
        totalCredit: totalCredit,
        netDifference: netDifference,
        isBalanced: Math.abs(netDifference) < 0.01,
        closingBalance: null, // No closing balance for export
      },
      exportDate: new Date().toISOString(),
    });
  } catch (error) {
    console.error('❌ Export ledger entries error:', error);
    res.status(500).json({
      success: false,
      message: 'Server Error',
      error: error.message,
    });
  }
};

// ============================================================
// @desc    Get account transaction history
// @route   GET /api/general-ledger/account-transactions/:accountId
// @access  Private
// ============================================================
exports.getAccountTransactions = async (req, res) => {
  try {
    const { accountId } = req.params;
    const { limit = 10, offset = 0 } = req.query;
    const userId = req.user.id;

    const account = await prisma.chartOfAccount.findFirst({
      where: {
        id: accountId,
        createdBy: userId
      }
    });

    if (!account) {
      return res.status(404).json({
        success: false,
        message: 'Account not found',
      });
    }

    const transactions = await prisma.journalLine.findMany({
      where: {
        accountId: accountId,
        journal: {
          createdBy: userId,
          status: 'Posted'
        }
      },
      include: {
        journal: {
          select: {
            entryNumber: true,
            date: true,
            description: true,
            reference: true,
          }
        }
      },
      orderBy: {
        journal: {
          date: 'desc'
        }
      },
      take: parseInt(limit),
      skip: parseInt(offset),
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
      isOpeningBalance: t.journal.description.includes('Opening Balance'),
    }));

    res.status(200).json({
      success: true,
      account: {
        id: account.id,
        code: account.code,
        name: account.name,
        type: account.type,
        currentBalance: account.currentBalance,
      },
      count: formattedTransactions.length,
      data: formattedTransactions,
    });
  } catch (error) {
    console.error('❌ Get account transactions error:', error);
    res.status(500).json({
      success: false,
      message: 'Server Error',
      error: error.message,
    });
  }
};