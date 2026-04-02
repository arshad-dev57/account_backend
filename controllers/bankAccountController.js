const BankAccount = require('../models/BankAccount');
const ChartOfAccount = require('../models/ChartOfAccount');
const JournalEntry = require('../models/JournalEntry');

// Helper: Generate next account code for bank accounts
async function getNextBankAccountCode(userId) {
  const accounts = await ChartOfAccount.find({ 
    code: /^102/,
    createdBy: userId  // 👈 Only find accounts created by this user
  });
  if (accounts.length === 0) return '1020';
  
  const codes = accounts.map(a => parseInt(a.code));
  const maxCode = Math.max(...codes);
  return (maxCode + 1).toString();
}

// Helper: Create journal entry for opening balance
async function createOpeningBalanceJournalEntry(accountId, accountName, openingBalance, userId, companyId) {
  // Get the capital account - must belong to user
  let capitalAccount = await ChartOfAccount.findOne({ 
    code: '3010',
    createdBy: userId  // 👈 Only find capital account created by this user
  });
  
  if (!capitalAccount) {
    capitalAccount = await ChartOfAccount.create({
      code: '3010',
      name: "Owner's Capital",
      type: 'Equity',
      parentAccount: 'Equity',
      openingBalance: 0,
      description: 'Owner investment',
      taxCode: 'N/A',
      createdBy: userId,
    });
  }
  
  // Get the bank account from Chart of Accounts
  const bankChartAccount = await ChartOfAccount.findOne({
    _id: accountId,
    createdBy: userId  // 👈 Only find account created by this user
  });
  
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
      branchCode,
      accountType,
      currency,
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
        req.user.id,
        req.user.companyId
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
    console.error(error);
    res.status(500).json({
      success: false,
      message: error.message || 'Server Error',
    });
  }
};

// @desc    Get all bank accounts
// @route   GET /api/bank-accounts
// @access  Private
exports.getBankAccounts = async (req, res) => {
  try {
    const { status, search } = req.query;
    
    let query = {
      createdBy: req.user.id  // 👈 Only show accounts created by this user
    };
    
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
    
    const totalBalance = activeAccounts.reduce((sum, acc) => sum + acc.currentBalance, 0);
    const totalPKR = activeAccounts
      .filter(acc => acc.currency === 'PKR')
      .reduce((sum, acc) => sum + acc.currentBalance, 0);
    const totalUSD = activeAccounts
      .filter(acc => acc.currency === 'USD')
      .reduce((sum, acc) => sum + acc.currentBalance, 0);
    const activeCount = activeAccounts.length;
    
    res.status(200).json({
      success: true,
      count: bankAccounts.length,
      data: bankAccounts,
      summary: {
        totalBalance,
        totalPKR,
        totalUSD,
        activeCount,
      },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: 'Server Error',
      error: error.message,
    });
  }
};

// @desc    Get single bank account
// @route   GET /api/bank-accounts/:id
// @access  Private
exports.getBankAccount = async (req, res) => {
  try {
    const bankAccount = await BankAccount.findOne({
      _id: req.params.id,
      createdBy: req.user.id  // 👈 Only allow if user owns this account
    })
      .populate('chartOfAccountId', 'code name currentBalance');
    
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
    console.error(error);
    res.status(500).json({
      success: false,
      message: 'Server Error',
      error: error.message,
    });
  }
};

// @desc    Update bank account
// @route   PUT /api/bank-accounts/:id
// @access  Private
exports.updateBankAccount = async (req, res) => {
  try {
    const { accountName, accountNumber, bankName, branchCode, accountType, currency, status } = req.body;
    
    let bankAccount = await BankAccount.findOne({
      _id: req.params.id,
      createdBy: req.user.id  // 👈 Only allow if user owns this account
    });
    
    if (!bankAccount) {
      return res.status(404).json({
        success: false,
        message: 'Bank account not found',
      });
    }
    
    // Check if updating account number to a duplicate
    if (accountNumber && accountNumber !== bankAccount.accountNumber) {
      const existingAccount = await BankAccount.findOne({
        accountNumber: accountNumber,
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
    
    // Update bank account
    bankAccount.accountName = accountName || bankAccount.accountName;
    bankAccount.accountNumber = accountNumber || bankAccount.accountNumber;
    bankAccount.bankName = bankName || bankAccount.bankName;
    bankAccount.branchCode = branchCode || bankAccount.branchCode;
    bankAccount.accountType = accountType || bankAccount.accountType;
    bankAccount.currency = currency || bankAccount.currency;
    bankAccount.status = status || bankAccount.status;
    
    await bankAccount.save();
    
    // Update Chart of Accounts
    await ChartOfAccount.findOneAndUpdate(
      { 
        _id: bankAccount.chartOfAccountId,
        createdBy: req.user.id  // 👈 Only update if user owns this account
      },
      {
        name: accountName,
        isActive: status === 'Active',
      }
    );
    
    res.status(200).json({
      success: true,
      data: bankAccount,
      message: 'Bank account updated successfully',
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: 'Server Error',
      error: error.message,
    });
  }
};

// @desc    Delete bank account
// @route   DELETE /api/bank-accounts/:id
// @access  Private
exports.deleteBankAccount = async (req, res) => {
  try {
    const bankAccount = await BankAccount.findOne({
      _id: req.params.id,
      createdBy: req.user.id  // 👈 Only allow if user owns this account
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
      createdBy: req.user.id  // 👈 Only check entries created by this user
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
      createdBy: req.user.id  // 👈 Only delete if user owns this account
    });
    
    res.status(200).json({
      success: true,
      message: 'Bank account deleted successfully',
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: 'Server Error',
      error: error.message,
    });
  }
};

// @desc    Update bank account balance (called from transactions)
// @route   PUT /api/bank-accounts/:id/balance
// @access  Private (Internal use)
exports.updateBalance = async (req, res) => {
  try {
    const { amount, type } = req.body; // type: 'credit' (deposit) or 'debit' (withdrawal)
    
    const bankAccount = await BankAccount.findOne({
      _id: req.params.id,
      createdBy: req.user.id  // 👈 Only allow if user owns this account
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
    }
    
    bankAccount.currentBalance = newBalance;
    await bankAccount.save();
    
    // Update Chart of Accounts balance
    await ChartOfAccount.findOneAndUpdate(
      { 
        _id: bankAccount.chartOfAccountId,
        createdBy: req.user.id  // 👈 Only update if user owns this account
      },
      {
        currentBalance: newBalance,
      }
    );
    
    res.status(200).json({
      success: true,
      data: { currentBalance: newBalance },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: 'Server Error',
      error: error.message,
    });
  }
};