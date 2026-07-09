// controllers/incomeController.js - COMPLETE FIXED VERSION WITH INCOME ACCOUNT

const IncomeModel = require('../models/Income');
const prisma = require('../prisma/client');

// ─── HELPER: Get all income accounts for dropdown ──────────────
async function getIncomeAccountsForDropdown(userId) {
  let accounts = await prisma.chartOfAccount.findMany({
    where: {
      createdBy: userId,
      type: { in: ['Revenue', 'Income'] },
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

  if (accounts.length === 0) {
    // Create a default income account
    const existingCode = await prisma.chartOfAccount.findFirst({
      where: { code: '4000' }
    });

    let newCode = '4000';
    if (existingCode) {
      let counter = 1;
      let codeExists = true;
      while (codeExists) {
        newCode = `400${counter}`;
        const existing = await prisma.chartOfAccount.findFirst({
          where: { code: newCode }
        });
        if (!existing) codeExists = false;
        counter++;
      }
    }

    const newAccount = await prisma.chartOfAccount.create({
      data: {
        code: newCode,
        name: 'Sales Revenue',
        type: 'Revenue',
        parentAccount: 'Operating Revenue',
        openingBalance: 0,
        currentBalance: 0,
        description: 'Default sales revenue account',
        taxCode: 'N/A',
        balanceType: 'Credit',
        isActive: true,
        createdBy: userId
      },
      select: {
        id: true,
        code: true,
        name: true,
        type: true
      }
    });

    accounts = [newAccount];
  }

  return accounts;
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

// ─── HELPER: Create journal entry for income ─────────────────────
async function createIncomeJournalEntry(userId, income, cashOrBankAccount, incomeAccount) {
  const entryNumber = `JE-${Date.now()}`;

  return await prisma.journalEntry.create({
    data: {
      entryNumber,
      date: income.date || new Date(),
      description: income.description || `${income.incomeType} - ${income.incomeNumber}`,
      reference: income.reference || income.incomeNumber,
      status: 'Posted',
      createdBy: userId,
      postedBy: userId,
      postedAt: new Date(),
      lines: {
        create: [
          {
            accountId: cashOrBankAccount.id,
            accountName: cashOrBankAccount.name,
            accountCode: cashOrBankAccount.code,
            debit: income.totalAmount,
            credit: 0,
            isReconciled: false
          },
          {
            accountId: incomeAccount.id,
            accountName: incomeAccount.name,
            accountCode: incomeAccount.code,
            debit: 0,
            credit: income.totalAmount,
            isReconciled: false
          }
        ]
      }
    }
  });
}

// ============================================================
// @desc    Get income accounts for dropdown
// @route   GET /api/income/accounts
// @access  Private
// ============================================================
exports.getIncomeAccounts = async (req, res) => {
  try {
    const userId = req.user.id;
    const accounts = await getIncomeAccountsForDropdown(userId);

    res.status(200).json({
      success: true,
      data: accounts
    });
  } catch (error) {
    console.error('❌ Get income accounts error:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// ============================================================
// @desc    Create Income - WITH INCOME ACCOUNT SELECTION
// @route   POST /api/income
// @access  Private
// ============================================================
exports.createIncome = async (req, res) => {
  try {
    const {
      date,
      incomeType,
      incomeAccountId,  // ✅ NEW
      customerId,
      items,
      amount,
      taxRate,
      description,
      reference,
      paymentMethod,
      bankAccountId,
    } = req.body;

    const userId = req.user.id;

    console.log("📦 Received income data:", JSON.stringify(req.body, null, 2));

    // ─── ✅ VALIDATE: Check if income account exists ─────────────
    if (!incomeAccountId) {
      return res.status(400).json({
        success: false,
        message: 'Please select an income account',
        suggestion: 'Select an income account from the dropdown'
      });
    }

    const incomeAccount = await prisma.chartOfAccount.findFirst({
      where: {
        id: incomeAccountId,
        createdBy: userId,
        type: { in: ['Revenue', 'Income'] },
        isActive: true
      }
    });

    if (!incomeAccount) {
      return res.status(400).json({
        success: false,
        message: 'Selected income account not found or is not active',
        suggestion: 'Please select a valid income account'
      });
    }

    console.log(`✅ Using income account: ${incomeAccount.name} (${incomeAccount.code})`);

    // ─── Clean bankAccountId ──────────────────────────────────────
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

    console.log(`🔍 Final cleanBankAccountId: "${cleanBankAccountId}"`);

    // ─── Validate Bank Transfer ──────────────────────────────────
    let finalPaymentMethod = paymentMethod || 'Cash';
    let finalBankAccountId = null;
    let bankAccountData = null;

    if (paymentMethod === 'Bank Transfer' || paymentMethod === 'Bank') {
      if (!cleanBankAccountId) {
        return res.status(400).json({
          success: false,
          message: 'Bank account is required for Bank Transfer. Please select a bank account.',
          suggestion: 'Please select a bank account from the dropdown before submitting.'
        });
      }

      finalBankAccountId = cleanBankAccountId;
      
      bankAccountData = await prisma.bankAccount.findFirst({
        where: {
          id: finalBankAccountId,
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
      
      console.log(`🏦 Bank account found: ${bankAccountData.accountName} (${bankAccountData.accountNumber})`);
      console.log(`   Current balance: ${bankAccountData.currentBalance}`);
      finalPaymentMethod = paymentMethod;
    } else {
      console.log('💵 Payment method is Cash, ignoring bankAccountId');
      finalPaymentMethod = 'Cash';
      finalBankAccountId = null;
    }

    // ─── Get customer name ──────────────────────────────────────
    let customerName = '';
    if (customerId) {
      const customer = await prisma.customer.findFirst({
        where: {
          id: customerId,
          createdBy: userId
        }
      });
      if (customer) {
        customerName = customer.name;
      }
    }

    // ─── Process items ──────────────────────────────────────────
    let finalItems = [];
    let finalAmount = 0;
    let subtotal = 0;
    let taxAmount = 0;
    let totalAmount = 0;

    const hasItems = items && items.length > 0;

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
    } else {
      console.log("📊 Processing SIMPLE income with amount:", amount);
      finalAmount = amount || 0;
      subtotal = finalAmount;
      totalAmount = finalAmount;
      taxAmount = 0;
      finalItems = [];
    }

    console.log(`💰 Total Amount: ${totalAmount}`);

    // ─── Format date ──────────────────────────────────────────────
    let formattedDate = date ? new Date(date) : new Date();
    if (isNaN(formattedDate.getTime())) {
      formattedDate = new Date();
    }

    // ─── Create income record ──────────────────────────────────
    const income = await IncomeModel.create({
      date: formattedDate,
      incomeType,
      incomeAccountId: incomeAccount.id,  // ✅ NEW
      customerId: customerId || null,
      customerName,
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

    console.log("✅ Income created successfully!");
    console.log("   ID:", income.id);
    console.log("   Number:", income.incomeNumber);
    console.log("   Total Amount:", income.totalAmount);

    // ─── Create journal entry using SELECTED income account ──
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

    console.log(`📒 Journal Entry - Debit: ${cashOrBankAccount.name}, Credit: ${incomeAccount.name}`);

    // ─── Create journal entry ──────────────────────────────────
    await createIncomeJournalEntry(userId, income, cashOrBankAccount, incomeAccount);

    // ─── Update bank/cash account balance ──────────────────────
    if (finalBankAccountId && bankAccountData) {
      const oldBalance = bankAccountData.currentBalance;
      const newBalance = oldBalance + totalAmount;
      
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
      const newBalance = oldBalance + totalAmount;
      
      console.log(`💰 Updating cash account balance: ${oldBalance} → ${newBalance}`);
      
      await prisma.chartOfAccount.update({
        where: { id: cashOrBankAccount.id },
        data: { currentBalance: newBalance }
      });
      
      console.log(`✅ Cash account balance updated successfully!`);
    }

    // ─── ✅ Update income account balance (INCREASE) ────────────
    const oldIncomeBalance = incomeAccount.currentBalance || 0;
    const newIncomeBalance = oldIncomeBalance + totalAmount;
    
    await prisma.chartOfAccount.update({
      where: { id: incomeAccount.id },
      data: { currentBalance: newIncomeBalance }
    });
    
    console.log(`💰 Updated income account balance: ${oldIncomeBalance} → ${newIncomeBalance}`);

    res.status(201).json({
      success: true,
      data: income,
      incomeAccount: {
        id: incomeAccount.id,
        code: incomeAccount.code,
        name: incomeAccount.name
      },
      message: finalBankAccountId ? 'Income recorded and posted to ledger (Bank Transfer)' : 'Income recorded and posted to ledger (Cash)'
    });
  } catch (error) {
    console.error("🔥 ERROR in createIncome:", error);

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
// @desc    Get all incomes
// @route   GET /api/income/list
// @access  Private
// ============================================================
exports.getIncomes = async (req, res) => {
  try {
    const { incomeType, status, startDate, endDate, search, page = 1, limit = 10 } = req.query;
    const userId = req.user.id;

    const filter = { createdBy: userId };

    if (incomeType && incomeType !== 'All') {
      filter.incomeType = incomeType;
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
        { incomeNumber: { contains: search, mode: 'insensitive' } },
        { customerName: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } }
      ];
    }

    const pageNum = parseInt(page) || 1;
    const limitNum = parseInt(limit) || 10;
    const skip = (pageNum - 1) * limitNum;

    const [incomes, totalCount] = await Promise.all([
      IncomeModel.findAll(filter, { skip, take: limitNum, orderBy: { date: 'desc' } }),
      IncomeModel.count(filter)
    ]);

    const totalPages = Math.ceil(totalCount / limitNum);

    res.status(200).json({
      success: true,
      count: incomes.length,
      total: totalCount,
      page: pageNum,
      pages: totalPages,
      data: incomes
    });
  } catch (error) {
    console.error('❌ Get incomes error:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// ============================================================
// @desc    Get single income
// @route   GET /api/income/:id
// @access  Private
// ============================================================
exports.getIncome = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const income = await prisma.income.findFirst({
      where: {
        id,
        createdBy: userId
      },
      include: {
        customer: {
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
        incomeAccount: {
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

    if (!income) {
      return res.status(404).json({
        success: false,
        message: 'Income record not found'
      });
    }

    res.status(200).json({
      success: true,
      data: income
    });
  } catch (error) {
    console.error('❌ Get income error:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// ============================================================
// @desc    Update income
// @route   PUT /api/income/:id
// @access  Private
// ============================================================
exports.updateIncome = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const {
      date,
      incomeType,
      incomeAccountId,  // ✅ NEW
      customerId,
      items,
      amount,
      taxRate,
      description,
      reference,
      paymentMethod,
      bankAccountId
    } = req.body;

    const existing = await prisma.income.findFirst({
      where: {
        id,
        createdBy: userId
      }
    });

    if (!existing) {
      return res.status(404).json({
        success: false,
        message: 'Income record not found'
      });
    }

    if (existing.status === 'Posted') {
      return res.status(400).json({
        success: false,
        message: 'Cannot update posted income record'
      });
    }

    let customerName = existing.customerName;
    if (customerId) {
      const customer = await prisma.customer.findFirst({
        where: {
          id: customerId,
          createdBy: userId
        }
      });
      if (customer) {
        customerName = customer.name;
      }
    }

    let validBankAccountId = null;
    if (bankAccountId && bankAccountId !== 'null' && bankAccountId !== 'NULL' && bankAccountId !== 'undefined') {
      const bankAccount = await prisma.bankAccount.findFirst({
        where: {
          id: bankAccountId,
          createdBy: userId
        }
      });
      if (!bankAccount) {
        return res.status(400).json({
          success: false,
          message: 'Bank account not found or does not belong to you'
        });
      }
      validBankAccountId = bankAccountId;
    }

    // ─── ✅ Validate income account ──────────────────────────────
    if (incomeAccountId) {
      const incomeAccount = await prisma.chartOfAccount.findFirst({
        where: {
          id: incomeAccountId,
          createdBy: userId,
          type: { in: ['Revenue', 'Income'] }
        }
      });
      if (!incomeAccount) {
        return res.status(400).json({
          success: false,
          message: 'Selected income account not found'
        });
      }
    }

    const updateData = {
      date: date || existing.date,
      incomeType: incomeType || existing.incomeType,
      incomeAccountId: incomeAccountId || existing.incomeAccountId,  // ✅ NEW
      customerId: customerId || existing.customerId,
      customerName: customerName || existing.customerName,
      description: description !== undefined ? description : existing.description,
      reference: reference !== undefined ? reference : existing.reference,
      paymentMethod: paymentMethod || existing.paymentMethod,
      bankAccountId: validBankAccountId,
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

    const updated = await IncomeModel.update(id, updateData);

    res.status(200).json({
      success: true,
      data: updated,
      message: 'Income record updated successfully'
    });
  } catch (error) {
    console.error('❌ Update income error:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// ============================================================
// @desc    Delete income
// @route   DELETE /api/income/:id
// @access  Private
// ============================================================
exports.deleteIncome = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const existing = await prisma.income.findFirst({
      where: {
        id,
        createdBy: userId
      }
    });

    if (!existing) {
      return res.status(404).json({
        success: false,
        message: 'Income record not found'
      });
    }

    if (existing.status === 'Posted') {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete posted income record'
      });
    }

    await IncomeModel.delete(id);

    res.status(200).json({
      success: true,
      message: 'Income record deleted successfully'
    });
  } catch (error) {
    console.error('❌ Delete income error:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// ============================================================
// @desc    Get income summary
// @route   GET /api/income/summary
// @access  Private
// ============================================================
exports.getSummary = async (req, res) => {
  try {
    const { startDate, endDate, page = 1, limit = 10 } = req.query;
    const userId = req.user.id;

    const filter = {
      createdBy: userId,
      status: 'Posted'
    };

    if (startDate && endDate) {
      filter.date = {
        gte: new Date(startDate),
        lte: new Date(endDate)
      };
    }

    const allIncomes = await prisma.income.findMany({
      where: filter
    });

    const summary = await IncomeModel.getSummary(allIncomes);

    const pageNum = parseInt(page) || 1;
    const limitNum = parseInt(limit) || 10;
    const skip = (pageNum - 1) * limitNum;

    const [incomes, totalCount] = await Promise.all([
      prisma.income.findMany({
        where: filter,
        skip,
        take: limitNum,
        orderBy: { date: 'desc' },
        include: {
          customer: {
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
          incomeAccount: {
            select: {
              id: true,
              code: true,
              name: true,
              type: true
            }
          }
        }
      }),
      prisma.income.count({ where: filter })
    ]);

    const totalPages = Math.ceil(totalCount / limitNum);

    res.status(200).json({
      success: true,
      data: {
        summary,
        incomes,
        pagination: {
          total: totalCount,
          page: pageNum,
          limit: limitNum,
          pages: totalPages,
          hasNext: pageNum < totalPages,
          hasPrev: pageNum > 1
        }
      }
    });
  } catch (error) {
    console.error('❌ Get income summary error:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// ============================================================
// @desc    Post income (Draft → Posted)
// @route   POST /api/income/:id/post
// @access  Private
// ============================================================
exports.postIncome = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const income = await prisma.income.findFirst({
      where: {
        id,
        createdBy: userId
      }
    });

    if (!income) {
      return res.status(404).json({
        success: false,
        message: 'Income record not found'
      });
    }

    if (income.status === 'Posted') {
      return res.status(400).json({
        success: false,
        message: 'Income already posted'
      });
    }

    // ─── ✅ Get income account from record ──────────────────────
    const incomeAccount = await prisma.chartOfAccount.findFirst({
      where: {
        id: income.incomeAccountId,
        createdBy: userId,
        type: 'Revenue'
      }
    });

    if (!incomeAccount) {
      return res.status(400).json({
        success: false,
        message: 'Income account not found. Please recreate the income record.'
      });
    }

    const posted = await IncomeModel.postIncome(id, userId);

    let cashOrBankAccount;

    if (income.paymentMethod === 'Cash') {
      cashOrBankAccount = await getOrCreateCashAccount(userId);
    } else if (income.bankAccountId) {
      const bankAccount = await prisma.bankAccount.findFirst({
        where: {
          id: income.bankAccountId,
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

    await createIncomeJournalEntry(userId, income, cashOrBankAccount, incomeAccount);

    // ─── Update bank/cash balance (INCREASE) ──────────────────
    if (income.bankAccountId) {
      const bankAccount = await prisma.bankAccount.findFirst({
        where: {
          id: income.bankAccountId,
          createdBy: userId
        }
      });
      if (bankAccount) {
        const newBalance = bankAccount.currentBalance + income.totalAmount;
        await prisma.bankAccount.update({
          where: { id: income.bankAccountId },
          data: { currentBalance: newBalance }
        });
        await prisma.chartOfAccount.update({
          where: { id: bankAccount.chartOfAccountId },
          data: { currentBalance: newBalance }
        });
      }
    } else if (cashOrBankAccount) {
      const newBalance = (cashOrBankAccount.currentBalance || 0) + income.totalAmount;
      await prisma.chartOfAccount.update({
        where: { id: cashOrBankAccount.id },
        data: { currentBalance: newBalance }
      });
    }

    // ─── Update income account balance (INCREASE) ────────────
    await prisma.chartOfAccount.update({
      where: { id: incomeAccount.id },
      data: { currentBalance: { increment: income.totalAmount } }
    });

    res.status(200).json({
      success: true,
      data: posted,
      message: 'Income posted successfully'
    });
  } catch (error) {
    console.error('❌ Post income error:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};