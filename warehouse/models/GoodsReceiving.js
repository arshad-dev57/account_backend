// warehouse/models/GoodsReceiving.js - COMPLETE CORRECTED

const prisma = require('../../prisma/client');

// ─── Generate GRN Number Function ──────────────────────────
function generateGRNNumber() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  
  return `GRN-${year}${month}${day}-${random}`;
}

class GoodsReceivingModel {
  // ============================================================
  // CREATE GOODS RECEIVING FROM PURCHASE ORDER
  // ============================================================
  static async create(data) {
    const grnNumber = generateGRNNumber();
    
    return await prisma.$transaction(async (tx) => {
      // ─── Get Purchase Order with items ──────────────────────
      const purchaseOrder = await tx.purchaseOrder.findFirst({
        where: {
          id: data.purchaseOrderId,
          companyId: data.companyId,  // ✅ FIXED: Use companyId instead of userId
          isActive: true,
          isDeleted: false,
          status: {
            not: 'Cancelled'
          }
        },
        include: {
          items: {
            include: {
              product: true
            }
          },
          supplier: true
        }
      });

      if (!purchaseOrder) {
        throw new Error('Purchase order not found or cancelled');
      }

      // ─── Get all previous GRNs for this PO ──────────────────
      const previousGRNs = await tx.goodsReceiving.findMany({
        where: {
          purchaseOrderId: data.purchaseOrderId,
          companyId: data.companyId,  // ✅ FIXED
          isActive: true,
          isDeleted: false,
          status: {
            in: ['Partially Received', 'Fully Received']
          }
        },
        include: {
          items: true
        }
      });

      // ─── Calculate previously received quantities ───────────
      const previousReceivedQty = {};
      for (const grn of previousGRNs) {
        for (const item of grn.items) {
          previousReceivedQty[item.purchaseOrderItemId] = 
            (previousReceivedQty[item.purchaseOrderItemId] || 0) + item.receivingQuantity;
        }
      }

      // ─── Process receiving items ─────────────────────────────
      let totalReceivingQty = 0;
      const receivingItems = [];

      for (const item of data.items) {
        const poItem = purchaseOrder.items.find(pi => pi.id === item.purchaseOrderItemId);
        
        if (!poItem) {
          throw new Error(`Purchase order item ${item.purchaseOrderItemId} not found`);
        }

        const alreadyReceived = previousReceivedQty[item.purchaseOrderItemId] || 0;
        const orderedQuantity = poItem.quantity;
        const remainingQuantity = orderedQuantity - alreadyReceived;

        if (item.receivingQuantity <= 0) {
          throw new Error(`Receiving quantity must be greater than 0 for product ${poItem.productName}`);
        }

        if (item.receivingQuantity > remainingQuantity) {
          throw new Error(
            `Receiving quantity (${item.receivingQuantity}) exceeds remaining quantity (${remainingQuantity}) for product ${poItem.productName}`
          );
        }

        receivingItems.push({
          purchaseOrderItemId: item.purchaseOrderItemId,
          productId: poItem.productId,
          productName: poItem.productName,
          sku: poItem.sku,
          orderedQuantity: orderedQuantity,
          previouslyReceivedQty: alreadyReceived,
          remainingQuantity: remainingQuantity - item.receivingQuantity,
          receivingQuantity: item.receivingQuantity,
          unit: poItem.product?.stockUnitName || 'Pcs',
          notes: item.notes || null
        });

        totalReceivingQty += item.receivingQuantity;
      }

      // ─── Determine GRN status ────────────────────────────────
      let status = 'Draft';
      if (data.status === 'Confirmed') {
        const allItemsFullyReceived = receivingItems.every(item => item.remainingQuantity === 0);
        status = allItemsFullyReceived ? 'Fully Received' : 'Partially Received';
      }

      // ─── Create Goods Receiving ──────────────────────────────
      const goodsReceiving = await tx.goodsReceiving.create({
        data: {
          grnNumber,
          purchaseOrderId: data.purchaseOrderId,
          purchaseOrderNumber: purchaseOrder.orderNumber,
          supplierId: purchaseOrder.supplierId,
          supplierName: purchaseOrder.supplierName,
          receivingDate: new Date(data.receivingDate || Date.now()),
          status: status,
          receivedBy: data.receivedBy || null,
          notes: data.notes || null,
          createdBy: data.createdBy,
          companyId: data.companyId,  // ✅ FIXED: Use companyId instead of userId
          items: {
            create: receivingItems
          }
        },
        include: {
          items: {
            include: {
              product: true,
              purchaseOrderItem: true
            }
          },
          purchaseOrder: {
            include: {
              supplier: true
            }
          },
          supplier: true,
          creator: {
            select: { id: true, firstName: true, lastName: true, email: true }
          }
        }
      });

      // Add supplier details from the supplier relation
      const supplierDetails = goodsReceiving.supplier ? {
        supplierEmail: goodsReceiving.supplier.email,
        supplierPhone: goodsReceiving.supplier.phone,
        supplierAddress: goodsReceiving.supplier.address
      } : {};

      // Calculate totalReceivedQty, totalOrderedQty, totalItems, and receivingProgress
      const totalReceivedQty = goodsReceiving.items.reduce((sum, item) => sum + item.receivingQuantity, 0);
      const totalOrderedQty = goodsReceiving.items.reduce((sum, item) => sum + item.orderedQuantity, 0);
      const totalItems = goodsReceiving.items.length;
      const receivingProgress = totalOrderedQty > 0 ? totalReceivedQty / totalOrderedQty : 0;

      const goodsReceivingWithTotals = {
        ...goodsReceiving,
        ...supplierDetails,
        totalReceivedQty,
        totalOrderedQty,
        totalItems,
        receivingProgress
      };

      // Stock is applied only via confirmReceiving — not on create
      if (data.status === 'Confirmed') {
        const allItemsFullyReceived = receivingItems.every(
          (item) => item.remainingQuantity === 0
        );
        if (allItemsFullyReceived) {
          await tx.purchaseOrder.update({
            where: { id: data.purchaseOrderId },
            data: {
              status: 'Received',
              updatedBy: data.createdBy,
            },
          });
        } else if (!['Received', 'Cancelled'].includes(purchaseOrder.status)) {
          await tx.purchaseOrder.update({
            where: { id: data.purchaseOrderId },
            data: {
              status: 'Partially Received',
              updatedBy: data.createdBy,
            },
          });
        }
      }

      return goodsReceivingWithTotals;
    });
  }

