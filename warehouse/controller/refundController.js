// controllers/refundController.js - COMPLETE SALES & PURCHASE REFUND CONTROLLER

const Refund = require('../models/Refunds');
const prisma = require('../../prisma/client');

// ============================================================
// ─── SALES REFUND CONTROLLERS ────────────────────────────────
// ============================================================

// @desc    Create Sales Refund
// @route   POST /api/sales/refunds
// @access  Private
const createSalesRefund = async (req, res) => {
  try {
    const userId = req.user.id;
    const refundData = {
      ...req.body,
      refundType: 'Sales Refund',
      createdBy: userId,
      userId: userId
    };
    
    const refund = await Refund.create(refundData);
    
    // Update order payment status
    if (refundData.orderId) {
      await prisma.order.update({
        where: { id: refundData.orderId },
        data: { paymentStatus: 'Refunded' }
      });
    }
    
    res.status(201).json({
      success: true,
      message: 'Sales Refund created successfully',
      data: refund
    });
  } catch (error) {
    console.error('Create sales refund error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Get all Sales Refunds
// @route   GET /api/sales/refunds
// @access  Private
const getSalesRefunds = async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      page = 1,
      limit = 10,
      search,
      status,
      method,
      fromDate,
      toDate,
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = req.query;

    const filter = {
      isActive: true,
      isDeleted: false,
      userId: userId,
      refundType: 'Sales Refund'
    };

    if (search) {
      filter.OR = [
        { refundNumber: { contains: search, mode: 'insensitive' } },
        { orderNumber: { contains: search, mode: 'insensitive' } },
        { customerName: { contains: search, mode: 'insensitive' } },
        { customerEmail: { contains: search, mode: 'insensitive' } },
      ];
    }

    if (status && status !== 'all') filter.refundStatus = status;
    if (method && method !== 'all') filter.refundMethod = method;

    if (fromDate || toDate) {
      filter.refundDate = {};
      if (fromDate) filter.refundDate.gte = new Date(fromDate);
      if (toDate) {
        const endDate = new Date(toDate);
        endDate.setHours(23, 59, 59, 999);
        filter.refundDate.lte = endDate;
      }
    }

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;
    const orderBy = { [sortBy]: sortOrder === 'desc' ? 'desc' : 'asc' };

    const [refunds, total, stats] = await Promise.all([
      Refund.findSalesRefunds(filter, { skip, take: limitNum, orderBy }),
      Refund.countSalesRefunds(filter),
      Refund.getStats(userId, 'Sales Refund')
    ]);

    res.status(200).json({
      success: true,
      data: refunds,
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
    console.error('Get sales refunds error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ============================================================
// ─── PURCHASE REFUND CONTROLLERS ─────────────────────────────
// ============================================================

// @desc    Create Purchase Refund
// @route   POST /api/purchase/refunds
// @access  Private
const createPurchaseRefund = async (req, res) => {
  try {
    const userId = req.user.id;
    const refundData = {
      ...req.body,
      refundType: 'Purchase Refund',
      createdBy: userId,
      userId: userId
    };
    
    const refund = await Refund.create(refundData);
    
    res.status(201).json({
      success: true,
      message: 'Purchase Refund created successfully',
      data: refund
    });
  } catch (error) {
    console.error('Create purchase refund error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Get all Purchase Refunds
// @route   GET /api/purchase/refunds
// @access  Private
const getPurchaseRefunds = async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      page = 1,
      limit = 10,
      search,
      status,
      method,
      fromDate,
      toDate,
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = req.query;

    const filter = {
      isActive: true,
      isDeleted: false,
      userId: userId,
      refundType: 'Purchase Refund'
    };

    if (search) {
      filter.OR = [
        { refundNumber: { contains: search, mode: 'insensitive' } },
        { purchaseNumber: { contains: search, mode: 'insensitive' } },
        { supplierName: { contains: search, mode: 'insensitive' } },
        { supplierEmail: { contains: search, mode: 'insensitive' } },
      ];
    }

    if (status && status !== 'all') filter.refundStatus = status;
    if (method && method !== 'all') filter.refundMethod = method;

    if (fromDate || toDate) {
      filter.refundDate = {};
      if (fromDate) filter.refundDate.gte = new Date(fromDate);
      if (toDate) {
        const endDate = new Date(toDate);
        endDate.setHours(23, 59, 59, 999);
        filter.refundDate.lte = endDate;
      }
    }

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;
    const orderBy = { [sortBy]: sortOrder === 'desc' ? 'desc' : 'asc' };

    const [refunds, total, stats] = await Promise.all([
      Refund.findPurchaseRefunds(filter, { skip, take: limitNum, orderBy }),
      Refund.countPurchaseRefunds(filter),
      Refund.getStats(userId, 'Purchase Refund')
    ]);

    res.status(200).json({
      success: true,
      data: refunds,
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
    console.error('Get purchase refunds error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ============================================================
// ─── SHARED REFUND CONTROLLERS ──────────────────────────────
// ============================================================

// @desc    Get refund by ID
// @route   GET /api/refunds/:id
// @access  Private
const getRefundById = async (req, res) => {
  try {
    const userId = req.user.id;
    const refund = await prisma.refund.findFirst({
      where: {
        id: req.params.id,
        userId: userId,
        isActive: true,
        isDeleted: false
      },
      include: {
        creator: {
          select: { id: true, firstName: true, lastName: true, email: true }
        },
        processor: {
          select: { id: true, firstName: true, lastName: true, email: true }
        },
        order: {
          select: { id: true, orderNumber: true, grandTotal: true, customerName: true }
        },
        purchase: {
          select: { id: true, purchaseNumber: true, grandTotal: true, supplierName: true }
        },
        supplier: {
          select: { id: true, name: true, email: true, phone: true }
        }
      }
    });

    if (!refund) {
      return res.status(404).json({ success: false, message: 'Refund not found' });
    }

    res.status(200).json({ success: true, data: refund });
  } catch (error) {
    console.error('Get refund error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Get refund by number
// @route   GET /api/refunds/number/:refundNumber
// @access  Private
const getRefundByNumber = async (req, res) => {
  try {
    const userId = req.user.id;
    const refund = await prisma.refund.findFirst({
      where: {
        refundNumber: req.params.refundNumber,
        userId: userId
      },
      include: {
        creator: {
          select: { id: true, firstName: true, lastName: true, email: true }
        },
        order: {
          select: { id: true, orderNumber: true, grandTotal: true }
        },
        purchase: {
          select: { id: true, purchaseNumber: true, grandTotal: true }
        }
      }
    });

    if (!refund) {
      return res.status(404).json({ success: false, message: 'Refund not found' });
    }

    res.status(200).json({ success: true, data: refund });
  } catch (error) {
    console.error('Get refund by number error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Get refunds by order
// @route   GET /api/refunds/order/:orderId
// @access  Private
const getOrderRefunds = async (req, res) => {
  try {
    const userId = req.user.id;
    const refunds = await Refund.findByOrderId(req.params.orderId);
    res.status(200).json({ success: true, data: refunds });
  } catch (error) {
    console.error('Get order refunds error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Get refunds by purchase
// @route   GET /api/refunds/purchase/:purchaseId
// @access  Private
const getPurchaseRefundsByPurchase = async (req, res) => {
  try {
    const userId = req.user.id;
    const refunds = await Refund.findByPurchaseId(req.params.purchaseId);
    res.status(200).json({ success: true, data: refunds });
  } catch (error) {
    console.error('Get purchase refunds error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Update refund
// @route   PUT /api/refunds/:id
// @access  Private
const updateRefund = async (req, res) => {
  try {
    const userId = req.user.id;
    const refund = await Refund.findById(req.params.id);
    if (!refund) {
      return res.status(404).json({ success: false, message: 'Refund not found' });
    }

    if (refund.refundStatus !== 'Pending') {
      return res.status(400).json({
        success: false,
        message: `Cannot update refund with status: ${refund.refundStatus}`
      });
    }

    const updated = await Refund.update(req.params.id, {
      ...req.body,
      updatedBy: userId
    });

    res.status(200).json({ success: true, data: updated });
  } catch (error) {
    console.error('Update refund error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Process refund
// @route   PATCH /api/refunds/:id/process
// @access  Private
const processRefund = async (req, res) => {
  try {
    const userId = req.user.id;
    const refund = await Refund.findById(req.params.id);
    if (!refund) {
      return res.status(404).json({ success: false, message: 'Refund not found' });
    }

    if (refund.refundStatus !== 'Pending') {
      return res.status(400).json({
        success: false,
        message: `Cannot process refund with status: ${refund.refundStatus}`
      });
    }

    const processed = await Refund.process(req.params.id, userId);
    res.status(200).json({ success: true, data: processed });
  } catch (error) {
    console.error('Process refund error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Complete refund
// @route   PATCH /api/refunds/:id/complete
// @access  Private
const completeRefund = async (req, res) => {
  try {
    const userId = req.user.id;
    const refund = await Refund.findById(req.params.id);
    if (!refund) {
      return res.status(404).json({ success: false, message: 'Refund not found' });
    }

    if (refund.refundStatus !== 'Processing') {
      return res.status(400).json({
        success: false,
        message: `Cannot complete refund with status: ${refund.refundStatus}`
      });
    }

    const completed = await Refund.complete(req.params.id, userId);
    res.status(200).json({ success: true, data: completed });
  } catch (error) {
    console.error('Complete refund error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Cancel refund
// @route   PATCH /api/refunds/:id/cancel
// @access  Private
const cancelRefund = async (req, res) => {
  try {
    const userId = req.user.id;
    const refund = await Refund.findById(req.params.id);
    if (!refund) {
      return res.status(404).json({ success: false, message: 'Refund not found' });
    }

    if (['Completed', 'Cancelled'].includes(refund.refundStatus)) {
      return res.status(400).json({
        success: false,
        message: `Cannot cancel refund with status: ${refund.refundStatus}`
      });
    }

    const cancelled = await Refund.cancel(req.params.id, userId, req.body.reason);
    res.status(200).json({ success: true, data: cancelled });
  } catch (error) {
    console.error('Cancel refund error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Delete refund (soft delete)
// @route   DELETE /api/refunds/:id
// @access  Private (Admin only)
const deleteRefund = async (req, res) => {
  try {
    const userId = req.user.id;
    const refund = await Refund.findById(req.params.id);
    if (!refund) {
      return res.status(404).json({ success: false, message: 'Refund not found' });
    }

    if (!['Pending', 'Cancelled'].includes(refund.refundStatus)) {
      return res.status(400).json({
        success: false,
        message: `Cannot delete refund with status: ${refund.refundStatus}`
      });
    }

    await Refund.softDelete(req.params.id, userId);
    res.status(200).json({ success: true, message: 'Refund deleted successfully' });
  } catch (error) {
    console.error('Delete refund error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Get refund stats
// @route   GET /api/refunds/stats
// @access  Private
const getRefundStats = async (req, res) => {
  try {
    const userId = req.user.id;
    const { period = 'month', type } = req.query;
    
    let stats;
    let dailyTrend;
    
    if (type === 'sales') {
      stats = await Refund.getStats(userId, 'Sales Refund', period);
      dailyTrend = await Refund.getDailyTrend(userId, 'Sales Refund', period);
    } else if (type === 'purchase') {
      stats = await Refund.getStats(userId, 'Purchase Refund', period);
      dailyTrend = await Refund.getDailyTrend(userId, 'Purchase Refund', period);
    } else {
      stats = await Refund.getStats(userId, null, period);
      dailyTrend = await Refund.getDailyTrend(userId, null, period);
    }
    
    res.status(200).json({
      success: true,
      data: { ...stats, dailyTrend }
    });
  } catch (error) {
    console.error('Get refund stats error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Search refunds
// @route   GET /api/refunds/search
// @access  Private
const searchRefunds = async (req, res) => {
  try {
    const userId = req.user.id;
    const { q, limit = 10 } = req.query;

    if (!q || q.length < 2) {
      return res.status(200).json({ success: true, data: [], count: 0 });
    }

    const refunds = await Refund.search(userId, q, parseInt(limit));
    res.status(200).json({ success: true, data: refunds, count: refunds.length });
  } catch (error) {
    console.error('Search refunds error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  // Sales Refunds
  createSalesRefund,
  getSalesRefunds,
  
  // Purchase Refunds
  createPurchaseRefund,
  getPurchaseRefunds,
  
  // Shared
  getRefundById,
  getRefundByNumber,
  getOrderRefunds,
  getPurchaseRefundsByPurchase,
  updateRefund,
  processRefund,
  completeRefund,
  cancelRefund,
  deleteRefund,
  getRefundStats,
  searchRefunds
};