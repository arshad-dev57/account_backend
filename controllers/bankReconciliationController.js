const BankAccount = require('../models/BankAccount');
const JournalEntry = require('../models/JournalEntry');
const ChartOfAccount = require('../models/ChartOfAccount');

// Helper: Get or create default accounts for reconciliation adjustments
async function getOrCreateAdjustmentAccounts(userId) {
  // Get or create Bank Charges Expense account
  let bankChargesAccount = await ChartOfAccount.findOne({ code: '5060' });
  if (!bankChargesAccount) {
    bankChargesAccount = await ChartOfAccount.create({
      code: '5060',
      name: 'Bank Charges Expense',
      type: 'Expenses',
      parentAccount: 'Operating Expenses',
      openingBalance: 0,
      description: 'Bank service charges and fees',
      taxCode: 'N/A',
      createdBy: userId,
    });
  }
  
  // Get or create Interest Income account
  let interestIncomeAccount = await ChartOfAccount.findOne({ code: '4030' });
  if (!interestIncomeAccount) {
    interestIncomeAccount = await ChartOfAccount.create({
      code: '4030',
      name: 'Interest Income',
      type: 'Income',
      parentAccount: 'Other Income',
      openingBalance: 0,
      description: 'Interest earned on bank deposits',
      taxCode: 'N/A',
      createdBy: userId,
    });
  }
  
  return { bankChargesAccount, interestIncomeAccount };
}

