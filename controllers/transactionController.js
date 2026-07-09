// warehouse/controller/transactionController.js - COMPLETE

const TransactionModel = require('../models/Transaction');
const prisma = require('../prisma/client');

// ============================================================
// ─── TRANSACTION CONTROLLERS ──────────────────────────────────
// ============================================================

// @desc    Create Transaction
// @route   POST /api/transactions
// @access  Private
const createTransaction = async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      date,
      type,
      title,
      description,
      amount,
      category,
      paymentMethod,
      reference,
      customerId,
      vendorId,
      bankAccountId
    } = req.body;

    console.log('═══════════════════════════════════════════════════');
    console.log('🔵 [createTransaction] Called');
    console.log('🔵 [createTransaction] User ID:', userId);
    console.log('🔵 [createTransaction] Type:', type);
    console.log('🔵 [createTransaction] Title:', title);
    console.log('🔵 [createTransaction] Amount:', amount);
    console.log('🔵 [createTransaction] Category:', category);
    console.log('🔵 [createTransaction] Payment Method:', paymentMethod);
    console.log('═══════════════════════════════════════════════════');

    // ─── Validation ──────────────────────────────────────────
    if (!type || !title || !amount || !category) {
      return res.status(400).json({
        success: false,
        message: 'Type, title, amount and category are required'
      });
    }

    if (amount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Amount must be greater than 0'
      });
    }

    if (type !== 'income' && type !== 'expense') {
      return res.status(400).json({
        success: false,
        message: 'Type must be either "income" or "expense"'
      });
    }

    // ─── Check if bank account exists for bank transfer ────
    if (paymentMethod === 'Bank Transfer' || paymentMethod === 'Cheque') {
      if (!bankAccountId) {
        return res.status(400).json({
          success: false,
          message: 'Bank account is required for Bank Transfer or Cheque'
        });
      }
    }

    // ─── Create Transaction ──────────────────────────────────
    const transactionData = {
      date: date || new Date(),
      type,
      title,
      description: description || '',
      amount,
      category,
      paymentMethod: paymentMethod || 'Cash',
      reference: reference || '',
      customerId,
      vendorId,
      bankAccountId,
      userId,
      createdBy: userId
    };

    const transaction = await TransactionModel.createTransaction(transactionData);

    console.log('✅ [createTransaction] Transaction created successfully');
    console.log(`✅ [createTransaction] Transaction Number: ${transaction.transactionNumber}`);
    console.log('═══════════════════════════════════════════════════');

    res.status(201).json({
      success: true,
      message: `${type === 'income' ? 'Income' : 'Expense'} recorded successfully`,
      data: transaction
    });
  } catch (error) {
    console.error('❌ [createTransaction] Error:', error);
    console.log('═══════════════════════════════════════════════════');
    res.status(500).json({
      success: false,
      message: error.message || 'Server error'
    });
  }
};

