// controllers/chartOfAccountController.js - COMPLETE FIXED VERSION (No Helpers)

const prisma = require('../prisma/client');
const { get, set, del, delPattern } = require('../utils/redisClient');
const BalanceCalculator = require('../utils/balanceCalculator');

// ─── CONSTANTS ─────────────────────────────────────────────────────
const VALID_ACCOUNT_TYPES = ['Asset', 'Liability', 'Equity', 'Revenue', 'Expense'];
const DEBIT_BALANCE_TYPES = ['Asset', 'Expense'];
const CREDIT_BALANCE_TYPES = ['Liability', 'Equity', 'Revenue'];

// ─── TYPE MAPPING ──────────────────────────────────────────────────
const TYPE_MAP = {
  'Assets': 'Asset',
  'Asset': 'Asset',
  'Liabilities': 'Liability',
  'Liability': 'Liability',
  'Equity': 'Equity',
  'Income': 'Revenue',
  'Revenue': 'Revenue',
  'Expenses': 'Expense',
  'Expense': 'Expense'
};
const ALLOWED_ACCOUNT_SORT = ['code', 'name', 'type', 'currentBalance', 'createdAt', 'updatedAt'];

// ─── CORE LOGIC: Opening Balance Management ───────────────────────

/**
 * Get or create Opening Balance Equity account
 */
async function getOrCreateOpeningBalanceEquity(userId, companyId) {
  let equityAccount = await prisma.chartOfAccount.findFirst({
    where: {
      OR: [
        { code: '3010', companyId: companyId, companyId: companyId },
        { name: 'Opening Balance Equity', companyId: companyId, companyId: companyId },
        { name: "Owner's Capital", companyId: companyId, companyId: companyId }
      ]
    }
  });

  if (!equityAccount) {
    equityAccount = await prisma.chartOfAccount.create({
      data: {
        code: '3010',
        name: 'Opening Balance Equity',
        type: 'Equity',
        parentAccount: 'Equity',
        openingBalance: 0,
        currentBalance: 0,
        description: 'Opening balance equity account - DO NOT DELETE',
        taxCode: 'N/A',
        balanceType: 'Credit',
        isActive: true,
        createdBy: userId,
        companyId: companyId
      }
    });
  }

  return equityAccount;
}

/**
 * Check if opening balance journal entry exists
 */
async function getOpeningBalanceEntry(userId, companyId) {
  return await prisma.journalEntry.findFirst({
    where: {
      
      companyId: companyId,
      description: {
        contains: 'Opening Balance'
      },
      status: 'Posted'
    },
    include: {
      lines: {
        include: {
          account: true
        }
      }
    }
  });
}

/**
 * Check if opening entry is balanced
 */
async function isOpeningEntryBalanced(journalId) {
  const lines = await prisma.journalLine.findMany({
    where: { journalId }
  });

  const totalDebit = lines.reduce((sum, l) => sum + l.debit, 0);
  const totalCredit = lines.reduce((sum, l) => sum + l.credit, 0);

  return Math.abs(totalDebit - totalCredit) < 0.001;
}

/**
 * Create or update opening balance journal entry
 */
async function createOrUpdateOpeningBalanceEntry(
  userId,
  accountId,
  accountType,
  amount,
  accountName,
  accountCode
) {
  // Get or create opening balance entry
  let openingEntry = await getOpeningBalanceEntry(userId);

  // Get or create equity account
  const equityAccount = await getOrCreateOpeningBalanceEquity(userId);

  if (!openingEntry) {
    // ─── CREATE NEW OPENING BALANCE ENTRY ───────────────────────
    const isDebit = DEBIT_BALANCE_TYPES.includes(accountType);
    
    openingEntry = await prisma.journalEntry.create({
      data: {
        entryNumber: `OB-${Date.now()}`,
        date: new Date(),
        description: 'Opening Balance Initialization',
        reference: 'SYSTEM-OB',
        status: 'Posted',
        createdBy: userId,
        postedBy: userId,
        postedAt: new Date(),
        lines: {
          create: [
            {
              accountId: accountId,
              accountName: accountName,
              accountCode: accountCode,
              debit: isDebit ? amount : 0,
              credit: !isDebit ? amount : 0,
              isReconciled: false
            },
            {
              accountId: equityAccount.id,
              accountName: equityAccount.name,
              accountCode: equityAccount.code,
              debit: !isDebit ? amount : 0,
              credit: isDebit ? amount : 0,
              isReconciled: false
            }
          ]
        }
      },
      include: {
        lines: {
          include: {
            account: true
          }
        }
      }
    });
  } else {
    // ─── UPDATE EXISTING OPENING BALANCE ENTRY ──────────────────
    const existingLine = openingEntry.lines.find(
      line => line.accountId === accountId
    );

    if (!existingLine) {
      const isDebit = DEBIT_BALANCE_TYPES.includes(accountType);
      
      await prisma.journalLine.create({
        data: {
          journalId: openingEntry.id,
          accountId: accountId,
          accountName: accountName,
          accountCode: accountCode,
          debit: isDebit ? amount : 0,
          credit: !isDebit ? amount : 0,
          isReconciled: false
        }
      });

      // Update equity line to balance
      const allLines = await prisma.journalLine.findMany({
        where: { journalId: openingEntry.id }
      });

      let totalDebit = allLines.reduce((sum, l) => sum + l.debit, 0);
      let totalCredit = allLines.reduce((sum, l) => sum + l.credit, 0);
      const difference = totalDebit - totalCredit;

      const equityLine = allLines.find(l => l.accountId === equityAccount.id);
      if (equityLine) {
        if (difference > 0) {
          await prisma.journalLine.update({
            where: { id: equityLine.id },
            data: { debit: 0, credit: difference }
          });
        } else if (difference < 0) {
          await prisma.journalLine.update({
            where: { id: equityLine.id },
            data: { debit: Math.abs(difference), credit: 0 }
          });
        } else {
          await prisma.journalLine.update({
            where: { id: equityLine.id },
            data: { debit: 0, credit: 0 }
          });
        }
      }

      // Re-fetch updated entry
      openingEntry = await prisma.journalEntry.findUnique({
        where: { id: openingEntry.id },
        include: {
          lines: {
            include: {
              account: true
            }
          }
        }
      });
    } else {
      // ─── UPDATE EXISTING LINE ──────────────────────────────────
      const isDebit = DEBIT_BALANCE_TYPES.includes(accountType);
      await prisma.journalLine.update({
        where: { id: existingLine.id },
        data: {
          debit: isDebit ? amount : 0,
          credit: !isDebit ? amount : 0
        }
      });

      // Recalculate and update equity line
      const allLines = await prisma.journalLine.findMany({
        where: { journalId: openingEntry.id }
      });

      let totalDebit = allLines.reduce((sum, l) => sum + l.debit, 0);
      let totalCredit = allLines.reduce((sum, l) => sum + l.credit, 0);
      const difference = totalDebit - totalCredit;

      const equityLine = allLines.find(l => l.accountId === equityAccount.id);
      if (equityLine) {
        if (difference > 0) {
          await prisma.journalLine.update({
            where: { id: equityLine.id },
            data: { debit: 0, credit: difference }
          });
        } else if (difference < 0) {
          await prisma.journalLine.update({
            where: { id: equityLine.id },
            data: { debit: Math.abs(difference), credit: 0 }
          });
        } else {
          await prisma.journalLine.update({
            where: { id: equityLine.id },
            data: { debit: 0, credit: 0 }
          });
        }
      }
    }

    // Update account balance
    await prisma.chartOfAccount.update({
      where: { id: accountId },
      data: { currentBalance: amount }
    });

    // Update equity account balance
    const equityBalance = await getEquityBalance(openingEntry.id);
    await prisma.chartOfAccount.update({
      where: { id: equityAccount.id },
      data: { currentBalance: equityBalance }
    });
  }

  return openingEntry;
}

