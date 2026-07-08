// controllers/expenseController.js - COMPLETE FIXED VERSION

const ExpenseModel = require('../models/Expense');
const prisma = require('../prisma/client');

// ─── EXPENSE TYPE TO ACCOUNT MAPPING ─────────────────────────────
const EXPENSE_ACCOUNT_MAPPING = {
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

const DEFAULT_EXPENSE_ACCOUNT = { code: '6900', name: 'Other Expenses' };

// ─── HELPER: Get existing expense account (DO NOT CREATE NEW) ───
async function getExistingExpenseAccount(userId, expenseType) {
  const mapping = EXPENSE_ACCOUNT_MAPPING[expenseType] || DEFAULT_EXPENSE_ACCOUNT;
  
  let expenseAccount = await prisma.chartOfAccount.findFirst({
    where: {
      code: mapping.code,
      createdBy: userId,
      type: 'Expense'
    }
  });

  if (!expenseAccount) {
    expenseAccount = await prisma.chartOfAccount.findFirst({
      where: {
        name: mapping.name,
        createdBy: userId,
        type: 'Expense'
      }
    });
  }

  return expenseAccount;
}

// ─── HELPER: Get all expense accounts for dropdown ──────────────
async function getExpenseAccountsForDropdown(userId) {
  return await prisma.chartOfAccount.findMany({
    where: {
      createdBy: userId,
      type: 'Expense',
      isActive: true
    },
    select: {
      id: true,
      code: true,
      name: true,
      type: true
    },
    orderBy: {
      code: 'asc'
    }
  });
}

// ─── HELPER: Get or create Cash account ──────────────────────────
async function getOrCreateCashAccount(userId) {
  let cashAccount = await prisma.chartOfAccount.findFirst({
    where: {
      code: '1010',
      createdBy: userId
    }
  });

  if (!cashAccount) {
    const existingCode = await prisma.chartOfAccount.findFirst({
      where: { code: '1010' }
    });

    let newCode = '1010';
    if (existingCode) {
      let counter = 1;
      let codeExists = true;
      while (codeExists) {
        newCode = `101${counter}`;
        const existing = await prisma.chartOfAccount.findFirst({
          where: {
            code: newCode,
            createdBy: userId
          }
        });
        if (!existing) {
          codeExists = false;
        }
        counter++;
      }
    }

    cashAccount = await prisma.chartOfAccount.create({
      data: {
        code: newCode,
        name: 'Cash in Hand',
        type: 'Asset',
        parentAccount: 'Current Assets',
        openingBalance: 0,
        currentBalance: 0,
        description: 'Physical cash',
        taxCode: 'N/A',
        balanceType: 'Debit',
        isActive: true,
        createdBy: userId
      }
    });
  }

  return cashAccount;
}

// ─── HELPER: Create journal entry for expense ─────────────────────
async function createExpenseJournalEntry(userId, expense, expenseAccount, cashOrBankAccount) {
  const entryNumber = `JE-${Date.now()}`;

  return await prisma.journalEntry.create({
    data: {
      entryNumber,
      date: expense.date || new Date(),
      description: expense.description || `${expense.expenseType} - ${expense.expenseNumber}`,
      reference: expense.reference || expense.expenseNumber,
      status: 'Posted',
      createdBy: userId,
      postedBy: userId,
      postedAt: new Date(),
      lines: {
        create: [
          {
            accountId: expenseAccount.id,
            accountName: expenseAccount.name,
            accountCode: expenseAccount.code,
            debit: expense.totalAmount,
            credit: 0,
            isReconciled: false
          },
          {
            accountId: cashOrBankAccount.id,
            accountName: cashOrBankAccount.name,
            accountCode: cashOrBankAccount.code,
            debit: 0,
            credit: expense.totalAmount,
            isReconciled: false
          }
        ]
      }
    }
  });
}

// ============================================================
// @desc    Get expense accounts for dropdown
// @route   GET /api/expenses/accounts
// @access  Private
// ============================================================
const getExpenseAccounts = async (req, res) => {
  try {
    const userId = req.user.id;
    const accounts = await getExpenseAccountsForDropdown(userId);

    res.status(200).json({
      success: true,
      data: accounts
    });
  } catch (error) {
    console.error('❌ Get expense accounts error:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// ============================================================
// @desc    Create Expense - FIXED with Expense Account dropdown
// @route   POST /api/expenses
// @access  Private
// ============================================================
const createExpense = async (req, res) => {
  try {
    const {
      date,
      expenseType,
      expenseAccountId,
      vendorId,
      items,
      amount,
      taxRate,
      description,
      reference,
      paymentMethod,
      bankAccountId,
    } = req.body;

    const userId = req.user.id;

    console.log("📦 Received expense data:", JSON.stringify(req.body, null, 2));

    if (!expenseAccountId) {
      return res.status(400).json({
        success: false,
        message: 'Please select an expense account',
        suggestion: 'Select an expense account from the dropdown'
      });
    }

    const expenseAccount = await prisma.chartOfAccount.findFirst({
      where: {
        id: expenseAccountId,
        createdBy: userId,
        type: 'Expense',
        isActive: true
      }
    });

    if (!expenseAccount) {
      return res.status(400).json({
        success: false,
        message: 'Selected expense account not found or is not active',
        suggestion: 'Please select a valid expense account'
      });
    }

    console.log(`✅ Using expense account: ${expenseAccount.name} (${expenseAccount.code})`);

    let cleanBankAccountId = null;
    const rawValue = bankAccountId !== null && bankAccountId !== undefined 
      ? String(bankAccountId).trim() 
      : '';

    if (rawValue && 
        rawValue !== 'null' && 
        rawValue !== 'NULL' && 
        rawValue !== 'undefined' &&
        rawValue !== '') {
      cleanBankAccountId = rawValue;
    }

    console.log(`🔍 cleanBankAccountId: "${cleanBankAccountId}"`);

    let vendorName = '';
    if (vendorId) {
      const vendor = await prisma.vendor.findFirst({
        where: {
          id: vendorId,
          createdBy: userId
        }
      });
      if (vendor) {
        vendorName = vendor.name;
      }
    }

    let bankAccountData = null;
    if (cleanBankAccountId) {
      bankAccountData = await prisma.bankAccount.findFirst({
        where: {
          id: cleanBankAccountId,
          createdBy: userId
        },
        include: {
          chartOfAccount: true
        }
      });

      if (!bankAccountData) {
        return res.status(400).json({
          success: false,
          message: 'Bank account not found or does not belong to you'
        });
      }
      
      console.log(`🏦 Bank Account Found: ${bankAccountData.accountName}`);
      console.log(`💰 Current Balance: ${bankAccountData.currentBalance}`);
    }

    let finalItems = [];
    let finalAmount = 0;
    let subtotal = 0;
    let taxAmount = 0;
    let totalAmount = 0;

    const hasItems = items && items.length > 0;

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

    console.log(`💰 Total Amount: ${totalAmount}`);

    let formattedDate = date ? new Date(date) : new Date();
    if (isNaN(formattedDate.getTime())) {
      formattedDate = new Date();
    }

    let finalPaymentMethod = paymentMethod || 'Cash';
    let finalBankAccountId = cleanBankAccountId;

    const expense = await ExpenseModel.create({
      date: formattedDate,
      expenseType,
      expenseAccountId: expenseAccount.id,
      vendorId: vendorId || null,
      vendorName,
      items: finalItems,
      amount: finalAmount,
      taxRate: taxRate || 0,
      description: description || '',
      reference: reference || '',
      paymentMethod: finalPaymentMethod,
      bankAccountId: finalBankAccountId,
      status: 'Posted',
      postedBy: userId,
      postedAt: new Date(),
      createdBy: userId
    });

    console.log("✅ Expense created successfully!");
    console.log("   ID:", expense.id);
    console.log("   Number:", expense.expenseNumber);
    console.log("   Total Amount:", expense.totalAmount);

    let cashOrBankAccount;

    if (finalPaymentMethod === 'Cash' || !finalBankAccountId) {
      cashOrBankAccount = await getOrCreateCashAccount(userId);
      console.log('💵 Using Cash account');
    } else if (finalBankAccountId && bankAccountData) {
      cashOrBankAccount = bankAccountData.chartOfAccount;
      console.log(`🏦 Using Bank account: ${bankAccountData.accountName}`);
    } else {
      cashOrBankAccount = await getOrCreateCashAccount(userId);
      console.log('💵 Fallback: Using Cash account');
    }

    if (!cashOrBankAccount) {
      cashOrBankAccount = await getOrCreateCashAccount(userId);
    }

    console.log(`📒 Journal Entry - Debit: ${expenseAccount.name}, Credit: ${cashOrBankAccount.name}`);

    await createExpenseJournalEntry(userId, expense, expenseAccount, cashOrBankAccount);

    if (finalBankAccountId && bankAccountData) {
      const oldBalance = bankAccountData.currentBalance;
      const newBalance = oldBalance - totalAmount;
      
      console.log(`💰 Updating bank account balance: ${oldBalance} → ${newBalance}`);
      
      await prisma.bankAccount.update({
        where: { id: finalBankAccountId },
        data: { currentBalance: newBalance }
      });

      if (bankAccountData.chartOfAccountId) {
        await prisma.chartOfAccount.update({
          where: { id: bankAccountData.chartOfAccountId },
          data: { currentBalance: newBalance }
        });
      }
      
      console.log(`✅ Bank account balance updated successfully!`);
    } else if (cashOrBankAccount) {
      const oldBalance = cashOrBankAccount.currentBalance || 0;
      const newBalance = oldBalance - totalAmount;
      
      console.log(`💰 Updating cash account balance: ${oldBalance} → ${newBalance}`);
      
      await prisma.chartOfAccount.update({
        where: { id: cashOrBankAccount.id },
        data: { currentBalance: newBalance }
      });
      
      console.log(`✅ Cash account balance updated successfully!`);
    }

    const oldExpenseBalance = expenseAccount.currentBalance || 0;
    const newExpenseBalance = oldExpenseBalance + totalAmount;
    
    await prisma.chartOfAccount.update({
      where: { id: expenseAccount.id },
      data: { currentBalance: newExpenseBalance }
    });
    
    console.log(`💰 Updated expense account balance: ${oldExpenseBalance} → ${newExpenseBalance}`);

    res.status(201).json({
      success: true,
      data: expense,
      expenseAccount: {
        id: expenseAccount.id,
        code: expenseAccount.code,
        name: expenseAccount.name
      },
      message: finalBankAccountId ? 'Expense recorded (Bank Transfer)' : 'Expense recorded (Cash)'
    });
  } catch (error) {
    console.error("🔥 ERROR in createExpense:", error);

    if (error.code === 'P2002') {
      return res.status(400).json({
        success: false,
        message: 'Duplicate entry. Please try again.'
      });
    }

    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// ============================================================
// @desc    Get all expenses
// @route   GET /api/expenses
// @access  Private
// ============================================================
const getExpenses = async (req, res) => {
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

    const userId = req.user.id;

    const filter = { 
      creator: {
        id: userId
      }
    };

    if (expenseType && expenseType !== 'All') {
      filter.expenseType = expenseType;
    }

    if (status && status !== 'All') {
      filter.status = status;
    }

    if (startDate && endDate) {
      filter.date = {
        gte: new Date(startDate),
        lte: new Date(endDate)
      };
    }

    if (search) {
      filter.OR = [
        { expenseNumber: { contains: search, mode: 'insensitive' } },
        { vendorName: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } }
      ];
    }

    const pageNum = parseInt(page) || 1;
    const limitNum = parseInt(limit) || 20;
    const skip = (pageNum - 1) * limitNum;

    const [expenses, totalCount] = await Promise.all([
      ExpenseModel.findAll(filter, { skip, take: limitNum, orderBy: { date: 'desc' } }),
      ExpenseModel.count(filter)
    ]);

    const totalPages = Math.ceil(totalCount / limitNum);

    res.status(200).json({
      success: true,
      count: expenses.length,
      total: totalCount,
      page: pageNum,
      pages: totalPages,
      data: expenses
    });
  } catch (error) {
    console.error('❌ Get expenses error:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// ============================================================
// @desc    Get single expense
// @route   GET /api/expenses/:id
// @access  Private
// ============================================================
const getExpense = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const expense = await prisma.expense.findFirst({
      where: {
        id,
        creator: {
          id: userId
        }
      },
      include: {
        vendor: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true
          }
        },
        bankAccount: {
          select: {
            id: true,
            accountName: true,
            accountNumber: true,
            bankName: true
          }
        },
        expenseAccount: {
          select: {
            id: true,
            code: true,
            name: true,
            type: true
          }
        },
        creator: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true
          }
        },
        poster: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true
          }
        }
      }
    });

    if (!expense) {
      return res.status(404).json({
        success: false,
        message: 'Expense record not found'
      });
    }

    res.status(200).json({
      success: true,
      data: expense
    });
  } catch (error) {
    console.error('❌ Get expense error:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// ============================================================
// @desc    Update expense
// @route   PUT /api/expenses/:id
// @access  Private
// ============================================================
const updateExpense = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const existing = await prisma.expense.findFirst({
      where: {
        id,
        creator: {
          id: userId
        }
      }
    });

    if (!existing) {
      return res.status(404).json({
        success: false,
        message: 'Expense record not found'
      });
    }

    if (existing.status === 'Posted') {
      return res.status(400).json({
        success: false,
        message: 'Cannot update posted expense record'
      });
    }

    const {
      date,
      expenseType,
      expenseAccountId,
      vendorId,
      items,
      amount,
      taxRate,
      description,
      reference,
      paymentMethod,
      bankAccountId
    } = req.body;

    let vendorName = existing.vendorName;
    if (vendorId) {
      const vendor = await prisma.vendor.findFirst({
        where: {
          id: vendorId,
          createdBy: userId
        }
      });
      if (vendor) {
        vendorName = vendor.name;
      }
    }

    let cleanBankAccountId = null;
    const rawValue = bankAccountId !== null && bankAccountId !== undefined 
      ? String(bankAccountId).trim() 
      : '';

    if (rawValue && 
        rawValue !== 'null' && 
        rawValue !== 'NULL' && 
        rawValue !== 'undefined' &&
        rawValue !== '') {
      cleanBankAccountId = rawValue;
    }

    if (cleanBankAccountId) {
      const bankAccount = await prisma.bankAccount.findFirst({
        where: {
          id: cleanBankAccountId,
          createdBy: userId
        }
      });
      if (!bankAccount) {
        return res.status(400).json({
          success: false,
          message: 'Bank account not found or does not belong to you'
        });
      }
    }

    if (expenseAccountId) {
      const expenseAccount = await prisma.chartOfAccount.findFirst({
        where: {
          id: expenseAccountId,
          createdBy: userId,
          type: 'Expense'
        }
      });
      if (!expenseAccount) {
        return res.status(400).json({
          success: false,
          message: 'Selected expense account not found'
        });
      }
    }

    const updateData = {
      date: date || existing.date,
      expenseType: expenseType || existing.expenseType,
      expenseAccountId: expenseAccountId || existing.expenseAccountId,
      vendorId: vendorId || existing.vendorId,
      vendorName: vendorName || existing.vendorName,
      description: description !== undefined ? description : existing.description,
      reference: reference !== undefined ? reference : existing.reference,
      paymentMethod: paymentMethod || existing.paymentMethod,
      bankAccountId: cleanBankAccountId,
      taxRate: taxRate !== undefined ? taxRate : existing.taxRate
    };

    let finalItems = [];
    let finalAmount = 0;
    let subtotal = 0;
    let taxAmount = 0;
    let totalAmount = 0;

    const hasItems = items && items.length > 0;

    if (hasItems) {
      finalItems = items.map(item => ({
        description: item.description,
        quantity: item.quantity || 1,
        unitPrice: item.unitPrice || 0,
        amount: (item.quantity || 1) * (item.unitPrice || 0),
      }));
      subtotal = finalItems.reduce((sum, item) => sum + (item.amount || 0), 0);
      taxAmount = subtotal * (updateData.taxRate || 0) / 100;
      totalAmount = subtotal + taxAmount;
      finalAmount = 0;
      updateData.hasItems = true;
      updateData.items = finalItems;
      updateData.amount = finalAmount;
      updateData.subtotal = subtotal;
      updateData.taxAmount = taxAmount;
      updateData.totalAmount = totalAmount;
    } else if (amount !== undefined && amount > 0) {
      finalAmount = amount;
      subtotal = finalAmount;
      totalAmount = finalAmount;
      taxAmount = 0;
      finalItems = [];
      updateData.hasItems = false;
      updateData.items = finalItems;
      updateData.amount = finalAmount;
      updateData.subtotal = subtotal;
      updateData.taxAmount = taxAmount;
      updateData.totalAmount = totalAmount;
    }

    const updated = await ExpenseModel.update(id, updateData);

    res.status(200).json({
      success: true,
      data: updated,
      message: 'Expense record updated successfully'
    });
  } catch (error) {
    console.error('❌ Update expense error:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// ============================================================
// @desc    Delete expense
// @route   DELETE /api/expenses/:id
// @access  Private
// ============================================================
const deleteExpense = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const existing = await prisma.expense.findFirst({
      where: {
        id,
        creator: {
          id: userId
        }
      }
    });

    if (!existing) {
      return res.status(404).json({
        success: false,
        message: 'Expense record not found'
      });
    }

    if (existing.status === 'Posted') {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete posted expense record'
      });
    }

    await ExpenseModel.delete(id);

    res.status(200).json({
      success: true,
      message: 'Expense record deleted successfully'
    });
  } catch (error) {
    console.error('❌ Delete expense error:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// ============================================================
// @desc    Get expense summary
// @route   GET /api/expenses/summary
// @access  Private
// ============================================================
const getSummary = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const userId = req.user.id;

    const filter = {
      creator: {
        id: userId
      },
      status: 'Posted'
    };

    if (startDate && endDate) {
      filter.date = {
        gte: new Date(startDate),
        lte: new Date(endDate)
      };
    }

    const allExpenses = await prisma.expense.findMany({
      where: filter
    });

    const summary = await ExpenseModel.getSummary(allExpenses);

    res.status(200).json({
      success: true,
      data: summary
    });
  } catch (error) {
    console.error('❌ Get expense summary error:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// ============================================================
// @desc    Post expense (Draft → Posted)
// @route   POST /api/expenses/:id/post
// @access  Private
// ============================================================
const postExpense = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const expense = await prisma.expense.findFirst({
      where: {
        id,
        creator: {
          id: userId
        }
      }
    });

    if (!expense) {
      return res.status(404).json({
        success: false,
        message: 'Expense record not found'
      });
    }

    if (expense.status === 'Posted') {
      return res.status(400).json({
        success: false,
        message: 'Expense already posted'
      });
    }

    const expenseAccount = await prisma.chartOfAccount.findFirst({
      where: {
        id: expense.expenseAccountId,
        createdBy: userId,
        type: 'Expense'
      }
    });

    if (!expenseAccount) {
      return res.status(400).json({
        success: false,
        message: 'Expense account not found. Please recreate the expense.'
      });
    }

    const posted = await ExpenseModel.postExpense(id, userId);

    let cashOrBankAccount;

    if (expense.paymentMethod === 'Cash' || !expense.bankAccountId) {
      cashOrBankAccount = await getOrCreateCashAccount(userId);
    } else if (expense.bankAccountId) {
      const bankAccount = await prisma.bankAccount.findFirst({
        where: {
          id: expense.bankAccountId,
          createdBy: userId
        },
        include: {
          chartOfAccount: true
        }
      });
      if (bankAccount && bankAccount.chartOfAccount) {
        cashOrBankAccount = bankAccount.chartOfAccount;
      }
    }

    if (!cashOrBankAccount) {
      cashOrBankAccount = await getOrCreateCashAccount(userId);
    }

    await createExpenseJournalEntry(userId, expense, expenseAccount, cashOrBankAccount);

    if (expense.bankAccountId) {
      const bankAccount = await prisma.bankAccount.findFirst({
        where: {
          id: expense.bankAccountId,
          createdBy: userId
        }
      });
      if (bankAccount) {
        const newBalance = bankAccount.currentBalance - expense.totalAmount;
        await prisma.bankAccount.update({
          where: { id: expense.bankAccountId },
          data: { currentBalance: newBalance }
        });
        await prisma.chartOfAccount.update({
          where: { id: bankAccount.chartOfAccountId },
          data: { currentBalance: newBalance }
        });
      }
    } else if (cashOrBankAccount) {
      const newBalance = (cashOrBankAccount.currentBalance || 0) - expense.totalAmount;
      await prisma.chartOfAccount.update({
        where: { id: cashOrBankAccount.id },
        data: { currentBalance: newBalance }
      });
    }

    await prisma.chartOfAccount.update({
      where: { id: expenseAccount.id },
      data: { currentBalance: { increment: expense.totalAmount } }
    });

    res.status(200).json({
      success: true,
      data: posted,
      message: 'Expense posted successfully'
    });
  } catch (error) {
    console.error('❌ Post expense error:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// ============================================================
// ─── EXPORT ALL FUNCTIONS ──────────────────────────────────────
// ============================================================
module.exports = {
  createExpense,
  getExpenses,
  getExpense,
  updateExpense,
  deleteExpense,
  getSummary,
  postExpense,
  getExpenseAccounts
};