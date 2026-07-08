// models/Refund.js - COMPLETE WITH SALES & PURCHASE REFUND SUPPORT

const prisma = require('../../prisma/client');

// ─── Generate Refund Number Function ──────────────────────
function generateRefundNumber(refundType) {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  
  let prefix = 'REF';
  if (refundType === 'Sales Refund') prefix = 'SRF';
  else if (refundType === 'Purchase Refund') prefix = 'PRF';
  
  return `${prefix}-${year}${month}${day}-${random}`;
}

class RefundModel {
  // ============================================================
  // CREATE REFUND (Sales or Purchase)
  // ============================================================
  static async create(data) {
    const refundNumber = generateRefundNumber(data.refundType || 'Sales Refund');
    
    return await prisma.refund.create({
      data: {
        refundNumber,
        refundDate: new Date(),
        // Order fields (for Sales Refund)
        orderId: data.orderId || null,
        orderNumber: data.orderNumber || '',
        // Purchase fields (for Purchase Refund)
        purchaseId: data.purchaseId || null,
        purchaseNumber: data.purchaseNumber || '',
        // Customer fields (for Sales Refund)
        customerId: data.customerId || null,
        customerName: data.customerName || '',
        customerEmail: data.customerEmail || '',
        customerPhone: data.customerPhone || '',
        // Supplier fields (for Purchase Refund)
        supplierId: data.supplierId || null,
        supplierName: data.supplierName || '',
        supplierEmail: data.supplierEmail || '',
        supplierPhone: data.supplierPhone || '',
        // Return reference
        returnId: data.returnId || null,
        returnNumber: data.returnNumber || '',
        // Financial
        amount: data.amount,
        refundStatus: data.refundStatus || 'Pending',
        refundMethod: data.refundMethod || 'Original Payment',
        refundType: data.refundType || 'Sales Refund', // ✅ Sales Refund or Purchase Refund
        reason: data.reason,
        notes: data.notes || '',
        referenceNumber: data.referenceNumber || '',
        bankName: data.bankName || '',
        accountNumber: data.accountNumber || '',
        accountHolderName: data.accountHolderName || '',
        attachments: data.attachments || [],
        createdBy: data.createdBy,
        updatedBy: data.createdBy,
        userId: data.userId // 👈 Multi-tenant support
      },
      include: {
        creator: {
          select: { id: true, firstName: true, lastName: true, email: true }
        },
        order: {
          select: { id: true, orderNumber: true, grandTotal: true, customerName: true }
        },
        purchase: {
          select: { id: true, purchaseNumber: true, grandTotal: true, supplierName: true }
        },
        supplier: {
          select: { id: true, name: true, email: true, phone: true }
        }
      }
    });
  }

  // ============================================================
  // GET ALL REFUNDS WITH FILTERS (by type)
  // ============================================================
  static async findAll(filter = {}, options = {}) {
    const { skip, take, orderBy = { createdAt: 'desc' } } = options;
    
    return await prisma.refund.findMany({
      where: filter,
      skip,
      take,
      orderBy,
      include: {
        creator: {
          select: { id: true, firstName: true, lastName: true, email: true }
        },
        processor: {
          select: { id: true, firstName: true, lastName: true, email: true }
        },
        order: {
          select: { id: true, orderNumber: true, grandTotal: true, customerName: true }
        },
        purchase: {
          select: { id: true, purchaseNumber: true, grandTotal: true, supplierName: true }
        },
        supplier: {
          select: { id: true, name: true, email: true, phone: true }
        }
      }
    });
  }

  // ============================================================
  // GET SALES REFUNDS ONLY
  // ============================================================
  static async findSalesRefunds(filter = {}, options = {}) {
    return await this.findAll({
      ...filter,
      refundType: 'Sales Refund'
    }, options);
  }

  // ============================================================
  // GET PURCHASE REFUNDS ONLY
  // ============================================================
  static async findPurchaseRefunds(filter = {}, options = {}) {
    return await this.findAll({
      ...filter,
      refundType: 'Purchase Refund'
    }, options);
  }

  // ============================================================
  // COUNT REFUNDS
  // ============================================================
  static async count(filter = {}) {
    return await prisma.refund.count({ where: filter });
  }

  // ============================================================
  // COUNT SALES REFUNDS
  // ============================================================
  static async countSalesRefunds(filter = {}) {
    return await prisma.refund.count({
      where: {
        ...filter,
        refundType: 'Sales Refund'
      }
    });
  }

