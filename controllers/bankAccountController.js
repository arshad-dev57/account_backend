const BankAccount = require('../models/BankAccount');
const ChartOfAccount = require('../models/ChartOfAccount');
const JournalEntry = require('../models/JournalEntry');

// ==================== HELPER FUNCTIONS ====================

// Generate next account code for bank accounts (1020, 1021, 1022...)
async function getNextBankAccountCode(userId) {
  const accounts = await ChartOfAccount.find({
    code: /^102/,
    createdBy: userId
  });
  if (accounts.length === 0) return '1020';
  
  const codes = accounts.map(a => parseInt(a.code));
  const maxCode = Math.max(...codes);
  return (maxCode + 1).toString();
}

// Get or create Capital account for this user (NO duplicate error)
async function getOrCreateCapitalAccount(userId) {
  // First try to find capital account by code OR name for this user
  let capitalAccount = await ChartOfAccount.findOne({
    $or: [
      { code: '3010', createdBy: userId },
      { name: "Owner's Capital", createdBy: userId }
    ]
  });
  
  if (!capitalAccount) {
    // Check if code 3010 already exists for ANY user
    const existingCode = await ChartOfAccount.findOne({ code: '3010' });
    
    let newCode = '3010';
    if (existingCode) {
      // Generate a unique code for this user
      let counter = 1;
      let codeExists = true;
      while (codeExists) {
        newCode = `301${counter}`;
        const existing = await ChartOfAccount.findOne({ code: newCode, createdBy: userId });
        if (!existing) {
          codeExists = false;
        }
        counter++;
      }
    }
    
    capitalAccount = await ChartOfAccount.create({
      code: newCode,
      name: "Owner's Capital",
      type: 'Equity',
      parentAccount: 'Equity',
      openingBalance: 0,
      currentBalance: 0,
      description: 'Owner investment',
      taxCode: 'N/A',
      createdBy: userId,
    });
  }
  
  return capitalAccount;
}

// Create journal entry for opening balance
async function createOpeningBalanceJournalEntry(bankChartAccountId, accountName, openingBalance, userId) {
  const capitalAccount = await getOrCreateCapitalAccount(userId);
  
  const bankChartAccount = await ChartOfAccount.findOne({
    _id: bankChartAccountId,
    createdBy: userId
  });
  
  if (!bankChartAccount) {
    throw new Error('Bank chart account not found');
  }
  
  const journalEntry = await JournalEntry.create({
    date: new Date(),
    description: `Opening balance for ${accountName}`,
    reference: `BANK-${Date.now()}`,
    lines: [
      {
        accountId: bankChartAccount._id,
        accountName: bankChartAccount.name,
        accountCode: bankChartAccount.code,
        debit: openingBalance,
        credit: 0,
      },
      {
        accountId: capitalAccount._id,
        accountName: capitalAccount.name,
        accountCode: capitalAccount.code,
        debit: 0,
        credit: openingBalance,
      },
    ],
    status: 'Posted',
    createdBy: userId,
    postedBy: userId,
    postedAt: new Date(),
  });
  
  return journalEntry;
}

// ==================== CREATE BANK ACCOUNT ====================
// @desc    Create new bank account
// @route   POST /api/bank-accounts
// @access  Private
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
    } = req.body;

    // Validation
    if (!accountName || !accountNumber || !bankName) {
      return res.status(400).json({
        success: false,
        message: 'Account name, account number and bank name are required',
      });
    }

    // Check if account number already exists for this user
    const existingAccount = await BankAccount.findOne({
      accountNumber,
      createdBy: req.user.id,
    });

    if (existingAccount) {
      return res.status(400).json({
        success: false,
        message: 'Bank account number already exists',
      });
    }

    // 1. Create entry in Chart of Accounts
    const nextCode = await getNextBankAccountCode(req.user.id);
    
    const chartAccount = await ChartOfAccount.create({
      code: nextCode,
      name: accountName,
      type: 'Assets',
      parentAccount: 'Current Assets',
      openingBalance: openingBalance || 0,
      currentBalance: openingBalance || 0,
      description: `${bankName} bank account - ${accountNumber}`,
      taxCode: 'N/A',
      createdBy: req.user.id,
    });

    // 2. Create bank account record
    const bankAccount = await BankAccount.create({
      accountName,
      accountNumber,
      bankName,
      branchCode: branchCode || '',
      accountType: accountType || 'Current',
      currency: currency || 'PKR',
      openingBalance: openingBalance || 0,
      currentBalance: openingBalance || 0,
      status: 'Active',
      lastReconciled: new Date(),
      chartOfAccountId: chartAccount._id,
      createdBy: req.user.id,
    });

    // 3. Create journal entry for opening balance (if > 0)
    if (openingBalance && openingBalance > 0) {
      await createOpeningBalanceJournalEntry(
        chartAccount._id,
        accountName,
        openingBalance,
        req.user.id
      );
    }

    res.status(201).json({
      success: true,
      data: {
        bankAccount,
        chartAccount,
      },
      message: 'Bank account created successfully',
    });
  } catch (error) {
    console.error('Create bank account error:', error);
    
    // Handle duplicate key error (MongoDB E11000)
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'Duplicate entry. Please try again with different details.',
      });
    }
    
    res.status(500).json({
      success: false,
      message: error.message || 'Server Error',
    });
  }
};

