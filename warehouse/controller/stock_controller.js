// warehouse/controller/stockController.js - MULTI-TENANT VERSION

const prisma = require('../../prisma/client');
const {
  validateStockInReason,
  validateStockOutReason,
  postStockInAccounting,
  postStockOutAccounting,
  createStockCreditPayableBill,
  listStockReasons,
} = require('../services/stockAccountingService');
const {
  resolveLocationId,
  adjustLocationStock,
} = require('../services/locationService');

// ============================================================
// @desc    Stock in/out reason catalog (for UI)
// @route   GET /api/warehouse/stock/reasons
// ============================================================
const getStockReasons = async (_req, res) => {
  res.json({ success: true, data: listStockReasons() });
};

// ============================================================
// @desc    Add stock (Stock In) with Box Support (User-specific)
// @route   POST /api/warehouse/stock/in
// @access  Private
// ============================================================
const addStock = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const userId = req.user.id;
    const {
      productId,
      stockType,
      quantity,
      boxCount,
      piecesPerBox,
      supplierId,
      supplierName,
      reference,
      notes,
      stockSourceReason,
      unitCost: unitCostInput,
      bankAccountId,
      locationId: locationIdInput,
    } = req.body;

    if (!productId || !quantity) {
      return res.status(400).json({
        success: false,
        message: 'Product ID and quantity are required',
      });
    }

    if (!stockSourceReason) {
      return res.status(400).json({
        success: false,
        message:
          'stockSourceReason is required (e.g. opening_stock, supplier_credit, cash_purchase)',
      });
    }

    let reasonMeta;
    try {
      reasonMeta = validateStockInReason(stockSourceReason);
    } catch (e) {
      return res.status(e.statusCode || 400).json({ success: false, message: e.message });
    }

    if (reasonMeta.requiresSupplier && !supplierId) {
      return res.status(400).json({
        success: false,
        message: 'Supplier is required for this stock source reason',
      });
    }

    if (reasonMeta.requiresBankAccount && !bankAccountId) {
      return res.status(400).json({
        success: false,
        message: 'Bank account is required for Cash / Bank Purchase',
      });
    }

    const product = await prisma.product.findFirst({
      where: { id: productId, companyId },
    });

    if (!product) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }

    if (supplierId) {
      const supplier = await prisma.supplier.findFirst({
        where: { id: supplierId, companyId },
      });
      if (!supplier) {
        return res.status(404).json({
          success: false,
          message: 'Supplier not found or does not belong to you',
        });
      }
    }

    const previousStock = product.currentStock;
    let totalPieces = 0;
    let stockDetails = {};

    if (stockType === 'bulk' || !stockType) {
      totalPieces = parseFloat(quantity);
      stockDetails = { type: 'bulk', quantityAdded: totalPieces };
    } else if (stockType === 'box') {
      const boxes = parseFloat(boxCount) || 0;
      const pieces = parseFloat(piecesPerBox) || 0;
      totalPieces = boxes * pieces;
      stockDetails = { type: 'box', boxCount: boxes, piecesPerBox: pieces, totalPieces };
    }

    const unitCost =
      unitCostInput != null && unitCostInput !== ''
        ? Number(unitCostInput)
        : Number(product.costPrice) || 0;

    const result = await prisma.$transaction(async (tx) => {
      const locationId = await resolveLocationId(
        tx,
        companyId,
        locationIdInput,
        userId
      );

      const adj = await adjustLocationStock(tx, {
        companyId,
        productId,
        locationId,
        delta: totalPieces,
      });

      const movementData = {
        productId,
        productName: product.name,
        type: 'stock_in',
        quantity: totalPieces,
        previousStock: adj.previousLocationStock,
        newStock: adj.newLocationStock,
        stockType: stockType || 'bulk',
        stockDetails: { ...stockDetails, locationId },
        reason: reasonMeta.label,
        reference: reference || '',
        notes: notes
          ? `${notes}${notes.includes('stockSourceReason') ? '' : `\n[source:${stockSourceReason}]`}`
          : `[source:${stockSourceReason}]`,
        status: 'Completed',
        createdBy: userId,
        companyId,
        locationId,
      };

      if (supplierId) movementData.supplierId = supplierId;
      if (supplierName) movementData.supplierName = supplierName;

      const movement = await tx.stockMovement.create({ data: movementData });

      let journalEntry = null;
      let payableBill = null;
      try {
        journalEntry = await postStockInAccounting(tx, {
          reasonKey: stockSourceReason,
          companyId,
          userId,
          productName: product.name,
          quantity: totalPieces,
          unitCost,
          reference,
          supplierId,
          bankAccountId,
          movementId: movement.id,
        });

        if (stockSourceReason === 'supplier_credit' && journalEntry) {
          const accountingAmount = totalPieces * unitCost;
          payableBill = await createStockCreditPayableBill(tx, {
            companyId,
            userId,
            supplierId,
            supplierName,
            productName: product.name,
            quantity: totalPieces,
            unitCost,
            amount: accountingAmount,
            movementId: movement.id,
            reference,
          });
        }
      } catch (accErr) {
        console.error('Stock In accounting error:', accErr);
        throw accErr;
      }

      return { movement, journalEntry, payableBill, locationId, adj };
    });

    const updatedProduct = await prisma.product.findFirst({
      where: { id: productId, companyId },
    });

    res.status(201).json({
      success: true,
      message: result.journalEntry
        ? 'Stock added and posted to accounting'
        : 'Stock added successfully',
      data: {
        movement: result.movement,
        journalEntry: result.journalEntry
          ? {
              id: result.journalEntry.id,
              entryNumber: result.journalEntry.entryNumber,
              reference: result.journalEntry.reference,
            }
          : null,
        payableBill: result.payableBill
          ? {
              id: result.payableBill.id,
              billNumber: result.payableBill.billNumber,
              outstanding: result.payableBill.outstanding,
            }
          : null,
        product: {
          id: updatedProduct.id,
          name: updatedProduct.name,
          currentStock: updatedProduct.currentStock,
        },
        stockDetails,
        accountingAmount: totalPieces * unitCost,
      },
    });
  } catch (error) {
    console.error('Stock In error:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || 'Server error',
    });
  }
};

