// models/Transaction.js - FIXED (Remove isActive and isDeleted)

const prisma = require('../prisma/client');

// ─── Generate Transaction Number ──────────────────────────────
function generateTransactionNumber(type) {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  const prefix = type === 'income' ? 'INC' : type === 'expense' ? 'EXP' : 'TRX';
  return `${prefix}-${year}${month}${day}-${random}`;
}

// ─── Helper: Find or Create Income/Expense Account ────────────
async function getOrCreateAccount(tx, userId, type, category) {
  let accountCode = type === 'income' ? '4000' : '5000';
  let accountName = type === 'income' ? 'Income' : 'Expenses';
  
  const categoryMap = {
    income: {
      'Sales': { code: '4100', name: 'Sales Revenue' },
      'Services': { code: '4200', name: 'Service Revenue' },
      'Consulting': { code: '4300', name: 'Consulting Revenue' },
      'Interest': { code: '4400', name: 'Interest Income' },
      'Rental': { code: '4500', name: 'Rental Income' },
      'Dividend': { code: '4600', name: 'Dividend Income' },
      'Receipt': { code: '4700', name: 'Receipt Income' },
    },
    expense: {
      'Rent': { code: '5100', name: 'Rent Expense' },
      'Salaries': { code: '5200', name: 'Salaries Expense' },
      'Utilities': { code: '5300', name: 'Utilities Expense' },
      'Office Supplies': { code: '5400', name: 'Office Supplies Expense' },
      'Marketing': { code: '5500', name: 'Marketing Expense' },
      'Travel': { code: '5600', name: 'Travel Expense' },
      'Meals': { code: '5700', name: 'Meals & Entertainment' },
      'Software': { code: '5800', name: 'Software Expense' },
      'Equipment': { code: '5900', name: 'Equipment Expense' },
      'Payment': { code: '6000', name: 'Payment Expense' },
    }
  };
  
  if (categoryMap[type] && categoryMap[type][category]) {
    accountCode = categoryMap[type][category].code;
    accountName = categoryMap[type][category].name;
  }
  
  let account = await tx.chartOfAccount.findFirst({
    where: {
      code: accountCode,
      OR: [
        { createdBy: userId },
        { userId: userId }
      ]
    }
  });
  
  if (!account) {
    account = await tx.chartOfAccount.create({
      data: {
        code: accountCode,
        name: accountName,
        type: type === 'income' ? 'Income' : 'Expenses',
        parentAccount: type === 'income' ? 'Operating Income' : 'Operating Expenses',
        openingBalance: 0,
        currentBalance: 0,
        description: `${category} account`,
        taxCode: 'N/A',
        balanceType: type === 'income' ? 'Credit' : 'Debit',
        isActive: true,
        createdBy: userId,
        userId: userId
      }
    });
  }
  return account;
}

// ─── Helper: Find or Create Cash Account ──────────────────────
async function getOrCreateCashAccount(tx, userId) {
  let cashAccount = await tx.chartOfAccount.findFirst({
    where: {
      code: '1010',
      OR: [
        { createdBy: userId },
        { userId: userId }
      ]
    }
  });
  
  if (!cashAccount) {
    const existingCode = await tx.chartOfAccount.findFirst({
      where: { code: '1010' }
    });
    
    let newCode = '1010';
    if (existingCode) {
      let counter = 1;
      while (await tx.chartOfAccount.findFirst({ 
        where: { 
          code: `101${counter}`,
          OR: [
            { createdBy: userId },
            { userId: userId }
          ]
        }
      })) {
        counter++;
        newCode = `101${counter}`;
      }
    }
    
    cashAccount = await tx.chartOfAccount.create({
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
        createdBy: userId,
        userId: userId
      }
    });
  }
  return cashAccount;
}

// ─── Helper: Get Bank Account's Chart of Account ──────────────
async function getBankChartOfAccount(tx, bankAccountId, userId) {
  const bankAccount = await tx.bankAccount.findFirst({
    where: {
      id: bankAccountId,
      OR: [
        { createdBy: userId },
        { userId: userId }
      ]
    }
  });
  
  if (!bankAccount) return null;
  
  return await tx.chartOfAccount.findFirst({
    where: {
      id: bankAccount.chartOfAccountId,
      OR: [
        { createdBy: userId },
        { userId: userId }
      ]
    }
  });
}