/**
 * Get total equity balance from opening entry
 */
async function getEquityBalance(journalId) {
  const lines = await prisma.journalLine.findMany({
    where: { journalId }
  });

  let totalDebit = lines.reduce((sum, l) => sum + l.debit, 0);
  let totalCredit = lines.reduce((sum, l) => sum + l.credit, 0);
  
  return totalCredit - totalDebit;
}

// ============================================================
// CREATE ACCOUNT - REDESIGNED
// ============================================================
const createAccount = async (req, res) => {
  try {
    let {
      code,
      name,
      type,
      parentAccount,
      openingBalance,
      description,
      taxCode,
      isActive,
      isOpeningBalance = true
    } = req.body;

    const userId = req.user.id;

    const companyId = req.user.companyId;
    // ─── Validation ──────────────────────────────────────────────
    if (!code || !name || !type) {
      return res.status(400).json({
        success: false,
        message: 'Code, name, and type are required'
      });
    }

    // ─── Map frontend type to backend type ──────────────────────
    if (TYPE_MAP[type]) {
      type = TYPE_MAP[type];
    }

    if (!VALID_ACCOUNT_TYPES.includes(type)) {
      return res.status(400).json({
        success: false,
        message: `Invalid account type. Must be one of: ${VALID_ACCOUNT_TYPES.join(', ')}`
      });
    }

    // ─── Check account code uniqueness ──────────────────────────
    const existingAccount = await prisma.chartOfAccount.findFirst({
      where: {
        code: code,
        companyId: companyId}
    });

    if (existingAccount) {
      return res.status(400).json({
        success: false,
        message: `Account code "${code}" already exists.`
      });
    }

    // ─── Determine balance type ──────────────────────────────────
    const balanceType = DEBIT_BALANCE_TYPES.includes(type) ? 'Debit' : 'Credit';

    // ─── Create account ──────────────────────────────────────────
    const account = await prisma.chartOfAccount.create({
      data: {
        code,
        name,
        type,
        parentAccount: parentAccount || '',
        openingBalance: openingBalance || 0,
        currentBalance: openingBalance || 0,
        balanceType: balanceType,
        description: description || '',
        taxCode: taxCode || 'N/A',
        isActive: isActive !== undefined ? isActive : true,
        createdBy: userId
      },
      include: {
        creator: {
          select: { id: true, firstName: true, lastName: true, email: true }
        }
      }
    });

    // ─── HANDLE OPENING BALANCE ──────────────────────────────────
    if (openingBalance && openingBalance > 0 && isOpeningBalance !== false) {
      await createOrUpdateOpeningBalanceEntry(
        userId,
        account.id,
        type,
        openingBalance,
        name,
        code
      );

      await prisma.chartOfAccount.update({
        where: { id: account.id },
        data: { currentBalance: openingBalance }
      });
    }

    const openingEntry = await getOpeningBalanceEntry(userId);
    const isBalanced = openingEntry ? await isOpeningEntryBalanced(openingEntry.id) : false;

    res.status(201).json({
      success: true,
      message: 'Account created successfully',
      data: {
        account,
        openingBalanceEntry: openingEntry ? {
          id: openingEntry.id,
          entryNumber: openingEntry.entryNumber,
          isBalanced
        } : null
      }
    });

    // Invalidate cache after successful account creation
    try {
      await delPattern(`coa:accounts:${userId}:*`);
      await delPattern(`coa:account:${userId}:*`);
      await delPattern(`coa:summary:${userId}`);
      await delPattern(`coa:search:${userId}:*`);
      await delPattern(`coa:by-type:${userId}:*`);
      await delPattern(`coa:stats:${userId}`);
      await delPattern(`coa:ob-status:${userId}`);
      await delPattern(`coa:ob-summary:${userId}`);
      console.log('🗑️ [COA] Cache invalidated after account creation');
    } catch (cacheError) {
      console.log('⚠️ [COA] Cache invalidation error:', cacheError.message);
    }
  } catch (error) {
    console.error('❌ Create account error:', error);
    res.status(500).json({
      success: false,
      message: 'Server Error',
      error: error.message
    });
  }
};

