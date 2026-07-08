// warehouse/controller/returnController.js - COMPLETE SALES & PURCHASE RETURN CONTROLLER

const Return = require('../models/Return');
const prisma = require('../../prisma/client');

// ============================================================
// HELPER: Auto-create Refund on Return Complete
// ============================================================
const autoCreateRefund = async (returnData, userId) => {
  try {
    const refundNumber = (() => {
      const date = new Date();
      const y = date.getFullYear();
      const m = String(date.getMonth() + 1).padStart(2, '0');
      const d = String(date.getDate()).padStart(2, '0');
      const rand = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
      return `REF-${y}${m}${d}-${rand}`;
    })();

    const refund = await prisma.refund.create({
      data: {
        refundNumber,
        refundDate: new Date(),
        orderId: returnData.orderId,
        orderNumber: returnData.orderNumber,
        returnId: returnData.id,
        returnNumber: returnData.returnNumber,
        customerName: returnData.customerName,
        customerEmail: returnData.customerEmail || '',
        customerPhone: returnData.customerPhone || '',
        amount: returnData.totalRefund,
        refundStatus: 'Pending',
        refundMethod: returnData.returnMethod || 'Original Payment',
        reason: `Auto-generated from Return: ${returnData.returnNumber}`,
        notes: '',
        createdBy: userId,
        updatedBy: userId,
        userId: userId
      },
    });

    console.log(`✅ Refund auto-created: ${refundNumber} from Return: ${returnData.returnNumber}`);
    return refund;
  } catch (error) {
    console.error('Auto-create refund error:', error);
    return null;
  }
};

// ============================================================
// ─── SALES RETURN CONTROLLERS ────────────────────────────────
// ============================================================

