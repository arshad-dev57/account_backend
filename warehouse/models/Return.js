// warehouse/models/Return.js - COMPLETE FIXED

const prisma = require('../../prisma/client');

function generateReturnNumber(returnType) {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  
  let prefix = 'RET';
  if (returnType === 'Sales Return') prefix = 'SR';
  else if (returnType === 'Purchase Return') prefix = 'PR';
  
  return `${prefix}-${year}${month}${day}-${random}`;
}

class ReturnModel {
  // ============================================================
  // CREATE RETURN
  // ============================================================
  static async create(data) {
    const returnNumber = generateReturnNumber(data.returnType || 'Sales Return');
    
    return await prisma.$transaction(async (tx) => {
      // ─── Calculate Totals from Items ──────────────────────
      let calculatedTotalRefund = 0;
      let calculatedSubtotal = 0;
      
      for (const item of data.items) {
        const refundAmount = item.refundAmount ?? (item.unitPrice * item.returnQuantity);
        calculatedTotalRefund += refundAmount;
        calculatedSubtotal += (item.unitPrice ?? 0) * (item.quantity ?? 1);
      }
      
      const restockingFee = data.restockingFee ?? 0;
      const shippingCost = data.shippingCost ?? 0;
      const finalTotalRefund = Math.max(0, calculatedTotalRefund - restockingFee - shippingCost);
      
      // ─── Create Return ──────────────────────────────────────
      // ✅ REMOVED: totalReturnQty (not in schema)
      const returnData = await tx.return.create({
        data: {
          returnNumber,
          returnDate: new Date(),
          orderId: data.orderId,
          orderNumber: data.orderNumber,
          customerId: data.customerId || null,
          customerName: data.customerName,
          customerEmail: data.customerEmail,
          customerPhone: data.customerPhone,
          subtotal: calculatedSubtotal,           
          refundAmount: calculatedTotalRefund,  
          restockingFee: restockingFee,
          shippingCost: shippingCost,
          totalRefund: finalTotalRefund,
          // totalReturnQty: calculatedTotalReturnQty, // ❌ REMOVED - not in schema
          returnType: data.returnType || 'Sales Return',
          reason: data.reason,
          notes: data.notes || '',
          returnMethod: data.returnMethod || 'Original Payment',
          images: data.images || [],
          attachments: data.attachments || [],
          createdBy: data.createdBy || data.userId,
          companyId: data.companyId,
          supplierId: data.supplierId || null,
          supplierName: data.supplierName || null,
          supplierEmail: data.supplierEmail || null,
          supplierPhone: data.supplierPhone || null,
          purchaseId: data.purchaseId || null,
          purchaseNumber: data.purchaseNumber || null,
          returnReasonCategory: data.returnReasonCategory || null,
          restockStatus: data.restockStatus || 'Pending',
          qualityCheckPassed: data.qualityCheckPassed || null,
          qualityCheckNotes: data.qualityCheckNotes || null,
          trackingNumber: data.trackingNumber || null,
          shippingCarrier: data.shippingCarrier || null,
          returnLabel: data.returnLabel || null,
          receivedDate: data.receivedDate || null
        },
        include: {
          creator: {
            select: { id: true, firstName: true, lastName: true, email: true }
          }
        }
      });

      // ─── Create Return Items ──────────────────────────────
      for (const item of data.items) {
        const refundAmount = item.refundAmount ?? (item.unitPrice * item.returnQuantity);
        
        await tx.returnItem.create({
          data: {
            returnId: returnData.id,
            productId: item.productId,
            productName: item.productName,
            sku: item.sku,
            quantity: item.quantity ?? 1,
            unitPrice: item.unitPrice ?? 0,
            totalPrice: (item.unitPrice ?? 0) * (item.quantity ?? 1),
            returnQuantity: item.returnQuantity ?? 1,
            reason: item.reason || data.reason || 'Return',
            condition: item.condition || 'New',
            refundAmount: refundAmount,
            batchNumber: item.batchNumber || '',
            serialNumber: item.serialNumber || '',
            notes: item.notes || '',
            restockQuantity: item.restockQuantity || null,
            restockStatus: item.restockStatus || 'Pending',
            returnReasonDetail: item.returnReasonDetail || null,
            replacementProductId: item.replacementProductId || null,
            replacementProductName: item.replacementProductName || null
          }
        });

        // ─── Update Stock ─────────────────────────────────────
        if (data.returnType === 'Sales Return') {
          await tx.product.update({
            where: { id: item.productId },
            data: {
              currentStock: {
                increment: item.returnQuantity
              },
              availableStock: {
                increment: item.returnQuantity
              }
            }
          });
        } else if (data.returnType === 'Purchase Return') {
          await tx.product.update({
            where: { id: item.productId },
            data: {
              currentStock: {
                decrement: item.returnQuantity
              },
              availableStock: {
                decrement: item.returnQuantity
              }
            }
          });
        }
      }

      // ─── Update Order Status ──────────────────────────────
      await tx.order.update({
        where: { id: data.orderId },
        data: {
          orderStatus: 'Returned'
        }
      });

      // ─── Return Complete Return with Items ─────────────────
      return await tx.return.findUnique({
        where: { id: returnData.id },
        include: {
          items: true,
          creator: {
            select: { id: true, firstName: true, lastName: true, email: true }
          },
          order: {
            select: { id: true, orderNumber: true, customerName: true }
          },
          supplier: {
            select: { id: true, name: true, email: true, phone: true }
          },
          purchase: {
            select: { id: true, purchaseNumber: true, supplierName: true }
          }
        }
      });
    });
  }