// ============================================================
// GET OPENING BALANCE STATUS
// ============================================================
const getOpeningBalanceStatus = async (req, res) => {
  try {
    const userId = req.user.id;

    const companyId = req.user.companyId;
    // Build cache key
    const cacheKey = `coa:ob-status:${userId}`;
    
    // Try to get from cache
    const cached = await get(cacheKey);
    if (cached) {
      return res.status(200).json({
        success: true,
        data: cached,
        cached: true,
      });
    }

    const entry = await getOpeningBalanceEntry(userId);
    const equityAccount = await getOrCreateOpeningBalanceEquity(userId);

    let status = {
      hasOpeningBalance: false,
      isBalanced: false,
      totalDebit: 0,
      totalCredit: 0,
      difference: 0,
      entries: [],
      equityAccount: {
        id: equityAccount.id,
        code: equityAccount.code,
        name: equityAccount.name,
        balance: equityAccount.currentBalance
      }
    };

    if (entry) {
      const lines = await prisma.journalLine.findMany({
        where: { journalId: entry.id },
        include: {
          account: {
            select: {
              id: true,
              code: true,
              name: true,
              type: true
            }
          }
        }
      });

      let totalDebit = 0;
      let totalCredit = 0;

      const entries = lines.map(line => {
        totalDebit += line.debit;
        totalCredit += line.credit;
        return {
          accountId: line.accountId,
          accountCode: line.account.code,
          accountName: line.account.name,
          accountType: line.account.type,
          debit: line.debit,
          credit: line.credit
        };
      });

      status.hasOpeningBalance = true;
      status.isBalanced = Math.abs(totalDebit - totalCredit) < 0.001;
      status.totalDebit = totalDebit;
      status.totalCredit = totalCredit;
      status.difference = totalDebit - totalCredit;
      status.entries = entries;
      status.entryId = entry.id;
      status.entryNumber = entry.entryNumber;
      status.date = entry.date;
      status.description = entry.description;
    }

    // Cache the result (2 minutes TTL)
    await set(cacheKey, status, 120);

    res.status(200).json({
      success: true,
      data: status,
      cached: false,
    });
  } catch (error) {
    console.error('❌ Get opening balance status error:', error);
    res.status(500).json({
      success: false,
      message: 'Server Error',
      error: error.message
    });
  }
};

// ============================================================
// GET OPENING BALANCE SUMMARY
// ============================================================
const getOpeningBalanceSummary = async (req, res) => {
  try {
    const userId = req.user.id;

    const companyId = req.user.companyId;
    // Build cache key
    const cacheKey = `coa:ob-summary:${userId}`;
    
    // Try to get from cache
    const cached = await get(cacheKey);
    if (cached) {
      return res.status(200).json({
        success: true,
        data: cached,
        cached: true,
      });
    }

    const entry = await getOpeningBalanceEntry(userId);
    
    if (!entry) {
      const noDataResponse = {
        hasOpeningBalance: false,
        message: 'No opening balance entry found'
      };

      // Cache the result (2 minutes TTL)
      await set(cacheKey, noDataResponse, 120);

      return res.status(200).json({
        success: true,
        data: noDataResponse,
        cached: false,
      });
    }

    const lines = await prisma.journalLine.findMany({
      where: { journalId: entry.id },
      include: {
        account: {
          select: {
            id: true,
            code: true,
            name: true,
            type: true,
            balanceType: true
          }
        }
      }
    });

    const summary = {
      Assets: { count: 0, total: 0 },
      Liabilities: { count: 0, total: 0 },
      Equity: { count: 0, total: 0 },
      Income: { count: 0, total: 0 },
      Expenses: { count: 0, total: 0 }
    };

    let totalDebit = 0;
    let totalCredit = 0;

    lines.forEach(line => {
      const type = line.account.type === 'Revenue' ? 'Income' : line.account.type;
      if (summary[type]) {
        summary[type].count++;
        summary[type].total += line.debit + line.credit;
      }
      totalDebit += line.debit;
      totalCredit += line.credit;
    });

    const summaryData = {
      hasOpeningBalance: true,
      isBalanced: Math.abs(totalDebit - totalCredit) < 0.001,
      totalDebit,
      totalCredit,
      difference: totalDebit - totalCredit,
      summary,
      entries: lines.map(line => ({
        accountCode: line.account.code,
        accountName: line.account.name,
        accountType: line.account.type,
        debit: line.debit,
        credit: line.credit
      }))
    };

    // Cache the result (2 minutes TTL)
    await set(cacheKey, summaryData, 120);

    res.status(200).json({
      success: true,
      data: summaryData,
      cached: false,
    });
  } catch (error) {
    console.error('❌ Get opening balance summary error:', error);
    res.status(500).json({
      success: false,
      message: 'Server Error',
      error: error.message
    });
  }
};

// ============================================================
// VALIDATE OPENING BALANCE
// ============================================================
const validateOpeningBalance = async (req, res) => {
  try {
    const userId = req.user.id;
    const companyId = req.user.companyId;
    const { entries } = req.body;

    if (!entries || !Array.isArray(entries)) {
      return res.status(400).json({
        success: false,
        message: 'Entries array is required'
      });
    }

    let totalDebit = 0;
    let totalCredit = 0;

    const validatedEntries = [];
    for (const entry of entries) {
      const { accountId, amount, type } = entry;
      
      const account = await prisma.chartOfAccount.findFirst({
        where: {
          id: accountId,
          companyId: companyId}
      });

      if (!account) {
        return res.status(400).json({
          success: false,
          message: `Account not found: ${accountId}`
        });
      }

      const isDebit = DEBIT_BALANCE_TYPES.includes(account.type);
      const debit = isDebit ? amount : 0;
      const credit = !isDebit ? amount : 0;

      totalDebit += debit;
      totalCredit += credit;

      validatedEntries.push({
        accountId,
        accountCode: account.code,
        accountName: account.name,
        accountType: account.type,
        debit,
        credit,
        amount
      });
    }

    const isBalanced = Math.abs(totalDebit - totalCredit) < 0.001;

    res.status(200).json({
      success: true,
      data: {
        isBalanced,
        totalDebit,
        totalCredit,
        difference: totalDebit - totalCredit,
        entries: validatedEntries,
        message: isBalanced 
          ? 'Opening balance is balanced ✓' 
          : 'Opening balance is NOT balanced. Please add difference to Equity account.'
      }
    });
  } catch (error) {
    console.error('❌ Validate opening balance error:', error);
    res.status(500).json({
      success: false,
      message: 'Server Error',
      error: error.message
    });
  }
};