  // ============================================================
  // COUNT PURCHASE REFUNDS
  // ============================================================
  static async countPurchaseRefunds(filter = {}) {
    return await prisma.refund.count({
      where: {
        ...filter,
        refundType: 'Purchase Refund'
      }
    });
  }

  // ============================================================
  // FIND REFUND BY ID
  // ============================================================
  static async findById(id) {
    return await prisma.refund.findUnique({
      where: { id },
      include: {
        creator: {
          select: { id: true, firstName: true, lastName: true, email: true }
        },
        processor: {
          select: { id: true, firstName: true, lastName: true, email: true }
        },
        updater: {
          select: { id: true, firstName: true, lastName: true, email: true }
        },
        order: {
          select: { id: true, orderNumber: true, grandTotal: true, customerName: true, orderDate: true }
        },
        purchase: {
          select: { id: true, purchaseNumber: true, grandTotal: true, supplierName: true, purchaseDate: true }
        },
        supplier: {
          select: { id: true, name: true, email: true, phone: true }
        }
      }
    });
  }

  // ============================================================
  // FIND REFUND BY REFUND NUMBER
  // ============================================================
  static async findByRefundNumber(refundNumber) {
    return await prisma.refund.findUnique({
      where: { refundNumber },
      include: {
        creator: {
          select: { id: true, firstName: true, lastName: true, email: true }
        },
        order: {
          select: { id: true, orderNumber: true, grandTotal: true, customerName: true }
        },
        purchase: {
          select: { id: true, purchaseNumber: true, grandTotal: true, supplierName: true }
        }
      }
    });
  }

  // ============================================================
  // FIND REFUNDS BY ORDER ID
  // ============================================================
  static async findByOrderId(orderId) {
    return await prisma.refund.findMany({
      where: { 
        orderId: orderId,
        refundType: 'Sales Refund'
      },
      orderBy: { createdAt: 'desc' },
      include: {
        creator: {
          select: { id: true, firstName: true, lastName: true, email: true }
        }
      }
    });
  }

  // ============================================================
  // FIND REFUNDS BY PURCHASE ID
  // ============================================================
  static async findByPurchaseId(purchaseId) {
    return await prisma.refund.findMany({
      where: { 
        purchaseId: purchaseId,
        refundType: 'Purchase Refund'
      },
      orderBy: { createdAt: 'desc' },
      include: {
        creator: {
          select: { id: true, firstName: true, lastName: true, email: true }
        }
      }
    });
  }

  // ============================================================
  // UPDATE REFUND
  // ============================================================
  static async update(id, data) {
    return await prisma.refund.update({
      where: { id },
      data,
      include: {
        creator: {
          select: { id: true, firstName: true, lastName: true, email: true }
        },
        processor: {
          select: { id: true, firstName: true, lastName: true, email: true }
        }
      }
    });
  }

  // ============================================================
  // PROCESS REFUND (Pending → Processing)
  // ============================================================
  static async process(id, userId) {
    return await prisma.refund.update({
      where: { id },
      data: {
        refundStatus: 'Processing',
        processedBy: userId,
        processedAt: new Date(),
        updatedBy: userId
      },
      include: {
        creator: {
          select: { id: true, firstName: true, lastName: true, email: true }
        },
        processor: {
          select: { id: true, firstName: true, lastName: true, email: true }
        }
      }
    });
  }

  // ============================================================
  // COMPLETE REFUND (Processing → Completed)
  // ============================================================
  static async complete(id, userId) {
    return await prisma.refund.update({
      where: { id },
      data: {
        refundStatus: 'Completed',
        completedAt: new Date(),
        updatedBy: userId
      },
      include: {
        creator: {
          select: { id: true, firstName: true, lastName: true, email: true }
        },
        processor: {
          select: { id: true, firstName: true, lastName: true, email: true }
        }
      }
    });
  }

  // ============================================================
  // CANCEL REFUND
  // ============================================================
  static async cancel(id, userId, reason = '') {
    return await prisma.refund.update({
      where: { id },
      data: {
        refundStatus: 'Cancelled',
        failureReason: reason || 'Cancelled by user',
        updatedBy: userId
      },
      include: {
        creator: {
          select: { id: true, firstName: true, lastName: true, email: true }
        }
      }
    });
  }

