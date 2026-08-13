// controllers/bankAccountController.js

const BankAccountModel = require('../models/BankAccount');
const prisma = require('../prisma/client');
const {
  upsertBankOpeningBalance,
  createBankDeposit,
  repairCompanyBankOpeningBalances
} = require('../services/bankAccountingService');

// ─── HELPER: Generate unique account code ─────────────────────────
async function generateUniqueAccountCode(companyId) {
  if (!prisma.chartOfAccount?.findMany) {
    const err = new Error(
      'Prisma chartOfAccount missing. Redeploy Vercel with cache cleared (prisma generate).'
    );
    err.statusCode = 503;
    throw err;
  }

  const accounts = await prisma.chartOfAccount.findMany({
    where: { companyId: companyId },
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
    const companyId = req.user.companyId;
    const opening = Number(openingBalance) || 0;

    if (!accountName || !accountNumber || !bankName) {
      return res.status(400).json({
        success: false,
        message: 'Account name, account number and bank name are required'
      });
    }

    if (opening < 0) {
      return res.status(400).json({
        success: false,
        message: 'Opening balance cannot be negative'
      });
    }

    const existingAccount = await BankAccountModel.findByAccountNumber(accountNumber, companyId);
    if (existingAccount) {
      return res.status(400).json({
        success: false,
        message: 'Bank account number already exists'
      });
    }

    const accountCode = await generateUniqueAccountCode(companyId);

    // currentBalance starts at 0; opening JE (if any) increments it atomically.
    // openingBalance field stores the original opening amount for display/metadata.
    const chartAccount = await prisma.chartOfAccount.create({
      data: {
        code: accountCode,
        name: accountName,
        type: 'Asset',
        parentAccount: 'Current Assets',
        openingBalance: opening,
        currentBalance: 0,
        description: `${bankName} bank account - ${accountNumber}`,
        taxCode: 'N/A',
        balanceType: 'Debit',
        isActive: true,
        createdBy: userId,
        companyId: companyId
      }
    });

    const bankAccount = await BankAccountModel.create({
      accountName,
      accountNumber,
      bankName,
      branchCode: branchCode || '',
      accountType: accountType || 'Current',
      currency: currency || 'PKR',
      openingBalance: opening,
      status: status || 'Active',
      chartOfAccountId: chartAccount.id,
      createdBy: userId,
      companyId: companyId
    });

    // Force currentBalance 0 before JE posts (model may copy opening → current)
    await prisma.bankAccount.update({
      where: { id: bankAccount.id },
      data: { currentBalance: 0, openingBalance: opening }
    });

    let journalEntry = null;
    if (opening > 0) {
      try {
        const result = await upsertBankOpeningBalance({
          userId,
          companyId,
          bankAccountId: bankAccount.id,
          amount: opening,
          postingDate: new Date(),
          balancesAlreadySet: false
        });
        journalEntry = result.journalEntry;
      } catch (jeErr) {
        // Roll back bank + COA so we never leave an unbalanced half-create
        await prisma.bankAccount.delete({ where: { id: bankAccount.id } }).catch(() => {});
        await prisma.chartOfAccount.delete({ where: { id: chartAccount.id } }).catch(() => {});
        const statusCode = jeErr.statusCode || (jeErr.code === 'FISCAL_YEAR_CLOSED' ? 400 : 500);
        return res.status(statusCode).json({
          success: false,
          message: jeErr.message || 'Failed to post opening balance journal entry'
        });
      }
    }

    const refreshed = await prisma.bankAccount.findFirst({
      where: { id: bankAccount.id },
      include: { chartOfAccount: true }
    });

    res.status(201).json({
      success: true,
      data: refreshed,
      journalEntry: journalEntry
        ? { id: journalEntry.id, entryNumber: journalEntry.entryNumber, reference: journalEntry.reference }
        : null,
      message: opening > 0
        ? 'Bank account created with opening balance journal entry'
        : 'Bank account created successfully'
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
    const companyId = req.user.companyId;

    // One-time soft repair: orphan OB JEs missing companyId break Trial Balance
    try {
      const orphan = await prisma.journalLine.findFirst({
        where: {
          debit: { gt: 0 },
          journal: {
            companyId: null,
            description: { contains: 'Opening Balance', mode: 'insensitive' },
            status: 'Posted',
            createdBy: userId
          },
          account: { companyId }
        }
      });
      if (orphan) {
        await repairCompanyBankOpeningBalances(userId, companyId);
      }
    } catch (repairErr) {
      console.log('⚠️ [Bank] Opening balance auto-repair skipped:', repairErr.message);
    }

    // FIXED: Search using companyId
    const filter = {
      companyId: companyId
    };

    if (status && status !== 'All') {
      filter.status = status;
    }

    if (search) {
      filter.AND = [
        {
          companyId: companyId
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

    const responseData = {
      count: accountsWithBalance.length,
      total: totalCount,
      page: pageNum,
      pages: totalPages,
      data: accountsWithBalance
    };

    res.status(200).json({
      success: true,
      ...responseData
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
    const companyId = req.user.companyId;

    const bankAccount = await prisma.bankAccount.findFirst({
      where: {
        id,
        companyId: companyId
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
      status,
      openingBalance
    } = req.body;
    const userId = req.user.id;
    const companyId = req.user.companyId;

    const existing = await prisma.bankAccount.findFirst({
      where: {
        id,
        companyId: companyId
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
          companyId: companyId,
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

    // Opening balance edit: reverse/repost via dedicated JE (no duplicate entries)
    if (openingBalance !== undefined && openingBalance !== null) {
      const newOpening = Number(openingBalance);
      if (Number.isNaN(newOpening) || newOpening < 0) {
        return res.status(400).json({
          success: false,
          message: 'Opening balance must be a non-negative number'
        });
      }
      try {
        await upsertBankOpeningBalance({
          userId,
          companyId,
          bankAccountId: id,
          amount: newOpening,
          postingDate: new Date(),
          balancesAlreadySet: false
        });
      } catch (jeErr) {
        const statusCode = jeErr.statusCode || (jeErr.code === 'FISCAL_YEAR_CLOSED' ? 400 : 500);
        return res.status(statusCode).json({
          success: false,
          message: jeErr.message || 'Failed to update opening balance journal entry'
        });
      }
    }

    const refreshed = await prisma.bankAccount.findFirst({
      where: { id, companyId },
      include: { chartOfAccount: true }
    });

    res.status(200).json({
      success: true,
      data: refreshed || updated,
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
    const companyId = req.user.companyId;

    const bankAccount = await prisma.bankAccount.findFirst({
      where: {
        id,
        companyId: companyId
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
          companyId: companyId
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
    const companyId = req.user.companyId;

    if (!amount || !type) {
      return res.status(400).json({
        success: false,
        message: 'Amount and type are required'
      });
    }

    const bankAccount = await prisma.bankAccount.findFirst({
      where: {
        id,
        companyId: companyId
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
    const companyId = req.user.companyId;

    if (statementBalance === undefined) {
      return res.status(400).json({
        success: false,
        message: 'Statement balance is required'
      });
    }

    const bankAccount = await prisma.bankAccount.findFirst({
      where: {
        id,
        companyId: companyId
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
    const companyId = req.user.companyId;

    const bankAccount = await prisma.bankAccount.findFirst({
      where: {
        id,
        companyId: companyId
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

    const responseData = {
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
    };

    res.status(200).json({
      success: true,
      ...responseData
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
    const companyId = req.user.companyId;

    const bankAccounts = await prisma.bankAccount.findMany({
      where: {
        status: 'Active',
        companyId: companyId
      }
    });

    const summary = await BankAccountModel.getSummary(bankAccounts);
    const balanceByCurrency = await BankAccountModel.getBalanceByCurrency(companyId);

    const summaryData = {
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
    };

    res.status(200).json({
      success: true,
      data: summaryData
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
    const companyId = req.user.companyId;

    if (!accounts || !Array.isArray(accounts) || accounts.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Please provide an array of bank accounts'
      });
    }

    const results = await BankAccountModel.bulkImport(accounts, companyId);

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
    const companyId = req.user.companyId;

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
// ============================================================
// @desc    Deposit / Add Money into a bank account
// @route   POST /api/bank-accounts/:id/deposit
// @access  Private
// ============================================================
exports.depositToBankAccount = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      amount,
      sourceAccountId,
      date,
      description,
      reference,
      notes
    } = req.body;
    const userId = req.user.id;
    const companyId = req.user.companyId;

    const result = await createBankDeposit({
      userId,
      companyId,
      bankAccountId: id,
      sourceAccountId,
      amount,
      postingDate: date ? new Date(date) : new Date(),
      description,
      reference,
      notes
    });

    try {
    } catch (_) {}

    return res.status(result.duplicate ? 200 : 201).json({
      success: true,
      data: {
        bankAccount: result.bankAccount,
        journalEntry: result.journalEntry
      },
      duplicate: !!result.duplicate,
      message: result.duplicate
        ? 'Deposit already recorded (duplicate reference)'
        : 'Deposit posted successfully'
    });
  } catch (error) {
    console.error('❌ Deposit error:', error);
    const statusCode =
      error.statusCode || (error.code === 'FISCAL_YEAR_CLOSED' ? 400 : 500);
    return res.status(statusCode).json({
      success: false,
      message: error.message || 'Server Error'
    });
  }
};

// ============================================================
// @desc    Repair missing/orphan opening-balance journal entries
// @route   POST /api/bank-accounts/repair-opening-balances
// @access  Private
// ============================================================
exports.repairOpeningBalances = async (req, res) => {
  try {
    const userId = req.user.id;
    const companyId = req.user.companyId;
    const results = await repairCompanyBankOpeningBalances(userId, companyId);

    try {
    } catch (_) {}

    return res.status(200).json({
      success: true,
      data: results,
      message: 'Opening balance repair completed'
    });
  } catch (error) {
    console.error('❌ Repair opening balances error:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Server Error'
    });
  }
};
