// warehouse/models/Order.js - COMPLETE CORRECTED

const prisma = require('../../prisma/client');

// ─── Generate Order Number Function ──────────────────────
function generateOrderNumber(orderType) {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  
  let prefix = 'ORD';
  if (orderType === 'Sales Order') prefix = 'SO';
  else if (orderType === 'Purchase Order') prefix = 'PO';
  
  return `${prefix}-${year}${month}${day}-${random}`;
}

class OrderModel {
  // ============================================================
  // CREATE ORDER (Sales or Purchase)
  // ============================================================
  static async create(data) {
    const orderNumber = generateOrderNumber(data.orderType || 'Sales Order');
    
    return await prisma.$transaction(async (tx) => {
      // Create order
      const order = await tx.order.create({
        data: {
          orderNumber,
          orderDate: new Date(),
          customerName: data.customerName,
          customerEmail: data.customerEmail,
          customerPhone: data.customerPhone,
          customerType: data.customerType || 'Individual',
          customerCompany: data.customerCompany,
          customerTaxId: data.customerTaxId,
          shippingAddress: data.shippingAddress || {},
          billingAddress: data.billingAddress || {},
          subtotal: data.subtotal,
          taxTotal: data.taxTotal || 0,
          shippingCost: data.shippingCost || 0,
          discountTotal: data.discountTotal || 0,
          grandTotal: data.grandTotal,
          totalWeight: data.totalWeight || 0,
          totalItems: data.totalItems || 0,
          orderType: data.orderType || 'Sales Order',
          priority: data.priority || 'Medium',
          source: data.source || 'Web',
          salesPerson: data.salesPerson || '',
          expectedDeliveryDate: data.expectedDeliveryDate,
          shippingMethod: data.shippingMethod || 'Standard',
          shippingCarrier: data.shippingCarrier || '',
          paymentMethod: data.paymentMethod || 'Cash',
          paymentStatus: data.paymentStatus || 'Pending',
          couponCode: data.couponCode || '',
          customerNotes: data.customerNotes || '',
          internalNotes: data.internalNotes || '',
          tags: data.tags || [],
          createdBy: data.createdBy || data.userId,  // ✅ Use createdBy
          companyId: data.companyId,                 // ✅ Use companyId
          // Sales orders start as Pending (not Draft). Draft only if explicitly sent.
          orderStatus:
            data.orderStatus ||
            (data.orderType === 'Purchase Order' ? 'Draft' : 'Pending'),
          fulfillmentStatus: data.fulfillmentStatus || 'Not Started',
          approvalStatus: data.approvalStatus || 'Pending',
          isActive: true,
          isDeleted: false
        },
        include: {
          creator: {
            select: { id: true, firstName: true, lastName: true, email: true }
          }
        }
      });

      // Create order items
      for (const item of data.items) {
        await tx.orderItem.create({
          data: {
            orderId: order.id,
            productId: item.productId,
            productName: item.productName,
            sku: item.sku,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            totalPrice: item.totalPrice,
            weight: item.weight || 0,
            weightUnit: item.weightUnit || 'KG',
            dimensions: item.dimensions || '',
            taxRate: item.taxRate || 0,
            taxAmount: item.taxAmount || 0,
            discount: item.discount || 0,
            batchNumber: item.batchNumber || '',
            serialNumber: item.serialNumber || '',
            notes: item.notes || ''
          }
        });

        // Reserve stock for Sales Orders (physical issue happens on delivery confirm)
        if (data.orderType !== 'Purchase Order') {
          await tx.product.update({
            where: { id: item.productId },
            data: {
              reservedStock: { increment: item.quantity },
              availableStock: { decrement: item.quantity },
            },
          });
        }
      }

      // Return order with items
      return await tx.order.findUnique({
        where: { id: order.id },
        include: {
          items: true,
          creator: {
            select: { id: true, firstName: true, lastName: true, email: true }
          }
        }
      });
    });
  }

  // ============================================================
  // GET ALL ORDERS WITH FILTERS
  // ============================================================
  static async findAll(filter = {}, options = {}) {
    const { skip, take, orderBy = { orderDate: 'desc' } } = options;
    
    return await prisma.order.findMany({
      where: filter,
      skip,
      take,
      orderBy,
      include: {
        items: true,
        creator: {
          select: { id: true, firstName: true, lastName: true, email: true }
        },
        picker: {
          select: { id: true, firstName: true, lastName: true }
        },
        packer: {
          select: { id: true, firstName: true, lastName: true }
        },
        shipper: {
          select: { id: true, firstName: true, lastName: true }
        },
        updater: {
          select: { id: true, firstName: true, lastName: true, email: true }
        }
      }
    });
  }

