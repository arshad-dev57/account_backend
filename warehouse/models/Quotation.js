// warehouse/models/Quotation.js - COMPLETE QUOTATION MODEL

const prisma = require('../../prisma/client');

// ─── Generate Quotation Number Function ──────────────────────
function generateQuotationNumber() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  
  return `QT-${year}${month}${day}-${random}`;
}

class QuotationModel {
  // ============================================================
  // CREATE QUOTATION
  // ============================================================
  static async create(data) {
    const quotationNumber = generateQuotationNumber();
    
    return await prisma.$transaction(async (tx) => {
      // Calculate totals
      let subtotal = 0;
      let totalDiscount = 0;
      let totalTax = 0;
      
      const quotationItems = data.items.map(item => {
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
      
      // Create quotation
      const quotation = await tx.quotation.create({
        data: {
          quotationNumber,
          customerId: data.customerId,
          customerName: data.customerName,
          customerEmail: data.customerEmail || null,
          customerPhone: data.customerPhone || null,
          customerCompany: data.customerCompany || null,
          quotationDate: new Date(data.quotationDate),
          validUntil: new Date(data.validUntil),
          salesPerson: data.salesPerson || null,
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
            create: quotationItems
          }
        },
        include: {
          items: {
            include: {
              product: true
            }
          },
          customer: true,
          creator: {
            select: { id: true, firstName: true, lastName: true, email: true }
          }
        }
      });
      
      return quotation;
    });
  }

  // ============================================================
  // CONVERT QUOTATION TO SALES ORDER
  // ============================================================
  static async convertToOrder(id, userId) {
    return await prisma.$transaction(async (tx) => {
      const quotation = await tx.quotation.findUnique({
        where: { id },
        include: {
          items: {
            include: {
              product: true
            }
          },
          customer: true
        }
      });

      if (!quotation) {
        throw new Error('Quotation not found');
      }

      if (quotation.status === 'Converted') {
        throw new Error('Quotation already converted to order');
      }

      if (quotation.status === 'Rejected' || quotation.status === 'Expired') {
        throw new Error(`Cannot convert ${quotation.status} quotation`);
      }

      // Generate order number
      const date = new Date();
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
      const orderNumber = `SO-${year}${month}${day}-${random}`;

      // Create order from quotation
      const order = await tx.order.create({
        data: {
          orderNumber,
          orderDate: new Date(),
          customerId: quotation.customerId,
          customerName: quotation.customerName,
          customerEmail: quotation.customerEmail,
          customerPhone: quotation.customerPhone,
          customerCompany: quotation.customerCompany,
          subtotal: quotation.subtotal,
          taxTotal: quotation.totalTax,
          discountTotal: quotation.totalDiscount,
          grandTotal: quotation.grandTotal,
          totalItems: quotation.items.reduce((sum, item) => sum + item.quantity, 0),
          orderType: 'Sales Order',
          orderStatus: 'Pending',
          paymentStatus: 'Pending',
          createdBy: userId,
          userId: quotation.userId,
          salesPerson: quotation.salesPerson,
          customerNotes: quotation.notes,
          items: {
            create: quotation.items.map(item => ({
              productId: item.productId,
              productName: item.productName,
              sku: item.sku,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              totalPrice: item.lineTotal,
              taxRate: item.taxRate || 0,
              taxAmount: item.taxAmount || 0,
              discount: item.discount || 0,
            }))
          }
        },
        include: {
          items: true,
          customer: true
        }
      });

      // Update quotation status
      const updatedQuotation = await tx.quotation.update({
        where: { id },
        data: {
          status: 'Converted',
          convertedAt: new Date(),
          convertedOrderId: order.id,
          updatedBy: userId
        },
        include: {
          items: true,
          customer: true,
          convertedOrder: true
        }
      });

      return {
        quotation: updatedQuotation,
        order: order
      };
    });
  }

  // ============================================================
  // UPDATE QUOTATION STATUS
  // ============================================================
  static async updateStatus(id, status, userId, notes = '') {
    const quotation = await tx.quotation.findUnique({ where: { id } });
    if (!quotation) {
      throw new Error('Quotation not found');
    }

    const updateData = {
      status,
      updatedBy: userId
    };

    // Set timestamps based on status
    if (status === 'Sent') {
      updateData.sentAt = new Date();
    } else if (status === 'Accepted') {
      updateData.acceptedAt = new Date();
    } else if (status === 'Rejected') {
      updateData.rejectedAt = new Date();
    }

    return await tx.quotation.update({
      where: { id },
      data: updateData,
      include: {
        items: {
          include: {
            product: true
          }
        },
        customer: true,
        creator: {
          select: { id: true, firstName: true, lastName: true, email: true }
        },
        convertedOrder: {
          select: { id: true, orderNumber: true, orderStatus: true }
        }
      }
    });
  }

  // ============================================================
  // GET QUOTATION BY ID
  // ============================================================
  static async findById(id) {
    return await prisma.quotation.findUnique({
      where: { id },
      include: {
        items: {
          include: {
            product: {
              select: { id: true, name: true, sku: true, sellingPrice: true }
            }
          }
        },
        customer: true,
        creator: {
          select: { id: true, firstName: true, lastName: true, email: true }
        },
        updater: {
          select: { id: true, firstName: true, lastName: true, email: true }
        },
        convertedOrder: {
          select: { id: true, orderNumber: true, orderStatus: true, createdAt: true }
        }
      }
    });
  }

  // ============================================================
  // GET QUOTATION BY NUMBER
  // ============================================================
  static async findByQuotationNumber(quotationNumber) {
    return await prisma.quotation.findUnique({
      where: { quotationNumber },
      include: {
        items: {
          include: {
            product: {
              select: { id: true, name: true, sku: true }
            }
          }
        },
        customer: true,
        creator: {
          select: { id: true, firstName: true, lastName: true, email: true }
        },
        convertedOrder: {
          select: { id: true, orderNumber: true, orderStatus: true }
        }
      }
    });
  }

  // ============================================================
  // GET ALL QUOTATIONS WITH FILTERS
  // ============================================================
  static async findAll(filter = {}, options = {}) {
    const { skip, take, orderBy = { quotationDate: 'desc' } } = options;
    
    return await prisma.quotation.findMany({
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
        customer: true,
        creator: {
          select: { id: true, firstName: true, lastName: true, email: true }
        },
        convertedOrder: {
          select: { id: true, orderNumber: true, orderStatus: true }
        }
      }
    });
  }

