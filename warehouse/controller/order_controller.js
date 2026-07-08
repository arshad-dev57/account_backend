// warehouse/controller/orderController.js - COMPLETE SALES & PURCHASE ORDER CONTROLLER

const Order = require('../models/Order');
const prisma = require('../../prisma/client');

// ============================================================
// HELPER: Auto-Generate Invoice
// ============================================================
const autoGenerateInvoice = async (order, userId) => {
  try {
    const year = new Date().getFullYear();
    const month = String(new Date().getMonth() + 1).padStart(2, '0');
    const day = String(new Date().getDate()).padStart(2, '0');
    const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
    
    // Different invoice prefix for Sales and Purchase
    const prefix = order.orderType === 'Sales Order' ? 'SI' : 'PI';
    const invoiceNumber = `${prefix}-${year}${month}${day}-${random}`;

    const invoice = await prisma.warehouseInvoice.create({
      data: {
        invoiceNumber,
        invoiceDate: new Date(),
        dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        orderId: order.id,
        orderNumber: order.orderNumber,
        customerName: order.customerName,
        customerEmail: order.customerEmail || '',
        customerPhone: order.customerPhone || '',
        subtotal: order.subtotal,
        taxTotal: order.taxTotal || 0,
        discountTotal: order.discountTotal || 0,
        grandTotal: order.grandTotal,
        paidAmount: 0,
        outstanding: order.grandTotal,
        invoiceStatus: 'Draft',
        paymentStatus: 'Unpaid',
        notes: order.customerNotes || '',
        createdBy: userId,
        updatedBy: userId,
        userId: userId,
        items: {
          create: order.items.map(item => ({
            productId: item.productId,
            productName: item.productName,
            sku: item.sku,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            totalPrice: item.totalPrice,
            taxRate: item.taxRate || 0,
            taxAmount: item.taxAmount || 0,
            discount: item.discount || 0,
          }))
        }
      },
      include: { items: true }
    });

    console.log(`✅ ${order.orderType} Invoice auto-generated: ${invoiceNumber}`);
    return invoice;
  } catch (error) {
    console.error('Auto-generate invoice error:', error);
    return null;
  }
};

// ============================================================
// ─── SALES ORDER CONTROLLERS ────────────────────────────────
// ============================================================

