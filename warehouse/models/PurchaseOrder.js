// warehouse/models/PurchaseOrder.js - FIXED

const prisma = require('../../prisma/client');

// ─── Generate Order Number Function ──────────────────────
function generateOrderNumber() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  
  return `PO-${year}${month}${day}-${random}`;
}

class PurchaseOrderModel {
  // ============================================================
  // CREATE PURCHASE ORDER
  // ============================================================
  static async create(data) {
    const orderNumber = generateOrderNumber();
    
    return await prisma.$transaction(async (tx) => {
      // ─── Validate Supplier ──────────────────────────────────
      // ✅ FIX: Use 'status' instead of 'isActive'
      const supplier = await tx.supplier.findFirst({
        where: {
          id: data.supplierId,
          userId: data.userId,
          status: 'active'  // ✅ Changed from isActive: true
        }
      });

      if (!supplier) {
        throw new Error('Supplier not found');
      }

      // ─── Validate Products ──────────────────────────────────
      for (const item of data.items) {
        const product = await tx.product.findFirst({
          where: {
            id: item.productId,
            userId: data.userId,
            isActive: true
          }
        });

        if (!product) {
          throw new Error(`Product ${item.productName} not found`);
        }
      }

      // ─── Calculate Totals ──────────────────────────────────
      let subtotal = 0;
      let totalDiscount = 0;
      let totalTax = 0;

      const orderItems = data.items.map(item => {
        const lineTotal = item.quantity * item.unitPrice;
        const discountAmount = (lineTotal * (item.discount || 0)) / 100;
        const taxableAmount = lineTotal - discountAmount;
        const taxAmount = (taxableAmount * (item.taxRate || 0)) / 100;
        const total = taxableAmount + taxAmount;

        subtotal += lineTotal;
        totalDiscount += discountAmount;
        totalTax += taxAmount;

        return {
          productId: item.productId,
          productName: item.productName,
          sku: item.sku,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          discount: item.discount || 0,
          taxRate: item.taxRate || 0,
          taxAmount: taxAmount,
          lineTotal: total,
          notes: item.notes || null
        };
      });

      const grandTotal = subtotal - totalDiscount + totalTax;

      // ─── Create Purchase Order ──────────────────────────────
      const purchaseOrder = await tx.purchaseOrder.create({
        data: {
          orderNumber,
          supplierId: data.supplierId,
          supplierName: supplier.name,
          supplierEmail: supplier.email || null,
          supplierPhone: supplier.phone || null,
          supplierAddress: supplier.address || null,
          orderDate: new Date(data.orderDate || Date.now()),
          expectedDeliveryDate: data.expectedDeliveryDate ? new Date(data.expectedDeliveryDate) : null,
          status: data.status || 'Draft',
          subtotal,
          totalDiscount,
          totalTax,
          grandTotal,
          notes: data.notes || null,
          termsConditions: data.termsConditions || null,
          createdBy: data.createdBy,
          userId: data.userId,
          items: {
            create: orderItems
          }
        },
        include: {
          items: {
            include: {
              product: true
            }
          },
          supplier: true,
          creator: {
            select: { id: true, firstName: true, lastName: true, email: true }
          }
        }
      });

      return purchaseOrder;
    });
  }

  // ============================================================
  // GET PURCHASE ORDER BY ID
  // ============================================================
  static async findById(id) {
    return await prisma.purchaseOrder.findUnique({
      where: { id },
      include: {
        items: {
          include: {
            product: {
              select: { id: true, name: true, sku: true, costPrice: true }
            }
          }
        },
        supplier: true,
        creator: {
          select: { id: true, firstName: true, lastName: true, email: true }
        },
        updater: {
          select: { id: true, firstName: true, lastName: true, email: true }
        }
      }
    });
  }

  // ============================================================
  // GET PURCHASE ORDER BY NUMBER
  // ============================================================
  static async findByOrderNumber(orderNumber) {
    return await prisma.purchaseOrder.findUnique({
      where: { orderNumber },
      include: {
        items: {
          include: {
            product: {
              select: { id: true, name: true, sku: true }
            }
          }
        },
        supplier: true,
        creator: {
          select: { id: true, firstName: true, lastName: true, email: true }
        }
      }
    });
  }

