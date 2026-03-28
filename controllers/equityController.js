const EquityAccount = require('../models/EquityAccount');
const JournalEntry = require('../models/JournalEntry');
const ChartOfAccount = require('../models/ChartOfAccount');

// Helper: Get or create Equity account in Chart of Accounts
async function getOrCreateEquityAccount(userId, accountCode, accountName) {
  let equityAccount = await ChartOfAccount.findOne({ code: accountCode });
  if (!equityAccount) {
    equityAccount = await ChartOfAccount.create({
      code: accountCode,
      name: accountName,
      type: 'Equity',
      parentAccount: 'Shareholders Equity',
      openingBalance: 0,
      description: accountName,
      taxCode: 'N/A',
      createdBy: userId,
    });
  }
  return equityAccount;
}

// Helper: Get cash account
async function getOrCreateCashAccount(userId) {
  let cashAccount = await ChartOfAccount.findOne({ code: '1010' });
  if (!cashAccount) {
    cashAccount = await ChartOfAccount.create({
      code: '1010',
      name: 'Cash in Hand',
      type: 'Assets',
      parentAccount: 'Current Assets',
      openingBalance: 0,
      description: 'Physical cash',
      taxCode: 'N/A',
      createdBy: userId,
    });
  }
  return cashAccount;
}