  // ============================================================
  // GET SALES ORDERS ONLY
  // ============================================================
  static async findSalesOrders(filter = {}, options = {}) {
    return await this.findAll({
      ...filter,
      orderType: 'Sales Order'
    }, options);
  }

  // ============================================================
  // GET PURCHASE ORDERS ONLY
  // ============================================================
  static async findPurchaseOrders(filter = {}, options = {}) {
    return await this.findAll({
      ...filter,
      orderType: 'Purchase Order'
    }, options);
  }

  // ============================================================
  // COUNT ORDERS
  // ============================================================
  static async count(filter = {}) {
    return await prisma.order.count({ where: filter });
  }

  // ============================================================
  // COUNT SALES ORDERS - ✅ FIXED
  // ============================================================
  static async countSalesOrders(filter = {}) {
    // Map userId to createdBy if present
    const cleanFilter = { ...filter };
    if (cleanFilter.userId) {
      cleanFilter.createdBy = cleanFilter.userId;
      delete cleanFilter.userId;
    }
    
    return await prisma.order.count({
      where: {
        ...cleanFilter,
        orderType: 'Sales Order'
      }
    });
  }

  // ============================================================
  // COUNT PURCHASE ORDERS - ✅ FIXED
  // ============================================================
  static async countPurchaseOrders(filter = {}) {
    // Map userId to createdBy if present
    const cleanFilter = { ...filter };
    if (cleanFilter.userId) {
      cleanFilter.createdBy = cleanFilter.userId;
      delete cleanFilter.userId;
    }
    
    return await prisma.order.count({
      where: {
        ...cleanFilter,
        orderType: 'Purchase Order'
      }
    });
  }

  // ============================================================
  // FIND ORDER BY ID
  // ============================================================
  static async findById(id) {
    return await prisma.order.findUnique({
      where: { id },
      include: {
        items: {
          include: {
            product: {
              select: { id: true, name: true, sku: true }
            }
          }
        },
        creator: {
          select: { id: true, firstName: true, lastName: true, email: true }
        },
        picker: {
          select: { id: true, firstName: true, lastName: true }
        },
        packer: {
          select: { id: true, firstName: true, lastName: true }
        },
        shipper: {
          select: { id: true, firstName: true, lastName: true }
        },
        updater: {
          select: { id: true, firstName: true, lastName: true, email: true }
        }
      }
    });
  }

  // ============================================================
  // FIND ORDER BY ORDER NUMBER
  // ============================================================
  static async findByOrderNumber(orderNumber) {
    return await prisma.order.findUnique({
      where: { orderNumber },
      include: {
        items: {
          include: {
            product: {
              select: { id: true, name: true, sku: true }
          }
        }
        },
        creator: {
          select: { id: true, firstName: true, lastName: true, email: true }
        }
      }
    });
  }