  // ============================================================
  // GET ALL PURCHASE ORDERS WITH FILTERS
  // ============================================================
  static async findAll(filter = {}, options = {}) {
    const { skip, take, orderBy = { orderDate: 'desc' } } = options;
    
    return await prisma.purchaseOrder.findMany({
      where: {
        ...filter,
        isActive: true,
        isDeleted: false
      },
      skip,
      take,
      orderBy,
      include: {
        items: {
          include: {
            product: {
              select: { id: true, name: true, sku: true }
            }
          }
        },
        supplier: true,
        creator: {
          select: { id: true, firstName: true, lastName: true, email: true }
        }
      }
    });
  }

  // ============================================================
  // COUNT PURCHASE ORDERS
  // ============================================================
  static async count(filter = {}) {
    return await prisma.purchaseOrder.count({
      where: {
        ...filter,
        isActive: true,
        isDeleted: false
      }
    });
  }

  // ============================================================
  // UPDATE PURCHASE ORDER
  // ============================================================
  static async update(id, data) {
    return await prisma.$transaction(async (tx) => {
      const purchaseOrder = await tx.purchaseOrder.findUnique({
        where: { id },
        include: { items: true }
      });

      if (!purchaseOrder) {
        throw new Error('Purchase order not found');
      }

      // ─── Don't allow update if cancelled or approved ──────
      if (purchaseOrder.status === 'Cancelled') {
        throw new Error('Cannot update cancelled purchase order');
      }

      if (purchaseOrder.status === 'Approved') {
        throw new Error('Cannot update approved purchase order');
      }

      // ─── Update header ──────────────────────────────────────
      const updateData = {
        updatedBy: data.updatedBy,
        ...(data.supplierId && { supplierId: data.supplierId }),
        ...(data.supplierName && { supplierName: data.supplierName }),
        ...(data.supplierEmail !== undefined && { supplierEmail: data.supplierEmail }),
        ...(data.supplierPhone !== undefined && { supplierPhone: data.supplierPhone }),
        ...(data.supplierAddress !== undefined && { supplierAddress: data.supplierAddress }),
        ...(data.orderDate && { orderDate: new Date(data.orderDate) }),
        ...(data.expectedDeliveryDate && { expectedDeliveryDate: new Date(data.expectedDeliveryDate) }),
        ...(data.status && { status: data.status }),
        ...(data.notes !== undefined && { notes: data.notes }),
        ...(data.termsConditions !== undefined && { termsConditions: data.termsConditions })
      };

      // ─── Update items if provided ──────────────────────────
      if (data.items) {
        // Delete existing items
        await tx.purchaseOrderItem.deleteMany({
          where: { purchaseOrderId: id }
        });

        // Recalculate totals
        let subtotal = 0;
        let totalDiscount = 0;
        let totalTax = 0;

        const orderItems = data.items.map(item => {
          const lineTotal = item.quantity * item.unitPrice;
          const discountAmount = (lineTotal * (item.discount || 0)) / 100;
          const taxableAmount = lineTotal - discountAmount;
          const taxAmount = (taxableAmount * (item.taxRate || 0)) / 100;
          const total = taxableAmount + taxAmount;

          subtotal += lineTotal;
          totalDiscount += discountAmount;
          totalTax += taxAmount;

          return {
            productId: item.productId,
            productName: item.productName,
            sku: item.sku,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            discount: item.discount || 0,
            taxRate: item.taxRate || 0,
            taxAmount: taxAmount,
            lineTotal: total,
            notes: item.notes || null
          };
        });

        const grandTotal = subtotal - totalDiscount + totalTax;

        updateData.subtotal = subtotal;
        updateData.totalDiscount = totalDiscount;
        updateData.totalTax = totalTax;
        updateData.grandTotal = grandTotal;
        updateData.items = {
          create: orderItems
        };
      }

      const updatedOrder = await tx.purchaseOrder.update({
        where: { id },
        data: updateData,
        include: {
          items: {
            include: {
              product: true
            }
          },
          supplier: true,
          creator: {
            select: { id: true, firstName: true, lastName: true, email: true }
          }
        }
      });

      return updatedOrder;
    });
  }