  // ============================================================
  // CONFIRM GOODS RECEIVING
  // ============================================================
  static async confirmReceiving(id, userId, companyId) {  // ✅ Added companyId
    return await prisma.$transaction(async (tx) => {
      const goodsReceiving = await tx.goodsReceiving.findUnique({
        where: { id },
        include: {
          items: {
            include: {
              product: true,
              purchaseOrderItem: true
            }
          },
          purchaseOrder: {
            include: {
              supplier: true
            }
          }
        }
      });

      if (!goodsReceiving) {
        throw new Error('Goods receiving not found');
      }

      if (goodsReceiving.confirmedAt) {
        throw new Error('Goods receiving already confirmed');
      }

      const stockAlreadyApplied = await tx.stockMovement.count({
        where: {
          reference: goodsReceiving.grnNumber,
          type: 'Goods Receiving',
        },
      });

      const previousGRNs = await tx.goodsReceiving.findMany({
        where: {
          purchaseOrderId: goodsReceiving.purchaseOrderId,
          companyId: companyId,  // ✅ FIXED
          isActive: true,
          isDeleted: false,
          status: {
            in: ['Partially Received', 'Fully Received']
          },
          id: { not: id }
        },
        include: {
          items: true
        }
      });

      const previousReceivedQty = {};
      for (const grn of previousGRNs) {
        for (const item of grn.items) {
          previousReceivedQty[item.purchaseOrderItemId] = 
            (previousReceivedQty[item.purchaseOrderItemId] || 0) + item.receivingQuantity;
        }
      }

      let allItemsFullyReceived = true;
      let totalReceivingQty = 0;

      for (const item of goodsReceiving.items) {
        const alreadyReceived = previousReceivedQty[item.purchaseOrderItemId] || 0;
        const orderedQuantity = item.purchaseOrderItem.quantity;
        const remainingQuantity =
          orderedQuantity - (alreadyReceived + item.receivingQuantity);

        if (stockAlreadyApplied === 0) {
          const product = await tx.product.findUnique({
            where: { id: item.productId },
          });

          if (product) {
            const newStock = product.currentStock + item.receivingQuantity;
            await tx.product.update({
              where: { id: item.productId },
              data: {
                currentStock: newStock,
                availableStock: newStock,
              },
            });

            await tx.stockMovement.create({
              data: {
                productId: item.productId,
                productName: item.productName,
                type: 'Goods Receiving',
                quantity: item.receivingQuantity,
                previousStock: product.currentStock,
                newStock: newStock,
                reason: `GRN #${goodsReceiving.grnNumber} confirmed - PO #${goodsReceiving.purchaseOrder.orderNumber}`,
                reference: goodsReceiving.grnNumber,
                status: 'Completed',
                createdBy: userId,
                companyId: companyId,
                supplierId: goodsReceiving.purchaseOrder.supplierId,
                supplierName: goodsReceiving.purchaseOrder.supplierName,
              },
            });
          }
        }

        await tx.goodsReceivingItem.update({
          where: { id: item.id },
          data: {
            remainingQuantity: remainingQuantity
          }
        });

        totalReceivingQty += item.receivingQuantity;
        if (remainingQuantity > 0) {
          allItemsFullyReceived = false;
        }
      }

      const status = allItemsFullyReceived ? 'Fully Received' : 'Partially Received';

      const updatedGRN = await tx.goodsReceiving.update({
        where: { id },
        data: {
          status: status,
          confirmedBy: userId,
          confirmedAt: new Date(),
          updatedBy: userId
        },
        include: {
          items: {
            include: {
              product: true,
              purchaseOrderItem: true
            }
          },
          purchaseOrder: {
            include: {
              supplier: true
            }
          },
          supplier: true,
          creator: {
            select: { id: true, firstName: true, lastName: true, email: true }
          },
          confirmer: {
            select: { id: true, firstName: true, lastName: true, email: true }
          }
        }
      });

      // Add supplier details from the supplier relation
      const supplierDetails = updatedGRN.supplier ? {
        supplierEmail: updatedGRN.supplier.email,
        supplierPhone: updatedGRN.supplier.phone,
        supplierAddress: updatedGRN.supplier.address
      } : {};

      // Calculate totalReceivedQty, totalOrderedQty, totalItems, and receivingProgress
      const totalReceivedQty = updatedGRN.items.reduce((sum, item) => sum + item.receivingQuantity, 0);
      const totalOrderedQty = updatedGRN.items.reduce((sum, item) => sum + item.orderedQuantity, 0);
      const totalItems = updatedGRN.items.length;
      const receivingProgress = totalOrderedQty > 0 ? totalReceivedQty / totalOrderedQty : 0;

      const updatedGRNWithTotals = {
        ...updatedGRN,
        ...supplierDetails,
        totalReceivedQty,
        totalOrderedQty,
        totalItems,
        receivingProgress
      };

      if (allItemsFullyReceived) {
        await tx.purchaseOrder.update({
          where: { id: goodsReceiving.purchaseOrderId },
          data: {
            status: 'Received',
            updatedBy: userId
          }
        });
      } else {
        await tx.purchaseOrder.update({
          where: { id: goodsReceiving.purchaseOrderId },
          data: {
            status: 'Partially Received',
            updatedBy: userId
          }
        });
      }

      return updatedGRNWithTotals;
    });
  }

