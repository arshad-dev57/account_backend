// models/PaymentMade.js - PostgreSQL Version (Prisma)

const prisma = require('../prisma/client');

// ─── CONSTANTS ─────────────────────────────────────────────────────
const VALID_PAYMENT_METHODS = ['Bank Transfer', 'Cash', 'Cheque', 'Credit Card'];
const VALID_STATUS = ['Cleared', 'Pending'];

class PaymentMadeModel {
  // ============================================================
  // ✅ VALIDATE PAYMENT DATA
  // ============================================================
  static validatePaymentData(data) {
    const errors = [];

    // ─── Check required fields ────────────────────────────────
    if (!data.supplierId) errors.push('Supplier ID is required');
    if (!data.billId) errors.push('Bill ID is required');
    if (!data.amount || data.amount <= 0) errors.push('Amount must be greater than 0');
    if (!data.paymentMethod) errors.push('Payment method is required');

    // ─── Check valid payment method ──────────────────────────
    if (data.paymentMethod && !VALID_PAYMENT_METHODS.includes(data.paymentMethod)) {
      errors.push(`Invalid payment method. Must be one of: ${VALID_PAYMENT_METHODS.join(', ')}`);
    }

    // ─── Check valid status ────────────────────────────────────
    if (data.status && !VALID_STATUS.includes(data.status)) {
      errors.push(`Invalid status. Must be one of: ${VALID_STATUS.join(', ')}`);
    }

    return errors;
  }

  // ============================================================
  // ✅ GENERATE PAYMENT NUMBER
  // ============================================================
  static async generatePaymentNumber(userId) {
    const count = await prisma.paymentMade.count({
      where: { createdBy: userId }
    });
    const year = new Date().getFullYear();
    return `PMT-${year}-${String(count + 1).padStart(4, '0')}`;
  }

