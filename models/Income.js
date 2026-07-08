// models/Income.js - PostgreSQL Version - WITH INCOME ACCOUNT

const prisma = require('../prisma/client');

// ─── CONSTANTS ─────────────────────────────────────────────────────
const VALID_INCOME_TYPES = ['Sales', 'Services', 'Interest Income', 'Rental Income', 'Dividend Income', 'Other Income'];
const VALID_STATUS = ['Draft', 'Posted', 'Cancelled'];
const VALID_PAYMENT_METHODS = ['Cash', 'Bank Transfer', 'Bank', 'Cheque', 'Credit Card', 'Online'];

class IncomeModel {
  // ============================================================
  // ✅ GENERATE INCOME NUMBER
  // ============================================================
  static async generateIncomeNumber() {
    const year = new Date().getFullYear();
    const prefix = `INC-${year}-`;

    const lastIncome = await prisma.income.findFirst({
      where: {
        incomeNumber: {
          startsWith: prefix
        }
      },
      orderBy: {
        incomeNumber: 'desc'
      }
    });

    if (!lastIncome) {
      return `${prefix}0001`;
    }

    const parts = lastIncome.incomeNumber.split('-');
    const lastNum = parseInt(parts[parts.length - 1]);
    const nextNum = lastNum + 1;

    return `${prefix}${String(nextNum).padStart(4, '0')}`;
  }