  // ============================================================
  // GET GOODS RECEIVING BY ID
  // ============================================================
  static async findById(id) {
    const grn = await prisma.goodsReceiving.findUnique({
      where: { id },
      include: {
        items: {
          include: {
            product: {
              select: { id: true, name: true, sku: true }
            },
            purchaseOrderItem: {
              include: {
                product: {
                  select: { id: true, name: true, sku: true }
                }
              }
            }
          }
        },
        purchaseOrder: {
          include: {
            supplier: true,
            items: true
          }
        },
        supplier: true,
        creator: {
          select: { id: true, firstName: true, lastName: true, email: true }
        },
        updater: {
          select: { id: true, firstName: true, lastName: true, email: true }
        },
        confirmer: {
          select: { id: true, firstName: true, lastName: true, email: true }
        }
      }
    });

    if (!grn) return null;

    // Add supplier details from the supplier relation
    const supplierDetails = grn.supplier ? {
      supplierEmail: grn.supplier.email,
      supplierPhone: grn.supplier.phone,
      supplierAddress: grn.supplier.address
    } : {};

    // Calculate totalReceivedQty, totalOrderedQty, totalItems, and receivingProgress
    const totalReceivedQty = grn.items.reduce((sum, item) => sum + item.receivingQuantity, 0);
    const totalOrderedQty = grn.items.reduce((sum, item) => sum + item.orderedQuantity, 0);
    const totalItems = grn.items.length;
    const receivingProgress = totalOrderedQty > 0 ? totalReceivedQty / totalOrderedQty : 0;

    return {
      ...grn,
      ...supplierDetails,
      totalReceivedQty,
      totalOrderedQty,
      totalItems,
      receivingProgress
    };
  }