// ============================================================
// GET ALL ACCOUNTS
// ============================================================
const getAccounts = async (req, res) => {
  try {
    const {
      type,
      search,
      page = 1,
      limit = 10,
      sortBy = 'code',
      sortOrder = 'asc'
    } = req.query;

    const userId = req.user.id;

    const companyId = req.user.companyId;

    const filter = { 
      companyId: companyId,
      isActive: true
    };

    let backendType = type;
    if (type && type !== 'All' && TYPE_MAP[type]) {
      backendType = TYPE_MAP[type];
    }

    if (backendType && backendType !== 'All') {
      filter.type = backendType;
    }

    const searchTerm = typeof search === 'string' ? search.trim() : '';
    if (searchTerm) {
      filter.OR = [
        { code: { contains: searchTerm, mode: 'insensitive' } },
        { name: { contains: searchTerm, mode: 'insensitive' } }
      ];
    }

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 10));
    const skip = (pageNum - 1) * limitNum;
    const safeSortBy = ALLOWED_ACCOUNT_SORT.includes(sortBy) ? sortBy : 'code';
    const safeSortOrder = sortOrder === 'desc' ? 'desc' : 'asc';

    // Build cache key with parameters (v4: company-wide stats + clamped pagination)
    const cacheKey = `coa:accounts:${userId}:v4:${backendType || 'All'}:${searchTerm}:${pageNum}:${limitNum}:${safeSortBy}:${safeSortOrder}`;
    
    // Try to get from cache
    const cached = await get(cacheKey);
    if (cached) {
      return res.status(200).json({
        success: true,
        ...cached,
        cached: true,
      });
    }

    const orderBy = {};
    orderBy[safeSortBy] = safeSortOrder;

    const [accounts, totalCount, typeAggregates] = await Promise.all([
      prisma.chartOfAccount.findMany({
        where: filter,
        skip,
        take: limitNum,
        orderBy,
        include: {
          creator: {
            select: { id: true, firstName: true, lastName: true, email: true }
          }
        }
      }),
      prisma.chartOfAccount.count({ where: filter }),
      prisma.chartOfAccount.groupBy({
        by: ['type'],
        where: filter,
        _sum: { currentBalance: true }
      })
    ]);

    // Derive balances from posted journal lines (source of truth)
    const accountIds = accounts.map((a) => a.id);
    let debitCreditByAccount = {};
    if (accountIds.length > 0) {
      const lineAggs = await prisma.journalLine.groupBy({
        by: ['accountId'],
        where: {
          accountId: { in: accountIds },
          journal: {
            companyId,
            status: 'Posted',
          },
        },
        _sum: { debit: true, credit: true },
      });
      debitCreditByAccount = Object.fromEntries(
        lineAggs.map((row) => [
          row.accountId,
          {
            debit: Number(row._sum.debit || 0),
            credit: Number(row._sum.credit || 0),
          },
        ])
      );
    }

    const accountsWithBalances = accounts.map((account) => {
      const sums = debitCreditByAccount[account.id] || { debit: 0, credit: 0 };
      const accountType = BalanceCalculator.normalizeAccountType(account.type);
      const jeBalance = BalanceCalculator.calculateAccountBalance({
        debit: sums.debit,
        credit: sums.credit,
        accountType,
      });
      // If no JE activity yet, keep stored currentBalance (opening / manual)
      const hasJe = sums.debit !== 0 || sums.credit !== 0;
      const balance = hasJe ? jeBalance : Number(account.currentBalance || 0);
      return {
        ...account,
        currentBalance: balance,
        debitTotal: sums.debit,
        creditTotal: sums.credit,
      };
    });

    // Persist JE-derived balances so Trial Balance / other screens stay consistent
    await Promise.all(
      accountsWithBalances.map((acc) => {
        if (Number(acc.currentBalance) === Number(accounts.find((a) => a.id === acc.id)?.currentBalance || 0)) {
          return null;
        }
        return prisma.chartOfAccount.update({
          where: { id: acc.id },
          data: { currentBalance: acc.currentBalance },
        });
      })
    );

    const summary = {
      Assets: 0,
      Liabilities: 0,
      Equity: 0,
      Income: 0,
      Expenses: 0
    };

    typeAggregates.forEach((row) => {
      const amount = Number(row._sum?.currentBalance || 0);
      if (row.type === 'Asset') summary.Assets = amount;
      else if (row.type === 'Liability') summary.Liabilities = amount;
      else if (row.type === 'Equity') summary.Equity = amount;
      else if (row.type === 'Revenue') summary.Income = amount;
      else if (row.type === 'Expense') summary.Expenses = amount;
    });

    const totalPages = Math.max(1, Math.ceil(totalCount / limitNum) || 1);
    const startIndex = totalCount === 0 ? 0 : skip + 1;
    const endIndex = Math.min(skip + accountsWithBalances.length, totalCount);

    const responseData = {
      count: accountsWithBalances.length,
      totalCount: totalCount,
      data: accountsWithBalances,
      summary,
      stats: {
        total: totalCount,
        assetTotal: summary.Assets,
        liabilityTotal: summary.Liabilities,
        equityTotal: summary.Equity,
        revenueTotal: summary.Income,
        expenseTotal: summary.Expenses
      },
      pagination: {
        total: totalCount,
        page: pageNum,
        limit: limitNum,
        pages: totalPages,
        hasNext: pageNum < totalPages && skip + accountsWithBalances.length < totalCount,
        hasPrev: pageNum > 1,
        nextPage: pageNum < totalPages ? pageNum + 1 : null,
        prevPage: pageNum > 1 ? pageNum - 1 : null,
        startIndex,
        endIndex
      }
    };

    // Cache the result (5 minutes TTL)
    await set(cacheKey, responseData, 300);

    res.status(200).json({
      success: true,
      ...responseData,
      cached: false,
    });
  } catch (error) {
    console.error('❌ Get accounts error:', error);
    res.status(500).json({
      success: false,
      message: 'Server Error',
      error: error.message
    });
  }
};