class TransactionModel {
  // ============================================================
  // CREATE TRANSACTION
  // ============================================================
  static async createTransaction(data) {
    return await prisma.$transaction(async (tx) => {
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
        bankAccountId,
        userId,
        createdBy
      } = data;

      if (!type || !title || !amount || !category) {
        throw new Error('Type, title, amount and category are required');
      }

      if (amount <= 0) {
        throw new Error('Amount must be greater than 0');
      }

      let customerName = '';
      if (customerId) {
        const customer = await tx.customer.findFirst({
          where: {
            id: customerId,
            userId: userId,
            isActive: true,
            isDeleted: false
          }
        });
        if (!customer) {
          throw new Error('Customer not found');
        }
        customerName = customer.name;
      }

      let vendorName = '';
      if (vendorId) {
        const vendor = await tx.supplier.findFirst({
          where: {
            id: vendorId,
            userId: userId,
            status: 'active'
          }
        });
        if (!vendor) {
          throw new Error('Vendor not found');
        }
        vendorName = vendor.name;
      }

      if (bankAccountId) {
        const bankAccount = await tx.bankAccount.findFirst({
          where: {
            id: bankAccountId,
            OR: [
              { createdBy: userId },
              { userId: userId }
            ]
          }
        });
        if (!bankAccount) {
          throw new Error('Bank account not found');
        }
      }

      const transactionNumber = generateTransactionNumber(type);

      const incomeExpenseAccount = await getOrCreateAccount(tx, userId, type, category);
      
      let cashOrBankAccount;
      if (paymentMethod === 'Cash') {
        cashOrBankAccount = await getOrCreateCashAccount(tx, userId);
      } else if (bankAccountId) {
        cashOrBankAccount = await getBankChartOfAccount(tx, bankAccountId, userId);
        if (!cashOrBankAccount) {
          cashOrBankAccount = await getOrCreateCashAccount(tx, userId);
        }
      } else {
        cashOrBankAccount = await getOrCreateCashAccount(tx, userId);
      }

      const entryNumber = `JE-${Date.now()}-${Math.floor(Math.random() * 10000)}`;

      let journalLines;
      if (type === 'income') {
        journalLines = [
          {
            accountId: cashOrBankAccount.id,
            accountName: cashOrBankAccount.name,
            accountCode: cashOrBankAccount.code,
            debit: amount,
            credit: 0
          },
          {
            accountId: incomeExpenseAccount.id,
            accountName: incomeExpenseAccount.name,
            accountCode: incomeExpenseAccount.code,
            debit: 0,
            credit: amount
          }
        ];
      } else {
        journalLines = [
          {
            accountId: incomeExpenseAccount.id,
            accountName: incomeExpenseAccount.name,
            accountCode: incomeExpenseAccount.code,
            debit: amount,
            credit: 0
          },
          {
            accountId: cashOrBankAccount.id,
            accountName: cashOrBankAccount.name,
            accountCode: cashOrBankAccount.code,
            debit: 0,
            credit: amount
          }
        ];
      }

      const journalEntry = await tx.journalEntry.create({
        data: {
          entryNumber,
          date: date || new Date(),
          description: description || `${title} - ${transactionNumber}`,
          reference: reference || transactionNumber,
          status: 'Posted',
          createdBy: createdBy,
          postedBy: createdBy,
          postedAt: new Date(),
          userId: userId,
          lines: {
            create: journalLines
          }
        }
      });

      if (bankAccountId) {
        await tx.bankAccount.update({
          where: { id: bankAccountId },
          data: {
            currentBalance: type === 'income' 
              ? { increment: amount }
              : { decrement: amount }
          }
        });
      }

      await tx.chartOfAccount.update({
        where: { id: cashOrBankAccount.id },
        data: {
          currentBalance: type === 'income'
            ? { increment: amount }
            : { decrement: amount }
        }
      });

      await tx.chartOfAccount.update({
        where: { id: incomeExpenseAccount.id },
        data: {
          currentBalance: type === 'income'
            ? { increment: amount }
            : { increment: amount }
        }
      });

      // ✅ FIXED: Removed isActive and isDeleted
      const transaction = await tx.transaction.create({
        data: {
          transactionNumber,
          date: date || new Date(),
          type,
          title,
          description: description || '',
          amount,
          category,
          paymentMethod: paymentMethod || 'Cash',
          reference: reference || '',
          customerId: customerId || null,
          customerName,
          vendorId: vendorId || null,
          vendorName,
          bankAccountId: bankAccountId || null,
          status: 'Posted',
          createdBy,
          postedBy: createdBy,
          postedAt: new Date(),
          journalEntryId: journalEntry.id
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

      return transaction;
    });
  }

  // ============================================================
  // GET TRANSACTION BY ID
  // ============================================================
  static async findById(id) {
    return await prisma.transaction.findUnique({
      where: { id },
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
  }

  // ============================================================
  // GET TRANSACTION BY NUMBER
  // ============================================================
  static async findByTransactionNumber(transactionNumber) {
    return await prisma.transaction.findUnique({
      where: { transactionNumber },
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
  }

  // ============================================================
  // GET ALL TRANSACTIONS WITH FILTERS
  // ============================================================
  static async findAll(filter = {}, options = {}) {
    const { skip, take, orderBy = { date: 'desc' } } = options;

    // ✅ FIXED: Removed isActive and isDeleted filters
    return await prisma.transaction.findMany({
      where: filter,
      skip,
      take,
      orderBy,
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
  }

  // ============================================================
  // COUNT TRANSACTIONS
  // ============================================================
  static async count(filter = {}) {
    return await prisma.transaction.count({
      where: filter
    });
  }

  // ============================================================
  // GET TRANSACTION SUMMARY
  // ============================================================
  static async getSummary(userId, filter = {}) {
    // ✅ FIXED: Removed isActive and isDeleted
    const baseFilter = {
      createdBy: userId,
      ...filter
    };

    const [income, expense] = await Promise.all([
      prisma.transaction.aggregate({
        where: {
          ...baseFilter,
          type: 'income'
        },
        _sum: { amount: true }
      }),
      prisma.transaction.aggregate({
        where: {
          ...baseFilter,
          type: 'expense'
        },
        _sum: { amount: true }
      })
    ]);

    return {
      totalIncome: income._sum.amount || 0,
      totalExpense: expense._sum.amount || 0,
      netCashFlow: (income._sum.amount || 0) - (expense._sum.amount || 0)
    };
  }

  // ============================================================
  // GET TRANSACTION STATS
  // ============================================================
  static async getStats(userId) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);

    // ✅ FIXED: Removed isActive and isDeleted
    const baseFilter = {
      createdBy: userId
    };

    const todayIncome = await prisma.transaction.aggregate({
      where: {
        ...baseFilter,
        date: { gte: today },
        type: 'income'
      },
      _sum: { amount: true }
    });

    const todayExpense = await prisma.transaction.aggregate({
      where: {
        ...baseFilter,
        date: { gte: today },
        type: 'expense'
      },
      _sum: { amount: true }
    });

    const monthIncome = await prisma.transaction.aggregate({
      where: {
        ...baseFilter,
        date: { gte: startOfMonth },
        type: 'income'
      },
      _sum: { amount: true }
    });

    const monthExpense = await prisma.transaction.aggregate({
      where: {
        ...baseFilter,
        date: { gte: startOfMonth },
        type: 'expense'
      },
      _sum: { amount: true }
    });

    return {
      today: {
        income: todayIncome._sum.amount || 0,
        expense: todayExpense._sum.amount || 0,
        net: (todayIncome._sum.amount || 0) - (todayExpense._sum.amount || 0)
      },
      month: {
        income: monthIncome._sum.amount || 0,
        expense: monthExpense._sum.amount || 0,
        net: (monthIncome._sum.amount || 0) - (monthExpense._sum.amount || 0)
      }
    };
  }

  // ============================================================
  // UPDATE TRANSACTION
  // ============================================================
  static async updateTransaction(id, data, userId) {
    return await prisma.$transaction(async (tx) => {
      const existing = await tx.transaction.findFirst({
        where: {
          id: id,
          createdBy: userId
        }
      });

      if (!existing) {
        throw new Error('Transaction not found');
      }

      if (existing.status === 'Posted') {
        throw new Error('Cannot update posted transaction');
      }

      if (data.customerId) {
        const customer = await tx.customer.findFirst({
          where: {
            id: data.customerId,
            userId: userId,
            isActive: true,
            isDeleted: false
          }
        });
        if (!customer) {
          throw new Error('Customer not found');
        }
      }

      if (data.vendorId) {
        const vendor = await tx.supplier.findFirst({
          where: {
            id: data.vendorId,
            userId: userId,
            status: 'active'
          }
        });
        if (!vendor) {
          throw new Error('Vendor not found');
        }
      }

      if (data.bankAccountId) {
        const bankAccount = await tx.bankAccount.findFirst({
          where: {
            id: data.bankAccountId,
            OR: [
              { createdBy: userId },
              { userId: userId }
            ]
          }
        });
        if (!bankAccount) {
          throw new Error('Bank account not found');
        }
      }

      // ✅ FIXED: Removed isActive and isDeleted from update
      const updated = await tx.transaction.update({
        where: { id },
        data: {
          date: data.date,
          title: data.title,
          description: data.description,
          amount: data.amount,
          category: data.category,
          paymentMethod: data.paymentMethod,
          reference: data.reference,
          customerId: data.customerId,
          vendorId: data.vendorId,
          bankAccountId: data.bankAccountId
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

      return updated;
    });
  }

  // ============================================================
  // DELETE TRANSACTION
  // ============================================================
  static async deleteTransaction(id, userId) {
    return await prisma.$transaction(async (tx) => {
      const transaction = await tx.transaction.findFirst({
        where: {
          id: id,
          createdBy: userId
        }
      });

      if (!transaction) {
        throw new Error('Transaction not found');
      }

      if (transaction.status === 'Posted') {
        throw new Error('Cannot delete posted transaction');
      }

      // ✅ FIXED: Soft delete using status instead of isDeleted
      const deleted = await tx.transaction.update({
        where: { id },
        data: {
          status: 'Cancelled'
        }
      });

      return deleted;
    });
  }

  // ============================================================
  // GET CATEGORIES
  // ============================================================
  static getCategories() {
    const incomeCategories = [
      'Sales', 'Services', 'Consulting', 'Interest', 'Rental', 'Dividend', 'Receipt', 'Other'
    ];
    
    const expenseCategories = [
      'Rent', 'Salaries', 'Utilities', 'Office Supplies', 'Marketing', 
      'Travel', 'Meals', 'Software', 'Equipment', 'Payment', 'Other'
    ];
    
    return {
      income: incomeCategories,
      expense: expenseCategories
    };
  }
}

module.exports = TransactionModel;