const ChartOfAccount = require('../models/ChartOfAccount');

// @desc    Create new account
// @route   POST /api/chart-of-accounts
// @access  Private
exports.createAccount = async (req, res) => {
  try {
    req.body.createdBy = req.user.id;

    // Check if account code already exists
    const existingAccount = await ChartOfAccount.findOne({
      code: req.body.code,
        createdBy: req.user.id, // ✅ yeh add karo
    });

    if (existingAccount) {
      return res.status(400).json({
        success: false,
        message: 'Account code already exists',
      });
    }

    const account = await ChartOfAccount.create(req.body);

    res.status(201).json({
      success: true,
      data: account,
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

// @desc    Get all accounts with pagination
// @route   GET /api/chart-of-accounts
// @access  Private
exports.getAccounts = async (req, res) => {
  try {
    const { 
      type, 
      search, 
      page = 1, 
      limit = 6,
      sortBy = 'code',
      sortOrder = 'asc'
    } = req.query;
    
    let query = {
      createdBy: req.user.id
    };

    // Filter by account type
    if (type && type !== 'All') {
      query.type = type;
    }

    // Search by code or name
    if (search) {
      query.$or = [
        { code: { $regex: search, $options: 'i' } },
        { name: { $regex: search, $options: 'i' } },
      ];
    }

    // Calculate total count for pagination
    const totalCount = await ChartOfAccount.countDocuments(query);
    
    // Check if user wants all records (no pagination)
    if (req.query.page === 'all' || req.query.limit === 'all') {
      const accounts = await ChartOfAccount.find(query).sort({ code: 1 });
      
      // Calculate summary totals
      const summary = {
        Assets: 0,
        Liabilities: 0,
        Equity: 0,
        Income: 0,
        Expenses: 0,
        totalBalance: 0
      };
      
      accounts.forEach((account) => {
        if (summary[account.type] !== undefined) {
          summary[account.type] += account.currentBalance;
        }
        summary.totalBalance += account.currentBalance;
      });
      
      return res.status(200).json({
        success: true,
        count: accounts.length,
        data: accounts,
        summary,
        pagination: {
          total: accounts.length,
          page: 1,
          pages: 1,
          hasNext: false,
          hasPrev: false,
          isAllRecords: true
        }
      });
    }
    
    // Calculate pagination values
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;
    
    // Build sort object
    const sort = {};
    sort[sortBy] = sortOrder === 'desc' ? -1 : 1;
    
    // Get paginated accounts
    const accounts = await ChartOfAccount.find(query)
      .sort(sort)
      .skip(skip)
      .limit(limitNum);
    
    // Calculate summary totals (for paginated data)
    const summary = {
      Assets: 0,
      Liabilities: 0,
      Equity: 0,
      Income: 0,
      Expenses: 0,
      totalBalance: 0
    };
    
    accounts.forEach((account) => {
      if (summary[account.type] !== undefined) {
        summary[account.type] += account.currentBalance;
      }
      summary.totalBalance += account.currentBalance;
    });
    
    // Calculate pagination metadata
    const totalPages = Math.ceil(totalCount / limitNum);
    const hasNext = pageNum < totalPages;
    const hasPrev = pageNum > 1;
    
    res.status(200).json({
      success: true,
      count: accounts.length,
      totalCount: totalCount,
      data: accounts,
      summary,
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

// @desc    Get single account
// @route   GET /api/chart-of-accounts/:id
// @access  Private
exports.getAccount = async (req, res) => {
  try {
    const account = await ChartOfAccount.findById(req.params.id);

    if (!account) {
      return res.status(404).json({
        success: false,
        message: 'Account not found',
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
      message: 'Server Error',
      error: error.message,
    });
  }
};

// @desc    Update account
// @route   PUT /api/chart-of-accounts/:id
// @access  Private
exports.updateAccount = async (req, res) => {
  try {
    let account = await ChartOfAccount.findById(req.params.id);

    if (!account) {
      return res.status(404).json({
        success: false,
        message: 'Account not found',
      });
    }

    // Check if updating code to a duplicate
    if (req.body.code && req.body.code !== account.code) {
      const existingAccount = await ChartOfAccount.findOne({
        code: req.body.code,
      });

      if (existingAccount) {
        return res.status(400).json({
          success: false,
          message: 'Account code already exists',
        });
      }
    }

    account = await ChartOfAccount.findByIdAndUpdate(
      req.params.id,
      req.body,
      {
        new: true,
        runValidators: true,
      }
    );

    res.status(200).json({
      success: true,
      data: account,
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

// @desc    Delete account (with balance and transaction checks)
// @route   DELETE /api/chart-of-accounts/:id
// @access  Private
exports.deleteAccount = async (req, res) => {
  try {
    const account = await ChartOfAccount.findById(req.params.id);

    if (!account) {
      return res.status(404).json({
        success: false,
        message: 'Account not found',
      });
    }

    // Check if account has non-zero balance
    if (account.currentBalance !== 0) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete account with non-zero balance. Please transfer or reconcile balance first.',
      });
    }

    // Optional: Check if account is linked to any journal entries
    // Uncomment this section if you have JournalEntry model
    /*
    const JournalEntry = require('../models/JournalEntry');
    const linkedEntries = await JournalEntry.findOne({
      $or: [
        { 'debitEntries.accountId': account._id },
        { 'creditEntries.accountId': account._id }
      ]
    });
    
    if (linkedEntries) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete account linked to journal entries. Account is in use.',
      });
    }
    */

    await account.deleteOne();

    res.status(200).json({
      success: true,
      message: 'Account deleted successfully',
      data: {},
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

// @desc    Archive/Deactivate account (Soft delete)
// @route   PATCH /api/chart-of-accounts/:id/archive
// @access  Private
exports.archiveAccount = async (req, res) => {
  try {
    const { isActive } = req.body;
    
    const account = await ChartOfAccount.findById(req.params.id);

    if (!account) {
      return res.status(404).json({
        success: false,
        message: 'Account not found',
      });
    }

    // If deactivating, check if account has balance
    if (isActive === false && account.currentBalance !== 0) {
      return res.status(400).json({
        success: false,
        message: 'Cannot deactivate account with non-zero balance',
      });
    }

    account.isActive = isActive !== undefined ? isActive : !account.isActive;
    await account.save();

    res.status(200).json({
      success: true,
      message: account.isActive ? 'Account activated successfully' : 'Account archived successfully',
      data: account,
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
