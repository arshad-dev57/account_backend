// warehouse/controller/salesPaymentController.js - COMPLETE CORRECTED

const SalesPaymentReceived = require('../models/SalesPaymentReceived');
const prisma = require('../../prisma/client');
const { fiscalYearGuard } = require('../../middleware/fiscalYearMiddleware');
const { resolveFiscalYearId } = require('../../utils/fiscalYearHelper');

// ============================================================
// ─── SALES PAYMENT RECEIVED CONTROLLERS ──────────────────────
// ============================================================

// @desc    Get Customer Invoices for Payment
// @route   GET /api/sales/payments/customer/:customerId/invoices
// @access  Private
const getCustomerInvoices = async (req, res) => {
  try {
    const userId = req.user.id;
    const companyId = req.user.companyId;
    const { customerId } = req.params;

    // ─── Check if customer exists ──────────────────────────
    const customer = await prisma.customer.findFirst({
      where: {
        id: customerId,
        companyId: companyId,
        isActive: true,
        isDeleted: false
      }
    });

    if (!customer) {
      return res.status(404).json({
        success: false,
        message: 'Customer not found'
      });
    }

    const invoices = await SalesPaymentReceived.getCustomerInvoices(customerId, companyId);

    res.status(200).json({
      success: true,
      count: invoices.length,
      data: invoices
    });
  } catch (error) {
    console.error('Get customer invoices error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Server error'
    });
  }
};

// @desc    Receive Payment
// @route   POST /api/sales/payments/receive
// @access  Private
const receivePayment = async (req, res) => {
  try {
    const userId = req.user.id;
    const companyId = req.user.companyId;
    const {
      customerId,
      customerName,
      amount,
      paymentMethod,
      bankAccountId,
      bankAccountName,
      reference,
      notes,
      invoicePayments,
      paymentDate
    } = req.body;

    const postingDate = paymentDate ? new Date(paymentDate) : new Date();

    // ─── Fiscal Year Guard ──────────────────────────────────
    try {
      await fiscalYearGuard(userId, postingDate);
    } catch (err) {
      if (err.code === 'FISCAL_YEAR_CLOSED') {
        return res.status(400).json({ success: false, message: err.message });
      }
      throw err;
    }

    // ─── Resolve Fiscal Year ID ─────────────────────────────
    const fiscalYearId = await resolveFiscalYearId(userId, postingDate);

    // ─── Validation ──────────────────────────────────────────
    if (!customerId) {
      return res.status(400).json({
        success: false,
        message: 'Customer is required'
      });
    }

    if (!invoicePayments || invoicePayments.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'At least one invoice must be selected'
      });
    }

    if (!amount || amount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Payment amount must be greater than 0'
      });
    }

    // ─── Process Payment ────────────────────────────────────
    const paymentData = {
      customerId,
      customerName,
      amount,
      paymentMethod: paymentMethod || 'Cash',
      bankAccountId,
      bankAccountName,
      reference,
      notes,
      invoicePayments,
      paymentDate: postingDate,
      userId,
      createdBy: userId,
      fiscalYearId,
      companyId
    };

    const payment = await SalesPaymentReceived.receivePayment(paymentData);

    res.status(201).json({
      success: true,
      message: 'Payment received successfully',
      data: payment
    });
  } catch (error) {
    console.error('Receive payment error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Server error'
    });
  }
};