// @desc    Get All Transactions
// @route   GET /api/transactions
// @access  Private
const getTransactions = async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      type,
      category,
      paymentMethod,
      startDate,
      endDate,
      search,
      page = 1,
      limit = 20,
      sortBy = 'date',
      sortOrder = 'desc'
    } = req.query;

    console.log('🔵 [getTransactions] Called');
    console.log('🔵 [getTransactions] Filters:', { type, category, search, page, limit });

    const filter = {
      createdBy: userId,
      isActive: true,
      isDeleted: false
    };

    // ─── Type Filter ─────────────────────────────────────────
    if (type && type !== 'All') {
      filter.type = type;
    }

    // ─── Category Filter ─────────────────────────────────────
    if (category && category !== 'All') {
      filter.category = category;
    }

    // ─── Payment Method Filter ──────────────────────────────
    if (paymentMethod && paymentMethod !== 'All') {
      filter.paymentMethod = paymentMethod;
    }

    // ─── Date Range Filter ──────────────────────────────────
    if (startDate || endDate) {
      filter.date = {};
      if (startDate) {
        filter.date.gte = new Date(startDate);
      }
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        filter.date.lte = end;
      }
    }

    // ─── Search Filter ──────────────────────────────────────
    if (search) {
      filter.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
        { reference: { contains: search, mode: 'insensitive' } },
        { customerName: { contains: search, mode: 'insensitive' } },
        { vendorName: { contains: search, mode: 'insensitive' } },
        { transactionNumber: { contains: search, mode: 'insensitive' } }
      ];
    }

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;
    const orderBy = { [sortBy]: sortOrder === 'asc' ? 'asc' : 'desc' };

    // ─── Execute Query ──────────────────────────────────────
    const [transactions, total, summary, stats] = await Promise.all([
      TransactionModel.findAll(filter, { skip, take: limitNum, orderBy }),
      TransactionModel.count(filter),
      TransactionModel.getSummary(userId, filter),
      TransactionModel.getStats(userId)
    ]);

    console.log(`✅ [getTransactions] Found ${transactions.length} transactions`);

    res.status(200).json({
      success: true,
      count: transactions.length,
      data: transactions,
      summary,
      stats,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum),
        hasNext: pageNum < Math.ceil(total / limitNum),
        hasPrev: pageNum > 1
      }
    });
  } catch (error) {
    console.error('❌ [getTransactions] Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// @desc    Get Transaction by ID
// @route   GET /api/transactions/:id
// @access  Private
const getTransactionById = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    console.log('🔵 [getTransactionById] Called');
    console.log('🔵 [getTransactionById] ID:', id);

    const transaction = await prisma.transaction.findFirst({
      where: {
        id: id,
        userId: userId,
        isActive: true,
        isDeleted: false
      },
      include: {
        customer: {
          select: { id: true, name: true, email: true, phone: true }
        },
        vendor: {
          select: { id: true, name: true, email: true, phone: true }
        },
        bankAccount: {
          select: { id: true, accountName: true, accountNumber: true, bankName: true }
        },
        creator: {
          select: { id: true, firstName: true, lastName: true, email: true }
        },
        poster: {
          select: { id: true, firstName: true, lastName: true, email: true }
        },
        journalEntry: {
          include: {
            lines: {
              include: {
                account: true
              }
            }
          }
        }
      }
    });

    if (!transaction) {
      console.log('❌ [getTransactionById] Transaction not found');
      return res.status(404).json({
        success: false,
        message: 'Transaction not found'
      });
    }

    console.log(`✅ [getTransactionById] Found: ${transaction.transactionNumber}`);

    res.status(200).json({
      success: true,
      data: transaction
    });
  } catch (error) {
    console.error('❌ [getTransactionById] Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// @desc    Get Transaction by Number
// @route   GET /api/transactions/number/:transactionNumber
// @access  Private
const getTransactionByNumber = async (req, res) => {
  try {
    const userId = req.user.id;
    const { transactionNumber } = req.params;

    console.log('🔵 [getTransactionByNumber] Called');
    console.log('🔵 [getTransactionByNumber] Number:', transactionNumber);

    const transaction = await prisma.transaction.findFirst({
      where: {
        transactionNumber: transactionNumber,
        userId: userId,
        isActive: true,
        isDeleted: false
      },
      include: {
        customer: {
          select: { id: true, name: true, email: true, phone: true }
        },
        vendor: {
          select: { id: true, name: true, email: true, phone: true }
        },
        bankAccount: {
          select: { id: true, accountName: true, accountNumber: true, bankName: true }
        },
        creator: {
          select: { id: true, firstName: true, lastName: true, email: true }
        },
        poster: {
          select: { id: true, firstName: true, lastName: true, email: true }
        },
        journalEntry: {
          include: {
            lines: {
              include: {
                account: true
              }
            }
          }
        }
      }
    });

    if (!transaction) {
      console.log('❌ [getTransactionByNumber] Transaction not found');
      return res.status(404).json({
        success: false,
        message: 'Transaction not found'
      });
    }

    console.log(`✅ [getTransactionByNumber] Found: ${transaction.transactionNumber}`);

    res.status(200).json({
      success: true,
      data: transaction
    });
  } catch (error) {
    console.error('❌ [getTransactionByNumber] Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// @desc    Update Transaction
// @route   PUT /api/transactions/:id
// @access  Private
const updateTransaction = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;
    const {
      date,
      title,
      description,
      amount,
      category,
      paymentMethod,
      reference,
      customerId,
      vendorId,
      bankAccountId
    } = req.body;

    console.log('🔵 [updateTransaction] Called');
    console.log('🔵 [updateTransaction] ID:', id);

    // ─── Check if transaction exists ──────────────────────
    const existing = await prisma.transaction.findFirst({
      where: {
        id: id,
        userId: userId,
        isActive: true,
        isDeleted: false
      }
    });

    if (!existing) {
      console.log('❌ [updateTransaction] Transaction not found');
      return res.status(404).json({
        success: false,
        message: 'Transaction not found'
      });
    }

    if (existing.status === 'Posted') {
      console.log('❌ [updateTransaction] Cannot update posted transaction');
      return res.status(400).json({
        success: false,
        message: 'Cannot update posted transaction'
      });
    }

    // ─── Validate customer if updating ─────────────────────
    if (customerId) {
      const customer = await prisma.customer.findFirst({
        where: {
          id: customerId,
          userId: userId,
          isActive: true,
          isDeleted: false
        }
      });
      if (!customer) {
        return res.status(404).json({
          success: false,
          message: 'Customer not found'
        });
      }
    }

    // ─── Validate vendor if updating ───────────────────────
    if (vendorId) {
      const vendor = await prisma.supplier.findFirst({
        where: {
          id: vendorId,
          userId: userId,
          status: 'active'
        }
      });
      if (!vendor) {
        return res.status(404).json({
          success: false,
          message: 'Vendor not found'
        });
      }
    }

    // ─── Validate bank account if updating ─────────────────
    if (bankAccountId) {
      const bankAccount = await prisma.bankAccount.findFirst({
        where: {
          id: bankAccountId,
          OR: [
            { createdBy: userId },
            { userId: userId }
          ]
        }
      });
      if (!bankAccount) {
        return res.status(404).json({
          success: false,
          message: 'Bank account not found'
        });
      }
    }

    // ─── Update Transaction ──────────────────────────────────
    const updateData = {
      date: date || existing.date,
      title: title || existing.title,
      description: description !== undefined ? description : existing.description,
      amount: amount || existing.amount,
      category: category || existing.category,
      paymentMethod: paymentMethod || existing.paymentMethod,
      reference: reference !== undefined ? reference : existing.reference,
      customerId: customerId !== undefined ? customerId : existing.customerId,
      vendorId: vendorId !== undefined ? vendorId : existing.vendorId,
      bankAccountId: bankAccountId !== undefined ? bankAccountId : existing.bankAccountId
    };

    const updated = await TransactionModel.updateTransaction(id, updateData, userId);

    console.log('✅ [updateTransaction] Transaction updated successfully');

    res.status(200).json({
      success: true,
      message: 'Transaction updated successfully',
      data: updated
    });
  } catch (error) {
    console.error('❌ [updateTransaction] Error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Server error'
    });
  }
};

// @desc    Delete Transaction
// @route   DELETE /api/transactions/:id
// @access  Private
const deleteTransaction = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    console.log('🔵 [deleteTransaction] Called');
    console.log('🔵 [deleteTransaction] ID:', id);

    // ─── Check if transaction exists ──────────────────────
    const existing = await prisma.transaction.findFirst({
      where: {
        id: id,
        userId: userId,
        isActive: true,
        isDeleted: false
      }
    });

    if (!existing) {
      console.log('❌ [deleteTransaction] Transaction not found');
      return res.status(404).json({
        success: false,
        message: 'Transaction not found'
      });
    }

    if (existing.status === 'Posted') {
      console.log('❌ [deleteTransaction] Cannot delete posted transaction');
      return res.status(400).json({
        success: false,
        message: 'Cannot delete posted transaction'
      });
    }

    // ─── Soft Delete ────────────────────────────────────────
    await TransactionModel.deleteTransaction(id, userId);

    console.log('✅ [deleteTransaction] Transaction deleted successfully');

    res.status(200).json({
      success: true,
      message: 'Transaction deleted successfully'
    });
  } catch (error) {
    console.error('❌ [deleteTransaction] Error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Server error'
    });
  }
};

