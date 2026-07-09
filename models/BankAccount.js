// models/BankAccount.js - PostgreSQL Version (Prisma) - COMPLETE FIXED

const prisma = require('../prisma/client');

// ─── CONSTANTS ─────────────────────────────────────────────────────
const VALID_ACCOUNT_TYPES = ['Current', 'Savings', 'Business', 'Islamic'];
const VALID_STATUS = ['Active', 'Inactive'];

class BankAccountModel {
  // ============================================================
  // ✅ VALIDATE BANK ACCOUNT DATA
  // ============================================================
  static validateBankAccountData(data) {
    const errors = [];

    // ─── Check required fields ────────────────────────────────
    if (!data.accountName) errors.push('Account name is required');
    if (!data.accountNumber) errors.push('Account number is required');
    if (!data.bankName) errors.push('Bank name is required');
    if (!data.chartOfAccountId) errors.push('Chart of account ID is required');

    // ─── Check valid account type ──────────────────────────────
    if (data.accountType && !VALID_ACCOUNT_TYPES.includes(data.accountType)) {
      errors.push(`Invalid account type. Must be one of: ${VALID_ACCOUNT_TYPES.join(', ')}`);
    }

    // ─── Check valid status ────────────────────────────────────
    if (data.status && !VALID_STATUS.includes(data.status)) {
      errors.push(`Invalid status. Must be one of: ${VALID_STATUS.join(', ')}`);
    }

    // ─── Check opening balance sign ────────────────────────────
    if (data.openingBalance && data.openingBalance < 0) {
      errors.push('Opening balance cannot be negative');
    }

    return errors;
  }

  // ============================================================
  // ✅ GENERATE ACCOUNT CODE FOR BANK ACCOUNT
  // ============================================================
  static async generateAccountCode(userId) {
    // Find all bank accounts for this user
    const bankAccounts = await prisma.bankAccount.findMany({
      where: {
        OR: [
          { createdBy: userId },
          { userId: userId }
        ]
      },
      orderBy: {
        accountCode: 'asc'
      }
    });

    if (bankAccounts.length === 0) {
      return '1020';
    }

    // Extract codes and find max
    const codes = bankAccounts
      .map(a => parseInt(a.accountCode))
      .filter(c => !isNaN(c));
    
    if (codes.length === 0) return '1020';
    
    const maxCode = Math.max(...codes);
    return (maxCode + 1).toString();
  }

  // ============================================================
  // ✅ GENERATE ACCOUNT NUMBER (Unique)
  // ============================================================
  static async generateAccountNumber(userId) {
    const count = await prisma.bankAccount.count({
      where: {
        OR: [
          { createdBy: userId },
          { userId: userId }
        ]
      }
    });
    
    const year = new Date().getFullYear();
    const padded = String(count + 1).padStart(4, '0');
    return `BA-${year}-${padded}`;
  }