  // ============================================================
  // FAIL REFUND (Processing → Failed)
  // ============================================================
  static async fail(id, userId, reason) {
    return await prisma.refund.update({
      where: { id },
      data: {
        refundStatus: 'Failed',
        failureReason: reason,
        updatedBy: userId
      },
      include: {
        creator: {
          select: { id: true, firstName: true, lastName: true, email: true }
        }
      }
    });
  }

  // ============================================================
  // SOFT DELETE REFUND
  // ============================================================
  static async softDelete(id, userId) {
    return await prisma.refund.update({
      where: { id },
      data: {
        isActive: false,
        isDeleted: true,
        updatedBy: userId
      }
    });
  }

  // ============================================================
  // GET REFUND STATS (by type)
  // ============================================================
  static async getStats(userId, refundType = null, period = 'month') {
    const now = new Date();
    let dateFilter = {};

    if (period === 'today') {
      const start = new Date(now);
      start.setHours(0, 0, 0, 0);
      dateFilter = { refundDate: { gte: start } };
    } else if (period === 'week') {
      const start = new Date(now);
      start.setDate(start.getDate() - 7);
      dateFilter = { refundDate: { gte: start } };
    } else if (period === 'month') {
      const start = new Date(now);
      start.setMonth(start.getMonth() - 1);
      dateFilter = { refundDate: { gte: start } };
    }

    const filter = {
      isActive: true,
      isDeleted: false,
      userId: userId,
      ...dateFilter
    };

    if (refundType) {
      filter.refundType = refundType;
    }

    // Get status counts
    const [total, pending, processing, completed, failed, cancelled] = await Promise.all([
      prisma.refund.count({ where: filter }),
      prisma.refund.count({ where: { ...filter, refundStatus: 'Pending' } }),
      prisma.refund.count({ where: { ...filter, refundStatus: 'Processing' } }),
      prisma.refund.count({ where: { ...filter, refundStatus: 'Completed' } }),
      prisma.refund.count({ where: { ...filter, refundStatus: 'Failed' } }),
      prisma.refund.count({ where: { ...filter, refundStatus: 'Cancelled' } })
    ]);

    // Get financial stats
    const financial = await prisma.refund.aggregate({
      where: filter,
      _sum: {
        amount: true
      }
    });

    return {
      total,
      pending,
      processing,
      completed,
      failed,
      cancelled,
      totalAmount: financial._sum.amount || 0
    };
  }

  // ============================================================
  // GET DAILY TREND
  // ============================================================
  static async getDailyTrend(userId, refundType = null, period = 'month') {
    const now = new Date();
    let startDate = new Date(now);

    if (period === 'today') {
      startDate.setHours(0, 0, 0, 0);
    } else if (period === 'week') {
      startDate.setDate(startDate.getDate() - 7);
    } else if (period === 'month') {
      startDate.setMonth(startDate.getMonth() - 1);
    }

    const filter = {
      userId: userId,
      isActive: true,
      isDeleted: false,
      refundDate: { gte: startDate }
    };

    if (refundType) {
      filter.refundType = refundType;
    }

    const refunds = await prisma.refund.groupBy({
      by: ['refundDate'],
      where: filter,
      _sum: {
        amount: true
      },
      _count: true,
      orderBy: {
        refundDate: 'asc'
      }
    });

    return refunds.map(item => ({
      date: item.refundDate.toISOString().split('T')[0],
      count: item._count,
      amount: item._sum.amount || 0
    }));
  }

  // ============================================================
  // SEARCH REFUNDS
  // ============================================================
  static async search(userId, query, limit = 10) {
    if (!query || query.length < 2) {
      return [];
    }

    return await prisma.refund.findMany({
      where: {
        userId: userId,
        isActive: true,
        isDeleted: false,
        OR: [
          { refundNumber: { contains: query, mode: 'insensitive' } },
          { orderNumber: { contains: query, mode: 'insensitive' } },
          { purchaseNumber: { contains: query, mode: 'insensitive' } },
          { customerName: { contains: query, mode: 'insensitive' } },
          { customerEmail: { contains: query, mode: 'insensitive' } },
          { supplierName: { contains: query, mode: 'insensitive' } },
          { supplierEmail: { contains: query, mode: 'insensitive' } }
        ]
      },
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        creator: {
          select: { id: true, firstName: true, lastName: true, email: true }
        }
      }
    });
  }
}

module.exports = RefundModel;