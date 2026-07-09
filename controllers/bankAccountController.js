// controllers/bankAccountController.js - FIXED VERSION

const BankAccountModel = require('../models/BankAccount');
const prisma = require('../prisma/client');

// ─── HELPER: Get or create Opening Balance Equity ────────────────
async function getOrCreateOpeningBalanceEquity(userId) {
  let equityAccount = await prisma.chartOfAccount.findFirst({
    where: {
      OR: [
        { code: '3010', createdBy: userId },
        { name: 'Opening Balance Equity', createdBy: userId }
      ]
    }
  });

  if (!equityAccount) {
    const maxCode = await prisma.chartOfAccount.aggregate({
      where: { createdBy: userId },
      _max: { code: true }
    });
    
    let newCode = '3010';
    if (maxCode._max.code) {
      const num = parseInt(maxCode._max.code) + 1;
      newCode = num.toString();
    }

    equityAccount = await prisma.chartOfAccount.create({
      data: {
        code: newCode,
        name: 'Opening Balance Equity',
        type: 'Equity',
        parentAccount: 'Equity',
        openingBalance: 0,
        currentBalance: 0,
        description: 'Opening balance equity account - DO NOT DELETE',
        taxCode: 'N/A',
        balanceType: 'Credit',
        isActive: true,
        createdBy: userId
      }
    });
  }

  return equityAccount;
}

// ─── HELPER: Get or create opening balance entry ──────────────────
async function getOrCreateOpeningBalanceEntry(userId) {
  let openingEntry = await prisma.journalEntry.findFirst({
    where: {
      createdBy: userId,
      description: {
        contains: 'Opening Balance'
      },
      status: 'Posted'
    }
  });

  if (!openingEntry) {
    openingEntry = await prisma.journalEntry.create({
      data: {
        entryNumber: `OB-${Date.now()}`,
        date: new Date(),
        description: 'Opening Balance Initialization',
        reference: 'SYSTEM-OB',
        status: 'Posted',
        createdBy: userId,
        postedBy: userId,
        postedAt: new Date()
      }
    });
  }

  return openingEntry;
}

// ─── HELPER: Generate unique account code ─────────────────────────
async function generateUniqueAccountCode(userId) {
  const accounts = await prisma.chartOfAccount.findMany({
    where: { createdBy: userId },
    select: { code: true },
    orderBy: { code: 'asc' }
  });

  if (accounts.length === 0) {
    return '1010';
  }

  const codes = accounts
    .map(a => parseInt(a.code))
    .filter(c => !isNaN(c))
    .sort((a, b) => a - b);

  if (codes.length === 0) {
    return '1010';
  }

  let nextCode = Math.max(...codes) + 1;
  
  if (nextCode > 9999) {
    for (let i = 1010; i < 9999; i++) {
      if (!codes.includes(i)) {
        nextCode = i;
        break;
      }
    }
  }

  return nextCode.toString();
}