  // ============================================================
  // ✅ CREATE BANK ACCOUNT - FIXED
  // ============================================================
  static async create(data) {
    // ─── Validate data ──────────────────────────────────────────
    const errors = this.validateBankAccountData(data);
    if (errors.length > 0) {
      throw new Error(errors.join('; '));
    }

    // ─── Generate account code if not provided ─────────────────
    let accountCode = data.accountCode;
    if (!accountCode) {
      accountCode = await this.generateAccountCode(data.createdBy);
    }

    // ─── Create bank account ────────────────────────────────────
    // ✅ FIXED: Set BOTH userId AND createdBy
    return await prisma.bankAccount.create({
      data: {
        accountName: data.accountName,
        accountNumber: data.accountNumber,
        bankName: data.bankName,
        branchCode: data.branchCode || '',
        accountCode: accountCode,
        accountType: data.accountType || 'Current',
        currency: data.currency || 'PKR',
        openingBalance: data.openingBalance || 0,
        currentBalance: data.openingBalance || 0,
        status: data.status || 'Active',
        lastReconciled: data.lastReconciled || new Date(),
        chartOfAccountId: data.chartOfAccountId,
        createdBy: data.createdBy,
        userId: data.userId || data.createdBy // ✅ FIXED: Set userId as well
      },
      include: {
        chartOfAccount: {
          select: {
            id: true,
            code: true,
            name: true,
            type: true,
            currentBalance: true
          }
        },
        creator: {
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
  // ✅ GET ALL BANK ACCOUNTS WITH FILTERS - FIXED
  // ============================================================
  static async findAll(filter = {}, options = {}) {
    const { skip, take, orderBy = { createdAt: 'desc' } } = options;

    // ✅ FIXED: If filter has createdBy, also include userId
    if (filter.createdBy) {
      const userId = filter.createdBy;
      delete filter.createdBy;
      filter.OR = [
        { createdBy: userId },
        { userId: userId }
      ];
    }

    return await prisma.bankAccount.findMany({
      where: filter,
      skip,
      take,
      orderBy,
      include: {
        chartOfAccount: {
          select: {
            id: true,
            code: true,
            name: true,
            type: true,
            currentBalance: true
          }
        },
        creator: {
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
  // ✅ COUNT BANK ACCOUNTS - FIXED
  // ============================================================
  static async count(filter = {}) {
    // ✅ FIXED: If filter has createdBy, also include userId
    if (filter.createdBy) {
      const userId = filter.createdBy;
      delete filter.createdBy;
      filter.OR = [
        { createdBy: userId },
        { userId: userId }
      ];
    }
    return await prisma.bankAccount.count({ where: filter });
  }

  // ============================================================
  // ✅ FIND BANK ACCOUNT BY ID - FIXED
  // ============================================================
  static async findById(id) {
    return await prisma.bankAccount.findUnique({
      where: { id },
      include: {
        chartOfAccount: {
          select: {
            id: true,
            code: true,
            name: true,
            type: true,
            currentBalance: true
          }
        },
        creator: {
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
  // ✅ FIND BANK ACCOUNT BY ACCOUNT NUMBER - FIXED
  // ============================================================
  static async findByAccountNumber(accountNumber, userId) {
    return await prisma.bankAccount.findFirst({
      where: {
        accountNumber,
        OR: [
          { createdBy: userId },
          { userId: userId }
        ]
      },
      include: {
        chartOfAccount: {
          select: {
            id: true,
            code: true,
            name: true,
            type: true,
            currentBalance: true
          }
        }
      }
    });
  }

  // ============================================================
  // ✅ UPDATE BANK ACCOUNT
  // ============================================================
  static async update(id, data) {
    // ─── Get existing account ──────────────────────────────────
    const existing = await prisma.bankAccount.findUnique({
      where: { id }
    });

    if (!existing) return null;

    // ─── Merge data for validation ─────────────────────────────
    const mergedData = { ...existing, ...data };

    // ─── Validate updated data ──────────────────────────────────
    const errors = this.validateBankAccountData(mergedData);
    if (errors.length > 0) {
      throw new Error(errors.join('; '));
    }

    // ─── Update bank account ────────────────────────────────────
    return await prisma.bankAccount.update({
      where: { id },
      data: {
        accountName: data.accountName,
        accountNumber: data.accountNumber,
        bankName: data.bankName,
        branchCode: data.branchCode,
        accountType: data.accountType,
        currency: data.currency,
        status: data.status,
        lastReconciled: data.lastReconciled
      },
      include: {
        chartOfAccount: {
          select: {
            id: true,
            code: true,
            name: true,
            type: true,
            currentBalance: true
          }
        },
        creator: {
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
  // ✅ UPDATE BANK ACCOUNT BALANCE
  // ============================================================
  static async updateBalance(id, amount, type = 'add') {
    const account = await prisma.bankAccount.findUnique({
      where: { id }
    });

    if (!account) return null;

    let newBalance = account.currentBalance;
    const amountNum = parseFloat(amount);

    if (type === 'add' || type === 'credit') {
      newBalance += amountNum;
    } else if (type === 'subtract' || type === 'debit') {
      newBalance -= amountNum;
    } else if (type === 'set') {
      newBalance = amountNum;
    } else {
      throw new Error('Invalid type. Use: add, subtract, credit, debit, or set');
    }

    // Update bank account
    const updated = await prisma.bankAccount.update({
      where: { id },
      data: { currentBalance: newBalance }
    });

    // Update chart of account balance
    await prisma.chartOfAccount.update({
      where: { id: account.chartOfAccountId },
      data: { currentBalance: newBalance }
    });

    return updated;
  }

  // ============================================================
  // ✅ RECONCILE BANK ACCOUNT
  // ============================================================
  static async reconcile(id, statementBalance, reconciledDate) {
    const account = await prisma.bankAccount.findUnique({
      where: { id }
    });

    if (!account) return null;

    const difference = statementBalance - account.currentBalance;

    return await prisma.bankAccount.update({
      where: { id },
      data: {
        lastReconciled: reconciledDate ? new Date(reconciledDate) : new Date()
      },
      include: {
        chartOfAccount: {
          select: {
            id: true,
            code: true,
            name: true,
            type: true,
            currentBalance: true
          }
        }
      }
    });
  }

  // ============================================================
  // ✅ DELETE BANK ACCOUNT
  // ============================================================
  static async delete(id) {
    // ─── Check if account exists ──────────────────────────────
    const account = await prisma.bankAccount.findUnique({
      where: { id }
    });

    if (!account) return null;

    // ─── Delete bank account ────────────────────────────────────
    return await prisma.bankAccount.delete({
      where: { id }
    });
  }

  // ============================================================
  // ✅ GET BANK ACCOUNT SUMMARY
  // ============================================================
  static async getSummary(accounts) {
    const summary = {
      totalBalance: 0,
      byCurrency: {},
      byType: {},
      activeCount: 0,
      inactiveCount: 0
    };

    accounts.forEach(account => {
      // Total balance
      summary.totalBalance += account.currentBalance || 0;

      // By currency
      const currency = account.currency || 'PKR';
      if (!summary.byCurrency[currency]) {
        summary.byCurrency[currency] = { count: 0, balance: 0 };
      }
      summary.byCurrency[currency].count++;
      summary.byCurrency[currency].balance += account.currentBalance || 0;

      // By type
      const type = account.accountType || 'Current';
      if (!summary.byType[type]) {
        summary.byType[type] = { count: 0, balance: 0 };
      }
      summary.byType[type].count++;
      summary.byType[type].balance += account.currentBalance || 0;

      // By status
      if (account.status === 'Active') {
        summary.activeCount++;
      } else {
        summary.inactiveCount++;
      }
    });

    return summary;
  }

  // ============================================================
  // ✅ GET BANK ACCOUNTS BY TYPE - FIXED
  // ============================================================
  static async findByType(accountType, userId) {
    return await prisma.bankAccount.findMany({
      where: {
        accountType,
        status: 'Active',
        OR: [
          { createdBy: userId },
          { userId: userId }
        ]
      },
      orderBy: { accountName: 'asc' },
      include: {
        chartOfAccount: {
          select: {
            id: true,
            code: true,
            name: true,
            type: true,
            currentBalance: true
          }
        }
      }
    });
  }

  // ============================================================
  // ✅ GET BANK ACCOUNTS BY STATUS - FIXED
  // ============================================================
  static async findByStatus(status, userId) {
    return await prisma.bankAccount.findMany({
      where: {
        status,
        OR: [
          { createdBy: userId },
          { userId: userId }
        ]
      },
      orderBy: { accountName: 'asc' },
      include: {
        chartOfAccount: {
          select: {
            id: true,
            code: true,
            name: true,
            type: true,
            currentBalance: true
          }
        }
      }
    });
  }

  // ============================================================
  // ✅ SEARCH BANK ACCOUNTS - FIXED
  // ============================================================
  static async search(query, userId, options = {}) {
    const { skip, take } = options;

    const filter = {
      OR: [
        { createdBy: userId },
        { userId: userId }
      ],
      AND: {
        OR: [
          { accountName: { contains: query, mode: 'insensitive' } },
          { accountNumber: { contains: query, mode: 'insensitive' } },
          { bankName: { contains: query, mode: 'insensitive' } },
          { accountCode: { contains: query, mode: 'insensitive' } }
        ]
      }
    };

    const accounts = await prisma.bankAccount.findMany({
      where: filter,
      skip,
      take,
      orderBy: { accountName: 'asc' },
      include: {
        chartOfAccount: {
          select: {
            id: true,
            code: true,
            name: true,
            type: true,
            currentBalance: true
          }
        },
        creator: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true
          }
        }
      }
    });

    const total = await prisma.bankAccount.count({ where: filter });

    return { accounts, total };
  }

  // ============================================================
  // ✅ GET BANK ACCOUNT TRANSACTIONS
  // ============================================================
  static async getTransactions(accountId, options = {}) {
    const { startDate, endDate, skip, take } = options;

    // Get chart of account ID
    const bankAccount = await prisma.bankAccount.findUnique({
      where: { id: accountId }
    });

    if (!bankAccount) return null;

    const whereClause = {
      accountId: bankAccount.chartOfAccountId,
      journal: {
        status: 'Posted'
      }
    };

    if (startDate && endDate) {
      whereClause.journal.date = {
        gte: new Date(startDate),
        lte: new Date(endDate)
      };
    }

    const transactions = await prisma.journalLine.findMany({
      where: whereClause,
      include: {
        journal: {
          select: {
            entryNumber: true,
            date: true,
            description: true,
            reference: true
          }
        }
      },
      orderBy: {
        journal: {
          date: 'desc'
        }
      },
      skip,
      take
    });

    const total = await prisma.journalLine.count({
      where: whereClause
    });

    return { transactions, total };
  }

  // ============================================================
  // ✅ BULK IMPORT BANK ACCOUNTS - FIXED
  // ============================================================
  static async bulkImport(accountsData, userId) {
    const results = {
      success: [],
      failed: [],
      total: accountsData.length
    };

    for (const data of accountsData) {
      try {
        // Validate each account
        const errors = this.validateBankAccountData(data);
        if (errors.length > 0) {
          results.failed.push({ ...data, error: errors.join('; ') });
          continue;
        }

        // Check duplicate account number
        const existing = await prisma.bankAccount.findFirst({
          where: {
            accountNumber: data.accountNumber,
            OR: [
              { createdBy: userId },
              { userId: userId }
            ]
          }
        });

        if (existing) {
          results.failed.push({
            ...data,
            error: `Account number "${data.accountNumber}" already exists`
          });
          continue;
        }

        // Create account
        const account = await this.create({
          ...data,
          createdBy: userId,
          userId: userId // ✅ FIXED: Explicitly set userId
        });

        results.success.push(account);
      } catch (error) {
        results.failed.push({ ...data, error: error.message });
      }
    }

    return results;
  }

  // ============================================================
  // ✅ GET TOTAL BALANCE BY CURRENCY - FIXED
  // ============================================================
  static async getBalanceByCurrency(userId) {
    const accounts = await prisma.bankAccount.findMany({
      where: {
        status: 'Active',
        OR: [
          { createdBy: userId },
          { userId: userId }
        ]
      }
    });

    const balanceByCurrency = {};
    accounts.forEach(account => {
      const currency = account.currency || 'PKR';
      if (!balanceByCurrency[currency]) {
        balanceByCurrency[currency] = 0;
      }
      balanceByCurrency[currency] += account.currentBalance || 0;
    });

    return balanceByCurrency;
  }

  // ============================================================
  // ✅ GET BANK ACCOUNT WITH LATEST TRANSACTIONS
  // ============================================================
  static async getWithLatestTransactions(accountId, limit = 5) {
    const bankAccount = await this.findById(accountId);

    if (!bankAccount) return null;

    const transactions = await this.getTransactions(accountId, {
      take: limit
    });

    return {
      ...bankAccount,
      recentTransactions: transactions.transactions
    };
  }
}

module.exports = BankAccountModel;