  // ============================================================
  // GET GOODS RECEIVING BY GRN NUMBER
  // ============================================================
  static async findByGRNNumber(grnNumber) {
    const grn = await prisma.goodsReceiving.findUnique({
      where: { grnNumber },
      include: {
        items: {
          include: {
            product: {
              select: { id: true, name: true, sku: true }
            }
          }
        },
        purchaseOrder: {
          include: {
            supplier: true
          }
        },
        supplier: true
      }
    });

    if (!grn) return null;

    // Add supplier details from the supplier relation
    const supplierDetails = grn.supplier ? {
      supplierEmail: grn.supplier.email,
      supplierPhone: grn.supplier.phone,
      supplierAddress: grn.supplier.address
    } : {};

    // Calculate totalReceivedQty, totalOrderedQty, totalItems, and receivingProgress
    const totalReceivedQty = grn.items.reduce((sum, item) => sum + item.receivingQuantity, 0);
    const totalOrderedQty = grn.items.reduce((sum, item) => sum + item.orderedQuantity, 0);
    const totalItems = grn.items.length;
    const receivingProgress = totalOrderedQty > 0 ? totalReceivedQty / totalOrderedQty : 0;

    return {
      ...grn,
      ...supplierDetails,
      totalReceivedQty,
      totalOrderedQty,
      totalItems,
      receivingProgress
    };
  }