// @desc    Create Sales Order
// @route   POST /api/sales/orders
// @access  Private
const createSalesOrder = async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      customerName,
      customerEmail,
      customerPhone,
      customerType,
      customerCompany,
      customerTaxId,
      shippingAddress,
      billingAddress,
      items,
      priority,
      source,
      salesPerson,
      expectedDeliveryDate,
      shippingMethod,
      shippingCarrier,
      shippingCost,
      paymentMethod,
      paymentStatus,
      couponCode,
      discountTotal,
      customerNotes,
      internalNotes,
      tags,
    } = req.body;

    // ─── Validation ──────────────────────────────────────
    if (!customerName) {
      return res.status(400).json({
        success: false,
        message: 'Customer name is required',
      });
    }

    if (!items || items.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Sales order must have at least one item',
      });
    }

    // ─── Process Items ──────────────────────────────────
    let subtotal = 0;
    let taxTotal = 0;
    let totalWeight = 0;
    const orderItems = [];

    for (const item of items) {
      let product;

      if (item.productId) {
        product = await prisma.product.findFirst({
          where: {
            id: item.productId,
            userId: userId
          }
        });
      } else if (item.sku) {
        product = await prisma.product.findFirst({
          where: {
            sku: item.sku,
            userId: userId
          }
        });
      } else if (item.productName) {
        product = await prisma.product.findFirst({
          where: {
            name: { contains: item.productName, mode: 'insensitive' },
            userId: userId
          }
        });
      }

      if (!product) {
        return res.status(404).json({
          success: false,
          message: `Product not found: ${item.productName || item.sku || item.productId}`,
        });
      }

      if (product.currentStock < item.quantity) {
        return res.status(400).json({
          success: false,
          message: `Insufficient stock for ${product.name}. Available: ${product.currentStock}`,
        });
      }

      const unitPrice = item.unitPrice || product.sellingPrice;
      const totalPrice = unitPrice * item.quantity;
      const taxAmount = (totalPrice * (item.taxRate || 0)) / 100;
      const itemWeight = (item.weight || product.weight || 0) * item.quantity;

      orderItems.push({
        productId: product.id,
        productName: product.name,
        sku: product.sku,
        quantity: item.quantity,
        unitPrice,
        totalPrice,
        weight: item.weight || product.weight || 0,
        weightUnit: item.weightUnit || product.weightUnit || 'KG',
        dimensions: item.dimensions || '',
        taxRate: item.taxRate || 0,
        taxAmount,
        discount: item.discount || 0,
        batchNumber: item.batchNumber || '',
        serialNumber: item.serialNumber || '',
        notes: item.notes || '',
      });

      subtotal += totalPrice;
      taxTotal += taxAmount;
      totalWeight += itemWeight;
    }

    // ─── Calculate Grand Total ──────────────────────────
    const shippingCostAmount = shippingCost || 0;
    const discountAmount = discountTotal || 0;
    const grandTotal = subtotal + taxTotal + shippingCostAmount - discountAmount;
    const totalItems = items.reduce((sum, i) => sum + i.quantity, 0);

    // ─── Create Sales Order ──────────────────────────────
    const orderData = {
      customerName,
      customerEmail,
      customerPhone,
      customerType: customerType || 'Individual',
      customerCompany,
      customerTaxId,
      shippingAddress: shippingAddress || {},
      billingAddress: billingAddress || {},
      items: orderItems,
      subtotal,
      taxTotal,
      shippingCost: shippingCostAmount,
      discountTotal: discountAmount,
      grandTotal,
      totalWeight,
      totalItems,
      orderType: 'Sales Order',
      priority: priority || 'Medium',
      source: source || 'Web',
      salesPerson: salesPerson || '',
      expectedDeliveryDate: expectedDeliveryDate || null,
      shippingMethod: shippingMethod || 'Standard',
      shippingCarrier: shippingCarrier || '',
      paymentMethod: paymentMethod || 'Cash',
      paymentStatus: paymentStatus || 'Pending',
      couponCode: couponCode || '',
      customerNotes: customerNotes || '',
      internalNotes: internalNotes || '',
      tags: tags || [],
      createdBy: userId,
      userId: userId
    };

    const order = await Order.create(orderData);

    // ─── Auto-Generate Invoice ───────────────────────────
    const invoice = await autoGenerateInvoice(order, userId);

    res.status(201).json({
      success: true,
      message: 'Sales Order created successfully',
      data: order,
      invoice: invoice
        ? { invoiceNumber: invoice.invoiceNumber, id: invoice.id }
        : null,
    });
  } catch (error) {
    console.error('Create sales order error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
};

// @desc    Get all Sales Orders
// @route   GET /api/sales/orders
// @access  Private
const getSalesOrders = async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      page = 1,
      limit = 20,
      search,
      status,
      paymentStatus,
      fromDate,
      toDate,
      sortBy = 'orderDate',
      sortOrder = 'desc',
    } = req.query;

    const filter = {
      isActive: true,
      userId: userId,
      orderType: 'Sales Order'
    };

    if (search) {
      filter.OR = [
        { orderNumber: { contains: search, mode: 'insensitive' } },
        { customerName: { contains: search, mode: 'insensitive' } },
        { customerEmail: { contains: search, mode: 'insensitive' } },
        { customerCompany: { contains: search, mode: 'insensitive' } },
      ];
    }

    if (status && status !== 'all') filter.orderStatus = status;
    if (paymentStatus && paymentStatus !== 'all') filter.paymentStatus = paymentStatus;

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

    const [orders, total] = await Promise.all([
      Order.findSalesOrders(filter, { skip, take: limitNum, orderBy }),
      Order.countSalesOrders(filter),
    ]);

    const kpi = await Order.getStatusCounts(userId, 'Sales Order');

    res.status(200).json({
      success: true,
      count: orders.length,
      data: orders,
      kpi,
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
    console.error('Get sales orders error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// ============================================================
// ─── PURCHASE ORDER CONTROLLERS ─────────────────────────────
// ============================================================

// @desc    Create Purchase Order
// @route   POST /api/purchase/orders
// @access  Private
const createPurchaseOrder = async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      supplierName,
      supplierEmail,
      supplierPhone,
      shippingAddress,
      billingAddress,
      items,
      priority,
      source,
      expectedDeliveryDate,
      shippingMethod,
      shippingCarrier,
      shippingCost,
      paymentMethod,
      paymentStatus,
      couponCode,
      discountTotal,
      internalNotes,
      tags,
    } = req.body;

    // ─── Validation ──────────────────────────────────────
    if (!supplierName) {
      return res.status(400).json({
        success: false,
        message: 'Supplier name is required',
      });
    }

    if (!items || items.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Purchase order must have at least one item',
      });
    }

    // ─── Process Items ──────────────────────────────────
    let subtotal = 0;
    let taxTotal = 0;
    let totalWeight = 0;
    const orderItems = [];

    for (const item of items) {
      let product;

      if (item.productId) {
        product = await prisma.product.findFirst({
          where: {
            id: item.productId,
            userId: userId
          }
        });
      } else if (item.sku) {
        product = await prisma.product.findFirst({
          where: {
            sku: item.sku,
            userId: userId
          }
        });
      } else if (item.productName) {
        product = await prisma.product.findFirst({
          where: {
            name: { contains: item.productName, mode: 'insensitive' },
            userId: userId
          }
        });
      }

      if (!product) {
        return res.status(404).json({
          success: false,
          message: `Product not found: ${item.productName || item.sku || item.productId}`,
        });
      }

      const unitPrice = item.unitPrice || product.costPrice;
      const totalPrice = unitPrice * item.quantity;
      const taxAmount = (totalPrice * (item.taxRate || 0)) / 100;
      const itemWeight = (item.weight || product.weight || 0) * item.quantity;

      orderItems.push({
        productId: product.id,
        productName: product.name,
        sku: product.sku,
        quantity: item.quantity,
        unitPrice,
        totalPrice,
        weight: item.weight || product.weight || 0,
        weightUnit: item.weightUnit || product.weightUnit || 'KG',
        dimensions: item.dimensions || '',
        taxRate: item.taxRate || 0,
        taxAmount,
        discount: item.discount || 0,
        batchNumber: item.batchNumber || '',
        serialNumber: item.serialNumber || '',
        notes: item.notes || '',
      });

      subtotal += totalPrice;
      taxTotal += taxAmount;
      totalWeight += itemWeight;
    }

    // ─── Calculate Grand Total ──────────────────────────
    const shippingCostAmount = shippingCost || 0;
    const discountAmount = discountTotal || 0;
    const grandTotal = subtotal + taxTotal + shippingCostAmount - discountAmount;
    const totalItems = items.reduce((sum, i) => sum + i.quantity, 0);

    // ─── Create Purchase Order ──────────────────────────────
    const orderData = {
      customerName: supplierName,
      customerEmail: supplierEmail,
      customerPhone: supplierPhone,
      customerType: 'Supplier',
      customerCompany: supplierName,
      customerTaxId: '',
      shippingAddress: shippingAddress || {},
      billingAddress: billingAddress || {},
      items: orderItems,
      subtotal,
      taxTotal,
      shippingCost: shippingCostAmount,
      discountTotal: discountAmount,
      grandTotal,
      totalWeight,
      totalItems,
      orderType: 'Purchase Order',
      priority: priority || 'Medium',
      source: source || 'Manual',
      salesPerson: '',
      expectedDeliveryDate: expectedDeliveryDate || null,
      shippingMethod: shippingMethod || 'Standard',
      shippingCarrier: shippingCarrier || '',
      paymentMethod: paymentMethod || 'Cash',
      paymentStatus: paymentStatus || 'Pending',
      couponCode: couponCode || '',
      customerNotes: '',
      internalNotes: internalNotes || '',
      tags: tags || [],
      createdBy: userId,
      userId: userId
    };

    const order = await Order.create(orderData);

    // ─── Auto-Generate Purchase Invoice ────────────────────
    const invoice = await autoGenerateInvoice(order, userId);

    res.status(201).json({
      success: true,
      message: 'Purchase Order created successfully',
      data: order,
      invoice: invoice
        ? { invoiceNumber: invoice.invoiceNumber, id: invoice.id }
        : null,
    });
  } catch (error) {
    console.error('Create purchase order error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
};

// @desc    Get all Purchase Orders
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
      paymentStatus,
      fromDate,
      toDate,
      sortBy = 'orderDate',
      sortOrder = 'desc',
    } = req.query;

    const filter = {
      isActive: true,
      userId: userId,
      orderType: 'Purchase Order'
    };

    if (search) {
      filter.OR = [
        { orderNumber: { contains: search, mode: 'insensitive' } },
        { customerName: { contains: search, mode: 'insensitive' } },
        { customerEmail: { contains: search, mode: 'insensitive' } },
        { customerCompany: { contains: search, mode: 'insensitive' } },
      ];
    }

    if (status && status !== 'all') filter.orderStatus = status;
    if (paymentStatus && paymentStatus !== 'all') filter.paymentStatus = paymentStatus;

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

    const [orders, total] = await Promise.all([
      Order.findPurchaseOrders(filter, { skip, take: limitNum, orderBy }),
      Order.countPurchaseOrders(filter),
    ]);

    const kpi = await Order.getStatusCounts(userId, 'Purchase Order');

    res.status(200).json({
      success: true,
      count: orders.length,
      data: orders,
      kpi,
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
    console.error('Get purchase orders error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// ============================================================
// ─── SHARED CONTROLLERS ──────────────────────────────────────
// ============================================================

// @desc    Get single order by ID
// @route   GET /api/orders/:id
// @access  Private
const getOrderById = async (req, res) => {
  try {
    const userId = req.user.id;
    const order = await prisma.order.findFirst({
      where: {
        id: req.params.id,
        userId: userId,
        isActive: true
      },
      include: {
        items: {
          include: {
            product: {
              select: { id: true, name: true, sku: true }
            }
          }
        },
        creator: {
          select: { id: true, firstName: true, lastName: true, email: true }
        },
        picker: {
          select: { id: true, firstName: true, lastName: true }
        },
        packer: {
          select: { id: true, firstName: true, lastName: true }
        },
        shipper: {
          select: { id: true, firstName: true, lastName: true }
        },
        updater: {
          select: { id: true, firstName: true, lastName: true, email: true }
        }
      }
    });

    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    res.status(200).json({ success: true, data: order });
  } catch (error) {
    console.error('Get order error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Update order status
// @route   PATCH /api/orders/:id/status
// @access  Private
const updateOrderStatus = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;
    const { status, notes } = req.body;

    if (!status) {
      return res.status(400).json({ success: false, message: 'Status is required' });
    }

    const order = await prisma.order.findFirst({
      where: { id: id, userId: userId }
    });

    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    const validTransitions = {
      Draft: ['Pending', 'Cancelled'],
      Pending: ['Processing', 'Cancelled'],
      Processing: ['Packed', 'Cancelled'],
      Packed: ['Shipped', 'Cancelled'],
      Shipped: ['In Transit', 'Delivered', 'Cancelled'],
      'In Transit': ['Delivered', 'Cancelled'],
      Delivered: ['Returned'],
      Cancelled: [],
      Returned: [],
      'On Hold': ['Pending', 'Processing', 'Cancelled'],
    };

    if (!validTransitions[order.orderStatus]?.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Cannot transition from ${order.orderStatus} to ${status}`,
      });
    }

    const updatedOrder = await Order.updateStatus(id, status, userId, notes);
    res.status(200).json({ success: true, data: updatedOrder });
  } catch (error) {
    console.error('Update order status error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Update order payment status
// @route   PATCH /api/orders/:id/payment
// @access  Private
const updateOrderPayment = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;
    const { paymentStatus, paymentReference } = req.body;

    if (!paymentStatus) {
      return res.status(400).json({ success: false, message: 'Payment status is required' });
    }

    const order = await prisma.order.findFirst({
      where: { id: id, userId: userId }
    });

    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    const updatedOrder = await Order.updatePayment(id, paymentStatus, paymentReference, userId);
    res.status(200).json({ success: true, data: updatedOrder });
  } catch (error) {
    console.error('Update payment status error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Cancel order
// @route   POST /api/orders/:id/cancel
// @access  Private
const cancelOrder = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;
    const { reason } = req.body;

    const order = await prisma.order.findFirst({
      where: { id: id, userId: userId }
    });

    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    if (!['Draft', 'Pending', 'Processing'].includes(order.orderStatus)) {
      return res.status(400).json({
        success: false,
        message: 'Order cannot be cancelled in current status',
      });
    }

    const cancelledOrder = await Order.cancelOrder(id, userId, reason);
    res.status(200).json({ success: true, data: cancelledOrder });
  } catch (error) {
    console.error('Cancel order error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Delete order (soft delete)
// @route   DELETE /api/orders/:id
// @access  Private (Admin only)
const deleteOrder = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    const order = await prisma.order.findFirst({
      where: { id: id, userId: userId }
    });

    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    if (!['Draft', 'Cancelled'].includes(order.orderStatus)) {
      return res.status(400).json({
        success: false,
        message: 'Only draft or cancelled orders can be deleted',
      });
    }

    await Order.softDelete(id, userId);
    res.status(200).json({ success: true, message: 'Order deleted successfully' });
  } catch (error) {
    console.error('Delete order error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Get order statistics / KPI
// @route   GET /api/orders/stats
// @access  Private
const getOrderStats = async (req, res) => {
  try {
    const userId = req.user.id;
    const { type } = req.query;
    
    let stats;
    if (type === 'sales') {
      stats = await Order.getStats(userId, 'Sales Order');
    } else if (type === 'purchase') {
      stats = await Order.getStats(userId, 'Purchase Order');
    } else {
      stats = await Order.getStats(userId);
    }
    
    res.status(200).json({ success: true, data: stats });
  } catch (error) {
    console.error('Get order stats error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Get order KPI
// @route   GET /api/orders/kpi
// @access  Private
const getOrderKPI = async (req, res) => {
  try {
    const userId = req.user.id;
    const { type } = req.query;
    
    let kpi;
    if (type === 'sales') {
      kpi = await Order.getStatusCounts(userId, 'Sales Order');
    } else if (type === 'purchase') {
      kpi = await Order.getStatusCounts(userId, 'Purchase Order');
    } else {
      kpi = await Order.getStatusCounts(userId);
    }
    
    res.status(200).json({ success: true, data: kpi });
  } catch (error) {
    console.error('Get order KPI error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  // Sales Orders
  createSalesOrder,
  getSalesOrders,
  
  // Purchase Orders
  createPurchaseOrder,
  getPurchaseOrders,
  
  // Shared
  getOrderById,
  updateOrderStatus,
  updateOrderPayment,
  cancelOrder,
  deleteOrder,
  getOrderStats,
  getOrderKPI
};