// warehouse/models/Delivery.js - FIXED DUPLICATE EMAIL ISSUE

const prisma = require('../../prisma/client');

// ─── Generate Delivery Number Function ──────────────────────
function generateDeliveryNumber() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  
  return `DLV-${year}${month}${day}-${random}`;
}

// ─── Helper: Find or Create Customer ────────────────────────
async function findOrCreateCustomer(tx, salesOrder, userId, createdBy) {
  let customerId = salesOrder.customerId;
  let customer = null;

  // If customerId exists, verify it's valid
  if (customerId) {
    customer = await tx.customer.findUnique({
      where: { id: customerId }
    });
    if (customer) {
      return { customerId, customer };
    }
    // If customer doesn't exist, reset customerId
    customerId = null;
  }

  // Try to find existing customer by email (most reliable)
  if (salesOrder.customerEmail) {
    customer = await tx.customer.findFirst({
      where: {
        email: salesOrder.customerEmail,
        userId: userId,
        isActive: true,
        isDeleted: false
      }
    });
    if (customer) {
      // Update sales order with found customer
      await tx.order.update({
        where: { id: salesOrder.id },
        data: { customerId: customer.id }
      });
      return { customerId: customer.id, customer };
    }
  }

  // Try to find by phone if email not found
  if (salesOrder.customerPhone) {
    customer = await tx.customer.findFirst({
      where: {
        phone: salesOrder.customerPhone,
        userId: userId,
        isActive: true,
        isDeleted: false
      }
    });
    if (customer) {
      // Update sales order with found customer
      await tx.order.update({
        where: { id: salesOrder.id },
        data: { customerId: customer.id }
      });
      return { customerId: customer.id, customer };
    }
  }

  // Try to find by name and company (fallback)
  if (salesOrder.customerName) {
    customer = await tx.customer.findFirst({
      where: {
        name: salesOrder.customerName,
        userId: userId,
        isActive: true,
        isDeleted: false
      }
    });
    if (customer) {
      await tx.order.update({
        where: { id: salesOrder.id },
        data: { customerId: customer.id }
      });
      return { customerId: customer.id, customer };
    }
  }

  // Generate unique customer number
  const customerNumber = `CUS-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  
  // Create new customer with unique email handling
  let email = salesOrder.customerEmail;
  let phone = salesOrder.customerPhone;
  
  // Check if email already exists in the system (for different user)
  if (email) {
    const existingEmail = await tx.customer.findFirst({
      where: {
        email: email,
        isActive: true,
        isDeleted: false
      }
    });
    if (existingEmail) {
      // If email exists, use a modified email or null
      email = null;
    }
  }

  // Check if phone already exists
  if (phone) {
    const existingPhone = await tx.customer.findFirst({
      where: {
        phone: phone,
        isActive: true,
        isDeleted: false
      }
    });
    if (existingPhone) {
      phone = null;
    }
  }

  try {
    customer = await tx.customer.create({
      data: {
        customerNumber: customerNumber,
        name: salesOrder.customerName || 'Unknown Customer',
        email: email,
        phone: phone,
        company: salesOrder.customerCompany || null,
        customerType: salesOrder.customerType || 'Individual',
        userId: userId,
        createdBy: createdBy,
        isActive: true
      }
    });

    // Update sales order with new customer
    await tx.order.update({
      where: { id: salesOrder.id },
      data: { customerId: customer.id }
    });

    return { customerId: customer.id, customer };
  } catch (error) {
    // If creation fails due to unique constraint, try to find the existing customer
    if (error.code === 'P2002') {
      // Try to find by email again
      if (email) {
        const existing = await tx.customer.findFirst({
          where: {
            email: email,
            isActive: true,
            isDeleted: false
          }
        });
        if (existing) {
          await tx.order.update({
            where: { id: salesOrder.id },
            data: { customerId: existing.id }
          });
          return { customerId: existing.id, customer: existing };
        }
      }
      // Try to find by phone
      if (phone) {
        const existing = await tx.customer.findFirst({
          where: {
            phone: phone,
            isActive: true,
            isDeleted: false
          }
        });
        if (existing) {
          await tx.order.update({
            where: { id: salesOrder.id },
            data: { customerId: existing.id }
          });
          return { customerId: existing.id, customer: existing };
        }
      }
    }
    throw error;
  }
}

class DeliveryModel {
  // ============================================================
  // CREATE DELIVERY AGAINST SALES ORDER
  // ============================================================
  static async create(data) {
    const deliveryNumber = generateDeliveryNumber();
    
    return await prisma.$transaction(async (tx) => {
      // Get sales order with items
      const salesOrder = await tx.order.findUnique({
        where: { id: data.salesOrderId },
        include: {
          items: {
            include: {
              product: true
            }
          },
          customer: true
        }
      });

      if (!salesOrder) {
        throw new Error('Sales order not found');
      }

      // ✅ Find or create customer
      const { customerId, customer } = await findOrCreateCustomer(
        tx,
        salesOrder,
        salesOrder.userId || data.userId,
        data.createdBy
      );

      // Get existing deliveries for this order
      const existingDeliveries = await tx.delivery.findMany({
        where: {
          salesOrderId: data.salesOrderId,
          isActive: true,
          isDeleted: false
        },
        include: {
          items: true
        }
      });

      // Calculate already delivered quantities per product
      const deliveredQuantities = {};
      for (const delivery of existingDeliveries) {
        for (const item of delivery.items) {
          deliveredQuantities[item.productId] = 
            (deliveredQuantities[item.productId] || 0) + item.deliveredQuantity;
        }
      }

      // Process delivery items
      let totalDeliveredQuantity = 0;
      const deliveryItems = [];

      for (const item of data.items) {
        const orderItem = salesOrder.items.find(oi => oi.productId === item.productId);
        
        if (!orderItem) {
          throw new Error(`Product ${item.productId} not found in sales order`);
        }

        const alreadyDelivered = deliveredQuantities[item.productId] || 0;
        const orderedQuantity = orderItem.quantity;
        const remainingQuantity = orderedQuantity - alreadyDelivered;

        if (item.deliveredQuantity <= 0) {
          throw new Error(`Delivered quantity must be greater than 0 for product ${orderItem.productName}`);
        }

        if (item.deliveredQuantity > remainingQuantity) {
          throw new Error(
            `Delivered quantity (${item.deliveredQuantity}) exceeds remaining quantity (${remainingQuantity}) for product ${orderItem.productName}`
          );
        }

        // Check stock availability
        const product = await tx.product.findUnique({
          where: { id: item.productId }
        });

        if (!product) {
          throw new Error(`Product ${item.productId} not found`);
        }

        if (product.currentStock < item.deliveredQuantity) {
          throw new Error(
            `Insufficient stock for product ${orderItem.productName}. Available: ${product.currentStock}, Required: ${item.deliveredQuantity}`
          );
        }

        deliveryItems.push({
          productId: item.productId,
          productName: orderItem.productName,
          sku: orderItem.sku,
          unit: product.stockUnitName || 'Pcs',
          orderedQuantity: orderedQuantity,
          deliveredQuantity: item.deliveredQuantity,
          remainingQuantity: remainingQuantity - item.deliveredQuantity,
          notes: item.notes || ''
        });

        totalDeliveredQuantity += item.deliveredQuantity;
      }

      // Determine delivery status
      let deliveryStatus = 'Pending';
      const allItemsFullyDelivered = deliveryItems.every(item => item.remainingQuantity === 0);
      
      if (allItemsFullyDelivered) {
        deliveryStatus = 'Delivered';
      } else if (totalDeliveredQuantity > 0) {
        deliveryStatus = 'Partially Delivered';
      }

      // Create delivery with validated customerId
      const delivery = await tx.delivery.create({
        data: {
          deliveryNumber,
          salesOrderId: data.salesOrderId,
          salesOrderNumber: salesOrder.orderNumber,
          customerId: customerId,
          customerName: customer?.name || salesOrder.customerName || 'Unknown Customer',
          deliveryDate: new Date(data.deliveryDate),
          deliveryStatus,
          deliveryPerson: data.deliveryPerson || null,
          trackingNumber: data.trackingNumber || null,
          notes: data.notes || null,
          createdBy: data.createdBy,
          userId: data.userId,
          items: {
            create: deliveryItems
          }
        },
        include: {
          items: true,
          salesOrder: {
            include: {
              customer: true
            }
          }
        }
      });

      // Update sales order status if fully delivered
      if (deliveryStatus === 'Delivered') {
        await tx.order.update({
          where: { id: data.salesOrderId },
          data: {
            deliveryDate: new Date(),
            orderStatus: 'Delivered'
          }
        });
      } else if (deliveryStatus === 'Partially Delivered') {
        // Only update if not already Delivered or Cancelled
        if (salesOrder.orderStatus !== 'Delivered' && salesOrder.orderStatus !== 'Cancelled') {
          await tx.order.update({
            where: { id: data.salesOrderId },
            data: {
              orderStatus: 'Partially Delivered'
            }
          });
        }
      }

      return delivery;
    });
  }

  // ============================================================
  // CONFIRM DELIVERY (Reduce Stock)
  // ============================================================
  static async confirmDelivery(id, userId) {
    return await prisma.$transaction(async (tx) => {
      const delivery = await tx.delivery.findUnique({
        where: { id },
        include: {
          items: {
            include: {
              product: true
            }
          },
          salesOrder: true
        }
      });

      if (!delivery) {
        throw new Error('Delivery not found');
      }

      if (delivery.deliveryStatus === 'Delivered') {
        throw new Error('Delivery is already confirmed');
      }

      if (delivery.confirmedAt) {
        throw new Error('Delivery has already been confirmed');
      }

      // Update stock for each item
      for (const item of delivery.items) {
        if (item.deliveredQuantity > 0) {
          const product = await tx.product.findUnique({
            where: { id: item.productId }
          });

          if (!product) {
            throw new Error(`Product ${item.productId} not found`);
          }

          // Reduce stock
          const newStock = product.currentStock - item.deliveredQuantity;
          
          if (newStock < 0) {
            throw new Error(
              `Insufficient stock for product ${product.name}. Available: ${product.currentStock}, Required: ${item.deliveredQuantity}`
            );
          }

          // Update product stock
          await tx.product.update({
            where: { id: item.productId },
            data: {
              currentStock: newStock,
              availableStock: Math.max(0, newStock - product.reservedStock)
            }
          });

          // Create stock movement record
          await tx.stockMovement.create({
            data: {
              productId: item.productId,
              productName: item.productName,
              type: 'Delivery',
              quantity: -item.deliveredQuantity,
              previousStock: product.currentStock,
              newStock: newStock,
              reason: `Delivery #${delivery.deliveryNumber} confirmed`,
              reference: delivery.deliveryNumber,
              status: 'Completed',
              createdBy: userId,
              userId: delivery.userId
            }
          });
        }
      }

      // Update delivery status to Delivered
      const updatedDelivery = await tx.delivery.update({
        where: { id },
        data: {
          deliveryStatus: 'Delivered',
          confirmedBy: userId,
          confirmedAt: new Date(),
          updatedBy: userId
        },
        include: {
          items: {
            include: {
              product: true
            }
          },
          salesOrder: {
            include: {
              customer: true
            }
          }
        }
      });

      // Update sales order delivery status
      await tx.order.update({
        where: { id: delivery.salesOrderId },
        data: {
          deliveryDate: new Date(),
          orderStatus: 'Delivered'
        }
      });

      return updatedDelivery;
    });
  }

  // ============================================================
  // GET DELIVERY BY ID
  // ============================================================
  static async findById(id) {
    return await prisma.delivery.findUnique({
      where: { id },
      include: {
        items: {
          include: {
            product: {
              select: { id: true, name: true, sku: true }
            }
          }
        },
        salesOrder: {
          include: {
            customer: true,
            items: true
          }
        },
        customer: true,
        creator: {
          select: { id: true, firstName: true, lastName: true, email: true }
        },
        confirmer: {
          select: { id: true, firstName: true, lastName: true, email: true }
        },
        updater: {
          select: { id: true, firstName: true, lastName: true, email: true }
        }
      }
    });
  }

  // ============================================================
  // GET DELIVERY BY DELIVERY NUMBER
  // ============================================================
  static async findByDeliveryNumber(deliveryNumber) {
    return await prisma.delivery.findUnique({
      where: { deliveryNumber },
      include: {
        items: {
          include: {
            product: {
              select: { id: true, name: true, sku: true }
            }
          }
        },
        salesOrder: {
          include: {
            customer: true
          }
        },
        creator: {
          select: { id: true, firstName: true, lastName: true, email: true }
        },
        confirmer: {
          select: { id: true, firstName: true, lastName: true, email: true }
        }
      }
    });
  }

  // ============================================================
  // GET DELIVERIES BY SALES ORDER
  // ============================================================
  static async findBySalesOrder(salesOrderId) {
    return await prisma.delivery.findMany({
      where: {
        salesOrderId,
        isActive: true,
        isDeleted: false
      },
      include: {
        items: {
          include: {
            product: {
              select: { id: true, name: true, sku: true }
            }
          }
        },
        salesOrder: {
          include: {
            customer: true
          }
        },
        creator: {
          select: { id: true, firstName: true, lastName: true, email: true }
        },
        confirmer: {
          select: { id: true, firstName: true, lastName: true, email: true }
        }
      },
      orderBy: {
        createdAt: 'desc'
      }
    });
  }

  // ============================================================
  // GET ALL DELIVERIES WITH FILTERS
  // ============================================================
  static async findAll(filter = {}, options = {}) {
    const { skip, take, orderBy = { deliveryDate: 'desc' } } = options;
    
    return await prisma.delivery.findMany({
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
        salesOrder: {
          include: {
            customer: true
          }
        },
        customer: true,
        creator: {
          select: { id: true, firstName: true, lastName: true, email: true }
        },
        confirmer: {
          select: { id: true, firstName: true, lastName: true, email: true }
        }
      }
    });
  }

  // ============================================================
  // COUNT DELIVERIES
  // ============================================================
  static async count(filter = {}) {
    return await prisma.delivery.count({
      where: {
        ...filter,
        isActive: true,
        isDeleted: false
      }
    });
  }

  // ============================================================
  // UPDATE DELIVERY
  // ============================================================
  static async update(id, data) {
    return await prisma.$transaction(async (tx) => {
      const delivery = await tx.delivery.findUnique({
        where: { id },
        include: {
          items: true,
          salesOrder: {
            include: {
              items: true
            }
          }
        }
      });

      if (!delivery) {
        throw new Error('Delivery not found');
      }

      if (delivery.confirmedAt) {
        throw new Error('Cannot update confirmed delivery');
      }

      // Update delivery header
      const updateData = {
        updatedBy: data.updatedBy,
        ...(data.deliveryDate && { deliveryDate: new Date(data.deliveryDate) }),
        ...(data.deliveryPerson !== undefined && { deliveryPerson: data.deliveryPerson }),
        ...(data.trackingNumber !== undefined && { trackingNumber: data.trackingNumber }),
        ...(data.notes !== undefined && { notes: data.notes })
      };

      // Update items if provided
      if (data.items) {
        // Delete existing items
        await tx.deliveryItem.deleteMany({
          where: { deliveryId: id }
        });

        // Get other deliveries for this order
        const otherDeliveries = await tx.delivery.findMany({
          where: {
            salesOrderId: delivery.salesOrderId,
            id: { not: id },
            isActive: true,
            isDeleted: false
          },
          include: {
            items: true
          }
        });

        // Calculate delivered quantities from other deliveries
        const deliveredQuantities = {};
        for (const d of otherDeliveries) {
          for (const item of d.items) {
            deliveredQuantities[item.productId] = 
              (deliveredQuantities[item.productId] || 0) + item.deliveredQuantity;
          }
        }

        // Process new items
        let totalDeliveredQuantity = 0;
        const deliveryItems = [];

        for (const item of data.items) {
          const orderItem = delivery.salesOrder.items.find(oi => oi.productId === item.productId);
          
          if (!orderItem) {
            throw new Error(`Product ${item.productId} not found in sales order`);
          }

          const alreadyDelivered = deliveredQuantities[item.productId] || 0;
          const orderedQuantity = orderItem.quantity;
          const remainingQuantity = orderedQuantity - alreadyDelivered;

          if (item.deliveredQuantity <= 0) {
            throw new Error(`Delivered quantity must be greater than 0 for product ${orderItem.productName}`);
          }

          if (item.deliveredQuantity > remainingQuantity) {
            throw new Error(
              `Delivered quantity (${item.deliveredQuantity}) exceeds remaining quantity (${remainingQuantity}) for product ${orderItem.productName}`
            );
          }

          deliveryItems.push({
            productId: item.productId,
            productName: orderItem.productName,
            sku: orderItem.sku,
            unit: 'Pcs',
            orderedQuantity: orderedQuantity,
            deliveredQuantity: item.deliveredQuantity,
            remainingQuantity: remainingQuantity - item.deliveredQuantity,
            notes: item.notes || ''
          });

          totalDeliveredQuantity += item.deliveredQuantity;
        }

        // Determine delivery status
        const allItemsFullyDelivered = deliveryItems.every(item => item.remainingQuantity === 0);
        let deliveryStatus = 'Pending';
        
        if (allItemsFullyDelivered) {
          deliveryStatus = 'Delivered';
        } else if (totalDeliveredQuantity > 0) {
          deliveryStatus = 'Partially Delivered';
        }

        updateData.deliveryStatus = deliveryStatus;
        updateData.items = {
          create: deliveryItems
        };
      }

      const updatedDelivery = await tx.delivery.update({
        where: { id },
        data: updateData,
        include: {
          items: {
            include: {
              product: true
            }
          },
          salesOrder: {
            include: {
              customer: true
            }
          }
        }
      });

      // Update sales order status if needed
      if (updatedDelivery.deliveryStatus === 'Delivered') {
        await tx.order.update({
          where: { id: delivery.salesOrderId },
          data: {
            deliveryDate: new Date(),
            orderStatus: 'Delivered'
          }
        });
      } else if (updatedDelivery.deliveryStatus === 'Partially Delivered') {
        const salesOrder = await tx.order.findUnique({
          where: { id: delivery.salesOrderId }
        });
        
        if (salesOrder && salesOrder.orderStatus !== 'Delivered' && salesOrder.orderStatus !== 'Cancelled') {
          await tx.order.update({
            where: { id: delivery.salesOrderId },
            data: {
              orderStatus: 'Partially Delivered'
            }
          });
        }
      }

      return updatedDelivery;
    });
  }

  // ============================================================
  // SOFT DELETE DELIVERY
  // ============================================================
  static async softDelete(id, userId) {
    const delivery = await prisma.delivery.findUnique({
      where: { id }
    });

    if (!delivery) {
      throw new Error('Delivery not found');
    }

    if (delivery.confirmedAt) {
      throw new Error('Cannot delete confirmed delivery');
    }

    return await prisma.delivery.update({
      where: { id },
      data: {
        isDeleted: true,
        isActive: false,
        updatedBy: userId,
        updatedAt: new Date()
      },
      include: {
        items: true
      }
    });
  }

  // ============================================================
  // GET DELIVERY STATS / KPI
  // ============================================================
  static async getStats(userId) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const startOfWeek = new Date(today);
    startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());
    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);

    const baseFilter = {
      isActive: true,
      isDeleted: false,
      userId: userId
    };

    // Today's deliveries
    const todayDeliveries = await prisma.delivery.count({
      where: {
        ...baseFilter,
        deliveryDate: {
          gte: today,
          lt: tomorrow
        }
      }
    });

    // Today's confirmed deliveries
    const todayConfirmed = await prisma.delivery.count({
      where: {
        ...baseFilter,
        deliveryStatus: 'Delivered',
        confirmedAt: {
          gte: today,
          lt: tomorrow
        }
      }
    });

    // Weekly deliveries
    const weekDeliveries = await prisma.delivery.count({
      where: {
        ...baseFilter,
        deliveryDate: {
          gte: startOfWeek
        }
      }
    });

    // Monthly deliveries
    const monthDeliveries = await prisma.delivery.count({
      where: {
        ...baseFilter,
        deliveryDate: {
          gte: startOfMonth
        }
      }
    });

    const monthConfirmed = await prisma.delivery.count({
      where: {
        ...baseFilter,
        deliveryStatus: 'Delivered',
        confirmedAt: {
          gte: startOfMonth
        }
      }
    });

    return {
      today: {
        deliveries: todayDeliveries,
        confirmed: todayConfirmed
      },
      week: {
        deliveries: weekDeliveries
      },
      month: {
        deliveries: monthDeliveries,
        confirmed: monthConfirmed
      }
    };
  }

  // ============================================================
  // GET DELIVERY STATUS COUNTS (KPI)
  // ============================================================
  static async getStatusCounts(userId) {
    const baseFilter = {
      isActive: true,
      isDeleted: false,
      userId: userId
    };

    const [total, pending, partiallyDelivered, delivered] = await Promise.all([
      prisma.delivery.count({ where: baseFilter }),
      prisma.delivery.count({ where: { ...baseFilter, deliveryStatus: 'Pending' } }),
      prisma.delivery.count({ where: { ...baseFilter, deliveryStatus: 'Partially Delivered' } }),
      prisma.delivery.count({ where: { ...baseFilter, deliveryStatus: 'Delivered' } })
    ]);

    return {
      total,
      pending,
      partiallyDelivered,
      delivered
    };
  }

  // ============================================================
  // GET AVAILABLE ORDERS FOR DELIVERY
  // ============================================================
  static async getAvailableOrders(userId, search = '', page = 1, limit = 20) {
    const where = {
      userId: userId,
      isActive: true,
      isDeleted: false,
      orderType: 'Sales Order',
      orderStatus: {
        notIn: ['Delivered', 'Cancelled']
      }
    };

    if (search) {
      where.OR = [
        { orderNumber: { contains: search, mode: 'insensitive' } },
        { customerName: { contains: search, mode: 'insensitive' } }
      ];
    }

    const skip = (page - 1) * limit;

    // Get orders with their deliveries
    const orders = await prisma.order.findMany({
      where,
      include: {
        items: true,
        customer: true,
        deliveries: {
          where: {
            isActive: true,
            isDeleted: false
          },
          include: {
            items: true
          }
        }
      },
      skip,
      take: limit,
      orderBy: {
        orderDate: 'desc'
      }
    });

    const total = await prisma.order.count({ where });

    // Calculate remaining quantities for each order
    const ordersWithRemaining = orders.map(order => {
      // Calculate total delivered per product
      const deliveredQty = {};
      for (const delivery of order.deliveries) {
        for (const item of delivery.items) {
          deliveredQty[item.productId] = (deliveredQty[item.productId] || 0) + item.deliveredQuantity;
        }
      }

      // Calculate remaining items
      const remainingItems = order.items.map(item => ({
        productId: item.productId,
        productName: item.productName,
        sku: item.sku,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        deliveredQuantity: deliveredQty[item.productId] || 0,
        remainingQuantity: item.quantity - (deliveredQty[item.productId] || 0),
        unit: 'Pcs'
      })).filter(item => item.remainingQuantity > 0);

      return {
        id: order.id,
        orderNumber: order.orderNumber,
        customerName: order.customerName,
        customerEmail: order.customerEmail || '',
        customerPhone: order.customerPhone || '',
        orderDate: order.orderDate,
        orderStatus: order.orderStatus,
        items: remainingItems,
        hasRemainingItems: remainingItems.length > 0
      };
    }).filter(order => order.hasRemainingItems);

    return {
      orders: ordersWithRemaining,
      total: ordersWithRemaining.length
    };
  }

  // ============================================================
  // GET PRODUCT DELIVERY SUMMARY
  // ============================================================
  static async getProductDeliverySummary(userId, startDate, endDate) {
    const where = {
      userId: userId,
      isActive: true,
      isDeleted: false,
      deliveryStatus: 'Delivered'
    };

    if (startDate || endDate) {
      where.confirmedAt = {};
      if (startDate) where.confirmedAt.gte = new Date(startDate);
      if (endDate) where.confirmedAt.lte = new Date(endDate);
    }

    const deliveries = await prisma.delivery.findMany({
      where,
      include: {
        items: true
      }
    });

    const summary = {};
    for (const delivery of deliveries) {
      for (const item of delivery.items) {
        if (!summary[item.productId]) {
          summary[item.productId] = {
            productId: item.productId,
            productName: item.productName,
            sku: item.sku,
            totalDelivered: 0,
            deliveryCount: 0
          };
        }
        summary[item.productId].totalDelivered += item.deliveredQuantity;
        summary[item.productId].deliveryCount += 1;
      }
    }

    return Object.values(summary).sort((a, b) => b.totalDelivered - a.totalDelivered);
  }
}

module.exports = DeliveryModel;