// ==================== CREATE EQUITY ACCOUNT ====================
exports.createEquityAccount = async (req, res) => {
  try {
    const {
      accountName,
      accountCode,
      accountType,
      openingBalance,
      notes,
    } = req.body;

    const equityAccount = await EquityAccount.create({
      accountName,
      accountCode,
      accountType,
      openingBalance: openingBalance || 0,
      currentBalance: openingBalance || 0,
      additions: 0,
      withdrawals: 0,
      notes: notes || '',
      createdBy: req.user.id,
    });

    // Create journal entry for opening balance
    if (openingBalance > 0) {
      const equityChartAccount = await getOrCreateEquityAccount(req.user.id, accountCode, accountName);
      const cashAccount = await getOrCreateCashAccount(req.user.id);

      await JournalEntry.create({
        entryNumber: `JE-${Date.now()}`,
        date: new Date(),
        description: `Opening balance for ${accountName}`,
        reference: accountCode,
        lines: [
          {
            accountId: cashAccount._id,
            accountName: cashAccount.name,
            accountCode: cashAccount.code,
            debit: openingBalance,
            credit: 0,
          },
          {
            accountId: equityChartAccount._id,
            accountName: equityChartAccount.name,
            accountCode: equityChartAccount.code,
            debit: 0,
            credit: openingBalance,
          },
        ],
        status: 'Posted',
        createdBy: req.user.id,
        postedBy: req.user.id,
        postedAt: new Date(),
      });
    }

    res.status(201).json({
      success: true,
      data: equityAccount,
      message: 'Equity account created successfully',
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ==================== GET ALL EQUITY ACCOUNTS ====================
exports.getEquityAccounts = async (req, res) => {
  try {
    const { accountType, search } = req.query;
    let query = {};

    if (accountType && accountType !== 'All') {
      query.accountType = accountType;
    }

    if (search) {
      query.$or = [
        { accountName: { $regex: search, $options: 'i' } },
        { accountCode: { $regex: search, $options: 'i' } },
      ];
    }

    const accounts = await EquityAccount.find(query)
      .sort({ accountType: 1, accountName: 1 });

    res.status(200).json({
      success: true,
      count: accounts.length,
      data: accounts,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ==================== GET SINGLE EQUITY ACCOUNT ====================
exports.getEquityAccount = async (req, res) => {
  try {
    const account = await EquityAccount.findById(req.params.id);

    if (!account) {
      return res.status(404).json({
        success: false,
        message: 'Equity account not found',
      });
    }

    res.status(200).json({
      success: true,
      data: account,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ==================== UPDATE EQUITY ACCOUNT ====================
exports.updateEquityAccount = async (req, res) => {
  try {
    const { notes, accountName } = req.body;
    const account = await EquityAccount.findById(req.params.id);

    if (!account) {
      return res.status(404).json({
        success: false,
        message: 'Equity account not found',
      });
    }

    if (accountName) account.accountName = accountName;
    if (notes !== undefined) account.notes = notes;

    await account.save();

    res.status(200).json({
      success: true,
      data: account,
      message: 'Equity account updated successfully',
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};
// equityController.js - addCapital function
exports.addCapital = async (req, res) => {
  try {
    const { accountId, amount, description, reference } = req.body;
    
    console.log("🔍 addCapital called");
    console.log("📌 Account ID:", accountId);
    console.log("💰 Amount:", amount);
    
    // Chart of Accounts se account find karo
    const account = await ChartOfAccount.findById(accountId);
    
    if (!account) {
      return res.status(404).json({ success: false, message: 'Account not found' });
    }
    
    console.log("📊 Old Balance:", account.currentBalance);
    
    // ✅ IMPORTANT: Balance update karo
    const oldBalance = account.currentBalance || account.openingBalance || 0;
    account.currentBalance = oldBalance + amount;
    
    console.log("📊 New Balance:", account.currentBalance);
    
    // ✅ Save karo
    await account.save();
    console.log("✅ Account saved successfully");
    
    // Journal entry create karo
    const cashAccount = await ChartOfAccount.findOne({ code: '1010' });
    
    await JournalEntry.create({
      entryNumber: `JE-${Date.now()}`,
      date: new Date(),
      description: description || `Additional capital to ${account.name}`,
      reference: reference || `CAP-${Date.now()}`,
      lines: [
        {
          accountId: cashAccount ? cashAccount._id : account._id,
          accountName: cashAccount ? cashAccount.name : 'Cash',
          accountCode: cashAccount ? cashAccount.code : '1010',
          debit: amount,
          credit: 0,
        },
        {
          accountId: account._id,
          accountName: account.name,
          accountCode: account.code,
          debit: 0,
          credit: amount,
        },
      ],
      status: 'Posted',
      createdBy: req.user.id,
    });
    
    // ✅ Return updated account with new balance
    res.status(200).json({
      success: true,
      data: {
        account: {
          _id: account._id,
          code: account.code,
          name: account.name,
          type: account.type,
          currentBalance: account.currentBalance,  // ← Ye updated balance hona chahiye
          openingBalance: account.openingBalance,
        },
        amount: amount
      },
      message: 'Capital added successfully',
    });
    
  } catch (error) {
    console.error("🔥 Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};
exports.recordDrawings = async (req, res) => {
  try {
    const { accountId, amount, description, reference } = req.body;

    const account = await EquityAccount.findById(accountId);

    if (!account) {
      return res.status(404).json({
        success: false,
        message: 'Equity account not found',
      });
    }

    if (account.accountType !== 'Drawings') {
      return res.status(400).json({
        success: false,
        message: 'Can only record drawings to Drawings account',
      });
    }

    await account.recordDrawings(amount, description, reference, req.user.id);

    // Create journal entry
    const equityChartAccount = await getOrCreateEquityAccount(req.user.id, account.accountCode, account.accountName);
    const cashAccount = await getOrCreateCashAccount(req.user.id);

    await JournalEntry.create({
      entryNumber: `JE-${Date.now()}`,
      date: new Date(),
      description: description || `Owner drawings from ${account.accountName}`,
      reference: reference || `DRW-${Date.now()}`,
      lines: [
        {
          accountId: equityChartAccount._id,
          accountName: equityChartAccount.name,
          accountCode: equityChartAccount.code,
          debit: amount,
          credit: 0,
        },
        {
          accountId: cashAccount._id,
          accountName: cashAccount.name,
          accountCode: cashAccount.code,
          debit: 0,
          credit: amount,
        },
      ],
      status: 'Posted',
      createdBy: req.user.id,
      postedBy: req.user.id,
      postedAt: new Date(),
    });

    res.status(200).json({
      success: true,
      data: account,
      message: `Drawings of ${amount} recorded successfully`,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ==================== TRANSFER TO RETAINED EARNINGS ====================
exports.transferToRetainedEarnings = async (req, res) => {
  try {
    const { amount, description, reference } = req.body;

    let retainedEarnings = await EquityAccount.findOne({ accountType: 'Retained Earnings' });

    if (!retainedEarnings) {
      retainedEarnings = await EquityAccount.create({
        accountName: 'Retained Earnings',
        accountCode: '3020',
        accountType: 'Retained Earnings',
        openingBalance: 0,
        currentBalance: 0,
        additions: 0,
        withdrawals: 0,
        notes: 'Accumulated profits',
        createdBy: req.user.id,
      });
    }

    await retainedEarnings.transferToRetainedEarnings(amount, description, reference, req.user.id);

    // Create journal entry
    const pnlAccount = await ChartOfAccount.findOne({ code: '3000' }); // Profit & Loss account
    const retainedEarningsChart = await getOrCreateEquityAccount(req.user.id, retainedEarnings.accountCode, retainedEarnings.accountName);

    await JournalEntry.create({
      entryNumber: `JE-${Date.now()}`,
      date: new Date(),
      description: description || `Transfer to retained earnings`,
      reference: reference || `RE-${Date.now()}`,
      lines: [
        {
          accountId: pnlAccount ? pnlAccount._id : retainedEarningsChart._id,
          accountName: pnlAccount ? pnlAccount.name : 'Profit & Loss',
          accountCode: pnlAccount ? pnlAccount.code : '3000',
          debit: amount,
          credit: 0,
        },
        {
          accountId: retainedEarningsChart._id,
          accountName: retainedEarningsChart.name,
          accountCode: retainedEarningsChart.code,
          debit: 0,
          credit: amount,
        },
      ],
      status: 'Posted',
      createdBy: req.user.id,
      postedBy: req.user.id,
      postedAt: new Date(),
    });

    res.status(200).json({
      success: true,
      data: retainedEarnings,
      message: `${amount} transferred to retained earnings successfully`,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};
// ==================== GET SUMMARY ====================
exports.getSummary = async (req, res) => {
  try {
    // Chart of Accounts se Equity type ke accounts fetch karo
    const accounts = await ChartOfAccount.find({ type: 'Equity' });
    
    let totalCapital = 0;
    let totalRetainedEarnings = 0;
    let totalReserves = 0;
    let totalDrawings = 0;
    
    for (const account of accounts) {
      const balance = account.currentBalance || account.openingBalance || 0;
      const name = account.name.toLowerCase();
      
      if (name.includes('capital') || name.includes('share')) {
        totalCapital += balance;
      } else if (name.includes('retained')) {
        totalRetainedEarnings += balance;
      } else if (name.includes('reserve')) {
        totalReserves += balance;
      } else if (name.includes('drawing')) {
        totalDrawings += balance;
      } else {
        // Default: Capital mein daal do
        totalCapital += balance;
      }
    }
    
    const totalEquity = totalCapital + totalRetainedEarnings + totalReserves - totalDrawings;
    
    res.status(200).json({
      success: true,
      data: {
        totalCapital,
        totalRetainedEarnings,
        totalReserves,
        totalDrawings,
        totalEquity,
      },
    });
  } catch (error) {
    console.error("🔥 Error in getSummary:", error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};
// ==================== GET ALL TRANSACTIONS ====================
exports.getAllTransactions = async (req, res) => {
  try {
    const accounts = await EquityAccount.find();
    
    let allTransactions = [];
    accounts.forEach(account => {
      account.transactions.forEach(txn => {
        allTransactions.push({
          id: txn._id,
          date: txn.date,
          type: txn.type,
          accountName: account.accountName,
          accountType: account.accountType,
          amount: txn.amount,
          description: txn.description,
          reference: txn.reference,
          status: txn.status,
        });
      });
    });

    // Sort by date descending
    allTransactions.sort((a, b) => b.date - a.date);

    res.status(200).json({
      success: true,
      count: allTransactions.length,
      data: allTransactions,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ==================== DELETE EQUITY ACCOUNT ====================
exports.deleteEquityAccount = async (req, res) => {
  try {
    const account = await EquityAccount.findById(req.params.id);

    if (!account) {
      return res.status(404).json({
        success: false,
        message: 'Equity account not found',
      });
    }

    if (account.transactions.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete account with transactions',
      });
    }

    await account.deleteOne();

    res.status(200).json({
      success: true,
      message: 'Equity account deleted successfully',
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};