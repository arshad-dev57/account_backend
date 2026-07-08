// models/Expense.js - PostgreSQL Version - FIXED

const prisma = require('../prisma/client');

// ─── CONSTANTS ─────────────────────────────────────────────────────
const VALID_EXPENSE_TYPES = [
  'Rent', 'Utilities', 'Salaries', 'Marketing',
  'Office Supplies', 'Travel', 'Meals', 'Insurance',
  'Maintenance', 'Software', 'Taxes', 'Other'
];

const VALID_PAYMENT_METHODS = ['Cash', 'Bank Transfer', 'Cheque', 'Credit Card', 'Online'];
const VALID_STATUS = ['Draft', 'Posted', 'Cancelled'];

class ExpenseModel {
  // ============================================================
  // ✅ VALIDATE EXPENSE DATA
  // ============================================================
  static validateExpenseData(data) {
    const errors = [];

    if (!data.expenseType) errors.push('Expense type is required');
    if (!VALID_EXPENSE_TYPES.includes(data.expenseType)) {
      errors.push(`Invalid expense type. Must be one of: ${VALID_EXPENSE_TYPES.join(', ')}`);
    }

    if (data.paymentMethod && !VALID_PAYMENT_METHODS.includes(data.paymentMethod)) {
      errors.push(`Invalid payment method. Must be one of: ${VALID_PAYMENT_METHODS.join(', ')}`);
    }

    if (data.status && !VALID_STATUS.includes(data.status)) {
      errors.push(`Invalid status. Must be one of: ${VALID_STATUS.join(', ')}`);
    }

    if (data.amount !== undefined && data.amount < 0) {
      errors.push('Amount cannot be negative');
    }

    if (data.taxRate !== undefined && (data.taxRate < 0 || data.taxRate > 100)) {
      errors.push('Tax rate must be between 0 and 100');
    }

    return errors;
  }

  // ============================================================
  // ✅ GENERATE EXPENSE NUMBER
  // ============================================================
  static async generateExpenseNumber() {
    const year = new Date().getFullYear();
    const prefix = `EXP-${year}-`;

    const lastExpense = await prisma.expense.findFirst({
      where: {
        expenseNumber: {
          startsWith: prefix
        }
      },
      orderBy: {
        expenseNumber: 'desc'
      }
    });

    if (!lastExpense) {
      return `${prefix}0001`;
    }

    const parts = lastExpense.expenseNumber.split('-');
    const lastNum = parseInt(parts[parts.length - 1]);
    const nextNum = lastNum + 1;

    return `${prefix}${String(nextNum).padStart(4, '0')}`;
  }