  // ============================================================
  // UPDATE STATUS
  // ============================================================
  static async updateStatus(id, status, userId, notes = '') {
    const purchaseOrder = await prisma.purchaseOrder.findUnique({
      where: { id }
    });

    if (!purchaseOrder) {
      throw new Error('Purchase order not found');
    }

    // ─── Validate status transition ──────────────────────────
    const validTransitions = {
      'Draft': ['Sent', 'Cancelled'],
      'Sent': ['Approved', 'Cancelled'],
      'Approved': ['Cancelled'],
      'Cancelled': []
    };

    if (!validTransitions[purchaseOrder.status]?.includes(status)) {
      throw new Error(`Cannot transition from ${purchaseOrder.status} to ${status}`);
    }

    const updateData = {
      status,
      updatedBy: userId
    };

    // ─── Set timestamps ──────────────────────────────────────
    if (status === 'Sent') {
      updateData.sentAt = new Date();
    } else if (status === 'Approved') {
      updateData.approvedAt = new Date();
    } else if (status === 'Cancelled') {
      updateData.cancelledAt = new Date();
    }

    return await prisma.purchaseOrder.update({
      where: { id },
      data: updateData,
      include: {
        items: {
          include: {
            product: true
          }
        },
        supplier: true,
        creator: {
          select: { id: true, firstName: true, lastName: true, email: true }
        }
      }
    });
  }

  // ============================================================
  // SEND PURCHASE ORDER (Email)
  // ============================================================
  static async sendOrder(id, userId) {
    return await prisma.$transaction(async (tx) => {
      const purchaseOrder = await tx.purchaseOrder.findUnique({
        where: { id },
        include: {
          items: {
            include: {
              product: true
            }
          },
          supplier: true,
          creator: {
            select: { id: true, firstName: true, lastName: true, email: true }
          }
        }
      });

      if (!purchaseOrder) {
        throw new Error('Purchase order not found');
      }

      if (purchaseOrder.status === 'Cancelled') {
        throw new Error('Cannot send cancelled purchase order');
      }

      if (!purchaseOrder.supplierEmail) {
        throw new Error('Supplier email is not configured');
      }

      // ─── Update status to Sent ─────────────────────────────
      const updatedOrder = await tx.purchaseOrder.update({
        where: { id },
        data: {
          status: 'Sent',
          sentAt: new Date(),
          updatedBy: userId
        },
        include: {
          items: {
            include: {
              product: true
            }
          },
          supplier: true,
          creator: {
            select: { id: true, firstName: true, lastName: true, email: true }
          }
        }
      });

      return updatedOrder;
    });
  }

  // ============================================================
  // CANCEL PURCHASE ORDER
  // ============================================================
  static async cancelOrder(id, userId, reason = '') {
    const purchaseOrder = await prisma.purchaseOrder.findUnique({
      where: { id }
    });

    if (!purchaseOrder) {
      throw new Error('Purchase order not found');
    }

    if (purchaseOrder.status === 'Cancelled') {
      throw new Error('Purchase order already cancelled');
    }

    return await prisma.purchaseOrder.update({
      where: { id },
      data: {
        status: 'Cancelled',
        cancelledAt: new Date(),
        updatedBy: userId,
        notes: purchaseOrder.notes 
          ? `${purchaseOrder.notes}\nCancelled: ${reason}` 
          : `Cancelled: ${reason}`
      },
      include: {
        items: {
          include: {
            product: true
          }
        },
        supplier: true,
        creator: {
          select: { id: true, firstName: true, lastName: true, email: true }
        }
      }
    });
  }

  // ============================================================
  // SOFT DELETE PURCHASE ORDER
  // ============================================================
  static async softDelete(id, userId) {
    const purchaseOrder = await prisma.purchaseOrder.findUnique({
      where: { id }
    });

    if (!purchaseOrder) {
      throw new Error('Purchase order not found');
    }

    if (purchaseOrder.status === 'Approved') {
      throw new Error('Cannot delete approved purchase order');
    }

    return await prisma.purchaseOrder.update({
      where: { id },
      data: {
        isDeleted: true,
        isActive: false,
        updatedBy: userId
      },
      include: {
        items: true
      }
    });
  }

