const BankAccount = require('../models/BankAccount');
const ChartOfAccount = require('../models/ChartOfAccount');
const JournalEntry = require('../models/JournalEntry');

// Helper: Generate next journal entry number
async function getNextJournalNumber() {
  const count = await JournalEntry.countDocuments();
  const year = new Date().getFullYear();
  return `JE-${year}-${String(count + 1).padStart(4, '0')}`;
}

// @desc    Transfer money between bank accounts
// @route   POST /api/transfers
// @access  Private
exports.transferMoney = async (req, res) => {
  try {
    const { 
      fromAccountId, 
      toAccountId, 
      amount, 
      date, 
      reference, 
      description 
    } = req.body;
    
    // 1. Validate amount
    if (!amount || amount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Amount must be greater than 0',
      });
    }
    
    // 2. Get both bank accounts
    const fromAccount = await BankAccount.findById(fromAccountId);
    const toAccount = await BankAccount.findById(toAccountId);
    
    if (!fromAccount || !toAccount) {
      return res.status(404).json({
        success: false,
        message: 'Bank account not found',
      });
    }
    
    // 3. Validate sufficient balance
    if (fromAccount.currentBalance < amount) {
      return res.status(400).json({
        success: false,
        message: `Insufficient balance. Available: ${fromAccount.currentBalance}`,
      });
    }
    
    // 4. Validate same account
    if (fromAccountId === toAccountId) {
      return res.status(400).json({
        success: false,
        message: 'Cannot transfer to the same account',
      });
    }
    
    // 5. Get Chart of Accounts for both bank accounts
    const fromChartAccount = await ChartOfAccount.findById(fromAccount.chartOfAccountId);
    const toChartAccount = await ChartOfAccount.findById(toAccount.chartOfAccountId);
    
    if (!fromChartAccount || !toChartAccount) {
      return res.status(404).json({
        success: false,
        message: 'Chart of account not found',
      });
    }
    
    // 6. Create Journal Entry for transfer
    const transferDate = date ? new Date(date) : new Date();
    const transferReference = reference || `TRANS-${Date.now()}`;
    const transferDescription = description || 
      `Transfer from ${fromAccount.accountName} to ${toAccount.accountName}`;
    
    const journalEntry = await JournalEntry.create({
      entryNumber: await getNextJournalNumber(),
      date: transferDate,
      description: transferDescription,
      reference: transferReference,
      lines: [
        {
          accountId: toChartAccount._id,
          accountName: toChartAccount.name,
          accountCode: toChartAccount.code,
          debit: amount,
          credit: 0,
        },
        {
          accountId: fromChartAccount._id,
          accountName: fromChartAccount.name,
          accountCode: fromChartAccount.code,
          debit: 0,
          credit: amount,
        },
      ],
      status: 'Posted',
      createdBy: req.user.id,
      postedBy: req.user.id,
      postedAt: transferDate,
    });
    
    // 7. Update account balances
    fromAccount.currentBalance -= amount;
    toAccount.currentBalance += amount;
    
    await fromAccount.save();
    await toAccount.save();
    
    // 8. Update Chart of Accounts balances
    await ChartOfAccount.findByIdAndUpdate(fromChartAccount._id, {
      currentBalance: fromAccount.currentBalance,
    });
    await ChartOfAccount.findByIdAndUpdate(toChartAccount._id, {
      currentBalance: toAccount.currentBalance,
    });
    
    res.status(201).json({
      success: true,
      message: 'Transfer completed successfully',
      data: {
        journalEntry: {
          id: journalEntry._id,
          entryNumber: journalEntry.entryNumber,
          date: journalEntry.date,
          description: journalEntry.description,
          reference: journalEntry.reference,
        },
        fromAccount: {
          id: fromAccount._id,
          name: fromAccount.accountName,
          previousBalance: fromAccount.currentBalance + amount,
          currentBalance: fromAccount.currentBalance,
        },
        toAccount: {
          id: toAccount._id,
          name: toAccount.accountName,
          previousBalance: toAccount.currentBalance - amount,
          currentBalance: toAccount.currentBalance,
        },
        amount: amount,
      },
    });
  } catch (error) {
    console.error('Transfer error:', error);
    res.status(500).json({
      success: false,
      message: 'Server Error',
      error: error.message,
    });
  }
};

// @desc    Get transfer history
// @route   GET /api/transfers
// @access  Private
exports.getTransferHistory = async (req, res) => {
  try {
    const { accountId, startDate, endDate } = req.query;
    
    // Build query for transfer-related journal entries
    let query = {
      description: { $regex: 'Transfer', $options: 'i' },
      status: 'Posted',
    };
    
    // Filter by date range
    if (startDate && endDate) {
      query.date = {
        $gte: new Date(startDate),
        $lte: new Date(endDate),
      };
    }
    
    const transfers = await JournalEntry.find(query)
      .sort({ date: -1 })
      .limit(100);
    
    // If accountId specified, filter transfers involving that account
    let filteredTransfers = transfers;
    if (accountId) {
      const bankAccount = await BankAccount.findById(accountId);
      if (bankAccount) {
        filteredTransfers = transfers.filter(transfer => {
          return transfer.lines.some(line => 
            line.accountId.toString() === bankAccount.chartOfAccountId.toString()
          );
        });
      }
    }
    
    // Format response
    const transferHistory = filteredTransfers.map(transfer => {
      // Find from and to accounts
      const debitLine = transfer.lines.find(l => l.debit > 0);
      const creditLine = transfer.lines.find(l => l.credit > 0);
      
      return {
        id: transfer._id,
        entryNumber: transfer.entryNumber,
        date: transfer.date,
        description: transfer.description,
        reference: transfer.reference,
        amount: debitLine?.debit || creditLine?.credit || 0,
        fromAccount: creditLine?.accountName || 'Unknown',
        toAccount: debitLine?.accountName || 'Unknown',
      };
    });
    
    res.status(200).json({
      success: true,
      count: transferHistory.length,
      data: transferHistory,
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

// @desc    Get transfer details
// @route   GET /api/transfers/:id
// @access  Private
exports.getTransferDetails = async (req, res) => {
  try {
    const transfer = await JournalEntry.findById(req.params.id);
    
    if (!transfer) {
      return res.status(404).json({
        success: false,
        message: 'Transfer not found',
      });
    }
    
    // Find from and to accounts
    const debitLine = transfer.lines.find(l => l.debit > 0);
    const creditLine = transfer.lines.find(l => l.credit > 0);
    
    res.status(200).json({
      success: true,
      data: {
        id: transfer._id,
        entryNumber: transfer.entryNumber,
        date: transfer.date,
        description: transfer.description,
        reference: transfer.reference,
        amount: debitLine?.debit || creditLine?.credit || 0,
        fromAccount: {
          name: creditLine?.accountName,
          code: creditLine?.accountCode,
        },
        toAccount: {
          name: debitLine?.accountName,
          code: debitLine?.accountCode,
        },
        createdAt: transfer.createdAt,
        createdBy: transfer.createdBy,
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