// ============================================================
// @desc    Create new bank account
// @route   POST /api/bank-accounts
// @access  Private
// ============================================================
exports.createBankAccount = async (req, res) => {
  try {
    const {
      accountName,
      accountNumber,
      bankName,
      branchCode,
      accountType,
      currency,
      openingBalance,
      status
    } = req.body;

    const userId = req.user.id;

    if (!accountName || !accountNumber || !bankName) {
      return res.status(400).json({
        success: false,
        message: 'Account name, account number and bank name are required'
      });
    }

    const existingAccount = await BankAccountModel.findByAccountNumber(accountNumber, userId);
    if (existingAccount) {
      return res.status(400).json({
        success: false,
        message: 'Bank account number already exists'
      });
    }

    const accountCode = await generateUniqueAccountCode(userId);

    const chartAccount = await prisma.chartOfAccount.create({
      data: {
        code: accountCode,
        name: accountName,
        type: 'Asset',
        parentAccount: 'Current Assets',
        openingBalance: openingBalance || 0,
        currentBalance: openingBalance || 0,
        description: `${bankName} bank account - ${accountNumber}`,
        taxCode: 'N/A',
        balanceType: 'Debit',
        isActive: true,
        createdBy: userId
      }
    });

    // FIXED: Set BOTH userId AND createdBy to the current user
    const bankAccount = await BankAccountModel.create({
      accountName,
      accountNumber,
      bankName,
      branchCode: branchCode || '',
      accountType: accountType || 'Current',
      currency: currency || 'PKR',
      openingBalance: openingBalance || 0,
      status: status || 'Active',
      chartOfAccountId: chartAccount.id,
      createdBy: userId,
      userId: userId  // FIXED: Set userId as well
    });

    if (openingBalance && openingBalance > 0) {
      const openingEntry = await getOrCreateOpeningBalanceEntry(userId);
      const equityAccount = await getOrCreateOpeningBalanceEquity(userId);

      const existingLine = await prisma.journalLine.findFirst({
        where: {
          journalId: openingEntry.id,
          accountId: chartAccount.id
        }
      });

      if (!existingLine) {
        await prisma.journalLine.create({
          data: {
            journalId: openingEntry.id,
            accountId: chartAccount.id,
            accountName: chartAccount.name,
            accountCode: chartAccount.code,
            debit: openingBalance,
            credit: 0,
            isReconciled: false
          }
        });

        const allLines = await prisma.journalLine.findMany({
          where: { journalId: openingEntry.id }
        });

        let totalDebit = allLines.reduce((sum, l) => sum + l.debit, 0);
        let totalCredit = allLines.reduce((sum, l) => sum + l.credit, 0);
        const difference = totalDebit - totalCredit;

        let equityLine = allLines.find(l => l.accountId === equityAccount.id);
        
        if (!equityLine) {
          equityLine = await prisma.journalLine.create({
            data: {
              journalId: openingEntry.id,
              accountId: equityAccount.id,
              accountName: equityAccount.name,
              accountCode: equityAccount.code,
              debit: 0,
              credit: 0,
              isReconciled: false
            }
          });
        }

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
        }

        const updatedLines = await prisma.journalLine.findMany({
          where: { journalId: openingEntry.id }
        });

        const equityBalance = updatedLines.reduce((sum, l) => {
          if (l.accountId === equityAccount.id) {
            return sum + l.credit - l.debit;
          }
          return sum;
        }, 0);

        await prisma.chartOfAccount.update({
          where: { id: equityAccount.id },
          data: { currentBalance: equityBalance }
        });
      }
    }

    res.status(201).json({
      success: true,
      data: bankAccount,
      message: 'Bank account created successfully'
    });
  } catch (error) {
    console.error('❌ Create bank account error:', error);

    if (error.code === 'P2002') {
      return res.status(400).json({
        success: false,
        message: 'Duplicate entry. Please try again with different details.'
      });
    }

    res.status(500).json({
      success: false,
      message: error.message || 'Server Error'
    });
  }
};