// @desc    Get Transaction Summary
// @route   GET /api/transactions/summary
// @access  Private
const getTransactionSummary = async (req, res) => {
  try {
    const userId = req.user.id;
    const { startDate, endDate } = req.query;

    console.log('🔵 [getTransactionSummary] Called');

    const filter = {
      userId: userId,
      isActive: true,
      isDeleted: false
    };

    if (startDate || endDate) {
      filter.date = {};
      if (startDate) {
        filter.date.gte = new Date(startDate);
      }
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        filter.date.lte = end;
      }
    }

    const summary = await TransactionModel.getSummary(userId, filter);
    const stats = await TransactionModel.getStats(userId);
    const categories = TransactionModel.getCategories();

    res.status(200).json({
      success: true,
      data: {
        summary,
        stats,
        categories
      }
    });
  } catch (error) {
    console.error('❌ [getTransactionSummary] Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// @desc    Get Transaction Categories
// @route   GET /api/transactions/categories
// @access  Private
const getTransactionCategories = async (req, res) => {
  try {
    console.log('🔵 [getTransactionCategories] Called');

    const categories = TransactionModel.getCategories();

    res.status(200).json({
      success: true,
      data: categories
    });
  } catch (error) {
    console.error('❌ [getTransactionCategories] Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// @desc    Get Transaction Stats (Today, Month)
// @route   GET /api/transactions/stats
// @access  Private
const getTransactionStats = async (req, res) => {
  try {
    const userId = req.user.id;

    console.log('🔵 [getTransactionStats] Called');

    const stats = await TransactionModel.getStats(userId);

    res.status(200).json({
      success: true,
      data: stats
    });
  } catch (error) {
    console.error('❌ [getTransactionStats] Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// ─── EXPORT CONTROLLERS ──────────────────────────────────────

module.exports = {
  createTransaction,
  getTransactions,
  getTransactionById,
  getTransactionByNumber,
  updateTransaction,
  deleteTransaction,
  getTransactionSummary,
  getTransactionCategories,
  getTransactionStats  // ✅ Make sure this is included
};