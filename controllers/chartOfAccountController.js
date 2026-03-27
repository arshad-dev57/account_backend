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

// @desc    Get all accounts
// @route   GET /api/chart-of-accounts
// @access  Private
exports.getAccounts = async (req, res) => {
  try {
    const { type, search } = req.query;
    
    let query = {};

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

    const accounts = await ChartOfAccount.find(query).sort({ code: 1 });

    // Calculate summary totals
    const summary = {
      Assets: 0,
      Liabilities: 0,
      Equity: 0,
      Income: 0,
      Expenses: 0,
    };

    accounts.forEach((account) => {
      if (summary[account.type] !== undefined) {
        summary[account.type] += account.currentBalance;
      }
    });

    res.status(200).json({
      success: true,
      count: accounts.length,
      data: accounts,
      summary,
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

// @desc    Delete account
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

    await account.deleteOne();

    res.status(200).json({
      success: true,
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

// @desc    Create default accounts
// @route   POST /api/chart-of-accounts/default
// @access  Private
exports.createDefaultAccounts = async (req, res) => {
  try {
    const defaultAccounts = [
      // Assets
      { code: '1010', name: 'Cash in Hand', type: 'Assets', parentAccount: 'Current Assets', openingBalance: 0, description: 'Physical cash in office' },
      { code: '1020', name: 'Bank Account', type: 'Assets', parentAccount: 'Current Assets', openingBalance: 0, description: 'Main business bank account' },
      { code: '1110', name: 'Accounts Receivable', type: 'Assets', parentAccount: 'Current Assets', openingBalance: 0, description: 'Amount due from customers' },
      { code: '1120', name: 'Inventory', type: 'Assets', parentAccount: 'Current Assets', openingBalance: 0, description: 'Stock and supplies' },
      { code: '1210', name: 'Fixed Assets', type: 'Assets', parentAccount: 'Fixed Assets', openingBalance: 0, description: 'Long-term assets' },
      
      // Liabilities
      { code: '2010', name: 'Accounts Payable', type: 'Liabilities', parentAccount: 'Current Liabilities', openingBalance: 0, description: 'Amount due to vendors' },
      { code: '2020', name: 'Tax Payable', type: 'Liabilities', parentAccount: 'Current Liabilities', openingBalance: 0, description: 'Sales tax payable' },
      { code: '2030', name: 'Loans Payable', type: 'Liabilities', parentAccount: 'Long Term Liabilities', openingBalance: 0, description: 'Bank loans and borrowings' },
      
      // Equity
      { code: '3010', name: "Owner's Capital", type: 'Equity', parentAccount: 'Equity', openingBalance: 0, description: 'Owner investment' },
      { code: '3020', name: 'Retained Earnings', type: 'Equity', parentAccount: 'Equity', openingBalance: 0, description: 'Accumulated profits' },
      
      // Income
      { code: '4010', name: 'Sales Revenue', type: 'Income', parentAccount: 'Operating Income', openingBalance: 0, description: 'Revenue from sales' },
      { code: '4020', name: 'Service Revenue', type: 'Income', parentAccount: 'Operating Income', openingBalance: 0, description: 'Revenue from services' },
      { code: '4030', name: 'Other Income', type: 'Income', parentAccount: 'Operating Income', openingBalance: 0, description: 'Miscellaneous income' },
      
      // Expenses
      { code: '5010', name: 'Rent Expense', type: 'Expenses', parentAccount: 'Operating Expenses', openingBalance: 0, description: 'Office rent' },
      { code: '5020', name: 'Salary Expense', type: 'Expenses', parentAccount: 'Operating Expenses', openingBalance: 0, description: 'Employee salaries' },
      { code: '5030', name: 'Utilities Expense', type: 'Expenses', parentAccount: 'Operating Expenses', openingBalance: 0, description: 'Electricity, water, gas' },
      { code: '5040', name: 'Office Supplies', type: 'Expenses', parentAccount: 'Operating Expenses', openingBalance: 0, description: 'Stationery and supplies' },
      { code: '5050', name: 'Marketing Expense', type: 'Expenses', parentAccount: 'Operating Expenses', openingBalance: 0, description: 'Advertising and marketing' },
    ];

    const createdAccounts = [];

    for (const account of defaultAccounts) {
      account.createdBy = req.user.id;
      
      const existing = await ChartOfAccount.findOne({
        code: account.code,
      });
      
      if (!existing) {
        const newAccount = await ChartOfAccount.create(account);
        createdAccounts.push(newAccount);
      }
    }

    res.status(201).json({
      success: true,
      count: createdAccounts.length,
      data: createdAccounts,
      message: `${createdAccounts.length} default accounts created`,
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