  // ============================================================
  // ✅ CREATE EXPENSE
  // ============================================================
  static async create(data) {
    const errors = this.validateExpenseData(data);
    if (errors.length > 0) {
      throw new Error(errors.join('; '));
    }

    const MAX_RETRIES = 3;
    let lastError = null;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        return await this._createOnce(data);
      } catch (error) {
        const isDuplicateExpenseNumber =
          error.code === 'P2002' &&
          error.meta?.target?.includes('expense_number');

        if (isDuplicateExpenseNumber && attempt < MAX_RETRIES) {
          lastError = error;
          console.warn(`⚠️ expense_number collision, retrying (attempt ${attempt}/${MAX_RETRIES})...`);
          continue;
        }

        throw error;
      }
    }

    throw lastError;
  }

  // ============================================================
  // ✅ INTERNAL: single create attempt
  // ============================================================
  static async _createOnce(data) {
    const expenseNumber = await this.generateExpenseNumber();

    let hasItems = false;
    let subtotal = 0;
    let taxAmount = 0;
    let totalAmount = 0;
    let finalAmount = 0;
    let itemsData = [];

    if (data.items && data.items.length > 0) {
      hasItems = true;
      itemsData = data.items.map(item => ({
        description: item.description,
        quantity: item.quantity || 1,
        unitPrice: item.unitPrice || 0,
        amount: (item.quantity || 1) * (item.unitPrice || 0),
      }));
      subtotal = itemsData.reduce((sum, item) => sum + (item.amount || 0), 0);
      taxAmount = subtotal * (data.taxRate || 0) / 100;
      totalAmount = subtotal + taxAmount;
      finalAmount = 0;
    } else if (data.amount && data.amount > 0) {
      hasItems = false;
      finalAmount = data.amount || 0;
      subtotal = finalAmount;
      totalAmount = finalAmount;
      taxAmount = 0;
      itemsData = [];
    } else {
      totalAmount = 0;
    }

    let dateObj = data.date ? new Date(data.date) : new Date();
    if (isNaN(dateObj.getTime())) {
      dateObj = new Date();
    }

    // ─── ✅ FIX: Direct scalar FK fields REMOVED — only relations used ───
    const createData = {
      expenseNumber,
      date: dateObj,
      expenseType: data.expenseType,
      // ❌ REMOVED: expenseAccountId — use relation connect instead
      // ❌ REMOVED: vendorId — use relation connect instead
      // ❌ REMOVED: bankAccountId — use relation connect instead
      vendorName: data.vendorName || '',
      items: itemsData,
      amount: finalAmount,
      hasItems: hasItems,
      subtotal: subtotal,
      taxRate: data.taxRate || 0,
      taxAmount: taxAmount,
      totalAmount: totalAmount,
      description: data.description || '',
      reference: data.reference || '',
      paymentMethod: data.paymentMethod || 'Cash',
      status: data.status || 'Posted',
      postedAt: data.postedAt || new Date(),
    };

    // ✅ Relations
    createData.creator = {
      connect: { id: data.createdBy }
    };

    const posterId = data.postedBy || data.createdBy;
    createData.poster = {
      connect: { id: posterId }
    };

    if (data.vendorId) {
      createData.vendor = {
        connect: { id: data.vendorId }
      };
    }

    if (data.bankAccountId) {
      createData.bankAccount = {
        connect: { id: data.bankAccountId }
      };
    }

    if (data.expenseAccountId) {
      createData.expenseAccount = {
        connect: { id: data.expenseAccountId }
      };
    }

    return await prisma.expense.create({
      data: createData,
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
  }

  // ============================================================
  // ✅ GET ALL EXPENSES
  // ============================================================
  static async findAll(filter = {}, options = {}) {
    const { skip, take, orderBy = { date: 'desc' } } = options;

    return await prisma.expense.findMany({
      where: filter,
      skip,
      take,
      orderBy,
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
  }

  // ============================================================
  // ✅ COUNT EXPENSES
  // ============================================================
  static async count(filter = {}) {
    return await prisma.expense.count({ where: filter });
  }

  // ============================================================
  // ✅ FIND EXPENSE BY ID
  // ============================================================
  static async findById(id) {
    return await prisma.expense.findUnique({
      where: { id },
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
  }

  // ============================================================
  // ✅ FIND EXPENSE BY NUMBER
  // ============================================================
  static async findByNumber(expenseNumber, userId) {
    return await prisma.expense.findFirst({
      where: {
        expenseNumber,
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
        expenseAccount: {
          select: {
            id: true,
            code: true,
            name: true,
            type: true
          }
        }
      }
    });
  }

  // ============================================================
  // ✅ UPDATE EXPENSE
  // ============================================================
  static async update(id, data) {
    const existing = await prisma.expense.findUnique({
      where: { id }
    });

    if (!existing) return null;

    const mergedData = { ...existing, ...data };
    const errors = this.validateExpenseData(mergedData);
    if (errors.length > 0) {
      throw new Error(errors.join('; '));
    }

    let itemsData = data.items || existing.items;
    let hasItems = existing.hasItems;
    let subtotal = existing.subtotal;
    let taxAmount = existing.taxAmount;
    let totalAmount = existing.totalAmount;
    let finalAmount = existing.amount;

    if (data.items && data.items.length > 0) {
      hasItems = true;
      itemsData = data.items.map(item => ({
        description: item.description,
        quantity: item.quantity || 1,
        unitPrice: item.unitPrice || 0,
        amount: (item.quantity || 1) * (item.unitPrice || 0),
      }));
      subtotal = itemsData.reduce((sum, item) => sum + (item.amount || 0), 0);
      taxAmount = subtotal * (data.taxRate || existing.taxRate || 0) / 100;
      totalAmount = subtotal + taxAmount;
      finalAmount = 0;
    } else if (data.amount !== undefined && data.amount > 0) {
      hasItems = false;
      finalAmount = data.amount;
      subtotal = finalAmount;
      totalAmount = finalAmount;
      taxAmount = 0;
      itemsData = [];
    }

    let dateObj = data.date ? new Date(data.date) : existing.date;
    if (isNaN(dateObj.getTime())) {
      dateObj = new Date();
    }

    // ✅ FIX: Direct scalar FK fields REMOVED from updateData
    const updateData = {
      date: dateObj,
      expenseType: data.expenseType || existing.expenseType,
      // ❌ REMOVED: expenseAccountId
      // ❌ REMOVED: vendorId
      // ❌ REMOVED: bankAccountId
      vendorName: data.vendorName !== undefined ? data.vendorName : existing.vendorName,
      items: itemsData,
      amount: finalAmount,
      hasItems: hasItems,
      subtotal: subtotal,
      taxRate: data.taxRate || existing.taxRate,
      taxAmount: taxAmount,
      totalAmount: totalAmount,
      description: data.description !== undefined ? data.description : existing.description,
      reference: data.reference !== undefined ? data.reference : existing.reference,
      paymentMethod: data.paymentMethod || existing.paymentMethod,
      status: data.status || existing.status,
    };

    // ✅ Handle relations only
    if (data.vendorId !== undefined) {
      updateData.vendor = data.vendorId ? {
        connect: { id: data.vendorId }
      } : {
        disconnect: true
      };
    }

    if (data.bankAccountId !== undefined) {
      updateData.bankAccount = data.bankAccountId ? {
        connect: { id: data.bankAccountId }
      } : {
        disconnect: true
      };
    }

    if (data.expenseAccountId !== undefined) {
      updateData.expenseAccount = data.expenseAccountId ? {
        connect: { id: data.expenseAccountId }
      } : {
        disconnect: true
      };
    }

    return await prisma.expense.update({
      where: { id },
      data: updateData,
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
  }

  // ============================================================
  // ✅ DELETE EXPENSE
  // ============================================================
  static async delete(id) {
    return await prisma.expense.delete({
      where: { id }
    });
  }

  // ============================================================
  // ✅ GET EXPENSE SUMMARY
  // ============================================================
  static async getSummary(expenses) {
    const summary = {
      totalExpense: 0,
      totalTax: 0,
      totalCount: expenses.length,
      byType: {},
      byPaymentMethod: {},
      byStatus: {}
    };

    expenses.forEach(expense => {
      summary.totalExpense += expense.totalAmount || 0;
      summary.totalTax += expense.taxAmount || 0;

      const type = expense.expenseType || 'Other';
      if (!summary.byType[type]) {
        summary.byType[type] = { count: 0, amount: 0 };
      }
      summary.byType[type].count++;
      summary.byType[type].amount += expense.totalAmount || 0;

      const method = expense.paymentMethod || 'Cash';
      if (!summary.byPaymentMethod[method]) {
        summary.byPaymentMethod[method] = { count: 0, amount: 0 };
      }
      summary.byPaymentMethod[method].count++;
      summary.byPaymentMethod[method].amount += expense.totalAmount || 0;

      const status = expense.status || 'Draft';
      if (!summary.byStatus[status]) {
        summary.byStatus[status] = { count: 0, amount: 0 };
      }
      summary.byStatus[status].count++;
      summary.byStatus[status].amount += expense.totalAmount || 0;
    });

    return summary;
  }

  // ============================================================
  // ✅ POST EXPENSE (Draft → Posted)
  // ============================================================
  static async postExpense(id, userId) {
    const expense = await prisma.expense.findUnique({
      where: { id }
    });

    if (!expense) return null;

    if (expense.status === 'Posted') {
      throw new Error('Expense already posted');
    }

    return await prisma.expense.update({
      where: { id },
      data: {
        status: 'Posted',
        postedAt: new Date(),
        poster: {
          connect: { id: userId }
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
  }
}

module.exports = ExpenseModel;