  // ============================================================
  // UPDATE ORDER
  // ============================================================
  static async update(id, data) {
    return await prisma.order.update({
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
  // UPDATE ORDER STATUS
  // ============================================================
  static async updateStatus(id, status, userId, notes = '') {
    const order = await prisma.order.findUnique({ where: { id } });
    if (!order) return null;

    let orderNotes = order.orderNotes || [];
    orderNotes.push({
      text: `Status changed to ${status}${notes ? `: ${notes}` : ''}`,
      createdBy: userId,
      createdAt: new Date()
    });

    const updateData = {
      orderStatus: status,
      updatedBy: userId,
      orderNotes: orderNotes
    };

    if (status === 'Shipped') {
      updateData.shippingDate = new Date();
    }
    if (status === 'Delivered') {
      updateData.deliveryDate = new Date();
    }

    return await prisma.order.update({
      where: { id },
      data: updateData,
      include: {
        items: true,
        creator: {
          select: { id: true, firstName: true, lastName: true, email: true }
        }
      }
    });
  }

  // ============================================================
  // UPDATE PAYMENT STATUS
  // ============================================================
  static async updatePayment(id, paymentStatus, paymentReference = null, userId) {
    const updateData = {
      paymentStatus,
      updatedBy: userId
    };

    if (paymentStatus === 'Paid') {
      updateData.paymentDate = new Date();
    }
    if (paymentReference) {
      updateData.paymentReference = paymentReference;
    }

    return await prisma.order.update({
      where: { id },
      data: updateData,
      include: {
        items: true,
        creator: {
          select: { id: true, firstName: true, lastName: true, email: true }
        }
      }
    });
  }

  // ============================================================
  // CANCEL ORDER (with stock return)
  // ============================================================
  static async cancelOrder(id, userId, reason = '') {
    return await prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { id },
        include: { items: true }
      });

      if (!order) return null;

      if (order.orderType !== 'Purchase Order') {
        const deliveries = await tx.delivery.findMany({
          where: { salesOrderId: id, isActive: true, isDeleted: false },
          include: { items: true },
        });
        const deliveredByProduct = {};
        for (const d of deliveries) {
          if (!d.confirmedAt) continue;
          for (const di of d.items || []) {
            deliveredByProduct[di.productId] =
              (deliveredByProduct[di.productId] || 0) +
              (Number(di.deliveredQuantity) || 0);
          }
        }

        for (const item of order.items) {
          const delivered = deliveredByProduct[item.productId] || 0;
          const toRelease = Math.max(0, item.quantity - delivered);
          if (toRelease <= 0) continue;
          await tx.product.update({
            where: { id: item.productId },
            data: {
              reservedStock: { decrement: toRelease },
              availableStock: { increment: toRelease },
            },
          });
        }
      }

      let orderNotes = order.orderNotes || [];
      orderNotes.push({
        text: `Order cancelled${reason ? `: ${reason}` : ''}`,
        createdBy: userId,
        createdAt: new Date()
      });

      return await tx.order.update({
        where: { id },
        data: {
          orderStatus: 'Cancelled',
          updatedBy: userId,
          orderNotes: orderNotes
        },
        include: {
          items: true,
          creator: {
            select: { id: true, firstName: true, lastName: true, email: true }
          }
        }
      });
    });
  }

  // ============================================================
  // SOFT DELETE ORDER
  // ============================================================
  static async softDelete(id, userId) {
    return await prisma.order.update({
      where: { id },
      data: {
        isActive: false,
        isDeleted: true,
        updatedBy: userId
      }
    });
  }

  // ============================================================
  // GET ORDER STATS / KPI (by type) - ✅ FIXED
  // ============================================================
  static async getStats(userId, orderType = null) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const startOfWeek = new Date(today);
    startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());
    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);

    // ✅ FIXED: Use createdBy instead of userId
    const activeFilter = {
      isActive: true,
      createdBy: userId
    };

    if (orderType) {
      activeFilter.orderType = orderType;
    }

    const [todayOrders, todayRevenue, weekOrders, monthOrders, monthRevenue] = await Promise.all([
      prisma.order.count({
        where: {
          ...activeFilter,
          orderDate: {
            gte: today,
            lt: tomorrow
          }
        }
      }),
      prisma.order.aggregate({
        where: {
          ...activeFilter,
          orderDate: {
            gte: today,
            lt: tomorrow
          }
        },
        _sum: { grandTotal: true }
      }),
      prisma.order.count({
        where: {
          ...activeFilter,
          orderDate: {
            gte: startOfWeek
          }
        }
      }),
      prisma.order.count({
        where: {
          ...activeFilter,
          orderDate: {
            gte: startOfMonth
          }
        }
      }),
      prisma.order.aggregate({
        where: {
          ...activeFilter,
          orderDate: {
            gte: startOfMonth
          }
        },
        _sum: { grandTotal: true }
      })
    ]);

    return {
      today: {
        orders: todayOrders,
        revenue: todayRevenue._sum.grandTotal || 0
      },
      week: {
        orders: weekOrders
      },
      month: {
        orders: monthOrders,
        revenue: monthRevenue._sum.grandTotal || 0
      }
    };
  }

  // ============================================================
  // SYNC ORDER PAYMENT / STATUS FROM LINKED INVOICES
  // ============================================================
  /**
   * Align order.paymentStatus (and lift Draft) from SalesInvoice + WarehouseInvoice.
   * Order payment labels: Pending | Partial | Paid
   */
  static async syncFromInvoices(orderId, client = prisma) {
    if (!orderId) return null;

    const order = await client.order.findUnique({ where: { id: orderId } });
    if (!order || order.isDeleted) return null;

    const [salesInvoices, warehouseInvoices] = await Promise.all([
      client.salesInvoice.findMany({
        where: {
          orderId,
          isActive: true,
          isDeleted: false,
          invoiceStatus: { notIn: ['Cancelled'] }
        },
        select: {
          grandTotal: true,
          paidAmount: true,
          outstanding: true,
          invoiceStatus: true,
          paymentStatus: true
        }
      }),
      client.warehouseInvoice.findMany({
        where: {
          orderId,
          isActive: true,
          isDeleted: false,
          invoiceStatus: { notIn: ['Cancelled', 'Draft'] }
        },
        select: {
          grandTotal: true,
          paidAmount: true,
          outstanding: true,
          invoiceStatus: true,
          paymentStatus: true
        }
      }),
    ]);

    const invoices = [...salesInvoices, ...warehouseInvoices];
    if (invoices.length === 0) {
      // No invoice yet — still lift stuck Draft → Pending for sales orders
      if (
        order.orderType === 'Sales Order' &&
        order.orderStatus === 'Draft'
      ) {
        return client.order.update({
          where: { id: orderId },
          data: { orderStatus: 'Pending' }
        });
      }
      return order;
    }

    const total = invoices.reduce((s, inv) => s + Number(inv.grandTotal || 0), 0);
    const paid = invoices.reduce((s, inv) => s + Number(inv.paidAmount || 0), 0);
    // Prefer outstanding (reflects payments + credit notes); fall back to cash-only
    const due = invoices.reduce((s, inv) => {
      const status = String(inv.paymentStatus || inv.invoiceStatus || '');
      if (status === 'Paid' || status === 'Credit Balance' || status === 'Cancelled') {
        return s;
      }
      if (inv.outstanding != null && inv.outstanding !== undefined) {
        return s + Math.max(0, Number(inv.outstanding) || 0);
      }
      return s + Math.max(0, Number(inv.grandTotal || 0) - Number(inv.paidAmount || 0));
    }, 0);

    let paymentStatus = 'Pending';
    if (due <= 0.01) paymentStatus = 'Paid';
    else if (paid > 0.0001 || due < total - 0.01) paymentStatus = 'Partial';

    const updateData = {};
    if (order.paymentStatus !== paymentStatus) {
      updateData.paymentStatus = paymentStatus;
      if (paymentStatus === 'Paid') updateData.paymentDate = new Date();
    }

    // Lift Draft once real invoice activity exists
    if (order.orderStatus === 'Draft') {
      updateData.orderStatus =
        paymentStatus === 'Paid' || paymentStatus === 'Partial'
          ? 'Processing'
          : 'Pending';
    }

    if (Object.keys(updateData).length === 0) return order;

    return client.order.update({
      where: { id: orderId },
      data: updateData
    });
  }

  static async syncManyFromInvoices(orderIds = [], client = prisma) {
    const unique = [...new Set((orderIds || []).filter(Boolean))];
    if (unique.length === 0) return [];
    const results = [];
    for (const id of unique) {
      results.push(await this.syncFromInvoices(id, client));
    }
    return results;
  }

  // ============================================================
  // GET STATUS COUNTS (KPI) - by type - ✅ FIXED
  // ============================================================
  static async getStatusCounts(userId, orderType = null) {
    // ✅ FIXED: Use createdBy instead of userId
    const activeFilter = {
      isActive: true,
      createdBy: userId
    };

    if (orderType) {
      activeFilter.orderType = orderType;
    }
    
    const [total, draft, pending, processing, packed, shipped, inTransit, delivered, cancelled, returned, onHold, paidOrders, partialOrders] = await Promise.all([
      prisma.order.count({ where: activeFilter }),
      prisma.order.count({ where: { ...activeFilter, orderStatus: 'Draft' } }),
      prisma.order.count({ where: { ...activeFilter, orderStatus: 'Pending' } }),
      prisma.order.count({ where: { ...activeFilter, orderStatus: 'Processing' } }),
      prisma.order.count({ where: { ...activeFilter, orderStatus: 'Packed' } }),
      prisma.order.count({ where: { ...activeFilter, orderStatus: 'Shipped' } }),
      prisma.order.count({ where: { ...activeFilter, orderStatus: 'In Transit' } }),
      prisma.order.count({ where: { ...activeFilter, orderStatus: 'Delivered' } }),
      prisma.order.count({ where: { ...activeFilter, orderStatus: 'Cancelled' } }),
      prisma.order.count({ where: { ...activeFilter, orderStatus: 'Returned' } }),
      prisma.order.count({ where: { ...activeFilter, orderStatus: 'On Hold' } }),
      prisma.order.count({ where: { ...activeFilter, paymentStatus: 'Paid' } }),
      prisma.order.count({ where: { ...activeFilter, paymentStatus: 'Partial' } }),
    ]);

    const revenue = await prisma.order.aggregate({
      where: {
        ...activeFilter,
        orderStatus: 'Delivered'
      },
      _sum: { grandTotal: true }
    });

    return {
      total,
      draft,
      pending,
      processing,
      packed,
      shipped,
      inTransit,
      delivered,
      cancelled,
      returned,
      onHold,
      paid: paidOrders,
      partial: partialOrders,
      revenue: revenue._sum.grandTotal || 0
    };
  }
}

module.exports = OrderModel;