  // ============================================================
  // GET RETURNS WITH FILTERS
  // ============================================================
  static async findAll(filter = {}, options = {}) {
    const { skip, take, orderBy = { createdAt: 'desc' } } = options;
    
    return await prisma.return.findMany({
      where: filter,
      skip,
      take,
      orderBy,
      include: {
        items: true,
        creator: {
          select: { id: true, firstName: true, lastName: true, email: true }
        },
        approver: {
          select: { id: true, firstName: true, lastName: true, email: true }
        },
        order: {
          select: { id: true, orderNumber: true, customerName: true, grandTotal: true }
        },
        supplier: {
          select: { id: true, name: true, email: true, phone: true }
        },
        purchase: {
          select: { id: true, purchaseNumber: true, supplierName: true }
        }
      }
    });
  }

  // ============================================================
  // GET SALES RETURNS ONLY
  // ============================================================
  static async findSalesReturns(filter = {}, options = {}) {
    return await this.findAll({
      ...filter,
      returnType: 'Sales Return'
    }, options);
  }

  // ============================================================
  // GET PURCHASE RETURNS ONLY
  // ============================================================
  static async findPurchaseReturns(filter = {}, options = {}) {
    return await this.findAll({
      ...filter,
      returnType: 'Purchase Return'
    }, options);
  }

  // ============================================================
  // COUNT RETURNS
  // ============================================================
  static async count(filter = {}) {
    return await prisma.return.count({ where: filter });
  }

  // ============================================================
  // COUNT SALES RETURNS
  // ============================================================
  static async countSalesReturns(filter = {}) {
    const cleanFilter = { ...filter };
    if (cleanFilter.userId) {
      cleanFilter.createdBy = cleanFilter.userId;
      delete cleanFilter.userId;
    }
    
    return await prisma.return.count({
      where: {
        ...cleanFilter,
        returnType: 'Sales Return'
      }
    });
  }

  // ============================================================
  // COUNT PURCHASE RETURNS
  // ============================================================
  static async countPurchaseReturns(filter = {}) {
    const cleanFilter = { ...filter };
    if (cleanFilter.userId) {
      cleanFilter.createdBy = cleanFilter.userId;
      delete cleanFilter.userId;
    }
    
    return await prisma.return.count({
      where: {
        ...cleanFilter,
        returnType: 'Purchase Return'
      }
    });
  }

  // ============================================================
  // FIND RETURN BY ID
  // ============================================================
  static async findById(id) {
    const returnData = await prisma.return.findUnique({
      where: { id },
      include: {
        items: {
          include: {
            product: {
              select: { id: true, name: true, sku: true, sellingPrice: true, currentStock: true }
            }
          }
        },
        creator: {
          select: { id: true, firstName: true, lastName: true, email: true }
        },
        approver: {
          select: { id: true, firstName: true, lastName: true, email: true }
        },
        updater: {
          select: { id: true, firstName: true, lastName: true, email: true }
        },
        order: {
          select: { id: true, orderNumber: true, customerName: true, grandTotal: true, orderDate: true }
        },
        supplier: {
          select: { id: true, name: true, email: true, phone: true }
        },
        purchase: {
          select: { id: true, purchaseNumber: true, supplierName: true }
        }
      }
    });

    // Calculate totalReturnQty from items for frontend
    if (returnData && returnData.items) {
      const totalQty = returnData.items.reduce((sum, item) => sum + (item.returnQuantity || 0), 0);
      return {
        ...returnData,
        totalReturnQty: totalQty
      };
    }
    
    return returnData;
  }

  // ============================================================
  // FIND RETURN BY RETURN NUMBER
  // ============================================================
  static async findByReturnNumber(returnNumber) {
    return await prisma.return.findUnique({
      where: { returnNumber },
      include: {
        items: true,
        creator: {
          select: { id: true, firstName: true, lastName: true, email: true }
        },
        order: {
          select: { id: true, orderNumber: true, customerName: true }
        }
      }
    });
  }

  // ============================================================
  // UPDATE RETURN
  // ============================================================
  static async update(id, data) {
    return await prisma.return.update({
      where: { id },
      data,
      include: {
        items: true,
        creator: {
          select: { id: true, firstName: true, lastName: true, email: true }
        }
      }
    });
  }

  // ============================================================
  // APPROVE RETURN
  // ============================================================
  static async approve(id, userId, notes = '') {
    return await prisma.return.update({
      where: { id },
      data: {
        returnStatus: 'Approved',
        approvedBy: userId,
        approvedAt: new Date(),
        updatedBy: userId,
        notes: notes ? `${notes}` : undefined
      },
      include: {
        items: true,
        creator: {
          select: { id: true, firstName: true, lastName: true, email: true }
        },
        approver: {
          select: { id: true, firstName: true, lastName: true, email: true }
        }
      }
    });
  }