// ============================================================
// GET SINGLE ACCOUNT
// ============================================================
const getAccount = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const companyId = req.user.companyId;
    // Build cache key
    const cacheKey = `coa:account:${userId}:${id}`;
    
    // Try to get from cache
    const cached = await get(cacheKey);
    if (cached) {
      return res.status(200).json({
        success: true,
        data: cached,
        cached: true,
      });
    }

    const account = await prisma.chartOfAccount.findFirst({
      where: {
        id,
        companyId: companyId},
      include: {
        creator: {
          select: { id: true, firstName: true, lastName: true, email: true }
        }
      }
    });

    if (!account) {
      return res.status(404).json({
        success: false,
        message: 'Account not found'
      });
    }

    // Cache the result (10 minutes TTL)
    await set(cacheKey, account, 600);

    res.status(200).json({
      success: true,
      data: account,
      cached: false,
    });
  } catch (error) {
    console.error('❌ Get account error:', error);
    res.status(500).json({
      success: false,
      message: 'Server Error',
      error: error.message
    });
  }
};

// ============================================================
// UPDATE ACCOUNT
// ============================================================
const updateAccount = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const companyId = req.user.companyId;
    let {
      code,
      name,
      type,
      parentAccount,
      openingBalance,
      description,
      taxCode,
      isActive
    } = req.body;

    const existing = await prisma.chartOfAccount.findFirst({
      where: {
        id,
        companyId: companyId}
    });

    if (!existing) {
      return res.status(404).json({
        success: false,
        message: 'Account not found'
      });
    }

    if (type && TYPE_MAP[type]) {
      type = TYPE_MAP[type];
    }

    if (type) {
      if (!VALID_ACCOUNT_TYPES.includes(type)) {
        return res.status(400).json({
          success: false,
          message: `Invalid account type. Must be one of: ${VALID_ACCOUNT_TYPES.join(', ')}`
        });
      }

      const nameLower = (name || existing.name).toLowerCase();
      const isCashOrBank = nameLower.includes('cash') || 
                          nameLower.includes('bank') || 
                          nameLower.includes('money') ||
                          nameLower.includes('checking') ||
                          nameLower.includes('saving');
      
      if (isCashOrBank && type !== 'Asset') {
        return res.status(400).json({
          success: false,
          message: `"${name || existing.name}" must be of type "Asset".`,
          suggestion: 'Cash and Bank accounts should always be "Asset" type.',
          fixable: true
        });
      }

      const oldType = existing.type;
      const oldIsDebitType = DEBIT_BALANCE_TYPES.includes(oldType);
      const newIsDebitType = DEBIT_BALANCE_TYPES.includes(type);
      
      if (oldIsDebitType !== newIsDebitType && existing.currentBalance !== 0) {
        return res.status(400).json({
          success: false,
          message: `Cannot change type from "${oldType}" to "${type}" with non-zero balance.`,
          currentBalance: existing.currentBalance,
          requiresForce: true
        });
      }
    }

    if (code && code !== existing.code) {
      const duplicate = await prisma.chartOfAccount.findFirst({
        where: {
          code: code,
          companyId: companyId,
          id: { not: id }
        }
      });
      if (duplicate) {
        return res.status(400).json({
          success: false,
          message: `Account code "${code}" already exists.`
        });
      }
    }

    const updateData = {};
    if (code) updateData.code = code;
    if (name) updateData.name = name;
    if (type) {
      updateData.type = type;
      updateData.balanceType = DEBIT_BALANCE_TYPES.includes(type) ? 'Debit' : 'Credit';
    }
    if (parentAccount !== undefined) updateData.parentAccount = parentAccount;
    if (openingBalance !== undefined) updateData.openingBalance = parseFloat(openingBalance);
    if (description !== undefined) updateData.description = description;
    if (taxCode !== undefined) updateData.taxCode = taxCode;
    if (isActive !== undefined) updateData.isActive = isActive;

    const updated = await prisma.chartOfAccount.update({
      where: { id },
      data: updateData,
      include: {
        creator: {
          select: { id: true, firstName: true, lastName: true, email: true }
        }
      }
    });

    res.status(200).json({
      success: true,
      message: 'Account updated successfully',
      data: updated
    });

    // Invalidate cache after successful account update
    try {
      await delPattern(`coa:accounts:${userId}:*`);
      await delPattern(`coa:account:${userId}:${id}`);
      await delPattern(`coa:summary:${userId}`);
      await delPattern(`coa:search:${userId}:*`);
      await delPattern(`coa:by-type:${userId}:*`);
      await delPattern(`coa:stats:${userId}`);
      console.log('🗑️ [COA] Cache invalidated after account update');
    } catch (cacheError) {
      console.log('⚠️ [COA] Cache invalidation error:', cacheError.message);
    }
  } catch (error) {
    console.error('❌ Update account error:', error);
    res.status(500).json({
      success: false,
      message: 'Server Error',
      error: error.message
    });
  }
};

// ============================================================
// DELETE ACCOUNT
// ============================================================
const deleteAccount = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const companyId = req.user.companyId;
    const account = await prisma.chartOfAccount.findFirst({
      where: {
        id,
        companyId: companyId}
    });

    if (!account) {
      return res.status(404).json({
        success: false,
        message: 'Account not found'
      });
    }

    if (account.currentBalance !== 0) {
      return res.status(400).json({
        success: false,
        message: `Cannot delete account "${account.name}" with non-zero balance.`,
        currentBalance: account.currentBalance
      });
    }

    const usedInEntries = await prisma.journalLine.findFirst({
      where: { accountId: id }
    });

    if (usedInEntries) {
      return res.status(400).json({
        success: false,
        message: `Cannot delete account "${account.name}" as it is used in journal entries.`
      });
    }

    await prisma.chartOfAccount.delete({
      where: { id }
    });

    res.status(200).json({
      success: true,
      message: `Account "${account.name}" deleted successfully`
    });

    // Invalidate cache after successful account deletion
    try {
      await delPattern(`coa:accounts:${userId}:*`);
      await delPattern(`coa:account:${userId}:${id}`);
      await delPattern(`coa:summary:${userId}`);
      await delPattern(`coa:search:${userId}:*`);
      await delPattern(`coa:by-type:${userId}:*`);
      await delPattern(`coa:stats:${userId}`);
      console.log('🗑️ [COA] Cache invalidated after account deletion');
    } catch (cacheError) {
      console.log('⚠️ [COA] Cache invalidation error:', cacheError.message);
    }
  } catch (error) {
    console.error('❌ Delete account error:', error);
    res.status(500).json({
      success: false,
      message: 'Server Error',
      error: error.message
    });
  }
};

