// models/Bill.js - PostgreSQL Prisma Version

const prisma = require('../prisma/client');

// ─── CONSTANTS ─────────────────────────────────────────────────────
const VALID_BILL_STATUS = ['Unpaid', 'Partial', 'Paid', 'Overdue'];

class BillModel {
  // ============================================================
  // ✅ GENERATE BILL NUMBER
  // ============================================================
  static async generateBillNumber(userId) {
    const count = await prisma.bill.count({
      where: { createdBy: userId }
    });
    const year = new Date().getFullYear();
    return `BILL-${year}-${String(count + 1).padStart(4, '0')}`;
  }

  // ============================================================
  // ✅ VALIDATE BILL DATA
  // ============================================================
  static validateBillData(data) {
    const errors = [];

    if (!data.vendorId) errors.push('Vendor ID is required');
    if (!data.vendorName) errors.push('Vendor name is required');
    if (!data.dueDate) errors.push('Due date is required');
    if (!data.items || data.items.length === 0) {
      errors.push('At least one item is required');
    }
    if (data.discount && data.discount < 0) {
      errors.push('Discount cannot be negative');
    }

    if (data.status && !VALID_BILL_STATUS.includes(data.status)) {
      errors.push(`Invalid status. Must be one of: ${VALID_BILL_STATUS.join(', ')}`);
    }

    return errors;
  }

  // ============================================================
  // ✅ DETERMINE BILL STATUS
  // ============================================================
  static determineStatus(totalAmount, paidAmount, dueDate) {
    const outstanding = totalAmount - paidAmount;
    if (outstanding <= 0) return 'Paid';
    if (paidAmount > 0 && outstanding > 0) return 'Partial';
    if (new Date(dueDate) < new Date() && outstanding > 0) return 'Overdue';
    return 'Unpaid';
  }

  // ============================================================
  // ✅ CREATE BILL
  // ============================================================
  static async create(data) {
    const errors = this.validateBillData(data);
    if (errors.length > 0) {
      throw new Error(errors.join('; '));
    }

    const billNumber = await this.generateBillNumber(data.createdBy);
    
    // Calculate totals
    let subtotal = 0;
    let taxTotal = 0;
    
    const items = data.items.map(item => {
      const amount = item.quantity * item.unitPrice;
      const taxAmount = amount * (item.taxRate || 0) / 100;
      subtotal += amount;
      taxTotal += taxAmount;
      return {
        description: item.description,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        amount: amount,
        taxRate: item.taxRate || 0,
        taxAmount: taxAmount
      };
    });

    const totalAmount = subtotal + taxTotal - (data.discount || 0);
    const status = this.determineStatus(totalAmount, 0, data.dueDate);

    return await prisma.bill.create({
      data: {
        billNumber,
        vendorId: data.vendorId,
        vendorName: data.vendorName,
        date: data.date || new Date(),
        dueDate: data.dueDate,
        items: items,
        subtotal,
        taxTotal,
        discount: data.discount || 0,
        totalAmount,
        paidAmount: 0,
        outstanding: totalAmount,
        status: status,
        notes: data.notes || '',
        posted: data.posted !== undefined ? data.posted : true,
        postedAt: data.posted !== false ? new Date() : null,
        createdBy: data.createdBy
      },
      include: {
        vendor: {
          select: { id: true, name: true, email: true, phone: true }
        },
        creator: {
          select: { id: true, firstName: true, lastName: true, email: true }
        }
      }
    });
  }

  // ============================================================
  // ✅ FIND ALL BILLS
  // ============================================================
  static async findAll(filter = {}, options = {}) {
    const { skip, take, orderBy = { date: 'desc' } } = options;
    
    return await prisma.bill.findMany({
      where: filter,
      skip,
      take,
      orderBy,
      include: {
        vendor: {
          select: { id: true, name: true, email: true, phone: true }
        },
        creator: {
          select: { id: true, firstName: true, lastName: true, email: true }
        },
        paymentsMade: {
          select: {
            id: true,
            paymentNumber: true,
            amount: true,
            paymentDate: true,
            status: true
          }
        }
      }
    });
  }

