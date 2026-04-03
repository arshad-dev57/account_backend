const Expense = require('../models/Expense');
const Vendor = require('../models/Vendor');
const BankAccount = require('../models/BankAccount');
const JournalEntry = require('../models/JournalEntry');
const ChartOfAccount = require('../models/ChartOfAccount');

// ==================== HELPER FUNCTIONS ====================

// Helper: Get or create Expense account (WITHOUT duplicate error)
async function getOrCreateExpenseAccount(userId, expenseType) {
  let accountCode = '5000';
  let accountName = 'Expenses';
  
  const categoryMap = {
    'Rent': { code: '5100', name: 'Rent Expense' },
    'Utilities': { code: '5200', name: 'Utilities Expense' },
    'Salaries': { code: '5300', name: 'Salaries Expense' },
    'Marketing': { code: '5400', name: 'Marketing Expense' },
    'Office Supplies': { code: '5500', name: 'Office Supplies Expense' },
    'Travel': { code: '5600', name: 'Travel Expense' },
    'Meals': { code: '5700', name: 'Meals & Entertainment' },
    'Insurance': { code: '5800', name: 'Insurance Expense' },
    'Maintenance': { code: '5900', name: 'Maintenance Expense' },
    'Software': { code: '6000', name: 'Software Expense' },
    'Taxes': { code: '6100', name: 'Taxes Expense' },
  };
  
  if (categoryMap[expenseType]) {
    accountCode = categoryMap[expenseType].code;
    accountName = categoryMap[expenseType].name;
  } else {
    accountCode = '6900';
    accountName = 'Other Expenses';
  }
  
  // First try to find account created by THIS user
  let expenseAccount = await ChartOfAccount.findOne({ 
    code: accountCode,
    createdBy: userId
  });
  
  if (!expenseAccount) {
    // Check if this code exists for ANY user
    const existingCode = await ChartOfAccount.findOne({ code: accountCode });
    
    let newCode = accountCode;
    if (existingCode) {
      // Generate a unique code for this user
      let counter = 1;
      let codeExists = true;
      while (codeExists) {
        const baseCode = accountCode.substring(0, 2);
        const suffix = parseInt(accountCode.substring(2)) + counter;
        newCode = `${baseCode}${suffix}`;
        const existing = await ChartOfAccount.findOne({ code: newCode, createdBy: userId });
        if (!existing) {
          codeExists = false;
        }
        counter++;
      }
    }
    
    expenseAccount = await ChartOfAccount.create({
      code: newCode,
      name: accountName,
      type: 'Expenses',
      parentAccount: 'Operating Expenses',
      openingBalance: 0,
      currentBalance: 0,
      description: `${expenseType} account`,
      taxCode: 'N/A',
      createdBy: userId,
    });
  }
  return expenseAccount;
}

// Helper: Get or create Cash account (WITHOUT duplicate error)
async function getOrCreateCashAccount(userId) {
  let cashAccount = await ChartOfAccount.findOne({ 
    code: '1010',
    createdBy: userId
  });
  
  if (!cashAccount) {
    // Check if code 1010 exists for ANY user
    const existingCode = await ChartOfAccount.findOne({ code: '1010' });
    
    let newCode = '1010';
    if (existingCode) {
      let counter = 1;
      let codeExists = true;
      while (codeExists) {
        newCode = `101${counter}`;
        const existing = await ChartOfAccount.findOne({ code: newCode, createdBy: userId });
        if (!existing) {
          codeExists = false;
        }
        counter++;
      }
    }
    
    cashAccount = await ChartOfAccount.create({
      code: newCode,
      name: 'Cash in Hand',
      type: 'Assets',
      parentAccount: 'Current Assets',
      openingBalance: 0,
      currentBalance: 0,
      description: 'Physical cash',
      taxCode: 'N/A',
      createdBy: userId,
    });
  }
  return cashAccount;
}

