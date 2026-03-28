const JournalEntry = require('../models/JournalEntry');
const ChartOfAccount = require('../models/ChartOfAccount');



exports.getTrialBalance = async (req, res) => {
  try {
    const { startDate, endDate, accountType, showZeroBalance } = req.query;
    
    // Build date filter
    let dateFilter = {};
    if (startDate && endDate) {
      dateFilter = {
        date: {
          $gte: new Date(startDate),
          $lte: new Date(endDate),
        },
        status: 'Posted',
      };
    } else {
      dateFilter = { status: 'Posted' };
    }
    
    // Get all posted journal entries within date range
    const journalEntries = await JournalEntry.find(dateFilter);
    
    // Get all active accounts
    let accountsQuery = { isActive: true };
    
    // Filter by account type if specified
    if (accountType && accountType !== 'All') {
      accountsQuery.type = accountType;
    }
    
    const accounts = await ChartOfAccount.find(accountsQuery);
    
    // Calculate debit and credit balances for each account
    const trialBalanceData = accounts.map(account => {
      let debitBalance = 0;
      let creditBalance = 0;
      
      // Calculate from journal entries
      journalEntries.forEach(entry => {
        entry.lines.forEach(line => {
          if (line.accountId.toString() === account._id.toString()) {
            debitBalance += line.debit || 0;
            creditBalance += line.credit || 0;
          }
        });
      });
      
      // Add opening balance
      if (account.type === 'Assets' || account.type === 'Expenses') {
        debitBalance += account.openingBalance;
      } else {
        creditBalance += account.openingBalance;
      }
      
      // Determine final balance (Debit or Credit)
      let finalDebitBalance = 0;
      let finalCreditBalance = 0;
      const netBalance = debitBalance - creditBalance;
      
      if (netBalance > 0) {
        finalDebitBalance = netBalance;
        finalCreditBalance = 0;
      } else if (netBalance < 0) {
        finalDebitBalance = 0;
        finalCreditBalance = Math.abs(netBalance);
      }
      
      return {
        accountId: account._id,
        accountCode: account.code,
        accountName: account.name,
        accountType: account.type,
        debitBalance: finalDebitBalance,
        creditBalance: finalCreditBalance,
      };
    });
    
    // Filter zero balance accounts if needed
    let filteredData = trialBalanceData;
    if (showZeroBalance === 'false') {
      filteredData = trialBalanceData.filter(account => 
        account.debitBalance > 0 || account.creditBalance > 0
      );
    }
    
    // Calculate totals
    const totalDebit = filteredData.reduce((sum, acc) => sum + acc.debitBalance, 0);
    const totalCredit = filteredData.reduce((sum, acc) => sum + acc.creditBalance, 0);
    const difference = Math.abs(totalDebit - totalCredit);
    const isBalanced = difference < 0.01;
    
    res.status(200).json({
      success: true,
      count: filteredData.length,
      data: filteredData,
      summary: {
        totalDebit,
        totalCredit,
        difference,
        isBalanced,
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

// @desc    Get Trial Balance summary only (for dashboard)
// @route   GET /api/trial-balance/summary
// @access  Private
exports.getTrialBalanceSummary = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    // Build date filter
    let dateFilter = {};
    if (startDate && endDate) {
      dateFilter = {
        date: {
          $gte: new Date(startDate),
          $lte: new Date(endDate),
        },
        status: 'Posted',
      };
    } else {
      dateFilter = { status: 'Posted' };
    }
    
    // Get all posted journal entries
    const journalEntries = await JournalEntry.find(dateFilter);
    
    // Get all active accounts
    const accounts = await ChartOfAccount.find({ isActive: true });
    
    // Calculate totals by account type
    const totals = {
      Assets: { debit: 0, credit: 0 },
      Liabilities: { debit: 0, credit: 0 },
      Equity: { debit: 0, credit: 0 },
      Income: { debit: 0, credit: 0 },
      Expenses: { debit: 0, credit: 0 },
    };
    
    accounts.forEach(account => {
      let debitBalance = 0;
      let creditBalance = 0;
      
      journalEntries.forEach(entry => {
        entry.lines.forEach(line => {
          if (line.accountId.toString() === account._id.toString()) {
            debitBalance += line.debit || 0;
            creditBalance += line.credit || 0;
          }
        });
      });
      
      if (account.type === 'Assets' || account.type === 'Expenses') {
        debitBalance += account.openingBalance;
      } else {
        creditBalance += account.openingBalance;
      }
      
      const netBalance = debitBalance - creditBalance;
      
      if (totals[account.type]) {
        if (netBalance > 0) {
          totals[account.type].debit += netBalance;
        } else if (netBalance < 0) {
          totals[account.type].credit += Math.abs(netBalance);
        }
      }
    });
    
    const totalDebit = Object.values(totals).reduce((sum, t) => sum + t.debit, 0);
    const totalCredit = Object.values(totals).reduce((sum, t) => sum + t.credit, 0);
    const isBalanced = Math.abs(totalDebit - totalCredit) < 0.01;
    
    res.status(200).json({
      success: true,
      data: {
        totals,
        summary: {
          totalDebit,
          totalCredit,
          difference: Math.abs(totalDebit - totalCredit),
          isBalanced,
        },
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