// @desc    Get All Payments with Filters
// @route   GET /api/sales/payments
// @access  Private
const getPayments = async (req, res) => {
  try {
    const userId = req.user.id;
    const companyId = req.user.companyId;
    const {
      page = 1,
      limit = 20,
      search,
      customerId,
      fromDate,
      toDate,
      sortBy = 'paymentDate',
      sortOrder = 'desc'
    } = req.query;

    const filter = {
      companyId: companyId,
      isActive: true,
      isDeleted: false
    };

    // ✅ FIXED: Search in customer relation as well
    if (search) {
      filter.OR = [
        { paymentNumber: { contains: search, mode: 'insensitive' } },
        { customerName: { contains: search, mode: 'insensitive' } },
        { reference: { contains: search, mode: 'insensitive' } },
        {
          customer: {
            OR: [
              { name: { contains: search, mode: 'insensitive' } },
              { email: { contains: search, mode: 'insensitive' } },
              { phone: { contains: search, mode: 'insensitive' } },
              { customerNumber: { contains: search, mode: 'insensitive' } }
            ]
          }
        }
      ];
    }

    if (customerId) {
      filter.customerId = customerId;
    }

    if (fromDate || toDate) {
      filter.paymentDate = {};
      if (fromDate) filter.paymentDate.gte = new Date(fromDate);
      if (toDate) {
        const endDate = new Date(toDate);
        endDate.setHours(23, 59, 59, 999);
        filter.paymentDate.lte = endDate;
      }
    }

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;
    const orderBy = { [sortBy]: sortOrder === 'asc' ? 'asc' : 'desc' };

    const [payments, total, stats] = await Promise.all([
      SalesPaymentReceived.findAll(filter, { skip, take: limitNum, orderBy }),
      SalesPaymentReceived.count(filter),
      SalesPaymentReceived.getStats(companyId)
    ]);

    res.status(200).json({
      success: true,
      count: payments.length,
      data: payments,
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
    console.error('Get payments error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// @desc    Get Payment by ID
// @route   GET /api/sales/payments/:id
// @access  Private
const getPaymentById = async (req, res) => {
  try {
    const userId = req.user.id;
    const companyId = req.user.companyId;
    const { id } = req.params;

    const payment = await prisma.salesPaymentReceived.findFirst({
      where: {
        id: id,
        companyId: companyId,
        isActive: true,
        isDeleted: false
      },
      include: {
        invoicePayments: {
          include: {
            invoice: {
              include: {
                items: true
              }
            }
          }
        },
        customer: true,
        bankAccount: true,
        journalEntry: {
          include: {
            lines: {
              include: {
                account: true
              }
            }
          }
        },
        creator: {
          select: { id: true, firstName: true, lastName: true, email: true }
        }
      }
    });

    if (!payment) {
      return res.status(404).json({
        success: false,
        message: 'Payment not found'
      });
    }

    res.status(200).json({
      success: true,
      data: payment
    });
  } catch (error) {
    console.error('Get payment error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// @desc    Get Payment by Number
// @route   GET /api/sales/payments/number/:paymentNumber
// @access  Private
const getPaymentByNumber = async (req, res) => {
  try {
    const userId = req.user.id;
    const companyId = req.user.companyId;
    const { paymentNumber } = req.params;

    const payment = await prisma.salesPaymentReceived.findFirst({
      where: {
        paymentNumber: paymentNumber,
        companyId: companyId,
        isActive: true,
        isDeleted: false
      },
      include: {
        invoicePayments: {
          include: {
            invoice: true
          }
        },
        customer: true,
        bankAccount: true,
        journalEntry: {
          include: {
            lines: {
              include: {
                account: true
              }
            }
          }
        }
      }
    });

    if (!payment) {
      return res.status(404).json({
        success: false,
        message: 'Payment not found'
      });
    }

    res.status(200).json({
      success: true,
      data: payment
    });
  } catch (error) {
    console.error('Get payment by number error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// @desc    Cancel Payment
// @route   POST /api/sales/payments/:id/cancel
// @access  Private
const cancelPayment = async (req, res) => {
  try {
    const userId = req.user.id;
    const companyId = req.user.companyId;
    const { id } = req.params;
    const { reason } = req.body;

    const payment = await prisma.salesPaymentReceived.findFirst({
      where: {
        id: id,
        companyId: companyId,
        isActive: true,
        isDeleted: false
      }
    });

    if (!payment) {
      return res.status(404).json({
        success: false,
        message: 'Payment not found'
      });
    }

    if (payment.status === 'Cancelled') {
      return res.status(400).json({
        success: false,
        message: 'Payment already cancelled'
      });
    }

    const cancelledPayment = await SalesPaymentReceived.cancelPayment(id, userId, reason);

    res.status(200).json({
      success: true,
      message: 'Payment cancelled successfully',
      data: cancelledPayment
    });
  } catch (error) {
    console.error('Cancel payment error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Server error'
    });
  }
};

// @desc    Get Payment Stats
// @route   GET /api/sales/payments/stats
// @access  Private
const getPaymentStats = async (req, res) => {
  try {
    const userId = req.user.id;
    const companyId = req.user.companyId;
    const stats = await SalesPaymentReceived.getStats(companyId);

    res.status(200).json({
      success: true,
      data: stats
    });
  } catch (error) {
    console.error('Get payment stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// @desc    Delete Payment (Soft Delete)
// @route   DELETE /api/sales/payments/:id
// @access  Private
const deletePayment = async (req, res) => {
  try {
    const userId = req.user.id;
    const companyId = req.user.companyId;
    const { id } = req.params;

    const payment = await prisma.salesPaymentReceived.findFirst({
      where: {
        id: id,
        companyId: companyId,
        isActive: true,
        isDeleted: false
      }
    });

    if (!payment) {
      return res.status(404).json({
        success: false,
        message: 'Payment not found'
      });
    }

    if (payment.status !== 'Cancelled') {
      return res.status(400).json({
        success: false,
        message: 'Only cancelled payments can be deleted'
      });
    }

    await prisma.salesPaymentReceived.update({
      where: { id },
      data: {
        isDeleted: true,
        isActive: false,
        updatedBy: userId
      }
    });

    res.status(200).json({
      success: true,
      message: 'Payment deleted successfully'
    });
  } catch (error) {
    console.error('Delete payment error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// ─── EXPORT CONTROLLERS ──────────────────────────────────────

module.exports = {
  getCustomerInvoices,
  receivePayment,
  getPayments,
  getPaymentById,
  getPaymentByNumber,
  cancelPayment,
  getPaymentStats,
  deletePayment
};