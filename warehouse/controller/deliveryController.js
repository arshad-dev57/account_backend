// warehouse/controller/deliveryController.js - COMPLETE DELIVERY CONTROLLER

const Delivery = require('../models/Delivery');
const prisma = require('../../prisma/client');

// ============================================================
// ─── DELIVERY CONTROLLERS ────────────────────────────────────
// ============================================================

// @desc    Create Delivery against Sales Order
// @route   POST /api/deliveries
// @access  Private
const createDelivery = async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      salesOrderId,
      deliveryDate,
      deliveryPerson,
      trackingNumber,
      notes,
      items
    } = req.body;

    // ─── Validation ──────────────────────────────────────
    if (!salesOrderId) {
      return res.status(400).json({
        success: false,
        message: 'Sales order ID is required'
      });
    }

    if (!deliveryDate) {
      return res.status(400).json({
        success: false,
        message: 'Delivery date is required'
      });
    }

    if (!items || items.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Delivery must have at least one item'
      });
    }

    // ─── Check if sales order exists ─────────────────────
    const salesOrder = await prisma.order.findFirst({
      where: {
        id: salesOrderId,
        userId: userId,
        isActive: true,
        orderType: 'Sales Order'
      },
      include: {
        items: true
      }
    });

    if (!salesOrder) {
      return res.status(404).json({
        success: false,
        message: 'Sales order not found'
      });
    }

    // ─── Check if order is already fully delivered ──────
    if (salesOrder.orderStatus === 'Delivered' || salesOrder.orderStatus === 'Cancelled') {
      return res.status(400).json({
        success: false,
        message: `Cannot create delivery for ${salesOrder.orderStatus} order`
      });
    }

    // ─── Create Delivery ──────────────────────────────────
    const deliveryData = {
      salesOrderId,
      deliveryDate,
      deliveryPerson,
      trackingNumber,
      notes,
      items,
      createdBy: userId,
      userId: userId
    };

    const delivery = await Delivery.create(deliveryData);

    res.status(201).json({
      success: true,
      message: 'Delivery created successfully',
      data: delivery
    });
  } catch (error) {
    console.error('Create delivery error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// @desc    Confirm Delivery (Reduce Stock)
// @route   POST /api/deliveries/:id/confirm
// @access  Private
const confirmDelivery = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    // ─── Check if delivery exists ────────────────────────
    const delivery = await prisma.delivery.findFirst({
      where: {
        id: id,
        userId: userId,
        isActive: true,
        isDeleted: false
      }
    });

    if (!delivery) {
      return res.status(404).json({
        success: false,
        message: 'Delivery not found'
      });
    }

    if (delivery.deliveryStatus === 'Delivered') {
      return res.status(400).json({
        success: false,
        message: 'Delivery is already confirmed'
      });
    }

    if (delivery.confirmedAt) {
      return res.status(400).json({
        success: false,
        message: 'Delivery has already been confirmed'
      });
    }

    // ─── Confirm Delivery ────────────────────────────────
    const confirmedDelivery = await Delivery.confirmDelivery(id, userId);

    res.status(200).json({
      success: true,
      message: 'Delivery confirmed successfully',
      data: confirmedDelivery
    });
  } catch (error) {
    console.error('Confirm delivery error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// @desc    Get Delivery by ID
// @route   GET /api/deliveries/:id
// @access  Private
const getDeliveryById = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    const delivery = await prisma.delivery.findFirst({
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

    if (!delivery) {
      return res.status(404).json({
        success: false,
        message: 'Delivery not found'
      });
    }

    res.status(200).json({
      success: true,
      data: delivery
    });
  } catch (error) {
    console.error('Get delivery error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// @desc    Get Delivery by Delivery Number
// @route   GET /api/deliveries/number/:deliveryNumber
// @access  Private
const getDeliveryByNumber = async (req, res) => {
  try {
    const userId = req.user.id;
    const { deliveryNumber } = req.params;

    const delivery = await prisma.delivery.findFirst({
      where: {
        deliveryNumber: deliveryNumber,
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

    if (!delivery) {
      return res.status(404).json({
        success: false,
        message: 'Delivery not found'
      });
    }

    res.status(200).json({
      success: true,
      data: delivery
    });
  } catch (error) {
    console.error('Get delivery by number error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// @desc    Get Deliveries by Sales Order
// @route   GET /api/deliveries/order/:orderId
// @access  Private
const getDeliveriesByOrder = async (req, res) => {
  try {
    const userId = req.user.id;
    const { orderId } = req.params;

    // ─── Check if order exists ──────────────────────────
    const order = await prisma.order.findFirst({
      where: {
        id: orderId,
        userId: userId,
        isActive: true
      }
    });

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    const deliveries = await Delivery.findBySalesOrder(orderId);

    res.status(200).json({
      success: true,
      count: deliveries.length,
      data: deliveries
    });
  } catch (error) {
    console.error('Get deliveries by order error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// @desc    Get All Deliveries with Filters
// @route   GET /api/deliveries
// @access  Private
const getDeliveries = async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      page = 1,
      limit = 20,
      search,
      status,
      customerId,
      fromDate,
      toDate,
      sortBy = 'deliveryDate',
      sortOrder = 'desc'
    } = req.query;

    const filter = {
      userId: userId,
      isActive: true,
      isDeleted: false
    };

    if (search) {
      filter.OR = [
        { deliveryNumber: { contains: search, mode: 'insensitive' } },
        { customerName: { contains: search, mode: 'insensitive' } },
        { salesOrderNumber: { contains: search, mode: 'insensitive' } }
      ];
    }

    if (status && status !== 'all') {
      filter.deliveryStatus = status;
    }

    if (customerId) {
      filter.customerId = customerId;
    }

    if (fromDate || toDate) {
      filter.deliveryDate = {};
      if (fromDate) filter.deliveryDate.gte = new Date(fromDate);
      if (toDate) {
        const endDate = new Date(toDate);
        endDate.setHours(23, 59, 59, 999);
        filter.deliveryDate.lte = endDate;
      }
    }

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;
    const orderBy = { [sortBy]: sortOrder === 'asc' ? 'asc' : 'desc' };

    const [deliveries, total] = await Promise.all([
      Delivery.findAll(filter, { skip, take: limitNum, orderBy }),
      Delivery.count(filter)
    ]);

    const kpi = await Delivery.getStatusCounts(userId);

    res.status(200).json({
      success: true,
      count: deliveries.length,
      data: deliveries,
      kpi,
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
    console.error('Get deliveries error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// @desc    Update Delivery
// @route   PUT /api/deliveries/:id
// @access  Private
const updateDelivery = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;
    const {
      deliveryDate,
      deliveryPerson,
      trackingNumber,
      notes,
      items
    } = req.body;

    // ─── Check if delivery exists ────────────────────────
    const delivery = await prisma.delivery.findFirst({
      where: {
        id: id,
        userId: userId,
        isActive: true,
        isDeleted: false
      }
    });

    if (!delivery) {
      return res.status(404).json({
        success: false,
        message: 'Delivery not found'
      });
    }

    if (delivery.confirmedAt) {
      return res.status(400).json({
        success: false,
        message: 'Cannot update confirmed delivery'
      });
    }

    // ─── Prepare update data ─────────────────────────────
    const updateData = {
      updatedBy: userId
    };

    if (deliveryDate) updateData.deliveryDate = deliveryDate;
    if (deliveryPerson !== undefined) updateData.deliveryPerson = deliveryPerson;
    if (trackingNumber !== undefined) updateData.trackingNumber = trackingNumber;
    if (notes !== undefined) updateData.notes = notes;
    if (items) updateData.items = items;

    // ─── Update Delivery ──────────────────────────────────
    const updatedDelivery = await Delivery.update(id, updateData);

    res.status(200).json({
      success: true,
      message: 'Delivery updated successfully',
      data: updatedDelivery
    });
  } catch (error) {
    console.error('Update delivery error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// @desc    Delete Delivery (Soft Delete)
// @route   DELETE /api/deliveries/:id
// @access  Private
const deleteDelivery = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    // ─── Check if delivery exists ────────────────────────
    const delivery = await prisma.delivery.findFirst({
      where: {
        id: id,
        userId: userId,
        isActive: true,
        isDeleted: false
      }
    });

    if (!delivery) {
      return res.status(404).json({
        success: false,
        message: 'Delivery not found'
      });
    }

    if (delivery.confirmedAt) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete confirmed delivery'
      });
    }

    // ─── Soft Delete Delivery ────────────────────────────
    await Delivery.softDelete(id, userId);

    res.status(200).json({
      success: true,
      message: 'Delivery deleted successfully'
    });
  } catch (error) {
    console.error('Delete delivery error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// @desc    Get Delivery Statistics
// @route   GET /api/deliveries/stats
// @access  Private
const getDeliveryStats = async (req, res) => {
  try {
    const userId = req.user.id;
    const stats = await Delivery.getStats(userId);
    
    res.status(200).json({
      success: true,
      data: stats
    });
  } catch (error) {
    console.error('Get delivery stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// @desc    Get Delivery KPI
// @route   GET /api/deliveries/kpi
// @access  Private
const getDeliveryKPI = async (req, res) => {
  try {
    const userId = req.user.id;
    const kpi = await Delivery.getStatusCounts(userId);
    
    res.status(200).json({
      success: true,
      data: kpi
    });
  } catch (error) {
    console.error('Get delivery KPI error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// @desc    Get Product Delivery Summary
// @route   GET /api/deliveries/product-summary
// @access  Private
const getProductDeliverySummary = async (req, res) => {
  try {
    const userId = req.user.id;
    const { startDate, endDate } = req.query;

    const summary = await Delivery.getProductDeliverySummary(userId, startDate, endDate);
    
    res.status(200).json({
      success: true,
      data: summary
    });
  } catch (error) {
    console.error('Get product delivery summary error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// @desc    Get Available Sales Orders for Delivery
// @route   GET /api/deliveries/available-orders
// @access  Private
const getAvailableOrdersForDelivery = async (req, res) => {
  try {
    const userId = req.user.id;
    const { search, page = 1, limit = 20 } = req.query;

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

    // Get orders with their deliveries
    const orders = await prisma.order.findMany({
      where,
      include: {
        items: true,
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
      skip: (parseInt(page) - 1) * parseInt(limit),
      take: parseInt(limit),
      orderBy: {
        orderDate: 'desc'
      }
    });

    // Calculate remaining quantities for each order
    const ordersWithRemaining = orders.map(order => {
      // Calculate total delivered per product
      const deliveredQty = {};
      for (const delivery of order.deliveries) {
        for (const item of delivery.items) {
          deliveredQty[item.productId] = (deliveredQty[item.productId] || 0) + item.deliveredQuantity;
        }
      }

      // Calculate remaining quantities
      const remainingItems = order.items.map(item => ({
        ...item,
        deliveredQuantity: deliveredQty[item.productId] || 0,
        remainingQuantity: item.quantity - (deliveredQty[item.productId] || 0)
      })).filter(item => item.remainingQuantity > 0);

      return {
        ...order,
        remainingItems,
        hasRemainingItems: remainingItems.length > 0
      };
    }).filter(order => order.hasRemainingItems);

    const total = ordersWithRemaining.length;

    res.status(200).json({
      success: true,
      count: ordersWithRemaining.length,
      data: ordersWithRemaining,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('Get available orders error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

module.exports = {
  createDelivery,
  confirmDelivery,
  getDeliveryById,
  getDeliveryByNumber,
  getDeliveriesByOrder,
  getDeliveries,
  updateDelivery,
  deleteDelivery,
  getDeliveryStats,
  getDeliveryKPI,
  getProductDeliverySummary,
  getAvailableOrdersForDelivery
};