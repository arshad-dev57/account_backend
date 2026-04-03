const Income = require('../models/Income');
const Customer = require('../models/Customer');
const BankAccount = require('../models/BankAccount');
const JournalEntry = require('../models/JournalEntry');
const ChartOfAccount = require('../models/ChartOfAccount');

// ==================== HELPER FUNCTIONS ====================

// Helper: Get or create Income account in Chart of Accounts (WITHOUT duplicate error)
async function getOrCreateIncomeAccount(userId, incomeType) {
  let accountCode = '4000';
  let accountName = 'Income';
  
  const categoryMap = {
    'Sales': { code: '4100', name: 'Sales Revenue' },
    'Services': { code: '4200', name: 'Service Revenue' },
    'Interest Income': { code: '4300', name: 'Interest Income' },
    'Rental Income': { code: '4400', name: 'Rental Income' },
    'Dividend Income': { code: '4500', name: 'Dividend Income' },
  };
  
  if (categoryMap[incomeType]) {
    accountCode = categoryMap[incomeType].code;
    accountName = categoryMap[incomeType].name;
  } else {
    accountCode = '4900';
    accountName = 'Other Income';
  }
  
  // First try to find account created by THIS user
  let incomeAccount = await ChartOfAccount.findOne({ 
    code: accountCode,
    createdBy: userId
  });
  
  if (!incomeAccount) {
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
    
    incomeAccount = await ChartOfAccount.create({
      code: newCode,
      name: accountName,
      type: 'Income',
      parentAccount: 'Operating Income',
      openingBalance: 0,
      currentBalance: 0,
      description: `${incomeType} account`,
      taxCode: 'N/A',
      createdBy: userId,
    });
  }
  return incomeAccount;
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

// ==================== CREATE INCOME ====================
exports.createIncome = async (req, res) => {
  try {
    const {
      date,
      incomeType,
      customerId,
      items,
      amount,
      taxRate,
      description,
      reference,
      paymentMethod,
      bankAccountId,
    } = req.body;

    console.log("📦 Received income data:", JSON.stringify(req.body, null, 2));

    // Get customer name if provided and customer belongs to user
    let customerName = '';
    if (customerId) {
      const customer = await Customer.findOne({
        _id: customerId,
        createdBy: req.user.id
      });
      if (customer) {
        customerName = customer.name;
      }
    }

    let finalItems = [];
    let finalAmount = 0;
    let subtotal = 0;
    let taxAmount = 0;
    let totalAmount = 0;

    // Check if this is detailed income (with items) or simple income
    const hasItems = items != null && items.length > 0;
    
    if (hasItems) {
      console.log("📊 Processing DETAILED income with items");
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
      console.log("   Subtotal:", subtotal);
      console.log("   Tax:", taxAmount);
      console.log("   Total:", totalAmount);
    } else {
      console.log("📊 Processing SIMPLE income with amount:", amount);
      finalAmount = amount || 0;
      subtotal = finalAmount;
      totalAmount = finalAmount;
      taxAmount = 0;
      finalItems = [];
      console.log("   Total Amount set to:", totalAmount);
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

    // Create income record
    const income = await Income.create({
      date: date || new Date(),
      incomeType,
      customerId: customerId || null,
      customerName,
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

    console.log("✅ Income created successfully!");
    console.log("   ID:", income._id);
    console.log("   Number:", income.incomeNumber);
    console.log("   Total Amount:", income.totalAmount);

    // Create journal entry
    const incomeAccount = await getOrCreateIncomeAccount(req.user.id, incomeType);
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
      description: description || `${incomeType} - ${income.incomeNumber}`,
      reference: reference || income.incomeNumber,
      lines: [
        {
          accountId: cashOrBankAccount._id,
          accountName: cashOrBankAccount.name,
          accountCode: cashOrBankAccount.code,
          debit: totalAmount,
          credit: 0,
        },
        {
          accountId: incomeAccount._id,
          accountName: incomeAccount.name,
          accountCode: incomeAccount.code,
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
      data: income,
      message: 'Income recorded successfully',
    });
  } catch (error) {
    console.error("🔥 ERROR in createIncome:", error);
    
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

// ==================== GET ALL INCOME RECORDS ====================
exports.getIncomes = async (req, res) => {
  try {
    const { incomeType, status, startDate, endDate, search } = req.query;
    let query = {
      createdBy: req.user.id
    };

    if (incomeType && incomeType !== 'All') query.incomeType = incomeType;
    if (status && status !== 'All') query.status = status;
    
    if (startDate && endDate) {
      query.date = {
        $gte: new Date(startDate),
        $lte: new Date(endDate),
      };
    }

    if (search) {
      query.$or = [
        { incomeNumber: { $regex: search, $options: 'i' } },
        { customerName: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
      ];
    }

    const incomes = await Income.find(query)
      .populate('customerId', 'name email phone')
      .populate('bankAccountId', 'accountName accountNumber')
      .sort({ date: -1, createdAt: -1 });

    res.status(200).json({
      success: true,
      count: incomes.length,
      data: incomes,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ==================== GET SINGLE INCOME ====================
exports.getIncome = async (req, res) => {
  try {
    const income = await Income.findOne({
      _id: req.params.id,
      createdBy: req.user.id
    })
      .populate('customerId', 'name email phone')
      .populate('bankAccountId', 'accountName accountNumber');

    if (!income) {
      return res.status(404).json({
        success: false,
        message: 'Income record not found',
      });
    }

    res.status(200).json({
      success: true,
      data: income,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ==================== UPDATE INCOME ====================
exports.updateIncome = async (req, res) => {
  try {
    const income = await Income.findOne({
      _id: req.params.id,
      createdBy: req.user.id
    });

    if (!income) {
      return res.status(404).json({
        success: false,
        message: 'Income record not found',
      });
    }

    if (income.status === 'Posted') {
      return res.status(400).json({
        success: false,
        message: 'Cannot update posted income record',
      });
    }

    const allowedUpdates = [
      'date', 'incomeType', 'customerId', 'items', 'amount', 'taxRate',
      'description', 'reference', 'paymentMethod', 'bankAccountId'
    ];
    
    allowedUpdates.forEach(field => {
      if (req.body[field] !== undefined) {
        income[field] = req.body[field];
      }
    });

    // Update customer name if customer changed and belongs to user
    if (req.body.customerId) {
      const customer = await Customer.findOne({
        _id: req.body.customerId,
        createdBy: req.user.id
      });
      if (customer) {
        income.customerName = customer.name;
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
    if (income.items && income.items.length > 0) {
      income.subtotal = income.items.reduce((sum, item) => sum + (item.quantity * item.unitPrice), 0);
      income.taxAmount = income.subtotal * (income.taxRate || 0) / 100;
      income.totalAmount = income.subtotal + income.taxAmount;
      income.amount = 0;
      income.hasItems = true;
    } else if (income.amount > 0) {
      income.subtotal = income.amount;
      income.taxAmount = 0;
      income.totalAmount = income.amount;
      income.hasItems = false;
    }

    await income.save();

    res.status(200).json({
      success: true,
      data: income,
      message: 'Income record updated successfully',
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ==================== DELETE INCOME ====================
exports.deleteIncome = async (req, res) => {
  try {
    const income = await Income.findOne({
      _id: req.params.id,
      createdBy: req.user.id
    });

    if (!income) {
      return res.status(404).json({
        success: false,
        message: 'Income record not found',
      });
    }

    if (income.status === 'Posted') {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete posted income record',
      });
    }

    await income.deleteOne();

    res.status(200).json({
      success: true,
      message: 'Income record deleted successfully',
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

    const allIncomes = await Income.find({ 
      ...dateFilter, 
      status: 'Posted',
      createdBy: req.user.id
    });
    
    const totalIncome = allIncomes.reduce((sum, inc) => sum + inc.totalAmount, 0);
    const totalTax = allIncomes.reduce((sum, inc) => sum + inc.taxAmount, 0);
    
    // Summary by type
    const byType = {};
    allIncomes.forEach(inc => {
      if (!byType[inc.incomeType]) {
        byType[inc.incomeType] = 0;
      }
      byType[inc.incomeType] += inc.totalAmount;
    });

    // This month summary
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const thisMonth = await Income.aggregate([
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
    const thisWeek = await Income.aggregate([
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
        totalIncome,
        totalTax,
        totalCount: allIncomes.length,
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

// ==================== POST INCOME (for draft to posted) ====================
exports.postIncome = async (req, res) => {
  try {
    const income = await Income.findOne({
      _id: req.params.id,
      createdBy: req.user.id
    });

    if (!income) {
      return res.status(404).json({
        success: false,
        message: 'Income record not found',
      });
    }

    if (income.status === 'Posted') {
      return res.status(400).json({
        success: false,
        message: 'Income already posted',
      });
    }

    income.status = 'Posted';
    income.postedBy = req.user.id;
    income.postedAt = new Date();

    await income.save();

    // Create journal entry for posting
    const incomeAccount = await getOrCreateIncomeAccount(req.user.id, income.incomeType);
    let cashOrBankAccount;
    
    if (income.paymentMethod === 'Cash') {
      cashOrBankAccount = await getOrCreateCashAccount(req.user.id);
    } else if (income.bankAccountId) {
      const bankAccount = await BankAccount.findOne({
        _id: income.bankAccountId,
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
      date: income.date,
      description: income.description || `${income.incomeType} - ${income.incomeNumber}`,
      reference: income.reference || income.incomeNumber,
      lines: [
        {
          accountId: cashOrBankAccount._id,
          accountName: cashOrBankAccount.name,
          accountCode: cashOrBankAccount.code,
          debit: income.totalAmount,
          credit: 0,
        },
        {
          accountId: incomeAccount._id,
          accountName: incomeAccount.name,
          accountCode: incomeAccount.code,
          debit: 0,
          credit: income.totalAmount,
        },
      ],
      status: 'Posted',
      createdBy: req.user.id,
      postedBy: req.user.id,
      postedAt: new Date(),
    });

    res.status(200).json({
      success: true,
      data: income,
      message: 'Income posted successfully',
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};