  // ============================================================
  // ✅ VALIDATE INCOME DATA
  // ============================================================
  static validateIncomeData(data) {
    const errors = [];

    if (!data.incomeType) errors.push('Income type is required');
    if (!data.date) errors.push('Date is required');

    if (data.incomeType && !VALID_INCOME_TYPES.includes(data.incomeType)) {
      errors.push(`Invalid income type. Must be one of: ${VALID_INCOME_TYPES.join(', ')}`);
    }

    if (data.status && !VALID_STATUS.includes(data.status)) {
      errors.push(`Invalid status. Must be one of: ${VALID_STATUS.join(', ')}`);
    }

    if (data.paymentMethod && !VALID_PAYMENT_METHODS.includes(data.paymentMethod)) {
      errors.push(`Invalid payment method. Must be one of: ${VALID_PAYMENT_METHODS.join(', ')}`);
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
  // ✅ CREATE INCOME
  // ============================================================
  static async create(data) {
    const errors = this.validateIncomeData(data);
    if (errors.length > 0) {
      throw new Error(errors.join('; '));
    }

    const MAX_RETRIES = 3;
    let lastError = null;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        return await this._createOnce(data);
      } catch (error) {
        const isDuplicateIncomeNumber =
          error.code === 'P2002' &&
          error.meta?.target?.includes('income_number');

        if (isDuplicateIncomeNumber && attempt < MAX_RETRIES) {
          lastError = error;
          console.warn(`⚠️ income_number collision, retrying (attempt ${attempt}/${MAX_RETRIES})...`);
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
    const incomeNumber = await this.generateIncomeNumber();

    let subtotal = 0;
    let taxAmount = 0;
    let totalAmount = 0;
    let hasItems = false;

    if (data.items && data.items.length > 0) {
      hasItems = true;
      data.items.forEach(item => {
        const itemAmount = (item.quantity || 1) * (item.unitPrice || 0);
        item.amount = itemAmount;
        subtotal += itemAmount;
      });
      taxAmount = subtotal * (data.taxRate || 0) / 100;
      totalAmount = subtotal + taxAmount;
    } else {
      subtotal = data.amount || 0;
      taxAmount = subtotal * (data.taxRate || 0) / 100;
      totalAmount = subtotal + taxAmount;
    }

    // ─── Build create data ──────────────────────────────────────
    // ✅ REMOVED: incomeAccountId direct field
    const createData = {
      incomeNumber: incomeNumber,
      date: data.date ? new Date(data.date) : new Date(),
      incomeType: data.incomeType,
      customerName: data.customerName || '',
      items: hasItems ? data.items : [],
      hasItems: hasItems,
      amount: hasItems ? 0 : (data.amount || 0),
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

    // ─── Add creator relation ──────────────────────────────────
    createData.creator = {
      connect: { id: data.createdBy }
    };

    // ─── Add poster relation ────────────────────────────────────
    const posterId = data.postedBy || data.createdBy;
    createData.poster = {
      connect: { id: posterId }
    };

    // ─── Add customer relation if customerId exists ────────────
    if (data.customerId) {
      createData.customer = {
        connect: { id: data.customerId }
      };
    }

    // ─── Add bank account relation if bankAccountId exists ──────
    if (data.bankAccountId) {
      createData.bankAccount = {
        connect: { id: data.bankAccountId }
      };
    }

    // ─── ✅ NEW: Add income account relation if incomeAccountId exists ──
    if (data.incomeAccountId) {
      createData.incomeAccount = {
        connect: { id: data.incomeAccountId }
      };
    }

    return await prisma.income.create({
      data: createData,
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
  }

  // ============================================================
  // ✅ GET ALL INCOMES
  // ============================================================
  static async findAll(filter = {}, options = {}) {
    const { skip, take, orderBy = { date: 'desc' } } = options;

    return await prisma.income.findMany({
      where: filter,
      skip,
      take,
      orderBy,
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
  }

  // ============================================================
  // ✅ COUNT INCOMES
  // ============================================================
  static async count(filter = {}) {
    return await prisma.income.count({ where: filter });
  }

  // ============================================================
  // ✅ FIND INCOME BY ID
  // ============================================================
  static async findById(id) {
    return await prisma.income.findUnique({
      where: { id },
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
  }

  // ============================================================
  // ✅ FIND INCOME BY NUMBER
  // ============================================================
  static async findByNumber(incomeNumber, createdBy) {
    return await prisma.income.findFirst({
      where: {
        incomeNumber,
        createdBy
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
        }
      }
    });
  }

  // ============================================================
  // ✅ UPDATE INCOME
  // ============================================================
  static async update(id, data) {
    const existing = await prisma.income.findUnique({
      where: { id }
    });

    if (!existing) return null;

    const errors = this.validateIncomeData({ ...existing, ...data });
    if (errors.length > 0) {
      throw new Error(errors.join('; '));
    }

    let subtotal = existing.subtotal || 0;
    let taxAmount = existing.taxAmount || 0;
    let totalAmount = existing.totalAmount || 0;
    let hasItems = existing.hasItems || false;
    let items = existing.items || [];

    if (data.items) {
      hasItems = true;
      items = data.items.map(item => ({
        description: item.description,
        quantity: item.quantity || 1,
        unitPrice: item.unitPrice || 0,
        amount: (item.quantity || 1) * (item.unitPrice || 0),
      }));
      subtotal = items.reduce((sum, item) => sum + (item.amount || 0), 0);
    } else if (data.amount !== undefined) {
      hasItems = false;
      items = [];
      subtotal = data.amount || 0;
    }

    const taxRate = data.taxRate !== undefined ? data.taxRate : existing.taxRate;
    taxAmount = subtotal * (taxRate || 0) / 100;
    totalAmount = subtotal + taxAmount;

    // ─── Build update data ──────────────────────────────────────
    const updateData = {
      date: data.date ? new Date(data.date) : existing.date,
      incomeType: data.incomeType || existing.incomeType,
      customerName: data.customerName !== undefined ? data.customerName : existing.customerName,
      items: items,
      hasItems: hasItems,
      amount: hasItems ? 0 : (data.amount || existing.amount || 0),
      subtotal: subtotal,
      taxRate: taxRate,
      taxAmount: taxAmount,
      totalAmount: totalAmount,
      description: data.description !== undefined ? data.description : existing.description,
      reference: data.reference !== undefined ? data.reference : existing.reference,
      paymentMethod: data.paymentMethod || existing.paymentMethod,
      status: data.status || existing.status,
    };

    // ─── Handle customer relation ──────────────────────────────
    if (data.customerId !== undefined) {
      if (data.customerId) {
        updateData.customer = {
          connect: { id: data.customerId }
        };
      } else {
        updateData.customer = {
          disconnect: true
        };
      }
    }

    // ─── Handle bank account relation ──────────────────────────
    if (data.bankAccountId !== undefined) {
      if (data.bankAccountId) {
        updateData.bankAccount = {
          connect: { id: data.bankAccountId }
        };
      } else {
        updateData.bankAccount = {
          disconnect: true
        };
      }
    }

    // ─── ✅ NEW: Handle income account relation ──────────────────
    if (data.incomeAccountId !== undefined) {
      if (data.incomeAccountId) {
        updateData.incomeAccount = {
          connect: { id: data.incomeAccountId }
        };
      } else {
        updateData.incomeAccount = {
          disconnect: true
        };
      }
    }

    return await prisma.income.update({
      where: { id },
      data: updateData,
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
  }

  // ============================================================
  // ✅ POST INCOME (Draft → Posted)
  // ============================================================
  static async postIncome(id, userId) {
    return await prisma.income.update({
      where: { id },
      data: {
        status: 'Posted',
        postedAt: new Date(),
        poster: {
          connect: { id: userId }
        }
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
        }
      }
    });
  }

  // ============================================================
  // ✅ DELETE INCOME
  // ============================================================
  static async delete(id) {
    const income = await prisma.income.findUnique({
      where: { id }
    });

    if (!income) return null;

    return await prisma.income.delete({
      where: { id }
    });
  }

  // ============================================================
  // ✅ GET INCOME SUMMARY
  // ============================================================
  static async getSummary(incomes) {
    const summary = {
      totalIncome: 0,
      totalTax: 0,
      count: incomes.length,
      byType: {},
      byPaymentMethod: {},
      byStatus: {
        Draft: 0,
        Posted: 0,
        Cancelled: 0
      },
      totalItems: 0
    };

    incomes.forEach(income => {
      summary.totalIncome += income.totalAmount || 0;
      summary.totalTax += income.taxAmount || 0;

      const type = income.incomeType || 'Other';
      if (!summary.byType[type]) {
        summary.byType[type] = { count: 0, total: 0 };
      }
      summary.byType[type].count++;
      summary.byType[type].total += income.totalAmount || 0;

      const method = income.paymentMethod || 'Cash';
      if (!summary.byPaymentMethod[method]) {
        summary.byPaymentMethod[method] = { count: 0, total: 0 };
      }
      summary.byPaymentMethod[method].count++;
      summary.byPaymentMethod[method].total += income.totalAmount || 0;

      const status = income.status || 'Draft';
      if (summary.byStatus[status] !== undefined) {
        summary.byStatus[status]++;
      }

      if (income.hasItems && income.items) {
        summary.totalItems += income.items.length;
      }
    });

    return summary;
  }

  // ============================================================
  // ✅ GET INCOMES BY TYPE
  // ============================================================
  static async findByType(incomeType, createdBy) {
    return await prisma.income.findMany({
      where: {
        incomeType,
        createdBy,
        status: 'Posted'
      },
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
    });
  }

  // ============================================================
  // ✅ GET INCOMES BY PAYMENT METHOD
  // ============================================================
  static async findByPaymentMethod(paymentMethod, createdBy) {
    return await prisma.income.findMany({
      where: {
        paymentMethod,
        createdBy,
        status: 'Posted'
      },
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
    });
  }

  // ============================================================
  // ✅ SEARCH INCOMES
  // ============================================================
  static async search(query, createdBy, options = {}) {
    const { skip, take } = options;

    const filter = {
      createdBy,
      OR: [
        { incomeNumber: { contains: query, mode: 'insensitive' } },
        { customerName: { contains: query, mode: 'insensitive' } },
        { description: { contains: query, mode: 'insensitive' } },
        { reference: { contains: query, mode: 'insensitive' } }
      ]
    };

    const incomes = await prisma.income.findMany({
      where: filter,
      skip,
      take,
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
    });

    const total = await prisma.income.count({ where: filter });

    return { incomes, total };
  }

  // ============================================================
  // ✅ BULK IMPORT INCOMES
  // ============================================================
  static async bulkImport(incomesData, userId) {
    const results = {
      success: [],
      failed: [],
      total: incomesData.length
    };

    for (const data of incomesData) {
      try {
        const errors = this.validateIncomeData(data);
        if (errors.length > 0) {
          results.failed.push({ ...data, error: errors.join('; ') });
          continue;
        }

        const income = await this.create({
          ...data,
          createdBy: userId,
          status: 'Posted'
        });

        results.success.push(income);
      } catch (error) {
        results.failed.push({ ...data, error: error.message });
      }
    }

    return results;
  }

  // ============================================================
  // ✅ GET TOTAL INCOME BY PERIOD
  // ============================================================
  static async getTotalByPeriod(startDate, endDate, createdBy) {
    const result = await prisma.income.aggregate({
      where: {
        createdBy,
        status: 'Posted',
        date: {
          gte: new Date(startDate),
          lte: new Date(endDate)
        }
      },
      _sum: {
        totalAmount: true,
        taxAmount: true
      },
      _count: true
    });

    return {
      totalAmount: result._sum.totalAmount || 0,
      totalTax: result._sum.taxAmount || 0,
      count: result._count || 0
    };
  }

  // ============================================================
  // ✅ GET INCOME BY DATE RANGE
  // ============================================================
  static async findByDateRange(startDate, endDate, createdBy) {
    return await prisma.income.findMany({
      where: {
        createdBy,
        status: 'Posted',
        date: {
          gte: new Date(startDate),
          lte: new Date(endDate)
        }
      },
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
    });
  }
}

module.exports = IncomeModel;