  // ============================================================
  // GET GOODS RECEIVINGS BY PURCHASE ORDER
  // ============================================================
  static async findByPurchaseOrder(purchaseOrderId) {
    const grns = await prisma.goodsReceiving.findMany({
      where: {
        purchaseOrderId: purchaseOrderId,
        isActive: true,
        isDeleted: false
      },
      include: {
        items: {
          include: {
            product: true
          }
        },
        purchaseOrder: {
          include: {
            supplier: true
          }
        },
        supplier: true,
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

    // Calculate totalReceivedQty, totalOrderedQty, totalItems, and receivingProgress for each GRN
    return grns.map(grn => {
      const supplierDetails = grn.supplier ? {
        supplierEmail: grn.supplier.email,
        supplierPhone: grn.supplier.phone,
        supplierAddress: grn.supplier.address
      } : {};

      const totalReceivedQty = grn.items.reduce((sum, item) => sum + item.receivingQuantity, 0);
      const totalOrderedQty = grn.items.reduce((sum, item) => sum + item.orderedQuantity, 0);
      const totalItems = grn.items.length;
      const receivingProgress = totalOrderedQty > 0 ? totalReceivedQty / totalOrderedQty : 0;

      return {
        ...grn,
        ...supplierDetails,
        totalReceivedQty,
        totalOrderedQty,
        totalItems,
        receivingProgress
      };
    });
  }

  // ============================================================
  // GET ALL GOODS RECEIVINGS WITH FILTERS
  // ============================================================
  static async findAll(filter = {}, options = {}) {
    const { skip, take, orderBy = { receivingDate: 'desc' } } = options;
    
    // ✅ FIXED: Map userId to createdBy if present
    const cleanFilter = { ...filter };
    if (cleanFilter.userId) {
      cleanFilter.createdBy = cleanFilter.userId;
      delete cleanFilter.userId;
    }
    
    const grns = await prisma.goodsReceiving.findMany({
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
        purchaseOrder: {
          include: {
            supplier: true
          }
        },
        supplier: true,
        creator: {
          select: { id: true, firstName: true, lastName: true, email: true }
        },
        confirmer: {
          select: { id: true, firstName: true, lastName: true, email: true }
        }
      }
    });

    // Calculate totalReceivedQty, totalOrderedQty, totalItems, and receivingProgress for each GRN
    return grns.map(grn => {
      const supplierDetails = grn.supplier ? {
        supplierEmail: grn.supplier.email,
        supplierPhone: grn.supplier.phone,
        supplierAddress: grn.supplier.address
      } : {};

      const totalReceivedQty = grn.items.reduce((sum, item) => sum + item.receivingQuantity, 0);
      const totalOrderedQty = grn.items.reduce((sum, item) => sum + item.orderedQuantity, 0);
      const totalItems = grn.items.length;
      const receivingProgress = totalOrderedQty > 0 ? totalReceivedQty / totalOrderedQty : 0;

      return {
        ...grn,
        ...supplierDetails,
        totalReceivedQty,
        totalOrderedQty,
        totalItems,
        receivingProgress
      };
    });
  }

  // ============================================================
  // COUNT GOODS RECEIVINGS - ✅ FIXED
  // ============================================================
  static async count(filter = {}) {
    // ✅ FIXED: Map userId to createdBy if present
    const cleanFilter = { ...filter };
    if (cleanFilter.userId) {
      cleanFilter.createdBy = cleanFilter.userId;
      delete cleanFilter.userId;
    }
    
    return await prisma.goodsReceiving.count({
      where: {
        ...cleanFilter,
        isActive: true,
        isDeleted: false
      }
    });
  }

  // ============================================================
  // UPDATE GOODS RECEIVING (Draft only)
  // ============================================================
  static async update(id, data) {
    return await prisma.$transaction(async (tx) => {
      const goodsReceiving = await tx.goodsReceiving.findUnique({
        where: { id },
        include: { items: true }
      });

      if (!goodsReceiving) {
        throw new Error('Goods receiving not found');
      }

      if (goodsReceiving.confirmedAt) {
        throw new Error('Cannot update confirmed goods receiving');
      }

      const updateData = {
        updatedBy: data.updatedBy,
        ...(data.receivingDate && { receivingDate: new Date(data.receivingDate) }),
        ...(data.receivedBy !== undefined && { receivedBy: data.receivedBy }),
        ...(data.notes !== undefined && { notes: data.notes }),
        ...(data.status && { status: data.status })
      };

      if (data.items) {
        await tx.goodsReceivingItem.deleteMany({
          where: { goodsReceivingId: id }
        });

        const purchaseOrder = await tx.purchaseOrder.findUnique({
          where: { id: goodsReceiving.purchaseOrderId },
          include: {
            items: {
              include: {
                product: true
              }
            }
          }
        });

        if (!purchaseOrder) {
          throw new Error('Purchase order not found');
        }

        const previousGRNs = await tx.goodsReceiving.findMany({
          where: {
            purchaseOrderId: goodsReceiving.purchaseOrderId,
            isActive: true,
            isDeleted: false,
            status: {
              in: ['Partially Received', 'Fully Received']
            },
            id: { not: id }
          },
          include: {
            items: true
          }
        });

        const previousReceivedQty = {};
        for (const grn of previousGRNs) {
          for (const item of grn.items) {
            previousReceivedQty[item.purchaseOrderItemId] = 
              (previousReceivedQty[item.purchaseOrderItemId] || 0) + item.receivingQuantity;
          }
        }

        const receivingItems = [];
        let totalReceivingQty = 0;

        for (const item of data.items) {
          const poItem = purchaseOrder.items.find(pi => pi.id === item.purchaseOrderItemId);
          
          if (!poItem) {
            throw new Error(`Purchase order item ${item.purchaseOrderItemId} not found`);
          }

          const alreadyReceived = previousReceivedQty[item.purchaseOrderItemId] || 0;
          const orderedQuantity = poItem.quantity;
          const remainingQuantity = orderedQuantity - alreadyReceived;

          if (item.receivingQuantity <= 0) {
            throw new Error(`Receiving quantity must be greater than 0 for product ${poItem.productName}`);
          }

          if (item.receivingQuantity > remainingQuantity) {
            throw new Error(
              `Receiving quantity (${item.receivingQuantity}) exceeds remaining quantity (${remainingQuantity}) for product ${poItem.productName}`
            );
          }

          receivingItems.push({
            purchaseOrderItemId: item.purchaseOrderItemId,
            productId: poItem.productId,
            productName: poItem.productName,
            sku: poItem.sku,
            orderedQuantity: orderedQuantity,
            previouslyReceivedQty: alreadyReceived,
            remainingQuantity: remainingQuantity - item.receivingQuantity,
            receivingQuantity: item.receivingQuantity,
            unit: poItem.product?.stockUnitName || 'Pcs',
            notes: item.notes || null
          });

          totalReceivingQty += item.receivingQuantity;
        }

        const allItemsFullyReceived = receivingItems.every(item => item.remainingQuantity === 0);
        let status = goodsReceiving.status;
        if (data.status !== 'Draft') {
          status = allItemsFullyReceived ? 'Fully Received' : 'Partially Received';
        }

        updateData.status = status;
        updateData.items = {
          create: receivingItems
        };
      }

      const updatedGRN = await tx.goodsReceiving.update({
        where: { id },
        data: updateData,
        include: {
          items: {
            include: {
              product: true,
              purchaseOrderItem: true
            }
          },
          purchaseOrder: {
            include: {
              supplier: true
            }
          },
          supplier: true
        }
      });

      return updatedGRN;
    });
  }

  // ============================================================
  // SOFT DELETE GOODS RECEIVING
  // ============================================================
  static async softDelete(id, userId) {
    const goodsReceiving = await prisma.goodsReceiving.findUnique({
      where: { id }
    });

    if (!goodsReceiving) {
      throw new Error('Goods receiving not found');
    }

    if (goodsReceiving.confirmedAt) {
      throw new Error('Cannot delete confirmed goods receiving');
    }

    return await prisma.goodsReceiving.update({
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
  // GET GOODS RECEIVING STATS - ✅ FIXED
  // ============================================================
  static async getStats(companyId) {  // ✅ Use companyId instead of userId
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);

    const baseFilter = {
      isActive: true,
      isDeleted: false,
      companyId: companyId  // ✅ Use companyId
    };

    const todayGRNs = await prisma.goodsReceiving.count({
      where: {
        ...baseFilter,
        receivingDate: {
          gte: today
        }
      }
    });

    const monthGRNs = await prisma.goodsReceiving.count({
      where: {
        ...baseFilter,
        receivingDate: {
          gte: startOfMonth
        }
      }
    });

    const [draft, partiallyReceived, fullyReceived] = await Promise.all([
      prisma.goodsReceiving.count({ where: { ...baseFilter, status: 'Draft' } }),
      prisma.goodsReceiving.count({ where: { ...baseFilter, status: 'Partially Received' } }),
      prisma.goodsReceiving.count({ where: { ...baseFilter, status: 'Fully Received' } })
    ]);

    return {
      today: {
        count: todayGRNs
      },
      month: {
        count: monthGRNs
      },
      status: {
        draft,
        partiallyReceived,
        fullyReceived,
        total: draft + partiallyReceived + fullyReceived
      }
    };
  }

  // ============================================================
  // GET GOODS RECEIVING SUMMARY BY SUPPLIER - ✅ FIXED
  // ============================================================
  static async getSupplierSummary(companyId, supplierId) {  // ✅ Use companyId instead of userId
    const baseFilter = {
      isActive: true,
      isDeleted: false,
      companyId: companyId,  // ✅ Use companyId
      supplierId: supplierId
    };

    const grns = await prisma.goodsReceiving.findMany({
      where: baseFilter,
      select: {
        id: true,
        grnNumber: true,
        receivingDate: true,
        status: true,
        items: {
          select: {
            receivingQuantity: true,
            productName: true,
            productId: true
          }
        }
      },
      orderBy: {
        receivingDate: 'desc'
      }
    });

    const summary = {
      totalGRNs: grns.length,
      totalItems: 0,
      draftCount: 0,
      partiallyReceivedCount: 0,
      fullyReceivedCount: 0,
      grns: grns
    };

    for (const grn of grns) {
      const itemCount = grn.items.length;
      summary.totalItems += itemCount;
      
      switch (grn.status) {
        case 'Draft': summary.draftCount++; break;
        case 'Partially Received': summary.partiallyReceivedCount++; break;
        case 'Fully Received': summary.fullyReceivedCount++; break;
      }
    }

    return summary;
  }
}

module.exports = GoodsReceivingModel;