  // ============================================================
  // ✅ COUNT BILLS
  // ============================================================
  static async count(filter = {}) {
    return await prisma.bill.count({ where: filter });
  }

  // ============================================================
  // ✅ FIND BILL BY ID
  // ============================================================
  static async findById(id) {
    return await prisma.bill.findUnique({
      where: { id },
      include: {
        vendor: {
          select: { id: true, name: true, email: true, phone: true, address: true }
        },
        creator: {
          select: { id: true, firstName: true, lastName: true, email: true }
        },
        paymentsMade: {
          select: {
            id: true,
            paymentNumber: true,
            amount: true,
            paymentDate: true,
            status: true
          }
        }
      }
    });
  }

  // ============================================================
  // ✅ FIND BILL BY NUMBER
  // ============================================================
  static async findByBillNumber(billNumber, userId) {
    return await prisma.bill.findFirst({
      where: {
        billNumber,
        createdBy: userId
      },
      include: {
        vendor: {
          select: { id: true, name: true, email: true, phone: true }
        },
        paymentsMade: {
          select: {
            id: true,
            paymentNumber: true,
            amount: true,
            paymentDate: true,
            status: true
          }
        }
      }
    });
  }

  // ============================================================
  // ✅ FIND BILLS BY VENDOR
  // ============================================================
  static async findByVendor(vendorId, userId) {
    return await prisma.bill.findMany({
      where: {
        vendorId,
        createdBy: userId
      },
      orderBy: { date: 'desc' },
      include: {
        paymentsMade: {
          select: {
            id: true,
            paymentNumber: true,
            amount: true,
            paymentDate: true,
            status: true
          }
        }
      }
    });
  }

  // ============================================================
  // ✅ GET UNPAID BILLS FOR VENDOR
  // ============================================================
  static async getUnpaidBills(vendorId, userId) {
    return await prisma.bill.findMany({
      where: {
        vendorId,
        createdBy: userId,
        status: { in: ['Unpaid', 'Partial'] }
      },
      orderBy: { dueDate: 'asc' },
      include: {
        paymentsMade: {
          select: {
            id: true,
            paymentNumber: true,
            amount: true,
            paymentDate: true,
            status: true
          }
        }
      }
    });
  }

  // ============================================================
  // ✅ UPDATE BILL
  // ============================================================
  static async update(id, data) {
    const existing = await prisma.bill.findUnique({
      where: { id }
    });

    if (!existing) return null;

    // Recalculate status if amount or paidAmount changed
    let status = data.status;
    if (data.totalAmount !== undefined || data.paidAmount !== undefined) {
      const totalAmount = data.totalAmount || existing.totalAmount;
      const paidAmount = data.paidAmount || existing.paidAmount;
      const dueDate = data.dueDate || existing.dueDate;
      status = this.determineStatus(totalAmount, paidAmount, dueDate);
    }

    return await prisma.bill.update({
      where: { id },
      data: {
        ...data,
        status: data.status || status,
        updatedAt: new Date()
      },
      include: {
        vendor: {
          select: { id: true, name: true, email: true, phone: true }
        },
        creator: {
          select: { id: true, firstName: true, lastName: true, email: true }
        }
      }
    });
  }

  // ============================================================
  // ✅ UPDATE BILL STATUS
  // ============================================================
  static async updateStatus(id, status) {
    if (!VALID_BILL_STATUS.includes(status)) {
      throw new Error(`Invalid status. Must be one of: ${VALID_BILL_STATUS.join(', ')}`);
    }

    return await prisma.bill.update({
      where: { id },
      data: { status },
      include: {
        vendor: {
          select: { id: true, name: true, email: true, phone: true }
        }
      }
    });
  }

