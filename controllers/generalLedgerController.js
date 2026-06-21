const JournalEntry = require('../models/JournalEntry');
const ChartOfAccount = require('../models/ChartOfAccount');

exports.getAccountSummaries = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    // Build date filter
    let dateFilter = { 
      status: 'Posted',
      createdBy: req.user.id  
    };
    
    if (startDate && endDate) {
      dateFilter.date = {
        $gte: new Date(startDate),
        $lte: new Date(endDate),
      };
    }
    
   
    const journalEntries = await JournalEntry.find(dateFilter);
 
    const accounts = await ChartOfAccount.find({ 
      isActive: true,
      createdBy: req.user.id  
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
      
      accountEntries.forEach(entry => {
        entry.lines.forEach(line => {
          if (line.accountId.toString() === account._id.toString()) {
            totalDebit += line.debit || 0;
            totalCredit += line.credit || 0;
          }
        });
      });
      
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


exports.getLedgerEntries = async (req, res) => {
  try {
    const { accountId } = req.params;
    const { startDate, endDate, search } = req.query;
    
    // Get account details - must belong to user
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
    
    let query = { 
      status: 'Posted',
      createdBy: req.user.id  
    };
    
    // Filter by date range
    if (startDate && endDate) {
      query.date = {
        $gte: new Date(startDate),
        $lte: new Date(endDate),
      };
    }
    
    let journalEntries = await JournalEntry.find(query).sort({ date: 1 });
    
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
    const { 
      startDate, 
      endDate, 
      accountId, 
      search,
      page = 1,
      limit = 20,
      sortBy = 'date',
      sortOrder = 'desc'
    } = req.query;
    
    // Build query - only posted entries created by this user
    let query = { 
      status: 'Posted',
      createdBy: req.user.id
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
      createdBy: req.user.id
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
        const accountIdStr = line.accountId.toString();
        const accountData = accountBalances.get(accountIdStr);
        
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
            accountId: accountIdStr,
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
    
    // ==================== PAGINATION ====================
    const totalCount = filteredResult.length;
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;
    
    // Sort the results
    const sortDirection = sortOrder === 'desc' ? -1 : 1;
    filteredResult.sort((a, b) => {
      if (sortBy === 'date') {
        return sortDirection * (new Date(a.date) - new Date(b.date));
      } else if (sortBy === 'debit') {
        return sortDirection * (a.debit - b.debit);
      } else if (sortBy === 'credit') {
        return sortDirection * (a.credit - b.credit);
      } else if (sortBy === 'balance') {
        return sortDirection * (a.balance - b.balance);
      } else if (sortBy === 'accountName') {
        return sortDirection * a.accountName.localeCompare(b.accountName);
      } else {
        return sortDirection * (new Date(a.date) - new Date(b.date));
      }
    });
    
    // Check if user wants all records (no pagination)
    if (req.query.page === 'all' || req.query.limit === 'all') {
      return res.status(200).json({
        success: true,
        count: filteredResult.length,
        data: filteredResult,
        pagination: {
          total: filteredResult.length,
          page: 1,
          pages: 1,
          hasNext: false,
          hasPrev: false,
          isAllRecords: true
        }
      });
    }
    
    // Apply pagination
    const paginatedData = filteredResult.slice(skip, skip + limitNum);
    
    // Calculate pagination metadata
    const totalPages = Math.ceil(totalCount / limitNum);
    const hasNext = pageNum < totalPages;
    const hasPrev = pageNum > 1;
    
    // Calculate summary (optional - useful for dashboard)
    const totalDebit = paginatedData.reduce((sum, entry) => sum + entry.debit, 0);
    const totalCredit = paginatedData.reduce((sum, entry) => sum + entry.credit, 0);
    
    res.status(200).json({
      success: true,
      count: paginatedData.length,
      totalCount: totalCount,
      data: paginatedData,
      summary: {
        totalDebit: totalDebit,
        totalCredit: totalCredit,
        difference: totalDebit - totalCredit
      },
      pagination: {
        total: totalCount,
        page: pageNum,
        limit: limitNum,
        pages: totalPages,
        hasNext: hasNext,
        hasPrev: hasPrev,
        nextPage: hasNext ? pageNum + 1 : null,
        prevPage: hasPrev ? pageNum - 1 : null,
        startIndex: skip + 1,
        endIndex: Math.min(skip + limitNum, totalCount),
        isAllRecords: false
      }
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