// ============================================================
// ARCHIVE ACCOUNT
// ============================================================
const archiveAccount = async (req, res) => {
  try {
    const { id } = req.params;
    const { isActive } = req.body;
    const userId = req.user.id;

    const companyId = req.user.companyId;
    const account = await prisma.chartOfAccount.findFirst({
      where: {
        id,
        companyId: companyId}
    });

    if (!account) {
      return res.status(404).json({
        success: false,
        message: 'Account not found'
      });
    }

    if (isActive === false && account.currentBalance !== 0) {
      return res.status(400).json({
        success: false,
        message: `Cannot deactivate account "${account.name}" with non-zero balance.`,
        currentBalance: account.currentBalance
      });
    }

    const newStatus = isActive !== undefined ? isActive : !account.isActive;
    const updated = await prisma.chartOfAccount.update({
      where: { id },
      data: { isActive: newStatus }
    });

    res.status(200).json({
      success: true,
      message: updated.isActive ? 'Account activated successfully' : 'Account archived successfully',
      data: updated
    });

    // Invalidate cache after successful account archive/activate
    try {
      await delPattern(`coa:accounts:${userId}:*`);
      await delPattern(`coa:account:${userId}:${id}`);
      await delPattern(`coa:summary:${userId}`);
      await delPattern(`coa:search:${userId}:*`);
      await delPattern(`coa:by-type:${userId}:*`);
      await delPattern(`coa:stats:${userId}`);
      console.log('🗑️ [COA] Cache invalidated after account archive');
    } catch (cacheError) {
      console.log('⚠️ [COA] Cache invalidation error:', cacheError.message);
    }
  } catch (error) {
    console.error('❌ Archive account error:', error);
    res.status(500).json({
      success: false,
      message: 'Server Error',
      error: error.message
    });
  }
};

// ============================================================
// GET ACCOUNT SUMMARY
// ============================================================
const getAccountSummary = async (req, res) => {
  try {
    const userId = req.user.id;

    const companyId = req.user.companyId;
    // Build cache key
    const cacheKey = `coa:summary:${userId}`;
    
    // Try to get from cache
    const cached = await get(cacheKey);
    if (cached) {
      return res.status(200).json({
        success: true,
        data: cached,
        cached: true,
      });
    }

    const accounts = await prisma.chartOfAccount.findMany({
      where: {
        companyId: companyId,
        isActive: true
      }
    });

    const summary = {
      Assets: 0,
      Liabilities: 0,
      Equity: 0,
      Income: 0,
      Expenses: 0,
      totalBalance: 0
    };

    accounts.forEach(account => {
      const typeKey = account.type === 'Revenue' ? 'Income' : account.type;
      if (summary[typeKey] !== undefined) {
        summary[typeKey] += account.currentBalance;
      }
      summary.totalBalance += account.currentBalance;
    });

    const summaryData = {
      accounts,
      summary
    };

    // Cache the result (2 minutes TTL)
    await set(cacheKey, summaryData, 120);

    res.status(200).json({
      success: true,
      data: summaryData,
      cached: false,
    });
  } catch (error) {
    console.error('❌ Get account summary error:', error);
    res.status(500).json({
      success: false,
      message: 'Server Error',
      error: error.message
    });
  }
};

// ============================================================
// SEARCH ACCOUNTS
// ============================================================
const searchAccounts = async (req, res) => {
  try {
    const { q, limit = 20 } = req.query;
    const userId = req.user.id;

    const companyId = req.user.companyId;
    if (!q || q.length < 1) {
      return res.status(400).json({
        success: false,
        message: 'Search query is required'
      });
    }

    // Build cache key with parameters
    const cacheKey = `coa:search:${userId}:${q}:${limit}`;
    
    // Try to get from cache
    const cached = await get(cacheKey);
    if (cached) {
      return res.status(200).json({
        success: true,
        ...cached,
        cached: true,
      });
    }

    const accounts = await prisma.chartOfAccount.findMany({
      where: {
        companyId: companyId,
        isActive: true,
        OR: [
          { code: { contains: q, mode: 'insensitive' } },
          { name: { contains: q, mode: 'insensitive' } }
        ]
      },
      take: parseInt(limit),
      orderBy: { code: 'asc' }
    });

    const responseData = {
      count: accounts.length,
      data: accounts
    };

    // Cache the result (5 minutes TTL)
    await set(cacheKey, responseData, 300);

    res.status(200).json({
      success: true,
      ...responseData,
      cached: false,
    });
  } catch (error) {
    console.error('❌ Search accounts error:', error);
    res.status(500).json({
      success: false,
      message: 'Server Error',
      error: error.message
    });
  }
};

