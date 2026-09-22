// warehouse/models/PurchaseOrder.js - COMPLETE CORRECTED

const prisma = require('../../prisma/client');
const { resolveLocationId } = require('../services/locationService');

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
      const supplierId = String(data.supplierId || '').trim();
      const supplier = await tx.supplier.findFirst({
        where: {
          id: supplierId,
          companyId: data.companyId,
        }
      });

      if (!supplier) {
        throw new Error('Supplier not found for your company');
      }
      if (String(supplier.status || '').toLowerCase() !== 'active') {
        throw new Error('Supplier is inactive. Reactivate it or pick an active supplier.');
      }
      for (const item of data.items) {
        const product = await tx.product.findFirst({
          where: {
            id: item.productId,
            companyId: data.companyId,  // ✅ Use companyId instead of userId
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

      const locationId = await resolveLocationId(
        tx,
        data.companyId,
        data.locationId,
        data.createdBy
      );

      // ─── Create Purchase Order ──────────────────────────────
      // ✅ FIXED: Use createdBy and companyId (NOT userId)
      const purchaseOrder = await tx.purchaseOrder.create({
        data: {
          orderNumber,
          supplierId: data.supplierId,
          supplierName: supplier.name,
          supplierEmail: supplier.email || null,
          supplierPhone: supplier.phone || null,
          supplierAddress: supplier.address || null,
          purchaseRequisitionId: data.purchaseRequisitionId || null,
          purchaseRequisitionNumber: data.purchaseRequisitionNumber || null,
          orderDate: new Date(data.orderDate || Date.now()),
          expectedDeliveryDate: data.expectedDeliveryDate ? new Date(data.expectedDeliveryDate) : null,
          status: data.status || 'Draft',
          approvedAt: data.status === 'Approved' ? new Date() : null,
          subtotal,
          totalDiscount,
          totalTax,
          grandTotal,
          notes: data.notes || null,
          termsConditions: data.termsConditions || null,
          createdBy: data.createdBy,        // ✅ Use createdBy
          companyId: data.companyId,        // ✅ Use companyId
          locationId,
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

      // Calculate totalItems
      return {
        ...purchaseOrder,
        totalItems: purchaseOrder.items.reduce((sum, item) => sum + item.quantity, 0)
      };
    });
  }

  // ============================================================
  // ATTACH GRN RECEIVING PROGRESS (per line + order totals)
  // ============================================================
  static grnLinkedToOrder(grn, orderId) {
    if (grn.purchaseOrderId === orderId) return true;
    return (grn.purchaseOrders || []).some(
      (link) => link.purchaseOrderId === orderId
    );
  }

  static buildReceivedQuantitiesForOrder(order, grns) {
    const poItems = order.items || [];
    const poItemIds = new Set(poItems.map((item) => item.id));
    const receivedByItemId = {};
    const receivedByProductId = {};

    for (const grn of grns) {
      if (!this.grnLinkedToOrder(grn, order.id)) continue;

      for (const item of grn.items || []) {
        const qty = Number(item.receivingQuantity) || 0;
        if (qty <= 0) continue;

        const matchesPoLine =
          item.purchaseOrderItemId && poItemIds.has(item.purchaseOrderItemId);
        const matchesPoScope =
          matchesPoLine ||
          item.purchaseOrderId === order.id ||
          (!item.purchaseOrderId && matchesPoLine);

        if (!matchesPoScope) continue;

        if (matchesPoLine) {
          receivedByItemId[item.purchaseOrderItemId] =
            (receivedByItemId[item.purchaseOrderItemId] || 0) + qty;
          continue;
        }

        if (item.productId) {
          receivedByProductId[item.productId] =
            (receivedByProductId[item.productId] || 0) + qty;
        }
      }
    }

    const productLineCounts = {};
    for (const item of poItems) {
      productLineCounts[item.productId] =
        (productLineCounts[item.productId] || 0) + 1;
    }

    let totalOrdered = 0;
    let totalReceived = 0;
    const items = poItems.map((item) => {
      const ordered = Number(item.quantity) || 0;
      let received = Number(receivedByItemId[item.id] || 0);

      if (received <= 0 && productLineCounts[item.productId] === 1) {
        received = Number(receivedByProductId[item.productId] || 0);
      }

      const remaining = Math.max(0, ordered - received);
      totalOrdered += ordered;
      totalReceived += received;

      return {
        ...item,
        receivedQuantity: received,
        remainingQuantity: remaining,
        receivingProgress: ordered > 0 ? received / ordered : 0,
        isFullyReceived: ordered > 0 && remaining <= 0,
      };
    });

    const receivingProgress =
      totalOrdered > 0 ? totalReceived / totalOrdered : 0;
    let receivingStatus = 'Not Received';
    if (totalReceived > 0) {
      receivingStatus =
        totalReceived >= totalOrdered ? 'Fully Received' : 'Partially Received';
    }

    return {
      items,
      totalOrderedQty: totalOrdered,
      totalReceivedQty: totalReceived,
      totalRemainingQty: Math.max(0, totalOrdered - totalReceived),
      receivingProgress,
      receivingStatus,
    };
  }

  static async attachReceivingProgress(orders) {
    const list = Array.isArray(orders) ? orders : [orders];
    if (!list.length) return orders;

    const orderIds = list.map((o) => o.id);
    const companyIds = [
      ...new Set(list.map((o) => o.companyId).filter(Boolean)),
    ];

    const grns = await prisma.goodsReceiving.findMany({
      where: {
        isActive: true,
        isDeleted: false,
        status: { not: 'Cancelled' },
        ...(companyIds.length === 1 ? { companyId: companyIds[0] } : {}),
        OR: [
          { purchaseOrderId: { in: orderIds } },
          { purchaseOrders: { some: { purchaseOrderId: { in: orderIds } } } },
        ],
      },
      select: {
        id: true,
        purchaseOrderId: true,
        purchaseOrders: {
          select: { purchaseOrderId: true },
        },
        items: {
          select: {
            purchaseOrderItemId: true,
            purchaseOrderId: true,
            productId: true,
            receivingQuantity: true,
          },
        },
      },
    });

    const enrich = (order) => {
      const progress = this.buildReceivedQuantitiesForOrder(order, grns);
      let status = order.status;
      if (progress.totalReceivedQty > 0 && order.status !== 'Cancelled') {
        status = progress.totalReceivedQty >= progress.totalOrderedQty ? 'Received' : 'Partially Received';
      }
      return {
        ...order,
        ...progress,
        status,
      };
    };

    return Array.isArray(orders) ? list.map(enrich) : enrich(list[0]);
  }

  // ============================================================
  // GET PURCHASE ORDER BY ID
  // ============================================================
  static async findById(id) {
    const order = await prisma.purchaseOrder.findUnique({
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

    if (!order) return null;

    return this.attachReceivingProgress({
      ...order,
      totalItems: order.items.reduce((sum, item) => sum + item.quantity, 0),
    });
  }

  // ============================================================
  // GET PURCHASE ORDER BY NUMBER
  // ============================================================
  static async findByOrderNumber(orderNumber) {
    const order = await prisma.purchaseOrder.findUnique({
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

    if (!order) return null;

    // Calculate totalItems
    return {
      ...order,
      totalItems: order.items.reduce((sum, item) => sum + item.quantity, 0)
    };
  }

  // ============================================================
  // GET ALL PURCHASE ORDERS WITH FILTERS
  // ============================================================
  static async findAll(filter = {}, options = {}) {
    const { skip, take, orderBy = { orderDate: 'desc' } } = options;
    
    // ✅ FIXED: Map userId to createdBy if present
    const cleanFilter = { ...filter };
    if (cleanFilter.userId) {
      cleanFilter.createdBy = cleanFilter.userId;
      delete cleanFilter.userId;
    }
    
    const orders = await prisma.purchaseOrder.findMany({
      where: {
        ...cleanFilter,
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

    const mapped = orders.map((order) => ({
      ...order,
      totalItems: order.items.reduce((sum, item) => sum + item.quantity, 0),
    }));

    return this.attachReceivingProgress(mapped);
  }

  static async count(filter = {}) {
    // ✅ FIXED: Map userId to createdBy if present
    const cleanFilter = { ...filter };
    if (cleanFilter.userId) {
      cleanFilter.createdBy = cleanFilter.userId;
      delete cleanFilter.userId;
    }
    
    return await prisma.purchaseOrder.count({
      where: {
        ...cleanFilter,
        isActive: true,
        isDeleted: false
      }
    });
  }

  static async update(id, data) {
    return await prisma.$transaction(async (tx) => {
      const purchaseOrder = await tx.purchaseOrder.findUnique({
        where: { id },
        include: { items: true }
      });

      if (!purchaseOrder) {
        throw new Error('Purchase order not found');
      }

      if (purchaseOrder.status === 'Cancelled') {
        throw new Error('Cannot update cancelled purchase order');
      }

      if (purchaseOrder.status === 'Approved') {
        throw new Error('Cannot update approved purchase order');
      }
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

      if (data.items) {
        await tx.purchaseOrderItem.deleteMany({
          where: { purchaseOrderId: id }
        });

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

      // Calculate totalItems
      return {
        ...updatedOrder,
        totalItems: updatedOrder.items.reduce((sum, item) => sum + item.quantity, 0)
      };
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

    const validTransitions = {
      'Draft': ['Sent', 'Cancelled'],
      'Sent': ['Approved', 'Cancelled'],
      'Approved': ['Partially Received', 'Received', 'Cancelled'],
      'Partially Received': ['Received', 'Cancelled'],
      'Received': ['Cancelled'],
      'Cancelled': []
    };

    if (!validTransitions[purchaseOrder.status]?.includes(status)) {
      throw new Error(`Cannot transition from ${purchaseOrder.status} to ${status}`);
    }

    const updateData = {
      status,
      updatedBy: userId
    };

    if (status === 'Sent') {
      updateData.sentAt = new Date();
    } else if (status === 'Approved') {
      updateData.approvedAt = new Date();
    } else if (status === 'Cancelled') {
      updateData.cancelledAt = new Date();
    }

    const updatedOrder = await prisma.purchaseOrder.update({
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

    // Calculate totalItems
    return {
      ...updatedOrder,
      totalItems: updatedOrder.items.reduce((sum, item) => sum + item.quantity, 0)
    };
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

      // Calculate totalItems
      return {
        ...updatedOrder,
        totalItems: updatedOrder.items.reduce((sum, item) => sum + item.quantity, 0)
      };
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

    const updatedOrder = await prisma.purchaseOrder.update({
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

    // Calculate totalItems
    return {
      ...updatedOrder,
      totalItems: updatedOrder.items.reduce((sum, item) => sum + item.quantity, 0)
    };
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

  static async getStats(companyId, locationId = null) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);

    const baseFilter = {
      isActive: true,
      isDeleted: false,
      ...(companyId ? { companyId } : {}),
      ...(locationId ? { locationId: String(locationId) } : {}),
    };

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

    const [draft, sent, approved, partiallyReceived, received, cancelled] =
      await Promise.all([
        prisma.purchaseOrder.count({ where: { ...baseFilter, status: 'Draft' } }),
        prisma.purchaseOrder.count({ where: { ...baseFilter, status: 'Sent' } }),
        prisma.purchaseOrder.count({ where: { ...baseFilter, status: 'Approved' } }),
        prisma.purchaseOrder.count({
          where: { ...baseFilter, status: 'Partially Received' }
        }),
        prisma.purchaseOrder.count({
          where: { ...baseFilter, status: 'Received' }
        }),
        prisma.purchaseOrder.count({
          where: { ...baseFilter, status: 'Cancelled' }
        }),
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
        partiallyReceived,
        received,
        cancelled,
        total:
          draft +
          sent +
          approved +
          partiallyReceived +
          received +
          cancelled
      }
    };
  }

  static async getSummary(companyId) {  
    const baseFilter = {
      isActive: true,
      isDeleted: false,
      companyId: companyId  
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

  static async getSupplierSummary(companyId, supplierId) {  
    const baseFilter = {
      isActive: true,
      isDeleted: false,
      companyId: companyId, 
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