// ============================================================
// @desc    Remove stock (Stock Out) (User-specific)
// @route   POST /api/warehouse/stock/out
// @access  Private
// ============================================================
const removeStock = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const userId = req.user.id;
    const {
      productId,
      quantity,
      reason,
      stockOutReason,
      customerName,
      reference,
      notes,
      unitCost: unitCostInput,
      locationId: locationIdInput,
    } = req.body;

    const outReasonKey = stockOutReason || reason;
    if (!productId || !quantity || !outReasonKey) {
      return res.status(400).json({
        success: false,
        message: 'Product ID, quantity and stockOutReason are required',
      });
    }

    let reasonMeta;
    try {
      reasonMeta = validateStockOutReason(outReasonKey);
    } catch (e) {
      return res.status(e.statusCode || 400).json({ success: false, message: e.message });
    }

    const product = await prisma.product.findFirst({
      where: { id: productId, companyId },
    });

    if (!product) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }

    const unitCost =
      unitCostInput != null && unitCostInput !== ''
        ? Number(unitCostInput)
        : Number(product.costPrice) || 0;
    const qty = parseFloat(quantity);

    const result = await prisma.$transaction(async (tx) => {
      const locationId = await resolveLocationId(
        tx,
        companyId,
        locationIdInput,
        userId
      );

      const adj = await adjustLocationStock(tx, {
        companyId,
        productId,
        locationId,
        delta: -qty,
        checkAvailable: true,
        productName: product.name,
      });

      const movement = await tx.stockMovement.create({
        data: {
          productId,
          productName: product.name,
          type: 'stock_out',
          quantity: qty,
          previousStock: adj.previousLocationStock,
          newStock: adj.newLocationStock,
          reason: reasonMeta.label,
          customerName: customerName || '',
          reference: reference || '',
          notes: notes
            ? `${notes}\n[source:${outReasonKey}]`
            : `[source:${outReasonKey}]`,
          status: 'Completed',
          createdBy: userId,
          companyId,
          locationId,
          stockDetails: { locationId },
        },
      });

      const journalEntry = await postStockOutAccounting(tx, {
        reasonKey: outReasonKey,
        companyId,
        userId,
        productName: product.name,
        quantity: qty,
        unitCost,
        reference,
        movementId: movement.id,
      });

      return { movement, journalEntry, locationId };
    });

    const updatedProduct = await prisma.product.findFirst({
      where: { id: productId, companyId },
    });

    res.status(201).json({
      success: true,
      message: result.journalEntry
        ? 'Stock removed and posted to accounting'
        : 'Stock removed successfully',
      data: {
        movement: result.movement,
        journalEntry: result.journalEntry
          ? {
              id: result.journalEntry.id,
              entryNumber: result.journalEntry.entryNumber,
            }
          : null,
        product: {
          id: updatedProduct.id,
          name: updatedProduct.name,
          currentStock: updatedProduct.currentStock,
        },
      },
    });
  } catch (error) {
    console.error('Stock Out error:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || 'Server error',
    });
  }
};

