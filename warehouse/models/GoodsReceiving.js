// warehouse/models/GoodsReceiving.js - COMPLETE

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
          userId: data.userId,
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
        // Check if all items are fully received
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
          userId: data.userId,
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

      // ─── Update Inventory Stock ──────────────────────────────
      if (data.status === 'Confirmed') {
        for (const item of receivingItems) {
          // Update product stock
          const product = await tx.product.findUnique({
            where: { id: item.productId }
          });

          if (product) {
            const newStock = product.currentStock + item.receivingQuantity;
            await tx.product.update({
              where: { id: item.productId },
              data: {
                currentStock: newStock,
                availableStock: newStock
              }
            });

            // Create stock movement record
            await tx.stockMovement.create({
              data: {
                productId: item.productId,
                productName: item.productName,
                type: 'Goods Receiving',
                quantity: item.receivingQuantity,
                previousStock: product.currentStock,
                newStock: newStock,
                reason: `GRN #${grnNumber} - PO #${purchaseOrder.orderNumber}`,
                reference: grnNumber,
                status: 'Completed',
                createdBy: data.createdBy,
                userId: data.userId,
                supplierId: purchaseOrder.supplierId,
                supplierName: purchaseOrder.supplierName
              }
            });
          }
        }

        // ─── Update Purchase Order status ──────────────────────
        // Check if all items are fully received
        const allItemsFullyReceived = receivingItems.every(item => item.remainingQuantity === 0);
        let poStatus = purchaseOrder.status;
        
        if (allItemsFullyReceived) {
          poStatus = 'Approved'; // or 'Fully Received' - you can add this status
        } else if (totalReceivingQty > 0) {
          // You may want to add a 'Partially Received' status to PurchaseOrder
          // For now, keep as is or update accordingly
        }

        // Update purchase order status if fully received
        if (allItemsFullyReceived && purchaseOrder.status !== 'Approved') {
          await tx.purchaseOrder.update({
            where: { id: data.purchaseOrderId },
            data: {
              status: 'Approved',
              updatedBy: data.createdBy
            }
          });
        }
      }

      return goodsReceiving;
    });
  }

  // ============================================================
  // CONFIRM GOODS RECEIVING
  // ============================================================
  static async confirmReceiving(id, userId) {
    return await prisma.$transaction(async (tx) => {
      // ─── Get GRN with items ──────────────────────────────────
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

      if (goodsReceiving.status === 'Fully Received') {
        throw new Error('Goods receiving already fully confirmed');
      }

      if (goodsReceiving.confirmedAt) {
        throw new Error('Goods receiving already confirmed');
      }

      // ─── Get all previous GRNs for this PO ──────────────────
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

      // ─── Calculate previously received quantities ───────────
      const previousReceivedQty = {};
      for (const grn of previousGRNs) {
        for (const item of grn.items) {
          previousReceivedQty[item.purchaseOrderItemId] = 
            (previousReceivedQty[item.purchaseOrderItemId] || 0) + item.receivingQuantity;
        }
      }

      // ─── Update inventory and calculate remaining ────────────
      let allItemsFullyReceived = true;
      let totalReceivingQty = 0;

      for (const item of goodsReceiving.items) {
        const alreadyReceived = previousReceivedQty[item.purchaseOrderItemId] || 0;
        const orderedQuantity = item.purchaseOrderItem.quantity;
        const remainingQuantity = orderedQuantity - (alreadyReceived + item.receivingQuantity);

        // Update product stock
        const product = await tx.product.findUnique({
          where: { id: item.productId }
        });

        if (product) {
          const newStock = product.currentStock + item.receivingQuantity;
          await tx.product.update({
            where: { id: item.productId },
            data: {
              currentStock: newStock,
              availableStock: newStock
            }
          });

          // Create stock movement record
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
              userId: goodsReceiving.userId,
              supplierId: goodsReceiving.purchaseOrder.supplierId,
              supplierName: goodsReceiving.purchaseOrder.supplierName
            }
          });
        }

        // Update GRN item remaining quantity
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

      // ─── Determine GRN status ─────────────────────────────────
      const status = allItemsFullyReceived ? 'Fully Received' : 'Partially Received';

      // ─── Update GRN ──────────────────────────────────────────
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

      // ─── Update Purchase Order status if fully received ──────
      if (allItemsFullyReceived) {
        await tx.purchaseOrder.update({
          where: { id: goodsReceiving.purchaseOrderId },
          data: {
            status: 'Approved',
            updatedBy: userId
          }
        });
      }

      return updatedGRN;
    });
  }

  // ============================================================
  // GET GOODS RECEIVING BY ID
  // ============================================================
  static async findById(id) {
    return await prisma.goodsReceiving.findUnique({
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
  }

  // ============================================================
  // GET GOODS RECEIVING BY GRN NUMBER
  // ============================================================
  static async findByGRNNumber(grnNumber) {
    return await prisma.goodsReceiving.findUnique({
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
  }

  // ============================================================
  // GET GOODS RECEIVINGS BY PURCHASE ORDER
  // ============================================================
  static async findByPurchaseOrder(purchaseOrderId) {
    return await prisma.goodsReceiving.findMany({
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
  }

  // ============================================================
  // GET ALL GOODS RECEIVINGS WITH FILTERS
  // ============================================================
  static async findAll(filter = {}, options = {}) {
    const { skip, take, orderBy = { receivingDate: 'desc' } } = options;
    
    return await prisma.goodsReceiving.findMany({
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
  }

  // ============================================================
  // COUNT GOODS RECEIVINGS
  // ============================================================
  static async count(filter = {}) {
    return await prisma.goodsReceiving.count({
      where: {
        ...filter,
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

      // ─── Update header ──────────────────────────────────────
      const updateData = {
        updatedBy: data.updatedBy,
        ...(data.receivingDate && { receivingDate: new Date(data.receivingDate) }),
        ...(data.receivedBy !== undefined && { receivedBy: data.receivedBy }),
        ...(data.notes !== undefined && { notes: data.notes }),
        ...(data.status && { status: data.status })
      };

      // ─── Update items if provided ──────────────────────────
      if (data.items) {
        // Delete existing items
        await tx.goodsReceivingItem.deleteMany({
          where: { goodsReceivingId: id }
        });

        // Get purchase order with items
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

        // Get all previous GRNs for this PO (excluding current)
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

        // Calculate previously received quantities
        const previousReceivedQty = {};
        for (const grn of previousGRNs) {
          for (const item of grn.items) {
            previousReceivedQty[item.purchaseOrderItemId] = 
              (previousReceivedQty[item.purchaseOrderItemId] || 0) + item.receivingQuantity;
          }
        }

        // Process new items
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

        // Determine GRN status
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
  // GET GOODS RECEIVING STATS
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

    // ─── Today's GRNs ──────────────────────────────────────────
    const todayGRNs = await prisma.goodsReceiving.count({
      where: {
        ...baseFilter,
        receivingDate: {
          gte: today
        }
      }
    });

    // ─── Monthly GRNs ──────────────────────────────────────────
    const monthGRNs = await prisma.goodsReceiving.count({
      where: {
        ...baseFilter,
        receivingDate: {
          gte: startOfMonth
        }
      }
    });

    // ─── Status counts ─────────────────────────────────────────
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
  // GET GOODS RECEIVING SUMMARY BY SUPPLIER
  // ============================================================
  static async getSupplierSummary(userId, supplierId) {
    const baseFilter = {
      isActive: true,
      isDeleted: false,
      userId: userId,
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