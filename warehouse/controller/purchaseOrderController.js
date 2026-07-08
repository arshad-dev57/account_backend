// warehouse/controller/purchaseOrderController.js - COMPLETE

const PurchaseOrder = require('../models/PurchaseOrder');
const prisma = require('../../prisma/client');

// ============================================================
// ─── PURCHASE ORDER CONTROLLERS ──────────────────────────────
// ============================================================

// @desc    Create Purchase Order
// @route   POST /api/purchase/orders
// @access  Private
const createPurchaseOrder = async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      supplierId,
      supplierName,
      supplierEmail,
      supplierPhone,
      supplierAddress,
      orderDate,
      expectedDeliveryDate,
      items,
      notes,
      termsConditions,
      status
    } = req.body;

    // ─── Validation ──────────────────────────────────────
    if (!supplierId) {
      return res.status(400).json({
        success: false,
        message: 'Supplier is required'
      });
    }

    if (!items || items.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Purchase order must have at least one item'
      });
    }

    // ─── Process Items ──────────────────────────────────
    const processedItems = [];
    for (const item of items) {
      let product;

      if (item.productId) {
        product = await prisma.product.findFirst({
          where: {
            id: item.productId,
            userId: userId,
            isActive: true
          }
        });
      } else if (item.sku) {
        product = await prisma.product.findFirst({
          where: {
            sku: item.sku,
            userId: userId,
            isActive: true
          }
        });
      }

      if (!product) {
        return res.status(404).json({
          success: false,
          message: `Product not found: ${item.productName || item.sku || item.productId}`
        });
      }

      processedItems.push({
        productId: product.id,
        productName: product.name,
        sku: product.sku,
        quantity: item.quantity,
        unitPrice: item.unitPrice || product.costPrice || 0,
        discount: item.discount || 0,
        taxRate: item.taxRate || product.taxRate || 0,
        notes: item.notes || '',
      });
    }

    // ─── Create Purchase Order ──────────────────────────
    const orderData = {
      supplierId,
      supplierName,
      supplierEmail,
      supplierPhone,
      supplierAddress,
      orderDate: orderDate || new Date(),
      expectedDeliveryDate: expectedDeliveryDate || null,
      items: processedItems,
      notes: notes || '',
      termsConditions: termsConditions || '',
      status: status || 'Draft',
      createdBy: userId,
      userId: userId
    };

    const purchaseOrder = await PurchaseOrder.create(orderData);

    res.status(201).json({
      success: true,
      message: 'Purchase order created successfully',
      data: purchaseOrder
    });
  } catch (error) {
    console.error('Create purchase order error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// @desc    Get All Purchase Orders with Filters
// @route   GET /api/purchase/orders
// @access  Private
const getPurchaseOrders = async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      page = 1,
      limit = 20,
      search,
      status,
      supplierId,
      fromDate,
      toDate,
      sortBy = 'orderDate',
      sortOrder = 'desc'
    } = req.query;

    const filter = {
      userId: userId,
      isActive: true,
      isDeleted: false
    };

    if (search) {
      filter.OR = [
        { orderNumber: { contains: search, mode: 'insensitive' } },
        { supplierName: { contains: search, mode: 'insensitive' } },
        { supplierEmail: { contains: search, mode: 'insensitive' } }
      ];
    }

    if (status && status !== 'all') {
      filter.status = status;
    }

    if (supplierId) {
      filter.supplierId = supplierId;
    }

    if (fromDate || toDate) {
      filter.orderDate = {};
      if (fromDate) filter.orderDate.gte = new Date(fromDate);
      if (toDate) {
        const endDate = new Date(toDate);
        endDate.setHours(23, 59, 59, 999);
        filter.orderDate.lte = endDate;
      }
    }

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;
    const orderBy = { [sortBy]: sortOrder === 'asc' ? 'asc' : 'desc' };

    const [orders, total, stats] = await Promise.all([
      PurchaseOrder.findAll(filter, { skip, take: limitNum, orderBy }),
      PurchaseOrder.count(filter),
      PurchaseOrder.getStats(userId)
    ]);

    res.status(200).json({
      success: true,
      count: orders.length,
      data: orders,
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
    console.error('Get purchase orders error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// @desc    Get Purchase Order by ID
// @route   GET /api/purchase/orders/:id
// @access  Private
const getPurchaseOrderById = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    const order = await prisma.purchaseOrder.findFirst({
      where: {
        id: id,
        userId: userId,
        isActive: true,
        isDeleted: false
      },
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

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Purchase order not found'
      });
    }

    res.status(200).json({
      success: true,
      data: order
    });
  } catch (error) {
    console.error('Get purchase order error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// @desc    Get Purchase Order by Number
// @route   GET /api/purchase/orders/number/:orderNumber
// @access  Private
const getPurchaseOrderByNumber = async (req, res) => {
  try {
    const userId = req.user.id;
    const { orderNumber } = req.params;

    const order = await prisma.purchaseOrder.findFirst({
      where: {
        orderNumber: orderNumber,
        userId: userId,
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
        supplier: true,
        creator: {
          select: { id: true, firstName: true, lastName: true, email: true }
        }
      }
    });

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Purchase order not found'
      });
    }

    res.status(200).json({
      success: true,
      data: order
    });
  } catch (error) {
    console.error('Get purchase order by number error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// @desc    Update Purchase Order
// @route   PUT /api/purchase/orders/:id
// @access  Private
const updatePurchaseOrder = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;
    const {
      supplierId,
      supplierName,
      supplierEmail,
      supplierPhone,
      supplierAddress,
      orderDate,
      expectedDeliveryDate,
      items,
      notes,
      termsConditions,
      status
    } = req.body;

    // ─── Check if order exists ──────────────────────────
    const order = await prisma.purchaseOrder.findFirst({
      where: {
        id: id,
        userId: userId,
        isActive: true,
        isDeleted: false
      }
    });

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Purchase order not found'
      });
    }

    // ─── Don't allow update if cancelled or approved ────
    if (order.status === 'Cancelled') {
      return res.status(400).json({
        success: false,
        message: 'Cannot update cancelled purchase order'
      });
    }

    if (order.status === 'Approved') {
      return res.status(400).json({
        success: false,
        message: 'Cannot update approved purchase order'
      });
    }

    // ─── Prepare update data ─────────────────────────────
    const updateData = {
      updatedBy: userId,
      ...(supplierId && { supplierId }),
      ...(supplierName && { supplierName }),
      ...(supplierEmail !== undefined && { supplierEmail }),
      ...(supplierPhone !== undefined && { supplierPhone }),
      ...(supplierAddress !== undefined && { supplierAddress }),
      ...(orderDate && { orderDate: new Date(orderDate) }),
      ...(expectedDeliveryDate && { expectedDeliveryDate: new Date(expectedDeliveryDate) }),
      ...(status && { status }),
      ...(notes !== undefined && { notes }),
      ...(termsConditions !== undefined && { termsConditions })
    };

    // ─── Process items if provided ──────────────────────
    if (items) {
      const processedItems = [];
      for (const item of items) {
        let product;

        if (item.productId) {
          product = await prisma.product.findFirst({
            where: {
              id: item.productId,
              userId: userId,
              isActive: true
            }
          });
        } else if (item.sku) {
          product = await prisma.product.findFirst({
            where: {
              sku: item.sku,
              userId: userId,
              isActive: true
            }
          });
        }

        if (!product) {
          return res.status(404).json({
            success: false,
            message: `Product not found: ${item.productName || item.sku || item.productId}`
          });
        }

        processedItems.push({
          productId: product.id,
          productName: product.name,
          sku: product.sku,
          quantity: item.quantity,
          unitPrice: item.unitPrice || product.costPrice || 0,
          discount: item.discount || 0,
          taxRate: item.taxRate || product.taxRate || 0,
          notes: item.notes || '',
        });
      }
      updateData.items = processedItems;
    }

    // ─── Update Purchase Order ──────────────────────────
    const updatedOrder = await PurchaseOrder.update(id, updateData);

    res.status(200).json({
      success: true,
      message: 'Purchase order updated successfully',
      data: updatedOrder
    });
  } catch (error) {
    console.error('Update purchase order error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// @desc    Update Purchase Order Status
// @route   PATCH /api/purchase/orders/:id/status
// @access  Private
const updatePurchaseOrderStatus = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;
    const { status, notes } = req.body;

    if (!status) {
      return res.status(400).json({
        success: false,
        message: 'Status is required'
      });
    }

    // ─── Check if order exists ──────────────────────────
    const order = await prisma.purchaseOrder.findFirst({
      where: {
        id: id,
        userId: userId,
        isActive: true,
        isDeleted: false
      }
    });

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Purchase order not found'
      });
    }

    // ─── Update Status ──────────────────────────────────
    const updatedOrder = await PurchaseOrder.updateStatus(id, status, userId, notes);

    res.status(200).json({
      success: true,
      message: `Purchase order status updated to ${status}`,
      data: updatedOrder
    });
  } catch (error) {
    console.error('Update purchase order status error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// @desc    Send Purchase Order (Email)
// @route   POST /api/purchase/orders/:id/send
// @access  Private
const sendPurchaseOrder = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    // ─── Check if order exists ──────────────────────────
    const order = await prisma.purchaseOrder.findFirst({
      where: {
        id: id,
        userId: userId,
        isActive: true,
        isDeleted: false
      },
      include: {
        supplier: true
      }
    });

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Purchase order not found'
      });
    }

    if (order.status === 'Cancelled') {
      return res.status(400).json({
        success: false,
        message: 'Cannot send cancelled purchase order'
      });
    }

    if (!order.supplierEmail) {
      return res.status(400).json({
        success: false,
        message: 'Supplier email is not configured'
      });
    }

    // ─── Send Order ──────────────────────────────────────
    const sentOrder = await PurchaseOrder.sendOrder(id, userId);

    res.status(200).json({
      success: true,
      message: `Purchase order sent to ${order.supplierEmail}`,
      data: sentOrder
    });
  } catch (error) {
    console.error('Send purchase order error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// @desc    Cancel Purchase Order
// @route   POST /api/purchase/orders/:id/cancel
// @access  Private
const cancelPurchaseOrder = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;
    const { reason } = req.body;

    // ─── Check if order exists ──────────────────────────
    const order = await prisma.purchaseOrder.findFirst({
      where: {
        id: id,
        userId: userId,
        isActive: true,
        isDeleted: false
      }
    });

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Purchase order not found'
      });
    }

    if (order.status === 'Cancelled') {
      return res.status(400).json({
        success: false,
        message: 'Purchase order already cancelled'
      });
    }

    // ─── Cancel Order ──────────────────────────────────
    const cancelledOrder = await PurchaseOrder.cancelOrder(id, userId, reason);

    res.status(200).json({
      success: true,
      message: 'Purchase order cancelled successfully',
      data: cancelledOrder
    });
  } catch (error) {
    console.error('Cancel purchase order error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// @desc    Delete Purchase Order (Soft Delete)
// @route   DELETE /api/purchase/orders/:id
// @access  Private
const deletePurchaseOrder = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    // ─── Check if order exists ──────────────────────────
    const order = await prisma.purchaseOrder.findFirst({
      where: {
        id: id,
        userId: userId,
        isActive: true,
        isDeleted: false
      }
    });

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Purchase order not found'
      });
    }

    if (order.status === 'Approved') {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete approved purchase order'
      });
    }

    // ─── Soft Delete ─────────────────────────────────────
    await PurchaseOrder.softDelete(id, userId);

    res.status(200).json({
      success: true,
      message: 'Purchase order deleted successfully'
    });
  } catch (error) {
    console.error('Delete purchase order error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// @desc    Get Purchase Order Stats
// @route   GET /api/purchase/orders/stats
// @access  Private
const getPurchaseOrderStats = async (req, res) => {
  try {
    const userId = req.user.id;
    const stats = await PurchaseOrder.getStats(userId);

    res.status(200).json({
      success: true,
      data: stats
    });
  } catch (error) {
    console.error('Get purchase order stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// @desc    Get Supplier Purchase Order Summary
// @route   GET /api/purchase/orders/supplier/:supplierId/summary
// @access  Private
const getSupplierPurchaseOrderSummary = async (req, res) => {
  try {
    const userId = req.user.id;
    const { supplierId } = req.params;

    const summary = await PurchaseOrder.getSupplierSummary(userId, supplierId);

    res.status(200).json({
      success: true,
      data: summary
    });
  } catch (error) {
    console.error('Get supplier purchase order summary error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// @desc    Get Purchase Order Summary
// @route   GET /api/purchase/orders/summary
// @access  Private
const getPurchaseOrderSummary = async (req, res) => {
  try {
    const userId = req.user.id;
    const summary = await PurchaseOrder.getSummary(userId);

    res.status(200).json({
      success: true,
      data: summary
    });
  } catch (error) {
    console.error('Get purchase order summary error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// ─── EXPORT CONTROLLERS ──────────────────────────────────────

module.exports = {
  createPurchaseOrder,
  getPurchaseOrders,
  getPurchaseOrderById,
  getPurchaseOrderByNumber,
  updatePurchaseOrder,
  updatePurchaseOrderStatus,
  sendPurchaseOrder,
  cancelPurchaseOrder,
  deletePurchaseOrder,
  getPurchaseOrderStats,
  getSupplierPurchaseOrderSummary,
  getPurchaseOrderSummary
};