  // ============================================================
  // GET PURCHASE ORDER STATS
  // ============================================================
  static async getStats(userId) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);

    const baseFilter = {
      isActive: true,
      isDeleted: false,
      userId: userId
    };

    // ─── Today's orders ──────────────────────────────────────
    const todayOrders = await prisma.purchaseOrder.count({
      where: {
        ...baseFilter,
        orderDate: {
          gte: today
        }
      }
    });

    const todayAmount = await prisma.purchaseOrder.aggregate({
      where: {
        ...baseFilter,
        orderDate: {
          gte: today
        }
      },
      _sum: {
        grandTotal: true
      }
    });

    // ─── Monthly orders ──────────────────────────────────────
    const monthOrders = await prisma.purchaseOrder.count({
      where: {
        ...baseFilter,
        orderDate: {
          gte: startOfMonth
        }
      }
    });

    const monthAmount = await prisma.purchaseOrder.aggregate({
      where: {
        ...baseFilter,
        orderDate: {
          gte: startOfMonth
        }
      },
      _sum: {
        grandTotal: true
      }
    });

    // ─── Status counts ──────────────────────────────────────
    const [draft, sent, approved, cancelled] = await Promise.all([
      prisma.purchaseOrder.count({ where: { ...baseFilter, status: 'Draft' } }),
      prisma.purchaseOrder.count({ where: { ...baseFilter, status: 'Sent' } }),
      prisma.purchaseOrder.count({ where: { ...baseFilter, status: 'Approved' } }),
      prisma.purchaseOrder.count({ where: { ...baseFilter, status: 'Cancelled' } })
    ]);

    return {
      today: {
        count: todayOrders,
        amount: todayAmount._sum.grandTotal || 0
      },
      month: {
        count: monthOrders,
        amount: monthAmount._sum.grandTotal || 0
      },
      status: {
        draft,
        sent,
        approved,
        cancelled,
        total: draft + sent + approved + cancelled
      }
    };
  }

  // ============================================================
  // GET PURCHASE ORDER SUMMARY
  // ============================================================
  static async getSummary(userId) {
    const baseFilter = {
      isActive: true,
      isDeleted: false,
      userId: userId
    };

    const totalOrders = await prisma.purchaseOrder.count({
      where: baseFilter
    });

    const totalAmount = await prisma.purchaseOrder.aggregate({
      where: baseFilter,
      _sum: {
        grandTotal: true
      }
    });

    const approvedOrders = await prisma.purchaseOrder.count({
      where: {
        ...baseFilter,
        status: 'Approved'
      }
    });

    const approvedAmount = await prisma.purchaseOrder.aggregate({
      where: {
        ...baseFilter,
        status: 'Approved'
      },
      _sum: {
        grandTotal: true
      }
    });

    return {
      totalOrders,
      totalAmount: totalAmount._sum.grandTotal || 0,
      approvedOrders,
      approvedAmount: approvedAmount._sum.grandTotal || 0
    };
  }

  // ============================================================
  // GET SUPPLIER PURCHASE ORDER SUMMARY
  // ============================================================
  static async getSupplierSummary(userId, supplierId) {
    const baseFilter = {
      isActive: true,
      isDeleted: false,
      userId: userId,
      supplierId: supplierId
    };

    const orders = await prisma.purchaseOrder.findMany({
      where: baseFilter,
      select: {
        id: true,
        orderNumber: true,
        orderDate: true,
        expectedDeliveryDate: true,
        status: true,
        grandTotal: true,
        subtotal: true,
        totalTax: true
      },
      orderBy: {
        orderDate: 'desc'
      }
    });

    const summary = {
      totalOrders: orders.length,
      totalAmount: 0,
      draftCount: 0,
      sentCount: 0,
      approvedCount: 0,
      cancelledCount: 0,
      orders: orders
    };

    for (const order of orders) {
      summary.totalAmount += order.grandTotal;
      switch (order.status) {
        case 'Draft': summary.draftCount++; break;
        case 'Sent': summary.sentCount++; break;
        case 'Approved': summary.approvedCount++; break;
        case 'Cancelled': summary.cancelledCount++; break;
      }
    }

    return summary;
  }
}

module.exports = PurchaseOrderModel;