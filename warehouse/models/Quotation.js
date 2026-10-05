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
          companyId: data.companyId || null,
          locationId: data.locationId || null,
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
  // CONVERT QUOTATION TO SALES ORDER (supports partial line/qty conversion)
  // ============================================================
  static async convertToOrder(id, userId, selectedItems = null) {
    const {
      resolveLocationId,
      reserveLocationStock,
    } = require('../services/locationService');
    const {
      getConvertedQtyFromQuotation,
      remainingQuotationLines,
      quotationMarker,
    } = require('../services/salesQuantityService');

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
        throw new Error('Quotation already fully converted to order');
      }

      if (quotation.status === 'Rejected' || quotation.status === 'Expired' || quotation.status === 'Cancelled') {
        throw new Error(`Cannot convert ${quotation.status} quotation`);
      }

      const companyId = quotation.companyId;
      if (!companyId) {
        throw new Error('Quotation has no company');
      }

      const locationId = await resolveLocationId(
        tx,
        companyId,
        quotation.locationId,
        userId
      );

      const convertedMap = await getConvertedQtyFromQuotation(id, { tx });
      const remainingLines = remainingQuotationLines(quotation.items, convertedMap);
      if (remainingLines.length === 0) {
        throw new Error('No remaining quantities left to convert on this quotation');
      }

      // Build conversion plan: either selected items or all remaining
      let plan = [];
      if (Array.isArray(selectedItems) && selectedItems.length > 0) {
        for (const sel of selectedItems) {
          const productId = sel.productId || sel.id;
          const remLine = remainingLines.find((l) => l.productId === productId);
          if (!remLine) {
            throw new Error(`Product ${sel.productName || productId} has no remaining quantity to convert`);
          }
          const qty = Number(sel.quantity);
          if (!qty || qty <= 0) {
            throw new Error(`Convert quantity must be > 0 for ${remLine.productName}`);
          }
          if (qty > remLine.remainingQuantity) {
            throw new Error(
              `Convert quantity ${qty} exceeds remaining ${remLine.remainingQuantity} for ${remLine.productName}`
            );
          }
          plan.push({ ...remLine, convertQty: qty });
        }
      } else {
        plan = remainingLines.map((l) => ({ ...l, convertQty: l.remainingQuantity }));
      }

      if (plan.length === 0) {
        throw new Error('Select at least one line to convert');
      }

      // Validate + reserve stock at warehouse
      for (const item of plan) {
        const stock = await tx.productStock.findUnique({
          where: {
            productId_locationId: {
              productId: item.productId,
              locationId,
            },
          },
        });
        const available =
          (stock?.currentStock || 0) - (stock?.reservedStock || 0);
        if (item.convertQty > available) {
          throw new Error(
            `Insufficient stock at warehouse for ${item.productName}. Available: ${Math.max(0, available)}`
          );
        }
      }

      // Generate order number
      const date = new Date();
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
      const orderNumber = `SO-${year}${month}${day}-${random}`;

      // Recalculate totals for converted subset
      let subtotal = 0;
      let totalDiscount = 0;
      let totalTax = 0;
      const orderItemsData = plan.map((item) => {
        const qty = item.convertQty;
        const lineGross = qty * item.unitPrice;
        const discountAmount = (lineGross * (item.discount || 0)) / 100;
        const taxable = lineGross - discountAmount;
        const taxAmount = (taxable * (item.taxRate || 0)) / 100;
        const lineTotal = taxable + taxAmount;
        subtotal += lineGross;
        totalDiscount += discountAmount;
        totalTax += taxAmount;
        return {
          productId: item.productId,
          productName: item.productName,
          sku: item.sku,
          quantity: qty,
          unitPrice: item.unitPrice,
          totalPrice: lineTotal,
          taxRate: item.taxRate || 0,
          taxAmount,
          discount: item.discount || 0,
        };
      });
      const grandTotal = subtotal - totalDiscount + totalTax;

      const marker = quotationMarker(id);
      const existingNotes = quotation.notes || '';

      // Create order from quotation (partial or full)
      const order = await tx.order.create({
        data: {
          orderNumber,
          orderDate: new Date(),
          customerId: quotation.customerId,
          customerName: quotation.customerName,
          customerEmail: quotation.customerEmail,
          customerPhone: quotation.customerPhone,
          customerCompany: quotation.customerCompany,
          subtotal,
          taxTotal: totalTax,
          discountTotal: totalDiscount,
          grandTotal,
          totalItems: orderItemsData.reduce((sum, item) => sum + item.quantity, 0),
          orderType: 'Sales Order',
          orderStatus: 'Pending',
          paymentStatus: 'Pending',
          createdBy: userId,
          companyId,
          locationId,
          salesPerson: quotation.salesPerson,
          customerNotes: existingNotes
            ? `${existingNotes}\n${marker}`
            : marker,
          internalNotes: marker,
          items: {
            create: orderItemsData,
          },
        },
        include: {
          items: true,
          customer: true,
        },
      });

      for (const item of plan) {
        await reserveLocationStock(tx, {
          companyId,
          productId: item.productId,
          locationId,
          qty: item.convertQty,
        });
      }

      // Recompute remaining after this conversion
      const newConvertedMap = { ...convertedMap };
      for (const item of plan) {
        newConvertedMap[item.productId] =
          (newConvertedMap[item.productId] || 0) + item.convertQty;
      }
      const stillRemaining = remainingQuotationLines(quotation.items, newConvertedMap);
      const newStatus = stillRemaining.length === 0 ? 'Converted' : 'Partially Converted';

      const updatedQuotation = await tx.quotation.update({
        where: { id },
        data: {
          status: newStatus,
          convertedAt: new Date(),
          // Keep first converted order id; subsequent partials tracked via order notes marker
          convertedOrderId: quotation.convertedOrderId || order.id,
          updatedBy: userId,
        },
        include: {
          items: true,
          customer: true,
          convertedOrder: true,
        },
      });

      return { quotation: updatedQuotation, order, remainingLines: stillRemaining };
    });
  }

  // ============================================================
  // UPDATE QUOTATION STATUS
  // ============================================================
  static async updateStatus(id, status, userId, notes = '') {
    const quotation = await prisma.quotation.findUnique({ where: { id } });
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
    } else if (status === 'Accepted' || status === 'Approved') {
      updateData.acceptedAt = new Date();
    } else if (status === 'Rejected') {
      updateData.rejectedAt = new Date();
    }

    return await prisma.quotation.update({
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
  static async getStats(companyId) {
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
      companyId,
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
  static async getStatusCounts(companyId) {
    const baseFilter = {
      isActive: true,
      isDeleted: false,
      companyId,
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
  static async updateExpiredQuotations(companyId, userId) {
    const now = new Date();
    
    const expiredQuotations = await prisma.quotation.updateMany({
      where: {
        companyId,
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
  static async getCustomerSummary(companyId, startDate, endDate) {
    const where = {
      companyId,
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
  static async getProductSummary(companyId, startDate, endDate) {
    const where = {
      companyId,
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