  // ============================================================
  // COUNT QUOTATIONS
  // ============================================================
  static async count(filter = {}) {
    return await prisma.quotation.count({
      where: {
        ...filter,
        isActive: true,
        isDeleted: false
      }
    });
  }

  // ============================================================
  // UPDATE QUOTATION
  // ============================================================
  static async update(id, data) {
    return await prisma.$transaction(async (tx) => {
      const quotation = await tx.quotation.findUnique({
        where: { id },
        include: { items: true }
      });

      if (!quotation) {
        throw new Error('Quotation not found');
      }

      if (quotation.status === 'Converted') {
        throw new Error('Cannot update converted quotation');
      }

      // Update quotation header
      const updateData = {
        updatedBy: data.updatedBy,
        ...(data.customerId && { customerId: data.customerId }),
        ...(data.customerName && { customerName: data.customerName }),
        ...(data.customerEmail !== undefined && { customerEmail: data.customerEmail }),
        ...(data.customerPhone !== undefined && { customerPhone: data.customerPhone }),
        ...(data.customerCompany !== undefined && { customerCompany: data.customerCompany }),
        ...(data.quotationDate && { quotationDate: new Date(data.quotationDate) }),
        ...(data.validUntil && { validUntil: new Date(data.validUntil) }),
        ...(data.salesPerson !== undefined && { salesPerson: data.salesPerson }),
        ...(data.notes !== undefined && { notes: data.notes }),
        ...(data.termsConditions !== undefined && { termsConditions: data.termsConditions }),
        ...(data.status && { status: data.status })
      };

      // Update items if provided
      if (data.items) {
        // Delete existing items
        await tx.quotationItem.deleteMany({
          where: { quotationId: id }
        });

        // Recalculate totals
        let subtotal = 0;
        let totalDiscount = 0;
        let totalTax = 0;

        const quotationItems = data.items.map(item => {
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
          create: quotationItems
        };
      }

      const updatedQuotation = await tx.quotation.update({
        where: { id },
        data: updateData,
        include: {
          items: {
            include: {
              product: true
            }
          },
          customer: true,
          creator: {
            select: { id: true, firstName: true, lastName: true, email: true }
          },
          convertedOrder: {
            select: { id: true, orderNumber: true, orderStatus: true }
          }
        }
      });

      return updatedQuotation;
    });
  }

  // ============================================================
  // SOFT DELETE QUOTATION
  // ============================================================
  static async softDelete(id, userId) {
    const quotation = await prisma.quotation.findUnique({
      where: { id }
    });

    if (!quotation) {
      throw new Error('Quotation not found');
    }

    if (quotation.status === 'Converted') {
      throw new Error('Cannot delete converted quotation');
    }

    return await prisma.quotation.update({
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
  // GET QUOTATION STATS / KPI
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

    // Today's quotations
    const todayQuotations = await prisma.quotation.count({
      where: {
        ...baseFilter,
        quotationDate: {
          gte: today,
          lt: tomorrow
        }
      }
    });

    // Weekly quotations
    const weekQuotations = await prisma.quotation.count({
      where: {
        ...baseFilter,
        quotationDate: {
          gte: startOfWeek
        }
      }
    });

    // Monthly quotations
    const monthQuotations = await prisma.quotation.count({
      where: {
        ...baseFilter,
        quotationDate: {
          gte: startOfMonth
        }
      }
    });

    const monthValue = await prisma.quotation.aggregate({
      where: {
        ...baseFilter,
        quotationDate: {
          gte: startOfMonth
        }
      },
      _sum: {
        grandTotal: true
      }
    });

    return {
      today: {
        quotations: todayQuotations
      },
      week: {
        quotations: weekQuotations
      },
      month: {
        quotations: monthQuotations,
        value: monthValue._sum.grandTotal || 0
      }
    };
  }

  // ============================================================
  // GET QUOTATION STATUS COUNTS (KPI)
  // ============================================================
  static async getStatusCounts(userId) {
    const baseFilter = {
      isActive: true,
      isDeleted: false,
      userId: userId
    };

    const [total, draft, sent, accepted, rejected, expired, converted] = await Promise.all([
      prisma.quotation.count({ where: baseFilter }),
      prisma.quotation.count({ where: { ...baseFilter, status: 'Draft' } }),
      prisma.quotation.count({ where: { ...baseFilter, status: 'Sent' } }),
      prisma.quotation.count({ where: { ...baseFilter, status: 'Accepted' } }),
      prisma.quotation.count({ where: { ...baseFilter, status: 'Rejected' } }),
      prisma.quotation.count({ where: { ...baseFilter, status: 'Expired' } }),
      prisma.quotation.count({ where: { ...baseFilter, status: 'Converted' } })
    ]);

    const totalValue = await prisma.quotation.aggregate({
      where: {
        ...baseFilter,
        status: {
          in: ['Draft', 'Sent', 'Accepted', 'Converted']
        }
      },
      _sum: {
        grandTotal: true
      }
    });

    const convertedValue = await prisma.quotation.aggregate({
      where: {
        ...baseFilter,
        status: 'Converted'
      },
      _sum: {
        grandTotal: true
      }
    });

    return {
      total,
      draft,
      sent,
      accepted,
      rejected,
      expired,
      converted,
      totalValue: totalValue._sum.grandTotal || 0,
      convertedValue: convertedValue._sum.grandTotal || 0
    };
  }

  // ============================================================
  // CHECK AND UPDATE EXPIRED QUOTATIONS
  // ============================================================
  static async updateExpiredQuotations(userId) {
    const now = new Date();
    
    const expiredQuotations = await prisma.quotation.updateMany({
      where: {
        status: {
          in: ['Draft', 'Sent']
        },
        validUntil: {
          lt: now
        },
        isActive: true,
        isDeleted: false
      },
      data: {
        status: 'Expired',
        updatedBy: userId,
        updatedAt: now
      }
    });

    return expiredQuotations;
  }

  // ============================================================
  // GET QUOTATION SUMMARY BY CUSTOMER
  // ============================================================
  static async getCustomerSummary(userId, startDate, endDate) {
    const where = {
      userId: userId,
      isActive: true,
      isDeleted: false
    };

    if (startDate || endDate) {
      where.quotationDate = {};
      if (startDate) where.quotationDate.gte = new Date(startDate);
      if (endDate) where.quotationDate.lte = new Date(endDate);
    }

    const quotations = await prisma.quotation.findMany({
      where,
      include: {
        customer: true
      }
    });

    const summary = {};
    for (const q of quotations) {
      const customerId = q.customerId;
      if (!summary[customerId]) {
        summary[customerId] = {
          customerId: customerId,
          customerName: q.customerName,
          totalQuotations: 0,
          totalValue: 0,
          convertedCount: 0,
          convertedValue: 0
        };
      }
      summary[customerId].totalQuotations += 1;
      summary[customerId].totalValue += q.grandTotal;
      if (q.status === 'Converted') {
        summary[customerId].convertedCount += 1;
        summary[customerId].convertedValue += q.grandTotal;
      }
    }

    return Object.values(summary).sort((a, b) => b.totalValue - a.totalValue);
  }

  // ============================================================
  // GET QUOTATION PRODUCT SUMMARY
  // ============================================================
  static async getProductSummary(userId, startDate, endDate) {
    const where = {
      userId: userId,
      isActive: true,
      isDeleted: false
    };

    if (startDate || endDate) {
      where.quotationDate = {};
      if (startDate) where.quotationDate.gte = new Date(startDate);
      if (endDate) where.quotationDate.lte = new Date(endDate);
    }

    const quotations = await prisma.quotation.findMany({
      where,
      include: {
        items: true
      }
    });

    const summary = {};
    for (const q of quotations) {
      for (const item of q.items) {
        if (!summary[item.productId]) {
          summary[item.productId] = {
            productId: item.productId,
            productName: item.productName,
            sku: item.sku,
            totalQuantity: 0,
            totalValue: 0,
            quotationCount: 0
          };
        }
        summary[item.productId].totalQuantity += item.quantity;
        summary[item.productId].totalValue += item.lineTotal;
        summary[item.productId].quotationCount += 1;
      }
    }

    return Object.values(summary).sort((a, b) => b.totalValue - a.totalValue);
  }
}

module.exports = QuotationModel;