// ============================================================
// @desc    Get all bank accounts - FIXED to use BOTH userId and createdBy
// @route   GET /api/bank-accounts
// @access  Private
// ============================================================
exports.getBankAccounts = async (req, res) => {
  try {
    const { status, search, page = 1, limit = 10 } = req.query;
    const userId = req.user.id;

    // FIXED: Search using BOTH userId AND createdBy
    const filter = {
      OR: [
        { userId: userId },
        { createdBy: userId }
      ]
    };

    if (status && status !== 'All') {
      filter.status = status;
    }

    if (search) {
      filter.AND = [
        {
          OR: [
            { userId: userId },
            { createdBy: userId }
          ]
        },
        {
          OR: [
            { accountName: { contains: search, mode: 'insensitive' } },
            { accountNumber: { contains: search, mode: 'insensitive' } },
            { bankName: { contains: search, mode: 'insensitive' } }
          ]
        }
      ];
    }

    const pageNum = parseInt(page) || 1;
    const limitNum = parseInt(limit) || 10;
    const skip = (pageNum - 1) * limitNum;

    const bankAccounts = await prisma.bankAccount.findMany({
      where: filter,
      skip,
      take: limitNum,
      orderBy: { createdAt: 'desc' },
      include: {
        chartOfAccount: {
          select: {
            id: true,
            code: true,
            name: true,
            currentBalance: true
          }
        },
        creator: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true
          }
        }
      }
    });

    const accountsWithBalance = bankAccounts.map(account => {
      return {
        ...account,
        currentBalance: account.chartOfAccount?.currentBalance || account.currentBalance
      };
    });

    const totalCount = await prisma.bankAccount.count({ where: filter });
    const totalPages = Math.ceil(totalCount / limitNum);

    res.status(200).json({
      success: true,
      count: accountsWithBalance.length,
      total: totalCount,
      page: pageNum,
      pages: totalPages,
      data: accountsWithBalance
    });
  } catch (error) {
    console.error('❌ Get bank accounts error:', error);
    res.status(500).json({
      success: false,
      message: 'Server Error',
      error: error.message
    });
  }
};

// ============================================================
// @desc    Get single bank account - FIXED to use BOTH userId and createdBy
// @route   GET /api/bank-accounts/:id
// @access  Private
// ============================================================
exports.getBankAccount = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const bankAccount = await prisma.bankAccount.findFirst({
      where: {
        id,
        OR: [
          { userId: userId },
          { createdBy: userId }
        ]
      },
      include: {
        chartOfAccount: {
          select: {
            id: true,
            code: true,
            name: true,
            type: true,
            currentBalance: true
          }
        },
        creator: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true
          }
        }
      }
    });

    if (!bankAccount) {
      return res.status(404).json({
        success: false,
        message: 'Bank account not found'
      });
    }

    res.status(200).json({
      success: true,
      data: bankAccount
    });
  } catch (error) {
    console.error('❌ Get bank account error:', error);
    res.status(500).json({
      success: false,
      message: 'Server Error',
      error: error.message
    });
  }
};

// ============================================================
// @desc    Update bank account
// @route   PUT /api/bank-accounts/:id
// @access  Private
// ============================================================
exports.updateBankAccount = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      accountName,
      accountNumber,
      bankName,
      branchCode,
      accountType,
      currency,
      status
    } = req.body;
    const userId = req.user.id;

    const existing = await prisma.bankAccount.findFirst({
      where: {
        id,
        OR: [
          { userId: userId },
          { createdBy: userId }
        ]
      }
    });

    if (!existing) {
      return res.status(404).json({
        success: false,
        message: 'Bank account not found'
      });
    }

    if (accountNumber && accountNumber !== existing.accountNumber) {
      const duplicate = await prisma.bankAccount.findFirst({
        where: {
          accountNumber,
          OR: [
            { userId: userId },
            { createdBy: userId }
          ],
          NOT: { id }
        }
      });

      if (duplicate) {
        return res.status(400).json({
          success: false,
          message: 'Bank account number already exists'
        });
      }
    }

    const updated = await BankAccountModel.update(id, {
      accountName,
      accountNumber,
      bankName,
      branchCode,
      accountType,
      currency,
      status
    });

    if (accountName || status) {
      await prisma.chartOfAccount.update({
        where: { id: existing.chartOfAccountId },
        data: {
          name: accountName || existing.accountName,
          isActive: status === 'Active'
        }
      });
    }

    res.status(200).json({
      success: true,
      data: updated,
      message: 'Bank account updated successfully'
    });
  } catch (error) {
    console.error('❌ Update bank account error:', error);
    res.status(500).json({
      success: false,
      message: 'Server Error',
      error: error.message
    });
  }
};

