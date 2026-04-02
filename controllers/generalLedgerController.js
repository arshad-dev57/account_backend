const JournalEntry = require('../models/JournalEntry');
const ChartOfAccount = require('../models/ChartOfAccount');

// @desc    Get all accounts summary for General Ledger
// @route   GET /api/general-ledger/accounts
// @access  Private
exports.getAccountSummaries = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    // Build date filter
    let dateFilter = { 
      status: 'Posted',
      createdBy: req.user.id  // 👈 Only show entries created by this user
    };
    
    if (startDate && endDate) {
      dateFilter.date = {
        $gte: new Date(startDate),
        $lte: new Date(endDate),
      };
    }
    
    // Get all posted journal entries for this user
    const journalEntries = await JournalEntry.find(dateFilter);
    
    // Get all accounts created by this user
    const accounts = await ChartOfAccount.find({ 
      isActive: true,
      createdBy: req.user.id  // 👈 Only show accounts created by this user
    });
    
    // Calculate summary for each account
    const accountSummaries = accounts.map(account => {
      // Filter entries for this account
      const accountEntries = journalEntries.filter(entry => {
        return entry.lines.some(line => 
          line.accountId.toString() === account._id.toString()
        );
      });
      
      let totalDebit = 0;
      let totalCredit = 0;
      
      // Calculate totals
      accountEntries.forEach(entry => {
        entry.lines.forEach(line => {
          if (line.accountId.toString() === account._id.toString()) {
            totalDebit += line.debit || 0;
            totalCredit += line.credit || 0;
          }
        });
      });
      
      // Calculate closing balance
      let closingBalance = account.openingBalance;
      if (account.type === 'Assets' || account.type === 'Expenses') {
        closingBalance = account.openingBalance + totalDebit - totalCredit;
      } else {
        closingBalance = account.openingBalance + totalCredit - totalDebit;
      }
      
      return {
        accountId: account._id,
        accountCode: account.code,
        accountName: account.name,
        accountType: account.type,
        openingBalance: account.openingBalance,
        totalDebit,
        totalCredit,
        closingBalance,
      };
    });
    
    res.status(200).json({
      success: true,
      count: accountSummaries.length,
      data: accountSummaries,
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

// @desc    Get ledger entries for a specific account
// @route   GET /api/general-ledger/entries/:accountId
// @access  Private
exports.getLedgerEntries = async (req, res) => {
  try {
    const { accountId } = req.params;
    const { startDate, endDate, search } = req.query;
    
    // Get account details - must belong to user
    const account = await ChartOfAccount.findOne({
      _id: accountId,
      createdBy: req.user.id  // 👈 Only allow if user owns this account
    });
    
    if (!account) {
      return res.status(404).json({
        success: false,
        message: 'Account not found',
      });
    }
    
    // Build query - only posted entries created by this user
    let query = { 
      status: 'Posted',
      createdBy: req.user.id  // 👈 Only show entries created by this user
    };
    
    // Filter by date range
    if (startDate && endDate) {
      query.date = {
        $gte: new Date(startDate),
        $lte: new Date(endDate),
      };
    }
    
    // Get journal entries
    let journalEntries = await JournalEntry.find(query).sort({ date: 1 });
    
    // Filter entries that have this account in lines
    const filteredEntries = journalEntries.filter(entry => {
      return entry.lines.some(line => 
        line.accountId.toString() === accountId
      );
    });
    
    // Process entries to show running balance
    let runningBalance = account.openingBalance;
    const ledgerEntries = [];
    
    filteredEntries.forEach(entry => {
      const accountLine = entry.lines.find(line => 
        line.accountId.toString() === accountId
      );
      
      if (accountLine) {
        const { debit, credit } = accountLine;
        
        // Update running balance based on account type
        if (account.type === 'Assets' || account.type === 'Expenses') {
          runningBalance = runningBalance + debit - credit;
        } else {
          runningBalance = runningBalance + credit - debit;
        }
        
        ledgerEntries.push({
          id: entry.entryNumber,
          date: entry.date,
          accountId: account._id,
          accountName: account.name,
          accountCode: account.code,
          description: entry.description,
          debit: debit,
          credit: credit,
          balance: runningBalance,
          reference: entry.reference,
        });
      }
    });
    
    // Apply search filter
    let filteredLedger = ledgerEntries;
    if (search) {
      const searchTerm = search.toLowerCase();
      filteredLedger = ledgerEntries.filter(entry =>
        entry.description.toLowerCase().includes(searchTerm) ||
        entry.reference.toLowerCase().includes(searchTerm) ||
        entry.id.toLowerCase().includes(searchTerm)
      );
    }
    
    res.status(200).json({
      success: true,
      account: {
        id: account._id,
        code: account.code,
        name: account.name,
        type: account.type,
        openingBalance: account.openingBalance,
      },
      count: filteredLedger.length,
      data: filteredLedger,
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

// @desc    Get all ledger entries (all accounts combined)
// @route   GET /api/general-ledger/all-entries
// @access  Private
exports.getAllLedgerEntries = async (req, res) => {
  try {
    const { startDate, endDate, accountId, search } = req.query;
    
    // Build query - only posted entries created by this user
    let query = { 
      status: 'Posted',
      createdBy: req.user.id  // 👈 Only show entries created by this user
    };
    
    if (startDate && endDate) {
      query.date = {
        $gte: new Date(startDate),
        $lte: new Date(endDate),
      };
    }
    
    // Get journal entries
    let journalEntries = await JournalEntry.find(query).sort({ date: 1 });
    
    // Filter by account if specified - must also check account belongs to user
    let filteredEntries = journalEntries;
    if (accountId) {
      // First verify account belongs to user
      const account = await ChartOfAccount.findOne({
        _id: accountId,
        createdBy: req.user.id
      });
      
      if (!account) {
        return res.status(404).json({
          success: false,
          message: 'Account not found',
        });
      }
      
      filteredEntries = journalEntries.filter(entry => {
        return entry.lines.some(line => 
          line.accountId.toString() === accountId
        );
      });
    }
    
    // Process all entries to show running balances per account
    const allEntries = [];
    const accountBalances = new Map();
    
    // Initialize account balances - only accounts created by this user
    const accounts = await ChartOfAccount.find({ 
      isActive: true,
      createdBy: req.user.id  // 👈 Only accounts created by this user
    });
    
    accounts.forEach(account => {
      accountBalances.set(account._id.toString(), {
        balance: account.openingBalance,
        type: account.type,
        code: account.code,
        name: account.name,
      });
    });
    
    filteredEntries.forEach(entry => {
      entry.lines.forEach(line => {
        const accountId = line.accountId.toString();
        const accountData = accountBalances.get(accountId);
        
        if (accountData) {
          const { debit, credit } = line;
          
          // Update balance
          if (accountData.type === 'Assets' || accountData.type === 'Expenses') {
            accountData.balance = accountData.balance + debit - credit;
          } else {
            accountData.balance = accountData.balance + credit - debit;
          }
          
          allEntries.push({
            id: entry.entryNumber,
            date: entry.date,
            accountId: accountId,
            accountName: accountData.name,
            accountCode: accountData.code,
            description: entry.description,
            debit: debit,
            credit: credit,
            balance: accountData.balance,
            reference: entry.reference,
          });
        }
      });
    });
    
    // Apply search filter
    let filteredResult = allEntries;
    if (search) {
      const searchTerm = search.toLowerCase();
      filteredResult = allEntries.filter(entry =>
        entry.description.toLowerCase().includes(searchTerm) ||
        entry.reference.toLowerCase().includes(searchTerm) ||
        entry.id.toLowerCase().includes(searchTerm)
      );
    }
    
    res.status(200).json({
      success: true,
      count: filteredResult.length,
      data: filteredResult,
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