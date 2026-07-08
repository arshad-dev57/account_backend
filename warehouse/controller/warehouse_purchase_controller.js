// warehouse/controller/purchaseController.js - MULTI-TENANT VERSION (CLEAN)

const prisma = require('../../prisma/client');

// ─── HELPERS ────────────────────────────────────────────────
const generatePurchaseNumber = () => {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  return `PO-${year}${month}${day}-${random}`;
};

const getDateFilter = (period) => {
  const now = new Date();
  let start = new Date(now);
  
  if (period === 'today') {
    start.setHours(0, 0, 0, 0);
  } else if (period === 'week') {
    start.setDate(start.getDate() - 7);
    start.setHours(0, 0, 0, 0);
  } else if (period === 'month') {
    start.setMonth(start.getMonth() - 1);
    start.setHours(0, 0, 0, 0);
  } else if (period === 'year') {
    start.setFullYear(start.getFullYear() - 1);
    start.setHours(0, 0, 0, 0);
  } else {
    start.setMonth(start.getMonth() - 1);
    start.setHours(0, 0, 0, 0);
  }
  
  return { gte: start };
};

// ─────────────────────────────────────────────────────────────
// Get All Purchases (User-specific)
// ─────────────────────────────────────────────────────────────
const getPurchases = async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      page = 1,
      limit = 10,
      search,
      status,
      paymentStatus,
      supplierId,
      fromDate,
      toDate,
    } = req.query;

    const filter = { 
      isActive: true, 
      isDeleted: false,
      userId: userId
    };

    if (status && status !== 'all') filter.purchaseStatus = status;
    if (paymentStatus && paymentStatus !== 'all') filter.paymentStatus = paymentStatus;
    
    if (supplierId) {
      const supplier = await prisma.supplier.findFirst({
        where: { id: supplierId, userId: userId }
      });
      if (!supplier) {
        return res.status(404).json({ success: false, message: 'Supplier not found' });
      }
      filter.supplierId = supplierId;
    }

    if (fromDate || toDate) {
      filter.purchaseDate = {};
      if (fromDate) filter.purchaseDate.gte = new Date(fromDate);
      if (toDate) {
        const end = new Date(toDate);
        end.setHours(23, 59, 59, 999);
        filter.purchaseDate.lte = end;
      }
    }

    if (search) {
      filter.OR = [
        { purchaseNumber: { contains: search, mode: 'insensitive' } },
        { supplierName: { contains: search, mode: 'insensitive' } },
        { reference: { contains: search, mode: 'insensitive' } },
      ];
    }

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    const [data, total] = await Promise.all([
      prisma.warehousePurchase.findMany({
        where: filter,
        skip,
        take: limitNum,
        orderBy: { purchaseDate: 'desc' },
        include: {
          items: {
            include: {
              product: {
                select: { id: true, name: true, sku: true }
              }
            }
          },
          supplier: {
            select: { id: true, name: true, email: true, phone: true }
          },
          creator: {
            select: { id: true, firstName: true, lastName: true, email: true }
          }
        }
      }),
      prisma.warehousePurchase.count({ where: filter })
    ]);

    res.status(200).json({
      success: true,
      data,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum),
        hasNext: pageNum < Math.ceil(total / limitNum),
        hasPrev: pageNum > 1,
      },
    });
  } catch (error) {
    console.error('Get purchases error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ─────────────────────────────────────────────────────────────
// Get Purchase by ID (User-specific)
// ─────────────────────────────────────────────────────────────
const getPurchaseById = async (req, res) => {
  try {
    const userId = req.user.id;
    const purchaseId = req.params.id;

    const purchase = await prisma.warehousePurchase.findFirst({
      where: {
        id: purchaseId,
        userId: userId
      },
      include: {
        items: {
          include: {
            product: {
              select: { id: true, name: true, sku: true, currentStock: true }
            }
          }
        },
        supplier: {
          select: { id: true, name: true, email: true, phone: true }
        },
        creator: {
          select: { id: true, firstName: true, lastName: true, email: true }
        },
        updater: {
          select: { id: true, firstName: true, lastName: true, email: true }
        }
      }
    });

    if (!purchase) {
      return res.status(404).json({ success: false, message: 'Purchase not found' });
    }

    res.status(200).json({ success: true, data: purchase });
  } catch (error) {
    console.error('Get purchase by ID error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ─────────────────────────────────────────────────────────────
// Get Purchase Stats (User-specific)
// ─────────────────────────────────────────────────────────────
const getPurchaseStats = async (req, res) => {
  try {
    const userId = req.user.id;
    const period = req.query.period || 'month';
    const dateFilter = getDateFilter(period);

    const whereCondition = {
      userId: userId,
      isActive: true,
      isDeleted: false
    };

    if (period !== 'all') {
      whereCondition.purchaseDate = dateFilter;
    }

    const [
      total,
      draft,
      ordered,
      received,
      partiallyReceived,
      cancelled,
      totalAmount
    ] = await Promise.all([
      prisma.warehousePurchase.count({ where: whereCondition }),
      prisma.warehousePurchase.count({ where: { ...whereCondition, purchaseStatus: 'Draft' } }),
      prisma.warehousePurchase.count({ where: { ...whereCondition, purchaseStatus: 'Ordered' } }),
      prisma.warehousePurchase.count({ where: { ...whereCondition, purchaseStatus: 'Received' } }),
      prisma.warehousePurchase.count({ where: { ...whereCondition, purchaseStatus: 'PartiallyReceived' } }),
      prisma.warehousePurchase.count({ where: { ...whereCondition, purchaseStatus: 'Cancelled' } }),
      prisma.warehousePurchase.aggregate({
        where: { ...whereCondition, purchaseStatus: { in: ['Received', 'PartiallyReceived'] } },
        _sum: { grandTotal: true }
      })
    ]);

    res.status(200).json({
      success: true,
      stats: {
        total,
        draft,
        ordered,
        received,
        partiallyReceived,
        cancelled,
        totalAmount: totalAmount._sum.grandTotal || 0
      }
    });
  } catch (error) {
    console.error('Get purchase stats error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ─────────────────────────────────────────────────────────────
// Create Purchase (User-specific)
// ─────────────────────────────────────────────────────────────
const createPurchase = async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      supplierId,
      expectedDeliveryDate,
      purchaseDate,
      items,
      discountTotal,
      reference,
      notes,
      internalNotes,
      paymentMethod,
      purchaseStatus,
    } = req.body;

    if (!supplierId) {
      return res.status(400).json({ success: false, message: 'Supplier is required' });
    }
    if (!items || items.length === 0) {
      return res.status(400).json({ success: false, message: 'At least one item is required' });
    }

    const supplier = await prisma.supplier.findFirst({
      where: { id: supplierId, userId: userId }
    });

    if (!supplier) {
      return res.status(404).json({ success: false, message: 'Supplier not found or does not belong to you' });
    }

    let subtotal = 0;
    let taxTotal = 0;
    const processedItems = [];

    for (const item of items) {
      const product = await prisma.product.findFirst({
        where: { id: item.productId, userId: userId }
      });

      if (!product) {
        return res.status(404).json({
          success: false,
          message: `Product not found: ${item.productName || item.productId}`
        });
      }

      const qty = parseInt(item.quantity) || 1;
      const unitCost = parseFloat(item.unitCost ?? product.costPrice ?? 0);
      const taxRate = parseFloat(item.taxRate) || 0;
      const lineSub = qty * unitCost;
      const taxAmount = lineSub * (taxRate / 100);
      subtotal += lineSub;
      taxTotal += taxAmount;

      processedItems.push({
        productId: product.id,
        productName: product.name,
        sku: product.sku,
        quantity: qty,
        receivedQty: 0,
        unitCost,
        taxRate,
        taxAmount,
        totalCost: lineSub + taxAmount,
        notes: item.notes || '',
      });
    }

    const discount = parseFloat(discountTotal) || 0;
    const grandTotal = subtotal + taxTotal - discount;
    const purchaseNumber = generatePurchaseNumber();

    const purchase = await prisma.warehousePurchase.create({
      data: {
        purchaseNumber,
        purchaseDate: purchaseDate ? new Date(purchaseDate) : new Date(),
        expectedDeliveryDate: expectedDeliveryDate ? new Date(expectedDeliveryDate) : null,
        supplierId: supplier.id,
        supplierName: supplier.name,
        subtotal,
        taxTotal,
        discountTotal: discount,
        grandTotal,
        purchaseStatus: purchaseStatus || 'Draft',
        paymentStatus: 'Unpaid',
        paymentMethod: paymentMethod || '',
        reference: reference || '',
        notes: notes || '',
        internalNotes: internalNotes || '',
        createdBy: userId,
        userId: userId,
        items: {
          create: processedItems
        }
      },
      include: {
        items: {
          include: {
            product: {
              select: { id: true, name: true, sku: true }
            }
          }
        },
        supplier: {
          select: { id: true, name: true, email: true, phone: true }
        },
        creator: {
          select: { id: true, firstName: true, lastName: true, email: true }
        }
      }
    });

    res.status(201).json({
      success: true,
      message: 'Purchase order created successfully',
      data: purchase
    });
  } catch (error) {
    console.error('Create purchase error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ─────────────────────────────────────────────────────────────
// Update Purchase Status (User-specific)
// ─────────────────────────────────────────────────────────────
const updatePurchaseStatus = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;
    const { purchaseStatus, paymentStatus } = req.body;

    const existing = await prisma.warehousePurchase.findFirst({
      where: { id: id, userId: userId }
    });

    if (!existing) {
      return res.status(404).json({ success: false, message: 'Purchase not found' });
    }

    const data = { updatedBy: userId };
    if (purchaseStatus) data.purchaseStatus = purchaseStatus;
    if (paymentStatus) data.paymentStatus = paymentStatus;

    const purchase = await prisma.warehousePurchase.update({
      where: { id: id },
      data,
      include: {
        items: {
          include: {
            product: {
              select: { id: true, name: true, sku: true }
            }
          }
        },
        supplier: {
          select: { id: true, name: true, email: true, phone: true }
        }
      }
    });

    res.status(200).json({
      success: true,
      message: 'Purchase status updated successfully',
      data: purchase
    });
  } catch (error) {
    console.error('Update purchase status error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ─────────────────────────────────────────────────────────────
// Receive Purchase Goods (User-specific)
// ─────────────────────────────────────────────────────────────
const receivePurchase = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;
    const { items } = req.body;

    if (!items || items.length === 0) {
      return res.status(400).json({ success: false, message: 'Receive items are required' });
    }

    const purchase = await prisma.warehousePurchase.findFirst({
      where: { id: id, userId: userId },
      include: {
        items: {
          include: {
            product: {
              select: { id: true, name: true, currentStock: true, costPrice: true }
            }
          }
        }
      }
    });

    if (!purchase) {
      return res.status(404).json({ success: false, message: 'Purchase not found' });
    }

    if (!['Ordered', 'PartiallyReceived'].includes(purchase.purchaseStatus)) {
      return res.status(400).json({
        success: false,
        message: `Cannot receive goods with status: ${purchase.purchaseStatus}`
      });
    }

    let allReceived = true;

    for (const receiveItem of items) {
      const purchaseItem = purchase.items.find(
        (item) => item.id === receiveItem.purchaseItemId || item.productId === receiveItem.productId
      );

      if (!purchaseItem) {
        return res.status(404).json({
          success: false,
          message: `Purchase item not found: ${receiveItem.productId || receiveItem.purchaseItemId}`
        });
      }

      const receivedQty = parseInt(receiveItem.receivedQty) || 0;
      if (receivedQty <= 0) continue;

      const previousStock = purchaseItem.product.currentStock;
      const newStock = previousStock + receivedQty;

      await prisma.product.update({
        where: { id: purchaseItem.productId },
        data: {
          currentStock: { increment: receivedQty },
          availableStock: { increment: receivedQty },
          totalValue: { increment: receivedQty * purchaseItem.unitCost }
        }
      });

      await prisma.stockMovement.create({
        data: {
          productId: purchaseItem.productId,
          productName: purchaseItem.productName,
          type: 'stock_in',
          quantity: receivedQty,
          previousStock,
          newStock,
          stockType: 'bulk',
          stockDetails: {
            type: 'purchase',
            purchaseId: purchase.id,
            purchaseNumber: purchase.purchaseNumber,
            supplierId: purchase.supplierId,
            supplierName: purchase.supplierName,
          },
          reason: 'Purchase Receive',
          reference: purchase.purchaseNumber,
          supplierId: purchase.supplierId,
          supplierName: purchase.supplierName,
          purchaseId: purchase.id,
          notes: `Received ${receivedQty} units of ${purchaseItem.productName}`,
          createdBy: userId,
          userId: userId
        }
      });

      await prisma.warehousePurchaseItem.update({
        where: { id: purchaseItem.id },
        data: {
          receivedQty: purchaseItem.receivedQty + receivedQty
        }
      });

      if (purchaseItem.receivedQty + receivedQty < purchaseItem.quantity) {
        allReceived = false;
      }
    }

    const newStatus = allReceived ? 'Received' : 'PartiallyReceived';
    const updatedPurchase = await prisma.warehousePurchase.update({
      where: { id: id },
      data: {
        purchaseStatus: newStatus,
        receivedDate: new Date(),
        updatedBy: userId
      },
      include: {
        items: {
          include: {
            product: {
              select: { id: true, name: true, sku: true, currentStock: true }
            }
          }
        },
        supplier: {
          select: { id: true, name: true, email: true, phone: true }
        }
      }
    });

    res.status(200).json({
      success: true,
      message: `Goods received successfully. Status: ${newStatus}`,
      data: updatedPurchase
    });
  } catch (error) {
    console.error('Receive purchase error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ─────────────────────────────────────────────────────────────
// Delete Purchase (Soft Delete - User-specific)
// ─────────────────────────────────────────────────────────────
const deletePurchase = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    const purchase = await prisma.warehousePurchase.findFirst({
      where: { id: id, userId: userId }
    });

    if (!purchase) {
      return res.status(404).json({ success: false, message: 'Purchase not found' });
    }

    if (['Received', 'PartiallyReceived'].includes(purchase.purchaseStatus)) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete received purchase order'
      });
    }

    await prisma.warehousePurchase.update({
      where: { id: id },
      data: {
        isActive: false,
        isDeleted: true,
        purchaseStatus: 'Cancelled',
        updatedBy: userId
      }
    });

    res.status(200).json({
      success: true,
      message: 'Purchase cancelled successfully'
    });
  } catch (error) {
    console.error('Delete purchase error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  getPurchases,
  getPurchaseById,
  getPurchaseStats,
  createPurchase,
  updatePurchaseStatus,
  receivePurchase,
  deletePurchase,
};