// warehouse/controller/goodsReceivingController.js - COMPLETE CORRECTED

const GoodsReceiving = require('../models/GoodsReceiving');
const prisma = require('../../prisma/client');

// @desc    Create Goods Receiving
// @route   POST /api/purchase/goods-receiving
// @access  Private
const createGoodsReceiving = async (req, res) => {
  try {
    const userId = req.user.id;
    const companyId = req.user.companyId;
    const {
      purchaseOrderId,
      receivingDate,
      receivedBy,
      notes,
      items,
      status,
      locationId,
    } = req.body;

    // ─── Validation ──────────────────────────────────────
    if (!purchaseOrderId) {
      return res.status(400).json({
        success: false,
        message: 'Purchase order is required'
      });
    }

    if (!items || items.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Goods receiving must have at least one item'
      });
    }

    // ─── Check if purchase order exists ──────────────────
    const purchaseOrder = await prisma.purchaseOrder.findFirst({
      where: {
        id: purchaseOrderId,
        companyId: companyId,
        isActive: true,
        isDeleted: false,
        status: {
          not: 'Cancelled'
        }
      }
    });

    if (!purchaseOrder) {
      return res.status(404).json({
        success: false,
        message: 'Purchase order not found or cancelled'
      });
    }

    // ─── Process Items ──────────────────────────────────
    const processedItems = [];
    for (const item of items) {
      const poItem = await prisma.purchaseOrderItem.findFirst({
        where: {
          id: item.purchaseOrderItemId,
          purchaseOrderId: purchaseOrderId
        }
      });

      if (!poItem) {
        return res.status(404).json({
          success: false,
          message: `Purchase order item ${item.purchaseOrderItemId} not found`
        });
      }

      processedItems.push({
        purchaseOrderItemId: item.purchaseOrderItemId,
        receivingQuantity: item.receivingQuantity,
        notes: item.notes || ''
      });
    }

    // ─── Create Goods Receiving ──────────────────────────
    // ✅ FIXED: Use createdBy and companyId
    const grnData = {
      purchaseOrderId,
      receivingDate: receivingDate || new Date(),
      receivedBy: receivedBy || '',
      notes: notes || '',
      items: processedItems,
      status: status || 'Draft',
      createdBy: userId,
      companyId: companyId,
      locationId: locationId || purchaseOrder.locationId || null,
    };

    const goodsReceiving = await GoodsReceiving.create(grnData);

    res.status(201).json({
      success: true,
      message: 'Goods receiving created successfully',
      data: goodsReceiving
    });
  } catch (error) {
    console.error('Create goods receiving error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// @desc    Confirm Goods Receiving (Update Inventory)
// @route   POST /api/purchase/goods-receiving/:id/confirm
// @access  Private
const confirmGoodsReceiving = async (req, res) => {
  try {
    const userId = req.user.id;
    const companyId = req.user.companyId;
    const { id } = req.params;

    const grn = await prisma.goodsReceiving.findFirst({
      where: {
        id: id,
        companyId: companyId,
        isActive: true,
        isDeleted: false
      }
    });

    if (!grn) {
      return res.status(404).json({
        success: false,
        message: 'Goods receiving not found'
      });
    }

    if (grn.status === 'Fully Received') {
      return res.status(400).json({
        success: false,
        message: 'Goods receiving already fully confirmed'
      });
    }

    if (grn.confirmedAt) {
      return res.status(400).json({
        success: false,
        message: 'Goods receiving already confirmed'
      });
    }

    // ✅ FIXED: Pass companyId to confirmReceiving
    const confirmedGRN = await GoodsReceiving.confirmReceiving(id, userId, companyId);

    res.status(200).json({
      success: true,
      message: 'Goods receiving confirmed successfully',
      data: confirmedGRN
    });
  } catch (error) {
    console.error('Confirm goods receiving error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// @desc    Get All Goods Receivings with Filters
// @route   GET /api/purchase/goods-receiving
// @access  Private
const getGoodsReceivings = async (req, res) => {
  try {
    const userId = req.user.id;
    const companyId = req.user.companyId;
    const {
      page = 1,
      limit = 20,
      search,
      status,
      supplierId,
      purchaseOrderId,
      fromDate,
      toDate,
      sortBy = 'receivingDate',
      sortOrder = 'desc',
      locationId,
    } = req.query;

    const filter = {
      companyId: companyId,
      isActive: true,
      isDeleted: false,
      ...(locationId ? { locationId: String(locationId) } : {}),
    };

    if (search) {
      filter.OR = [
        { grnNumber: { contains: search, mode: 'insensitive' } },
        { supplierName: { contains: search, mode: 'insensitive' } },
        { purchaseOrderNumber: { contains: search, mode: 'insensitive' } }
      ];
    }

    if (status && status !== 'all') {
      filter.status = status;
    }

    if (supplierId) {
      filter.supplierId = supplierId;
    }

    if (purchaseOrderId) {
      filter.purchaseOrderId = purchaseOrderId;
    }

    if (fromDate || toDate) {
      filter.receivingDate = {};
      if (fromDate) filter.receivingDate.gte = new Date(fromDate);
      if (toDate) {
        const endDate = new Date(toDate);
        endDate.setHours(23, 59, 59, 999);
        filter.receivingDate.lte = endDate;
      }
    }

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;
    const orderBy = { [sortBy]: sortOrder === 'asc' ? 'asc' : 'desc' };

    // ✅ FIXED: Pass companyId to getStats
    const [grns, total, stats] = await Promise.all([
      GoodsReceiving.findAll(filter, { skip, take: limitNum, orderBy }),
      GoodsReceiving.count(filter),
      GoodsReceiving.getStats(companyId, locationId || null)
    ]);

    const enriched = grns.map((grn) => ({
      ...grn,
      canConfirm:
        grn.status === 'Draft' &&
        !grn.confirmedAt,
    }));

    res.status(200).json({
      success: true,
      count: enriched.length,
      data: enriched,
      stats,
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
    console.error('Get goods receivings error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// @desc    Get Goods Receiving by ID
// @route   GET /api/purchase/goods-receiving/:id
// @access  Private
const getGoodsReceivingById = async (req, res) => {
  try {
    const userId = req.user.id;
    const companyId = req.user.companyId;
    const { id } = req.params;

    const grn = await GoodsReceiving.findById(id);

    if (!grn) {
      return res.status(404).json({
        success: false,
        message: 'Goods receiving not found'
      });
    }

    res.status(200).json({
      success: true,
      data: {
        ...grn,
        canConfirm: grn.status === 'Draft' && !grn.confirmedAt,
      },
    });
  } catch (error) {
    console.error('Get goods receiving error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// @desc    Get Goods Receiving by GRN Number
// @route   GET /api/purchase/goods-receiving/number/:grnNumber
// @access  Private
const getGoodsReceivingByNumber = async (req, res) => {
  try {
    const userId = req.user.id;
    const companyId = req.user.companyId;
    const { grnNumber } = req.params;

    const grn = await prisma.goodsReceiving.findFirst({
      where: {
        grnNumber: grnNumber,
        companyId: companyId,
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

    if (!grn) {
      return res.status(404).json({
        success: false,
        message: 'Goods receiving not found'
      });
    }

    res.status(200).json({
      success: true,
      data: grn
    });
  } catch (error) {
    console.error('Get goods receiving by number error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// @desc    Get Goods Receivings by Purchase Order
// @route   GET /api/purchase/goods-receiving/order/:purchaseOrderId
// @access  Private
const getGoodsReceivingsByOrder = async (req, res) => {
  try {
    const userId = req.user.id;
    const companyId = req.user.companyId;
    const { purchaseOrderId } = req.params;

    const grns = await GoodsReceiving.findByPurchaseOrder(purchaseOrderId);

    res.status(200).json({
      success: true,
      count: grns.length,
      data: grns
    });
  } catch (error) {
    console.error('Get goods receivings by order error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// @desc    Update Goods Receiving (Draft only)
// @route   PUT /api/purchase/goods-receiving/:id
// @access  Private
const updateGoodsReceiving = async (req, res) => {
  try {
    const userId = req.user.id;
    const companyId = req.user.companyId;
    const { id } = req.params;
    const {
      receivingDate,
      receivedBy,
      notes,
      items,
      status
    } = req.body;

    const grn = await prisma.goodsReceiving.findFirst({
      where: {
        id: id,
        companyId: companyId,
        isActive: true,
        isDeleted: false
      }
    });

    if (!grn) {
      return res.status(404).json({
        success: false,
        message: 'Goods receiving not found'
      });
    }

    if (grn.confirmedAt) {
      return res.status(400).json({
        success: false,
        message: 'Cannot update confirmed goods receiving'
      });
    }

    const updateData = {
      updatedBy: userId,
      ...(receivingDate && { receivingDate: new Date(receivingDate) }),
      ...(receivedBy !== undefined && { receivedBy }),
      ...(notes !== undefined && { notes }),
      ...(status && { status })
    };

    if (items) {
      const processedItems = [];
      for (const item of items) {
        const poItem = await prisma.purchaseOrderItem.findFirst({
          where: {
            id: item.purchaseOrderItemId,
            purchaseOrderId: grn.purchaseOrderId
          }
        });

        if (!poItem) {
          return res.status(404).json({
            success: false,
            message: `Purchase order item ${item.purchaseOrderItemId} not found`
          });
        }

        processedItems.push({
          purchaseOrderItemId: item.purchaseOrderItemId,
          receivingQuantity: item.receivingQuantity,
          notes: item.notes || ''
        });
      }
      updateData.items = processedItems;
    }

    const updatedGRN = await GoodsReceiving.update(id, updateData);

    res.status(200).json({
      success: true,
      message: 'Goods receiving updated successfully',
      data: updatedGRN
    });
  } catch (error) {
    console.error('Update goods receiving error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// @desc    Delete Goods Receiving (Soft Delete)
// @route   DELETE /api/purchase/goods-receiving/:id
// @access  Private
const deleteGoodsReceiving = async (req, res) => {
  try {
    const userId = req.user.id;
    const companyId = req.user.companyId;
    const { id } = req.params;

    const grn = await prisma.goodsReceiving.findFirst({
      where: {
        id: id,
        companyId: companyId,
        isActive: true,
        isDeleted: false
      }
    });

    if (!grn) {
      return res.status(404).json({
        success: false,
        message: 'Goods receiving not found'
      });
    }

    if (grn.confirmedAt) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete confirmed goods receiving'
      });
    }

    await GoodsReceiving.softDelete(id, userId);

    res.status(200).json({
      success: true,
      message: 'Goods receiving deleted successfully'
    });
  } catch (error) {
    console.error('Delete goods receiving error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// @desc    Get Goods Receiving Stats
// @route   GET /api/purchase/goods-receiving/stats
// @access  Private
const getGoodsReceivingStats = async (req, res) => {
  try {
    const userId = req.user.id;
    const companyId = req.user.companyId;
    // ✅ FIXED: Pass companyId
    const stats = await GoodsReceiving.getStats(companyId);

    res.status(200).json({
      success: true,
      data: stats
    });
  } catch (error) {
    console.error('Get goods receiving stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// @desc    Get Supplier Goods Receiving Summary
// @route   GET /api/purchase/goods-receiving/supplier/:supplierId/summary
// @access  Private
const getSupplierGoodsReceivingSummary = async (req, res) => {
  try {
    const userId = req.user.id;
    const companyId = req.user.companyId;
    const { supplierId } = req.params;

    // ✅ FIXED: Pass companyId first
    const summary = await GoodsReceiving.getSupplierSummary(companyId, supplierId);

    res.status(200).json({
      success: true,
      data: summary
    });
  } catch (error) {
    console.error('Get supplier goods receiving summary error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// @desc    Get Available Purchase Orders for Receiving
// @route   GET /api/purchase/goods-receiving/available-orders
// @access  Private
const getAvailablePurchaseOrders = async (req, res) => {
  try {
    const userId = req.user.id;
    const companyId = req.user.companyId;
    const { search, page = 1, limit = 20, locationId } = req.query;

    const where = {
      companyId: companyId,
      isActive: true,
      isDeleted: false,
      status: {
        notIn: ['Cancelled']
      },
      ...(locationId ? { locationId: String(locationId) } : {}),
    };

    if (search) {
      where.OR = [
        { orderNumber: { contains: search, mode: 'insensitive' } },
        { supplierName: { contains: search, mode: 'insensitive' } }
      ];
    }

    const orders = await prisma.purchaseOrder.findMany({
      where,
      include: {
        items: {
          include: {
            product: true
          }
        },
        supplier: true,
        goodsReceivings: {
          where: {
            isActive: true,
            isDeleted: false,
            status: { in: ['Partially Received', 'Fully Received'] }
          },
          include: {
            items: true
          }
        }
      },
      skip: (parseInt(page) - 1) * parseInt(limit),
      take: parseInt(limit),
      orderBy: {
        orderDate: 'desc'
      }
    });

    const availableOrders = orders.map(order => {
      const receivedQty = {};
      for (const grn of order.goodsReceivings) {
        for (const item of grn.items) {
          receivedQty[item.purchaseOrderItemId] = 
            (receivedQty[item.purchaseOrderItemId] || 0) + item.receivingQuantity;
        }
      }

      const remainingItems = order.items.map(item => ({
        ...item,
        alreadyReceived: receivedQty[item.id] || 0,
        remainingQuantity: item.quantity - (receivedQty[item.id] || 0),
        receivingQuantity: 0
      })).filter(item => item.remainingQuantity > 0);

      return {
        ...order,
        remainingItems,
        hasRemainingItems: remainingItems.length > 0
      };
    }).filter(order => order.hasRemainingItems);

    const total = availableOrders.length;

    res.status(200).json({
      success: true,
      count: availableOrders.length,
      data: availableOrders,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('Get available purchase orders error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// @desc    Print Goods Receiving
// @route   GET /api/purchase/goods-receiving/:id/print
// @access  Private
const printGoodsReceiving = async (req, res) => {
  try {
    const userId = req.user.id;
    const companyId = req.user.companyId;
    const { id } = req.params;

    const grn = await prisma.goodsReceiving.findFirst({
      where: {
        id: id,
        companyId: companyId,
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

    if (!grn) {
      return res.status(404).json({
        success: false,
        message: 'Goods receiving not found'
      });
    }

    res.status(200).json({
      success: true,
      message: 'GRN data for print',
      data: grn
    });
  } catch (error) {
    console.error('Print goods receiving error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// ─── EXPORT CONTROLLERS ──────────────────────────────────────

module.exports = {
  createGoodsReceiving,
  confirmGoodsReceiving,
  getGoodsReceivings,
  getGoodsReceivingById,
  getGoodsReceivingByNumber,
  getGoodsReceivingsByOrder,
  updateGoodsReceiving,
  deleteGoodsReceiving,
  getGoodsReceivingStats,
  getSupplierGoodsReceivingSummary,
  getAvailablePurchaseOrders,
  printGoodsReceiving
};