// ==================== GET ALL BANK ACCOUNTS ====================
// @desc    Get all bank accounts
// @route   GET /api/bank-accounts
// @access  Private
exports.getBankAccounts = async (req, res) => {
  try {
    const { status, search } = req.query;
    
    let query = { createdBy: req.user.id };
    
    if (status && status !== 'All') {
      query.status = status;
    }
    
    if (search) {
      query.$or = [
        { accountName: { $regex: search, $options: 'i' } },
        { accountNumber: { $regex: search, $options: 'i' } },
        { bankName: { $regex: search, $options: 'i' } },
      ];
    }
    
    const bankAccounts = await BankAccount.find(query)
      .populate('chartOfAccountId', 'code name currentBalance')
      .sort({ createdAt: -1 });
    
    // Calculate summaries
    const activeAccounts = bankAccounts.filter(acc => acc.status === 'Active');
    const totalBalance = activeAccounts.reduce((sum, acc) => sum + (acc.currentBalance || 0), 0);
    const totalPKR = activeAccounts
      .filter(acc => acc.currency === 'PKR')
      .reduce((sum, acc) => sum + (acc.currentBalance || 0), 0);
    const totalUSD = activeAccounts
      .filter(acc => acc.currency === 'USD')
      .reduce((sum, acc) => sum + (acc.currentBalance || 0), 0);
    
    res.status(200).json({
      success: true,
      count: bankAccounts.length,
      data: bankAccounts,
      summary: {
        totalBalance,
        totalPKR,
        totalUSD,
        activeCount: activeAccounts.length,
      },
    });
  } catch (error) {
    console.error('Get bank accounts error:', error);
    res.status(500).json({
      success: false,
      message: 'Server Error',
      error: error.message,
    });
  }
};

// ==================== GET SINGLE BANK ACCOUNT ====================
// @desc    Get single bank account
// @route   GET /api/bank-accounts/:id
// @access  Private
exports.getBankAccount = async (req, res) => {
  try {
    const bankAccount = await BankAccount.findOne({
      _id: req.params.id,
      createdBy: req.user.id,
    }).populate('chartOfAccountId', 'code name currentBalance');
    
    if (!bankAccount) {
      return res.status(404).json({
        success: false,
        message: 'Bank account not found',
      });
    }
    
    res.status(200).json({
      success: true,
      data: bankAccount,
    });
  } catch (error) {
    console.error('Get bank account error:', error);
    res.status(500).json({
      success: false,
      message: 'Server Error',
      error: error.message,
    });
  }
};

// ==================== UPDATE BANK ACCOUNT ====================
// @desc    Update bank account
// @route   PUT /api/bank-accounts/:id
// @access  Private
exports.updateBankAccount = async (req, res) => {
  try {
    const { accountName, accountNumber, bankName, branchCode, accountType, currency, status } = req.body;
    
    const bankAccount = await BankAccount.findOne({
      _id: req.params.id,
      createdBy: req.user.id,
    });
    
    if (!bankAccount) {
      return res.status(404).json({
        success: false,
        message: 'Bank account not found',
      });
    }
    
    // Check duplicate account number
    if (accountNumber && accountNumber !== bankAccount.accountNumber) {
      const existingAccount = await BankAccount.findOne({
        accountNumber,
        createdBy: req.user.id,
        _id: { $ne: req.params.id },
      });
      if (existingAccount) {
        return res.status(400).json({
          success: false,
          message: 'Bank account number already exists',
        });
      }
    }
    
    // Update fields
    if (accountName) bankAccount.accountName = accountName;
    if (accountNumber) bankAccount.accountNumber = accountNumber;
    if (bankName) bankAccount.bankName = bankName;
    if (branchCode !== undefined) bankAccount.branchCode = branchCode;
    if (accountType) bankAccount.accountType = accountType;
    if (currency) bankAccount.currency = currency;
    if (status) bankAccount.status = status;
    
    await bankAccount.save();
    
    // Update Chart of Accounts name if changed
    if (accountName) {
      await ChartOfAccount.findOneAndUpdate(
        { _id: bankAccount.chartOfAccountId, createdBy: req.user.id },
        { name: accountName, isActive: status === 'Active' }
      );
    }
    
    res.status(200).json({
      success: true,
      data: bankAccount,
      message: 'Bank account updated successfully',
    });
  } catch (error) {
    console.error('Update bank account error:', error);
    res.status(500).json({
      success: false,
      message: 'Server Error',
      error: error.message,
    });
  }
};