// @desc    Get bank account details with transactions for reconciliation
// @route   GET /api/bank-reconciliation/:accountId
// @access  Private
exports.getReconciliationData = async (req, res) => {
  try {
    const { accountId } = req.params;
    const { startDate, endDate } = req.query;
    
    // 1. Get bank account details
    const bankAccount = await BankAccount.findById(accountId)
      .populate('chartOfAccountId', 'code name currentBalance');
    
    if (!bankAccount) {
      return res.status(404).json({
        success: false,
        message: 'Bank account not found',
      });
    }
    
    // 2. Build date filter for transactions
    let dateFilter = {};
    if (startDate && endDate) {
      dateFilter = {
        date: {
          $gte: new Date(startDate),
          $lte: new Date(endDate),
        },
        status: 'Posted',
      };
    } else if (bankAccount.lastReconciled) {
      // Get transactions since last reconciliation
      dateFilter = {
        date: { $gte: bankAccount.lastReconciled },
        status: 'Posted',
      };
    } else {
      dateFilter = { status: 'Posted' };
    }
    
    // 3. Get journal entries for this bank account
    const journalEntries = await JournalEntry.find(dateFilter);
    
    // 4. Filter entries that have this bank account in lines
    const transactions = [];
    journalEntries.forEach(entry => {
      entry.lines.forEach(line => {
        if (line.accountId.toString() === bankAccount.chartOfAccountId._id.toString()) {
          transactions.push({
            id: entry._id,
            entryNumber: entry.entryNumber,
            date: entry.date,
            description: entry.description,
            reference: entry.reference,
            amount: line.debit || line.credit,
            type: line.debit > 0 ? 'Deposit' : 'Payment',
            isCleared: entry.isReconciled || false,
          });
        }
      });
    });
    
    // 5. Sort by date
    transactions.sort((a, b) => a.date - b.date);
    
    // 6. Calculate book balance
    let bookBalance = bankAccount.openingBalance;
    transactions.forEach(t => {
      if (t.type === 'Deposit') {
        bookBalance += t.amount;
      } else {
        bookBalance -= t.amount;
      }
    });
    
    res.status(200).json({
      success: true,
      data: {
        account: {
          id: bankAccount._id,
          name: bankAccount.accountName,
          number: bankAccount.accountNumber,
          openingBalance: bankAccount.openingBalance,
          currentBalance: bankAccount.currentBalance,
          lastReconciled: bankAccount.lastReconciled,
        },
        transactions,
        bookBalance,
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

// @desc    Complete bank reconciliation
// @route   POST /api/bank-reconciliation/:accountId/complete
// @access  Private
exports.completeReconciliation = async (req, res) => {
  try {
    const { accountId } = req.params;
    const { 
      statementBalance, 
      serviceCharge, 
      interestEarned, 
      clearedTransactionIds,
      statementDate 
    } = req.body;
    
    // 1. Get bank account
    const bankAccount = await BankAccount.findById(accountId);
    if (!bankAccount) {
      return res.status(404).json({
        success: false,
        message: 'Bank account not found',
      });
    }
    
    // 2. Get all transactions for this account since last reconciliation
    let dateFilter = {};
    if (bankAccount.lastReconciled) {
      dateFilter = { date: { $gte: bankAccount.lastReconciled }, status: 'Posted' };
    } else {
      dateFilter = { status: 'Posted' };
    }
    
    const journalEntries = await JournalEntry.find(dateFilter);
    
    // 3. Calculate uncleared amounts
    let unclearedDeposits = 0;
    let unclearedPayments = 0;
    let clearedTransactions = [];
    
    journalEntries.forEach(entry => {
      entry.lines.forEach(line => {
        if (line.accountId.toString() === bankAccount.chartOfAccountId.toString()) {
          const isCleared = clearedTransactionIds.includes(entry._id.toString());
          const amount = line.debit || line.credit;
          
          if (isCleared) {
            clearedTransactions.push(entry._id);
          } else {
            if (line.debit > 0) {
              unclearedDeposits += amount;
            } else {
              unclearedPayments += amount;
            }
          }
        }
      });
    });
    
    // 4. Calculate adjusted balances
    const bookBalance = bankAccount.currentBalance;
    const adjustedBookBalance = bookBalance - (serviceCharge || 0) + (interestEarned || 0);
    const reconciledBalance = statementBalance - unclearedDeposits + unclearedPayments;
    const difference = Math.abs(adjustedBookBalance - reconciledBalance);
    
    // 5. Validate reconciliation
    if (difference > 0.01) {
      return res.status(400).json({
        success: false,
        message: 'Reconciliation is not balanced',
        data: {
          bookBalance,
          adjustedBookBalance,
          statementBalance,
          reconciledBalance,
          difference,
          unclearedDeposits,
          unclearedPayments,
        },
      });
    }
    
    // 6. Create journal entries for adjustments
    const adjustmentEntries = [];
    const adjustmentDate = new Date();
    const { bankChargesAccount, interestIncomeAccount } = await getOrCreateAdjustmentAccounts(req.user.id);
    
    // Service charge adjustment
    if (serviceCharge && serviceCharge > 0) {
      const serviceChargeEntry = await JournalEntry.create({
        date: adjustmentDate,
        description: `Bank reconciliation adjustment - Service charge for ${bankAccount.accountName}`,
        reference: `REC-${Date.now()}`,
        lines: [
          {
            accountId: bankChargesAccount._id,
            accountName: bankChargesAccount.name,
            accountCode: bankChargesAccount.code,
            debit: serviceCharge,
            credit: 0,
          },
          {
            accountId: bankAccount.chartOfAccountId,
            accountName: bankAccount.accountName,
            accountCode: bankAccount.accountCode || '1020',
            debit: 0,
            credit: serviceCharge,
          },
        ],
        status: 'Posted',
        createdBy: req.user.id,
        postedBy: req.user.id,
        postedAt: adjustmentDate,
      });
      adjustmentEntries.push(serviceChargeEntry);
      
      // Update bank account balance
      bankAccount.currentBalance -= serviceCharge;
    }
    
    // Interest earned adjustment
    if (interestEarned && interestEarned > 0) {
      const interestEntry = await JournalEntry.create({
        date: adjustmentDate,
        description: `Bank reconciliation adjustment - Interest earned on ${bankAccount.accountName}`,
        reference: `REC-${Date.now()}`,
        lines: [
          {
            accountId: bankAccount.chartOfAccountId,
            accountName: bankAccount.accountName,
            accountCode: bankAccount.accountCode || '1020',
            debit: interestEarned,
            credit: 0,
          },
          {
            accountId: interestIncomeAccount._id,
            accountName: interestIncomeAccount.name,
            accountCode: interestIncomeAccount.code,
            debit: 0,
            credit: interestEarned,
          },
        ],
        status: 'Posted',
        createdBy: req.user.id,
        postedBy: req.user.id,
        postedAt: adjustmentDate,
      });
      adjustmentEntries.push(interestEntry);
      
      // Update bank account balance
      bankAccount.currentBalance += interestEarned;
    }
    
    // 7. Update bank account
    bankAccount.lastReconciled = statementDate ? new Date(statementDate) : new Date();
    await bankAccount.save();
    
    // 8. Update Chart of Accounts balance
    await ChartOfAccount.findByIdAndUpdate(bankAccount.chartOfAccountId, {
      currentBalance: bankAccount.currentBalance,
    });
    
    // 9. Mark transactions as reconciled
    for (const entryId of clearedTransactions) {
      await JournalEntry.findByIdAndUpdate(entryId, { isReconciled: true });
    }
    
    res.status(200).json({
      success: true,
      message: 'Bank reconciliation completed successfully',
      data: {
        account: {
          id: bankAccount._id,
          name: bankAccount.accountName,
          currentBalance: bankAccount.currentBalance,
          lastReconciled: bankAccount.lastReconciled,
        },
        adjustments: adjustmentEntries.length,
        clearedTransactions: clearedTransactions.length,
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

// @desc    Get reconciliation history for an account
// @route   GET /api/bank-reconciliation/:accountId/history
// @access  Private
exports.getReconciliationHistory = async (req, res) => {
  try {
    const { accountId } = req.params;
    
    const bankAccount = await BankAccount.findById(accountId);
    if (!bankAccount) {
      return res.status(404).json({
        success: false,
        message: 'Bank account not found',
      });
    }
    
    // Get all reconciliation-related journal entries
    const reconciliationEntries = await JournalEntry.find({
      description: { $regex: 'Bank reconciliation adjustment', $options: 'i' },
      'lines.accountId': bankAccount.chartOfAccountId,
      status: 'Posted',
    }).sort({ date: -1 });
    
    const history = reconciliationEntries.map(entry => ({
      id: entry._id,
      date: entry.date,
      description: entry.description,
      reference: entry.reference,
      serviceCharge: entry.lines.find(l => l.accountName?.includes('Bank Charges'))?.debit || 0,
      interestEarned: entry.lines.find(l => l.accountName?.includes('Interest'))?.credit || 0,
    }));
    
    res.status(200).json({
      success: true,
      count: history.length,
      data: history,
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