// @desc    Create Sales Return
// @route   POST /api/sales/returns
// @access  Private
const createSalesReturn = async (req, res) => {
  try {
    const userId = req.user.id;
    const returnData = {
      ...req.body,
      returnType: 'Sales Return',
      createdBy: userId,
      userId: userId
    };
    
    const salesReturn = await Return.create(returnData);
    
    res.status(201).json({
      success: true,
      message: 'Sales Return created successfully',
      data: salesReturn
    });
  } catch (error) {
    console.error('Create sales return error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Get all Sales Returns
// @route   GET /api/sales/returns
// @access  Private
const getSalesReturns = async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      page = 1,
      limit = 10,
      search,
      status,
      customerId,
      fromDate,
      toDate,
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = req.query;

    const filter = {
      isActive: true,
      isDeleted: false,
      userId: userId,
      returnType: 'Sales Return'
    };

    if (search) {
      filter.OR = [
        { returnNumber: { contains: search, mode: 'insensitive' } },
        { orderNumber: { contains: search, mode: 'insensitive' } },
        { customerName: { contains: search, mode: 'insensitive' } },
        { customerEmail: { contains: search, mode: 'insensitive' } },
      ];
    }

    if (status && status !== 'all') filter.returnStatus = status;

    if (customerId) {
      const customer = await prisma.customer.findFirst({
        where: { id: customerId, userId: userId }
      });
      if (!customer) {
        return res.status(404).json({
          success: false,
          message: 'Customer not found'
        });
      }
      filter.customerId = customerId;
    }

    if (fromDate || toDate) {
      filter.returnDate = {};
      if (fromDate) filter.returnDate.gte = new Date(fromDate);
      if (toDate) {
        const endDate = new Date(toDate);
        endDate.setHours(23, 59, 59, 999);
        filter.returnDate.lte = endDate;
      }
    }

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;
    const orderBy = { [sortBy]: sortOrder === 'desc' ? 'desc' : 'asc' };

    const [returns, total, stats] = await Promise.all([
      Return.findSalesReturns(filter, { skip, take: limitNum, orderBy }),
      Return.countSalesReturns(filter),
      Return.getStats(userId, 'Sales Return')
    ]);

    res.status(200).json({
      success: true,
      data: returns,
      stats,
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
    console.error('Get sales returns error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ============================================================
// ─── PURCHASE RETURN CONTROLLERS ──────────────────────────────
// ============================================================

// @desc    Create Purchase Return
// @route   POST /api/purchase/returns
// @access  Private
const createPurchaseReturn = async (req, res) => {
  try {
    const userId = req.user.id;
    const returnData = {
      ...req.body,
      returnType: 'Purchase Return',
      createdBy: userId,
      userId: userId
    };
    
    const purchaseReturn = await Return.create(returnData);
    
    res.status(201).json({
      success: true,
      message: 'Purchase Return created successfully',
      data: purchaseReturn
    });
  } catch (error) {
    console.error('Create purchase return error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Get all Purchase Returns
// @route   GET /api/purchase/returns
// @access  Private
const getPurchaseReturns = async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      page = 1,
      limit = 10,
      search,
      status,
      supplierId,
      fromDate,
      toDate,
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = req.query;

    const filter = {
      isActive: true,
      isDeleted: false,
      userId: userId,
      returnType: 'Purchase Return'
    };

    if (search) {
      filter.OR = [
        { returnNumber: { contains: search, mode: 'insensitive' } },
        { orderNumber: { contains: search, mode: 'insensitive' } },
        { customerName: { contains: search, mode: 'insensitive' } },
        { customerEmail: { contains: search, mode: 'insensitive' } },
      ];
    }

    if (status && status !== 'all') filter.returnStatus = status;

    if (supplierId) {
      const supplier = await prisma.supplier.findFirst({
        where: { id: supplierId, userId: userId }
      });
      if (!supplier) {
        return res.status(404).json({
          success: false,
          message: 'Supplier not found'
        });
      }
      filter.supplierId = supplierId;
    }

    if (fromDate || toDate) {
      filter.returnDate = {};
      if (fromDate) filter.returnDate.gte = new Date(fromDate);
      if (toDate) {
        const endDate = new Date(toDate);
        endDate.setHours(23, 59, 59, 999);
        filter.returnDate.lte = endDate;
      }
    }

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;
    const orderBy = { [sortBy]: sortOrder === 'desc' ? 'desc' : 'asc' };

    const [returns, total, stats] = await Promise.all([
      Return.findPurchaseReturns(filter, { skip, take: limitNum, orderBy }),
      Return.countPurchaseReturns(filter),
      Return.getStats(userId, 'Purchase Return')
    ]);

    res.status(200).json({
      success: true,
      data: returns,
      stats,
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
    console.error('Get purchase returns error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ============================================================
// ─── SHARED RETURN CONTROLLERS ────────────────────────────────
// ============================================================

// @desc    Get return by ID
// @route   GET /api/returns/:id
// @access  Private
const getReturnById = async (req, res) => {
  try {
    const userId = req.user.id;
    const returnData = await prisma.return.findFirst({
      where: {
        id: req.params.id,
        userId: userId,
        isActive: true,
        isDeleted: false
      },
      include: {
        items: {
          include: {
            product: {
              select: { id: true, name: true, sku: true, sellingPrice: true, currentStock: true }
            }
          }
        },
        creator: {
          select: { id: true, firstName: true, lastName: true, email: true }
        },
        approver: {
          select: { id: true, firstName: true, lastName: true, email: true }
        },
        updater: {
          select: { id: true, firstName: true, lastName: true, email: true }
        },
        order: {
          select: { id: true, orderNumber: true, customerName: true, grandTotal: true }
        }
      }
    });

    if (!returnData) {
      return res.status(404).json({ success: false, message: 'Return not found' });
    }

    res.status(200).json({ success: true, data: returnData });
  } catch (error) {
    console.error('Get return error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Approve Return
// @route   PATCH /api/returns/:id/approve
// @access  Private
const approveReturn = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;
    const { notes } = req.body;

    const returnData = await Return.findById(id);
    if (!returnData) {
      return res.status(404).json({ success: false, message: 'Return not found' });
    }

    if (returnData.returnStatus !== 'Pending') {
      return res.status(400).json({
        success: false,
        message: `Cannot approve return with status: ${returnData.returnStatus}`
      });
    }

    const updated = await Return.approve(id, userId, notes);
    res.status(200).json({ success: true, data: updated });
  } catch (error) {
    console.error('Approve return error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Reject Return
// @route   PATCH /api/returns/:id/reject
// @access  Private
const rejectReturn = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;
    const { rejectionReason } = req.body;

    if (!rejectionReason) {
      return res.status(400).json({ success: false, message: 'Rejection reason is required' });
    }

    const returnData = await Return.findById(id);
    if (!returnData) {
      return res.status(404).json({ success: false, message: 'Return not found' });
    }

    if (returnData.returnStatus !== 'Pending') {
      return res.status(400).json({
        success: false,
        message: `Cannot reject return with status: ${returnData.returnStatus}`
      });
    }

    const updated = await Return.reject(id, userId, rejectionReason);
    res.status(200).json({ success: true, data: updated });
  } catch (error) {
    console.error('Reject return error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Complete Return
// @route   PATCH /api/returns/:id/complete
// @access  Private
const completeReturn = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;
    const { receivedDate } = req.body;

    const returnData = await Return.findById(id);
    if (!returnData) {
      return res.status(404).json({ success: false, message: 'Return not found' });
    }

    if (returnData.returnStatus !== 'Approved') {
      return res.status(400).json({
        success: false,
        message: `Cannot complete return with status: ${returnData.returnStatus}`
      });
    }

    const updated = await Return.complete(id, userId, receivedDate);

    // Auto-create refund only for Sales Returns
    if (returnData.returnType === 'Sales Return') {
      const refund = await autoCreateRefund(returnData, userId);
      return res.status(200).json({
        success: true,
        message: 'Return completed successfully',
        data: updated,
        refund: refund ? { refundNumber: refund.refundNumber, id: refund.id, amount: refund.amount } : null
      });
    }

    res.status(200).json({
      success: true,
      message: 'Return completed successfully',
      data: updated
    });
  } catch (error) {
    console.error('Complete return error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Cancel Return
// @route   POST /api/returns/:id/cancel
// @access  Private
const cancelReturn = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;
    const { reason } = req.body;

    const returnData = await Return.findById(id);
    if (!returnData) {
      return res.status(404).json({ success: false, message: 'Return not found' });
    }

    if (['Completed', 'Cancelled'].includes(returnData.returnStatus)) {
      return res.status(400).json({
        success: false,
        message: `Cannot cancel return with status: ${returnData.returnStatus}`
      });
    }

    const updated = await Return.cancel(id, userId, reason);
    res.status(200).json({ success: true, data: updated });
  } catch (error) {
    console.error('Cancel return error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Delete Return (soft delete)
// @route   DELETE /api/returns/:id
// @access  Private (Admin only)
const deleteReturn = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    const returnData = await Return.findById(id);
    if (!returnData) {
      return res.status(404).json({ success: false, message: 'Return not found' });
    }

    await Return.softDelete(id, userId);
    res.status(200).json({ success: true, message: 'Return deleted successfully' });
  } catch (error) {
    console.error('Delete return error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Get Return Stats
// @route   GET /api/returns/stats
// @access  Private
const getReturnStats = async (req, res) => {
  try {
    const userId = req.user.id;
    const { period = 'month', type } = req.query;
    
    let stats;
    let dailyTrend;
    
    if (type === 'sales') {
      stats = await Return.getStats(userId, 'Sales Return', period);
      dailyTrend = await Return.getDailyTrend(userId, 'Sales Return', period);
    } else if (type === 'purchase') {
      stats = await Return.getStats(userId, 'Purchase Return', period);
      dailyTrend = await Return.getDailyTrend(userId, 'Purchase Return', period);
    } else {
      stats = await Return.getStats(userId, null, period);
      dailyTrend = await Return.getDailyTrend(userId, null, period);
    }
    
    res.status(200).json({
      success: true,
      data: { ...stats, dailyTrend }
    });
  } catch (error) {
    console.error('Get return stats error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Get Returns by Order
// @route   GET /api/returns/order/:orderId
// @access  Private
const getReturnsByOrder = async (req, res) => {
  try {
    const userId = req.user.id;
    const { orderId } = req.params;

    const order = await prisma.order.findFirst({
      where: { id: orderId, userId: userId },
      select: { id: true }
    });

    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    const returns = await prisma.return.findMany({
      where: {
        orderId: orderId,
        userId: userId,
        isActive: true,
        isDeleted: false
      },
      include: {
        items: true,
        creator: {
          select: { id: true, firstName: true, lastName: true, email: true }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    res.status(200).json({ success: true, data: returns });
  } catch (error) {
    console.error('Get returns by order error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  // Sales Returns
  createSalesReturn,
  getSalesReturns,
  
  // Purchase Returns
  createPurchaseReturn,
  getPurchaseReturns,
  
  // Shared
  getReturnById,
  approveReturn,
  rejectReturn,
  completeReturn,
  cancelReturn,
  deleteReturn,
  getReturnStats,
  getReturnsByOrder
};