// ============================================================
// UPDATE ACCOUNT BALANCE
// ============================================================
const updateAccountBalance = async (req, res) => {
  try {
    const { id } = req.params;
    const { amount, type = 'add' } = req.body;
    const userId = req.user.id;

    const companyId = req.user.companyId;
    if (amount === undefined || amount === null) {
      return res.status(400).json({
        success: false,
        message: 'Amount is required'
      });
    }

    const account = await prisma.chartOfAccount.findFirst({
      where: {
        id,
        companyId: companyId}
    });

    if (!account) {
      return res.status(404).json({
        success: false,
        message: 'Account not found'
      });
    }

    let newBalance = account.currentBalance;
    const amountNum = parseFloat(amount);

    if (type === 'add') {
      newBalance += amountNum;
    } else if (type === 'subtract') {
      newBalance -= amountNum;
    } else if (type === 'set') {
      newBalance = amountNum;
    } else {
      return res.status(400).json({
        success: false,
        message: 'Invalid type. Use: add, subtract, or set'
      });
    }

    const updated = await prisma.chartOfAccount.update({
      where: { id },
      data: { currentBalance: newBalance }
    });

    res.status(200).json({
      success: true,
      message: 'Balance updated successfully',
      data: {
        currentBalance: updated.currentBalance,
        previousBalance: account.currentBalance,
        change: newBalance - account.currentBalance
      }
    });

    // Invalidate cache after successful balance update
    try {
      await delPattern(`coa:accounts:${userId}:*`);
      await delPattern(`coa:account:${userId}:${id}`);
      await delPattern(`coa:summary:${userId}`);
      await delPattern(`coa:stats:${userId}`);
      console.log('🗑️ [COA] Cache invalidated after balance update');
    } catch (cacheError) {
      console.log('⚠️ [COA] Cache invalidation error:', cacheError.message);
    }
  } catch (error) {
    console.error('❌ Update balance error:', error);
    res.status(500).json({
      success: false,
      message: 'Server Error',
      error: error.message
    });
  }
};

// ============================================================
// GET ACCOUNTS BY TYPE
// ============================================================
const getAccountsByType = async (req, res) => {
  try {
    let { type } = req.params;
    const userId = req.user.id;

    const companyId = req.user.companyId;
    if (TYPE_MAP[type]) {
      type = TYPE_MAP[type];
    }

    if (!VALID_ACCOUNT_TYPES.includes(type)) {
      return res.status(400).json({
        success: false,
        message: `Invalid account type. Must be one of: ${VALID_ACCOUNT_TYPES.join(', ')}`
      });
    }

    // Build cache key
    const cacheKey = `coa:by-type:${userId}:${type}`;
    
    // Try to get from cache
    const cached = await get(cacheKey);
    if (cached) {
      return res.status(200).json({
        success: true,
        ...cached,
        cached: true,
      });
    }

    const accounts = await prisma.chartOfAccount.findMany({
      where: {
        type,
        companyId: companyId,
        isActive: true
      },
      orderBy: { code: 'asc' }
    });

    const responseData = {
      count: accounts.length,
      data: accounts
    };

    // Cache the result (5 minutes TTL)
    await set(cacheKey, responseData, 300);

    res.status(200).json({
      success: true,
      ...responseData,
      cached: false,
    });
  } catch (error) {
    console.error('❌ Get accounts by type error:', error);
    res.status(500).json({
      success: false,
      message: 'Server Error',
      error: error.message
    });
  }
};

// ============================================================
// FIX ACCOUNT TYPE
// ============================================================
const fixAccountType = async (req, res) => {
  try {
    const { id } = req.params;
    let { type } = req.body;
    const userId = req.user.id;

    const companyId = req.user.companyId;
    if (!type) {
      return res.status(400).json({
        success: false,
        message: 'Type is required'
      });
    }

    if (TYPE_MAP[type]) {
      type = TYPE_MAP[type];
    }

    if (!VALID_ACCOUNT_TYPES.includes(type)) {
      return res.status(400).json({
        success: false,
        message: `Invalid account type. Must be one of: ${VALID_ACCOUNT_TYPES.join(', ')}`
      });
    }

    const account = await prisma.chartOfAccount.findFirst({
      where: {
        id,
        companyId: companyId}
    });

    if (!account) {
      return res.status(404).json({
        success: false,
        message: 'Account not found'
      });
    }

    const updated = await prisma.chartOfAccount.update({
      where: { id },
      data: {
        type: type,
        balanceType: DEBIT_BALANCE_TYPES.includes(type) ? 'Debit' : 'Credit'
      }
    });

    res.status(200).json({
      success: true,
      message: `Account type force-changed from "${account.type}" to "${type}"`,
      data: updated,
      warning: '⚠️ This is a force update. Please verify the balance is now correct.'
    });

    // Invalidate cache after successful account type fix
    try {
      await delPattern(`coa:accounts:${userId}:*`);
      await delPattern(`coa:account:${userId}:${id}`);
      await delPattern(`coa:summary:${userId}`);
      await delPattern(`coa:search:${userId}:*`);
      await delPattern(`coa:by-type:${userId}:*`);
      await delPattern(`coa:stats:${userId}`);
      console.log('🗑️ [COA] Cache invalidated after account type fix');
    } catch (cacheError) {
      console.log('⚠️ [COA] Cache invalidation error:', cacheError.message);
    }
  } catch (error) {
    console.error('❌ Fix account type error:', error);
    res.status(500).json({
      success: false,
      message: 'Server Error',
      error: error.message
    });
  }
};

// ============================================================
// FIX CASH ACCOUNTS
// ============================================================
const fixCashAccounts = async (req, res) => {
  try {
    const userId = req.user.id;

    const companyId = req.user.companyId;
    const accounts = await prisma.chartOfAccount.findMany({
      where: {
        companyId: companyId,
        OR: [
          { name: { contains: 'cash', mode: 'insensitive' } },
          { name: { contains: 'bank', mode: 'insensitive' } },
          { name: { contains: 'money', mode: 'insensitive' } },
          { name: { contains: 'checking', mode: 'insensitive' } },
          { name: { contains: 'saving', mode: 'insensitive' } },
          { name: { contains: 'current', mode: 'insensitive' } },
          { name: { contains: 'savings', mode: 'insensitive' } },
          { name: { contains: 'petty cash', mode: 'insensitive' } }
        ],
        type: { not: 'Asset' }
      }
    });

    if (accounts.length === 0) {
      return res.status(200).json({
        success: true,
        message: '✅ No cash/bank accounts with incorrect type found',
        count: 0
      });
    }

    const results = [];
    for (const account of accounts) {
      const updated = await prisma.chartOfAccount.update({
        where: { id: account.id },
        data: {
          type: 'Asset',
          balanceType: 'Debit'
        }
      });
      results.push({
        id: account.id,
        name: account.name,
        code: account.code,
        oldType: account.type,
        newType: 'Asset',
        balance: account.currentBalance,
        fixed: true
      });
    }

    res.status(200).json({
      success: true,
      message: `✅ ${results.length} cash/bank account(s) fixed successfully`,
      count: results.length,
      data: results
    });

    // Invalidate cache after successful cash accounts fix
    try {
      await delPattern(`coa:accounts:${userId}:*`);
      await delPattern(`coa:summary:${userId}`);
      await delPattern(`coa:search:${userId}:*`);
      await delPattern(`coa:by-type:${userId}:*`);
      await delPattern(`coa:stats:${userId}`);
      console.log('🗑️ [COA] Cache invalidated after cash accounts fix');
    } catch (cacheError) {
      console.log('⚠️ [COA] Cache invalidation error:', cacheError.message);
    }
  } catch (error) {
    console.error('❌ Fix cash accounts error:', error);
    res.status(500).json({
      success: false,
      message: 'Server Error',
      error: error.message
    });
  }
};