// ============================================================
// @desc    Get stock history for a product (User-specific)
// @route   GET /api/warehouse/stock/history/:productId
// @access  Private
// ============================================================
const getStockHistory = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { productId } = req.params;
    const { page = 1, limit = 20 } = req.query;

    // ✅ Product must belong to company
    const product = await prisma.product.findFirst({
      where: {
        id: productId,
        companyId: companyId
      }
    });

    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    // ✅ Movements must belong to company
    const [movements, total] = await Promise.all([
      prisma.stockMovement.findMany({
        where: {
          productId: productId,
          companyId: companyId // 👈 CRITICAL
        },
        skip,
        take: limitNum,
        orderBy: { createdAt: 'desc' }
      }),
      prisma.stockMovement.count({
        where: {
          productId: productId,
          companyId: companyId
        }
      })
    ]);

    res.status(200).json({
      success: true,
      data: movements,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum)
      }
    });

  } catch (error) {
    console.error('Get stock history error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// ============================================================
// @desc    Get all stock movements (User-specific)
// @route   GET /api/warehouse/stock/movements
// @access  Private
// ============================================================
const getAllStockHistory = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { page = 1, limit = 50, type, search, startDate, endDate, locationId } = req.query;

    // ✅ Base filter with companyId
    const filter = {
      companyId: companyId // 👈 CRITICAL
    };

    if (locationId) {
      filter.locationId = locationId;
    }

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    if (type && type !== 'all') {
      filter.type = type === 'in' ? 'stock_in' : 'stock_out';
    }

    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) {
        filter.createdAt.gte = new Date(startDate);
      }
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        filter.createdAt.lte = end;
      }
    }

    if (search) {
      filter.OR = [
        { productName: { contains: search, mode: 'insensitive' } },
        { reference: { contains: search, mode: 'insensitive' } },
        { notes: { contains: search, mode: 'insensitive' } },
        { customerName: { contains: search, mode: 'insensitive' } },
        { supplierName: { contains: search, mode: 'insensitive' } }
      ];
    }

    const [movements, total, summary] = await Promise.all([
      prisma.stockMovement.findMany({
        where: filter,
        skip,
        take: limitNum,
        orderBy: { createdAt: 'desc' },
        include: {
          product: {
            select: { id: true, name: true, sku: true }
          }
        }
      }),
      prisma.stockMovement.count({ where: filter }),
      getStockSummaryInternal(filter)
    ]);

    res.status(200).json({
      success: true,
      count: movements.length,
      data: movements,
      summary,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum),
        hasNext: pageNum < Math.ceil(total / limitNum),
        hasPrev: pageNum > 1
      }
    });

  } catch (error) {
    console.error('Get all stock history error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// ============================================================
// Internal: Get Stock Summary (User-specific)
// ============================================================
const getStockSummaryInternal = async (filter) => {
  const [totalIn, totalOut] = await Promise.all([
    prisma.stockMovement.aggregate({
      where: { ...filter, type: 'stock_in' },
      _sum: { quantity: true }
    }),
    prisma.stockMovement.aggregate({
      where: { ...filter, type: 'stock_out' },
      _sum: { quantity: true }
    })
  ]);

  return {
    totalIn: totalIn._sum.quantity || 0,
    totalOut: totalOut._sum.quantity || 0,
    netChange: (totalIn._sum.quantity || 0) - (totalOut._sum.quantity || 0)
  };
};

// ============================================================
// @desc    Get today's movements (User-specific)
// @route   GET /api/warehouse/stock/movements/today
// @access  Private
// ============================================================
const getTodayMovements = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { type } = req.query;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const filter = {
      companyId: companyId,
      createdAt: {
        gte: today,
        lt: tomorrow
      }
    };

    if (type && type !== 'all') {
      filter.type = type === 'in' ? 'stock_in' : 'stock_out';
    }

    const [movements, summary] = await Promise.all([
      prisma.stockMovement.findMany({
        where: filter,
        orderBy: { createdAt: 'desc' },
        include: {
          product: {
            select: { id: true, name: true, sku: true }
          }
        }
      }),
      getStockSummaryInternal(filter)
    ]);

    res.status(200).json({
      success: true,
      count: movements.length,
      data: movements,
      summary
    });

  } catch (error) {
    console.error('Get today movements error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// ============================================================
// @desc    Update stock movement status (User-specific)
// @route   PUT /api/warehouse/stock/:id
// @access  Private
// ============================================================
const updateStockMovement = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { id } = req.params;
    const { status, notes } = req.body;

    // ✅ Movement must belong to company
    const movement = await prisma.stockMovement.findFirst({
      where: {
        id: id,
        companyId: companyId
      }
    });

    if (!movement) {
      return res.status(404).json({
        success: false,
        message: 'Stock movement not found'
      });
    }

    const updateData = {};
    if (status) updateData.status = status;
    if (notes !== undefined) updateData.notes = notes;

    const updated = await prisma.stockMovement.update({
      where: { id: id },
      data: updateData
    });

    res.status(200).json({
      success: true,
      message: 'Stock movement updated successfully',
      data: updated
    });

  } catch (error) {
    console.error('Update stock movement error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// ============================================================
// @desc    Delete stock movement (with stock reversal) (User-specific)
// @route   DELETE /api/warehouse/stock/:id
// @access  Private
// ============================================================
const deleteStockMovement = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { id } = req.params;

    // ✅ Movement must belong to company
    const movement = await prisma.stockMovement.findFirst({
      where: {
        id: id,
        companyId: companyId
      }
    });

    if (!movement) {
      return res.status(404).json({
        success: false,
        message: 'Stock movement not found'
      });
    }

    // ✅ Product must belong to company
    const product = await prisma.product.findFirst({
      where: {
        id: movement.productId,
        companyId: companyId
      }
    });

    if (product) {
      let newStock = product.currentStock;
      if (movement.type === 'stock_in') {
        newStock -= movement.quantity;
      } else {
        newStock += movement.quantity;
      }
      await prisma.product.update({
        where: { id: product.id },
        data: {
          currentStock: newStock,
          availableStock: newStock,
          totalValue: newStock * product.costPrice
        }
      });
    }

    await prisma.stockMovement.delete({
      where: { id: id }
    });

    res.status(200).json({
      success: true,
      message: 'Stock movement deleted successfully',
      data: {
        movementId: id,
        reversed: !!product
      }
    });

  } catch (error) {
    console.error('Delete stock movement error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// ============================================================
// @desc    Get stock movement stats (User-specific)
// @route   GET /api/warehouse/stock/stats
// @access  Private
// ============================================================
const getStockStats = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { startDate, endDate } = req.query;

    const filter = {
      companyId: companyId // 👈 CRITICAL
    };
    
    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) {
        filter.createdAt.gte = new Date(startDate);
      }
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        filter.createdAt.lte = end;
      }
    }

    const summary = await getStockSummaryInternal(filter);

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    const todayFilter = {
      companyId: companyId,
      createdAt: {
        gte: today,
        lt: tomorrow
      }
    };
    const todaySummary = await getStockSummaryInternal(todayFilter);

    const recentMovements = await prisma.stockMovement.findMany({
      where: filter,
      take: 10,
      orderBy: { createdAt: 'desc' },
      include: {
        product: {
          select: { id: true, name: true, sku: true }
        }
      }
    });

    res.status(200).json({
      success: true,
      data: {
        summary,
        today: todaySummary,
        recent: recentMovements
      }
    });

  } catch (error) {
    console.error('Get stock stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// ============================================================
// @desc    Get stock movement by ID (User-specific)
// @route   GET /api/warehouse/stock/:id
// @access  Private
// ============================================================
const getStockMovementById = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { id } = req.params;

    // ✅ Movement must belong to company
    const movement = await prisma.stockMovement.findFirst({
      where: {
        id: id,
        companyId: companyId
      },
      include: {
        product: {
          select: { id: true, name: true, sku: true }
        },
        supplier: {
          select: { id: true, name: true }
        }
      }
    });

    if (!movement) {
      return res.status(404).json({
        success: false,
        message: 'Stock movement not found'
      });
    }

    res.status(200).json({
      success: true,
      data: movement
    });

  } catch (error) {
    console.error('Get stock movement error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// ============================================================
// @desc    Bulk stock adjustment (User-specific)
// @route   POST /api/warehouse/stock/bulk-adjust
// @access  Private
// ============================================================
const bulkStockAdjust = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { adjustments, reason, notes } = req.body;

    if (!adjustments || !Array.isArray(adjustments) || adjustments.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Adjustments array is required'
      });
    }

    const results = [];
    const errors = [];

    for (const item of adjustments) {
      try {
        const { productId, newStock } = item;
        
        if (!productId || newStock === undefined) {
          errors.push({ productId, error: 'Product ID and new stock are required' });
          continue;
        }

        // ✅ Product must belong to company
        const product = await prisma.product.findFirst({
          where: {
            id: productId,
            companyId: companyId
          }
        });

        if (!product) {
          errors.push({ productId, error: 'Product not found' });
          continue;
        }

        const previousStock = product.currentStock;
        const quantity = Math.abs(newStock - previousStock);
        const type = newStock > previousStock ? 'stock_in' : 'stock_out';

        await prisma.product.update({
          where: { id: productId },
          data: {
            currentStock: newStock,
            availableStock: newStock,
            totalValue: newStock * product.costPrice
          }
        });

        const movement = await prisma.stockMovement.create({
          data: {
            productId,
            productName: product.name,
            type,
            quantity,
            previousStock,
            newStock,
            stockType: 'bulk',
            stockDetails: {
              type: 'bulk',
              adjustment: true,
              quantityChanged: quantity
            },
            reason: reason || 'Bulk adjustment',
            notes: notes || `Adjusted from ${previousStock} to ${newStock}`,
            createdBy: req.user.id,
            companyId: companyId // 👈 CRITICAL
          }
        });

        results.push({
          productId,
          productName: product.name,
          previousStock,
          newStock,
          movementId: movement.id
        });

      } catch (error) {
        errors.push({
          productId: item.productId,
          error: error.message
        });
      }
    }

    res.status(200).json({
      success: true,
      message: `Bulk adjustment completed: ${results.length} successful, ${errors.length} failed`,
      data: {
        results,
        errors
      }
    });

  } catch (error) {
    console.error('Bulk stock adjustment error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// ============================================================
// @desc    Get low stock products (User-specific)
// @route   GET /api/warehouse/stock/low-stock
// @access  Private
// ============================================================
const getLowStockProducts = async (req, res) => {
  try {
    const companyId = req.user.companyId;

    // ✅ Only company's products
    const products = await prisma.product.findMany({
      where: {
        companyId: companyId,
        isActive: true,
        currentStock: {
          lte: prisma.product.fields.minimumStock
        }
      },
      select: {
        id: true,
        name: true,
        sku: true,
        currentStock: true,
        minimumStock: true,
        maximumStock: true,
        totalValue: true,
        categoryName: true,
        supplierName: true
      },
      orderBy: {
        currentStock: 'asc'
      }
    });

    res.status(200).json({
      success: true,
      count: products.length,
      data: products
    });

  } catch (error) {
    console.error('Get low stock error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// ============================================================
// @desc    Get stock value summary (User-specific)
// @route   GET /api/warehouse/stock/value
// @access  Private
// ============================================================
const getStockValue = async (req, res) => {
  try {
    const companyId = req.user.companyId;

    // ✅ Only company's products
    const products = await prisma.product.findMany({
      where: {
        companyId: companyId,
        isActive: true
      },
      select: {
        name: true,
        sku: true,
        currentStock: true,
        costPrice: true,
        totalValue: true
      }
    });

    const totalItems = products.length;
    const totalStock = products.reduce((sum, p) => sum + p.currentStock, 0);
    const totalValue = products.reduce((sum, p) => sum + p.totalValue, 0);

    const topProducts = products
      .sort((a, b) => b.totalValue - a.totalValue)
      .slice(0, 10);

    res.status(200).json({
      success: true,
      data: {
        summary: {
          totalItems,
          totalStock,
          totalValue
        },
        topProducts
      }
    });

  } catch (error) {
    console.error('Get stock value error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

module.exports = {
  addStock,
  removeStock,
  getStockHistory,
  getAllStockHistory,
  getTodayMovements,
  updateStockMovement,
  deleteStockMovement,
  getStockStats,
  getStockMovementById,
  bulkStockAdjust,
  getLowStockProducts,
  getStockValue,
  getStockReasons,
};