// ==================== CREATE EXPENSE ====================
exports.createExpense = async (req, res) => {
  try {
    const {
      date,
      expenseType,
      vendorId,
      items,
      amount,
      taxRate,
      description,
      reference,
      paymentMethod,
      bankAccountId,
    } = req.body;

    console.log("📦 Received expense data:", JSON.stringify(req.body, null, 2));

    let vendorName = '';
    if (vendorId) {
      const vendor = await Vendor.findOne({
        _id: vendorId,
        createdBy: req.user.id
      });
      if (vendor) {
        vendorName = vendor.name;
      }
    }

    let finalItems = [];
    let finalAmount = 0;
    let subtotal = 0;
    let taxAmount = 0;
    let totalAmount = 0;

    // Check if this is detailed expense (with items) or simple expense
    const hasItems = items != null && items.length > 0;
    
    if (hasItems) {
      console.log("📊 Processing DETAILED expense with items");
      finalItems = items.map(item => ({
        description: item.description,
        quantity: item.quantity || 1,
        unitPrice: item.unitPrice || 0,
        amount: (item.quantity || 1) * (item.unitPrice || 0),
      }));
      subtotal = finalItems.reduce((sum, item) => sum + (item.amount || 0), 0);
      taxAmount = subtotal * (taxRate || 0) / 100;
      totalAmount = subtotal + taxAmount;
      finalAmount = 0;
    } else {
      console.log("📊 Processing SIMPLE expense with amount:", amount);
      finalAmount = amount || 0;
      subtotal = finalAmount;
      totalAmount = finalAmount;
      taxAmount = 0;
      finalItems = [];
    }

    // Verify bank account belongs to user if provided
    if (bankAccountId) {
      const bankAccount = await BankAccount.findOne({
        _id: bankAccountId,
        createdBy: req.user.id
      });
      
      if (!bankAccount) {
        return res.status(400).json({
          success: false,
          message: 'Bank account not found or does not belong to you',
        });
      }
    }

    // Create expense record
    const expense = await Expense.create({
      date: date || new Date(),
      expenseType,
      vendorId: vendorId || null,
      vendorName,
      items: finalItems,
      amount: finalAmount,
      hasItems: hasItems,
      subtotal: subtotal,
      taxRate: taxRate || 0,
      taxAmount: taxAmount,
      totalAmount: totalAmount,
      description: description || '',
      reference: reference || '',
      paymentMethod: paymentMethod || 'Cash',
      bankAccountId: bankAccountId || null,
      status: 'Posted',
      postedBy: req.user.id,
      postedAt: new Date(),
      createdBy: req.user.id,
    });

    console.log("✅ Expense created successfully!");
    console.log("   ID:", expense._id);
    console.log("   Number:", expense.expenseNumber);
    console.log("   Total Amount:", expense.totalAmount);

    // Create journal entry
    const expenseAccount = await getOrCreateExpenseAccount(req.user.id, expenseType);
    let cashOrBankAccount;
    
    if (paymentMethod === 'Cash') {
      cashOrBankAccount = await getOrCreateCashAccount(req.user.id);
    } else if (bankAccountId) {
      const bankAccount = await BankAccount.findOne({
        _id: bankAccountId,
        createdBy: req.user.id
      });
      if (bankAccount) {
        cashOrBankAccount = await ChartOfAccount.findOne({
          _id: bankAccount.chartOfAccountId,
          createdBy: req.user.id
        });
      }
    }
    
    if (!cashOrBankAccount) {
      cashOrBankAccount = await getOrCreateCashAccount(req.user.id);
    }

    await JournalEntry.create({
      entryNumber: `JE-${Date.now()}`,
      date: date || new Date(),
      description: description || `${expenseType} - ${expense.expenseNumber}`,
      reference: reference || expense.expenseNumber,
      lines: [
        {
          accountId: expenseAccount._id,
          accountName: expenseAccount.name,
          accountCode: expenseAccount.code,
          debit: totalAmount,
          credit: 0,
        },
        {
          accountId: cashOrBankAccount._id,
          accountName: cashOrBankAccount.name,
          accountCode: cashOrBankAccount.code,
          debit: 0,
          credit: totalAmount,
        },
      ],
      status: 'Posted',
      createdBy: req.user.id,
      postedBy: req.user.id,
      postedAt: new Date(),
    });

    res.status(201).json({
      success: true,
      data: expense,
      message: 'Expense recorded successfully',
    });
  } catch (error) {
    console.error("🔥 ERROR in createExpense:", error);
    
    // Handle duplicate key error
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'Duplicate entry. Please try again.',
      });
    }
    
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ==================== GET ALL EXPENSES ====================
exports.getExpenses = async (req, res) => {
  try {
    const { 
      expenseType, 
      status, 
      startDate, 
      endDate, 
      search,
      page = 1,
      limit = 20 
    } = req.query;
    
    let query = {
      createdBy: req.user.id
    };

    if (expenseType && expenseType !== 'All') query.expenseType = expenseType;
    if (status && status !== 'All') query.status = status;
    
    if (startDate && endDate) {
      query.date = {
        $gte: new Date(startDate),
        $lte: new Date(endDate),
      };
    }

    if (search) {
      query.$or = [
        { expenseNumber: { $regex: search, $options: 'i' } },
        { vendorName: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
      ];
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    const expenses = await Expense.find(query)
      .populate('vendorId', 'name email phone')
      .populate('bankAccountId', 'accountName accountNumber')
      .sort({ date: -1, createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));
    
    const total = await Expense.countDocuments(query);

    res.status(200).json({
      success: true,
      count: expenses.length,
      total,
      page: parseInt(page),
      pages: Math.ceil(total / parseInt(limit)),
      data: expenses,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ==================== GET SINGLE EXPENSE ====================
exports.getExpense = async (req, res) => {
  try {
    const expense = await Expense.findOne({
      _id: req.params.id,
      createdBy: req.user.id
    })
      .populate('vendorId', 'name email phone')
      .populate('bankAccountId', 'accountName accountNumber');

    if (!expense) {
      return res.status(404).json({
        success: false,
        message: 'Expense record not found',
      });
    }

    res.status(200).json({
      success: true,
      data: expense,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ==================== UPDATE EXPENSE ====================
exports.updateExpense = async (req, res) => {
  try {
    const expense = await Expense.findOne({
      _id: req.params.id,
      createdBy: req.user.id
    });

    if (!expense) {
      return res.status(404).json({
        success: false,
        message: 'Expense record not found',
      });
    }

    if (expense.status === 'Posted') {
      return res.status(400).json({
        success: false,
        message: 'Cannot update posted expense record',
      });
    }

    const allowedUpdates = [
      'date', 'expenseType', 'vendorId', 'items', 'amount', 'taxRate',
      'description', 'reference', 'paymentMethod', 'bankAccountId'
    ];
    
    allowedUpdates.forEach(field => {
      if (req.body[field] !== undefined) {
        expense[field] = req.body[field];
      }
    });

    // Update vendor name if vendor changed and belongs to user
    if (req.body.vendorId) {
      const vendor = await Vendor.findOne({
        _id: req.body.vendorId,
        createdBy: req.user.id
      });
      if (vendor) {
        expense.vendorName = vendor.name;
      }
    }

    // Verify bank account belongs to user if updating
    if (req.body.bankAccountId) {
      const bankAccount = await BankAccount.findOne({
        _id: req.body.bankAccountId,
        createdBy: req.user.id
      });
      
      if (!bankAccount) {
        return res.status(400).json({
          success: false,
          message: 'Bank account not found or does not belong to you',
        });
      }
    }

    // Recalculate totals
    if (expense.items && expense.items.length > 0) {
      expense.subtotal = expense.items.reduce((sum, item) => sum + (item.quantity * item.unitPrice), 0);
      expense.taxAmount = expense.subtotal * (expense.taxRate || 0) / 100;
      expense.totalAmount = expense.subtotal + expense.taxAmount;
      expense.amount = 0;
      expense.hasItems = true;
    } else if (expense.amount > 0) {
      expense.subtotal = expense.amount;
      expense.taxAmount = 0;
      expense.totalAmount = expense.amount;
      expense.hasItems = false;
    }

    await expense.save();

    res.status(200).json({
      success: true,
      data: expense,
      message: 'Expense record updated successfully',
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ==================== DELETE EXPENSE ====================
exports.deleteExpense = async (req, res) => {
  try {
    const expense = await Expense.findOne({
      _id: req.params.id,
      createdBy: req.user.id
    });

    if (!expense) {
      return res.status(404).json({
        success: false,
        message: 'Expense record not found',
      });
    }

    if (expense.status === 'Posted') {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete posted expense record',
      });
    }

    await expense.deleteOne();

    res.status(200).json({
      success: true,
      message: 'Expense record deleted successfully',
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
    const { startDate, endDate } = req.query;
    let dateFilter = {};

    if (startDate && endDate) {
      dateFilter = {
        date: {
          $gte: new Date(startDate),
          $lte: new Date(endDate),
        },
      };
    }

    const allExpenses = await Expense.find({ 
      ...dateFilter, 
      status: 'Posted',
      createdBy: req.user.id
    });
    
    const totalExpense = allExpenses.reduce((sum, exp) => sum + exp.totalAmount, 0);
    const totalTax = allExpenses.reduce((sum, exp) => sum + exp.taxAmount, 0);
    
    // Summary by type
    const byType = {};
    allExpenses.forEach(exp => {
      if (!byType[exp.expenseType]) {
        byType[exp.expenseType] = 0;
      }
      byType[exp.expenseType] += exp.totalAmount;
    });

    // This month summary
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const thisMonth = await Expense.aggregate([
      {
        $match: {
          date: { $gte: startOfMonth },
          status: 'Posted',
          createdBy: req.user.id,
          ...dateFilter,
        },
      },
      {
        $group: {
          _id: null,
          total: { $sum: '$totalAmount' },
          count: { $sum: 1 },
        },
      },
    ]);

    // This week summary
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay());
    const thisWeek = await Expense.aggregate([
      {
        $match: {
          date: { $gte: startOfWeek },
          status: 'Posted',
          createdBy: req.user.id,
          ...dateFilter,
        },
      },
      {
        $group: {
          _id: null,
          total: { $sum: '$totalAmount' },
          count: { $sum: 1 },
        },
      },
    ]);

    res.status(200).json({
      success: true,
      data: {
        totalExpense,
        totalTax,
        totalCount: allExpenses.length,
        byType,
        thisMonth: thisMonth[0]?.total || 0,
        thisWeek: thisWeek[0]?.total || 0,
      },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ==================== POST EXPENSE (for draft to posted) ====================
exports.postExpense = async (req, res) => {
  try {
    const expense = await Expense.findOne({
      _id: req.params.id,
      createdBy: req.user.id
    });

    if (!expense) {
      return res.status(404).json({
        success: false,
        message: 'Expense record not found',
      });
    }

    if (expense.status === 'Posted') {
      return res.status(400).json({
        success: false,
        message: 'Expense already posted',
      });
    }

    expense.status = 'Posted';
    expense.postedBy = req.user.id;
    expense.postedAt = new Date();

    await expense.save();

    // Create journal entry for posting
    const expenseAccount = await getOrCreateExpenseAccount(req.user.id, expense.expenseType);
    let cashOrBankAccount;
    
    if (expense.paymentMethod === 'Cash') {
      cashOrBankAccount = await getOrCreateCashAccount(req.user.id);
    } else if (expense.bankAccountId) {
      const bankAccount = await BankAccount.findOne({
        _id: expense.bankAccountId,
        createdBy: req.user.id
      });
      if (bankAccount) {
        cashOrBankAccount = await ChartOfAccount.findOne({
          _id: bankAccount.chartOfAccountId,
          createdBy: req.user.id
        });
      }
    }
    
    if (!cashOrBankAccount) {
      cashOrBankAccount = await getOrCreateCashAccount(req.user.id);
    }

    await JournalEntry.create({
      entryNumber: `JE-${Date.now()}`,
      date: expense.date,
      description: expense.description || `${expense.expenseType} - ${expense.expenseNumber}`,
      reference: expense.reference || expense.expenseNumber,
      lines: [
        {
          accountId: expenseAccount._id,
          accountName: expenseAccount.name,
          accountCode: expenseAccount.code,
          debit: expense.totalAmount,
          credit: 0,
        },
        {
          accountId: cashOrBankAccount._id,
          accountName: cashOrBankAccount.name,
          accountCode: cashOrBankAccount.code,
          debit: 0,
          credit: expense.totalAmount,
        },
      ],
      status: 'Posted',
      createdBy: req.user.id,
      postedBy: req.user.id,
      postedAt: new Date(),
    });

    res.status(200).json({
      success: true,
      data: expense,
      message: 'Expense posted successfully',
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};