// ============================================================
// @desc    Delete bank account
// @route   DELETE /api/bank-accounts/:id
// @access  Private
// ============================================================
exports.deleteBankAccount = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const bankAccount = await prisma.bankAccount.findFirst({
      where: {
        id,
        OR: [
          { userId: userId },
          { createdBy: userId }
        ]
      },
      include: {
        chartOfAccount: true
      }
    });

    if (!bankAccount) {
      return res.status(404).json({
        success: false,
        message: 'Bank account not found'
      });
    }

    const hasTransactions = await prisma.journalLine.findFirst({
      where: {
        accountId: bankAccount.chartOfAccountId,
        journal: {
          createdBy: userId
        }
      }
    });

    if (hasTransactions) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete account with existing transactions. Please deactivate instead.'
      });
    }

    await BankAccountModel.delete(id);

    await prisma.chartOfAccount.delete({
      where: { id: bankAccount.chartOfAccountId }
    });

    res.status(200).json({
      success: true,
      message: 'Bank account deleted successfully'
    });
  } catch (error) {
    console.error('❌ Delete bank account error:', error);
    res.status(500).json({
      success: false,
      message: 'Server Error',
      error: error.message
    });
  }
};

// ============================================================
// @desc    Update bank account balance
// @route   PATCH /api/bank-accounts/:id/balance
// @access  Private
// ============================================================
exports.updateBalance = async (req, res) => {
  try {
    const { id } = req.params;
    const { amount, type } = req.body;
    const userId = req.user.id;

    if (!amount || !type) {
      return res.status(400).json({
        success: false,
        message: 'Amount and type are required'
      });
    }

    const bankAccount = await prisma.bankAccount.findFirst({
      where: {
        id,
        OR: [
          { userId: userId },
          { createdBy: userId }
        ]
      }
    });

    if (!bankAccount) {
      return res.status(404).json({
        success: false,
        message: 'Bank account not found'
      });
    }

    const updated = await BankAccountModel.updateBalance(id, amount, type);

    res.status(200).json({
      success: true,
      data: {
        currentBalance: updated.currentBalance,
        previousBalance: bankAccount.currentBalance,
        change: updated.currentBalance - bankAccount.currentBalance
      },
      message: 'Balance updated successfully'
    });
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
// @desc    Reconcile bank account
// @route   POST /api/bank-accounts/:id/reconcile
// @access  Private
// ============================================================
exports.reconcileBankAccount = async (req, res) => {
  try {
    const { id } = req.params;
    const { statementBalance, reconciledDate } = req.body;
    const userId = req.user.id;

    if (statementBalance === undefined) {
      return res.status(400).json({
        success: false,
        message: 'Statement balance is required'
      });
    }

    const bankAccount = await prisma.bankAccount.findFirst({
      where: {
        id,
        OR: [
          { userId: userId },
          { createdBy: userId }
        ]
      }
    });

    if (!bankAccount) {
      return res.status(404).json({
        success: false,
        message: 'Bank account not found'
      });
    }

    const updated = await BankAccountModel.reconcile(
      id,
      statementBalance,
      reconciledDate
    );

    const difference = statementBalance - bankAccount.currentBalance;

    res.status(200).json({
      success: true,
      data: {
        accountId: updated.id,
        accountName: updated.accountName,
        currentBalance: updated.currentBalance,
        statementBalance,
        difference,
        lastReconciled: updated.lastReconciled
      },
      message: difference === 0
        ? 'Account reconciled successfully'
        : `Account reconciled with difference of ${difference}`
    });
  } catch (error) {
    console.error('❌ Reconcile error:', error);
    res.status(500).json({
      success: false,
      message: 'Server Error',
      error: error.message
    });
  }
};

// ============================================================
// @desc    Get bank account transactions
// @route   GET /api/bank-accounts/:id/transactions
// @access  Private
// ============================================================
exports.getBankAccountTransactions = async (req, res) => {
  try {
    const { id } = req.params;
    const { startDate, endDate, limit = 20, page = 1 } = req.query;
    const userId = req.user.id;

    const bankAccount = await prisma.bankAccount.findFirst({
      where: {
        id,
        OR: [
          { userId: userId },
          { createdBy: userId }
        ]
      }
    });

    if (!bankAccount) {
      return res.status(404).json({
        success: false,
        message: 'Bank account not found'
      });
    }

    const pageNum = parseInt(page) || 1;
    const limitNum = parseInt(limit) || 20;
    const skip = (pageNum - 1) * limitNum;

    const { transactions, total } = await BankAccountModel.getTransactions(id, {
      startDate,
      endDate,
      skip,
      take: limitNum
    });

    const totalPages = Math.ceil(total / limitNum);

    res.status(200).json({
      success: true,
      account: {
        id: bankAccount.id,
        accountName: bankAccount.accountName,
        accountNumber: bankAccount.accountNumber,
        bankName: bankAccount.bankName,
        currentBalance: bankAccount.currentBalance
      },
      count: transactions.length,
      total,
      page: pageNum,
      pages: totalPages,
      data: transactions
    });
  } catch (error) {
    console.error('❌ Get bank account transactions error:', error);
    res.status(500).json({
      success: false,
      message: 'Server Error',
      error: error.message
    });
  }
};

// ============================================================
// @desc    Get bank account summary
// @route   GET /api/bank-accounts/summary
// @access  Private
// ============================================================
exports.getBankAccountSummary = async (req, res) => {
  try {
    const userId = req.user.id;

    const bankAccounts = await prisma.bankAccount.findMany({
      where: {
        status: 'Active',
        OR: [
          { userId: userId },
          { createdBy: userId }
        ]
      }
    });

    const summary = await BankAccountModel.getSummary(bankAccounts);
    const balanceByCurrency = await BankAccountModel.getBalanceByCurrency(userId);

    res.status(200).json({
      success: true,
      data: {
        summary,
        balanceByCurrency,
        accounts: bankAccounts.map(acc => ({
          id: acc.id,
          accountName: acc.accountName,
          accountNumber: acc.accountNumber,
          bankName: acc.bankName,
          currency: acc.currency,
          balance: acc.currentBalance,
          lastReconciled: acc.lastReconciled
        }))
      }
    });
  } catch (error) {
    console.error('❌ Get bank account summary error:', error);
    res.status(500).json({
      success: false,
      message: 'Server Error',
      error: error.message
    });
  }
};

// ============================================================
// @desc    Bulk import bank accounts
// @route   POST /api/bank-accounts/bulk-import
// @access  Private
// ============================================================
exports.bulkImportBankAccounts = async (req, res) => {
  try {
    const { accounts } = req.body;
    const userId = req.user.id;

    if (!accounts || !Array.isArray(accounts) || accounts.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Please provide an array of bank accounts'
      });
    }

    const results = await BankAccountModel.bulkImport(accounts, userId);

    res.status(201).json({
      success: true,
      message: `Successfully imported ${results.success.length} of ${results.total} bank accounts`,
      data: results
    });
  } catch (error) {
    console.error('❌ Bulk import bank accounts error:', error);
    res.status(500).json({
      success: false,
      message: 'Server Error',
      error: error.message
    });
  }
};

// ============================================================
// @desc    Get bank account with latest transactions
// @route   GET /api/bank-accounts/:id/with-transactions
// @access  Private
// ============================================================
exports.getBankAccountWithTransactions = async (req, res) => {
  try {
    const { id } = req.params;
    const { limit = 5 } = req.query;
    const userId = req.user.id;

    const result = await BankAccountModel.getWithLatestTransactions(id, parseInt(limit));

    if (!result) {
      return res.status(404).json({
        success: false,
        message: 'Bank account not found'
      });
    }

    res.status(200).json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error('❌ Get bank account with transactions error:', error);
    res.status(500).json({
      success: false,
      message: 'Server Error',
      error: error.message
    });
  }
};