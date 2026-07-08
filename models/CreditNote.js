const prisma = require('../prisma/client');

// ─── CONSTANTS ─────────────────────────────────────────────────────
const VALID_REASON_TYPES = ['Return', 'Refund', 'Discount', 'Adjustment'];
const VALID_STATUS = ['Issued', 'Applied', 'Expired', 'PartiallyApplied'];

class CreditNoteModel {
  // ============================================================
  // ✅ VALIDATE CREDIT NOTE DATA
  // ============================================================
  static validateCreditNoteData(data) {
    const errors = [];

    if (!data.customerId) errors.push('Customer ID is required');
    if (!data.originalInvoiceId) errors.push('Original invoice ID is required');
    if (!data.amount || data.amount <= 0) errors.push('Amount must be greater than 0');
    if (!data.reason) errors.push('Reason is required');
    if (!data.reasonType) errors.push('Reason type is required');

    if (data.reasonType && !VALID_REASON_TYPES.includes(data.reasonType)) {
      errors.push(`Invalid reason type. Must be one of: ${VALID_REASON_TYPES.join(', ')}`);
    }

    if (data.status && !VALID_STATUS.includes(data.status)) {
      errors.push(`Invalid status. Must be one of: ${VALID_STATUS.join(', ')}`);
    }

    return errors;
  }

  // ============================================================
  // ✅ GENERATE CREDIT NOTE NUMBER
  // ============================================================
  static async generateCreditNoteNumber(userId) {
    const count = await prisma.creditNote.count({
      where: { createdBy: userId }
    });
    const year = new Date().getFullYear();
    return `CN-${year}-${String(count + 1).padStart(4, '0')}`;
  }