// ============================================================
// GET ACCOUNT TYPE STATS
// ============================================================
const getAccountTypeStats = async (req, res) => {
  try {
    const userId = req.user.id;

    const companyId = req.user.companyId;
    // Build cache key
    const cacheKey = `coa:stats:${userId}`;
    
    // Try to get from cache
    const cached = await get(cacheKey);
    if (cached) {
      return res.status(200).json({
        success: true,
        data: cached,
        cached: true,
      });
    }

    const stats = {};
    for (const type of VALID_ACCOUNT_TYPES) {
      const count = await prisma.chartOfAccount.count({
        where: {
          companyId: companyId,
          type: type,
          isActive: true
        }
      });
      
      const balance = await prisma.chartOfAccount.aggregate({
        where: {
          companyId: companyId,
          type: type,
          isActive: true
        },
        _sum: {
          currentBalance: true
        }
      });

      const frontendType = type === 'Revenue' ? 'Income' : type;
      stats[frontendType] = {
        count,
        totalBalance: balance._sum.currentBalance || 0
      };
    }

    const incorrectCashAccounts = await prisma.chartOfAccount.count({
      where: {
        companyId: companyId,
        OR: [
          { name: { contains: 'cash', mode: 'insensitive' } },
          { name: { contains: 'bank', mode: 'insensitive' } },
          { name: { contains: 'money', mode: 'insensitive' } }
        ],
        type: { not: 'Asset' }
      }
    });

    const statsData = {
      stats,
      issues: {
        incorrectCashAccounts,
        hasIssues: incorrectCashAccounts > 0,
        message: incorrectCashAccounts > 0 
          ? `${incorrectCashAccounts} cash/bank account(s) have incorrect type` 
          : 'All cash/bank accounts are correctly typed'
      }
    };

    // Cache the result (2 minutes TTL)
    await set(cacheKey, statsData, 120);

    res.status(200).json({
      success: true,
      data: statsData,
      cached: false,
    });
  } catch (error) {
    console.error('❌ Get account type stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Server Error',
      error: error.message
    });
  }
};

// ============================================================
// BULK IMPORT ACCOUNTS
// ============================================================
const bulkImportAccounts = async (req, res) => {
  try {
    const { accounts } = req.body;
    const userId = req.user.id;

    const companyId = req.user.companyId;
    if (!accounts || !Array.isArray(accounts) || accounts.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Please provide an array of accounts'
      });
    }

    const results = {
      success: [],
      failed: [],
      total: accounts.length
    };

    for (const accountData of accounts) {
      try {
        const { code, name, type, parentAccount, openingBalance, description, taxCode } = accountData;

        if (!code || !name || !type) {
          results.failed.push({ ...accountData, error: 'Missing required fields' });
          continue;
        }

        let backendType = TYPE_MAP[type] || type;
        if (!VALID_ACCOUNT_TYPES.includes(backendType)) {
          results.failed.push({ ...accountData, error: `Invalid type: ${type}` });
          continue;
        }

        const existing = await prisma.chartOfAccount.findFirst({
          where: {
            code: code,
            companyId: companyId}
        });

        if (existing) {
          results.failed.push({ ...accountData, error: `Code "${code}" already exists` });
          continue;
        }

        const account = await prisma.chartOfAccount.create({
          data: {
            code,
            name,
            type: backendType,
            parentAccount: parentAccount || '',
            openingBalance: openingBalance || 0,
            currentBalance: openingBalance || 0,
            balanceType: DEBIT_BALANCE_TYPES.includes(backendType) ? 'Debit' : 'Credit',
            description: description || '',
            taxCode: taxCode || 'N/A',
            isActive: true,
            createdBy: userId
          }
        });

        results.success.push(account);
      } catch (error) {
        results.failed.push({ ...accountData, error: error.message });
      }
    }

    res.status(201).json({
      success: true,
      message: `Successfully imported ${results.success.length} of ${results.total} accounts`,
      data: results
    });

    // Invalidate cache after successful bulk import
    try {
      await delPattern(`coa:accounts:${userId}:*`);
      await delPattern(`coa:account:${userId}:*`);
      await delPattern(`coa:summary:${userId}`);
      await delPattern(`coa:search:${userId}:*`);
      await delPattern(`coa:by-type:${userId}:*`);
      await delPattern(`coa:stats:${userId}`);
      console.log('🗑️ [COA] Cache invalidated after bulk import');
    } catch (cacheError) {
      console.log('⚠️ [COA] Cache invalidation error:', cacheError.message);
    }
  } catch (error) {
    console.error('❌ Bulk import error:', error);
    res.status(500).json({
      success: false,
      message: 'Server Error',
      error: error.message
    });
  }
};

// ─── EXPORT ALL FUNCTIONS ──────────────────────────────────────────
module.exports = {
  createAccount,
  getAccounts,
  getAccount,
  updateAccount,
  deleteAccount,
  archiveAccount,
  getAccountSummary,
  searchAccounts,
  updateAccountBalance,
  getAccountsByType,
  fixAccountType,
  fixCashAccounts,
  getAccountTypeStats,
  bulkImportAccounts,
  getOpeningBalanceStatus,
  getOpeningBalanceSummary,
  validateOpeningBalance
};