// ==================== DELETE BANK ACCOUNT ====================
// @desc    Delete bank account
// @route   DELETE /api/bank-accounts/:id
// @access  Private
exports.deleteBankAccount = async (req, res) => {
  try {
    const bankAccount = await BankAccount.findOne({
      _id: req.params.id,
      createdBy: req.user.id,
    });
    
    if (!bankAccount) {
      return res.status(404).json({
        success: false,
        message: 'Bank account not found',
      });
    }
    
    // Check if account has transactions
    const hasTransactions = await JournalEntry.findOne({
      'lines.accountId': bankAccount.chartOfAccountId,
      createdBy: req.user.id
    });
    
    if (hasTransactions) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete account with existing transactions. Please deactivate instead.',
      });
    }
    
    // Delete from BankAccount and ChartOfAccount
    await bankAccount.deleteOne();
    await ChartOfAccount.findOneAndDelete({
      _id: bankAccount.chartOfAccountId,
      createdBy: req.user.id
    });
    
    res.status(200).json({
      success: true,
      message: 'Bank account deleted successfully',
    });
  } catch (error) {
    console.error('Delete bank account error:', error);
    res.status(500).json({
      success: false,
      message: 'Server Error',
      error: error.message,
    });
  }
};

// ==================== UPDATE BANK BALANCE ====================
// @desc    Update bank account balance (called from transactions)
// @route   PUT /api/bank-accounts/:id/balance
// @access  Private
exports.updateBalance = async (req, res) => {
  try {
    const { amount, type } = req.body;
    
    if (!amount || !type) {
      return res.status(400).json({
        success: false,
        message: 'Amount and type are required',
      });
    }
    
    const bankAccount = await BankAccount.findOne({
      _id: req.params.id,
      createdBy: req.user.id,
    });
    
    if (!bankAccount) {
      return res.status(404).json({
        success: false,
        message: 'Bank account not found',
      });
    }
    
    let newBalance = bankAccount.currentBalance;
    if (type === 'credit') {
      newBalance += amount;
    } else if (type === 'debit') {
      newBalance -= amount;
    } else {
      return res.status(400).json({
        success: false,
        message: 'Invalid type. Use "credit" or "debit"',
      });
    }
    
    bankAccount.currentBalance = newBalance;
    await bankAccount.save();
    
    // Update Chart of Accounts balance
    await ChartOfAccount.findOneAndUpdate(
      { _id: bankAccount.chartOfAccountId, createdBy: req.user.id },
      { currentBalance: newBalance }
    );
    
    res.status(200).json({
      success: true,
      data: { currentBalance: newBalance },
      message: 'Balance updated successfully',
    });
  } catch (error) {
    console.error('Update balance error:', error);
    res.status(500).json({
      success: false,
      message: 'Server Error',
      error: error.message,
    });
  }
};

// ==================== RECONCILE BANK ACCOUNT ====================
// @desc    Reconcile bank account
// @route   POST /api/bank-accounts/:id/reconcile
// @access  Private
exports.reconcileBankAccount = async (req, res) => {
  try {
    const { statementBalance, reconciledDate } = req.body;
    
    if (statementBalance === undefined) {
      return res.status(400).json({
        success: false,
        message: 'Statement balance is required',
      });
    }
    
    const bankAccount = await BankAccount.findOne({
      _id: req.params.id,
      createdBy: req.user.id,
    });
    
    if (!bankAccount) {
      return res.status(404).json({
        success: false,
        message: 'Bank account not found',
      });
    }
    
    const difference = statementBalance - bankAccount.currentBalance;
    
    bankAccount.lastReconciled = reconciledDate ? new Date(reconciledDate) : new Date();
    await bankAccount.save();
    
    res.status(200).json({
      success: true,
      data: {
        accountId: bankAccount._id,
        accountName: bankAccount.accountName,
        currentBalance: bankAccount.currentBalance,
        statementBalance: statementBalance,
        difference: difference,
        lastReconciled: bankAccount.lastReconciled,
      },
      message: difference === 0 
        ? 'Account reconciled successfully' 
        : `Account reconciled with difference of ${difference}`,
    });
  } catch (error) {
    console.error('Reconcile error:', error);
    res.status(500).json({
      success: false,
      message: 'Server Error',
      error: error.message,
    });
  }
};