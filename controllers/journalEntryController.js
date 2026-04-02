const JournalEntry = require('../models/JournalEntry');
const ChartOfAccount = require('../models/ChartOfAccount');

// ==================== CREATE JOURNAL ENTRY ====================
exports.createJournalEntry = async (req, res) => {
  try {
    const { date, description, reference, lines } = req.body;
    
    // Validate lines exist and have data
    if (!lines || lines.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'At least one journal line is required',
      });
    }
    
    // Validate each line has valid accountId
    for (const line of lines) {
      // Check if accountId is provided and not empty
      if (!line.accountId || line.accountId === '') {
        return res.status(400).json({
          success: false,
          message: 'Account ID is required for each journal line',
        });
      }
      
      // Validate account exists
      const account = await ChartOfAccount.findById(line.accountId);
      if (!account) {
        return res.status(400).json({
          success: false,
          message: `Account not found with ID: ${line.accountId}`,
        });
      }
      
      line.accountName = account.name;
      line.accountCode = account.code;
    }
    
    const journalEntry = await JournalEntry.create({
      date: date || new Date(),
      description,
      reference: reference || '',
      lines,
      createdBy: req.user.id,
      status: 'Draft',
    });
    
    res.status(201).json({
      success: true,
      data: journalEntry,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: error.message || 'Server Error',
    });
  }
};
exports.getJournalEntries = async (req, res) => {
  try {
    const { 
      status, 
      search, 
      startDate, 
      endDate,
      page = 1,
      limit = 10
    } = req.query;
    
    let query = {
      createdBy: req.user.id
    };
    
    // Filter by status
    if (status && status !== 'All') {
      query.status = status;
    }
    
    // Filter by date range
    if (startDate && endDate) {
      query.date = {
        $gte: new Date(startDate),
        $lte: new Date(endDate),
      };
    }
    
    // Search by entryNumber, description, reference
    if (search) {
      query.$or = [
        { entryNumber: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
        { reference: { $regex: search, $options: 'i' } },
      ];
    }
    
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    const journalEntries = await JournalEntry.find(query)
      .populate('createdBy', 'firstName lastName')
      .populate('postedBy', 'firstName lastName')
      .sort({ date: -1, createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));
    
    const total = await JournalEntry.countDocuments(query);
    const totalPages = Math.ceil(total / parseInt(limit));
    
    // Calculate summary for all filtered entries (not just current page)
    const allEntries = await JournalEntry.find(query);
    let totalDebit = 0;
    let totalCredit = 0;
    let postedCount = 0;
    let draftCount = 0;
    
    allEntries.forEach(entry => {
      const entryDebit = entry.lines.reduce((sum, line) => sum + line.debit, 0);
      const entryCredit = entry.lines.reduce((sum, line) => sum + line.credit, 0);
      totalDebit += entryDebit;
      totalCredit += entryCredit;
      
      if (entry.status === 'Posted') postedCount++;
      else draftCount++;
    });
    
    res.status(200).json({
      success: true,
      count: journalEntries.length,
      total: total,
      page: parseInt(page),
      pages: totalPages,
      data: journalEntries,
      summary: {
        totalDebit,
        totalCredit,
        difference: Math.abs(totalDebit - totalCredit),
        postedCount,
        draftCount,
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
};exports.getJournalEntry = async (req, res) => {
  try {
    const journalEntry = await JournalEntry.findOne({
      _id: req.params.id,
      createdBy: req.user.id
    })
      .populate('createdBy', 'firstName lastName')
      .populate('postedBy', 'firstName lastName');
    
    if (!journalEntry) {
      return res.status(404).json({
        success: false,
        message: 'Journal entry not found',
      });
    }
    
    res.status(200).json({
      success: true,
      data: journalEntry,
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
exports.updateJournalEntry = async (req, res) => {
  try {
    let journalEntry = await JournalEntry.findOne({
      _id: req.params.id,
      createdBy: req.user.id
    });
    
    if (!journalEntry) {
      return res.status(404).json({
        success: false,
        message: 'Journal entry not found',
      });
    }
    
    if (journalEntry.status === 'Posted') {
      return res.status(400).json({
        success: false,
        message: 'Cannot update posted journal entry',
      });
    }
    
    const { date, description, reference, lines } = req.body;
    
    // Validate accounts if lines are updated
    if (lines && lines.length > 0) {
      for (const line of lines) {
        const account = await ChartOfAccount.findOne({
          _id: line.accountId,
          createdBy: req.user.id
        });
        if (!account) {
          return res.status(400).json({
            success: false,
            message: `Account not found: ${line.accountId}`,
          });
        }
        line.accountName = account.name;
        line.accountCode = account.code;
      }
      journalEntry.lines = lines;
    }
    
    if (date) journalEntry.date = date;
    if (description) journalEntry.description = description;
    if (reference !== undefined) journalEntry.reference = reference;
    
    await journalEntry.save();
    
    res.status(200).json({
      success: true,
      data: journalEntry,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: error.message || 'Server Error',
    });
  }
};
exports.postJournalEntry = async (req, res) => {
  try {
    const journalEntry = await JournalEntry.findOne({
      _id: req.params.id,
      createdBy: req.user.id
    });
    
    if (!journalEntry) {
      return res.status(404).json({
        success: false,
        message: 'Journal entry not found',
      });
    }
    
    if (journalEntry.status === 'Posted') {
      return res.status(400).json({
        success: false,
        message: 'Journal entry already posted',
      });
    }
    
    journalEntry.status = 'Posted';
    journalEntry.postedBy = req.user.id;
    journalEntry.postedAt = new Date();
    
    await journalEntry.save();
    
    // TODO: Update account balances in Chart of Accounts
    // This will be implemented in next step
    
    res.status(200).json({
      success: true,
      data: journalEntry,
      message: 'Journal entry posted successfully',
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
exports.deleteJournalEntry = async (req, res) => {
  try {
    const journalEntry = await JournalEntry.findOne({
      _id: req.params.id,
      createdBy: req.user.id
    });
    
    if (!journalEntry) {
      return res.status(404).json({
        success: false,
        message: 'Journal entry not found',
      });
    }
    
    if (journalEntry.status === 'Posted') {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete posted journal entry',
      });
    }
    
    await journalEntry.deleteOne();
    
    res.status(200).json({
      success: true,
      data: {},
      message: 'Journal entry deleted successfully',
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