  // ============================================================
  // ✅ CREATE CREDIT NOTE
  // ============================================================
  static async create(data) {
    const errors = this.validateCreditNoteData(data);
    if (errors.length > 0) {
      throw new Error(errors.join('; '));
    }

    const creditNumber = await this.generateCreditNoteNumber(data.createdBy);
    const expiryDate = data.expiryDate || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    try {
      // ✅ Verify invoice exists
      const invoiceExists = await prisma.warehouseInvoice.findUnique({
        where: { id: data.originalInvoiceId }
      });

      if (!invoiceExists) {
        throw new Error(`Invoice with ID ${data.originalInvoiceId} does not exist`);
      }

      return await prisma.creditNote.create({
        data: {
          creditNumber,
          date: data.date || new Date(),
          customerId: data.customerId,
          customerName: data.customerName || '',
          originalInvoiceId: data.originalInvoiceId,
          originalInvoiceNumber: data.originalInvoiceNumber || '',
          originalInvoiceAmount: data.originalInvoiceAmount || 0,
          amount: data.amount,
          reason: data.reason,
          reasonType: data.reasonType,
          items: data.items || [],
          status: 'Issued',
          appliedAmount: 0,
          remainingAmount: data.amount,
          expiryDate: expiryDate,
          notes: data.notes || '',
          createdBy: data.createdBy
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
          originalInvoice: {
            select: {
              id: true,
              invoiceNumber: true,
              grandTotal: true,        // ✅ totalAmount → grandTotal
              paidAmount: true,
              outstanding: true,
              invoiceStatus: true,
              paymentStatus: true
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
    } catch (error) {
      console.error('❌ [CN] Create error:', error);
      if (error.code === 'P2003') {
        throw new Error('Invalid invoice ID. Please select a valid warehouse invoice.');
      }
      throw error;
    }
  }

  // ============================================================
  // ✅ FIND ALL CREDIT NOTES WITH FILTERS
  // ============================================================
  static async findAll(filter = {}, options = {}) {
    const { skip, take, orderBy = { date: 'desc' } } = options;

    return await prisma.creditNote.findMany({
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
        originalInvoice: {
          select: {
            id: true,
            invoiceNumber: true,
            grandTotal: true,        // ✅ totalAmount → grandTotal
            paidAmount: true,
            outstanding: true,
            invoiceStatus: true,
            paymentStatus: true
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
  // ✅ COUNT CREDIT NOTES
  // ============================================================
  static async count(filter = {}) {
    return await prisma.creditNote.count({ where: filter });
  }

  // ============================================================
  // ✅ FIND CREDIT NOTE BY ID
  // ============================================================
  static async findById(id) {
    return await prisma.creditNote.findUnique({
      where: { id },
      include: {
        customer: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
            address: true
          }
        },
        originalInvoice: {
          select: {
            id: true,
            invoiceNumber: true,
            invoiceDate: true,
            dueDate: true,
            items: true,
            subtotal: true,
            taxTotal: true,
            discountTotal: true,
            grandTotal: true,        // ✅ totalAmount → grandTotal
            paidAmount: true,
            outstanding: true,
            invoiceStatus: true,
            paymentStatus: true
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
  // ✅ FIND BY CREDIT NUMBER
  // ============================================================
  static async findByCreditNumber(creditNumber, createdBy) {
    return await prisma.creditNote.findFirst({
      where: {
        creditNumber,
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
        originalInvoice: {
          select: {
            id: true,
            invoiceNumber: true,
            grandTotal: true,        // ✅ totalAmount → grandTotal
            paidAmount: true,
            outstanding: true,
            invoiceStatus: true,
            paymentStatus: true
          }
        }
      }
    });
  }

  // ============================================================
  // ✅ FIND BY CUSTOMER
  // ============================================================
  static async findByCustomer(customerId, createdBy) {
    return await prisma.creditNote.findMany({
      where: {
        customerId,
        createdBy
      },
      orderBy: { date: 'desc' },
      include: {
        originalInvoice: {
          select: {
            id: true,
            invoiceNumber: true,
            grandTotal: true,        // ✅ totalAmount → grandTotal
            paidAmount: true,
            outstanding: true,
            invoiceStatus: true,
            paymentStatus: true
          }
        }
      }
    });
  }

  // ============================================================
  // ✅ UPDATE CREDIT NOTE
  // ============================================================
  static async update(id, data) {
    const existing = await prisma.creditNote.findUnique({
      where: { id }
    });

    if (!existing) return null;

    const mergedData = { ...existing, ...data };
    const errors = this.validateCreditNoteData(mergedData);
    if (errors.length > 0) {
      throw new Error(errors.join('; '));
    }

    return await prisma.creditNote.update({
      where: { id },
      data: {
        date: data.date,
        customerId: data.customerId,
        customerName: data.customerName,
        originalInvoiceId: data.originalInvoiceId,
        originalInvoiceNumber: data.originalInvoiceNumber,
        originalInvoiceAmount: data.originalInvoiceAmount,
        amount: data.amount,
        reason: data.reason,
        reasonType: data.reasonType,
        items: data.items,
        status: data.status,
        appliedAmount: data.appliedAmount,
        remainingAmount: data.remainingAmount,
        expiryDate: data.expiryDate,
        notes: data.notes
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
        originalInvoice: {
          select: {
            id: true,
            invoiceNumber: true,
            grandTotal: true,        // ✅ totalAmount → grandTotal
            paidAmount: true,
            outstanding: true,
            invoiceStatus: true,
            paymentStatus: true
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
  // ✅ UPDATE STATUS
  // ============================================================
  static async updateStatus(id, status) {
    if (!VALID_STATUS.includes(status)) {
      throw new Error(`Invalid status. Must be one of: ${VALID_STATUS.join(', ')}`);
    }

    return await prisma.creditNote.update({
      where: { id },
      data: { status },
      include: {
        customer: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true
          }
        },
        originalInvoice: {
          select: {
            id: true,
            invoiceNumber: true,
            grandTotal: true,        // ✅ totalAmount → grandTotal
            paidAmount: true,
            outstanding: true,
            invoiceStatus: true,
            paymentStatus: true
          }
        }
      }
    });
  }

  // ============================================================
  // ✅ DELETE CREDIT NOTE
  // ============================================================
  static async delete(id) {
    return await prisma.creditNote.delete({
      where: { id }
    });
  }

  // ============================================================
  // ✅ GET STATS
  // ============================================================
  static async getStats(createdBy) {
    const filter = { createdBy };

    const [total, totalAmount, issued, applied, expired] = await Promise.all([
      prisma.creditNote.count({ where: filter }),
      prisma.creditNote.aggregate({
        where: filter,
        _sum: { amount: true }
      }),
      prisma.creditNote.count({
        where: { ...filter, status: 'Issued' }
      }),
      prisma.creditNote.count({
        where: { ...filter, status: 'Applied' }
      }),
      prisma.creditNote.count({
        where: { ...filter, status: 'Expired' }
      })
    ]);

    return {
      total,
      totalAmount: totalAmount._sum.amount || 0,
      issued,
      applied,
      expired
    };
  }

  // ============================================================
  // ✅ SEARCH CREDIT NOTES
  // ============================================================
  static async search(query, createdBy, options = {}) {
    const { skip, take } = options;

    const filter = {
      createdBy,
      OR: [
        { creditNumber: { contains: query, mode: 'insensitive' } },
        { customerName: { contains: query, mode: 'insensitive' } },
        { originalInvoiceNumber: { contains: query, mode: 'insensitive' } },
        { reason: { contains: query, mode: 'insensitive' } }
      ]
    };

    const creditNotes = await prisma.creditNote.findMany({
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
        originalInvoice: {
          select: {
            id: true,
            invoiceNumber: true,
            grandTotal: true,        // ✅ totalAmount → grandTotal
            paidAmount: true,
            outstanding: true,
            invoiceStatus: true,
            paymentStatus: true
          }
        }
      }
    });

    const total = await prisma.creditNote.count({ where: filter });

    return { creditNotes, total };
  }

  // ============================================================
  // ✅ GET SUMMARY BY PERIOD
  // ============================================================
  static async getSummaryByPeriod(createdBy, startDate, endDate) {
    const filter = {
      createdBy,
      date: {
        gte: startDate,
        lte: endDate
      }
    };

    const [total, byStatus] = await Promise.all([
      prisma.creditNote.aggregate({
        where: filter,
        _sum: { amount: true },
        _count: true
      }),
      prisma.creditNote.groupBy({
        by: ['status'],
        where: filter,
        _sum: { amount: true },
        _count: true
      })
    ]);

    return {
      totalAmount: total._sum.amount || 0,
      totalCount: total._count || 0,
      byStatus
    };
  }

  // ============================================================
  // ✅ GET RECENT CREDIT NOTES
  // ============================================================
  static async getRecent(createdBy, limit = 10) {
    return await prisma.creditNote.findMany({
      where: { createdBy },
      orderBy: { date: 'desc' },
      take: limit,
      include: {
        customer: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true
          }
        },
        originalInvoice: {
          select: {
            id: true,
            invoiceNumber: true,
            grandTotal: true,        // ✅ totalAmount → grandTotal
            paidAmount: true,
            outstanding: true,
            invoiceStatus: true,
            paymentStatus: true
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

module.exports = CreditNoteModel;