  // ============================================================
  // ✅ CREATE PAYMENT
  // ============================================================
  static async create(data) {
    // ─── Validate data ──────────────────────────────────────────
    const errors = this.validatePaymentData(data);
    if (errors.length > 0) {
      throw new Error(errors.join('; '));
    }

    // ─── Generate payment number ──────────────────────────────
    const paymentNumber = await this.generatePaymentNumber(data.createdBy);

    // ─── Create payment record ────────────────────────────────
    return await prisma.paymentMade.create({
      data: {
        paymentNumber,
        paymentDate: data.paymentDate || new Date(),
        supplierId: data.supplierId,
        supplierName: data.supplierName || '',
        billId: data.billId,
        billNumber: data.billNumber || '',
        billAmount: data.billAmount || 0,
        amount: data.amount,
        paymentMethod: data.paymentMethod,
        reference: data.reference || '',
        bankAccountId: data.bankAccountId || null,
        bankAccountName: data.bankAccountName || '',
        notes: data.notes || '',
        status: data.status || 'Pending',
        createdBy: data.createdBy
      },
      include: {
        supplier: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true
          }
        },
        bill: {
          select: {
            id: true,
            billNumber: true,
            totalAmount: true,
            paidAmount: true,
            status: true
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
  // ✅ FIND ALL PAYMENTS WITH FILTERS
  // ============================================================
  static async findAll(filter = {}, options = {}) {
    const { skip, take, orderBy = { paymentDate: 'desc' } } = options;

    return await prisma.paymentMade.findMany({
      where: filter,
      skip,
      take,
      orderBy,
      include: {
        supplier: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true
          }
        },
        bill: {
          select: {
            id: true,
            billNumber: true,
            totalAmount: true,
            paidAmount: true,
            status: true
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
  // ✅ COUNT PAYMENTS
  // ============================================================
  static async count(filter = {}) {
    return await prisma.paymentMade.count({ where: filter });
  }

  // ============================================================
  // ✅ FIND PAYMENT BY ID
  // ============================================================
  static async findById(id) {
    return await prisma.paymentMade.findUnique({
      where: { id },
      include: {
        supplier: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
            address: true
          }
        },
        bill: {
          select: {
            id: true,
            billNumber: true,
            date: true,
            dueDate: true,
            items: true,
            subtotal: true,
            taxTotal: true,
            discount: true,
            totalAmount: true,
            paidAmount: true,
            status: true,
            notes: true
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
  // ✅ FIND PAYMENT BY NUMBER
  // ============================================================
  static async findByPaymentNumber(paymentNumber, createdBy) {
    return await prisma.paymentMade.findFirst({
      where: {
        paymentNumber,
        createdBy
      },
      include: {
        supplier: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true
          }
        },
        bill: {
          select: {
            id: true,
            billNumber: true,
            totalAmount: true,
            paidAmount: true,
            status: true
          }
        }
      }
    });
  }

  // ============================================================
  // ✅ FIND PAYMENTS BY SUPPLIER
  // ============================================================
  static async findBySupplier(supplierId, createdBy) {
    return await prisma.paymentMade.findMany({
      where: {
        supplierId,
        createdBy
      },
      orderBy: { paymentDate: 'desc' },
      include: {
        bill: {
          select: {
            id: true,
            billNumber: true,
            totalAmount: true,
            paidAmount: true,
            status: true
          }
        },
        bankAccount: {
          select: {
            id: true,
            accountName: true,
            accountNumber: true,
            bankName: true
          }
        }
      }
    });
  }

  // ============================================================
  // ✅ FIND PAYMENTS BY BILL
  // ============================================================
  static async findByBill(billId, createdBy) {
    return await prisma.paymentMade.findMany({
      where: {
        billId,
        createdBy
      },
      orderBy: { paymentDate: 'desc' },
      include: {
        supplier: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true
          }
        }
      }
    });
  }

  // ============================================================
  // ✅ UPDATE PAYMENT
  // ============================================================
  static async update(id, data) {
    // ─── Get existing payment ──────────────────────────────────
    const existing = await prisma.paymentMade.findUnique({
      where: { id }
    });

    if (!existing) return null;

    // ─── Merge data for validation ─────────────────────────────
    const mergedData = { ...existing, ...data };

    // ─── Validate updated data ──────────────────────────────────
    const errors = this.validatePaymentData(mergedData);
    if (errors.length > 0) {
      throw new Error(errors.join('; '));
    }

    // ─── Update payment ──────────────────────────────────────────
    return await prisma.paymentMade.update({
      where: { id },
      data: {
        paymentDate: data.paymentDate,
        supplierId: data.supplierId,
        supplierName: data.supplierName,
        billId: data.billId,
        billNumber: data.billNumber,
        billAmount: data.billAmount,
        amount: data.amount,
        paymentMethod: data.paymentMethod,
        reference: data.reference,
        bankAccountId: data.bankAccountId,
        bankAccountName: data.bankAccountName,
        notes: data.notes,
        status: data.status
      },
      include: {
        supplier: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true
          }
        },
        bill: {
          select: {
            id: true,
            billNumber: true,
            totalAmount: true,
            paidAmount: true,
            status: true
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
  // ✅ UPDATE PAYMENT STATUS
  // ============================================================
  static async updateStatus(id, status) {
    if (!VALID_STATUS.includes(status)) {
      throw new Error(`Invalid status. Must be one of: ${VALID_STATUS.join(', ')}`);
    }

    return await prisma.paymentMade.update({
      where: { id },
      data: { status },
      include: {
        supplier: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true
          }
        },
        bill: {
          select: {
            id: true,
            billNumber: true,
            totalAmount: true,
            paidAmount: true,
            status: true
          }
        }
      }
    });
  }

  // ============================================================
  // ✅ DELETE PAYMENT
  // ============================================================
  static async delete(id) {
    return await prisma.paymentMade.delete({
      where: { id }
    });
  }

  // ============================================================
  // ✅ GET PAYMENT STATS
  // ============================================================
  static async getStats(createdBy) {
    const filter = { createdBy };

    const [total, totalAmount, cleared, pending] = await Promise.all([
      prisma.paymentMade.count({ where: filter }),
      prisma.paymentMade.aggregate({
        where: filter,
        _sum: { amount: true }
      }),
      prisma.paymentMade.count({
        where: { ...filter, status: 'Cleared' }
      }),
      prisma.paymentMade.count({
        where: { ...filter, status: 'Pending' }
      })
    ]);

    return {
      total,
      totalAmount: totalAmount._sum.amount || 0,
      cleared,
      pending
    };
  }

  // ============================================================
  // ✅ GET PAYMENTS BY METHOD
  // ============================================================
  static async getByMethod(createdBy) {
    const payments = await prisma.paymentMade.groupBy({
      by: ['paymentMethod'],
      where: { createdBy },
      _sum: { amount: true },
      _count: true
    });

    return payments.map(item => ({
      method: item.paymentMethod,
      count: item._count,
      totalAmount: item._sum.amount || 0
    }));
  }

  // ============================================================
  // ✅ SEARCH PAYMENTS
  // ============================================================
  static async search(query, createdBy, options = {}) {
    const { skip, take } = options;

    const filter = {
      createdBy,
      OR: [
        { paymentNumber: { contains: query, mode: 'insensitive' } },
        { supplierName: { contains: query, mode: 'insensitive' } },
        { billNumber: { contains: query, mode: 'insensitive' } },
        { reference: { contains: query, mode: 'insensitive' } }
      ]
    };

    const payments = await prisma.paymentMade.findMany({
      where: filter,
      skip,
      take,
      orderBy: { paymentDate: 'desc' },
      include: {
        supplier: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true
          }
        },
        bill: {
          select: {
            id: true,
            billNumber: true,
            totalAmount: true,
            paidAmount: true,
            status: true
          }
        }
      }
    });

    const total = await prisma.paymentMade.count({ where: filter });

    return { payments, total };
  }

  // ============================================================
  // ✅ GET PAYMENT SUMMARY BY PERIOD
  // ============================================================
  static async getSummaryByPeriod(createdBy, startDate, endDate) {
    const filter = {
      createdBy,
      paymentDate: {
        gte: startDate,
        lte: endDate
      }
    };

    const [total, byMethod] = await Promise.all([
      prisma.paymentMade.aggregate({
        where: filter,
        _sum: { amount: true },
        _count: true
      }),
      this.getByMethod(createdBy)
    ]);

    return {
      totalAmount: total._sum.amount || 0,
      totalCount: total._count || 0,
      byMethod
    };
  }

  // ============================================================
  // ✅ GET RECENT PAYMENTS
  // ============================================================
  static async getRecent(createdBy, limit = 10) {
    return await prisma.paymentMade.findMany({
      where: { createdBy },
      orderBy: { paymentDate: 'desc' },
      take: limit,
      include: {
        supplier: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true
          }
        },
        bill: {
          select: {
            id: true,
            billNumber: true,
            totalAmount: true,
            paidAmount: true,
            status: true
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
}

module.exports = PaymentMadeModel;