  // ============================================================
  // REJECT RETURN
  // ============================================================
  static async reject(id, userId, rejectionReason) {
    return await prisma.return.update({
      where: { id },
      data: {
        returnStatus: 'Rejected',
        rejectionReason,
        updatedBy: userId
      },
      include: {
        items: true,
        creator: {
          select: { id: true, firstName: true, lastName: true, email: true }
        }
      }
    });
  }

  // ============================================================
  // COMPLETE RETURN
  // ============================================================
  static async complete(id, userId, receivedDate = null) {
    return await prisma.return.update({
      where: { id },
      data: {
        returnStatus: 'Completed',
        receivedDate: receivedDate || new Date(),
        updatedBy: userId
      },
      include: {
        items: true,
        creator: {
          select: { id: true, firstName: true, lastName: true, email: true }
        }
      }
    });
  }

  // ============================================================
  // CANCEL RETURN
  // ============================================================
  static async cancel(id, userId, reason = '') {
    return await prisma.return.update({
      where: { id },
      data: {
        returnStatus: 'Cancelled',
        updatedBy: userId,
        notes: reason ? `Cancelled: ${reason}` : 'Cancelled'
      },
      include: {
        items: true,
        creator: {
          select: { id: true, firstName: true, lastName: true, email: true }
        }
      }
    });
  }

  // ============================================================
  // SOFT DELETE RETURN
  // ============================================================
  static async softDelete(id, userId) {
    return await prisma.return.update({
      where: { id },
      data: {
        isActive: false,
        isDeleted: true,
        updatedBy: userId
      }
    });
  }

  // ============================================================
  // GET RETURN STATS
  // ============================================================
  static async getStats(companyId, returnType = null, period = 'month') {
    const now = new Date();
    let dateFilter = {};

    if (period === 'today') {
      const start = new Date(now);
      start.setHours(0, 0, 0, 0);
      dateFilter = { returnDate: { gte: start } };
    } else if (period === 'week') {
      const start = new Date(now);
      start.setDate(start.getDate() - 7);
      dateFilter = { returnDate: { gte: start } };
    } else if (period === 'month') {
      const start = new Date(now);
      start.setMonth(start.getMonth() - 1);
      dateFilter = { returnDate: { gte: start } };
    }

    const filter = {
      isActive: true,
      isDeleted: false,
      companyId: companyId,
      ...dateFilter
    };

    if (returnType) {
      filter.returnType = returnType;
    }

    const [total, pending, approved, rejected, completed, cancelled] = await Promise.all([
      prisma.return.count({ where: filter }),
      prisma.return.count({ where: { ...filter, returnStatus: 'Pending' } }),
      prisma.return.count({ where: { ...filter, returnStatus: 'Approved' } }),
      prisma.return.count({ where: { ...filter, returnStatus: 'Rejected' } }),
      prisma.return.count({ where: { ...filter, returnStatus: 'Completed' } }),
      prisma.return.count({ where: { ...filter, returnStatus: 'Cancelled' } })
    ]);

    const financial = await prisma.return.aggregate({
      where: filter,
      _sum: {
        totalRefund: true,
        refundAmount: true,
        restockingFee: true,
        shippingCost: true
      },
      _avg: {
        totalRefund: true
      }
    });

    return {
      total,
      pending,
      approved,
      rejected,
      completed,
      cancelled,
      totalRefund: financial._sum.totalRefund || 0,
      totalRefundAmount: financial._sum.refundAmount || 0,
      totalRestockingFee: financial._sum.restockingFee || 0,
      totalShippingCost: financial._sum.shippingCost || 0,
      avgRefund: financial._avg.totalRefund || 0
    };
  }

  // ============================================================
  // GET DAILY TREND
  // ============================================================
  static async getDailyTrend(companyId, returnType = null, period = 'month') {
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
      companyId: companyId,
      isActive: true,
      isDeleted: false,
      returnDate: { gte: startDate }
    };

    if (returnType) {
      filter.returnType = returnType;
    }

    const returns = await prisma.return.groupBy({
      by: ['returnDate'],
      where: filter,
      _sum: {
        totalRefund: true
      },
      _count: true,
      orderBy: {
        returnDate: 'asc'
      }
    });

    return returns.map(item => ({
      date: item.returnDate,
      count: item._count,
      refund: item._sum.totalRefund || 0
    }));
  }

  // ============================================================
  // GET RETURNS BY ORDER
  // ============================================================
  static async getReturnsByOrder(companyId, orderId) {
    return await prisma.return.findMany({
      where: {
        orderId: orderId,
        companyId: companyId,
        isActive: true,
        isDeleted: false
      },
      include: {
        items: true,
        creator: {
          select: { id: true, firstName: true, lastName: true, email: true }
        }
      },
      orderBy: { createdAt: 'desc' }
    });
  }
}

module.exports = ReturnModel;