  // ============================================================
  // ✅ UPDATE BILL PAYMENT
  // ============================================================
  static async updatePayment(id, amount, userId) {
    return await prisma.$transaction(async (tx) => {
      const bill = await tx.bill.findUnique({
        where: { id }
      });

      if (!bill) return null;

      const newPaidAmount = bill.paidAmount + amount;
      const newOutstanding = bill.totalAmount - newPaidAmount;
      const newStatus = this.determineStatus(bill.totalAmount, newPaidAmount, bill.dueDate);

      return await tx.bill.update({
        where: { id },
        data: {
          paidAmount: newPaidAmount,
          outstanding: newOutstanding,
          status: newStatus,
          updatedAt: new Date()
        },
        include: {
          vendor: {
            select: { id: true, name: true, email: true, phone: true }
          }
        }
      });
    });
  }

  // ============================================================
  // ✅ DELETE BILL
  // ============================================================
  static async delete(id) {
    return await prisma.bill.delete({
      where: { id }
    });
  }

  // ============================================================
  // ✅ GET BILL STATS
  // ============================================================
  static async getStats(userId) {
    const filter = { createdBy: userId };
    
    const [total, unpaid, partial, paid, overdue, financial] = await Promise.all([
      prisma.bill.count({ where: filter }),
      prisma.bill.count({ where: { ...filter, status: 'Unpaid' } }),
      prisma.bill.count({ where: { ...filter, status: 'Partial' } }),
      prisma.bill.count({ where: { ...filter, status: 'Paid' } }),
      prisma.bill.count({ where: { ...filter, status: 'Overdue' } }),
      prisma.bill.aggregate({
        where: filter,
        _sum: { totalAmount: true, paidAmount: true, outstanding: true }
      })
    ]);

    return {
      total,
      unpaid,
      partial,
      paid,
      overdue,
      totalAmount: financial._sum.totalAmount || 0,
      paidAmount: financial._sum.paidAmount || 0,
      outstanding: financial._sum.outstanding || 0
    };
  }

  // ============================================================
  // ✅ SEARCH BILLS
  // ============================================================
  static async search(query, userId, options = {}) {
    const { skip, take } = options;

    const filter = {
      createdBy: userId,
      OR: [
        { billNumber: { contains: query, mode: 'insensitive' } },
        { vendorName: { contains: query, mode: 'insensitive' } },
        { notes: { contains: query, mode: 'insensitive' } }
      ]
    };

    const bills = await prisma.bill.findMany({
      where: filter,
      skip,
      take,
      orderBy: { date: 'desc' },
      include: {
        vendor: {
          select: { id: true, name: true, email: true, phone: true }
        },
        creator: {
          select: { id: true, firstName: true, lastName: true, email: true }
        }
      }
    });

    const total = await prisma.bill.count({ where: filter });

    return { bills, total };
  }

  // ============================================================
  // ✅ GET BILLS BY DATE RANGE
  // ============================================================
  static async getByDateRange(startDate, endDate, userId) {
    return await prisma.bill.findMany({
      where: {
        createdBy: userId,
        date: {
          gte: new Date(startDate),
          lte: new Date(endDate)
        }
      },
      orderBy: { date: 'desc' },
      include: {
        vendor: {
          select: { id: true, name: true, email: true, phone: true }
        },
        creator: {
          select: { id: true, firstName: true, lastName: true, email: true }
        }
      }
    });
  }

  // ============================================================
  // ✅ GET OVERDUE BILLS
  // ============================================================
  static async getOverdueBills(userId) {
    return await prisma.bill.findMany({
      where: {
        createdBy: userId,
        dueDate: { lt: new Date() },
        status: { in: ['Unpaid', 'Partial'] }
      },
      orderBy: { dueDate: 'asc' },
      include: {
        vendor: {
          select: { id: true, name: true, email: true, phone: true }
        }
      }
    });
  }
}

module.exports = BillModel;